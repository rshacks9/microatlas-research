// Every wild species must be ACTUALLY encounterable: not just present in a
// biome's encounter table, but with reachable encounter-rate tiles in that biome.
// This checker exists because four surface biomes shipped with 0.0% encounter
// coverage — every species exclusive to them, both PEAK legendaries included,
// was uncatchable in practice while the table-level checker stayed green.
// Run: node tools/check-huntable.mjs [seeds]
import { generateWorld, encounterTableFor, BIOMES } from '../game/js/worldgen.js';
import { buildInterior } from '../game/js/towns.js';
import { isSolid, overlayBlocks, encounterRate, isGrass } from '../game/js/tiles.js';
import { allSpecies, getSpecies } from '../game/js/creatures.js';

const N = parseInt(process.argv[2] || '3', 10);
let fails = 0;
const fail = (m) => { fails++; console.log('  FAIL ' + m); };

// Reachable encounter tiles per biome, under the game's full collision rule.
function reachableEncByBiome(w) {
  const m = w.map;
  const occupied = new Set();
  for (const e of m.entities) {
    if (!e || e.kind === 'item' || e.kind === 'sign' || e.kind === 'door') continue;
    if (e.blocking === false) continue;
    occupied.add(e.x + ',' + e.y);
  }
  const seen = new Uint8Array(m.w * m.h);
  const st = [w.start.y * m.w + w.start.x];
  seen[st[0]] = 1;
  const enc = new Array(BIOMES.length).fill(0);
  while (st.length) {
    const i = st.pop();
    if (encounterRate(m.ground[i]) > 0) enc[w.biome[i]]++;
    const x = i % m.w, y = (i / m.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
      const j = ny * m.w + nx;
      if (seen[j]) continue;
      if (isSolid(m.ground[j]) || overlayBlocks(m.overlay[j])) continue;
      if (occupied.has(nx + ',' + ny)) continue;
      seen[j] = 1; st.push(j);
    }
  }
  return enc;
}

console.log('=== HUNTABILITY: tables x tiles x reachability (' + N + ' seeds) ===');

// Union across seeds: a species is fine if SOME seed offers it, since every
// playthrough is one seed — so also track the per-seed worst case.
const perSeedMisses = [];
const unionHuntable = new Set();

for (let s = 0; s < N; s++) {
  const seed = 60601 + s * 5227;
  const w = generateWorld(seed);
  const enc = reachableEncByBiome(w);

  const huntableBiomes = new Set();
  for (let b = 0; b < BIOMES.length; b++) {
    // 25+ reachable encounter tiles = a patch a player can realistically find.
    if (enc[b] >= 25) huntableBiomes.add(BIOMES[b]);
  }

  const misses = [];
  for (const biome of BIOMES) {
    for (const e of (encounterTableFor(biome) || [])) {
      if (huntableBiomes.has(biome)) unionHuntable.add(e.species);
    }
  }
  for (const sp of allSpecies()) {
    if (!sp.biomes || !sp.biomes.length) continue;      // starters: granted, not hunted
    const inTable = BIOMES.some((b) => (encounterTableFor(b) || []).some((e) => e.species === sp.id));
    if (!inTable) continue;                             // stage-2s reached by evolution
    const ok = BIOMES.some((b) =>
      huntableBiomes.has(b) && (encounterTableFor(b) || []).some((e) => e.species === sp.id));
    if (!ok) misses.push(sp.id);
  }
  perSeedMisses.push({ seed, misses });
  console.log('  seed ' + seed + ': biomes with reachable encounter patches: ' +
    [...huntableBiomes].filter((b) => b !== 'OCEAN').length + '/10' +
    (misses.length ? '   unhuntable here: ' + misses.join(', ') : ''));
}

// Per-seed rule: a species missing on EVERY seed is broken; missing on one seed
// out of several is world-variance worth knowing about but not a failure, EXCEPT
// legendaries — a playthrough where a legendary cannot appear breaks the dex on
// that save, so they must be huntable on every seed.
const alwaysMissing = perSeedMisses[0].misses.filter((id) =>
  perSeedMisses.every((r) => r.misses.includes(id)));
for (const id of alwaysMissing) fail('species "' + id + '" has no huntable biome on ANY seed');

for (const r of perSeedMisses) {
  for (const id of r.misses) {
    if (getSpecies(id).rarity === 'legendary') {
      fail('legendary "' + id + '" is unhuntable on seed ' + r.seed + ' — that save can never complete its dex');
    }
  }
}

// Caves must carry their own reachable encounter tiles from the entrance.
console.log('\n=== CAVE ENCOUNTERS ===');
for (const seed of [17, 4242]) {
  const c = buildInterior('cave', seed, 0);
  const seen = new Uint8Array(c.w * c.h);
  const st = [c.spawn.y * c.w + c.spawn.x];
  seen[st[0]] = 1;
  let enc = 0;
  while (st.length) {
    const i = st.pop();
    if (encounterRate(c.ground[i]) > 0) enc++;
    const x = i % c.w, y = (i / c.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= c.w || ny >= c.h) continue;
      const j = ny * c.w + nx;
      if (seen[j] || isSolid(c.ground[j]) || overlayBlocks(c.overlay[j])) continue;
      seen[j] = 1; st.push(j);
    }
  }
  console.log('  cave seed ' + seed + ': reachable encounter tiles: ' + enc);
  if (enc < 8) fail('cave seed ' + seed + ' has only ' + enc + ' reachable encounter tiles');
}

console.log('\n' + (fails ? 'HUNTABLE: ' + fails + ' FAILURES'
                          : 'HUNTABLE: every wild species can actually be encountered'));
process.exit(fails ? 1 : 0);
