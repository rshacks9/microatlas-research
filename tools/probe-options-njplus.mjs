// F1+F2 probe: toggle Music through the REAL pause menu, reload the page,
// Continue — the setting must survive. Then New Journey+ from a cold boot must
// carry the field notes stored in the SAVES (session memory is empty at the
// title, which is exactly how the old carry shipped dead).
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
const key = async (k, ms = 220) => { await page.keyboard.press(k); await page.waitForTimeout(ms); };

await page.goto(`http://localhost:${PORT}/game/`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, { timeout: 20000 });
for (let i = 0; i < 30; i++) await key('Enter', 110);
let st = await page.evaluate(() => window.__probe());
if (!st.started) { console.log('PROBE: intro failed'); process.exit(1); }

// Seed the notes + trial history + a save, all through real APIs.
await page.evaluate(async () => {
  const state = await import('./js/state.js');
  state.seeSpecies('mottlemouse'); state.seeSpecies('flitterwing');
  state.setFlag('trial_done', true);
  state.updateRecord({ adds: { trials: 1, journeys: 1 } });
  const { saveGame } = await import('./js/save.js');
  if (!saveGame(0)) throw new Error('saveGame failed');
});

// Toggle Music OFF via the actual pause menu: c -> down x6 (Options) -> z ->
// down (Music row) -> z (toggle+persist) -> x x (all the way out).
await key('KeyC', 400);
for (let i = 0; i < 6; i++) await key('ArrowDown');
await key('KeyZ', 350);
await key('ArrowDown');
await key('KeyZ', 350);
const afterToggle = await page.evaluate(() => {
  let dev = null;
  try { dev = JSON.parse(localStorage.getItem('verdant.options') || 'null'); } catch (_) {}
  return { music: window.__game.S.options.music, deviceMusic: dev && dev.music };
});
console.log('after toggle:', JSON.stringify(afterToggle));
await key('KeyX', 300); await key('KeyX', 300);

// RELOAD — the old bug: boot loads the stale device copy and continue re-stamps it.
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, { timeout: 20000 });
await page.waitForTimeout(600);

// Title -> pick New Journey+ (row above the default Continue selection).
await key('ArrowUp', 300);
await key('Enter', 700);
// Starter scene: wait out the 0.35s confirm lockout, then confirm twice.
await page.waitForTimeout(600);
for (let i = 0; i < 30; i++) await key('KeyZ', 140);

const end = await page.evaluate(() => {
  const { S } = window.__game;
  const bag = S.bag || {};
  return {
    started: S.started,
    money: S.player.money,
    orbs: bag.orb | 0,
    seen: Object.keys(S.dex.seen).sort(),
    music: S.options.music,
  };
});
console.log('end:', JSON.stringify(end), 'errors:', errors.length);
for (const e of errors.slice(0, 4)) console.log('  ERR ' + e);

const carried = end.seen.includes('mottlemouse') && end.seen.includes('flitterwing');
const ok = afterToggle.music === false && afterToggle.deviceMusic === false &&
           end.music === false && end.started && end.money === 1400 && end.orbs === 8 &&
           carried && errors.length === 0;
if (!ok) {
  console.log('detail:', JSON.stringify({
    toggled: afterToggle.music === false, persisted: afterToggle.deviceMusic === false,
    kept: end.music === false, njMoney: end.money, njOrbs: end.orbs, carried,
  }));
}
console.log(ok ? 'OPTIONS+NJ+ PROBE: settings survive reload; field notes travel'
              : 'OPTIONS+NJ+ PROBE: FAILURE');
await browser.close(); srv.close();
process.exit(ok ? 0 : 1);
