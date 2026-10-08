// A tiny desktop environment ("Windoze XD"): draggable windows, taskbar, start menu,
// desktop icons, notifications. Used for your work PC and for victims' PCs.
import { el, clamp, clockText, money } from '../../core/util.js';
import { sfx } from '../../core/audio.js';
import { bus } from '../../core/bus.js';
import { icon, iconFor } from '../icons.js';
import { APP_ICONS } from '../appIcons.js';
import { settings, updateSettings } from '../../core/store.js';

export const WALLPAPERS = [
  ['green', 'Global Solutions'], ['bliss', 'Rolling hills'], ['night', 'Kolkata night'], ['koi', 'Koi pond'],
  ['sunset', 'Sunset'], ['classic', 'Classic teal'], ['chai', 'Masala chai'], ['grid', 'Synthwave'],
];
const CELL = { sm: [76, 84], md: [90, 98], lg: [108, 118] };
const UNMOVABLE_TO_TRASH = new Set(['recycle', 'settings']);

/** Tile colours for app icons (anything else gets a hue from its name). */
const TILE = {
  phone: '#22a861', remote: '#2f6fe0', notes: '#e0a91b', browser: '#1d8fd6', cashier: '#1f9d4c', playbook: '#6b4fd8', messenger: '#14a3a3',
  files: '#d98a1c', antivirus: '#c43b3b', recorder: '#d63a5a', paint: '#e0662b', camera: '#5b6573', docforge: '#4a6fa5', siteforge: '#8e44ad',
  mycomputer: '#d98a1c', cmd: '#2b2f33', eventvwr: '#c9a227', notepad: '#5f87c9', recycle: '#6b7a86', obs: '#3a3f47', vbox: '#2f6fe0',
};
function tileColor(id = '') {
  if (TILE[id]) return TILE[id];
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 42%)`;
}

let svgUid = 0;
/** Full-colour SVG for an app (gradient ids made unique per copy so hidden copies can't break visible ones). */
function colorSvg(def) {
  const n = ++svgUid;
  const body = def.body.replace(/id="([^"]+)"/g, (m, id) => `id="${id}-${n}"`).replace(/url\(#([^)]+)\)/g, (m, id) => `url(#${id}-${n})`).replace(/href="#([^"]+)"/g, (m, id) => `href="#${id}-${n}"`);
  const wrap = document.createElement('span');
  wrap.className = 'color-ico';
  wrap.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${def.w} ${def.h}" width="100%" height="100%" aria-hidden="true">${body}</svg>`;
  return wrap;
}

/** App icon: a full-colour icon when we have one, else a coloured tile with a glyph. */
export function appTile(app, size = 'md') {
  const def = APP_ICONS[app.id];
  if (def) return el(`span.app-icon.${size}`, colorSvg(def));
  const tile = el(`span.app-tile.${size}`, icon(iconFor(app.icon, 'square')));
  tile.style.setProperty('--tile', tileColor(app.id));
  return tile;
}

let zTop = 10;

export class Win {
  constructor(desktop, { id, appId = id, title, icon: appIcon = 'square', width = 560, height = 400, x, y, body, onClose, resizable = true, className = '' }) {
    this.desktop = desktop;
    this.id = id;
    this.appId = appId;
    this.appIcon = appIcon;
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
        appTile({ id: appId, icon: appIcon }, 'sm'), this.titleEl,
        el('button', { title: 'Minimize', onclick: (e) => (e.stopPropagation(), this.minimize()) }, icon('minus')),
        el('button', { title: 'Maximize', onclick: (e) => (e.stopPropagation(), this.toggleMax()) }, icon('maximize')),
        el('button.close', { title: 'Close', onclick: (e) => (e.stopPropagation(), this.close()) }, icon('x'))),
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
  constructor({ theme = 'player', apps = {}, icons = [], user = 'Agent', wallpaperText = '', vm = false, startItems = null, locked = new Set(), onStartAction = null, customizable = false }) {
    this.apps = apps;
    this.windows = new Map();
    this.theme = theme;
    this.locked = locked;
    this.root = el(`div.os.${theme}${vm ? '.vm' : ''}`);
    this.iconLayer = el('div.desk-icons');
    this.winLayer = el('div.win-layer');
    this.taskItems = el('div.row', { style: { gap: '4px', flexWrap: 'nowrap', overflow: 'hidden' } });
    this.clockEl = el('span', '9:00 AM');
    this.statusEl = theme === 'player' ? el('div.tray-status') : null;
    this.trayExtra = el('span');
    this.startMenu = null;
    this.user = user;
    this.onStartAction = onStartAction;
    this.startItems = startItems;
    if (wallpaperText) this.root.append(el('div.wallpaper-text', { html: wallpaperText }));
    this.root.append(
      this.iconLayer,
      this.winLayer,
      el('div.taskbar', el('button.start-btn', { onclick: (e) => (e.stopPropagation(), this.toggleStart()) }, icon('grid'), theme === 'player' ? 'start' : ''), this.taskItems, el('div.tray', this.statusEl, this.trayExtra, el('span.tray-icons', icon('volume'), icon('wifi')), this.clockEl)),
    );
    this.root.addEventListener('mousedown', (e) => {
      if (this.startMenu && !this.startMenu.contains(e.target)) this.closeStart();
    });
    this.customizable = customizable;
    if (customizable) {
      this.iconLayer.classList.add('free');
      this.applyLook();
      new ResizeObserver(() => this.layoutIcons()).observe(this.iconLayer);
    }
    this.setIcons(icons);
  }

  // ---------------------------------------------------------------- customizable desktop (player PC)
  get prefs() {
    const d = settings.desktop || {};
    return { pos: d.pos || {}, trash: d.trash || [], wallpaper: d.wallpaper || 'green', iconSize: d.iconSize || 'md' };
  }
  savePrefs(patch) {
    updateSettings({ desktop: { ...this.prefs, ...patch } });
  }
  applyLook() {
    const p = this.prefs;
    for (const c of [...this.root.classList]) if (c.startsWith('wp-') || c.startsWith('ic-')) this.root.classList.remove(c);
    this.root.classList.add(`wp-${p.wallpaper}`, `ic-${p.iconSize}`);
  }
  setWallpaper(id) { this.savePrefs({ wallpaper: id }); this.applyLook(); }
  setIconSize(sz) { this.savePrefs({ iconSize: sz }); this.applyLook(); this.layoutIcons(); }
  arrangeIcons() { this.savePrefs({ pos: {} }); this.layoutIcons(); }
  trashApp(id) {
    if (UNMOVABLE_TO_TRASH.has(id)) return;
    const t = new Set(this.prefs.trash); t.add(id);
    this.savePrefs({ trash: [...t] }); this.setIcons(this.allIcons); sfx('shred'); bus.emit('desktop:changed');
    this.notify(`${this.apps[id]?.name || id} moved to the Recycle Bin.`, { icon: 'trash', ms: 2500 });
  }
  restoreApp(id) {
    this.savePrefs({ trash: id ? this.prefs.trash.filter((x) => x !== id) : [] });
    this.setIcons(this.allIcons);
    bus.emit('desktop:changed');
  }
  /** Grid geometry for the current icon size and layer height. */
  grid() {
    const [cw, ch] = CELL[this.prefs.iconSize] || CELL.md;
    const h = this.iconLayer.clientHeight || 520;
    const w = this.iconLayer.clientWidth || 900;
    return { cw, ch, rows: Math.max(1, Math.floor(h / ch)), cols: Math.max(1, Math.floor(w / cw)) };
  }
  layoutIcons() {
    if (!this.customizable) return;
    const { cw, ch, rows, cols } = this.grid();
    const pos = this.prefs.pos;
    const taken = new Set();
    const nodes = [...this.iconLayer.children];
    const place = (n, c, r) => { taken.add(`${c},${r}`); n.style.left = `${c * cw}px`; n.style.top = `${r * ch}px`; n.style.width = `${cw - 6}px`; };
    const free = [];
    for (const n of nodes) {
      const p = pos[n.dataset.app];
      if (p && p[0] < cols && p[1] < rows && !taken.has(`${p[0]},${p[1]}`)) place(n, p[0], p[1]); else free.push(n);
    }
    let i = 0;
    for (const n of free) {
      while (taken.has(`${Math.floor(i / rows)},${i % rows}`)) i++;
      place(n, Math.floor(i / rows), i % rows);
    }
  }
  enableIconDrag(node, appId) {
    node.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const start = { x: e.clientX, y: e.clientY, left: node.offsetLeft, top: node.offsetTop };
      let dragging = false;
      const move = (ev) => {
        const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
        if (!dragging && Math.hypot(dx, dy) < 6) return;
        dragging = true;
        node.classList.add('dragging');
        // the layer may be CSS-scaled (the monitor is a scaled 3D-ish panel): convert
        const scale = this.iconLayer.getBoundingClientRect().width / (this.iconLayer.offsetWidth || 1) || 1;
        node.style.left = `${start.left + dx / scale}px`;
        node.style.top = `${start.top + dy / scale}px`;
        const bin = this.iconLayer.querySelector('[data-app="recycle"]');
        if (bin && bin !== node) bin.classList.toggle('drop-target', overlaps(node, bin));
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        node.classList.remove('dragging');
        if (!dragging) return this.open(appId);
        node.dataset.justDragged = '1';
        setTimeout(() => delete node.dataset.justDragged, 0);
        const bin = this.iconLayer.querySelector('[data-app="recycle"]');
        bin?.classList.remove('drop-target');
        if (bin && bin !== node && overlaps(node, bin)) return this.trashApp(appId);
        const { cw, ch, rows, cols } = this.grid();
        const c = clamp(Math.round(node.offsetLeft / cw), 0, cols - 1);
        const r = clamp(Math.round(node.offsetTop / ch), 0, rows - 1);
        const pos = { ...this.prefs.pos };
        // swap with whatever already sits in that cell
        const cellOf = (n) => [Math.round(n.offsetLeft / cw), Math.round(n.offsetTop / ch)];
        for (const other of this.iconLayer.children) {
          if (other === node) continue;
          const [oc, orow] = cellOf(other);
          if (oc === c && orow === r) {
            const mine = pos[appId] || cellOf({ offsetLeft: start.left, offsetTop: start.top });
            pos[other.dataset.app] = mine;
          } else if (!pos[other.dataset.app]) pos[other.dataset.app] = [oc, orow];
        }
        pos[appId] = [c, r];
        this.savePrefs({ pos });
        this.layoutIcons();
        sfx('click');
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  setIcons(icons) {
    this.allIcons = icons;
    const trash = this.customizable ? new Set(this.prefs.trash) : new Set();
    this.iconLayer.replaceChildren(
      ...icons.map((ic) => {
        const app = typeof ic === 'string' ? { id: ic, ...this.apps[ic] } : ic;
        if (!app || !app.name || trash.has(app.id)) return null;
        const locked = this.locked.has(app.id);
        const node = el(`div.desk-icon${locked ? '.locked' : ''}`, { title: locked ? 'Unlocks on a later day' : app.name, dataset: { app: app.id }, onclick: this.customizable ? null : () => (ic.onOpen ? ic.onOpen() : this.open(app.id)) },
          el('span.tile-wrap', appTile(app, 'lg'), locked ? el('span.lock-badge', icon('lock')) : null), el('span.desk-label', app.name));
        if (this.customizable) this.enableIconDrag(node, app.id);
        return node;
      }),
    );
    if (this.customizable) requestAnimationFrame(() => this.layoutIcons());
    if (this.customizable) this.layoutIcons();
  }

  /** Open (or focus) an app window. */
  open(appId, opts = {}) {
    if (this.locked.has(appId)) {
      sfx('error');
      this.notify(`${this.apps[appId]?.name || appId} unlocks on a later day.`, { icon: 'lock' });
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
    const win = new Win(this, { id: key, appId, title: opts.title || app.name, icon: app.icon, width: opts.width || app.width || 560, height: opts.height || app.height || 400, className: app.bodyClass || '', onClose: () => app.onClose?.(win) });
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
      ...[...this.windows.values()].map((w) => el(`button.task-item${w === this.active && !w.minimized ? '.active' : ''}`, { onclick: () => (w.minimized || w !== this.active ? w.focus() : w.minimize()) }, appTile({ id: w.appId, icon: w.appIcon }, 'xs'), el('span', w.titleEl.textContent))),
    );
  }

  setClock(mins) {
    this.clockEl.textContent = clockText(mins);
  }

  /** PERSONAL / QUOTA readout in the taskbar (player PC only). */
  setStatus({ earned, quota } = {}) {
    if (!this.statusEl) return;
    const met = earned >= quota;
    this.statusEl.replaceChildren(
      el('span', el('b', 'PERSONAL '), money(earned)),
      el('span', { class: met ? 'met' : '' }, el('b', 'QUOTA '), money(quota)),
    );
  }

  toggleStart() {
    if (this.startMenu) return this.closeStart();
    const items = this.startItems || Object.entries(this.apps).filter(([, a]) => !a.hidden).map(([id, a]) => ({ id, ...a }));
    this.startMenu = el('div.start-menu',
      el('div.head', el('span.avatar', appTile({ id: 'user' }, 'md')), this.user),
      el('div.items', items.map((a) => el(`div.item${this.locked.has(a.id) ? '.locked' : ''}`, { onclick: () => (this.closeStart(), a.action ? a.action() : this.open(a.id)) }, appTile(a, 'sm'), el('span', a.name), this.locked.has(a.id) ? icon('lock') : null))),
      this.onStartAction ? el('div.foot', el('button.xp-btn.red', { onclick: () => (this.closeStart(), this.onStartAction('shutdown')) }, icon('power'), 'Leave PC')) : null,
    );
    this.root.append(this.startMenu);
  }

  closeStart() {
    this.startMenu?.remove();
    this.startMenu = null;
  }

  notify(text, { kind = '', ms = 4500, actions = [], icon: ic = '' } = {}) {
    const n = el(`div.notif${kind ? '.' + kind : ''}`, el('div.notif-row', ic ? icon(ic) : null, el('div', text)), actions.length ? el('div.row', { style: { marginTop: '8px' } }, actions.map((a) => el('button.xp-btn' + (a.primary ? '.primary' : ''), { onclick: () => (n.remove(), a.onClick()) }, a.label))) : null);
    this.root.append(n);
    sfx('notify');
    if (ms) setTimeout(() => n.remove(), ms);
    return n;
  }
}

function overlaps(a, b) {
  const r1 = a.getBoundingClientRect(), r2 = b.getBoundingClientRect();
  const cx = r1.left + r1.width / 2, cy = r1.top + r1.height / 2;
  return cx > r2.left && cx < r2.right && cy > r2.top && cy < r2.bottom;
}
