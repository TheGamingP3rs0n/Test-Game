// Groq API client (OpenAI-compatible endpoints), called straight from the browser.
//
// Built for Groq's FREE tier, which is generous per day but tight per minute
// (e.g. openai/gpt-oss-20b: 30 requests and ~8K tokens per minute; Orpheus TTS:
// 10 requests/minute and a small daily budget). So this module:
//   * budgets every request per model (tokens + requests per minute) using Groq's
//     x-ratelimit-* response headers, waiting briefly instead of firing into a 429;
//   * falls back to another free chat model when one is rate-limited (every model
//     has its own separate quota), so a busy minute doesn't break a phone call;
//   * remembers daily-limit hits and stops hammering that model until it resets.
//
// Defaults (see Settings):
//   chat: openai/gpt-oss-20b            — callers, boss (fallbacks below)
//   tts:  canopylabs/orpheus-v1-english — voices (max 200 chars/request)
//   stt:  whisper-large-v3              — your microphone
import { settings, hasApiKey, apiKey } from '../core/store.js';
import { bus } from '../core/bus.js';

const BASE = 'https://api.groq.com/openai/v1';

export const ORPHEUS_VOICES = {
  female: ['autumn', 'diana', 'hannah'],
  male: ['austin', 'daniel', 'troy'],
};
export const ALL_VOICES = [...ORPHEUS_VOICES.female, ...ORPHEUS_VOICES.male];

/** Free-tier per-minute limits we plan around (Groq headers override these live). */
const LIMITS = {
  'openai/gpt-oss-20b': { rpm: 30, tpm: 8000 },
  'openai/gpt-oss-120b': { rpm: 30, tpm: 8000 },
  'llama-3.3-70b-versatile': { rpm: 30, tpm: 12000 },
  'llama-3.1-8b-instant': { rpm: 30, tpm: 6000 },
  'canopylabs/orpheus-v1-english': { rpm: 10, tpm: 1200 },
  'whisper-large-v3': { rpm: 20, tpm: Infinity },
  'whisper-large-v3-turbo': { rpm: 20, tpm: Infinity },
};
const DEFAULT_LIMIT = { rpm: 30, tpm: 6000 };

/** Chat models tried (in order) after the one picked in Settings. */
export const CHAT_FALLBACKS = ['openai/gpt-oss-20b', 'llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'llama-3.1-8b-instant'];
/** Small, fast model for low-stakes text (coworker chat) so callers keep the big budget. */
const CHEAP_CHAT = 'llama-3.1-8b-instant';

export const usage = { chatCalls: 0, promptTokens: 0, cachedTokens: 0, completionTokens: 0, ttsChars: 0, sttSeconds: 0, errors: 0, rateLimited: 0, fallbacks: 0 };

export class GroqError extends Error {
  constructor(message, status, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** "2m59.56s" / "7.66s" / "450ms" / "1h2m" → milliseconds */
export function parseDuration(s) {
  if (s === null || s === undefined || s === '') return 0;
  if (/^\d+(\.\d+)?$/.test(String(s).trim())) return Number(s) * 1000;
  let ms = 0;
  for (const [, n, unit] of String(s).matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    ms += Number(n) * { ms: 1, s: 1000, m: 60000, h: 3600000 }[unit];
  }
  return ms;
}

// ---------------------------------------------------------------------------
// Per-model budget
// ---------------------------------------------------------------------------
const state = new Map();
function modelState(model) {
  if (!state.has(model)) state.set(model, { log: [], blockedUntil: 0, dailyBlocked: false, dead: false, remTokens: null, tokensResetAt: 0, remReq: null, reqResetAt: 0 });
  return state.get(model);
}

function limitsFor(model) {
  return LIMITS[model] || DEFAULT_LIMIT;
}

/** ms until `est` tokens can be sent to `model` without (probably) hitting a limit. */
function waitNeeded(model, est) {
  const st = modelState(model);
  const now = Date.now();
  if (st.dead) return Infinity;
  st.log = st.log.filter((e) => now - e.t < 60000);
  let wait = Math.max(0, st.blockedUntil - now);
  const lim = limitsFor(model);
  if (st.log.length + 1 > lim.rpm) wait = Math.max(wait, st.log[0].t + 60000 - now);
  if (Number.isFinite(lim.tpm)) {
    const budget = lim.tpm * 0.92;
    let used = st.log.reduce((s, e) => s + e.tokens, 0);
    if (used + est > budget) {
      // wait until enough old requests age out of the 60s window
      for (const e of st.log) {
        used -= e.tokens;
        if (used + est <= budget) {
          wait = Math.max(wait, e.t + 60000 - now);
          break;
        }
      }
      if (used + est > budget) wait = Math.max(wait, est > budget ? 0 : 60000);
    }
    // Groq tells us exactly what's left; trust it over our own bookkeeping
    if (st.remTokens !== null && st.tokensResetAt > now && st.remTokens < est) wait = Math.max(wait, st.tokensResetAt - now);
  }
  if (st.remReq !== null && st.remReq <= 0 && st.reqResetAt > now) wait = Math.max(wait, st.reqResetAt - now);
  return wait;
}

/** Wait (up to maxWait ms) until the model has budget, then reserve it. */
async function acquire(model, est, maxWait) {
  for (let i = 0; i < 4; i++) {
    const wait = waitNeeded(model, est);
    if (wait <= 0) break;
    if (wait > maxWait) throw new GroqError(`${model} is busy (rate limit) for ${Math.ceil(wait / 1000)}s`, 429, { local: true, waitMs: wait });
    bus.emit('ai:waiting', { model, ms: wait });
    await sleep(wait + 50);
    maxWait -= wait;
  }
  modelState(model).log.push({ t: Date.now(), tokens: est });
}

function readHeaders(model, res) {
  const st = modelState(model);
  const now = Date.now();
  const remT = res.headers.get('x-ratelimit-remaining-tokens');
  if (remT !== null) {
    st.remTokens = Number(remT);
    st.tokensResetAt = now + parseDuration(res.headers.get('x-ratelimit-reset-tokens'));
  }
  const remR = res.headers.get('x-ratelimit-remaining-requests');
  if (remR !== null) {
    // this one is the per-DAY request budget
    st.remReq = Number(remR);
    st.reqResetAt = now + parseDuration(res.headers.get('x-ratelimit-reset-requests'));
  }
}

function noteRateLimit(model, res, detail) {
  const st = modelState(model);
  usage.rateLimited++;
  let wait = parseDuration(res.headers.get('retry-after'));
  const m = /try again in ([\dhms.]+)/i.exec(detail);
  if (m) wait = Math.max(wait, parseDuration(m[1]));
  const daily = /per day|\(TPD\)|\(RPD\)|\(ASD\)/i.test(detail);
  if (daily) st.dailyBlocked = true;
  st.blockedUntil = Date.now() + Math.max(wait, daily ? 10 * 60000 : 3000);
}

/** Seconds until a model is usable again (0 = ready). For UI hints. */
export function modelCooldown(model) {
  return Math.ceil(waitNeeded(model, 600) / 1000);
}

/** True when the main chat models are close to their per-minute budget. */
export function chatBudgetLow() {
  return chatChain().every((m) => waitNeeded(m, 1800) > 0);
}

function headers(json = true) {
  const h = { Authorization: `Bearer ${apiKey()}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

/** One HTTP request. Never retries a 429 itself — callers decide (wait or fall back). */
async function request(model, path, init) {
  if (!hasApiKey()) throw new GroqError('No Groq API key set. Open Settings and paste your key.', 401);
  let res;
  try {
    res = await fetch(BASE + path, init);
  } catch (err) {
    usage.errors++;
    throw new GroqError(`Network error talking to Groq: ${err.message}`, 0);
  }
  if (model) readHeaders(model, res);
  if (res.ok) return res;
  let detail = '';
  let code = '';
  try {
    const j = await res.json();
    detail = j?.error?.message || JSON.stringify(j);
    code = j?.error?.code || '';
  } catch {
    detail = await res.text().catch(() => '');
  }
  usage.errors++;
  if (model && res.status === 429) noteRateLimit(model, res, detail);
  if (model && (res.status === 404 || /model_not_found|decommissioned|does not exist|model_terms_required/i.test(code + detail))) modelState(model).dead = res.status === 404 || /not_found|decommissioned|does not exist/i.test(code + detail);
  const err = new GroqError(`Groq ${res.status}: ${detail}`.slice(0, 400), res.status, { code, detail });
  if (res.status === 401) bus.emit('ai:error', err);
  throw err;
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------
const estTokens = (messages) => Math.ceil(messages.reduce((s, m) => s + String(m.content).length + 12, 0) / 3.6);
const isReasoning = (model) => /gpt-oss|qwen3/.test(model);

function chatChain(first = settings.chatModel || CHAT_FALLBACKS[0]) {
  return [...new Set([first, ...CHAT_FALLBACKS])].filter((m) => !modelState(m).dead);
}

function chatBody(model, { system, messages, temperature, maxTokens, schema, schemaName, json }) {
  const body = {
    model,
    messages: [{ role: 'system', content: system }, ...messages],
    temperature: temperature ?? settings.aiCreativity ?? 0.9,
    // reasoning models think before answering; give them headroom so the JSON isn't cut off
    max_completion_tokens: maxTokens + (isReasoning(model) ? 320 : 0),
  };
  if (isReasoning(model)) {
    body.reasoning_effort = 'low';
    body.include_reasoning = false;
  }
  if (json) {
    if (schema && /gpt-oss/.test(model)) body.response_format = { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } };
    else body.response_format = { type: 'json_object' };
  }
  return body;
}

/**
 * Run a chat request across the model chain. Each model gets a short wait budget;
 * the last one may wait longer. Returns { text, model }.
 */
async function runChat(opts, { first, patience = 2500, lastPatience = 14000, json = false } = {}) {
  const chain = chatChain(first);
  if (!chain.length) throw new GroqError('No chat model is available on your Groq account.', 404);
  let lastErr = null;
  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    const isLast = i === chain.length - 1;
    let body = chatBody(model, { ...opts, json });
    const est = estTokens(body.messages) + body.max_completion_tokens;
    try {
      await acquire(model, est, isLast ? lastPatience : patience);
    } catch (err) {
      lastErr = err;
      continue;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await request(model, '/chat/completions', { method: 'POST', headers: headers(), body: JSON.stringify(body) });
        const data = await res.json();
        usage.chatCalls++;
        usage.promptTokens += data.usage?.prompt_tokens || 0;
        usage.cachedTokens += data.usage?.prompt_tokens_details?.cached_tokens || 0;
        usage.completionTokens += data.usage?.completion_tokens || 0;
        // replace our estimate with the real cost
        const st = modelState(model);
        const entry = st.log[st.log.length - 1];
        if (entry && data.usage?.total_tokens) entry.tokens = data.usage.total_tokens - (data.usage?.prompt_tokens_details?.cached_tokens || 0);
        const text = (data.choices?.[0]?.message?.content || '').trim();
        if (!text) throw new GroqError('The AI returned an empty reply.', 422);
        if (i > 0) usage.fallbacks++;
        return { text, model };
      } catch (err) {
        lastErr = err;
        if (err.status === 401) throw err;
        // schema/format trouble on this model: retry once with plain JSON mode
        if ((err.status === 400 || err.status === 422) && json && attempt === 0 && body.response_format?.type === 'json_schema') {
          body = { ...body, response_format: { type: 'json_object' } };
          continue;
        }
        break; // 429 / 413 / 5xx / dead model → next model in the chain
      }
    }
  }
  throw lastErr || new GroqError('All AI models are busy right now.', 429);
}

/** Chat completion that returns parsed JSON. */
export async function chatJSON({ system, messages, schema, schemaName = 'response', temperature, maxTokens = 400, patience, lastPatience }) {
  // json_object mode requires the word "json" in the prompt; spell out the keys for non-schema models
  const keys = schema ? Object.keys(schema.properties).join(', ') : '';
  const sys = `${system}\n\nRespond ONLY with one JSON object${keys ? ` with exactly these keys: ${keys}` : ''}.`;
  const { text } = await runChat({ system: sys, messages, schema, schemaName, temperature, maxTokens }, { json: true, patience, lastPatience });
  return parseLooseJSON(text);
}

/** Plain text chat (coworker banter). Prefers the small fast model to save quota. */
export async function chatText({ system, messages, temperature = 1, maxTokens = 160 }) {
  const { text } = await runChat({ system, messages, temperature, maxTokens }, { first: CHEAP_CHAT, patience: 800, lastPatience: 3000 });
  return text;
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

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------
/** True once Orpheus has hit its daily limit (we stop asking until reload). */
export function ttsExhausted() {
  const st = modelState(settings.ttsModel || 'canopylabs/orpheus-v1-english');
  return st.dailyBlocked || st.dead;
}

/** Text-to-speech. Returns an ArrayBuffer of WAV audio. Input must be <= 200 chars. */
export async function tts(text, voice = 'hannah') {
  const model = settings.ttsModel || 'canopylabs/orpheus-v1-english';
  const input = text.slice(0, 200);
  if (ttsExhausted()) throw new GroqError('Groq voice quota used up for today.', 429, { daily: true });
  await acquire(model, input.length, 6000);
  let res;
  try {
    res = await request(model, '/audio/speech', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ model, voice, input, response_format: 'wav' }),
    });
  } catch (err) {
    // one short retry for a per-minute limit; daily limits fall through to browser voices
    if (err.status !== 429 || modelState(model).dailyBlocked) throw err;
    await acquire(model, input.length, 7000);
    res = await request(model, '/audio/speech', { method: 'POST', headers: headers(), body: JSON.stringify({ model, voice, input, response_format: 'wav' }) });
  }
  usage.ttsChars += input.length;
  return res.arrayBuffer();
}

/** Speech-to-text for one push-to-talk clip. */
export async function stt(blob, prompt = '') {
  const model = settings.sttModel || 'whisper-large-v3';
  const send = async (m) => {
    const form = new FormData();
    const ext = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'mp4' : blob.type.includes('wav') ? 'wav' : 'webm';
    form.append('file', blob, `speech.${ext}`);
    form.append('model', m);
    form.append('language', 'en');
    form.append('response_format', 'json');
    form.append('temperature', '0');
    if (prompt) form.append('prompt', prompt.slice(0, 400));
    await acquire(m, 0, 5000);
    const res = await request(m, '/audio/transcriptions', { method: 'POST', headers: headers(false), body: form });
    return res.json();
  };
  let data;
  try {
    data = await send(model);
  } catch (err) {
    // the turbo model has its own quota — use it if the main one is rate-limited
    const alt = model === 'whisper-large-v3' ? 'whisper-large-v3-turbo' : 'whisper-large-v3';
    if (err.status !== 429 && err.status !== 503 && err.status !== 404) throw err;
    data = await send(alt);
  }
  usage.sttSeconds += Math.max(10, blob.size / 4000);
  return (data.text || '').trim();
}

/** Used by the Settings "Test key" button. */
export async function testKey() {
  const res = await request(null, '/models', { headers: headers(false) });
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
