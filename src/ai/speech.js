// Voice output (Groq Orpheus TTS, custom WAV "babble" voices, or the browser's built-in
// speech) and voice input (push-to-talk → Groq Whisper, or the browser recognizer).
import { settings, hasApiKey } from '../core/store.js';
import { tts, stt, chunkForTTS, ttsExhausted } from './groq.js';
import { decodeAudio, playVoiceBuffer, audioCtx, audioBuses, sfx } from '../core/audio.js';
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
    this.warned = new Set();
  }

  /** Game paused: freeze browser speech too (WebAudio voices freeze with the audio context). */
  pause() {
    try {
      window.speechSynthesis?.pause();
    } catch {
      /* noop */
    }
  }

  resume() {
    try {
      window.speechSynthesis?.resume();
    } catch {
      /* noop */
    }
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
      } else if (mode === 'groq' && hasApiKey() && voice.type !== 'browser' && !ttsExhausted()) {
        try {
          await this.orpheus(text, voice, emotion, token, phone);
        } catch (err) {
          console.warn('Groq TTS failed, using browser voice', err);
          // tell the player once per kind of problem, not on every line
          const kind = ttsExhausted() ? 'daily' : err.status === 429 ? 'busy' : 'other';
          if (!this.warned.has(kind)) {
            this.warned.add(kind);
            bus.emit('toast', { kind: 'warn', icon: 'volume', text: kind === 'daily' ? 'Groq\'s free voice quota is used up for today. Callers will use your browser\'s built-in voices.' : kind === 'busy' ? 'Groq voices are rate-limited for a moment. Using backup voices.' : `Groq voice failed (${err.message.slice(0, 90)}). Using backup voices.` });
          }
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
    // fetch one chunk ahead of playback (Groq's free TTS allows only 10 requests/minute)
    const fetchChunk = (c) => tts(c, voice.voice || 'hannah').then((ab) => decodeAudio(ab)).catch((err) => ({ err }));
    let next = fetchChunk(chunks[0]);
    for (let i = 0; i < chunks.length; i++) {
      const buf = await next;
      next = i + 1 < chunks.length && !token.cancelled ? fetchChunk(chunks[i + 1]) : null;
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
      const all = synth.getVoices();
      // prefer the nicer "natural"/online voices Chrome & Edge ship
      const voices = all.filter((v) => /^en/i.test(v.lang)).sort((a, b) => (/natural|online|google/i.test(b.name) ? 1 : 0) - (/natural|online|google/i.test(a.name) ? 1 : 0));
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
  // The microphone is opened only while you hold push-to-talk (plus a short grace
  // period so rapid presses don't re-open it), then fully released — the browser's
  // "mic in use" indicator turns off between lines.
  constructor() {
    this.stream = null;
    this.source = null;
    this.recorder = null;
    this.chunks = [];
    this.recognition = null;
    this.browserText = '';
    this.active = false;
    this.analyser = null;
    this.releaseTimer = null;
    this.peak = 0;
  }

  get mode() {
    if (settings.voiceInput === 'text') return 'text';
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (settings.voiceInput === 'browser' && SR) return 'browser';
    if (hasApiKey()) return 'groq';
    return SR ? 'browser' : 'text';
  }

  async ensureMic() {
    clearTimeout(this.releaseTimer);
    if (this.stream && this.stream.getAudioTracks().some((t) => t.readyState === 'live')) return this.stream;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    const c = audioCtx();
    this.source = c.createMediaStreamSource(this.stream);
    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 512;
    this.source.connect(this.analyser);
    return this.stream;
  }

  /** Close the microphone completely. */
  release() {
    clearTimeout(this.releaseTimer);
    if (this.active) return;
    try {
      this.source?.disconnect();
    } catch {
      /* noop */
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.source = null;
    this.analyser = null;
  }

  releaseSoon(ms = 1500) {
    clearTimeout(this.releaseTimer);
    this.releaseTimer = setTimeout(() => this.release(), ms);
  }

  level() {
    if (!this.analyser || !this.active) return 0;
    const arr = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(arr);
    let sum = 0;
    for (const v of arr) sum += ((v - 128) / 128) ** 2;
    const l = Math.sqrt(sum / arr.length);
    this.peak = Math.max(this.peak, l);
    return l;
  }

  /** Start capturing (push-to-talk pressed). Resolves once the mic is actually recording. */
  async begin() {
    if (this.active) return;
    const mode = this.mode;
    if (mode === 'text') throw new Error('Voice input is set to "type only" in Settings.');
    this.active = true;
    this.peak = 0;
    this.startedAt = performance.now();
    try {
      if (mode === 'browser') {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.browserText = '';
        this.recognition = new SR();
        this.recognition.lang = 'en-US';
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.maxAlternatives = 1;
        this.recognition.onresult = (e) => {
          let txt = '';
          for (const r of e.results) txt += r[0].transcript;
          this.browserText = txt;
          bus.emit('mic:interim', txt);
        };
        this.recognition.onerror = (e) => console.warn('speech recognition error', e.error);
        try {
          await this.ensureMic(); // level meter only
        } catch {
          /* recognition opens the mic itself */
        }
        this.recognition.start();
      } else {
        await this.ensureMic();
        const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((m) => window.MediaRecorder?.isTypeSupported?.(m));
        this.recorder = new MediaRecorder(this.stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 64000 });
        this.chunks = [];
        this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
        await new Promise((resolve) => {
          this.recorder.onstart = resolve;
          this.recorder.start(250);
          setTimeout(resolve, 400);
        });
      }
    } catch (err) {
      this.active = false;
      this.recognition = null;
      this.recorder = null;
      this.releaseSoon(0);
      throw err;
    }
    sfx('micOn'); // a little radio click: start talking now
  }

  /** Stop capturing and return the transcript ('' if nothing usable). */
  async end(contextPrompt = '') {
    if (!this.active) return '';
    // keep listening a moment so the last word isn't clipped
    await new Promise((r) => setTimeout(r, 280));
    this.level();
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
      this.releaseSoon();
      return this.browserText.trim();
    }
    if (!this.recorder) return '';
    const rec = this.recorder;
    this.recorder = null;
    const blob = await new Promise((resolve) => {
      rec.onstop = () => resolve(new Blob(this.chunks, { type: rec.mimeType || 'audio/webm' }));
      rec.stop();
    });
    this.releaseSoon();
    // nothing but silence → don't send it (Whisper invents words on silence)
    if (heldMs < 400 || blob.size < 1500 || (this.peak > 0 && this.peak < 0.012)) return '';
    const text = await stt(blob, contextPrompt);
    if (/^(thanks? (you )?(so much )?(for watching)?[.!]*|you|\.+|bye\.?|subtitles? by.*|okay\.?)$/i.test(text.trim())) return '';
    return text;
  }

  /** Record a raw clip (Custom Client maker uses this for voice samples). */
  async recordClip(maxMs = 8000) {
    await this.ensureMic();
    const rec = new MediaRecorder(this.stream);
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((resolve) => (rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType })))).finally(() => this.releaseSoon(500));
    rec.start();
    const stop = () => rec.state === 'recording' && rec.stop();
    setTimeout(stop, maxMs);
    return { stop, done };
  }
}

export const voiceInput = new VoiceInput();
