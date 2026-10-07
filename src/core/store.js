// Settings + run save, persisted in localStorage on this machine only.
import { bus } from './bus.js';

export const VERSION = 'v0.3.0';

const SETTINGS_KEY = 'scc.settings.v1';
const RUN_KEY = 'scc.run.v1';
const META_KEY = 'scc.meta.v1';

export const DEFAULT_SETTINGS = {
  apiKey: '',
  chatModel: 'openai/gpt-oss-20b',
  ttsModel: 'canopylabs/orpheus-v1-english',
  sttModel: 'whisper-large-v3',
  voiceOutput: 'groq', // groq | browser | off
  voiceInput: 'groq', // groq | browser | text
  pttKey: 'KeyV',
  aiCreativity: 0.9,
  masterVolume: 0.8,
  voiceVolume: 1,
  sfxVolume: 0.7,
  ambienceVolume: 0.35,
  musicVolume: 0.45,
  dayLengthMinutes: 16,
  fov: 80,
  mouseSensitivity: 1,
  showSubtitles: true,
  showCallerThoughts: true,
  graphics: 'high', // low | medium | high | ultra
  agentAlias: 'Steve Johnson',
  playerName: 'You',
  enabledMods: {},
};

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn('Could not save', key, err);
  }
}

export const settings = { ...DEFAULT_SETTINGS, ...load(SETTINGS_KEY, {}) };

// v2: the old 10-minute default workday felt rushed — move untouched saves to the new default
if ((settings.settingsVersion || 1) < 2) {
  if (settings.dayLengthMinutes === 10) settings.dayLengthMinutes = DEFAULT_SETTINGS.dayLengthMinutes;
  settings.settingsVersion = 2;
  save(SETTINGS_KEY, settings);
}

export function updateSettings(patch) {
  Object.assign(settings, patch);
  save(SETTINGS_KEY, settings);
  bus.emit('settings:changed', settings, patch);
}

export function hasApiKey() {
  return typeof settings.apiKey === 'string' && settings.apiKey.trim().length > 10;
}

export const runStore = {
  load: () => load(RUN_KEY, null),
  save: (run) => save(RUN_KEY, run),
  clear: () => save(RUN_KEY, null),
};

/** Meta progression that survives runs (best run, total stolen, etc.). */
export const meta = {
  data: { bestDay: 0, totalScammed: 0, runs: 0, baitersCaught: 0, ...load(META_KEY, {}) },
  update(patch) {
    Object.assign(this.data, patch);
    save(META_KEY, this.data);
  },
};
