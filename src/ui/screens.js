// Full-screen UI: loading, main menu, briefing, pause, call recap, game over, credits.
import { el, money, clockText } from '../core/util.js';
import { icon } from './icons.js';
import { settings, hasApiKey, meta, VERSION } from '../core/store.js';
import { unlockAudio, sfx } from '../core/audio.js';
import { DAY_INTROS, APPS } from '../game/progression.js';
import { content } from '../game/content.js';
import { portraitFor } from './portraits.js';
import { modal } from './dialog.js';
import { bus } from '../core/bus.js';
import { net } from '../net/net.js';

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

  menu({ onSettings, onClients, onMods, onMultiplayer }) {
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
          btn('Multiplayer', 'users', onMultiplayer, '', el('span.badge.green', 'Online')),
          btn('Custom Clients', 'contact', onClients),
          btn('Mods', 'puzzle', onMods),
          btn('Settings', 'settings', onSettings),
          btn('Credits', 'scroll', () => this.credits()),
          hasApiKey() ? null : el('div.keywarn', icon('warn'), el('span', 'No Groq API key yet — callers use a simple offline brain and browser voices. Add a free key in ', el('a', { href: '#', onclick: (e) => (e.preventDefault(), onSettings()) }, 'Settings'), ' for real AI conversations.'))),
        el('div.footer', el('span', `${content.callers.length} callers • ${content.scenarios.length} scams • ${content.events.length} events loaded${content.customClients.length ? ` • ${content.customClients.length} custom clients` : ''}`), el('span', 'A parody game. All callers, companies and money are fictional.'))),
      el('div.version', VERSION)));
  }

  briefing(run, day) {
    const g = this.game;
    const intro = DAY_INTROS[Math.min(day.day - 1, DAY_INTROS.length - 1)];
    const newScams = content.scenarios.filter((s) => (s.unlockDay || 1) === day.day);
    const newEvents = content.events.filter((e) => (e.minDay || 1) === day.day && e.type !== 'narrative');
    this.show(el('div.screen',
      el('div.panel.briefing',
        el('div.muted', 'GLOBAL SOLUTIONS PVT. LTD. — SHIFT BRIEFING'),
        el('div.day', `DAY ${day.day}`),
        el('div.quota-big', `QUOTA: ${money(day.quota)}`),
        el('p', intro),
        run.strikes ? el('p', { style: { color: 'var(--red)', fontWeight: 800 } }, `⚠️ You have ${run.strikes} strike${run.strikes > 1 ? 's' : ''}. Three strikes and you're fired.`) : null,
        newScams.length || newEvents.length ? el('div.unlocks',
          ...newScams.map((s) => el('div.unlock', `${s.icon || '📞'} New scam: ${s.name}`)),
          ...newEvents.map((e) => el('div.unlock', { style: { borderColor: 'rgba(255,77,77,.4)' } }, `⚠️ New hazard: ${e.name}`))) : null,
        day.day === 1 ? el('div.controls',
          el('div', '🎧 Calls ring at your desk. Press ', el('span.kbd', 'F'), ' to answer. Hold ', el('span.kbd', (settings.pttKey || 'KeyV').replace('Key', '')), ' and speak (or type and press Enter).'),
          el('div', '📈 Watch the ', el('b', 'Trust Meter'), '. Once they trust you, get them to read you a code — a gift card code, card verification code, or ID number.'),
          el('div', '💳 Type that code into the matching app (', el('b', 'Gift Cards'), ', ', el('b', 'Credit Card'), ' or ', el('b', 'Identity'), ') and hit Verify to get paid. Enter it before the shift ends or the money is lost.'),
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
      ['WASD', 'Walk around the office'], ['Space', 'Jump'], ['Shift', 'Sprint (uses stamina)'], ['E / Click', 'Interact (breakers, router, shredder…)'], ['C', 'Crouch — hide under your desk'],
      ['1–9', 'Equip a Scamazon tool'], ['F', 'Swing the equipped tool'], ['Esc', 'Pause'],
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
      recap.paid ? el('p', { style: { fontSize: '18px' } }, '💸 They read you codes worth ', el('b', money(recap.paid)), '. Enter them in the Gift Cards / Credit Card / Identity apps before the shift ends.') : null,
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
    const total = Math.round(run.totalEarned || 0);
    const days = Math.max(1, run.day || 1);
    const avg = Math.round(total / days);
    // in co-op, rank the real team by what each player personally scammed
    let board;
    if (g.mp && net.active) {
      board = net.rosterList().map((p) => ({ name: p.name + (p.you ? ' (You)' : ''), earned: Math.round(p.personal || 0), you: p.you })).sort((a, b) => b.earned - a.earned);
    } else {
      const coworkers = [
        { name: 'Ahmed', mult: 1.35 }, { name: 'JakeHub', mult: 1.12 }, { name: 'Hypercat', mult: 0.92 },
        { name: 'Priya "Jennifer"', mult: 0.8 }, { name: 'Raju "Kevin"', mult: 0.66 }, { name: 'Vikram "Brad"', mult: 0.4 },
      ];
      const seed = total + days * 97;
      board = [
        { name: `${g.run?.alias ? g.run.alias.replace(/"/g, '') : 'You'} (You)`, earned: total, you: true },
        ...coworkers.map((c, i) => ({ name: c.name, earned: Math.max(200, Math.round((total || 1200) * c.mult * (0.9 + ((seed * (i + 3)) % 20) / 100) / 50) * 50) })),
      ].sort((a, b) => b.earned - a.earned);
    }
    const leader = board[0].earned;
    this.show(el('div.screen.fired-screen',
      el('div.panel.termination',
        el('div.term-head',
          el('div', el('div.term-sub', 'KOLKATA TERMINATION REPORT'), el('div.term-big', "YOU'RE FIRED"), el('p.muted', { style: { margin: '6px 0 0' } }, 'Your complete employment record, ranked against the rest of the call floor.')),
          el('div.term-haul', el('div.term-days', `${days} DAY${days > 1 ? 'S' : ''}`), el('div.muted', 'DAYS WORKED'), el('div.term-total', money(total)), el('div.muted', 'TOTAL SCAMMED'))),
        el('div.term-cols', el('span', 'RANK'), el('span', { style: { flex: 1 } }, 'FORMER EMPLOYEE'), el('span', 'TOTAL EARNED'), el('span', 'AVG / DAY')),
        el('div.term-rows', ...board.map((b, i) => el(`div.term-row${b.you ? '.you' : ''}${i === 0 ? '.first' : ''}`,
          el('div.term-rank', `#${i + 1}`),
          el('div.term-emp', el('b', b.name), el('div.term-note', i === 0 ? 'TOP EARNER' : `${money(leader - b.earned)} behind the leader`), el('div.term-bar', el('div', { style: { width: `${Math.round((b.earned / leader) * 100)}%` } }))),
          el('div.term-earned', money(b.earned)),
          el('div.term-avg', money(Math.round(b.earned / days)))))),
        el('div.row', { style: { justifyContent: 'center', marginTop: '16px' } },
          el('button.btn.ghost', { onclick: () => g.quitToMenu() }, 'Main menu'),
          el('button.btn.big.primary', { onclick: () => g.newRun() }, 'New run')))));
    void report;
    void avg;
  }

  credits() {
    const sec = (ic, title, lines) => el('div.cred-sec', el('div.cred-h', icon(ic), title), ...lines.map((l) => el('div.cred-line', l)));
    modal(el('div.credits',
      el('div.cred-top', this.logo(0.5)),
      el('p.muted', { style: { textAlign: 'center', marginTop: '-6px' } }, 'A single-player + LAN co-op parody inspired by "Scam With Your Friends". Everything here is original or openly licensed.'),
      el('div.cred-grid',
        sec('bot', 'AI (Groq)', ['openai/gpt-oss — callers, boss & coworkers', 'canopylabs/orpheus — voices', 'whisper-large-v3 — your microphone']),
        sec('gamepad', 'Engine', ['three.js + Vite (MIT)', 'Sound effects & music synthesized live in WebAudio', 'ws — LAN co-op server']),
        sec('user', '3D models', ['Kenney (kenney.nl) — Furniture, Mini Characters,', 'Car, Cube Pets & Food kits. CC0 / public domain.']),
        sec('image', 'Icons', ['Lucide (ISC)', 'Fluent UI System Color Icons — Microsoft (MIT)', 'Flat Color Icons — Icons8 (MIT)']),
        sec('contact', 'Portraits', ['Avataaars by Pablo Stanley,', 'via DiceBear (free for any use)']),
        sec('type', 'Fonts', ['Bungee, Inter, VT323, Permanent Marker', 'SIL Open Font License, via Fontsource'])),
      el('p.cred-foot', VERSION, ' · A parody. All callers, companies and money are fictional.')), { className: 'credits-modal' });
  }
}
