// Full-screen UI: loading, main menu, briefing, pause, call recap, game over, credits.
import { el, money, clockText } from '../core/util.js';
import { icon } from './icons.js';
import { settings, hasApiKey, meta } from '../core/store.js';
import { unlockAudio, sfx } from '../core/audio.js';
import { DAY_INTROS, APPS } from '../game/progression.js';
import { content } from '../game/content.js';
import { portraitFor } from './portraits.js';
import { modal } from './dialog.js';
import { bus } from '../core/bus.js';

export const GAME_TITLE = 'Scam Call Center';

export class Screens {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    this.current = null;
  }

  show(node) {
    this.hide();
    this.current = node;
    this.root.append(node);
    return node;
  }

  hide() {
    this.current?.remove();
    this.current = null;
  }

  logo(size = 1) {
    return el('div.logo', { style: { transform: `rotate(-3deg) scale(${size})` } },
      el('span.big', el('span.dollar', '$'), 'CAM'),
      el('span.big', { style: { fontSize: 'clamp(30px, 5vw, 60px)' } }, 'CALL CENTER'),
      el('span.sub', 'KOLKATA ', el('b', 'NIGHT'), ' SHIFT'));
  }

  loading() {
    const bar = el('div');
    const label = el('div.muted', 'Loading the office…');
    this.show(el('div.screen.loading', this.logo(0.8), el('div.bar', bar), label));
    return {
      progress: (p, text) => {
        bar.style.width = `${Math.round(p * 100)}%`;
        if (text) label.textContent = text;
      },
    };
  }

  menu({ onSettings, onClients, onMods }) {
    const g = this.game;
    const hasSave = g.hasSave();
    const btn = (label, ic, onclick, cls = '', extra = null) => el(`button.btn.big.menu-btn${cls}`, { onclick: () => (unlockAudio(), sfx('click'), onclick()), onmouseenter: () => sfx('hover') }, el('span.lbl', icon(ic), label), extra);
    const m = meta.data;
    this.show(el('div.screen.menu-screen',
      el('div.menu',
        el('div', this.logo(1), el('div.stats', m.runs ? `Best run: Day ${m.bestDay || 0} • Lifetime scammed: ${money(m.totalScammed || 0)} • Scambaiters caught: ${m.baitersCaught || 0}` : 'Run a scam call center. Trick AI callers. Survive the boss.')),
        el('div.buttons',
          hasSave ? btn('Continue run', 'play', () => g.continueRun(), '.primary') : null,
          btn(hasSave ? 'New run' : 'Start shift', 'phone', () => g.newRun(), hasSave ? '' : '.primary'),
          el('button.btn.big.menu-btn', { disabled: true, title: 'Online co-op is coming soon!' }, el('span.lbl', icon('users'), 'Multiplayer'), el('span.badge.yellow', 'Coming soon')),
          btn('Custom Clients', 'contact', onClients),
          btn('Mods', 'puzzle', onMods),
          btn('Settings', 'settings', onSettings),
          btn('Credits', 'scroll', () => this.credits()),
          hasApiKey() ? null : el('div.keywarn', icon('warn'), el('span', 'No Groq API key yet — callers use a simple offline brain and browser voices. Add a free key in ', el('a', { href: '#', onclick: (e) => (e.preventDefault(), onSettings()) }, 'Settings'), ' for real AI conversations.'))),
        el('div.footer', el('span', `${content.callers.length} callers • ${content.scenarios.length} scams • ${content.events.length} events loaded${content.customClients.length ? ` • ${content.customClients.length} custom clients` : ''}`), el('span', 'A parody game. All callers, companies and money are fictional.')))));
  }

  briefing(run, day) {
    const g = this.game;
    const intro = DAY_INTROS[Math.min(day.day - 1, DAY_INTROS.length - 1)];
    const newApps = APPS.filter((a) => a.day === day.day && day.day > 1);
    const newScams = content.scenarios.filter((s) => (s.unlockDay || 1) === day.day);
    const newEvents = content.events.filter((e) => (e.minDay || 1) === day.day && e.type !== 'narrative');
    this.show(el('div.screen',
      el('div.panel.briefing',
        el('div.muted', 'GLOBAL SOLUTIONS PVT. LTD. — SHIFT BRIEFING'),
        el('div.day', `DAY ${day.day}`),
        el('div.quota-big', `QUOTA: ${money(day.quota)}`),
        el('p', intro),
        run.strikes ? el('p', { style: { color: 'var(--red)', fontWeight: 800 } }, `⚠️ You have ${run.strikes} strike${run.strikes > 1 ? 's' : ''}. Three strikes and you're fired.`) : null,
        newApps.length || newScams.length || newEvents.length ? el('div.unlocks',
          ...newScams.map((s) => el('div.unlock', `${s.icon || '📞'} New scam: ${s.name}`)),
          ...newApps.map((a) => el('div.unlock', `${a.icon} New app: ${a.name}`)),
          ...newEvents.map((e) => el('div.unlock', { style: { borderColor: 'rgba(255,77,77,.4)' } }, `⚠️ New hazard: ${e.name}`))) : null,
        day.day === 1 ? el('div.controls',
          el('div', '🎧 Calls ring at your desk. Press ', el('span.kbd', 'F'), ' to answer. Hold ', el('span.kbd', (settings.pttKey || 'KeyV').replace('Key', '')), ' and speak (or type and press Enter).'),
          el('div', '📈 Watch the ', el('b', 'Trust Meter'), '. Get remote access, find their personal details, then get paid. Collect payments in the ', el('b', 'Cashier'), ' app.'),
          el('div', '🖥️ ', el('span.kbd', 'Tab'), ' (or ', el('span.kbd', 'E'), ' on your monitor) opens and closes your PC. ', el('span.kbd', 'Esc'), ' pauses.'),
          el('div', '🔥 Disasters happen. Walk with ', el('span.kbd', 'WASD'), ', interact with ', el('span.kbd', 'E'), ', hide with ', el('span.kbd', 'C'), '.'),
          el('div', '🚩 Some callers are scambaiters. Spot them before they expose you.')) : null,
        el('div.row', { style: { justifyContent: 'center', marginTop: '10px' } },
          el('button.btn.ghost', { onclick: () => g.quitToMenu() }, 'Main menu'),
          el('button.btn.big.primary', { onclick: () => (unlockAudio(), this.hide(), g.startShift()) }, 'Start shift ▶')))));
  }

  /**
   * Pause menu: everything else is blurred/dimmed behind it (see body.paused in the
   * CSS). Arrow keys / mouse to pick, Enter to confirm, Esc to resume.
   */
  pause({ onSettings }) {
    const g = this.game;
    this.hidePause();
    const d = g.day;
    const items = [
      { label: 'Resume', icon: 'play', run: () => g.resume() },
      { label: 'Settings', icon: 'settings', run: () => onSettings() },
      { label: 'Controls', icon: 'keyboard', run: () => this.controls() },
      { label: 'Quit to main menu', icon: 'door', run: () => confirmQuit() },
    ];
    let sel = 0;
    const buttons = items.map((it, i) => el('button.pause-item', {
      onclick: () => (sfx('click'), it.run()),
      onmouseenter: () => setSel(i),
    }, icon(it.icon), el('span', it.label)));
    const setSel = (i) => {
      if (i !== sel) sfx('hover');
      sel = (i + items.length) % items.length;
      buttons.forEach((b, k) => b.classList.toggle('on', k === sel));
    };
    const confirmQuit = () => {
      const q = modal(el('div', el('h2', 'Quit to main menu?'), el('p.muted', g.phase === 'practice' ? 'The practice call will end.' : 'Today\'s progress is lost — your run is saved at the start of each day.'),
        el('div.row', { style: { justifyContent: 'flex-end', marginTop: '14px' } },
          el('button.btn.ghost', { onclick: () => q.close() }, 'Stay'),
          el('button.btn.danger', { onclick: () => (q.close(), g.quitToMenu()) }, 'Quit'))));
    };
    const quota = d ? Math.min(1, Math.max(0, d.earned) / d.quota) : 0;
    const call = g.calls?.active ? g.calls.caller : null;
    const status = d && g.phase !== 'practice'
      ? el('div.pause-status',
        el('div.ps-head', el('span', `DAY ${d.day}`), el('span', clockText(g.clock))),
        el('div.ps-row', el('span.muted', 'Quota'), el('b', `${money(Math.max(0, d.earned))} / ${money(d.quota)}`)),
        el('div.ps-bar', el('div', { style: { width: `${quota * 100}%` } })),
        el('div.ps-grid',
          el('div', el('b', String(d.callsTaken)), el('span', 'calls')),
          el('div', el('b', String(d.scamsWon)), el('span', 'scams')),
          el('div', el('b', String(d.missedCalls)), el('span', 'missed')),
          el('div', el('b', `${g.run?.strikes || 0}/3`), el('span', 'strikes'))),
        call ? el('div.ps-call', icon('phone'), el('span', 'On hold: ', el('b', call.name))) : null)
      : el('div.pause-status', el('div.ps-head', el('span', 'PRACTICE CALL')), el('p.muted', 'Nothing counts. Test your client as much as you like.'));
    this.pauseNode = el('div.screen.pause-screen',
      el('div.pause-left',
        el('div.pause-title', 'PAUSED'),
        el('div.pause-sub', 'The clock is stopped. The boss is not.'),
        el('div.pause-items', buttons),
        el('div.pause-hint', el('span.kbd', 'Esc'), ' resume   ', el('span.kbd', '↑'), el('span.kbd', '↓'), ' select   ', el('span.kbd', 'Enter'), ' confirm')),
      status);
    this.pauseKeys = (e) => {
      if (document.querySelector('.modal-back')) return;
      if (e.code === 'ArrowDown' || e.code === 'KeyS') (e.preventDefault(), setSel(sel + 1));
      else if (e.code === 'ArrowUp' || e.code === 'KeyW') (e.preventDefault(), setSel(sel - 1));
      else if (e.code === 'Enter' || e.code === 'Space') (e.preventDefault(), sfx('click'), items[sel].run());
    };
    document.addEventListener('keydown', this.pauseKeys);
    setSel(0);
    this.root.append(this.pauseNode);
  }

  hidePause() {
    this.pauseNode?.remove();
    this.pauseNode = null;
    if (this.pauseKeys) document.removeEventListener('keydown', this.pauseKeys);
    this.pauseKeys = null;
  }

  controls() {
    const key = (settings.pttKey || 'KeyV').replace('Key', '');
    const rows = [
      ['F', 'Answer the ringing phone'], [key, 'Hold to talk to the caller'], ['Enter', 'Type instead of talking'], ['Tab', 'Use / leave your computer'],
      ['WASD', 'Walk around the office'], ['E / Click', 'Interact (breakers, router, shredder…)'], ['C', 'Crouch — hide under your desk'], ['Shift', 'Run'], ['Esc', 'Pause'],
    ];
    modal(el('div', el('h2', 'Controls'), el('div.controls-list', rows.map(([k, t]) => el('div.ctl', el('span.kbd', k), el('span', t))))));
  }

  recap(recap) {
    if (!recap.caller) return;
    const c = recap.caller;
    const outcomes = {
      scammed: ['SCAMMED', 'var(--green-2)', 'money'],
      caller_hung_up: ['They hung up', 'var(--orange)', 'phone-off'],
      out_of_patience: ['They lost patience', 'var(--orange)', 'hourglass'],
      agent_hung_up: ['You hung up', 'var(--muted)', 'phone-off'],
      exposed: ['EXPOSED by a scambaiter', 'var(--red)', 'video'],
      flagged: ['Scambaiter caught!', 'var(--green-2)', 'flag'],
      wrong_flag: ['Wrongly accused a real victim', 'var(--red)', 'x'],
      shift_over: ['Shift ended mid-call', 'var(--muted)', 'clock5'],
      power: ['Call dropped (power cut)', 'var(--orange)', 'zap-off'],
    };
    const [label, color, ic] = outcomes[recap.outcome] || outcomes[recap.reason] || [recap.outcome, 'var(--muted)', 'phone'];
    const content2 = el('div.recap-card',
      el('div.head', el('img', { src: portraitFor(c, recap.paid > 0 ? 'sad' : recap.outcome === 'exposed' ? 'happy' : 'neutral'), style: { width: '76px', borderRadius: '14px' } }),
        el('div', el('div', { style: { fontWeight: 900, fontSize: '18px' } }, c.name), el('div.recap-outcome', { style: { color } }, icon(ic), label), el('div.muted', `${Math.floor(recap.duration / 60)}m ${Math.floor(recap.duration % 60)}s • final trust ${Math.round(recap.trust)} • ${recap.turns} exchanges`))),
      recap.paid ? el('p', { style: { fontSize: '18px' } }, '💸 They sent ', el('b', money(recap.paid)), '. Collect it in the Cashier app.') : null,
      recap.fakePaid ? el('p', { style: { color: 'var(--red)' } }, `🚫 ${money(recap.fakePaid)} of their "payments" are fake.`) : null,
      recap.isBaiter && recap.outcome !== 'flagged' ? el('p', { style: { color: 'var(--yellow)' } }, `🎥 Plot twist: ${c.firstName} was a scambaiter (${c.baiter?.channel || 'streaming'}).`) : null,
      settings.showCallerThoughts && recap.thoughts.length ? el('div', el('h3', 'What they were secretly thinking'), el('div.thoughts', recap.thoughts.map((t) => el('div', `“${t}”`)))) : null,
      el('div.row', { style: { justifyContent: 'flex-end', marginTop: '14px' } }, el('button.btn.primary', { onclick: () => m.close() }, recap.sandbox ? 'Done' : 'Back to work')));
    const m = modal(content2, {
      onClose: () => {
        if (recap.sandbox) bus.emit('practice:done');
        else if (this.game.playing && !this.game.computerOpen) this.game.world.player.requestLock();
      },
    });
    this.game.world.player.releaseLock();
  }

  gameOver(run, report) {
    const g = this.game;
    this.show(el('div.screen',
      el('div.panel.gameover',
        el('div.big', "YOU'RE FIRED"),
        el('p', `Mr. Chatterjee has personally escorted you out, along with your chair.`),
        el('h3', 'Your career'),
        el('p', `Survived ${run.day} day${run.day > 1 ? 's' : ''} • Total scammed ${money(run.totalEarned)} • Final cut ${money(run.wallet)}`),
        el('div', (run.history || []).map((h) => el('div.muted', `Day ${h.day}: ${money(h.earned)} / ${money(h.quota)} — ${h.verdict}`))),
        el('div.row', { style: { justifyContent: 'center', marginTop: '16px' } },
          el('button.btn.ghost', { onclick: () => g.quitToMenu() }, 'Main menu'),
          el('button.btn.big.primary', { onclick: () => g.newRun() }, 'New run')))));
    void report;
  }

  credits() {
    modal(el('div',
      el('h2', 'Credits'),
      el('p', 'A single-player parody inspired by the co-op game "Scam With Your Friends". All assets here are original or openly licensed.'),
      el('h3', '3D models'),
      el('p', 'Kenney (kenney.nl) — Furniture Kit, Mini Characters, Car Kit, Cube Pets, Food Kit. CC0 / public domain.'),
      el('h3', 'Portraits'),
      el('p', 'Avataaars by Pablo Stanley, via DiceBear (free for personal & commercial use).'),
      el('h3', 'Icons'),
      el('p', 'Lucide (ISC). App icons: Fluent UI System Color Icons by Microsoft (MIT) and Flat Color Icons by Icons8 (MIT), via Iconify.'),
      el('h3', 'Fonts'),
      el('p', 'Bungee, Inter, VT323, Permanent Marker — SIL Open Font License, via Fontsource.'),
      el('h3', 'AI'),
      el('p', 'Groq: openai/gpt-oss-20b (callers, boss, coworkers), canopylabs/orpheus-v1-english (voices), whisper-large-v3 (speech to text).'),
      el('h3', 'Engine'),
      el('p', 'three.js + Vite. Sound effects and music are synthesized live in WebAudio.'),
    ));
  }
}
