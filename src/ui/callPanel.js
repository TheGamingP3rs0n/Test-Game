// The call panel: caller ID, live portrait (changes with emotion), the Trust Meter,
// patience, transcript, push-to-talk, typed replies, intel chips and call actions.
import { el, typingInField, escapeHtml } from '../core/util.js';
import { bus } from '../core/bus.js';
import { settings } from '../core/store.js';
import { voiceInput, speaker } from '../ai/speech.js';
import { trustLabel } from '../ai/callerBrain.js';
import { portraitFor } from './portraits.js';
import { sfx, unlockAudio } from '../core/audio.js';
import { confirmDialog } from './dialog.js';

const EMO_ICON = { neutral: '😐', happy: '😊', excited: '🤩', confused: '😕', suspicious: '🤨', angry: '😡', scared: '😱', sad: '😢' };

export class CallPanel {
  constructor(root, game) {
    this.game = game;
    this.node = el('div.callpanel', { style: { display: 'none' } });
    root.append(this.node);
    this.talking = false;
    this.bind();
  }

  get calls() {
    return this.game.calls;
  }

  bind() {
    bus.on('call:ring', (caller) => this.renderRinging(caller));
    bus.on('call:missed', () => this.hide());
    bus.on('call:start', ({ caller, conv }) => this.renderActive(caller, conv));
    bus.on('call:line', (l) => this.addLine(l));
    bus.on('call:update', (u) => this.updateTrust(u));
    bus.on('call:thinking', (on) => this.setThinking(on));
    bus.on('call:speaking', (on) => this.portrait?.classList.toggle('talking', on));
    bus.on('call:hold', (on) => this.holdBadge && (this.holdBadge.style.display = on ? '' : 'none'));
    bus.on('call:end', () => this.hide());
    bus.on('intel:added', () => this.renderIntel());
    bus.on('mic:interim', (t) => this.talking && this.pttLabel && (this.pttLabel.textContent = t || 'Listening…'));

    // push-to-talk key + answer key
    document.addEventListener('keydown', (e) => {
      if (typingInField() || e.repeat) return;
      if (e.code === (settings.pttKey || 'KeyV') && this.calls.active) {
        e.preventDefault();
        this.startTalk();
      }
      if (e.code === 'KeyF' && this.calls.state === 'ringing' && this.game.playing && !this.game.paused) this.calls.answer();
      if (e.code === 'Enter' && this.calls.active && this.input && document.activeElement !== this.input) {
        e.preventDefault();
        this.game.world.player.releaseLock();
        this.input.focus();
      }
    });
    document.addEventListener('keyup', (e) => {
      if (e.code === (settings.pttKey || 'KeyV') && this.talking) this.stopTalk();
    });
    setInterval(() => this.tick(), 80);
  }

  hide() {
    if (this.talking) this.stopTalk(true);
    this.node.style.display = 'none';
    this.node.replaceChildren();
    this.input = null;
    document.body.classList.remove('oncall');
    bus.emit('callpanel:visible', false);
  }

  show() {
    this.node.style.display = '';
    document.body.classList.add('oncall');
    bus.emit('callpanel:visible', true);
  }

  renderRinging(caller) {
    this.show();
    this.node.classList.add('ringing');
    this.ringCountdown = el('span.muted');
    this.node.replaceChildren(
      el('div.call-head',
        el('div.portrait', el('img', { src: portraitFor(caller, 'neutral'), alt: '' })),
        el('div.call-id', el('div.meta', '📞 INCOMING CALL'), el('div.name', caller.name), el('div.meta', `${caller.location || ''}`), el('div.lead', '🎯 Lead: ', caller.scenario.leadSource))),
      el('div.ringing-box',
        el('div.muted', { style: { fontSize: '13px' } }, `Suggested scam: ${caller.scenario.icon || ''} ${caller.scenario.name} — pretend to be ${caller.scenario.impersonate}.`),
        el('button.btn.green.big', { onclick: () => (unlockAudio(), this.calls.answer()) }, '📞 Answer ', el('span.kbd', 'F')),
        el('button.btn.ghost', { onclick: () => this.calls.decline() }, 'Ignore (the boss will notice)'),
        this.ringCountdown),
    );
  }

  renderActive(caller, conv) {
    this.node.classList.remove('ringing');
    this.show();
    this.caller = caller;
    this.portraitImg = el('img', { src: portraitFor(caller, 'neutral'), alt: '' });
    this.emo = el('span.emo', EMO_ICON.neutral);
    this.portrait = el('div.portrait', this.portraitImg, this.emo);
    this.timer = el('div.call-timer', '00:00');
    this.holdBadge = el('div.badge.yellow', { style: { display: 'none', position: 'absolute', left: '14px', bottom: '6px' } }, '⏸ ON HOLD');
    this.needle = el('div.needle');
    this.cover = el('div.cover');
    this.trustVal = el('div.val', '');
    this.trustState = el('div.state', '');
    this.reason = el('div.reason', '');
    this.meter = el('div.meter', this.cover, this.needle, this.trustVal);
    this.trustBox = el('div.trust', { style: { position: 'relative' } },
      el('div.top', el('div.title', 'Caller trust'), this.trustState),
      this.meter,
      el('div.ticks', el('span', 'Hang up'), el('span', 'Suspicious'), el('span', 'Uncertain'), el('span', 'Cooperative')),
      this.reason,
      el('div.patience', '⏳ Patience', el('div.bar', (this.patienceBar = el('div'))), (this.patienceVal = el('span', ''))));
    this.transcript = el('div.transcript');
    this.thinking = el('div.thinking', { style: { display: 'none' } }, `${caller.firstName} is thinking`);
    this.intel = el('div.intel-chips');
    this.pttLvl = el('div.lvl');
    this.pttLabel = el('span', 'Hold to talk');
    const key = (settings.pttKey || 'KeyV').replace('Key', '');
    this.ptt = el('button.ptt', { onmousedown: (e) => (e.preventDefault(), this.startTalk()), onmouseup: () => this.stopTalk(), onmouseleave: () => this.talking && this.stopTalk(), ontouchstart: (e) => (e.preventDefault(), this.startTalk()), ontouchend: () => this.stopTalk() },
      el('div', '🎙️ ', this.pttLabel), el('small', `or hold ${key}`), this.pttLvl);
    this.input = el('input', { placeholder: 'Type what you say… (Enter)', onkeydown: (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.sendTyped();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        this.input.blur();
        if (this.game.computerOpen) this.game.closeComputer();
        else this.game.openComputer();
      } else if (e.key === 'Escape') {
        this.input.blur();
      }
      e.stopPropagation();
    } });
    this.node.replaceChildren(
      el('div.call-head', this.portrait,
        el('div.call-id', el('div.name', caller.name), el('div.meta', `${caller.age ? caller.age + ' • ' : ''}${caller.occupation || ''}`), el('div.meta', caller.location || ''), el('div.lead', `${caller.scenario.icon || '🎯'} ${caller.scenario.name}: be "${caller.scenario.impersonate}"`)),
        this.timer, this.holdBadge),
      this.trustBox,
      this.transcript,
      this.intel,
      el('div.call-controls',
        this.ptt,
        el('div.say-row', this.input, el('button.btn.small', { onclick: () => this.sendTyped() }, 'Say')),
        el('div.call-actions',
          el('button.btn.danger', { onclick: () => this.calls.end('agent_hung_up') }, '📵 Hang up'),
          el('button.btn', { title: 'Accuse them of being a scambaiter. Right = bonus, wrong = lost victim.', onclick: async () => {
            if (await confirmDialog('Flag as scambaiter?', `If ${caller.firstName} is a scambaiter you get a bounty. If not, they hang up offended.`, { ok: '🚩 Flag them', danger: true })) this.calls.flagBaiter();
          } }, '🚩 Scambaiter!'),
          el('button.btn', { title: 'Open your computer', onclick: () => (this.game.computerOpen ? this.game.closeComputer() : this.game.openComputer()) }, '🖥️ PC'))),
    );
    this.renderIntel();
    if (voiceInput.mode === 'text') this.ptt.disabled = true;
  }

  renderIntel() {
    if (!this.intel || !this.caller) return;
    const facts = (this.game.run?.intel || []).filter((f) => f.callerId === this.caller.id);
    this.intel.replaceChildren(
      ...(facts.length ? [el('span.muted', { style: { fontSize: '11px' } }, 'Intel:')] : []),
      ...facts.map((f) => el('span.chipx', { title: 'Click to add to your message', onclick: () => this.insert(f.value) }, `${f.label}: ${f.value}`)),
    );
  }

  insert(text) {
    if (!this.input) return;
    this.input.value = (this.input.value ? this.input.value + ' ' : '') + text;
    this.input.focus();
  }

  sendTyped() {
    const t = this.input?.value.trim();
    if (!t) return;
    this.input.value = '';
    unlockAudio();
    this.calls.playerSay(t);
  }

  async startTalk() {
    if (this.talking || !this.calls.active || !this.ptt || this.ptt.disabled) return;
    unlockAudio();
    this.talking = true;
    speaker.stop();
    this.ptt.classList.add('active');
    this.pttLabel.textContent = 'Listening… (release to send)';
    try {
      await voiceInput.begin();
    } catch (err) {
      this.talking = false;
      this.ptt.classList.remove('active');
      this.pttLabel.textContent = 'Hold to talk';
      bus.emit('toast', { kind: 'warn', text: `Microphone unavailable: ${err.message}. You can type instead.` });
    }
  }

  async stopTalk(silent = false) {
    if (!this.talking) return;
    this.talking = false;
    this.ptt?.classList.remove('active');
    if (this.pttLabel) this.pttLabel.textContent = 'Transcribing…';
    const ctx = this.caller ? `Phone call with ${this.caller.name}. Scam call center agent speaking. Words: gift card, remote access, RemoteHelp, Windoze, refund, warrant, bitcoin, ${this.caller.firstName}.` : '';
    try {
      const text = await voiceInput.end(ctx);
      if (this.pttLabel) this.pttLabel.textContent = 'Hold to talk';
      if (silent) return;
      if (text) this.calls.playerSay(text);
      else bus.emit('toast', { kind: 'warn', text: '🎙️ Didn\'t catch that — hold the key while you speak.', ms: 2200 });
    } catch (err) {
      if (this.pttLabel) this.pttLabel.textContent = 'Hold to talk';
      bus.emit('toast', { kind: 'bad', text: `Speech-to-text failed: ${err.message}` });
    }
  }

  addLine(l) {
    if (!this.transcript) return;
    const m = el(`div.msg.${l.who}`);
    if (l.html) m.innerHTML = l.html;
    else m.textContent = l.text;
    if (l.code && l.who === 'caller' && !l.text.includes(l.code.split(' ')[0])) {
      m.append(el('div', { html: `<span class="code">${escapeHtml(l.code)}</span>` }));
    }
    this.transcript.append(m);
    this.transcript.scrollTop = this.transcript.scrollHeight;
  }

  setThinking(on) {
    if (!this.transcript || !this.thinking) return;
    this.thinking.style.display = on ? '' : 'none';
    this.transcript.append(this.thinking);
    this.transcript.scrollTop = this.transcript.scrollHeight;
  }

  updateTrust({ trust, delta, reason, patience, emotion }) {
    if (!this.needle) return;
    const lab = trustLabel(trust);
    this.needle.style.left = `${trust}%`;
    this.cover.style.width = `${100 - trust}%`;
    this.trustVal.textContent = `${Math.round(trust)}`;
    this.trustState.textContent = lab.text;
    this.trustState.style.color = { high: 'var(--green-2)', mid: 'var(--yellow)', low: 'var(--orange)', critical: 'var(--red)' }[lab.key];
    if (reason) this.reason.textContent = `“${reason}”`;
    if (delta) {
      const d = el(`div.delta.${delta > 0 ? 'up' : 'down'}`, `${delta > 0 ? '+' : ''}${delta}`);
      this.trustBox.append(d);
      setTimeout(() => d.remove(), 1700);
      if (delta <= -8) {
        this.trustBox.classList.remove('shake');
        void this.trustBox.offsetWidth;
        this.trustBox.classList.add('shake');
      }
    }
    this.patienceBar.style.width = `${patience}%`;
    this.patienceVal.textContent = `${Math.round(patience)}`;
    if (emotion && this.caller) {
      this.portraitImg.src = portraitFor(this.caller, emotion);
      this.emo.textContent = EMO_ICON[emotion] || '😐';
    }
  }

  tick() {
    if (this.calls.state === 'ringing' && this.ringCountdown) this.ringCountdown.textContent = `Ringing… ${Math.ceil(this.calls.ringTimer)}s`;
    if (this.calls.active && this.timer) {
      const s = Math.floor(this.calls.callTime);
      this.timer.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }
    if (this.talking && this.pttLvl) this.pttLvl.style.width = `${Math.min(100, voiceInput.level() * 400)}%`;
  }
}

export function playRing() {
  sfx('ring');
}
