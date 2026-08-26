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
  badges: 0,
  started: false,
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
  S.badges = 0;
  S.started = true;
  addItem('orb', 3);
  addItem('potion', 3);
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
