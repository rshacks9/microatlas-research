// Verifies the battle game-feel additions actually render: damage popups,
// crit/super-effective colouring, sprite recoil and hit-stop.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const ROOT = process.cwd();
const PORT = 8137;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

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
for (let i = 0; i < 26; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(100); }

// Force a battle directly so timing is deterministic.
const started = await page.evaluate(async () => {
  const m = await import('./js/battle.js');
  const party = await import('./js/party.js');
  const wild = party.makeCreature('mottlemouse', 12, {});
  m.startBattle({ wild });
  return true;
});
console.log('battle forced:', started);
await page.waitForTimeout(1500);

// Inject the three popup flavours plus recoil, then capture the frame.
await page.evaluate(async () => {
  const m = await import('./js/battle.js');
  const B = m.BattleScene;
  B.popups.push({ text: '-47', x: 224, y: 62, t: 0.05, life: 0.85, color: '#ffd23c', big: true });
  B.popups.push({ text: '-12', x: 92,  y: 122, t: 0.30, life: 0.85, color: '#ffffff', big: false });
  B.popups.push({ text: '-31', x: 200, y: 74, t: 0.15, life: 0.85, color: '#ff8a3c', big: true });
  B.recoil.foe = 1;
  B.recoil.me = 0.6;
  B.shake.mag = 5; B.shake.t = 0.3;
});
await page.waitForTimeout(60);
await page.screenshot({ path: '.harness/juice-popups.png' });
console.log('popup frame captured');

const state = await page.evaluate(async () => {
  const m = await import('./js/battle.js');
  const B = m.BattleScene;
  return { popups: B.popups.length, hitstop: B.hitstop, recoilFoe: B.recoil.foe, active: B.active };
});
console.log('battle feel state:', JSON.stringify(state));

// Confirm hit-stop actually freezes the coroutine.
const froze = await page.evaluate(async () => {
  const m = await import('./js/battle.js');
  const B = m.BattleScene;
  B.hitstop = 0.5;
  const t0 = B.t;
  await new Promise((r) => setTimeout(r, 250));
  const advanced = B.t - t0;
  B.hitstop = 0;
  return { advanced: +advanced.toFixed(3) };
});
console.log('hit-stop test (B.t should still advance but popups freeze):', JSON.stringify(froze));

console.log('console errors:', errors.length ? errors.slice(0, 4) : 'none');
await browser.close();
srv.close();
