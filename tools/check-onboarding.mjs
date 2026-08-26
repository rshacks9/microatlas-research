// Measures the opening experience: how far a NEW player must actually walk from
// the spawn point to reach their first patch of encounter grass, by real
// pathfinding rather than straight-line distance. A long or twisty first walk is
// an onboarding failure even when the world is technically connected.
import { generateWorld } from '../game/js/worldgen.js';
import { isSolid, isGrass, overlayBlocks } from '../game/js/tiles.js';

const N = parseInt(process.argv[2] || '12', 10);
let fails = 0;
const fail = (m) => { fails++; console.log('  FAIL ' + m); };

function bfsToGrass(map, sx, sy) {
  const n = map.w * map.h;
  const dist = new Int32Array(n).fill(-1);
  const start = sy * map.w + sx;
  dist[start] = 0;
  const q = new Int32Array(n);
  let head = 0, tail = 0;
  q[tail++] = start;
  let firstGrass = -1, firstGrassDist = -1, reachable = 0, grassCount = 0;

  while (head < tail) {
    const i = q[head++];
    reachable++;
    const x = i % map.w, y = (i / map.w) | 0;
    if (isGrass(map.ground[i])) {
      grassCount++;
      if (firstGrass < 0) { firstGrass = i; firstGrassDist = dist[i]; }
    }
    const push = (nx, ny) => {
      if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) return;
      const j = ny * map.w + nx;
      if (dist[j] !== -1) return;
      if (isSolid(map.ground[j]) || overlayBlocks(map.overlay[j])) return;
      dist[j] = dist[i] + 1;
      q[tail++] = j;
    };
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  return { firstGrass, firstGrassDist, reachable, grassCount, dist };
}

console.log('=== ONBOARDING: first walk from spawn to encounter grass (' + N + ' seeds) ===');
console.log('seed        reachable   grass   steps-to-grass   straight-line   detour');

const steps = [];
for (let s = 0; s < N; s++) {
  const seed = 90001 + s * 4517;
  const w = generateWorld(seed);
  const map = w.map;
  const r = bfsToGrass(map, w.start.x, w.start.y);

  if (r.firstGrass < 0) { fail('seed ' + seed + ': NO reachable encounter grass at all'); continue; }

  const gx = r.firstGrass % map.w, gy = (r.firstGrass / map.w) | 0;
  const straight = Math.abs(gx - w.start.x) + Math.abs(gy - w.start.y);
  const detour = straight > 0 ? (r.firstGrassDist / straight) : 1;
  steps.push(r.firstGrassDist);

  console.log(
    String(seed).padEnd(11) +
    String(r.reachable).padStart(8) +
    String(r.grassCount).padStart(8) +
    String(r.firstGrassDist).padStart(16) +
    String(straight).padStart(15) +
    ('  x' + detour.toFixed(2)).padStart(9)
  );

  // A new player should reach their first encounter quickly and without a maze.
  if (r.firstGrassDist > 45) fail('seed ' + seed + ': first grass is ' + r.firstGrassDist + ' steps away — too far for an opening');
  if (detour > 3.0) fail('seed ' + seed + ': path to first grass is ' + detour.toFixed(1) + 'x the straight-line distance — the town is a maze');
  if (r.reachable < 5000) fail('seed ' + seed + ': only ' + r.reachable + ' tiles reachable from spawn');
}

steps.sort((a, b) => a - b);
if (steps.length) {
  console.log('\nsteps to first grass:  min ' + steps[0] +
              '  median ' + steps[(steps.length / 2) | 0] +
              '  max ' + steps[steps.length - 1]);
}

console.log('\n' + (fails ? 'ONBOARDING: ' + fails + ' FAILURES' : 'ONBOARDING: the opening walk is short and direct on every seed'));
process.exit(fails ? 1 : 0);
