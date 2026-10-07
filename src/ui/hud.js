// In-world HUD: day/clock, quota bar, strikes, police heat, wallet, crosshair,
// interaction prompt, disaster banner, subtitles, hidden indicator.
import { el, money, clockText, pick, typingInField } from '../core/util.js';
import { bus } from '../core/bus.js';
import { sfx } from '../core/audio.js';
import { settings } from '../core/store.js';
import { icon, iconFor } from './icons.js';
import { PHYSICAL_TOOLS } from './os/extraApps.js';

export class HUD {
  constructor(root, game) {
    this.game = game;
    this.node = el('div.hud');
    this.clock = el('span.hud-clock', '9:00 AM');
    this.overtime = el('span.hud-overtime', { style: { display: 'none' } }, 'OT 2:00');
    this.dayLabel = el('span.hud-day', 'DAY 1');
    this.quotaBar = el('div', { style: { width: '0%' } });
    this.quotaEarned = el('b', '$0');
    this.quotaGoal = el('span', '/ $1,500');
    this.pending = el('span.hud-pending', '');
    this.strikeDots = [0, 1, 2].map(() => el('span.dot'));
    this.heatBar = el('div', { style: { width: '0%' } });
    this.wallet = el('b', '$0');
    this.status = el('div.hud-status',
      el('div.hud-row', this.dayLabel, el('span', this.overtime, this.clock)),
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
    this.breakTag = el('div.break-indicator', { style: { display: 'none' } }, icon('chai'), 'ON BREAK — NO CALLS');
    this.staminaBar = el('div', { style: { width: '100%' } });
    this.stamina = el('div.stamina', { style: { display: 'none' } }, icon('run'), el('div.bar', this.staminaBar));
    this.equipped = null; // id of the physical tool currently held (Scamazon "personal safety")
    this.toolbar = el('div.hud-toolbar', { style: { display: 'none' } });
    this.vignette = el('div.vignette');
    this.clockOut = el('button.clock-out', { style: { display: 'none' }, onclick: () => this.game.clockOut() }, icon('door'), el('span', 'Clock Out'), el('small', 'Quota met — end the day'));
    this.node.append(this.vignette, this.status, this.practice, this.crosshair, this.prompt, this.banner, this.subtitles, this.hint, this.lookHint, this.hiddenTag, this.breakTag, this.clockOut, this.stamina, this.toolbar);
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
    bus.on('player:zone', (z) => {
      this.breakTag.style.display = z ? '' : 'none';
      if (z) this.breakTag.lastChild.textContent = z === 'restroom' ? 'IN THE RESTROOM — NO CALLS' : 'ON BREAK — NO CALLS';
    });
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
    bus.on('overtime:start', () => { this.overtime.style.display = ''; this.node.classList.add('overtime'); });
    bus.on('overtime:end', () => { this.overtime.style.display = 'none'; this.node.classList.remove('overtime'); });
    bus.on('overtime:tick', (left) => { const s = Math.ceil(left); this.overtime.textContent = `OT ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; });
    // physical tools (Scamazon "personal safety"): equip + fire on coworkers/NPCs
    bus.on('tools:changed', () => this.renderToolbar());
    bus.on('player:fire', () => this.useEquippedTool());
    bus.on('player:mode', () => this.renderToolbar());
    document.addEventListener('keydown', (e) => {
      if (typingInField() || !this.game.playing || this.game.paused || this.game.computerOpen) return;
      if (/^Digit[1-9]$/.test(e.code)) {
        const owned = this.ownedTools();
        const t = owned[Number(e.code.slice(5)) - 1];
        if (t) { this.equip(t.id); sfx('click'); }
      }
    });
  }

  /** The physical tools the player currently owns (bought from Scamazon). */
  ownedTools() {
    const tools = this.game.run?.tools || {};
    return PHYSICAL_TOOLS.filter((t) => (tools[t.id] || 0) > 0);
  }

  equip(id) {
    this.equipped = this.equipped === id ? null : id; // click the held one to put it away
    this.renderToolbar();
    this.renderHint();
  }

  renderToolbar() {
    const owned = this.ownedTools();
    const g = this.game;
    const onFoot = g.playing && !g.computerOpen && g.world?.player && g.world.player.mode !== 'seated';
    if (!owned.length || !onFoot) { this.toolbar.style.display = 'none'; return; }
    if (this.equipped && !owned.some((t) => t.id === this.equipped)) this.equipped = null;
    this.toolbar.style.display = '';
    this.toolbar.replaceChildren(...owned.map((t, i) => {
      const n = g.run.tools[t.id] || 0;
      return el(`button.tool-slot${this.equipped === t.id ? '.on' : ''}`, { title: t.name, onclick: () => (this.equip(t.id), sfx('click')) },
        el('span.tool-key', String(i + 1)),
        el('span.tool-ico', { style: { color: t.color } }, icon(iconFor(t.icon || 'target', 'target'))),
        n > 1 ? el('span.tool-qty', `×${n}`) : null);
    }));
  }

  /** Swing/fire the held tool at whoever we're aiming at — comedic, non-violent. */
  useEquippedTool() {
    const g = this.game;
    if (!g.playing || g.paused || g.computerOpen) return;
    const pl = g.world?.player;
    if (!pl || pl.mode === 'seated') return;
    if (g.calls?.state === 'ringing' || g.calls?.active) return;
    const tool = this.equipped && this.ownedTools().find((t) => t.id === this.equipped);
    if (!tool) return;
    sfx('zap');
    const npc = g.world.aimNpc();
    if (!npc) {
      bus.emit('toast', { kind: 'warn', icon: 'target', text: `You ${tool.use} thin air. Aim at a coworker.`, ms: 2200 });
      return;
    }
    const who = npc.label || 'a coworker';
    npc.react(pick(['!!!', 'AAAH', 'HEY!', 'OW', 'WHY', 'NOT AGAIN', 'HR!!']));
    bus.emit('flash');
    bus.emit('toast', { kind: 'bad', icon: 'zap', title: tool.name, text: `You ${tool.use} ${who}. Morale is now negative.`, ms: 3000 });
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
    else if (p && p.mode !== 'seated') {
      parts = [k('WASD', 'Walk'), k('E', 'Use'), k('Shift', 'Sprint'), k('Space', 'Jump'), k('Tab', 'Back to desk')];
      if (this.equipped) parts.splice(2, 0, k('F', 'Swing tool'));
    } else parts = [k('Tab', 'Computer'), k('WASD', 'Get up'), k('Esc', 'Pause')];
    this.hint.replaceChildren(...parts.map((pt) => el('span.hint-item', pt)));
    const needLook = p && !p.locked && g.playing && !g.paused && !g.computerOpen;
    this.lookHint.style.display = needLook ? '' : 'none';
  }

  show(on, { practice = false } = {}) {
    this.node.style.display = on ? '' : 'none';
    document.body.classList.toggle('in-shift', on && !practice);
    this.practice.style.display = practice ? '' : 'none';
    this.status.style.display = practice ? 'none' : '';
    if (!on) this.toolbar.style.display = 'none';
    this.renderHint();
    this.renderToolbar();
  }

  setComputerMode(on) {
    this.crosshair.style.display = on ? 'none' : '';
    this.prompt.style.display = 'none';
    this.hint.style.display = on ? 'none' : '';
    this.hiddenTag.style.display = 'none';
    if (on) { this.clockOut.style.display = 'none'; this.toolbar.style.display = 'none'; }
    this.renderHint();
    this.renderToolbar();
  }

  update() {
    const g = this.game;
    if (!g.day || this.node.style.display === 'none') return;
    this.clock.textContent = clockText(g.clock);
    // co-op shows the shared TEAM total/quota; solo shows yours
    const earned = g.mp ? g.mpTeam.earned : Math.max(0, g.day.earned);
    const quota = g.mp ? g.mpTeam.quota : g.day.quota;
    this.dayLabel.textContent = g.mp ? `DAY ${g.mpTeam.day} · TEAM` : `DAY ${g.day.day}`;
    const pct = Math.min(1, earned / Math.max(1, quota));
    this.quotaBar.style.width = `${pct * 100}%`;
    this.status.classList.toggle('done', pct >= 1);
    this.quotaEarned.textContent = money(earned);
    this.quotaGoal.textContent = `/ ${money(quota)}`;
    const pend = g.pendingTotal();
    this.pending.textContent = pend ? `+${money(pend)} waiting in Cashier` : '';
    this.strikeDots.forEach((d, i) => d.classList.toggle('on', i < (g.run?.strikes || 0)));
    this.heatBar.style.width = `${g.run?.heat || 0}%`;
    this.wallet.textContent = money(g.run?.wallet || 0);
    // Clock Out appears once quota is met; it hides again if earnings drop back below.
    const earnedNow = g.mp ? g.mpTeam.earned : g.day.earned;
    const quotaNow = g.mp ? g.mpTeam.quota : g.day.quota;
    // sprint/stamina bar
    const pl = g.world?.player;
    if (pl && g.phase === 'playing' && !g.computerOpen && (pl.stamina < 99.5 || pl.sprinting)) {
      this.stamina.style.display = '';
      this.staminaBar.style.width = `${pl.stamina}%`;
      this.staminaBar.style.background = pl.stamina < 25 ? 'var(--red)' : pl.sprinting ? 'var(--yellow)' : 'var(--green-2)';
    } else this.stamina.style.display = 'none';
    const canClockOut = g.phase === 'playing' && !g.computerOpen && earnedNow >= quotaNow;
    this.clockOut.style.display = canClockOut ? '' : 'none';
    if (canClockOut) this.clockOut.lastChild.textContent = g.mp ? 'Quota met — vote to clock out' : 'Quota met — end the day';
    this.clockOut.firstChild && (this.clockOut.querySelector('span').textContent = g.mp ? 'Vote: Clock Out' : 'Clock Out');
  }
}
