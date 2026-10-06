// Full-screen UI: loading, main menu, briefing, pause, call recap, game over, credits.
import { el, money } from '../core/util.js';
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
    const btn = (label, icon, onclick, cls = '', extra = null) => el(`button.btn.big${cls}`, { onclick: () => (unlockAudio(), sfx('click'), onclick()) }, el('span', `${icon} ${label}`), extra);
    const m = meta.data;
    this.show(el('div.screen', { style: { background: 'radial-gradient(ellipse at 30% 40%, rgba(8,20,14,.25), rgba(0,0,0,.78))' } },
      el('div.menu',
        el('div', this.logo(1), el('div.stats', m.runs ? `Best run: Day ${m.bestDay || 0} • Lifetime scammed: ${money(m.totalScammed || 0)} • Scambaiters caught: ${m.baitersCaught || 0}` : 'Run a scam call center. Trick AI callers. Survive the boss.')),
        el('div.buttons',
          hasSave ? btn('Continue run', '▶️', () => g.continueRun(), '.primary') : null,
          btn(hasSave ? 'New run' : 'Start shift', '📞', () => g.newRun(), hasSave ? '' : '.primary'),
          el('button.btn.big', { disabled: true, title: 'Online co-op is coming soon!' }, el('span', '👥 Multiplayer'), el('span.badge.yellow', 'Coming soon')),
          btn('Custom Clients', '🧑‍🎨', onClients),
          btn('Mods', '🧩', onMods),
          btn('Settings', '⚙️', onSettings),
          btn('Credits', '📜', () => this.credits()),
          hasApiKey() ? null : el('div.keywarn', '⚠️ No Groq API key yet — callers will use a dumb offline brain and browser voices. Add your key in ', el('a', { href: '#', style: { color: 'var(--yellow)' }, onclick: (e) => (e.preventDefault(), onSettings()) }, 'Settings'), ' for real AI conversations.')),
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
          el('div', '🖥️ ', el('span.kbd', 'Tab'), ' or ', el('span.kbd', 'E'), ' on your monitor opens your PC. ', el('span.kbd', 'Esc'), ' gets up.'),
          el('div', '🔥 Disasters happen. Walk with ', el('span.kbd', 'WASD'), ', interact with ', el('span.kbd', 'E'), ', hide with ', el('span.kbd', 'C'), '.'),
          el('div', '🚩 Some callers are scambaiters. Spot them before they expose you.')) : null,
        el('div.row', { style: { justifyContent: 'center', marginTop: '10px' } },
          el('button.btn.ghost', { onclick: () => g.quitToMenu() }, 'Main menu'),
          el('button.btn.big.primary', { onclick: () => (unlockAudio(), this.hide(), g.startShift()) }, 'Start shift ▶')))));
  }

  pause({ onSettings }) {
    const g = this.game;
    this.show(el('div.screen',
      el('div.panel', { style: { width: 'min(420px, 100%)', textAlign: 'center' } },
        el('h2', 'Paused'),
        el('p.muted', 'The clock is stopped. The boss is not.'),
        el('div.col',
          el('button.btn.big.primary', { onclick: () => (this.hide(), g.resume()) }, 'Resume'),
          el('button.btn', { onclick: onSettings }, '⚙️ Settings'),
          el('button.btn.ghost', { onclick: () => (this.hide(), g.quitToMenu()) }, 'Quit to menu (progress saved at start of day)')))));
  }

  recap(recap) {
    if (!recap.caller) return;
    const c = recap.caller;
    const outcomes = {
      scammed: ['💰 SCAMMED', 'var(--green-2)'],
      caller_hung_up: ['📵 They hung up', 'var(--orange)'],
      out_of_patience: ['⏳ They lost patience', 'var(--orange)'],
      agent_hung_up: ['☎️ You hung up', 'var(--muted)'],
      exposed: ['🔴 EXPOSED by a scambaiter', 'var(--red)'],
      flagged: ['🚩 Scambaiter caught!', 'var(--green-2)'],
      wrong_flag: ['❌ Wrongly accused a real victim', 'var(--red)'],
      shift_over: ['🕔 Shift ended mid-call', 'var(--muted)'],
      power: ['⚡ Call dropped (power cut)', 'var(--orange)'],
    };
    const [label, color] = outcomes[recap.outcome] || outcomes[recap.reason] || [recap.outcome, 'var(--muted)'];
    const content2 = el('div.recap-card',
      el('div.head', el('img', { src: portraitFor(c, recap.paid > 0 ? 'sad' : recap.outcome === 'exposed' ? 'happy' : 'neutral'), style: { width: '76px', borderRadius: '14px' } }),
        el('div', el('div', { style: { fontWeight: 900, fontSize: '18px' } }, c.name), el('div', { style: { color, fontWeight: 900, fontSize: '20px' } }, label), el('div.muted', `${Math.floor(recap.duration / 60)}m ${Math.floor(recap.duration % 60)}s • final trust ${Math.round(recap.trust)} • ${recap.turns} exchanges`))),
      recap.paid ? el('p', { style: { fontSize: '18px' } }, '💸 They sent ', el('b', money(recap.paid)), '. Collect it in the Cashier app.') : null,
      recap.fakePaid ? el('p', { style: { color: 'var(--red)' } }, `🚫 ${money(recap.fakePaid)} of their "payments" are fake.`) : null,
      recap.isBaiter && recap.outcome !== 'flagged' ? el('p', { style: { color: 'var(--yellow)' } }, `🎥 Plot twist: ${c.firstName} was a scambaiter (${c.baiter?.channel || 'streaming'}).`) : null,
      settings.showCallerThoughts && recap.thoughts.length ? el('div', el('h3', '🧠 What they were secretly thinking'), el('div.thoughts', recap.thoughts.map((t) => el('div', `“${t}”`)))) : null,
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
      el('h3', 'Fonts'),
      el('p', 'Bungee, Inter, VT323, Permanent Marker — SIL Open Font License, via Fontsource.'),
      el('h3', 'AI'),
      el('p', 'Groq: openai/gpt-oss-20b (callers, boss, coworkers), canopylabs/orpheus-v1-english (voices), whisper-large-v3 (speech to text).'),
      el('h3', 'Engine'),
      el('p', 'three.js + Vite. Sound effects are synthesized in WebAudio.'),
    ));
  }
}
