// Generates the contents of a caller's computer for the RemoteHelp app: documents,
// photos, email, online banking, and (for scambaiters) honeypot clues and traps.
// Text uses [[label|value]] markers for facts the player can click to save as intel.
import { seeded, pick } from '../core/util.js';

const PET_EMOJI = { cat: '🐈', dog: '🐕', parrot: '🦜', goldfish: '🐠', tortoise: '🐢' };

export function buildVictimPC(caller) {
  const p = caller.profile;
  const rng = seeded(`${caller.id}-pc-${p.remoteCode}`);
  const baiter = !!caller.isScambaiter;
  const first = p.firstName;
  const last = p.lastName;
  const fam = [...(p.kids || []), ...(p.grandkids || [])];

  const docs = [
    {
      name: 'passwords.txt', icon: '📝', kind: 'text', event: 'opened a file called passwords.txt containing all your passwords',
      content: `MY PASSWORDS (do not lose!!)\n\nEmail: [[Email|${p.email}]]\nEmail password: [[Email password|${p.emailPassword}]]\nBank login: ${first.toLowerCase()}${last.toLowerCase()}\nBank password: [[Bank password|${p.emailPassword}!]]\nNetflix: same as email\nWiFi: ${p.petName.replace(/\W/g, '')}${rng.int(10, 99)}\n\nSecurity question (mother's maiden name): [[Mother's maiden name|${p.mothersMaidenName}]]`,
    },
    {
      name: `${p.bank.replace(/\W+/g, '_')}_statement.txt`, icon: '🧾', kind: 'text', event: 'opened your bank statement',
      content: `${p.bank.toUpperCase()}\nMonthly Statement\n\nAccount holder: [[Full name|${p.fullName}]]\nAddress: [[Address|${p.address}]]\nChecking account ending in [[Account last 4|${p.accountLast4}]]\nDebit card ending in [[Card last 4|${p.cardLast4}]]\nRouting: ${p.routingNumber}\n\nChecking balance: [[Checking balance|$${p.checkingBalance.toLocaleString()}]]\nSavings balance: [[Savings balance|$${p.savingsBalance.toLocaleString()}]]\n\nRecent: ${pick(['WALMART #3321', 'CVS PHARMACY', 'BINGO HALL', 'PETCO', 'QVC SHOPPING NETWORK'])}  -$${rng.int(12, 180)}.00`,
    },
    {
      name: fam.length ? `Letter to ${fam[0]}.txt` : 'Diary.txt', icon: '💌', kind: 'text', event: 'opened a very personal letter/diary of yours',
      content: fam.length
        ? `Dear [[Family member|${fam[0]}]],\n\nI hope you are doing well! ${p.petName} the ${p.petType} says hello. I finally learned how to use the computer, well, mostly. Your ${p.spouse ? `grandpa/grandma ${p.spouse}` : 'old grandparent'} sends love.\n\nPlease call me more often. And please remind me what you said about those phone calls from "the computer company"... I forgot.\n\nLove,\n${first}\n\nP.S. My birthday is [[Birthday|${p.birthday}]], don't forget!!`
        : `Dear Diary,\n\nToday I spent 4 hours on ${p.hobbies[0]}. ${p.petName} the ${p.petType} [[Pet name|${p.petName}]] knocked over my coffee again.\n\nI have a secret I've never told anyone: I ${p.secret}.\n\nBirthday coming up: [[Birthday|${p.birthday}]].`,
    },
    {
      name: 'tax_return_2025.txt', icon: '📄', kind: 'text', event: 'opened your tax return with your social security number',
      content: `FORM 1040-ISH (definitely official)\n\nName: ${p.fullName}\nSSN: ***-**-[[SSN last 4|${p.ssnLast4}]]\nOccupation: ${caller.occupation}\nFiling status: ${p.spouse ? 'Married' : 'Single'}\n${p.spouse ? `Spouse: [[Spouse|${p.spouse}]]\n` : ''}Refund owed: $${rng.int(40, 900)}`,
    },
    {
      name: 'shopping list.txt', icon: '🛒', kind: 'text', event: 'opened your shopping list',
      content: `- milk\n- ${p.petType} food for [[Pet name|${p.petName}]]\n- stamps\n- ${pick(['prune juice', 'energy drinks', 'protein powder', 'denture glue', 'scratch-off tickets', 'tinfoil (lots)'])}\n- gift cards?? (for the nice man on the phone)`,
    },
  ];

  const photos = [
    { name: `${p.petName}.jpg`, icon: '🖼️', kind: 'image', emoji: PET_EMOJI[p.petType] || '🐾', caption: `${p.petName} the ${p.petType}`, fact: ['Pet name', p.petName], event: `opened a photo of your ${p.petType} ${p.petName}` },
    { name: 'vacation_1998.jpg', icon: '🖼️', kind: 'image', emoji: '🏖️', caption: 'Myrtle Beach, 1998', event: 'opened your vacation photos' },
    fam.length ? { name: `${fam[0]}_graduation.jpg`, icon: '🖼️', kind: 'image', emoji: '🎓', caption: `${fam[0]}'s graduation`, fact: ['Family member', fam[0]], event: `opened a photo of ${fam[0]}` } : { name: 'selfie.jpg', icon: '🖼️', kind: 'image', emoji: '🤳', caption: 'Selfie', event: 'opened your selfies' },
  ];

  const downloads = [
    { name: 'FreeSolitaire_setup.exe', icon: '⚙️', kind: 'exe', event: 'ran a program in your downloads folder' },
    { name: 'coupon_book.pdf', icon: '📕', kind: 'text', content: '50% off at Dennys. Expired 2019.', event: 'opened a coupon book' },
  ];

  if (baiter) {
    docs.push({ name: 'scammer_numbers.xlsx', icon: '📊', kind: 'text', event: 'opened a spreadsheet listing scam call-center phone numbers — including the one you called', content: `REPORTED SCAM NUMBERS\n\n+1 (888) 555-0142  "Windoze Support"  REPORTED ✔\n+1 (877) 555-0199  "IRD Tax Division" REPORTED ✔\n+1 (866) 555-0123  "GLOBAL SOLUTIONS" ← CURRENT CALL 🎥\n\nTODO: get their real names on stream`, clue: true });
    docs.push({ name: 'episode_notes_ep47.txt', icon: '🎬', kind: 'text', event: 'opened notes for a YouTube episode about wasting scammers\' time', content: `EP 47 PLAN\n- pretend computer is slow (works every time lol)\n- read gift card codes wrong\n- send them the "bank statement" 😈\n- chat says do the granny voice again\n\nSponsor read at 12:00`, clue: true });
    downloads.unshift({ name: 'bank_statement.pdf.exe', icon: '📕', kind: 'exe', trap: true, event: 'opened a file called bank_statement.pdf.exe — it was a trap and infected the agent' });
    downloads.unshift({ name: 'passwords_REAL.exe', icon: '🔑', kind: 'exe', trap: true, event: 'opened passwords_REAL.exe — a trap that reverse-connects to the agent' });
  }

  const recycle = [
    { name: 'old_will.txt', icon: '📄', kind: 'text', event: 'dug through your recycle bin and opened your old will', content: `I leave everything to [[Pet name|${p.petName}]].\n\nExcept the timeshare. Nobody wants the timeshare.` },
  ];

  const email = [
    { from: 'noreply@windoze-security.biz', subject: '⚠️ VIRUS DETECTED call +1-866-555-0123', body: 'Your computer has 37 virus. Call immediately. Do not turn off computer.' },
    fam.length ? { from: `${fam[0].toLowerCase()}@gmail.com`, subject: 'Re: phone calls', body: `${baiter ? 'lol the stream last night was hilarious' : `Grandma/Grandpa, please DON'T give anyone remote access to your computer!! And never buy gift cards for strangers. Love, ${fam[0]}`}` } : { from: 'newsletter@bingoworld.com', subject: 'BINGO NIGHT THIS FRIDAY!!', body: 'Free cookies.' },
    { from: `alerts@${p.bank.toLowerCase().replace(/[^a-z]/g, '')}.com`, subject: 'Your monthly statement is ready', body: `Your checking account ending in ${p.accountLast4} has a new statement.` },
    { from: 'prince.adewale@royalmail.ng', subject: 'URGENT BUSINESS PROPOSAL', body: 'Dearest friend, I am prince... (wow, amateurs)' },
  ];

  const history = baiter
    ? ['youtube.com/@GrandmaGetsEven — studio', 'how to set up a virtual machine for scambaiting', 'voice changer old lady preset', 'reverse RAT tutorial']
    : ['how to delete virus', 'is my computer hacked', `${p.hobbies[0]} for beginners`, 'why is my printer sad', `${p.bank} login`, 'can cats eat bananas'];

  return {
    baiter,
    vm: baiter,
    owner: p.fullName,
    wallpaper: baiter ? 'linear-gradient(160deg,#1d2b3a,#3d5a80)' : pick(['linear-gradient(160deg,#3a7bd5,#00d2ff)', 'linear-gradient(160deg,#f6d365,#fda085)', 'linear-gradient(160deg,#84fab0,#8fd3f4)', 'linear-gradient(160deg,#a18cd1,#fbc2eb)']),
    folders: { Documents: docs, Pictures: photos, Downloads: downloads, 'Recycle Bin': recycle },
    email,
    history,
    bank: {
      name: p.bank,
      holder: p.fullName,
      checking: baiter ? 9999999 : p.checkingBalance,
      savings: baiter ? 4999999 : p.savingsBalance,
      last4: p.accountLast4,
      tx: [
        ['Today', pick(['WALMART', 'CVS', 'BINGO HALL', 'PETCO', 'STARBUCKS']), -rng.int(5, 90)],
        ['Yesterday', 'SOCIAL SECURITY DEP', rng.int(900, 2400)],
        ['3 days ago', pick(['QVC', 'AMAZON', 'HOME SHOPPING NETWORK']), -rng.int(20, 300)],
        ['Last week', `${p.petType.toUpperCase()} SUPPLIES`, -rng.int(10, 80)],
      ],
    },
    trays: baiter ? ['🔴 OBS REC', '📦 VBox'] : ['🛡️ ' + pick(['NortonGuard (expired)', 'McAffee Trial (expired)'])],
  };
}

/** Parse [[label|value]] markers into text/fact segments. */
export function parseFacts(text) {
  const out = [];
  const re = /\[\[([^|\]]+)\|([^\]]+)\]\]/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ fact: { label: m[1], value: m[2] } });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
