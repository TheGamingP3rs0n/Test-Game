// Voice output (Groq Orpheus TTS, custom WAV "babble" voices, or the browser's built-in
// speech) and voice input (push-to-talk → Groq Whisper, or the browser recognizer).
import { settings, hasApiKey } from '../core/store.js';
import { tts, stt, chunkForTTS } from './groq.js';
import { decodeAudio, playVoiceBuffer, audioCtx, audioBuses } from '../core/audio.js';
import { bus } from '../core/bus.js';

const EMOTION_DIRECTIONS = {
  happy: '[cheerful]',
  excited: '[excited]',
  confused: '[confused]',
  suspicious: '[skeptical]',
  angry: '[angry]',
  scared: '[nervous]',
  sad: '[sad]',
  neutral: '',
};

export function stripDirections(text) {
  return String(text || '').replace(/\[[^\]]{1,40}\]/g, '').replace(/\s{2,}/g, ' ').trim();
}

const wavCache = new Map();
async function loadBuffer(url) {
  if (!url) return null;
  if (wavCache.has(url)) return wavCache.get(url);
  const p = fetch(url)
    .then((r) => r.arrayBuffer())
    .then((ab) => decodeAudio(ab))
    .catch((err) => {
      console.warn('Could not load voice file', url, err);
      return null;
    });
  wavCache.set(url, p);
  return p;
}

class Speaker {
  constructor() {
    this.current = null; // { cancel }
    this.speaking = false;
  }

  stop() {
    this.current?.cancel();
    this.current = null;
    this.speaking = false;
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* noop */
    }
  }

  /**
   * Speak a line. voice = { type: 'orpheus'|'wav'|'browser', voice, style, gender, pitch, babble, sfx }
   * Resolves when finished (or interrupted).
   */
  async speak(text, voice = {}, { emotion = 'neutral', phone = true } = {}) {
    this.stop();
    const token = { cancelled: false, stops: [] };
    token.cancel = () => {
      token.cancelled = true;
      token.stops.forEach((s) => s());
    };
    this.current = token;
    this.speaking = true;
    bus.emit('voice:start');
    try {
      // emotion sound effect from a custom client (e.g. laugh.wav)
      const sfxUrl = voice.sfx?.[emotion];
      if (sfxUrl) {
        const buf = await loadBuffer(sfxUrl);
        if (buf && !token.cancelled) {
          const h = playVoiceBuffer(buf, { phone });
          token.stops.push(h.stop);
          await h.done;
        }
      }
      if (token.cancelled) return;
      const mode = settings.voiceOutput;
      if (mode === 'off') {
        await new Promise((r) => setTimeout(r, Math.min(4000, 40 * stripDirections(text).length)));
      } else if (voice.type === 'wav' && voice.babble) {
        await this.babble(stripDirections(text), voice, emotion, token, phone);
      } else if (mode === 'groq' && hasApiKey() && voice.type !== 'browser') {
        try {
          await this.orpheus(text, voice, emotion, token, phone);
        } catch (err) {
          console.warn('Groq TTS failed, using browser voice', err);
          bus.emit('toast', { kind: 'warn', text: `Voice (TTS) failed: ${err.message}. Using browser voice.` });
          if (!token.cancelled) await this.browser(stripDirections(text), voice, emotion, token);
        }
      } else {
        await this.browser(stripDirections(text), voice, emotion, token);
      }
    } finally {
      if (this.current === token) {
        this.speaking = false;
        this.current = null;
      }
      bus.emit('voice:end');
    }
  }

  async orpheus(text, voice, emotion, token, phone) {
    let line = String(text).trim();
    if (!/^\[/.test(line)) {
      const dir = voice.style || EMOTION_DIRECTIONS[emotion] || '';
      if (dir) line = `${dir} ${line}`;
    }
    const chunks = chunkForTTS(line);
    // fetch all chunks in parallel, play in order as they arrive
    const pending = chunks.map((c) =>
      tts(c, voice.voice || 'hannah')
        .then((ab) => decodeAudio(ab))
        .catch((err) => ({ err })),
    );
    for (const p of pending) {
      const buf = await p;
      if (buf?.err) throw buf.err;
      if (token.cancelled) return;
      const h = playVoiceBuffer(buf, { phone, rate: voice.pitch || 1 });
      token.stops.push(h.stop);
      await h.done;
      if (token.cancelled) return;
    }
  }

  async babble(text, voice, emotion, token, phone) {
    const buf = await loadBuffer(voice.babble);
    if (!buf) return this.browser(text, voice, emotion, token);
    const c = audioCtx();
    const syllables = Math.max(2, Math.round(text.replace(/[^a-z]/gi, '').length / 2.6));
    const basePitch = (voice.pitch || 1) * ({ angry: 0.92, scared: 1.15, excited: 1.12, sad: 0.88, happy: 1.06 }[emotion] || 1);
    const grain = Math.min(0.16, buf.duration / 2);
    const out = c.createGain();
    out.gain.value = 0.9;
    if (phone) {
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1400;
      bp.Q.value = 0.6;
      out.connect(bp).connect(audioBuses.voice);
    } else out.connect(audioBuses.voice);
    const step = 0.11;
    let t = c.currentTime + 0.02;
    const srcs = [];
    for (let i = 0; i < syllables; i++) {
      const s = c.createBufferSource();
      s.buffer = buf;
      s.playbackRate.value = basePitch * (0.9 + Math.random() * 0.25);
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 0.015);
      g.gain.linearRampToValueAtTime(0, t + grain);
      s.connect(g).connect(out);
      s.start(t, Math.random() * Math.max(0, buf.duration - grain), grain + 0.02);
      srcs.push(s);
      t += step + (/[,.!?]/.test(text[Math.floor((i / syllables) * text.length)]) ? 0.18 : 0);
    }
    token.stops.push(() => srcs.forEach((s) => { try { s.stop(); } catch { /* noop */ } }));
    await new Promise((resolve) => {
      const end = setTimeout(resolve, (t - c.currentTime) * 1000 + 50);
      token.stops.push(() => {
        clearTimeout(end);
        resolve();
      });
    });
  }

  browser(text, voice, emotion, token) {
    return new Promise((resolve) => {
      const synth = window.speechSynthesis;
      if (!synth || !text) return setTimeout(resolve, 30 * (text?.length || 10));
      const u = new SpeechSynthesisUtterance(text);
      const voices = synth.getVoices().filter((v) => /^en/i.test(v.lang));
      const female = voice.gender === 'female';
      const preferred = voices.find((v) => (female ? /female|samantha|zira|susan|karen|victoria|fiona|moira/i : /male|daniel|david|alex|fred|george|mark/i).test(v.name));
      if (voice.browserVoice) u.voice = voices.find((v) => v.name === voice.browserVoice) || preferred || voices[0];
      else if (preferred || voices[0]) u.voice = preferred || voices[0];
      u.pitch = Math.max(0.1, Math.min(2, (voice.pitch || 1) * (female ? 1.15 : 0.9) * (emotion === 'scared' ? 1.2 : emotion === 'angry' ? 0.85 : 1)));
      u.rate = emotion === 'excited' || emotion === 'angry' ? 1.15 : emotion === 'sad' ? 0.85 : 1;
      u.volume = Math.min(1, settings.voiceVolume * settings.masterVolume);
      let finished = false;
      const finish = () => {
        if (!finished) {
          finished = true;
          resolve();
        }
      };
      u.onend = finish;
      u.onerror = finish;
      token.stops.push(() => {
        synth.cancel();
        finish();
      });
      // Safety net: some platforms never fire onend.
      setTimeout(finish, 2000 + text.length * 120);
      synth.speak(u);
    });
  }
}

export const speaker = new Speaker();

// ---------------------------------------------------------------------------
// Voice input
// ---------------------------------------------------------------------------
class VoiceInput {
  constructor() {
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
    this.recognition = null;
    this.browserText = '';
    this.active = false;
    this.analyser = null;
  }

  get mode() {
    if (settings.voiceInput === 'groq' && hasApiKey()) return 'groq';
    if (settings.voiceInput === 'text') return 'text';
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    return SR ? 'browser' : hasApiKey() ? 'groq' : 'text';
  }

  async ensureMic() {
    if (this.stream) return this.stream;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const c = audioCtx();
    const src = c.createMediaStreamSource(this.stream);
    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 256;
    src.connect(this.analyser);
    return this.stream;
  }

  level() {
    if (!this.analyser || !this.active) return 0;
    const arr = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(arr);
    let sum = 0;
    for (const v of arr) sum += ((v - 128) / 128) ** 2;
    return Math.sqrt(sum / arr.length);
  }

  /** Start capturing (push-to-talk pressed). */
  async begin() {
    if (this.active) return;
    const mode = this.mode;
    if (mode === 'text') throw new Error('Voice input is set to "type only" in Settings.');
    this.active = true;
    this.startedAt = performance.now();
    if (mode === 'browser') {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      this.browserText = '';
      this.recognition = new SR();
      this.recognition.lang = 'en-US';
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.onresult = (e) => {
        let txt = '';
        for (const r of e.results) txt += r[0].transcript;
        this.browserText = txt;
        bus.emit('mic:interim', txt);
      };
      this.recognition.onerror = (e) => console.warn('speech recognition error', e.error);
      try {
        await this.ensureMic();
      } catch {
        /* level meter only */
      }
      this.recognition.start();
      return;
    }
    await this.ensureMic();
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((m) => window.MediaRecorder?.isTypeSupported?.(m));
    this.recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.chunks = [];
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start();
  }

  /** Stop capturing and return the transcript ('' if nothing usable). */
  async end(contextPrompt = '') {
    if (!this.active) return '';
    this.active = false;
    const heldMs = performance.now() - this.startedAt;
    if (this.recognition) {
      const rec = this.recognition;
      this.recognition = null;
      await new Promise((resolve) => {
        rec.onend = resolve;
        try {
          rec.stop();
        } catch {
          resolve();
        }
        setTimeout(resolve, 1500);
      });
      return this.browserText.trim();
    }
    if (!this.recorder) return '';
    const rec = this.recorder;
    this.recorder = null;
    const blob = await new Promise((resolve) => {
      rec.onstop = () => resolve(new Blob(this.chunks, { type: rec.mimeType || 'audio/webm' }));
      rec.stop();
    });
    if (heldMs < 350 || blob.size < 1500) return '';
    const text = await stt(blob, contextPrompt);
    // Whisper hallucinates these on silence
    if (/^(thanks? (you )?for watching|you|\.|bye\.?)$/i.test(text.trim())) return '';
    return text;
  }

  /** Record a raw clip (Custom Client maker uses this for voice samples). */
  async recordClip(maxMs = 8000) {
    await this.ensureMic();
    const rec = new MediaRecorder(this.stream);
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((resolve) => (rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType }))));
    rec.start();
    const stop = () => rec.state === 'recording' && rec.stop();
    setTimeout(stop, maxMs);
    return { stop, done };
  }
}

export const voiceInput = new VoiceInput();
