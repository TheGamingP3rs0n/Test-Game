// Settings: Groq API key + models, voice in/out, audio, gameplay, graphics.
import { el } from '../core/util.js';
import { settings, updateSettings, DEFAULT_SETTINGS, hasApiKey } from '../core/store.js';
import { testKey, ALL_VOICES } from '../ai/groq.js';
import { speaker } from '../ai/speech.js';
import { modal, toast } from './dialog.js';
import { QUALITY } from '../world/render.js';
import { unlockAudio, sfx } from '../core/audio.js';

export function openSettings({ onClose } = {}) {
  let tab = 'ai';
  const body = el('div');
  const tabs = el('div.tabs');
  const tabList = [['ai', '🤖 AI & API key'], ['voice', '🎙️ Voice'], ['audio', '🔊 Audio'], ['game', '🎮 Gameplay'], ['graphics', '🖼️ Graphics']];
  const renderTabs = () => tabs.replaceChildren(...tabList.map(([id, label]) => el(`div.tab${id === tab ? '.on' : ''}`, { onclick: () => ((tab = id), renderTabs(), render()) }, label)));

  const field = (label, input, help) => el('div.field', el('label', label), input, help ? el('div.help', help) : null);
  const text = (key, opts = {}) => el('input', { type: opts.type || 'text', value: settings[key] ?? '', placeholder: opts.placeholder || '', onchange: (e) => updateSettings({ [key]: e.target.value }), onkeydown: (e) => e.stopPropagation() });
  const select = (key, options) => el('select', { onchange: (e) => updateSettings({ [key]: e.target.value }) }, options.map(([v, l]) => el('option', { value: v, selected: settings[key] === v }, l)));
  const range = (key, min, max, step = 0.05) => {
    const out = el('span.muted', String(settings[key]));
    const r = el('input', { type: 'range', min, max, step, value: settings[key], oninput: (e) => { out.textContent = e.target.value; updateSettings({ [key]: Number(e.target.value) }); } });
    return el('div.row', { style: { flexWrap: 'nowrap' } }, r, out);
  };
  const check = (key, label) => el('label.row', { style: { cursor: 'pointer' } }, el('input', { type: 'checkbox', checked: !!settings[key], onchange: (e) => updateSettings({ [key]: e.target.checked }) }), label);

  const render = () => {
    if (tab === 'ai') {
      const status = el('div.muted', { style: { minHeight: '18px' } }, hasApiKey() ? '🔑 Key saved.' : 'No key yet — the game runs in offline mode.');
      const key = el('input', { type: 'password', value: settings.apiKey, placeholder: 'gsk_...', autocomplete: 'off', onchange: (e) => updateSettings({ apiKey: e.target.value.trim() }), onkeydown: (e) => e.stopPropagation() });
      const show = el('button.btn.small.ghost', { onclick: () => (key.type = key.type === 'password' ? 'text' : 'password') }, '👁');
      body.replaceChildren(
        el('h3', 'Groq API key'),
        field('API key', el('div.row', { style: { flexWrap: 'nowrap' } }, key, show), el('span', 'Get one free at ', el('a', { href: 'https://console.groq.com/keys', target: '_blank', rel: 'noopener', style: { color: 'var(--yellow)' } }, 'console.groq.com/keys'), '. Stored only in this browser (localStorage) and sent only to api.groq.com.')),
        el('div.row', { style: { marginBottom: '12px' } },
          el('button.btn.small.primary', { onclick: async () => {
            updateSettings({ apiKey: key.value.trim() });
            status.textContent = 'Testing…';
            try {
              const models = await testKey();
              const need = [settings.chatModel, settings.ttsModel, settings.sttModel];
              const missing = need.filter((m) => !models.includes(m));
              status.textContent = missing.length ? `✅ Key works, but your account can't see: ${missing.join(', ')}. (TTS may need accepting Orpheus terms in the Groq console playground.)` : '✅ Key works! All three models are available.';
            } catch (err) {
              status.textContent = `❌ ${err.message}`;
            }
          } }, 'Test key'),
          el('button.btn.small.ghost', { onclick: () => { updateSettings({ apiKey: '' }); key.value = ''; status.textContent = 'Key removed.'; } }, 'Remove key')),
        status,
        el('h3', 'Models'),
        field('Text model', text('chatModel'), 'Default openai/gpt-oss-20b — the cheapest model on Groq\'s pay-as-you-go plan ($0.075 / $0.30 per 1M tokens). Try openai/gpt-oss-120b for smarter callers.'),
        field('Text-to-speech', text('ttsModel'), 'canopylabs/orpheus-v1-english — Groq\'s TTS ($22 per 1M characters). Supports [vocal directions].'),
        field('Speech-to-text', text('sttModel'), 'whisper-large-v3 — Groq\'s most accurate Whisper ($0.111/hour). whisper-large-v3-turbo is cheaper ($0.04/hour).'),
        field('Caller creativity', range('aiCreativity', 0.2, 1.3, 0.05), 'Higher = more unhinged callers.'),
        el('div.row', { style: { justifyContent: 'flex-end' } }, el('button.btn.small.ghost', { onclick: () => { updateSettings({ chatModel: DEFAULT_SETTINGS.chatModel, ttsModel: DEFAULT_SETTINGS.ttsModel, sttModel: DEFAULT_SETTINGS.sttModel }); render(); } }, 'Reset models to defaults')),
      );
    } else if (tab === 'voice') {
      const voiceSel = el('select', ALL_VOICES.map((v) => el('option', { value: v }, v)));
      body.replaceChildren(
        el('h3', 'Caller voices (output)'),
        field('Voice output', select('voiceOutput', [['groq', 'Groq Orpheus (best)'], ['browser', 'Browser built-in voices (free)'], ['off', 'Off (subtitles only)']])),
        field('Test a voice', el('div.row', voiceSel, el('button.btn.small', { onclick: async () => {
          unlockAudio();
          try {
            await speaker.speak('[nervous] Hello? Is this the computer company? My screen says I have thirty seven viruses!', { type: 'orpheus', voice: voiceSel.value, gender: ['autumn', 'diana', 'hannah'].includes(voiceSel.value) ? 'female' : 'male' }, { emotion: 'scared' });
          } catch (err) {
            toast(err.message, 'bad');
          }
        } }, '▶ Play'))),
        el('h3', 'Your voice (input)'),
        field('Speech recognition', select('voiceInput', [['groq', 'Groq Whisper (best)'], ['browser', 'Browser speech recognition (Chrome/Edge)'], ['text', 'Type only (no microphone)']])),
        field('Push-to-talk key', el('div.row', el('span.kbd', (settings.pttKey || 'KeyV').replace('Key', '')), el('button.btn.small', { onclick: (e) => {
          e.target.textContent = 'Press a key…';
          const h = (ev) => {
            ev.preventDefault();
            updateSettings({ pttKey: ev.code });
            document.removeEventListener('keydown', h, true);
            render();
          };
          document.addEventListener('keydown', h, true);
        } }, 'Change')), 'Hold it while talking. You can also hold the big mic button.'),
        field('Mic check', el('button.btn.small', { onclick: async () => {
          try {
            await navigator.mediaDevices.getUserMedia({ audio: true });
            toast('🎙️ Microphone OK!');
          } catch (err) {
            toast(`Microphone blocked: ${err.message}`, 'bad');
          }
        } }, 'Request microphone permission')),
      );
    } else if (tab === 'audio') {
      body.replaceChildren(
        field('Master volume', range('masterVolume', 0, 1)),
        field('Voices', range('voiceVolume', 0, 1.5)),
        field('Sound effects', range('sfxVolume', 0, 1)),
        field('Office ambience', range('ambienceVolume', 0, 1)),
        el('button.btn.small', { onclick: () => (unlockAudio(), sfx('cash')) }, '🔊 Test sound'),
      );
    } else if (tab === 'game') {
      body.replaceChildren(
        field('Workday length', range('dayLengthMinutes', 4, 25, 1), 'Real minutes per 9-to-5 shift. Longer = more calls per day.'),
        field('Mouse sensitivity', range('mouseSensitivity', 0.2, 3, 0.1)),
        field('Your fake name', text('agentAlias'), 'What you call yourself on the phone (just for flavor).'),
        field('Subtitles', check('showSubtitles', 'Show caller subtitles in 3D view')),
        field('Caller thoughts', check('showCallerThoughts', 'Reveal what callers were secretly thinking after each call')),
      );
    } else if (tab === 'graphics') {
      body.replaceChildren(
        field('Quality preset', select('graphics', Object.entries(QUALITY).map(([k, q]) => [k, q.label])), 'Ultra: 4K shadows, full-res. High: AO, bloom, sun shafts, floor reflections. Medium: no AO/reflections. Low: for laptops.'),
        el('p.muted', 'Rendering: ACES tone mapping, golden-hour sun with shadow-mapped blinds, rect-area ceiling lights, a baked reflection + irradiance probe, ground-truth ambient occlusion, bloom, raymarched volumetric sun shafts, planar floor reflections and a film grade.'),
      );
    }
  };
  renderTabs();
  render();
  const m = modal(el('div.settings', el('h2', 'Settings'), tabs, body, el('div.row', { style: { justifyContent: 'flex-end', marginTop: '14px' } }, el('button.btn.primary', { onclick: () => m.close() }, 'Done'))), { onClose, className: 'settings' });
  return m;
}
