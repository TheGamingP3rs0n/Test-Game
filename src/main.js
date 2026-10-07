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
import './ui/icons.js';

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
import { openMultiplayer, initCoop } from './ui/multiplayer.js';
import { showReview } from './ui/review.js';
import { showShop } from './ui/shop.js';
import { bindChatStore } from './ui/os/apps.js';
import { bus } from './core/bus.js';
import { unlockAudio } from './core/audio.js';
import { music } from './core/music.js';
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
  await world.init(canvas, (p, label) => loading.progress(0.1 + p * 0.9, label));
  loading.progress(1, 'Ready');

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
  const showMenu = () => {
    music.play('menu');
    screens.menu({
      onSettings: () => openSettings({ onClose: () => game.phase === 'menu' && showMenu() }),
      onClients: openMaker,
      onMods: () => openMods({ onClose: () => game.phase === 'menu' && showMenu() }),
      onMultiplayer: () => openMultiplayer(screens, game, { onClose: () => game.phase === 'menu' && showMenu() }),
    });
  };
  initCoop(game);

  game.ui = {
    showMenu,
    hideScreens: () => screens.hide(),
    showBriefing: (run, day) => {
      computer.newDay();
      screens.briefing(run, day);
    },
    showHUD: (on, opts) => hud.show(on, opts),
    showRecap: (recap) => screens.recap(recap),
    showReview: (report) => showReview(screens, game, report),
    showShop: (run, commission) => showShop(screens, game, run, commission),
    showGameOver: (run, report) => screens.gameOver(run, report),
    showPause: () => screens.pause({ onSettings: () => openSettings(), hud }),
    hidePause: () => screens.hidePause(),
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
  // big green +$ money popup (juice)
  bus.on('money:popup', ({ amount }) => {
    if (!amount) return;
    const pop = el('div.money-pop', `+$${Math.abs(Math.round(amount)).toLocaleString()}`);
    ui.append(pop);
    setTimeout(() => pop.remove(), 1500);
  });
  bus.on('ai:error', (err) => {
    if (err.status === 401) toast('Groq rejected your API key. Check it in Settings.', 'bad', 6000, { icon: 'key', title: 'API key problem' });
  });
  // music: quieter under calls, normal otherwise
  bus.on('call:start', () => music.setDuck(0.3));
  bus.on('call:end', () => music.setDuck(1));
  bus.on('call:missed', () => music.setDuck(1));

  // per-frame UI sync (throttled)
  let acc = 0;
  world.onUpdate((dt) => {
    acc += dt;
    if (acc < 0.2) return;
    acc = 0;
    hud.update();
    computer.desktop?.setClock(game.clock);
    if (game.day && game.phase === 'playing') computer.desktop?.setStatus({ earned: Math.max(0, game.day.earned), quota: game.day.quota });
    if (game.day && game.phase === 'playing') {
      world.office.updateBoard({
        day: game.day.day,
        time: clockText(game.clock),
        earned: Math.max(0, game.day.earned),
        quota: game.day.quota,
        calls: game.day.callsTaken,
        alert: game.chaos.active ? game.chaos.active.def.name.toUpperCase() : game.calls.state === 'ringing' ? 'PHONE RINGING' : '',
      });
    }
  });
  const updateScreen = () => {
    if (game.powerOut) return;
    if (game.calls.active) world.office.setPlayerScreen({ kind: 'desktop', text: game.calls.caller.name, trust: game.calls.conv.trust });
    else if (game.calls.state === 'ringing') world.office.setPlayerScreen({ kind: 'desktop', text: 'INCOMING CALL', ringing: true });
    else world.office.setPlayerScreen({ kind: game.virus ? 'virus' : 'desktop' });
  };
  ['call:ring', 'call:start', 'call:update', 'call:end', 'call:missed', 'computer:virus', 'computer:power'].forEach((e) => bus.on(e, updateScreen));

  // keyboard: ONE press of Esc pauses. (While the mouse is captured the browser keeps
  // the Esc key to itself and just releases the mouse — so losing the mouse capture
  // during play is treated as that Esc press.)
  const canPause = () => game.playing && !game.paused && !document.querySelector('.modal-back') && !document.querySelector('.screen:not(.pause-screen)');
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
      if (document.querySelector('.modal-back')) return;
      if (typingInField()) {
        document.activeElement.blur();
        return;
      }
      if (game.paused) game.resume();
      else if (canPause()) game.pause();
      return;
    }
    if (typingInField()) return;
    if (e.code === 'Tab' && game.playing && !game.paused) {
      e.preventDefault();
      if (game.computerOpen) game.closeComputer();
      else {
        const seat = world.office.playerSeat.pos;
        const p = world.player.pos;
        if (Math.hypot(p.x - seat.x, p.z - seat.z) < 2.6) {
          if (world.player.mode !== 'seated') world.player.sitAtDesk();
          game.openComputer();
        } else toast('Walk back to your desk to use your computer.', 'info', 3000, { icon: 'monitor' });
      }
    }
  });
  bus.on('player:lock', (locked, info = {}) => {
    if (!locked && info.lost && world.mode === 'play' && canPause()) game.pause();
  });
  // browsers only allow sound after a click/keypress
  const firstGesture = () => {
    unlockAudio();
    if (game.phase === 'menu') music.play('menu');
  };
  window.addEventListener('pointerdown', firstGesture, { once: true });
  window.addEventListener('keydown', firstGesture, { once: true });

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
