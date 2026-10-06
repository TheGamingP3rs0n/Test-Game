// In-world HUD: day/clock, quota bar, strikes, police heat, wallet, crosshair,
// interaction prompt, disaster banner, subtitles, hidden indicator.
import { el, money, clockText } from '../core/util.js';
import { bus } from '../core/bus.js';
import { settings } from '../core/store.js';

export class HUD {
  constructor(root, game) {
    this.game = game;
    this.node = el('div.hud');
    this.clock = el('div.chip.clock', '9:00 AM');
    this.dayChip = el('div.chip', el('span.label', 'Day'), el('b', '1'));
    this.quotaBar = el('div', { style: { width: '0%' } });
    this.quotaNums = el('div.nums', el('span', '$0'), el('span', '/ $1,500'));
    this.pending = el('span.label', '');
    this.quota = el('div.chip.quota', el('div.row', { style: { justifyContent: 'space-between' } }, el('span.label', 'Daily quota'), this.pending), el('div.bar', this.quotaBar), this.quotaNums);
    this.strikes = el('div.chip.strikes', el('span.label', 'Strikes'), el('span', '❌'), el('span', '❌'), el('span', '❌'));
    this.heatBar = el('div', { style: { width: '0%' } });
    this.heat = el('div.chip.heat', el('span.label', 'Heat'), el('div.bar', this.heatBar));
    this.wallet = el('div.chip', el('span.label', 'Your cut'), el('b', '$0'));
    this.practice = el('div.chip', { style: { display: 'none', color: 'var(--yellow)' } }, '🎭 PRACTICE CALL — nothing counts');
    this.crosshair = el('div.crosshair');
    this.prompt = el('div.prompt', { style: { display: 'none' } });
    this.banner = el('div.banner', { style: { display: 'none' } });
    this.subtitles = el('div.subtitles');
    this.hint = el('div.hint');
    this.hiddenTag = el('div.hidden-indicator', { style: { display: 'none' } }, '🙈 HIDDEN UNDER DESK');
    this.vignette = el('div.vignette');
    this.node.append(this.vignette, el('div.hud-top', this.clock, this.dayChip, this.quota, this.strikes, this.heat, this.wallet, this.practice), this.crosshair, this.prompt, this.banner, this.subtitles, this.hint, this.hiddenTag);
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
    bus.on('player:mode', () => this.renderHint());
    bus.on('player:lock', () => this.renderHint());
    bus.on('chaos:start', ({ message, type }) => {
      this.banner.style.display = '';
      this.vignette.classList.toggle('red', ['police_raid', 'fire', 'air_strike', 'power_failure'].includes(type));
      this.bannerMsg = message;
    });
    bus.on('chaos:tick', ({ message, timeLeft, timeLimit, progress }) => {
      const hasTimer = timeLimit < 500;
      this.banner.replaceChildren(
        el('div', message),
        progress ? el('div', { style: { fontSize: '13px', marginTop: '4px', color: '#ffe' } }, progress) : null,
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

  renderHint() {
    const p = this.game.world?.player;
    const lines = [];
    if (p && !p.locked && this.game.playing) lines.push('🖱️ Click to look around');
    lines.push(`<span class="kbd">E</span> use  <span class="kbd">WASD</span> walk  <span class="kbd">C</span> crouch/hide  <span class="kbd">Tab</span> computer`);
    lines.push(`<span class="kbd">F</span> answer  <span class="kbd">${(settings.pttKey || 'KeyV').replace('Key', '')}</span> hold to talk  <span class="kbd">Enter</span> type  <span class="kbd">Esc</span> pause`);
    this.hint.innerHTML = lines.join('<br>');
  }

  show(on, { practice = false } = {}) {
    this.node.style.display = on ? '' : 'none';
    this.practice.style.display = practice ? '' : 'none';
    for (const c of [this.quota, this.strikes, this.heat, this.wallet, this.dayChip]) c.style.display = practice ? 'none' : '';
    this.renderHint();
  }

  setComputerMode(on) {
    this.crosshair.style.display = on ? 'none' : '';
    this.prompt.style.display = 'none';
    this.hint.style.display = on ? 'none' : '';
    this.hiddenTag.style.display = 'none';
  }

  update() {
    const g = this.game;
    if (!g.day || this.node.style.display === 'none') return;
    this.clock.textContent = clockText(g.clock);
    this.dayChip.lastChild.textContent = g.day.day;
    const pct = Math.min(1, Math.max(0, g.day.earned) / g.day.quota);
    this.quotaBar.style.width = `${pct * 100}%`;
    this.quota.classList.toggle('done', pct >= 1);
    this.quotaNums.firstChild.textContent = money(g.day.earned);
    this.quotaNums.lastChild.textContent = `/ ${money(g.day.quota)}`;
    const pend = g.pendingTotal();
    this.pending.textContent = pend ? `+${money(pend)} to collect` : '';
    [...this.strikes.querySelectorAll('span:not(.label)')].forEach((s, i) => s.classList.toggle('on', i < (g.run?.strikes || 0)));
    this.heatBar.style.width = `${g.run?.heat || 0}%`;
    this.wallet.lastChild.textContent = money(g.run?.wallet || 0);
  }
}
