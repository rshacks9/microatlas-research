// moves.js — Verdant Frontier move table. Pure data + lookups. No DOM, Node-importable.
// 68 moves. All ids, names and flavour are original to Verdant Frontier.
//
// Move record shape (see docs/CONTRACT.md):
//   { id, name, type, category:'physical'|'special'|'status', power, accuracy, pp, priority, desc, effect }
// `effect` is null or exactly one EffectSpec from the closed set battle.js understands:
//   status | stat | heal | drain | recoil | multihit | flinch | confuse | crit | ohko | fixed
// accuracy 0 means "never misses".

/** @typedef {{id:string,name:string,type:string,category:string,power:number,accuracy:number,pp:number,priority:number,desc:string,effect:object|null}} MoveRecord */

function m(id, name, type, category, power, accuracy, pp, priority, desc, effect = null) {
  return { id, name, type, category, power, accuracy, pp, priority, desc, effect };
}

// --- effect helpers (keep the emitted objects plain and literal) ---
const status = (s, chance = 100) => ({ kind: 'status', status: s, chance });
const stat = (target, st, stages, chance = 100) => ({ kind: 'stat', target, stat: st, stages, chance });
const heal = (frac) => ({ kind: 'heal', frac });
const drain = (frac) => ({ kind: 'drain', frac });
const recoil = (frac) => ({ kind: 'recoil', frac });
const multihit = (min, max) => ({ kind: 'multihit', min, max });
const flinch = (chance) => ({ kind: 'flinch', chance });
const confuse = (chance = 100) => ({ kind: 'confuse', chance });
const crit = (stages) => ({ kind: 'crit', stages });

const LIST = [
  // ---------------- PLAIN ----------------
  m('tackle',      'Tackle',       'PLAIN', 'physical', 40,  100, 35, 0, 'A plain full-body charge.'),
  m('scratch',     'Scratch',      'PLAIN', 'physical', 40,  100, 35, 0, 'Rakes the foe with blunt claws.'),
  m('quickjab',    'Quick Jab',    'PLAIN', 'physical', 40,  100, 30, 1, 'Always lands first. Fast and light.'),
  m('headbutt',    'Headbutt',     'PLAIN', 'physical', 65,  100, 25, 0, 'A hard butt that may make foes flinch.', flinch(30)),
  m('bodyslam',    'Body Slam',    'PLAIN', 'physical', 85,  100, 15, 0, 'Drops full weight. May numb the foe.', status('par', 20)),

  // ---------------- BRAWL ----------------
  m('ironfist',    'Iron Fist',    'BRAWL', 'physical', 40,  100, 30, 0, 'A tight, disciplined punch.'),
  m('focusstrike', 'Focus Strike', 'BRAWL', 'physical', 65,  100, 20, 0, 'A centred blow with steady aim.'),
  m('crushblow',   'Crush Blow',   'BRAWL', 'physical', 90,   85, 10, 0, 'A heavy swing that is hard to aim.'),
  m('lastditch',   'Last Ditch',   'BRAWL', 'physical', 130,  90,  5, 0, 'A reckless all-out hit. User is hurt.', recoil(0.33)),

  // ---------------- GALE ----------------
  m('gustcut',     'Gust Cut',     'GALE',  'special',  40,  100, 35, 0, 'A thin blade of moving air.'),
  m('wingslash',   'Wing Slash',   'GALE',  'physical', 60,  100, 25, 0, 'Slashes past on outstretched wings.'),
  m('galeforce',   'Gale Force',   'GALE',  'special',  90,   85, 10, 0, 'A roaring wall of wind.'),
  m('divebomb',    'Dive Bomb',    'GALE',  'physical', 95,   75, 10, 0, 'A wild plunge. Risky but brutal.', flinch(20)),

  // ---------------- EMBER ----------------
  m('emberspit',   'Ember Spit',   'EMBER', 'special',  40,  100, 35, 0, 'Spits a small ember. May burn.', status('brn', 10)),
  m('flamefang',   'Flame Fang',   'EMBER', 'physical', 65,   95, 20, 0, 'Bites with searing jaws. May burn.', status('brn', 20)),
  m('cinderburst', 'Cinder Burst', 'EMBER', 'special',  90,   85, 10, 0, 'A bursting cloud of hot cinders.', status('brn', 10)),
  m('magmalash',   'Magma Lash',   'EMBER', 'physical', 95,   75, 10, 0, 'A whip of molten rock. May burn.', status('brn', 20)),

  // ---------------- TIDE ----------------
  m('waterjet',    'Water Jet',    'TIDE',  'special',  40,  100, 35, 0, 'A narrow jet of pressured water.'),
  m('aquafang',    'Aqua Fang',    'TIDE',  'physical', 65,  100, 20, 0, 'Bites while wreathed in spray.', flinch(20)),
  m('tidalcrash',  'Tidal Crash',  'TIDE',  'special',  90,   85, 10, 0, 'Slams the foe with a rolling wave.'),

  // ---------------- BLOOM ----------------
  m('leafcut',     'Leaf Cut',     'BLOOM', 'physical', 40,  100, 35, 0, 'Slices with a hardened leaf edge.'),
  m('vinelash',    'Vine Lash',    'BLOOM', 'physical', 60,  100, 25, 0, 'Whips the foe with a long vine.'),
  m('bloomburst',  'Bloom Burst',  'BLOOM', 'special',  90,   85, 10, 0, 'A blast of exploding petals.'),
  m('seedvolley',  'Seed Volley',  'BLOOM', 'physical', 20,   90, 20, 0, 'Fires hard seeds two to five times.', multihit(2, 5)),

  // ---------------- SPARK ----------------
  m('sparkbite',   'Spark Bite',   'SPARK', 'physical', 40,  100, 35, 0, 'A crackling nip. May numb the foe.', status('par', 10)),
  m('voltlash',    'Volt Lash',    'SPARK', 'special',  65,  100, 20, 0, 'A lashing arc of current.', status('par', 20)),
  m('thunderclap', 'Thunderclap',  'SPARK', 'special',  90,   85, 10, 0, 'A deafening burst of lightning.', status('par', 10)),

  // ---------------- FROST ----------------
  m('frostbite',   'Frostbite',    'FROST', 'physical', 40,  100, 35, 0, 'A biting chill. May freeze.', status('frz', 10)),
  m('icelance',    'Ice Lance',    'FROST', 'special',  65,  100, 20, 0, 'Hurls a spear of clear ice.', status('frz', 10)),
  m('blizzardcall','Blizzard Call','FROST', 'special',  95,   70, 10, 0, 'Calls a whiteout. Hard to aim.', status('frz', 20)),

  // ---------------- TOXIN ----------------
  m('toxinspray',  'Toxin Spray',  'TOXIN', 'special',  40,  100, 35, 0, 'A fine, stinging spray. May poison.', status('psn', 20)),
  m('venomfang',   'Venom Fang',   'TOXIN', 'physical', 60,  100, 25, 0, 'Sinks tainted fangs in. May poison.', status('psn', 20)),
  m('sludgewave',  'Sludge Wave',  'TOXIN', 'special',  90,   85, 10, 0, 'A surging wave of foul sludge.', status('psn', 10)),

  // ---------------- TERRA ----------------
  m('stonethrow',  'Stone Throw',  'TERRA', 'physical', 40,  100, 35, 0, 'Hurls a blunt stone at the foe.'),
  m('quakestomp',  'Quake Stomp',  'TERRA', 'physical', 65,  100, 20, 0, 'Stomps hard enough to split soil.'),
  m('boulderdrop', 'Boulder Drop', 'TERRA', 'physical', 90,   80, 10, 0, 'Drops a boulder. May cause flinching.', flinch(20)),
  m('sandblast',   'Sandblast',    'TERRA', 'special',  45,   95, 20, 0, 'Grit stings and may blur foe aim.', stat('foe', 'acc', -1, 30)),

  // ---------------- PSION ----------------
  m('mindjab',     'Mind Jab',     'PSION', 'special',  40,  100, 35, 0, 'A sharp pulse of focused thought.'),
  m('psywave',     'Psy Wave',     'PSION', 'special',  65,  100, 20, 0, 'A rippling wave of raw mind.', stat('foe', 'spd', -1, 20)),
  m('mirrorgaze',  'Mirror Gaze',  'PSION', 'special',  90,   85, 10, 0, 'A stare that turns the mind inward.', confuse(20)),
  m('dreameater',  'Dream Eater',  'PSION', 'special',  100, 100, 10, 0, 'Feeds on the dreams of a sleeping foe.', drain(0.5)),

  // ---------------- UMBRA ----------------
  m('shadowclaw',  'Shadow Claw',  'UMBRA', 'physical', 40,  100, 35, 0, 'A dim swipe that lands critically.', crit(1)),
  m('nightbite',   'Night Bite',   'UMBRA', 'physical', 65,  100, 20, 0, 'A bite out of the dark. May flinch.', flinch(20)),
  m('dreadhowl',   'Dread Howl',   'UMBRA', 'special',  90,   85, 10, 0, 'A howl of pure dread. May flinch.', flinch(20)),

  // ---------------- ALLOY ----------------
  m('metalclaw',   'Metal Claw',   'ALLOY', 'physical', 40,  100, 35, 0, 'Hard claws. May sharpen the user.', stat('self', 'atk', 1, 10)),
  m('ironbash',    'Iron Bash',    'ALLOY', 'physical', 65,  100, 20, 0, 'A dull, jarring hit. May dent guard.', stat('foe', 'def', -1, 20)),
  m('platingslam', 'Plating Slam', 'ALLOY', 'physical', 90,   85, 10, 0, 'Slams with heavy plating.', stat('self', 'def', 1, 10)),

  // ---------------- STATUS: stat changes ----------------
  m('growl',       'Growl',        'PLAIN', 'status',    0,  100, 40, 0, 'A soft growl. Lowers foe Attack.', stat('foe', 'atk', -1, 100)),
  m('tailwhip',    'Tail Whip',    'PLAIN', 'status',    0,  100, 30, 0, 'A coy swish. Lowers foe Defence.', stat('foe', 'def', -1, 100)),
  m('screech',     'Screech',      'PLAIN', 'status',    0,   85, 25, 0, 'A shriek that cracks foe Defence.', stat('foe', 'def', -2, 100)),
  m('scaryface',   'Scary Face',   'PLAIN', 'status',    0,  100, 20, 0, 'A grim look. Slows the foe sharply.', stat('foe', 'spe', -2, 100)),
  m('harden',      'Harden',       'PLAIN', 'status',    0,    0, 30, 0, 'Tenses up. Raises own Defence.', stat('self', 'def', 1, 100)),
  m('sharpen',     'Sharpen',      'PLAIN', 'status',    0,    0, 30, 0, 'Hones edges. Raises own Attack.', stat('self', 'atk', 1, 100)),
  m('coilup',      'Coil Up',      'PLAIN', 'status',    0,    0, 20, 0, 'Coils tight. Raises own Attack.', stat('self', 'atk', 1, 100)),
  m('agilityrush', 'Agility Rush', 'PLAIN', 'status',    0,    0, 30, 0, 'Loosens up. Sharply raises Speed.', stat('self', 'spe', 2, 100)),
  m('staticfield', 'Static Field', 'SPARK', 'status',    0,  100, 20, 0, 'A clinging field. Slows the foe.', stat('foe', 'spe', -1, 100)),
  m('mistveil',    'Mist Veil',    'TIDE',  'status',    0,    0, 20, 0, 'Cloaking mist. Raises own evasion.', stat('self', 'eva', 1, 100)),
  m('gloomveil',   'Gloom Veil',   'UMBRA', 'status',    0,  100, 20, 0, 'Dims the air. Lowers foe accuracy.', stat('foe', 'acc', -1, 100)),

  // ---------------- STATUS: ailments ----------------
  m('thunderwave', 'Thunder Wave', 'SPARK', 'status',    0,   90, 20, 0, 'A weak jolt that numbs the foe.', status('par', 100)),
  m('paralyzespore','Paralyze Spore','BLOOM','status',   0,   75, 20, 0, 'Numbing spores that lock muscles.', status('par', 100)),
  m('willowisp',   'Will-o-Wisp',  'EMBER', 'status',    0,   85, 15, 0, 'A drifting flame that burns the foe.', status('brn', 100)),
  m('poisonpowder','Poison Powder','TOXIN', 'status',    0,   75, 25, 0, 'A cloud of powder that poisons.', status('psn', 100)),
  m('sleeppowder', 'Sleep Powder', 'BLOOM', 'status',    0,   75, 15, 0, 'Drowsy powder that lulls the foe.', status('slp', 100)),
  m('icyglare',    'Icy Glare',    'FROST', 'status',    0,   90, 10, 0, 'A cold stare that freezes the foe.', status('frz', 100)),
  m('confuseray',  'Confuse Ray',  'PSION', 'status',    0,  100, 10, 0, 'A wobbling light that confuses.', confuse(100)),

  // ---------------- STATUS: recovery ----------------
  m('recover',     'Recover',      'PLAIN', 'status',    0,    0, 10, 0, 'Rests up and restores half of HP.', heal(0.5)),
  m('synthesize',  'Synthesize',   'BLOOM', 'status',    0,    0, 10, 0, 'Drinks light to restore half of HP.', heal(0.5)),
  m('roost',       'Roost',        'GALE',  'status',    0,    0, 10, 0, 'Settles down to restore half of HP.', heal(0.5)),
];

/** @type {Object<string, MoveRecord>} */
export const MOVES = Object.create(null);
for (const mv of LIST) MOVES[mv.id] = mv;

// Documented placeholder returned for unknown ids so a corrupt save cannot crash battle.js.
const FALLBACK = Object.freeze(
  m('struggleon', 'Struggle On', 'PLAIN', 'physical', 30, 100, 1, 0, 'A desperate, unpracticed flail.')
);

/**
 * Look up a move. Never returns undefined.
 * @param {string} id
 * @returns {MoveRecord}
 */
export function getMove(id) {
  if (typeof id !== 'string') return FALLBACK;
  const mv = MOVES[id];
  return mv || FALLBACK;
}

/** @returns {MoveRecord[]} every move, in table order. */
export function allMoves() {
  return LIST.slice();
}

export const MOVE_COUNT = LIST.length;
