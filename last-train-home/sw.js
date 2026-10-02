/* Last Train Home: keeps the app opening with no signal, and the trail's maps showing where the signal is weak.
   The page comes from the network whenever it can, so updates land right away, and from this cache when it can't
   or when the signal is too weak to bring it in 3 seconds.
   Typefaces and the app's own icons are cached on first use.
   Satellite map tiles from the two imagery services the maps use (Indiana's statewide orthophotos and the USGS
   backup) are kept on this phone too, but only tiles along the Monon Trail: a strip either side of the trail's line,
   wider at the zoom levels that show more ground. The strip comes from the trail's line alone, the same for everyone,
   so the kept tiles show the trail area and are never picked by where anyone lives. A kept tile shows at once, with no
   network wait; once it is a week old it is refreshed in the background while the phone is online. All kept tiles
   share a 40 MB budget: tiles saved with Settings, Save trail maps for offline, stay until Delete saved maps; the
   rest make way for newer ones, least recently used first.
   Nothing personal is ever cached: the relay, the weather, address search and CARTO's street maps (whose key is
   personal, and whose terms differ) always go straight to the network.
   Tests can register sw.js?budget=<bytes>&fresh=<ms> for a smaller budget and a shorter refresh age; neither can grow. */
const CACHE = 'lth-shell-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
const TILES = 'lth-tiles-v1';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('lth-') && k !== CACHE && k !== TILES).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const keep = (req, res) => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; };

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const own = url.origin === self.location.origin;
  // the app itself: network first, the saved copy when offline. A weak signal can't hold the app back: if the whole
  // page hasn't arrived in 3 seconds, the saved copy opens and the download finishes in the background for next time.
  if (req.mode === 'navigate' || (own && /\/(index\.html)?$/.test(url.pathname))) {
    let saving = Promise.resolve();
    const net = fetch(req).then(res => {
      if (!res.ok) return res;
      const copy = res.clone(), whole = res.clone();
      saving = caches.open(CACHE).then(c => c.put('./index.html', copy)).catch(() => {});
      return whole.arrayBuffer().then(() => res); // ready once every byte is here; a dropped download falls back below
    });
    const saved = () => caches.match('./index.html').then(hit => hit || caches.match('./'));
    e.respondWith(new Promise(resolve => {
      let sent = false;
      const send = r => { if (!sent && r) { sent = true; resolve(r); } };
      const slow = setTimeout(() => saved().then(send), 3000);
      net.then(res => { clearTimeout(slow); send(res); }, () => { clearTimeout(slow); saved().then(hit => send(hit || Response.error())); });
    }));
    e.waitUntil(net.then(() => saving, () => {}));
    return;
  }
  // typefaces never change: cache first
  if (url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com') {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => (res.ok || res.type === 'opaque' ? keep(req, res) : res))));
    return;
  }
  // satellite tiles along the trail: kept on this phone (see the top of this file). Tiles anywhere else, and every
  // CARTO street tile, go to the network untouched.
  const tile = Tiles.parse(req.url);
  if (tile && Tiles.wants(tile)) {
    e.respondWith(Tiles.serve(e, tile));
    return;
  }
  // the app's own icons and manifest: cache first
  if (own && /\.(png|webmanifest)$/.test(url.pathname)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => (res.ok ? keep(req, res) : res))));
  }
  // everything else (the relay, weather, other map tiles, address search) goes to the network untouched
});

/* ------------------------------------------------------------ satellite tiles along the trail */
// The two imagery services in map.js, tile addresses by level, row and column
const SRC = {
  in: 'https://di-ingov.img.arcgis.com/arcgis/rest/services/CacheWebMercator/IndianaCurrentImageryCacheL19v4/MapServer/tile/',
  us: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/',
};
const US_MAX = 16; // USGS imagery is sharp to level 16; past that the maps scale up its level 16 tile, as here
// Save trail maps for offline brings in these levels: the small maps draw imagery one level deeper than their view
// (views 11 to 17 in map.js), and the full-screen map opens at most at view 17 (ext/mapview.js)
const LEVELS = [12, 13, 14, 15, 16, 17, 18];
const opt = new URL(self.location.href).searchParams;
const num = (k, d, lo) => { const v = +opt.get(k); return opt.has(k) && Number.isFinite(v) ? Math.max(lo, Math.min(d, v)) : d; };
const BUDGET = num('budget', 40e6, 20e3); // bytes for every kept tile
const CAP = Math.round(BUDGET * 0.9);     // saved tiles stop here, so tiles in use always have room
const FRESH = num('fresh', 7 * 86400e3, 0); // a kept tile older than this is refreshed in the background
// bytes per tile the size estimate assumes until this phone has measured a dozen tiles: a guess for 256 px JPEG at
// quality 75 (the Indiana service's setting), not a measurement, so the card says what the estimate rests on
const TYPICAL = 20e3;

// The trail's line from ROUTE: build.py writes it in. Left empty, nothing along the trail is kept.
const LINE = [[39.78137,-86.14004],[39.79953,-86.14004],[39.80165,-86.13975],[39.81744,-86.13567],[39.81822,-86.1357],[39.81925,-86.136],[39.82494,-86.13971],[39.82594,-86.14013],[39.82675,-86.14026],[39.86803,-86.14083],[39.87051,-86.14155],[39.87064,-86.14179],[39.871,-86.14171],[39.87277,-86.14216],[39.87498,-86.14219],[39.87631,-86.14194],[39.88078,-86.14032],[39.88492,-86.13949],[39.88617,-86.1396],[39.89064,-86.14087],[39.89223,-86.14114],[39.9048,-86.14109],[39.90579,-86.1409],[39.90725,-86.14015],[39.91048,-86.13701],[39.91149,-86.13647],[39.9124,-86.13631],[39.91263,-86.13633],[39.92708,-86.13637],[39.92825,-86.13637],[39.93159,-86.13638],[39.93382,-86.1364],[39.93662,-86.1364],[39.94078,-86.13642],[39.94171,-86.13642],[39.94359,-86.13642],[39.94678,-86.13638],[39.94902,-86.13637],[39.95369,-86.13634],[39.9551,-86.13633],[39.95556,-86.13633],[39.95602,-86.13629],[39.95657,-86.13623],[39.95714,-86.13611],[39.95741,-86.136],[39.95857,-86.1353],[39.95937,-86.13452],[39.96034,-86.13315],[39.96104,-86.13212],[39.96168,-86.13124],[39.96185,-86.13107],[39.96193,-86.13098],[39.9623,-86.13062],[39.96257,-86.13041],[39.96311,-86.13006],[39.96357,-86.12983],[39.96421,-86.12961],[39.96454,-86.12954],[39.96609,-86.12953],[39.96754,-86.12956],[39.96877,-86.12958],[39.96974,-86.12964],[39.97056,-86.12972],[39.97126,-86.12965],[39.97261,-86.12969],[39.97312,-86.12974],[39.97452,-86.12978],[39.97548,-86.1298],[39.97641,-86.12981],[39.97718,-86.12983],[39.97745,-86.12981],[39.97835,-86.12985],[39.97923,-86.12988],[39.98114,-86.12992],[39.98344,-86.12998],[39.98551,-86.13003],[39.9856,-86.13004],[39.98599,-86.13013],[39.98672,-86.13036],[39.98703,-86.13051],[39.98736,-86.13069],[39.9878,-86.13101],[39.98786,-86.13105],[39.98833,-86.13144],[39.98931,-86.13229],[39.991,-86.13376],[39.99197,-86.13461],[39.99289,-86.13539],[39.99326,-86.13567],[39.99361,-86.13589],[39.99407,-86.1361],[39.99442,-86.13624],[39.99491,-86.13637],[39.99553,-86.13644],[39.99714,-86.13647],[40.0,-86.13651],[40.00253,-86.13656],[40.0052,-86.13656]];
const HALF = Math.PI * 6378137;
const span = z => (2 * HALF) / Math.pow(2, z); // a tile's width in Web Mercator meters
const merc = (lat, lon) => [lon * HALF / 180, Math.log(Math.tan((90 + lat) * Math.PI / 360)) * 6378137];
const BOXES = []; // each stretch of the line as a box in Web Mercator meters
let SCALE = 1;    // Web Mercator meters per meter on the ground, at the trail
(() => {
  const pts = (Array.isArray(LINE) ? LINE : []).filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (!pts.length) return;
  SCALE = 1 / Math.cos(pts.reduce((s, p) => s + p[0], 0) / pts.length * Math.PI / 180);
  for (let i = Math.min(1, pts.length - 1); i < pts.length; i++) {
    const a = merc(pts[Math.max(0, i - 1)][0], pts[Math.max(0, i - 1)][1]), b = merc(pts[i][0], pts[i][1]);
    BOXES.push([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]);
  }
})();
// How far the strip reaches either side of the line. A map at the lower levels shows kilometers either side of the
// trail, so the strip is a tile and a half wide there; close up it hugs the trail (200 m, then 60 m). Each stretch of
// the line counts as its bounding box, so where a long stretch runs on a diagonal the strip reaches a few hundred
// meters farther (tiles up to about 430 m off the line at level 17 and 360 m at level 18). A tile can show a home near
// the trail at any level, which is why the Privacy list in About says so.
const reach = z => (z <= 15 ? 1.5 * span(z) : z === 16 ? span(z) : (z === 17 ? 200 : 60) * SCALE);
function inCorridor(z, x, y) {
  const m = span(z), r = reach(z), x1 = x * m - HALF, x2 = x1 + m, y2 = HALF - y * m, y1 = y2 - m;
  return BOXES.some(b => x2 > b[0] - r && x1 < b[2] + r && y2 > b[1] - r && y1 < b[3] + r);
}
// The USGS tile the maps show in place of an Indiana tile that fails (as map.js backupOf)
const backupOf = (z, x, y) => { const f = Math.pow(2, Math.max(0, z - US_MAX)); return { z: Math.min(z, US_MAX), x: Math.floor(x / f), y: Math.floor(y / f) }; };
const tileUrl = (src, z, x, y) => `${SRC[src]}${z}/${y}/${x}`;
// What Save trail maps for offline brings in: every Indiana tile in the strip at each level, lowest level first and
// south to north along the trail, so a download stopped early has the views the maps open on
let PLAN = null;
function plan() {
  if (PLAN) return PLAN;
  const tiles = [];
  for (const z of LEVELS) {
    const m = span(z), r = reach(z), seen = new Set();
    for (const b of BOXES) {
      const xa = Math.floor((b[0] - r + HALF) / m), xb = Math.floor((b[2] + r + HALF) / m);
      const ya = Math.floor((HALF - b[3] - r) / m), yb = Math.floor((HALF - b[1] + r) / m);
      for (let x = xa; x <= xb; x++) for (let y = ya; y <= yb; y++) {
        const k = x + '/' + y;
        if (!seen.has(k) && inCorridor(z, x, y)) { seen.add(k); tiles.push([z, x, y]); }
      }
    }
  }
  return (PLAN = { tiles, urls: tiles.map(([z, x, y]) => tileUrl('in', z, x, y)) });
}

// Which tiles are kept, in IndexedDB: { u: address, n: bytes, t: last shown, f: fetched, s: 1 if saved for offline,
// alt: the USGS address standing in for an Indiana tile the server doesn't have (n is 0 then, and nothing is cached) }
const DB = {
  p: null,
  open() {
    if (!this.p) {
      this.p = new Promise((res, rej) => {
        const r = indexedDB.open('lth-tiles', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('tiles', { keyPath: 'u' });
        r.onsuccess = () => { const db = r.result; db.onversionchange = () => { db.close(); this.p = null; }; res(db); };
        r.onerror = () => rej(r.error);
        r.onblocked = () => rej(new Error('blocked'));
      }).catch(err => { this.p = null; throw err; });
    }
    return this.p;
  },
  run(mode, fn) {
    return this.open().then(db => new Promise((res, rej) => {
      const tx = db.transaction('tiles', mode), out = fn(tx.objectStore('tiles'));
      tx.oncomplete = () => res(out && out.result);
      tx.onerror = tx.onabort = () => rej(tx.error);
    }));
  },
  all() { return this.run('readonly', st => st.getAll()); },
  put(recs) { return recs.length ? this.run('readwrite', st => { recs.forEach(r => st.put(r)); }) : Promise.resolve(); },
  del(urls) { return urls.length ? this.run('readwrite', st => { urls.forEach(u => st.delete(u)); }) : Promise.resolve(); },
  clear() { return this.run('readwrite', st => st.clear()); },
};
const safe = p => p.catch(() => {});

const Tiles = {
  idx: null, loading: null, bytes: 0, sbytes: 0, cp: null,
  pending: new Map(), dirty: new Set(), flushing: null, refreshing: new Set(), quietUntil: 0,
  noCors: {}, probed: {}, droppedAt: 0,

  parse(href) {
    for (const src of ['in', 'us']) {
      if (!href.startsWith(SRC[src])) continue;
      const m = /^(\d{1,2})\/(\d{1,7})\/(\d{1,7})$/.exec(href.slice(SRC[src].length));
      if (!m) return null;
      const z = +m[1], y = +m[2], x = +m[3], n = Math.pow(2, z);
      return z <= 20 && x < n && y < n ? { src, z, x, y, href } : null;
    }
    return null;
  },
  wants(t) { return BOXES.length > 0 && !this.noCors[t.src] && inCorridor(t.z, t.x, t.y); },
  cache() { return this.cp || (this.cp = caches.open(TILES)); },
  load() {
    if (this.idx) return Promise.resolve();
    return this.loading || (this.loading = DB.all().catch(() => []).then(list => {
      this.loading = null;
      if (this.idx) return;
      this.idx = new Map(); this.bytes = 0; this.sbytes = 0;
      for (const r of list || []) if (r && typeof r.u === 'string' && r.n >= 0) this.add(r);
    }));
  },
  add(r) { const old = this.idx.get(r.u); if (old) this.count(old, -1); this.idx.set(r.u, r); this.count(r, 1); },
  count(r, k) { this.bytes += k * r.n; if (r.s) this.sbytes += k * r.n; },
  // drop tiles from the index, the cache and the database
  drop(urls) {
    if (!urls.length) return Promise.resolve();
    urls.forEach(u => { const r = this.idx.get(u); if (r) { this.count(r, -1); this.idx.delete(u); this.dirty.delete(u); } });
    return safe(Promise.all([this.cache().then(c => Promise.all(urls.map(u => c.delete(u)))), DB.del(urls)]));
  },

  // One tile from its server, shared by everyone asking for it at once. Resolves { blob, type } for a picture or
  // { status } for an answer without one (0: not a picture, as from a Wi-Fi sign-in page); rejects when the request
  // fails (no signal, a timeout, or a server that won't share its pictures). It skips the browser's own cache: this
  // cache is the one for these tiles, and a copy the page fetched before this worker ran may lack the CORS header.
  get(href, ms = 20000) {
    if (this.pending.has(href)) return this.pending.get(href);
    const ac = new AbortController(), timer = setTimeout(() => ac.abort(), ms);
    const p = fetch(href, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: ac.signal })
      .then(res => {
        const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (!res.ok) return { status: res.status };
        if (!/^image\//.test(type)) return { status: 0 };
        return res.blob().then(blob => (blob.size ? { blob, type } : { status: 0 }));
      })
      .finally(() => { clearTimeout(timer); this.pending.delete(href); });
    this.pending.set(href, p);
    return p;
  },

  // A tile a map asked for: the kept copy at once, else the network, keeping what comes back
  async serve(e, t) {
    await this.load();
    const rec = this.idx.get(t.href);
    if (rec && rec.n) {
      const hit = await this.cache().then(c => c.match(t.href, { ignoreVary: true })).catch(() => null);
      if (hit) {
        rec.t = Date.now(); this.dirty.add(t.href); e.waitUntil(this.flushSoon());
        if (this.due(rec)) e.waitUntil(this.refresh(t.href));
        return hit;
      }
      e.waitUntil(this.drop([t.href])); // its picture went missing
    }
    try {
      const got = await this.get(t.href);
      if (!got.blob) return got.status >= 400 ? new Response(null, { status: got.status }) : Response.error();
      e.waitUntil(this.keep(t.href, got, 0));
      return new Response(got.blob, { headers: { 'Content-Type': got.type } });
    } catch (err) {
      // no signal, or a server that won't share its pictures for keeping: the plain request still shows them
      return fetch(e.request).then(res => { if (res.type === 'opaque') this.noCors[t.src] = true; return res; }, () => Response.error());
    }
  },
  // Keep a tile. saved: 1 when Save trail maps for offline asked for it (a tile saved before stays saved).
  // Resolves true, or why it wasn't kept: 'full' (saved tiles reached their share) or 'space' (the phone is full).
  async keep(href, got, saved) {
    await this.load();
    const n = got.blob.size, old = this.idx.get(href), s = saved || (old && old.s) ? 1 : 0;
    if (s && !(old && old.s) && this.sbytes + n > CAP) return 'full';
    const now = Date.now(), rec = { u: href, n, t: now, f: now, s };
    this.add(rec);
    try {
      await safe(DB.put([rec]));
      const c = await this.cache();
      await c.put(href, new Response(got.blob, { headers: { 'Content-Type': got.type, 'Content-Length': String(n) } }));
    } catch (err) {
      await this.drop([href]);
      return 'space';
    }
    await this.trim();
    return true;
  },
  // Over budget: tiles kept from use go first, least recently shown first. Saved tiles go only if they alone
  // overflow, which their share keeps from happening.
  trim() {
    if (this.bytes <= BUDGET) return Promise.resolve();
    const list = [...this.idx.values()].filter(r => r.n).sort((a, b) => a.s - b.s || a.t - b.t);
    const gone = [];
    let over = this.bytes - BUDGET;
    for (const r of list) { if (over <= 0) break; gone.push(r.u); over -= r.n; }
    return this.drop(gone);
  },
  // when a kept tile is old enough to refresh: online, no Data Saver, two refreshes at a time, a pause after a failure
  due(rec) {
    const c = self.navigator.connection, now = Date.now();
    return now - rec.f > FRESH && now > this.quietUntil && self.navigator.onLine !== false && !(c && c.saveData) &&
      this.refreshing.size < 2 && !this.refreshing.has(rec.u);
  },
  refresh(href) {
    this.refreshing.add(href);
    const rest = () => { this.quietUntil = Date.now() + 60000; const r = this.idx.get(href); if (r) { r.f = Date.now(); this.dirty.add(href); } };
    return this.get(href).then(got => (got.blob ? this.keep(href, got, 0) : rest()), rest).then(() => this.flushSoon()).finally(() => this.refreshing.delete(href));
  },
  // last-shown times are written a second later, a batch at a time
  flushSoon() {
    if (!this.flushing) {
      this.flushing = new Promise(r => setTimeout(r, 1000)).then(() => {
        this.flushing = null;
        const recs = [...this.dirty].map(u => this.idx.get(u)).filter(Boolean);
        this.dirty.clear();
        return safe(DB.put(recs));
      });
    }
    return this.flushing;
  },
  // The index agrees with the cache: a record whose picture went missing is dropped, and a cached picture without a
  // record is measured and kept as a tile in use
  async reconcile() {
    const c = await this.cache();
    const keys = await c.keys().catch(() => []);
    const have = new Set(keys.map(k => k.url));
    await this.drop([...this.idx.values()].filter(r => r.n && !have.has(r.u)).map(r => r.u));
    for (const k of keys) {
      if (this.idx.has(k.url)) continue;
      const res = await c.match(k).catch(() => null), n = res ? +(res.headers.get('content-length') || 0) : 0;
      if (!n) { await safe(c.delete(k)); continue; }
      const rec = { u: k.url, n, t: 0, f: 0, s: 0 };
      this.add(rec); await safe(DB.put([rec]));
    }
  },
  // the plan's progress: plan tiles saved, of how many, and bytes kept
  progress() {
    const P = plan();
    let done = 0;
    for (const u of P.urls) { const r = this.idx.get(u); if (r && r.s) done++; }
    return { done, total: P.urls.length, saved: this.sbytes, bytes: this.bytes };
  },
  async info() {
    await this.load();
    await this.reconcile();
    const P = plan();
    // the rest of the plan weighs what this phone's own tiles weigh, level by level where it has enough of them
    const per = {};
    let all = 0, allN = 0, count = 0;
    for (const r of this.idx.values()) {
      if (!r.n) continue;
      count++;
      if (!r.u.startsWith(SRC.in)) continue;
      const z = +r.u.slice(SRC.in.length).split('/')[0], p = per[z] || (per[z] = [0, 0]);
      p[0] += r.n; p[1]++; all += r.n; allN++;
    }
    const size = z => (per[z] && per[z][1] >= 5 ? per[z][0] / per[z][1] : allN >= 12 ? all / allN : TYPICAL);
    let left = 0;
    P.tiles.forEach(([z], i) => { const r = this.idx.get(P.urls[i]); if (!(r && r.s)) left += size(z); });
    return Object.assign({ ok: true, count, budget: BUDGET, cap: CAP, levels: LEVELS,
      est: { left: Math.round(left), total: Math.round(this.sbytes + left), basis: allN >= 12 ? 'phone' : 'typical', samples: allN } }, this.progress());
  },
  // the plan tiles not saved yet, in order
  async todo() {
    await this.load();
    await this.reconcile();
    const P = plan();
    return Object.assign({ ok: true, todo: P.tiles.filter((t, i) => { const r = this.idx.get(P.urls[i]); return !(r && r.s); }) }, this.progress());
  },
  // why a request failed: a server that won't share its pictures answers a plain request, and no signal answers none
  async why(href, src) {
    if (this.probed[src]) return 'cors';
    const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 10000);
    try {
      const r = await fetch(href, { mode: 'no-cors', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: ac.signal });
      if (r.type === 'opaque') { this.probed[src] = this.noCors[src] = true; return 'cors'; }
    } catch (err) { /* no signal */ } finally { clearTimeout(timer); }
    return 'network';
  },
  // pin a tile that is already kept; false when saved tiles have no room left
  async pin(rec) {
    if (rec.s) return true;
    if (this.sbytes + rec.n > CAP) return false;
    this.count(rec, -1); rec.s = 1; this.count(rec, 1);
    await safe(DB.put([rec]));
    return true;
  },
  // Save one plan tile for offline, for ext/offline.js. A save from a download that was cancelled while its tile was on
  // the way keeps the tile as one in use (pin() asks at the moment it counts).
  async save(d) {
    await this.load();
    const z = d.z, x = d.x, y = d.y;
    if (![z, x, y].every(Number.isInteger) || !LEVELS.includes(z) || !inCorridor(z, x, y)) return { ok: false, error: 'outside' };
    const pin = () => !(d.at < this.droppedAt), href = tileUrl('in', z, x, y), out = r => Object.assign(r, this.progress());
    const c = await this.cache();
    const kept = async u => { const r = this.idx.get(u); return r && r.n && (await c.match(u).catch(() => null)) ? r : null; };
    const have = await kept(href);
    if (have) return pin() && !(await this.pin(have)) ? { ok: false, error: 'full' } : out({ ok: true, had: true });
    const stub = this.idx.get(href);
    if (stub && !stub.n && stub.s) return out({ ok: true, had: true });
    let got;
    try { got = await this.get(href); } catch (err) { return { ok: false, error: await this.why(href, 'in') }; }
    if (got.blob) { const k = await this.keep(href, got, pin() ? 1 : 0); return k === true ? out({ ok: true, n: got.blob.size }) : { ok: false, error: k }; }
    if (!got.status || got.status === 429 || got.status >= 500) return { ok: false, error: got.status ? 'busy' : 'network', status: got.status };
    // Indiana has no picture here: save the USGS tile the maps show in its place
    const b = backupOf(z, x, y), bh = tileUrl('us', b.z, b.x, b.y), bk = await kept(bh);
    if (bk) { if (pin() && !(await this.pin(bk))) return { ok: false, error: 'full' }; }
    else {
      let bg;
      try { bg = await this.get(bh); } catch (err) { return { ok: false, error: await this.why(bh, 'us') }; }
      if (bg.blob) { const k = await this.keep(bh, bg, pin() ? 1 : 0); if (k !== true) return { ok: false, error: k }; }
      else if (!bg.status || bg.status === 429 || bg.status >= 500) return { ok: false, error: bg.status ? 'busy' : 'network', status: bg.status };
    }
    if (pin()) { const rec = { u: href, n: 0, t: Date.now(), f: Date.now(), s: 1, alt: bh }; this.add(rec); await safe(DB.put([rec])); }
    return out({ ok: true, n: 0, backup: true });
  },
  // Cancel: the saved tiles go. Delete saved maps: every kept tile goes.
  async dropSaved() {
    this.droppedAt = Date.now();
    await this.load();
    await this.drop([...this.idx.values()].filter(r => r.s).map(r => r.u));
  },
  async dropAll() {
    this.droppedAt = Date.now();
    await this.load();
    this.idx = new Map(); this.bytes = 0; this.sbytes = 0; this.dirty.clear(); this.cp = null;
    await Promise.all([safe(caches.delete(TILES)), safe(DB.clear())]);
  },
};

// Settings asks for the numbers, the plan, one tile at a time, or a clean slate; each answer goes back on its port
self.addEventListener('message', e => {
  const d = e.data, port = e.ports && e.ports[0];
  if (!port || !d || typeof d.t !== 'string' || !d.t.startsWith('tiles:')) return;
  if (e.origin && e.origin !== self.location.origin) return;
  const jobs = {
    'tiles:info': () => Tiles.info(),
    'tiles:plan': () => Tiles.todo(),
    'tiles:save': () => Tiles.save(d),
    'tiles:drop': () => (d.what === 'all' ? Tiles.dropAll() : Tiles.dropSaved()).then(() => Tiles.info()),
  };
  const job = jobs[d.t];
  if (!job) return;
  e.waitUntil(job().then(r => port.postMessage(r), err => port.postMessage({ ok: false, error: 'failed', detail: String((err && err.message) || err) })));
});
