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
import { icon } from './icons.js';

// One-click starting points so you don't have to fill in 30 fields.
const PRESETS = [
  { id: 'grandma', label: 'Sweet grandma', ic: 'heart', patch: { age: 78, gender: 'female', occupation: 'Retired school librarian', personality: 'Sweet, trusting grandma who loves her cat Mittens and gets flustered by technology.', speakingStyle: 'Slow and polite, calls everyone "dear", loses her train of thought.', trust: { start: 55, gullibility: 8, skepticism: 2, patience: 85, intelligence: 4, techLiteracy: 1, volatility: 3 }, isScambaiter: false, voice: { voice: 'diana' } } },
  { id: 'techbro', label: 'Crypto tech bro', ic: 'rocket', patch: { age: 29, gender: 'male', occupation: 'Self-described "serial founder"', personality: 'Overconfident crypto bro who thinks he is too smart to be scammed, but can\'t resist a "100x opportunity".', speakingStyle: 'Fast, full of buzzwords: "alpha", "synergy", "to the moon".', trust: { start: 35, gullibility: 6, skepticism: 5, patience: 40, intelligence: 6, techLiteracy: 7, volatility: 6 }, isScambaiter: false, voice: { voice: 'austin' } } },
  { id: 'uncle', label: 'Conspiracy uncle', ic: 'eye', patch: { age: 61, gender: 'male', occupation: 'Retired trucker, full-time forum poster', personality: 'Paranoid conspiracy theorist — suspicious of the government, but will believe ANY caller who agrees with him.', speakingStyle: 'Rambling, all-caps energy, "wake up, sheeple".', trust: { start: 25, gullibility: 7, skepticism: 7, patience: 55, intelligence: 4, techLiteracy: 3, volatility: 8 }, isScambaiter: false, voice: { voice: 'troy' } } },
  { id: 'baiter', label: 'Scambaiter', ic: 'video', patch: { age: 70, gender: 'female', occupation: '"Retired" (actually a streamer)', personality: 'Pretends to be a confused old lady, wastes as much of your time as possible, secretly streaming the call.', speakingStyle: 'Exaggerated granny voice, keeps "mishearing" numbers.', trust: { start: 50, gullibility: 9, skepticism: 1, patience: 100, intelligence: 9, techLiteracy: 9, volatility: 2 }, isScambaiter: true, baiter: { realIdentity: 'a bored IT guy doing a granny voice', channel: 'Grandma Gets Even (LIVE)', tactics: ['reads gift card codes wrong', 'pretends the computer is very slow'] } } },
];
const TABS = [['basics', 'Basics', 'user'], ['look', 'Look', 'palette'], ['voice', 'Voice', 'volume'], ['behavior', 'Behavior', 'trend'], ['more', 'Extras', 'settings']];

const EMO_LABEL = { neutral: 'Neutral', happy: 'Happy', excited: 'Excited', confused: 'Confused', suspicious: 'Suspicious', angry: 'Angry', scared: 'Scared', sad: 'Sad' };
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

  let tab = 'basics';
  const renderSidebar = () => {
    sidebar.replaceChildren(
      el('div.cm-side-head', el('h2', 'Custom Clients'), el('p.muted', 'Callers you design. Enabled ones join the call queue.')),
      el('div.cm-side-actions',
        el('button.btn.primary.small', { onclick: () => { current = blankClient(); tab = 'basics'; render(); } }, icon('plus'), 'New client'),
        el('button.btn.small', { onclick: importJSON }, icon('upload'), 'Import')),
      el('div.cm-list', ...clients.map((c) => el(`div.cm-card${c.id === current.id ? '.on' : ''}`, { onclick: () => { current = structuredClone(c); render(); } },
        el('img', { src: portraitFor(c, 'happy') }),
        el('div.cm-card-meta', el('b', c.name), el('span', `${c.age || '?'} · ${c.location || 'Somewhere, USA'}`)),
        el(`span.cm-pill${c.enabled === false ? '.off' : ''}`, c.isScambaiter ? 'baiter' : c.enabled === false ? 'off' : 'on')))),
      clients.length ? null : el('div.cm-empty', icon('users'), el('p', 'No custom clients yet.'), el('p.muted', 'Hit New client, then pick a quick-start preset.')));
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
        toast(`Imported ${list.length} client(s) from ${f.name}`);
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
    if (!quiet) toast(`Saved ${current.name}`, 'good', 2500, { icon: 'save' });
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
          } }, icon('folder')),
          el('button.btn.small', { title: 'Take a webcam photo', onclick: async () => {
            const url = await webcamPhoto();
            if (url) {
              current.appearance.images = { ...(current.appearance.images || {}), [emo]: url };
              renderPortraits();
            }
          } }, icon('camera')),
          img ? el('button.btn.small', { title: 'Clear', onclick: () => (delete current.appearance.images[emo], renderPortraits()) }, icon('x')) : null) : null);
    }));
  };

  const pretty = (v) => (v ? v.replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()).replace(/0(\d)/, '$1') : 'None');
  const swatches = (path) => {
    const key = path.split('.').pop();
    const wrap = el('div.cm-swatches');
    const draw = () => wrap.replaceChildren(...AVATAR_OPTIONS[key].map((v) => el(`button.cm-swatch${get(path) === v ? '.on' : ''}`, { title: `#${v}`, style: { background: `#${v}` }, onclick: () => { set(path, v); draw(); renderPortraits(); renderPreview(); } })));
    draw();
    return wrap;
  };
  const avatarEditor = () => {
    const opts = (k) => AVATAR_OPTIONS[k].map((v) => [v, pretty(v)]);
    const onC = () => { renderPortraits(); renderPreview(); };
    return el('div',
      el('div.cm-grid2',
        field('Hair / headwear', selectOf('appearance.avatar.top', opts('top'), onC)),
        field('Facial hair', selectOf('appearance.avatar.facialHair', opts('facialHair'), onC)),
        field('Glasses', selectOf('appearance.avatar.accessories', opts('accessories'), onC)),
        field('Clothes', selectOf('appearance.avatar.clothing', opts('clothing'), onC))),
      field('Hair color', swatches('appearance.avatar.hairColor')),
      field('Skin', swatches('appearance.avatar.skinColor')),
      field('Clothes color', swatches('appearance.avatar.clothesColor')),
      field('Background', swatches('appearance.avatar.backgroundColor')),
      el('button.btn.small', { onclick: () => {
        const a = current.appearance.avatar;
        for (const k of ['top', 'hairColor', 'skinColor', 'facialHair', 'accessories', 'clothing', 'clothesColor', 'backgroundColor']) a[k] = pick(AVATAR_OPTIONS[k]);
        render();
      } }, icon('refresh'), 'Randomize look'));
  };

  const voiceSection = () => {
    const v = current.voice;
    const babbleStatus = el('span.muted', v.babble ? 'custom voice loaded' : 'no file yet');
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
          setText(babbleStatus, f.name);
        } }, icon('upload'), 'Upload WAV'),
        el('button.btn.small', { onclick: async () => {
          const url = await recordAudio(4000);
          if (url) {
            v.babble = url;
            setText(babbleStatus, 'recorded');
          }
        } }, icon('mic'), 'Record 4s'),
        babbleStatus), 'Your clip is chopped into syllables and pitch-shifted to "speak" every line (Animal Crossing style). Groq has no voice cloning, so this is how custom voices work.') : null,
      field('Pitch', el('input', { type: 'range', min: 0.6, max: 1.6, step: 0.05, value: v.pitch || 1, oninput: (e) => (v.pitch = Number(e.target.value)) })),
      el('div.row', { style: { margin: '6px 0 12px' } }, el('button.btn.small.primary', { onclick: () => {
        unlockAudio();
        speaker.speak(`[${'excited'}] Oh hello! My name is ${current.name.split(' ')[0]} and I definitely did not call about a virus.`, { ...v, gender: current.gender }, { emotion: 'happy' });
      } }, icon('play'), 'Test voice')),
      el('h4.cm-h', 'Voice sound effects (optional)'),
      el('p.muted', { style: { fontSize: '13px' } }, 'Played before a line when the caller feels that emotion. Upload or record a short clip.'),
      sfxGrid);
  };

  const sfxSlot = (emo, label) => {
    const has = () => !!current.voice.sfx?.[emo];
    const status = el('span.muted', has() ? 'set' : '—');
    return el('div.sfx-slot', el('b', `${EMO_LABEL[emo]} — ${label}`),
      el('div.row',
        el('button.btn.small', { onclick: async () => {
          const f = await pickFile('audio/*');
          if (!f) return;
          current.voice.sfx = { ...(current.voice.sfx || {}), [emo]: await blobToDataURL(f) };
          setText(status, 'set');
        } }, icon('folder')),
        el('button.btn.small', { onclick: async () => {
          const url = await recordAudio(2500);
          if (url) {
            current.voice.sfx = { ...(current.voice.sfx || {}), [emo]: url };
            setText(status, 'recorded');
          }
        } }, icon('mic')),
        el('button.btn.small', { onclick: () => current.voice.sfx?.[emo] && new Audio(current.voice.sfx[emo]).play() }, icon('play')),
        el('button.btn.small', { onclick: () => (delete current.voice.sfx?.[emo], (status.textContent = '—')) }, icon('x')),
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
      el('button.btn.small', { onclick: () => (current.triggers.splice(i, 1), renderRows()) }, icon('x')))));
    renderRows();
    return el('div', rows, el('button.btn.small', { onclick: () => ((current.triggers = current.triggers || []).push({ when: '', reaction: '' }), renderRows()) }, icon('plus'), 'Add reaction'));
  };

  const scenarioSection = () => el('div.row', ...content.scenarios.map((s) => el('label.row', { style: { gap: '4px', marginRight: '10px' } }, el('input', { type: 'checkbox', checked: (current.scenarios || []).includes(s.id), onchange: (e) => {
    current.scenarios = (current.scenarios || []).filter((x) => x !== s.id);
    if (e.target.checked) current.scenarios.push(s.id);
  } }), s.name)));

  const previewImg = el('img.cm-prev-img');
  const trustBars = () => el('div.cm-bars', ...[['start', 'Trust', 100], ['gullibility', 'Gullible', 10], ['patience', 'Patience', 100], ['techLiteracy', 'Tech-savvy', 10]].map(([k, l, max]) =>
    el('div.cm-bar', el('span', l), el('div', el('i', { style: { width: `${Math.round(((current.trust[k] || 0) / max) * 100)}%` } })))));
  const preview = el('div.cm-preview');
  const renderPreview = () => {
    previewImg.src = portraitFor(current, 'happy');
    preview.replaceChildren(previewImg,
      el('div.cm-prev-name', current.name || 'New client'),
      el('div.cm-prev-sub', `${current.age || '?'} · ${current.occupation || ''}`),
      el('div.cm-prev-sub', current.location || ''),
      current.isScambaiter ? el('span.cm-pill.baiter', icon('video'), 'secret scambaiter') : null,
      trustBars(),
      el('div.cm-prev-quote', current.personality ? `"${current.personality.slice(0, 120)}${current.personality.length > 120 ? '…' : ''}"` : ''));
  };
  const grid2 = (...kids) => el('div.cm-grid2', ...kids);
  const sectionBody = () => {
    switch (tab) {
      case 'basics':
        return el('div',
          el('div.cm-presets', el('span', 'Quick start:'), ...PRESETS.map((pr) => el('button.cm-preset', { onclick: () => {
            const keep = { id: current.id, name: current.name, appearance: current.appearance };
            current = { ...blankClient(), ...structuredClone(current), ...structuredClone(pr.patch), ...keep };
            current.voice = { ...current.voice, ...(pr.patch.voice || {}) };
            current.trust = { ...current.trust, ...(pr.patch.trust || {}) };
            render();
          } }, icon(pr.ic), pr.label))),
          grid2(field('Name', input('name', { onChange: renderPreview })), field('Age', input('age', { type: 'number', onChange: renderPreview }))),
          grid2(field('Gender', selectOf('gender', [['female', 'Female'], ['male', 'Male']])), field('Location', input('location', { onChange: renderPreview }))),
          field('Occupation', input('occupation', { onChange: renderPreview })),
          field('Personality', input('personality', { area: true, onChange: renderPreview }), 'The AI role-plays this. Be specific and funny — this matters most.'),
          field('How they talk', input('speakingStyle', { area: true, placeholder: 'e.g. Folksy, calls people "sugar", tells long stories.' })));
      case 'look':
        return el('div',
          el('div.cm-seg', ...[['avatar', 'Avatar builder'], ['images', 'My own pictures']].map(([v, l]) => el(`button${current.appearance.mode === v ? '.on' : ''}`, { onclick: () => { current.appearance.mode = v; render(); } }, l))),
          current.appearance.mode === 'avatar' ? avatarEditor() : el('p.muted', 'Upload or snap a picture for each emotion. Missing ones fall back to the avatar.'),
          el('h4.cm-h', 'Emotions'), portraitsGrid);
      case 'voice':
        return voiceSection();
      case 'behavior':
        return el('div', trustSection(), el('h4.cm-h', 'Special reactions'), el('p.muted', 'Rules the AI follows: "when X happens → they do Y".'), reactionsSection());
      default:
        return el('div',
          field('Catchphrases (one per line)', listInput('catchphrases')),
          field('Quirks (one per line)', listInput('quirks')),
          field('Backstory', input('backstory', { area: true })),
          field('Dialogue style', input('dialogueStyle', { area: true, placeholder: 'e.g. Answers every question with another question.' })),
          grid2(field('Shows up from day', input('minDay', { type: 'number' })), field('How often', input('weight', { type: 'number' }), '1 = normal, 3 = a lot')),
          field('Archetype hint', selectOf('archetype', [['', '(none)'], ...ARCHETYPE_KEYS.map((k) => [k, k])])),
          el('h4.cm-h', 'Which scams do they fall for?'), el('p.muted', 'Leave empty for any scam.'), scenarioSection());
    }
  };

  const render = () => {
    renderSidebar();
    current.appearance = current.appearance || { mode: 'avatar', avatar: { seed: current.id }, images: {} };
    current.appearance.mode = current.appearance.mode || (current.appearance.images && Object.keys(current.appearance.images).length ? 'images' : 'avatar');
    current.appearance.avatar = current.appearance.avatar || { seed: current.id };
    current.voice = { type: 'orpheus', voice: 'hannah', sfx: {}, ...(current.voice || {}) };
    current.trust = { start: 40, gullibility: 5, skepticism: 5, patience: 60, intelligence: 5, techLiteracy: 4, volatility: 5, ...(current.trust || {}) };
    renderPortraits();
    renderPreview();
    editor.replaceChildren(
      el('div.cm-main',
        el('div.cm-tabs', ...TABS.map(([id, label, ic]) => el(`button.cm-tab${tab === id ? '.on' : ''}`, { onclick: () => { tab = id; render(); } }, icon(ic), label))),
        el('div.cm-body', sectionBody())),
      el('div.cm-aside', preview,
        el('label.cm-toggle', el('input', { type: 'checkbox', checked: current.enabled !== false, onchange: (e) => (current.enabled = e.target.checked) }), el('span'), 'In the caller pool')),
      el('div.cm-foot',
        el('button.btn.danger.small', { title: 'Delete', onclick: async () => {
          if (!(await confirmDialog('Delete client?', `Delete ${current.name} forever?`, { ok: 'Delete', danger: true }))) return;
          await db.delete('clients', current.id);
          clients = await db.all('clients');
          current = clients[0] ? structuredClone(clients[0]) : blankClient();
          await loadContent();
          render();
        } }, icon('trash')),
        el('button.btn.small', { onclick: () => downloadBlob(new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' }), `${current.name.replace(/\W+/g, '_')}.json`) }, icon('download'), 'Export'),
        el('span.cm-spacer'),
        el('button.btn.green', { onclick: async () => { if (await save(true)) { m.close(); onTestCall?.(structuredClone(current)); } } }, icon('phone'), 'Test call'),
        el('button.btn.primary', { onclick: () => save() }, icon('save'), 'Save')),
    );
  };

  render();
  m = modal(el('div', { style: { display: 'contents' } }, sidebar, editor), { onClose, className: 'maker.cm' });
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
      } }, icon('camera'), 'Snap'))), { onClose: () => finish(null) });
  });
}

async function recordAudio(ms) {
  try {
    const { stop, done } = await voiceInput.recordClip(ms);
    toast(`Recording for ${ms / 1000}s…`, 'info', ms);
    setTimeout(stop, ms);
    const blob = await done;
    return await blobToDataURL(blob);
  } catch (err) {
    toast(`Recording failed: ${err.message}`, 'bad');
    return null;
  }
}
