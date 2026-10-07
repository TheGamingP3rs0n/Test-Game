// Central game controller: run → briefing → shift (calls + chaos) → boss review →
// shop → next day. UI screens are injected via game.ui to avoid import cycles.
import { world } from '../world/world.js';
import { bus } from '../core/bus.js';
import { settings, meta } from '../core/store.js';
import { newRun, newDayState, saveRun, loadRun } from './run.js';
import { baiterChanceFor, decideVerdict, upgradeLevel } from './progression.js';
import { content, nextCaller, prepareCaller } from './content.js';
import { CallManager } from './callManager.js';
import { ChaosManager, bindChaosGame } from './chaos.js';
import { sfx, startLoop, stopLoop, stopAllLoops, pauseGameAudio, resumeGameAudio } from '../core/audio.js';
import { music } from '../core/music.js';
import { money, clamp, pick } from '../core/util.js';
import { scriptedMessage } from '../ai/coworkers.js';
import { speaker } from '../ai/speech.js';

export const DAY_START = 9 * 60;
const DAY_END = 17 * 60;

export const game = {
  world,
  phase: 'menu', // menu | briefing | playing | review | shop | gameover | practice
  run: null,
  day: null,
  clock: DAY_START,
  dayStart: DAY_START,
  dayEnd: DAY_END,
  paused: false,
  computerOpen: false,
  micBroken: false,
  powerOut: false,
  virus: false,
  internetDown: false,
  holding: null,
  dayFlags: {},
  nextCallIn: 0,
  ui: {},
  calls: null,
  chaos: null,

  init() {
    this.calls = new CallManager(this);
    this.chaos = new ChaosManager(this);
    bindChaosGame(this);
    world.onUpdate((dt) => this.tick(dt));
    bus.on('interact', (id) => this.interact(id));
    bus.on('call:end', (recap) => this.onCallEnded(recap));
    bus.on('call:payment', () => this.chat('callWin', 0.5));
    bus.on('chaos:start', () => this.chat('disaster', 0.6));
  },

  get playing() {
    return this.phase === 'playing' || this.phase === 'practice';
  },

  // ------------------------------------------------------------------ runs
  hasSave() {
    const r = loadRun();
    return !!(r && !r.over);
  },

  newRun() {
    this.run = newRun();
    saveRun(this.run);
    this.beginDay();
  },

  continueRun() {
    const r = loadRun();
    if (!r) return this.newRun();
    this.run = r;
    this.beginDay();
  },

  beginDay() {
    this.phase = 'briefing';
    this.day = newDayState(this.run);
    this.dayStart = DAY_START;
    this.dayEnd = DAY_END + 60 * upgradeLevel(this.run, 'chai');
    this.clock = this.dayStart;
    this.dayFlags = {};
    this.resetHazards();
    world.setMode('menu');
    world.office.setShame((this.run.shame || []).slice(-5));
    this.ui.showBriefing?.(this.run, this.day);
  },

  startShift() {
    this.phase = 'playing';
    this.paused = false;
    world.player.sitAtDesk();
    world.setMode('play');
    world.player.requestLock();
    this.chaos.planDay(this.day.day, this.dayStart, this.dayEnd);
    this.nextCallIn = 4;
    startLoop('officeAmbience', 'amb');
    music.play('shift');
    this.ui.showHUD?.(true);
    this.chat('morning', 1);
    saveRun(this.run);
  },

  resetHazards() {
    this.micBroken = false;
    this.powerOut = false;
    this.virus = false;
    this.internetDown = false;
    this.holding = null;
    world.office.setPower(true);
    world.office.setRouter(true);
  },

  get minutesPerSecond() {
    return (this.dayEnd - this.dayStart) / (Math.max(2, settings.dayLengthMinutes) * 60);
  },

  tick(dt) {
    if (!this.playing || this.paused) return;
    this.calls.update(dt);
    if (this.phase === 'practice') return;
    this.clock += dt * this.minutesPerSecond;
    this.chaos.update(dt);
    // schedule calls
    if (this.calls.state === 'idle' && !this.powerOut) {
      this.nextCallIn -= dt;
      if (this.nextCallIn <= 0 && this.clock < this.dayEnd - 12) this.ringNext();
    }
    // chatter
    this.chatTimer = (this.chatTimer ?? 40) - dt;
    if (this.chatTimer <= 0) {
      this.chatTimer = 55 + Math.random() * 60;
      this.chat('idle', 0.7);
    }
    world.office.setClock(this.clock);
    if (this.clock >= this.dayEnd) this.endDay();
  },

  ringNext() {
    const caller = nextCaller({
      day: this.day.day,
      seen: new Set(this.day.seenCallers),
      baiterChance: baiterChanceFor(this.day.day) * (upgradeLevel(this.run, 'leads') ? 0.7 : 1),
      gullibleBias: upgradeLevel(this.run, 'leads') ? 2 : 0,
    });
    this.calls.ring(caller);
  },

  onCallEnded(recap) {
    this.nextCallIn = 5 + Math.random() * 7;
    if (this.phase === 'menu') return;
    if (!recap.sandbox) {
      if (recap.outcome === 'exposed') this.chat('exposed', 1);
      else if (recap.paid > 0) this.chat('callWin', 0.6);
      else this.chat('callFail', 0.5);
    }
    this.ui.showRecap?.(recap);
  },

  // ------------------------------------------------------------------ money
  addMoney(amount, label = '', { allowNegative = false } = {}) {
    if (!this.day) return;
    this.day.earned += amount;
    if (!allowNegative) this.day.earned = Math.max(0, this.day.earned);
    if (amount > 0) {
      sfx('cash');
      bus.emit('money:popup', { amount });
      bus.emit('toast', { kind: 'money', icon: 'money', text: `+${money(amount)}${label ? ` — ${label}` : ''}` });
    } else if (amount < 0) {
      bus.emit('toast', { kind: 'bad', icon: 'payout', text: `${money(amount)}${label ? ` — ${label}` : ''}` });
    }
    bus.emit('money:changed', this.day.earned);
  },

  pendingTotal() {
    return (this.day?.pendingPayments || []).filter((p) => p.status === 'pending' && !p.fake).reduce((s, p) => s + p.amount, 0);
  },

  /** Normalize a typed code for comparison (ignore spaces, dashes, case). */
  normCode(v) {
    return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  },

  /**
   * A scam app verifies the code the caller read out. Returns:
   *   'ok'       — code matched a real caller → money earned
   *   'invalid'  — code matched, but the caller was a scambaiter (fake) → heat
   *   'mismatch' — the typed code doesn't match what they read you
   */
  verifyScam(pay, entered) {
    if (pay.status !== 'pending') return pay.status;
    if (this.normCode(entered) !== this.normCode(pay.code)) return 'mismatch';
    if (pay.fake) {
      pay.status = 'invalid';
      sfx('error');
      this.onFakePayment(pay);
      return 'invalid';
    }
    pay.status = 'collected';
    const label = { giftcards: 'gift card', creditcard: 'card charge', identity: 'identity scam' }[pay.app] || 'payment';
    this.addMoney(pay.amount, `${label} from ${pay.from}`);
    return 'ok';
  },

  /** Direct collect (internal use; apps go through verifyScam). */
  collect(pay) {
    if (pay.status !== 'pending') return pay.status;
    if (pay.fake) {
      pay.status = 'invalid';
      sfx('error');
      this.onFakePayment(pay);
      return 'invalid';
    }
    pay.status = 'collected';
    this.addMoney(pay.amount, `${(pay.method || '').replace(/_/g, ' ')} from ${pay.from}`);
    return 'ok';
  },

  onFakePayment(pay) {
    this.run.heat = clamp(this.run.heat + (upgradeLevel(this.run, 'vpn') ? 3 : 6), 0, 100);
    this.addHighlight(`${pay.from} "paid" ${money(pay.amount)} in fake codes. Scambaiter!`);
    bus.emit('toast', { kind: 'bad', icon: 'ban', text: `${money(pay.amount)} from ${pay.from} was FAKE. That caller was a scambaiter. Heat +${upgradeLevel(this.run, 'vpn') ? 3 : 6}` });
  },

  addHighlight(text, shame = false) {
    if (!this.day) return;
    this.day.highlights.push(text);
    if (shame) {
      this.run.shame = [...(this.run.shame || []), text].slice(-12);
      world.office.setShame(this.run.shame.slice(-5));
    }
  },

  // ------------------------------------------------------------------ end of day
  endDay() {
    if (this.phase !== 'playing') return;
    this.phase = 'review';
    if (this.calls.state !== 'idle') this.calls.end('shift_over');
    this.chaos.reset();
    this.resetHazards();
    stopAllLoops();
    speaker.stop();
    this.closeComputer();
    // payments you never entered into a scam app are lost (you were too slow)
    const missed = this.day.pendingPayments.filter((p) => p.status === 'pending' && !p.fake);
    for (const p of missed) p.status = 'expired';
    if (missed.length) this.addHighlight(`Left ${money(missed.reduce((s, p) => s + p.amount, 0))} uncollected — never entered the codes in time.`);
    const d = this.day;
    const verdict = decideVerdict({ earned: d.earned, quota: d.quota, strikes: this.run.strikes });
    const report = {
      day: d.day,
      quota: d.quota,
      earned: Math.round(d.earned),
      callsTaken: d.callsTaken,
      missedCalls: d.missedCalls,
      scamsWon: d.scamsWon,
      hangups: d.hangups,
      baitersFlagged: d.baitersFlagged,
      exposed: d.exposed,
      infections: d.infections,
      disasters: d.disasters,
      heat: this.run.heat,
      strikesBefore: this.run.strikes,
      highlights: d.highlights,
      callLog: d.callLog,
      verdict: verdict.verdict,
      verdictText: verdict.text,
      rule: verdict,
    };
    sfx('sting');
    music.play('review');
    this.ui.showHUD?.(false);
    // boss strides to the middle of his office
    const boss = world.office.boss;
    boss.root.position.copy(world.office.bossSpot);
    boss.lookAtXZ(world.office.bossReviewCam.pos.x, world.office.bossReviewCam.pos.z);
    boss.play(verdict.verdict === 'promoted' || verdict.verdict === 'survived' ? 'emote-yes' : 'emote-no', { loop: true });
    world.setMode('review');
    this.ui.showReview?.(report);
  },

  /** Called by the review screen once the verdict (and excuse) is settled. */
  finishReview({ report, excuseAccepted }) {
    const rule = report.rule;
    let strikeDelta = rule.strikeDelta;
    if (excuseAccepted && strikeDelta > 0 && rule.excusable) strikeDelta = 0;
    this.run.strikes = clamp(this.run.strikes + strikeDelta, 0, 3);
    const commission = Math.round(report.earned * (0.1 + rule.bonusPct) + this.day.baitersFlagged * 50);
    this.run.wallet += commission;
    this.run.totalEarned += report.earned;
    this.run.heat = clamp(this.run.heat - 15, 0, 100);
    this.run.history.push({ day: report.day, quota: report.quota, earned: report.earned, verdict: report.verdict, strikes: this.run.strikes });
    meta.update({ totalScammed: (meta.data.totalScammed || 0) + report.earned, bestDay: Math.max(meta.data.bestDay || 0, report.day), baitersCaught: (meta.data.baitersCaught || 0) + this.day.baitersFlagged });
    world.office.boss.play('idle');
    if (this.run.strikes >= 3 || report.verdict === 'fired') return this.gameOver(report);
    this.phase = 'shop';
    this.run.day++; // the day is done — continuing a save starts the next one
    saveRun(this.run);
    this.ui.showShop?.(this.run, commission);
  },

  /** Player-initiated early end of day (the Clock Out button; only when quota is met). */
  clockOut() {
    if (this.phase !== 'playing' || !this.day || this.day.earned < this.day.quota) return;
    if (this.calls.state === 'ringing') this.calls.decline();
    sfx('win');
    this.addHighlight('Clocked out early with quota in the bag.');
    this.endDay();
  },

  nextDay() {
    saveRun(this.run);
    this.beginDay();
  },

  gameOver(report) {
    this.phase = 'gameover';
    this.run.over = true;
    saveRun(this.run);
    sfx('lose');
    this.ui.showGameOver?.(this.run, report);
  },

  quitToMenu() {
    if (this.paused) {
      this.paused = false;
      document.body.classList.remove('paused');
      resumeGameAudio();
      speaker.resume();
      music.setMuffled(false);
      this.ui.hidePause?.();
    }
    this.phase = 'menu';
    if (this.calls.state !== 'idle') this.calls.end('agent_hung_up');
    this.chaos.reset();
    this.resetHazards();
    stopAllLoops();
    speaker.stop();
    this.closeComputer();
    this.phase = 'menu';
    this.paused = false;
    this.ui.showHUD?.(false);
    world.setMode('menu');
    this.ui.showMenu?.();
  },

  // ------------------------------------------------------------------ practice
  startPractice(def) {
    this.phase = 'practice';
    if (!this.run) this.run = { day: 1, upgrades: {}, heat: 0, wallet: 0, strikes: 0, notes: '', intel: [], chats: {}, shame: [] };
    this.day = this.day || newDayState({ day: 1 });
    world.player.sitAtDesk();
    world.setMode('play');
    this.ui.showHUD?.(true, { practice: true });
    const caller = prepareCaller(def, 1);
    this.calls.ring(caller, { sandbox: true });
  },

  // ------------------------------------------------------------------ pause / computer
  // Pausing freezes everything: the clock, the ringing phone (sound, shake and timer),
  // caller voices, alarms and the 3D world. Resuming picks up exactly where it stopped.
  pause() {
    if (!this.playing || this.paused) return;
    this.paused = true;
    this.modeBeforePause = world.mode;
    world.setMode('frozen');
    pauseGameAudio();
    speaker.pause();
    music.setMuffled(true);
    document.body.classList.add('paused');
    sfx('pause');
    this.ui.showPause?.();
  },

  resume() {
    if (!this.paused) return;
    this.paused = false;
    document.body.classList.remove('paused');
    resumeGameAudio();
    speaker.resume();
    music.setMuffled(false);
    sfx('unpause');
    this.ui.hidePause?.();
    if (this.computerOpen) world.setMode('computer');
    else {
      world.setMode('play');
      world.player.requestLock();
    }
  },

  openComputer() {
    if (!this.playing || this.computerOpen) return;
    this.computerOpen = true;
    world.setMode('computer');
    this.ui.openComputer?.();
  },

  closeComputer() {
    if (!this.computerOpen) return;
    this.computerOpen = false;
    this.ui.closeComputer?.();
    if (this.playing && !this.paused) {
      world.setMode('play');
      world.player.requestLock();
    }
  },

  // ------------------------------------------------------------------ office interactions
  interact(id) {
    if (!this.playing) return;
    if (this.chaos.interact(id)) return;
    const say = (t, icon) => bus.emit('toast', { text: t, icon });
    switch (id) {
      case 'computer':
        return this.openComputer();
      case 'phone':
        if (this.calls.state === 'ringing') return this.calls.answer();
        return say(this.calls.active ? 'You\'re already on a call (talk with your headset).' : 'No calls right now. Enjoy the 4 seconds of peace.', 'phone');
      case 'bossdoor':
        sfx('stamp');
        return say(pick(['Mr. Chatterjee (through the door): "GO AWAY. QUOTA."', 'Mr. Chatterjee: "Unless you are bringing money or samosas, DO NOT KNOCK."']));
      case 'breaker':
        return say('All breakers are on. The wiring is held together by hope and tape.', 'zap');
      case 'router':
        return say('The router blinks happily. For now.', 'wifi');
      case 'shredder':
        sfx('shred');
        return say('You shred Raju\'s lunch order. Worth it.', 'trash');
      case 'supplies':
        return say('Spare headsets, chai packets, and 400 empty Google Play card sleeves.', 'headphones');
      case 'extinguisher':
        return say('A fire extinguisher. Expired in 2011, but optimistic.', 'extinguisher');
      case 'cow':
        return say('Moo.', 'cow');
      default:
        return undefined;
    }
  },

  // ------------------------------------------------------------------ coworker chat
  chat(kind, chance = 1) {
    if (Math.random() > chance) return;
    const msg = scriptedMessage(kind);
    bus.emit('chat:message', { ...msg, time: this.clock });
  },
};

export { content };
