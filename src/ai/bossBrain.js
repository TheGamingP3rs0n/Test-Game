// End-of-day performance review from the boss, Mr. Chatterjee. The verdict (pass,
// strike, fired...) is decided by game rules; the AI writes the rant around it and
// judges the player's one excuse.
import { chatJSON } from './groq.js';
import { hasApiKey } from '../core/store.js';
import { pick, money } from '../core/util.js';

export const BOSS = {
  name: 'Mr. Chatterjee',
  voice: { type: 'orpheus', voice: 'troy', gender: 'male', pitch: 0.95 },
  persona: `You are Mr. Chatterjee, the volcanic, rage-filled but hilarious boss of a shady call center in Kolkata in a dark-comedy video game. You scream, you make absurd and oddly specific threats (never graphic violence or slurs) like "I will sell your chair to the chai wallah", "you will be transferred to the night shift in the basement with the rats and the fax machine", "I will tell your mother". You are obsessed with the daily quota, your sports car loan, and your pet koi fish Rajesh. Good results make you awkwardly, suspiciously generous for about three seconds.`,
};

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['speech', 'mood', 'nickname'],
  properties: {
    speech: { type: 'string' },
    mood: { type: 'string', enum: ['proud', 'satisfied', 'disappointed', 'furious', 'apocalyptic'] },
    nickname: { type: 'string' },
  },
};

const EXCUSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['speech', 'accepted', 'mood'],
  properties: {
    speech: { type: 'string' },
    accepted: { type: 'boolean' },
    mood: { type: 'string', enum: ['proud', 'satisfied', 'disappointed', 'furious', 'apocalyptic'] },
  },
};

function summary(report) {
  return [
    `Day ${report.day}. Daily quota: ${money(report.quota)}. Team earned: ${money(report.earned)} (${Math.round((report.earned / report.quota) * 100)}% of quota).`,
    `Calls answered: ${report.callsTaken}. Missed calls: ${report.missedCalls}. Successful scams: ${report.scamsWon}. Callers who hung up on us: ${report.hangups}.`,
    `Scambaiters correctly flagged: ${report.baitersFlagged}. Times exposed by scambaiters: ${report.exposed}. Malware infections: ${report.infections}.`,
    `Office disasters: ${report.disasters.map((d) => `${d.name} (${d.success ? 'handled' : 'FAILED'})`).join(', ') || 'none'}.`,
    `Police heat: ${Math.round(report.heat)}/100. Strikes before today: ${report.strikesBefore}/3.`,
    report.highlights.length ? `Notable moments: ${report.highlights.slice(-6).join(' | ')}` : '',
    `VERDICT (already decided, announce it in your speech): ${report.verdict.toUpperCase()} — ${report.verdictText}`,
  ].filter(Boolean).join('\n');
}

export async function bossReview(report) {
  if (hasApiKey()) {
    try {
      const r = await chatJSON({
        system: `${BOSS.persona}\n\nYou are giving the player their end-of-day performance review in your office. Speak directly to them. 3-6 sentences (max ~110 words). Reference specific numbers and moments from the report. You may start with ONE vocal direction in brackets like [shouting] or [furious] or [suspiciously cheerful]. Also invent a short insulting/affectionate nickname for the player.`,
        messages: [{ role: 'user', content: summary(report) }],
        schema: REVIEW_SCHEMA,
        schemaName: 'boss_review',
        temperature: 1,
        lastPatience: 25000,
      });
      return { speech: r.speech, mood: r.mood, nickname: r.nickname };
    } catch (err) {
      console.warn('Boss AI failed, using canned review', err);
    }
  }
  return cannedReview(report);
}

export async function bossExcuse(report, excuse) {
  if (hasApiKey()) {
    try {
      const r = await chatJSON({
        system: `${BOSS.persona}\n\nThe player just gave an excuse/response to your performance review. Decide if it is funny, clever or groveling enough to accept (accepted=true removes today's strike — be stingy: accept maybe 1 in 4, more often if it is genuinely hilarious or flatters your koi fish). Reply in 1-3 sentences (max ~60 words), in character.`,
        messages: [
          { role: 'user', content: summary(report) },
          { role: 'user', content: `The player says: "${excuse}"` },
        ],
        schema: EXCUSE_SCHEMA,
        schemaName: 'boss_excuse',
        temperature: 1,
        maxTokens: 220,
        lastPatience: 25000,
      });
      return r;
    } catch (err) {
      console.warn('Boss excuse AI failed', err);
    }
  }
  const accepted = /rajesh|koi|sorry|forgive|beautiful|genius|best boss|sir/i.test(excuse) && Math.random() < 0.5;
  return {
    speech: accepted ? 'Hmph. You mentioned... respect. Fine. FINE. The strike is gone. Do not make me regret this or I will feed your stapler to Rajesh.' : pick(['Excuses! I eat excuses for breakfast with extra chili! Get out of my office!', 'Did you practice that in the mirror? It shows. It does not work. GET OUT.']),
    accepted,
    mood: accepted ? 'satisfied' : 'furious',
  };
}

function cannedReview(r) {
  const pct = r.earned / r.quota;
  if (r.verdict === 'fired') return { speech: `[apocalyptic] ${money(r.earned)}?! THAT is what you bring me?! You are FIRED. Leave your headset, leave your chair, leave your dignity. Rajesh the koi fish could do your job with his fins!`, mood: 'apocalyptic', nickname: 'Former Employee' };
  if (pct >= 1.5) return { speech: `[suspiciously cheerful] ${money(r.earned)}! You magnificent little gremlin! I almost feel... emotions. Here, take this bonus before I change my mind. Tomorrow the quota goes up, obviously.`, mood: 'proud', nickname: 'Golden Goose' };
  if (pct >= 1) return { speech: `[grumbling] ${money(r.earned)}. You hit the quota. Barely acceptable. I have seen faster work from the office cow. Come back tomorrow and do better or I will tell your mother.`, mood: 'satisfied', nickname: 'Adequate Andy' };
  return { speech: `[shouting] ${money(r.earned)}?! The quota was ${money(r.quota)}! Do you know how much my sports car payment is?! That is a STRIKE. One more disaster like this and you are working the night shift with the rats!`, mood: 'furious', nickname: 'Quota Crusher (Not)' };
}
