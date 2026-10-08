// Messenger — message the people in the game:
//   #floor   the office group chat (coworkers gossip here; post and someone answers)
//   #team    co-op only: the real players on your shift
//   DMs      each coworker (AI), Mr. Chatterjee (ALL CAPS), and each co-op teammate
// Coworkers who message you also say it out loud at their desk in the 3D office.
import { el, clockText } from '../../core/util.js';
import { bus } from '../../core/bus.js';
import { sfx } from '../../core/audio.js';
import { net } from '../../net/net.js';
import { COWORKERS, BOSS_CONTACT, coworkerReply } from '../../ai/coworkers.js';
import { avatarDataUri } from '../portraits.js';
import { icon } from '../icons.js';

const STATUS = ['at desk', 'on a call', 'on a call', 'on chai break', 'hiding from the boss'];

function threads(game) {
  const list = [{ id: 'floor', kind: 'channel', name: 'floor', title: '#floor', sub: 'Everyone on the call floor' }];
  if (game.mp && net.active) list.push({ id: 'team', kind: 'channel', name: 'team', title: '#team', sub: 'Your co-op shift (real players)' });
  for (const c of COWORKERS) list.push({ id: c.id, kind: 'ai', contact: c, title: c.name, sub: `"${c.alias}"` });
  list.push({ id: 'boss', kind: 'ai', contact: BOSS_CONTACT, title: BOSS_CONTACT.name, sub: 'in his office' });
  if (game.mp && net.active) for (const pl of net.rosterList()) if (!pl.you) list.push({ id: `p:${pl.id}`, kind: 'player', player: pl, title: pl.name, sub: 'teammate · online' });
  return list;
}

/** Make the matching 3D coworker say the line at their desk. */
function sayIn3D(game, fromId, text) {
  const c = COWORKERS.find((x) => x.id === fromId);
  if (!c) return;
  const npc = game.world?.office?.coworkers?.find((n) => n.label === c.name);
  if (npc) npc.say(text.length > 42 ? `${text.slice(0, 40)}…` : text, 3.5);
}

export function pushChat(game, threadId, msg, { unread = true } = {}) {
  if (!game.run) return;
  game.run.chats = game.run.chats || {};
  const t = (game.run.chats[threadId] = game.run.chats[threadId] || []);
  if (t.length && t[t.length - 1].text === msg.text && t[t.length - 1].from === msg.from) return;
  t.push({ time: game.clock, ...msg });
  if (t.length > 120) t.splice(0, t.length - 120);
  if (unread && msg.from !== 'me') {
    game.chatUnread = game.chatUnread || {};
    game.chatUnread[threadId] = (game.chatUnread[threadId] || 0) + 1;
  }
  bus.emit('messenger:changed', threadId);
}

/** Store chat traffic even while Messenger is closed (called once at boot). */
export function bindChatStore(game) {
  // scripted office gossip → #floor (and the coworker says it at their desk)
  bus.on('chat:message', (m) => {
    pushChat(game, 'floor', { from: m.from, text: m.text });
    sayIn3D(game, m.from, m.text);
  });
  bus.on('net:chat', (m) => { if (m.id !== net.id) pushChat(game, 'team', { from: `p:${m.id}`, name: m.name, text: m.text }); });
  bus.on('net:dm', (m) => pushChat(game, `p:${m.from}`, { from: `p:${m.from}`, name: m.name, text: m.text }));
}

export function messengerApp(game, win) {
  game.run.chats = game.run.chats || {};
  game.chatUnread = game.chatUnread || {};
  const statusOf = {};
  for (const c of COWORKERS) statusOf[c.id] = STATUS[Math.floor(Math.random() * STATUS.length)];
  let current = 'floor';
  const typing = new Set(); // thread ids with an AI reply in flight

  const side = el('div.ms-side');
  const head = el('div.ms-head');
  const msgs = el('div.ms-msgs');
  const input = el('input.ms-input', { placeholder: 'Message #floor', maxLength: 240, onkeydown: (e) => { e.stopPropagation(); if (e.key === 'Enter') send(); } });

  const avatarFor = (th, from) => {
    if (from === 'me') return null;
    const cw = COWORKERS.find((c) => c.id === from) || (from === 'boss' ? BOSS_CONTACT : null);
    if (cw) return el('img.ms-av', { src: avatarDataUri(cw.avatar, 'happy') });
    return el('span.ms-av.ms-av-init', (th?.player?.name || '?')[0].toUpperCase());
  };
  const nameOf = (m) => {
    if (m.from === 'me') return 'You';
    if (m.name) return m.name;
    const cw = COWORKERS.find((c) => c.id === m.from);
    return cw ? cw.name : m.from === 'boss' ? BOSS_CONTACT.name : m.from;
  };

  const renderSide = () => {
    const all = threads(game);
    const row = (th) => {
      const n = game.chatUnread[th.id] || 0;
      const av = th.kind === 'channel' ? el('span.ms-av.ms-chan', icon(th.id === 'team' ? 'users' : 'chat'))
        : th.kind === 'player' ? el('span.ms-av.ms-av-init', { style: { background: th.player.color || '#2b6cff' } }, th.player.name[0].toUpperCase())
          : el('img.ms-av', { src: avatarDataUri(th.contact.avatar, 'happy') });
      const sub = th.kind === 'ai' && th.id !== 'boss' ? statusOf[th.id] : th.sub;
      const dot = th.kind === 'channel' ? null : el(`span.ms-dot${sub === 'on a call' ? '.busy' : ''}`);
      return el(`div.ms-row${th.id === current ? '.on' : ''}`, { onclick: () => { current = th.id; game.chatUnread[th.id] = 0; render(); input.focus(); } },
        el('div.ms-avwrap', av, dot), el('div.ms-meta', el('b', th.title), el('span', sub)), n ? el('span.ms-badge', n > 9 ? '9+' : n) : null);
    };
    const chans = all.filter((t) => t.kind === 'channel');
    const people = all.filter((t) => t.kind !== 'channel');
    side.replaceChildren(el('div.ms-brand', icon('chat'), 'Messenger'), el('div.ms-sec', 'Channels'), ...chans.map(row), el('div.ms-sec', 'Direct messages'), ...people.map(row));
  };

  const renderThread = () => {
    const th = threads(game).find((t) => t.id === current) || threads(game)[0];
    current = th.id;
    head.replaceChildren(el('b', th.title), el('span', th.kind === 'ai' && th.id !== 'boss' ? statusOf[th.id] : th.sub));
    input.placeholder = `Message ${th.kind === 'channel' ? th.title : th.title}`;
    const list = game.run.chats[current] || [];
    const nodes = [];
    let prev = null;
    for (const m of list) {
      const mine = m.from === 'me';
      const grouped = prev && prev.from === m.from;
      nodes.push(el(`div.ms-msg${mine ? '.me' : ''}${grouped ? '.grouped' : ''}`,
        !mine && !grouped ? avatarFor(th, m.from) : el('span.ms-av-gap'),
        el('div.ms-bubble', !grouped ? el('div.ms-from', nameOf(m), m.time != null ? el('time', clockText(m.time)) : null) : null, el('div.ms-text', m.text))));
      prev = m;
    }
    if (!list.length) nodes.push(el('div.ms-empty', icon('chat'), th.kind === 'channel' ? 'No messages yet. Say hi to the floor.' : `Start a conversation with ${th.title}.`));
    if (typing.has(current)) nodes.push(el('div.ms-typing', el('span'), el('span'), el('span'), ` ${current === 'floor' ? 'someone' : th.title} is typing…`));
    msgs.replaceChildren(...nodes);
    msgs.scrollTop = msgs.scrollHeight;
  };
  const render = () => { renderSide(); renderThread(); };

  async function aiReply(threadId, contact, group) {
    typing.add(threadId);
    renderThread();
    const hist = game.run.chats[threadId] || [];
    const last = [...hist].reverse().find((m) => m.from === 'me');
    const reply = await coworkerReply(contact, hist.slice(0, hist.lastIndexOf(last)), last?.text || 'hey', { group });
    typing.delete(threadId);
    pushChat(game, threadId, { from: contact.id, text: reply }, { unread: current !== threadId || !msgs.isConnected });
    sayIn3D(game, contact.id, reply);
    sfx('notify');
  }

  function send() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const th = threads(game).find((t) => t.id === current);
    pushChat(game, current, { from: 'me', text }, { unread: false });
    if (th.kind === 'player') net.dm(th.player.id, text);
    else if (th.id === 'team') net.chat(text);
    else if (th.id === 'floor') {
      // whoever you name answers; otherwise a random coworker chimes in (sometimes nobody)
      const named = COWORKERS.find((c) => new RegExp(`\\b${c.name}\\b`, 'i').test(text));
      const who = named || (Math.random() < 0.75 ? COWORKERS[Math.floor(Math.random() * COWORKERS.length)] : null);
      if (who) setTimeout(() => aiReply('floor', who, true), 500 + Math.random() * 1200);
    } else {
      setTimeout(() => aiReply(current, th.contact, false), 400 + Math.random() * 900);
    }
  }

  const off = bus.on('messenger:changed', (id) => { if (id === current) game.chatUnread[id] = 0; render(); });
  const offRoster = bus.on('net:roster', () => renderSide());
  win.onClose = () => { off(); offRoster(); };
  game.chatUnread[current] = 0;
  render();
  setTimeout(() => input.focus(), 50);
  return el('div.messenger', side, el('div.ms-main', head, msgs, el('div.ms-compose', input, el('button.ms-send', { onclick: send, title: 'Send' }, icon('send')))));
}
