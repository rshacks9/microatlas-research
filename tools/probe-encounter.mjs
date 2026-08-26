// Targeted test: put the player on real tall grass and confirm encounters fire,
// and separately measure how far the player can actually get from the spawn point.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const ROOT = process.cwd();
const PORT = 8131;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

const srv = await new Promise((res) => {
  const s = createServer(async (req, rq) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const full = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!full.startsWith(ROOT) || !existsSync(full)) { rq.writeHead(404); rq.end(); return; }
    rq.writeHead(200, { 'Content-Type': MIME[extname(full)] || 'application/octet-stream' });
    rq.end(await readFile(full));
  });
  s.listen(PORT, () => res(s));
});

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`http://localhost:${PORT}/game/`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, { timeout: 20000 });

// Start a new game and get through the intro.
for (let i = 0; i < 26; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(110); }
const st0 = await page.evaluate(() => window.__probe());
console.log('after intro:', JSON.stringify(st0));

// --- 1. How much of the world can the player actually reach from spawn? ---
const reach = await page.evaluate(() => {
  const { S } = window.__game;
  const m = S.world.map;
  const start = S.world.start;
  // Replicate the game's own walkability rule via the live GameMap if we can.
  const seen = new Uint8Array(m.w * m.h);
  const stack = [start.y * m.w + start.x];
  seen[start.y * m.w + start.x] = 1;
  let n = 0, grassReachable = 0, nearestGrass = null;
  const solid = (x, y) => {
    if (x < 0 || y < 0 || x >= m.w || y >= m.h) return true;
    const i = y * m.w + x;
    return window.__game.isSolidTile(m.ground[i]) || window.__game.overlayBlocksTile(m.overlay[i]);
  };
  while (stack.length) {
    const i = stack.pop(); n++;
    const x = i % m.w, y = (i / m.w) | 0;
    if (window.__game.isGrassTile(m.ground[i])) {
      grassReachable++;
      const d = Math.max(Math.abs(x - start.x), Math.abs(y - start.y));
      if (!nearestGrass || d < nearestGrass.d) nearestGrass = { x, y, d };
    }
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
      const j = ny * m.w + nx;
      if (seen[j] || solid(nx, ny)) continue;
      seen[j] = 1; stack.push(j);
    }
  }
  return { reachable: n, grassReachable, nearestGrass, start, total: m.w * m.h };
});
console.log('reachability from spawn:', JSON.stringify(reach));

// --- 2. Teleport onto grass and walk; encounters must fire ---
if (reach.nearestGrass) {
  const g = reach.nearestGrass;
  await page.evaluate(([gx, gy]) => window.__game.enterMap('world', gx, gy, 'down'), [g.x, g.y]);
  await page.waitForTimeout(400);
  const onGrass = await page.evaluate(() => window.__probe());
  console.log('teleported to grass at', g.x + ',' + g.y, '->', JSON.stringify(onGrass));

  let battled = false;
  for (let i = 0; i < 40 && !battled; i++) {
    await page.keyboard.down(i % 2 ? 'ArrowRight' : 'ArrowLeft');
    await page.waitForTimeout(260);
    await page.keyboard.up(i % 2 ? 'ArrowRight' : 'ArrowLeft');
    await page.waitForTimeout(60);
    const s = await page.evaluate(() => window.__probe());
    if (s.scene === 'battle' || s.sceneCount > 1) { battled = true; console.log('ENCOUNTER at burst', i, JSON.stringify(s)); break; }
  }
  const fin = await page.evaluate(() => window.__probe());
  console.log('after grass walk:', JSON.stringify(fin));
  if (!battled) console.log('NO ENCOUNTER while standing on grass — grassSteps=' + fin.grassSteps + ' rolls=' + fin.encounterRolls);
  else {
    // let the slide-in animation settle before capturing
    await page.waitForTimeout(1400);
    await page.screenshot({ path: '.harness/battle.png' });
    console.log('battle screenshot (settled) saved');

    // advance to the action menu
    for (let i = 0; i < 4; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(320); }
    await page.screenshot({ path: '.harness/battle-menu.png' });

    // Fight -> first move, then play out several turns
    await page.keyboard.press('Enter'); await page.waitForTimeout(320);
    await page.screenshot({ path: '.harness/battle-moves.png' });
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(240);
      const s = await page.evaluate(() => window.__probe());
      if (s.scene !== 'battle') { console.log('battle ended after', i, 'presses ->', JSON.stringify(s)); break; }
    }
    await page.screenshot({ path: '.harness/battle-turn.png' });
    const post = await page.evaluate(() => window.__probe());
    console.log('post-battle:', JSON.stringify(post));
  }
}

console.log('console errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
srv.close();
