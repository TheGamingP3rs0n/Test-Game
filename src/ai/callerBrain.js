// The AI caller. Each turn the LLM role-plays the caller and returns structured JSON:
// what they say, how they feel, how much their trust changed and why, and whether they
// take an action (install remote access, pay, hang up, expose you, send malware...).
// Game rules (thresholds, money limits, personality scaling) are enforced here in code,
// so the Trust Meter reacts to what you actually say but can't be "prompted" to 100.
import { chatJSON } from './groq.js';
import { hasApiKey } from '../core/store.js';
import { clamp, pick, chance } from '../core/util.js';
import { privateFacts } from '../game/profile.js';

export const EMOTIONS = ['neutral', 'happy', 'excited', 'confused', 'suspicious', 'angry', 'scared', 'sad'];
export const ACTIONS = ['none', 'grant_remote', 'pay', 'hang_up', 'expose', 'send_file', 'hold'];
export const PAY_METHODS = ['none', 'gift_cards', 'wire_transfer', 'crypto', 'bank_transfer', 'cash_by_mail'];

export const TRUST_THRESHOLDS = { remote: 35, pay: 55 };

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'emotion', 'trust_change', 'trust_reason', 'patience_change', 'action', 'pay_amount', 'pay_method', 'inner_thought'],
  properties: {
    reply: { type: 'string' },
    emotion: { type: 'string', enum: EMOTIONS },
    trust_change: { type: 'integer' },
    trust_reason: { type: 'string' },
    patience_change: { type: 'integer' },
    action: { type: 'string', enum: ACTIONS },
    pay_amount: { type: 'integer' },
    pay_method: { type: 'string', enum: PAY_METHODS },
    inner_thought: { type: 'string' },
  },
};

export function trustLabel(t) {
  if (t >= 70) return { key: 'high', text: 'Cooperative' };
  if (t >= 40) return { key: 'mid', text: 'Uncertain' };
  if (t >= 15) return { key: 'low', text: 'Suspicious' };
  return { key: 'critical', text: 'About to hang up!' };
}

export class CallerConversation {
  /**
   * @param caller   caller definition (mod JSON shape) + `profile` from buildProfile()
   * @param scenario scenario definition
   * @param ctx      { day, agentAlias, upgrades, sandbox }
   */
  constructor(caller, scenario, ctx = {}) {
    this.caller = caller;
    this.profile = caller.profile;
    this.scenario = scenario;
    this.ctx = ctx;
    const t = caller.trust || {};
    this.stats = {
      start: t.start ?? 40,
      gullibility: t.gullibility ?? 5,
      skepticism: t.skepticism ?? 5,
      patience: t.patience ?? 60,
      intelligence: t.intelligence ?? 5,
      techLiteracy: t.techLiteracy ?? 4,
      volatility: t.volatility ?? 5,
    };
    this.isBaiter = !!caller.isScambaiter;
    this.trust = clamp(this.stats.start + (ctx.trustBonus || 0), 0, 100);
    this.patience = clamp(this.stats.patience, 5, 100);
    this.emotion = 'neutral';
    this.turns = 0;
    this.messages = []; // LLM transcript (agent = user, caller = assistant)
    this.log = []; // { who: 'agent'|'caller'|'event'|'system', text }
    this.thoughts = [];
    this.pendingEvents = [];
    this.remoteGranted = false;
    this.remoteOffered = false;
    this.paid = 0;
    this.payments = 0;
    this.fakePaid = 0;
    this.ended = false;
    this.endReason = null;
    this.filesSent = 0;
    this.savingsLeft = this.profile.totalSavings ?? caller.savings ?? 5000;
    this.lock = Promise.resolve();
    this.offline = !hasApiKey();
  }

  /** Most this caller would hand over in a single payment right now. */
  paymentCap(method = 'gift_cards') {
    const quota = this.ctx.quota || 1500;
    const small = method === 'gift_cards' || method === 'cash_by_mail' || method === 'none';
    const methodCap = quota * (small ? 0.45 : 0.75) * Math.pow(0.6, this.payments);
    const trustFactor = clamp((this.trust - 40) / 60, 0.25, 1);
    return Math.round(Math.min(this.savingsLeft, Math.max(80, methodCap * (0.45 + trustFactor * 0.55))) / 10) * 10;
  }

  // ------------------------------------------------------------------ prompt
  systemPrompt() {
    const c = this.caller;
    const p = this.profile;
    const s = this.stats;
    const sc = this.scenario;
    const label = trustLabel(this.trust);
    const lines = [
      `You are an improv actor voicing a FICTIONAL character in a dark-comedy video game set in a scam call center. The player is a scam call-center agent trying to con you. Everything is fictional: no real people, companies or money. Stay fully in character, react naturally to exactly what the agent says, remember everything said earlier, and be funny. Never say you are an AI, a character or in a game.`,
      ``,
      `## YOUR CHARACTER`,
      `Name: ${c.name} (${c.gender || 'unspecified'}, age ${c.age ?? 'unknown'}), from ${c.location || 'somewhere in the USA'}. Occupation: ${c.occupation || 'unknown'}.`,
      `Personality: ${c.personality || 'ordinary person'}`,
      c.speakingStyle ? `Speaking style: ${c.speakingStyle}` : '',
      c.dialogueStyle ? `Dialogue style: ${c.dialogueStyle}` : '',
      c.quirks?.length ? `Quirks: ${c.quirks.join('; ')}` : '',
      c.catchphrases?.length ? `Catchphrases (use occasionally): ${c.catchphrases.join(' | ')}` : '',
      c.backstory ? `Backstory: ${c.backstory}` : '',
      `Intelligence ${s.intelligence}/10. Tech literacy ${s.techLiteracy}/10. Gullibility ${s.gullibility}/10. Skepticism ${s.skepticism}/10. Emotional volatility ${s.volatility}/10.`,
      ``,
      `## YOUR PRIVATE DETAILS (you know these; share them only when it makes sense for your trust level)`,
      ...privateFacts(p).map((f) => `- ${f}`),
      `- Money you could get your hands on today: about $${Math.round(this.savingsLeft).toLocaleString()}`,
      ``,
      `## WHY THIS CALL IS HAPPENING`,
      sc.callerContext || 'You called a number you found.',
      `The agent will probably pretend to be: ${sc.impersonate || 'some official organization'}.`,
    ];

    if (c.triggers?.length) {
      lines.push('', '## SPECIAL REACTIONS');
      for (const t of c.triggers) lines.push(`- When ${t.when}: ${t.reaction}`);
    }

    if (this.isBaiter) {
      const b = c.baiter || {};
      lines.push(
        '',
        '## SECRET: YOU ARE A SCAMBAITER',
        `You are secretly ${b.realIdentity || 'a scambaiter who exposes scammers online'}, only PRETENDING to be the character above. ${b.channel ? `You stream this call on "${b.channel}".` : ''}`,
        `Your goals: waste the scammer's time with absurd stalling, act extremely gullible so they stay hooked, give fake info, "pay" with fake gift-card codes, try to get them to open malware files you send, and eventually expose them dramatically.`,
        `Tactics you like: ${(b.tactics || ['pretend the computer is very slow', 'read gift card codes wrong on purpose', 'ask them to spell everything', 'put them on hold for long periods']).join('; ')}.`,
        `Subtle tells (the agent may notice): you are a bit too eager, your story has small inconsistencies, you know oddly specific tech terms, you giggle at odd moments.`,
        `trust_change for you means how convinced you PRETEND to be: keep it rising so they stay hooked. Your inner_thought must reveal your real plan.`,
        `Use action "send_file" to send them a "document" (malware) when they ask for screenshots/documents/info. Use action "expose" to reveal yourself and mock them when you have wasted enough of their time (after ~8+ exchanges) or when they insult you or try to hang up. Never actually pay real money.`,
      );
    }

    lines.push(
      '',
      '## CURRENT STATE',
      `Your trust in the agent: ${Math.round(this.trust)}/100 (${label.text}). Your patience: ${Math.round(this.patience)}/100. Your mood: ${this.emotion}.`,
      this.remoteGranted ? 'You already installed the remote access app; the agent can see and control your computer screen.' : `If you agree to install the remote access app, read this access code aloud: ${p.remoteCode}`,
      this.paid > 0 ? `You have already sent the agent $${this.paid.toLocaleString()} this call.` : '',
      this.turns > 18 ? 'This call is getting very long and you are getting tired of it.' : '',
      '',
      '## HOW TRUST WORKS (decide trust_change each turn, from -30 to +20)',
      'Trust goes UP when the agent: sounds official and confident, correctly states YOUR private details, explains things you understand, shows empathy, plays on your fears convincingly, stays consistent, or shows you convincing things on your screen.',
      'Trust goes DOWN when the agent: asks for money / gift cards / crypto too early or too bluntly, gets your details wrong, contradicts earlier claims, is rude or threatening (unless you are easily scared), has an obviously fake name or accent slip, says something absurd, or you hear suspicious background noise.',
      'Scale it by your personality: gullible = bigger gains, skeptical = bigger losses, intelligent = catches mistakes. Small talk is roughly 0. Be honest with yourself about how convincing the agent is.',
      'Trust 70+: cooperative, follow instructions. 40-69: uncertain, need reassurance. 15-39: suspicious, ask hard questions. Below 15: you are about to hang up or call them out.',
      '',
      '## ACTIONS (pick exactly one each turn)',
      `- "none": just talk.`,
      `- "grant_remote": you install the remote access app and read out your access code (only if they asked you to install software / go to a website, and your trust >= ${TRUST_THRESHOLDS.remote}).`,
      `- "pay": you actually send money right now (only if they explicitly asked for a payment and your trust >= ${TRUST_THRESHOLDS.pay}). Set pay_amount and pay_method. Right now you'd hand over at most about $${this.paymentCap('gift_cards').toLocaleString()} in gift cards, or $${this.paymentCap('wire_transfer').toLocaleString()} by wire/bank transfer/crypto, in one go — say that exact amount out loud. For gift cards, say you bought them and read the codes.`,
      `- "hang_up": you end the call (fed up, scared off, or realized it is a scam).`,
      `- "hold": you put the agent on hold for a moment (to find glasses, feed the cat, etc).`,
      this.isBaiter ? '- "send_file": you send the agent a file (it is secretly malware).\n- "expose": you reveal you are a scambaiter and end the call.' : '- Do not use "send_file" or "expose".',
      'When not paying, set pay_amount 0 and pay_method "none".',
      '',
      '## INPUT FORMAT',
      'Agent lines are what the scam agent says to you (speech-to-text, may contain typos).',
      'Lines in [SCREEN] brackets describe what you can see happening on your computer screen. [BACKGROUND] lines describe noises you hear on the agent\'s end. [SYSTEM] lines are stage directions. React to them naturally.',
      '',
      '## OUTPUT',
      'reply: what you say out loud — like a real phone call: 1-3 short sentences (max ~50 words), natural spoken language, no stage directions except you may START with ONE short vocal direction in brackets like [nervous], [laughing], [whispering], [angry], [confused].',
      'emotion: your current emotion. trust_reason: max 8 words, why trust changed (written from your point of view, e.g. "knew my dog\'s name"). patience_change: -15 to +10. inner_thought: one funny sentence of what you are secretly thinking.',
    );
    return lines.filter((l) => l !== '').join('\n');
  }

  // ------------------------------------------------------------------ turns
  /** Serialize turns so overlapping speech/events never interleave. */
  queue(fn) {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => {});
    return run;
  }

  /** The caller's first line once the agent picks up. */
  opening() {
    return this.queue(() => this.turn('[SYSTEM] The call just connected — the agent picked up and greeted you. Say your opening line explaining why you are calling (in character).', { opening: true }));
  }

  /** The agent said something. */
  agentSays(text) {
    this.log.push({ who: 'agent', text });
    return this.queue(() => this.turn(text));
  }

  /**
   * Something happened on the victim's screen or in the office. If `react` the caller
   * responds immediately, otherwise it is attached to the next agent line.
   */
  event(text, { react = false } = {}) {
    this.log.push({ who: 'event', text });
    if (!react) {
      this.pendingEvents.push(text);
      return Promise.resolve(null);
    }
    return this.queue(() => this.turn(text, { isEvent: true }));
  }

  async turn(input, { opening = false, isEvent = false } = {}) {
    if (this.ended) return null;
    const prefix = this.pendingEvents.splice(0).join('\n');
    let content = opening || isEvent ? input : `Agent: ${input}`;
    if (prefix) content = `${prefix}\n${content}`;
    this.messages.push({ role: 'user', content });

    let raw;
    try {
      raw = this.offline ? offlineBrain(this, input, { opening, isEvent }) : await chatJSON({ system: this.systemPrompt(), messages: this.trimmedMessages(), schema: SCHEMA, schemaName: 'caller_turn' });
    } catch (err) {
      console.warn('Caller AI failed, using offline brain for this turn', err);
      raw = offlineBrain(this, input, { opening, isEvent });
      raw.aiError = err.message;
    }
    const result = this.apply(raw, { opening, isEvent });
    this.messages.push({ role: 'assistant', content: result.reply });
    this.log.push({ who: 'caller', text: result.reply });
    return result;
  }

  trimmedMessages() {
    // keep the prompt small: last ~24 messages (system prompt carries state)
    return this.messages.slice(-24);
  }

  /** Validate + apply the model's decision using game rules. */
  apply(raw, { opening = false, isEvent = false } = {}) {
    this.turns++;
    const r = {
      reply: String(raw.reply || '...').trim() || '...',
      emotion: EMOTIONS.includes(raw.emotion) ? raw.emotion : 'neutral',
      trustReason: String(raw.trust_reason || '').slice(0, 80),
      action: ACTIONS.includes(raw.action) ? raw.action : 'none',
      payAmount: Math.max(0, Math.round(Number(raw.pay_amount) || 0)),
      payMethod: PAY_METHODS.includes(raw.pay_method) ? raw.pay_method : 'none',
      thought: String(raw.inner_thought || '').slice(0, 200),
      aiError: raw.aiError,
      notes: [],
    };
    const s = this.stats;

    // ---- trust: personality-scaled and clamped
    let delta = clamp(Math.round(Number(raw.trust_change) || 0), -30, 20);
    if (opening) delta = clamp(delta, -5, 5);
    if (delta > 0) delta *= 0.55 + s.gullibility / 11;
    if (delta < 0) delta *= 0.55 + s.skepticism / 11;
    delta *= 0.8 + s.volatility / 25;
    delta = Math.round(delta);
    const before = this.trust;
    this.trust = clamp(this.trust + delta, 0, 100);
    r.trustDelta = Math.round(this.trust - before);
    r.trust = this.trust;

    // ---- patience: drains every turn, faster for impatient callers
    // reacting to something on screen is less draining than a full exchange
    const decay = opening ? 0 : (2 + (100 - s.patience) / 35) * (this.ctx.patienceMult ?? 1) * (isEvent ? 0.35 : 1);
    this.patience = clamp(this.patience + clamp(Number(raw.patience_change) || 0, -15, 10) - decay, 0, 100);
    if (this.isBaiter) this.patience = Math.max(this.patience, 30); // baiters have all day
    r.patience = this.patience;
    this.emotion = r.emotion;
    if (r.thought) this.thoughts.push(r.thought);

    // ---- action validation
    if (r.action === 'grant_remote') {
      if (this.remoteGranted) r.action = 'none';
      else if (this.trust < TRUST_THRESHOLDS.remote && !this.isBaiter) {
        r.action = 'none';
        r.notes.push('Not enough trust to install remote access yet.');
      } else {
        this.remoteGranted = true;
        r.remoteCode = this.profile.remoteCode;
      }
    }
    if (r.action === 'pay') {
      if (this.isBaiter) {
        r.payAmount = clamp(r.payAmount || 500, 100, 5000);
        r.fake = true;
        this.fakePaid += r.payAmount;
      } else if (this.trust < TRUST_THRESHOLDS.pay) {
        r.action = 'none';
        r.notes.push(`Caller won't pay below ${TRUST_THRESHOLDS.pay} trust.`);
      } else {
        // Payment size: the more they trust you, the deeper they dig — but one payment
        // is capped relative to today's quota (gift cards are smaller than transfers)
        // and every payment after the first gets smaller (buyer's remorse).
        const cap = this.paymentCap(r.payMethod);
        r.payAmount = Math.round(clamp(r.payAmount || 300, 50, cap) / 10) * 10;
        if (r.payAmount <= 0 || this.savingsLeft < 50) {
          r.action = 'none';
          r.notes.push('Caller is out of money!');
        } else {
          this.savingsLeft -= r.payAmount;
          this.paid += r.payAmount;
          this.payments++;
          this.trust = clamp(this.trust - 7, 0, 100);
          r.trust = this.trust;
        }
      }
      if (r.action === 'pay' && r.payMethod === 'none') r.payMethod = 'gift_cards';
    }
    if ((r.action === 'expose' || r.action === 'send_file') && !this.isBaiter) r.action = 'none';
    if (r.action === 'send_file') this.filesSent++;

    // ---- automatic hang-ups
    if (!this.isBaiter && r.action === 'none') {
      if (this.trust <= 3 && this.turns > 1) {
        r.action = 'hang_up';
        r.notes.push('Trust hit rock bottom.');
      } else if (this.patience <= 0) {
        r.action = 'hang_up';
        r.notes.push('Caller ran out of patience.');
      }
    }
    if (this.isBaiter && this.turns > 22 && r.action === 'none') r.action = 'expose';
    if (r.action === 'hang_up' || r.action === 'expose') this.ended = true;
    return r;
  }

  hasMentioned(word) {
    return this.log.some((l) => l.who === 'agent' && l.text.toLowerCase().includes(word.toLowerCase()));
  }
}

// ---------------------------------------------------------------------------
// Offline brain — used when there is no API key (or the API fails mid-call).
// Keyword heuristics + canned lines. Much dumber than the real AI, but the game is
// fully playable for testing.
// ---------------------------------------------------------------------------
const KW = {
  authority: /\b(microsoft|windoze|support|technician|bank|fraud department|irs|government|police|officer|agent|department|security|federal|official|supervisor|manager|customs|delivery|amazon|courier|lottery|sweepstakes|license|certified)\b/i,
  urgency: /\b(urgent|immediately|right now|hack(ed|er|ers)?|virus|infected|arrest|warrant|suspend(ed)?|danger|compromised|stolen|frozen|deadline|lawsuit)\b/i,
  polite: /\b(sir|ma'?am|madam|please|thank you|thanks|dear|happy to help|no problem|my friend)\b/i,
  money: /\b(gift ?cards?|google play|itunes|steam cards?|bitcoin|crypto|wire|western union|pay|payment|fee|transfer|send (me|us) money|\$\s?\d+|dollars?|cash)\b/i,
  remote: /\b(anydesk|teamviewer|remotehelp|remote|install|download|website|www|\.com|access code|connect)\b/i,
  insult: /\b(stupid|idiot|dumb|shut up|moron|useless|old fool|loser)\b/i,
  scamword: /\b(scam|scammer|fake|con|trick|steal|fraud(ster)?)\b/i,
  empathy: /\b(understand|don'?t worry|i'?m here|we will fix|i can help|trust me|for your safety|protect you)\b/i,
};

const CANNED = {
  opening: [
    "Hello? Is this the number from the {lead}? I'm very worried, my name is {first}.",
    "Hi, um, I got a message telling me to call this number. This is {first} {last}. What's going on?",
    "Yes, hello, I'm calling about the {lead}. Is this real? I'm {first}.",
  ],
  happy: ["Oh, that's such a relief! You're very kind.", "Wonderful, thank you so much, dear!", "Okay! That makes sense now. What do I do next?"],
  excited: ["Oh my goodness, really?!", "Wow, okay, let's do it!"],
  confused: ["I'm sorry, what was that? Can you say it slower?", "I don't understand computers very well... which button?", "Wait, the what? The little window?"],
  suspicious: ["Hold on. How do I know you're really who you say you are?", "Hmm. That sounds a bit fishy to me.", "What did you say your name was again? And your badge number?"],
  angry: ["Excuse me? Don't you talk to me like that!", "This is ridiculous, I've been on the phone forever!", "I don't appreciate your tone, young man."],
  scared: ["Oh no, oh no, what do I do?! Please help me!", "Am I in trouble?! I don't want to go to jail!"],
  sad: ["I just don't know who to trust anymore...", "My late husband used to handle all of this..."],
  neutral: ["Okay... go on.", "Mm-hmm. And then what?", "Alright, I'm listening."],
  remote: ["Okay, I typed it in... it's asking for... oh, here's my code: {code}.", "It downloaded! The code it shows me is {code}."],
  pay: ["Alright, I went to the store and got the cards. The amount is ${amount}. Do you need the numbers?", "Fine, I'll send ${amount} right now. Please make the problem go away."],
  noPay: ["Money? Why would I need to pay anything? I'm not sure about this.", "Gift cards? That seems strange for a {role}..."],
  hangup: ["You know what? I'm calling my grandson. Goodbye!", "This is a scam! I'm hanging up!", "I don't have time for this. Goodbye."],
  screen: ["Oh! Something's happening on my screen!", "Whoa, what is all that on my computer?", "Is that... my stuff? What are you doing?"],
  background: ["What on earth is that noise?!", "Is everything okay over there?"],
  baiterExpose: ["[laughing] Gotcha! This whole call is streaming live to thousands of viewers. Say hi, scammer!", "Ha! There is no {first}. I'm a scambaiter, and your number just got reported."],
  baiterFile: ["I'll just send you my bank document so you can see it. It's called bank_statement.pdf.exe, is that normal?"],
  hold: ["Hold on, dear, I need to find my glasses. Don't go anywhere!"],
};

function fill(line, conv, extra = {}) {
  const p = conv.profile;
  return line
    .replace(/\{first\}/g, p.firstName)
    .replace(/\{last\}/g, p.lastName)
    .replace(/\{code\}/g, p.remoteCode)
    .replace(/\{lead\}/g, conv.scenario.leadSource?.replace(/^[^:]*:\s*/, '').slice(0, 40) || 'message')
    .replace(/\{role\}/g, conv.scenario.impersonate?.split(/[,(]/)[0] || 'company')
    .replace(/\{amount\}/g, (extra.amount || 0).toLocaleString());
}

export function offlineBrain(conv, input, { opening = false, isEvent = false } = {}) {
  const s = conv.stats;
  const text = String(input || '');
  const out = { reply: '', emotion: conv.emotion, trust_change: 0, trust_reason: '', patience_change: 0, action: 'none', pay_amount: 0, pay_method: 'none', inner_thought: '' };
  const say = (k, extra) => fill(pick(conv.caller.fallbackLines?.[k] || CANNED[k]), conv, extra);

  if (opening) {
    out.reply = conv.caller.fallbackLines?.greeting ? say('greeting') : say('opening');
    out.emotion = s.gullibility > 6 ? 'scared' : 'confused';
    out.inner_thought = 'I hope this person can help me.';
    return out;
  }
  if (isEvent) {
    const bg = /BACKGROUND/.test(text);
    out.reply = bg ? say('background') : say('screen');
    out.emotion = bg ? 'confused' : s.techLiteracy < 4 ? 'scared' : 'suspicious';
    out.trust_change = bg ? -6 : /balance|refund|error|hacker|netstat|tree/i.test(text) ? (s.techLiteracy < 5 ? 8 : -4) : 0;
    out.trust_reason = bg ? 'weird noises on their end' : 'saw scary stuff on my screen';
    return out;
  }

  let d = 0;
  const reasons = [];
  const p = conv.profile;
  const knowsDetail = [p.petName, p.lastName, p.bank, p.accountLast4, p.cardLast4, p.spouse, p.mothersMaidenName, p.birthday?.split(',')[0], p.email].filter((v) => v && v.length > 2).some((v) => text.toLowerCase().includes(String(v).toLowerCase()));
  if (knowsDetail) (d += 12), reasons.push('knew my private details');
  if (KW.authority.test(text)) (d += 5), reasons.push('sounds official');
  if (KW.urgency.test(text)) (d += s.gullibility > 5 ? 6 : -4), reasons.push(s.gullibility > 5 ? 'sounds urgent and scary' : 'pushy scare tactics');
  if (KW.polite.test(text)) d += 2;
  if (KW.empathy.test(text)) (d += 4), reasons.push('seems caring');
  if (KW.insult.test(text)) (d -= 15), reasons.push('was rude to me');
  if (KW.scamword.test(text)) (d -= 12), reasons.push('said something sketchy');
  const asksMoney = KW.money.test(text);
  const asksRemote = KW.remote.test(text);
  if (asksMoney && conv.trust < TRUST_THRESHOLDS.pay) (d -= 6 + s.skepticism), reasons.push('asked for money too soon');
  if (text.split(/\s+/).length < 3) d -= 1;
  out.trust_change = clamp(Math.round(d + (Math.random() * 4 - 2)), -30, 20);
  out.trust_reason = reasons[0] || (d >= 0 ? 'seems okay so far' : 'something feels off');
  out.patience_change = text.length > 220 ? -6 : 0;

  const projected = conv.trust + out.trust_change;
  if (conv.isBaiter) {
    out.trust_change = Math.abs(out.trust_change) + 4;
    if (conv.turns > 8 && chance(0.25)) {
      out.action = 'expose';
      out.reply = say('baiterExpose');
      out.emotion = 'happy';
      out.inner_thought = 'This clip is going to get SO many views.';
      return out;
    }
    if (asksMoney && conv.turns > 3) {
      out.action = 'pay';
      out.pay_amount = 500 * (1 + Math.floor(Math.random() * 4));
      out.pay_method = 'gift_cards';
      out.reply = fill("Okay! I bought the cards. The first code is... X... 7... hold on, is that a 7 or a T? It's for ${amount}.", conv, { amount: out.pay_amount });
      out.emotion = 'excited';
      out.inner_thought = 'Those codes are from a cereal box, lol.';
      return out;
    }
    if (conv.filesSent === 0 && conv.turns > 2 && chance(0.4)) {
      out.action = 'send_file';
      out.reply = say('baiterFile');
      out.emotion = 'happy';
      out.inner_thought = 'Open it. Open it. OPEN IT.';
      return out;
    }
  }
  if (asksRemote && projected >= TRUST_THRESHOLDS.remote && !conv.remoteGranted) {
    out.action = 'grant_remote';
    out.reply = say('remote');
    out.emotion = 'confused';
  } else if (asksMoney && projected >= TRUST_THRESHOLDS.pay) {
    out.action = 'pay';
    out.pay_method = /bitcoin|crypto/i.test(text) ? 'crypto' : /wire|western/i.test(text) ? 'wire_transfer' : 'gift_cards';
    out.pay_amount = Math.round((conv.paymentCap(out.pay_method) * (0.7 + Math.random() * 0.3)) / 10) * 10;
    out.reply = say('pay', { amount: out.pay_amount });
    out.emotion = 'scared';
  } else if (asksMoney) {
    out.reply = say('noPay');
    out.emotion = 'suspicious';
  } else if (projected <= 5 || (KW.insult.test(text) && s.patience < 50)) {
    out.action = 'hang_up';
    out.reply = say('hangup');
    out.emotion = 'angry';
  } else if (chance(0.06)) {
    out.action = 'hold';
    out.reply = say('hold');
  } else {
    const emo = out.trust_change >= 6 ? (s.gullibility > 6 ? 'happy' : 'neutral') : out.trust_change <= -8 ? (KW.insult.test(text) ? 'angry' : 'suspicious') : KW.urgency.test(text) && s.gullibility > 5 ? 'scared' : s.intelligence < 4 && chance(0.4) ? 'confused' : 'neutral';
    out.emotion = emo;
    out.reply = say(emo);
  }
  out.inner_thought = pick(['I wonder if I left the stove on.', 'This person sounds very professional.', 'Why does this feel weird?', 'I should probably call my daughter after this.', 'Their accent is lovely.']);
  return out;
}

/** Flavor text for the system prompt of settings / debugging. */
export function describeTrustStats(caller) {
  const t = caller.trust || {};
  return `Start ${t.start ?? 40} · Gullible ${t.gullibility ?? 5}/10 · Skeptic ${t.skepticism ?? 5}/10 · Patience ${t.patience ?? 60}`;
}

export { SCHEMA as CALLER_SCHEMA };
