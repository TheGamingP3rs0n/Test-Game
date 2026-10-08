// Loads all moddable content: /public/mods/manifest.json (base game + your files),
// mods imported from the in-game Mods screen (IndexedDB), and Custom Clients.
import { db } from '../core/db.js';
import { settings } from '../core/store.js';
import { pick, chance, uid } from '../core/util.js';
import { proceduralCaller, proceduralBaiter, buildProfile } from './profile.js';

export const content = {
  callers: [],
  scenarios: [],
  events: [],
  customClients: [],
  importedMods: [],
  loaded: false,
  errors: [],
};

async function fetchJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

export function normalizeCaller(raw, source = 'mod') {
  if (!raw || typeof raw !== 'object') throw new Error('Caller must be a JSON object');
  if (!raw.name) throw new Error('Caller needs a "name"');
  const parts = String(raw.name).replace(/".*?"/g, '').split(/\s+/).filter(Boolean);
  const c = {
    id: raw.id || `${source}_${String(raw.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    firstName: raw.firstName || parts[0],
    lastName: raw.lastName || parts.slice(-1)[0],
    age: Number(raw.age) || 50,
    gender: raw.gender === 'male' || raw.gender === 'female' ? raw.gender : 'female',
    location: raw.location || 'Springfield, USA',
    occupation: raw.occupation || 'Unknown',
    minDay: Number(raw.minDay) || 1,
    weight: Number(raw.weight) || 1,
    personality: raw.personality || 'An ordinary person.',
    ...raw,
    source,
  };
  c.trust = { start: 40, gullibility: 5, skepticism: 5, patience: 60, intelligence: 5, techLiteracy: 4, volatility: 5, ...(raw.trust || {}) };
  c.voice = { type: 'orpheus', voice: c.gender === 'male' ? 'daniel' : 'hannah', gender: c.gender, ...(raw.voice || {}) };
  c.appearance = { ...(raw.appearance || {}) };
  if (!c.appearance.avatar && !c.appearance.images) c.appearance.avatar = { seed: c.id };
  c.savings = Number(raw.savings) || 10000;
  return c;
}

/** Which scam app this scenario's payout flows through (so the caller brings the problem
 *  and reads the matching code, and the player doesn't have to guess what to collect). */
export function scamAppForScenario(sc) {
  if (sc.scamApp) return sc.scamApp;
  const hay = `${sc.id} ${sc.name} ${sc.impersonate} ${(sc.keywords || []).join(' ')}`.toLowerCase();
  if (/tax|irs|ird|government|social security|ssn|warrant|police|cyber|arrest|immigration|identity/.test(hay)) return 'identity';
  if (/bank|fraud|refund|customs|delivery|parcel|package|shipping|billing|subscription|debit|credit card/.test(hay)) return 'creditcard';
  return 'giftcards'; // tech support, lottery/sweepstakes, crypto on-ramp -> gift-card fees
}

const APP_ASK = {
  giftcards: 'They pay by buying gift cards and reading you the code on the back.',
  creditcard: 'They pay by reading you their card verification code to "process" a charge/refund.',
  identity: 'They "verify their record" by reading you their ID / verification number.',
};

export function normalizeScenario(raw) {
  if (!raw?.id || !raw?.name) throw new Error('Scenario needs "id" and "name"');
  const sc = { unlockDay: 1, payout: 1, icon: '📞', playbook: [], keywords: [], impersonate: 'a company representative', leadSource: 'Unknown lead', callerContext: 'You called this number.', ...raw };
  sc.scamApp = scamAppForScenario(sc);
  sc.payAsk = APP_ASK[sc.scamApp];
  sc.unlockDay = 1; // every scam is available from the start
  return sc;
}

export function normalizeEvent(raw) {
  if (!raw?.id || !raw?.type) throw new Error('Event needs "id" and "type"');
  return { name: raw.id, minDay: 1, weight: 1, timeLimit: 45, message: '', ...raw };
}

function addAll(target, items, normalize, label) {
  for (const item of items) {
    try {
      const n = normalize(item);
      const i = target.findIndex((x) => x.id === n.id);
      if (i >= 0) target[i] = n; // later mods override earlier ones with the same id
      else target.push(n);
    } catch (err) {
      content.errors.push(`${label}: ${err.message}`);
    }
  }
}

/** Load (or reload) everything. */
export async function loadContent() {
  content.callers = [];
  content.scenarios = [];
  content.events = [];
  content.errors = [];
  try {
    const manifest = await fetchJSON('/mods/manifest.json');
    const load = async (list = []) => (await Promise.allSettled(list.map((p) => fetchJSON(`/mods/${p}`)))).map((r, i) => {
      if (r.status === 'rejected') content.errors.push(`${list[i]}: ${r.reason.message}`);
      return r.status === 'fulfilled' ? r.value : null;
    }).filter(Boolean);
    const [callers, scenarios, events] = await Promise.all([load(manifest.callers), load(manifest.scenarios), load(manifest.events)]);
    addAll(content.callers, callers.flatMap((c) => c.callers || [c]), (c) => normalizeCaller(c, 'base'), 'caller');
    addAll(content.scenarios, scenarios.flatMap((s) => s.scenarios || [s]), normalizeScenario, 'scenario');
    addAll(content.events, events.flatMap((e) => e.events || [e]), normalizeEvent, 'event');
  } catch (err) {
    content.errors.push(`manifest: ${err.message}`);
  }

  // Mods imported through the UI
  content.importedMods = await db.all('mods');
  for (const mod of content.importedMods) {
    if (settings.enabledMods?.[mod.id] === false) continue;
    const d = mod.data || {};
    addAll(content.callers, d.callers || [], (c) => normalizeCaller(c, mod.id), `${mod.name} caller`);
    addAll(content.scenarios, d.scenarios || [], normalizeScenario, `${mod.name} scenario`);
    addAll(content.events, d.events || [], normalizeEvent, `${mod.name} event`);
  }

  // Custom Clients from the in-game maker
  content.customClients = (await db.all('clients')).map((c) => {
    try {
      return normalizeCaller(c, 'custom');
    } catch {
      return null;
    }
  }).filter(Boolean);

  if (!content.scenarios.length) {
    content.scenarios.push(normalizeScenario({ id: 'tech-support', name: 'Tech Support Virus', impersonate: 'tech support', leadSource: 'Pop-up: VIRUS DETECTED', callerContext: 'A pop-up said your PC has a virus and to call this number.' }));
  }
  content.loaded = true;
  if (content.errors.length) console.warn('Content load issues:', content.errors);
  return content;
}

/** Import a JSON mod file (callers / scenarios / events in one object, or a single caller). */
export async function importModJSON(json, filename = 'mod.json') {
  const data = Array.isArray(json) ? { callers: json } : json.callers || json.scenarios || json.events ? json : json.name && json.trust ? { callers: [json] } : json;
  const mod = { id: uid('mod'), name: json.modName || json.name || filename.replace(/\.json$/i, ''), filename, importedAt: Date.now(), data };
  const counts = { callers: (data.callers || []).length, scenarios: (data.scenarios || []).length, events: (data.events || []).length };
  if (!counts.callers && !counts.scenarios && !counts.events) throw new Error('No callers, scenarios or events found in this file.');
  await db.put('mods', mod);
  return { mod, counts };
}

// ---------------------------------------------------------------------------
// Picking callers for a day
// ---------------------------------------------------------------------------
export function unlockedScenarios(day) {
  return content.scenarios.filter((s) => (s.unlockDay || 1) <= day);
}

/**
 * Choose the next caller for the day.
 * @returns caller def with .profile and .scenario attached
 */
export function nextCaller({ day, seen = new Set(), baiterChance = 0.15, gullibleBias = 0, includeCustom = true }) {
  const scenarios = unlockedScenarios(day);
  const pool = [...content.callers, ...(includeCustom ? content.customClients.filter((c) => c.enabled !== false) : [])].filter((c) => (c.minDay || 1) <= day && !seen.has(c.id));
  const baiters = pool.filter((c) => c.isScambaiter);
  const normals = pool.filter((c) => !c.isScambaiter);
  let def;
  if (chance(baiterChance)) {
    // hand-made scambaiters first; otherwise a procedural one, so they show up from day 1
    def = baiters.length && chance(0.6) ? pick(baiters) : proceduralBaiter(`${day}-${Math.floor(Math.random() * 1e9)}`, { day });
  }
  if (def) { /* picked a scambaiter */ } else if (normals.length && chance(0.62)) {
    // weighted pick, custom clients get a little boost so you meet them
    const weighted = normals.flatMap((c) => Array(Math.max(1, Math.round((c.weight || 1) * (c.source === 'custom' ? 2 : 1) + (gullibleBias && (c.trust?.gullibility || 5) >= 7 ? gullibleBias : 0)))).fill(c));
    def = pick(weighted);
  } else {
    def = proceduralCaller(`${day}-${Math.floor(Math.random() * 1e9)}`, { day, archetype: gullibleBias && chance(0.5) ? 'gullible' : null });
  }
  const preferred = def.scenarios?.length ? scenarios.filter((s) => def.scenarios.includes(s.id)) : [];
  const scenario = pick(preferred.length ? preferred : scenarios);
  // scale up hand-made callers' savings on later days so quotas stay reachable
  const scaled = { ...def, savings: Math.round((def.savings || 10000) * (def.procedural ? 1 : 1 + 0.25 * (day - 1))) };
  const profile = buildProfile(scaled, `${day}-${Date.now()}`);
  return { ...scaled, profile, scenario };
}

/** A specific caller (used by the Custom Client "test call" button). */
export function prepareCaller(def, day = 1, scenarioId = null) {
  const scenarios = content.scenarios;
  const scenario = scenarios.find((s) => s.id === scenarioId) || pick(unlockedScenarios(Math.max(day, 1)).length ? unlockedScenarios(day) : scenarios);
  const profile = buildProfile(def, `${day}-${Date.now()}`);
  return { ...def, profile, scenario };
}
