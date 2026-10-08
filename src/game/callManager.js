// Orchestrates a phone call: ringing → AI conversation → actions (remote access,
// payments, holds, malware, exposure) → recap. UI listens to the bus events.
import { CallerConversation, trustLabel } from '../ai/callerBrain.js';
import { speaker, stripDirections } from '../ai/speech.js';
import { bus } from '../core/bus.js';
import { sfx, startLoop, stopLoop } from '../core/audio.js';
import { uid, pick, randInt, money, clamp } from '../core/util.js';
import { buildVictimPC } from './victimPC.js';
import { chatBudgetLow } from '../ai/groq.js';
import { upgradeLevel } from './progression.js';

const RING_SECONDS = 24;

// Which "scam app" collects a given payment method, plus a fictional verification code
// the caller reads out (abstract digits only — the player types it into the app).
export const SCAM_APP = { gift_cards: 'giftcards', cash_by_mail: 'giftcards', credit_card: 'creditcard', wire_transfer: 'creditcard', bank_transfer: 'creditcard', crypto: 'creditcard', identity: 'identity' };
const APP_NAME = { giftcards: 'Gift Cards', creditcard: 'Credit Card', identity: 'Identity' };
const d = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
function scamCode(method) {
  if (method === 'gift_cards' || method === 'cash_by_mail') return `${d(4)}-${d(4)}`;
  if (method === 'identity') return `${d(3)}-${d(2)}-${d(4)}`;
  return d(6);
}

export class CallManager {
  constructor(game) {
    this.game = game;
    this.state = 'idle'; // idle | ringing | active
    this.caller = null;
    this.conv = null;
    this.pc = null;
    this.ringTimer = 0;
    this.callTime = 0;
    this.pending = 0;
    this.holdTimer = 0;
    this.lastReact = 0;
    this.sandbox = false;
  }

  get active() {
    return this.state === 'active';
  }

  ring(caller, { sandbox = false } = {}) {
    if (this.state !== 'idle') return;
    this.state = 'ringing';
    this.caller = caller;
    this.sandbox = sandbox;
    this.ringTimer = RING_SECONDS;
    this.ringTotal = RING_SECONDS;
    startLoop('ringLoop');
    this.game.world?.office.setPhoneRinging(true);
    bus.emit('call:ring', caller);
  }

  update(dt) {
    if (this.state === 'ringing') {
      this.ringTimer -= dt;
      if (this.ringTimer <= 0) this.missed();
    } else if (this.state === 'active') {
      this.callTime += dt;
      if (this.holdTimer > 0) {
        this.holdTimer -= dt;
        if (this.holdTimer <= 0) this.endHold();
      }
    }
  }

  missed() {
    stopLoop('ringLoop');
    this.game.world?.office.setPhoneRinging(false);
    const caller = this.caller;
    this.state = 'idle';
    this.caller = null;
    this.game.nextCallIn = 3 + Math.random() * 5; // breather before the next call
    if (!this.sandbox && this.game.day) {
      this.game.day.missedCalls++;
      this.game.addHighlight(`Let ${caller.name} ring out. The boss heard.`);
    }
    bus.emit('call:missed', caller);
    bus.emit('toast', { kind: 'warn', icon: 'phone-missed', title: 'Missed call', text: `${caller.name} rang out. The boss tracks missed calls.` });
  }

  decline() {
    if (this.state !== 'ringing') return;
    this.ringTimer = 0;
    this.missed();
  }

  async answer() {
    if (this.state !== 'ringing') return;
    stopLoop('ringLoop');
    this.game.world?.office.setPhoneRinging(false);
    sfx('pickup');
    startLoop('phoneLine', 'amb');
    const caller = this.caller;
    const run = this.game.run;
    const ctx = {
      day: this.game.day?.day || 1,
      quota: this.game.day?.quota || 1500,
      trustBonus: 6 * upgradeLevel(run, 'accent'),
      patienceMult: upgradeLevel(run, 'headset') ? 0.75 : 1,
    };
    this.conv = new CallerConversation(caller, caller.scenario, ctx);
    this.pc = buildVictimPC(caller);
    this.state = 'active';
    this.callTime = 0;
    this.holdTimer = 0;
    this.remoteConnected = false;
    this.screenBlanked = false;
    this.flagged = false;
    if (!this.sandbox && this.game.day) {
      this.game.day.callsTaken++;
      this.game.day.seenCallers.push(caller.id);
    }
    bus.emit('call:start', { caller, conv: this.conv });
    bus.emit('call:update', this.snapshot(0, ''));
    if (this.conv.offline) bus.emit('call:line', { who: 'system', icon: 'bot', text: 'Offline mode: no Groq API key, so this caller uses a simple canned brain. Add your key in Settings for the real AI.' });
    await this.respond(() => this.conv.opening());
  }

  snapshot(delta, reason) {
    const c = this.conv;
    return { trust: c.trust, delta, reason, patience: c.patience, emotion: c.emotion, label: trustLabel(c.trust) };
  }

  voice() {
    const v = this.caller.voice || {};
    return { ...v, gender: v.gender || this.caller.gender };
  }

  /** The player said/typed something. */
  async playerSay(text) {
    text = String(text || '').trim();
    if (!this.active || !text) return;
    if (this.holdTimer > 0) {
      bus.emit('call:line', { who: 'agent', text });
      bus.emit('call:line', { who: 'system', icon: 'music', text: 'You are talking to hold music. They can\'t hear you.' });
      return;
    }
    speaker.stop();
    bus.emit('call:line', { who: 'agent', text });
    if (this.game.micBroken) this.conv.event('[BACKGROUND] The agent\'s headset is shrieking with feedback; you can only make out every other word.');
    await this.respond(() => this.conv.agentSays(text));
  }

  async respond(fn) {
    this.pending++;
    bus.emit('call:thinking', true);
    let r = null;
    try {
      r = await fn();
    } catch (err) {
      console.error(err);
    } finally {
      this.pending--;
      if (this.pending <= 0) bus.emit('call:thinking', false);
    }
    if (r && this.active) await this.apply(r);
  }

  async apply(r) {
    if (r.lineTrouble && r.aiError) {
      bus.emit('call:line', { who: 'system', icon: 'signal', text: r.rateLimited ? 'Bad line: the free Groq AI is at its per-minute limit. Wait a few seconds, then say it again.' : `Bad line: the AI didn't answer (${r.aiError.slice(0, 110)}). Say it again.` });
    }
    const caller = this.caller;
    const text = stripDirections(r.reply);
    bus.emit('call:line', { who: 'caller', text, emotion: r.emotion, code: r.remoteCode });
    bus.emit('call:update', this.snapshot(r.trustDelta, r.trustReason));
    if (r.trustDelta >= 4) sfx('trustUp');
    else if (r.trustDelta <= -4) sfx('trustDown');
    for (const n of r.notes) if (/trust|money/.test(n)) bus.emit('call:line', { who: 'system', text: n });
    const speaking = speaker.speak(r.reply, this.voice(), { emotion: r.emotion });
    bus.emit('call:speaking', true);
    speaking.finally(() => bus.emit('call:speaking', false));

    switch (r.action) {
      case 'grant_remote':
        bus.emit('call:line', { who: 'system', icon: 'monitor', html: `${caller.firstName} installed <b>RemoteHelp</b>. Their ID: <span class="code">${r.remoteCode}</span>. Enter it in the RemoteHelp app on your PC.` });
        bus.emit('call:remote', { code: r.remoteCode });
        break;
      case 'pay':
        this.receivePayment(r);
        break;
      case 'hold':
        await speaking;
        this.startHold(randInt(7, 14));
        break;
      case 'send_file':
        this.sendFile();
        break;
      case 'hang_up':
        await speaking;
        this.end(r.notes.some((n) => /patience/.test(n)) ? 'out_of_patience' : 'caller_hung_up');
        break;
      case 'expose':
        await speaking;
        this.exposed();
        break;
      default:
        break;
    }
  }

  receivePayment(r) {
    const amount = Math.round(r.payAmount);
    const method = r.payMethod || 'gift_cards';
    // the scenario decides which app collects it, so the player always has the right app open
    const app = this.caller.scenario?.scamApp || SCAM_APP[method] || 'giftcards';
    const codeMethod = app === 'identity' ? 'identity' : app === 'giftcards' ? 'gift_cards' : 'credit_card';
    const code = scamCode(codeMethod);
    const fieldName = { giftcards: 'gift card code', creditcard: 'card verification code', identity: 'verification number' }[app];
    const pay = { id: uid('pay'), amount, method, app, code, fake: !!r.fake, from: this.caller.name, status: 'pending', time: this.game.clock };
    if (!this.sandbox && this.game.day) this.game.day.pendingPayments.push(pay);
    // the caller reads the code out loud → it shows in the transcript; the player enters it in the app
    bus.emit('call:line', { who: 'caller', text: `Okay... my ${fieldName} is ${code}. Did you get that?`, emotion: r.emotion });
    bus.emit('call:line', { who: 'system', icon: 'payout', html: `Enter ${this.caller.firstName}'s code <span class="code">${code}</span> in the <b>${APP_NAME[app]}</b> app to collect ${money(amount)}.` });
    bus.emit('call:payment', pay);
    sfx('notify');
  }

  startHold(seconds) {
    this.holdTimer = seconds;
    bus.emit('call:hold', true);
    bus.emit('call:line', { who: 'system', icon: 'pause', text: `${this.caller.firstName} put you on hold.` });
    sfx('hold');
    this.holdMusic = setInterval(() => this.holdTimer > 0 && sfx('hold'), 2400);
  }

  endHold() {
    clearInterval(this.holdMusic);
    bus.emit('call:hold', false);
    if (!this.active) return;
    this.respond(() => this.conv.event('[SYSTEM] You come back to the phone after putting the agent on hold. Say something about what you were doing.', { react: true }));
  }

  sendFile() {
    const file = { name: pick(['bank_statement.pdf.exe', 'invoice_2026.pdf.exe', 'Screenshot_of_error.png.scr', 'my_account_info.docm']), from: this.caller.name };
    bus.emit('call:line', { who: 'system', icon: 'clip', text: `${this.caller.firstName} sent you a file: ${file.name}` });
    bus.emit('call:file', file);
  }

  /** The player opened a baiter's trap file (or a trap on their PC). */
  infected(source) {
    const day = this.game.day;
    if (upgradeLevel(this.game.run, 'antivirus') && !this.game.dayFlags.avUsed) {
      this.game.dayFlags.avUsed = true;
      bus.emit('toast', { kind: 'info', text: '🛡️ DefendoMax Pro blocked the malware! (once per day)' });
      return;
    }
    if (day) {
      day.infections++;
      this.game.addHighlight(`Opened "${source}" from a scambaiter. Got hacked.`);
    }
    if (this.active) this.conv.event(`[SCREEN] The agent opened your trap file (${source}). Your reverse-connection succeeded: you can now see THEIR screen and files. Gloat.`, { react: false });
    this.game.chaos?.trigger('computer-virus', { forced: true, ransom: true });
  }

  /** Something happened on the victim's screen while the agent was remoted in. */
  screenEvent(text, { react = false } = {}) {
    if (!this.active) return;
    // their monitor is blacked out: they can't see what you're doing
    if (this.screenBlanked) return;
    const now = performance.now();
    // reactions cost an AI request — keep them rare so the free tier lasts
    const canReact = react && this.pending === 0 && !speaker.speaking && now - this.lastReact > 9000 && (this.conv.offline || !chatBudgetLow());
    if (canReact) this.lastReact = now;
    const line = `[SCREEN] The agent ${text}.`;
    bus.emit('call:line', { who: 'event', text: `${this.caller.firstName} sees: you ${text}` });
    if (canReact) this.respond(() => this.conv.event(line, { react: true }));
    else this.conv.event(line);
  }

  /** Chaos in the office the caller can hear. */
  backgroundEvent(text, { react = true } = {}) {
    if (!this.active) return;
    const now = performance.now();
    const canReact = react && this.pending === 0 && now - this.lastReact > 6000 && (this.conv.offline || !chatBudgetLow());
    if (canReact) this.lastReact = now;
    if (canReact) this.respond(() => this.conv.event(`[BACKGROUND] ${text}`, { react: true }));
    else this.conv.event(`[BACKGROUND] ${text}`);
  }

  adjustTrust(delta, reason) {
    if (!this.active) return;
    this.conv.trust = clamp(this.conv.trust + delta, 0, 100);
    bus.emit('call:update', this.snapshot(delta, reason));
  }

  flagBaiter() {
    if (!this.active) return;
    this.flagged = true;
    if (this.conv.isBaiter) {
      if (!this.sandbox && this.game.day) {
        this.game.day.baitersFlagged++;
        this.game.addMoney(150, 'Scambaiter bounty from the boss');
        this.game.addHighlight(`Caught scambaiter "${this.caller.name}" red-handed.`);
      }
      sfx('win');
      bus.emit('call:line', { who: 'system', icon: 'flag', text: 'Correct! That was a scambaiter. Boss bonus +$150 and they lose a sucker.' });
      speaker.speak("[laughing] Ha! Okay, okay, you got me. Good instincts. See you on the next stream!", this.voice(), { emotion: 'happy' }).then(() => this.end('flagged'));
    } else {
      if (!this.sandbox && this.game.day) this.game.day.wrongFlags++;
      sfx('error');
      bus.emit('call:line', { who: 'system', icon: 'x', text: 'Wrong! That was a real victim — and you just accused them of being a YouTuber.' });
      speaker.speak("[confused] A what? A scam-baker? I don't know what you're talking about. This is very rude. Goodbye!", this.voice(), { emotion: 'angry' }).then(() => this.end('wrong_flag'));
    }
  }

  exposed() {
    if (!this.sandbox && this.game.day) {
      this.game.day.exposed++;
      const loss = Math.min(this.game.day.earned, 250 * (this.game.day.day || 1));
      this.game.day.earned -= loss;
      this.game.run.heat = clamp(this.game.run.heat + (upgradeLevel(this.game.run, 'vpn') ? 10 : 20), 0, 100);
      this.game.addHighlight(`Exposed live on "${this.caller.baiter?.channel || 'a scambaiting stream'}". Lost ${money(loss)}.`, true);
      bus.emit('toast', { kind: 'bad', text: `🔴 EXPOSED by a scambaiter! -${money(loss)} and police heat increased.` });
    }
    sfx('sting');
    this.end('exposed');
  }

  /** End the call. reason: caller_hung_up | out_of_patience | agent_hung_up | exposed | flagged | wrong_flag | shift_over | power */
  end(reason = 'agent_hung_up') {
    if (this.state === 'ringing') {
      stopLoop('ringLoop');
      this.game.world?.office.setPhoneRinging(false);
      this.state = 'idle';
      bus.emit('call:missed', this.caller);
      return;
    }
    if (!this.active) return;
    clearInterval(this.holdMusic);
    stopLoop('phoneLine');
    speaker.stop();
    sfx('hangup');
    const c = this.conv;
    const caller = this.caller;
    this.state = 'idle';
    c.ended = true;
    const paid = c.paid;
    const outcome = reason === 'exposed' ? 'exposed' : reason === 'flagged' ? 'flagged' : paid > 0 ? 'scammed' : reason === 'wrong_flag' ? 'wrong_flag' : reason;
    const recap = {
      caller,
      scenario: caller.scenario,
      reason,
      outcome,
      paid,
      fakePaid: c.fakePaid,
      trust: c.trust,
      turns: c.turns,
      duration: this.callTime,
      thoughts: c.thoughts.slice(-6),
      isBaiter: c.isBaiter,
      remote: this.remoteConnected,
      sandbox: this.sandbox,
    };
    if (!this.sandbox && this.game.day) {
      const d = this.game.day;
      if (paid > 0) {
        d.scamsWon++;
        this.game.addHighlight(`Got ${money(paid)} from ${caller.name} with the "${caller.scenario.name}" scam.`);
      } else if (['caller_hung_up', 'out_of_patience', 'wrong_flag'].includes(reason)) {
        d.hangups++;
        if (c.turns <= 3) this.game.addHighlight(`${caller.name} hung up after ${c.turns} line${c.turns === 1 ? '' : 's'}.`);
      }
      d.callLog.push({ name: caller.name, outcome, paid, scenario: caller.scenario.name, baiter: c.isBaiter });
    }
    this.conv = null;
    this.caller = null;
    this.pc = null;
    bus.emit('call:end', recap);
  }
}
