// Modal dialogs + toasts.
import { el } from '../core/util.js';
import { bus } from '../core/bus.js';
import { sfx } from '../core/audio.js';
import { icon, iconFor } from './icons.js';

let uiRoot = null;
let toastBox = null;

export function initDialogs(root) {
  uiRoot = root;
  toastBox = el('div.toasts.passthrough');
  root.append(toastBox);
  bus.on('toast', (t) => toast(t.text, t.kind, t.ms, { icon: t.icon, title: t.title }));
}

const KIND = {
  info: { title: 'Notice', icon: 'info' },
  warn: { title: 'Heads up', icon: 'warn' },
  bad: { title: 'Problem', icon: 'x-circle' },
  money: { title: 'Cash in', icon: 'money' },
};

/** Game-style notification card (icon badge, title, message, timer bar). */
export function toast(text, kind = 'info', ms = 4200, { icon: ic, title } = {}) {
  if (!toastBox) return;
  const k = KIND[kind] || KIND.info;
  // a leading emoji in old-style messages becomes the badge icon
  const lead = String(text).match(/^\s*(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*\uFE0F?)\s*/u);
  const leadIcon = lead ? iconFor(lead[1], '') : '';
  const body = lead ? String(text).slice(lead[0].length) : String(text);
  const bar = el('div.toast-timer');
  const t = el(`div.toast.${kind}`, el('div.toast-badge', icon(ic || leadIcon || k.icon)), el('div.toast-body', el('div.toast-title', title || k.title), el('div.toast-text', body)), bar);
  bar.style.animationDuration = `${ms}ms`;
  toastBox.append(t);
  while (toastBox.children.length > 4) toastBox.firstChild.remove();
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 350);
  }, ms);
}

/** Generic modal. content: Node. Returns { close, node }. */
export function modal(content, { onClose, closable = true, className = '' } = {}) {
  const closeBtn = closable ? el('button.modal-close', { title: 'Close (Esc)', 'aria-label': 'Close' }, icon('x')) : null;
  const panel = el(`div.panel.modal${className ? '.' + className : ''}`, closeBtn, content);
  const back = el('div.modal-back', panel);
  if (closeBtn) closeBtn.addEventListener('click', () => close());
  const onKey = (e) => {
    // Esc closes the top-most modal only (and doesn't also resume/pause the game)
    if (e.code !== 'Escape' || back !== [...document.querySelectorAll('.modal-back')].pop()) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    close();
  };
  const close = () => {
    if (!back.isConnected) return;
    document.removeEventListener('keydown', onKey, true);
    back.remove();
    onClose?.();
  };
  if (closable) {
    back.addEventListener('mousedown', (e) => e.target === back && close());
    document.addEventListener('keydown', onKey, true);
  }
  uiRoot.append(back);
  return { close, node: back, panel };
}

export function confirmDialog(title, text, { ok = 'OK', cancel = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    let m;
    const done = (v) => {
      m.close();
      resolve(v);
    };
    m = modal(
      el('div', el('h2', title), el('p.muted', text), el('div.row', { style: { justifyContent: 'flex-end', marginTop: '14px' } }, cancel ? el('button.btn.ghost', { onclick: () => done(false) }, cancel) : null, el(`button.btn.${danger ? 'danger' : 'primary'}`, { onclick: () => done(true) }, ok))),
      { onClose: () => resolve(false) },
    );
  });
}

/** Choice dialog: choices = [{ label, value, hint }]. */
export function choiceDialog(title, text, choices, { closable = false } = {}) {
  return new Promise((resolve) => {
    sfx('notify');
    let m;
    m = modal(
      el('div', el('h2', title), text ? el('p', text) : null, el('div.choices', choices.map((c) => el('button.btn', { onclick: () => (m.close(), resolve(c.value)) }, el('div', el('div', c.label), c.hint ? el('small.muted', c.hint) : null))))),
      { closable },
    );
  });
}

export function promptDialog(title, text, { placeholder = '', value = '', ok = 'OK' } = {}) {
  return new Promise((resolve) => {
    let m;
    const input = el('input.input', { placeholder, value });
    const done = (v) => {
      m.close();
      resolve(v);
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && done(input.value));
    m = modal(el('div', el('h2', title), text ? el('p.muted', text) : null, input, el('div.row', { style: { justifyContent: 'flex-end', marginTop: '12px' } }, el('button.btn.ghost', { onclick: () => done(null) }, 'Cancel'), el('button.btn.primary', { onclick: () => done(input.value) }, ok))), { onClose: () => resolve(null) });
    setTimeout(() => input.focus(), 30);
  });
}
