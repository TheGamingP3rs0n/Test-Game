// All sound effects are synthesized with WebAudio, so the game ships no audio files.
// Voices (Groq TTS / custom WAVs) also route through here so volume sliders and the
// "phone line" EQ apply to them.
import { settings } from './store.js';
import { bus } from './bus.js';

let ctx = null; // game world: sfx, voices, ambience, alarms — suspended while paused
let uiCtx = null; // menus + music — keeps running while paused
const buses = {};
const uiBuses = {};
let voiceAnalyser = null;
let noiseBuffer = null;
let uiNoise = null;
const loops = new Map();
let gamePaused = false;

export function audioCtx() {
  if (!ctx) init();
  return ctx;
}

/** Context for menu sounds and music (never paused). */
export function uiAudioCtx() {
  if (!uiCtx) initUI();
  return uiCtx;
}
export const uiAudioBuses = uiBuses;

function makeNoise(c) {
  const b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function init() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  buses.master = ctx.createGain();
  buses.master.connect(ctx.destination);
  for (const name of ['sfx', 'voice', 'amb']) {
    buses[name] = ctx.createGain();
    buses[name].connect(buses.master);
  }
  voiceAnalyser = ctx.createAnalyser();
  voiceAnalyser.fftSize = 256;
  buses.voice.connect(voiceAnalyser);
  noiseBuffer = makeNoise(ctx);
  applyVolumes();
}

function initUI() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  uiCtx = new AC();
  uiBuses.master = uiCtx.createGain();
  uiBuses.master.connect(uiCtx.destination);
  uiBuses.sfx = uiCtx.createGain();
  uiBuses.sfx.connect(uiBuses.master);
  uiBuses.music = uiCtx.createGain();
  uiBuses.music.connect(uiBuses.master);
  uiNoise = makeNoise(uiCtx);
  applyVolumes();
}

function applyVolumes() {
  if (ctx) {
    buses.master.gain.value = settings.masterVolume;
    buses.sfx.gain.value = settings.sfxVolume;
    buses.voice.gain.value = settings.voiceVolume;
    buses.amb.gain.value = settings.ambienceVolume;
  }
  if (uiCtx) {
    uiBuses.master.gain.value = settings.masterVolume;
    uiBuses.sfx.gain.value = settings.sfxVolume;
    uiBuses.music.gain.value = settings.musicVolume ?? 0.5;
  }
}
bus.on('settings:changed', applyVolumes);

/** Must be called from a user gesture at least once (browser autoplay rules). */
export function unlockAudio() {
  audioCtx();
  uiAudioCtx();
  if (ctx && ctx.state === 'suspended' && !gamePaused) ctx.resume();
  if (uiCtx && uiCtx.state === 'suspended') uiCtx.resume();
}

/** Freeze every game sound (ringing phone, voices, sirens) exactly where it is. */
export function pauseGameAudio() {
  gamePaused = true;
  ctx?.suspend();
}

export function resumeGameAudio() {
  gamePaused = false;
  ctx?.resume();
}

export function voiceLevel() {
  if (!voiceAnalyser) return 0;
  const arr = new Uint8Array(voiceAnalyser.frequencyBinCount);
  voiceAnalyser.getByteTimeDomainData(arr);
  let sum = 0;
  for (const v of arr) sum += ((v - 128) / 128) ** 2;
  return Math.sqrt(sum / arr.length);
}

// Synthesis primitives write to the "current target" so the same recipes can play on
// the game context or the UI context.
let T = { c: null, b: buses, n: null };
function target(ui) {
  if (ui) {
    uiAudioCtx();
    T = { c: uiCtx, b: uiBuses, n: uiNoise };
  } else {
    audioCtx();
    T = { c: ctx, b: buses, n: noiseBuffer };
  }
  return T.c;
}

// ---------- synthesis primitives ----------
function tone({ freq = 440, type = 'sine', start = 0, dur = 0.2, vol = 0.3, attack = 0.005, release = 0.05, glide = null, dest = 'sfx', detune = 0 }) {
  const c = T.c;
  if (!c) return;
  const t0 = c.currentTime + start;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  o.detune.value = detune;
  if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, glide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  g.gain.setValueAtTime(vol, t0 + Math.max(attack, dur - release));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(typeof dest === 'string' ? T.b[dest] || T.b.sfx : dest);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
  return o;
}

function noise({ start = 0, dur = 0.3, vol = 0.3, filter = 'lowpass', freq = 1200, q = 1, sweepTo = null, dest = 'sfx' }) {
  const c = T.c;
  if (!c) return;
  const t0 = c.currentTime + start;
  const src = c.createBufferSource();
  src.buffer = T.n;
  src.loop = true;
  const f = c.createBiquadFilter();
  f.type = filter;
  f.frequency.setValueAtTime(freq, t0);
  f.Q.value = q;
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(T.b[dest] || T.b.sfx);
  src.start(t0, Math.random());
  src.stop(t0 + dur + 0.05);
}

const SFX = {
  micOn() {
    noise({ dur: 0.04, vol: 0.18, filter: 'bandpass', freq: 3000, q: 2 });
    tone({ freq: 1180, dur: 0.07, vol: 0.06, type: 'sine', start: 0.02 });
  },
  hover() {
    tone({ freq: 1600, dur: 0.03, vol: 0.025, type: 'sine' });
  },
  pause() {
    tone({ freq: 520, dur: 0.12, vol: 0.08, type: 'triangle', glide: 330 });
  },
  unpause() {
    tone({ freq: 330, dur: 0.12, vol: 0.08, type: 'triangle', glide: 560 });
  },
  ring() {
    for (let i = 0; i < 2; i++) {
      tone({ freq: 440, start: i * 0.5, dur: 0.4, vol: 0.12 });
      tone({ freq: 480, start: i * 0.5, dur: 0.4, vol: 0.12 });
    }
  },
  pickup() {
    noise({ dur: 0.08, vol: 0.4, filter: 'bandpass', freq: 2500, q: 2 });
    tone({ freq: 900, dur: 0.06, vol: 0.1, type: 'square', start: 0.05 });
  },
  hangup() {
    for (let i = 0; i < 3; i++) tone({ freq: 480, start: i * 0.35, dur: 0.22, vol: 0.12, type: 'sine' }) && tone({ freq: 620, start: i * 0.35, dur: 0.22, vol: 0.1 });
  },
  cash() {
    noise({ dur: 0.12, vol: 0.4, filter: 'highpass', freq: 3000 });
    [1318, 1568, 2093, 2637].forEach((f, i) => tone({ freq: f, type: 'triangle', start: 0.08 + i * 0.07, dur: 0.6, vol: 0.18 }));
  },
  click() {
    noise({ dur: 0.03, vol: 0.25, filter: 'bandpass', freq: 3500, q: 3 });
  },
  type() {
    noise({ dur: 0.025, vol: 0.12 + Math.random() * 0.08, filter: 'bandpass', freq: 2000 + Math.random() * 2500, q: 4 });
  },
  notify() {
    tone({ freq: 880, dur: 0.12, vol: 0.15, type: 'triangle' });
    tone({ freq: 1320, start: 0.1, dur: 0.2, vol: 0.15, type: 'triangle' });
  },
  error() {
    tone({ freq: 160, dur: 0.25, vol: 0.2, type: 'square' });
    tone({ freq: 120, start: 0.12, dur: 0.3, vol: 0.2, type: 'square' });
  },
  trustUp() {
    tone({ freq: 660, dur: 0.1, vol: 0.12, type: 'triangle' });
    tone({ freq: 990, start: 0.08, dur: 0.15, vol: 0.12, type: 'triangle' });
  },
  trustDown() {
    tone({ freq: 400, dur: 0.15, vol: 0.14, type: 'sawtooth', glide: 180 });
  },
  explosion() {
    noise({ dur: 2.2, vol: 1.0, filter: 'lowpass', freq: 900, sweepTo: 60 });
    tone({ freq: 60, dur: 1.5, vol: 0.6, type: 'sine', glide: 25 });
  },
  powerDown() {
    tone({ freq: 220, dur: 1.2, vol: 0.25, type: 'sawtooth', glide: 30 });
    noise({ dur: 0.3, vol: 0.3, filter: 'bandpass', freq: 400 });
  },
  powerUp() {
    tone({ freq: 60, dur: 0.8, vol: 0.2, type: 'sawtooth', glide: 400 });
    tone({ freq: 1200, start: 0.8, dur: 0.15, vol: 0.12, type: 'triangle' });
  },
  whoosh() {
    noise({ dur: 0.5, vol: 0.3, filter: 'bandpass', freq: 400, sweepTo: 3000, q: 1.5 });
  },
  moo() {
    tone({ freq: 140, dur: 1.4, vol: 0.35, type: 'sawtooth', glide: 95, attack: 0.15, release: 0.4 });
    tone({ freq: 210, dur: 1.4, vol: 0.12, type: 'sawtooth', glide: 140, attack: 0.15, release: 0.4 });
  },
  sting() {
    [130.8, 155.6, 185, 233].forEach((f) => tone({ freq: f, dur: 1.2, vol: 0.12, type: 'sawtooth', release: 0.6 }));
    noise({ dur: 0.4, vol: 0.4, filter: 'lowpass', freq: 300 });
  },
  win() {
    [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, start: i * 0.12, dur: 0.4, vol: 0.15, type: 'triangle' }));
  },
  lose() {
    [392, 370, 349, 330].forEach((f, i) => tone({ freq: f, start: i * 0.3, dur: 0.45, vol: 0.15, type: 'sawtooth' }));
  },
  stamp() {
    noise({ dur: 0.15, vol: 0.6, filter: 'lowpass', freq: 500 });
    tone({ freq: 90, dur: 0.15, vol: 0.4 });
  },
  shred() {
    noise({ dur: 1.2, vol: 0.35, filter: 'bandpass', freq: 1800, q: 0.8 });
    tone({ freq: 95, dur: 1.2, vol: 0.15, type: 'square' });
  },
  spray() {
    noise({ dur: 0.35, vol: 0.25, filter: 'highpass', freq: 2500 });
  },
  hold() {
    // elevator music jingle while caller puts you on hold
    [523, 587, 659, 587, 523, 440, 494, 523].forEach((f, i) => tone({ freq: f, start: i * 0.28, dur: 0.26, vol: 0.06, type: 'triangle' }));
  },
  static() {
    noise({ dur: 0.6, vol: 0.15, filter: 'bandpass', freq: 1800, q: 0.5 });
  },
  popup() {
    tone({ freq: 1046, dur: 0.08, vol: 0.12, type: 'square' });
    tone({ freq: 784, start: 0.08, dur: 0.1, vol: 0.12, type: 'square' });
  },
};

const UI_SFX = new Set(['click', 'hover', 'pause', 'unpause']);

/** Play a sound. Menu sounds (and anything played while paused) use the UI context. */
export function sfx(name, { ui = UI_SFX.has(name) || gamePaused } = {}) {
  try {
    if (!target(ui)) return;
    SFX[name]?.();
  } catch (err) {
    console.warn('sfx failed', name, err);
  } finally {
    T = { c: ctx, b: buses, n: noiseBuffer };
  }
}

// ---------- looping sounds (sirens, alarms, ambience) ----------
const LOOPS = {
  policeSiren(c, out) {
    const o = c.createOscillator();
    o.type = 'square';
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.9;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 250;
    lfo.connect(lfoGain).connect(o.frequency);
    o.frequency.value = 800;
    const g = c.createGain();
    g.gain.value = 0.05;
    o.connect(g).connect(out);
    o.start();
    lfo.start();
    return () => (o.stop(), lfo.stop());
  },
  airRaid(c, out) {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.12;
    const lg = c.createGain();
    lg.gain.value = 180;
    lfo.connect(lg).connect(o.frequency);
    o.frequency.value = 380;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1400;
    const g = c.createGain();
    g.gain.value = 0.09;
    o.connect(f).connect(g).connect(out);
    o.start();
    lfo.start();
    return () => (o.stop(), lfo.stop());
  },
  fireAlarm(c, out) {
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.value = 950;
    const gate = c.createGain();
    const lfo = c.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 2.5;
    const lg = c.createGain();
    lg.gain.value = 0.04;
    gate.gain.value = 0.04;
    lfo.connect(lg).connect(gate.gain);
    o.connect(gate).connect(out);
    o.start();
    lfo.start();
    return () => (o.stop(), lfo.stop());
  },
  ringLoop(c, out) {
    // a classic desk phone ring: 2s on, 2s off
    const g = c.createGain();
    g.gain.value = 0;
    const o1 = c.createOscillator();
    const o2 = c.createOscillator();
    o1.frequency.value = 440;
    o2.frequency.value = 480;
    const trem = c.createOscillator();
    trem.type = 'square';
    trem.frequency.value = 20;
    const tg = c.createGain();
    tg.gain.value = 0.5;
    const amp = c.createGain();
    amp.gain.value = 0.5;
    trem.connect(tg).connect(amp.gain);
    o1.connect(amp);
    o2.connect(amp);
    amp.connect(g).connect(out);
    const t = c.currentTime;
    for (let i = 0; i < 60; i++) {
      g.gain.setValueAtTime(0.09, t + i * 4);
      g.gain.setValueAtTime(0, t + i * 4 + 1.6);
    }
    [o1, o2, trem].forEach((o) => o.start());
    return () => [o1, o2, trem].forEach((o) => o.stop());
  },
  officeAmbience(c, out) {
    // brown-ish noise murmur + ceiling fan hum
    const src = c.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500;
    const g = c.createGain();
    g.gain.value = 0.08;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.15;
    const lg = c.createGain();
    lg.gain.value = 0.03;
    lfo.connect(lg).connect(g.gain);
    const hum = c.createOscillator();
    hum.frequency.value = 55;
    const hg = c.createGain();
    hg.gain.value = 0.015;
    src.connect(f).connect(g).connect(out);
    hum.connect(hg).connect(out);
    src.start();
    lfo.start();
    hum.start();
    return () => (src.stop(), lfo.stop(), hum.stop());
  },
  phoneLine(c, out) {
    const src = c.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2200;
    f.Q.value = 0.7;
    const g = c.createGain();
    g.gain.value = 0.006;
    src.connect(f).connect(g).connect(out);
    src.start();
    return () => src.stop();
  },
};

export function startLoop(name, busName = 'sfx') {
  const c = target(false);
  if (!c || loops.has(name)) return;
  try {
    loops.set(name, LOOPS[name](c, buses[busName]));
  } catch (err) {
    console.warn('loop failed', name, err);
  }
}

export function stopLoop(name) {
  const stop = loops.get(name);
  if (stop) {
    try {
      stop();
    } catch {
      /* already stopped */
    }
    loops.delete(name);
  }
}

export function stopAllLoops() {
  for (const k of [...loops.keys()]) stopLoop(k);
}

// ---------- voice playback ----------
export async function decodeAudio(arrayBuffer) {
  const c = audioCtx();
  return c.decodeAudioData(arrayBuffer.slice(0));
}

/**
 * Play an AudioBuffer on the voice bus. `phone: true` applies a telephone band-pass
 * so callers sound like they're on the line. Resolves when playback ends.
 */
export function playVoiceBuffer(buffer, { phone = true, rate = 1, gain = 1, bus: busName = 'voice' } = {}) {
  const c = audioCtx();
  let src;
  const done = new Promise((resolve) => {
    src = c.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = c.createGain();
    g.gain.value = gain;
    let node = src;
    if (phone) {
      const hp = c.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 280;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 3600;
      const drive = c.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) {
        const x = (i / 128) - 1;
        curve[i] = Math.tanh(x * 1.6);
      }
      drive.curve = curve;
      node.connect(hp);
      hp.connect(lp);
      lp.connect(drive);
      node = drive;
    }
    node.connect(g).connect(buses[busName]);
    src.onended = () => resolve();
    src.start();
  });
  return { done, stop: () => { try { src.stop(); } catch { /* noop */ } } };
}

export const audioBuses = buses;
