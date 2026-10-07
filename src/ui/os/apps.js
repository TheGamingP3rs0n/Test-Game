// App registry for your work PC + the "office" apps: Phone, Notes, Cashier, Playbook,
// Messenger, Files, DefendoMax antivirus.
import { el, setText, money, clockText, uid, downloadBlob, dataURLToBlob } from '../../core/util.js';
import { bus } from '../../core/bus.js';
import { sfx } from '../../core/audio.js';
import { content } from '../../game/content.js';
import { COWORKERS, BOSS_CONTACT, coworkerReply } from '../../ai/coworkers.js';
import { avatarDataUri } from '../portraits.js';
import { remoteApp } from './remoteApp.js';
import { browserApp } from './browserApp.js';
import { paintApp, recorderApp, docforgeApp, siteforgeApp } from './creativeApps.js';
import { scamApp } from './scamApps.js';
import { scamazonApp, meteorCookieApp, disscordApp } from './extraApps.js';

/** Persist a file in the run (paintings, photos, clips, documents). */
export function saveFile(game, file) {
  game.run.files = game.run.files || [];
  const f = { id: uid('file'), created: Date.now(), ...file };
  game.run.files.push(f);
  bus.emit('files:changed');
  return f;
}

export function addIntel(game, fact) {
  const callerId = game.calls.caller?.id || 'unknown';
  game.run.intel = game.run.intel || [];
  if (game.run.intel.some((i) => i.callerId === callerId && i.label === fact.label && i.value === fact.value)) return false;
  game.run.intel.push({ ...fact, callerId, callerName: game.calls.caller?.name || '?' });
  bus.emit('intel:added', fact);
  sfx('notify');
  return true;
}

export function buildApps(ctx) {
  const { game } = ctx;
  return {
    phone: { name: 'Phone', icon: '📞', width: 420, height: 440, render: (win) => phoneApp(game, win) },
    remote: { name: 'RemoteHelp', icon: '🖥️', width: 980, height: 620, render: (win) => remoteApp(game, win, ctx) },
    notes: { name: 'Notes', icon: '📝', width: 520, height: 460, render: () => notesApp(game) },
    browser: { name: 'Browser', icon: '🌐', width: 860, height: 560, render: (win, opts) => browserApp(game, win, opts) },
    cashier: { name: 'Cashier', icon: '💰', width: 520, height: 460, render: (win) => cashierApp(game, win) },
    giftcards: { name: 'Gift Cards', icon: '🎁', width: 460, height: 520, render: (win) => scamApp(game, win, 'giftcards') },
    creditcard: { name: 'Credit Card', icon: '💳', width: 460, height: 520, render: (win) => scamApp(game, win, 'creditcard') },
    identity: { name: 'Identity', icon: '🆔', width: 460, height: 520, render: (win) => scamApp(game, win, 'identity') },
    playbook: { name: 'Playbook', icon: '📘', width: 560, height: 520, render: () => playbookApp(game) },
    messenger: { name: 'Messenger', icon: '💬', width: 620, height: 460, render: (win) => messengerApp(game, win) },
    files: { name: 'Files', icon: '📁', width: 640, height: 440, render: (win) => filesApp(game, win, ctx) },
    antivirus: { name: 'DefendoMax', icon: '🛡️', width: 420, height: 300, render: (win) => antivirusApp(game, win) },
    recorder: { name: 'Recorder', icon: '⏺️', width: 460, height: 340, render: (win) => recorderApp(game, win) },
    paint: { name: 'Paint', icon: '🎨', width: 760, height: 560, render: (win) => paintApp(game, win) },
    docforge: { name: 'DocForge', icon: '📄', width: 820, height: 600, render: (win) => docforgeApp(game, win) },
    siteforge: { name: 'SiteForge', icon: '🕸️', width: 820, height: 600, render: (win) => siteforgeApp(game, win) },
    scamazon: { name: 'Scamazon', icon: '🛒', width: 680, height: 540, render: (win) => scamazonApp(game, win) },
    meteorcookie: { name: 'Meteor Cookie', icon: '🍪', width: 420, height: 520, render: (win) => meteorCookieApp(game, win) },
    disscord: { name: 'Disscord', icon: '💬', width: 560, height: 480, render: (win) => disscordApp(game, win) },
  };
}

// ---------------------------------------------------------------------------
function phoneApp(game, win) {
  const body = el('div.pad');
  const render = () => {
    const c = game.calls;
    body.replaceChildren(
      el('h3', { style: { margin: '0 0 8px' } }, '📞 Line 1'),
      c.state === 'ringing' ? el('div', el('p', `Incoming: ${c.caller.name}`), el('button.xp-btn.primary', { onclick: () => c.answer() }, 'Answer')) :
      c.active ? el('div', el('p', `On call with ${c.caller.name} — ${Math.floor(c.callTime)}s`), el('button.xp-btn.red', { onclick: () => c.end('agent_hung_up') }, 'Hang up')) :
      el('p', { style: { color: '#666' } }, 'No active call. Calls arrive automatically.'),
      el('h3', { style: { margin: '14px 0 6px' } }, "Today's call log"),
      el('div.list', (game.day?.callLog || []).slice().reverse().map((l) => el('div.li', el('span', l.paid ? '💰' : l.outcome === 'exposed' ? '🔴' : l.outcome === 'flagged' ? '🚩' : '📵'), el('span', { style: { flex: 1 } }, `${l.name} — ${l.scenario}`), el('b', l.paid ? money(l.paid) : l.outcome.replace(/_/g, ' '))))),
    );
  };
  render();
  const offs = ['call:ring', 'call:start', 'call:end'].map((e) => bus.on(e, render));
  win.onClose = () => offs.forEach((o) => o());
  return body;
}

function notesApp(game) {
  const ta = el('textarea.notes-area', { value: game.run.notes || '', oninput: () => (game.run.notes = ta.value), spellcheck: false });
  const intel = el('div.list.intel-list');
  const renderIntel = () => {
    const items = (game.run.intel || []).slice().reverse();
    intel.replaceChildren(
      el('div', { style: { padding: '8px 10px', fontWeight: 800, background: '#eef3ff' } }, '🕵️ Intel collected (click facts in a victim\'s files)'),
      ...(items.length ? items.map((f) => el('div.li', el('span', '🔎'), el('div', { style: { flex: 1 } }, el('b', `${f.label}: `), f.value, el('div', { style: { fontSize: '11px', color: '#777' } }, f.callerName)))) : [el('div.li', { style: { color: '#888' } }, 'Nothing yet. Remote into a caller\'s PC and click highlighted details.')]),
    );
  };
  renderIntel();
  const off = bus.on('intel:added', () => (intel.isConnected ? renderIntel() : off()));
  return el('div.split', el('div.main', { style: { flex: 1.3 } }, ta), el('div.side', { style: { width: '220px', background: '#fff' } }, intel));
}

function cashierApp(game, win) {
  const body = el('div.cashier');
  const APP = { giftcards: 'Gift Cards', creditcard: 'Credit Card', identity: 'Identity' };
  const render = () => {
    const pays = (game.day?.pendingPayments || []).slice().reverse();
    const pending = pays.filter((p) => p.status === 'pending' && !p.fake);
    body.replaceChildren(
      el('div.app-toolbar',
        el('div', el('div', { style: { fontSize: '12px', color: '#555' } }, 'Collected today'), el('div.stat', money(game.day?.earned || 0))),
        el('div', { style: { marginLeft: '20px' } }, el('div', { style: { fontSize: '12px', color: '#555' } }, 'Waiting to collect'), el('div.stat', { style: { color: '#c77700' } }, money(game.pendingTotal())))),
      pending.length ? el('div', { style: { padding: '8px 12px', fontSize: '12px', color: '#555' } }, 'Enter each caller\'s code in the app shown to collect it.') : null,
      pays.length ? null : el('div', { style: { padding: '20px', color: '#777' } }, 'No payments yet. Build a caller\'s trust, then get them to read you a gift card code, card verification code, or ID number.'),
      ...pays.map((p) => el('div.pay',
        el('div.amt', money(p.amount)),
        el('div', { style: { flex: 1 } }, el('b', `${APP[p.app] || p.app} — ${p.from}`), el('div', { style: { fontSize: '12px', color: '#666' } }, `at ${clockText(p.time || 540)}`)),
        p.status === 'collected' ? el('b', { style: { color: '#137a43' } }, '✔ collected')
          : p.status === 'invalid' ? el('b', { style: { color: '#c62828' } }, '✖ INVALID')
          : p.status === 'expired' ? el('b', { style: { color: '#999' } }, 'expired')
          : el('button.xp-btn.primary', { onclick: () => win.desktop.open(p.app) }, `Open ${APP[p.app] || p.app}`))),
    );
  };
  render();
  const offs = ['call:payment', 'money:changed', 'call:end'].map((e) => bus.on(e, () => body.isConnected && render()));
  win.onClose = () => offs.forEach((o) => o());
  return body;
}

function playbookApp(game) {
  const day = game.day?.day || 1;
  return el('div.pad.playbook',
    el('h3', { style: { marginTop: 0 } }, '📘 The Official Global Solutions Playbook'),
    el('p', { style: { fontSize: '12px', color: '#555' } }, 'Improvise! The AI callers react to whatever you actually say. These are just proven moves.'),
    ...content.scenarios.map((s) => el(`div.sc${s.unlockDay > day ? '.locked' : ''}`,
      el('h4', `${s.icon || '📞'} ${s.name} ${s.unlockDay > day ? `🔒 (Day ${s.unlockDay})` : ''}`),
      el('div', { style: { fontSize: '12px', color: '#555' } }, `Pretend to be: ${s.impersonate}. Lead: ${s.leadSource}`),
      s.unlockDay <= day ? el('ol', s.playbook.map((step) => el('li', step))) : null)),
    el('h4', '🚩 Spotting scambaiters'),
    el('ul', ['Too eager to buy gift cards, or happy to read codes before you even ask', 'Their PC says "VirtualBox", has OBS recording, or files about scammers', 'Gift card codes that come back INVALID when you Verify them', 'They send you files ending in .exe — never open those', 'Ask them something only a real old person would know... or just flag them (🚩) for a bounty'].map((t) => el('li', t))),
    el('h4', '💡 How to get paid'),
    el('ul', ['Build trust first, THEN ask them to read you a gift card code, card verification code, or ID number', 'Their code appears in the Phone transcript — type it into the matching app (Gift Cards / Credit Card / Identity) and hit Verify', 'Enter codes before 5 PM — uncollected codes are lost at the end of the shift', 'Use details from their PC (pet names, bank, family) to push trust higher and unlock bigger payouts', 'Scambaiters read FAKE codes that come back INVALID and raise police heat — check suspicious ones in GiftCheck first'].map((t) => el('li', t))),
  );
}

function messengerApp(game, win) {
  const contacts = [...COWORKERS, BOSS_CONTACT];
  game.run.chats = game.run.chats || {};
  let current = contacts[0].id;
  const unread = {};
  const list = el('div.contacts');
  const msgs = el('div.msgs');
  const input = el('input', { placeholder: 'Message…', onkeydown: (e) => (e.stopPropagation(), e.key === 'Enter' && send()) });
  const renderContacts = () => list.replaceChildren(...contacts.map((c) => el(`div.contact${c.id === current ? '.on' : ''}`, { onclick: () => ((current = c.id), (unread[c.id] = 0), renderAll()) }, el('img', { src: avatarDataUri(c.avatar, 'happy') }), el('div', el('b', c.name), el('div', { style: { fontSize: '11px', color: '#777' } }, `"${c.alias}"`)), unread[c.id] ? el('span.unread', unread[c.id]) : null)));
  const renderMsgs = () => {
    const thread = game.run.chats[current] || [];
    msgs.replaceChildren(...thread.map((m) => el(`div.bub${m.from === 'me' ? '.me' : ''}`, m.text)));
    msgs.scrollTop = msgs.scrollHeight;
  };
  const renderAll = () => (renderContacts(), renderMsgs());
  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const id = current;
    (game.run.chats[id] = game.run.chats[id] || []).push({ from: 'me', text });
    renderMsgs();
    const contact = contacts.find((c) => c.id === id);
    const reply = await coworkerReply(contact, game.run.chats[id], text);
    game.run.chats[id].push({ from: id, text: reply });
    if (current === id) renderMsgs();
    else (unread[id] = (unread[id] || 0) + 1), renderContacts();
    sfx('notify');
  };
  const off = bus.on('chat:message', (m) => {
    if (current !== m.from) unread[m.from] = (unread[m.from] || 0) + 1;
    renderAll();
  });
  win.onClose = off;
  renderAll();
  return el('div.chat', list, el('div.thread', msgs, el('div.compose', input, el('button.xp-btn.primary', { onclick: send }, 'Send'))));
}

/** Coworker messages are stored even when Messenger is closed. */
export function bindChatStore(game) {
  bus.on('chat:message', (m) => {
    if (!game.run) return;
    game.run.chats = game.run.chats || {};
    const t = (game.run.chats[m.from] = game.run.chats[m.from] || []);
    if (t[t.length - 1]?.text !== m.text) t.push({ from: m.from, text: m.text });
  });
}

function filesApp(game, win) {
  const main = el('div.main');
  let folder = 'All';
  const side = el('div.side');
  const kinds = { All: null, Recordings: 'video', Photos: 'photo', Paintings: 'painting', Documents: 'document', Websites: 'site' };
  const render = () => {
    side.replaceChildren(...Object.keys(kinds).map((k) => el('div.li' + (k === folder ? '' : ''), { style: { padding: '8px 10px', cursor: 'pointer', fontWeight: k === folder ? 800 : 400 }, onclick: () => ((folder = k), render()) }, `📁 ${k}`)));
    const files = (game.run.files || []).filter((f) => !kinds[folder] || f.kind === kinds[folder]);
    main.replaceChildren(
      files.length ? el('div.gallery', ...files.slice().reverse().map((f) => el('div', { style: { textAlign: 'center', fontSize: '11px', cursor: 'pointer' }, onclick: () => openFile(f) },
        f.kind === 'video' ? el('div', { style: { fontSize: '48px' } }, '🎬') : f.kind === 'document' ? el('div', { style: { fontSize: '48px' } }, '📄') : f.kind === 'site' ? el('div', { style: { fontSize: '48px' } }, '🕸️') : el('img', { src: f.url }),
        el('div', f.name)))) : el('div', { style: { padding: '20px', color: '#777' } }, 'Empty. Make something with Paint, Camera, Recorder, DocForge or SiteForge.'),
    );
  };
  const openFile = (f) => {
    const d = win.desktop;
    if (f.kind === 'site') return d.open('browser', { key: f.id, url: f.url });
    const w = d.open('files', { key: f.id, title: f.name, width: 640, height: 480 });
    if (!w) return;
    w.setBody(el('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
      el('div.app-toolbar', el('button.xp-btn', { onclick: async () => downloadBlob(f.blob || (await dataURLToBlob(f.url)), f.name) }, '💾 Save to your real computer')),
      el('div', { style: { flex: 1, overflow: 'auto', background: '#222', display: 'flex', alignItems: 'center', justifyContent: 'center' } },
        f.kind === 'video' ? el('video', { src: f.url, controls: true, style: { maxWidth: '100%', maxHeight: '100%' } }) : f.kind === 'document' ? el('div', { html: f.html, style: { background: '#fff', maxWidth: '100%' } }) : el('img', { src: f.url, style: { maxWidth: '100%', maxHeight: '100%' } }))));
  };
  render();
  const off = bus.on('files:changed', render);
  win.onClose = off;
  return el('div.split', side, main);
}

function antivirusApp(game, win) {
  const bar = el('div');
  const status = el('div', game.virus ? '⚠️ THREATS DETECTED. Your PC is infected!' : '✅ Your PC is protected (probably).');
  const btn = el('button.xp-btn.primary', { onclick: () => scan() }, '🔍 Scan now');
  const scan = () => {
    btn.disabled = true;
    let p = 0;
    status.textContent = 'Scanning… (please do not panic)';
    const t = setInterval(() => {
      p += 4 + Math.random() * 6;
      bar.style.width = `${Math.min(100, p)}%`;
      if (p >= 100) {
        clearInterval(t);
        btn.disabled = false;
        if (game.virus) {
          setText(status, `☣️ Removed ${Math.floor(Math.random() * 3000) + 300} threats, including "BonziBuddy" and "grandma_gets_even.dll".`);
          sfx('win');
          if (game.chaos.active?.def.type === 'virus') game.chaos.finish(true);
          else game.virus = false;
        } else status.textContent = 'No threats found. DefendoMax would like a 5-star review.';
      }
    }, 200);
  };
  return el('div.av-scan', el('h3', { style: { margin: '0 0 6px' } }, '🛡️ DefendoMax Antivirus 2009'), status, el('div.bar', bar), btn);
}
