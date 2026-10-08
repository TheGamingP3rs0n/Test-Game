// Multiplayer front-end: the Host/Join menu, the lobby, and the in-shift clock-out
// vote banner. Talks to the server through net (src/net/net.js) and drives the game's
// co-op hooks. Online games use a join code (PeerJS); LAN games use the host's address.
import { el } from '../core/util.js';
import { settings, updateSettings, session } from '../core/store.js';
import { bus } from '../core/bus.js';
import { sfx, unlockAudio } from '../core/audio.js';
import { net, toWsUrl } from '../net/net.js';
import { icon } from './icons.js';
import { modal, toast } from './dialog.js';

const DEFAULT_PORT = 8787;

export function openMultiplayer(screens, game, { onClose } = {}) {
  let mode = 'home'; // home | host-online | join-online | host-lan | join-lan | lobby
  let lanInfo = null; // { addresses, port } when this desktop app runs the LAN server
  const body = el('div.mp');
  const stop = (e) => e.stopPropagation();
  const nameInput = () => el('input.mp-name', { value: settings.playerName && settings.playerName !== 'You' ? settings.playerName : '', placeholder: 'Your name', maxLength: 20, onkeydown: stop });
  const passInput = (ph = 'Optional — leave empty for an open lobby') => el('input.mp-pass', { type: 'password', placeholder: ph, maxLength: 40, autocomplete: 'off', onkeydown: stop });
  const desktop = window.desktopApp || null; // Electron bridge (desktop build only)

  const busy = (text) => body.replaceChildren(el('div.mp-connecting', el('div.spinner'), el('div', text)));
  const fail = (err, back) => { sfx('error'); mode = back; render(); toast(err.message || String(err), 'bad', 7000, { icon: 'wifi-off', title: 'Could not connect' }); };
  const enterLobby = () => { mode = 'lobby'; render(); };

  const render = () => ({ lobby: renderLobby, 'host-online': renderHostOnline, 'join-online': renderJoinOnline, 'host-lan': renderHostLan, 'join-lan': renderJoinLan }[mode] || renderHome)();
  const back = () => el('button.btn.ghost', { onclick: () => (mode = 'home', render()) }, 'Back');

  const renderHome = () => {
    const card = (ic, title, sub, go) => el('button.mp-card', { onclick: () => (sfx('click'), go()) }, icon(ic), el('b', title), el('span', sub));
    body.replaceChildren(
      el('div.mp-head', icon('users'), el('h2', 'Multiplayer'), el('p.muted', 'Work the phones as a team. Pool your scams toward a shared quota, then vote to clock out.')),
      el('div.mp-sec', icon('globe'), 'Online — play with friends anywhere'),
      el('div.mp-choices',
        card('antenna', 'Host online', 'Get a join code to send to your friends. Optional password.', () => (mode = 'host-online', render())),
        card('key', 'Join with a code', 'Enter the code (and password) your host gave you.', () => (mode = 'join-online', render()))),
      el('div.mp-sec', icon('wifi'), 'Same Wi-Fi (LAN)'),
      el('div.mp-choices',
        card('monitor', 'Host on this network', desktop ? 'Run the server right here — no extra steps.' : 'Run the multiplayer server on this computer.', () => (mode = 'host-lan', render())),
        card('wifi', 'Join on this network', "Enter the host's address on your Wi-Fi.", () => (mode = 'join-lan', render()))));
  };

  const renderHostOnline = () => {
    const name = nameInput();
    const pass = passInput();
    const go = async () => {
      unlockAudio();
      updateSettings({ playerName: name.value.trim() || 'Host' });
      busy('Creating your online game…');
      try { await net.hostOnline(name.value.trim() || 'Host', pass.value); enterLobby(); } catch (err) { fail(err, 'host-online'); }
    };
    body.replaceChildren(
      el('div.mp-head', icon('antenna'), el('h2', 'Host online')),
      el('div.mp-form', el('label', 'Your name'), name, el('label', 'Lobby password'), pass,
        el('div.help', 'You get a 6-letter join code. Anyone with the code (and the password, if you set one) can join. Keep this game open — you are the host.')),
      el('div.mp-actions', back(), el('button.btn.primary', { onclick: go }, 'Create game')));
  };

  const renderJoinOnline = () => {
    const name = nameInput();
    const code = el('input.mp-code', { placeholder: 'ABC123', maxLength: 8, value: settings.lastCode || '', onkeydown: (e) => (stop(e), e.key === 'Enter' && go()), oninput: () => (code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '')) });
    const pass = passInput('Only if the host set one');
    const go = async () => {
      unlockAudio();
      updateSettings({ playerName: name.value.trim() || 'Agent', lastCode: code.value });
      busy(`Joining ${code.value}…`);
      try { await net.joinOnline(code.value, name.value.trim() || 'Agent', pass.value); enterLobby(); } catch (err) { fail(err, 'join-online'); }
    };
    body.replaceChildren(
      el('div.mp-head', icon('key'), el('h2', 'Join with a code')),
      el('div.mp-form', el('label', 'Your name'), name, el('label', 'Join code'), code, el('label', 'Password'), pass),
      el('div.mp-actions', back(), el('button.btn.primary', { onclick: go }, 'Join')));
  };

  const renderHostLan = () => {
    const name = nameInput();
    const pass = passInput();
    if (desktop?.startLanHost) {
      const go = async () => {
        unlockAudio();
        updateSettings({ playerName: name.value.trim() || 'Host' });
        busy('Starting the LAN server…');
        try {
          lanInfo = await desktop.startLanHost({ port: DEFAULT_PORT, password: pass.value });
          await net.connect(toWsUrl(`localhost:${lanInfo.port}`), name.value.trim() || 'Host', pass.value);
          enterLobby();
        } catch (err) { fail(err, 'host-lan'); }
      };
      body.replaceChildren(
        el('div.mp-head', icon('monitor'), el('h2', 'Host on this network')),
        el('div.mp-form', el('label', 'Your name'), name, el('label', 'Lobby password'), pass, el('div.help', 'Starts the server inside the game. Teammates on the same Wi-Fi choose "Join on this network" and enter the address shown in the lobby.')),
        el('div.mp-actions', back(), el('button.btn.primary', { onclick: go }, 'Start hosting')));
      return;
    }
    const url = el('input.mp-url', { value: `localhost:${DEFAULT_PORT}`, onkeydown: stop });
    body.replaceChildren(
      el('div.mp-head', icon('monitor'), el('h2', 'Host on this network')),
      el('div.mp-steps',
        el('div.mp-step', el('b', '1.'), el('span', 'Start the server: run ', el('code', 'npm run mp'), ' or the ', el('b', 'Host Multiplayer'), ' launcher. It prints your Wi-Fi address.')),
        el('div.mp-step', el('b', '2.'), el('span', 'Share that address (e.g. ', el('code', '192.168.1.5'), ') with teammates on the same Wi-Fi.')),
        el('div.mp-step', el('b', '3.'), el('span', 'Connect below. (The desktop app does all of this with one button — or use Host online.)'))),
      el('div.mp-form', el('label', 'Your name'), name, el('label', 'Server'), url, el('label', 'Password'), passInput('Only if you started the server with MP_PASSWORD')),
      el('div.mp-actions', back(), el('button.btn.primary', { onclick: async () => {
        unlockAudio();
        updateSettings({ playerName: name.value.trim() || 'Host' });
        busy(`Connecting to ${url.value}…`);
        try { await net.connect(toWsUrl(url.value || `localhost:${DEFAULT_PORT}`), name.value.trim() || 'Host', body.querySelector('.mp-pass')?.value || ''); enterLobby(); } catch (err) { fail(err, 'host-lan'); }
      } }, 'Connect')));
  };

  const renderJoinLan = () => {
    const name = nameInput();
    const url = el('input.mp-url', { placeholder: 'e.g. 192.168.1.5', value: settings.lastHost || '', onkeydown: (e) => (stop(e), e.key === 'Enter' && go()) });
    const pass = passInput('Only if the host set one');
    const go = async () => {
      unlockAudio();
      const addr = url.value.trim();
      if (!addr) return toast('Enter the host address.', 'warn');
      updateSettings({ lastHost: addr, playerName: name.value.trim() || 'Agent' });
      busy(`Connecting to ${addr}…`);
      try { await net.connect(toWsUrl(addr), name.value.trim() || 'Agent', pass.value); enterLobby(); } catch (err) { fail(err, 'join-lan'); }
    };
    body.replaceChildren(
      el('div.mp-head', icon('wifi'), el('h2', 'Join on this network')),
      el('div.mp-form', el('label', 'Your name'), name, el('label', "Host's address"), url, el('label', 'Password'), pass, el('div.help', 'Ask the host for the address shown in their lobby. Same Wi-Fi required.')),
      el('div.mp-actions', back(), el('button.btn.primary', { onclick: go }, 'Join')));
  };

  const list = el('div.mp-roster');
  const renderRoster = (roster) => {
    const r = roster || net.rosterList();
    list.replaceChildren(...r.map((p) => el('div.mp-player', el('span.mp-dot', { style: { background: p.color || '#888' } }), el('b', p.name), p.you ? el('span.mp-you', 'you') : null)));
  };
  const renderLobby = () => {
    renderRoster();
    const copy = (text) => { try { navigator.clipboard?.writeText(text); toast('Copied!', 'good', 1500, { icon: 'clip' }); } catch { /* noop */ } };
    let where = null;
    if (net.mode === 'online') {
      where = el('div.mp-codebox', el('span', net.isHost ? 'Share this join code' : 'Joined game'), el('div.mp-bigcode', net.code),
        el('div.mp-codeacts', el('button.btn.small', { onclick: () => copy(net.code) }, icon('clip'), 'Copy code'), net.hasPassword ? el('span.mp-badge', icon('lock'), 'password protected') : null));
    } else if (lanInfo) {
      where = el('div.mp-codebox', el('span', 'Teammates on your Wi-Fi join:'), ...lanInfo.addresses.map((a) => el('div.mp-addr', `${a}:${lanInfo.port}`, el('button.btn.small', { onclick: () => copy(`${a}:${lanInfo.port}`) }, icon('clip')))));
    }
    const ownKey = (settings.apiKey || '').trim().length > 10;
    const share = el('label.mp-share', el('input', { type: 'checkbox', checked: !!settings.shareKey && ownKey, disabled: !ownKey, onchange: (e) => { updateSettings({ shareKey: e.target.checked }); net.shareKey(e.target.checked ? settings.apiKey : ''); sfx('click'); } }),
      el('div', el('b', 'Share my Groq key with the team'), el('span', ownKey ? 'Teammates without their own key can use yours for AI callers this session. Off by default — their usage counts against your free tier. Anyone with their own key keeps using theirs.' : 'Add your own Groq key in Settings to be able to share it.')));
    if (settings.shareKey && ownKey) net.shareKey(settings.apiKey);
    const keyInfo = session.sharedKey && !ownKey ? el('div.mp-keyinfo', icon('key'), `Using ${session.sharedBy || 'a teammate'}'s shared Groq key this session.`) : null;
    body.replaceChildren(
      el('div.mp-head', icon('users'), el('h2', 'Lobby'), el('p.muted', 'Waiting for the team. Anyone can start the shift when everyone is in.')),
      where,
      el('div.mp-lobby', el('div.mp-roster-head', 'Call floor'), list),
      share, keyInfo,
      el('div.mp-actions',
        el('button.btn.ghost', { onclick: () => leave() }, 'Leave'),
        el('button.btn.big.primary', { onclick: () => (unlockAudio(), sfx('click'), net.startShift()) }, 'Start shift ▶')));
  };
  const leave = async () => {
    net.disconnect();
    if (lanInfo && desktop?.stopLanHost) { try { await desktop.stopLanHost(); } catch { /* noop */ } lanInfo = null; }
    mode = 'home';
    render();
  };

  const offRoster = bus.on('net:roster', (r) => mode === 'lobby' && renderRoster(r));
  const offKey = bus.on('net:sharedkey', () => mode === 'lobby' && renderLobby());
  const offClose = bus.on('net:close', () => { if (mode === 'lobby') { mode = 'home'; render(); toast('Disconnected from the host.', 'warn', 5000, { icon: 'wifi-off' }); } });
  render();

  const m = modal(body, { className: 'mp-modal', onClose: () => { offRoster(); offClose(); offKey(); if (!game.mp) { net.disconnect(); if (lanInfo) desktop?.stopLanHost?.(); } onClose?.(); } });
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
  bus.on('net:chat', (m) => { if (m.id !== net.id) toast(m.text, 'info', 4000, { icon: 'chat', title: `${m.name} · #team` }); });
  bus.on('net:sharedkey', (m) => { if (!(settings.apiKey || '').trim()) toast(m.on ? `${m.from} shared their Groq key — AI callers are on.` : 'The shared Groq key was withdrawn. Offline callers until you add your own key.', m.on ? 'info' : 'warn', 5000, { icon: 'key' }); });
  bus.on('net:dm', (m) => toast(m.text, 'info', 4500, { icon: 'chat', title: `${m.name} (private)` }));
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
