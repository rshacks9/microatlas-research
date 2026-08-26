// Captures the overworld at several in-game hours to verify the day/night tint,
// and checks that nocturnal spawn weighting actually shifts the encounter table.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const ROOT = process.cwd();
let PORT = 0;   // ephemeral: a killed run must never block the next one
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
  s.listen(0, () => { PORT = s.address().port; res(s); });
});

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 700, height: 560 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`http://localhost:${PORT}/game/`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, { timeout: 20000 });
for (let i = 0; i < 26; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(100); }

// Walk out of town a little so there is terrain, not just plaza.
for (let i = 0; i < 6; i++) {
  await page.keyboard.down('ArrowDown'); await page.waitForTimeout(400); await page.keyboard.up('ArrowDown');
}

const HOURS = [[3, 'night'], [7, 'dawn'], [12, 'noon'], [18, 'golden'], [21, 'dusk']];
for (const [h, name] of HOURS) {
  await page.evaluate((hh) => { window.__game.S.time = hh * 60; }, h);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `.harness/tod-${String(h).padStart(2, '0')}-${name}.png`, clip: { x: 0, y: 0, width: 700, height: 520 } });
  const tod = await page.evaluate(() => window.__game.S.time);
  console.log(`captured hour ${h} (${name}) time=${tod}`);
}

// Nocturnal weighting: sample which species the table favours at noon vs midnight.
const spread = await page.evaluate(async () => {
  const wg = await import('./js/worldgen.js');
  const cr = await import('./js/creatures.js');
  const table = wg.encounterTableFor('FOREST') || [];
  const score = (tod) => {
    const out = {};
    for (const e of table) {
      const types = cr.getSpecies(e.species).types || [];
      const noct = types.includes('UMBRA') || types.includes('PSION') || types.includes('TOXIN');
      let w = e.weight || 1;
      if (tod === 'night') w *= noct ? 3 : 0.7;
      else if (tod === 'day') w *= noct ? 0.35 : 1.15;
      out[e.species] = +w.toFixed(2);
    }
    const tot = Object.values(out).reduce((a, b) => a + b, 0);
    for (const k in out) out[k] = Math.round((out[k] / tot) * 100);
    return out;
  };
  return { day: score('day'), night: score('night') };
});
console.log('FOREST spawn share by time of day (%):');
console.log('  day  :', JSON.stringify(spread.day));
console.log('  night:', JSON.stringify(spread.night));

console.log('console errors:', errors.length ? errors.slice(0, 4) : 'none');
await browser.close();
srv.close();
