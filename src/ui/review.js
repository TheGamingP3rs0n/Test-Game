// End-of-day performance review in the boss's office.
import { el, setText, money, sleep } from '../core/util.js';
import { bus } from '../core/bus.js';
import { sfx, unlockAudio } from '../core/audio.js';
import { BOSS, bossReview, bossExcuse } from '../ai/bossBrain.js';
import { speaker, stripDirections, voiceInput } from '../ai/speech.js';
import { settings } from '../core/store.js';

const MOOD_DIRECTION = { proud: '[suspiciously cheerful]', satisfied: '[grumbling]', disappointed: '[exasperated]', furious: '[shouting]', apocalyptic: '[furious screaming]' };

export function showReview(screens, game, report) {
  screens.recapModal?.close(); // a call cut off by the bell shouldn't cover the report
  const speech = el('div.boss-speech', el('span.thinking', 'Mr. Chatterjee is inhaling'));
  const stampSlot = el('div');
  const actions = el('div.col', { style: { marginTop: '12px' } });
  const pct = Math.round((report.earned / report.quota) * 100);
  const stat = (k, v, color) => el('div.stat', el('span', k), el('b', { style: color ? { color } : {} }, v));
  const stats = el('div.panel.stats',
    el('h2', `Day ${report.day} report`),
    stat('Quota', money(report.quota)),
    stat('Earned', `${money(report.earned)} (${pct}%)`, pct >= 100 ? 'var(--green-2)' : 'var(--red)'),
    stat('Calls answered', report.callsTaken),
    stat('Missed calls', report.missedCalls, report.missedCalls ? 'var(--orange)' : null),
    stat('Successful scams', report.scamsWon),
    stat('Hang-ups', report.hangups),
    stat('Scambaiters caught', report.baitersFlagged),
    stat('Exposed by scambaiters', report.exposed, report.exposed ? 'var(--red)' : null),
    stat('Disasters', `${report.disasters.filter((d) => d.success).length}/${report.disasters.length} handled`),
    stat('Police heat', `${Math.round(report.heat)}/100`),
    report.callLog.length ? el('div.recap', el('h3', 'Calls'), report.callLog.map((c) => el('div.item', `${c.paid ? '💰' : c.outcome === 'exposed' ? '🔴' : c.outcome === 'flagged' ? '🚩' : '📵'} ${c.name} — ${c.scenario} ${c.paid ? `(${money(c.paid)})` : ''}`))) : null);
  const bossPanel = el('div.panel.boss',
    el('div.boss-name', '😤 ', BOSS.name, el('span.muted', { style: { fontFamily: 'var(--font)', fontSize: '13px' } }, 'Regional Director of Customer Happiness')),
    speech, stampSlot, actions);
  screens.show(el('div.screen.clear', { style: { alignItems: 'flex-end', paddingBottom: '24px', background: 'linear-gradient(90deg, rgba(0,0,0,.55), transparent 32%, transparent 64%, rgba(0,0,0,.55))' } }, el('div.review', stats, bossPanel)));

  let excuseAccepted = false;
  let excuseUsed = false;

  const typewriter = async (text) => {
    speech.replaceChildren();
    const clean = stripDirections(text);
    for (let i = 0; i <= clean.length; i += 2) {
      speech.textContent = clean.slice(0, i);
      await sleep(18);
    }
    speech.textContent = clean;
  };

  const bossSays = async (text, mood) => {
    const line = /^\[/.test(text) ? text : `${MOOD_DIRECTION[mood] || ''} ${text}`;
    const boss = game.world.office.boss;
    boss.play(['proud', 'satisfied'].includes(mood) ? 'emote-yes' : 'emote-no', { loop: true });
    if (['furious', 'apocalyptic'].includes(mood)) game.world.fx.addShake(0.35);
    await Promise.all([typewriter(text), speaker.speak(line, BOSS.voice, { emotion: ['proud', 'satisfied'].includes(mood) ? 'happy' : 'angry', phone: false }).catch(() => {})]);
    boss.play('idle');
  };

  const finish = () => {
    speaker.stop();
    screens.hide();
    game.finishReview({ report, excuseAccepted });
  };

  (async () => {
    await sleep(1300);
    const r = await bossReview(report);
    await bossSays(r.speech, r.mood);
    sfx('stamp');
    stampSlot.replaceChildren(el(`div.stamp.${report.verdict}`, { promoted: 'PROMOTED', survived: 'SURVIVED', warning: 'STRIKE?', strike: 'STRIKE', fired: 'FIRED' }[report.verdict] || report.verdict.toUpperCase()), r.nickname ? el('div.muted', `New nickname: "${r.nickname}"`) : null);
    renderActions();
  })();

  function renderActions() {
    const input = el('input.input', { placeholder: report.rule.excusable ? 'Make an excuse… (it could save you from the strike)' : 'Say something to the boss…', onkeydown: (e) => (e.stopPropagation(), e.key === 'Enter' && respond(input.value)) });
    const respond = async (text) => {
      text = String(text || '').trim();
      if (!text || excuseUsed) return;
      excuseUsed = true;
      actions.replaceChildren(el('div.muted', `You: "${text}"`), el('div.thinking', 'Mr. Chatterjee is processing your audacity'));
      const r = await bossExcuse(report, text);
      excuseAccepted = !!r.accepted;
      await bossSays(r.speech, r.mood);
      if (report.rule.excusable) {
        sfx(excuseAccepted ? 'win' : 'lose');
        stampSlot.replaceChildren(el(`div.stamp.${excuseAccepted ? 'survived' : 'strike'}`, excuseAccepted ? 'EXCUSED' : 'STRIKE'));
      }
      actions.replaceChildren(el('button.btn.big.primary', { onclick: finish }, report.verdict === 'fired' ? 'Clean out your desk' : 'Leave the office ▶'));
    };
    let micHeld = false;
    const mic = el('button.btn', { title: 'Hold to talk', onmousedown: async () => {
      unlockAudio();
      try {
        micHeld = true;
        setText(mic, '🔴 Listening…');
        await voiceInput.begin();
      } catch (err) {
        micHeld = false;
        setText(mic, '🎙️ Hold');
        bus.emit('toast', { kind: 'warn', text: err.message });
      }
    }, onmouseup: async () => {
      if (!micHeld) return;
      micHeld = false;
      setText(mic, '🎙️ Hold');
      const t = await voiceInput.end('Talking to an angry boss about the daily quota.').catch(() => '');
      if (t) respond(t);
    } }, '🎙️ Hold');
    actions.replaceChildren(
      report.verdict === 'fired' ? null : el('div.row', { style: { flexWrap: 'nowrap' } }, input, mic, el('button.btn', { onclick: () => respond(input.value) }, 'Say')),
      el('div.row', report.verdict === 'fired' ? el('button.btn.big.danger', { onclick: finish }, 'Clean out your desk') : el('button.btn.ghost', { onclick: finish }, 'Just leave (say nothing)')),
    );
    if (settings.voiceInput === 'text') mic.disabled = true;
    setTimeout(() => input.focus(), 50);
  }
}
