# Modding Scam Call Center

Everything the game says and does with callers, scams and office disasters is data.
There are three ways to add content:

1. **Drop JSON files in this folder** and list them in `manifest.json` (they load on startup).
2. **Import JSON in-game** from *Main menu → Mods → Import mod JSON* (stored in your browser).
3. **Build callers visually** in *Main menu → Custom Clients* (pictures, voices, recordings — export/import as JSON).

A file can hold a single object, or a pack: `{ "modName": "...", "callers": [...], "scenarios": [...], "events": [...] }`.
If two things share an `id`, the one loaded later wins, so you can override base-game content.

---

## Callers (`callers/*.json`)

```jsonc
{
  "id": "maggie-thompson",            // unique id
  "name": "Margaret \"Maggie\" Thompson",
  "firstName": "Margaret",            // optional (derived from name)
  "lastName": "Thompson",             // optional
  "age": 79,
  "gender": "female",                 // "female" | "male" (picks default voices)
  "location": "Duluth, Minnesota",
  "occupation": "Retired school librarian",
  "minDay": 1,                        // first day this caller can appear
  "weight": 3,                        // how often they appear (1 = normal)

  // --- personality: the AI role-plays this ---
  "personality": "Sweet, lonely, painfully polite and extremely gullible...",
  "speakingStyle": "Rambles, calls everyone 'dear'...",
  "dialogueStyle": "Optional extra rules for how they talk",
  "backstory": "Optional",
  "quirks": ["Calls the computer 'the machine'"],
  "catchphrases": ["Oh my stars!"],
  "archetype": "gullible",            // optional hint: gullible, suspicious, argumentative, impatient, confused, overtrusting, genius, paranoid, chatty, sarcastic

  // --- trust behavior (drives the Trust Meter) ---
  "trust": {
    "start": 58,          // 0-100 starting trust
    "gullibility": 9,     // 1-10: scales trust GAINS
    "skepticism": 2,      // 1-10: scales trust LOSSES
    "patience": 90,       // 5-100: how long they put up with you
    "intelligence": 4,    // 1-10: catches inconsistencies
    "techLiteracy": 1,    // 1-10: how scary 'tree'/'netstat' looks to them
    "volatility": 4       // 1-10: how big emotional swings are
  },
  "savings": 42000,                   // money they could be talked out of (scales up on later days)

  // --- special rules: "when X → they do Y" ---
  "triggers": [
    { "when": "the agent mentions Mr. Whiskers", "reaction": "she is delighted and trusts the agent much more" }
  ],

  // --- private details (optional; anything missing is generated) ---
  "details": { "petType": "cat", "petName": "Mr. Whiskers", "bank": "Lakeshore Savings & Loan", "grandkids": ["Tyler"] },

  // --- which scams they fall for (optional, scenario ids) ---
  "scenarios": ["tech-support", "refund"],

  // --- scambaiters ---
  "isScambaiter": false,
  "baiter": {
    "realIdentity": "Dale, an IT guy doing a granny voice",
    "channel": "Grandma Gets Even (LIVE)",
    "tactics": ["pretend computer is slow", "read gift card codes wrong"]
  },

  // --- voice ---
  "voice": {
    "type": "orpheus",                // "orpheus" (Groq TTS) | "wav" (your own voice file) | "browser"
    "voice": "diana",                 // orpheus: autumn, diana, hannah, austin, daniel, troy
    "style": "[shaky]",               // optional default vocal direction
    "pitch": 1.0,
    "babble": "/mods/voices/maggie.wav",   // type "wav": a short clip that gets chopped into syllables
    "sfx": {                                // optional emotion sound effects (any audio file / data URL)
      "happy": "/mods/voices/maggie_laugh.wav",
      "angry": "/mods/voices/maggie_huff.wav"
    }
  },

  // --- looks ---
  "appearance": {
    // DiceBear "avataaars" options (expressions change automatically with emotion)
    "avatar": { "seed": "maggie", "top": "bun", "hairColor": "e8e1e1", "skinColor": "ffdbb4", "accessories": "round", "clothing": "collarAndSweater", "clothesColor": "ffafb9", "facialHair": "", "backgroundColor": "ffd5dc" },
    // OR your own pictures per emotion (URLs or data URLs). Missing ones fall back to the avatar.
    "images": { "neutral": "/mods/img/maggie.png", "happy": "/mods/img/maggie_happy.png", "angry": "...", "scared": "...", "confused": "...", "suspicious": "...", "sad": "...", "excited": "..." }
  },

  // --- offline mode lines (used only without an API key) ---
  "fallbackLines": { "greeting": ["Hello? Is this the computer people?"], "happy": ["Oh, you're a dear!"] }
}
```

**Emotions:** neutral, happy, excited, confused, suspicious, angry, scared, sad.

### Custom voices (WAV)
Groq's TTS can't clone voices, so custom voices work like Animal Crossing "babble":
put a 2–6 second WAV of someone talking in `public/mods/voices/` and set
`"voice": { "type": "wav", "babble": "/mods/voices/you.wav", "pitch": 1.1 }`.
Emotion sound effects (`voice.sfx`) play right before lines spoken in that emotion.
In the Custom Client maker you can also **record** both straight from your mic.

---

## Scenarios / scams (`scenarios/*.json`)

```json
{
  "id": "tech-support",
  "name": "Tech Support Virus",
  "impersonate": "Windoze Tech Support",
  "leadSource": "Pop-up ad: 'VIRUS DETECTED!! CALL NOW'",
  "callerContext": "Told to the caller AI: why they are calling, in second person.",
  "unlockDay": 1,
  "payout": 1.0,
  "icon": "🦠",
  "playbook": ["Step shown in the Playbook app", "..."],
  "keywords": ["used", "by", "the", "offline", "brain"]
}
```

---

## Events (`events/*.json`)

Built-in event types have code behind them; tweak their text/timing or add copies:
`power_failure`, `headset`, `boss_visit`, `virus`, `internet`, `visitor`, `police_raid`, `fire`, `air_strike`.

`narrative` events need no code at all:

```json
{
  "id": "chai-wallah",
  "type": "narrative",
  "name": "The Chai Wallah Arrives",
  "minDay": 1,
  "weight": 2,
  "message": "☕ The chai wallah is here, ringing his bell.",
  "background": "What the caller hears on the line (they react to it!)",
  "effects": { "money": 0, "timeMinutes": -15, "heat": 0, "trustCurrent": -5, "patienceAll": 10 },
  "choices": [
    { "label": "Buy chai (-$20)", "effects": { "money": -20, "patienceAll": 15 }, "result": "Everyone loves you." },
    { "label": "Keep working", "effects": {}, "result": "Raju steals your cup." }
  ]
}
```

Effects: `money` (+/-), `timeMinutes` (negative = time lost), `heat` (police attention),
`trustCurrent` (current caller's trust), `patienceAll` (current caller's patience).
`timeLimit` (seconds) applies to the coded event types.
