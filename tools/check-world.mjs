// Worldgen invariants: determinism, performance, connectivity, biome spread,
// difficulty curve, and encounter-table sanity. Run: node tools/check-world.mjs [seeds]
import { generateWorld, biomeAt, levelAt, encounterTableFor, BIOMES, WORLD_W, WORLD_H }
  from '../game/js/worldgen.js';
import { isSolid, overlayBlocks, T } from '../game/js/tiles.js';
import { getSpecies } from '../game/js/creatures.js';

const N = parseInt(process.argv[2] || '12', 10);
let fails = 0;
const fail = (m) => { fails++; console.log('  FAIL ' + m); };

// 4-way flood fill over non-solid ground tiles.
function reachable(map, sx, sy) {
  const seen = new Uint8Array(map.w * map.h);
  const stack = [sy * map.w + sx];
  seen[sy * map.w + sx] = 1;
  let count = 0;
  while (stack.length) {
    const i = stack.pop();
    count++;
    const x = i % map.w, y = (i / map.w) | 0;
    const push = (nx, ny) => {
      if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) return;
      const j = ny * map.w + nx;
      if (seen[j]) return;
      if (isSolid(map.ground[j]) || overlayBlocks(map.overlay[j])) return;
      seen[j] = 1;
      stack.push(j);
    };
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  return { seen, count };
}

console.log('=== WORLDGEN INVARIANTS (' + N + ' seeds) ===');
const times = [];
let totalTowns = 0, totalCaves = 0;
const biomeSeen = new Set();

for (let s = 0; s < N; s++) {
  const seed = 1000 + s * 7919;
  const t0 = performance.now();
  let w;
  try { w = generateWorld(seed); }
  catch (e) { fail('seed ' + seed + ' threw: ' + e.message); continue; }
  const ms = performance.now() - t0;
  times.push(ms);

  if (!w || !w.map || !w.map.ground) { fail('seed ' + seed + ' returned no map'); continue; }
  const map = w.map;

  if (map.w !== WORLD_W || map.h !== WORLD_H) fail('seed ' + seed + ' wrong size ' + map.w + 'x' + map.h);
  if (!w.start) { fail('seed ' + seed + ' has no start'); continue; }

  const si = w.start.y * map.w + w.start.x;
  if (isSolid(map.ground[si]) || overlayBlocks(map.overlay[si])) fail('seed ' + seed + ' start is inside a solid tile');

  const { seen, count } = reachable(map, w.start.x, w.start.y);
  if (count < 2000) fail('seed ' + seed + ' reachable area is only ' + count + ' tiles');

  // Every town and cave mouth must be reachable from the start.
  for (const t of (w.towns || [])) {
    totalTowns++;
    if (!seen[t.y * map.w + t.x]) {
      // A town centre could legitimately be a building; accept any reachable tile within 3.
      let ok = false;
      for (let dy = -3; dy <= 3 && !ok; dy++) {
        for (let dx = -3; dx <= 3 && !ok; dx++) {
          const nx = t.x + dx, ny = t.y + dy;
          if (nx >= 0 && ny >= 0 && nx < map.w && ny < map.h && seen[ny * map.w + nx]) ok = true;
        }
      }
      if (!ok) fail('seed ' + seed + ': town "' + (t.name || t.id) + '" at ' + t.x + ',' + t.y + ' is UNREACHABLE');
    }
  }
  for (const c of (w.caves || [])) {
    totalCaves++;
    let ok = false;
    for (let dy = -2; dy <= 2 && !ok; dy++) {
      for (let dx = -2; dx <= 2 && !ok; dx++) {
        const nx = c.x + dx, ny = c.y + dy;
        if (nx >= 0 && ny >= 0 && nx < map.w && ny < map.h && seen[ny * map.w + nx]) ok = true;
      }
    }
    if (!ok) fail('seed ' + seed + ': cave at ' + c.x + ',' + c.y + ' is UNREACHABLE');
  }

  if (!w.towns || w.towns.length < 3) fail('seed ' + seed + ' only produced ' + (w.towns || []).length + ' towns');

  for (let i = 0; i < map.w * map.h; i += 97) biomeSeen.add(biomeAt(w, i % map.w, (i / map.w) | 0));

  // Difficulty curve near the start must be gentle.
  const lStart = levelAt(w, w.start.x, w.start.y);
  if (lStart > 5) fail('seed ' + seed + ' start level is ' + lStart + ' (should be <= 5)');
  const lFar = levelAt(w, 5, 5);
  const lFar2 = levelAt(w, map.w - 6, map.h - 6);
  if (Math.max(lFar, lFar2) < 35) fail('seed ' + seed + ' far corners only reach level ' + Math.max(lFar, lFar2));

  // Grass exists, or there are no encounters anywhere.
  let grassCount = 0;
  for (let i = 0; i < map.ground.length; i += 13) {
    const g = map.ground[i];
    if (g === T.TALLGRASS || g === T.TALLGRASS_DARK || g === T.JUNGLE || g === T.MARSH
        || g === T.SAVANNA || g === T.TUNDRA) grassCount++;
  }
  if (grassCount < 50) fail('seed ' + seed + ' has almost no encounter grass (' + grassCount + ' sampled)');
}

times.sort((a, b) => a - b);
console.log('  generateWorld ms  min ' + times[0].toFixed(0) +
            '  median ' + times[(times.length / 2) | 0].toFixed(0) +
            '  max ' + times[times.length - 1].toFixed(0));
if (times[times.length - 1] > 2500) fail('worst-case generation ' + times[times.length - 1].toFixed(0) + 'ms is too slow');
console.log('  towns total ' + totalTowns + '  caves total ' + totalCaves);
console.log('  distinct biomes seen: ' + biomeSeen.size + ' (' + [...biomeSeen].join(', ') + ')');
if (biomeSeen.size < 6) fail('only ' + biomeSeen.size + ' biomes appear across all seeds');

// ---- determinism ----
const a = generateWorld(424242);
const b = generateWorld(424242);
let diff = 0;
for (let i = 0; i < a.map.ground.length; i++) {
  if (a.map.ground[i] !== b.map.ground[i] || a.map.overlay[i] !== b.map.overlay[i]) { diff++; }
}
console.log('  determinism: ' + (diff === 0 ? 'identical' : diff + ' TILES DIFFER'));
if (diff !== 0) fail('generateWorld is not deterministic (' + diff + ' tiles differ on the same seed)');
if (a.start.x !== b.start.x || a.start.y !== b.start.y) fail('start point is not deterministic');

// ---- encounter tables ----
const STARTERS = new Set(['sproutle', 'thornmane', 'cindercub', 'pyrelynx', 'driblet', 'tidalquill']);
console.log('\n=== ENCOUNTER TABLES ===');
for (const biome of BIOMES) {
  let table = [];
  try { table = encounterTableFor(biome) || []; } catch (e) { fail(biome + ' threw: ' + e.message); continue; }
  if (biome === 'OCEAN') {
    if (table.length) fail('OCEAN should have no encounters');
    continue;
  }
  if (!table.length) { fail(biome + ' has an empty encounter table'); continue; }
  let bad = [];
  for (const t of table) {
    if (getSpecies(t.species).id !== t.species) bad.push('unknown species ' + t.species);
    if (STARTERS.has(t.species)) bad.push('starter ' + t.species + ' appears in the wild');
    if (!(t.weight > 0)) bad.push(t.species + ' has weight ' + t.weight);
    if (!(t.minLvl >= 1) || !(t.maxLvl >= t.minLvl)) bad.push(t.species + ' bad level range');
    const sp = getSpecies(t.species);
    if (sp.biomes && sp.biomes.length && !sp.biomes.includes(biome)) {
      bad.push(t.species + ' spawns in ' + biome + ' but its roster biomes are ' + sp.biomes.join('/'));
    }
  }
  console.log('  ' + biome.padEnd(9) + String(table.length).padStart(2) + ' entries  ' +
              (bad.length ? 'ISSUES: ' + bad.join('; ') : 'ok'));
  for (const m of bad) fail(biome + ': ' + m);
}

// --- stampTown's shared-stream footprint is exactly one draw ---------------
// Town content once drew a VARIABLE number of values from the world's shared
// rng, so any content change (a new trainer archetype, one more team pick)
// re-rolled every later town and moved every cave mouth for the same seed —
// silently breaking saves that regenerate their world from seed. stampTown
// now forks a private rng off a single shared draw; hold it to that.
{
  const { stampTown } = await import('../game/js/towns.js');
  const { makeRng } = await import('../game/js/rng.js');
  const { T } = await import('../game/js/tiles.js');
  console.log('\n=== STAMP FOOTPRINT ===');
  for (const [idx, tier] of [[0, 0], [3, 2], [7, 5], [9, 9]]) {
    const w2 = 64, h2 = 64;
    const scratch = {
      id: 'world', w: w2, h: h2,
      ground: new Uint8Array(w2 * h2).fill(T.GRASS),
      overlay: new Uint8Array(w2 * h2),
      biome: new Uint8Array(w2 * h2),
      entities: [], warps: [],
    };
    let draws = 0;
    const base = makeRng(1234 + idx);
    const counted = new Proxy(base, {
      get(t2, k) {
        const v = t2[k];
        if (typeof v !== 'function') return v;
        return (...a) => { draws++; return v(...a); };
      },
    });
    try { stampTown(scratch, 32, 32, counted, idx, tier); }
    catch (e) { fail('stampTown threw on scratch map (idx ' + idx + '): ' + e.message); continue; }
    console.log('  town idx ' + idx + ' tier ' + tier + ': shared rng draws = ' + draws);
    if (draws !== 1) fail('stampTown drew ' + draws + ' shared values (idx ' + idx + ', tier ' + tier + ') — content changes will cascade across the world again');
  }
}

console.log('\n' + (fails ? 'WORLDGEN: ' + fails + ' FAILURES' : 'WORLDGEN: all invariants hold'));
process.exit(fails ? 1 : 0);
