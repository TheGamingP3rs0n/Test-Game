// A tiny desktop environment ("Windoze XD"): draggable windows, taskbar, start menu,
// desktop icons, notifications. Used for your work PC and for victims' PCs.
import { el, clamp, clockText } from '../../core/util.js';
import { sfx } from '../../core/audio.js';

let zTop = 10;

export class Win {
  constructor(desktop, { id, title, icon = '🗔', width = 560, height = 400, x, y, body, onClose, resizable = true, className = '' }) {
    this.desktop = desktop;
    this.id = id;
    this.onClose = onClose;
    const rect = desktop.root.getBoundingClientRect();
    const area = rect.width > 50 ? rect : { width: 1000, height: 640 };
    const W = Math.min(width, Math.max(260, area.width - 30));
    const H = Math.min(height, Math.max(160, area.height - 70));
    const n = desktop.windows.size;
    const left = x ?? clamp(110 + n * 28 + Math.random() * 30, 4, Math.max(4, area.width - W - 6));
    const top = y ?? clamp(20 + n * 24 + Math.random() * 20, 4, Math.max(4, area.height - H - 44));
    this.titleEl = el('span.t', title);
    this.bodyEl = el(`div.win-body${className ? '.' + className : ''}`);
    this.node = el('div.win', { style: { width: W + 'px', height: H + 'px', left: left + 'px', top: top + 'px', resize: resizable ? 'both' : 'none' } },
      el('div.win-title', { onmousedown: (e) => this.startDrag(e), ondblclick: () => this.toggleMax() },
        el('span', icon), this.titleEl,
        el('button', { title: 'Minimize', onclick: (e) => (e.stopPropagation(), this.minimize()) }, '_'),
        el('button', { title: 'Maximize', onclick: (e) => (e.stopPropagation(), this.toggleMax()) }, '□'),
        el('button.close', { title: 'Close', onclick: (e) => (e.stopPropagation(), this.close()) }, '✕')),
      this.bodyEl);
    this.node.addEventListener('mousedown', () => this.focus());
    desktop.winLayer.append(this.node);
    if (body) this.setBody(typeof body === 'function' ? body(this) : body);
    this.focus();
  }

  setBody(node) {
    this.bodyEl.replaceChildren(node);
  }

  setTitle(t) {
    this.titleEl.textContent = t;
    this.desktop.renderTaskbar();
  }

  focus() {
    for (const w of this.desktop.windows.values()) w.node.classList.remove('focused');
    this.node.classList.add('focused');
    this.node.style.zIndex = ++zTop;
    this.node.style.display = '';
    this.minimized = false;
    this.desktop.active = this;
    this.desktop.renderTaskbar();
  }

  minimize() {
    this.node.style.display = 'none';
    this.minimized = true;
    this.desktop.renderTaskbar();
  }

  toggleMax() {
    if (this.max) {
      Object.assign(this.node.style, this.max);
      this.max = null;
    } else {
      this.max = { left: this.node.style.left, top: this.node.style.top, width: this.node.style.width, height: this.node.style.height };
      Object.assign(this.node.style, { left: '0px', top: '0px', width: '100%', height: 'calc(100% - 38px)' });
    }
  }

  close() {
    this.node.remove();
    this.desktop.windows.delete(this.id);
    this.onClose?.();
    this.desktop.renderTaskbar();
  }

  startDrag(e) {
    if (e.target.tagName === 'BUTTON') return;
    const sx = e.clientX;
    const sy = e.clientY;
    const ox = this.node.offsetLeft;
    const oy = this.node.offsetTop;
    const area = this.desktop.root.getBoundingClientRect();
    const move = (ev) => {
      this.node.style.left = clamp(ox + ev.clientX - sx, -this.node.offsetWidth + 80, area.width - 60) + 'px';
      this.node.style.top = clamp(oy + ev.clientY - sy, 0, area.height - 70) + 'px';
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }
}

export class Desktop {
  /**
   * @param apps     { id: { name, icon, open(desktop, opts) -> {title, body, width, height} } }
   * @param icons    list of app ids (or {id,name,icon,onOpen}) shown on the desktop
   */
  constructor({ theme = 'player', apps = {}, icons = [], user = 'Agent', wallpaperText = '', vm = false, startItems = null, locked = new Set(), onStartAction = null }) {
    this.apps = apps;
    this.windows = new Map();
    this.theme = theme;
    this.locked = locked;
    this.root = el(`div.os.${theme}${vm ? '.vm' : ''}`);
    this.iconLayer = el('div.desk-icons');
    this.winLayer = el('div.win-layer');
    this.taskItems = el('div.row', { style: { gap: '4px', flexWrap: 'nowrap', overflow: 'hidden' } });
    this.clockEl = el('span', '9:00 AM');
    this.trayExtra = el('span');
    this.startMenu = null;
    this.user = user;
    this.onStartAction = onStartAction;
    this.startItems = startItems;
    if (wallpaperText) this.root.append(el('div.wallpaper-text', { html: wallpaperText }));
    this.root.append(
      this.iconLayer,
      this.winLayer,
      el('div.taskbar', el('button.start-btn', { onclick: (e) => (e.stopPropagation(), this.toggleStart()) }, theme === 'player' ? '⊞ start' : '⊞'), this.taskItems, el('div.tray', this.trayExtra, el('span', theme === 'player' ? '🔊 📶' : '🔈'), this.clockEl)),
    );
    this.root.addEventListener('mousedown', (e) => {
      if (this.startMenu && !this.startMenu.contains(e.target)) this.closeStart();
    });
    this.setIcons(icons);
  }

  setIcons(icons) {
    this.iconLayer.replaceChildren(
      ...icons.map((ic) => {
        const app = typeof ic === 'string' ? { id: ic, ...this.apps[ic] } : ic;
        if (!app || !app.name) return null;
        const locked = this.locked.has(app.id);
        return el(`div.desk-icon${locked ? '.locked' : ''}`, { title: locked ? 'Unlocks on a later day' : app.name, dataset: { app: app.id }, onclick: () => (ic.onOpen ? ic.onOpen() : this.open(app.id)) },
          el('span.ico', app.icon || '📄'), locked ? `🔒 ${app.name}` : app.name);
      }),
    );
  }

  /** Open (or focus) an app window. */
  open(appId, opts = {}) {
    if (this.locked.has(appId)) {
      sfx('error');
      this.notify(`🔒 ${this.apps[appId]?.name || appId} unlocks on a later day.`);
      return null;
    }
    const key = opts.key ? `${appId}:${opts.key}` : appId;
    if (this.windows.has(key)) {
      const w = this.windows.get(key);
      w.focus();
      return w;
    }
    const app = this.apps[appId];
    if (!app) return null;
    sfx('click');
    const win = new Win(this, { id: key, title: opts.title || app.name, icon: app.icon, width: opts.width || app.width || 560, height: opts.height || app.height || 400, className: app.bodyClass || '', onClose: () => app.onClose?.(win) });
    this.windows.set(key, win);
    try {
      win.setBody(app.render(win, opts));
    } catch (err) {
      console.error(err);
      win.setBody(el('div.fileview', `This program has performed an illegal operation.\n\n${err.message}`));
    }
    this.renderTaskbar();
    return win;
  }

  close(appId) {
    for (const [k, w] of this.windows) if (k === appId || k.startsWith(appId + ':')) w.close();
  }

  closeAll() {
    for (const w of [...this.windows.values()]) w.close();
  }

  renderTaskbar() {
    this.taskItems.replaceChildren(
      ...[...this.windows.values()].map((w) => el(`button.task-item${w === this.active && !w.minimized ? '.active' : ''}`, { onclick: () => (w.minimized || w !== this.active ? w.focus() : w.minimize()) }, w.titleEl.textContent)),
    );
  }

  setClock(mins) {
    this.clockEl.textContent = clockText(mins);
  }

  toggleStart() {
    if (this.startMenu) return this.closeStart();
    const items = this.startItems || Object.entries(this.apps).filter(([, a]) => !a.hidden).map(([id, a]) => ({ id, ...a }));
    this.startMenu = el('div.start-menu',
      el('div.head', el('span', { style: { fontSize: '26px' } }, '🧑‍💼'), this.user),
      el('div.items', items.map((a) => el('div.item', { onclick: () => (this.closeStart(), a.action ? a.action() : this.open(a.id)) }, el('span', a.icon), (this.locked.has(a.id) ? '🔒 ' : '') + a.name))),
      this.onStartAction ? el('div.foot', el('button.xp-btn', { onclick: () => (this.closeStart(), this.onStartAction('logoff')) }, '🚪 Stand up'), el('button.xp-btn.red', { onclick: () => (this.closeStart(), this.onStartAction('shutdown')) }, '⏻ Leave PC')) : null,
    );
    this.root.append(this.startMenu);
  }

  closeStart() {
    this.startMenu?.remove();
    this.startMenu = null;
  }

  notify(text, { kind = '', ms = 4500, actions = [] } = {}) {
    const n = el(`div.notif${kind ? '.' + kind : ''}`, el('div', text), actions.length ? el('div.row', { style: { marginTop: '8px' } }, actions.map((a) => el('button.xp-btn' + (a.primary ? '.primary' : ''), { onclick: () => (n.remove(), a.onClick()) }, a.label))) : null);
    this.root.append(n);
    sfx('notify');
    if (ms) setTimeout(() => n.remove(), ms);
    return n;
  }
}
