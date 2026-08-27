// Outcome probe for the Seal award: talk to the start-town Warden, win, and
// assert S.badges increments and the beaten Warden remains interactable.
// This is the live check the review demanded: the award path through the
// WRAPPED entity, not the spec.
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

await page.goto(`http://localhost:${PORT}/game/`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, { timeout: 20000 });
for (let i = 0; i < 30; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(110); }
let st = await page.evaluate(() => window.__probe());
if (!st.started) { console.log('WARDEN PROBE: intro did not complete', JSON.stringify(st)); process.exit(1); }

// Find the start-town Warden and stand below them, facing up.
const w = await page.evaluate(() => {
  const { S } = window.__game;
  const start = S.world.start;
  let best = null, bestD = Infinity;
  for (const e of S.world.map.entities) {
    if (!e.warden) continue;
    const d = Math.max(Math.abs(e.x - start.x), Math.abs(e.y - start.y));
    if (d < bestD) { bestD = d; best = { x: e.x, y: e.y, name: e.name, seal: e.seal, flag: e.flag, challenge: (e.challenge || '').slice(0, 60) }; }
  }
  return best;
});
console.log('warden:', JSON.stringify(w));
if (!w || !w.seal) { console.log('WARDEN PROBE: no warden with seal found'); process.exit(1); }

await page.evaluate(([x, y]) => window.__game.enterMap('world', x, y + 1, 'up'), [w.x, w.y]);
await page.waitForTimeout(400);

// Make our side certain to win before the battle starts.
await page.evaluate(async () => {
  const { getMove } = await import('./js/moves.js');
  const c = window.__game.S.party[0];
  c.level = 40; c.hp = 400;
  c.moves.sort((a, b) => (getMove(b.id).power || 0) - (getMove(a.id).power || 0));
});

const badgesBefore = await page.evaluate(() => window.__game.S.badges | 0);
await page.keyboard.press('z');          // talk -> challenge line -> battle
await page.waitForTimeout(700);

// Wait for the battle scene, then hold every foe at 1 HP as they come out.
let sawChallenge = false;
for (let i = 0; i < 300; i++) {
  const info = await page.evaluate(async () => {
    const { BattleScene: B } = await import('./js/battle.js');
    const st2 = window.__probe();
    if (st2.scene === 'battle' && B.foe && B.foe.inst) {
      B.foe.inst.hp = Math.min(B.foe.inst.hp, 1);
      if (B.foeTeam) for (const m of B.foeTeam) if (m) m.hp = Math.min(m.hp, 1);
    }
    return { scene: st2.scene, badges: window.__game.S.badges | 0, errors: st2.errors };
  });
  if (i > 4 && info.scene !== 'battle' && info.badges > badgesBefore) break;
  await page.keyboard.press('z');
  await page.waitForTimeout(150);
}
await page.waitForTimeout(400);
for (let i = 0; i < 14; i++) { await page.keyboard.press('z'); await page.waitForTimeout(180); }  // seal + milestone dialogue

const after = await page.evaluate(() => ({
  badges: window.__game.S.badges | 0,
  scene: window.__probe().scene,
  flags: Object.keys(window.__game.S.flags).filter((k) => k.startsWith('warden')),
}));
console.log('after battle:', JSON.stringify(after), 'errors:', errors.length);

// The beaten Warden must still be there and interactable (after-lines).
const still = await page.evaluate(async ([x, y]) => {
  const ow = await import('./js/overworld.js');
  const map = ow.Overworld.map;
  const e = map.entityAt(x, y);
  return { present: !!e, name: e && e.name, hidden: !!(e && e.hidden) };
}, [w.x, w.y]);
console.log('beaten warden still present:', JSON.stringify(still));

const ok = after.badges === badgesBefore + 1 && still.present && !still.hidden && errors.length === 0;
for (const e of errors.slice(0, 4)) console.log('  ERR ' + e);
console.log(ok ? 'WARDEN PROBE: Seal awarded, badge counted, the beaten remain'
              : 'WARDEN PROBE: FAILURE');
await browser.close(); srv.close();
process.exit(ok ? 0 : 1);
