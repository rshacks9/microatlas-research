// The overworld scene: grid movement, encounters, warps, interaction, trainer sight.
import { Game, W, H, pushScene, popScene, transition, fade } from './game.js';
import { TILE, T, isGrass, ledgeDir, isCounter } from './tiles.js';
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
import { S, advanceTime, addItem, setFlag, getFlag, seeSpecies, spendMoney, timeOfDay } from './state.js';
import { getSpecies, STARTERS } from './creatures.js';
import { makeRng, rand } from './rng.js';
import { playBgm, sfx } from './audio.js';
import { drawText, drawWindow, PAL } from './ui.js';

// Every settlement has exactly one Warden, so the Seal target is the town count.
export const TOTAL_WARDENS = 10;

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
  busy: false,          // true while a blocking sequence (battle, dialogue, warp) runs
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
    data = buildInterior(kind, interiorSeed(mapId), index);
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
  }

  O.cam = makeCamera(map);
  O.cam.follow(player.px + TILE / 2, player.py + TILE / 2, true);
  O.stepsSinceEncounter = 0;
  O.effects = [];
  O.busy = false;
  O.pendingWatcher = null;

  playBgm(data.bgm || (mapId === 'world' ? 'overworld' : 'town'));
  // Name the place you are actually standing in. The world map's own name was
  // being shown for every town, so settlements the generator named were nameless
  // to the player.
  const here = (mapId === 'world') ? townNameAt(player.x, player.y) : data.name;
  if (here) showBanner(here, 2.2);
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
  if (String(S.mapId).startsWith('cave')) return Math.max(4, Math.min(45, 8 + ((S.seed % 7) | 0)));
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

  let total = 0;
  for (const e of table) total += weightFor(e);
  if (total <= 0) return null;
  let r = rand.float() * total;
  let pick = table[0];
  for (const e of table) { r -= weightFor(e); if (r <= 0) { pick = e; break; } }
  if (!pick || !pick.species) return null;

  // Difficulty comes from DISTANCE, not from the biome table. The table's level range
  // says where a species sits relative to its peers; `base` (levelAt) says how dangerous
  // THIS spot is. Rolling the table range straight would put level-23 tundra wilds next
  // to the start town, which kills the whole "walk any direction, danger scales" premise.
  const base = wildLevelHere();
  const lo = pick.minLvl !== undefined ? pick.minLvl : Math.max(2, base - 2);
  const hi = pick.maxLvl !== undefined ? pick.maxLvl : base + 1;
  const roll = rand.range(Math.min(lo, hi), Math.max(lo, hi));
  const floor = Math.max(2, base - 3);
  const ceil = Math.max(floor, base + 4);
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
  O.busy = true;
  sfx('encounter');
  await encounterWipe();
  // startBattle pushes the battle scene synchronously, so fade back IN over it.
  // Without this the screen stays under a full-alpha black overlay for the whole battle.
  const battle = startBattle({ wild });
  await fade('in', 0.3);
  const result = await battle;
  await afterBattle(result);
  O.busy = false;
}

async function afterBattle(result) {
  O.stepsSinceEncounter = 0;
  if (result === 'lose' || partyWiped()) {
    await fade('out', 0.4, '#000');
    // Losing used to cost nothing at all, which also meant winning carried no
    // relief. The cost is deliberately mild: a slice of your credits, capped, and
    // never enough to leave you unable to restock.
    const money = S.player.money | 0;
    const fee = Math.min(Math.floor(money * 0.25), 400 + (S.badges | 0) * 250);
    if (fee > 0) S.player.money = money - fee;

    const where = nearestTown();
    await say(fee > 0
      ? ['You have no creatures able to battle!',
         'You scrambled back to ' + where.name + ', dropping ' + fee + ' credits along the way.']
      : ['You have no creatures able to battle!',
         'You scrambled back to ' + where.name + '.']);
    healParty();
    enterMap('world', where.x, where.y, 'down');
    await fade('in', 0.4);
    playBgm('town');
    return;
  }
  // The battle scene has popped and the overworld is visible again; a short dip
  // covers the swap rather than snapping.
  await fade('out', 0.18, '#000');
  await fade('in', 0.28);
  playBgm(S.mapId === 'world' ? 'overworld' : (String(S.mapId).startsWith('cave') ? 'cave' : 'town'));
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
  let best = towns[0], bestD = Infinity;
  for (const t of towns) {
    const d = Math.max(Math.abs(t.x - player.x), Math.abs(t.y - player.y));
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

  if (e && !(e.flag && getFlag(e.flag))) {
    O.busy = true;
    try { await talkTo(e); } finally { O.busy = false; }
    return true;
  }

  const tile = map.at(f.x, f.y);
  if (tile === T.SIGN) {
    O.busy = true;
    await say('A weathered signpost. The paint has long since faded.');
    O.busy = false;
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
      await say('You found a ' + getItem(id).name + '!');
      return;
    }
    if (e.kind === 'trainer') {
      if (e.flag && getFlag(e.flag)) {
        // Already beaten: they stay put and acknowledge it, rather than the world
        // quietly deleting everyone you have defeated.
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
  const slot = seals === 3 ? 0 : seals === 6 ? 1 : -1;
  if (slot < 0) return;

  const unchosen = STARTERS.filter((id) => !getFlag('starter_' + id));
  const already = unchosen.filter((id) => getFlag('granted_' + id));
  const remaining = unchosen.filter((id) => !getFlag('granted_' + id));
  if (!remaining.length) return;
  const giveId = remaining[0];

  // Match the player's current team so the gift is usable, not a museum piece.
  let lvl = 5;
  for (const c of S.party) if (c && c.level > lvl) lvl = c.level;
  lvl = Math.max(5, Math.min(60, lvl - 2));

  const gift = makeCreature(giveId, lvl, { where: 'a Warden' });
  const dest = addToParty(gift);
  setFlag('granted_' + giveId, true);
  sfx('levelup');
  if (dest === 'full') {
    await say('The Warden offers you a companion, but you have nowhere to put it.');
    setFlag('granted_' + giveId, false);
    return;
  }
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
      'The Warden hands you a Seal.',
      'Seals: ' + S.badges + ' of ' + TOTAL_WARDENS + '.  Every settlement out there has one.',
    ]);
    await grantStarterMilestone();
  }
  e.defeated = result === 'win';
  await afterBattle(result);
}

// ---------------------------------------------------------------- warps
async function doWarp(wp) {
  O.busy = true;
  try {
    sfx('open');
    await fade('out', 0.3, '#000');
    const target = wp.to || 'world';
    if (target === 'world') {
      const rp = O.returnPoint;
      if (rp) enterMap('world', rp.x, rp.y, 'down');
      else if (wp.tx !== undefined) enterMap('world', wp.tx, wp.ty, wp.dir || 'down');
      else respawnAtHome();
      O.returnPoint = null;
    } else {
      O.returnPoint = { x: player.x, y: player.y + 1 };
      enterMap(target, wp.tx, wp.ty, wp.dir || 'down');
    }
    await fade('in', 0.3);
  } finally {
    O.busy = false;
  }
}

// ---------------------------------------------------------------- scene
O.enter = function () {
  O.t = 0;
  O.busy = false;
};

O.resume = function () {
  O.busy = false;
};

O.update = function (dt) {
  O.t += dt;
  updateBanner(dt);
  updateEffects(dt);
  if (!O.map || !O.cam) return;

  S.playtime += dt;
  advanceTime(dt * 0.5);   // a full in-game day is ~48 real minutes

  for (const e of O.entities) {
    if (e.update) e.update(dt, O.map);
  }

  if (!O.busy && !isDialogueOpen()) {
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
  startStep(dir, Keys.run);
}

function onStepComplete() {
  S.player.x = player.x; S.player.y = player.y; S.player.dir = player.dir;
  S.player.steps++;
  O.stepsSinceEncounter++;
  if (O.map && O.map.grassAt && O.map.grassAt(player.x, player.y)) {
    O.grassSteps++;
    addEffect('rustle', player.x, player.y);
  } else if (O.lastRunning) {
    addEffect('dust', player.fromX, player.fromY);
  }
  if (S.repelSteps > 0) S.repelSteps--;

  const map = O.map;

  const wp = map.warpAt ? map.warpAt(player.x, player.y) : null;
  if (wp) { doWarp(wp); return; }

  const item = map.entityAt ? map.entityAt(player.x, player.y) : null;
  if (item && item.kind === 'item' && !(item.flag && getFlag(item.flag))) {
    O.busy = true;
    talkTo(item).finally(() => { O.busy = false; });
    return;
  }

  const watcher = findSighting();
  if (watcher) { triggerWatcher(watcher); return; }

  const wild = rollEncounter();
  if (wild) { doWildBattle(wild); }
}

function findSighting() {
  for (const e of O.entities) {
    if (e.kind !== 'trainer' || e.hidden || e.defeated) continue;
    if (e.flag && getFlag(e.flag)) continue;
    const d = e.seesPlayer ? e.seesPlayer(player.x, player.y, O.map) : 0;
    if (d > 0) return e;
  }
  return null;
}

async function triggerWatcher(e) {
  O.busy = true;
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
    O.busy = false;
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
