// Generates the private details of a caller (family, pets, bank, passwords...) from a
// seed, plus fully procedural callers. These details fill the victim's remote PC and
// are what the AI caller "knows" about themselves.
import { seeded, digits } from '../core/util.js';

const FIRST = {
  female: {
    old: ['Dorothy', 'Margaret', 'Betty', 'Shirley', 'Gloria', 'Edna', 'Mildred', 'Agnes', 'Florence', 'Phyllis', 'Bernice', 'Rosa', 'Doris', 'Gladys'],
    mid: ['Linda', 'Susan', 'Karen', 'Donna', 'Patricia', 'Deborah', 'Tammy', 'Denise', 'Wendy', 'Lori', 'Michelle', 'Angela'],
    young: ['Brittany', 'Ashley', 'Kayleigh', 'Madison', 'Taylor', 'Chloe', 'Megan', 'Jasmine', 'Hailey', 'Sierra'],
  },
  male: {
    old: ['Harold', 'Walter', 'Earl', 'Eugene', 'Herbert', 'Clarence', 'Melvin', 'Ernest', 'Leonard', 'Floyd', 'Gerald', 'Norman'],
    mid: ['Gary', 'Doug', 'Randy', 'Kevin', 'Steve', 'Greg', 'Darrell', 'Todd', 'Rick', 'Craig', 'Dale', 'Wayne'],
    young: ['Tyler', 'Brayden', 'Chad', 'Kyle', 'Logan', 'Hunter', 'Jayden', 'Austin', 'Cody', 'Mason'],
  },
};
const LAST = ['Thompson', 'Miller', 'Johnson', 'Kowalski', 'Henderson', 'McAllister', 'Fitzgerald', 'Pickering', 'Dunbar', 'Whitaker', 'Hollis', 'Barnes', 'Crumb', 'Wiggins', 'Pemberton', 'Snodgrass', 'Butterfield', 'Ramirez', 'Okafor', 'Nguyen', 'Schultz', 'Delgado', 'Brennan', 'Lindqvist'];
const CITIES = ['Duluth, Minnesota', 'Boise, Idaho', 'Tulsa, Oklahoma', 'Scranton, Pennsylvania', 'Fresno, California', 'Akron, Ohio', 'Mobile, Alabama', 'Spokane, Washington', 'Lubbock, Texas', 'Bangor, Maine', 'Dayton, Ohio', 'Reno, Nevada', 'Leeds, England', 'Swindon, England', 'Moose Jaw, Saskatchewan', 'Wollongong, Australia', 'Sheboygan, Wisconsin', 'Kalamazoo, Michigan'];
const BANKS = ['First Prairie Bank', 'Lakeshore Savings & Loan', 'Eagle Trust Bank', 'Heartland Credit Union', 'Pinnacle National', 'Bank of Everywhere', 'Goldbrook Federal', 'Union Pacific Savings'];
const PETS = [
  ['cat', ['Mr. Whiskers', 'Princess', 'Mittens', 'Sir Fluffington', 'Biscuit', 'Cheeto', 'Garfield Jr.']],
  ['dog', ['Buster', 'Rocky', 'Duke', 'Peanut', 'Sergeant Barksworth', 'Cookie', 'Tank']],
  ['parrot', ['Captain', 'Polly', 'Kevin', 'Mango']],
  ['goldfish', ['Bubbles', 'Sushi', 'Jaws']],
  ['tortoise', ['Speedy', 'Gerald', 'Old Tom']],
];
const OCCUPATIONS = {
  old: ['Retired school librarian', 'Retired postal worker', 'Retired dentist', 'Retired accountant', 'Retired farmer', 'Retired nurse', 'Retired bus driver', 'Retired insurance salesman'],
  mid: ['Middle school PE teacher', 'Regional sales manager', 'HVAC technician', 'Dental hygienist', 'Real estate agent', 'Truck dispatcher', 'Insurance adjuster', 'Bakery owner'],
  young: ['Lifestyle influencer', 'Barista', 'College student', 'Crypto day trader', 'Dog groomer', 'Esports hopeful', 'Uber driver', 'Junior marketing associate'],
};
const HOBBIES = ['knitting', 'birdwatching', 'collecting porcelain frogs', 'bingo', 'competitive bowling', 'model trains', 'gardening', 'online poker', 'true-crime podcasts', 'Facebook arguments', 'yodeling', 'metal detecting', 'baking pies', 'fantasy football', 'conspiracy forums', 'line dancing'];
const SECRETS = [
  'secretly hides $2,000 cash in a coffee can',
  'never told their spouse about the timeshare in Branson',
  'runs an anonymous blog about Bigfoot sightings',
  'has been losing at online slots every night',
  'still owes their brother $500 from 1997',
  'pretends to like their neighbor\'s casserole',
  'wrote a 400-page fan fiction about a weatherman',
  'bought 30,000 units of a meme coin called $GOOSE',
];

const ARCHETYPES = [
  { key: 'gullible', label: 'Extremely gullible', trust: [55, 70], gull: [8, 10], skep: [1, 2], pat: [70, 95], intel: [2, 4], personality: 'Trusting to a fault, eager to help, believes anything said in an official tone. Gets scared easily and apologizes a lot.' },
  { key: 'suspicious', label: 'Suspicious', trust: [15, 30], gull: [2, 4], skep: [7, 9], pat: [40, 60], intel: [5, 7], personality: 'Distrustful, asks for names and badge numbers, wants proof for everything, has heard about scams on the news.' },
  { key: 'argumentative', label: 'Argumentative', trust: [30, 45], gull: [4, 6], skep: [5, 7], pat: [30, 50], intel: [4, 6], personality: 'Loves to argue about everything, contradicts the agent constantly, but can be won over by someone who argues back confidently.' },
  { key: 'impatient', label: 'Impatient', trust: [35, 50], gull: [5, 7], skep: [4, 6], pat: [20, 35], intel: [4, 6], personality: 'Always in a hurry, talks fast, hates being put on hold, wants this fixed in five minutes.' },
  { key: 'confused', label: 'Confused', trust: [45, 60], gull: [7, 9], skep: [2, 4], pat: [60, 85], intel: [2, 3], personality: 'Easily confused, mishears words, mixes up instructions, needs everything repeated three times, but is very cooperative.' },
  { key: 'overtrusting', label: 'Overly trusting', trust: [60, 75], gull: [9, 10], skep: [1, 1], pat: [75, 95], intel: [3, 5], personality: 'Thinks everyone is a friend. Overshares personal details. Invites the agent to Thanksgiving.' },
  { key: 'genius', label: 'Unusually intelligent', trust: [25, 40], gull: [2, 4], skep: [6, 8], pat: [50, 70], intel: [9, 10], personality: 'Very smart and analytical, asks pointed technical questions and catches inconsistencies, but is curious and can be dazzled by elaborate technobabble.' },
  { key: 'paranoid', label: 'Paranoid', trust: [30, 45], gull: [6, 8], skep: [5, 7], pat: [45, 65], intel: [4, 6], personality: 'Believes the government, 5G towers and lizard people are watching. Distrusts banks but believes wild conspiracies.' },
  { key: 'chatty', label: 'Chatty', trust: [45, 60], gull: [6, 8], skep: [3, 4], pat: [80, 100], intel: [4, 6], personality: 'Lonely and talkative, goes on long tangents about family drama and the weather, easily distracted.' },
  { key: 'sarcastic', label: 'Sarcastic', trust: [25, 40], gull: [4, 6], skep: [5, 7], pat: [35, 55], intel: [6, 8], personality: 'Deadpan and sarcastic, makes fun of the agent, but secretly bored and might go along with it for entertainment.' },
];

export const ARCHETYPE_KEYS = ARCHETYPES.map((a) => a.key);

const AVATAR = {
  topsF: ['bob', 'bun', 'curly', 'curvy', 'longButNotTooLong', 'miaWallace', 'straight01', 'straight02', 'straightAndStrand', 'bigHair', 'frida', 'fro'],
  topsM: ['shortFlat', 'shortRound', 'shortWaved', 'sides', 'theCaesar', 'theCaesarAndSidePart', 'shortCurly', 'shaggy', 'shaggyMullet', 'dreads01', 'frizzle'],
  skin: ['614335', 'd08b5b', 'ae5d29', 'edb98a', 'ffdbb4', 'fd9841'],
  hairYoung: ['2c1b18', '4a312c', '724133', 'a55728', 'b58143', 'd6b370', 'c93305', 'f59797'],
  hairOld: ['e8e1e1', 'ecdcbf', 'd6b370'],
  clothes: ['blazerAndShirt', 'blazerAndSweater', 'collarAndSweater', 'graphicShirt', 'hoodie', 'overall', 'shirtCrewNeck', 'shirtScoopNeck', 'shirtVNeck'],
  clothesColor: ['262e33', '65c9ff', '5199e4', '25557c', 'e6e6e6', '929598', '3c4f5c', 'b1e2ff', 'a7ffc4', 'ffafb9', 'ffffb1', 'ff488e', 'ff5c5c'],
};

function ageBand(age) {
  return age >= 62 ? 'old' : age >= 35 ? 'mid' : 'young';
}

export function makeAvatar(rng, { gender, age }) {
  const band = ageBand(age);
  return {
    seed: String(rng.int(1, 1e9)),
    top: rng.pick(gender === 'female' ? AVATAR.topsF : AVATAR.topsM),
    hairColor: band === 'old' ? rng.pick(AVATAR.hairOld) : rng.pick(AVATAR.hairYoung),
    skinColor: rng.pick(AVATAR.skin),
    facialHair: gender === 'male' && rng.chance(0.45) ? rng.pick(['beardLight', 'beardMajestic', 'beardMedium', 'moustacheFancy', 'moustacheMagnum']) : '',
    accessories: band === 'old' ? rng.pick(['prescription01', 'prescription02', 'round', 'kurt']) : rng.chance(0.25) ? rng.pick(['prescription01', 'round', 'sunglasses', 'wayfarers']) : '',
    clothing: rng.pick(AVATAR.clothes),
    clothesColor: rng.pick(AVATAR.clothesColor),
    backgroundColor: rng.pick(['b6e3f4', 'c0aede', 'd1d4f9', 'ffd5dc', 'ffdfbf', 'c1f4c5', 'fff3b0']),
  };
}

/** Fully random caller definition (same shape as a mod caller JSON). */
export function proceduralCaller(seed, { day = 1, archetype = null } = {}) {
  const rng = seeded(seed);
  const gender = rng.chance(0.5) ? 'female' : 'male';
  const age = rng.chance(0.5) ? rng.int(62, 91) : rng.chance(0.5) ? rng.int(35, 61) : rng.int(19, 34);
  const band = ageBand(age);
  const first = rng.pick(FIRST[gender][band]);
  const last = rng.pick(LAST);
  const a = ARCHETYPES.find((x) => x.key === archetype) || rng.pick(ARCHETYPES);
  const r = (range) => rng.int(range[0], range[1]);
  const voices = gender === 'female' ? ['autumn', 'diana', 'hannah'] : ['austin', 'daniel', 'troy'];
  return {
    id: `proc_${seed}`,
    procedural: true,
    name: `${first} ${last}`,
    firstName: first,
    lastName: last,
    age,
    gender,
    location: rng.pick(CITIES),
    occupation: rng.pick(OCCUPATIONS[band]),
    archetype: a.key,
    personality: a.personality,
    speakingStyle: band === 'old' ? 'Slow and polite, old-fashioned expressions, a little hard of hearing.' : band === 'young' ? 'Casual slang, short sentences, easily distracted by their phone.' : 'Normal everyday speech, a bit tired and stressed.',
    quirks: [rng.pick(['Keeps mentioning their favorite TV show', 'Hums when nervous', 'Talks to their pet mid-sentence', 'Insists on spelling everything out', 'Brings up their ex constantly', 'Thinks the agent sounds like a celebrity'])],
    trust: { start: r(a.trust), gullibility: r(a.gull), skepticism: r(a.skep), patience: r(a.pat), intelligence: r(a.intel), techLiteracy: band === 'old' ? rng.int(1, 3) : band === 'mid' ? rng.int(3, 6) : rng.int(5, 8), volatility: rng.int(3, 8) },
    savings: Math.round((band === 'old' ? rng.int(8000, 70000) : band === 'mid' ? rng.int(3000, 40000) : rng.int(500, 9000)) * (1 + 0.3 * (day - 1)) / 10) * 10,
    isScambaiter: false,
    voice: { type: 'orpheus', voice: rng.pick(voices) },
    appearance: { avatar: makeAvatar(rng, { gender, age }) },
    minDay: 1,
  };
}

/**
 * Expand a caller definition into a full profile with private details. Values
 * already present in `def.details` win over generated ones.
 */
export function buildProfile(def, seed) {
  const rng = seeded(`${def.id}:${seed}`);
  const first = def.firstName || def.name.split(' ')[0];
  const last = def.lastName || def.name.split(' ').slice(-1)[0];
  const [petType, petNames] = rng.pick(PETS);
  const bank = rng.pick(BANKS);
  const kids = Array.from({ length: rng.int(0, 3) }, () => rng.pick([...FIRST.female.young, ...FIRST.male.young]));
  const grandkids = def.age >= 60 ? Array.from({ length: rng.int(1, 4) }, () => rng.pick([...FIRST.female.young, ...FIRST.male.young, 'Tiffany', 'Brandon', 'Caden'])) : [];
  const birthYear = 2026 - (def.age || 50);
  const savings = def.savings ?? 10000;
  const checking = Math.round(savings * (0.08 + rng.next() * 0.2));
  const emailUser = `${first}.${last}${rng.int(1, 99)}`.toLowerCase().replace(/[^a-z0-9.]/g, '');
  const generated = {
    fullName: `${first} ${last}`,
    firstName: first,
    lastName: last,
    birthday: `${rng.pick(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'])} ${rng.int(1, 28)}, ${birthYear}`,
    address: `${rng.int(100, 9999)} ${rng.pick(['Maple', 'Oak', 'Elm', 'Birch', 'Willow', 'Cedar', 'Pine', 'Lakeview', 'Sunset'])} ${rng.pick(['St', 'Ave', 'Dr', 'Ln', 'Ct'])}, ${def.location || 'Springfield'}`,
    phone: `(${rng.int(201, 989)}) 555-${digits(4, rng)}`,
    email: `${emailUser}@${rng.pick(['aol.com', 'yahoo.com', 'hotmail.com', 'gmail.com', 'comcast.net'])}`,
    emailPassword: rng.pick([`${(petNames[0] || 'kitty').replace(/[^a-z]/gi, '').toLowerCase()}${birthYear}`, `password${rng.int(1, 9)}`, `${first.toLowerCase()}123`, 'iloveyou', `${last.toLowerCase()}!!`]),
    petType,
    petName: rng.pick(petNames),
    spouse: def.age >= 30 && rng.chance(0.55) ? rng.pick([...FIRST[def.gender === 'female' ? 'male' : 'female'][ageBand(def.age)]]) : '',
    kids,
    grandkids,
    mothersMaidenName: rng.pick(LAST),
    bank,
    accountLast4: digits(4, rng),
    routingNumber: `0${digits(8, rng)}`,
    cardLast4: digits(4, rng),
    savingsBalance: savings - checking,
    checkingBalance: checking,
    ssnLast4: digits(4, rng),
    hobbies: [rng.pick(HOBBIES), rng.pick(HOBBIES)].filter((v, i, arr) => arr.indexOf(v) === i),
    secret: rng.pick(SECRETS),
    computer: rng.pick(['Dell Inspiron from 2014', 'a hand-me-down HP laptop', 'a sticker-covered gaming PC', 'an ancient beige tower PC', 'a cheap Chromebook-looking thing']),
  };
  const details = { ...generated, ...(def.details || {}) };
  details.totalSavings = (details.savingsBalance || 0) + (details.checkingBalance || 0);
  details.remoteCode = `${digits(3, rng)} ${digits(3, rng)} ${digits(3, rng)}`;
  return details;
}

/** A short list of the private facts the AI should treat as "only real staff would know this". */
export function privateFacts(p) {
  return [
    `Full name: ${p.fullName}`,
    `Birthday: ${p.birthday}`,
    `Address: ${p.address}`,
    `Email: ${p.email}`,
    `Bank: ${p.bank}, account ending ${p.accountLast4}, card ending ${p.cardLast4}`,
    `Balances: checking $${p.checkingBalance?.toLocaleString()}, savings $${p.savingsBalance?.toLocaleString()}`,
    `Pet: ${p.petType} named ${p.petName}`,
    p.spouse ? `Spouse: ${p.spouse}` : 'Not married (or widowed)',
    p.kids?.length ? `Kids: ${p.kids.join(', ')}` : '',
    p.grandkids?.length ? `Grandkids: ${p.grandkids.join(', ')}` : '',
    `Mother's maiden name: ${p.mothersMaidenName}`,
    `SSN last 4: ${p.ssnLast4}`,
    `Email password: ${p.emailPassword}`,
    `Hobbies: ${p.hobbies?.join(', ')}`,
    `Embarrassing secret: ${p.secret}`,
    `Computer: ${p.computer}`,
  ].filter(Boolean);
}

const BAITER_IDS = ['a bored IT technician doing a voice', 'a cybersecurity student streaming for awareness', 'a retired police detective with a hobby', 'a YouTuber who wastes scammers\' time for a living', 'a group of college roommates sharing one phone'];
const BAITER_CHANNELS = ['Scammer Payback Jr (LIVE)', 'Grandma Gets Even (LIVE)', 'HoldMusic Heroes (LIVE)', 'The Long Con Stream', 'ByeByeGiftCards (LIVE)', 'NotYourGrandpa TV'];
const BAITER_TACTICS = ['pretend the computer is very slow', 'read codes wrong on purpose', 'ask the agent to spell everything', 'keep "finding their glasses"', 'offer a huge fake balance', 'ask where the agent is really calling from', 'send a "document" that is really malware'];

/** A procedurally generated scambaiter (so they can show up from day 1). */
export function proceduralBaiter(seed, { day = 1 } = {}) {
  const c = proceduralCaller(`baiter-${seed}`, { day, archetype: 'gullible' });
  const rng = seeded(`baiter:${seed}`);
  const tactics = [...BAITER_TACTICS].sort(() => rng.next() - 0.5).slice(0, 4);
  return {
    ...c,
    id: `procbaiter_${seed}`,
    isScambaiter: true,
    personality: `${c.personality} Seems almost TOO eager to cooperate.`,
    trust: { ...c.trust, start: Math.max(c.trust.start, 55), gullibility: 9, skepticism: 1, patience: 100, intelligence: 9, techLiteracy: 9 },
    savings: Math.max(c.savings, 120000),
    baiter: { realIdentity: rng.pick(BAITER_IDS), channel: rng.pick(BAITER_CHANNELS), tactics },
  };
}
