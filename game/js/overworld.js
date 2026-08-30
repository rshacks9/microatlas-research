// The overworld scene: grid movement, encounters, warps, interaction, trainer sight.
import { Game, W, H, pushScene, popScene, transition, fade } from './game.js';
import { TILE, T, isGrass, isWater, ledgeDir, isCounter } from './tiles.js';
import { GameMap } from './tilemap.js';
import { makeCamera } from './camera.js';
import { makeEntities, Entity, DELTA, OPPOSITE } from './entities.js';
import { drawSprite, hasSprite, walkKey } from './sprites.js';
import { generateWorld, biomeAt, levelAt, encounterTableFor } from './worldgen.js';
import { buildInterior } from './towns.js';
import { makeCreature, displayName, partyWiped, healParty, firstHealthy, addToParty } from './party.js';
import { maxHp } from './battlecalc.js';
import { startBattle } from './battle.js';
import { say, ask, showBanner, updateBanner, renderBanner, isDialogueOpen } from './dialogue.js';
import { openPauseMenu, openShop } from './menus.js';
import { S, advanceTime, addItem, setFlag, getFlag, seeSpecies, spendMoney, timeOfDay, dexCaughtCount, markExplored, updateRecord } from './state.js';
import { getSpecies, STARTERS } from './creatures.js';
import { effectiveness } from './types.js';
import { makeRng, rand } from './rng.js';
import { playBgm, sfx } from './audio.js';
import { drawText, drawWindow, PAL } from './ui.js';

// Every settlement has exactly one Warden, so the Seal target is the town count.
export const TOTAL_WARDENS = 10;   // fallback; the live goal is the generated town count
function sealGoal() {
  return (S.world && S.world.towns && S.world.towns.length) ? S.world.towns.length : TOTAL_WARDENS;
}

const WALK_DUR = 0.16;
const RUN_DUR = 0.09;

export const player = {
  x: 0, y: 0, dir: 'down',
  fromX: 0, fromY: 0,
  moving: false, moveT: 0, moveDur: WALK_DUR,
  frame: 0, animT: 0,
  hopping: false, hopFrom: null,
  stepParity: false,
  sprite: 'hero',
  get px() {
    if (!this.moving) return this.x * TILE;
    const p = Math.min(1, this.moveT / this.moveDur);
    return (this.fromX + (this.x - this.fromX) * p) * TILE;
  },
  get py() {
    if (!this.moving) return this.y * TILE;
    const p = Math.min(1, this.moveT / this.moveDur);
    return (this.fromY + (this.y - this.fromY) * p) * TILE;
  },
};

const O = {
  opaque: true,
  map: null,
  cam: null,
  entities: [],
  // Control lock for blocking sequences (battle, dialogue, warp). A DEPTH
  // COUNTER owned strictly by begin/endBusy pairs — it used to be a boolean
  // that resume() and enterMap() cleared blind, which handed the player live
  // control in the middle of transitions: warping during the post-battle fade
  // collided two fades and locked input forever.
  busyDepth: 0,
  t: 0,
  stepsSinceEncounter: 0,
  pendingWatcher: null,
  grassSteps: 0,
  encounterRolls: 0,
  effects: [],          // short-lived overworld puffs (grass rustle, running dust)
  lastRunning: false,
  lastBump: -1,
  returnPoint: null,    // where to drop the player when leaving an interior
  turnHold: 0,
};

function beginBusy() { O.busyDepth++; }
function endBusy() { O.busyDepth = Math.max(0, O.busyDepth - 1); }

// For main.js: hold the player still through the intro, so an encounter or a
// trainer sighting can never fire before the starter exists.
export function holdControl() { beginBusy(); }
export function releaseControl() { endBusy(); }

// ---------------------------------------------------------------- map loading
function interiorSeed(mapId) {
  let h = S.seed >>> 0;
  for (let i = 0; i < mapId.length; i++) h = (Math.imul(h ^ mapId.charCodeAt(i), 0x01000193) >>> 0);
  return h >>> 0;
}

function buildMapData(mapId) {
  if (mapId === 'world') {
    if (!S.world) S.world = generateWorld(S.seed);
    return S.world.map;
  }
  if (S.interiors[mapId]) return S.interiors[mapId];

  const parts = String(mapId).split(':');
  let kind = 'house', index = 0;
  if (parts[0] === 'cave') { kind = 'cave'; index = parseInt(parts[1], 10) || 0; }
  else if (parts[0] === 'inside') { kind = parts[1] || 'house'; index = parseInt(parts[2], 10) || 0; }

  let data = null;
  try {
    // Caves inherit their surface surroundings: theme and danger come from where
    // the mouth sits, so a peak cave and a desert cave stop being identical.
    let hint;
    if (kind === 'cave' && S.world && S.world.caves && S.world.caves[index]) {
      const mouth = S.world.caves[index];
      hint = {
        biome: biomeAt(S.world, mouth.x, mouth.y),
        level: levelAt(S.world, mouth.x, mouth.y),
      };
    }
    data = buildInterior(kind, interiorSeed(mapId), index, hint);
  } catch (e) {
    try { console.error('buildInterior failed for ' + mapId, e); } catch (_) {}
  }
  if (!data || !data.ground) data = emergencyRoom(mapId);
  data.id = mapId;
  S.interiors[mapId] = data;
  return data;
}

// If an interior fails to generate we still owe the player a room they can leave.
function emergencyRoom(mapId) {
  const w = 9, h = 7;
  const ground = new Uint16Array(w * h);
  const overlay = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      ground[y * w + x] = (y === 0 || x === 0 || x === w - 1) ? T.WALL_WOOD : T.FLOOR_WOOD;
    }
  }
  return {
    id: mapId, w, h, ground, overlay, biome: null,
    warps: [{ x: 4, y: h - 1, to: 'world' }],
    entities: [], spawn: { x: 4, y: h - 2 }, indoor: true, bgm: 'town', name: 'Inside',
  };
}

export function enterMap(mapId, x, y, dir) {
  const data = buildMapData(mapId);
  const map = new GameMap(data);
  map.playerAt = (tx, ty) => !player.moving && player.x === tx && player.y === ty;

  O.map = map;
  O.entities = map.entityList ? map.entityList().slice() : [];
  if (!O.entities.length && Array.isArray(data.entities)) {
    // tilemap keeps plain specs; wrap them so they animate and can be talked to.
    O.entities = makeEntities(data.entities);
  } else {
    O.entities = O.entities.map((e) => (e instanceof Entity ? e : new Entity(e)));
  }
  map.entities = O.entities;
  if (map.reindex) map.reindex();

  S.mapId = mapId;

  const sx = (x !== undefined && x !== null) ? x : (data.spawn ? data.spawn.x : 1);
  const sy = (y !== undefined && y !== null) ? y : (data.spawn ? data.spawn.y : 1);
  player.x = clampInt(sx, 0, map.w - 1);
  player.y = clampInt(sy, 0, map.h - 1);
  player.fromX = player.x; player.fromY = player.y;
  player.moving = false; player.moveT = 0; player.frame = 0;
  if (dir) player.dir = dir;
  S.player.x = player.x; S.player.y = player.y; S.player.dir = player.dir;

  // Never spawn the player inside a wall.
  if (map.solidAt(player.x, player.y)) {
    const spot = nearestOpen(map, player.x, player.y);
    player.x = spot.x; player.y = spot.y;
    player.fromX = spot.x; player.fromY = spot.y;
    if (map.solidAt(player.x, player.y)) {
      // nearestOpen exhausted its radius — deep ocean or void, e.g. a migrated
      // save with no usable coordinates. The map's own spawn is the one point
      // guaranteed walkable.
      const sp = data.spawn || { x: 1, y: 1 };
      player.x = sp.x; player.y = sp.y;
      player.fromX = sp.x; player.fromY = sp.y;
    }
  }

  O.cam = makeCamera(map);
  O.cam.follow(player.px + TILE / 2, player.py + TILE / 2, true);
  O.stepsSinceEncounter = 0;
  O.effects = [];
  O.pendingWatcher = null;

  playBgm(fieldBgm(mapId) || data.bgm || 'town');
  // Name the place you are actually standing in. The world map's own name was
  // being shown for every town, so settlements the generator named were nameless
  // to the player.
  if (mapId === 'world') markExplored(player.x, player.y, 8);
  const here = (mapId === 'world') ? townNameAt(player.x, player.y) : data.name;
  if (here) showBanner(here, 2.2);
  if (getFlag('world_shifted') && !getFlag('world_shifted_told')) {
    // A migrated save woke up in a subtly different world; say so once, as a
    // banner rather than a dialogue, so loading stays uninterrupted.
    setFlag('world_shifted_told', true);
    showBanner('The frontier has shifted since your last journey', 3.6);
  }
  return map;
}

// Which settlement (if any) the player is standing in, for the location banner.
function townNameAt(x, y) {
  const towns = (S.world && S.world.towns) || [];
  for (const t of towns) {
    if (Math.max(Math.abs(t.x - x), Math.abs(t.y - y)) <= 13) return t.name || null;
  }
  return null;
}

function clampInt(v, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(Number(v) || 0))); }

function nearestOpen(map, x, y) {
  for (let r = 1; r < 40; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
        if (!map.solidAt(nx, ny)) return { x: nx, y: ny };
      }
    }
  }
  return { x, y };
}

// ---------------------------------------------------------------- movement
function canEnter(nx, ny) {
  const map = O.map;
  if (!map) return false;
  if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) return false;
  if (map.solidAt(nx, ny)) return false;
  const e = map.entityAt ? map.entityAt(nx, ny) : null;
  if (e && e.blocking !== false && e.kind !== 'item' && !(e.flag && getFlag(e.flag) && e.kind !== 'trainer')) return false;
  return true;
}

function startStep(dir, running) {
  const d = DELTA[dir];
  if (!d) return false;
  const nx = player.x + d[0], ny = player.y + d[1];

  // Ledge hop: only downward, only when approaching from above.
  const ledge = ledgeDir(O.map.at(nx, ny));
  if (ledge === 'down' && dir === 'down') {
    const lx = nx, ly = ny + 1;
    if (ly < O.map.h && !O.map.solidAt(lx, ly)) {
      player.fromX = player.x; player.fromY = player.y;
      player.x = lx; player.y = ly;
      player.moving = true; player.hopping = true;
      player.moveT = 0; player.moveDur = 0.28;
      sfx('bump');
      return true;
    }
  }

  if (!canEnter(nx, ny)) {
    player.dir = dir;
    // Held against a wall this fired 60 times a second. Rate-limit it so a bump
    // reads as one thud rather than a buzzsaw.
    if (O.t - O.lastBump > 0.35) { sfx('bump'); O.lastBump = O.t; }
    return false;
  }
  player.fromX = player.x; player.fromY = player.y;
  player.x = nx; player.y = ny;
  player.dir = dir;
  player.moving = true;
  player.hopping = false;
  player.moveT = 0;
  player.moveDur = running ? RUN_DUR : WALK_DUR;
  player.stepParity = !player.stepParity;   // alternate the leading foot
  O.lastRunning = !!running;
  return true;
}

// ---------------------------------------------------------------- encounters
function currentBiome() {
  if (S.mapId === 'world' && S.world) return biomeAt(S.world, player.x, player.y);
  if (String(S.mapId).startsWith('cave')) return 'MOUNTAIN';
  return 'MEADOW';
}

function wildLevelHere() {
  if (S.mapId === 'world' && S.world) return levelAt(S.world, player.x, player.y);
  if (String(S.mapId).startsWith('cave')) {
    // The cave is as dangerous as the ground above it.
    const idx = parseInt(String(S.mapId).split(':')[1], 10) || 0;
    const mouth = S.world && S.world.caves && S.world.caves[idx];
    if (mouth) return Math.max(4, levelAt(S.world, mouth.x, mouth.y) + 2);
    return 8;
  }
  return 3;
}

function rollEncounter() {
  const map = O.map;
  if (!map) return null;
  const tile = map.at(player.x, player.y);
  if (!isGrass(tile)) return null;
  if (S.repelSteps > 0) return null;

  const rate = map.encounterRateAt ? map.encounterRateAt(player.x, player.y) : 0.12;
  // A short grace period after a battle so you can walk out of a patch.
  if (O.stepsSinceEncounter < 3) return null;
  O.encounterRolls++;
  if (!rand.chance(rate)) return null;

  let table = [];
  try { table = encounterTableFor(currentBiome()) || []; } catch (_) { table = []; }
  if (!table.length) return null;

  // Time of day reweights the table so night genuinely feels different from noon.
  // Nocturnal types become common after dark and scarce at midday, which gives the
  // clock a reason to exist and rewards a player for coming back at another hour.
  const tod = timeOfDay();
  const weightFor = (e) => {
    const w = e.weight || 1;
    const types = getSpecies(e.species).types || [];
    const nocturnal = types.includes('UMBRA') || types.includes('PSION') || types.includes('TOXIN');
    if (tod === 'night') return w * (nocturnal ? 3 : 0.7);
    if (tod === 'evening') return w * (nocturnal ? 1.6 : 0.95);
    if (tod === 'day') return w * (nocturnal ? 0.35 : 1.15);
    return w;   // morning: neutral
  };

  // The level ceiling near the start clamps LEVELS but a stage-2 clamped to
  // L5 still fights on a stage-2 stat budget — three playtest personas were
  // wiped at the doorstep by "L5" Burrowarden/Voltlope. Where the ceiling
  // bites (base <= 4), species whose natural band starts above it simply do
  // not appear; they return at their real levels a few hundred tiles out.
  const baseHere = wildLevelHere();
  const bandCeil = baseHere + (baseHere <= 4 ? 2 : 4);
  // Levels alone were not enough: a doorstep mudpuff at L3 still went 5-0
  // against a full-HP fire starter, because STAB typing beats even stats.
  // In the training-wheels zone the pool also refuses species whose STAB is
  // super-effective against the player's lead — those species return, at the
  // same spot, the moment the lead can answer back (or one ring out).
  const lead = S.party.find((c) => c && c.hp > 0) || S.party[0];
  const leadTypes = lead ? getSpecies(lead.species).types : [];
  const stabCounters = (id) =>
    leadTypes.length > 0 && getSpecies(id).types.some((t) => effectiveness(t, leadTypes) > 1);
  const inBand = (e) => (e.minLvl === undefined || e.minLvl <= bandCeil);

  const eligible = baseHere <= 4
    ? table.filter((e) => inBand(e) && !stabCounters(e.species))
    : table;
  // Fallbacks relax one rule at a time and never reopen both doors at once:
  // first keep the counter rule over the lowest band, then band alone, then
  // (a table that is ALL counters in-band) anything.
  let pool = eligible;
  if (!pool.length && baseHere <= 4) {
    const lowest = Math.min(...table.map((e) => (e.minLvl === undefined ? 2 : e.minLvl)));
    const lowBand = (e) => (e.minLvl === undefined ? 2 : e.minLvl) <= lowest + 2;
    pool = table.filter((e) => lowBand(e) && !stabCounters(e.species));
    if (!pool.length) pool = table.filter(lowBand);
  }
  if (!pool.length) pool = table;

  let total = 0;
  for (const e of pool) total += weightFor(e);
  if (total <= 0) return null;
  let r = rand.float() * total;
  let pick = pool[0];
  for (const e of pool) { r -= weightFor(e); if (r <= 0) { pick = e; break; } }
  if (!pick || !pick.species) return null;

  // Difficulty comes from DISTANCE, not from the biome table. The table's level range
  // says where a species sits relative to its peers; `base` (levelAt) says how dangerous
  // THIS spot is. Rolling the table range straight would put level-23 tundra wilds next
  // to the start town, which kills the whole "walk any direction, danger scales" premise.
  const base = baseHere;
  const lo = pick.minLvl !== undefined ? pick.minLvl : Math.max(2, base - 2);
  const hi = pick.maxLvl !== undefined ? pick.maxLvl : base + 1;
  const roll = rand.range(Math.min(lo, hi), Math.max(lo, hi));
  const floor = Math.max(2, base - 3);
  // Near the start (base <= 4) the table's own minLvl could push rolls to
  // base+4 — L6-7 wilds flattening a fresh L5 starter on its literal first
  // battle, three playtest personas hit it. The doorstep stays a doorstep.
  const ceil = Math.max(floor, base + (base <= 4 ? 2 : 4));
  const level = Math.max(2, Math.min(100, Math.max(floor, Math.min(ceil, roll))));
  return makeCreature(pick.species, level, { where: currentBiome().toLowerCase() });
}

// A plain fade makes every encounter feel identical. A short flashing wipe costs
// almost nothing and turns the moment of an encounter into an event.
async function encounterWipe() {
  for (let i = 0; i < 3; i++) {
    await fade('out', 0.07, '#f8f4e8');
    await fade('in', 0.07, '#f8f4e8');
  }
  await fade('out', 0.26, '#000');
}

async function doWildBattle(wild) {
  beginBusy();
  sfx('encounter');
  await encounterWipe();
  // startBattle pushes the battle scene synchronously, so fade back IN over it.
  // Without this the screen stays under a full-alpha black overlay for the whole battle.
  const battle = startBattle({ wild });
  await fade('in', 0.3);
  const result = await battle;
  try {
    await afterBattle(result);
    // The intro ranger sets one explicit objective — weaken a wild one, throw an
    // orb — and an objective a game sets and never acknowledges teaches the
    // player that its promises are decorative. Pay it off exactly once, and
    // only when this really IS the first catch: the flag alone would fire the
    // congratulation mid-game on a pre-flag save, dozens of catches too late.
    if (result === 'caught' && !getFlag('ranger_first_catch')) {
      setFlag('ranger_first_catch', true);
      if (dexCaughtCount() <= 2) {   // the starter plus the one just caught
        addItem('orb', 5);
        sfx('levelup');
        await say([
          'Your field radio crackles. It is the old ranger.',
          'Ranger: Weakened it and threw the orb, just like I said. You will do fine out there.',
          'Ranger: I left five orbs for you with the courier. Go fill that dex of yours.',
        ]);
      }
    }
  } finally { endBusy(); }
}

async function afterBattle(result) {
  O.stepsSinceEncounter = 0;
  if (result === 'lose' || partyWiped()) {
    // A concede arrives here as 'lose' with a healthy team — same cost, but
    // telling that player their creatures were wiped is simply false.
    const conceded = !partyWiped();
    // Losing used to cost nothing at all, which also meant winning carried no
    // relief. The cost is deliberately mild — and gentler before the second
    // Seal: playtests showed two doorstep losses eating a third of starting
    // money before a new player could even restock.
    const money = S.player.money | 0;
    const rate = (S.badges | 0) >= 2 ? 0.25 : 0.1;
    const fee = Math.min(Math.floor(money * rate), 400 + (S.badges | 0) * 250);
    if (fee > 0) S.player.money = money - fee;

    // Teleport and heal happen UNDER the fade; the explanation plays over the
    // town after fading back in. The message used to play under the black
    // overlay — an invisible dialogue holding a seemingly frozen screen, which
    // every playtester read as a crash.
    const where = nearestTown();
    await fade('out', 0.4, '#000');
    healParty();
    enterMap('world', where.x, where.y, 'down');
    playBgm('town');
    await fade('in', 0.4);
    const firstLine = conceded ? 'You conceded the match.' : 'You have no creatures able to battle!';
    const backLine = conceded
      ? 'You made your way back to ' + where.name + (fee > 0 ? ', ' + fee + (fee === 1 ? ' credit' : ' credits') + ' lighter.' : '.')
      : (fee > 0
        ? 'You scrambled back to ' + where.name + ', dropping ' + fee + (fee === 1 ? ' credit' : ' credits') + ' along the way.'
        : 'You scrambled back to ' + where.name + '.');
    await say([firstLine, backLine]);
    return;
  }
  // The battle scene has popped and the overworld is visible again; a short dip
  // covers the swap rather than snapping.
  await fade('out', 0.18, '#000');
  await fade('in', 0.28);
  playBgm(fieldBgm(S.mapId) || 'town');
}

// The audio compiler derives overworld2/cave2 from the base tracks; unplayed
// tracks are dead content. Night gets its own overworld voice, and caves
// alternate by index so two neighbouring caves never sound identical.
function fieldBgm(mapId) {
  if (mapId === 'world') return timeOfDay() === 'night' ? 'overworld2' : 'overworld';
  const m = /^cave:(\d+)/.exec(String(mapId));
  if (m) return ((m[1] | 0) % 2) ? 'cave2' : 'cave';
  return null;
}

function respawnAtHome() {
  const home = (S.world && S.world.start) ? S.world.start : { x: 8, y: 8 };
  enterMap('world', home.x, home.y, 'down');
}

// Towns double as the checkpoint network. Respawning at the NEAREST one rather
// than always at the start town means seeking out settlements is worth doing,
// which is exactly the behaviour an open world wants to reward.
function nearestTown() {
  const towns = (S.world && S.world.towns) || [];
  const home = (S.world && S.world.start) ? S.world.start : { x: 8, y: 8 };
  if (!towns.length) return { x: home.x, y: home.y, name: 'the frontier' };
  // Inside a cave or a building, player.x/y are INTERIOR coordinates — measuring
  // distance with them picked an arbitrary town. Use the world-space point we
  // entered from instead.
  const at = (S.mapId === 'world')
    ? { x: player.x, y: player.y }
    : (O.returnPoint || S.returnPoint || home);
  let best = towns[0], bestD = Infinity;
  for (const t of towns) {
    const d = Math.max(Math.abs(t.x - at.x), Math.abs(t.y - at.y));
    if (d < bestD) { bestD = d; best = t; }
  }
  return { x: best.x, y: best.y, name: best.name || 'the nearest settlement' };
}

// ---------------------------------------------------------------- interaction
function facingTile() {
  const d = DELTA[player.dir] || [0, 1];
  return { x: player.x + d[0], y: player.y + d[1] };
}

async function interact() {
  const map = O.map;
  const f = facingTile();
  let e = map.entityAt ? map.entityAt(f.x, f.y) : null;

  // Talk across a shop/heal counter.
  if (!e && isCounter(map.at(f.x, f.y))) {
    const d = DELTA[player.dir];
    e = map.entityAt ? map.entityAt(f.x + d[0], f.y + d[1]) : null;
  }

  // entityAt already hides spent one-shots; what still comes back flagged is
  // a beaten trainer or stilled shrine, and talkTo owns those branches.
  if (e) {
    beginBusy();
    try { await talkTo(e); } finally { endBusy(); }
    return true;
  }

  const tile = map.at(f.x, f.y);
  if (tile === T.SIGN) {
    beginBusy();
    try { await say('A weathered signpost. The paint has long since faded.'); } finally { endBusy(); }
    return true;
  }
  return false;
}

// NPCs that never acknowledge anything the player has done make a world feel
// procedural. These fire on top of an NPC's own lines when the player's state
// gives them something to react to, which is cheap texture for real payoff.
function reactiveLine() {
  const seals = S.badges | 0;
  const caught = Object.keys(S.dex.caught).length;
  const party = S.party.length;
  const tod = timeOfDay();
  const pool = [];

  if (seals >= 8) pool.push('Eight Seals? The Wardens must be running out of things to teach you.');
  else if (seals >= 4) pool.push('You are carrying real Seals. Word travels faster than you walk.');
  else if (seals === 0) pool.push('No Seals yet? Every settlement keeps a Warden. Start with ours.');

  if (caught >= 25) pool.push('They say someone out here has catalogued nearly everything. That is you, is it?');
  else if (caught >= 10) pool.push('You have met more creatures than most of us ever will.');

  if (party >= 6) pool.push('Six already? You will need somewhere to keep the rest.');
  else if (party === 1) pool.push('Travelling with just the one? Braver than me.');

  if (tod === 'night') pool.push('Out this late? Different things wake up after dark, you know.');
  else if (tod === 'morning') pool.push('Early start. Best time to be on the road.');

  const hurt = S.party.some((c) => c && c.hp > 0 && c.hp < maxHpOf(c) * 0.35);
  if (hurt) pool.push('Your team looks rough. The recovery centre costs nothing.');

  if (S.player.money < 300) pool.push('Short on credits? Wardens pay well, if you can take them.');

  return pool.length ? pool[Math.floor(rand.float() * pool.length)] : null;
}

function maxHpOf(c) {
  try { return maxHp(c); } catch (_) { return 1; }
}

async function talkTo(e) {
  if (e.facePoint) e.facePoint(player.x, player.y);
  e.frozen = true;
  try {
    if (e.kind === 'heal') {
      // Healing is the single most repeated interaction in the game, so it is one
      // question, not a five-press conversation. Saving is folded in rather than
      // being a second prompt: a player who never loses an hour of progress to a
      // forgotten save is a player who comes back.
      const yes = await ask('Rest your team here?', ['Yes', 'No']);
      if (yes !== 0) { await say('Come back any time.'); return; }
      sfx('heal');
      healParty();
      let saved = false;
      try {
        const { saveGame } = await import('./save.js');
        saved = saveGame(0);
      } catch (_) { saved = false; }
      await say(saved
        ? 'Everyone is back on their feet, and your journey is recorded.'
        : 'Everyone is back on their feet. (Your journey could not be recorded — browser storage may be blocked.)');
      return;
    }
    if (e.kind === 'shop') {
      await openShop(e.tier || 1);
      return;
    }
    if (e.kind === 'item') {
      const id = e.itemId || 'potion';
      const { getItem } = await import('./items.js');
      addItem(id, 1);
      if (e.flag) setFlag(e.flag, true);
      sfx('heal');
      const nm = getItem(id).name;
      await say('You found ' + (/^[aeiou]/i.test(nm) ? 'an ' : 'a ') + nm + '!');
      return;
    }
    if (e.kind === 'shrine') {
      const SEALS_NEEDED = 5;
      if (getFlag('shrine_' + e.species)) {
        await say('The shrine is quiet now. Whatever lived here travels with you.');
        return;
      }
      await say([
        'A weathered shrine, older than any settlement.',
        'Something vast is watching from just out of sight.',
      ]);
      if ((S.badges | 0) < SEALS_NEEDED) {
        await say('It does not consider you worthy yet. (' + (S.badges | 0) + '/' + SEALS_NEEDED + ' Seals — return stronger.)');
        return;
      }
      const yes = await ask('Call it forth?', ['Challenge', 'Not yet']);
      if (yes !== 0) return;
      sfx('encounter');
      const legend = makeCreature(e.species, e.level || 50, { where: 'its shrine' });
      await encounterWipe();
      const battle = startBattle({ wild: legend, bg: ['#403858', '#584870', '#302848'] });
      await fade('in', 0.3);
      const result = await battle;
      // Catching it stills the shrine forever. Merely defeating it lets you
      // return and try again — a KO must not permanently break the dex.
      if (result === 'caught') setFlag('shrine_' + e.species, true);
      await afterBattle(result);
      if (result === 'win') await say('It scatters like smoke. The shrine waits for you to try again.');
      return;
    }
    if (e.kind === 'trainer') {
      if (e.flag && getFlag(e.flag)) {
        // Already beaten: they stay put and acknowledge it, rather than the world
        // quietly deleting everyone you have defeated.
        if (e.warden) {
          // A milestone grant refused for lack of space must stay claimable —
          // after the FINAL Warden there is no next win to retry it on, and
          // the gifted starters are the only path to a complete dex.
          await grantStarterMilestone();
          if ((S.badges | 0) >= sealGoal() && !getFlag('trial_done')) {
            await offerVerdantTrial(e.name || 'The Warden');
            return;
          }
        }
        const lines = (e.lines && e.lines.length) ? e.lines : ['You bested me fair and square.'];
        await say(lines, { speaker: e.name || undefined });
        return;
      }
      await startTrainerBattle(e);
      return;
    }
    const lines = (e.lines && e.lines.length) ? e.lines.slice() : ['...'];
    // Roughly one in three villagers has something to say about how you are doing.
    if (e.kind === 'npc' && rand.chance(0.34)) {
      const extra = reactiveLine();
      if (extra) lines.push(extra);
    }
    await say(lines, { speaker: e.name || undefined });
  } finally {
    e.frozen = false;
  }
}

// The two starter lines you did not pick are not in any encounter table, so a
// dex could only ever reach 30 of 34. Wardens hand them over at the third and
// sixth Seal, which closes the gap and turns the milestone into a real reward.
async function grantStarterMilestone() {
  const seals = S.badges | 0;
  const unchosen = STARTERS.filter((id) => !getFlag('starter_' + id));
  const remaining = unchosen.filter((id) => !getFlag('granted_' + id));
  if (!remaining.length) return;

  // How many of these the player has EARNED by now: one at 3 Seals, one at 6.
  // This was an exact-equality check, so a grant that failed because the party and
  // boxes were both full at that exact Seal could never be retried — and the two
  // starter lines are the only way the dex reaches 34, so it silently capped again.
  const earned = (seals >= 6 ? 2 : seals >= 3 ? 1 : 0);
  const granted = unchosen.length - remaining.length;
  if (granted >= earned) return;

  const giveId = remaining[0];

  // Match the player's current team so the gift is usable, not a museum piece.
  let lvl = 5;
  for (const c of S.party) if (c && c.level > lvl) lvl = c.level;
  lvl = Math.max(5, Math.min(60, lvl - 2));

  const gift = makeCreature(giveId, lvl, { where: 'a Warden' });
  const dest = addToParty(gift);
  if (dest === 'full') {
    // Do NOT burn the grant. It will be offered again after the next Warden.
    await say('The Warden offers you a companion, but you have nowhere to put it. Come back with room.');
    return;
  }
  setFlag('granted_' + giveId, true);
  sfx('levelup');
  await say([
    'The Warden says: a keeper of Seals should know the whole frontier.',
    'You received ' + displayName(gift) + '!' + (dest === 'box' ? ' It went to storage.' : ''),
  ]);
}

async function startTrainerBattle(e) {
  sfx('encounter');
  await say((e.name ? e.name + ': ' : '') + (e.challenge || "Let's battle!"));
  await encounterWipe();
  const battle = startBattle({ trainer: e });
  await fade('in', 0.3);
  const result = await battle;
  if (result === 'win' && e.flag) setFlag(e.flag, true);
  if (result === 'win' && e.warden) {
    S.badges = (S.badges | 0) + 1;
    sfx('levelup');
    await say([
      e.seal ? 'You received the ' + e.seal + '!' : 'The Warden hands you a Seal.',
      'Seals: ' + S.badges + ' of ' + sealGoal() + '.  Every settlement out there has one.',
    ]);
    updateRecord({ maxes: { bestSeals: S.badges } });
    await grantStarterMilestone();
    if (S.badges >= sealGoal() && !getFlag('trial_done')) {
      // An accepted Trial runs its own afterBattle for whichever way it ends;
      // running this function's own one too replayed the fade and stamped
      // overworld BGM over a town after a Trial loss.
      const trialRan = await offerVerdantTrial(e.name || 'The Warden');
      if (trialRan) { e.defeated = true; return; }
    }
  }
  e.defeated = result === 'win';
  await afterBattle(result);
}

// ---------------------------------------------------------------- the Trial
// The ending the Seals were always pointing at: with every Seal held, the
// Wardens' Circle convenes and the Keepers test you back-to-back with no rest
// between rounds. Losing costs what any loss costs and the Circle will convene
// again from any beaten Warden — the ending must be winnable eventually, not
// missable forever.
export const TRIAL_KEEPERS = [
  { name: 'Keeper Bramwell', warden: true,   // warden battle theme
    challenge: 'The Circle opens with stone. Wear through me if you can.',
    team: [{ species: 'boulderkin', level: 47 }, { species: 'ironclad', level: 49 }, { species: 'thornmane', level: 48 }],
    prize: 1200 },
  { name: 'Keeper Sable', warden: true,   // warden battle theme
    challenge: 'Round two. What you cannot see will decide this.',
    team: [{ species: 'nightveil', level: 48 }, { species: 'bogwisp', level: 47 }, { species: 'rimewolf', level: 49 }],
    prize: 1500 },
  { name: 'Keeper Oriane', warden: true,   // warden battle theme
    challenge: 'Last round. The Circle asks for everything now.',
    team: [{ species: 'thunderjaw', level: 50 }, { species: 'galeplume', level: 48 },
           { species: 'tidalquill', level: 49 }, { species: 'pyrelynx', level: 52 }],
    prize: 2400 },
];

/** Returns true when the Trial was accepted (whatever its outcome). */
async function offerVerdantTrial(byName) {
  await say([
    byName + ': Every Seal on the frontier answers to you now.',
    byName + ': The Wardens\' Circle convenes for the Verdant Trial — three Keepers, no rest between rounds.',
  ]);
  const yes = await ask('Face the Verdant Trial?', ['Begin', 'Not yet']);
  if (yes !== 0) {
    await say('The Circle will convene whenever you speak to a Warden you have bested.');
    return false;
  }
  await runVerdantTrial();
  return true;
}

async function runVerdantTrial() {
  healParty();   // the Trial starts fair; what it never does is heal BETWEEN rounds
  await say('The light shifts. The Circle has formed around you.');
  for (let i = 0; i < TRIAL_KEEPERS.length; i++) {
    const k = TRIAL_KEEPERS[i];
    sfx('encounter');
    await say(k.name + ': ' + k.challenge);
    await encounterWipe();
    const battle = startBattle({ trainer: k, bg: ['#2c2440', '#483860', '#241c34'] });
    await fade('in', 0.3);
    const result = await battle;
    if (result !== 'win') {
      await afterBattle(result);
      await say('The Circle disperses. It will convene again when you are ready.');
      return;
    }
    if (i < TRIAL_KEEPERS.length - 1) {
      await say(k.name + ' steps back. No one heals you. The next round begins.');
    }
  }
  // The ending.
  setFlag('trial_done', true);
  updateRecord({ adds: { trials: 1 }, maxes: { bestSeals: S.badges, bestDex: dexCaughtCount() } });
  sfx('fanfare_catch');
  await say([
    'The Keepers lower their orbs. The Circle is silent, then it bows.',
    'Keeper Oriane: The frontier has a new Warden of Wardens. Walk it however you please.',
    'You completed the Verdant Trial!',
    'Your journey is recorded in the Frontier Record. A New Journey+ awaits from the title screen.',
  ]);
  await afterBattle('win');
}

// ---------------------------------------------------------------- warps
async function doWarp(wp) {
  beginBusy();
  try {
    sfx('open');
    await fade('out', 0.3, '#000');
    const target = wp.to || 'world';
    if (target === 'world') {
      const rp = O.returnPoint || S.returnPoint;
      if (rp) enterMap('world', rp.x, rp.y, 'down');
      else if (wp.tx !== undefined) enterMap('world', wp.tx, wp.ty, wp.dir || 'down');
      else respawnAtHome();
      O.returnPoint = null;
      S.returnPoint = null;
    } else {
      O.returnPoint = { x: player.x, y: player.y + 1 };
      S.returnPoint = O.returnPoint;
      enterMap(target, wp.tx, wp.ty, wp.dir || 'down');
    }
    await fade('in', 0.3);
  } finally {
    endBusy();
  }
}

// ---------------------------------------------------------------- scene
O.enter = function () {
  O.t = 0;
  O.busyDepth = 0;
  O.returnPoint = S.returnPoint || null;
};

O.resume = function () { /* the sequence that acquired the lock releases it */ };

O.update = function (dt) {
  O.t += dt;
  updateBanner(dt);
  updateEffects(dt);
  updateAmbient(dt);
  if (!O.map || !O.cam) return;

  S.playtime += dt;
  advanceTime(dt * 0.5);   // a full in-game day is ~48 real minutes

  for (const e of O.entities) {
    if (e.update) e.update(dt, O.map);
  }

  if (O.busyDepth === 0 && !isDialogueOpen()) {
    handleInput(dt);
  }

  if (player.moving) {
    player.moveT += dt;
    player.animT += dt;
    // Drive the frame from progress THROUGH the step rather than a timer that
    // ticks over exactly as the step ends — frame 2 was being assigned on the
    // final tick and never rendered, so the same foot lifted on every tile.
    const prog = Math.min(0.999, player.moveT / Math.max(0.0001, player.moveDur));
    player.frame = player.stepParity ? (prog < 0.5 ? 1 : 2) : (prog < 0.5 ? 2 : 1);
    if (player.moveT >= player.moveDur) {
      player.moving = false;
      player.hopping = false;
      player.moveT = 0;
      player.frame = 0;
      player.fromX = player.x; player.fromY = player.y;
      onStepComplete();
    }
  }

  // Lead the camera in the direction of travel. It used to trail ~12px walking
  // and ~21px running, so sprinting actively showed you less of what was ahead.
  const lead = player.moving ? (O.lastRunning ? 22 : 12) : 0;
  const d = DELTA[player.dir] || [0, 0];
  O.cam.follow(player.px + TILE / 2 + d[0] * lead, player.py + TILE / 2 + d[1] * lead);
  O.cam.update(dt);
};

function handleInput(dt) {
  const { Keys, consume, pressed } = inputRefs;

  if (consume('start')) { openPauseMenu(); return; }
  if (consume('a')) { interact(); return; }

  if (player.moving) return;

  const dir = Keys.up ? 'up' : Keys.down ? 'down' : Keys.left ? 'left' : Keys.right ? 'right' : null;
  if (!dir) { O.turnHold = 0; return; }

  // Tapping a new direction turns in place before committing to a step.
  if (player.dir !== dir && O.turnHold < 0.08) {
    player.dir = dir;
    O.turnHold += dt;
    return;
  }
  O.turnHold = 0;
  // With autoRun on, Shift becomes a WALK key instead of a held run key.
  const running = S.options.autoRun ? !Keys.run : Keys.run;
  startStep(dir, running);
}

function onStepComplete() {
  if (S.mapId === 'world') markExplored(player.x, player.y);
  S.player.x = player.x; S.player.y = player.y; S.player.dir = player.dir;
  S.player.steps++;
  O.stepsSinceEncounter++;
  if (O.map && O.map.grassAt && O.map.grassAt(player.x, player.y)) {
    O.grassSteps++;
    // Tuft rustle only where there is actually tall growth — a green tuft on a
    // snow drift or a scree slope reads wrong; those get running dust instead.
    if (O.map.isTallAt && O.map.isTallAt(player.x, player.y)) addEffect('rustle', player.x, player.y);
    else if (O.lastRunning) addEffect('dust', player.fromX, player.fromY);
  } else if (O.lastRunning) {
    addEffect('dust', player.fromX, player.fromY);
  }
  if (S.repelSteps > 0) S.repelSteps--;

  const map = O.map;

  const wp = map.warpAt ? map.warpAt(player.x, player.y) : null;
  if (wp) { doWarp(wp); return; }

  const item = map.entityAt ? map.entityAt(player.x, player.y) : null;
  if (item && item.kind === 'item' && !(item.flag && getFlag(item.flag))) {
    beginBusy();
    talkTo(item).finally(() => { endBusy(); });
    return;
  }

  const watcher = findSighting();
  if (watcher) { triggerWatcher(watcher); return; }

  const wild = rollEncounter();
  if (wild) { doWildBattle(wild); }
}

function findSighting() {
  for (const e of O.entities) {
    if (e.kind !== 'trainer' || e.hidden || e.defeated || e.engaged) continue;
    if (e.flag && getFlag(e.flag)) continue;
    const d = e.seesPlayer ? e.seesPlayer(player.x, player.y, O.map) : 0;
    if (d > 0) return e;
  }
  return null;
}

async function triggerWatcher(e) {
  if (e.engaged) return;      // already walking over — never spawn a second chain
  e.engaged = true;
  beginBusy();
  try {
    sfx('error');
    await say('!', { speaker: e.name || 'Trainer' });
    // Walk the trainer up to the player.
    const d = DELTA[e.dir];
    let guard = 0;
    while (d && guard++ < 12) {
      const nx = e.x + d[0], ny = e.y + d[1];
      if (nx === player.x && ny === player.y) break;
      if (O.map.solidAt(nx, ny)) break;
      O.map.moveEntity(e, nx, ny);
      e.x = nx; e.y = ny;
      await waitSec(0.11);
    }
    e.facePoint(player.x, player.y);
    player.dir = OPPOSITE[e.dir] || player.dir;
    await startTrainerBattle(e);
  } finally {
    e.engaged = false;
    endBusy();
  }
}

function waitSec(s) { return new Promise((res) => setTimeout(res, s * 1000)); }

// ---------------------------------------------------------------- step effects
// Walking was completely silent and still — no rustle, no dust. These are the
// cheapest possible "the world reacted to me" feedback, and movement is the thing
// the player does most.
function addEffect(kind, tx, ty) {
  if (O.effects.length > 24) O.effects.shift();
  O.effects.push({ kind, x: tx * TILE, y: ty * TILE, t: 0, life: kind === 'dust' ? 0.32 : 0.36 });
}

function updateEffects(dt) {
  for (let i = O.effects.length - 1; i >= 0; i--) {
    const e = O.effects[i];
    e.t += dt;
    if (e.t >= e.life) O.effects.splice(i, 1);
  }
}

function renderEffects(ctx, cam) {
  for (const e of O.effects) {
    const k = Math.min(0.999, e.t / e.life);
    const sx = Math.round(e.x - cam.ox);
    const sy = Math.round(e.y - cam.oy);
    if (sx < -20 || sy < -20 || sx > W + 20 || sy > H + 20) continue;
    if (e.kind === 'rustle') {
      const frame = Math.min(2, Math.floor(k * 3));
      const key = 'grass_tuft_' + frame;
      if (hasSprite(key)) drawSprite(ctx, key, sx, sy + 8, { alpha: 1 - k * 0.35 });
    } else {
      // running dust: two small puffs drifting back and fading
      ctx.save();
      ctx.globalAlpha = (1 - k) * 0.55;
      ctx.fillStyle = '#d8cba8';
      const spread = Math.round(k * 5);
      ctx.fillRect(sx + 5 - spread, sy + 13 - Math.round(k * 3), 2, 2);
      ctx.fillRect(sx + 9 + spread, sy + 13 - Math.round(k * 2), 2, 2);
      ctx.restore();
    }
  }
}

// ---------------------------------------------------------------- ambient
// Idle motion so the world reads as alive while the player stands still:
// glints on open water, birds crossing the sky by day, wind gusts bending a
// travelling line through the grass. Pure presentation — nothing here touches
// gameplay state, so Math.random is fine (the same rule as battle shake).
const AMBIENT = { birds: [], nextBird: 6, gust: null, nextGust: 5 };

function updateAmbient(dt) {
  const outdoors = S.mapId === 'world';
  for (let i = AMBIENT.birds.length - 1; i >= 0; i--) {
    const b = AMBIENT.birds[i];
    b.x += b.vx * dt; b.t += dt;
    if (b.x < -48 || b.x > W + 48) AMBIENT.birds.splice(i, 1);
  }
  AMBIENT.nextBird -= dt;
  if (AMBIENT.nextBird <= 0) {
    AMBIENT.nextBird = 14 + Math.random() * 22;
    const h = (S.time / 60) % 24;
    // Birds keep daylight hours; the night sky staying still is part of what
    // makes night read as night.
    if (outdoors && h > 6 && h < 20) {
      const ltr = Math.random() < 0.5;
      const y = 14 + Math.random() * (H * 0.38);
      const n = 1 + ((Math.random() * 3) | 0);
      for (let i = 0; i < n; i++) {
        AMBIENT.birds.push({
          x: ltr ? -12 - i * 8 : W + 12 + i * 8,
          y: y + (i % 2) * 4 + i * 2,
          vx: (ltr ? 1 : -1) * (32 + Math.random() * 12),
          t: Math.random() * 2,
        });
      }
    }
  }
  if (AMBIENT.gust) {
    AMBIENT.gust.t += dt;
    if (AMBIENT.gust.t >= AMBIENT.gust.life) AMBIENT.gust = null;
  } else {
    AMBIENT.nextGust -= dt;
    if (AMBIENT.nextGust <= 0) {
      AMBIENT.nextGust = 9 + Math.random() * 14;
      if (outdoors) AMBIENT.gust = { t: 0, life: 1.7 };
    }
  }
}

// Under the actor pass: effects that belong to the ground plane.
function renderAmbientGround(ctx, cam) {
  const map = O.map;
  if (!map || S.mapId !== 'world') return;
  const tx0 = Math.floor(cam.ox / TILE), ty0 = Math.floor(cam.oy / TILE);
  const tw = Math.ceil(W / TILE) + 1, th = Math.ceil(H / TILE) + 1;
  const step = Math.floor(O.t * 2);
  const gustX = AMBIENT.gust ? (AMBIENT.gust.t / AMBIENT.gust.life) * (W + 80) - 40 : -1e9;
  for (let y = ty0; y <= ty0 + th; y++) {
    for (let x = tx0; x <= tx0 + tw; x++) {
      const g = map.at(x, y);
      if (isWater(g)) {
        // A per-tile hash re-picks a sparse set of glint tiles every half
        // second; each glint swells and dies inside its half-second slot.
        const hsh = ((x * 73856093) ^ (y * 19349663) ^ (step * 83492791)) >>> 0;
        if (hsh % 97 < 3) {
          const k = (O.t * 2) % 1;
          ctx.globalAlpha = 0.5 * Math.sin(k * Math.PI);
          ctx.fillStyle = '#eaf6ff';
          ctx.fillRect(x * TILE - cam.ox + (hsh % 12) + 1, y * TILE - cam.oy + ((hsh >> 4) % 12) + 1, 2, 1);
          ctx.globalAlpha = 1;
        }
      } else if (AMBIENT.gust && isGrass(g)) {
        const sx = x * TILE - cam.ox;
        const d = gustX - sx;
        if (d > 0 && d < 30) {
          // Light flecks riding the front, so the wind is a thing that ARRIVES
          // and passes rather than a uniform wobble.
          ctx.globalAlpha = 0.35 * (1 - d / 30);
          ctx.fillStyle = '#d8f0a0';
          ctx.fillRect(sx + ((x * 7 + y * 13) % 10) + 3, y * TILE - cam.oy + ((x * 5 + y * 3) % 8) + 4, 2, 1);
          ctx.globalAlpha = 1;
        }
      }
    }
  }
}

// Above the overlay, below the sky tint, so dusk colours the birds too.
function renderAmbientSky(ctx) {
  if (S.mapId !== 'world') return;
  for (const b of AMBIENT.birds) {
    const flap = Math.sin(b.t * 9) > 0;
    const x = Math.round(b.x), y = Math.round(b.y + Math.sin(b.t * 2.2) * 2);
    ctx.fillStyle = 'rgba(30,40,52,0.85)';
    ctx.fillRect(x - 2, y - (flap ? 1 : 0), 2, 1);
    ctx.fillRect(x + 1, y - (flap ? 1 : 0), 2, 1);
    ctx.fillRect(x, y, 1, 1);
  }
}

// ---------------------------------------------------------------- day / night
// Keyframes over a 24h clock: [hour, r, g, b, alpha]. Interpolated so the world
// slides between them instead of snapping at bucket boundaries.
const SKY_KEYS = [
  [0,   10, 16, 52, 0.62],   // deep night
  [5,   20, 28, 68, 0.54],   // late night
  [7,  126, 80, 58, 0.24],   // dawn warmth
  [9,    0,  0,  0, 0.00],   // morning, clear
  [16,   0,  0,  0, 0.00],   // day, clear
  [18, 156, 86, 40, 0.24],   // golden hour
  [20,  66, 42, 84, 0.40],   // dusk
  [22,  16, 22, 60, 0.56],   // night falls
  [24,  10, 16, 52, 0.62],
];

function skyOverlay() {
  const h = (S.time / 60) % 24;
  let a = SKY_KEYS[0], b = SKY_KEYS[SKY_KEYS.length - 1];
  for (let i = 0; i < SKY_KEYS.length - 1; i++) {
    if (h >= SKY_KEYS[i][0] && h <= SKY_KEYS[i + 1][0]) { a = SKY_KEYS[i]; b = SKY_KEYS[i + 1]; break; }
  }
  const span = Math.max(0.0001, b[0] - a[0]);
  const t = Math.max(0, Math.min(1, (h - a[0]) / span));
  const lerp = (i) => a[i] + (b[i] - a[i]) * t;
  return { r: Math.round(lerp(1)), g: Math.round(lerp(2)), b: Math.round(lerp(3)), a: lerp(4) };
}

function drawSky(ctx) {
  const map = O.map;
  if (!map) return;
  const indoor = !!(map.data && map.data.indoor) || String(S.mapId).startsWith('inside');
  const s = skyOverlay();
  // Interiors are lit, so they only pick up a fraction of the outdoor tint.
  const alpha = indoor ? s.a * 0.35 : s.a;
  if (alpha <= 0.005) return;
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = Math.min(0.8, alpha);
  ctx.fillStyle = 'rgb(' + Math.max(40, s.r + 90) + ',' + Math.max(40, s.g + 90) + ',' + Math.max(60, s.b + 90) + ')';
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = Math.min(0.4, alpha * 0.55);
  ctx.fillStyle = 'rgb(' + s.r + ',' + s.g + ',' + s.b + ')';
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// ---------------------------------------------------------------- render
O.render = function (ctx) {
  const map = O.map, cam = O.cam;
  if (!map || !cam) {
    ctx.fillStyle = '#101820';
    ctx.fillRect(0, 0, W, H);
    return;
  }

  ctx.fillStyle = '#0d1418';
  ctx.fillRect(0, 0, W, H);

  map.render(ctx, cam, 'ground');
  renderAmbientGround(ctx, cam);

  // Y-sorted actor pass so things overlap correctly.
  const actors = [];
  for (const e of O.entities) {
    if (e.hidden) continue;
    actors.push({ y: e.py !== undefined ? e.py : e.y * TILE, draw: () => e.render(ctx, cam) });
  }
  actors.push({ y: player.py, draw: () => drawPlayer(ctx, cam) });
  actors.sort((a, b) => a.y - b.y);
  for (const a of actors) a.draw();

  renderEffects(ctx, cam);
  map.render(ctx, cam, 'overlay');
  renderAmbientSky(ctx);

  drawSky(ctx);

  renderBanner(ctx);
  if (S.repelSteps > 0) {
    drawText(ctx, 'REPEL ' + S.repelSteps, 6, H - 12, { color: '#c8e0f0', shadow: '#101820' });
  }
};

function drawPlayer(ctx, cam) {
  const sx = Math.round(player.px - cam.ox);
  let sy = Math.round(player.py - cam.oy);
  if (player.hopping) {
    const p = Math.min(1, player.moveT / player.moveDur);
    sy -= Math.round(Math.sin(p * Math.PI) * 10);
  }

  if (hasSprite('shadow')) drawSprite(ctx, 'shadow', sx, sy + 16, { alpha: 0.45 });

  const dirWanted = player.dir;
  const hasRight = hasSprite(walkKey('hero', 'right', 0));
  const dir = (dirWanted === 'right' && !hasRight) ? 'left' : dirWanted;
  const flip = dir !== dirWanted;
  let key = walkKey('hero', dir, player.moving ? player.frame : 0);
  if (!hasSprite(key)) key = walkKey('hero', dir, 0);
  if (!hasSprite(key)) key = walkKey('hero', 'down', 0);

  const inTall = O.map.isTallAt && O.map.isTallAt(player.x, player.y) && !player.moving;
  if (inTall) {
    // Clip the lower third so the player reads as standing in the grass.
    ctx.save();
    ctx.beginPath();
    ctx.rect(sx - 4, sy - 12, 24, 22);
    ctx.clip();
    drawSprite(ctx, key, sx, sy - 8, { flip });
    ctx.restore();
  } else {
    drawSprite(ctx, key, sx, sy - 8, { flip });
  }
}

// input is imported lazily to keep this module Node-importable for tests
import * as inputRefs from './input.js';

export const Overworld = O;
export default O;
