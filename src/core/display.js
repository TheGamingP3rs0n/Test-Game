// Display + accessibility settings applied to the page: UI scale, brightness, colour-
// blind palettes, high contrast, reduced motion, subtitle size, crosshair, HUD opacity
// and an FPS counter. Renderer-side bits (render scale, FPS cap, camera shake) are read
// by the world/fx directly from settings.
import { settings } from './store.js';
import { bus } from './bus.js';

// approximate daltonization matrices for the 3D view (shift confusing hues apart)
const CB_MATRIX = {
  protanopia: '0.20 0.99 -0.19 0 0  0.16 0.79 0.04 0 0  0.01 -0.01 1.00 0 0  0 0 0 1 0',
  deuteranopia: '0.43 0.72 -0.15 0 0  0.34 0.57 0.09 0 0  -0.02 0.03 1.00 0 0  0 0 0 1 0',
  tritanopia: '0.97 0.11 -0.08 0 0  0.02 0.82 0.16 0 0  -0.06 0.88 0.18 0 0  0 0 0 1 0',
};

function ensureFilters() {
  if (document.getElementById('cb-filters')) return;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.id = 'cb-filters';
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  for (const [id, m] of Object.entries(CB_MATRIX)) {
    const f = document.createElementNS(ns, 'filter');
    f.id = `cb-${id}`;
    const cm = document.createElementNS(ns, 'feColorMatrix');
    cm.setAttribute('type', 'matrix'); cm.setAttribute('values', m);
    f.append(cm); svg.append(f);
  }
  document.body.append(svg);
}

let fpsEl = null;
let frames = 0;
let lastFps = performance.now();
function fpsTick() {
  frames++;
  const now = performance.now();
  if (now - lastFps >= 500) {
    if (fpsEl) fpsEl.textContent = `${Math.round((frames * 1000) / (now - lastFps))} FPS`;
    frames = 0; lastFps = now;
  }
  if (settings.showFps) requestAnimationFrame(fpsTick);
}

export function applyDisplay() {
  ensureFilters();
  const s = settings;
  const root = document.documentElement;
  const b = document.body;
  root.style.setProperty('--ui-scale', String(s.uiScale || 1));
  root.style.setProperty('--hud-opacity', String(s.hudOpacity ?? 1));
  const ui = document.getElementById('ui');
  if (ui) ui.style.zoom = String(s.uiScale || 1);
  const canvas = document.querySelector('canvas#game, #app canvas, body > canvas') || document.querySelector('canvas');
  const filters = [];
  if ((s.brightness || 1) !== 1) filters.push(`brightness(${s.brightness})`);
  if (s.colorblind && s.colorblind !== 'off') filters.push(`url(#cb-${s.colorblind})`);
  if (canvas) canvas.style.filter = filters.join(' ');
  b.classList.toggle('reduce-motion', !!s.reduceMotion);
  b.classList.toggle('high-contrast', !!s.highContrast);
  for (const c of ['cb-protanopia', 'cb-deuteranopia', 'cb-tritanopia']) b.classList.remove(c);
  if (s.colorblind && s.colorblind !== 'off') b.classList.add(`cb-${s.colorblind}`);
  for (const c of ['sub-sm', 'sub-md', 'sub-lg', 'sub-xl']) b.classList.remove(c);
  b.classList.add(`sub-${s.subtitleSize || 'md'}`);
  for (const c of ['xhair-dot', 'xhair-cross', 'xhair-none']) b.classList.remove(c);
  b.classList.add(`xhair-${s.crosshair || 'dot'}`);
  if (s.showFps && !fpsEl) {
    fpsEl = document.createElement('div');
    fpsEl.className = 'fps-counter';
    document.body.append(fpsEl);
    requestAnimationFrame(fpsTick);
  } else if (!s.showFps && fpsEl) { fpsEl.remove(); fpsEl = null; }
}

const KEYS = ['uiScale', 'hudOpacity', 'brightness', 'colorblind', 'reduceMotion', 'highContrast', 'subtitleSize', 'crosshair', 'showFps'];
export function initDisplay() {
  applyDisplay();
  bus.on('settings:changed', (s, patch) => { if (KEYS.some((k) => k in patch)) applyDisplay(); });
}

export async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { /* not allowed */ }
}
