// Headless play-test harness for Verdant Frontier.
// Usage: node tools/harness.mjs [--shots] [--script=boot|play|mobile]
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const ROOT = process.cwd();
const OUT = join(ROOT, '.harness');
const PORT = 8123;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.pdf': 'application/pdf', '.md': 'text/plain; charset=utf-8',
};

function serve() {
  return new Promise((res) => {
    const srv = createServer(async (req, rq) => {
      try {
        let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (p.endsWith('/')) p += 'index.html';
        const full = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
        if (!full.startsWith(ROOT) || !existsSync(full)) { rq.writeHead(404); rq.end('nf'); return; }
        const body = await readFile(full);
        rq.writeHead(200, { 'Content-Type': MIME[extname(full)] || 'application/octet-stream' });
        rq.end(body);
      } catch (e) { rq.writeHead(500); rq.end(String(e)); }
    });
    srv.listen(PORT, () => res(srv));
  });
}

const args = process.argv.slice(2);
const SHOTS = args.includes('--shots');
const SCRIPT = (args.find((a) => a.startsWith('--script=')) || '--script=play').split('=')[1];
const MOBILE = SCRIPT === 'mobile';

const problems = [];
const note = (kind, msg) => { problems.push({ kind, msg: String(msg).slice(0, 600) }); };

const srv = await serve();
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
});

const ctx = await browser.newContext(
  MOBILE
    ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
    : { viewport: { width: 1100, height: 800 } }
);
const page = await ctx.newPage();

page.on('console', (m) => {
  const t = m.type();
  if (t === 'error') note('console.error', m.text());
  else if (t === 'warning' && /deprecat|violation/i.test(m.text()) === false) note('console.warn', m.text());
});
page.on('pageerror', (e) => note('pageerror', e.stack || e.message));
page.on('requestfailed', (r) => {
  const u = r.url();
  if (u.startsWith('data:')) return;
  note('requestfailed', u + ' :: ' + (r.failure()?.errorText || ''));
});

const shot = async (name) => { if (SHOTS) await page.screenshot({ path: join(OUT, name + '.png') }); };

// Deterministic seed + fast text so runs are reproducible.
await page.addInitScript(() => {
  window.__HARNESS__ = true;
  try { localStorage.clear(); } catch (_) {}
});

const t0 = Date.now();
await page.goto(`http://localhost:${PORT}/game/`, { waitUntil: 'load', timeout: 25000 });

// Wait for the game to signal readiness (main.js sets window.__ready).
try {
  await page.waitForFunction(() => window.__ready === true, { timeout: 20000 });
} catch (_) {
  note('boot', 'window.__ready never became true within 20s');
}
const bootMs = Date.now() - t0;

const key = async (k, times = 1, delay = 90) => {
  for (let i = 0; i < times; i++) { await page.keyboard.press(k); await page.waitForTimeout(delay); }
};
const hold = async (k, ms) => {
  await page.keyboard.down(k); await page.waitForTimeout(ms); await page.keyboard.up(k);
};

const probe = async (label) => {
  try {
    return await page.evaluate(() => (window.__probe ? window.__probe() : null));
  } catch (e) { note('probe', label + ': ' + e.message); return null; }
};

await shot('01-title');

if (SCRIPT !== 'boot') {
  // Title -> new game -> starter pick. Advance until the player actually has
  // control, rather than a fixed press count that breaks whenever intro text
  // changes length.
  await key('Enter', 4, 180);
  await shot('02-intro');
  let ready = false;
  for (let i = 0; i < 60; i++) {
    await key('Enter', 1, 150);
    const st = await probe('intro' + i);
    if (st && st.scene === 'overworld' && st.sceneCount === 1 && st.party > 0) {
      // one more beat to be sure no dialogue is mid-close
      await page.waitForTimeout(250);
      const again = await probe('intro-confirm');
      if (again && again.scene === 'overworld' && again.sceneCount === 1) { ready = true; break; }
    }
    if (i === 12) await shot('03-starter');
  }
  if (!ready) note('flow', 'never reached interactive overworld after 60 intro presses');
  await shot('04-overworld');

  const afterIntro = await probe('after-intro');
  if (afterIntro && afterIntro.party === 0) note('flow', 'player has no party after the intro sequence');

  // Walk OUT of the start town looking for tall grass. Rotating directions every
  // burst just oscillates in place, so commit to a heading and only change it when
  // the player stops making progress (blocked by a building or the shoreline).
  const HEADINGS = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'];
  let hi = 0;
  let encountered = false;
  let prev = await probe('walk-start');
  let stuckRuns = 0;

  for (let i = 0; i < 40 && !encountered; i++) {
    await hold(HEADINGS[hi], 900);
    const st = await probe('walk' + i);
    if (st && st.scene === 'battle') { encountered = true; break; }
    if (st && prev) {
      const moved = Math.abs(st.x - prev.x) + Math.abs(st.y - prev.y);
      if (moved < 2) {
        // Genuinely blocked this burst. Rotate, but do not treat it as failure:
        // tools/check-onboarding.mjs shows the real path to grass is straight,
        // so thrashing here is the walker's fault, not the world's.
        stuckRuns++;
        hi = (hi + 1) % HEADINGS.length;
      } else {
        stuckRuns = 0;
      }
    }
    prev = st;
    if (stuckRuns >= 12) { note('flow', 'player appears boxed in at ' + (st ? st.x + ',' + st.y : '?')); break; }
  }
  await shot('05-walk');
  const walked = prev && afterIntro ? Math.abs(prev.x - afterIntro.x) + Math.abs(prev.y - afterIntro.y) : 0;
  if (!encountered) {
    note('flow', 'no wild encounter after 40 walk bursts (moved ' + walked +
                 ' tiles from spawn, ' + (prev ? prev.steps : 0) + ' steps)');
  }

  if (encountered) {
    await shot('06-battle');
    // Fight: A to open Fight, A to pick the first move, then mash through the turn.
    await key('Enter', 2, 300);
    await key('Enter', 14, 220);
    await shot('07-battle-turn');
  }

  // Pause menu
  await key('KeyC', 1, 350);
  await shot('08-menu');
  const menuState = await probe('menu');
  if (menuState && menuState.scene !== 'menu' && menuState.sceneCount < 2) {
    note('flow', 'pause menu did not open on C (scene=' + menuState.scene + ')');
  }
  await key('Escape', 3, 200);

  if (MOBILE) {
    const pad = await page.$('[data-btn="down"]');
    if (!pad) note('mobile', 'touch d-pad not present on a touch viewport');
    else {
      const box = await pad.boundingBox();
      if (!box || box.width < 20) note('mobile', 'd-pad rendered but has no usable size');
      else {
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(300);
      }
    }
    const vis = await page.evaluate(() => {
      const c = document.getElementById('screen');
      const r = c.getBoundingClientRect();
      return { w: r.width, h: r.height, top: r.top, bottom: r.bottom, inner: window.innerHeight,
               scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth };
    });
    if (vis.scrollW > vis.clientW + 1) note('mobile', 'page scrolls horizontally: ' + JSON.stringify(vis));
    if (vis.bottom > vis.inner + 1) note('mobile', 'canvas is cut off below the viewport: ' + JSON.stringify(vis));
    await shot('09-mobile');
  }
}

const final = await probe('final');

// Frame timing sample
let fps = null;
try {
  fps = await page.evaluate(() => new Promise((res) => {
    let n = 0; const t = performance.now();
    const tick = () => { n++; if (performance.now() - t < 1000) requestAnimationFrame(tick); else res(n); };
    requestAnimationFrame(tick);
  }));
} catch (_) {}
if (fps !== null && fps < 30) note('perf', 'only ' + fps + ' rAF callbacks in 1s');

await browser.close();
srv.close();

const report = { script: SCRIPT, bootMs, fps, state: final, problems };
await writeFile(join(OUT, 'report-' + SCRIPT + '.json'), JSON.stringify(report, null, 2));

console.log('=== HARNESS ' + SCRIPT + ' ===');
console.log('boot: ' + bootMs + 'ms   fps~' + fps);
console.log('state: ' + JSON.stringify(final));
if (!problems.length) console.log('PROBLEMS: none');
else {
  console.log('PROBLEMS: ' + problems.length);
  const seen = new Set();
  for (const p of problems) {
    const k = p.kind + '|' + p.msg.slice(0, 160);
    if (seen.has(k)) continue;
    seen.add(k);
    console.log('  [' + p.kind + '] ' + p.msg.split('\n').slice(0, 4).join('\n      '));
  }
}
process.exit(problems.length ? 1 : 0);
