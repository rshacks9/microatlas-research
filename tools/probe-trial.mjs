// Verdant Trial probe: with all Seals held, a beaten Warden convenes the
// Circle; win the three-Keeper gauntlet and assert the ending actually ends —
// trial_done set, record stamped, player back in the overworld, 0 errors.
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

// All Seals held, nearest Warden already beaten; stand facing them.
const setup = await page.evaluate(() => {
  const { S } = window.__game;
  S.badges = S.world.towns.length;
  const start = S.world.start;
  let w = null, best = Infinity;
  for (const e of S.world.map.entities) {
    if (!e.warden) continue;
    const d = Math.max(Math.abs(e.x - start.x), Math.abs(e.y - start.y));
    if (d < best) { best = d; w = e; }
  }
  S.flags[w.flag] = true;
  const c = S.party[0];
  c.level = 70; c.hp = 5000;
  return { x: w.x, y: w.y, name: w.name, seals: S.badges };
});
console.log('setup:', JSON.stringify(setup));
await page.evaluate(([x, y]) => window.__game.enterMap('world', x, y + 1, 'up'), [setup.x, setup.y]);
await page.waitForTimeout(400);

await page.keyboard.press('z');   // talk -> trial offer
await page.waitForTimeout(600);

let shotTaken = false;
let done = false;
for (let i = 0; i < 500; i++) {
  const info = await page.evaluate(async () => {
    const { BattleScene: B } = await import('./js/battle.js');
    const st = window.__probe();
    if (st.scene === 'battle' && B.foe && B.foe.inst) {
      B.foe.inst.hp = Math.min(B.foe.inst.hp, 1);
      if (B.foeTeam) for (const m of B.foeTeam) if (m) m.hp = Math.min(m.hp, 1);
      if (B.me && B.me.inst) B.me.inst.hp = Math.max(B.me.inst.hp, 500);
    }
    return {
      scene: st.scene, errors: st.errors,
      trialDone: !!window.__game.S.flags.trial_done,
    };
  });
  if (info.trialDone && !shotTaken) {
    shotTaken = true;
    await page.screenshot({ path: '/tmp/claude-0/-home-user-microatlas-research/55073887-1b33-5a66-8e2f-d0de53d81307/scratchpad/trial-epilogue.png' });
  }
  if (info.trialDone && info.scene === 'overworld') { done = true; break; }
  await page.keyboard.press('z');
  await page.waitForTimeout(150);
}

const end = await page.evaluate(() => {
  const { S } = window.__game;
  let rec = null;
  try { rec = JSON.parse(localStorage.getItem('verdant.record') || 'null'); } catch (_) {}
  return {
    trialDone: !!S.flags.trial_done,
    scene: window.__probe().scene,
    money: S.player.money,
    recTrials: rec && rec.trials,
    recBestSeals: rec && rec.bestSeals,
  };
});
console.log('end:', JSON.stringify(end), 'errors:', errors.length);
for (const e of errors.slice(0, 4)) console.log('  ERR ' + e);
const ok = done && end.trialDone && end.recTrials >= 1 && errors.length === 0;
console.log(ok ? 'TRIAL PROBE: gauntlet fought, ending reached, record stamped'
              : 'TRIAL PROBE: FAILURE');
await browser.close(); srv.close();
process.exit(ok ? 0 : 1);
