// Your work PC: the monitor overlay hosting the "Windoze XD" desktop and its apps.
// Also handles power cuts (no signal), viruses (pop-up storm), and files sent by callers.
import { el, pick } from '../core/util.js';
import { bus } from '../core/bus.js';
import { sfx } from '../core/audio.js';
import { Desktop } from './os/os.js';
import { APPS } from '../game/progression.js';
import { buildApps } from './os/apps.js';

const VIRUS_POPUPS = [
  ['⚠️ CONGRATULATIONS!!', 'You are the 1,000,000th visitor! Click to claim your FREE iPad!!'],
  ['☠️ SYSTEM HACKED', 'All your files are belong to us. Send 0.5 BTC to unlock.'],
  ['🔥 HOT SINGLES', 'Hot singles in Kolkata want to discuss your car\'s extended warranty.'],
  ['📞 CALL TECH SUPPORT', 'Your PC has 37 viruses. Call +1-866-555-0123 immediately! (wait...)'],
  ['🐒 BONZI BUDDY', 'Hi! I\'m your new best friend! I\'ll be reading your passwords now.'],
  ['💊 DOWNLOAD MORE RAM', 'Your PC only has 4GB. Download 64GB more, totally free.'],
  ['😈 GRANDMA GETS EVEN', 'Thanks for opening my file! Say hi to chat 👋'],
];

export class Computer {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    this.desktop = null;
    this.wrap = null;
    this.popupTimer = null;
    bus.on('computer:power', (on) => this.setPower(on));
    bus.on('computer:virus', (on) => this.setVirus(on));
    bus.on('call:file', (file) => this.incomingFile(file));
    bus.on('call:remote', ({ code }) => this.desktop?.notify(`🖥️ Remote session ready. ID ${code}`, { actions: [{ label: 'Open RemoteHelp', primary: true, onClick: () => this.desktop.open('remote') }] }));
    bus.on('call:payment', (p) => this.desktop?.notify(`💸 Incoming ${p.method.replace(/_/g, ' ')} from ${p.from}: $${p.amount.toLocaleString()}`, { actions: [{ label: 'Open Cashier', primary: true, onClick: () => this.desktop.open('cashier') }] }));
    bus.on('chat:message', (m) => {
      if (this.wrap?.isConnected && !this.desktop.windows.has('messenger')) this.desktop.notify(`💬 ${m.from === 'boss' ? 'BOSS' : m.from[0].toUpperCase() + m.from.slice(1)}: ${m.text}`, { ms: 4000 });
    });
    bus.on('callpanel:visible', (v) => this.wrap?.classList.toggle('nocall', !v));
  }

  /** Build a fresh desktop for the day (apps unlock as days progress). */
  newDay() {
    this.desktop?.closeAll();
    const unlocked = new Set(this.game.day?.apps || APPS.map((a) => a.id));
    const apps = buildApps({ game: this.game, computer: this });
    const locked = new Set(APPS.filter((a) => !unlocked.has(a.id)).map((a) => a.id));
    this.desktop = new Desktop({
      theme: 'player',
      apps,
      icons: APPS.map((a) => a.id),
      locked,
      user: `${this.game.run?.alias || 'Agent "Steve"'}`,
      wallpaperText: 'GLOBAL<br>SOLUTIONS<br><span style="font-size:18px">pvt. ltd.</span>',
      onStartAction: () => this.game.closeComputer(),
    });
    this.monitor = el('div.monitor', this.desktop.root, el('div.power-led'));
    this.wrap = el('div.os-wrap', this.monitor);
    this.wrap.addEventListener('mousedown', (e) => e.target === this.wrap && this.game.closeComputer());
  }

  open() {
    if (!this.desktop) this.newDay();
    this.wrap.classList.toggle('nocall', this.game.calls.state === 'idle');
    this.root.append(this.wrap);
    this.setPower(!this.game.powerOut);
    if (this.game.virus) this.setVirus(true);
    sfx('click');
    bus.emit('computer:opened');
  }

  close() {
    this.wrap?.remove();
  }

  get isOpen() {
    return !!this.wrap?.isConnected;
  }

  setPower(on) {
    if (!this.desktop) return;
    this.desktop.root.querySelector('.os-off')?.remove();
    if (!on) this.desktop.root.append(el('div.os-off', el('div', { style: { textAlign: 'center' } }, 'NO SIGNAL', el('div', { style: { fontSize: '16px', marginTop: '8px' } }, '⚡ Power is out — fix the breakers (west wall)'))));
    this.monitor?.querySelector('.power-led')?.style.setProperty('background', on ? '#3f6' : '#300');
  }

  setVirus(on) {
    clearInterval(this.popupTimer);
    if (!this.desktop) return;
    if (!on) {
      this.desktop.root.querySelectorAll('.popup-virus').forEach((p) => p.remove());
      return;
    }
    const spawn = () => {
      if (!this.game.virus) return clearInterval(this.popupTimer);
      const [t, m] = pick(VIRUS_POPUPS);
      const rect = this.desktop.root.getBoundingClientRect();
      const p = el('div.popup-virus', { style: { left: `${Math.random() * Math.max(50, rect.width - 260)}px`, top: `${Math.random() * Math.max(50, rect.height - 180)}px` } },
        el('div.bar', el('span', t), el('button', { onclick: () => (p.remove(), sfx('click')) }, '✕')),
        el('div.content', m, el('div', { style: { marginTop: '8px' } }, el('button.xp-btn', { onclick: () => { p.remove(); spawn(); spawn(); } }, 'OK'))));
      this.desktop.root.append(p);
      sfx('popup');
      if (this.desktop.root.querySelectorAll('.popup-virus').length > 14) this.desktop.root.querySelector('.popup-virus')?.remove();
    };
    for (let i = 0; i < 4; i++) spawn();
    this.popupTimer = setInterval(spawn, 2200);
  }

  incomingFile(file) {
    const show = () => {
      if (!this.desktop) this.newDay();
      const box = el('div.incoming-file', el('div.box', el('div.t', '📎 File received'), el('div.c',
        el('div', `${file.from} sent you `, el('b', file.name)),
        el('div', { style: { fontSize: '12px', color: '#555' } }, 'Windoze SmartScreen: This file is probably fine. Probably.'),
        el('div.row', { style: { justifyContent: 'flex-end' } },
          el('button.xp-btn', { onclick: () => { box.remove(); bus.emit('toast', { text: `🗑️ Deleted ${file.name}. Smart.` }); this.game.calls.conv?.event(`[SCREEN] The agent deleted the file you sent (${file.name}) without opening it.`); } }, 'Delete'),
          el('button.xp-btn.primary', { onclick: () => { box.remove(); this.game.calls.infected(file.name); } }, 'Open')))));
      this.desktop.root.append(box);
    };
    if (this.isOpen) show();
    else {
      bus.emit('toast', { kind: 'warn', text: `📎 ${file.from} sent you a file. Check your PC.` });
      this.pendingFile = file;
      const off = bus.on('computer:opened', () => {
        off();
        if (this.pendingFile === file) show();
        this.pendingFile = null;
      });
    }
  }
}
