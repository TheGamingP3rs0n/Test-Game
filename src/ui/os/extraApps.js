// Reference-flavoured desktop apps: Scamazon (in-shift store), Meteor Cookie (an idle
// cookie-clicker to waste time on), and Disscord (a fake chat with a too-good-to-be-true
// "Nitro" gift that is, of course, a trap). All parody, all fictional.
import { el, money } from '../../core/util.js';
import { bus } from '../../core/bus.js';
import { sfx } from '../../core/audio.js';
import { SHOP, upgradeLevel } from '../../game/progression.js';
import { saveRun } from '../../game/run.js';
import { icon, iconFor } from '../icons.js';

// ---------------------------------------------------------------- Scamazon
export function scamazonApp(game, win) {
  const run = game.run;
  const body = el('div.scamazon');
  // novelty items are pure comedy; the real buys are the SHOP upgrades
  const NOVELTY = [
    { id: 'nov-airstrike-rivals', name: 'Airstrike the Rival Scammers', icon: 'bomb', price: 9000, desc: 'Orders one full missile barrage against every registered rival scammer HQ.', effect: () => bus.emit('toast', { kind: 'warn', icon: 'bomb', title: 'Order placed', text: 'Rival HQs notified of incoming barrage. They are, understandably, upset.' }) },
    { id: 'nov-airstrike-self', name: 'Airstrike Yourselves', icon: 'bomb', price: 6000, desc: 'Orders one full missile barrage against your own call center. Team morale may vary.', effect: () => game.chaos?.trigger?.('air-strike', { forced: true }) },
  ];
  let tab = 'upgrades';
  const walletLine = el('div.sz-wallet');
  const render = () => {
    walletLine.replaceChildren(icon('wallet'), el('b', money(run.wallet || 0)), el('span', ' your cut'));
    const items = tab === 'upgrades'
      ? SHOP.map((it) => ({ ...it, buy: () => { run.upgrades[it.id] = upgradeLevel(run, it.id) + 1; } }))
      : NOVELTY;
    const grid = el('div.sz-grid', ...items.map((it) => {
      const lvl = tab === 'upgrades' ? upgradeLevel(run, it.id) : 0;
      const maxed = tab === 'upgrades' && lvl >= it.max;
      const afford = (run.wallet || 0) >= it.price;
      const btn = holdToBuy(() => {
        if (maxed || !afford) return;
        run.wallet -= it.price;
        (it.buy || (() => {}))();
        it.effect?.();
        sfx('cash');
        saveRun(run);
        bus.emit('money:changed');
        render();
      }, maxed ? 'Owned' : afford ? money(it.price) : 'Can\'t afford', maxed || !afford);
      return el(`div.sz-item${lvl ? '.owned' : ''}`,
        el('div.sz-ico', icon(iconFor(it.icon, 'cart'))),
        el('div.sz-nm', it.name),
        el('div.sz-ds', it.desc),
        tab === 'upgrades' ? el('div.sz-lvl', it.consumable ? `Owned: ${lvl}` : `${lvl}/${it.max}`) : null,
        btn);
    }));
    body.replaceChildren(
      el('div.sz-bar',
        el('div.sz-logo', icon('cart'), el('b', 'SCAMAZON'), el('span.sz-market', 'MARKET')),
        walletLine),
      el('div.sz-tabs',
        el(`div.sz-tab${tab === 'upgrades' ? '.on' : ''}`, { onclick: () => (tab = 'upgrades', render()) }, 'Upgrades'),
        el(`div.sz-tab${tab === 'novelty' ? '.on' : ''}`, { onclick: () => (tab = 'novelty', render()) }, 'Physical goods')),
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
