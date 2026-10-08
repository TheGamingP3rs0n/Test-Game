// The "scam apps" that turn a code the caller reads out into money — the core earner.
// A caller who trusts you reads a fictional verification code (gift card, card, or
// identity number). You type it into the matching app and hit Verify: a match pays
// out (big +$ popup, "Scam complete"), a scambaiter's fake code comes back INVALID,
// and a wrong code tells you to ask them to read it again. Everything is fictional.
import { el, money, setText } from '../../core/util.js';
import { bus } from '../../core/bus.js';
import { sfx } from '../../core/audio.js';

const APPS = {
  giftcards: {
    name: 'Gift Cards',
    tagline: 'Redeem the gift card codes a caller reads you.',
    accent: '#1f9d4c',
    field: 'Gift Card Code',
    placeholder: 'XXXX-XXXX',
  },
  creditcard: {
    name: 'Credit Card',
    tagline: "Charge a caller's card using the verification code they read aloud.",
    accent: '#0e7fb8',
    field: 'Card Verification Code',
    placeholder: 'XXXXXX',
  },
  identity: {
    name: 'Identity',
    tagline: "Validate a caller's record using the number they read you.",
    accent: '#b3261e',
    field: 'Verification Number',
    placeholder: 'XXX-XX-XXXX',
  },
};

export function scamApp(game, win, appId) {
  const cfg = APPS[appId];
  const body = el('div.scamapp', { style: { '--accent': cfg.accent } });

  const pending = () => (game.day?.pendingPayments || []).filter((p) => p.app === appId && p.status === 'pending');
  const doneToday = () => (game.day?.pendingPayments || []).filter((p) => p.app === appId && (p.status === 'collected' || p.status === 'invalid'));

  const render = () => {
    const jobs = pending();
    const done = doneToday();
    body.replaceChildren(
      el('div.scam-head',
        el('div.scam-title', cfg.name),
        el('div.scam-tag', cfg.tagline)),
      quickBar(),
      jobs.length
        ? el('div.scam-jobs', ...jobs.map((p) => jobCard(p)))
        : el('div.scam-empty',
            el('div', 'Waiting for a caller.'),
            el('small', `Get a caller to trust you, then ask them to read you their ${cfg.field.toLowerCase()}. Their code shows up in the Phone, then you enter it here.`)),
      done.length ? el('div.scam-done',
        el('div.scam-done-head', 'Today'),
        ...done.map((p) => el('div.scam-done-row',
          el('span', p.from),
          el('b', { class: p.status === 'collected' ? 'ok' : 'bad' }, p.status === 'collected' ? `+${money(p.amount)}` : 'INVALID')))) : null,
    );
  };

  // Type (or paste) anything a caller said or you copied from their PC, press Enter.
  // A real code they read you gets collected; their personal details become a trust
  // boost on the live call; anything else is rejected.
  const quickMsg = el('div.scam-quick-msg');
  const quickInput = el('input.scam-input.scam-quick-input', { placeholder: `Type or paste a ${cfg.field.toLowerCase()}… then Enter`, autocomplete: 'off', spellcheck: false, onkeydown: (e) => { e.stopPropagation(); if (e.key === 'Enter') quickCheck(); } });
  const quickBar = () => el('div.scam-quick', el('div.scam-row', quickInput, el('button.scam-verify', { onclick: () => quickCheck() }, 'Check')), quickMsg);
  const usedIntel = new Set();
  const quickCheck = () => {
    const raw = quickInput.value.trim();
    if (!raw) return;
    const norm = game.normCode(raw);
    const match = pending().find((p) => game.normCode(p.code) === norm);
    if (match) {
      const r = game.verifyScam(match, raw);
      quickInput.value = '';
      if (r === 'ok') { sfx('cash'); quickMsg.className = 'scam-quick-msg ok'; setText(quickMsg, `Matched ${match.from}'s code — ${money(match.amount)} collected.`); }
      else if (r === 'invalid') { quickMsg.className = 'scam-quick-msg bad'; setText(quickMsg, `${match.from}'s code was never activated — scambaiter.`); }
      setTimeout(render, 1600);
      return;
    }
    const caller = game.calls.caller;
    const intel = (game.run.intel || []).find((f) => String(f.value).toLowerCase() === raw.toLowerCase() && (!caller || f.callerName === caller.name));
    if (intel && game.calls.active && !usedIntel.has(intel.value)) {
      usedIntel.add(intel.value);
      game.calls.adjustTrust(6, `You "verified" their ${intel.label.toLowerCase()}`);
      game.calls.screenEvent?.(`typed your ${intel.label.toLowerCase()} ("${intel.value}") into a verification form`);
      sfx('trustUp');
      quickMsg.className = 'scam-quick-msg ok';
      setText(quickMsg, `That's their ${intel.label.toLowerCase()} — not a payment code, but quoting it back made them trust you more (+6).`);
      quickInput.value = '';
      return;
    }
    sfx('error');
    quickMsg.className = 'scam-quick-msg bad';
    setText(quickMsg, intel ? 'You already used that detail on this call.' : "Nobody read you that. Get them to read the code out loud (or copy a highlighted detail from their PC).");
    quickInput.select();
  };

  const jobCard = (p) => {
    const input = el('input.scam-input', { placeholder: cfg.placeholder, autocomplete: 'off', spellcheck: false, onkeydown: (e) => (e.stopPropagation(), e.key === 'Enter' && verify()) });
    const status = el('div.scam-status');
    const btn = el('button.scam-verify', { onclick: () => verify() }, 'Verify');
    const card = el('div.scam-job',
      el('div.scam-job-top', el('span.scam-from', p.from), el('span.scam-amt', money(p.amount))),
      el('label.scam-label', cfg.field),
      el('div.scam-row', input, btn),
      status);
    const verify = () => {
      const r = game.verifyScam(p, input.value);
      if (r === 'mismatch') {
        sfx('error');
        status.className = 'scam-status bad';
        setText(status, "That's not the code they read you. Ask them to read it again.");
        input.focus();
        input.select();
        return;
      }
      if (r === 'ok') {
        sfx('cash');
        input.disabled = true;
        btn.disabled = true;
        input.value = p.code;
        card.classList.add('complete');
        card.prepend(el('div.scam-complete', `Scam complete — ${money(p.amount)} earned.`));
        status.replaceChildren();
        setText(btn, 'Verified');
        setTimeout(render, 2200);
      } else if (r === 'invalid') {
        input.disabled = true;
        btn.disabled = true;
        status.className = 'scam-status bad';
        setText(status, 'INVALID — this code was never activated. That caller was a scambaiter.');
        setTimeout(render, 2600);
      } else {
        render();
      }
    };
    return card;
  };

  render();
  const offs = ['call:payment', 'money:changed', 'call:end'].map((e) => bus.on(e, () => body.isConnected && render()));
  win.onClose = () => offs.forEach((o) => o());
  return body;
}
