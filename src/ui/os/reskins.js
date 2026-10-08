// Reskinned work-PC utilities: a softphone (Phone), an OBS-style screen recorder
// (Recorder) and a "real" antivirus suite (DefendoMax). Same behaviour as before,
// proper app UIs instead of a heading and two buttons.
import { el, money, downloadBlob } from '../../core/util.js';
import { bus } from '../../core/bus.js';
import { sfx } from '../../core/audio.js';
import { icon } from '../icons.js';
import { portraitFor } from '../portraits.js';
import { saveFile } from './apps.js';

const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ---------------------------------------------------------------- Phone (softphone)
export function phoneApp(game, win) {
  const body = el('div.ph');
  let timerEl = null;
  const stat = (label, v) => el('div.ph-stat', el('b', String(v)), el('span', label));
  const render = () => {
    const c = game.calls;
    const st = c.state;
    const caller = c.caller;
    timerEl = st === 'active' ? el('div.ph-timer', mmss(c.callTime)) : null;
    const card = caller
      ? el(`div.ph-card.${st}`, el('div.ph-avwrap', el('img.ph-av', { src: portraitFor(caller, st === 'active' ? c.conv?.emotion || 'neutral' : 'neutral') })),
        el('div.ph-name', caller.name), el('div.ph-sub', caller.location || ''), caller.scenario ? el('div.ph-scam', icon('target'), caller.scenario.name) : null, timerEl)
      : el('div.ph-card.idle', el('div.ph-idle', icon('phone')), el('div.ph-name', 'No active call'), el('div.ph-sub', 'Calls ring automatically — stay near your desk.'));
    const actions = st === 'ringing'
      ? el('div.ph-actions', el('button.ph-round.decline', { title: 'Decline', onclick: () => c.decline() }, icon('phone-off')), el('button.ph-round.answer', { title: 'Answer (F)', onclick: () => c.answer() }, icon('phone')))
      : st === 'active' ? el('div.ph-actions', el('button.ph-round.decline', { title: 'Hang up', onclick: () => c.end('agent_hung_up') }, icon('phone-off'))) : null;
    const d = game.day || {};
    const log = (d.callLog || []).slice().reverse();
    body.replaceChildren(
      el('div.ph-top', el('span.ph-line', icon('headphones'), 'Line 1 · ext. 4471'), el(`span.ph-pill.${st}`, st === 'ringing' ? 'Ringing' : st === 'active' ? 'On call' : 'Available')),
      card, actions,
      el('div.ph-stats', stat('Answered', d.callsTaken || 0), stat('Scammed', d.scamsWon || 0), stat('Missed', d.missedCalls || 0)),
      el('div.ph-loghead', 'Recent calls'),
      el('div.ph-log', ...(log.length ? log.map((l) => el('div.ph-row',
        el(`span.ph-ic${l.paid ? '.won' : '.lost'}`, icon(l.paid ? 'payout' : l.outcome === 'exposed' ? 'video' : l.outcome === 'flagged' ? 'flag' : 'phone-missed')),
        el('div.ph-rowmeta', el('b', l.name), el('span', l.scenario)),
        el(`b.ph-amt${l.paid ? '.won' : ''}`, l.paid ? money(l.paid) : l.outcome.replace(/_/g, ' ')))) : [el('div.ph-empty', 'No calls yet today.')])),
    );
  };
  render();
  const offs = ['call:ring', 'call:start', 'call:end', 'call:missed', 'call:update'].map((e) => bus.on(e, render));
  const t = setInterval(() => { if (timerEl && game.calls.active) timerEl.textContent = mmss(game.calls.callTime); }, 500);
  win.onClose = () => { offs.forEach((o) => o()); clearInterval(t); };
  return body;
}

// ---------------------------------------------------------------- Recorder (OBS-style)
export function recorderApp(game, win) {
  let rec = null;
  let chunks = [];
  let stream = null;
  let t0 = 0;
  let tick = null;
  const preview = el('div.obs-preview', el('div.obs-idle', icon('monitor'), el('b', 'Display Capture'), el('span', 'Press Start Recording and pick this tab to clip your calls.')));
  const recBadge = el('span.obs-rec', '● REC 00:00');
  const statusTime = el('span', 'REC 00:00:00');
  const startBtn = el('button.obs-btn.start', { onclick: () => start() }, icon('rec'), 'Start Recording');
  const stopBtn = el('button.obs-btn', { onclick: () => stop(), disabled: true }, icon('square'), 'Stop Recording');
  const result = el('div.obs-result');
  const setRecording = (on) => {
    preview.classList.toggle('live', on);
    startBtn.disabled = on; stopBtn.disabled = !on;
    if (on) {
      t0 = performance.now();
      preview.replaceChildren(el('div.obs-live', icon('video'), el('b', 'Recording this tab…'), el('span', 'Everything you see and hear is being captured.')), recBadge);
      tick = setInterval(() => { const s = (performance.now() - t0) / 1000; recBadge.textContent = `● REC ${mmss(s)}`; statusTime.textContent = `REC 00:${mmss(s)}`; }, 250);
    } else {
      clearInterval(tick);
      preview.replaceChildren(el('div.obs-idle', icon('monitor'), el('b', 'Display Capture'), el('span', 'Ready.')));
    }
  };
  const start = async () => {
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true, preferCurrentTab: true, selfBrowserSurface: 'include' });
    } catch (err) {
      result.replaceChildren(el('span.obs-err', `Couldn't start capture: ${err.message}`));
      return;
    }
    chunks = [];
    rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : 'video/webm' });
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      saveFile(game, { kind: 'video', name: `clip_${new Date().toLocaleTimeString().replace(/\W/g, '')}.webm`, url, blob });
      result.replaceChildren(el('span', icon('check'), 'Clip saved to Files.'), el('button.obs-btn.small', { onclick: () => downloadBlob(blob, 'scam-call-center-clip.webm') }, icon('download'), 'Download'));
      stream.getTracks().forEach((tr) => tr.stop());
      bus.emit('recorder', false);
      setRecording(false);
    };
    stream.getVideoTracks()[0].addEventListener('ended', () => rec?.state === 'recording' && stop());
    rec.start(500);
    setRecording(true);
    bus.emit('recorder', true);
  };
  const stop = () => { if (rec?.state === 'recording') rec.stop(); };
  win.onClose = () => { stop(); clearInterval(tick); };
  const dock = (title, ...rows) => el('div.obs-dock', el('div.obs-dock-h', title), ...rows);
  return el('div.obs',
    preview,
    el('div.obs-docks',
      dock('Scenes', el('div.obs-item.on', 'Call Clip'), el('div.obs-item', 'Boss Rant (unused)')),
      dock('Sources', el('div.obs-item', icon('monitor'), 'Display Capture'), el('div.obs-item', icon('mic'), 'Headset Mic')),
      dock('Controls', startBtn, stopBtn, result)),
    el('div.obs-status', el('span', 'Tip: pick "this tab" when your browser asks.'), el('span.obs-spacer'), statusTime, el('span', 'CPU 3.1%'), el('span', '30.00 / 30.00 FPS')));
}

// ---------------------------------------------------------------- DefendoMax (antivirus suite)
const SCAN_PATHS = ['C:\\Windoze\\System32\\drivers\\etc\\hosts', 'C:\\Users\\Agent\\Desktop\\quota_tips.txt', 'C:\\Program Files\\Rainbit\\definitely_not_rigged.dll', 'C:\\Windoze\\Temp\\grandma_gets_even.dll', 'C:\\Users\\Agent\\Downloads\\free_nitro.exe', 'C:\\Program Files\\Meteor Cookie\\cookies.db', 'C:\\Windoze\\System32\\koi_rajesh.sys', 'C:\\Users\\Agent\\AppData\\Local\\Temp\\bonzi.tmp'];
const QUARANTINE = [['BonziBuddy.exe', 'Adware.Purple.Gorilla'], ['free_nitro.exe', 'Trojan.Disscord.Gift'], ['grandma_gets_even.dll', 'Backdoor.Scambaiter.Stream'], ['ScreenSaver_Fish.scr', 'Riskware.Koi']];

export function antivirusApp(game, win) {
  let view = 'status';
  let scanning = false;
  let scanTimer = null;
  const nav = el('div.dm-nav');
  const main = el('div.dm-main');
  game.run.avStats = game.run.avStats || { blocked: 1200 + Math.floor(Math.random() * 900), lastScan: null };
  const st = game.run.avStats;

  const renderNav = () => nav.replaceChildren(
    el('div.dm-logo', icon('shield'), el('div', el('b', 'DefendoMax'), el('span', 'Total Security 2009'))),
    ...[['status', 'Status', 'shield'], ['scan', 'Scan', 'search'], ['quarantine', 'Quarantine', 'biohazard'], ['settings', 'Settings', 'settings']].map(([id, l, ic]) =>
      el(`div.dm-navitem${view === id ? '.on' : ''}`, { onclick: () => { if (!scanning) { view = id; render(); } } }, icon(ic), l)),
    el('div.dm-upsell', el('b', 'PRO trial: 3 days left'), el('span', 'Upgrade for real-time protection against scambaiters.'), el('button', { onclick: () => bus.emit('toast', { kind: 'warn', icon: 'card', text: 'DefendoMax PRO costs $49.99/yr. You run a scam call center. You know better.' }) }, 'Upgrade')));

  const ring = (pct, cls, inner) => el(`div.dm-ring.${cls}`, { style: { '--p': `${pct}` } }, el('div.dm-ring-inner', ...inner));

  const startScan = () => {
    view = 'scan'; scanning = true; renderNav();
    let p = 0;
    const pathEl = el('div.dm-path');
    const pctEl = el('b', '0%');
    const r = ring(0, 'scan', [pctEl, el('span', 'Scanning')]);
    main.replaceChildren(el('div.dm-center', r, el('h2', 'Smart Scan in progress'), pathEl, el('p.dm-muted', 'Please do not panic. DefendoMax is panicking for you.')));
    scanTimer = setInterval(() => {
      p = Math.min(100, p + 3 + Math.random() * 6);
      r.style.setProperty('--p', p);
      pctEl.textContent = `${Math.floor(p)}%`;
      pathEl.textContent = SCAN_PATHS[Math.floor(Math.random() * SCAN_PATHS.length)];
      if (p >= 100) {
        clearInterval(scanTimer);
        scanning = false;
        st.lastScan = game.clock;
        let found = 0;
        if (game.virus) {
          found = Math.floor(Math.random() * 3000) + 300;
          st.blocked += found;
          sfx('win');
          if (game.chaos.active?.def.type === 'virus') game.chaos.finish(true);
          else game.virus = false;
        } else sfx('cash');
        main.replaceChildren(el('div.dm-center', ring(100, found ? 'warn' : 'ok', [icon(found ? 'biohazard' : 'check')]),
          el('h2', found ? `${found.toLocaleString()} threats removed` : 'No threats found'),
          el('p.dm-muted', found ? 'Including "BonziBuddy" and "grandma_gets_even.dll". Your PC is clean (ish).' : 'DefendoMax would like a 5-star review.'),
          el('button.dm-btn', { onclick: () => { view = 'status'; render(); } }, 'Done')));
        renderNav();
      }
    }, 180);
  };

  const render = () => {
    renderNav();
    if (view === 'status' || view === 'scan') {
      const bad = !!game.virus;
      main.replaceChildren(
        el('div.dm-center',
          ring(100, bad ? 'bad' : 'ok', [icon(bad ? 'warn' : 'check')]),
          el('h2', bad ? 'Your PC is at risk' : 'You are protected'),
          el('p.dm-muted', bad ? 'Malware detected. Run a Smart Scan immediately.' : 'Real-time protection is on (probably).'),
          el(`button.dm-btn${bad ? '.danger' : ''}`, { onclick: startScan }, icon('search'), 'Run Smart Scan')),
        el('div.dm-tiles',
          el('div.dm-tile', el('span', 'Threats blocked'), el('b', st.blocked.toLocaleString())),
          el('div.dm-tile', el('span', 'Last scan'), el('b', st.lastScan == null ? 'Never' : `Today`)),
          el('div.dm-tile', el('span', 'Virus definitions'), el('b.dm-warnt', '2009-04-01'))));
    } else if (view === 'quarantine') {
      main.replaceChildren(el('div.dm-list', el('h3', 'Quarantine'), ...QUARANTINE.map(([f, t]) => el('div.dm-qrow', icon('biohazard'), el('div', el('b', f), el('span', t)), el('span.dm-chip', 'Isolated')))));
    } else {
      main.replaceChildren(el('div.dm-list', el('h3', 'Settings'),
        ...[['Real-time protection', true], ['Block scambaiter files', true], ['Show 400 pop-ups a day', true], ['Let the boss see my browser history', false]].map(([l, on]) =>
          el('label.dm-toggle', el('span', l), el('input', { type: 'checkbox', checked: on }), el('i')))));
    }
  };
  render();
  win.onClose = () => clearInterval(scanTimer);
  return el('div.dm', nav, main);
}
