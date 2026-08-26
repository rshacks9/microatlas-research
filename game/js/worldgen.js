// worldgen.js — the seeded open-world generator for Verdant Frontier.
//
// Pure + fully deterministic in `seed`: every random decision goes through
// rng.js (makeRng / fbm / ridge / hash2). No DOM, no Math.random, Node-importable.
//
// Pipeline:
//   1. elevation  = fbm + ridge, shaped by a radial falloff  -> one big island
//   2. moisture   = fbm on a different seed offset
//   3. temperature= latitude gradient + noise - altitude cooling
//   4. biome      = lookup over (elevation, moisture, temperature)
//   5. rivers     = steepest-descent walks from high ground to the sea
//   6. tiles      = ground + overlay painted per biome, tall grass in patches
//   7. towns      = rejection-sampled flat sites, stamped by towns.js
//   8. caves      = warp mouths in MOUNTAIN / PEAK
//   9. connectivity repair: every walkable tile must be reachable from `start`
//
// The connectivity repair (step 9) is not optional. A stranded player or an
// unreachable town is a softlock, so the generator bridges or fills every
// disconnected region and re-verifies before returning.

import { T, isSolid, isWater } from './tiles.js';
import { makeRng, fbm, ridge, hash2 } from './rng.js';
// Namespace import: tolerant of module cycles and of towns.js still being
// half-written — every use is guarded and wrapped in try/catch.
import * as Towns from './towns.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const WORLD_W = 384;
export const WORLD_H = 384;

export const BIOMES = [
  'OCEAN', 'BEACH', 'MEADOW', 'FOREST', 'JUNGLE', 'SWAMP',
  'DESERT', 'SAVANNA', 'TUNDRA', 'MOUNTAIN', 'PEAK',
];

/** name -> index into BIOMES */
export const BIOME_ID = (() => {
  const o = Object.create(null);
  for (let i = 0; i < BIOMES.length; i++) o[BIOMES[i]] = i;
  return o;
})();

const B_OCEAN = 0, B_BEACH = 1, B_MEADOW = 2, B_FOREST = 3, B_JUNGLE = 4,
      B_SWAMP = 5, B_DESERT = 6, B_SAVANNA = 7, B_TUNDRA = 8,
      B_MOUNTAIN = 9, B_PEAK = 10;

const SEA_LEVEL   = 0.360;
const BEACH_LEVEL = 0.392;
const MOUNTAIN_LEVEL = 0.685;
const PEAK_LEVEL     = 0.800;

const RIVER_COUNT     = 14;
const RIVER_MAX_STEPS = 600;

const TOWN_TARGET     = 10;   // aim for 10, accept >= 8
const TOWN_MIN        = 8;
const TOWN_SEP        = 55;
const TOWN_CLEAR      = 6;    // half-size of the flattened clearing (13x13)

const CAVE_MIN        = 5;
const CAVE_MAX        = 8;
const CAVE_SEP        = 26;

const MIN_REGION_KEEP = 12;   // smaller orphan pockets are filled, not bridged
const MAX_REPAIR_PASS = 10;

const FALLBACK_TOWN_NAMES = [
  'Willowmere', 'Ashfen Hollow', 'Brackenford', 'Solmarch', 'Duskcairn',
  'Emberhollow', 'Gilded Reach', 'Hollowbrook', 'Iremoor', 'Thistlewick',
  'Quillhaven', 'Verdant Rest',
];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function smoothstep(a, b, x) {
  if (x <= a) return 0;
  if (x >= b) return 1;
  const t = (x - a) / (b - a);
  return t * t * (3 - 2 * t);
}

/** Positional hash in [0,1). Stable, seed-deterministic, allocation free. */
function hashUnit(seed, x, y) {
  return hash2(seed, x, y) / 4294967296;
}

const inBounds = (x, y) => x >= 0 && y >= 0 && x < WORLD_W && y < WORLD_H;

// ---------------------------------------------------------------------------
// 1-3. Scalar fields
// ---------------------------------------------------------------------------

function buildFields(seed, elev, moist, temp) {
  const W = WORLD_W, H = WORLD_H;
  const eS = (seed + 0x1f35) >>> 0;
  const rS = (seed + 0x2b71) >>> 0;
  const mS = (seed + 0x3c4d) >>> 0;
  const tS = (seed + 0x4e19) >>> 0;

  const invW = 2 / (W - 1), invH = 2 / (H - 1);
  const FE = 1 / 58, FR = 1 / 76, FM = 1 / 62, FT = 1 / 88;

  for (let y = 0; y < H; y++) {
    const ny = y * invH - 1;
    const lat = y / (H - 1);
    const row = y * W;
    const ey = y * FE, ry = y * FR, my = y * FM, ty = y * FT;

    for (let x = 0; x < W; x++) {
      const nx = x * invW - 1;
      const i = row + x;

      // --- elevation: fbm base + ridged spines, then island falloff --------
      const rad = Math.sqrt(nx * nx + ny * ny) * 0.76 +
                  (Math.abs(nx) > Math.abs(ny) ? Math.abs(nx) : Math.abs(ny)) * 0.20;
      const fall = smoothstep(0.50, 1.14, rad);

      let e = fbm(eS, x * FE, ey, 5, 2, 0.5) * 0.66 + ridge(rS, x * FR, ry, 4) * 0.46;
      e = (e + 0.005) * 1.20;
      e = e * (1 - fall) - fall * 0.28;
      e = clamp01(e);
      elev[i] = e;

      // --- moisture --------------------------------------------------------
      let m = fbm(mS, x * FM, my, 4, 2, 0.5);
      m = clamp01(m * 1.34 - 0.17 + (1 - e) * 0.06);
      moist[i] = m;

      // --- temperature: north cold, south hot, high ground cold ------------
      let t = lat * 1.16 - 0.07;
      t += (fbm(tS, x * FT, ty, 3, 2, 0.5) - 0.5) * 0.30;
      if (e > 0.45) t -= (e - 0.45) * 0.85;
      temp[i] = clamp01(t);
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Biome lookup
// ---------------------------------------------------------------------------

function biomeFor(e, m, t) {
  if (e < SEA_LEVEL) return B_OCEAN;
  if (e < BEACH_LEVEL) return B_BEACH;
  if (e >= PEAK_LEVEL) return B_PEAK;
  if (e >= MOUNTAIN_LEVEL) return B_MOUNTAIN;

  if (t < 0.245) return B_TUNDRA;
  if (e < SEA_LEVEL + 0.085 && m > 0.60) return B_SWAMP;

  if (t > 0.665) {
    if (m < 0.33) return B_DESERT;
    if (m < 0.55) return B_SAVANNA;
    return B_JUNGLE;
  }
  if (t > 0.44 && m < 0.29) return B_SAVANNA;
  if (m > 0.57) return B_FOREST;
  return B_MEADOW;
}

function buildBiomes(elev, moist, temp, biome) {
  for (let i = 0, n = biome.length; i < n; i++) {
    biome[i] = biomeFor(elev[i], moist[i], temp[i]);
  }
}

// ---------------------------------------------------------------------------
// 5. Rivers — steepest descent to the sea
// ---------------------------------------------------------------------------

const NX8 = [0, 1, 0, -1, 1, 1, -1, -1];
const NY8 = [-1, 0, 1, 0, -1, 1, 1, -1];
const NX4 = [0, 1, 0, -1];
const NY4 = [-1, 0, 1, 0];

function carveRivers(seed, rng, elev, biome, river) {
  const W = WORLD_W, H = WORLD_H;
  const jitterSeed = (seed + 0x7a11) >>> 0;
  const visited = new Int32Array(W * H).fill(-1);
  const paths = [];

  // Candidate sources: high ground, away from the border.
  const sources = [];
  for (let tries = 0; tries < 40000 && sources.length < RIVER_COUNT * 8; tries++) {
    const x = 12 + rng.int(W - 24);
    const y = 12 + rng.int(H - 24);
    const i = y * W + x;
    if (elev[i] < 0.58) continue;
    sources.push(i);
  }

  for (let s = 0; s < sources.length && paths.length < RIVER_COUNT; s++) {
    let cur = sources[s];
    if (river[cur]) continue;

    const path = [];
    let stalls = 0;
    let reachedSea = false;
    const stamp = s;

    for (let step = 0; step < RIVER_MAX_STEPS; step++) {
      if (visited[cur] === stamp) break;          // looped back on ourselves
      visited[cur] = stamp;
      path.push(cur);

      if (biome[cur] === B_OCEAN) { reachedSea = true; break; }
      if (step > 0 && river[cur]) { reachedSea = true; break; }   // joined a river

      const cx = cur % W, cy = (cur / W) | 0;
      let best = -1, bestV = Infinity;
      for (let k = 0; k < 8; k++) {
        const nx = cx + NX8[k], ny = cy + NY8[k];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (visited[ni] === stamp) continue;
        // small deterministic tiebreak so rivers meander instead of stair-stepping
        const v = elev[ni] + (hashUnit(jitterSeed, nx, ny) - 0.5) * 0.006;
        if (v < bestV) { bestV = v; best = ni; }
      }
      if (best < 0) break;

      // Uphill or flat means we fell into a basin: spend a little stall budget
      // flooding through it rather than abandoning the river outright.
      if (elev[best] >= elev[cur]) {
        if (++stalls > 70) break;
      }
      cur = best;
    }

    if (path.length < 14) continue;
    if (!reachedSea && path.length < 26) continue;   // stubby dead-end, skip it

    for (let p = 0; p < path.length; p++) river[path[p]] = 1;
    paths.push(path);
  }
  return paths;
}

/**
 * Drop fords across each river at regular intervals so the landmass stays
 * traversable without relying on the connectivity repair to notice.
 */
function bridgeRivers(paths, biome, ground, overlay) {
  for (let p = 0; p < paths.length; p++) {
    const path = paths[p];
    for (let k = 10; k < path.length; k += 20) {
      const i = path[k];
      if (biome[i] === B_OCEAN) continue;
      ground[i] = T.BRIDGE;
      overlay[i] = 0;
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Tile painting
// ---------------------------------------------------------------------------

const GROUND_FOR_BIOME = new Uint16Array(BIOMES.length);
GROUND_FOR_BIOME[B_OCEAN]    = T.WATER;
GROUND_FOR_BIOME[B_BEACH]    = T.SAND;
GROUND_FOR_BIOME[B_MEADOW]   = T.GRASS;
GROUND_FOR_BIOME[B_FOREST]   = T.GRASS;
GROUND_FOR_BIOME[B_JUNGLE]   = T.GRASS;
GROUND_FOR_BIOME[B_SWAMP]    = T.MARSH;
GROUND_FOR_BIOME[B_DESERT]   = T.SAND;
GROUND_FOR_BIOME[B_SAVANNA]  = T.SAVANNA;
GROUND_FOR_BIOME[B_TUNDRA]   = T.TUNDRA;
GROUND_FOR_BIOME[B_MOUNTAIN] = T.GRAVEL;
GROUND_FOR_BIOME[B_PEAK]     = T.SNOW;

/** Tall-grass tile scattered in patches for each biome (0 = none). */
const PATCH_FOR_BIOME = new Uint16Array(BIOMES.length);
PATCH_FOR_BIOME[B_MEADOW]  = T.TALLGRASS;
PATCH_FOR_BIOME[B_FOREST]  = T.TALLGRASS;
PATCH_FOR_BIOME[B_JUNGLE]  = T.JUNGLE;
PATCH_FOR_BIOME[B_SWAMP]   = T.MARSH;
PATCH_FOR_BIOME[B_SAVANNA] = T.SAVANNA;
PATCH_FOR_BIOME[B_TUNDRA]  = T.TUNDRA;
// The four biomes below had NO patch tile, so their ground (sand, gravel, snow)
// could never roll an encounter — measured at 0.0% encounter coverage, which
// made every species that only spawns there uncatchable in practice, both PEAK
// legendaries included.
PATCH_FOR_BIOME[B_BEACH]    = T.BEACHTUFT;
PATCH_FOR_BIOME[B_DESERT]   = T.DUNEGRASS;
PATCH_FOR_BIOME[B_MOUNTAIN] = T.SCREE;
PATCH_FOR_BIOME[B_PEAK]     = T.SNOWDRIFT;

function paintTiles(seed, elev, moist, temp, biome, river, ground, overlay) {
  const W = WORLD_W, H = WORLD_H;

  const patchFineS   = (seed + 0x5501) >>> 0;
  const patchWideS   = (seed + 0x7703) >>> 0;
  const canopyS      = (seed + 0x1ce7) >>> 0;
  const scatterS     = (seed + 0x24b9) >>> 0;
  const decorS       = (seed + 0x3ff1) >>> 0;

  const PF = 1 / 8.5, PW = 1 / 27, CF = 1 / 12.5;

  for (let y = 0; y < H; y++) {
    const row = y * W;
    const pfy = y * PF, pwy = y * PW, cfy = y * CF;

    for (let x = 0; x < W; x++) {
      const i = row + x;
      const b = biome[i];
      const e = elev[i];
      const t = temp[i];

      // ---- ground ------------------------------------------------------
      let g;
      if (b === B_OCEAN) {
        g = e < SEA_LEVEL - 0.075 ? T.DEEPWATER : T.WATER;
      } else {
        g = GROUND_FOR_BIOME[b];
      }
      overlay[i] = 0;

      if (b !== B_OCEAN) {
        // ---- patch noise ------------------------------------------------
        const wide = fbm(patchWideS, x * PW, pwy, 2, 2, 0.5);
        const fine = fbm(patchFineS, x * PF, pfy, 3, 2, 0.5);
        const canopy = fbm(canopyS, x * CF, cfy, 3, 2, 0.5);
        const patch = PATCH_FOR_BIOME[b];

        if (patch && wide > 0.455 && fine > 0.520) g = patch;
        if (b === B_FOREST && canopy > 0.600 && fine > 0.470) g = T.TALLGRASS_DARK;
        if (b === B_JUNGLE && wide > 0.42 && fine > 0.44) g = T.JUNGLE;

        // ---- overlay scatter (trees etc. NEVER go on the ground layer) ---
        const r1 = hashUnit(scatterS, x, y);
        const r2 = hashUnit(decorS, x, y);

        switch (b) {
          case B_BEACH:
            if (r1 < 0.035) overlay[i] = T.PALM;
            break;
          case B_MEADOW:
            if (canopy > 0.66 && r1 < 0.45) overlay[i] = T.TREE;
            else if (r1 < 0.020) overlay[i] = T.BUSH;
            else if (r2 < 0.035) overlay[i] = T.FLOWER;
            break;
          case B_FOREST:
            if (canopy > 0.470 && r1 < 0.52) overlay[i] = (t < 0.32 ? T.PINE : T.TREE);
            else if (r1 < 0.030) overlay[i] = T.BUSH;
            else if (r2 < 0.020) overlay[i] = T.FLOWER;
            break;
          case B_JUNGLE:
            if (canopy > 0.430 && r1 < 0.50) overlay[i] = T.TREE;
            else if (r2 < 0.030) overlay[i] = T.MUSHROOM;
            break;
          case B_SWAMP:
            if (canopy > 0.610 && r1 < 0.30) overlay[i] = T.TREE;
            else if (r2 < 0.045) overlay[i] = T.MUSHROOM;
            else if (r2 > 0.972) overlay[i] = T.PUDDLE;
            break;
          case B_DESERT:
            if (r1 < 0.016) overlay[i] = T.CACTUS;
            else if (r2 < 0.012) overlay[i] = T.ROCK;
            break;
          case B_SAVANNA:
            if (canopy > 0.690 && r1 < 0.22) overlay[i] = T.TREE;
            else if (r2 < 0.018) overlay[i] = T.BUSH;
            break;
          case B_TUNDRA:
            if (canopy > 0.640 && r1 < 0.26) overlay[i] = T.PINE;
            else if (r2 < 0.014) overlay[i] = T.ROCK;
            break;
          case B_MOUNTAIN:
            if (canopy > 0.560 && r1 < 0.30) overlay[i] = T.ROCK;
            else if (r2 < 0.020) overlay[i] = T.BUSH;
            break;
          case B_PEAK:
            if (canopy > 0.640 && r1 < 0.26) overlay[i] = T.ROCK;
            else if (r2 < 0.010) overlay[i] = T.CRYSTAL;
            break;
          default:
            break;
        }
      }

      // ---- rivers win over everything ------------------------------------
      if (river[i] && b !== B_OCEAN) {
        g = T.WATER;
        overlay[i] = 0;
      }

      ground[i] = g;
    }
  }
}

// ---------------------------------------------------------------------------
// Walkability + connected component labelling
// ---------------------------------------------------------------------------

/**
 * Conservative walkability: a tile counts as blocked if EITHER layer is solid.
 * tilemap.js currently only tests the ground layer, so treating solid overlay
 * as blocking here can only make the world more connected, never less.
 */
function buildWalkMask(ground, overlay, walk) {
  for (let i = 0, n = walk.length; i < n; i++) {
    const ov = overlay[i];                      // 0 means "no overlay", not VOID
    walk[i] = (!isSolid(ground[i]) && (ov === 0 || !isSolid(ov))) ? 1 : 0;
  }
}

/**
 * 4-way flood fill labelling. comp[i] = -2 for blocked tiles, else region id.
 * Returns an array of region sizes indexed by region id.
 */
function labelRegions(walk, comp, stack) {
  const W = WORLD_W, H = WORLD_H, n = walk.length;
  comp.fill(-1);
  const sizes = [];

  for (let seedIdx = 0; seedIdx < n; seedIdx++) {
    if (comp[seedIdx] !== -1) continue;
    if (!walk[seedIdx]) { comp[seedIdx] = -2; continue; }

    const id = sizes.length;
    let size = 0;
    let sp = 0;
    stack[sp++] = seedIdx;
    comp[seedIdx] = id;

    while (sp > 0) {
      const i = stack[--sp];
      size++;
      const x = i % W, y = (i / W) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = x + NX4[k], ny = y + NY4[k];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (comp[ni] !== -1) continue;
        if (!walk[ni]) { comp[ni] = -2; continue; }
        comp[ni] = id;
        stack[sp++] = ni;
      }
    }
    sizes.push(size);
  }
  return sizes;
}

// ---------------------------------------------------------------------------
// 7 (cont). Connectivity repair — bridge or fill every orphaned region
// ---------------------------------------------------------------------------

const COST_BLOCKED   = 1;   // rock / cliff / tree
const COST_WATER     = 2;   // river / shallow — becomes a BRIDGE
const COST_DEEPWATER = 4;   // open sea — expensive, but never impossible
const DIAL_BUCKETS   = 6;   // must exceed the largest edge cost

function entryCost(walk, ground, i) {
  if (walk[i]) return 0;
  const g = ground[i];
  if (isWater(g)) return g === T.DEEPWATER ? COST_DEEPWATER : COST_WATER;
  return COST_BLOCKED;
}

/**
 * Dial's algorithm (bucketed Dijkstra) from every tile of `mainId` outward
 * across the whole grid. Fills dist/prev so any tile can be traced back to the
 * main region along the cheapest carve.
 */
function costFieldFromRegion(comp, mainId, walk, ground, dist, prev) {
  const W = WORLD_W, H = WORLD_H, n = dist.length;
  dist.fill(0x3fffffff);
  prev.fill(-1);

  const buckets = new Array(DIAL_BUCKETS);
  for (let i = 0; i < DIAL_BUCKETS; i++) buckets[i] = [];

  let pending = 0;
  for (let i = 0; i < n; i++) {
    if (comp[i] === mainId) { dist[i] = 0; buckets[0].push(i); pending++; }
  }
  if (pending === 0) return;

  let d = 0;
  const guard = n * 8;
  let spins = 0;
  while (pending > 0 && spins++ < guard) {
    const b = buckets[d % DIAL_BUCKETS];
    while (b.length) {
      const i = b.pop();
      pending--;
      if (dist[i] !== d) continue;             // stale entry
      const x = i % W, y = (i / W) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = x + NX4[k], ny = y + NY4[k];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        const nd = d + entryCost(walk, ground, ni);
        if (nd < dist[ni]) {
          dist[ni] = nd;
          prev[ni] = i;
          buckets[nd % DIAL_BUCKETS].push(ni);
          pending++;
        }
      }
    }
    d++;
  }
}

function carveTile(i, ground, overlay, biome) {
  const g = ground[i];
  if (isWater(g)) {
    ground[i] = T.BRIDGE;
  } else if (isSolid(g)) {
    const b = biome[i];
    ground[i] = b === B_PEAK ? T.SNOW
              : b === B_MOUNTAIN ? T.GRAVEL
              : b === B_DESERT || b === B_BEACH ? T.SAND
              : T.DIRT;
  }
  overlay[i] = 0;
}

/** Trace `from` back to the main region, carving every blocked tile en route. */
function carvePathToMain(from, dist, prev, ground, overlay, biome) {
  let cur = from;
  let guard = 0;
  while (cur >= 0 && dist[cur] > 0 && guard++ < 4096) {
    carveTile(cur, ground, overlay, biome);
    cur = prev[cur];
  }
}

// Fill every listed orphan region in ONE pass over the grid. The per-region
// version rescanned all 147,456 tiles once per region — tens of millions of
// comparisons per generated world for identical output.
function fillRegions(regionIds, comp, ground, overlay) {
  if (!regionIds.length) return;
  let maxId = 0;
  for (const id of regionIds) if (id > maxId) maxId = id;
  const kill = new Uint8Array(maxId + 1);
  for (const id of regionIds) kill[id] = 1;
  for (let i = 0, n = comp.length; i < n; i++) {
    const c = comp[i];
    if (c >= 0 && c <= maxId && kill[c]) {
      ground[i] = T.ROCK;
      overlay[i] = 0;
    }
  }
}

/**
 * Guarantees that every walkable tile is reachable from `startIdx`.
 * Orphan regions are bridged when they are big enough (or contain a protected
 * point such as a town or cave mouth), and filled in otherwise.
 */
function repairConnectivity(startIdx, protectedIdx, ground, overlay, biome, buf) {
  const { walk, comp, stack, dist, prev } = buf;
  const n = ground.length;

  const protectedSet = new Uint8Array(n);
  for (let p = 0; p < protectedIdx.length; p++) {
    const pi = protectedIdx[p];
    if (pi >= 0 && pi < n) protectedSet[pi] = 1;
  }

  for (let pass = 0; pass < MAX_REPAIR_PASS; pass++) {
    // The start tile itself must always be standable.
    if (isSolid(ground[startIdx])) ground[startIdx] = T.DIRT;
    overlay[startIdx] = 0;

    buildWalkMask(ground, overlay, walk);
    const sizes = labelRegions(walk, comp, stack);
    const mainId = comp[startIdx];
    if (mainId < 0) { ground[startIdx] = T.DIRT; continue; }
    if (sizes.length <= 1) return true;

    // Which orphan regions must be bridged vs filled?
    const hasProtected = new Uint8Array(sizes.length);
    for (let p = 0; p < protectedIdx.length; p++) {
      const c = comp[protectedIdx[p]];
      if (c >= 0) hasProtected[c] = 1;
    }

    const toBridge = [];
    const toFill = [];
    for (let id = 0; id < sizes.length; id++) {
      if (id === mainId) continue;
      if (sizes[id] >= MIN_REGION_KEEP || hasProtected[id]) toBridge.push(id);
      else toFill.push(id);
    }

    if (toBridge.length) {
      costFieldFromRegion(comp, mainId, walk, ground, dist, prev);
      // cheapest entry tile per orphan region
      const bestIdx = new Int32Array(sizes.length).fill(-1);
      const bestVal = new Int32Array(sizes.length).fill(0x3fffffff);
      for (let i = 0; i < n; i++) {
        const c = comp[i];
        if (c < 0 || c === mainId) continue;
        if (dist[i] < bestVal[c]) { bestVal[c] = dist[i]; bestIdx[c] = i; }
      }
      for (let b = 0; b < toBridge.length; b++) {
        const id = toBridge[b];
        if (bestIdx[id] >= 0) carvePathToMain(bestIdx[id], dist, prev, ground, overlay, biome);
      }
    }

    fillRegions(toFill, comp, ground, overlay);

    if (!toBridge.length && !toFill.length) return true;
  }

  // Last resort: anything still stranded and unprotected gets filled solid so
  // the invariant "every walkable tile is reachable" holds no matter what.
  buildWalkMask(ground, overlay, walk);
  const sizes = labelRegions(walk, comp, stack);
  const mainId = comp[startIdx];
  if (sizes.length > 1 && mainId >= 0) {
    for (let i = 0; i < n; i++) {
      if (comp[i] >= 0 && comp[i] !== mainId && !protectedSet[i]) {
        ground[i] = T.ROCK;
        overlay[i] = 0;
      }
    }
    buildWalkMask(ground, overlay, walk);
    labelRegions(walk, comp, stack);
  }
  return comp[startIdx] >= 0;
}

// ---------------------------------------------------------------------------
// Town + cave siting
// ---------------------------------------------------------------------------

const TOWN_OK_BIOME = new Uint8Array(BIOMES.length);
TOWN_OK_BIOME[B_MEADOW] = 1;
TOWN_OK_BIOME[B_FOREST] = 1;
TOWN_OK_BIOME[B_SAVANNA] = 1;
TOWN_OK_BIOME[B_TUNDRA] = 1;
TOWN_OK_BIOME[B_DESERT] = 1;
TOWN_OK_BIOME[B_BEACH] = 1;
TOWN_OK_BIOME[B_JUNGLE] = 1;

function siteIsFlat(elev, x, y, tol) {
  let lo = Infinity, hi = -Infinity;
  for (let dy = -4; dy <= 4; dy += 2) {
    for (let dx = -4; dx <= 4; dx += 2) {
      const v = elev[(y + dy) * WORLD_W + (x + dx)];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return (hi - lo) <= tol;
}

function siteIsClear(ground, comp, mainId, x, y, r, minFrac) {
  let ok = 0, total = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const i = (y + dy) * WORLD_W + (x + dx);
      total++;
      if (isWater(ground[i])) return false;
      if (comp[i] === mainId) ok++;
    }
  }
  return ok / total >= minFrac;
}

function pickTownSites(rng, elev, biome, ground, comp, mainId) {
  const W = WORLD_W, H = WORLD_H;
  const margin = TOWN_CLEAR + 8;
  const sites = [];

  const relaxSep = [TOWN_SEP, TOWN_SEP, 46, 38, 30, 24];
  const relaxFlat = [0.045, 0.060, 0.075, 0.095, 0.130, 0.200];
  const relaxFrac = [0.90, 0.82, 0.74, 0.66, 0.55, 0.40];

  for (let phase = 0; phase < relaxSep.length && sites.length < TOWN_TARGET; phase++) {
    const sep2 = relaxSep[phase] * relaxSep[phase];
    for (let tries = 0; tries < 9000 && sites.length < TOWN_TARGET; tries++) {
      const x = margin + rng.int(W - margin * 2);
      const y = margin + rng.int(H - margin * 2);
      const i = y * W + x;
      if (comp[i] !== mainId) continue;
      if (!TOWN_OK_BIOME[biome[i]]) continue;
      if (!siteIsFlat(elev, x, y, relaxFlat[phase])) continue;
      if (!siteIsClear(ground, comp, mainId, x, y, TOWN_CLEAR, relaxFrac[phase])) continue;

      let far = true;
      for (let s = 0; s < sites.length; s++) {
        const dx = sites[s].x - x, dy = sites[s].y - y;
        if (dx * dx + dy * dy < sep2) { far = false; break; }
      }
      if (!far) continue;
      sites.push({ x, y });
    }
    if (phase >= 1 && sites.length >= TOWN_MIN) break;
  }
  return sites;
}

/** Flatten + clear the town footprint so towns.js has a clean canvas. */
function clearTownSite(x, y, r, ground, overlay, biome) {
  for (let dy = -r; dy <= r; dy++) {
    const yy = y + dy;
    if (yy < 0 || yy >= WORLD_H) continue;
    for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx;
      if (xx < 0 || xx >= WORLD_W) continue;
      const i = yy * WORLD_W + xx;
      overlay[i] = 0;
      const g = ground[i];
      if (isWater(g) || isSolid(g)) {
        ground[i] = GROUND_FOR_BIOME[biome[i]] || T.GRASS;
        if (isWater(ground[i]) || isSolid(ground[i])) ground[i] = T.GRASS;
      } else if (g === T.TALLGRASS || g === T.TALLGRASS_DARK || g === T.JUNGLE) {
        ground[i] = T.GRASS;
      }
    }
  }
}

function nearestWalkable(x, y, ground, overlay, maxR) {
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const xx = x + dx, yy = y + dy;
        if (!inBounds(xx, yy)) continue;
        const i = yy * WORLD_W + xx;
        const ov = overlay[i];
        if (!isSolid(ground[i]) && !isWater(ground[i]) && (ov === 0 || !isSolid(ov))) {
          return { x: xx, y: yy, i };
        }
      }
    }
  }
  return null;
}

function pickCaveSites(rng, elev, biome, ground, overlay, comp, mainId, towns, target) {
  const W = WORLD_W, H = WORLD_H;
  const sites = [];
  const sepPhases = [CAVE_SEP, CAVE_SEP, 18, 12, 8];

  for (let phase = 0; phase < sepPhases.length && sites.length < target; phase++) {
    const sep2 = sepPhases[phase] * sepPhases[phase];
    const allowHighland = phase >= 3;
    for (let tries = 0; tries < 12000 && sites.length < target; tries++) {
      const x = 6 + rng.int(W - 12);
      const y = 6 + rng.int(H - 12);
      const i = y * W + x;
      if (comp[i] !== mainId) continue;
      const b = biome[i];
      if (!(b === B_MOUNTAIN || b === B_PEAK || (allowHighland && elev[i] > MOUNTAIN_LEVEL - 0.06))) continue;
      if (isWater(ground[i])) continue;

      let far = true;
      for (let s = 0; s < sites.length; s++) {
        const dx = sites[s].x - x, dy = sites[s].y - y;
        if (dx * dx + dy * dy < sep2) { far = false; break; }
      }
      if (far) {
        for (let t = 0; t < towns.length; t++) {
          const dx = towns[t].x - x, dy = towns[t].y - y;
          if (dx * dx + dy * dy < 14 * 14) { far = false; break; }
        }
      }
      if (!far) continue;
      sites.push({ x, y });
    }
    if (phase >= 1 && sites.length >= CAVE_MIN) break;
  }
  return sites;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the whole overworld. Pure and deterministic in `seed`.
 * @returns {{map:Object, towns:Array, caves:Array, start:{x:number,y:number},
 *            elevation:Float32Array, biome:Uint8Array, seed:number}}
 */
export function generateWorld(seed) {
  const W = WORLD_W, H = WORLD_H, len = W * H;
  seed = (seed >>> 0) || 1;

  const rng = makeRng((seed ^ 0x9e3779b9) >>> 0);

  const elevation = new Float32Array(len);
  const moisture  = new Float32Array(len);
  const temperature = new Float32Array(len);
  const biome  = new Uint8Array(len);
  const ground = new Uint16Array(len);
  const overlay = new Uint16Array(len);
  const river  = new Uint8Array(len);

  buildFields(seed, elevation, moisture, temperature);
  buildBiomes(elevation, moisture, temperature, biome);
  const riverPaths = carveRivers(seed, rng, elevation, biome, river);
  paintTiles(seed, elevation, moisture, temperature, biome, river, ground, overlay);
  bridgeRivers(riverPaths, biome, ground, overlay);

  // Scratch buffers shared by every graph pass (no per-tile allocation).
  const buf = {
    walk: new Uint8Array(len),
    comp: new Int32Array(len),
    stack: new Int32Array(len),
    dist: new Int32Array(len),
    prev: new Int32Array(len),
  };

  // --- main landmass -------------------------------------------------------
  buildWalkMask(ground, overlay, buf.walk);
  let sizes = labelRegions(buf.walk, buf.comp, buf.stack);
  let mainId = 0, mainSize = -1;
  for (let id = 0; id < sizes.length; id++) {
    if (sizes[id] > mainSize) { mainSize = sizes[id]; mainId = id; }
  }

  // --- towns ---------------------------------------------------------------
  const sites = pickTownSites(rng, elevation, biome, ground, buf.comp, mainId);

  // Start town = the site closest to the centre of the landmass.
  let cx = 0, cy = 0, cn = 0;
  for (let i = 0; i < len; i++) {
    if (buf.comp[i] === mainId) { cx += i % W; cy += (i / W) | 0; cn++; }
  }
  if (cn > 0) { cx /= cn; cy /= cn; } else { cx = W / 2; cy = H / 2; }

  // Prefer a gentle starting biome so the first route is a level 2-4 route,
  // then fall back to whichever site sits closest to the middle.
  let startTownIndex = 0, bestD = Infinity, bestGentleD = Infinity, gentleIndex = -1;
  for (let s = 0; s < sites.length; s++) {
    const dx = sites[s].x - cx, dy = sites[s].y - cy;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; startTownIndex = s; }
    const sb = biome[sites[s].y * W + sites[s].x];
    if ((sb === B_MEADOW || sb === B_FOREST || sb === B_BEACH) && d < bestGentleD) {
      bestGentleD = d; gentleIndex = s;
    }
  }
  if (gentleIndex >= 0) startTownIndex = gentleIndex;

  const towns = [];
  const warps = [];
  const entities = [];
  const townNames = Array.isArray(Towns.TOWN_NAMES) && Towns.TOWN_NAMES.length
    ? Towns.TOWN_NAMES : FALLBACK_TOWN_NAMES;

  const map = {
    id: 'world',
    w: W,
    h: H,
    ground,
    overlay,
    biome,
    warps,
    entities,
    spawn: { x: 0, y: 0 },
    indoor: false,
    bgm: 'overworld',
    name: 'Verdant Frontier',
  };

  // A town's difficulty tier must come from DISTANCE to the start town, not from
  // its placement index. startTownIndex is chosen by biome and centrality, so it
  // is rarely 0 — which meant the "go easy on the first town" case almost never
  // fired on the town the player actually starts in, and a fresh level-5 starter
  // could meet a level-23 trainer eight tiles from spawn.
  const startSite = sites[Math.min(startTownIndex, sites.length - 1)] || sites[0];
  let maxSiteD = 1;
  for (const st of sites) {
    const d = Math.max(Math.abs(st.x - startSite.x), Math.abs(st.y - startSite.y));
    if (d > maxSiteD) maxSiteD = d;
  }

  for (let s = 0; s < sites.length; s++) {
    const site = sites[s];
    const siteD = Math.max(Math.abs(site.x - startSite.x), Math.abs(site.y - startSite.y));
    const tier = s === startTownIndex ? 0 : Math.max(1, Math.round(9 * (siteD / maxSiteD)));
    clearTownSite(site.x, site.y, TOWN_CLEAR, ground, overlay, biome);

    let name = townNames[s % townNames.length] || `Settlement ${s + 1}`;
    let stamped = false;

    if (typeof Towns.stampTown === 'function') {
      try {
        const res = Towns.stampTown(map, site.x, site.y, rng, s, tier);
        stamped = true;
        if (res && typeof res === 'object') {
          if (typeof res.name === 'string' && res.name) name = res.name;
          if (Array.isArray(res.entities)) {
            for (const e of res.entities) if (e && entities.indexOf(e) === -1) entities.push(e);
          }
          if (Array.isArray(res.warps)) {
            for (const wp of res.warps) if (wp && warps.indexOf(wp) === -1) warps.push(wp);
          }
          if (Array.isArray(res.doors)) {
            for (const dp of res.doors) if (dp && warps.indexOf(dp) === -1) warps.push(dp);
          }
        }
      } catch (err) {
        // Falling back silently hid a real defect: a variable-shadowing bug made
        // stampTown throw on every town, so every settlement lost all of its
        // NPCs, trainers, Wardens, shops and healers, and worldgen reported
        // success. A degraded world must be loud about being degraded.
        stamped = false;
        try {
          console.error('[worldgen] stampTown failed for town ' + s + ' at ' +
                        site.x + ',' + site.y + ' — the town will have no buildings ' +
                        'or people: ' + (err && err.message ? err.message : err));
        } catch (_) { /* console may be absent */ }
      }
    }

    if (!stamped) {
      // towns.js unavailable or threw: leave a plain clearing so worldgen
      // never hard-fails. The site is still walkable and still a town record.
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const xx = site.x + dx, yy = site.y + dy;
          if (!inBounds(xx, yy)) continue;
          const i = yy * W + xx;
          ground[i] = T.PATH;
          overlay[i] = 0;
        }
      }
    }

    const anchor = nearestWalkable(site.x, site.y, ground, overlay, 10);
    let ax = site.x, ay = site.y;
    if (anchor) { ax = anchor.x; ay = anchor.y; }
    else {
      const i = site.y * W + site.x;
      ground[i] = T.PATH;
      overlay[i] = 0;
    }

    towns.push({ x: ax, y: ay, name, id: `town:${s}`, index: s });
  }

  // --- start position ------------------------------------------------------
  let start;
  if (towns.length) {
    const st = towns[Math.min(startTownIndex, towns.length - 1)];
    start = { x: st.x, y: st.y };
  } else {
    const fallback = nearestWalkable(Math.round(cx), Math.round(cy), ground, overlay, 200);
    start = fallback ? { x: fallback.x, y: fallback.y } : { x: W >> 1, y: H >> 1 };
  }
  let startIdx = start.y * W + start.x;
  if (isSolid(ground[startIdx])) ground[startIdx] = T.PATH;
  overlay[startIdx] = 0;

  // --- caves ---------------------------------------------------------------
  // Re-label so cave siting sees the post-stamp world.
  buildWalkMask(ground, overlay, buf.walk);
  sizes = labelRegions(buf.walk, buf.comp, buf.stack);
  mainId = buf.comp[startIdx];
  if (mainId < 0) {
    mainId = 0; mainSize = -1;
    for (let id = 0; id < sizes.length; id++) {
      if (sizes[id] > mainSize) { mainSize = sizes[id]; mainId = id; }
    }
  }

  const caveTarget = CAVE_MIN + rng.int(CAVE_MAX - CAVE_MIN + 1);
  const caveSites = pickCaveSites(rng, elevation, biome, ground, overlay, buf.comp, mainId, towns, caveTarget);
  const caves = [];
  for (let c = 0; c < caveSites.length; c++) {
    const cs = caveSites[c];
    const i = cs.y * W + cs.x;
    ground[i] = T.STAIRS;
    overlay[i] = 0;
    // a little apron so the mouth is never wedged between two boulders
    for (let k = 0; k < 4; k++) {
      const nx = cs.x + NX4[k], ny = cs.y + NY4[k];
      if (!inBounds(nx, ny)) continue;
      const ni = ny * W + nx;
      overlay[ni] = 0;
      if (isSolid(ground[ni]) || isWater(ground[ni])) ground[ni] = T.GRAVEL;
    }
    const id = `cave:${c}`;
    caves.push({ x: cs.x, y: cs.y, id, index: c });
    // No tx/ty: enterMap falls back to the cave's own spawn, which buildInterior
    // places at the mouth, one tile from the exit. The hardcoded 5,9 dumped the
    // player deep inside an arbitrary chamber.
    warps.push({ x: cs.x, y: cs.y, to: id, dir: 'down' });
  }

  // --- legendary shrines ---------------------------------------------------
  // One fixed shrine per legendary, pushed to the far reaches of its biome. The
  // shrine is an entity the player walks to and challenges — gated on Seals by
  // the overworld — and a marker on the region map, so the endgame is a visible
  // destination instead of an invisible dice roll.
  const shrines = [];
  {
    const SHRINE_SPECS = [
      { species: 'aurorix', wants: [B_PEAK, B_TUNDRA], level: 52 },
      { species: 'magmaroth', wants: [B_PEAK, B_MOUNTAIN], level: 52 },
      { species: 'verdilith', wants: [B_JUNGLE, B_FOREST], level: 50 },
    ];
    for (const spec of SHRINE_SPECS) {
      let best = -1, bestScore = -1;
      // Deterministic scan: the farthest walkable tile of the wanted biome.
      for (let i = 0; i < W * H; i += 3) {
        const b = biome[i];
        if (b !== spec.wants[0] && b !== spec.wants[1]) continue;
        if (isSolid(ground[i]) || isWater(ground[i])) continue;
        const x = i % W, y = (i / W) | 0;
        const d = Math.max(Math.abs(x - start.x), Math.abs(y - start.y));
        // Keep shrines apart from each other.
        let clash = false;
        for (const sh of shrines) {
          if (Math.max(Math.abs(sh.x - x), Math.abs(sh.y - y)) < 60) { clash = true; break; }
        }
        if (clash) continue;
        if (d > bestScore) { bestScore = d; best = i; }
      }
      if (best < 0) continue;
      const sx2 = best % W, sy2 = (best / W) | 0;
      // Clear a small apron so the shrine is approachable from below.
      for (let dy = -1; dy <= 2; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = sx2 + dx, ny = sy2 + dy;
          if (!inBounds(nx, ny)) continue;
          const ni = ny * W + nx;
          overlay[ni] = 0;
          if (isSolid(ground[ni]) || isWater(ground[ni])) ground[ni] = T.GRAVEL;
        }
      }
      ground[best] = T.STAIRS;
      entities.push({
        kind: 'shrine', x: sx2, y: sy2, dir: 'down', blocking: true,
        sprite: 'npc_elder', name: 'Ancient Shrine',
        species: spec.species, level: spec.level,
        flag: 'shrine_' + spec.species,
      });
      shrines.push({ x: sx2, y: sy2, species: spec.species });
    }
  }

  // --- connectivity: the load-bearing invariant ---------------------------
  const protectedIdx = [startIdx];
  for (const t of towns) protectedIdx.push(t.y * W + t.x);
  for (const c of caves) protectedIdx.push(c.y * W + c.x);
  for (const sh of shrines) protectedIdx.push(sh.y * W + sh.x);

  repairConnectivity(startIdx, protectedIdx, ground, overlay, biome, buf);

  // Final targeted pass: guarantee every town + cave mouth is reachable even
  // if a stamp or a fill isolated it. Assert, then fix — never just warn.
  for (let attempt = 0; attempt < 4; attempt++) {
    buildWalkMask(ground, overlay, buf.walk);
    labelRegions(buf.walk, buf.comp, buf.stack);
    const rootId = buf.comp[startIdx];
    const stranded = [];
    for (let p = 0; p < protectedIdx.length; p++) {
      const pi = protectedIdx[p];
      if (buf.comp[pi] !== rootId) stranded.push(pi);
    }
    if (!stranded.length) break;
    costFieldFromRegion(buf.comp, rootId, buf.walk, ground, buf.dist, buf.prev);
    for (let s = 0; s < stranded.length; s++) {
      const pi = stranded[s];
      if (isSolid(ground[pi])) carveTile(pi, ground, overlay, biome);
      carvePathToMain(pi, buf.dist, buf.prev, ground, overlay, biome);
    }
    repairConnectivity(startIdx, protectedIdx, ground, overlay, biome, buf);
  }

  map.spawn = { x: start.x, y: start.y };

  // --- scattered finds ------------------------------------------------------
  // An open world with nothing to find is just a big empty map. Items are
  // sprinkled on walkable land, tuned so the reward grows with distance from the
  // start: near town you find a potion, far out you find an ultra orb. Each has
  // a stable flag so a collected pickup stays collected across a save.
  {
    const NEAR = ['potion', 'orb', 'antidote', 'orb'];
    const MID = ['superpotion', 'greatorb', 'repel', 'cureall', 'greatorb'];
    const FAR = ['hyperpotion', 'ultraorb', 'revive', 'fullrestore', 'ultraorb'];
    const maxD = Math.max(1, Math.max(W, H) / 2);
    let placed = 0;
    for (let tries = 0; tries < 26000 && placed < 90; tries++) {
      const x = 4 + rng.int(W - 8);
      const y = 4 + rng.int(H - 8);
      const i = y * W + x;
      if (isSolid(ground[i]) || isWater(ground[i]) || overlay[i] !== 0) continue;
      if (buf.comp[i] !== buf.comp[startIdx]) continue;          // must be reachable
      const d = Math.max(Math.abs(x - start.x), Math.abs(y - start.y));
      if (d < 14) continue;                                      // not on the doorstep
      // keep pickups off town plazas
      let nearTown = false;
      for (const t of towns) {
        if (Math.max(Math.abs(t.x - x), Math.abs(t.y - y)) < 16) { nearTown = true; break; }
      }
      if (nearTown) continue;
      const u = Math.min(1, d / maxD);
      const pool = u < 0.3 ? NEAR : u < 0.62 ? MID : FAR;
      map.entities.push({
        kind: 'item', x, y, dir: 'down', blocking: false,
        itemId: pool[rng.int(pool.length)],
        flag: 'find_' + x + '_' + y,
      });
      placed++;
    }
  }

  // --- roadside signposts ---------------------------------------------------
  // Direction and danger, posted where the player actually decides which way
  // to walk: just outside each town, naming the nearest settlements and how
  // hard the wilds between them run. Leaving town becomes an informed choice.
  {
    // atan2 octant → compass word. Screen coords: +x east, +y south.
    const OCT = ['east', 'south-east', 'south', 'south-west', 'west',
                 'north-west', 'north', 'north-east'];
    const compass = (dx, dy) =>
      OCT[((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8];
    const occupied = new Set();
    for (const e2 of entities) occupied.add(e2.x + ',' + e2.y);
    for (const e2 of map.entities) occupied.add(e2.x + ',' + e2.y);

    for (const t of towns) {
      // Two nearest other towns, by straight-line distance.
      const others = towns.filter((o) => o !== t)
        .map((o) => ({ o, d: Math.max(Math.abs(o.x - t.x), Math.abs(o.y - t.y)) }))
        .sort((a2, b2) => a2.d - b2.d).slice(0, 2);
      if (!others.length) continue;

      // Stand the post a few tiles out of town toward the nearest neighbour,
      // snapped to the closest clear walkable tile that is actually reachable.
      const lead = others[0].o;
      const ux = lead.x - t.x, uy = lead.y - t.y;
      const um = Math.max(1, Math.max(Math.abs(ux), Math.abs(uy)));
      const px = t.x + Math.round((ux / um) * (TOWN_CLEAR + 3));
      const py = t.y + Math.round((uy / um) * (TOWN_CLEAR + 3));
      let sx3 = -1, sy3 = -1, bestD2 = Infinity;
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const nx = px + dx, ny = py + dy;
          if (!inBounds(nx, ny)) continue;
          const ni = ny * W + nx;
          if (isSolid(ground[ni]) || isWater(ground[ni]) || overlay[ni] !== 0) continue;
          if (buf.comp[ni] !== buf.comp[startIdx]) continue;
          if (occupied.has(nx + ',' + ny)) continue;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD2) { bestD2 = d2; sx3 = nx; sy3 = ny; }
        }
      }
      if (sx3 < 0) continue;

      const lines = others.map(({ o, d }) =>
        o.name + ': ' + d + ' tiles ' + compass(o.x - t.x, o.y - t.y) + '.');
      // Route danger: the wilds midway to the nearest neighbour, which is
      // where a player following this sign will actually be walking.
      const midLvl = levelAt({ start }, (t.x + lead.x) >> 1, (t.y + lead.y) >> 1);
      lines.push('Wild creatures along the way run to about L' + midLvl + '.');
      map.entities.push({
        kind: 'sign', x: sx3, y: sy3, dir: 'down', blocking: false,
        sprite: 'sign', name: 'Signpost', lines,
      });
      occupied.add(sx3 + ',' + sy3);
    }
  }

  const world = {
    map,
    towns,
    caves,
    shrines,
    start,
    startTown: towns.length ? towns[Math.min(startTownIndex, towns.length - 1)] : null,
    elevation,
    biome,
    seed,
    w: W,
    h: H,
  };
  return world;
}

/** BIOME name at a world tile. Out of bounds reads as open ocean. */
export function biomeAt(world, x, y) {
  if (!world) return 'OCEAN';
  const arr = world.biome || (world.map && world.map.biome);
  if (!arr) return 'OCEAN';
  x |= 0; y |= 0;
  if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) return 'OCEAN';
  return BIOMES[arr[y * WORLD_W + x]] || 'OCEAN';
}

/**
 * Wild level for a tile: 2 near the start town, climbing to ~60 out at the
 * far corners. Chebyshev distance keeps the difficulty rings square-ish, which
 * reads clearly on the world map.
 */
export function levelAt(world, x, y) {
  const start = (world && world.start) || { x: WORLD_W >> 1, y: WORLD_H >> 1 };
  const sx = start.x | 0, sy = start.y | 0;

  const dx = Math.abs((x | 0) - sx);
  const dy = Math.abs((y | 0) - sy);
  const d = dx > dy ? dx : dy;

  const maxX = Math.max(sx, WORLD_W - 1 - sx);
  const maxY = Math.max(sy, WORLD_H - 1 - sy);
  const maxD = Math.max(1, Math.max(maxX, maxY));

  let u = d / maxD;
  if (u < 0) u = 0; else if (u > 1) u = 1;

  const lvl = 2 + 58 * Math.pow(u, 1.55);
  return Math.max(2, Math.min(60, Math.round(lvl)));
}

// ---------------------------------------------------------------------------
// Encounter tables
// ---------------------------------------------------------------------------
// Species ids are hardcoded strings on purpose: worldgen must stay independent
// of creatures.js. Every id below is from docs/ROSTER.md and respects that
// species' listed biomes. Starters never appear. Legendaries are weight 1 and
// Legendaries are NOT in these tables: an invisible 1-weight lottery roll is a
// hook nobody can feel. They live at fixed, map-marked shrines instead (see
// placeShrines), which turns a 0.9%-per-encounter accident into a hunt you plan.

const e = (species, weight, minLvl, maxLvl) => ({ species, weight, minLvl, maxLvl });

const ENCOUNTERS = {
  OCEAN: [],

  BEACH: [
    e('flitterwing', 55, 2, 8),
    e('mudpuff', 45, 3, 9),
  ],

  MEADOW: [
    e('mottlemouse', 38, 2, 9),
    e('flitterwing', 32, 2, 9),
    e('zapkit', 22, 3, 11),
    e('burrowarden', 8, 18, 26),
  ],

  FOREST: [
    e('mottlemouse', 24, 3, 11),
    e('flitterwing', 20, 3, 11),
    e('glimmoth', 20, 4, 13),
    e('shadewisp', 16, 4, 13),
    e('lumibud', 12, 8, 17),
    e('nightveil', 8, 26, 34),
  ],

  JUNGLE: [
    e('glimmoth', 34, 14, 24),
    e('sporecap', 30, 14, 24),
    e('lumibud', 25, 16, 27),
  ],

  SWAMP: [
    e('mudpuff', 28, 10, 20),
    e('sporecap', 24, 10, 20),
    e('bogwisp', 18, 13, 23),
    e('shadewisp', 16, 11, 21),
    e('myconaut', 14, 24, 33),
  ],

  DESERT: [
    e('dunewyrm', 34, 12, 24),
    e('pebblit', 26, 11, 22),
    e('emberbat', 22, 13, 25),
    e('sandcoil', 18, 26, 36),
  ],

  SAVANNA: [
    e('zapkit', 36, 8, 18),
    e('burrowarden', 28, 18, 28),
    e('voltlope', 24, 20, 30),
    e('thunderjaw', 12, 28, 38),
  ],

  TUNDRA: [
    e('frostkit', 64, 14, 26),
    e('rimewolf', 36, 24, 36),
  ],

  MOUNTAIN: [
    e('pebblit', 24, 14, 24),
    e('galeplume', 18, 18, 30),
    e('boulderkin', 16, 22, 34),
    e('emberbat', 14, 15, 26),
    e('tinplate', 12, 20, 32),
    e('cragfang', 10, 22, 34),
    e('thunderjaw', 6, 28, 40),
  ],

  PEAK: [
    e('galeplume', 26, 30, 44),
    e('boulderkin', 22, 32, 46),
    e('rimewolf', 18, 30, 44),
    e('cragfang', 16, 32, 46),
    e('ironclad', 16, 34, 48),
  ],
};

/**
 * Wild encounter table for a biome.
 * @param {string} biome BIOME key (or a BIOMES index)
 * @returns {Array<{species:string,weight:number,minLvl:number,maxLvl:number}>}
 *          A fresh array each call; OCEAN is the only empty one.
 */
export function encounterTableFor(biome) {
  let key = biome;
  if (typeof key === 'number') key = BIOMES[key];
  if (typeof key !== 'string') return [];
  key = key.toUpperCase();
  const table = Object.prototype.hasOwnProperty.call(ENCOUNTERS, key) ? ENCOUNTERS[key] : null;
  if (!table) return [];
  // Copy so callers can sort/filter without corrupting the table.
  return table.map((r) => ({ species: r.species, weight: r.weight, minLvl: r.minLvl, maxLvl: r.maxLvl }));
}

export default generateWorld;
