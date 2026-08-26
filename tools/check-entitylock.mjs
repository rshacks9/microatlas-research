// Softlock check the existing tools do NOT cover: reachability under the game's
// FULL collision rule, entities included. check-world only flood-fills terrain.
import { generateWorld } from '../game/js/worldgen.js';
import { isSolid, overlayBlocks } from '../game/js/tiles.js';

const NONBLOCKING = { item: 1, sign: 1, door: 1 };
let fails = 0;

function reachable(w) {
  const m = w.map;
  const occupied = new Set();
  for (const e of m.entities) {
    if (!e || NONBLOCKING[e.kind]) continue;
    if (e.blocking === false) continue;
    occupied.add(e.x + ',' + e.y);
  }
  const seen = new Uint8Array(m.w * m.h);
  const st = [w.start.y * m.w + w.start.x];
  seen[st[0]] = 1;
  let n = 0;
  while (st.length) {
    const i = st.pop(); n++;
    const x = i % m.w, y = (i / m.w) | 0;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
      const j = ny * m.w + nx;
      if (seen[j]) continue;
      if (isSolid(m.ground[j]) || overlayBlocks(m.overlay[j])) continue;
      if (occupied.has(nx + ',' + ny)) continue;
      seen[j] = 1; st.push(j);
    }
  }
  return { seen, n, occupied };
}

console.log('=== REACHABILITY UNDER FULL COLLISION (entities included) ===');
console.log('seed        reachable   towns ok   wardens ok   doors ok');
for (let s = 0; s < 10; s++) {
  const seed = 777 + s * 3313;
  const w = generateWorld(seed);
  const m = w.map;
  const { seen, n } = reachable(w);

  const near = (x, y, r) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < m.w && ny < m.h && seen[ny * m.w + nx]) return true;
    }
    return false;
  };

  let townsOk = 0;
  for (const t of w.towns) if (near(t.x, t.y, 4)) townsOk++;
  const wardens = m.entities.filter((e) => e.warden);
  let wardOk = 0;
  for (const e of wardens) if (near(e.x, e.y, 1)) wardOk++;
  const doors = m.warps.filter((wp) => String(wp.to || '').startsWith('inside:'));
  let doorOk = 0;
  for (const d of doors) if (near(d.x, d.y, 1)) doorOk++;

  console.log(String(seed).padEnd(11) + String(n).padStart(10) +
    (townsOk + '/' + w.towns.length).padStart(11) +
    (wardOk + '/' + wardens.length).padStart(13) +
    (doorOk + '/' + doors.length).padStart(11));

  if (townsOk < w.towns.length) { fails++; console.log('  FAIL a town is unreachable once entities block'); }
  if (wardOk < wardens.length) { fails++; console.log('  FAIL a Warden cannot be reached — a Seal would be unobtainable'); }
  if (doorOk < doors.length) { fails++; console.log('  FAIL a building door is unreachable'); }
  if (n < 5000) { fails++; console.log('  FAIL only ' + n + ' tiles reachable with entities blocking'); }
}
console.log('\n' + (fails ? 'ENTITY REACHABILITY: ' + fails + ' FAILURES'
                           : 'ENTITY REACHABILITY: everything stays reachable with entities blocking'));
process.exit(fails ? 1 : 0);
