// Creative tools: Paint, Camera, Screen Recorder, DocForge (fake documents),
// SiteForge (fake websites). Things you make can be shown to the caller, who reacts.
import { el, money, downloadBlob, escapeHtml, uid } from '../../core/util.js';
import { bus } from '../../core/bus.js';
import { sfx } from '../../core/audio.js';
import { promptDialog } from '../dialog.js';
import { saveFile } from './apps.js';
import { renderSite } from './remoteApp.js';

function showToCaller(game, text) {
  const c = game.calls;
  if (!c.active) {
    bus.emit('toast', { kind: 'warn', text: 'You need a caller on the line to show them anything.' });
    return false;
  }
  c.screenEvent(text, { react: true });
  return true;
}

// ---------------------------------------------------------------- Paint
export function paintApp(game) {
  const canvas = el('canvas', { width: 720, height: 420 });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let color = '#111111';
  let size = 6;
  let tool = 'brush';
  let drawing = false;
  let last = null;
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height };
  };
  canvas.addEventListener('mousedown', async (e) => {
    const p = pos(e);
    if (tool === 'text') {
      const t = await promptDialog('Add text', '', { placeholder: 'OFFICIAL MICROSOFT CERTIFICATE' });
      if (t) {
        ctx.fillStyle = color;
        ctx.font = `bold ${size * 5}px Impact, Arial`;
        ctx.fillText(t, p.x, p.y);
      }
      return;
    }
    if (tool === 'stamp') {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(-0.2);
      ctx.strokeStyle = '#c00';
      ctx.fillStyle = '#c00';
      ctx.lineWidth = 5;
      ctx.strokeRect(-90, -28, 180, 56);
      ctx.font = 'bold 30px Impact';
      ctx.textAlign = 'center';
      ctx.fillText('APPROVED', 0, 11);
      ctx.restore();
      sfx('stamp');
      return;
    }
    drawing = true;
    last = p;
  });
  canvas.addEventListener('mousemove', (e) => {
    if (!drawing) return;
    const p = pos(e);
    ctx.strokeStyle = tool === 'eraser' ? '#fff' : color;
    ctx.lineWidth = tool === 'eraser' ? size * 4 : size;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = p;
  });
  window.addEventListener('mouseup', () => (drawing = false));
  const colors = ['#111111', '#ffffff', '#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#6d4c41'];
  const swatches = colors.map((c) => el('div.swatch', { style: { background: c }, onclick: (e) => { color = c; swatches.forEach((s) => s.classList.remove('on')); e.target.classList.add('on'); } }));
  swatches[0].classList.add('on');
  const toolBtn = (t, label) => el('button.xp-btn', { onclick: () => (tool = t) }, label);
  return el('div.paint',
    el('div.app-toolbar', toolBtn('brush', '🖌️'), toolBtn('eraser', '🧽'), toolBtn('text', '🔤'), toolBtn('stamp', '🟥 Stamp'),
      el('input', { type: 'range', min: 1, max: 30, value: size, style: { width: '80px' }, oninput: (e) => (size = Number(e.target.value)) }), ...swatches,
      el('button.xp-btn', { onclick: () => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); } }, 'Clear'),
      el('button.xp-btn', { onclick: () => { saveFile(game, { kind: 'painting', name: `painting_${Date.now() % 10000}.png`, url: canvas.toDataURL('image/png') }); bus.emit('toast', { text: '🎨 Saved to Files' }); } }, '💾 Save'),
      el('button.xp-btn.primary', { onclick: async () => {
        const desc = await promptDialog('Show on the caller\'s screen', 'Describe your masterpiece — the caller will "see" this:', { placeholder: 'An official Windoze security certificate with a gold seal' });
        if (desc) showToCaller(game, `displayed a picture on your screen (made in MS Paint). It shows: ${desc}`);
      } }, '📺 Show to caller')),
    el('div', { style: { flex: 1, overflow: 'auto' } }, canvas));
}

// ---------------------------------------------------------------- Camera
const FILTERS = {
  none: { label: 'No filter', desc: 'a normal webcam photo of the agent' },
  badge: { label: '👮 Police badge', desc: 'a photo of the agent holding an official-looking police badge, in front of a flag' },
  support: { label: '🎧 Tech support', desc: 'a photo of the agent in a headset with a "Certified Windoze Technician" banner' },
  mustache: { label: '🥸 Disguise', desc: 'a photo of the agent wearing an obviously fake mustache and sunglasses' },
  rich: { label: '💰 Crypto king', desc: 'a photo of the agent surrounded by money and a "TO THE MOON" banner' },
};

export function cameraApp(game, win) {
  const video = el('video', { autoplay: true, playsInline: true, muted: true });
  const canvas = el('canvas', { width: 640, height: 480, style: { display: 'none' } });
  const status = el('div', { style: { padding: '6px', fontSize: '12px', color: '#555' } }, 'Starting camera…');
  let stream = null;
  let filter = 'none';
  navigator.mediaDevices?.getUserMedia({ video: true }).then((s) => {
    stream = s;
    video.srcObject = s;
    status.textContent = 'Camera ready. Pick a filter and snap.';
  }).catch((err) => (status.textContent = `No camera available (${err.message}). Photos will be a placeholder.`));
  win.cleanup = () => stream?.getTracks().forEach((t) => t.stop());
  const overlay = (ctx) => {
    ctx.textAlign = 'center';
    if (filter === 'badge') {
      ctx.font = '120px serif';
      ctx.fillText('🛡️', 120, 440);
      ctx.fillStyle = 'rgba(0,40,120,.7)';
      ctx.fillRect(0, 0, 640, 50);
      ctx.fillStyle = '#ffd700';
      ctx.font = 'bold 30px Arial';
      ctx.fillText('FEDERAL TAX POLICE • BADGE #4471', 320, 36);
    } else if (filter === 'support') {
      ctx.font = '110px serif';
      ctx.fillText('🎧', 320, 140);
      ctx.fillStyle = 'rgba(10,79,209,.85)';
      ctx.fillRect(0, 420, 640, 60);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 28px Arial';
      ctx.fillText('✔ CERTIFIED WINDOZE TECHNICIAN', 320, 460);
    } else if (filter === 'mustache') {
      ctx.font = '150px serif';
      ctx.fillText('🥸', 320, 300);
    } else if (filter === 'rich') {
      ctx.font = '70px serif';
      for (let i = 0; i < 9; i++) ctx.fillText('💸', 60 + ((i * 73) % 560), 80 + ((i * 131) % 380));
      ctx.fillStyle = '#ffe14d';
      ctx.font = 'bold 44px Impact';
      ctx.fillText('TO THE MOON 🚀', 320, 460);
    }
  };
  const snap = () => {
    const ctx = canvas.getContext('2d');
    if (stream) ctx.drawImage(video, 0, 0, 640, 480);
    else {
      ctx.fillStyle = '#444';
      ctx.fillRect(0, 0, 640, 480);
      ctx.font = '200px serif';
      ctx.textAlign = 'center';
      ctx.fillText('🙂', 320, 320);
    }
    overlay(ctx);
    sfx('click');
    return canvas.toDataURL('image/jpeg', 0.85);
  };
  const preview = el('img', { style: { width: '100%', display: 'none' } });
  return el('div.camera',
    el('div.app-toolbar', el('select', { onchange: (e) => (filter = e.target.value) }, Object.entries(FILTERS).map(([k, f]) => el('option', { value: k }, f.label))),
      el('button.xp-btn.primary', { onclick: () => { const url = snap(); preview.src = url; preview.style.display = ''; saveFile(game, { kind: 'photo', name: `photo_${Date.now() % 10000}.jpg`, url }); bus.emit('toast', { text: '📷 Saved to Files' }); } }, '📸 Snap'),
      el('button.xp-btn', { onclick: () => { snap(); showToCaller(game, `sent you a photo of themselves: ${FILTERS[filter].desc}`); } }, '📤 Send to caller')),
    status, video, canvas, preview);
}

// ---------------------------------------------------------------- Recorder
export function recorderApp(game, win) {
  const status = el('div', { style: { margin: '10px 0' } }, 'Record clips of your calls to post online. Captures this browser tab (with sound).');
  let rec = null;
  let chunks = [];
  let stream = null;
  const startBtn = el('button.xp-btn.primary', { onclick: () => start() }, '⏺️ Start recording');
  const stopBtn = el('button.xp-btn.red', { onclick: () => stop(), disabled: true }, '⏹ Stop');
  const start = async () => {
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true, preferCurrentTab: true, selfBrowserSurface: 'include' });
    } catch (err) {
      status.textContent = `Couldn't start capture: ${err.message}`;
      return;
    }
    chunks = [];
    rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : 'video/webm' });
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      saveFile(game, { kind: 'video', name: `clip_${new Date().toLocaleTimeString().replace(/\W/g, '')}.webm`, url, blob });
      status.replaceChildren('✅ Clip saved to Files. ', el('button.xp-btn', { onclick: () => downloadBlob(blob, 'scam-call-center-clip.webm') }, '💾 Download now'));
      stream.getTracks().forEach((t) => t.stop());
      bus.emit('recorder', false);
    };
    stream.getVideoTracks()[0].addEventListener('ended', () => rec?.state === 'recording' && stop());
    rec.start(500);
    startBtn.disabled = true;
    stopBtn.disabled = false;
    status.textContent = '🔴 Recording…';
    bus.emit('recorder', true);
  };
  const stop = () => {
    if (rec?.state === 'recording') rec.stop();
    startBtn.disabled = false;
    stopBtn.disabled = true;
  };
  win.onClose = () => stop();
  return el('div.pad', el('h3', { style: { marginTop: 0 } }, '⏺️ Screen Recorder'), status, el('div.row', startBtn, stopBtn),
    el('p', { style: { fontSize: '12px', color: '#666' } }, 'Tip: your browser will ask what to share — pick this tab.'));
}

// ---------------------------------------------------------------- DocForge
const DOCS = {
  warrant: { title: 'ARREST WARRANT', org: 'Internal Revenue Department — Tax Crimes Division', body: (f) => `This warrant is issued for the immediate arrest of <b>${f.name}</b> for failure to pay outstanding federal taxes in the amount of <b>${money(f.amount)}</b>. The subject may avoid arrest by settling the balance today with the assigned officer, <b>${f.officer}</b> (Badge #${f.badge}).` },
  certificate: { title: 'CERTIFICATE OF COMPUTER SECURITY', org: 'Windoze Technical Support Division', body: (f) => `This certifies that the computer of <b>${f.name}</b> is protected by a <b>Lifetime Security License</b> (license fee: ${money(f.amount)}). Certified technician: <b>${f.officer}</b>, ID #${f.badge}.` },
  refund: { title: 'REFUND AUTHORIZATION', org: 'GeekPatrol Billing Department', body: (f) => `A refund of <b>${money(f.amount)}</b> has been authorized to the account of <b>${f.name}</b>. Any excess refund must be returned immediately per policy 7(b). Authorized by: <b>${f.officer}</b>.` },
  lottery: { title: 'OFFICIAL WINNER CERTIFICATE', org: 'Mega Global Sweepstakes Commission', body: (f) => `Congratulations <b>${f.name}</b>! You have won <b>$2,500,000</b> and a new car. A processing fee of <b>${money(f.amount)}</b> is required to release the prize. Prize director: <b>${f.officer}</b>.` },
  customs: { title: 'CUSTOMS RELEASE NOTICE', org: 'SpeedyParcel International Customs Desk', body: (f) => `A parcel addressed to <b>${f.name}</b> is held at customs. Release fee: <b>${money(f.amount)}</b>. Unclaimed parcels will be destroyed in 24 hours. Officer: <b>${f.officer}</b>, desk #${f.badge}.` },
  bank: { title: 'FRAUD ALERT NOTICE', org: 'Fraud Prevention Department', body: (f) => `Suspicious activity detected on the account of <b>${f.name}</b>. To protect your funds, <b>${money(f.amount)}</b> must be moved to a secure holding account today. Case officer: <b>${f.officer}</b>.` },
};

export function docforgeApp(game) {
  const caller = game.calls.caller;
  const fields = { name: caller?.name || 'Margaret Thompson', amount: 499, officer: 'Officer Steve Johnson', badge: String(4000 + ((Math.random() * 5999) | 0)), notes: '' };
  let type = 'warrant';
  const preview = el('div.doc-preview');
  const render = () => {
    const d = DOCS[type];
    preview.innerHTML = `<div class="seal">OFFICIAL<br>SEAL<br>★★★</div><div style="text-align:center;font-size:12px;letter-spacing:2px">${escapeHtml(d.org)}</div><h1>${d.title}</h1><hr><p>${d.body(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, k === 'amount' ? Number(v) || 0 : escapeHtml(v)])))}</p>${fields.notes ? `<p><i>${escapeHtml(fields.notes)}</i></p>` : ''}<p style="margin-top:24px">Date: ${new Date().toLocaleDateString()}<br>Signature: <span style="font-family:'Permanent Marker',cursive;font-size:20px">${escapeHtml(fields.officer)}</span></p><div class="stamp">${type === 'lottery' ? 'WINNER' : 'URGENT'}</div>`;
  };
  const input = (k, label, type2 = 'text') => el('label', { style: { display: 'block', marginBottom: '6px' } }, label, el('input', { type: type2, value: fields[k], style: { width: '100%' }, oninput: (e) => ((fields[k] = e.target.value), render()), onkeydown: (e) => e.stopPropagation() }));
  render();
  const describe = () => {
    const d = DOCS[type];
    const nameMatch = caller && fields.name.toLowerCase().includes(caller.lastName.toLowerCase());
    return `"${d.title}" from "${d.org}" — ${preview.querySelector('p').textContent} ${nameMatch ? '(It has your correct full name on it.)' : caller ? `(It is addressed to "${fields.name}", which is NOT your name!)` : ''}`;
  };
  return el('div.split',
    el('div.side', { style: { width: '250px', padding: '10px', background: '#f4f4f0' } },
      el('label', 'Template', el('select', { style: { width: '100%', marginBottom: '8px' }, onchange: (e) => ((type = e.target.value), render()) }, Object.entries(DOCS).map(([k, d]) => el('option', { value: k }, d.title)))),
      input('name', 'Recipient name'), input('amount', 'Amount ($)', 'number'), input('officer', 'Officer / signer'), input('badge', 'Badge / ID #'), input('notes', 'Extra note'),
      el('div.col', { style: { gap: '6px', marginTop: '8px' } },
        el('button.xp-btn.primary', { onclick: () => showToCaller(game, `showed you an official-looking document on your screen: ${describe()}`) && sfx('stamp') }, '📺 Show to caller'),
        el('button.xp-btn', { onclick: () => { saveFile(game, { kind: 'document', name: `${DOCS[type].title.toLowerCase().replace(/\W+/g, '_')}.html`, html: preview.outerHTML }); bus.emit('toast', { text: '📄 Saved to Files' }); } }, '💾 Save'))),
    el('div.main', { style: { background: '#888' } }, preview));
}

// ---------------------------------------------------------------- SiteForge
const TEMPLATES = { support: 'Tech support portal', bank: 'Bank login page', government: 'Government payment portal', crypto: 'Crypto trading dashboard', lottery: 'Prize claim page' };

export function siteforgeApp(game) {
  const s = { domain: 'windoze-support-official.com', title: 'Windoze Support Center', message: 'Your device has been flagged. A certified technician will assist you.', template: 'support', color: '#0a4fd1', logo: '🛡️' };
  const preview = el('div', { style: { border: '1px solid #aaa', margin: '10px', background: '#fff' } });
  const render = () => preview.replaceChildren(renderSite(s));
  const inp = (k, label) => el('label', { style: { display: 'block', marginBottom: '6px' } }, label, el('input', { value: s[k], style: { width: '100%' }, oninput: (e) => ((s[k] = e.target.value), render()), onkeydown: (e) => e.stopPropagation() }));
  render();
  const publish = () => {
    s.domain = s.domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\s+/g, '-');
    game.run.sites = (game.run.sites || []).filter((x) => x.domain !== s.domain);
    const site = { ...s, id: uid('site') };
    game.run.sites.push(site);
    saveFile(game, { kind: 'site', name: s.domain, url: s.domain });
    bus.emit('toast', { text: `🕸️ Published ${s.domain}. Victims can visit it in their browser (via RemoteHelp) or you can send the link.` });
    return site;
  };
  return el('div.split',
    el('div.side', { style: { width: '260px', padding: '10px', background: '#f4f4f0' } },
      inp('domain', 'Domain (e.g. secure-bank-help.ru)'), inp('title', 'Site title'), inp('message', 'Main message'), inp('logo', 'Logo emoji'),
      el('label', 'Template', el('select', { style: { width: '100%' }, onchange: (e) => ((s.template = e.target.value), render()) }, Object.entries(TEMPLATES).map(([k, v]) => el('option', { value: k, selected: k === s.template }, v)))),
      el('label', { style: { display: 'block', marginTop: '6px' } }, 'Color ', el('input', { type: 'color', value: s.color, oninput: (e) => ((s.color = e.target.value), render()) })),
      el('div.col', { style: { gap: '6px', marginTop: '10px' } },
        el('button.xp-btn.primary', { onclick: () => publish() }, '🚀 Publish'),
        el('button.xp-btn', { onclick: () => { const site = publish(); showToCaller(game, `sent you a link and asked you to open the website "${site.domain}". It's titled "${site.title}" and says: ${site.message}`); } }, '🔗 Publish & send link to caller'))),
    el('div.main', { style: { background: '#ddd' } }, preview));
}
