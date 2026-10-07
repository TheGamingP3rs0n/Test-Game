// Procedural soundtrack, synthesized live with WebAudio (the game ships no audio files).
//   menu   — upbeat "Kolkata night shift" theme: tabla groove, sitar-ish plucks in
//            D phrygian dominant, a fat bass and a bII chord move for that filmi flavor.
//   shift  — laid-back lo-fi beat for working the phones (sits under the voices).
//   review — slow, tense groove for the walk into the boss's office.
// Music plays on the UI audio context so it keeps going (muffled) while paused.
import { uiAudioCtx, uiAudioBuses } from './audio.js';

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

const TRACKS = {
  menu: {
    bpm: 104,
    swing: 0.06,
    bars: 4,
    gain: 0.9,
    // D | Eb | Cm | D   (chord tones as MIDI notes)
    chords: [[50, 54, 57], [51, 55, 58], [48, 51, 55], [50, 54, 57]],
    bass: { steps: [0, 3, 6, 8, 11, 14], pattern: [0, 0, 7, 12, 0, 7] },
    tabla: { 0: 'dha', 2: 'na', 3: 'na', 4: 'ge', 6: 'na', 8: 'dha', 10: 'tin', 11: 'na', 12: 'ge', 14: 'na', 15: 'ti' },
    kick: [0, 8, 11],
    clap: [4, 12],
    hat: [1, 3, 5, 7, 9, 11, 13, 15],
    pad: true,
    melody: [
      [0, 74, 2], [2, 72, 1], [3, 70, 1], [4, 69, 2], [6, 70, 1], [7, 69, 1], [8, 66, 3], [12, 67, 1], [13, 66, 1], [14, 63, 2],
      [16, 62, 4], [22, 66, 1], [23, 67, 1], [24, 69, 2], [26, 70, 2], [28, 72, 4],
      [32, 72, 2], [34, 70, 1], [35, 67, 1], [36, 63, 2], [38, 67, 1], [39, 70, 1], [40, 72, 3], [44, 70, 1], [45, 67, 1], [46, 63, 2],
      [48, 66, 4], [52, 69, 2], [54, 67, 1], [55, 66, 1], [56, 63, 1], [57, 62, 3], [60, 62, 4],
    ],
  },
  shift: {
    bpm: 80,
    swing: 0.16,
    bars: 4,
    gain: 0.55,
    // Dm9 | Bbmaj7 | Gm9 | A7
    chords: [[50, 53, 57, 60, 64], [46, 50, 53, 57], [43, 46, 50, 53, 57], [45, 49, 52, 55]],
    bass: { steps: [0, 7, 10], pattern: [0, 0, 7] },
    kick: [0, 7, 10],
    snare: [4, 12],
    hat: [0, 2, 4, 6, 8, 10, 12, 14],
    keys: [0, 7],
    crackle: true,
    melody: [
      [6, 69, 2], [8, 72, 3], [14, 69, 1], [15, 67, 1],
      [22, 65, 2], [24, 62, 4],
      [38, 70, 2], [40, 69, 2], [42, 65, 3],
      [54, 64, 2], [56, 61, 2], [58, 64, 4],
    ],
    melodyEvery: 2,
  },
  review: {
    bpm: 72,
    swing: 0,
    bars: 2,
    gain: 0.7,
    chords: [[38, 45, 50], [39, 46, 51]],
    bass: { steps: [0, 6, 8, 14], pattern: [0, 0, 1, 0] },
    tabla: { 0: 'ge', 6: 'ge', 8: 'dha', 12: 'na', 14: 'ge' },
    kick: [0, 6],
    pad: true,
    drone: 38,
    melody: [[8, 62, 2], [10, 63, 6], [24, 62, 2], [26, 60, 2], [28, 58, 4]],
  },
};

class Music {
  constructor() {
    this.track = null;
    this.timer = null;
    this.step = 0;
    this.loop = 0;
    this.nextTime = 0;
    this.duck = 1;
    this.voices = [];
  }

  setup() {
    if (this.c) return true;
    const c = uiAudioCtx();
    if (!c) return false;
    this.c = c;
    this.out = c.createGain();
    this.duckGain = c.createGain();
    this.muffle = c.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 18000;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.ratio.value = 3;
    this.out.connect(this.duckGain).connect(this.muffle).connect(this.comp).connect(uiAudioBuses.music);
    // echo for plucks
    this.delay = c.createDelay(2);
    this.fb = c.createGain();
    this.fb.gain.value = 0.32;
    this.wet = c.createGain();
    this.wet.gain.value = 0.22;
    this.delay.connect(this.fb).connect(this.delay);
    this.delay.connect(this.wet).connect(this.out);
    // small synthetic room
    this.verb = c.createConvolver();
    const len = c.sampleRate * 1.6;
    const ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    this.verb.buffer = ir;
    this.verbGain = c.createGain();
    this.verbGain.gain.value = 0.18;
    this.verb.connect(this.verbGain).connect(this.out);
    this.noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    return true;
  }

  /** Crossfade to a track ('menu' | 'shift' | 'review') or null for silence. */
  play(name) {
    if (!this.setup()) return;
    if (this.track === TRACKS[name] && this.timer) return;
    const c = this.c;
    const old = this.trackGain;
    if (old) {
      old.gain.cancelScheduledValues(c.currentTime);
      old.gain.setValueAtTime(old.gain.value, c.currentTime);
      old.gain.linearRampToValueAtTime(0, c.currentTime + 1.2);
      setTimeout(() => old.disconnect(), 1500);
    }
    clearInterval(this.timer);
    this.timer = null;
    this.track = TRACKS[name] || null;
    if (!this.track) return;
    this.trackGain = c.createGain();
    this.trackGain.gain.setValueAtTime(0, c.currentTime);
    this.trackGain.gain.linearRampToValueAtTime(this.track.gain, c.currentTime + 1.5);
    this.trackGain.connect(this.out);
    this.trackGain.connect(this.verb);
    this.delay.delayTime.value = (60 / this.track.bpm) * 0.75;
    this.step = 0;
    this.loop = 0;
    this.nextTime = c.currentTime + 0.12;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stop() {
    this.play(null);
  }

  /** Quieter under phone calls / boss speeches (0..1). */
  setDuck(v, seconds = 0.6) {
    if (!this.setup()) return;
    this.duck = v;
    const g = this.duckGain.gain;
    g.cancelScheduledValues(this.c.currentTime);
    g.setValueAtTime(g.value, this.c.currentTime);
    g.linearRampToValueAtTime(v, this.c.currentTime + seconds);
  }

  /** Muffled "through the wall" sound while the pause menu is open. */
  setMuffled(on) {
    if (!this.setup()) return;
    const f = this.muffle.frequency;
    f.cancelScheduledValues(this.c.currentTime);
    f.setValueAtTime(f.value, this.c.currentTime);
    f.exponentialRampToValueAtTime(on ? 650 : 18000, this.c.currentTime + 0.35);
  }

  schedule() {
    const t = this.track;
    if (!t) return;
    const c = this.c;
    const sixteenth = 60 / t.bpm / 4;
    while (this.nextTime < c.currentTime + 0.15) {
      const swingOffset = this.step % 2 ? t.swing * sixteenth : 0;
      this.playStep(this.step, this.nextTime + swingOffset, sixteenth);
      this.nextTime += sixteenth;
      this.step++;
      if (this.step >= t.bars * 16) {
        this.step = 0;
        this.loop++;
      }
    }
  }

  playStep(step, time, sixteenth) {
    const t = this.track;
    const s = step % 16;
    const bar = Math.floor(step / 16);
    const chord = t.chords[bar % t.chords.length];
    const breakdown = t === TRACKS.menu && this.loop % 4 === 2;
    if (t.kick?.includes(s) && !(breakdown && s !== 0)) this.kick(time);
    if (t.clap?.includes(s) && !breakdown) this.clap(time);
    if (t.snare?.includes(s)) this.snare(time);
    if (t.hat?.includes(s)) this.hat(time, s % 4 === 2 ? 0.05 : 0.03);
    if (t.tabla?.[s]) this.tabla(t.tabla[s], time);
    if (t.bass) {
      const i = t.bass.steps.indexOf(s);
      if (i >= 0 && !(breakdown && i > 0)) this.bass(mtof(chord[0] - 12 + t.bass.pattern[i]), time, sixteenth * (t === TRACKS.shift ? 5 : 2));
    }
    if (s === 0 && t.pad) this.pad(chord, time, sixteenth * 16);
    if (s === 0 && t.drone !== undefined) this.pad([t.drone - 12, t.drone - 5], time, sixteenth * 16, 0.05);
    if (t.keys?.includes(s)) this.keys(chord, time, sixteenth * (s === 0 ? 6 : 5));
    if (t.crackle && Math.random() < 0.18) this.crackle(time + Math.random() * sixteenth);
    const melodyOn = t.melodyEvery ? this.loop % t.melodyEvery === 1 : !breakdown;
    if (t.melody && melodyOn) {
      const octave = t === TRACKS.menu && this.loop % 4 === 3 ? 12 : 0;
      for (const [st, note, len] of t.melody) if (st === step) this.pluck(mtof(note + octave), time, sixteenth * len, t === TRACKS.shift ? 0.07 : 0.11);
    }
  }

  // ---------------------------------------------------------------- instruments
  env(node, time, attack, hold, release, peak) {
    node.gain.setValueAtTime(0.0001, time);
    node.gain.exponentialRampToValueAtTime(peak, time + attack);
    node.gain.setValueAtTime(peak, time + attack + hold);
    node.gain.exponentialRampToValueAtTime(0.0001, time + attack + hold + release);
  }

  osc(type, freq, time, dur, dest) {
    const o = this.c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, time);
    o.connect(dest);
    o.start(time);
    o.stop(time + dur + 0.05);
    return o;
  }

  noiseHit(time, dur, filterType, freq, q, vol) {
    const c = this.c;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    this.env(g, time, 0.002, 0, dur, vol);
    src.connect(f).connect(g).connect(this.trackGain);
    src.start(time, Math.random() * 0.5);
    src.stop(time + dur + 0.05);
  }

  kick(time) {
    const g = this.c.createGain();
    this.env(g, time, 0.003, 0.02, 0.28, 0.55);
    g.connect(this.trackGain);
    const o = this.osc('sine', 130, time, 0.35, g);
    o.frequency.exponentialRampToValueAtTime(42, time + 0.18);
  }

  clap(time) {
    this.noiseHit(time, 0.12, 'bandpass', 1500, 0.9, 0.22);
    this.noiseHit(time + 0.012, 0.16, 'bandpass', 1900, 0.8, 0.14);
  }

  snare(time) {
    this.noiseHit(time, 0.16, 'lowpass', 2600, 0.5, 0.11);
    const g = this.c.createGain();
    this.env(g, time, 0.002, 0, 0.1, 0.06);
    g.connect(this.trackGain);
    this.osc('triangle', 190, time, 0.12, g);
  }

  hat(time, vol) {
    this.noiseHit(time, 0.035, 'highpass', 7500, 0.7, vol);
  }

  /** Tabla bols: bayan (low, pitch-bending "ge"), dayan (ringing "na"/"tin"), both ("dha"). */
  tabla(bol, time) {
    const c = this.c;
    const dayan = (vol, decay) => {
      const g = c.createGain();
      this.env(g, time, 0.002, 0, decay, vol);
      g.connect(this.trackGain);
      const o = this.osc('sine', 520, time, decay + 0.05, g);
      o.frequency.exponentialRampToValueAtTime(470, time + decay);
      const g2 = c.createGain();
      this.env(g2, time, 0.002, 0, decay * 0.5, vol * 0.4);
      g2.connect(this.trackGain);
      this.osc('sine', 1040 * 1.5, time, decay, g2);
      this.noiseHit(time, 0.02, 'bandpass', 3000, 2, vol * 0.5);
    };
    const bayan = (vol) => {
      const g = c.createGain();
      this.env(g, time, 0.004, 0.02, 0.35, vol);
      g.connect(this.trackGain);
      const o = this.osc('sine', 85, time, 0.45, g);
      o.frequency.linearRampToValueAtTime(125, time + 0.12);
      o.frequency.exponentialRampToValueAtTime(95, time + 0.4);
    };
    if (bol === 'dha') {
      dayan(0.16, 0.22);
      bayan(0.3);
    } else if (bol === 'ge') bayan(0.28);
    else if (bol === 'tin') dayan(0.12, 0.3);
    else if (bol === 'ti') dayan(0.05, 0.06);
    else dayan(0.1, 0.12);
  }

  bass(freq, time, dur) {
    const c = this.c;
    const g = c.createGain();
    this.env(g, time, 0.01, dur * 0.6, dur * 0.5, 0.32);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, time);
    f.frequency.exponentialRampToValueAtTime(260, time + dur);
    f.Q.value = 3;
    g.connect(this.trackGain);
    f.connect(g);
    this.osc('sawtooth', freq, time, dur * 1.2, f);
    this.osc('sine', freq / 2, time, dur * 1.2, g);
  }

  pad(notes, time, dur, vol = 0.035) {
    const c = this.c;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(vol, time + dur * 0.3);
    g.gain.linearRampToValueAtTime(0.0001, time + dur * 1.05);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1300;
    f.connect(g).connect(this.trackGain);
    for (const n of notes) {
      this.osc('sawtooth', mtof(n + 12), time, dur * 1.1, f).detune.value = -7;
      this.osc('sawtooth', mtof(n + 12), time, dur * 1.1, f).detune.value = 7;
    }
  }

  /** Lo-fi electric piano chord with a soft tremolo. */
  keys(notes, time, dur) {
    const c = this.c;
    const g = c.createGain();
    this.env(g, time, 0.012, dur * 0.4, dur * 0.8, 0.05);
    const trem = c.createGain();
    trem.gain.value = 0.85;
    const lfo = c.createOscillator();
    lfo.frequency.value = 4.5;
    const lg = c.createGain();
    lg.gain.value = 0.15;
    lfo.connect(lg).connect(trem.gain);
    lfo.start(time);
    lfo.stop(time + dur * 1.3);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1800;
    trem.connect(f).connect(g).connect(this.trackGain);
    for (const n of notes) {
      this.osc('sine', mtof(n + 12), time, dur * 1.3, trem);
      const o2 = this.osc('triangle', mtof(n + 24), time, dur * 0.5, trem);
      o2.detune.value = 4;
    }
  }

  /** Plucked string with a little sitar-like pitch bend + echo. */
  pluck(freq, time, dur, vol) {
    const c = this.c;
    const g = c.createGain();
    this.env(g, time, 0.003, 0.02, Math.max(0.25, dur * 1.4), vol);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(4200, time);
    f.frequency.exponentialRampToValueAtTime(900, time + 0.4);
    f.Q.value = 4;
    f.connect(g);
    g.connect(this.trackGain);
    g.connect(this.delay);
    const o = this.osc('sawtooth', freq * 1.02, time, dur * 1.6 + 0.3, f);
    o.frequency.exponentialRampToValueAtTime(freq, time + 0.05);
    const o2 = this.osc('square', freq * 2, time, 0.2, f);
    o2.detune.value = 9;
    const g2 = c.createGain();
    g2.gain.value = 0.2;
    o2.disconnect();
    o2.connect(g2).connect(f);
  }

  crackle(time) {
    this.noiseHit(time, 0.008, 'highpass', 3000, 1, 0.03 + Math.random() * 0.03);
  }
}

export const music = new Music();
