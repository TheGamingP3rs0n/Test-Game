// Two desktop utilities for the work PC: Settings (wallpaper, icon size, arrange icons,
// a shortcut to the full game settings) and the Recycle Bin (drag an icon onto it to
// hide that app; restore it from here).
import { el } from '../../core/util.js';
import { bus } from '../../core/bus.js';
import { sfx } from '../../core/audio.js';
import { icon } from '../icons.js';
import { WALLPAPERS, appTile } from './os.js';

export function pcSettingsApp(game, win) {
  const d = win.desktop;
  const body = el('div.pcset');
  const render = () => {
    const p = d.prefs;
    body.replaceChildren(
      el('div.pcset-head', icon('settings'), el('div', el('h3', 'Personalize'), el('p', 'Make the work PC yours. (IT will reset it. IT does not exist.)'))),
      el('h4', 'Wallpaper'),
      el('div.pcset-walls', ...WALLPAPERS.map(([id, label]) => el(`button.pcset-wall.wp-${id}${p.wallpaper === id ? '.on' : ''}`, { title: label, onclick: () => { d.setWallpaper(id); sfx('click'); render(); } }, el('span', label)))),
      el('h4', 'Icon size'),
      el('div.pcset-seg', ...[['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large']].map(([v, l]) => el(`button${p.iconSize === v ? '.on' : ''}`, { onclick: () => { d.setIconSize(v); sfx('click'); render(); } }, l))),
      el('h4', 'Desktop'),
      el('div.pcset-row',
        el('button.xp-btn', { onclick: () => { d.arrangeIcons(); sfx('click'); } }, icon('grid'), 'Auto-arrange icons'),
        el('button.xp-btn', { onclick: () => { d.restoreApp(null); d.arrangeIcons(); sfx('click'); render(); } }, icon('refresh'), 'Reset everything')),
      el('p.pcset-tip', 'Tip: drag icons anywhere to organize them. Drop one on the Recycle Bin to hide it.'),
      el('h4', 'Game'),
      el('div.pcset-row', el('button.xp-btn.primary', { onclick: () => bus.emit('ui:openSettings') }, icon('settings'), 'Open game settings…')),
    );
  };
  render();
  return body;
}

export function recycleBinApp(game, win) {
  const d = win.desktop;
  const body = el('div.recycle');
  const render = () => {
    const trash = d.prefs.trash;
    body.replaceChildren(
      el('div.recycle-bar', el('b', `${trash.length} item${trash.length === 1 ? '' : 's'}`), trash.length ? el('button.xp-btn', { onclick: () => { d.restoreApp(null); sfx('cash'); render(); } }, icon('refresh'), 'Restore all') : null),
      trash.length
        ? el('div.recycle-grid', ...trash.map((id) => {
          const app = { id, ...(d.apps[id] || { name: id }) };
          return el('div.recycle-item', appTile(app, 'lg'), el('span', app.name), el('button.xp-btn', { onclick: () => { d.restoreApp(id); sfx('click'); render(); } }, 'Restore'));
        }))
        : el('div.recycle-empty', icon('trash'), el('p', 'The Recycle Bin is empty.'), el('p.muted', 'Drag a desktop icon onto the bin to hide it.')),
    );
  };
  render();
  const off = bus.on('desktop:changed', render);
  win.onClose = off;
  return body;
}
