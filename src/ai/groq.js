// Thin Groq API client (OpenAI-compatible endpoints), called straight from the browser.
// Defaults (see Settings):
//   chat: openai/gpt-oss-20b            — cheapest model on Groq's public (non-enterprise) plan
//   tts:  canopylabs/orpheus-v1-english — Groq's text-to-speech model (max 200 chars/request)
//   stt:  whisper-large-v3              — Groq's most accurate speech-to-text model
import { settings, hasApiKey } from '../core/store.js';
import { bus } from '../core/bus.js';

const BASE = 'https://api.groq.com/openai/v1';

export const ORPHEUS_VOICES = {
  female: ['autumn', 'diana', 'hannah'],
  male: ['austin', 'daniel', 'troy'],
};
export const ALL_VOICES = [...ORPHEUS_VOICES.female, ...ORPHEUS_VOICES.male];

export const usage = { chatCalls: 0, promptTokens: 0, completionTokens: 0, ttsChars: 0, sttSeconds: 0, errors: 0 };

export class GroqError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function headers(json = true) {
  const h = { Authorization: `Bearer ${settings.apiKey.trim()}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function request(path, init, { retries = 1 } = {}) {
  if (!hasApiKey()) throw new GroqError('No Groq API key set. Open Settings and paste your key.', 401);
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(BASE + path, init);
      if (res.ok) return res;
      let detail = '';
      try {
        const j = await res.json();
        detail = j?.error?.message || JSON.stringify(j);
      } catch {
        detail = await res.text().catch(() => '');
      }
      lastErr = new GroqError(`Groq ${res.status}: ${detail}`.slice(0, 400), res.status);
      // retry only on rate limits / transient server errors
      if (res.status === 429 || res.status >= 500) {
        const wait = Number(res.headers.get('retry-after')) || 1.5 * (attempt + 1);
        await new Promise((r) => setTimeout(r, Math.min(wait, 6) * 1000));
        continue;
      }
      break;
    } catch (err) {
      lastErr = err instanceof GroqError ? err : new GroqError(`Network error talking to Groq: ${err.message}`, 0);
    }
  }
  usage.errors++;
  bus.emit('ai:error', lastErr);
  throw lastErr;
}

/**
 * Chat completion that returns parsed JSON. Uses strict JSON-schema mode when a
 * schema is given (supported by gpt-oss models); falls back to json_object mode for
 * models that reject schemas.
 */
export async function chatJSON({ system, messages, schema, schemaName = 'response', temperature, maxTokens = 900 }) {
  const model = settings.chatModel || 'openai/gpt-oss-20b';
  const base = {
    model,
    messages: [{ role: 'system', content: system }, ...messages],
    temperature: temperature ?? settings.aiCreativity ?? 0.9,
    max_completion_tokens: maxTokens,
  };
  if (/gpt-oss/.test(model)) {
    base.reasoning_effort = 'low';
    base.include_reasoning = false;
  }
  const attempts = schema
    ? [
        { ...base, response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } } },
        { ...base, response_format: { type: 'json_object' } },
      ]
    : [{ ...base, response_format: { type: 'json_object' } }];

  let lastErr;
  for (const body of attempts) {
    try {
      const res = await request('/chat/completions', { method: 'POST', headers: headers(), body: JSON.stringify(body) });
      const data = await res.json();
      usage.chatCalls++;
      usage.promptTokens += data.usage?.prompt_tokens || 0;
      usage.completionTokens += data.usage?.completion_tokens || 0;
      const text = data.choices?.[0]?.message?.content || '';
      return parseLooseJSON(text);
    } catch (err) {
      lastErr = err;
      // 400 = model doesn't like the schema/params: try the next, looser format
      if (!(err instanceof GroqError) || err.status !== 400) break;
    }
  }
  throw lastErr;
}

/** Plain text chat (used for coworker banter). */
export async function chatText({ system, messages, temperature = 1, maxTokens = 300 }) {
  const model = settings.chatModel || 'openai/gpt-oss-20b';
  const body = {
    model,
    messages: [{ role: 'system', content: system }, ...messages],
    temperature,
    max_completion_tokens: maxTokens,
  };
  if (/gpt-oss/.test(model)) {
    body.reasoning_effort = 'low';
    body.include_reasoning = false;
  }
  const res = await request('/chat/completions', { method: 'POST', headers: headers(), body: JSON.stringify(body) });
  const data = await res.json();
  usage.chatCalls++;
  return (data.choices?.[0]?.message?.content || '').trim();
}

export function parseLooseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    const m = String(text).match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        /* fallthrough */
      }
    }
    throw new GroqError('The AI returned something that was not valid JSON.', 422);
  }
}

/** Text-to-speech. Returns an ArrayBuffer of WAV audio. Input must be <= 200 chars. */
export async function tts(text, voice = 'hannah') {
  const input = text.slice(0, 200);
  const res = await request('/audio/speech', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ model: settings.ttsModel || 'canopylabs/orpheus-v1-english', voice, input, response_format: 'wav' }),
  });
  usage.ttsChars += input.length;
  return res.arrayBuffer();
}

/** Speech-to-text for one push-to-talk clip. */
export async function stt(blob, prompt = '') {
  const form = new FormData();
  const ext = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'mp4' : blob.type.includes('wav') ? 'wav' : 'webm';
  form.append('file', blob, `speech.${ext}`);
  form.append('model', settings.sttModel || 'whisper-large-v3');
  form.append('language', 'en');
  form.append('response_format', 'json');
  form.append('temperature', '0');
  if (prompt) form.append('prompt', prompt.slice(0, 600));
  const res = await request('/audio/transcriptions', { method: 'POST', headers: headers(false), body: form });
  const data = await res.json();
  usage.sttSeconds += Math.max(10, blob.size / 4000);
  return (data.text || '').trim();
}

/** Used by the Settings "Test key" button. */
export async function testKey() {
  const res = await request('/models', { headers: headers(false) }, { retries: 0 });
  const data = await res.json();
  return (data.data || []).map((m) => m.id);
}

/**
 * Split text into <=maxLen chunks on sentence boundaries, carrying a leading
 * [vocal direction] into each chunk so the TTS tone stays consistent.
 */
export function chunkForTTS(text, maxLen = 190) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const lead = clean.match(/^\[[^\]]{1,30}\]\s*/);
  const direction = lead ? lead[0].trim() : '';
  const body = lead ? clean.slice(lead[0].length) : clean;
  const sentences = body.match(/[^.!?…]+[.!?…]+["')\]]*\s*|[^.!?…]+$/g) || [body];
  const chunks = [];
  let cur = '';
  const budget = maxLen - (direction ? direction.length + 1 : 0);
  for (let s of sentences) {
    s = s.trim();
    while (s.length > budget) {
      const cut = s.lastIndexOf(' ', budget) > 20 ? s.lastIndexOf(' ', budget) : budget;
      if (cur) {
        chunks.push(cur);
        cur = '';
      }
      chunks.push(s.slice(0, cut).trim());
      s = s.slice(cut).trim();
    }
    if ((cur + ' ' + s).trim().length > budget) {
      if (cur) chunks.push(cur);
      cur = s;
    } else cur = (cur + ' ' + s).trim();
  }
  if (cur) chunks.push(cur);
  return chunks.filter(Boolean).map((c) => (direction ? `${direction} ${c}` : c));
}
