// Between-day company store: spend your commission on upgrades.
import { el, money } from '../core/util.js';
import { SHOP, upgradeLevel } from '../game/progression.js';
import { sfx } from '../core/audio.js';
import { saveRun } from '../game/run.js';

export function showShop(screens, game, run, commission) {
  const walletEl = el('b', money(run.wallet));
  const grid = el('div.shop-grid');
  const render = () => {
    walletEl.textContent = money(run.wallet);
    grid.replaceChildren(...SHOP.map((it) => {
      const lvl = upgradeLevel(run, it.id);
      const maxed = lvl >= it.max;
      const afford = run.wallet >= it.price;
      return el(`div.shop-item${lvl ? '.owned' : ''}`,
        el('div.ico', it.icon), el('div.nm', it.name), el('div.ds', it.desc),
        el('div.row', el('span.muted', it.consumable ? `Owned: ${lvl}` : `${lvl}/${it.max}`), el('span.spacer', { style: { flex: 1 } }),
          el('button.btn.small' + (afford && !maxed ? '.primary' : ''), { disabled: maxed || !afford, onclick: () => {
            run.wallet -= it.price;
            run.upgrades[it.id] = lvl + 1;
            sfx('cash');
            saveRun(run);
            render();
          } }, maxed ? 'Maxed' : money(it.price))));
    }));
  };
  render();
  screens.show(el('div.screen', el('div.panel.shop',
    el('h2', '🛒 The Company Store'),
    el('p', 'Your cut today: ', el('b', { style: { color: 'var(--green-2)' } }, money(commission)), '. Wallet: ', walletEl, `. Strikes: ${'❌'.repeat(run.strikes) || 'none'}. Police heat: ${Math.round(run.heat)}/100.`),
    grid,
    el('div.row', { style: { justifyContent: 'flex-end', marginTop: '16px' } },
      el('button.btn.ghost', { onclick: () => game.quitToMenu() }, 'Save & quit to menu'),
      el('button.btn.big.primary', { onclick: () => (screens.hide(), game.nextDay()) }, `Start Day ${run.day} ▶`)))));
}
