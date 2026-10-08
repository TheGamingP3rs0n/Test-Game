// Walk into Mr. Chatterjee's office and press E to haggle: type to him, he answers
// (AI or canned), and if you're very lucky he cuts today's quota or wipes a strike.
// He dislikes everyone — every message raises his annoyance; at 100 you're thrown out.
import { el, money } from '../core/util.js';
import { bus } from '../core/bus.js';
import { sfx } from '../core/audio.js';
import { BOSS, bossNegotiate } from '../ai/bossBrain.js';
import { speaker, stripDirections } from '../ai/speech.js';
import { saveRun } from '../game/run.js';
import { icon } from './icons.js';
import { modal, toast } from './dialog.js';

export function openBossTalk(game) {
  const day = game.day;
  const run = game.run;
  if (!day || !run) return;
  const flags = game.dayFlags || (game.dayFlags = {});
  if (flags.bossKickedOut) {
    toast('Mr. Chatterjee already threw you out today. He is "in a meeting" (with his koi).', 'warn', 4000, { icon: 'door', title: 'Door is locked' });
    return;
  }
  if (game.calls?.active) {
    toast('Finish your call first. He can hear the caller through your headset.', 'warn', 3000, { icon: 'phone' });
    return;
  }
  const world = game.world;
  world.player.setEnabled(false);
  const boss = world.office.boss;
  world.office.bossBusy = true;
  boss.lookAtXZ(world.player.pos.x, world.player.pos.z);
  boss.play('idle');

  let annoyance = flags.bossAnnoyance || 0;
  let turns = 0;
  let busy = false;
  const history = [];

  const log = el('div.bt-log');
  const meterFill = el('div.bt-meter-fill');
  const chips = el('div.bt-chips');
  const input = el('input.input.bt-input', { placeholder: 'Make your pitch… (Enter to send)', maxLength: 240, onkeydown: (e) => { e.stopPropagation(); if (e.key === 'Enter') send(); } });
  const sendBtn = el('button.btn.primary', { onclick: () => send() }, icon('send'), 'Say it');

  const canQuota = () => !game.mp && !flags.bossQuotaCut;
  const canStrike = () => (run.strikes || 0) > 0 && !flags.bossStrikeWiped;
  const renderStatus = () => {
    meterFill.style.width = `${Math.min(100, annoyance)}%`;
    meterFill.classList.toggle('hot', annoyance >= 66);
    const quota = game.mp ? game.mpTeam.quota : day.quota;
    chips.replaceChildren(
      el(`span.bt-chip${canQuota() ? '' : '.off'}`, icon('target'), canQuota() ? `Quota ${money(quota)} — negotiable` : game.mp ? 'Team quota (fixed)' : 'Quota cut used'),
      el(`span.bt-chip${canStrike() ? '' : '.off'}`, icon('x-circle'), canStrike() ? `Strikes ${run.strikes}/3 — could wipe one` : (run.strikes ? 'Strike wipe used' : 'No strikes')),
    );
  };
  const line = (who, text) => {
    const row = el(`div.bt-line.${who}`, el('b', who === 'boss' ? BOSS.name : who === 'system' ? 'Deal' : 'You'), el('span', text));
    log.append(row);
    log.scrollTop = log.scrollHeight;
    return row;
  };

  const opener = annoyance >= 50
    ? '[groaning] YOU again. Make it quick. Quicker than that.'
    : (pickOpener());
  line('boss', stripDirections(opener));
  history.push({ who: 'boss', text: stripDirections(opener) });
  speaker.speak(opener, BOSS.voice, { emotion: 'angry', phone: false }).catch(() => {});

  async function send() {
    const text = input.value.trim();
    if (!text || busy) return;
    busy = true;
    input.value = '';
    input.disabled = true;
    sendBtn.disabled = true;
    line('player', text);
    const thinking = line('boss', '…');
    thinking.classList.add('thinking');
    const r = await bossNegotiate({
      day: day.day, quota: game.mp ? game.mpTeam.quota : day.quota, earned: Math.max(0, game.mp ? game.mpTeam.earned : day.earned),
      strikes: run.strikes || 0, canQuota: canQuota(), canStrike: canStrike(), annoyance, turns,
    }, history, text);
    turns++;
    history.push({ who: 'player', text }, { who: 'boss', text: stripDirections(r.speech) });
    thinking.classList.remove('thinking');
    thinking.lastChild.textContent = stripDirections(r.speech);
    annoyance = Math.min(100, annoyance + (r.annoyance ?? 15));
    flags.bossAnnoyance = annoyance;
    speaker.stop();
    speaker.speak(r.speech, BOSS.voice, { emotion: ['proud', 'satisfied'].includes(r.mood) ? 'happy' : 'angry', phone: false }).catch(() => {});
    boss.play(['proud', 'satisfied'].includes(r.mood) ? 'emote-yes' : 'emote-no', { loop: false, then: 'idle' });

    if (r.deal === 'quota' && canQuota()) {
      flags.bossQuotaCut = true;
      const before = day.quota;
      day.quota = Math.round(day.quota * 0.85);
      sfx('win');
      line('system', `DEAL: today's quota cut from ${money(before)} to ${money(day.quota)}.`);
      game.addHighlight?.(`Talked the boss into a lower quota (${money(day.quota)}).`);
      bus.emit('money:changed');
    } else if (r.deal === 'strike' && canStrike()) {
      flags.bossStrikeWiped = true;
      run.strikes = Math.max(0, (run.strikes || 0) - 1);
      saveRun(run);
      sfx('win');
      line('system', `DEAL: one strike erased. Strikes now ${run.strikes}/3.`);
      game.addHighlight?.('Groveled a strike off the record.');
    } else {
      sfx(annoyance >= 66 ? 'trustDown' : 'click');
    }
    renderStatus();

    if (r.deal === 'kick_out' || annoyance >= 100) {
      flags.bossKickedOut = true;
      line('system', 'You have been thrown out of the office. Don\'t come back today.');
      sfx('stamp');
      setTimeout(() => m.close(), 1800);
      return;
    }
    busy = false;
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
  }

  renderStatus();
  const body = el('div.bosstalk',
    el('div.bt-head', el('div.bt-avatar', icon('angry')), el('div', el('h2', BOSS.name), el('p.muted', 'Regional Manager · hates interruptions · loves his koi, Rajesh'))),
    el('div.bt-meter', el('span', 'Annoyance'), el('div.bt-meter-bar', meterFill)),
    chips,
    log,
    el('div.bt-compose', input, sendBtn),
    el('p.help', 'Tip: flattery, Rajesh the koi, and a genuinely good pitch work better than begging. One quota cut and one strike wipe per day, max.'));
  const m = modal(body, {
    className: 'bosstalk-modal',
    onClose: () => {
      speaker.stop();
      world.office.bossBusy = false;
      if (game.playing && world.mode === 'play') { world.player.setEnabled(true); world.player.requestLock(); }
    },
  });
  setTimeout(() => input.focus(), 50);
  return m;
}

function pickOpener() {
  const o = [
    '[shouting] WHAT. Who let you in? Why are you not on the phone?',
    '[annoyed] You have thirty seconds. Twenty-nine. Twenty-eight…',
    '[suspicious] If this is about the air conditioning, the answer is no.',
    '[sighing] Sit. Don\'t sit. Talk. Fast.',
  ];
  return o[Math.floor(Math.random() * o.length)];
}
