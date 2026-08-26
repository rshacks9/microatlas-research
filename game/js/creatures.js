// creatures.js — the 34-species Verdant Frontier roster.
// Pure data + lookups. No DOM, no side effects: safe to import in Node.
// Frozen against docs/ROSTER.md (dexNo / id / name / types / evolution / biomes / rarity).

/**
 * @typedef {Object} SpeciesRecord
 * @property {string} id
 * @property {number} dexNo
 * @property {string} name
 * @property {string[]} types
 * @property {{hp:number,atk:number,def:number,spa:number,spd:number,spe:number}} base
 * @property {number} catchRate
 * @property {number} expYield
 * @property {'fast'|'medium'|'slow'} growth
 * @property {Array<[number,string]>} learnset
 * @property {null|{level:number,into:string}} evolve
 * @property {string[]} biomes
 * @property {string} rarity
 * @property {number} height
 * @property {number} weight
 * @property {string} entry
 * @property {string} sprite
 */

/** @type {Object.<string, SpeciesRecord>} */
export const SPECIES = {

  // ---- Starters -----------------------------------------------------------
  sproutle: {
    id: 'sproutle', dexNo: 1, name: 'Sproutle', types: ['BLOOM'],
    base: { hp: 50, atk: 52, def: 55, spa: 62, spd: 60, spe: 44 },
    catchRate: 45, expYield: 81, growth: 'slow',
    learnset: [
      [1, 'tackle'], [1, 'leafcut'], [5, 'growl'], [9, 'vinelash'], [13, 'synthesize'],
      [17, 'seedvolley'], [22, 'sleeppowder'], [27, 'bloomburst'], [33, 'bodyslam'], [39, 'harden'],
    ],
    evolve: { level: 16, into: 'thornmane' },
    biomes: [], rarity: 'starter', height: 0.6, weight: 7.2,
    entry: 'A bashful seedling that turns the broad leaf on its head toward the sun all day long.',
    sprite: 'sproutle',
  },

  thornmane: {
    id: 'thornmane', dexNo: 2, name: 'Thornmane', types: ['BLOOM', 'BRAWL'],
    base: { hp: 80, atk: 100, def: 82, spa: 78, spd: 75, spe: 63 },
    catchRate: 45, expYield: 120, growth: 'slow',
    learnset: [
      [1, 'tackle'], [1, 'leafcut'], [5, 'growl'], [9, 'vinelash'], [13, 'synthesize'],
      [17, 'seedvolley'], [22, 'sleeppowder'], [28, 'bloomburst'], [34, 'focusstrike'],
      [40, 'crushblow'], [46, 'coilup'], [52, 'lastditch'],
    ],
    evolve: null,
    biomes: [], rarity: 'starter', height: 1.4, weight: 62.0,
    entry: 'The woody vines of its mane stiffen into thorns the instant it braces for a charge.',
    sprite: 'thornmane',
  },

  cindercub: {
    id: 'cindercub', dexNo: 3, name: 'Cindercub', types: ['EMBER'],
    base: { hp: 48, atk: 62, def: 45, spa: 65, spd: 50, spe: 58 },
    catchRate: 45, expYield: 82, growth: 'slow',
    learnset: [
      [1, 'scratch'], [1, 'emberspit'], [5, 'growl'], [9, 'flamefang'], [14, 'quickjab'],
      [19, 'willowisp'], [25, 'cinderburst'], [31, 'agilityrush'], [38, 'magmalash'], [45, 'crushblow'],
    ],
    evolve: { level: 16, into: 'pyrelynx' },
    biomes: [], rarity: 'starter', height: 0.5, weight: 8.4,
    entry: 'Sparks drift from the tuft on its tail whenever the little cub gets excited.',
    sprite: 'cindercub',
  },

  pyrelynx: {
    id: 'pyrelynx', dexNo: 4, name: 'Pyrelynx', types: ['EMBER'],
    base: { hp: 72, atk: 88, def: 62, spa: 100, spd: 72, spe: 84 },
    catchRate: 45, expYield: 120, growth: 'slow',
    learnset: [
      [1, 'scratch'], [1, 'emberspit'], [5, 'growl'], [9, 'flamefang'], [14, 'quickjab'],
      [20, 'willowisp'], [26, 'cinderburst'], [33, 'agilityrush'], [40, 'magmalash'], [47, 'crushblow'],
    ],
    evolve: null,
    biomes: [], rarity: 'starter', height: 1.2, weight: 41.5,
    entry: 'It stalks ridgelines at dusk, the ruff at its neck flaring into open flame when challenged.',
    sprite: 'pyrelynx',
  },

  driblet: {
    id: 'driblet', dexNo: 5, name: 'Driblet', types: ['TIDE'],
    base: { hp: 52, atk: 48, def: 52, spa: 66, spd: 62, spe: 48 },
    catchRate: 45, expYield: 82, growth: 'slow',
    learnset: [
      [1, 'tackle'], [1, 'waterjet'], [5, 'tailwhip'], [9, 'aquafang'], [14, 'mistveil'],
      [20, 'headbutt'], [26, 'tidalcrash'], [33, 'bodyslam'],
    ],
    evolve: { level: 16, into: 'tidalquill' },
    biomes: [], rarity: 'starter', height: 0.4, weight: 6.6,
    entry: 'A droplet-shaped swimmer that hums a low note to keep its wobbling body in one piece.',
    sprite: 'driblet',
  },

  tidalquill: {
    id: 'tidalquill', dexNo: 6, name: 'Tidalquill', types: ['TIDE', 'GALE'],
    base: { hp: 74, atk: 80, def: 70, spa: 96, spd: 80, spe: 78 },
    catchRate: 45, expYield: 120, growth: 'slow',
    learnset: [
      [1, 'tackle'], [1, 'waterjet'], [5, 'tailwhip'], [9, 'aquafang'], [14, 'mistveil'],
      [19, 'gustcut'], [24, 'headbutt'], [30, 'tidalcrash'], [36, 'wingslash'], [42, 'roost'],
      [48, 'divebomb'], [55, 'galeforce'],
    ],
    evolve: null,
    biomes: [], rarity: 'starter', height: 1.5, weight: 33.0,
    entry: 'It skims the surf on feathered fins and breaks the water only to snatch a meal.',
    sprite: 'tidalquill',
  },

  // ---- Route commons and their lines --------------------------------------
  mottlemouse: {
    id: 'mottlemouse', dexNo: 7, name: 'Mottlemouse', types: ['PLAIN'],
    base: { hp: 48, atk: 56, def: 44, spa: 38, spd: 42, spe: 68 },
    catchRate: 220, expYield: 74, growth: 'fast',
    learnset: [
      [1, 'tackle'], [1, 'growl'], [5, 'quickjab'], [9, 'tailwhip'], [13, 'headbutt'],
      [18, 'agilityrush'], [23, 'bodyslam'], [29, 'screech'], [35, 'crushblow'],
    ],
    evolve: { level: 18, into: 'burrowarden' },
    biomes: ['MEADOW', 'FOREST'], rarity: 'common', height: 0.3, weight: 3.4,
    entry: 'Its speckled coat blends into leaf litter so well that hikers step right over it.',
    sprite: 'mottlemouse',
  },

  burrowarden: {
    id: 'burrowarden', dexNo: 8, name: 'Burrowarden', types: ['PLAIN', 'TERRA'],
    base: { hp: 88, atk: 98, def: 96, spa: 48, spd: 66, spe: 60 },
    catchRate: 110, expYield: 114, growth: 'medium',
    learnset: [
      [1, 'tackle'], [1, 'growl'], [5, 'quickjab'], [9, 'tailwhip'], [13, 'headbutt'],
      [18, 'stonethrow'], [24, 'agilityrush'], [30, 'bodyslam'], [36, 'quakestomp'],
      [42, 'harden'], [48, 'sandblast'], [54, 'boulderdrop'],
    ],
    evolve: null,
    biomes: ['MEADOW', 'SAVANNA'], rarity: 'uncommon', height: 1.1, weight: 58.0,
    entry: 'It keeps a sprawling tunnel network under the grassland and guards every entrance.',
    sprite: 'burrowarden',
  },

  flitterwing: {
    id: 'flitterwing', dexNo: 9, name: 'Flitterwing', types: ['GALE'],
    base: { hp: 42, atk: 46, def: 40, spa: 52, spd: 48, spe: 74 },
    catchRate: 235, expYield: 76, growth: 'fast',
    learnset: [
      [1, 'gustcut'], [1, 'tackle'], [5, 'growl'], [9, 'quickjab'], [13, 'wingslash'],
      [17, 'roost'], [22, 'agilityrush'], [27, 'divebomb'], [33, 'screech'], [39, 'galeforce'],
    ],
    evolve: { level: 18, into: 'galeplume' },
    biomes: ['MEADOW', 'FOREST', 'BEACH'], rarity: 'common', height: 0.3, weight: 1.9,
    entry: 'Its morning song carries for kilometres across still meadow air.',
    sprite: 'flitterwing',
  },

  galeplume: {
    id: 'galeplume', dexNo: 10, name: 'Galeplume', types: ['GALE'],
    base: { hp: 70, atk: 92, def: 66, spa: 74, spd: 68, spe: 108 },
    catchRate: 100, expYield: 120, growth: 'medium',
    learnset: [
      [1, 'gustcut'], [1, 'tackle'], [5, 'growl'], [9, 'wingslash'], [14, 'quickjab'],
      [20, 'roost'], [26, 'agilityrush'], [33, 'divebomb'], [40, 'screech'], [47, 'galeforce'],
    ],
    evolve: null,
    biomes: ['MOUNTAIN', 'PEAK'], rarity: 'uncommon', height: 1.3, weight: 26.5,
    entry: 'It rides the ridgeline thermals for hours without a single beat of its wings.',
    sprite: 'galeplume',
  },

  pebblit: {
    id: 'pebblit', dexNo: 11, name: 'Pebblit', types: ['TERRA'],
    base: { hp: 52, atk: 60, def: 82, spa: 32, spd: 44, spe: 30 },
    catchRate: 230, expYield: 75, growth: 'fast',
    learnset: [
      [1, 'tackle'], [1, 'stonethrow'], [5, 'harden'], [10, 'headbutt'], [15, 'sandblast'],
      [21, 'screech'], [28, 'quakestomp'], [35, 'boulderdrop'],
    ],
    evolve: { level: 22, into: 'boulderkin' },
    biomes: ['MOUNTAIN', 'DESERT'], rarity: 'common', height: 0.4, weight: 22.0,
    entry: 'It dozes half-buried on scree slopes and is easily mistaken for an ordinary stone.',
    sprite: 'pebblit',
  },

  boulderkin: {
    id: 'boulderkin', dexNo: 12, name: 'Boulderkin', types: ['TERRA', 'ALLOY'],
    base: { hp: 82, atk: 104, def: 128, spa: 40, spd: 70, spe: 38 },
    catchRate: 90, expYield: 116, growth: 'medium',
    learnset: [
      [1, 'tackle'], [1, 'stonethrow'], [5, 'harden'], [10, 'headbutt'], [15, 'sandblast'],
      [21, 'metalclaw'], [27, 'screech'], [33, 'quakestomp'], [39, 'ironbash'],
      [45, 'boulderdrop'], [51, 'platingslam'], [57, 'bodyslam'],
    ],
    evolve: null,
    biomes: ['MOUNTAIN', 'PEAK'], rarity: 'uncommon', height: 1.6, weight: 210.0,
    entry: 'Ore veins thread its stone body, and it rings faintly when struck on the shoulder.',
    sprite: 'boulderkin',
  },

  zapkit: {
    id: 'zapkit', dexNo: 13, name: 'Zapkit', types: ['SPARK'],
    base: { hp: 44, atk: 50, def: 42, spa: 64, spd: 48, spe: 72 },
    catchRate: 210, expYield: 80, growth: 'fast',
    learnset: [
      [1, 'sparkbite'], [1, 'tackle'], [5, 'tailwhip'], [9, 'thunderwave'], [13, 'quickjab'],
      [18, 'staticfield'], [23, 'voltlash'], [29, 'agilityrush'], [35, 'headbutt'], [41, 'thunderclap'],
    ],
    evolve: { level: 20, into: 'voltlope' },
    biomes: ['MEADOW', 'SAVANNA'], rarity: 'common', height: 0.4, weight: 6.1,
    entry: 'The forked tail of this kit crackles louder the more nervous it becomes.',
    sprite: 'zapkit',
  },

  voltlope: {
    id: 'voltlope', dexNo: 14, name: 'Voltlope', types: ['SPARK'],
    base: { hp: 72, atk: 74, def: 62, spa: 100, spd: 72, spe: 96 },
    catchRate: 95, expYield: 119, growth: 'medium',
    learnset: [
      [1, 'sparkbite'], [1, 'tackle'], [5, 'tailwhip'], [9, 'thunderwave'], [14, 'quickjab'],
      [20, 'staticfield'], [26, 'voltlash'], [33, 'agilityrush'], [40, 'thunderclap'], [47, 'bodyslam'],
    ],
    evolve: null,
    biomes: ['SAVANNA'], rarity: 'uncommon', height: 1.5, weight: 48.0,
    entry: 'Arcs leap between its antlers as it bounds across open savanna at full stride.',
    sprite: 'voltlope',
  },

  glimmoth: {
    id: 'glimmoth', dexNo: 15, name: 'Glimmoth', types: ['BLOOM', 'GALE'],
    base: { hp: 46, atk: 38, def: 44, spa: 70, spd: 58, spe: 62 },
    catchRate: 200, expYield: 80, growth: 'fast',
    learnset: [
      [1, 'gustcut'], [1, 'tackle'], [4, 'leafcut'], [8, 'sleeppowder'], [12, 'wingslash'],
      [16, 'seedvolley'], [21, 'paralyzespore'], [26, 'synthesize'], [32, 'bloomburst'],
      [38, 'roost'], [44, 'galeforce'],
    ],
    evolve: null,
    biomes: ['FOREST', 'JUNGLE'], rarity: 'common', height: 0.5, weight: 2.8,
    entry: 'Luminous spots on its wings pulse in slow patterns that other moths seem to read.',
    sprite: 'glimmoth',
  },

  mudpuff: {
    id: 'mudpuff', dexNo: 16, name: 'Mudpuff', types: ['TIDE', 'TERRA'],
    base: { hp: 60, atk: 54, def: 64, spa: 48, spd: 52, spe: 36 },
    catchRate: 215, expYield: 79, growth: 'fast',
    learnset: [
      [1, 'tackle'], [1, 'waterjet'], [5, 'harden'], [9, 'stonethrow'], [13, 'aquafang'],
      [18, 'sandblast'], [24, 'mistveil'], [30, 'quakestomp'], [36, 'tidalcrash'], [42, 'boulderdrop'],
    ],
    evolve: null,
    biomes: ['SWAMP', 'BEACH'], rarity: 'common', height: 0.4, weight: 12.5,
    entry: 'It packs wet silt into its own body until it is round enough to roll along the tideline.',
    sprite: 'mudpuff',
  },

  sporecap: {
    id: 'sporecap', dexNo: 17, name: 'Sporecap', types: ['BLOOM', 'TOXIN'],
    base: { hp: 56, atk: 50, def: 56, spa: 62, spd: 60, spe: 38 },
    catchRate: 195, expYield: 81, growth: 'fast',
    learnset: [
      [1, 'tackle'], [1, 'leafcut'], [5, 'poisonpowder'], [9, 'toxinspray'], [13, 'sleeppowder'],
      [17, 'vinelash'], [22, 'paralyzespore'], [27, 'seedvolley'], [33, 'sludgewave'],
      [39, 'synthesize'], [45, 'bloomburst'],
    ],
    evolve: { level: 24, into: 'myconaut' },
    biomes: ['SWAMP', 'JUNGLE'], rarity: 'common', height: 0.4, weight: 9.0,
    entry: 'The pale spots on its cap puff out a drowsy dust whenever something brushes past.',
    sprite: 'sporecap',
  },

  myconaut: {
    id: 'myconaut', dexNo: 18, name: 'Myconaut', types: ['BLOOM', 'TOXIN'],
    base: { hp: 88, atk: 70, def: 80, spa: 100, spd: 92, spe: 44 },
    catchRate: 90, expYield: 119, growth: 'medium',
    learnset: [
      [1, 'tackle'], [1, 'leafcut'], [5, 'poisonpowder'], [9, 'toxinspray'], [13, 'sleeppowder'],
      [17, 'vinelash'], [23, 'paralyzespore'], [29, 'seedvolley'], [35, 'sludgewave'],
      [41, 'synthesize'], [48, 'bloomburst'], [55, 'venomfang'],
    ],
    evolve: null,
    biomes: ['SWAMP'], rarity: 'uncommon', height: 1.3, weight: 34.0,
    entry: 'Its glowing gill ring lights the swamp floor and guides smaller creatures past the deep water.',
    sprite: 'myconaut',
  },

  emberbat: {
    id: 'emberbat', dexNo: 19, name: 'Emberbat', types: ['EMBER', 'GALE'],
    base: { hp: 66, atk: 82, def: 58, spa: 88, spd: 62, spe: 104 },
    catchRate: 120, expYield: 115, growth: 'medium',
    learnset: [
      [1, 'gustcut'], [1, 'emberspit'], [5, 'quickjab'], [9, 'wingslash'], [14, 'flamefang'],
      [19, 'willowisp'], [25, 'divebomb'], [31, 'cinderburst'], [37, 'roost'],
      [44, 'galeforce'], [51, 'magmalash'],
    ],
    evolve: null,
    biomes: ['MOUNTAIN', 'DESERT'], rarity: 'uncommon', height: 0.8, weight: 11.0,
    entry: 'Its wing membranes glow like banked coals, lighting the cave walls it wheels between.',
    sprite: 'emberbat',
  },

  frostkit: {
    id: 'frostkit', dexNo: 20, name: 'Frostkit', types: ['FROST'],
    base: { hp: 48, atk: 52, def: 46, spa: 66, spd: 52, spe: 58 },
    catchRate: 205, expYield: 81, growth: 'fast',
    learnset: [
      [1, 'tackle'], [1, 'frostbite'], [5, 'growl'], [10, 'icyglare'], [15, 'quickjab'],
      [21, 'icelance'], [28, 'agilityrush'], [35, 'blizzardcall'],
    ],
    evolve: { level: 24, into: 'rimewolf' },
    biomes: ['TUNDRA'], rarity: 'common', height: 0.5, weight: 8.0,
    entry: 'It breathes a thin fog that freezes into glittering dust in the tundra air.',
    sprite: 'frostkit',
  },

  rimewolf: {
    id: 'rimewolf', dexNo: 21, name: 'Rimewolf', types: ['FROST'],
    base: { hp: 76, atk: 94, def: 70, spa: 82, spd: 70, spe: 84 },
    catchRate: 95, expYield: 119, growth: 'medium',
    learnset: [
      [1, 'tackle'], [1, 'frostbite'], [5, 'growl'], [10, 'icyglare'], [16, 'quickjab'],
      [23, 'icelance'], [31, 'crushblow'], [39, 'blizzardcall'],
    ],
    evolve: null,
    biomes: ['TUNDRA', 'PEAK'], rarity: 'uncommon', height: 1.4, weight: 52.0,
    entry: 'Frost crystals grow along its spine and chime softly when the whole pack runs together.',
    sprite: 'rimewolf',
  },

  dunewyrm: {
    id: 'dunewyrm', dexNo: 22, name: 'Dunewyrm', types: ['TERRA'],
    base: { hp: 54, atk: 66, def: 58, spa: 36, spd: 42, spe: 64 },
    catchRate: 200, expYield: 80, growth: 'fast',
    learnset: [
      [1, 'tackle'], [1, 'sandblast'], [5, 'harden'], [10, 'stonethrow'], [16, 'headbutt'],
      [22, 'quakestomp'], [29, 'coilup'], [36, 'boulderdrop'],
    ],
    evolve: { level: 26, into: 'sandcoil' },
    biomes: ['DESERT'], rarity: 'common', height: 1.0, weight: 18.0,
    entry: 'It swims through loose dune sand and surfaces only to taste the cooling evening air.',
    sprite: 'dunewyrm',
  },

  sandcoil: {
    id: 'sandcoil', dexNo: 23, name: 'Sandcoil', types: ['TERRA', 'TOXIN'],
    base: { hp: 80, atk: 106, def: 78, spa: 60, spd: 74, spe: 80 },
    catchRate: 90, expYield: 120, growth: 'medium',
    learnset: [
      [1, 'tackle'], [1, 'sandblast'], [5, 'harden'], [10, 'stonethrow'], [15, 'venomfang'],
      [21, 'headbutt'], [27, 'quakestomp'], [33, 'toxinspray'], [39, 'coilup'],
      [45, 'boulderdrop'], [51, 'sludgewave'], [57, 'crushblow'],
    ],
    evolve: null,
    biomes: ['DESERT'], rarity: 'uncommon', height: 3.2, weight: 74.0,
    entry: 'Violet bands along its coils warn of the venom stored behind a pair of curved fangs.',
    sprite: 'sandcoil',
  },

  tinplate: {
    id: 'tinplate', dexNo: 24, name: 'Tinplate', types: ['ALLOY'],
    base: { hp: 70, atk: 78, def: 112, spa: 52, spd: 88, spe: 40 },
    catchRate: 130, expYield: 110, growth: 'medium',
    learnset: [
      [1, 'tackle'], [1, 'metalclaw'], [5, 'harden'], [10, 'headbutt'], [15, 'ironbash'],
      [21, 'screech'], [28, 'platingslam'], [35, 'bodyslam'], [42, 'sharpen'],
    ],
    evolve: { level: 28, into: 'ironclad' },
    biomes: ['MOUNTAIN'], rarity: 'uncommon', height: 0.5, weight: 40.0,
    entry: 'Layered plates overlap across its shell, and every one of them rings a different note.',
    sprite: 'tinplate',
  },

  ironclad: {
    id: 'ironclad', dexNo: 25, name: 'Ironclad', types: ['ALLOY', 'BRAWL'],
    base: { hp: 88, atk: 126, def: 120, spa: 44, spd: 86, spe: 46 },
    catchRate: 50, expYield: 128, growth: 'medium',
    learnset: [
      [1, 'tackle'], [1, 'metalclaw'], [5, 'harden'], [10, 'headbutt'], [15, 'ironbash'],
      [21, 'screech'], [28, 'platingslam'], [34, 'ironfist'], [40, 'bodyslam'],
      [46, 'focusstrike'], [52, 'crushblow'], [58, 'sharpen'],
    ],
    evolve: null,
    biomes: ['PEAK'], rarity: 'rare', height: 2.0, weight: 320.0,
    entry: 'Riveted armour muffles its steps until it decides otherwise, and then the ground shakes.',
    sprite: 'ironclad',
  },

  bogwisp: {
    id: 'bogwisp', dexNo: 26, name: 'Bogwisp', types: ['TOXIN', 'PSION'],
    base: { hp: 64, atk: 44, def: 60, spa: 106, spd: 96, spe: 74 },
    catchRate: 115, expYield: 111, growth: 'medium',
    learnset: [
      [1, 'toxinspray'], [1, 'mindjab'], [5, 'confuseray'], [9, 'poisonpowder'], [14, 'psywave'],
      [19, 'gloomveil'], [25, 'sludgewave'], [31, 'mirrorgaze'], [37, 'venomfang'],
      [44, 'dreameater'], [51, 'scaryface'],
    ],
    evolve: null,
    biomes: ['SWAMP'], rarity: 'uncommon', height: 0.9, weight: 3.0,
    entry: 'Marsh gas gathers around its violet core, which brightens the moment it senses a thought.',
    sprite: 'bogwisp',
  },

  cragfang: {
    id: 'cragfang', dexNo: 27, name: 'Cragfang', types: ['TERRA', 'UMBRA'],
    base: { hp: 74, atk: 104, def: 88, spa: 56, spd: 66, spe: 82 },
    catchRate: 105, expYield: 118, growth: 'medium',
    learnset: [
      [1, 'scratch'], [1, 'stonethrow'], [5, 'scaryface'], [9, 'shadowclaw'], [14, 'sandblast'],
      [20, 'nightbite'], [26, 'quakestomp'], [32, 'dreadhowl'], [38, 'crushblow'],
      [45, 'boulderdrop'], [52, 'gloomveil'],
    ],
    evolve: null,
    biomes: ['MOUNTAIN', 'PEAK'], rarity: 'uncommon', height: 1.2, weight: 96.0,
    entry: 'Climbers know it only by the two red lights that drift along the cliff face after dark.',
    sprite: 'cragfang',
  },

  lumibud: {
    id: 'lumibud', dexNo: 28, name: 'Lumibud', types: ['BLOOM', 'PSION'],
    base: { hp: 70, atk: 48, def: 66, spa: 104, spd: 98, spe: 56 },
    catchRate: 120, expYield: 111, growth: 'medium',
    learnset: [
      [1, 'leafcut'], [1, 'mindjab'], [5, 'synthesize'], [9, 'confuseray'], [14, 'psywave'],
      [19, 'seedvolley'], [25, 'sleeppowder'], [31, 'mirrorgaze'], [37, 'bloomburst'],
      [44, 'dreameater'], [51, 'vinelash'],
    ],
    evolve: null,
    biomes: ['JUNGLE', 'FOREST'], rarity: 'uncommon', height: 0.6, weight: 7.5,
    entry: 'The pink pistil at its centre opens like an eye and follows anything that moves.',
    sprite: 'lumibud',
  },

  thunderjaw: {
    id: 'thunderjaw', dexNo: 29, name: 'Thunderjaw', types: ['SPARK', 'BRAWL'],
    base: { hp: 92, atk: 124, def: 84, spa: 62, spd: 74, spe: 72 },
    catchRate: 50, expYield: 127, growth: 'medium',
    learnset: [
      [1, 'scratch'], [1, 'sparkbite'], [5, 'growl'], [9, 'quickjab'], [14, 'thunderwave'],
      [20, 'ironfist'], [26, 'voltlash'], [32, 'staticfield'], [39, 'focusstrike'],
      [46, 'thunderclap'], [53, 'crushblow'],
    ],
    evolve: null,
    biomes: ['SAVANNA', 'MOUNTAIN'], rarity: 'rare', height: 1.9, weight: 128.0,
    entry: 'Its jaws close with a crack of static that carries clear across the open plain.',
    sprite: 'thunderjaw',
  },

  shadewisp: {
    id: 'shadewisp', dexNo: 30, name: 'Shadewisp', types: ['UMBRA'],
    base: { hp: 46, atk: 44, def: 44, spa: 70, spd: 58, spe: 64 },
    catchRate: 190, expYield: 82, growth: 'fast',
    learnset: [
      [1, 'tackle'], [1, 'shadowclaw'], [5, 'gloomveil'], [10, 'scaryface'], [15, 'nightbite'],
      [21, 'confuseray'], [28, 'dreadhowl'], [35, 'bodyslam'],
    ],
    evolve: { level: 26, into: 'nightveil' },
    biomes: ['FOREST', 'SWAMP'], rarity: 'common', height: 0.6, weight: 2.2,
    entry: 'It slips between tree shadows and leaves behind only a chill and two hollow gleams.',
    sprite: 'shadewisp',
  },

  nightveil: {
    id: 'nightveil', dexNo: 31, name: 'Nightveil', types: ['UMBRA', 'PSION'],
    base: { hp: 74, atk: 66, def: 72, spa: 108, spd: 92, spe: 66 },
    catchRate: 90, expYield: 120, growth: 'medium',
    learnset: [
      [1, 'tackle'], [1, 'shadowclaw'], [5, 'gloomveil'], [10, 'scaryface'], [15, 'nightbite'],
      [21, 'confuseray'], [27, 'mindjab'], [33, 'dreadhowl'], [39, 'psywave'],
      [45, 'mirrorgaze'], [52, 'dreameater'], [58, 'bodyslam'],
    ],
    evolve: null,
    biomes: ['FOREST'], rarity: 'uncommon', height: 1.6, weight: 24.0,
    entry: 'Motes like far-off stars drift inside its veil, and watching too long makes you lose the hour.',
    sprite: 'nightveil',
  },

  // ---- Legendaries --------------------------------------------------------
  aurorix: {
    id: 'aurorix', dexNo: 32, name: 'Aurorix', types: ['FROST', 'PSION'],
    base: { hp: 100, atk: 80, def: 96, spa: 132, spd: 120, spe: 62 },
    catchRate: 5, expYield: 148, growth: 'slow',
    learnset: [
      [1, 'frostbite'], [1, 'mindjab'], [6, 'icyglare'], [12, 'confuseray'], [18, 'icelance'],
      [24, 'psywave'], [30, 'mistveil'], [36, 'mirrorgaze'], [43, 'blizzardcall'],
      [50, 'dreameater'], [57, 'recover'], [64, 'agilityrush'],
    ],
    evolve: null,
    biomes: ['PEAK'], rarity: 'legendary', height: 2.2, weight: 148.0,
    entry: 'Ribbons of light bend around its antlers, and the whole peak sky changes colour as it walks.',
    sprite: 'aurorix',
  },

  magmaroth: {
    id: 'magmaroth', dexNo: 33, name: 'Magmaroth', types: ['EMBER', 'TERRA'],
    base: { hp: 120, atk: 134, def: 112, spa: 96, spd: 84, spe: 44 },
    catchRate: 4, expYield: 148, growth: 'slow',
    learnset: [
      [1, 'headbutt'], [1, 'emberspit'], [6, 'harden'], [12, 'flamefang'], [18, 'stonethrow'],
      [24, 'willowisp'], [30, 'quakestomp'], [36, 'cinderburst'], [43, 'boulderdrop'],
      [50, 'magmalash'], [57, 'crushblow'], [64, 'bodyslam'],
    ],
    evolve: null,
    biomes: ['PEAK'], rarity: 'legendary', height: 3.4, weight: 620.0,
    entry: 'Molten seams split its stone hide, and cooled ash trails mark every route it has ever taken.',
    sprite: 'magmaroth',
  },

  verdilith: {
    id: 'verdilith', dexNo: 34, name: 'Verdilith', types: ['BLOOM', 'ALLOY'],
    base: { hp: 110, atk: 104, def: 130, spa: 104, spd: 110, spe: 32 },
    catchRate: 3, expYield: 148, growth: 'slow',
    learnset: [
      [1, 'vinelash'], [1, 'metalclaw'], [6, 'harden'], [12, 'leafcut'], [18, 'ironbash'],
      [24, 'synthesize'], [30, 'seedvolley'], [36, 'platingslam'], [43, 'sleeppowder'],
      [50, 'bloomburst'], [57, 'quakestomp'], [64, 'bodyslam'],
    ],
    evolve: null,
    biomes: ['JUNGLE'], rarity: 'legendary', height: 2.8, weight: 480.0,
    entry: 'A guardian of the deep jungle whose stone limbs are bound by vines that never wither.',
    sprite: 'verdilith',
  },
};

/** Returned by getSpecies() for an unknown id so a corrupt save can never crash battle code. */
export const FALLBACK_SPECIES = Object.freeze({
  id: 'unknown', dexNo: 0, name: '??????', types: ['PLAIN'],
  base: Object.freeze({ hp: 30, atk: 30, def: 30, spa: 30, spd: 30, spe: 30 }),
  catchRate: 255, expYield: 30, growth: 'medium',
  learnset: Object.freeze([[1, 'tackle']]),
  evolve: null, biomes: Object.freeze([]), rarity: 'common',
  height: 1.0, weight: 10.0,
  entry: 'No records of this creature exist.',
  sprite: 'unknown',
});

const _byDex = Object.values(SPECIES).slice().sort((a, b) => a.dexNo - b.dexNo);

export const DEX_COUNT = _byDex.length;

export const STARTERS = ['sproutle', 'cindercub', 'driblet'];

/** @returns {SpeciesRecord} never undefined */
export function getSpecies(id) {
  if (typeof id !== 'string') return FALLBACK_SPECIES;
  return Object.prototype.hasOwnProperty.call(SPECIES, id) ? SPECIES[id] : FALLBACK_SPECIES;
}

/** @returns {SpeciesRecord[]} sorted by dexNo */
export function allSpecies() {
  return _byDex.slice();
}

/** @returns {SpeciesRecord} the species with that dex number, or the fallback */
export function speciesByDex(n) {
  const i = (n | 0) - 1;
  return (i >= 0 && i < _byDex.length) ? _byDex[i] : FALLBACK_SPECIES;
}
