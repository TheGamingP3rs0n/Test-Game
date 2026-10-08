// Reference-flavoured desktop apps: Scamazon (in-shift store), Meteor Cookie (an idle
// cookie-clicker to waste time on), and Disscord (a fake chat with a too-good-to-be-true
// "Nitro" gift that is, of course, a trap). All parody, all fictional.
import { el, money } from '../../core/util.js';
import { bus } from '../../core/bus.js';
import { sfx } from '../../core/audio.js';
import { SHOP, upgradeLevel } from '../../game/progression.js';
import { saveRun } from '../../game/run.js';
import { icon, iconFor } from '../icons.js';
import { renderItemThumb } from './itemRender.js';

/** The product image for a catalogue item: a coloured backdrop with a 3D-rendered model
 *  (built offscreen from primitives). Falls back to the line icon if rendering fails. */
function itemImg(it) {
  const fallback = icon(iconFor(it.icon || (it.kind === 'tool' ? 'target' : 'cart'), 'cart'));
  const wrap = el('div.sz-img', { style: { background: `linear-gradient(160deg, ${it.color}, color-mix(in srgb, ${it.color} 70%, #000))` } }, fallback);
  setTimeout(() => {
    if (!wrap.isConnected) return;
    const url = renderItemThumb(it.id);
    if (url) wrap.replaceChildren(el('img.sz-3d', { src: url, alt: it.name }));
  }, 0);
  return wrap;
}

// Physical tools you can equip and (comedically) use on coworkers/NPCs — all parody,
// no gore. Exported so the world/hotbar can read the catalog.
export const PHYSICAL_TOOLS = [
  { id: 'mace', name: 'Bear Mace', icon: 'flame', price: 35, color: '#9b4dff', desc: 'A pocket-sized performance review for eyes, noses, and workplace morale.', use: 'spray a cloud of bear mace at' },
  { id: 'sniper', name: 'Remote-Work Sniper', icon: 'target', price: 1800, color: '#7ea4d8', desc: 'Attend difficult meetings from several rooftops away.', use: 'line up a long-distance "performance review" on' },
  { id: 'shotgun', name: 'Conflict Resolution Shotgun', icon: 'bomb', price: 650, color: '#f0892b', desc: 'Turns an open-door policy into an open-wall policy.', use: 'resolve a conflict (loudly) with' },
  { id: 'shield', name: 'Customer Support Riot Shield', icon: 'shield', price: 120, color: '#f0892b', desc: 'Blocks projectiles, criticism, and most reasonable refund requests.', use: 'shield-bash' },
  { id: 'taser', name: 'Motivational Taser', icon: 'zap', price: 350, color: '#2fab5e', desc: 'Delivers actionable feedback at fifty thousand volts.', use: 'deliver 50,000 volts of feedback to' },
  { id: 'baton', name: 'Batton (Definitely Spelled Right)', icon: 'swords', price: 90, color: '#f0892b', desc: 'For when words fail and HR is on lunch.', use: 'gently remind' },
  { id: 'traq', name: 'Traq Gun', icon: 'biohazard', price: 220, color: '#2fab5e', desc: 'Keeps overachievers from making the rest of you look bad.', use: 'tranquilize' },
  { id: 'ak', name: 'AK-47 Office Standard', icon: 'skull', price: 1500, color: '#d14b8f', desc: 'Issued to all senior scammers. Fully automatic synergy.', use: 'unleash synergy on' },
  { id: 'javelin', name: 'FGM-148 Javelin', icon: 'rocket', price: 12000, color: '#ff3ea5', desc: 'Fire-and-forget team-building exercise.', use: 'launch a team-building exercise at' },
];

// ---------------------------------------------------------------- Scamazon
export function scamazonApp(game, win) {
  const run = game.run;
  run.tools = run.tools || {};
  const body = el('div.scamazon');

  const upgradeItem = (it) => ({ ...it, color: '#2b5fd9', kind: 'upgrade', max: it.max, buy: () => { run.upgrades[it.id] = upgradeLevel(run, it.id) + 1; } });
  const toolItem = (it) => ({ ...it, kind: 'tool', max: 9, buy: () => { run.tools[it.id] = (run.tools[it.id] || 0) + 1; bus.emit('tools:changed'); } });
  const CATALOG = {
    scams: { label: 'Scam Tools & Leads', items: SHOP.filter((i) => ['leads', 'accent', 'whodat', 'bribe'].includes(i.id)).map(upgradeItem) },
    business: { label: 'Business Apps', items: SHOP.filter((i) => ['vpn', 'antivirus', 'shredder', 'ganesha', 'chai', 'headset'].includes(i.id)).map(upgradeItem) },
    games: { label: 'Games & Software', items: [
      { id: 'nov-airstrike-self', name: 'Airstrike Yourselves', icon: 'bomb', price: 6000, color: '#b3261e', desc: 'Orders one full missile barrage against your own call center. Team morale may vary.', kind: 'novelty', effect: () => game.chaos?.trigger?.('air-strike', { forced: true }) },
      { id: 'nov-cookie', name: 'Meteor Cookie Premium', icon: 'cookie', price: 50, color: '#c08a4a', desc: 'Removes the ads from the cookie clicker. There were no ads.', kind: 'novelty' },
      { id: 'nov-nitro', name: 'Disscord Nitro (Legit)', icon: 'chat', price: 100, color: '#5865f2', desc: 'A totally real one-month Nitro. Definitely not from Hypercat.', kind: 'novelty' },
    ] },
    physical: { label: 'Weapons & Personal Safety', items: PHYSICAL_TOOLS.map(toolItem) },
  };

  let tab = 'scams';
  const walletLine = el('div.sz-wallet');

  const render = () => {
    walletLine.replaceChildren(icon('wallet'), el('b', money(run.wallet || 0)), el('span', ' your cut'));
    const cat = CATALOG[tab];
    const grid = el('div.sz-grid', ...cat.items.map((it) => {
      const lvl = it.kind === 'upgrade' ? upgradeLevel(run, it.id) : it.kind === 'tool' ? (run.tools[it.id] || 0) : 0;
      const maxed = (it.kind === 'upgrade') && lvl >= it.max;
      const afford = (run.wallet || 0) >= it.price;
      const canBuy = afford && !maxed;
      const btn = canBuy
        ? holdToBuy(() => { run.wallet -= it.price; it.buy?.(); it.effect?.(); sfx('cash'); saveRun(run); bus.emit('money:changed'); render(); }, money(it.price), false)
        : el('button.sz-need', { disabled: true }, maxed ? 'Owned' : `Need ${money(it.price)}`);
      return el(`div.sz-item${lvl ? '.owned' : ''}`,
        itemImg(it),
        el('div.sz-body',
          el('div.sz-nm', it.name),
          el('div.sz-ds', it.desc),
          el('div.sz-price', money(it.price)),
          lvl ? el('div.sz-lvl', it.kind === 'tool' ? `Owned ×${lvl}` : it.consumable ? `Owned: ${lvl}` : `${lvl}/${it.max}`) : null,
          btn));
    }));
    body.replaceChildren(
      el('div.sz-bar',
        el('div.sz-logo', el('span.sz-dollar', '$'), el('b', 'SCAMAZON'), el('span.sz-market', 'MARKET')),
        el('div.sz-hello', `Hello, ${(run.alias || 'Metater').replace(/"/g, '')}`)),
      el('div.sz-tabs',
        ...[['scams', 'Scams'], ['business', 'Business apps'], ['games', 'Games & software'], ['physical', 'Physical goods']].map(([id, lbl]) =>
          el(`div.sz-tab${tab === id ? '.on' : ''}`, { onclick: () => (sfx('click'), tab = id, render()) }, lbl))),
      el('div.sz-cat', cat.label),
      grid);
  };
  render();
  const off = bus.on('money:changed', () => body.isConnected && render());
  win.onClose = off;
  return body;
}

/** A press-and-hold buy button (fills over ~0.7s, then fires). */
function holdToBuy(onBuy, label, disabled) {
  const fill = el('div.hold-fill');
  const btn = el(`button.hold-buy${disabled ? '.disabled' : ''}`, fill, el('span', disabled ? label : `Hold to buy — ${label}`));
  if (disabled) {
    btn.disabled = true;
    return btn;
  }
  let raf = null;
  let t0 = 0;
  const DUR = 650;
  const step = (t) => {
    if (!t0) t0 = t;
    const p = Math.min(1, (t - t0) / DUR);
    fill.style.width = `${p * 100}%`;
    if (p >= 1) {
      cancel();
      onBuy();
    } else raf = requestAnimationFrame(step);
  };
  const start = (e) => {
    e.preventDefault();
    t0 = 0;
    raf = requestAnimationFrame(step);
  };
  const cancel = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    fill.style.width = '0%';
  };
  btn.addEventListener('mousedown', start);
  btn.addEventListener('touchstart', start);
  btn.addEventListener('mouseup', cancel);
  btn.addEventListener('mouseleave', cancel);
  btn.addEventListener('touchend', cancel);
  return btn;
}

// ---------------------------------------------------------------- Meteor Cookie
export function meteorCookieApp(game, win) {
  game.run.cookie = game.run.cookie || { mass: 0, auto: 0 };
  const st = game.run.cookie;
  const massEl = el('div.mc-mass');
  const cookie = el('button.mc-cookie', { onclick: () => { st.mass += 1 + st.auto; pop(); sfx('click'); } }, icon('cookie'));
  const autoBtn = el('button.xp-btn.primary');
  const renderMass = () => {
    const m = Math.floor(st.mass);
    massEl.replaceChildren(el('b', m >= 1000 ? `${(m / 1000).toFixed(3)} Thousand` : String(m)), el('span', ' cookie mass'));
    autoBtn.replaceChildren(document.createTextNode(`Buy Auto-Clicker (${st.cookieCost || 25} mass) — owned ${st.auto}`));
    autoBtn.disabled = st.mass < (st.cookieCost || 25);
  };
  const pop = () => {
    cookie.classList.remove('tap');
    void cookie.offsetWidth;
    cookie.classList.add('tap');
    renderMass();
  };
  autoBtn.onclick = () => {
    const cost = st.cookieCost || 25;
    if (st.mass < cost) return;
    st.mass -= cost;
    st.auto += 1;
    st.cookieCost = Math.round(cost * 1.6);
    sfx('cash');
    renderMass();
  };
  renderMass();
  const timer = setInterval(() => { if (st.auto) { st.mass += st.auto * 0.2; renderMass(); } }, 200);
  win.onClose = () => clearInterval(timer);
  return el('div.meteorcookie',
    el('div.mc-top', massEl),
    cookie,
    el('div.mc-foot', el('p', 'An idle cookie clicker someone installed on the work PC. It does nothing for your quota. Click anyway.'), autoBtn));
}

// ---------------------------------------------------------------- Disscord
export function disscordApp(game, win) {
  const msgs = el('div.dc-msgs');
  const push = (who, node) => { msgs.append(el(`div.dc-row${who === 'me' ? '.me' : ''}`, node)); msgs.scrollTop = msgs.scrollHeight; };
  push('them', el('div.dc-bub', el('b', 'Hypercat'), el('div', 'yo you still on shift? this place is wild lol')));
  push('them', el('div.dc-gift', { onclick: () => {
    sfx('error');
    push('them', el('div.dc-bub', el('b', 'Hypercat'), el('div', 'lmaooo you actually clicked it')));
    bus.emit('toast', { kind: 'bad', icon: 'skull', title: 'That was not Nitro', text: 'The "free Nitro" was a trap. Your PC is not having a good time.' });
    game.chaos?.trigger?.('computer-virus', { forced: true });
  } },
    el('div.dc-gift-head', icon('gift'), 'DISSCORD NITRO'),
    el('div.dc-gift-big', '1 MONTH · FREE'),
    el('div.dc-gift-sub', 'Exclusive gift · CLICK TO CLAIM')));
  const input = el('input', { placeholder: 'Message @Hypercat', onkeydown: (e) => { e.stopPropagation(); if (e.key === 'Enter' && input.value.trim()) { push('me', el('div.dc-bub.me', input.value.trim())); input.value = ''; setTimeout(() => push('them', el('div.dc-bub', el('b', 'Hypercat'), el('div', 'k'))), 700); } } });
  return el('div.disscord',
    el('div.dc-head', icon('bot'), el('b', 'Disscord'), el('span', '— the world\'s most secure messaging app')),
    msgs,
    el('div.dc-compose', input, el('button.xp-btn.primary', { onclick: () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })) }, 'Send')));
}
