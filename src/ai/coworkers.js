// Coworkers you can message in the Messenger app. In single-player they stand in for
// your friends: they gossip, give tips, panic during disasters, and reply via the AI.
import { chatText } from './groq.js';
import { hasApiKey } from '../core/store.js';
import { pick } from '../core/util.js';

export const COWORKERS = [
  { id: 'raju', name: 'Raju', alias: 'Kevin', vibe: 'overconfident top scammer who brags constantly and gives terrible but confident advice', avatar: { seed: 'raju', top: 'shortFlat', hairColor: '2c1b18', skinColor: 'ae5d29', facialHair: 'moustacheFancy', clothing: 'shirtCrewNeck', clothesColor: '65c9ff' } },
  { id: 'priya', name: 'Priya', alias: 'Jennifer', vibe: 'smart, sarcastic, secretly the most competent person in the office; warns you about scambaiters', avatar: { seed: 'priya', top: 'straight01', hairColor: '2c1b18', skinColor: 'd08b5b', clothing: 'blazerAndShirt', clothesColor: 'ff488e' } },
  { id: 'vikram', name: 'Vikram', alias: 'Brad', vibe: 'anxious new hire who is terrified of the boss and keeps asking you for help', avatar: { seed: 'vikram', top: 'shortCurly', hairColor: '4a312c', skinColor: 'ae5d29', accessories: 'prescription02', clothing: 'collarAndSweater', clothesColor: 'a7ffc4' } },
  { id: 'anjali', name: 'Anjali', alias: 'Ashley', vibe: 'chaotic office gossip who knows every rumor, always eating snacks, obsessed with the chai wallah', avatar: { seed: 'anjali', top: 'bun', hairColor: '2c1b18', skinColor: 'd08b5b', clothing: 'hoodie', clothesColor: 'ffffb1' } },
];

export const BOSS_CONTACT = { id: 'boss', name: 'Mr. Chatterjee', alias: 'BOSS', vibe: 'rage-filled boss who types in ALL CAPS', avatar: { seed: 'boss', top: 'sides', hairColor: '4a312c', skinColor: 'ae5d29', facialHair: 'beardMajestic', clothing: 'blazerAndSweater', clothesColor: '262e33' } };

const SCRIPTED = {
  morning: [
    ['raju', 'Bro I already scammed 2 grandmas before you even sat down 😎'],
    ['anjali', 'Did anyone see who took my samosa from the fridge?? I WILL find out'],
    ['priya', "Reminder: if a caller sounds suspiciously excited to buy gift cards, check their PC for VirtualBox. Scambaiters are everywhere."],
    ['vikram', 'Is it normal that the boss stared at me for 4 minutes without blinking'],
  ],
  callWin: [
    ['raju', 'Not bad. Not Raju level, but not bad.'],
    ['anjali', 'KA-CHING 💸 heard that from here'],
    ['vikram', 'How did you do that?? Teach me please 🙏'],
  ],
  callFail: [
    ['raju', 'Skill issue 💀'],
    ['priya', "Next time don't ask for gift cards in the first 10 seconds."],
    ['anjali', 'Oof. I heard them yelling from my desk lol'],
  ],
  exposed: [
    ['priya', 'You just got streamed. I told you. I TOLD you.'],
    ['raju', 'Bro you are on YouTube now 💀💀💀'],
  ],
  disaster: [
    ['vikram', 'WHAT IS HAPPENING'],
    ['anjali', 'I am not getting paid enough for this'],
    ['raju', 'Stay calm. Raju has seen worse. (Raju has not seen worse)'],
  ],
  idle: [
    ['anjali', 'Chai wallah is downstairs!! who wants'],
    ['raju', 'My caller just asked if I am a robot. I said yes. She trusted me MORE.'],
    ['priya', 'Pro tip: callers trust you way more if you mention something personal from their PC. Pet names work great.'],
    ['vikram', 'My caller said her grandson is a police officer. Should I be worried'],
    ['anjali', 'The boss is talking to his koi fish again'],
    ['priya', "Run 'tree' in their command prompt. Boomers think the scrolling text is hackers. Works every time."],
  ],
};

export function scriptedMessage(kind) {
  const [id, text] = pick(SCRIPTED[kind] || SCRIPTED.idle);
  return { from: id, text };
}

export async function coworkerReply(contact, history, playerText, { group = false } = {}) {
  if (!hasApiKey()) {
    return pick(['lol', 'busy rn, on a call 📞', 'bro what', 'ok but did you hit quota yet', "can't talk, boss is watching", '🙏']);
  }
  try {
    return await chatText({
      system: `You are ${contact.name} (fake American alias "${contact.alias}"), a coworker at a chaotic scam call center in Kolkata in a dark-comedy video game. Personality: ${contact.vibe}. ${group ? 'You are replying in the office group chat (#floor) where everyone can read it.' : 'You are texting the player privately in a work chat app.'} Reply with 1-2 short casual chat messages (max 30 words total). No emojis. Stay in character. ${contact.id === 'boss' ? 'You type in ALL CAPS and threaten absurd consequences.' : ''}`,
      messages: [
        ...history.slice(-6).map((m) => ({ role: m.from === 'me' ? 'user' : 'assistant', content: m.from === 'me' || m.from === contact.id ? m.text : `(${m.name || m.from} wrote) ${m.text}` })),
        { role: 'user', content: playerText },
      ],
      temperature: 1,
    });
  } catch (err) {
    console.warn('coworker reply failed', err);
    return pick(['(no reply — probably on a call)', 'brb, boss is walking past', 'can\'t talk, caller is crying']);
  }
}
