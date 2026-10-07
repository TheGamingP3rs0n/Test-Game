// Multiplayer front-end: the Host/Join menu, the lobby, and the in-shift clock-out
// vote banner. Talks to the server through net (src/net/net.js) and drives the game's
// co-op hooks. Everything is LAN — players on the same Wi-Fi connect to the host.
import { el } from '../core/util.js';
import { settings, updateSettings } from '../core/store.js';
import { bus } from '../core/bus.js';
import { sfx, unlockAudio } from '../core/audio.js';
import { net, toWsUrl } from '../net/net.js';
import { icon } from './icons.js';
import { modal, toast } from './dialog.js';

const DEFAULT_PORT = 8787;

export function openMultiplayer(screens, game, { onClose } = {}) {
  let mode = 'home'; // home | host | join | lobby
  const body = el('div.mp');
  const nameInput = () => el('input.mp-name', { value: settings.playerName && settings.playerName !== 'You' ? settings.playerName : '', placeholder: 'Your name', maxLength: 20, onkeydown: (e) => e.stopPropagation() });

  const connect = async (url, name) => {
    updateSettings({ playerName: name });
    body.replaceChildren(el('div.mp-connecting', el('div.spinner'), el('div', `Connecting to ${url}…`)));
    try {
      await net.connect(url, name);
      mode = 'lobby';
      render();
    } catch (err) {
      sfx('error');
      mode = 'home';
      render();
      toast(err.message, 'bad', 6000, { icon: 'wifi-off', title: 'Could not connect' });
    }
  };

  const render = () => {
    if (mode === 'lobby') return renderLobby();
    if (mode === 'host') return renderHost();
    if (mode === 'join') return renderJoin();
    renderHome();
  };

  const renderHome = () => {
    body.replaceChildren(
      el('div.mp-head', icon('users'), el('h2', 'Local Co-op'), el('p.muted', 'Work the phones as a team on the same Wi-Fi. Pool your scams toward a shared quota, then vote to clock out.')),
      el('div.mp-choices',
        el('button.mp-card', { onclick: () => (sfx('click'), mode = 'host', render()) }, icon('antenna'), el('b', 'Host a game'), el('span', 'Run the server on this computer and invite the team.')),
        el('button.mp-card', { onclick: () => (sfx('click'), mode = 'join', render()) }, icon('wifi'), el('b', 'Join a game'), el('span', "Enter the host's Wi-Fi address to join their shift."))));
  };

  const renderHost = () => {
    const name = nameInput();
    body.replaceChildren(
      el('div.mp-head', icon('antenna'), el('h2', 'Host a game')),
      el('div.mp-steps',
        el('div.mp-step', el('b', '1.'), el('span', 'Start the server on this computer: run ', el('code', 'npm run mp'), ' (or the ', el('b', 'Start Multiplayer Server'), ' launcher). It prints your Wi-Fi address.')),
        el('div.mp-step', el('b', '2.'), el('span', 'Share that address (e.g. ', el('code', '192.168.1.5'), ') with teammates on the same Wi-Fi.')),
        el('div.mp-step', el('b', '3.'), el('span', 'Enter your name and connect to your own server below.'))),
      el('div.mp-form',
        el('label', 'Your name'), name,
        el('label', 'Server'), el('div.mp-row', el('input.mp-url', { value: `localhost:${DEFAULT_PORT}`, onkeydown: (e) => e.stopPropagation(), id: 'mp-host-url' }))),
      el('div.mp-actions',
        el('button.btn.ghost', { onclick: () => (mode = 'home', render()) }, 'Back'),
        el('button.btn.primary', { onclick: () => { unlockAudio(); const n = name.value.trim() || 'Host'; connect(toWsUrl(body.querySelector('#mp-host-url').value || `localhost:${DEFAULT_PORT}`), n); } }, 'Connect')));
  };

  const renderJoin = () => {
    const name = nameInput();
    const url = el('input.mp-url', { placeholder: 'e.g. 192.168.1.5', value: settings.lastHost || '', onkeydown: (e) => (e.stopPropagation(), e.key === 'Enter' && go()) });
    const go = () => {
      unlockAudio();
      const addr = url.value.trim();
      if (!addr) return toast('Enter the host address.', 'warn');
      updateSettings({ lastHost: addr });
      connect(toWsUrl(addr), name.value.trim() || 'Agent');
    };
    body.replaceChildren(
      el('div.mp-head', icon('wifi'), el('h2', 'Join a game')),
      el('div.mp-form',
        el('label', 'Your name'), name,
        el('label', "Host's address"), url,
        el('div.help', 'Ask the host for the address their server printed. Same Wi-Fi required.')),
      el('div.mp-actions',
        el('button.btn.ghost', { onclick: () => (mode = 'home', render()) }, 'Back'),
        el('button.btn.primary', { onclick: go }, 'Join')));
  };

  const list = el('div.mp-roster');
  const renderRoster = (roster) => {
    const r = roster || net.rosterList();
    list.replaceChildren(...r.map((p) => el('div.mp-player', el('span.mp-dot', { style: { background: p.color || '#888' } }), el('b', p.name), p.you ? el('span.mp-you', 'you') : null)));
  };
  const renderLobby = () => {
    renderRoster();
    body.replaceChildren(
      el('div.mp-head', icon('users'), el('h2', 'Lobby'), el('p.muted', 'Waiting for the team. Anyone can start the shift when everyone is in.')),
      el('div.mp-lobby', el('div.mp-roster-head', 'Call floor'), list),
      el('div.mp-actions',
        el('button.btn.ghost', { onclick: () => (net.disconnect(), mode = 'home', render()) }, 'Leave'),
        el('button.btn.big.primary', { onclick: () => (unlockAudio(), sfx('click'), net.startShift()) }, 'Start shift ▶')));
  };

  const offRoster = bus.on('net:roster', (r) => mode === 'lobby' && renderRoster(r));
  const offClose = bus.on('net:close', () => { if (mode === 'lobby') { mode = 'home'; render(); toast('Disconnected from the host.', 'warn', 5000, { icon: 'wifi-off' }); } });
  render();

  const m = modal(body, { className: 'mp-modal', onClose: () => { offRoster(); offClose(); if (!game.mp) net.disconnect(); onClose?.(); } });
  // when the shift starts, close the lobby
  const offStart = bus.on('net:start', () => m.close());
  const origClose = m.close;
  m.close = () => { offStart(); origClose(); };
  return m;
}

/** Wire net events to the game (called once at boot). */
export function initCoop(game) {
  let voteBanner = null;

  bus.on('net:team', (team) => { game.mpTeam = { earned: team.earned, quota: team.quota, day: team.day }; });
  bus.on('net:start', (m) => { game.beginCoopDay(m.day, m.quota); });
  bus.on('net:advance', (m) => {
    toast(`Day ${m.day}! New team quota: $${m.quota.toLocaleString()}.`, 'info', 5000, { icon: 'clock', title: 'Next shift' });
    game.beginCoopDay(m.day, m.quota);
  });
  bus.on('net:notice', (text) => toast(text, 'warn', 4000, { icon: 'info' }));
  bus.on('net:chat', (m) => { if (m.id !== net.id) toast(m.text, 'info', 4000, { icon: 'chat', title: m.name }); });
  bus.on('net:close', () => {
    if (game.mp) {
      game.mp = false;
      toast('Lost connection to the host. Back to the menu.', 'bad', 6000, { icon: 'wifi-off', title: 'Disconnected' });
      game.quitToMenu();
    }
  });

  bus.on('net:vote', (vote) => {
    if (!vote) { voteBanner?.remove(); voteBanner = null; document.body.classList.remove('voting'); return; }
    document.body.classList.add('voting');
    if (!voteBanner) {
      voteBanner = el('div.vote-banner');
      document.getElementById('ui').append(voteBanner);
    }
    const mine = false;
    voteBanner.replaceChildren(
      el('div.vote-title', icon('door'), 'Clock-out vote'),
      el('div.vote-tally', `${vote.yes} / ${vote.needed} needed`),
      el('div.vote-actions',
        el('button.btn.small.green', { onclick: () => net.voteClockOut() }, 'Vote yes'),
        el('button.btn.small.ghost', { onclick: () => net.cancelVote() }, 'Withdraw')));
    void mine;
  });
}
