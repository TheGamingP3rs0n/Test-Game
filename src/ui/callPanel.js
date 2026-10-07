// The call panel: caller ID, live portrait (changes with emotion), the Trust Meter,
// patience, transcript, push-to-talk, typed replies, intel chips and call actions.
import { el, setText, typingInField, escapeHtml, renderText, renderHTML } from '../core/util.js';
import { bus } from '../core/bus.js';
import { settings } from '../core/store.js';
import { voiceInput, speaker } from '../ai/speech.js';
import { trustLabel } from '../ai/callerBrain.js';
import { portraitFor } from './portraits.js';
import { sfx, unlockAudio } from '../core/audio.js';
import { confirmDialog } from './dialog.js';
import { icon, iconFor, stripEmoji } from './icons.js';

const EMO_ICON = { neutral: 'meh', happy: 'smile', excited: 'sparkles', confused: 'help', suspicious: 'annoyed', angry: 'angry', scared: 'ghost', sad: 'frown' };
const EMO_LABEL = { neutral: 'Calm', happy: 'Happy', excited: 'Excited', confused: 'Confused', suspicious: 'Suspicious', angry: 'Angry', scared: 'Scared', sad: 'Sad' };
const LINE_ICON = { system: 'info', event: 'eye' };

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
    this.node.className = 'callpanel';
    this.node.replaceChildren();
    this.input = null;
    this.needle = null;
    document.body.classList.remove('oncall', 'ringing');
    bus.emit('callpanel:visible', false);
  }

  show(mode) {
    this.node.style.display = '';
    this.node.className = `callpanel ${mode}`;
    document.body.classList.toggle('oncall', mode === 'active');
    document.body.classList.toggle('ringing', mode === 'ringing');
    bus.emit('callpanel:visible', true);
  }

  /** Incoming call: a compact card, not the full panel. */
  renderRinging(caller) {
    this.show('ringing');
    this.ringCountdown = el('div.ring-timer');
    this.ringArc = el('div.ring-arc');
    this.node.replaceChildren(
      el('div.ring-top', el('span.ring-pulse', icon('phone-in')), el('span', 'Incoming call'), this.ringCountdown),
      el('div.ring-portrait', this.ringArc, el('img', { src: portraitFor(caller, 'neutral'), alt: '' })),
      el('div.ring-name', caller.name),
      el('div.ring-meta', caller.location || ''),
      el('div.ring-lead', icon(iconFor(caller.scenario.icon, 'target')), el('span', stripEmoji(caller.scenario.name))),
      el('div.ring-actions',
        el('button.btn.green', { onclick: () => (unlockAudio(), this.calls.answer()) }, icon('phone'), 'Answer', el('span.kbd', 'F')),
        el('button.btn.ghost.icon-only', { title: 'Ignore (the boss will notice)', onclick: () => this.calls.decline() }, icon('phone-off'))),
    );
  }

  renderActive(caller, conv) {
    this.show('active');
    this.caller = caller;
    this.portraitImg = el('img', { src: portraitFor(caller, 'neutral'), alt: '' });
    this.emo = el('span.emo', icon(EMO_ICON.neutral));
    this.emoLabel = el('span.emo-label', EMO_LABEL.neutral);
    this.portrait = el('div.portrait', this.portraitImg, this.emo);
    this.timer = el('div.call-timer', '00:00');
    this.holdBadge = el('div.hold-badge', { style: { display: 'none' } }, icon('pause'), 'ON HOLD');
    this.needle = el('div.needle');
    this.cover = el('div.cover');
    this.trustVal = el('div.val', '');
    this.trustState = el('div.state', '');
    this.reason = el('div.reason', '');
    this.meter = el('div.meter', this.cover, this.needle, this.trustVal);
    this.shownTrust = conv.trust;
    this.trustBox = el('div.trust',
      el('div.top', el('div.title', 'Trust'), this.trustState),
      this.meter,
      el('div.ticks', el('span', 'Hang up'), el('span', 'Suspicious'), el('span', 'Unsure'), el('span', 'Cooperative')),
      this.reason,
      el('div.patience', icon('hourglass'), el('span', 'Patience'), el('div.bar', (this.patienceBar = el('div'))), (this.patienceVal = el('span', ''))));
    this.transcript = el('div.transcript');
    this.thinking = el('div.thinking', { style: { display: 'none' } }, `${caller.firstName} is thinking`);
    this.intel = el('div.intel-chips');
    this.pttLvl = el('div.lvl');
    this.pttLabel = el('span', 'Hold to talk');
    const key = (settings.pttKey || 'KeyV').replace('Key', '');
    this.ptt = el('button.ptt', { onmousedown: (e) => (e.preventDefault(), this.startTalk()), onmouseup: () => this.stopTalk(), onmouseleave: () => this.talking && this.stopTalk(), ontouchstart: (e) => (e.preventDefault(), this.startTalk()), ontouchend: () => this.stopTalk() },
      icon('mic'), el('div.ptt-text', this.pttLabel, el('small', `or hold ${key}`)), this.pttLvl);
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
        el('div.call-id', el('div.name', caller.name), el('div.meta', [caller.age, caller.occupation].filter(Boolean).join(' • ')), el('div.meta', caller.location || ''), el('div.mood', this.emoLabel)),
        el('div.call-right', this.timer, this.holdBadge)),
      el('div.call-scam', icon(iconFor(caller.scenario.icon, 'target')), el('span', 'Be: ', el('b', stripEmoji(caller.scenario.impersonate)))),
      this.trustBox,
      this.transcript,
      this.intel,
      el('div.call-controls',
        el('div.say-row', this.ptt, this.input),
        el('div.call-actions',
          el('button.btn.danger', { onclick: () => this.calls.end('agent_hung_up') }, icon('phone-off'), 'Hang up'),
          el('button.btn', { title: 'Accuse them of being a scambaiter. Right = bonus, wrong = lost victim.', onclick: async () => {
            if (await confirmDialog('Flag as scambaiter?', `If ${caller.firstName} is a scambaiter you get a bounty. If not, they hang up offended.`, { ok: 'Flag them', danger: true })) this.calls.flagBaiter();
          } }, icon('flag'), 'Baiter?'),
          el('button.btn', { title: 'Open your computer (Tab)', onclick: () => (this.game.computerOpen ? this.game.closeComputer() : this.game.openComputer()) }, icon('monitor'), 'PC'))),
    );
    this.renderIntel();
    this.updateTrust({ trust: conv.trust, delta: 0, reason: '', patience: conv.patience, emotion: 'neutral' });
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
      bus.emit('toast', { kind: 'warn', icon: 'mic-off', title: 'Microphone unavailable', text: `${err.message}. You can type instead.` });
    }
  }

  async stopTalk(silent = false) {
    if (!this.talking) return;
    this.talking = false;
    this.ptt?.classList.remove('active');
    if (this.pttLabel) this.pttLabel.textContent = 'Transcribing…';
    // Whisper follows the style of a natural sentence far better than a keyword list
    const ctx = this.caller ? `Hello ${this.caller.firstName}, this is ${settings.agentAlias || 'Steve'} from ${this.caller.scenario.impersonate?.split(/[,(]/)[0] || 'support'}. Please open RemoteHelp so I can fix your Windoze computer.` : '';
    try {
      const text = await voiceInput.end(ctx);
      if (this.pttLabel) this.pttLabel.textContent = 'Hold to talk';
      if (silent) return;
      if (text) this.calls.playerSay(text);
      else bus.emit('toast', { kind: 'warn', icon: 'mic-off', title: 'Didn\'t catch that', text: 'Hold the key the whole time you speak — wait for the click before talking.', ms: 2600 });
    } catch (err) {
      if (this.pttLabel) this.pttLabel.textContent = 'Hold to talk';
      bus.emit('toast', { kind: 'bad', icon: 'mic-off', title: 'Speech-to-text failed', text: err.status === 429 ? 'Groq\'s free speech limit is busy for a moment. Try again or type.' : err.message });
    }
  }

  addLine(l) {
    if (!this.transcript) return;
    const m = el(`div.msg.${l.who}`);
    if (LINE_ICON[l.who] || l.icon) m.append(icon(l.icon || LINE_ICON[l.who]));
    const body = el('span');
    if (l.html) body.innerHTML = renderHTML(l.html);
    else body.append(...renderText(l.text));
    m.append(body);
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
    this.trustState.textContent = lab.text;
    this.trustState.style.color = { high: 'var(--green-2)', mid: 'var(--yellow)', low: 'var(--orange)', critical: 'var(--red)' }[lab.key];
    this.targetTrust = trust;
    if (reason) setText(this.reason, `“${reason}”`);
    if (delta) {
      const d = el(`div.delta.${delta > 0 ? 'up' : 'down'}`, `${delta > 0 ? '+' : ''}${delta}`);
      this.trustBox.append(d);
      setTimeout(() => d.remove(), 1700);
      this.meter.classList.remove('pulse-up', 'pulse-down');
      void this.meter.offsetWidth;
      this.meter.classList.add(delta > 0 ? 'pulse-up' : 'pulse-down');
      if (delta <= -8) {
        this.trustBox.classList.remove('shake');
        void this.trustBox.offsetWidth;
        this.trustBox.classList.add('shake');
      }
    }
    this.patienceBar.style.width = `${patience}%`;
    this.patienceBar.classList.toggle('low', patience < 25);
    this.patienceVal.textContent = `${Math.round(patience)}`;
    if (emotion && this.caller) {
      this.portraitImg.src = portraitFor(this.caller, emotion);
      this.emo.replaceChildren(icon(EMO_ICON[emotion] || 'meh'));
      this.emoLabel.textContent = EMO_LABEL[emotion] || 'Calm';
      this.emoLabel.dataset.emo = emotion;
    }
  }

  tick() {
    if (this.calls.state === 'ringing' && this.ringCountdown) {
      this.ringCountdown.textContent = `${Math.ceil(this.calls.ringTimer)}s`;
      this.ringArc?.style.setProperty('--p', `${Math.max(0, this.calls.ringTimer / this.calls.ringTotal) * 100}`);
    }
    // count the number up/down smoothly so trust changes are easy to follow
    if (this.trustVal && this.targetTrust !== undefined) {
      this.shownTrust += (this.targetTrust - this.shownTrust) * 0.25;
      if (Math.abs(this.targetTrust - this.shownTrust) < 0.5) this.shownTrust = this.targetTrust;
      this.trustVal.textContent = `${Math.round(this.shownTrust)}`;
    }
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
