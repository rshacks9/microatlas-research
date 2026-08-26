// Verifies the wild-level difficulty curve: levels must stay gentle near the start
// town and rise with distance, in EVERY biome. Run: node tools/check-curve.mjs
import { generateWorld, levelAt, encounterTableFor, biomeAt, BIOMES } from '../game/js/worldgen.js';

// Mirror of overworld.js rollEncounter level selection.
function levelFor(base, pick, rnd) {
  const lo = pick.minLvl !== undefined ? pick.minLvl : Math.max(2, base - 2);
  const hi = pick.maxLvl !== undefined ? pick.maxLvl : base + 1;
  const a = Math.min(lo, hi), b = Math.max(lo, hi);
  const roll = a + Math.floor(rnd() * (b - a + 1));
  const floor = Math.max(2, base - 3);
  const ceil = Math.max(floor, base + 4);
  return Math.max(2, Math.min(100, Math.max(floor, Math.min(ceil, roll))));
}

let rs = 12345;
const rnd = () => ((rs = (rs * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

const world = generateWorld(4242);
const start = world.start;
let fails = 0;

console.log('=== WILD LEVEL CURVE (start at ' + start.x + ',' + start.y + ') ===');
console.log('dist  base   observed wild levels (min-max over all biomes)');

for (const dist of [0, 5, 12, 25, 50, 90, 150, 250]) {
  let lo = Infinity, hi = -Infinity, n = 0;
  for (const biome of BIOMES) {
    const table = encounterTableFor(biome);
    if (!table || !table.length) continue;
    const base = levelAt(world, Math.min(world.map.w - 1, start.x + dist), start.y);
    for (const pick of table) {
      for (let i = 0; i < 40; i++) {
        const lv = levelFor(base, pick, rnd);
        lo = Math.min(lo, lv); hi = Math.max(hi, lv); n++;
      }
    }
  }
  const base = levelAt(world, Math.min(world.map.w - 1, start.x + dist), start.y);
  console.log(
    String(dist).padStart(4) + '  ' + String(base).padStart(4) + '   ' +
    String(lo).padStart(3) + ' - ' + String(hi).padStart(3) + '   (' + n + ' samples)'
  );
  if (dist <= 5 && hi > 9) { fails++; console.log('       FAIL: level ' + hi + ' is far too strong this close to the start town'); }
  if (dist >= 150 && hi < 25) { fails++; console.log('       FAIL: distant wilds only reach level ' + hi); }
}

// Per-biome check right next to the start town — this is where the old bug lived.
console.log('\n=== NEAR-START SAFETY, PER BIOME (dist 8) ===');
const nearBase = levelAt(world, start.x + 8, start.y);
for (const biome of BIOMES) {
  const table = encounterTableFor(biome);
  if (!table || !table.length) continue;
  let hi = 0, worst = '';
  for (const pick of table) {
    for (let i = 0; i < 60; i++) {
      const lv = levelFor(nearBase, pick, rnd);
      if (lv > hi) { hi = lv; worst = pick.species; }
    }
  }
  const bad = hi > 9;
  if (bad) fails++;
  console.log('  ' + biome.padEnd(9) + ' max level ' + String(hi).padStart(3) +
              '  (' + worst + ')' + (bad ? '   <-- TOO STRONG NEAR START' : ''));
}

console.log('\n' + (fails ? 'CURVE: ' + fails + ' FAILURES' : 'CURVE: difficulty scales with distance in every biome'));
process.exit(fails ? 1 : 0);
