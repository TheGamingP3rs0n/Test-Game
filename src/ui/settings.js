// Settings: Groq API key + models, voice in/out, audio, gameplay, graphics.
import { el, setText } from '../core/util.js';
import { settings, updateSettings, DEFAULT_SETTINGS, hasApiKey } from '../core/store.js';
import { testKey, ALL_VOICES, usage, CHAT_FALLBACKS } from '../ai/groq.js';
import { icon } from './icons.js';
import { speaker } from '../ai/speech.js';
import { modal, toast } from './dialog.js';
import { QUALITY } from '../world/render.js';
import { unlockAudio, sfx } from '../core/audio.js';
import { VERSION } from '../core/store.js';
import { checkForUpdates, BUILD_DATE, UPDATE_REPO } from '../core/updater.js';
import { toggleFullscreen } from '../core/display.js';

export function openSettings({ onClose } = {}) {
  let tab = 'ai';
  const body = el('div');
  const tabs = el('div.tabs');
  const tabList = [['ai', 'bot', 'AI & API key'], ['voice', 'mic', 'Voice'], ['audio', 'volume', 'Audio'], ['game', 'gamepad', 'Gameplay'], ['graphics', 'image', 'Graphics'], ['display', 'monitor', 'Display'], ['access', 'eye', 'Accessibility'], ['about', 'download', 'Updates']];
  const renderTabs = () => tabs.replaceChildren(...tabList.map(([id, ic, label]) => el(`div.tab${id === tab ? '.on' : ''}`, { onclick: () => ((tab = id), renderTabs(), render()) }, icon(ic), label)));

  const field = (label, input, help) => el('div.field', el('label', label), input, help ? el('div.help', help) : null);
  const text = (key, opts = {}) => el('input', { type: opts.type || 'text', value: settings[key] ?? '', placeholder: opts.placeholder || '', onchange: (e) => updateSettings({ [key]: e.target.value }), onkeydown: (e) => e.stopPropagation() });
  const coerce = (key, v) => (typeof DEFAULT_SETTINGS[key] === 'number' ? Number(v) : typeof DEFAULT_SETTINGS[key] === 'boolean' ? v === 'true' : v);
  const select = (key, options) => el('select', { onchange: (e) => updateSettings({ [key]: coerce(key, e.target.value) }) }, options.map(([v, l]) => el('option', { value: v, selected: String(settings[key]) === String(v) }, l)));
  const range = (key, min, max, step = 0.05) => {
    const out = el('span.muted', String(settings[key]));
    const r = el('input', { type: 'range', min, max, step, value: settings[key], oninput: (e) => { out.textContent = e.target.value; updateSettings({ [key]: Number(e.target.value) }); } });
    return el('div.row', { style: { flexWrap: 'nowrap' } }, r, out);
  };
  const check = (key, label) => el('label.row', { style: { cursor: 'pointer' } }, el('input', { type: 'checkbox', checked: !!settings[key], onchange: (e) => updateSettings({ [key]: e.target.checked }) }), label);

  const render = () => {
    if (tab === 'ai') {
      const status = el('div.muted', { style: { minHeight: '18px' } }, hasApiKey() ? 'Key saved.' : 'No key yet — the game runs in offline mode.');
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
              setText(status, missing.length ? `✅ Key works, but your account can't see: ${missing.join(', ')}. (TTS may need accepting Orpheus terms in the Groq console playground.)` : '✅ Key works! All models are available.');
            } catch (err) {
              setText(status, `❌ ${err.message}`);
            }
          } }, 'Test key'),
          el('button.btn.small.ghost', { onclick: () => { updateSettings({ apiKey: '' }); key.value = ''; status.textContent = 'Key removed.'; } }, 'Remove key')),
        status,
        el('h3', 'Models'),
        field('Text model', text('chatModel'), 'Default openai/gpt-oss-20b — the cheapest model on Groq\'s pay-as-you-go plan ($0.075 / $0.30 per 1M tokens). Try openai/gpt-oss-120b for smarter callers.'),
        field('Text-to-speech', text('ttsModel'), 'canopylabs/orpheus-v1-english — Groq\'s TTS ($22 per 1M characters). Supports [vocal directions].'),
        field('Speech-to-text', text('sttModel'), 'whisper-large-v3 — Groq\'s most accurate Whisper ($0.111/hour). whisper-large-v3-turbo is cheaper ($0.04/hour).'),
        field('Caller creativity', range('aiCreativity', 0.2, 1.3, 0.05), 'Higher = more unhinged callers.'),
        el('h3', 'Free tier'),
        el('p.muted', { style: { fontSize: '13px' } }, `Groq's free tier allows only a few thousand tokens per minute per model, so the game keeps prompts short, paces requests, and switches to another free model (${CHAT_FALLBACKS.filter((m) => m !== settings.chatModel).join(', ')}) when one is busy. Free voices (Orpheus) have a small daily limit — after that, callers use your browser's voices.`),
        el('div.usage', `This session: ${usage.chatCalls} AI replies • ${(usage.promptTokens + usage.completionTokens).toLocaleString()} tokens (${usage.cachedTokens.toLocaleString()} cached) • ${usage.ttsChars.toLocaleString()} voice chars • ${usage.rateLimited} rate-limit waits • ${usage.fallbacks} backup-model replies`),
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
        field('Speech recognition', select('voiceInput', [['groq', 'Groq Whisper large-v3 (most accurate)'], ['browser', 'Browser recognition — free, live captions (Chrome/Edge)'], ['text', 'Type only (no microphone)']]), 'The mic only turns on while you hold push-to-talk. Wait for the little click before you start speaking. Browser recognition costs no Groq quota and shows your words live as you speak.'),
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
        field('Proximity voice (co-op)', check('proxVoice', 'Hold B to talk to teammates near you — muffled through walls'), 'Peer-to-peer over your Wi-Fi. The mic only opens while you hold B.'),
        field('Mic check', el('button.btn.small', { onclick: async () => {
          try {
            const s = await navigator.mediaDevices.getUserMedia({ audio: true });
            s.getTracks().forEach((t) => t.stop());
            toast('Microphone works!', 'info', 3000, { icon: 'mic' });
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
        field('Music', range('musicVolume', 0, 1)),
        el('button.btn.small', { onclick: () => (unlockAudio(), sfx('cash')) }, icon('volume'), 'Test sound'),
      );
    } else if (tab === 'game') {
      body.replaceChildren(
        field('Field of view', range('fov', 60, 100, 1), 'Vertical field of view in degrees (default 80).'),
        field('Mouse sensitivity', range('mouseSensitivity', 0.2, 3, 0.1)),
        field('Your fake name', text('agentAlias'), 'What you call yourself on the phone (just for flavor).'),
        field('Subtitles', check('showSubtitles', 'Show caller subtitles in 3D view')),
        field('Caller thoughts', check('showCallerThoughts', 'Reveal what callers were secretly thinking after each call')),
      );
    } else if (tab === 'display') {
      body.replaceChildren(
        field('Fullscreen', el('button.btn.small', { onclick: () => toggleFullscreen() }, icon('monitor'), document.fullscreenElement ? 'Exit fullscreen' : 'Go fullscreen'), 'F11 works too.'),
        field('Render scale', range('renderScale', 0.5, 1, 0.05), 'Lower = faster on weak laptops (the 3D view renders at fewer pixels; UI stays sharp).'),
        field('Frame rate limit', select('fpsCap', [[0, 'Unlimited'], [30, '30 FPS'], [60, '60 FPS'], [120, '120 FPS']].map(([v, l]) => [String(v), l])), 'Cap the frame rate to save battery / reduce fan noise.'),
        field('Brightness', range('brightness', 0.7, 1.4, 0.05)),
        field('Interface size', range('uiScale', 0.8, 1.35, 0.05), 'Scales menus, HUD and the work PC.'),
        field('HUD opacity', range('hudOpacity', 0.35, 1, 0.05)),
        field('FPS counter', check('showFps', 'Show frames per second in the corner')),
      );
    } else if (tab === 'access') {
      body.replaceChildren(
        el('h3', 'Vision'),
        field('Colour-blind mode', select('colorblind', [['off', 'Off'], ['protanopia', 'Protanopia (red-weak)'], ['deuteranopia', 'Deuteranopia (green-weak)'], ['tritanopia', 'Tritanopia (blue-weak)']]), 'Swaps red/green UI colours for safer pairs and adjusts the 3D view.'),
        field('High contrast', check('highContrast', 'Solid, high-contrast panels and text')),
        field('Subtitle size', select('subtitleSize', [['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large'], ['xl', 'Extra large']])),
        field('Crosshair', select('crosshair', [['dot', 'Dot'], ['cross', 'Cross'], ['none', 'Hidden']])),
        el('h3', 'Motion'),
        field('Camera shake', check('cameraShake', 'Shake the camera during explosions and raids')),
        field('Reduce motion', check('reduceMotion', 'Turn off screen shake, flashing and most UI animations')),
        el('h3', 'Controls'),
        field('Push-to-talk mode', select('pttToggle', [['false', 'Hold to talk'], ['true', 'Tap to start / tap to stop']].map(([v, l]) => [v, l])), 'Tap mode is easier if holding a key is uncomfortable.'),
        field('Caller subtitles', check('showSubtitles', 'Always show what callers say')),
      );
    } else if (tab === 'about') {
      const out = el('div.upd-out');
      const last = settings.lastUpdateCheck ? new Date(settings.lastUpdateCheck).toLocaleString() : 'never';
      const run = async () => {
        out.replaceChildren(el('div.muted', 'Checking GitHub…'));
        try {
          const r = await checkForUpdates();
          if (!r.latest) { out.replaceChildren(el('div.upd-card', el('b', 'No releases published yet.'), el('p.muted', `Releases appear here once they're published on github.com/${UPDATE_REPO}.`))); return; }
          out.replaceChildren(
            r.newer
              ? el('div.upd-card.new', el('div.upd-row', icon('download'), el('b', `Update available: ${r.latest.name}`)), r.latest.notes ? el('pre.upd-notes', r.latest.notes.slice(0, 900)) : null,
                el('div.row', el('a.btn.primary', { href: r.latest.download, target: '_blank', rel: 'noopener' }, icon('download'), 'Download update'), el('a.btn.ghost', { href: r.latest.page, target: '_blank', rel: 'noopener' }, 'Release notes')),
                el('p.help', 'Unzip it over your current game folder and relaunch. Your saves and settings live in the browser, so they carry over.'))
              : el('div.upd-card.ok', el('div.upd-row', icon('check'), el('b', `You're up to date (${VERSION}).`))),
            r.releases.length ? el('div.upd-old', el('h3', 'All versions'), ...r.releases.map((x) => el('div.upd-ver', el('b', x.name), el('span.muted', x.date ? new Date(x.date).toLocaleDateString() : ''), x.tag === VERSION ? el('span.upd-cur', 'installed') : null, el('a', { href: x.download, target: '_blank', rel: 'noopener' }, icon('download'), 'zip')))) : null);
        } catch (err) {
          out.replaceChildren(el('div.upd-card.bad', el('b', 'Could not check for updates.'), el('p.muted', err.message)));
        }
      };
      body.replaceChildren(
        el('div.upd-head', el('div', el('div.upd-ver-big', VERSION), el('div.muted', `Built ${BUILD_DATE ? new Date(BUILD_DATE).toLocaleString() : 'in development'} · last checked ${last}`)),
          el('button.btn.primary', { onclick: run }, icon('refresh'), 'Check for updates')),
        field('Automatic checks', check('autoUpdateCheck', 'Check GitHub for a new version when the game starts (once a day)')),
        out);
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
