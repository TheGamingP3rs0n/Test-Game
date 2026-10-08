// Run-based progression: quotas, what unlocks each day, and the between-day shop.

export function quotaFor(day) {
  return Math.round((1500 * Math.pow(1.5, day - 1)) / 50) * 50;
}

export function baiterChanceFor(day) {
  if (day <= 1) return 0.12;
  return Math.min(0.35, 0.12 + day * 0.035);
}

export function eventsPerDay(day) {
  return Math.min(6, 1 + Math.floor(day * 0.85));
}

/** Apps on your work PC and the day they unlock. */
export const APPS = [
  { id: 'phone', name: 'Phone', icon: '📞', day: 1 },
  { id: 'remote', name: 'RemoteHelp', icon: '🖥️', day: 1 },
  { id: 'notes', name: 'Notes', icon: '📝', day: 1 },
  { id: 'browser', name: 'Browser', icon: '🌐', day: 1 },
  { id: 'cashier', name: 'Cashier', icon: '💰', day: 1 },
  { id: 'giftcards', name: 'Gift Cards', icon: '🎁', day: 1 },
  { id: 'creditcard', name: 'Credit Card', icon: '💳', day: 1 },
  { id: 'identity', name: 'Identity', icon: '🆔', day: 1 },
  { id: 'playbook', name: 'Playbook', icon: '📘', day: 1 },
  { id: 'messenger', name: 'Messenger', icon: '💬', day: 1 },
  { id: 'files', name: 'Files', icon: '📁', day: 1 },
  { id: 'antivirus', name: 'DefendoMax', icon: '🛡️', day: 1 },
  { id: 'recorder', name: 'Recorder', icon: '⏺️', day: 1 },
  { id: 'paint', name: 'Paint', icon: '🎨', day: 2 },
  { id: 'docforge', name: 'DocForge', icon: '📄', day: 3 },
  { id: 'siteforge', name: 'SiteForge', icon: '🕸️', day: 4 },
  { id: 'scamazon', name: 'Scamazon', icon: '🛒', day: 1 },
  { id: 'meteorcookie', name: 'Meteor Cookie', icon: '🍪', day: 1 },
  { id: 'disscord', name: 'Disscord', icon: '💬', day: 1 },
  { id: 'rainbit', name: 'Rainbit', icon: '🎰', day: 1 },
];

export function appsForDay() {
  // every app is available from day 1 (no locked apps)
  return APPS.map((a) => a.id);
}

export const SHOP = [
  { id: 'headset', name: 'Noise-Cancelling Headset', icon: '🎧', price: 300, desc: 'Callers lose patience 25% slower.', max: 1 },
  { id: 'accent', name: 'Accent Coaching', icon: '🗣️', price: 450, desc: 'Callers start with +6 trust.', max: 2 },
  { id: 'leads', name: 'Premium Lead List', icon: '📇', price: 600, desc: 'More gullible callers, 30% fewer scambaiters.', max: 1 },
  { id: 'vpn', name: 'VPN Deluxe', icon: '🕶️', price: 400, desc: 'Police heat builds up half as fast.', max: 1 },
  { id: 'chai', name: 'Turbo Chai Subscription', icon: '☕', price: 250, desc: 'Workday lasts one extra in-game hour.', max: 2 },
  { id: 'antivirus', name: 'DefendoMax Pro License', icon: '🛡️', price: 350, desc: 'Blocks the first malware infection every day.', max: 1 },
  { id: 'shredder', name: 'Industrial Shredder', icon: '🗑️', price: 300, desc: 'Shred evidence twice as fast during raids.', max: 1 },
  { id: 'ganesha', name: 'Lucky Ganesha Statue', icon: '🐘', price: 200, desc: 'One fewer office disaster per day.', max: 2 },
  { id: 'whodat', name: 'WhoDat Premium', icon: '🔎', price: 250, desc: 'People-finder lookups are free.', max: 1 },
  { id: 'bribe', name: 'Bribe Envelope', icon: '✉️', price: 500, desc: 'Automatically ends the next police raid. (Consumable)', max: 3, consumable: true },
];

export function upgradeLevel(run, id) {
  return run?.upgrades?.[id] || 0;
}

/** Boss verdict rules (the AI only writes the speech). */
export function decideVerdict({ earned, quota, strikes }) {
  const pct = quota ? earned / quota : 0;
  if (pct >= 1.5) return { verdict: 'promoted', text: 'Crushed the quota by 50%+. Employee of the Day: one strike removed and a fat bonus.', strikeDelta: strikes > 0 ? -1 : 0, bonusPct: 0.08 };
  if (pct >= 1) return { verdict: 'survived', text: 'Quota met. You keep your job. For now.', strikeDelta: 0, bonusPct: 0.03 };
  if (strikes + 1 >= 3) return { verdict: 'fired', text: 'Quota missed with two strikes already. FIRED.', strikeDelta: 1, bonusPct: 0 };
  if (pct >= 0.8) return { verdict: 'warning', text: 'Quota missed (but close). That is a STRIKE — unless the excuse is amazing.', strikeDelta: 1, bonusPct: 0, excusable: true };
  return { verdict: 'strike', text: 'Quota badly missed. That is a STRIKE.', strikeDelta: 1, bonusPct: 0 };
}

export const DAY_INTROS = [
  'Welcome to your first day at Global Solutions Pvt. Ltd. (definitely a real tech company). Answer calls. Get money. Do not disappoint Mr. Chatterjee.',
  'Day two. Refund scams are now on the menu, and Paint + Camera are installed on your PC. Watch out — scambaiters have found our number.',
  'The government and bank-fraud scripts are unlocked, plus DocForge for official-looking documents. Police have been "asking questions" in the area.',
  'Customs package scams and SiteForge are unlocked. Rumor says the air-raid siren on the roof works now.',
  'Sweepstakes scams unlocked. The quota is getting ridiculous. So is the boss.',
  'Crypto and Cyber Police scams unlocked. Everything is on fire, sometimes literally.',
];
