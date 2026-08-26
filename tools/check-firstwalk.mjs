// The opening must be survivable. A fresh level-5 starter walking out of the
// start town must not run into a trainer it cannot beat and cannot flee.
// This exists because town difficulty was keyed to placement index while the
// start town is chosen by centrality, so the "easy first town" case almost never
// fired where it mattered — level-23 trainers, eight tiles from spawn.
import { generateWorld } from '../game/js/worldgen.js';

const N = parseInt(process.argv[2] || '14', 10);
const STARTER_LEVEL = 5;
const SAFE_RADIUS = 30;      // tiles from spawn a beginner will plausibly wander
const MAX_SAFE_LEVEL = 9;    // beatable by a level-5 starter

let fails = 0;
let worstSeen = 0;

console.log('=== FIRST WALK SAFETY (' + N + ' seeds) ===');
console.log('seed        trainers<=30t   max level   wardens<=30t   max warden lvl');

for (let i = 0; i < N; i++) {
  const seed = 31337 + i * 2711;
  const w = generateWorld(seed);
  const start = w.start;

  const near = [];
  const nearWardens = [];
  for (const e of w.map.entities) {
    if (e.kind !== 'trainer') continue;
    const d = Math.max(Math.abs(e.x - start.x), Math.abs(e.y - start.y));
    if (d > SAFE_RADIUS) continue;
    const lvl = (e.team || []).reduce((a, t) => Math.max(a, t.level || 0), 0);
    (e.warden ? nearWardens : near).push({ d, lvl, name: e.name });
  }

  const maxLvl = near.reduce((a, t) => Math.max(a, t.lvl), 0);
  const maxWard = nearWardens.reduce((a, t) => Math.max(a, t.lvl), 0);
  worstSeen = Math.max(worstSeen, maxLvl);

  console.log(
    String(seed).padEnd(11) +
    String(near.length).padStart(12) +
    String(maxLvl).padStart(12) +
    String(nearWardens.length).padStart(15) +
    String(maxWard).padStart(16)
  );

  for (const t of near) {
    if (t.lvl > MAX_SAFE_LEVEL) {
      fails++;
      console.log('    FAIL a level ' + t.lvl + ' ambusher (' + t.name + ') sits ' + t.d +
                  ' tiles from spawn — unwinnable and unfleeable for a level ' + STARTER_LEVEL + ' starter');
    }
  }
  // Wardens are opt-in (sight 0), so a strong one nearby is fine — but not absurd.
  for (const t of nearWardens) {
    if (t.lvl > 20) {
      fails++;
      console.log('    FAIL the nearby Warden is level ' + t.lvl + ', too steep for a first challenge');
    }
  }
}

console.log('\nhighest ambusher level within ' + SAFE_RADIUS + ' tiles of spawn: ' + worstSeen +
            ' (limit ' + MAX_SAFE_LEVEL + ')');
console.log(fails ? 'FIRST WALK: ' + fails + ' FAILURES' : 'FIRST WALK: the opening is survivable on every seed');
process.exit(fails ? 1 : 0);
