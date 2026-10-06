// Run state: survives between days (and page reloads via localStorage).
import { runStore, meta } from '../core/store.js';
import { uid } from '../core/util.js';
import { quotaFor, appsForDay } from './progression.js';

export function newRun() {
  const run = {
    id: uid('run'),
    startedAt: Date.now(),
    day: 1,
    strikes: 0,
    wallet: 0, // your commission, spent in the shop
    heat: 0, // police attention 0-100
    upgrades: {},
    totalEarned: 0,
    notes: 'Scam notes:\n- Always use your fake name.\n- Never say "scam" on the phone.\n',
    intel: [],
    files: [],
    chats: {},
    history: [],
    over: false,
  };
  meta.update({ runs: (meta.data.runs || 0) + 1 });
  return run;
}

export function newDayState(run) {
  return {
    day: run.day,
    quota: quotaFor(run.day),
    earned: 0,
    pendingPayments: [],
    callsTaken: 0,
    missedCalls: 0,
    scamsWon: 0,
    hangups: 0,
    baitersFlagged: 0,
    wrongFlags: 0,
    exposed: 0,
    infections: 0,
    disasters: [],
    highlights: [],
    callLog: [],
    seenCallers: [],
    apps: appsForDay(run.day),
  };
}

export function saveRun(run) {
  if (!run || run.over) return runStore.clear();
  const { dayState, ...persist } = run;
  runStore.save(persist);
}

export function loadRun() {
  return runStore.load();
}
