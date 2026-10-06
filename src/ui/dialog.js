// Modal dialogs + toasts.
import { el } from '../core/util.js';
import { bus } from '../core/bus.js';
import { sfx } from '../core/audio.js';

let uiRoot = null;
let toastBox = null;

export function initDialogs(root) {
  uiRoot = root;
  toastBox = el('div.toasts.passthrough');
  root.append(toastBox);
  bus.on('toast', (t) => toast(t.text, t.kind, t.ms));
}

export function toast(text, kind = 'info', ms = 4200) {
  if (!toastBox) return;
  const t = el(`div.toast.${kind}`, text);
  toastBox.append(t);
  while (toastBox.children.length > 5) toastBox.firstChild.remove();
  setTimeout(() => {
    t.style.transition = 'opacity .4s';
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 400);
  }, ms);
}

/** Generic modal. content: Node. Returns { close, node }. */
export function modal(content, { onClose, closable = true, className = '' } = {}) {
  const panel = el(`div.panel.modal${className ? '.' + className : ''}`, content);
  const back = el('div.modal-back', panel);
  const close = () => {
    back.remove();
    onClose?.();
  };
  if (closable) back.addEventListener('mousedown', (e) => e.target === back && close());
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
