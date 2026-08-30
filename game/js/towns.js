// towns.js — hand-authored settlements stamped onto the generated world, plus
// the interiors you can walk into (recovery centre, supply shop, houses, caves).
//
// No DOM, no Math.random: every decision comes from the rng handed in by the
// caller (stampTown) or from makeRng(seed) (buildInterior), so a given world
// seed always produces the same frontier.
//
// Depends only on tiles.js + rng.js — importing creatures/worldgen/state here
// would close a cycle, so trainer teams reference roster ids as plain strings.

import { T, isSolid, isWater, isGrass, ledgeDir } from './tiles.js';
import { makeRng } from './rng.js';

// ---------------------------------------------------------------------------
// Place names
// ---------------------------------------------------------------------------

export const TOWN_NAMES = [
  'Willowmere',
  'Ashford Hollow',
  'Kestrel Bay',
  'Bramblewick',
  'Hollypeak',
  'Marrowfen',
  'Cinderhearth',
  'Rookswatch',
  'Elderbrook',
  'Thistledown',
  'Quarryhold',
  'Saltmarch',
];

export const CAVE_NAMES = [
  'Gravelmouth Hollow',
  'Whisper Grotto',
  'Emberdeep',
  'The Old Adit',
  'Rimebite Cavern',
  'Rootspire Cave',
  'Sunken Shaft',
  'Marrowstone Deep',
];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const wrapIdx = (i, n) => ((Math.floor(Number(i) || 0) % n) + n) % n;

/**
 * 8-way compass word for the bearing from (fx,fy) to (tx,ty) in tile space
 * (y grows southward). Integer math only — no trig — so the word is identical
 * on every engine. The minor axis is kept only when it is at least ~tan(22.5°)
 * of the major one (5*min >= 2*max), so shallow bearings read as straight.
 */
function compassWord(fx, fy, tx, ty) {
  const dx = tx - fx, dy = ty - fy;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (!ax && !ay) return 'here';
  const diag = ax && ay && 5 * Math.min(ax, ay) >= 2 * Math.max(ax, ay);
  const ns = dy < 0 ? 'north' : 'south';
  const ew = dx < 0 ? 'west' : 'east';
  if (diag) return ns + '-' + ew;
  return ax >= ay ? ew : ns;
}

/** Town footprint, in tiles. Every local coordinate below lives in this box. */
export const FOOT_W = 26, FOOT_H = 22;

/**
 * Tidy a wild tile into something a town square can sit on: no cliffs, no
 * water, and crucially no encounter grass inside the fence.
 */
function tame(id) {
  if (id === T.SNOW || id === T.ICE || id === T.TUNDRA) return T.SNOW;
  if (id === T.SAND || id === T.CACTUS || id === T.PALM) return T.SAND;
  if (id === T.ASH || id === T.LAVA) return T.ASH;
  if (id === T.VOID) return T.GRASS;
  if (isSolid(id) || isWater(id) || isGrass(id) || ledgeDir(id)) return T.GRASS;
  return id;
}

function mapIndex(map, x, y) { return y * map.w + x; }
function inBounds(map, x, y) { return x >= 0 && y >= 0 && x < map.w && y < map.h; }

function groundAt(map, x, y) {
  return inBounds(map, x, y) ? map.ground[mapIndex(map, x, y)] : T.VOID;
}

function walkableAt(map, x, y) {
  return inBounds(map, x, y) && !isSolid(groundAt(map, x, y));
}

// ---------------------------------------------------------------------------
// Building templates
//
// A building is a solid rectangle: `roofRows` rows of roof on top, then wall
// rows. The first wall row carries the windows, the last carries the door.
// ---------------------------------------------------------------------------

const BUILDINGS = {
  heal:  { w: 6, h: 4, roofRows: 2, roof: T.ROOF_RED },
  shop:  { w: 5, h: 4, roofRows: 2, roof: T.ROOF_BLUE },
  house: { w: 4, h: 3, roofRows: 1, roof: T.ROOF_GREY },
};

// Fixed slots inside the 26x22 footprint. Chosen so no building overlaps a
// road and every door row sits directly above one.
const SLOT_HEAL = { x: 2, y: 4 };
const SLOT_SHOP = { x: 19, y: 4 };
const HOUSE_SLOTS = [
  { x: 15, y: 5 },
  { x: 2, y: 15 },
  { x: 7, y: 15 },
  { x: 15, y: 15 },
  { x: 20, y: 15 },
];

// Road skeleton, in local coordinates.
const ROAD_N = 3;    // back lane
const ROAD_A = 8;    // north high street  (door row for the north buildings)
const ROAD_B = 13;   // south high street
const ROAD_C = 18;   // south lane         (door row for the south houses)
const ROAD_X0 = 12, ROAD_X1 = 13;          // two-lane main street
const PLAZA = { x0: 9, y0: 9, x1: 16, y1: 12 };

// ---------------------------------------------------------------------------
// Plan grid — the town is authored locally, then blitted onto the world map.
// ---------------------------------------------------------------------------

function planSet(plan, lx, ly, id) {
  if (lx < 0 || ly < 0 || lx >= FOOT_W || ly >= FOOT_H) return;
  plan[ly * FOOT_W + lx] = id;
}
function planGet(plan, lx, ly) {
  if (lx < 0 || ly < 0 || lx >= FOOT_W || ly >= FOOT_H) return 0;
  return plan[ly * FOOT_W + lx];
}
function planRect(plan, x0, y0, x1, y1, id) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) planSet(plan, x, y, id);
}

function stampBuilding(plan, bx, by, tpl) {
  const doorX = bx + (tpl.w >> 1);
  const doorY = by + tpl.h - 1;
  for (let y = 0; y < tpl.h; y++) {
    for (let x = 0; x < tpl.w; x++) {
      let id;
      if (y < tpl.roofRows) id = tpl.roof;
      else if (y === tpl.roofRows && tpl.w >= 3 && (x === 1 || x === tpl.w - 2)) id = T.WINDOW;
      else id = T.WALL_HOUSE;
      if (by + y === doorY && bx + x === doorX) id = T.DOOR;
      planSet(plan, bx + x, by + y, id);
    }
  }
  // The step in front of the door is always path, so the player can stand there.
  planSet(plan, doorX, doorY + 1, T.PATH);
  return { doorX, doorY };
}

// ---------------------------------------------------------------------------
// Flavour text
// ---------------------------------------------------------------------------

const VILLAGER_LINES = [
  ['The road east washes out every spring.', 'Mind your footing past the ford.'],
  ['I traded a whole basket of pears for a cracked orb.', 'Worst deal of my life.'],
  ['Careful in the tall grass. Things live in there that do not care for company.'],
  ['My grandmother swore the ridge lights were a creature, not weather.'],
  ['If the shopkeep offers you the dented orb, say no.'],
  ['We keep the fence up for the gardens, not for danger. Mostly.'],
];

const ELDER_LINES = [
  ['I have kept this square swept for forty winters.',
   'The frontier gives you what you are willing to walk for.'],
  ['Every creature out there was somebody\'s neighbour first.', 'Treat them so.'],
  ['They say the deep hollows were carved by something enormous.',
   'They also say I talk too much.'],
];

const KID_LINES = [
  ['I am going to be the best in the whole frontier!', 'As soon as I am allowed past the fence.'],
  ['My brother caught something with SIX legs. He would not show me.'],
  ['Wanna race to the shop? ...No? Okay.'],
];

const TRAVELLER_LINES = [
  ['Three towns in four days. My boots are begging.'],
  ['Recovery centres are free, you know. Do not sleep in a ditch like I did.'],
  ['I sketch every creature I meet. My book is nearly full.'],
];

// ---------------------------------------------------------------------------
// Trainer archetypes
//
// Ordinary town trainers draw an archetype (voice + themed species pool) from
// the town rng instead of a flat roster. Species ids come from docs/ROSTER.md;
// `early` holds base forms a low-tier town would plausibly field, `mid` holds
// the evolved/deeper picks, mirroring the tier split the flat roster used.
// Only prize money and flags stay archetype-independent — those are balance.
// ---------------------------------------------------------------------------

const ARCHETYPES = [
  { title: 'Hedge-Keeper', sprite: 'trainer_scout',
    names: ['Pip', 'Nell', 'Tobin', 'Sorrel'],
    early: ['glimmoth', 'sporecap', 'flitterwing', 'mottlemouse'],
    mid: ['glimmoth', 'lumibud', 'myconaut'],
    challenge: 'I keep every crawly thing the hedges will give me. Meet the collection!',
    defeat: 'Back to the hedges. There is always a rarer one.' },
  { title: 'Ridge Hiker', sprite: 'trainer_hiker',
    names: ['Bram', 'Hetty', 'Cole', 'Ferris'],
    early: ['pebblit', 'mottlemouse', 'dunewyrm'],
    mid: ['tinplate', 'cragfang', 'emberbat', 'boulderkin'],
    challenge: 'Forty switchbacks before breakfast, and my team climbed every one. Your move.',
    defeat: 'Well walked. The summit humbles everybody eventually.' },
  { title: 'Creel Angler', sprite: 'trainer_angler',
    names: ['Wick', 'Marla', 'Dorrit', 'Sten'],
    early: ['mudpuff', 'flitterwing'],
    mid: ['mudpuff', 'bogwisp'],
    challenge: 'Hooked everything worth hooking in this water. You look like fresh bait.',
    defeat: 'Snapped my line clean. I will be telling this one for years.' },
  { title: 'Night Collector', sprite: 'trainer_scout',
    names: ['Vesper', 'Onna', 'Merle', 'Casca'],
    early: ['shadewisp', 'glimmoth', 'zapkit'],
    mid: ['nightveil', 'bogwisp', 'emberbat'],
    challenge: 'Everything interesting comes out after dark. Including, apparently, you.',
    defeat: 'Fine. The night keeps its secrets a little longer.' },
  { title: 'Drove Herder', sprite: 'trainer_hiker',
    names: ['Tam', 'Rosie', 'Gunnar', 'Effie'],
    early: ['mottlemouse', 'zapkit', 'flitterwing'],
    mid: ['voltlope', 'burrowarden'],
    challenge: 'My herd minds me because I earned it. Let us see who yours minds.',
    defeat: 'Soundly driven. Off home with us, then.' },
];

// ---------------------------------------------------------------------------
// The ten Wardens
//
// One fixed identity per town index 0..9 (matching TOWN_NAMES). Each Warden has
// a type specialty; `low`/`high` are specialty-type roster ids ordered weakest
// to strongest so the tier-selected slice always fields the majority of the
// team in-type, with `offLow`/`offHigh` as the single off-type companion on
// teams of three or more. `tell` is the pre-battle line and must stay a honest
// hint of what fighting the specialty feels like. Levels, prize, flag and Seal
// counting are balance and belong to stampTown, not to this table.
// The EMBER Warden fields the cindercub line: starters never spawn wild, but a
// hearth-keeper raising one by hand is exactly what the roster note implies.
// ---------------------------------------------------------------------------

const WARDENS = [
  { name: 'Maren Wyle', type: 'BLOOM', seal: 'Greenward Seal',
    low: ['sporecap', 'glimmoth', 'lumibud'], high: ['glimmoth', 'lumibud', 'myconaut'],
    offLow: 'mottlemouse', offHigh: 'burrowarden',
    tell: 'Fair warning: my grove drains what it touches. Strike fast, or your strength waters my garden.',
    after: 'Maren Wyle keeps her word — the grove will not test you twice.' },
  { name: 'Corvin Vale', type: 'UMBRA', seal: 'Duskveil Seal',
    low: ['shadewisp'], high: ['cragfang', 'nightveil'],
    offLow: 'sporecap', offHigh: 'bogwisp',
    tell: 'Every partner I keep was found in the dark, and they fight like it — half-seen and patient. Keep your nerve.',
    after: 'Corvin Vale owes the dark one more apology. Go on.' },
  { name: 'Odile Tern', type: 'GALE', seal: 'Skysworn Seal',
    low: ['flitterwing', 'glimmoth'], high: ['emberbat', 'galeplume'],
    offLow: 'mudpuff', offHigh: 'mudpuff',
    tell: 'All of mine fight from the wing, and the wind always moves first. Ground them quickly or be worn down.',
    after: 'Odile Tern salutes you. The sky remembers a good match.' },
  { name: 'Hessa Mirk', type: 'TOXIN', seal: 'Thornvenom Seal',
    low: ['sporecap'], high: ['bogwisp', 'sandcoil', 'myconaut'],
    offLow: 'glimmoth', offHigh: 'glimmoth',
    tell: 'I win slowly. Venom does its work between your moves — pack antidotes or pack regrets.',
    after: 'Hessa Mirk suggests you keep carrying antidotes. Habit.' },
  { name: 'Eira Kalder', type: 'FROST', seal: 'Rimelock Seal',
    low: ['frostkit'], high: ['frostkit', 'rimewolf'],
    offLow: 'pebblit', offHigh: 'galeplume',
    tell: 'The cold fights beside me — it slows feet and stiffens joints. End it quickly, or it ends you slowly.',
    after: 'Eira Kalder has nothing colder to offer. Walk warm.' },
  { name: 'Lucen Vey', type: 'PSION', seal: 'Mindglow Seal',
    low: ['bogwisp'], high: ['bogwisp', 'lumibud', 'nightveil'],
    offLow: 'sporecap', offHigh: 'myconaut',
    tell: 'My wisps unpick a battle from the inside; before the end you will doubt your own orders. Trust the first one.',
    after: 'Lucen Vey saw this rematch coming, and declines it kindly.' },
  { name: 'Aldous Brand', type: 'EMBER', seal: 'Hearthflare Seal',
    low: ['cindercub', 'emberbat'], high: ['emberbat', 'pyrelynx'],
    offLow: 'pebblit', offHigh: 'cragfang',
    tell: 'Everything I raise was whelped beside the forge. Burns outlast the blow — bring salves, or bring water.',
    after: 'Aldous Brand banks the fire for you. The hearth is yours.' },
  { name: 'Renna Volk', type: 'SPARK', seal: 'Stormcall Seal',
    low: ['zapkit'], high: ['voltlope', 'thunderjaw'],
    offLow: 'flitterwing', offHigh: 'galeplume',
    tell: 'Static gets into your creature before my strike does. When its legs seize mid-turn, that was me being polite.',
    after: 'Renna Volk unplugs. The storm rests until you need it.' },
  { name: 'Prue Alder', type: 'PLAIN', seal: 'Steadfast Seal',
    low: ['mottlemouse'], high: ['mottlemouse', 'burrowarden'],
    offLow: 'flitterwing', offHigh: 'voltlope',
    tell: 'No venom, no weather, no tricks — just fundamentals drilled until they cannot miss. See if plain beats clever.',
    after: 'Prue Alder has no excuses and wants none. Well fought.' },
  { name: 'Garrick Bault', type: 'TERRA', seal: 'Deeproot Seal',
    low: ['pebblit', 'dunewyrm', 'mudpuff'], high: ['sandcoil', 'cragfang', 'boulderkin'],
    offLow: 'mottlemouse', offHigh: 'tinplate',
    tell: 'My line is patient stone. Chip at it all day and it will still be standing — bring real force or do not knock.',
    after: 'Garrick Bault stands aside. Stone knows when it is beaten.' },
];

// ---------------------------------------------------------------------------
// Biome dressing
//
// Towns keep the biome they were founded in. The plaza floor, the two inner
// lanes, the plaza frame and the verge scatter swap per biome family, and each
// family stamps one signature feature on the plaza. Every swapped ground tile
// is walkable with encounterRate 0 (tame() already bans encounter grass inside
// the fence), and a feature places at most two solid tiles on fixed plaza
// coordinates chosen clear of doors, the noticeboard, NPC spawn tiles and the
// main-street lanes — so dressing can never seal a route or an entity.
// The high streets and the main street stay T.PATH unconditionally: the fence
// ring only leaves gaps where it sees T.PATH on the footprint border.
// ---------------------------------------------------------------------------

// Mirrors worldgen.BIOMES (frozen contract order). Importing worldgen here
// would close a cycle, so like the roster ids these live as plain strings.
const BIOME_IDS = [
  'OCEAN', 'BEACH', 'MEADOW', 'FOREST', 'JUNGLE', 'SWAMP',
  'DESERT', 'SAVANNA', 'TUNDRA', 'MOUNTAIN', 'PEAK',
];

const BIOME_FAMILY = {
  DESERT: 'dry', SAVANNA: 'dry',
  TUNDRA: 'frost', PEAK: 'frost',
  MOUNTAIN: 'stone',
  OCEAN: 'coast', BEACH: 'coast',
  FOREST: 'lush', JUNGLE: 'lush', SWAMP: 'lush',
};

// feature = [west, centre, east] tiles for the three-tile plaza feature.
const TOWN_DRESS = {
  // Meadow keeps the classic packed-path square; its feature is a tended bush
  // in a bloom bed.
  meadow: { plaza: T.PATH, lane: T.PATH, frame: T.FLOWER, scatter: T.FLOWER,
            feature: [T.FLOWER, T.BUSH, T.FLOWER] },
  // Sand plaza and gravel lanes, with a cactus garden.
  dry:    { plaza: T.SAND, lane: T.GRAVEL, frame: T.GRAVEL, scatter: T.GRAVEL,
            feature: [T.SAND, T.CACTUS, T.SAND] },
  // Trodden snow everywhere, and a fountain frozen mid-spray.
  frost:  { plaza: T.SNOW, lane: T.SNOW, frame: T.ICE, scatter: T.ICE,
            feature: [T.ICE, T.CRYSTAL, T.ICE] },
  // Darker stone underfoot, and a standing stone on a gravel apron.
  stone:  { plaza: T.GRAVEL, lane: T.GRAVEL, frame: T.FLOWER, scatter: T.GRAVEL,
            feature: [T.GRAVEL, T.ROCK, T.GRAVEL] },
  // Sand streets and a two-palm cluster.
  coast:  { plaza: T.SAND, lane: T.SAND, frame: T.FLOWER, scatter: T.FLOWER,
            feature: [T.PALM, T.SAND, T.PALM] },
  // Dirt lanes, and an elder stump ringed by mushrooms.
  lush:   { plaza: T.PATH, lane: T.DIRT, frame: T.MUSHROOM, scatter: T.MUSHROOM,
            feature: [T.MUSHROOM, T.STUMP, T.MUSHROOM] },
};

// Feature anchor: plaza row 11 is the only interior row with no NPC spawn, and
// x 9..11 sits west of the main-street lanes (x 12..13) and clear of the
// noticeboard at (8,10). check-entitylock proves the remaining plaza stays
// connected with the feature solids and blocking NPCs both in place.
const FEATURE_LX = 9, FEATURE_LY = 11;

/**
 * Majority biome family over the footprint. Reads only map.biome, so the same
 * seed always dresses the same town the same way; maps without biome data
 * (or all-water samples) fall back to the meadow dressing.
 */
function townDressFor(map, ox, oy) {
  const dress = (fam) => TOWN_DRESS[fam] || TOWN_DRESS.meadow;
  if (!map.biome || map.biome.length < map.w * map.h) return dress('meadow');
  const tally = Object.create(null);
  for (let ly = 1; ly < FOOT_H; ly += 4) {
    for (let lx = 1; lx < FOOT_W; lx += 4) {
      const wx = ox + lx, wy = oy + ly;
      if (!inBounds(map, wx, wy)) continue;
      const fam = BIOME_FAMILY[BIOME_IDS[map.biome[mapIndex(map, wx, wy)]] || ''] || 'meadow';
      tally[fam] = (tally[fam] || 0) + 1;
    }
  }
  let best = 'meadow', bestN = 0;
  for (const fam in tally) {
    if (tally[fam] > bestN) { best = fam; bestN = tally[fam]; }
  }
  return dress(best);
}

// ---------------------------------------------------------------------------
// stampTown
// ---------------------------------------------------------------------------

/**
 * Stamp a hand-authored settlement onto `map` around (cx, cy).
 *
 * Mutates the map's ground/overlay in place and pushes the town's entities and
 * warps onto `map.entities` / `map.warps`, so a caller that just wants a town
 * on the world can ignore the return value entirely.
 *
 * @param {object} map   MapData (needs w, h, ground; overlay/warps/entities optional)
 * @param {number} cx    town centre, tile x
 * @param {number} cy    town centre, tile y
 * @param {object} rng   makeRng() instance — the ONLY source of randomness here
 * @param {number} index town index; picks the name and scales the trainers
 * @returns {{name:string, entities:object[], warps:object[], doors:object[], x:number, y:number}}
 */
// `index` identifies the town (names, flags). `tier` is its DIFFICULTY, derived
// by the caller from distance to the start town — they are not the same thing,
// and conflating them put level-23 trainers in the starting settlement.
export function stampTown(map, cx, cy, rng, index, tier) {
  if (!map || !map.ground || !map.w || !map.h) {
    throw new Error('stampTown: need a MapData with w, h and ground');
  }
  const shared = rng && typeof rng.int === 'function' ? rng : makeRng(((index | 0) * 2654435761) >>> 0);
  // Exactly ONE draw from the world's shared stream, then a private fork for
  // everything this town generates. Town content used to draw a variable
  // number of shared values, so ANY content change (a new archetype, one more
  // team pick) re-rolled every later town and moved every cave mouth for the
  // same seed — silently corrupting saves that regenerate their world from
  // seed. With the fork, stampTown's shared-stream footprint is fixed forever.
  const r = makeRng((shared.int(0x7fffffff) ^ (((index | 0) + 1) * 0x9e3779b9)) >>> 0);
  const idx = Math.max(0, Math.floor(Number(index) || 0));
  const name = TOWN_NAMES[wrapIdx(idx, TOWN_NAMES.length)];

  if (!Array.isArray(map.warps)) map.warps = [];
  if (!Array.isArray(map.entities)) map.entities = [];
  if (!map.overlay || map.overlay.length < map.w * map.h) {
    map.overlay = new Uint16Array(map.w * map.h);
  }

  // Anchor the footprint so it fits the map wherever possible.
  const ox = clamp(Math.round(cx) - (FOOT_W >> 1), 0, Math.max(0, map.w - FOOT_W));
  const oy = clamp(Math.round(cy) - (FOOT_H >> 1), 0, Math.max(0, map.h - FOOT_H));
  const WX = (lx) => ox + lx;
  const WY = (ly) => oy + ly;

  // ---- 1. author the plan ------------------------------------------------
  const plan = new Uint16Array(FOOT_W * FOOT_H);
  const dress = townDressFor(map, ox, oy);

  // Streets. The two high streets and the two-lane main street run clear
  // through the fence, so there is always a way in and a way out — and they
  // stay T.PATH in every biome, because the fence ring below only leaves a gap
  // where it sees T.PATH on the border.
  planRect(plan, 0, ROAD_A, FOOT_W - 1, ROAD_A, T.PATH);
  planRect(plan, 0, ROAD_B, FOOT_W - 1, ROAD_B, T.PATH);
  planRect(plan, ROAD_X0, 0, ROAD_X1, FOOT_H - 1, T.PATH);
  planRect(plan, 2, ROAD_N, FOOT_W - 3, ROAD_N, dress.lane);
  planRect(plan, 2, ROAD_C, FOOT_W - 3, ROAD_C, dress.lane);

  // Plaza, floored in the biome's paving.
  planRect(plan, PLAZA.x0, PLAZA.y0, PLAZA.x1, PLAZA.y1, dress.plaza);

  // The biome's signature feature — three fixed plaza tiles, at most two of
  // them solid (see the anchor comment on FEATURE_LX).
  for (let f = 0; f < 3; f++) planSet(plan, FEATURE_LX + f, FEATURE_LY, dress.feature[f]);

  // Buildings.
  const doors = [];
  const healDoor = stampBuilding(plan, SLOT_HEAL.x, SLOT_HEAL.y, BUILDINGS.heal);
  doors.push({ kind: 'heal', lx: healDoor.doorX, ly: healDoor.doorY, to: 'inside:heal:' + idx });

  const shopDoor = stampBuilding(plan, SLOT_SHOP.x, SLOT_SHOP.y, BUILDINGS.shop);
  doors.push({ kind: 'shop', lx: shopDoor.doorX, ly: shopDoor.doorY, to: 'inside:shop:' + idx });

  const houseCount = r.range(3, 5);
  const picked = r.shuffle(HOUSE_SLOTS).slice(0, houseCount)
    .sort((a, b) => (a.y - b.y) || (a.x - b.x));
  picked.forEach((slot, n) => {
    const d = stampBuilding(plan, slot.x, slot.y, BUILDINGS.house);
    doors.push({ kind: 'house', n, lx: d.doorX, ly: d.doorY, to: 'inside:house:' + idx + ':' + n });
  });

  // Beds framing the plaza, in the biome's frame tile.
  for (const ly of [PLAZA.y0, PLAZA.y0 + 1, PLAZA.y1 - 1, PLAZA.y1]) {
    if (planGet(plan, PLAZA.x0 - 1, ly) === 0) planSet(plan, PLAZA.x0 - 1, ly, dress.frame);
    if (planGet(plan, PLAZA.x1 + 1, ly) === 0) planSet(plan, PLAZA.x1 + 1, ly, dress.frame);
  }
  // Verge scatter — always a walkable, encounter-free tile.
  for (let i = 0; i < 18; i++) {
    const lx = r.range(1, FOOT_W - 2), ly = r.range(1, FOOT_H - 2);
    if (planGet(plan, lx, ly) === 0) planSet(plan, lx, ly, dress.scatter);
  }

  // Town noticeboard, on the west lip of the plaza.
  const signLocal = { x: PLAZA.x0 - 1, y: PLAZA.y0 + 1 };
  planSet(plan, signLocal.x, signLocal.y, T.SIGN);

  // Fence ring, skipping anywhere a road punches through (>= 2 gaps by design:
  // main street north + south, both high streets east + west = 8 gap tiles).
  for (let lx = 0; lx < FOOT_W; lx++) {
    for (const ly of [0, FOOT_H - 1]) if (planGet(plan, lx, ly) !== T.PATH) planSet(plan, lx, ly, T.FENCE);
  }
  for (let ly = 0; ly < FOOT_H; ly++) {
    for (const lx of [0, FOOT_W - 1]) if (planGet(plan, lx, ly) !== T.PATH) planSet(plan, lx, ly, T.FENCE);
  }

  // ---- 2. blit the plan onto the world ------------------------------------
  for (let ly = 0; ly < FOOT_H; ly++) {
    for (let lx = 0; lx < FOOT_W; lx++) {
      const wx = WX(lx), wy = WY(ly);
      if (!inBounds(map, wx, wy)) continue;
      const i = mapIndex(map, wx, wy);
      map.overlay[i] = 0;                       // no wild decoration inside town
      const id = plan[ly * FOOT_W + lx];
      map.ground[i] = id !== 0 ? id : tame(map.ground[i]);
    }
  }

  // ---- 3. entities + warps -------------------------------------------------
  const entities = [];
  const warps = [];
  const outDoors = [];

  /** Nearest walkable tile to (wx,wy); null if the area is hopeless. */
  function settle(wx, wy) {
    if (walkableAt(map, wx, wy)) return { x: wx, y: wy };
    for (let rad = 1; rad <= 3; rad++) {
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
          if (walkableAt(map, wx + dx, wy + dy)) return { x: wx + dx, y: wy + dy };
        }
      }
    }
    return null;
  }

  // Doors -> warps. The door tile itself is walkable, so stepping on it fires.
  for (const d of doors) {
    const wx = WX(d.lx), wy = WY(d.ly);
    if (!inBounds(map, wx, wy)) continue;
    if (groundAt(map, wx, wy) !== T.DOOR) continue;   // clipped by the map edge
    const warp = { x: wx, y: wy, to: d.to, dir: 'up' };
    warps.push(warp);
    outDoors.push({ x: wx, y: wy, to: d.to, kind: d.kind, index: idx, n: d.n });
  }

  // Signpost (sits ON the sign tile — that is what makes it readable).
  // Directions come from the stamped DOOR tiles, not from the slot layout: a
  // door clipped by the map edge must drop off the sign, and the words must
  // stay true if a slot ever moves. outDoors is already filtered to doors that
  // actually survived the blit.
  const signX = WX(signLocal.x), signY = WY(signLocal.y);
  if (inBounds(map, signX, signY) && groundAt(map, signX, signY) === T.SIGN) {
    const services = [];
    const healAt = outDoors.find((d) => d.kind === 'heal');
    if (healAt) services.push('Recovery Centre ' + compassWord(signX, signY, healAt.x, healAt.y) + '.');
    const shopAt = outDoors.find((d) => d.kind === 'shop');
    if (shopAt) services.push('Supplies ' + compassWord(signX, signY, shopAt.x, shopAt.y) + '.');
    const signLines = [name + '. Population: enough.'];
    if (services.length) signLines.push(services.join(' '));
    entities.push({
      kind: 'sign', x: signX, y: signY, dir: 'down',
      sprite: 'sign', name: name,
      lines: signLines,
      blocking: false,
    });
  }

  // Villagers on the plaza.
  const NPC_POOL = [
    { lx: 10, ly: 10, sprite: 'npc_villager', name: 'Villager', wander: true, pool: VILLAGER_LINES },
    { lx: 15, ly: 10, sprite: 'npc_elder', name: 'Elder', wander: false, pool: ELDER_LINES },
    { lx: 11, ly: 12, sprite: 'npc_kid', name: 'Kid', wander: true, pool: KID_LINES },
    { lx: 15, ly: 12, sprite: 'npc_villager', name: 'Traveller', wander: true, pool: TRAVELLER_LINES },
  ];
  const npcCount = r.range(2, 4);
  for (let i = 0; i < npcCount; i++) {
    const spec = NPC_POOL[i];
    const at = settle(WX(spec.lx), WY(spec.ly));
    if (!at) continue;
    entities.push({
      kind: 'npc', x: at.x, y: at.y, dir: i % 2 ? 'down' : 'left',
      sprite: spec.sprite, name: spec.name, wander: spec.wander,
      lines: r.pick(spec.pool).slice(),
    });
  }

  // Trainers loitering on the approach lanes. Both stand in one lane of the
  // two-lane main street, so they can never wall the town off.
  // NB: not named `T` — that is the tile-constant import, and shadowing it with a
  // const in this scope put every earlier T.GRASS reference in the temporal dead
  // zone, so stampTown threw and every town silently lost all of its entities.
  const tierN = (tier === undefined || tier === null) ? idx : (tier | 0);
  const lvl = clamp(3 + tierN * 2, 3, 44);
  const TRAINER_POOL = [
    { lx: ROAD_X1, ly: SLOT_HEAL.y, dir: 'up' },
    { lx: ROAD_X0, ly: ROAD_C - 1, dir: 'down' },
  ];
  const trainerCount = r.range(1, 2);
  for (let i = 0; i < trainerCount; i++) {
    const spot = TRAINER_POOL[i];
    const at = settle(WX(spot.lx), WY(spot.ly));
    if (!at) continue;
    // Archetype + name from the town rng; their pool is tier-filtered the same
    // way the flat roster was, so nothing outlevels its neighbourhood.
    const arch = r.pick(ARCHETYPES);
    const pool = tierN < 3 ? arch.early : arch.mid;
    // Teams of three only appear from tier 3 out — check-firstwalk caps every
    // ambusher within 30 tiles of spawn at level 9, and lvl+2 breaks that cap
    // for the low tiers a spawn-adjacent town can actually have.
    const teamSize = tierN === 0 ? 1 : r.range(1, tierN < 3 ? 2 : 3);
    const team = [];
    for (let k = 0; k < teamSize; k++) {
      team.push({ species: r.pick(pool), level: clamp(lvl + k, 2, 60) });
    }
    entities.push({
      kind: 'trainer', x: at.x, y: at.y, dir: spot.dir,
      sprite: arch.sprite, name: arch.title + ' ' + r.pick(arch.names),
      sight: r.range(3, 4),
      team,
      prize: 80 + tierN * 60 + i * 20,
      challenge: arch.challenge,
      lines: [arch.defeat],
      flag: 'trainer_t' + idx + '_' + i,
    });
  }

  // ---- 3b. the town Warden ------------------------------------------------
  // Each settlement is guarded by one Warden. Beating them awards a Seal, which
  // is the game's only mastery ladder. Because the world is open, Wardens can be
  // challenged in ANY order — the difficulty ordering comes from geography, since
  // a Warden's team scales with how far its town sits from the start. That gives
  // the player a visible goal without gating a single route.
  // Stand the Warden in the plaza, facing the main street.
  const wardenLx = (PLAZA.x0 + PLAZA.x1) >> 1;
  const wardenLy = PLAZA.y0;
  const wardenAt = settle(WX(wardenLx), WY(wardenLy)) || settle(WX(wardenLx), WY(PLAZA.y1));
  if (wardenAt) {
    // Fixed identity per town index; only the LEVELS come from the tier, so a
    // Warden's name, specialty and Seal are the same on every seed. The team
    // slice keeps the specialty in the majority: sizes 2 are all in-type, and
    // the single off-type companion only joins teams of three or four.
    const w = WARDENS[wrapIdx(idx, WARDENS.length)];
    // Wardens climb their own, steeper ladder than town trainers: the flat
    // +3 gave a ~L27 ceiling at tier 9, leaving a 20-level pure-grind gap to
    // the L47-52 Trial Keepers. Tier 9 now reaches ~L39-42, and tier 0 eases
    // to ~L4-5 so the first Seal is a lesson, not a wall.
    const wLvl = clamp(3 + tierN * 4, 4, 62);
    const wPool = tierN >= 4 ? w.high : w.low;
    const wTeam = [];
    const wSize = tierN === 0 ? 2 : Math.min(4, 2 + Math.floor(tierN / 2));
    if (wSize >= 3) {
      wTeam.push({ species: tierN >= 4 ? w.offHigh : w.offLow, level: clamp(wLvl, 3, 64) });
    }
    // Pools are ordered weakest to strongest, so the ace closes the fight.
    for (let k = 0; wTeam.length < wSize; k++) {
      wTeam.push({
        species: wPool[Math.min(k, wPool.length - 1)],
        level: clamp(wLvl + wTeam.length, 3, 64),
      });
    }
    entities.push({
      kind: 'trainer', warden: true,
      x: wardenAt.x, y: wardenAt.y, dir: 'down',
      sprite: 'trainer_scout',
      name: 'Warden ' + w.name,
      seal: w.seal,                   // overworld names the Seal when awarding it
      sight: 0,                       // Wardens never ambush; you choose to fight them
      team: wTeam,
      prize: 400 + tierN * 220,
      challenge: 'I hold the ' + w.seal + ' for ' + name + '. ' + w.tell,
      lines: ['The ' + w.seal + ' is yours, fairly taken.', w.after],
      flag: 'warden_' + idx,
    });
  }

  // ---- 4. hand everything to the map --------------------------------------
  for (const w of warps) map.warps.push(w);
  for (const e of entities) map.entities.push(e);

  return { name, entities, warps, doors: outDoors, x: WX(FOOT_W >> 1), y: WY(FOOT_H >> 1) };
}

// ---------------------------------------------------------------------------
// Interiors
// ---------------------------------------------------------------------------

function blankRoom(w, h, floor, wall) {
  const ground = new Uint16Array(w * h);
  const overlay = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const edge = (x === 0 || y === 0 || x === w - 1 || y === h - 1);
      ground[y * w + x] = edge ? wall : floor;
    }
  }
  return { ground, overlay };
}

function put(data, x, y, id) {
  if (x < 0 || y < 0 || x >= data.w || y >= data.h) return;
  data.ground[y * data.w + x] = id;
}
function get(data, x, y) {
  if (x < 0 || y < 0 || x >= data.w || y >= data.h) return T.VOID;
  return data.ground[y * data.w + x];
}
function fill(data, x0, y0, x1, y1, id) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(data, x, y, id);
}

/**
 * Cut the exit in the bottom wall and register the warp back to the world.
 * `tx`/`ty` are deliberately left off: overworld.js remembers where you came in
 * and drops you back there, and falls back to the start town if it cannot.
 */
function cutExit(data, doorX, tile) {
  const y = data.h - 1;
  put(data, doorX, y, tile === undefined ? T.DOOR : tile);
  data.warps.push({ x: doorX, y, to: 'world', dir: 'down' });
  return { x: doorX, y };
}

// ---- Recovery Centre -------------------------------------------------------

function buildHeal(rng, index) {
  const w = 14, h = 11;
  const { ground, overlay } = blankRoom(w, h, T.FLOOR_TILE, T.WALL_BRICK);
  const data = {
    id: 'inside:heal:' + index, w, h, ground, overlay, biome: null,
    warps: [], entities: [], spawn: { x: 6, y: h - 2 },
    indoor: true, bgm: 'town', name: 'Recovery Centre',
  };

  cutExit(data, 6);
  fill(data, 5, h - 2, 7, h - 2, T.CARPET);          // entry mat

  fill(data, 8, 3, 12, 3, T.COUNTER);                 // reception counter
  fill(data, 1, 1, 3, 1, T.SHELF);                    // record cabinets
  fill(data, 1, 3, 2, 3, T.TABLE);                    // waiting table
  put(data, 11, 1, T.SHELF);
  put(data, 12, 1, T.SHELF);

  data.entities.push({
    kind: 'heal', x: 10, y: 2, dir: 'down',
    sprite: 'npc_villager', name: 'Attendant',
    lines: ['Welcome to the Recovery Centre.'],
  });

  const chat = [
    ['My team is still catching its breath.', 'Take the counter, I am in no rush.'],
    ['They restore everyone for free out here.', 'Frontier rules.'],
    ['I walked in from ' + TOWN_NAMES[wrapIdx(index + 1, TOWN_NAMES.length)] + '.',
     'Do not attempt it at night.'],
  ];
  data.entities.push({
    kind: 'npc', x: 3, y: 6, dir: 'right',
    sprite: 'npc_villager', name: 'Wanderer', wander: false,
    lines: rng.pick(chat).slice(),
  });

  return data;
}

// ---- Supply Shop -----------------------------------------------------------

function buildShop(rng, index) {
  const w = 12, h = 10;
  const { ground, overlay } = blankRoom(w, h, T.FLOOR_WOOD, T.WALL_WOOD);
  const tier = clamp(1 + Math.floor(index / 2), 1, 4);
  const data = {
    id: 'inside:shop:' + index, w, h, ground, overlay, biome: null,
    warps: [], entities: [], spawn: { x: 5, y: h - 2 },
    indoor: true, bgm: 'town', name: 'Supply Shop',
  };

  cutExit(data, 5);
  put(data, 5, h - 2, T.CARPET);

  fill(data, 6, 3, 10, 3, T.COUNTER);                 // sales counter
  fill(data, 1, 1, 4, 1, T.SHELF);                    // stock along the walls
  fill(data, 1, 3, 1, 6, T.SHELF);
  fill(data, 10, 6, 10, 7, T.SHELF);

  data.entities.push({
    kind: 'shop', x: 8, y: 2, dir: 'down',
    sprite: 'npc_villager', name: 'Shopkeeper', tier,
    lines: ['Everything on the shelves is honest stock.'],
  });

  const browsers = [
    ['Orbs first, potions second. That is the order that keeps you walking.'],
    ['I keep buying repellent and forgetting to use it.'],
    ['Tier ' + tier + ' stock here. The coast towns carry more.'],
  ];
  data.entities.push({
    kind: 'npc', x: 3, y: 6, dir: 'up',
    sprite: 'npc_kid', name: 'Browser', wander: false,
    lines: rng.pick(browsers).slice(),
  });

  return data;
}

// ---- House -----------------------------------------------------------------

function buildHouse(rng, index) {
  const w = 10, h = 9;
  const { ground, overlay } = blankRoom(w, h, T.FLOOR_WOOD, T.WALL_WOOD);
  const data = {
    id: 'inside:house:' + index, w, h, ground, overlay, biome: null,
    warps: [], entities: [], spawn: { x: 4, y: h - 2 },
    indoor: true, bgm: 'town', name: 'Home',
  };

  cutExit(data, 4);
  fill(data, 4, h - 2, 5, h - 2, T.CARPET);

  fill(data, 4, 4, 5, 4, T.TABLE);
  fill(data, 1, 1, 2, 1, T.SHELF);
  fill(data, 7, 1, 8, 1, T.SHELF);
  put(data, 8, 4, T.SHELF);

  const HOSTS = [
    { sprite: 'npc_elder', name: 'Grandmother',
      lines: ['Sit, sit. The kettle is always on.', 'You have the look of someone who walks too far in one day.'] },
    { sprite: 'npc_villager', name: 'Woodcutter',
      lines: ['I fell trees on the ridge. Never the old ones.', 'Something nests in those.'] },
    { sprite: 'npc_kid', name: 'Child',
      lines: ['I drew every creature I have seen!', 'Mum says four does not count as every.'] },
    { sprite: 'npc_villager', name: 'Weaver',
      lines: ['Frontier wool, frontier dye, frontier prices.', 'Everything here is frontier something.'] },
  ];
  const host = HOSTS[rng.int(HOSTS.length)];
  data.entities.push({
    kind: 'npc', x: 2, y: 3, dir: 'right',
    sprite: host.sprite, name: host.name, wander: false,
    lines: host.lines.slice(),
  });

  return data;
}

// ---- Cave ------------------------------------------------------------------

const DIRS4 = [[0, -1], [0, 1], [-1, 0], [1, 0]];

// Per-biome cave dressing. Every id here exists in tiles.js; every `floor`,
// `patch` and `enc` tile is walkable, every `wall`/`wallDecor` tile is solid,
// and every `enc` tile has encounterRate > 0 — so swapping palettes can never
// change connectivity or starve a cave of encounters.
const CAVE_THEMES = {
  classic: { wall: T.WALL_CAVE, floor: T.FLOOR_CAVE, patch: T.GRAVEL, enc: T.CAVEMOSS,
             wallDecor: T.CRYSTAL, decorLo: 6, decorHi: 12, floorDecor: 0 },
  // Dry sandstone hollows under the dunes: sand underfoot, cactus in the walls.
  dry:     { wall: T.ROCK, floor: T.SAND, patch: T.GRAVEL, enc: T.DUNEGRASS,
             wallDecor: T.CACTUS, decorLo: 4, decorHi: 8, floorDecor: 0 },
  // Glacial caverns: snow floors, sheet-ice accents, heavy crystal growth.
  ice:     { wall: T.WALL_CAVE, floor: T.SNOW, patch: T.ICE, enc: T.SNOWDRIFT,
             wallDecor: T.CRYSTAL, decorLo: 10, decorHi: 16, floorDecor: 0 },
  // High-country adits: loose scree beds between the gravel.
  stone:   { wall: T.WALL_CAVE, floor: T.FLOOR_CAVE, patch: T.GRAVEL, enc: T.SCREE,
             wallDecor: T.CRYSTAL, decorLo: 8, decorHi: 14, floorDecor: 0 },
  // Damp root-caves under the green biomes: dirt, puddles, mushrooms.
  lush:    { wall: T.WALL_CAVE, floor: T.DIRT, patch: T.PUDDLE, enc: T.CAVEMOSS,
             wallDecor: T.CRYSTAL, decorLo: 4, decorHi: 8, floorDecor: T.MUSHROOM },
};

const CAVE_BIOME_FAMILY = {
  DESERT: 'dry', SAVANNA: 'dry', BEACH: 'dry',
  TUNDRA: 'ice', PEAK: 'ice',
  MOUNTAIN: 'stone',
  FOREST: 'lush', JUNGLE: 'lush', SWAMP: 'lush',
};

function caveThemeFor(hint) {
  const biome = hint && typeof hint.biome === 'string' ? hint.biome.toUpperCase() : '';
  return CAVE_THEMES[CAVE_BIOME_FAMILY[biome]] || CAVE_THEMES.classic;
}

/** Flood fill over non-solid tiles. -> Uint8Array mask of reachable tiles. */
function floodFill(data, sx, sy) {
  const { w, h } = data;
  const seen = new Uint8Array(w * h);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return seen;
  if (isSolid(get(data, sx, sy))) return seen;
  const stack = [sy * w + sx];
  seen[sy * w + sx] = 1;
  while (stack.length) {
    const cur = stack.pop();
    const x = cur % w, y = (cur / w) | 0;
    for (const d of DIRS4) {
      const nx = x + d[0], ny = y + d[1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (seen[ni]) continue;
      if (isSolid(data.ground[ni])) continue;
      seen[ni] = 1;
      stack.push(ni);
    }
  }
  return seen;
}

function buildCave(rng, index, hint) {
  const theme = caveThemeFor(hint);
  const hintLevel = hint && Number.isFinite(Number(hint.level)) ? Number(hint.level) : 0;
  const size = 30 + rng.int(17);                 // 30..46 tiles square
  const { ground, overlay } = blankRoom(size, size, theme.wall, theme.wall);
  for (let i = 0; i < ground.length; i++) ground[i] = theme.wall;

  const data = {
    id: 'cave:' + index, w: size, h: size, ground, overlay, biome: null,
    warps: [], entities: [], spawn: { x: 0, y: 0 },
    indoor: true, bgm: 'cave',
    name: CAVE_NAMES[wrapIdx(index, CAVE_NAMES.length)],
  };

  const ex = size >> 1;
  const entryY = size - 2;
  const floors = [];

  function carve(x, y) {
    if (x < 1 || y < 1 || x > size - 2 || y > size - 2) return;
    const i = y * size + x;
    if (ground[i] === theme.floor) return;
    ground[i] = theme.floor;
    floors.push({ x, y });
  }

  // Drunkard's walk. Every carve is adjacent to the walker's current tile and
  // every restart teleports to an already-carved tile, so the result is
  // connected by construction — the flood fill below is the belt-and-braces.
  let x = ex, y = entryY;
  carve(x, y);
  const target = Math.floor(size * size * 0.30);
  const maxSteps = size * size * 24;
  let steps = 0;
  while (floors.length < target && steps < maxSteps) {
    steps++;
    const d = DIRS4[rng.int(4)];
    const nx = x + d[0], ny = y + d[1];
    if (nx < 1 || ny < 1 || nx > size - 2 || ny > size - 2) {
      const p = floors[rng.int(floors.length)];
      x = p.x; y = p.y;
      continue;
    }
    x = nx; y = ny;
    carve(x, y);
    if (rng.chance(0.10)) {                       // occasional chamber
      for (const d2 of DIRS4) carve(x + d2[0], y + d2[1]);
    }
    if (rng.chance(0.02)) {                       // wander off somewhere else
      const p = floors[rng.int(floors.length)];
      x = p.x; y = p.y;
    }
  }

  // Mouth of the cave: a stair tile punched through the bottom wall.
  ground[(size - 1) * size + ex] = T.STAIRS;
  if (ground[entryY * size + ex] !== theme.floor) carve(ex, entryY);
  data.spawn = { x: ex, y: entryY };
  const exit = { x: ex, y: size - 1 };
  data.warps.push({ x: exit.x, y: exit.y, to: 'world', dir: 'down' });

  // Verify: the exit must be reachable from every carved tile. Re-carve a
  // straight corridor to any pocket that got orphaned, then re-check.
  for (let pass = 0; pass < 4; pass++) {
    const seen = floodFill(data, exit.x, exit.y);
    let orphan = null;
    for (let i = 0; i < ground.length && !orphan; i++) {
      if (seen[i] || isSolid(ground[i])) continue;
      orphan = { x: i % size, y: (i / size) | 0 };
    }
    if (!orphan) break;
    let cx2 = orphan.x, cy2 = orphan.y;
    while (cx2 !== ex) { carve(cx2, cy2); cx2 += cx2 < ex ? 1 : -1; }
    while (cy2 !== entryY) { carve(cx2, cy2); cy2 += cy2 < entryY ? 1 : -1; }
    carve(cx2, cy2);
  }
  // Anything still cut off after four repair passes gets filled back in, so the
  // invariant "every floor tile reaches the exit" holds unconditionally.
  {
    const seen = floodFill(data, exit.x, exit.y);
    for (let i = 0; i < ground.length; i++) {
      if (!seen[i] && !isSolid(ground[i])) ground[i] = theme.wall;
    }
  }

  // ---- heart chamber -------------------------------------------------------
  // BFS from the mouth finds the deepest tile in the cave; a small round
  // chamber is cleared there and dressed as the reward for going all the way:
  // dense encounter ground, twin crystals, and one guaranteed gift.
  // Carving only ever turns wall into floor around an already-reachable tile
  // (the disc is internally connected and contains the BFS tile), so the
  // "every floor reaches the exit" invariant survives untouched.
  const giftRoll = rng.chance(0.35);
  const gift = (hintLevel >= 22 || giftRoll) ? 'ultraorb' : 'revive';
  const dist = new Int32Array(size * size).fill(-1);
  const queue = [data.spawn.y * size + data.spawn.x];
  dist[queue[0]] = 0;
  let heart = { x: data.spawn.x, y: data.spawn.y, d: 0 };
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    const cx = cur % size, cy = (cur / size) | 0;
    for (const d of DIRS4) {
      const nx = cx + d[0], ny = cy + d[1];
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const ni = ny * size + nx;
      if (dist[ni] >= 0 || isSolid(ground[ni])) continue;
      dist[ni] = dist[cur] + 1;
      queue.push(ni);
      if (ground[ni] === theme.floor && dist[ni] > heart.d) heart = { x: nx, y: ny, d: dist[ni] };
    }
  }
  // Clamp by at most one tile, so the disc still covers the reachable BFS tile.
  const hx = clamp(heart.x, 2, size - 3), hy = clamp(heart.y, 2, size - 3);
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (dx * dx + dy * dy > 5) continue;
      carve(hx + dx, hy + dy);
      // Everything in the chamber except the gift tile rolls encounters.
      if ((dx || dy) && get(data, hx + dx, hy + dy) === theme.floor) put(data, hx + dx, hy + dy, theme.enc);
    }
  }
  // Two crystals set into the nearest wall faces of the chamber. Crystal is as
  // solid as the wall it replaces, so connectivity cannot change.
  let heartCrystals = 0;
  for (let rad = 1; rad <= 6 && heartCrystals < 2; rad++) {
    for (let dy = -rad; dy <= rad && heartCrystals < 2; dy++) {
      for (let dx = -rad; dx <= rad && heartCrystals < 2; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
        const wx = hx + dx, wy = hy + dy;
        if (wx < 1 || wy < 1 || wx > size - 2 || wy > size - 2) continue;
        if (get(data, wx, wy) !== theme.wall) continue;
        let touchesOpen = false;
        for (const d of DIRS4) if (!isSolid(get(data, wx + d[0], wy + d[1]))) { touchesOpen = true; break; }
        if (!touchesOpen) continue;
        put(data, wx, wy, T.CRYSTAL);
        heartCrystals++;
      }
    }
  }
  data.entities.push({
    kind: 'item', x: hx, y: hy, dir: 'down',
    sprite: 'ball_orb', name: 'Item',
    itemId: gift,
    flag: 'cavegift_' + index,
    blocking: false,
  });

  const open = [];
  for (let i = 0; i < ground.length; i++) {
    if (ground[i] === theme.floor) open.push({ x: i % size, y: (i / size) | 0 });
  }

  // Ground patches. The theme's `patch` tile is pure dressing (encounter rate
  // 0), so the encounter tile threaded through each patch is what actually
  // rolls encounters — both tiles are walkable, so connectivity is untouched.
  const patches = rng.range(4, 7);
  for (let p = 0; p < patches && open.length; p++) {
    const c = open[rng.int(open.length)];
    const rad = rng.range(1, 2);
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        const gx = c.x + dx, gy = c.y + dy;
        if (get(data, gx, gy) !== theme.floor) continue;
        put(data, gx, gy, rng.chance(0.45) ? theme.enc : theme.patch);
      }
    }
  }

  // Wall decor (crystals, or cactus in the dry family) grows out of the walls,
  // never out of the floor, so it cannot seal a corridor. Candidates are
  // collected first rather than rejection-sampled, so a sparse cave still gets
  // its glitter.
  const decorSpots = [];
  for (let cy3 = 1; cy3 <= size - 2; cy3++) {
    for (let cx3 = 1; cx3 <= size - 2; cx3++) {
      if (get(data, cx3, cy3) !== theme.wall) continue;
      for (const d of DIRS4) {
        if (!isSolid(get(data, cx3 + d[0], cy3 + d[1]))) { decorSpots.push({ x: cx3, y: cy3 }); break; }
      }
    }
  }
  const decorCount = Math.min(decorSpots.length, rng.range(theme.decorLo, theme.decorHi));
  const shuffledSpots = rng.shuffle(decorSpots);
  for (let c = 0; c < decorCount; c++) put(data, shuffledSpots[c].x, shuffledSpots[c].y, theme.wallDecor);

  // Lush caves get a scatter of mushrooms on open ground — walkable, no
  // encounter rate, pure dressing.
  if (theme.floorDecor) {
    const shrooms = rng.range(4, 8);
    for (let m = 0; m < shrooms && open.length; m++) {
      const p = open[rng.int(open.length)];
      if (get(data, p.x, p.y) === theme.floor && !(p.x === data.spawn.x && p.y === data.spawn.y)) {
        put(data, p.x, p.y, theme.floorDecor);
      }
    }
  }

  // One or two pickups, placed well away from the mouth.
  const LOOT = ['potion', 'orb', 'superpotion', 'antidote', 'revive', 'greatorb'];
  const far = open.filter((p) => Math.abs(p.x - ex) + Math.abs(p.y - entryY) > size / 2);
  const pool = far.length ? far : open;
  const pickups = rng.range(1, 2);
  const used = Object.create(null);
  used[hx + ',' + hy] = true;                     // heart-chamber gift lives there
  for (let i = 0; i < pickups && pool.length; i++) {
    const p = pool[rng.int(pool.length)];
    const k = p.x + ',' + p.y;
    if (used[k]) continue;
    used[k] = true;
    if (isSolid(get(data, p.x, p.y))) continue;
    data.entities.push({
      kind: 'item', x: p.x, y: p.y, dir: 'down',
      sprite: 'ball_orb', name: 'Item',
      itemId: LOOT[rng.int(LOOT.length)],
      flag: 'cave' + index + '_item' + i,
      blocking: false,
    });
  }

  // ---- entry patch ---------------------------------------------------------
  // The mouth chamber must be able to roll encounters: the random patches above
  // can land anywhere, leaving the first minute of a cave dead. BFS out to six
  // steps from the spawn; if fewer than ENTRY_MIN encounter tiles landed there,
  // convert the nearest floor/patch tiles until the mouth carries its own
  // patch. Conversions swap one walkable tile for another walkable tile, so no
  // path can close and reachable-encounter counts can only rise. No rng: the
  // top-up is a pure function of the layout already generated, so every other
  // dressing decision for a seed is byte-identical with or without it. The
  // heart chamber is untouchable from here — a connected cave of 200+ floor
  // tiles always puts its deepest tile well past six steps from the mouth.
  {
    const ENTRY_MIN = 6, ENTRY_RADIUS = 6;
    const ed = new Int32Array(size * size).fill(-1);
    const eq = [data.spawn.y * size + data.spawn.x];
    ed[eq[0]] = 0;
    const near = [];
    let entryEnc = 0;
    for (let qi = 0; qi < eq.length; qi++) {
      const cur = eq[qi];
      const id = ground[cur];
      if (id === theme.enc) entryEnc++;
      else if (cur !== eq[0] && (id === theme.floor || id === theme.patch)) near.push(cur);
      if (ed[cur] >= ENTRY_RADIUS) continue;
      const cx4 = cur % size, cy4 = (cur / size) | 0;
      for (const d of DIRS4) {
        const nx = cx4 + d[0], ny = cy4 + d[1];
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const ni = ny * size + nx;
        if (ed[ni] >= 0 || isSolid(ground[ni])) continue;
        ed[ni] = ed[cur] + 1;
        eq.push(ni);
      }
    }
    // `near` is in BFS order, so the top-up hugs the spawn.
    for (let i = 0; i < near.length && entryEnc < ENTRY_MIN; i++) {
      ground[near[i]] = theme.enc;
      entryEnc++;
    }
  }

  return data;
}

// ---------------------------------------------------------------------------

/**
 * Build a full MapData for one interior.
 * @param {'heal'|'shop'|'house'|'cave'} kind
 * @param {number} seed  deterministic seed (overworld.js hashes the map id)
 * @param {number} index town or cave index
 * @param {{biome?:string, level?:number}} [hint] optional surface context —
 *        caves use it to pick their palette family and scale their loot.
 *        Fully optional: omitting it keeps the classic grey cave.
 */
export function buildInterior(kind, seed, index, hint) {
  const rng = makeRng((Number(seed) >>> 0) || 1);
  const i = Math.max(0, Math.floor(Number(index) || 0));
  switch (kind) {
    case 'heal': return buildHeal(rng, i);
    case 'shop': return buildShop(rng, i);
    case 'cave': return buildCave(rng, i, hint);
    case 'house':
    default: return buildHouse(rng, i);
  }
}

export default { stampTown, buildInterior, TOWN_NAMES };
