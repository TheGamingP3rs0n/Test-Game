// Rainbit — a parody crypto casino on the work PC. Gamble your cut (run.wallet) on
// Crash, Dice or Slots. The house always wins (eventually): every game has an edge.
import { el, money } from '../../core/util.js';
import { bus } from '../../core/bus.js';
import { sfx } from '../../core/audio.js';
import { saveRun } from '../../game/run.js';
import { icon, drawIcon } from '../icons.js';

const FAKE_USERS = ['xX_RajuGOAT_Xx', 'kevin_from_texas', 'GiftCardGandalf', 'priya.eth', 'chai_maxi', 'TaxRefund99', 'Mr_Chatterjee_alt', 'koi_rajesh', 'NotAScammer', 'boomer_hunter'];
const SLOT_SYMBOLS = [
  { id: 'cherry', ic: 'heart', color: '#ff4d6d', w: 5, pay: 5 },
  { id: 'bell', ic: 'bell', color: '#ffcf5a', w: 4, pay: 8 },
  { id: 'gem', ic: 'gem', color: '#55d6ff', w: 3, pay: 12 },
  { id: 'coin', ic: 'bitcoin', color: '#f7931a', w: 2, pay: 20 },
  { id: 'seven', ic: 'flame', color: '#ff3ea5', w: 1, pay: 50 },
];

export function rainbitApp(game, win) {
  const run = game.run;
  let tab = 'crash';
  let bet = Math.min(50, Math.max(1, Math.floor(run.wallet || 0)) || 10);
  const timers = new Set();
  let raf = 0;

  const balance = el('b.rb-bal');
  const feed = el('div.rb-feed');
  const stage = el('div.rb-stage');
  const betInput = el('input.rb-bet', { type: 'number', min: 1, value: bet, onkeydown: (e) => e.stopPropagation(), oninput: () => { bet = Math.max(1, Math.floor(Number(betInput.value) || 1)); } });

  const wallet = () => Math.floor(run.wallet || 0);
  const setBalance = () => balance.replaceChildren(icon('wallet'), money(wallet()));
  const take = (amt) => {
    if (amt > wallet() || amt < 1) { sfx('error'); bus.emit('toast', { kind: 'warn', icon: 'wallet', text: wallet() < 1 ? 'You\'re broke. Go scam someone. (Rainbit accepts your cut only.)' : 'Not enough in your wallet for that bet.' }); return false; }
    run.wallet -= amt; saveRun(run); bus.emit('money:changed'); setBalance(); return true;
  };
  const give = (amt) => { run.wallet += amt; saveRun(run); bus.emit('money:changed'); setBalance(); };
  const pushFeed = (user, game_, mult, win_) => {
    feed.prepend(el(`div.rb-feed-row${win_ > 0 ? '.won' : ''}`, el('span.rb-fu', user), el('div.rb-fd', el('span', `${game_} · ${mult.toFixed(2)}×`), el('b', win_ > 0 ? `+${money(win_)}` : 'lost'))));
    while (feed.children.length > 9) feed.lastChild.remove();
  };
  // ambient fake big wins so the place feels alive
  const ambient = setInterval(() => {
    const m = Math.random() < 0.2 ? 2 + Math.random() * 40 : 1 + Math.random() * 2;
    pushFeed(FAKE_USERS[Math.floor(Math.random() * FAKE_USERS.length)], ['Crash', 'Dice', 'Slots'][Math.floor(Math.random() * 3)], m, Math.random() < 0.55 ? Math.round((20 + Math.random() * 900) * m) : 0);
  }, 2600);
  timers.add(ambient);

  const betRow = () => el('div.rb-betrow',
    el('label', 'Bet'), el('div.rb-betbox', el('span', '$'), betInput),
    el('button.rb-chip', { onclick: () => setBet(Math.max(1, Math.floor(bet / 2))) }, '½'),
    el('button.rb-chip', { onclick: () => setBet(bet * 2) }, '2×'),
    el('button.rb-chip', { onclick: () => setBet(Math.max(1, wallet())) }, 'Max'));
  const setBet = (v) => { bet = Math.max(1, Math.floor(v)); betInput.value = bet; };

  // ---------------------------------------------------------------- Crash
  function crashGame() {
    const canvas = el('canvas.rb-crash', { width: 560, height: 230 });
    const ctx = canvas.getContext('2d');
    const multEl = el('div.rb-mult', '1.00×');
    const btn = el('button.rb-go');
    const auto = el('input.rb-auto', { type: 'number', min: 1.01, step: 0.1, value: 2, onkeydown: (e) => e.stopPropagation() });
    let state = 'idle'; // idle | flying | crashed | cashed
    let stake = 0, mult = 1, crashAt = 1, t0 = 0;
    const pts = [];
    const draw = () => {
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 1;
      for (let i = 1; i < 5; i++) { ctx.beginPath(); ctx.moveTo(0, (h / 5) * i); ctx.lineTo(w, (h / 5) * i); ctx.stroke(); }
      if (!pts.length) return;
      const maxT = Math.max(6, pts[pts.length - 1][0]);
      const maxM = Math.max(2, mult * 1.15);
      const X = (t) => 16 + (t / maxT) * (w - 40), Y = (m) => h - 14 - ((m - 1) / (maxM - 1)) * (h - 34);
      const grad = ctx.createLinearGradient(0, h, 0, 0);
      grad.addColorStop(0, state === 'crashed' ? 'rgba(255,61,90,.05)' : 'rgba(34,230,140,.05)'); grad.addColorStop(1, state === 'crashed' ? 'rgba(255,61,90,.35)' : 'rgba(34,230,140,.35)');
      ctx.beginPath(); ctx.moveTo(X(0), Y(1));
      for (const [t, m] of pts) ctx.lineTo(X(t), Y(m));
      ctx.lineTo(X(pts[pts.length - 1][0]), h); ctx.lineTo(X(0), h); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
      ctx.beginPath(); ctx.moveTo(X(0), Y(1));
      for (const [t, m] of pts) ctx.lineTo(X(t), Y(m));
      ctx.strokeStyle = state === 'crashed' ? '#ff3d5a' : '#22e68c'; ctx.lineWidth = 4; ctx.stroke();
      const [lt, lm] = pts[pts.length - 1];
      drawIcon(ctx, state === 'crashed' ? 'flame' : 'rocket', X(lt) - 14, Y(lm) - 18, 28, state === 'crashed' ? '#ff3d5a' : '#ffffff', 2.4);
    };
    const render = () => {
      multEl.textContent = `${mult.toFixed(2)}×`;
      multEl.className = `rb-mult ${state}`;
      if (state === 'flying') { btn.textContent = `Cash out ${money(Math.floor(stake * mult))}`; btn.className = 'rb-go cash'; }
      else { btn.textContent = 'Place bet & launch'; btn.className = 'rb-go'; }
    };
    const step = (now) => {
      if (state !== 'flying') return;
      const t = (now - t0) / 1000;
      mult = Math.min(crashAt, Math.pow(Math.E, 0.11 * t * 1.6));
      pts.push([t, mult]);
      const autoAt = Number(auto.value) || 0;
      if (mult >= crashAt) {
        state = 'crashed'; sfx('explosion');
        pushFeed('You', 'Crash', crashAt, 0);
      } else if (autoAt >= 1.01 && mult >= autoAt) {
        return cashOut();
      }
      render(); draw();
      if (state === 'flying') raf = requestAnimationFrame(step);
    };
    const cashOut = () => {
      if (state !== 'flying') return;
      state = 'cashed';
      const win_ = Math.floor(stake * mult);
      give(win_); sfx('cash');
      pushFeed('You', 'Crash', mult, win_);
      render(); draw();
    };
    btn.onclick = () => {
      if (state === 'flying') return cashOut();
      if (!take(bet)) return;
      stake = bet; mult = 1; pts.length = 0; t0 = performance.now();
      // 4% house edge; ~3% of rounds bust instantly
      const u = Math.random();
      crashAt = u < 0.03 ? 1 : Math.max(1.0, Math.floor((0.96 / (1 - u)) * 100) / 100);
      state = 'flying'; sfx('whoosh');
      raf = requestAnimationFrame(step);
    };
    render(); draw();
    return el('div.rb-game', el('div.rb-crash-wrap', canvas, multEl), betRow(), el('div.rb-betrow', el('label', 'Auto cash out'), el('div.rb-betbox', auto, el('span', '×'))), btn);
  }

  // ---------------------------------------------------------------- Dice
  function diceGame() {
    let target = 50;
    const result = el('div.rb-dice-result', '—');
    const track = el('div.rb-track');
    const marker = el('div.rb-marker');
    const fill = el('div.rb-fill');
    track.append(fill, marker);
    const slider = el('input.rb-slider', { type: 'range', min: 5, max: 95, value: target, oninput: () => { target = Number(slider.value); upd(); } });
    const info = el('div.rb-dice-info');
    const upd = () => {
      const chance = 100 - target;
      const payout = Math.floor((97 / chance) * 100) / 100;
      fill.style.left = `${target}%`; fill.style.width = `${100 - target}%`;
      info.replaceChildren(el('div', el('span', 'Roll over'), el('b', target)), el('div', el('span', 'Win chance'), el('b', `${chance}%`)), el('div', el('span', 'Payout'), el('b', `${payout.toFixed(2)}×`)));
      return payout;
    };
    const roll = el('button.rb-go', { onclick: () => {
      if (!take(bet)) return;
      const payout = upd();
      const r = Math.floor(Math.random() * 10000) / 100;
      marker.style.left = `${r}%`;
      marker.classList.remove('pop'); void marker.offsetWidth; marker.classList.add('pop');
      const won = r > target;
      result.textContent = r.toFixed(2);
      result.className = `rb-dice-result ${won ? 'won' : 'lose'}`;
      if (won) { const w = Math.floor(bet * payout); give(w); sfx('cash'); pushFeed('You', 'Dice', payout, w); } else { sfx('trustDown'); pushFeed('You', 'Dice', payout, 0); }
    } }, 'Roll dice');
    upd();
    return el('div.rb-game', result, track, slider, info, betRow(), roll);
  }

  // ---------------------------------------------------------------- Slots
  function slotsGame() {
    const total = SLOT_SYMBOLS.reduce((s, x) => s + x.w, 0);
    const pickSym = () => { let r = Math.random() * total; for (const s of SLOT_SYMBOLS) { if ((r -= s.w) < 0) return s; } return SLOT_SYMBOLS[0]; };
    const reels = [0, 1, 2].map(() => el('div.rb-reel'));
    const show = (reel, s) => reel.replaceChildren(el('span', { style: { color: s.color } }, icon(s.ic)));
    reels.forEach((r) => show(r, pickSym()));
    const msg = el('div.rb-slot-msg', 'Three of a kind pays big. Two pays 1.5×.');
    let spinning = false;
    const spin = el('button.rb-go', { onclick: () => {
      if (spinning || !take(bet)) return;
      spinning = true; sfx('click');
      const final = [pickSym(), pickSym(), pickSym()];
      reels.forEach((reel, i) => {
        reel.classList.add('spin');
        const iv = setInterval(() => show(reel, pickSym()), 70);
        timers.add(iv);
        const to = setTimeout(() => {
          clearInterval(iv); timers.delete(iv); reel.classList.remove('spin'); show(reel, final[i]); sfx('type');
          if (i === 2) {
            spinning = false;
            const [a, b, c] = final.map((s) => s.id);
            let mult = 0;
            if (a === b && b === c) mult = final[0].pay;
            else if (a === b || b === c || a === c) mult = 1.5;
            if (mult) { const w = Math.floor(bet * mult); give(w); sfx(mult >= 5 ? 'win' : 'cash'); msg.textContent = `${mult >= 5 ? 'JACKPOT! ' : ''}${mult}× — you won ${money(w)}`; msg.className = 'rb-slot-msg won'; pushFeed('You', 'Slots', mult, w); }
            else { msg.textContent = 'Nothing. The house thanks you for your donation.'; msg.className = 'rb-slot-msg'; pushFeed('You', 'Slots', 0, 0); }
          }
        }, 650 + i * 380);
        timers.add(to);
      });
    } }, 'Spin');
    const paytable = el('div.rb-pay', ...SLOT_SYMBOLS.slice().reverse().map((s) => el('div', el('span', { style: { color: s.color } }, icon(s.ic), icon(s.ic), icon(s.ic)), el('b', `${s.pay}×`))));
    return el('div.rb-game', el('div.rb-reels', ...reels), msg, betRow(), spin, paytable);
  }

  const GAMES = { crash: ['Crash', 'rocket', crashGame], dice: ['Dice', 'target', diceGame], slots: ['Slots', 'gem', slotsGame] };
  const nav = el('div.rb-nav');
  const renderTab = () => {
    cancelAnimationFrame(raf);
    nav.replaceChildren(...Object.entries(GAMES).map(([id, [label, ic]]) => el(`button.rb-tab${tab === id ? '.on' : ''}`, { onclick: () => { tab = id; renderTab(); } }, icon(ic), label)));
    stage.replaceChildren(GAMES[tab][2]());
  };
  setBalance();
  renderTab();
  const off = bus.on('money:changed', setBalance);
  win.onClose = () => { off(); cancelAnimationFrame(raf); for (const t of timers) { clearInterval(t); clearTimeout(t); } };
  return el('div.rainbit',
    el('div.rb-top', el('div.rb-logo', icon('zap'), 'RAINBIT', el('small', 'provably unfair')), balance),
    el('div.rb-body', el('div.rb-left', nav, stage), el('div.rb-right', el('div.rb-feed-head', icon('trophy'), 'Live bets'), feed)),
    el('div.rb-foot', 'Gamble responsibly. (You work at a scam call center, so… gamble.) Bets come out of your personal cut.'));
}
