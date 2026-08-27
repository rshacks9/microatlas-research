// Concede probe: the Forfeit confirm must ask its question, default to the
// safe answer, and a concede with a healthy team must never claim the party
// was wiped. All three shipped wrong in the first cut of the feature.
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
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const key = async (k, ms = 260) => { await page.keyboard.press(k); await page.waitForTimeout(ms); };

await page.goto(`http://localhost:${PORT}/game/`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, { timeout: 20000 });
for (let i = 0; i < 30; i++) await key('Enter', 110);

// Stand before the nearest trainer (any, warden included) and challenge them.
const t = await page.evaluate(() => {
  const { S } = window.__game;
  const start = S.world.start;
  let best = null, bd = Infinity;
  for (const e of S.world.map.entities) {
    if (e.kind !== 'trainer') continue;
    const d = Math.max(Math.abs(e.x - start.x), Math.abs(e.y - start.y));
    if (d < bd) { bd = d; best = { x: e.x, y: e.y, name: e.name }; }
  }
  const c = S.party[0];
  c.level = 30; c.hp = 300;   // healthy and safe while menus are driven
  return best;
});
await page.evaluate(([x, y]) => window.__game.enterMap('world', x, y + 1, 'up'), [t.x, t.y]);
await page.waitForTimeout(400);
await key('KeyZ', 700);                       // challenge line

// Advance until the MAIN battle menu is actually open, then navigate.
const waitMainMenu = async () => {
  for (let i = 0; i < 60; i++) {
    const m = await page.evaluate(async () => {
      const { BattleScene: B } = await import('./js/battle.js');
      return B.waiting && B.waiting.kind === 'menu' && B.menu ? B.menu.kind : null;
    });
    if (m === 'main') return true;
    await key('KeyZ', 220);
  }
  return false;
};
if (!(await waitMainMenu())) { console.log('CONCEDE PROBE: main menu never opened'); process.exit(1); }
await key('ArrowDown'); await key('ArrowRight'); await key('KeyZ', 500);

const menu = await page.evaluate(async () => {
  const { BattleScene: B } = await import('./js/battle.js');
  return B.menu && { title: B.menu.title, index: B.menu.index, labels: B.menu.items.map((i2) => i2.label) };
});
console.log('confirm menu:', JSON.stringify(menu));
await page.screenshot({ path: '/tmp/claude-0/-home-user-microatlas-research/55073887-1b33-5a66-8e2f-d0de53d81307/scratchpad/concede-confirm.png' });

// Default (index 0) must be 'Keep fighting'; a mashed A must NOT concede.
await key('KeyZ', 500);
const afterKeep = await page.evaluate(() => window.__probe());
const keptFighting = afterKeep.scene === 'battle';

// Concede deliberately: back to the main menu, Forfeit, Down, confirm.
if (!(await waitMainMenu())) { console.log('CONCEDE PROBE: menu lost after keep-fighting'); process.exit(1); }
await key('ArrowDown'); await key('ArrowRight'); await key('KeyZ', 500);
await key('ArrowDown'); await key('KeyZ', 500);

// Drain to the overworld; screenshot the post-concede dialogue for reading.
let shot = false;
for (let i = 0; i < 60; i++) {
  const st = await page.evaluate(() => window.__probe());
  if (!shot && st.scene !== 'battle' && st.sceneCount >= 2 && st.map === 'world') {
    await page.waitForTimeout(600);   // let the fade finish and text render
    await page.screenshot({ path: '/tmp/claude-0/-home-user-microatlas-research/55073887-1b33-5a66-8e2f-d0de53d81307/scratchpad/concede-message.png' });
    shot = true;
  }
  if (st.scene === 'overworld' && st.sceneCount === 1 && i > 4) break;
  await key('KeyZ', 260);
}
const end = await page.evaluate(() => {
  const { S } = window.__game;
  return { scene: window.__probe().scene, hp: S.party[0].hp, money: S.player.money };
});
console.log('after concede:', JSON.stringify(end), 'messageShot:', shot);

const menuOk = menu && menu.title === 'Forfeit the match?' && menu.index === 0 && menu.labels[0] === 'Keep fighting';
const ok = menuOk && keptFighting && shot && end.hp > 0 && end.money < 600 && errors.length === 0;
console.log(JSON.stringify({ menuOk, keptFighting, messageShot: shot, healthyAfter: end.hp > 0, feeCharged: end.money < 600, errors: errors.length }));
console.log(ok ? 'CONCEDE PROBE: question asked, safe default, honest message'
              : 'CONCEDE PROBE: FAILURE');
await browser.close(); srv.close();
process.exit(ok ? 0 : 1);
