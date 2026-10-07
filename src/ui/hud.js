// In-world HUD: day/clock, quota bar, strikes, police heat, wallet, crosshair,
// interaction prompt, disaster banner, subtitles, hidden indicator.
import { el, money, clockText } from '../core/util.js';
import { bus } from '../core/bus.js';
import { settings } from '../core/store.js';
import { icon } from './icons.js';

export class HUD {
  constructor(root, game) {
    this.game = game;
    this.node = el('div.hud');
    this.clock = el('span.hud-clock', '9:00 AM');
    this.dayLabel = el('span.hud-day', 'DAY 1');
    this.quotaBar = el('div', { style: { width: '0%' } });
    this.quotaEarned = el('b', '$0');
    this.quotaGoal = el('span', '/ $1,500');
    this.pending = el('span.hud-pending', '');
    this.strikeDots = [0, 1, 2].map(() => el('span.dot'));
    this.heatBar = el('div', { style: { width: '0%' } });
    this.wallet = el('b', '$0');
    this.status = el('div.hud-status',
      el('div.hud-row', this.dayLabel, this.clock),
      el('div.hud-quota', el('div.hud-row', el('span.label', 'Quota'), el('span', this.quotaEarned, ' ', this.quotaGoal)), el('div.bar', this.quotaBar), this.pending),
      el('div.hud-row.hud-small',
        el('span.hud-strikes', { title: 'Strikes — three and you\'re fired' }, el('span.label', 'Strikes'), this.strikeDots),
        el('span.hud-heat', { title: 'Police heat' }, icon('siren'), el('div.bar', this.heatBar)),
        el('span.hud-wallet', { title: 'Your cut (spend it in the shop)' }, icon('wallet'), this.wallet)));
    this.practice = el('div.hud-status.practice', { style: { display: 'none' } }, icon('drama'), 'PRACTICE CALL — nothing counts');
    this.crosshair = el('div.crosshair');
    this.prompt = el('div.prompt', { style: { display: 'none' } });
    this.banner = el('div.banner', { style: { display: 'none' } });
    this.subtitles = el('div.subtitles');
    this.hint = el('div.hint');
    this.lookHint = el('div.look-hint', { style: { display: 'none' } }, icon('mouse'), 'Click to look around');
    this.hiddenTag = el('div.hidden-indicator', { style: { display: 'none' } }, icon('hidden'), 'HIDDEN UNDER DESK');
    this.vignette = el('div.vignette');
    this.clockOut = el('button.clock-out', { style: { display: 'none' }, onclick: () => this.game.clockOut() }, icon('door'), el('span', 'Clock Out'), el('small', 'Quota met — end the day'));
    this.node.append(this.vignette, this.status, this.practice, this.crosshair, this.prompt, this.banner, this.subtitles, this.hint, this.lookHint, this.hiddenTag, this.clockOut);
    root.append(this.node);
    this.show(false);
    this.bind();
    this.renderHint();
  }

  bind() {
    bus.on('player:target', (t) => {
      this.crosshair.classList.toggle('active', !!t);
      if (t) {
        this.prompt.style.display = '';
        this.prompt.replaceChildren(el('span.kbd', 'E'), ' ', t.label);
      } else this.prompt.style.display = 'none';
    });
    bus.on('player:hidden', (h) => (this.hiddenTag.style.display = h ? '' : 'none'));
    for (const e of ['player:mode', 'player:lock', 'call:ring', 'call:start', 'call:end', 'call:missed']) bus.on(e, () => this.renderHint());
    bus.on('chaos:start', ({ message, type }) => {
      this.banner.style.display = '';
      this.vignette.classList.toggle('red', ['police_raid', 'fire', 'air_strike', 'power_failure'].includes(type));
      this.bannerMsg = message;
    });
    bus.on('chaos:tick', ({ message, timeLeft, timeLimit, progress }) => {
      const hasTimer = timeLimit < 500;
      this.banner.replaceChildren(
        el('div.banner-msg', icon('siren'), el('span', message)),
        progress ? el('div.banner-progress', progress) : null,
        hasTimer ? el('div.timer', `${Math.ceil(timeLeft)}s`) : null,
        hasTimer ? el('div.progress', el('div', { style: { width: `${(timeLeft / timeLimit) * 100}%` } })) : null,
      );
    });
    bus.on('chaos:end', () => {
      this.banner.style.display = 'none';
      this.vignette.classList.remove('red');
    });
    bus.on('call:line', (l) => {
      if (l.who !== 'caller' || !settings.showSubtitles) return;
      if (this.game.computerOpen) return; // the call panel already shows it
      this.subtitles.replaceChildren(el('span.who', `${this.game.calls.caller?.firstName || 'Caller'}: `), l.text);
      clearTimeout(this.subTimer);
      this.subTimer = setTimeout(() => this.subtitles.replaceChildren(), 4000 + l.text.length * 60);
    });
    bus.on('call:end', () => this.subtitles.replaceChildren());
  }

  /** One short line of the keys that matter right now (full list: pause → Controls). */
  renderHint() {
    const g = this.game;
    const p = g.world?.player;
    const k = (key, label) => [el('span.kbd', key), ` ${label}`];
    const ptt = (settings.pttKey || 'KeyV').replace('Key', '');
    let parts;
    if (g.calls?.state === 'ringing') parts = [k('F', 'Answer the phone')];
    else if (g.calls?.active) parts = [k(ptt, 'Hold to talk'), k('Enter', 'Type'), k('Tab', 'Computer')];
    else if (p && p.mode !== 'seated') parts = [k('WASD', 'Walk'), k('E', 'Use'), k('C', 'Crouch'), k('Tab', 'Back to desk')];
    else parts = [k('Tab', 'Computer'), k('WASD', 'Get up'), k('Esc', 'Pause')];
    this.hint.replaceChildren(...parts.map((pt) => el('span.hint-item', pt)));
    const needLook = p && !p.locked && g.playing && !g.paused && !g.computerOpen;
    this.lookHint.style.display = needLook ? '' : 'none';
  }

  show(on, { practice = false } = {}) {
    this.node.style.display = on ? '' : 'none';
    document.body.classList.toggle('in-shift', on && !practice);
    this.practice.style.display = practice ? '' : 'none';
    this.status.style.display = practice ? 'none' : '';
    this.renderHint();
  }

  setComputerMode(on) {
    this.crosshair.style.display = on ? 'none' : '';
    this.prompt.style.display = 'none';
    this.hint.style.display = on ? 'none' : '';
    this.hiddenTag.style.display = 'none';
    if (on) this.clockOut.style.display = 'none';
    this.renderHint();
  }

  update() {
    const g = this.game;
    if (!g.day || this.node.style.display === 'none') return;
    this.clock.textContent = clockText(g.clock);
    this.dayLabel.textContent = `DAY ${g.day.day}`;
    const pct = Math.min(1, Math.max(0, g.day.earned) / g.day.quota);
    this.quotaBar.style.width = `${pct * 100}%`;
    this.status.classList.toggle('done', pct >= 1);
    this.quotaEarned.textContent = money(Math.max(0, g.day.earned));
    this.quotaGoal.textContent = `/ ${money(g.day.quota)}`;
    const pend = g.pendingTotal();
    this.pending.textContent = pend ? `+${money(pend)} waiting in Cashier` : '';
    this.strikeDots.forEach((d, i) => d.classList.toggle('on', i < (g.run?.strikes || 0)));
    this.heatBar.style.width = `${g.run?.heat || 0}%`;
    this.wallet.textContent = money(g.run?.wallet || 0);
    // Clock Out appears once quota is met; it hides again if earnings drop back below.
    const canClockOut = g.phase === 'playing' && !g.computerOpen && g.day.earned >= g.day.quota && g.clock < g.dayEnd;
    this.clockOut.style.display = canClockOut ? '' : 'none';
  }
}
