// Loss-flow probe: lose a wild battle, then verify the wipe explanation is
// VISIBLE (dialogue over the town, screen not black) — the exact failure every
// playtest persona reported as "the game crashed".
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const ROOT = process.cwd();
let PORT = 0;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const srv = await new Promise((res) => {
  const s = createServer(async (req, rq) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const full = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!full.startsWith(ROOT) || !existsSync(full)) { rq.writeHead(404); rq.end(); return; }
    rq.writeHead(200, { 'Content-Type': MIME[extname(full)] || 'application/octet-stream' });
    rq.end(await readFile(full));
  });
  s.listen(0, () => { PORT = s.address().port; res(s); });
});

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`http://localhost:${PORT}/game/`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, { timeout: 20000 });
for (let i = 0; i < 30; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(110); }

// Walk into grass and enter a battle.
const g = await page.evaluate(() => {
  const { S } = window.__game;
  const m = S.world.map, start = S.world.start;
  const seen = new Uint8Array(m.w * m.h);
  const stack = [start.y * m.w + start.x]; seen[stack[0]] = 1;
  while (stack.length) {
    const i = stack.pop();
    if (window.__game.isGrassTile(m.ground[i])) return { x: i % m.w, y: (i / m.w) | 0 };
    const x = i % m.w, y = (i / m.w) | 0;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
      const j = ny * m.w + nx;
      if (seen[j]) continue;
      if (window.__game.isSolidTile(m.ground[j]) || window.__game.overlayBlocksTile(m.overlay[j])) continue;
      seen[j] = 1; stack.push(j);
    }
  }
  return null;
});
await page.evaluate(([x, y]) => window.__game.enterMap('world', x, y, 'down'), [g.x, g.y]);
await page.waitForTimeout(400);
for (let b = 0; b < 60; b++) {
  const st = await page.evaluate(() => window.__probe());
  if (st.scene === 'battle') break;
  const k = b % 2 ? 'ArrowLeft' : 'ArrowRight';
  await page.keyboard.down(k); await page.waitForTimeout(260); await page.keyboard.up(k);
  await page.waitForTimeout(80);
}
let st = await page.evaluate(() => window.__probe());
if (st.scene !== 'battle') { console.log('LOSS PROBE: no battle entered'); process.exit(1); }

// Guarantee the loss: our creature at 1 HP, the foe strong enough to finish it.
await page.evaluate(async () => {
  const { BattleScene: B } = await import('./js/battle.js');
  if (B.me && B.me.inst) B.me.inst.hp = 1;
  if (B.foe && B.foe.inst) B.foe.inst.level = Math.max(B.foe.inst.level, 20);
});

// Mash through the loss; sample the screen the whole way.
const frames = [];
let sawDialogueOverTown = false;
for (let i = 0; i < 120; i++) {
  await page.keyboard.press('z');
  await page.waitForTimeout(200);
  if (i % 4 === 3) {
    const info = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let lit = 0;
      for (let k = 0; k < d.length; k += 400) if (d[k] + d[k + 1] + d[k + 2] > 60) lit++;
      const st2 = window.__probe();
      return { scene: st2.scene, count: st2.sceneCount, lit, map: st2.map, hp0: true };
    });
    frames.push(info);
    // dialogue over the overworld with a substantially lit screen = the fix
    if (info.scene !== 'battle' && info.count >= 2 && info.lit > 200) {
      sawDialogueOverTown = true;
      await page.screenshot({ path: '/tmp/claude-0/-home-user-microatlas-research/55073887-1b33-5a66-8e2f-d0de53d81307/scratchpad/loss-visible.png' });
      break;
    }
  }
}
// finish the dialogue
for (let i = 0; i < 6; i++) { await page.keyboard.press('z'); await page.waitForTimeout(200); }
const end = await page.evaluate(() => {
  const st2 = window.__probe();
  const { S } = window.__game;
  return { scene: st2.scene, money: st2.money, hp: S.party[0].hp };
});
console.log('frames sampled:', frames.length, 'sawVisibleWipeDialogue:', sawDialogueOverTown);
console.log('end:', JSON.stringify(end), 'errors:', errors.length);
const feeOk = end.money === 540;   // 10% of 600 at zero badges — the gentler early fee
const ok = sawDialogueOverTown && end.scene === 'overworld' && end.hp > 0 && feeOk && errors.length === 0;
if (!feeOk) console.log('fee mismatch: expected 540 after 10% early fee, got', end.money);
console.log(ok ? 'LOSS PROBE: wipe message visible over the town, healed, gentle fee' : 'LOSS PROBE: FAILURE');
await browser.close(); srv.close();
process.exit(ok ? 0 : 1);
