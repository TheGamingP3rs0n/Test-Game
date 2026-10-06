// Mods screen: import JSON mods (callers / scenarios / events), toggle and delete them,
// reload content, and copy example templates.
import { el, pickFile, downloadBlob } from '../core/util.js';
import { db } from '../core/db.js';
import { settings, updateSettings } from '../core/store.js';
import { content, loadContent, importModJSON } from '../game/content.js';
import { modal, toast, confirmDialog } from './dialog.js';

const CALLER_TEMPLATE = {
  id: 'my-caller',
  name: 'Herbert Pennywhistle',
  age: 81,
  gender: 'male',
  location: 'Bangor, Maine',
  occupation: 'Retired lighthouse keeper',
  minDay: 1,
  weight: 2,
  personality: 'Lonely, chatty, thinks every caller is a long-lost friend. Terrified of computers.',
  speakingStyle: 'Old sea-captain talk, says "ahoy" and "by the barnacles".',
  quirks: ['Talks to his parrot mid-sentence'],
  catchphrases: ['By the barnacles!'],
  trust: { start: 55, gullibility: 8, skepticism: 2, patience: 85, intelligence: 4, techLiteracy: 1, volatility: 4 },
  savings: 30000,
  isScambaiter: false,
  triggers: [{ when: 'the agent mentions the sea', reaction: 'he trusts them instantly' }],
  voice: { type: 'orpheus', voice: 'troy', style: '[gravelly]' },
  appearance: { avatar: { seed: 'herbert', top: 'hat', hairColor: 'e8e1e1', facialHair: 'beardMajestic', clothing: 'overall', clothesColor: '25557c' } },
};
const SCENARIO_TEMPLATE = { id: 'my-scam', name: 'Pet Insurance Emergency', impersonate: 'PawSafe Pet Insurance claims department', leadSource: 'Email: "Your pet insurance has lapsed!"', callerContext: 'You got an email saying your pet insurance lapsed and your pet is uninsured.', unlockDay: 1, payout: 1.2, icon: '🐶', playbook: ['Mention their pet by name', 'Invent a scary uninsured scenario', 'Offer reinstatement for a fee'] };
const EVENT_TEMPLATE = { id: 'my-event', type: 'narrative', name: 'Pigeon in the Office', minDay: 1, weight: 1, message: '🐦 A pigeon flew in and is attacking Raju.', background: 'Someone is screaming about a pigeon.', choices: [{ label: 'Bribe it with samosa (-$5)', effects: { money: -5 }, result: 'The pigeon accepts.' }, { label: 'Ignore it', effects: { timeMinutes: -10 }, result: 'It steals your pen.' }] };

export async function openMods({ onClose } = {}) {
  let m;
  const body = el('div');
  const render = async () => {
    const mods = await db.all('mods');
    body.replaceChildren(
      el('h2', '🧩 Mods'),
      el('p', `Loaded: ${content.callers.length} callers, ${content.scenarios.length} scams, ${content.events.length} events, ${content.customClients.length} custom clients.`),
      content.errors.length ? el('div.keywarn', el('b', 'Problems while loading:'), el('ul', content.errors.map((e) => el('li', e)))) : null,
      el('div.row', { style: { margin: '10px 0' } },
        el('button.btn.primary', { onclick: async () => {
          const files = await pickFile('.json,application/json', true);
          for (const f of files || []) {
            try {
              const { counts } = await importModJSON(JSON.parse(await f.text()), f.name);
              toast(`🧩 ${f.name}: ${counts.callers} callers, ${counts.scenarios} scams, ${counts.events} events`);
            } catch (err) {
              toast(`${f.name}: ${err.message}`, 'bad');
            }
          }
          await loadContent();
          render();
        } }, '📥 Import mod JSON'),
        el('button.btn', { onclick: async () => (await loadContent(), toast('🔄 Reloaded /mods and imported mods'), render()) }, '🔄 Reload content')),
      el('h3', 'Imported mods'),
      mods.length ? mods.map((mod) => el('div.mod-row',
        el('div', { style: { flex: 1 } }, el('b', mod.name), el('div.muted', { style: { fontSize: '12px' } }, `${(mod.data.callers || []).length} callers • ${(mod.data.scenarios || []).length} scams • ${(mod.data.events || []).length} events`)),
        el('label.row', el('input', { type: 'checkbox', checked: settings.enabledMods?.[mod.id] !== false, onchange: async (e) => { updateSettings({ enabledMods: { ...settings.enabledMods, [mod.id]: e.target.checked } }); await loadContent(); render(); } }), 'Enabled'),
        el('button.btn.small.danger', { onclick: async () => { if (await confirmDialog('Remove mod?', mod.name, { ok: 'Remove', danger: true })) { await db.delete('mods', mod.id); await loadContent(); render(); } } }, '🗑'))) : el('p.muted', 'None yet.'),
      el('h3', 'Modding the game files'),
      el('p', 'Everything in ', el('code', 'public/mods/'), ' loads at startup through ', el('code', 'public/mods/manifest.json'), '. Add your own JSON files there and list them in the manifest, or import them above. Custom voices: drop WAV files in ', el('code', 'public/mods/voices/'), ' and reference them as ', el('code', '"voice": { "type": "wav", "babble": "/mods/voices/you.wav" }'), '. See ', el('code', 'public/mods/README.md'), ' for every field.'),
      el('div.row', { style: { marginBottom: '8px' } },
        el('button.btn.small', { onclick: () => dl(CALLER_TEMPLATE, 'caller-template.json') }, '📄 Caller template'),
        el('button.btn.small', { onclick: () => dl({ scenarios: [SCENARIO_TEMPLATE] }, 'scenario-template.json') }, '📄 Scam template'),
        el('button.btn.small', { onclick: () => dl({ events: [EVENT_TEMPLATE] }, 'event-template.json') }, '📄 Event template'),
        el('button.btn.small', { onclick: () => dl({ modName: 'My Mod Pack', callers: [CALLER_TEMPLATE], scenarios: [SCENARIO_TEMPLATE], events: [EVENT_TEMPLATE] }, 'mod-pack-template.json') }, '📦 Full mod pack')),
      el('pre.code', JSON.stringify(CALLER_TEMPLATE, null, 2)),
      el('div.row', { style: { justifyContent: 'flex-end', marginTop: '12px' } }, el('button.btn.primary', { onclick: () => m.close() }, 'Done')),
    );
  };
  await render();
  m = modal(body, { onClose, className: 'mods' });
  return m;
}

function dl(obj, name) {
  downloadBlob(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }), name);
}
