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

const TRAINER_TAUNTS = [
  'You walk like someone with a team worth testing.',
  'Hold it! Nobody strolls past me unchallenged.',
  'I have been waiting all morning for a decent match.',
  'Let us see what you have been feeding that lot.',
];

// Low-level roster ids that actually appear in the wild (see docs/ROSTER.md).
const EARLY_ROSTER = [
  'mottlemouse', 'flitterwing', 'zapkit', 'pebblit', 'shadewisp',
  'glimmoth', 'mudpuff', 'sporecap', 'frostkit', 'dunewyrm',
];
const MID_ROSTER = [
  'burrowarden', 'galeplume', 'voltlope', 'emberbat', 'tinplate',
  'bogwisp', 'cragfang', 'lumibud', 'myconaut', 'sandcoil',
];

const TRAINER_KIT = [
  { sprite: 'trainer_scout', name: 'Scout' },
  { sprite: 'trainer_hiker', name: 'Hiker' },
  { sprite: 'trainer_angler', name: 'Angler' },
];

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
export function stampTown(map, cx, cy, rng, index) {
  if (!map || !map.ground || !map.w || !map.h) {
    throw new Error('stampTown: need a MapData with w, h and ground');
  }
  const r = rng && typeof rng.int === 'function' ? rng : makeRng(((index | 0) * 2654435761) >>> 0);
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

  // Streets. The two high streets and the two-lane main street run clear
  // through the fence, so there is always a way in and a way out.
  planRect(plan, 0, ROAD_A, FOOT_W - 1, ROAD_A, T.PATH);
  planRect(plan, 0, ROAD_B, FOOT_W - 1, ROAD_B, T.PATH);
  planRect(plan, ROAD_X0, 0, ROAD_X1, FOOT_H - 1, T.PATH);
  planRect(plan, 2, ROAD_N, FOOT_W - 3, ROAD_N, T.PATH);
  planRect(plan, 2, ROAD_C, FOOT_W - 3, ROAD_C, T.PATH);

  // Plaza.
  planRect(plan, PLAZA.x0, PLAZA.y0, PLAZA.x1, PLAZA.y1, T.PATH);

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

  // Flower beds framing the plaza.
  for (const ly of [PLAZA.y0, PLAZA.y0 + 1, PLAZA.y1 - 1, PLAZA.y1]) {
    if (planGet(plan, PLAZA.x0 - 1, ly) === 0) planSet(plan, PLAZA.x0 - 1, ly, T.FLOWER);
    if (planGet(plan, PLAZA.x1 + 1, ly) === 0) planSet(plan, PLAZA.x1 + 1, ly, T.FLOWER);
  }
  // Scattered blooms in the verges.
  for (let i = 0; i < 18; i++) {
    const lx = r.range(1, FOOT_W - 2), ly = r.range(1, FOOT_H - 2);
    if (planGet(plan, lx, ly) === 0) planSet(plan, lx, ly, T.FLOWER);
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
  const signX = WX(signLocal.x), signY = WY(signLocal.y);
  if (inBounds(map, signX, signY) && groundAt(map, signX, signY) === T.SIGN) {
    entities.push({
      kind: 'sign', x: signX, y: signY, dir: 'down',
      sprite: 'sign', name: name,
      lines: [name + '. Population: enough.', 'Recovery Centre north-west. Supplies north-east.'],
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
  const lvl = clamp(4 + idx * 2, 3, 44);
  const roster = idx < 3 ? EARLY_ROSTER : MID_ROSTER;
  const TRAINER_POOL = [
    { lx: ROAD_X1, ly: SLOT_HEAL.y, dir: 'up' },
    { lx: ROAD_X0, ly: ROAD_C - 1, dir: 'down' },
  ];
  const trainerCount = r.range(1, 2);
  for (let i = 0; i < trainerCount; i++) {
    const spot = TRAINER_POOL[i];
    const at = settle(WX(spot.lx), WY(spot.ly));
    if (!at) continue;
    const kit = TRAINER_KIT[(idx + i) % TRAINER_KIT.length];
    const teamSize = idx === 0 ? 1 : r.range(1, 2);
    const team = [];
    for (let k = 0; k < teamSize; k++) {
      team.push({ species: r.pick(roster), level: clamp(lvl + k, 2, 60) });
    }
    entities.push({
      kind: 'trainer', x: at.x, y: at.y, dir: spot.dir,
      sprite: kit.sprite, name: kit.name,
      sight: r.range(3, 4),
      team,
      prize: 80 + idx * 60 + i * 20,
      challenge: r.pick(TRAINER_TAUNTS),
      lines: ['Good match. The frontier keeps you honest.'],
      flag: 'trainer_t' + idx + '_' + i,
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

function buildCave(rng, index) {
  const size = 30 + rng.int(17);                 // 30..46 tiles square
  const { ground, overlay } = blankRoom(size, size, T.WALL_CAVE, T.WALL_CAVE);
  for (let i = 0; i < ground.length; i++) ground[i] = T.WALL_CAVE;

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
    if (ground[i] === T.FLOOR_CAVE) return;
    ground[i] = T.FLOOR_CAVE;
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
  if (ground[entryY * size + ex] !== T.FLOOR_CAVE) carve(ex, entryY);
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
      if (!seen[i] && !isSolid(ground[i])) ground[i] = T.WALL_CAVE;
    }
  }

  const open = [];
  for (let i = 0; i < ground.length; i++) {
    if (ground[i] === T.FLOOR_CAVE) open.push({ x: i % size, y: (i / size) | 0 });
  }

  // Gravel patches. GRAVEL itself carries no encounter rate in tiles.js, so the
  // damp moss threaded through each patch is what actually rolls encounters —
  // both tiles are walkable, so connectivity is untouched.
  const patches = rng.range(4, 7);
  for (let p = 0; p < patches && open.length; p++) {
    const c = open[rng.int(open.length)];
    const rad = rng.range(1, 2);
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        const gx = c.x + dx, gy = c.y + dy;
        if (get(data, gx, gy) !== T.FLOOR_CAVE) continue;
        put(data, gx, gy, rng.chance(0.45) ? T.TALLGRASS_DARK : T.GRAVEL);
      }
    }
  }

  // Crystals grow out of the walls, never out of the floor, so they cannot
  // seal a corridor. Candidates are collected first rather than rejection-
  // sampled, so a sparse cave still gets its glitter.
  const crystalSpots = [];
  for (let cy3 = 1; cy3 <= size - 2; cy3++) {
    for (let cx3 = 1; cx3 <= size - 2; cx3++) {
      if (get(data, cx3, cy3) !== T.WALL_CAVE) continue;
      for (const d of DIRS4) {
        if (!isSolid(get(data, cx3 + d[0], cy3 + d[1]))) { crystalSpots.push({ x: cx3, y: cy3 }); break; }
      }
    }
  }
  const crystals = Math.min(crystalSpots.length, rng.range(6, 12));
  const shuffledSpots = rng.shuffle(crystalSpots);
  for (let c = 0; c < crystals; c++) put(data, shuffledSpots[c].x, shuffledSpots[c].y, T.CRYSTAL);

  // One or two pickups, placed well away from the mouth.
  const LOOT = ['potion', 'orb', 'superpotion', 'antidote', 'revive', 'greatorb'];
  const far = open.filter((p) => Math.abs(p.x - ex) + Math.abs(p.y - entryY) > size / 2);
  const pool = far.length ? far : open;
  const pickups = rng.range(1, 2);
  const used = Object.create(null);
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

  return data;
}

// ---------------------------------------------------------------------------

/**
 * Build a full MapData for one interior.
 * @param {'heal'|'shop'|'house'|'cave'} kind
 * @param {number} seed  deterministic seed (overworld.js hashes the map id)
 * @param {number} index town or cave index
 */
export function buildInterior(kind, seed, index) {
  const rng = makeRng((Number(seed) >>> 0) || 1);
  const i = Math.max(0, Math.floor(Number(index) || 0));
  switch (kind) {
    case 'heal': return buildHeal(rng, i);
    case 'shop': return buildShop(rng, i);
    case 'cave': return buildCave(rng, i);
    case 'house':
    default: return buildHouse(rng, i);
  }
}

export default { stampTown, buildInterior, TOWN_NAMES };
