// Entry point: load fonts + content + 3D office, then wire the UI to the game.
import '@fontsource/bungee';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import '@fontsource/inter/900.css';
import '@fontsource/vt323';
import '@fontsource/permanent-marker';
import './styles.css';

import { world } from './world/world.js';
import { game } from './game/game.js';
import { loadContent, content, prepareCaller } from './game/content.js';
import { Screens } from './ui/screens.js';
import { HUD } from './ui/hud.js';
import { CallPanel } from './ui/callPanel.js';
import { Computer } from './ui/computer.js';
import { initDialogs, toast } from './ui/dialog.js';
import { openSettings } from './ui/settings.js';
import { openClientMaker } from './ui/clientMaker.js';
import { openMods } from './ui/mods.js';
import { showReview } from './ui/review.js';
import { showShop } from './ui/shop.js';
import { bindChatStore } from './ui/os/apps.js';
import { bus } from './core/bus.js';
import { unlockAudio } from './core/audio.js';
import { typingInField, clockText, el } from './core/util.js';
import { settings } from './core/store.js';

async function boot() {
  const ui = document.getElementById('ui');
  const canvas = document.getElementById('world');
  const screens = new Screens(ui, game);
  const loading = screens.loading();
  initDialogs(ui);

  // canvas textures (posters, TV, signs) need the fonts first
  await Promise.race([
    Promise.all(['40px Bungee', 'bold 20px Inter', '400 20px Inter', '20px "Permanent Marker"', '20px VT323'].map((f) => document.fonts.load(f))),
    new Promise((r) => setTimeout(r, 4000)),
  ]).catch(() => {});

  loading.progress(0.05, 'Loading callers, scams and mods…');
  await loadContent();
  loading.progress(0.1, 'Building the office…');
  await world.init(canvas, (p) => loading.progress(0.1 + p * 0.8, `Loading 3D models… ${Math.round(p * 100)}%`));
  loading.progress(1, 'Baking lights…');

  game.init();
  const hud = new HUD(ui, game);
  const callPanel = new CallPanel(ui, game);
  const computer = new Computer(ui, game);
  bindChatStore(game);
  void callPanel;

  const openMaker = () => openClientMaker({
    onTestCall: (def) => {
      screens.hide();
      game.startPractice(def);
    },
  });
  const showMenu = () => screens.menu({
    onSettings: () => openSettings({ onClose: () => game.phase === 'menu' && showMenu() }),
    onClients: openMaker,
    onMods: () => openMods({ onClose: () => game.phase === 'menu' && showMenu() }),
  });

  game.ui = {
    showMenu,
    showBriefing: (run, day) => {
      computer.newDay();
      screens.briefing(run, day);
    },
    showHUD: (on, opts) => hud.show(on, opts),
    showRecap: (recap) => screens.recap(recap),
    showReview: (report) => showReview(screens, game, report),
    showShop: (run, commission) => showShop(screens, game, run, commission),
    showGameOver: (run, report) => screens.gameOver(run, report),
    showPause: () => screens.pause({ onSettings: () => openSettings() }),
    openComputer: () => {
      computer.open();
      hud.setComputerMode(true);
      document.body.classList.add('pc-open');
    },
    closeComputer: () => {
      computer.close();
      hud.setComputerMode(false);
      document.body.classList.remove('pc-open');
    },
  };

  bus.on('practice:done', () => {
    game.quitToMenu();
    openMaker();
  });
  bus.on('flash', () => {
    const f = el('div.flash');
    ui.append(f);
    setTimeout(() => f.remove(), 700);
  });
  bus.on('ai:error', (err) => {
    if (err.status === 401) toast('🔑 Groq rejected your API key. Check it in Settings.', 'bad', 6000);
  });

  // per-frame UI sync (throttled)
  let acc = 0;
  world.onUpdate((dt) => {
    acc += dt;
    if (acc < 0.2) return;
    acc = 0;
    hud.update();
    computer.desktop?.setClock(game.clock);
    if (game.day && game.phase === 'playing') {
      world.office.updateBoard({
        day: game.day.day,
        time: clockText(game.clock),
        earned: Math.max(0, game.day.earned),
        quota: game.day.quota,
        calls: game.day.callsTaken,
        alert: game.chaos.active ? game.chaos.active.def.name.toUpperCase() : game.calls.state === 'ringing' ? '📞 PHONE RINGING' : '',
      });
    }
  });
  const updateScreen = () => {
    if (game.powerOut) return;
    if (game.calls.active) world.office.setPlayerScreen({ kind: 'desktop', text: `📞 ${game.calls.caller.name}`, trust: game.calls.conv.trust });
    else if (game.calls.state === 'ringing') world.office.setPlayerScreen({ kind: 'desktop', text: '📞 INCOMING CALL!' });
    else world.office.setPlayerScreen({ kind: game.virus ? 'virus' : 'desktop' });
  };
  ['call:ring', 'call:start', 'call:update', 'call:end', 'call:missed', 'computer:virus', 'computer:power'].forEach((e) => bus.on(e, updateScreen));

  // keyboard
  document.addEventListener('keydown', (e) => {
    if (typingInField()) return;
    if (e.code === 'Escape') {
      if (document.querySelector('.modal-back')) return;
      if (game.computerOpen) game.closeComputer();
      else if (game.paused) {
        screens.hide();
        game.resume();
      } else if (game.playing && !document.querySelector('.screen')) game.pause();
    }
    if (e.code === 'Tab' && game.playing && !game.paused) {
      e.preventDefault();
      if (game.computerOpen) game.closeComputer();
      else {
        const seat = world.office.playerSeat.pos;
        const p = world.player.pos;
        if (Math.hypot(p.x - seat.x, p.z - seat.z) < 2.6) {
          if (world.player.mode !== 'seated') world.player.sitAtDesk();
          game.openComputer();
        } else toast('🖥️ Walk back to your desk to use your computer.');
      }
    }
  });
  window.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('keydown', unlockAudio, { once: true });

  // handy for debugging from the browser console
  window.__game = game;
  window.__world = world;
  window.__ui = { computer, screens, hud };
  window.__debug = { content, prepareCaller };
  screens.hide();
  showMenu();
  document.title = 'Scam Call Center';
  document.body.dataset.ready = '1';
  if (settings.apiKey) console.info('Groq key present — real AI callers enabled.');
}

boot().catch((err) => {
  console.error(err);
  document.getElementById('ui').append(el('div.screen', el('div.panel', el('h2', 'Something broke while loading'), el('pre.code', String(err?.stack || err)))));
});
