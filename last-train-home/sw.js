/* Last Train Home: keeps the app opening with no signal.
   The page comes from the network whenever it can, so updates land right away, and from this cache when it can't
   or when the signal is too weak to bring it in 3 seconds.
   Typefaces and the app's own icons are cached on first use. Nothing personal is ever cached: the relay, the weather,
   map tiles and address search always go straight to the network. */
const CACHE = 'lth-shell-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('lth-') && k !== CACHE).map(k => caches.delete(k))))
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
  // the app's own icons and manifest: cache first
  if (own && /\.(png|webmanifest)$/.test(url.pathname)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => (res.ok ? keep(req, res) : res))));
  }
  // everything else (the relay, weather, map tiles, address search) goes to the network untouched
});
