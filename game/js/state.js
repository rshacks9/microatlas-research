// Central mutable game state. No DOM. Node-importable.

export const S = {
  seed: 0,
  world: null,          // result of generateWorld()
  map: null,            // active GameMap
  mapId: 'world',
  interiors: {},        // mapId -> MapData cache
  player: { x: 0, y: 0, dir: 'down', name: 'Rowan', money: 3000, steps: 0 },
  party: [],
  boxes: [],
  bag: Object.create(null),
  dex: { seen: Object.create(null), caught: Object.create(null), variant: Object.create(null) },
  flags: Object.create(null),
  time: 480,            // in-game minutes, 0..1439
  playtime: 0,          // real seconds
  options: { textSpeed: 2, music: true, sfx: true, autoRun: false },
  repelSteps: 0,
  returnPoint: null,   // world tile to emerge at when leaving an interior
  badges: 0,
  started: false,
  explored: null,       // Uint8Array(EXPLORE_W*EXPLORE_H) of charted 4x4-tile cells
};

export const PARTY_MAX = 6;
export const BOX_MAX = 60;

export function resetState(seed, name) {
  S.seed = seed >>> 0;
  S.world = null;
  S.map = null;
  S.mapId = 'world';
  S.interiors = Object.create(null);
  // Deliberately poor. With 3000 credits and 5 orbs up front, the economy was
  // decorative for the whole game; starting lean makes the first purchase a real
  // decision and gives the wild-battle bounty somewhere to matter.
  S.player = { x: 0, y: 0, dir: 'down', name: name || 'Rowan', money: 600, steps: 0 };
  S.party = [];
  S.boxes = [];
  S.bag = Object.create(null);
  S.dex = { seen: Object.create(null), caught: Object.create(null), variant: Object.create(null) };
  S.flags = Object.create(null);
  S.time = 480;
  S.playtime = 0;
  S.repelSteps = 0;
  S.returnPoint = null;
  S.badges = 0;
  S.started = true;
  S.explored = new Uint8Array(EXPLORE_W * EXPLORE_H);
  addItem('orb', 3);
  addItem('potion', 3);
}

// ---------------------------------------------------------------------------
// Explored chart: the region map draws only where the player has been. Cells
// are 4x4 world tiles — coarse enough that the whole chart is ~1KB in a save,
// fine enough that one map pixel (~2 tiles) never straddles a charted and an
// uncharted cell visibly.
export const EXPLORE_CELL = 4;
export const EXPLORE_W = 96;    // ceil(384 / 4); worldgen's WORLD_W stays the authority
export const EXPLORE_H = 96;

/** Chart the cells within `radius` world tiles of x,y. Cheap; call per step. */
export function markExplored(x, y, radius = 6) {
  if (!S.explored) S.explored = new Uint8Array(EXPLORE_W * EXPLORE_H);
  const c0x = Math.max(0, ((x - radius) / EXPLORE_CELL) | 0);
  const c1x = Math.min(EXPLORE_W - 1, ((x + radius) / EXPLORE_CELL) | 0);
  const c0y = Math.max(0, ((y - radius) / EXPLORE_CELL) | 0);
  const c1y = Math.min(EXPLORE_H - 1, ((y + radius) / EXPLORE_CELL) | 0);
  for (let cy = c0y; cy <= c1y; cy++) {
    for (let cx = c0x; cx <= c1x; cx++) S.explored[cy * EXPLORE_W + cx] = 1;
  }
}

/** Has the world tile x,y been charted? Unstarted state reads as uncharted. */
export function isExplored(x, y) {
  if (!S.explored) return false;
  const cx = (x / EXPLORE_CELL) | 0, cy = (y / EXPLORE_CELL) | 0;
  if (cx < 0 || cy < 0 || cx >= EXPLORE_W || cy >= EXPLORE_H) return false;
  return S.explored[cy * EXPLORE_W + cx] === 1;
}

// ---------------------------------------------------------------------------
// Options persistence: options live on their own device key so a New Journey
// never resets them. persistOptions must run at the moment an option CHANGES
// (the pause menu calls it), not only at save boundaries — deferring it to
// save time is exactly how the pause menu shipped with reverting settings.
const OPTIONS_KEY = 'verdant.options';
let optionsKnown = false;

function optionsStore() {
  try {
    if (typeof localStorage === 'undefined') return null;
    localStorage.setItem('__vf_probe_opts', '1');
    localStorage.removeItem('__vf_probe_opts');
    return localStorage;
  } catch (_) { return null; }   // private mode / disabled storage
}

/** Apply the stored options onto S.options. Every field range-checked. */
export function loadStoredOptions() {
  const st = optionsStore();
  if (!st) return false;
  let text;
  try { text = st.getItem(OPTIONS_KEY); } catch (_) { return false; }
  if (!text || typeof text !== 'string' || text.length > 4096) return false;
  let o;
  try { o = JSON.parse(text); } catch (_) { return false; }
  if (!o || typeof o !== 'object') return false;
  const ts = Number(o.textSpeed);
  if (isFinite(ts)) S.options.textSpeed = Math.max(0, Math.min(3, Math.floor(ts)));
  if (typeof o.music === 'boolean') S.options.music = o.music;
  if (typeof o.sfx === 'boolean') S.options.sfx = o.sfx;
  if (typeof o.autoRun === 'boolean') S.options.autoRun = o.autoRun;
  optionsKnown = true;
  return true;
}

export function persistOptions() {
  const st = optionsStore();
  if (!st) return false;
  try {
    st.setItem(OPTIONS_KEY, JSON.stringify({
      textSpeed: S.options.textSpeed | 0,
      music: !!S.options.music,
      sfx: !!S.options.sfx,
      autoRun: !!S.options.autoRun,
    }));
    optionsKnown = true;
    return true;
  } catch (_) { return false; }
}

/** True once the device store is known to hold an options copy. */
export function optionsOnDevice() { return optionsKnown; }

// ---------------------------------------------------------------------------
// Frontier Record: lifetime stats across every journey on this device. Lives
// in its own storage key, never inside a save slot, so it survives New
// Journey and deleted saves alike. Every access is guarded — a blocked store
// degrades to an in-memory record, never a crash.
const RECORD_KEY = 'verdant.record';
const RECORD_SHAPE = {
  journeys: 0,        // games started
  trials: 0,          // Verdant Trials completed
  bestDex: 0,
  bestSeals: 0,
  totalPlaytime: 0,   // seconds, lifetime
  lastSeed: 0,
};
let recordCache = null;

function recordStore() {
  try {
    if (typeof localStorage === 'undefined') return null;
    localStorage.setItem('__vf_rec_probe', '1');
    localStorage.removeItem('__vf_rec_probe');
    return localStorage;
  } catch (_) { return null; }
}

export function getRecord() {
  if (recordCache) return recordCache;
  const rec = Object.assign({}, RECORD_SHAPE);
  const st = recordStore();
  if (st) {
    try {
      const d = JSON.parse(st.getItem(RECORD_KEY) || '{}');
      if (d && typeof d === 'object' && !Array.isArray(d)) {
        for (const k of Object.keys(RECORD_SHAPE)) {
          const v = Number(d[k]);
          // lastSeed is a full uint32 — the general 1e9 cap would corrupt
          // seeds above it on read-back.
          const cap = k === 'lastSeed' ? 0xffffffff : 1e9;
          if (Number.isFinite(v) && v >= 0) rec[k] = Math.min(v, cap);
        }
      }
    } catch (_) { /* hostile or absent record: keep defaults */ }
  }
  recordCache = rec;
  return rec;
}

/** Merge numeric updates into the record and persist. adds= increments, maxes= high-water marks. */
export function updateRecord({ adds = {}, maxes = {} } = {}) {
  const rec = getRecord();
  for (const k of Object.keys(adds)) {
    if (k in RECORD_SHAPE) rec[k] = Math.min(1e9, rec[k] + Math.max(0, Number(adds[k]) || 0));
  }
  for (const k of Object.keys(maxes)) {
    if (k in RECORD_SHAPE) rec[k] = Math.max(rec[k], Math.min(1e9, Math.max(0, Number(maxes[k]) || 0)));
  }
  if ('lastSeed' in maxes) rec.lastSeed = (Number(maxes.lastSeed) >>> 0);
  const st = recordStore();
  if (st) { try { st.setItem(RECORD_KEY, JSON.stringify(rec)); } catch (_) { /* full or blocked */ } }
  return rec;
}

export function setFlag(k, v = true) { S.flags[k] = v; }
export function getFlag(k) { return !!S.flags[k]; }

export function addMoney(n) { S.money = S.player.money = Math.min(999999, S.player.money + Math.max(0, n | 0)); }
export function spendMoney(n) {
  n = Math.max(0, n | 0);
  if (S.player.money < n) return false;
  S.player.money -= n;
  return true;
}

export function addItem(id, n = 1) {
  if (!id) return;
  S.bag[id] = Math.min(99, (S.bag[id] || 0) + Math.max(1, n | 0));
}
export function removeItem(id, n = 1) {
  if (!S.bag[id]) return false;
  S.bag[id] -= Math.max(1, n | 0);
  if (S.bag[id] <= 0) delete S.bag[id];
  return true;
}
export function itemCount(id) { return S.bag[id] || 0; }
export function bagList() {
  return Object.keys(S.bag).filter((k) => S.bag[k] > 0);
}

export function seeSpecies(id) { if (id) S.dex.seen[id] = true; }
export function catchSpecies(id, variant) {
  if (!id) return;
  S.dex.seen[id] = true;
  S.dex.caught[id] = true;
  // A second, equally deep completion layer for free: the variant system already
  // gives every species a recognisable alternate palette, and nothing recorded it.
  if (variant) S.dex.variant[id] = true;
}
export function dexVariantCount() { return Object.keys(S.dex.variant || {}).length; }
export function dexSeenCount() { return Object.keys(S.dex.seen).length; }
export function dexCaughtCount() { return Object.keys(S.dex.caught).length; }

export function timeOfDay() {
  const h = Math.floor(S.time / 60) % 24;
  if (h >= 5 && h < 10) return 'morning';
  if (h >= 10 && h < 17) return 'day';
  if (h >= 17 && h < 20) return 'evening';
  return 'night';
}

export function advanceTime(minutes) {
  S.time = (S.time + minutes) % 1440;
  if (S.time < 0) S.time += 1440;
}

export function clockString() {
  const h = Math.floor(S.time / 60) % 24;
  const m = Math.floor(S.time % 60);
  const ampm = h < 12 ? 'AM' : 'PM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return hh + ':' + String(m).padStart(2, '0') + ' ' + ampm;
}

export function playtimeString() {
  const t = Math.floor(S.playtime);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60);
  return h + ':' + String(m).padStart(2, '0');
}
