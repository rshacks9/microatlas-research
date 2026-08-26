# VERDANT FRONTIER — Module Interface Contract (FROZEN v1)

Every module is authored against this document. Do not change a signature here without
updating this file first. Agents implementing a module MUST implement exactly these exports.

## Hard rules

1. **ES modules only.** `import ... from './x.js'` with the `.js` extension. No bundler, no npm,
   no CDN, no external assets of any kind.
2. **No top-level DOM access** in: `types.js`, `creatures.js`, `moves.js`, `items.js`, `rng.js`,
   `battlecalc.js`, `party.js`, `tiles.js`, `worldgen.js`, `towns.js`.
   These must be importable in Node for headless simulation. (DOM is fine inside functions that
   are only called from the browser, but nothing at import time.)
3. **Original IP only.** No Nintendo/Game Freak names, creature names, move names, town names,
   or melodies. Everything is original.
4. Internal resolution is **320x240**, tile size **16px**, so the view is 20x15 tiles.
5. Never use `innerHTML` with any player-supplied string. Use `textContent`.
6. All randomness in world/creature generation goes through `rng.js` so it is seed-deterministic.

## Coordinate conventions

- Tile coords are integers `(tx, ty)`. Pixel coords are `(px, py) = (tx*16, ty*16)`.
- `dir` is one of `'down' | 'up' | 'left' | 'right'`. Numeric dir order where needed: 0=down, 1=up, 2=left, 3=right.
- Map index is `ty * map.w + tx`.

---

## game.js — shared runtime context + scene stack

```js
export const W = 320, H = 240, TILE = 16;

export const Game = {
  canvas: null,          // HTMLCanvasElement, set by main.js
  ctx: null,             // CanvasRenderingContext2D (320x240 backing store)
  scenes: [],            // scene stack, last = active
  t: 0,                  // seconds since boot
  paused: false,
};

export function pushScene(scene, params);   // calls scene.enter(params)
export function popScene(result);           // calls top.exit(), then below.resume(result)
export function replaceScene(scene, params);
export function topScene();
export function fade(kind, durationSec);    // kind: 'out'|'in'; returns Promise
export function isFading();
export function renderFade(ctx);            // main.js calls this last, every frame
```

### Scene interface (duck-typed, no base class required)

```js
{
  opaque: true,               // if false, the scene below is rendered first
  enter(params) {},           // called on push
  exit() {},                  // called on pop
  resume(result) {},          // called when a scene above it pops, with that pop's result
  update(dt) {},              // dt is always 1/60
  render(ctx) {},
}
```

Every field is optional except `update` and `render`.

---

## rng.js — seeded determinism

```js
export function mulberry32(seed);            // -> () => float in [0,1)
export function hash2(seed, x, y);           // -> uint32, stable spatial hash
export function makeRng(seed);               // -> { next(), int(n), range(a,b), pick(arr), chance(p), shuffle(arr) }
export function valueNoise2(seed, x, y);     // -> float in [0,1), smooth
export function fbm(seed, x, y, octaves, lacunarity, gain); // -> float in [0,1)
export const rand = { int(n), range(a,b), pick(arr), chance(p), float() }; // unseeded, for VFX only
```

`fbm` must be normalized to [0,1). Battle RNG uses `rand` (unseeded); world gen uses `makeRng(seed)`.

---

## types.js — type chart

```js
export const TYPES = ['PLAIN','EMBER','TIDE','BLOOM','SPARK','FROST','BRAWL','TOXIN','TERRA','GALE','PSION','UMBRA','ALLOY'];
export const TYPE_NAMES = { PLAIN:'Plain', EMBER:'Ember', ... };   // display names
export const TYPE_COLORS = { PLAIN:'#a8a878', ... };               // CSS hex per type
export function effectiveness(atkType, defTypes);  // defTypes: string[]; -> 0 | 0.25 | 0.5 | 1 | 2 | 4
export function matchupText(mult);                 // -> '' | 'It barely registered...' | "It's not very effective..." | "It's super effective!"
```

---

## Data record shapes

### Species (creatures.js)
```js
{
  id: 'sproutle',                  // lowercase, unique
  dexNo: 1,                        // 1..N, contiguous
  name: 'Sproutle',
  types: ['BLOOM'],                // 1 or 2 entries from TYPES
  base: { hp:45, atk:49, def:49, spa:65, spd:65, spe:45 },   // each 1..255
  catchRate: 45,                   // 3..255, higher = easier
  expYield: 64,
  growth: 'fast'|'medium'|'slow',
  learnset: [[1,'tackle'], [7,'leafcut']],   // sorted ascending by level
  evolve: null | { level: 16, into: 'speciesId' },
  biomes: ['MEADOW','FOREST'],     // BIOME keys it spawns in; [] = does not spawn wild
  rarity: 'common'|'uncommon'|'rare'|'legendary',
  height: 0.7, weight: 6.9,        // metres, kg (flavour)
  entry: 'One-sentence dex flavour text.',
  sprite: 'sproutle',              // key into SPRITES
}
```

### Move (moves.js)
```js
{
  id: 'leafcut',
  name: 'Leaf Cut',
  type: 'BLOOM',
  category: 'physical'|'special'|'status',
  power: 55,           // 0 for status moves
  accuracy: 95,        // 0..100; 0 means "never misses"
  pp: 25,
  priority: 0,         // -6..+6
  desc: 'Short description shown in the move menu.',
  effect: null | EffectSpec,
}
```

`EffectSpec` is exactly one of:
```js
{ kind:'status',   status:'brn'|'psn'|'par'|'slp'|'frz', chance:100 }
{ kind:'stat',     target:'self'|'foe', stat:'atk'|'def'|'spa'|'spd'|'spe'|'acc'|'eva', stages:-2..2, chance:100 }
{ kind:'heal',     frac:0.5 }
{ kind:'drain',    frac:0.5 }
{ kind:'recoil',   frac:0.33 }
{ kind:'multihit', min:2, max:5 }
{ kind:'flinch',   chance:30 }
{ kind:'confuse',  chance:100 }
{ kind:'crit',     stages:1 }
{ kind:'ohko' }
{ kind:'fixed',    amount:20 }
```

### Item (items.js)
```js
{
  id:'potion', name:'Potion',
  kind:'heal'|'ball'|'cure'|'revive'|'repel'|'boost'|'key',
  price: 300,              // 0 = not sold
  desc: 'Restores 20 HP to one creature.',
  inBattle: true, inField: true,
  effect: { kind:'heal', amount:20 }
        | { kind:'ball', rate:1.0, name:'Orb' }
        | { kind:'cure', status:'psn'|'all' }
        | { kind:'revive', frac:0.5 }
        | { kind:'repel', steps:100 }
        | { kind:'boost', stat:'atk', stages:1 }
        | null,
}
```

### Creature instance (runtime, created by party.js)
```js
{
  species: 'sproutle',
  nickname: null,
  level: 5,
  exp: 0,
  ivs: { hp:0..31, atk:.., def:.., spa:.., spd:.., spe:.. },
  hp: 20,                        // CURRENT hp
  status: null|'brn'|'psn'|'par'|'slp'|'frz',
  sleepTurns: 0,
  moves: [ { id:'tackle', pp:35, ppMax:35 } ],   // 1..4 entries
  ball: 'orb',
  met: { level:5, where:'Willowmere' },
}
```

### MapData (worldgen.js / towns.js)
```js
{
  id: 'world' | 'town:0' | 'cave:3' | 'inside:heal:0',
  w, h,                          // tiles
  ground: Uint16Array(w*h),      // tile id, never 0 on a valid map
  overlay: Uint16Array(w*h),     // tile id, 0 = nothing
  biome: Uint8Array(w*h)|null,   // BIOME_IDS index, world map only
  warps: [ { x, y, to:'cave:3', tx:5, ty:9, dir:'down' } ],
  entities: [ EntitySpec ],
  spawn: { x, y },
  indoor: false,
  bgm: 'overworld'|'town'|'cave'|'battle'|'wild',
  name: 'Willowmere',            // shown on the location banner
}
```

### EntitySpec (entities.js)

The `Entity` wrapper carries EVERY spec field through — fields it does not
model explicitly are copied verbatim (specs come from our own generators,
never from saves). A field the wrapper drops is a feature that silently never
fires; the Warden Seal award shipped dead exactly this way.

```js
{
  kind: 'npc'|'trainer'|'sign'|'item'|'heal'|'shop'|'door',
  x, y, dir:'down',
  sprite: 'npc_villager',
  name: 'Villager',
  wander: false,                 // npc only
  lines: ['Hello there!'],       // npc/sign dialogue
  sight: 4,                      // trainer only: LOS range in tiles
  team: [ { species:'sproutle', level:8 } ],  // trainer only
  prize: 200,                    // trainer only
  itemId: 'potion',              // item pickup only
  flag: 'trainer_0_beaten',      // event flag key; entity is hidden/disabled when set
  to: 'inside:heal:0',           // door only
}
```

---

## tiles.js

```js
export const TILE = 16;
export const T = {                      // tile ids — FROZEN, do not renumber
  VOID:0, DEEPWATER:1, WATER:2, SHALLOW:3, SAND:4, GRASS:5, TALLGRASS:6, DIRT:7, PATH:8,
  ROCK:9, CLIFF:10, SNOW:11, ICE:12, MARSH:13, JUNGLE:14, ASH:15, LAVA:16,
  TREE:17, PINE:18, PALM:19, CACTUS:20, BUSH:21, FLOWER:22, STUMP:23,
  FLOOR_WOOD:24, FLOOR_TILE:25, FLOOR_CAVE:26, WALL_BRICK:27, WALL_CAVE:28, WALL_WOOD:29,
  ROOF_RED:30, ROOF_BLUE:31, ROOF_GREY:32, WALL_HOUSE:33, DOOR:34, WINDOW:35,
  SIGN:36, FENCE:37, LEDGE_D:38, STAIRS:39, COUNTER:40, TABLE:41, SHELF:42,
  CARPET:43, WATER_EDGE:44, BRIDGE:45, PUDDLE:46, TALLGRASS_DARK:47, MUSHROOM:48,
  CRYSTAL:49, GRAVEL:50, SAVANNA:51, TUNDRA:52,
};
export const TILE_COUNT = 53;

export const TILE_DEFS = [ /* indexed by tile id, length TILE_COUNT */
  { name:'void', solid:true, grass:false, water:false, ledge:null, encounterRate:0, colors:['#000'] },
];
export function isSolid(id);
export function isGrass(id);       // triggers encounters + occludes player legs
export function isWater(id);
export function ledgeDir(id);      // null | 'down' — hop-down one-way
export function isCounter(id);     // talkable-through
export function encounterRate(id); // 0..1 per step
```

## tileset.js — procedural atlas (browser only)

```js
export function buildAtlas();                       // rasterize once; idempotent
export function getAtlas();                         // -> HTMLCanvasElement
export function drawTile(ctx, id, px, py, mask=0);  // mask = 4-bit neighbour-differs bitmask (1=N,2=E,4=S,8=W)
export function tileVariantCount(id);
```

## sprites.js — pixel art (browser only for raster; DATA is plain)

Sprite data format:
```js
{ w:16, h:24, pal:['#000000','#ffffff'], rows:['..00..','.0110.'] }
```
Each char is `'.'` for transparent, else its index in `'0123456789abcdefghijklmnopqrstuv'`
selects `pal[i]`. Every row string must be exactly `w` chars; there must be exactly `h` rows.

```js
export const SPRITES = { key: SpriteData };
export function getSprite(key);                  // -> HTMLCanvasElement (cached)
export function getFlipped(key);                 // -> horizontally mirrored canvas (cached)
export function drawSprite(ctx, key, x, y, opts); // opts: { flip, alpha, tint, scale }
export function hasSprite(key);
```

Required sprite keys:
- Player/NPC walk sheets, 16x24, 3 frames per direction, keys:
  `hero_down_0..2`, `hero_up_0..2`, `hero_left_0..2`, `hero_right_0..2` (right may be flipped left)
- Same pattern for `npc_villager_*`, `npc_elder_*`, `npc_kid_*`, `trainer_hiker_*`, `trainer_angler_*`, `trainer_scout_*`
- One 32x32 creature sprite per species, key = species `sprite` field. Back sprites are derived by
  flipping + scaling — do not author separate back sprites.
- UI: `ball_orb`, `ball_great`, `ball_ultra`, `cursor`

## camera.js
```js
export function makeCamera(map);   // -> { x, y, follow(px,py,instant), shake(mag,dur), update(dt), clampTo(map) }
```
`cam.x/cam.y` are pixel coords of the top-left of the 320x240 view, clamped to map bounds
(or centred when the map is smaller than the view).

## worldgen.js
```js
export const BIOMES = ['OCEAN','BEACH','MEADOW','FOREST','JUNGLE','SWAMP','DESERT','SAVANNA','TUNDRA','MOUNTAIN','PEAK'];
export function generateWorld(seed);   // -> { map: MapData, towns: [{x,y,name,id}], caves: [...],
                                       //      shrines: [{x,y,species}], start:{x,y} }
// Legendaries are NOT in encounter tables: each has a fixed shrine entity
// (kind:'shrine', Seal-gated by overworld.js) at the far reach of its biome.
// Roadside signposts (kind:'sign') outside each town name the two nearest
// settlements with distance + compass and the wild level along the route.
export function biomeAt(world, x, y);  // -> BIOME string
export function levelAt(world, x, y);  // -> 2..60, scales with distance from start town
export function encounterTableFor(biome); // -> [ { species, weight, minLvl, maxLvl } ]
```
World is 384x384 (WORLD_W/WORLD_H). `generateWorld` must be pure and deterministic in `seed`.

## towns.js
```js
export function stampTown(map, x, y, rng, index, tier); // mutates world map, returns { name, entities, warps, doors }
export function buildInterior(kind, seed, index, hint); // kind: 'heal'|'shop'|'house'|'cave' -> MapData
// hint (optional, caves): { biome, level } from the cave mouth — picks the
// interior palette family and encounter level; caves carry a BFS-farthest
// heart chamber with crystals and dense encounter ground.
export const TOWN_NAMES = ['Willowmere', ...];
```

## tilemap.js

**Liveness rule (`isLive`)**: a set `flag` spends one-shot entities (pickups, gift
NPCs, doors) — `entityAt`/`entityList` hide them. Beaten trainers and stilled
shrines REMAIN: present, blocking, interactable with their after-lines. All
filters must go through `isLive`; never re-implement `flag && getFlag(flag)`.

```js
export class GameMap {
  constructor(data);              // data = MapData
  get w(); get h();
  at(x,y);                        // ground tile id, T.VOID out of bounds
  overlayAt(x,y);
  setTile(x,y,id,layer='ground');
  solidAt(x,y);                   // tile solid OR a blocking entity stands there
  grassAt(x,y);
  warpAt(x,y);                    // -> warp | null
  entityAt(x,y);                  // -> Entity | null
  render(ctx, cam, layer);        // layer: 'ground' | 'overlay'
}
```

## input.js
```js
export const Keys = { up, down, left, right, a, b, start, select, run };  // booleans, held state
export function pressed(name);    // true for exactly one frame after press (edge)
export function consume(name);    // pressed() + clears it
export function anyPressed();
export function initInput(canvasEl, touchRootEl);
export function updateInput();    // called once per frame AFTER scene updates, to roll edges
export function setTouchVisible(v);
```

## ui.js — shared drawing (browser only)
```js
export const PAL = { ink:'#182028', paper:'#f8f4e8', shadow:'#5a6472', accent:'#3868b8',
                     hpGood:'#48c058', hpWarn:'#f0c020', hpBad:'#e04038', frame:'#283848' };
export function drawWindow(ctx, x, y, w, h, opts);       // 9-slice styled box
export function drawText(ctx, text, x, y, opts);         // opts: { color, shadow, max }
export function textWidth(text);
export function wrapText(text, maxPx);                   // -> string[]
export function drawBar(ctx, x, y, w, h, frac, color);
export function drawHpBar(ctx, x, y, w, cur, max);       // colour changes at 50%/20%
export function drawCursor(ctx, x, y, t);                // animated selection arrow
export function drawTypeBadge(ctx, type, x, y);
```

## font.js
```js
export const GLYPH_W = 5, GLYPH_H = 7, GLYPH_SPACING = 1;
export const GLYPHS = { 'A': ['.###.','#...#',...] };   // 7 rows of 5 chars, '#' = ink
export function glyphFor(ch);                            // -> string[] | null
```
`ui.drawText` MUST fall back to `ctx.fillText` with a monospace font for any missing glyph, so a
partial font never crashes rendering.

## battlecalc.js — pure battle math, NO DOM (Node-importable)
```js
export function statsFor(inst);                  // -> {hp,atk,def,spa,spd,spe} using species base + ivs + level
export function maxHp(inst);
export function expForLevel(growth, level);
export function levelForExp(growth, exp);
export function stageMul(stage);                 // -6..6 -> multiplier
export function accStageMul(stage);
export function damage(attacker, defender, move, opts); // -> { dmg, mult, crit, missed }
export function catchChance(target, ballRate, statusName);   // -> { shakes:0..4, caught:boolean }
export function expGain(defeated, participants, isTrainer);
export function aiChooseMove(self, foe, difficulty);         // -> move index
```
`damage` uses `opts.rng` if provided (a `() => float`), else `rand.float()`, so simulations are
reproducible.

## party.js
```js
export function makeCreature(speciesId, level, opts);  // rolls ivs + learnset moves
export function displayName(inst);
export function heal(inst);
export function healParty();
export function addToParty(inst);      // -> 'party'|'box'|'full'
export function firstHealthy();
export function partyWiped();
export function giveExp(inst, amount); // -> { leveled:[], learned:[], evolved:null }
export function tryEvolve(inst);       // -> newSpeciesId | null
export function learnMove(inst, moveId, replaceIndex);
```

## items.js
```js
export const ITEMS = { id: ItemRecord };
export function getItem(id);
export function useItem(id, targetInst, context);  // context: 'battle'|'field' -> { ok, message, consumed }
export function shopStock(tier);                   // -> itemId[]
```

## dialogue.js
```js
export function say(lines, opts);      // -> Promise, pushes a dialogue scene
export function ask(prompt, choices);  // -> Promise<number> (index chosen)
export function showBanner(text, sec); // location banner, non-blocking
export function isDialogueOpen();
export function updateBanner(dt);
export function renderBanner(ctx);
```

## menus.js
```js
export function openPauseMenu();       // pushes scene
export function openParty(opts);       // -> Promise<number|null> chosen index
export function openBag(opts);         // -> Promise<string|null> chosen item id
export function openDex();
export function openWorldMap(world);
export function openShop(stock);
```

## save.js
```js
export const SAVE_KEY_PREFIX = 'verdant.save.';
export function saveGame(slot);        // -> boolean
export function loadGame(slot);        // -> boolean (rehydrates state + world)
export function hasSave(slot);
export function slotSummary(slot);     // -> { name, playtime, badges, dexCaught, party } | null
export function deleteSave(slot);
export function encodeMap(mapData);    // RLE -> compact string
export function decodeMap(str);        // -> MapData
```
`loadGame` MUST tolerate corrupt/hostile JSON: wrap in try/catch, validate every field with a
whitelist, use `Object.create(null)` for map-like objects, and never trust array lengths.

## audio.js
```js
export function initAudio();           // must be called from a user gesture
export function playBgm(name);         // 'title'|'town'|'overworld'|'overworld2'|'cave'|'cave2'
                                       // |'battle'|'battle_warden'|'victory'
export function stopBgm();
export function sfx(name);             // 'select'|'cancel'|'bump'|'hit'|'hit_weak'|'hit_super'|'crit'|'faint'
                                       // |'catch'|'lock'|'tick'|'fanfare_catch'|'heal'|'levelup'|'encounter'
                                       // unknown names are silent no-ops — callers may wire ahead of the table
export function setMusicEnabled(v);
export function setSfxEnabled(v);
export function setMusicDuck(v);       // 0..1 music gain multiplier, ~0.25s slew; battle ducks under danger/capture
export function isAudioReady();
```
Every function must be a safe no-op if the AudioContext is unavailable or suspended.

## state.js

Wave-6 additions:
```js
export const EXPLORE_CELL = 4, EXPLORE_W = 96, EXPLORE_H = 96;
export function markExplored(x, y, radius = 6);  // chart cells near a world tile
export function isExplored(x, y);                // world-tile query; false pre-reset
export function getRecord();      // device-lifetime Frontier Record (own storage key)
export function updateRecord({ adds, maxes });   // increments + high-water marks
```
`S.explored` is a Uint8Array of 4x4-tile cells; saves persist it (save.js).
The Record never lives inside a save slot — it survives New Journey and
deleted saves, and every storage access degrades silently when blocked.

```js
export const S = {
  seed: 0, world: null, map: null, mapId: 'world',
  player: { x:0, y:0, dir:'down', name:'Rowan', money:3000, steps:0 },
  party: [], boxes: [], bag: {}, dex: { seen:{}, caught:{} },
  flags: {}, time: 480, playtime: 0,
  options: { textSpeed:2, music:true, sfx:true },
  repelSteps: 0,
};
export function resetState(seed, name);
export function setFlag(k, v); export function getFlag(k);
export function addMoney(n); export function spendMoney(n);  // spendMoney -> boolean
export function addItem(id, n); export function removeItem(id, n); export function itemCount(id);
export function seeSpecies(id); export function catchSpecies(id);
export function timeOfDay();   // -> 'morning'|'day'|'evening'|'night'
```

## overworld.js

`TRIAL_KEEPERS` (exported): the three Verdant Trial gauntlet trainers, offered
when `S.badges >= town count` and re-offered by any beaten Warden until the
`trial_done` flag is set. No legendaries; endgame level band 50-64
(tools/check-entities.mjs enforces both).

```js
export const Overworld = { /* scene */ };
export function enterMap(mapId, x, y, dir);
```

## battle.js
```js
export function startBattle(opts);   // opts: { wild: creatureInst } | { trainer: EntitySpec }
                                     // -> Promise<'win'|'lose'|'caught'|'ran'>
```

## main.js
Boots everything: sizes the canvas, `initInput`, `buildAtlas`, title screen, then the run loop
(fixed 1/60 accumulator, `requestAnimationFrame`).

---

## Addendum — data module exports (required)

```js
// creatures.js
export const SPECIES;                 // { id: SpeciesRecord }
export function getSpecies(id);       // -> SpeciesRecord (never undefined; returns a safe fallback)
export function allSpecies();         // -> SpeciesRecord[] sorted by dexNo
export function speciesByDex(n);
export const DEX_COUNT;
export const STARTERS;                // [speciesId, speciesId, speciesId]

// moves.js
export const MOVES;                   // { id: MoveRecord }
export function getMove(id);          // -> MoveRecord (never undefined; safe fallback)
export function allMoves();
```

`getSpecies`/`getMove` must NEVER return undefined — an unknown id returns a documented
placeholder record so a corrupt save can't crash the battle engine.
