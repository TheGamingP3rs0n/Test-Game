// Office disasters. Each event type has a handler that changes the 3D office and the
// rules (power out, mic broken, PC infected...) and is resolved by physically doing
// something in the office. Event definitions (timing, text, weights) come from JSON
// mods in /public/mods/events — "narrative" events need no code at all.
import * as THREE from 'three';
import { bus } from '../core/bus.js';
import { sfx, startLoop, stopLoop } from '../core/audio.js';
import { pick, money, clamp, randInt } from '../core/util.js';
import { content } from './content.js';
import { eventsPerDay, upgradeLevel } from './progression.js';
import { choiceDialog } from '../ui/dialog.js';

export class ChaosManager {
  constructor(game) {
    this.game = game;
    this.active = null;
    this.schedule = [];
  }

  get world() {
    return this.game.world;
  }

  planDay(day, dayStart, dayEnd) {
    const pool = content.events.filter((e) => (e.minDay || 1) <= day);
    const n = Math.max(0, eventsPerDay(day) - upgradeLevel(this.game.run, 'ganesha'));
    const span = dayEnd - dayStart;
    this.schedule = [];
    // heat makes raids more likely
    const heat = this.game.run.heat || 0;
    for (let i = 0; i < n && pool.length; i++) {
      const weighted = pool.flatMap((e) => Array(Math.max(1, Math.round((e.weight || 1) * (e.type === 'police_raid' ? 1 + heat / 40 : 1)))).fill(e));
      const ev = pick(weighted);
      const at = dayStart + span * (0.12 + (0.78 * (i + Math.random())) / n);
      this.schedule.push({ at, id: ev.id });
    }
    this.schedule.sort((a, b) => a.at - b.at);
    if (heat >= 75 && pool.some((e) => e.type === 'police_raid') && !this.schedule.some((s) => /raid/.test(s.id))) {
      this.schedule.push({ at: dayStart + span * 0.6, id: pool.find((e) => e.type === 'police_raid').id });
    }
  }

  update(dt) {
    const g = this.game;
    if (!this.active && this.schedule.length && g.clock >= this.schedule[0].at) {
      const next = this.schedule.shift();
      this.trigger(next.id);
    }
    const a = this.active;
    if (!a) return;
    a.timeLeft -= dt;
    a.handler.update?.(a, dt);
    bus.emit('chaos:tick', { name: a.def.name, message: a.message, timeLeft: Math.max(0, a.timeLeft), timeLimit: a.timeLimit, progress: a.progressText });
    if (a.timeLeft <= 0 && !a.done) this.finish(a.handler.onTimeout ? a.handler.onTimeout(a) : false);
  }

  trigger(id, opts = {}) {
    if (this.active) {
      if (opts.forced) this.queueAfter = { id, opts };
      return;
    }
    const def = content.events.find((e) => e.id === id) || (id === 'computer-virus' ? { id, type: 'virus', name: 'Computer Virus', timeLimit: 60, message: '🦠 Your PC got infected! Close the pop-ups and run DefendoMax.' } : null);
    if (!def) return;
    const handler = HANDLERS[def.type] || HANDLERS.narrative;
    const a = { def, handler, timeLimit: def.timeLimit || 45, timeLeft: def.timeLimit || 45, message: def.message, progressText: '', opts, done: false };
    this.active = a;
    bus.emit('chaos:start', { name: def.name, message: def.message, timeLimit: a.timeLimit, type: def.type });
    if (def.background && this.game.calls.active) this.game.calls.backgroundEvent(def.background);
    handler.start(a, this);
    if (handler.instant) this.finish(true, { silent: true });
  }

  /** Player interacted with something in the office while an event is active. */
  interact(id) {
    const a = this.active;
    if (!a || a.done) return false;
    return a.handler.interact?.(a, id, this) || false;
  }

  finish(success, { silent = false } = {}) {
    const a = this.active;
    if (!a || a.done) return;
    a.done = true;
    const text = a.handler.end(a, success, this);
    this.active = null;
    const day = this.game.day;
    if (day && a.def.type !== 'narrative') day.disasters.push({ name: a.def.name, success });
    if (!silent) {
      bus.emit('chaos:end', { name: a.def.name, success, text });
      sfx(success ? 'win' : 'lose');
      bus.emit('toast', { kind: success ? 'info' : 'bad', text: `${success ? '✅' : '❌'} ${a.def.name}: ${text}` });
    } else bus.emit('chaos:end', { name: a.def.name, success, text, silent: true });
    if (this.queueAfter) {
      const q = this.queueAfter;
      this.queueAfter = null;
      setTimeout(() => this.trigger(q.id, q.opts), 400);
    }
  }

  /** Clean up at end of day. */
  reset() {
    if (this.active && !this.active.done) {
      this.active.done = true;
      try {
        this.active.handler.end(this.active, true, this);
      } catch (err) {
        console.warn(err);
      }
    }
    this.active = null;
    this.schedule = [];
    this.queueAfter = null;
    bus.emit('chaos:end', { silent: true });
  }

  applyEffects(fx = {}) {
    const g = this.game;
    if (fx.money) g.addMoney(fx.money, fx.money > 0 ? 'Bonus' : 'Expense', { allowNegative: true });
    // negative timeMinutes = time lost (clock jumps ahead), positive = time gained
    if (fx.timeMinutes) g.clock = clamp(g.clock - fx.timeMinutes, g.dayStart, g.dayEnd - 0.5);
    if (fx.heat) g.run.heat = clamp(g.run.heat + fx.heat, 0, 100);
    if (fx.trustCurrent && g.calls.active) g.calls.adjustTrust(fx.trustCurrent, 'chaos in the background');
    if (fx.patienceAll && g.calls.active) g.calls.conv.patience = clamp(g.calls.conv.patience + fx.patienceAll, 0, 100);
  }
}

/** Lose N in-game minutes (time spent dealing with the mess). */
function loseTime(game, minutes) {
  game.clock = Math.min(game.dayEnd - 0.5, game.clock + minutes);
}

const HANDLERS = {
  narrative: {
    instant: false,
    start(a, mgr) {
      const def = a.def;
      a.timeLeft = 999;
      if (def.choices?.length) {
        choiceDialog(def.name, def.message, def.choices.map((c, i) => ({ label: c.label, value: i }))).then((i) => {
          const c = def.choices[i];
          mgr.applyEffects(c.effects);
          a.resultText = c.result || 'Done.';
          mgr.finish(true);
        });
      } else {
        mgr.applyEffects(def.effects);
        a.resultText = 'Chaos survived.';
        setTimeout(() => mgr.finish(true), 3500);
      }
    },
    end(a) {
      return a.resultText || 'Done.';
    },
  },

  power_failure: {
    start(a, mgr) {
      const g = mgr.game;
      g.powerOut = true;
      g.world.office.setPower(false);
      g.world.pipeline.setTint(0xff3030, 0.18);
      sfx('powerDown');
      a.flipped = 0;
      a.progressText = 'Breakers flipped: 0/3';
      if (g.calls.active) {
        g.calls.backgroundEvent('The power just went out on the agent\'s end with a loud pop. The line crackles.');
      }
      bus.emit('computer:power', false);
    },
    interact(a, id, mgr) {
      if (id !== 'breaker') return false;
      a.flipped++;
      sfx('click');
      a.progressText = `Breakers flipped: ${a.flipped}/3`;
      if (a.flipped >= 3) mgr.finish(true);
      return true;
    },
    end(a, success, mgr) {
      const g = mgr.game;
      g.powerOut = false;
      g.world.office.setPower(true);
      g.world.pipeline.setTint(null, 0);
      sfx('powerUp');
      bus.emit('computer:power', true);
      if (!success) {
        loseTime(g, 45);
        if (g.calls.active) g.calls.end('power');
        return 'The electrician took 45 minutes. Calls dropped.';
      }
      return 'Power restored. Everybody cheers (then goes back to scamming).';
    },
  },

  headset: {
    start(a, mgr) {
      mgr.game.micBroken = true;
      sfx('static');
      a.progressText = 'Get a spare headset from the SUPPLIES cabinet';
    },
    interact(a, id, mgr) {
      if (id !== 'supplies') return false;
      sfx('click');
      mgr.finish(true);
      return true;
    },
    end(a, success, mgr) {
      mgr.game.micBroken = false;
      return success ? 'New headset acquired. Crystal clear lies.' : 'You used the broken headset all along. Callers hated it.';
    },
    onTimeout() {
      return false;
    },
  },

  boss_visit: {
    start(a, mgr) {
      const office = mgr.world.office;
      const boss = office.boss;
      const seat = office.playerSeat.pos;
      a.progressText = 'Look busy! Be on a call or at your computer.';
      boss.walk([[5.2, -1.2], [2.0, 0.9], [0.4, 3.3], [seat.x + 0.9, seat.z + 0.3]], {
        speed: 1.3,
        onArrive: () => {
          boss.lookAtXZ(seat.x, seat.z);
          const busy = mgr.game.calls.active || mgr.game.computerOpen;
          a.verdict = busy;
          boss.play(busy ? 'emote-yes' : 'emote-no', { loop: false, then: 'idle' });
          boss.say(busy ? 'Good. Keep scamming.' : 'WHY ARE YOU NOT ON THE PHONE?!', 3);
          sfx(busy ? 'notify' : 'sting');
          setTimeout(() => mgr.finish(busy), 1600);
        },
      });
      a.timeLeft = 60;
    },
    end(a, success, mgr) {
      const office = mgr.world.office;
      office.boss.walk([[0.4, 3.3], [2.0, 0.9], [5.2, -1.2], [office.bossSpot.x, office.bossSpot.z]], { speed: 1.3, onArrive: (b) => (b.root.rotation.y = Math.PI * 0.85) });
      if (!success) {
        mgr.game.addMoney(-100, 'Idle fine', { allowNegative: true });
        mgr.game.addHighlight('Caught slacking by the boss. Fined $100.');
        return 'Fined $100 for "loitering in your own chair".';
      }
      return 'The boss grunts approvingly. That\'s basically a hug.';
    },
  },

  virus: {
    start(a, mgr) {
      mgr.game.virus = true;
      a.progressText = 'Open DefendoMax on your PC and run a scan';
      a.ransom = !!a.opts.ransom;
      sfx('error');
      bus.emit('computer:virus', true);
      mgr.world.pipeline.setTint(0xff2020, 0.12);
    },
    end(a, success, mgr) {
      const g = mgr.game;
      g.virus = false;
      bus.emit('computer:virus', false);
      mgr.world.pipeline.setTint(null, 0);
      if (!success || a.ransom) {
        const loss = Math.min(Math.max(0, g.day.earned), 150 * g.day.day + (a.ransom ? 200 : 0));
        if (loss > 0) g.addMoney(-loss, 'Ransomware', { allowNegative: true });
        return success ? `Cleaned, but the hackers already drained ${money(loss)}.` : `The virus emptied ${money(loss)} from the ledger.`;
      }
      return 'Virus deleted. DefendoMax demands a 5-star review.';
    },
  },

  internet: {
    start(a, mgr) {
      mgr.game.internetDown = true;
      mgr.world.office.setRouter(false);
      a.progressText = 'Reboot the router (side table, west wall)';
      bus.emit('computer:internet', false);
    },
    interact(a, id, mgr) {
      if (id !== 'router') return false;
      if (a.rebooting) return true;
      a.rebooting = true;
      a.progressText = 'Rebooting... (unplug, count to five, pray)';
      sfx('click');
      setTimeout(() => mgr.finish(true), 4000);
      return true;
    },
    end(a, success, mgr) {
      mgr.game.internetDown = false;
      mgr.world.office.setRouter(true);
      bus.emit('computer:internet', true);
      if (!success) loseTime(mgr.game, 30);
      return success ? 'Wi-Fi is back. All 4 bars. For now.' : 'The ISP took 30 minutes to "turn it off and on again".';
    },
  },

  visitor: {
    async start(a, mgr) {
      a.shoos = 0;
      a.progressText = 'Shoo the cow out (walk up, press E ×4)';
      sfx('moo');
      const { cow } = await mgr.world.office.spawnCow();
      a.cow = cow;
      a.mooTimer = 4;
      cow.say('MOOOO', 2);
    },
    update(a, dt) {
      a.mooTimer -= dt;
      if (a.mooTimer <= 0 && a.cow) {
        a.mooTimer = 6 + Math.random() * 6;
        sfx('moo');
        a.cow.say(pick(['MOO.', 'moo?', 'MOOOOOOO', '*eats a gift card*']), 2);
      }
    },
    interact(a, id, mgr) {
      if (id !== 'cow') return false;
      a.shoos++;
      sfx('whoosh');
      a.cow?.say(pick(['moo >:(', 'MOO!', '...moo', 'MOO MOO']), 1.5);
      a.progressText = `Shoo progress: ${a.shoos}/4`;
      if (mgr.game.calls.active && a.shoos === 1) mgr.game.calls.backgroundEvent('The agent is yelling "SHOO! SHOO! GET OUT!" at what sounds like a cow.');
      if (a.shoos >= 4) mgr.finish(true);
      return true;
    },
    end(a, success, mgr) {
      mgr.world.office.removeCow();
      if (!success) {
        loseTime(mgr.game, 25);
        return 'The cow ate a stack of call scripts. 25 minutes wasted re-printing.';
      }
      return 'The cow leaves with dignity. Mostly.';
    },
  },

  police_raid: {
    start(a, mgr) {
      const g = mgr.game;
      const w = mgr.world;
      a.shredded = 0;
      a.needShred = upgradeLevel(g.run, 'shredder') ? 2 : 4;
      startLoop('policeSiren');
      w.fx.addFlasher(w.office.policeLight, [0xff1010, 0x1030ff], 7);
      w.pipeline.setTint(0x4060ff, 0.1);
      a.progressText = `Shred evidence: 0/${a.needShred} • then HIDE under your desk (C)`;
      if (upgradeLevel(g.run, 'bribe') > 0) {
        g.run.upgrades.bribe--;
        a.bribed = true;
        a.progressText = 'You slip the officers your Bribe Envelope...';
        setTimeout(() => mgr.finish(true), 5000);
      }
      setTimeout(() => !a.done && w.office.spawnPolice(3), 9000);
    },
    interact(a, id, mgr) {
      if (id !== 'shredder' || a.shredded >= a.needShred) return false;
      a.shredded++;
      sfx('shred');
      a.progressText = a.shredded >= a.needShred ? 'Evidence shredded! Now HIDE under your desk (C)!' : `Shred evidence: ${a.shredded}/${a.needShred} • then HIDE (C)`;
      return true;
    },
    onTimeout(a) {
      return a.bribed || (a.shredded >= a.needShred && this.hiddenCheck());
    },
    hiddenCheck() {
      return !!HANDLERS._game?.world.player.hidden;
    },
    end(a, success, mgr) {
      const g = mgr.game;
      const w = mgr.world;
      stopLoop('policeSiren');
      w.fx.removeFlasher(w.office.policeLight);
      w.pipeline.setTint(null, 0);
      setTimeout(() => w.office.clearPolice(), a.done && success ? 2500 : 4000);
      if (a.bribed) return 'The officers count the envelope, nod, and leave. Bribe consumed.';
      if (success) {
        g.run.heat = Math.max(0, g.run.heat - 25);
        return 'The police find nothing but chai stains. Heat -25.';
      }
      const loss = Math.round(Math.max(0, g.day.earned) * 0.4);
      if (loss) g.addMoney(-loss, 'Police seized cash', { allowNegative: true });
      g.run.heat = 20;
      g.addHighlight(`Police raid! Seized ${money(loss)} in "evidence".`, true);
      if (g.calls.active) g.calls.end('agent_hung_up');
      return `They found the evidence and seized ${money(loss)}.`;
    },
  },

  fire: {
    start(a, mgr) {
      const w = mgr.world;
      startLoop('fireAlarm');
      const spots = [new THREE.Vector3(-4.4, 0, 0.3), new THREE.Vector3(-5.9, 0, -2.4), new THREE.Vector3(-1.2, 0, -2.5), new THREE.Vector3(-6.2, 0, 3.5)];
      const n = randInt(2, 3);
      a.fires = [];
      for (let i = 0; i < n; i++) a.fires.push(w.fx.addFire(spots[(i + randInt(0, 3)) % spots.length].clone()));
      a.progressText = 'Grab the extinguisher (red, by the kitchen) then click/E near the fire';
      w.pipeline.setTint(0xff6020, 0.12);
    },
    interact(a, id, mgr) {
      const g = mgr.game;
      const w = mgr.world;
      if (id === 'extinguisher') {
        if (g.holding === 'extinguisher') return true;
        g.holding = 'extinguisher';
        w.office.extinguisher.visible = false;
        a.progressText = 'Now spray the fires! (E / click while close)';
        sfx('click');
        return true;
      }
      if (id === 'spray' && g.holding === 'extinguisher') {
        const cam = w.camera;
        const dir = new THREE.Vector3();
        cam.getWorldDirection(dir);
        const origin = cam.position.clone().add(new THREE.Vector3(0, -0.4, 0)).addScaledVector(dir, 0.4);
        w.fx.sprayFrom(origin, dir);
        sfx('spray');
        const aim = cam.position.clone().addScaledVector(dir, 1.6);
        aim.y = 0;
        const out = w.fx.extinguishNear(aim, 0.22);
        a.progressText = `Fires left: ${w.fx.fires.length}`;
        if (out) mgr.finish(true);
        return true;
      }
      return false;
    },
    end(a, success, mgr) {
      const g = mgr.game;
      const w = mgr.world;
      stopLoop('fireAlarm');
      w.fx.clearFires();
      w.pipeline.setTint(null, 0);
      g.holding = null;
      w.office.extinguisher.visible = true;
      if (!success) {
        loseTime(g, 60);
        g.addMoney(-Math.min(300, Math.max(0, g.day.earned)), 'Fire damage', { allowNegative: true });
        g.addHighlight('The office caught fire. Everyone evacuated for an hour.', true);
        return 'Full evacuation. An hour lost and the fire department sent an invoice.';
      }
      return 'Fire out! You are a hero. Vikram is banned from the microwave.';
    },
  },

  air_strike: {
    start(a, mgr) {
      startLoop('airRaid');
      a.progressText = 'TAKE COVER under your desk! (go to your desk, press C)';
      mgr.world.pipeline.setTint(0xff2020, 0.15);
    },
    onTimeout(a) {
      return !!HANDLERS._game?.world.player.hidden;
    },
    end(a, success, mgr) {
      const g = mgr.game;
      const w = mgr.world;
      stopLoop('airRaid');
      sfx('explosion');
      w.fx.addShake(1.2);
      w.fx.dustBurst(new THREE.Vector3(-2, 0, 0), 7);
      bus.emit('flash');
      setTimeout(() => w.pipeline.setTint(null, 0), 1500);
      if (g.calls.active) g.calls.backgroundEvent('A HUGE explosion just shook the agent\'s building. Dust is falling. The agent is coughing.');
      if (!success) {
        loseTime(g, 50);
        g.addHighlight('Didn\'t take cover during the air strike. Spent an hour picking ceiling tiles out of hair.', true);
        return 'You got rattled by debris. 50 minutes in the first-aid room.';
      }
      return 'Safe under the desk. The office looks... rustic now.';
    },
  },
};

export function bindChaosGame(game) {
  HANDLERS._game = game;
}
