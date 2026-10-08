// Your browser: a tiny fake internet with useful (and useless) sites.
import { el, money, pick } from '../../core/util.js';
import { bus } from '../../core/bus.js';
import { sfx } from '../../core/audio.js';
import { upgradeLevel } from '../../game/progression.js';
import { addIntel } from './apps.js';
import { renderSite } from './remoteApp.js';
import { COWORKERS } from '../../ai/coworkers.js';
import { icon, iconFor } from '../icons.js';

const BOOKMARKS = [
  ['🔎', 'searchy.com', 'Searchy'],
  ['🕵️', 'whodat.com', 'WhoDat'],
  ['🎁', 'giftcheck.biz', 'GiftCheck'],
  ['📚', 'scamwiki.org', 'ScamWiki'],
  ['📰', 'kolkatatimes.in', 'Kolkata Times'],
  ['🏢', 'intranet.globalsolutions', 'Intranet'],
];

export function browserApp(game, win, opts = {}) {
  const page = el('div.page');
  const history = [];
  let hIdx = -1;
  const tabTitle = el('span.br-tabtitle', 'New Tab');
  const tabFav = el('span.br-fav', icon('globe'));
  const lock = el('span.br-lock', icon('lock'));
  const addr = el('input.addr.br-addr', { spellcheck: false, onkeydown: (e) => (e.stopPropagation(), e.key === 'Enter' && go(addr.value)) });
  const back = el('button.br-nav', { title: 'Back', onclick: () => hIdx > 0 && go(history[--hIdx], true) }, icon('arrow-left'));
  const fwd = el('button.br-nav', { title: 'Forward', onclick: () => hIdx < history.length - 1 && go(history[++hIdx], true) }, icon('arrow-right'));
  const go = (url, fromHistory = false) => {
    url = String(url || 'searchy.com').trim().toLowerCase().replace(/^https?:\/\//, '');
    addr.value = url;
    if (!fromHistory) { history.splice(hIdx + 1); history.push(url); hIdx = history.length - 1; }
    back.disabled = hIdx <= 0; fwd.disabled = hIdx >= history.length - 1;
    const bm = BOOKMARKS.find(([, d]) => url.startsWith(d));
    tabTitle.textContent = bm ? bm[2] : url.split('/')[0];
    tabFav.replaceChildren(icon(bm ? iconFor(bm[0], 'globe') : 'globe'));
    lock.classList.toggle('insecure', !bm && !(game.run.sites || []).some((x) => url.includes(x.domain.toLowerCase())));
    page.scrollTop = 0;
    if (game.internetDown) {
      tabTitle.textContent = 'No internet';
      page.replaceChildren(el('div.br-offline', icon('wifi-off'), el('h2', 'No internet'), el('p', 'Try: rebooting the router (side table, west wall).'), el('p.muted', 'ERR_ROUTER_HELD_TOGETHER_BY_TAPE')));
      return;
    }
    const site = SITES.find(([d]) => url.startsWith(d));
    if (site) return page.replaceChildren(site[1](game, go));
    const custom = (game.run.sites || []).find((x) => url.includes(x.domain.toLowerCase()));
    if (custom) return page.replaceChildren(renderSite(custom));
    page.replaceChildren(el('div.br-offline', icon('globe'), el('h2', 'This site can\'t be reached'), el('p', `${url}'s server IP address could not be found.`), el('p.muted', 'DNS_PROBE_FINISHED_NXDOMAIN')));
  };
  const root = el('div.browser.br',
    el('div.br-tabs', el('div.br-tab', tabFav, tabTitle, el('span.br-x', icon('x'))), el('span.br-newtab', icon('plus'))),
    el('div.br-toolbar', back, fwd, el('button.br-nav', { title: 'Reload', onclick: () => go(addr.value, true) }, icon('refresh')),
      el('div.br-omni', lock, addr, el('span.br-star', icon('star'))),
      el('button.br-nav', { title: 'Home', onclick: () => go('searchy.com') }, icon('home'))),
    el('div.br-bookmarks', ...BOOKMARKS.map(([i, d, n]) => el('button.br-bm', { title: d, onclick: () => go(d) }, icon(iconFor(i, 'globe')), n))),
    page);
  setTimeout(() => go(opts.url || 'searchy.com'), 0);
  return root;
}

const SITES = [
  ['searchy.com', (game, go) => el('div.site', el('div.body', { style: { textAlign: 'center', paddingTop: '30px' } },
    el('div', { style: { fontSize: '48px', fontWeight: 900, letterSpacing: '-2px' } }, el('span', { style: { color: '#4285f4' } }, 'S'), el('span', { style: { color: '#ea4335' } }, 'e'), el('span', { style: { color: '#fbbc05' } }, 'a'), el('span', { style: { color: '#4285f4' } }, 'r'), el('span', { style: { color: '#34a853' } }, 'c'), el('span', { style: { color: '#ea4335' } }, 'h'), 'y'),
    el('p', { style: { color: '#666' } }, 'Results you can trust (sponsored)'),
    el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', maxWidth: '560px', margin: '20px auto' } },
      ...BOOKMARKS.slice(1).map(([i, d]) => el('div.card', { style: { cursor: 'pointer' }, onclick: () => go(d) }, el('div', { style: { fontSize: '28px' } }, i), d)),
      ...(game.run.sites || []).map((s) => el('div.card', { style: { cursor: 'pointer' }, onclick: () => go(s.domain) }, el('div', { style: { fontSize: '28px' } }, s.logo || '🌐'), s.domain)))))],

  ['whodat.com', (game) => {
    const out = el('div');
    const input = el('input', { placeholder: 'Full name…', value: game.calls.caller?.name || '', style: { width: '260px' }, onkeydown: (e) => e.stopPropagation() });
    const free = upgradeLevel(game.run, 'whodat') > 0;
    const search = () => {
      const c = game.calls.caller;
      const q = input.value.trim().toLowerCase();
      if (!q) return;
      if (!free) {
        if ((game.run.wallet || 0) < 50) return out.replaceChildren(el('p', { style: { color: '#c62828' } }, 'Insufficient funds ($50 per lookup, from your cut). Buy WhoDat Premium in the shop.'));
        game.run.wallet -= 50;
      }
      sfx('notify');
      if (c && (c.name.toLowerCase().includes(q) || q.includes(c.lastName?.toLowerCase()))) {
        const p = c.profile;
        const facts = [['Full name', p.fullName], ['Age', String(c.age)], ['Address', p.address], ['Phone', p.phone], [p.spouse ? 'Spouse' : 'Relatives', p.spouse || [...(p.kids || []), ...(p.grandkids || [])].join(', ') || 'none listed'], ['Possible employer', c.occupation]];
        out.replaceChildren(el('div.card', el('b', `✅ 1 match found${free ? '' : ' (-$50)'}`),
          el('table', facts.map(([k, v]) => el('tr', el('td', k), el('td', v), el('td', el('button.xp-btn', { onclick: () => addIntel(game, { label: k, value: v }) && bus.emit('toast', { text: `🕵️ Saved ${k}`, ms: 1500 }) }, '📌')))))));
      } else out.replaceChildren(el('p', `No records for "${input.value}". ${free ? '' : '(-$50, no refunds)'}`));
    };
    return el('div.site', el('header', { style: { background: '#222' } }, el('h1', '🕵️ WhoDat People Finder')), el('div.body', el('p', `Find anyone's address, relatives and more. ${free ? 'Premium: free lookups ✅' : '$50 per search.'}`), el('div.row', input, el('button.xp-btn.primary', { onclick: search }, 'Search')), out));
  }],

  ['giftcheck.biz', (game) => {
    const out = el('div');
    const input = el('input', { placeholder: 'XXXX-XXXX-XXXX', style: { width: '220px', fontFamily: 'var(--mono)', fontSize: '18px' }, onkeydown: (e) => e.stopPropagation() });
    const check = () => {
      const norm = (v) => String(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
      const code = norm(input.value);
      const pay = (game.day?.pendingPayments || []).find((p) => p.code && norm(p.code) === code);
      if (!pay) return out.replaceChildren(el('p', '❓ Unknown code.'));
      out.replaceChildren(pay.fake ? el('p', { style: { color: '#c62828', fontWeight: 800 } }, '🚫 INVALID — this code was never activated. Someone is messing with you…') : el('p', { style: { color: '#137a43', fontWeight: 800 } }, '✅ Valid and unredeemed.'));
    };
    const pending = (game.day?.pendingPayments || []).filter((p) => p.status === 'pending' && p.code).map((p) => p.code);
    return el('div.site', el('header', { style: { background: '#d81b60' } }, el('h1', '🎁 GiftCheck — card balance checker')), el('div.body', el('p', 'Check a gift card before redeeming it. Scambaiters love fake codes.'), el('div.row', input, el('button.xp-btn.primary', { onclick: check }, 'Check')), pending.length ? el('p', { style: { fontSize: '12px', color: '#666' } }, 'Codes waiting in your Cashier: ', ...pending.map((c) => el('a', { href: '#', style: { marginRight: '8px' }, onclick: (e) => (e.preventDefault(), (input.value = c), check()) }, c))) : null, out));
  }],

  ['scamwiki.org', () => el('div.site', el('header', { style: { background: '#555' } }, el('h1', '📚 ScamWiki')), el('div.body',
    el('h3', 'Tech support scam'), el('p', 'Victims are shown "errors" in Event Viewer and "hackers" in netstat, then sold a useless license. Classic.'),
    el('h3', 'Refund scam'), el('p', 'The scammer edits the victim\'s bank page with Inspect Element so it looks like they were refunded too much, then begs for the difference back in gift cards.'),
    el('h3', 'Scambaiters'), el('p', 'People who pretend to be victims to waste scammers\' time. Tells: virtual machines (VirtualBox), streaming software (OBS), suspiciously perfect gullibility, fake gift card codes, .exe "documents".'),
    el('h3', 'Why gift cards?'), el('p', 'Untraceable-ish and instant. Also the #1 red flag that makes smart callers hang up. Timing is everything.')))],

  ['kolkatatimes.in', (game) => {
    const hl = [
      'Local cow elected employee of the month at undisclosed call center',
      'Scientists confirm: nobody has ever needed "Windoze Support"',
      'Grandmother scams scammer out of 400 gift cards in viral video',
      'Police "very close" to finding call center located directly above police station',
      `Area man fired for not hitting quota of ${money((game.day?.quota || 1500) * 3)}`,
      'Monsoon expected to flood exactly one office building again',
      'Study: 98% of people asked to "open the black window" do so',
      ...(game.day?.highlights || []).slice(-3).map((h) => `BREAKING: ${h}`),
    ];
    return el('div.site', el('header', { style: { background: '#8b0000' } }, el('h1', '📰 The Kolkata Times')), el('div.body', ...hl.reverse().map((h) => el('div.card', el('b', h), el('div', { style: { fontSize: '12px', color: '#777' } }, pick(['2 min ago', '1 hour ago', 'Yesterday']))))));
  }],

  ['intranet.globalsolutions', (game) => {
    const you = { name: 'You ("Steve")', earned: game.day?.earned || 0 };
    const others = COWORKERS.map((c) => ({ name: `${c.name} ("${c.alias}")`, earned: Math.round((game.day?.quota || 1500) * (0.2 + Math.random() * 0.9) * ((game.clock - 540) / 480 + 0.1)) }));
    const board = [you, ...others].sort((a, b) => b.earned - a.earned);
    return el('div.site', el('header', { style: { background: '#1f9d4c' } }, el('h1', '🏢 Global Solutions Intranet')), el('div.body',
      el('div.card', el('b', `Quota today: ${money(game.day?.quota || 0)}`), el('div', `Team progress: ${money(game.day?.earned || 0)} (yours, the rest is "being audited")`)),
      el('div.card', el('b', '🏆 Leaderboard'), el('table', board.map((b, i) => el('tr', el('td', `#${i + 1}`), el('td', b.name), el('td', money(b.earned)))))),
      el('div.card', el('b', '📢 Announcements'), el('ul', ['Microwave privileges suspended (Vikram).', 'Do NOT feed the office cow.', 'Mandatory fun: Friday 11pm–2am.'].map((t) => el('li', t))))));
  }],
];
