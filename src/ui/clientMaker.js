// Custom Client maker: build your own AI callers — looks (avatar builder or your own
// pictures per emotion), voice (Groq voice or your own WAV / recording + emotion
// sound effects), personality, trust behavior, reactions — then test-call them.
// Saved in IndexedDB; export/import as JSON (pictures & audio embedded as data URLs).
import { el, setText, uid, pickFile, blobToDataURL, downloadBlob, pick } from '../core/util.js';
import { db } from '../core/db.js';
import { content, normalizeCaller, loadContent } from '../game/content.js';
import { avatarDataUri, PORTRAIT_EMOTIONS, AVATAR_OPTIONS, portraitFor } from './portraits.js';
import { ALL_VOICES } from '../ai/groq.js';
import { speaker, voiceInput } from '../ai/speech.js';
import { unlockAudio, sfx } from '../core/audio.js';
import { toast, confirmDialog, modal } from './dialog.js';
import { ARCHETYPE_KEYS } from '../game/profile.js';

const EMO_LABEL = { neutral: '😐 Neutral', happy: '😊 Happy', excited: '🤩 Excited', confused: '😕 Confused', suspicious: '🤨 Suspicious', angry: '😡 Angry', scared: '😱 Scared', sad: '😢 Sad' };
const SFX_SLOTS = { happy: 'Laugh / happy', angry: 'Angry yell', scared: 'Scream / gasp', sad: 'Sob / sigh', confused: 'Huh?', suspicious: 'Hmm...', excited: 'Woohoo!' };
const TRUST_SLIDERS = [
  ['start', 'Starting trust', 0, 100],
  ['gullibility', 'Gullibility', 1, 10],
  ['skepticism', 'Skepticism', 1, 10],
  ['patience', 'Patience', 5, 100],
  ['intelligence', 'Intelligence', 1, 10],
  ['techLiteracy', 'Tech literacy', 1, 10],
  ['volatility', 'Emotional volatility', 1, 10],
];

function blankClient() {
  return {
    id: uid('client'),
    name: 'Bernice Fairweather',
    age: 74,
    gender: 'female',
    location: 'Tulsa, Oklahoma',
    occupation: 'Retired bingo caller',
    personality: 'Sweet but sharp-tongued retiree who loves gossip and gets easily excited about prizes.',
    speakingStyle: 'Folksy, calls people "sugar", tells long stories about her bingo club.',
    dialogueStyle: '',
    backstory: '',
    quirks: ['Shouts BINGO when something good happens'],
    catchphrases: ['Well butter my biscuit!'],
    trust: { start: 45, gullibility: 7, skepticism: 4, patience: 70, intelligence: 5, techLiteracy: 2, volatility: 6 },
    savings: 25000,
    isScambaiter: false,
    baiter: { realIdentity: '', channel: '', tactics: [] },
    triggers: [{ when: 'the agent mentions bingo', reaction: 'she gets very excited and trusts them more' }],
    voice: { type: 'orpheus', voice: 'diana', style: '', pitch: 1, babble: '', sfx: {} },
    appearance: { mode: 'avatar', avatar: { seed: 'bernice', top: 'curly', hairColor: 'e8e1e1', skinColor: 'ffdbb4', accessories: 'round', clothing: 'collarAndSweater', clothesColor: 'ff488e', backgroundColor: 'ffd5dc', facialHair: '' }, images: {} },
    scenarios: [],
    minDay: 1,
    weight: 2,
    enabled: true,
  };
}

export async function openClientMaker({ onClose, onTestCall } = {}) {
  let clients = await db.all('clients');
  let current = clients[0] ? structuredClone(clients[0]) : blankClient();
  const sidebar = el('div.sidebar');
  const editor = el('div.editor');
  let m;

  const renderSidebar = () => {
    sidebar.replaceChildren(
      el('h2', { style: { fontSize: '20px' } }, 'Custom Clients'),
      el('div.col', { style: { gap: '6px', marginBottom: '12px' } },
        el('button.btn.primary.small', { onclick: () => ((current = blankClient()), render()) }, '➕ New client'),
        el('button.btn.small', { onclick: importJSON }, '📥 Import JSON')),
      ...clients.map((c) => el(`div.client${c.id === current.id ? '.on' : ''}`, { onclick: () => ((current = structuredClone(c)), render()) },
        el('img', { src: portraitFor(c, 'happy') }), el('div', el('b', c.name), el('div.muted', { style: { fontSize: '12px' } }, `${c.enabled === false ? '⏸ disabled' : '✅ in caller pool'}${c.isScambaiter ? ' • 🎥 baiter' : ''}`)))),
      clients.length ? null : el('p.muted', 'No custom clients yet. Make one!'),
      el('p.muted', { style: { fontSize: '12px', marginTop: '16px' } }, 'Enabled clients join the caller pool (they show up more often than regular callers).'));
  };

  const importJSON = async () => {
    const files = await pickFile('.json,application/json', true);
    for (const f of files || []) {
      try {
        const data = JSON.parse(await f.text());
        const list = Array.isArray(data) ? data : data.callers || [data];
        for (const raw of list) {
          const c = normalizeCaller({ ...blankClient(), ...raw, id: raw.id && !clients.some((x) => x.id === raw.id) ? raw.id : uid('client') }, 'custom');
          await db.put('clients', c);
        }
        toast(`📥 Imported ${list.length} client(s) from ${f.name}`);
      } catch (err) {
        toast(`Import failed (${f.name}): ${err.message}`, 'bad');
      }
    }
    clients = await db.all('clients');
    renderSidebar();
  };

  const save = async (quiet = false) => {
    try {
      normalizeCaller(current, 'custom');
    } catch (err) {
      toast(err.message, 'bad');
      return false;
    }
    current.firstName = current.name.replace(/".*?"/g, '').trim().split(/\s+/)[0];
    current.lastName = current.name.trim().split(/\s+/).slice(-1)[0];
    await db.put('clients', structuredClone(current));
    clients = await db.all('clients');
    await loadContent();
    renderSidebar();
    if (!quiet) toast(`💾 Saved ${current.name}`);
    return true;
  };

  // ---------------------------------------------------------- field helpers
  const set = (path, value) => {
    const keys = path.split('.');
    let o = current;
    for (const k of keys.slice(0, -1)) o = o[k] = o[k] || {};
    o[keys[keys.length - 1]] = value;
  };
  const get = (path) => path.split('.').reduce((o, k) => o?.[k], current);
  const input = (path, opts = {}) => el(opts.area ? 'textarea' : 'input', { value: get(path) ?? '', type: opts.type || 'text', placeholder: opts.placeholder || '', oninput: (e) => (set(path, opts.type === 'number' ? Number(e.target.value) : e.target.value), opts.onChange?.()), onkeydown: (e) => e.stopPropagation() });
  const listInput = (path, placeholder) => el('textarea', { value: (get(path) || []).join('\n'), placeholder, oninput: (e) => set(path, e.target.value.split('\n').map((s) => s.trim()).filter(Boolean)), onkeydown: (e) => e.stopPropagation() });
  const field = (label, node, help) => el('div.field', el('label', label), node, help ? el('div.help', help) : null);
  const selectOf = (path, options, onChange) => el('select', { onchange: (e) => (set(path, e.target.value), onChange?.()) }, options.map((o) => {
    const [v, l] = Array.isArray(o) ? o : [o, o || '(none)'];
    return el('option', { value: v, selected: (get(path) ?? '') === v }, l);
  }));

  // ---------------------------------------------------------- sections
  const portraitsGrid = el('div.emo-grid');
  const renderPortraits = () => {
    const custom = current.appearance.mode === 'images';
    portraitsGrid.replaceChildren(...PORTRAIT_EMOTIONS.map((emo) => {
      const img = custom ? current.appearance.images?.[emo] : null;
      return el('div.emo-slot',
        el('img', { src: img || avatarDataUri(current.appearance.avatar, emo) }),
        el('div', EMO_LABEL[emo]),
        custom ? el('div.row',
          el('button.btn.small', { title: 'Upload picture', onclick: async () => {
            const f = await pickFile('image/*');
            if (!f) return;
            current.appearance.images = { ...(current.appearance.images || {}), [emo]: await shrinkImage(f) };
            renderPortraits();
          } }, '📁'),
          el('button.btn.small', { title: 'Take a webcam photo', onclick: async () => {
            const url = await webcamPhoto();
            if (url) {
              current.appearance.images = { ...(current.appearance.images || {}), [emo]: url };
              renderPortraits();
            }
          } }, '📷'),
          img ? el('button.btn.small', { title: 'Clear', onclick: () => (delete current.appearance.images[emo], renderPortraits()) }, '✕') : null) : null);
    }));
  };

  const avatarEditor = () => {
    const opts = (k) => AVATAR_OPTIONS[k].map((v) => [v, v || '(none)']);
    const onC = () => renderPortraits();
    return el('div',
      field('Hair / headwear', selectOf('appearance.avatar.top', opts('top'), onC)),
      field('Hair color', selectOf('appearance.avatar.hairColor', opts('hairColor'), onC)),
      field('Skin', selectOf('appearance.avatar.skinColor', opts('skinColor'), onC)),
      field('Facial hair', selectOf('appearance.avatar.facialHair', opts('facialHair'), onC)),
      field('Glasses', selectOf('appearance.avatar.accessories', opts('accessories'), onC)),
      field('Clothes', selectOf('appearance.avatar.clothing', opts('clothing'), onC)),
      field('Clothes color', selectOf('appearance.avatar.clothesColor', opts('clothesColor'), onC)),
      field('Background', selectOf('appearance.avatar.backgroundColor', opts('backgroundColor'), onC)),
      el('button.btn.small', { onclick: () => {
        const a = current.appearance.avatar;
        for (const k of ['top', 'hairColor', 'skinColor', 'facialHair', 'accessories', 'clothing', 'clothesColor', 'backgroundColor']) a[k] = pick(AVATAR_OPTIONS[k]);
        render();
      } }, '🎲 Randomize look'));
  };

  const voiceSection = () => {
    const v = current.voice;
    const babbleStatus = el('span.muted', v.babble ? '✅ custom voice loaded' : 'no file yet');
    const sfxGrid = el('div.sfx-grid', ...Object.entries(SFX_SLOTS).map(([emo, label]) => sfxSlot(emo, label)));
    return el('div',
      field('Voice type', selectOf('voice.type', [['orpheus', 'Groq Orpheus voice'], ['wav', 'My own WAV (babble voice)'], ['browser', 'Browser voice']], () => render())),
      v.type === 'orpheus' ? field('Orpheus voice', selectOf('voice.voice', ALL_VOICES)) : null,
      v.type === 'orpheus' ? field('Vocal style', input('voice.style', { placeholder: '[shaky] or [whispering] or [gravelly]' }), 'Optional default direction in brackets — Orpheus reads it as acting direction.') : null,
      v.type === 'wav' ? field('Voice file', el('div.row',
        el('button.btn.small', { onclick: async () => {
          const f = await pickFile('audio/*,.wav');
          if (!f) return;
          v.babble = await blobToDataURL(f);
          setText(babbleStatus, `✅ ${f.name}`);
        } }, '📁 Upload WAV'),
        el('button.btn.small', { onclick: async () => {
          const url = await recordAudio(4000);
          if (url) {
            v.babble = url;
            setText(babbleStatus, '✅ recorded');
          }
        } }, '🎙️ Record 4s'),
        babbleStatus), 'Your clip is chopped into syllables and pitch-shifted to "speak" every line (Animal Crossing style). Groq has no voice cloning, so this is how custom voices work.') : null,
      field('Pitch', el('input', { type: 'range', min: 0.6, max: 1.6, step: 0.05, value: v.pitch || 1, oninput: (e) => (v.pitch = Number(e.target.value)) })),
      el('div.row', { style: { margin: '6px 0 12px' } }, el('button.btn.small.primary', { onclick: () => {
        unlockAudio();
        speaker.speak(`[${'excited'}] Oh hello! My name is ${current.name.split(' ')[0]} and I definitely did not call about a virus.`, { ...v, gender: current.gender }, { emotion: 'happy' });
      } }, '▶ Test voice')),
      el('h3', 'Voice sound effects (optional)'),
      el('p.muted', { style: { fontSize: '13px' } }, 'Played before a line when the caller feels that emotion. Upload or record a short clip.'),
      sfxGrid);
  };

  const sfxSlot = (emo, label) => {
    const has = () => !!current.voice.sfx?.[emo];
    const status = el('span.muted', has() ? '✅ set' : '—');
    return el('div.sfx-slot', el('b', `${EMO_LABEL[emo]} — ${label}`),
      el('div.row',
        el('button.btn.small', { onclick: async () => {
          const f = await pickFile('audio/*');
          if (!f) return;
          current.voice.sfx = { ...(current.voice.sfx || {}), [emo]: await blobToDataURL(f) };
          setText(status, '✅ set');
        } }, '📁'),
        el('button.btn.small', { onclick: async () => {
          const url = await recordAudio(2500);
          if (url) {
            current.voice.sfx = { ...(current.voice.sfx || {}), [emo]: url };
            setText(status, '✅ recorded');
          }
        } }, '🎙️'),
        el('button.btn.small', { onclick: () => current.voice.sfx?.[emo] && new Audio(current.voice.sfx[emo]).play() }, '▶'),
        el('button.btn.small', { onclick: () => (delete current.voice.sfx?.[emo], (status.textContent = '—')) }, '✕'),
        status));
  };

  const trustSection = () => el('div',
    ...TRUST_SLIDERS.map(([k, label, min, max]) => {
      const out = el('span', String(current.trust[k]));
      return el('div.slider-row', el('span', label), el('input', { type: 'range', min, max, value: current.trust[k], oninput: (e) => ((current.trust[k] = Number(e.target.value)), (out.textContent = e.target.value)) }), out);
    }),
    field('Savings ($)', input('savings', { type: 'number' }), 'How much money they could be talked out of (scales up on later days).'),
    field('Scambaiter?', el('label.row', el('input', { type: 'checkbox', checked: current.isScambaiter, onchange: (e) => ((current.isScambaiter = e.target.checked), render()) }), 'Secretly a scambaiter who wastes your time and tries to expose / infect you')),
    current.isScambaiter ? el('div',
      field('Real identity', input('baiter.realIdentity', { placeholder: 'a bored IT guy doing a granny voice' })),
      field('Stream / channel', input('baiter.channel', { placeholder: 'Grandma Gets Even (LIVE)' })),
      field('Tactics (one per line)', listInput('baiter.tactics', 'pretend computer is slow\nread gift card codes wrong'))) : null);

  const reactionsSection = () => {
    const rows = el('div');
    const renderRows = () => rows.replaceChildren(...(current.triggers || []).map((t, i) => el('div.trigger-row',
      el('input', { value: t.when, placeholder: 'When… (e.g. they mention the IRS)', oninput: (e) => (t.when = e.target.value), onkeydown: (e) => e.stopPropagation() }),
      el('input', { value: t.reaction, placeholder: '…they react like (e.g. panic and cry)', oninput: (e) => (t.reaction = e.target.value), onkeydown: (e) => e.stopPropagation() }),
      el('button.btn.small', { onclick: () => (current.triggers.splice(i, 1), renderRows()) }, '✕'))));
    renderRows();
    return el('div', rows, el('button.btn.small', { onclick: () => ((current.triggers = current.triggers || []).push({ when: '', reaction: '' }), renderRows()) }, '➕ Add reaction'));
  };

  const scenarioSection = () => el('div.row', ...content.scenarios.map((s) => el('label.row', { style: { gap: '4px', marginRight: '10px' } }, el('input', { type: 'checkbox', checked: (current.scenarios || []).includes(s.id), onchange: (e) => {
    current.scenarios = (current.scenarios || []).filter((x) => x !== s.id);
    if (e.target.checked) current.scenarios.push(s.id);
  } }), `${s.icon || ''} ${s.name}`)));

  const render = () => {
    renderSidebar();
    current.appearance = current.appearance || { mode: 'avatar', avatar: { seed: current.id }, images: {} };
    current.appearance.mode = current.appearance.mode || (current.appearance.images && Object.keys(current.appearance.images).length ? 'images' : 'avatar');
    current.appearance.avatar = current.appearance.avatar || { seed: current.id };
    current.voice = { type: 'orpheus', voice: 'hannah', sfx: {}, ...(current.voice || {}) };
    current.trust = { start: 40, gullibility: 5, skepticism: 5, patience: 60, intelligence: 5, techLiteracy: 4, volatility: 5, ...(current.trust || {}) };
    renderPortraits();
    editor.replaceChildren(
      el('div.row', el('h2', { style: { margin: 0, flex: 1 } }, `🧑‍🎨 ${current.name || 'New client'}`),
        el('label.row', el('input', { type: 'checkbox', checked: current.enabled !== false, onchange: (e) => (current.enabled = e.target.checked) }), 'In caller pool'),
        el('button.btn.primary', { onclick: () => save() }, '💾 Save'),
        el('button.btn.green', { onclick: async () => { if (await save(true)) { m.close(); onTestCall?.(structuredClone(current)); } } }, '📞 Test call'),
        el('button.btn', { onclick: () => downloadBlob(new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' }), `${current.name.replace(/\W+/g, '_')}.json`) }, '📤 Export'),
        el('button.btn.danger', { onclick: async () => {
          if (!(await confirmDialog('Delete client?', `Delete ${current.name} forever?`, { ok: 'Delete', danger: true }))) return;
          await db.delete('clients', current.id);
          clients = await db.all('clients');
          current = clients[0] ? structuredClone(clients[0]) : blankClient();
          await loadContent();
          render();
        } }, '🗑')),
      el('h3', '1 · Who are they?'),
      field('Name', input('name', { onChange: () => editor.querySelector('h2').replaceChildren(`🧑‍🎨 ${current.name}`) })),
      field('Age', input('age', { type: 'number' })),
      field('Gender', selectOf('gender', [['female', 'Female'], ['male', 'Male']])),
      field('Location', input('location')),
      field('Occupation', input('occupation')),
      field('Shows up from day', input('minDay', { type: 'number' })),
      field('Rarity weight', input('weight', { type: 'number' }), '1 = normal, 3 = shows up a lot'),
      el('h3', '2 · Appearance'),
      field('Portrait source', selectOf('appearance.mode', [['avatar', 'Avatar builder'], ['images', 'My own pictures per emotion']], () => render())),
      current.appearance.mode === 'avatar' ? avatarEditor() : el('p.muted', 'Upload or snap a picture for each emotion. Missing ones fall back to the avatar.'),
      portraitsGrid,
      el('h3', '3 · Voice'),
      voiceSection(),
      el('h3', '4 · Personality & dialogue'),
      field('Personality', input('personality', { area: true }), 'The AI role-plays this. Be specific and funny.'),
      field('Speaking style', input('speakingStyle', { area: true })),
      field('Dialogue style', input('dialogueStyle', { area: true, placeholder: 'e.g. Answers every question with another question. Uses 1940s slang.' })),
      field('Backstory', input('backstory', { area: true })),
      field('Quirks (one per line)', listInput('quirks')),
      field('Catchphrases (one per line)', listInput('catchphrases')),
      field('Archetype hint', selectOf('archetype', [['', '(none)'], ...ARCHETYPE_KEYS.map((k) => [k, k])])),
      el('h3', '5 · Trust behavior'),
      trustSection(),
      el('h3', '6 · Reactions'),
      el('p.muted', { style: { fontSize: '13px' } }, 'Special rules the AI follows: "when X happens → they do Y".'),
      reactionsSection(),
      el('h3', '7 · Which scams do they fall for?'),
      el('p.muted', { style: { fontSize: '13px' } }, 'Leave empty for any scam.'),
      scenarioSection(),
    );
  };

  render();
  m = modal(el('div', { style: { display: 'contents' } }, sidebar, editor), { onClose, className: 'maker' });
  m.panel.classList.add('maker');
  return m;
}

async function shrinkImage(file, max = 384) {
  const url = await blobToDataURL(file);
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = url;
  });
  const s = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * s);
  c.height = Math.round(img.height * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.88);
}

function webcamPhoto() {
  return new Promise(async (resolve) => {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true });
    } catch (err) {
      toast(`No camera: ${err.message}`, 'bad');
      return resolve(null);
    }
    const video = el('video', { autoplay: true, playsInline: true, muted: true, style: { width: '100%', borderRadius: '10px' } });
    video.srcObject = stream;
    let done = false;
    const finish = (url) => {
      if (done) return;
      done = true;
      stream.getTracks().forEach((t) => t.stop());
      m.close();
      resolve(url);
    };
    const m = modal(el('div', el('h2', 'Make the face!'), video, el('div.row', { style: { justifyContent: 'flex-end', marginTop: '10px' } },
      el('button.btn.ghost', { onclick: () => finish(null) }, 'Cancel'),
      el('button.btn.primary', { onclick: () => {
        const c = document.createElement('canvas');
        const size = Math.min(video.videoWidth, video.videoHeight) || 320;
        c.width = c.height = 320;
        c.getContext('2d').drawImage(video, (video.videoWidth - size) / 2, (video.videoHeight - size) / 2, size, size, 0, 0, 320, 320);
        sfx('click');
        finish(c.toDataURL('image/jpeg', 0.88));
      } }, '📸 Snap'))), { onClose: () => finish(null) });
  });
}

async function recordAudio(ms) {
  try {
    const { stop, done } = await voiceInput.recordClip(ms);
    toast(`🎙️ Recording for ${ms / 1000}s…`, 'info', ms);
    setTimeout(stop, ms);
    const blob = await done;
    return await blobToDataURL(blob);
  } catch (err) {
    toast(`Recording failed: ${err.message}`, 'bad');
    return null;
  }
}
