// localStorage save/load. The world is NOT serialized — it is regenerated from the seed,
// which keeps saves tiny and exercises worldgen determinism.
// Every field coming back from storage is treated as hostile.
import { S, resetState, PARTY_MAX, BOX_MAX, EXPLORE_W, EXPLORE_H, markExplored, updateRecord } from './state.js';
import { getSpecies } from './creatures.js';
import { getMove } from './moves.js';
import { getItem } from './items.js';
import { maxHp, clampLevel } from './battlecalc.js';

export const SAVE_KEY_PREFIX = 'verdant.save.';
export const SAVE_VERSION = 2;   // v2: Wave 5 re-derives town content, so v1 worlds shifted
export const SLOTS = 3;

const STATUSES = ['brn', 'psn', 'par', 'slp', 'frz'];
const DIRS = ['down', 'up', 'left', 'right'];

function storage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    localStorage.setItem('__vf_probe', '1');
    localStorage.removeItem('__vf_probe');
    return localStorage;
  } catch (_) { return null; }   // private mode / disabled storage
}

const keyFor = (slot) => SAVE_KEY_PREFIX + (Math.max(0, Math.min(SLOTS - 1, slot | 0)));

// ---- sanitisers --------------------------------------------------------
function num(v, lo, hi, dflt) {
  const n = Number(v);
  if (!isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

const CTRL = /[\x00-\x1f\x7f-\x9f]/g;

function str(v, maxLen, dflt) {
  if (typeof v !== 'string') return dflt;
  // Strip control characters. The name is drawn to canvas, never inserted as HTML.
  const clean = v.replace(CTRL, '').slice(0, maxLen);
  return clean.length ? clean : dflt;
}

function sanitizeCreature(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const sp = getSpecies(raw.species);
  if (!sp || sp.id !== raw.species) return null;      // unknown species -> drop, don't fake it

  const inst = {
    species: sp.id,
    nickname: (raw.nickname === null || raw.nickname === undefined) ? null : str(raw.nickname, 12, null),
    level: clampLevel(raw.level),
    exp: num(raw.exp, 0, 1e9, 0),
    ivs: {},
    hp: 0,
    status: STATUSES.indexOf(raw.status) !== -1 ? raw.status : null,
    sleepTurns: num(raw.sleepTurns, 0, 7, 0),
    variant: !!raw.variant,
    moves: [],
    ball: (typeof raw.ball === 'string' && getItem(raw.ball).id === raw.ball) ? raw.ball : 'orb',
    met: { level: 1, where: 'somewhere' },
  };

  const rawIv = (raw.ivs && typeof raw.ivs === 'object') ? raw.ivs : {};
  for (const k of ['hp', 'atk', 'def', 'spa', 'spd', 'spe']) inst.ivs[k] = num(rawIv[k], 0, 31, 0);

  const rawMoves = Array.isArray(raw.moves) ? raw.moves.slice(0, 4) : [];
  for (const m of rawMoves) {
    if (!m || typeof m !== 'object') continue;
    const mv = getMove(m.id);
    if (!mv || mv.id !== m.id) continue;
    const ppMax = num(m.ppMax, 1, 64, mv.pp);
    inst.moves.push({ id: mv.id, ppMax, pp: num(m.pp, 0, ppMax, ppMax) });
  }
  if (!inst.moves.length) {
    const mv = getMove('tackle');
    inst.moves.push({ id: mv.id, pp: mv.pp, ppMax: mv.pp });
  }

  if (raw.met && typeof raw.met === 'object') {
    inst.met.level = clampLevel(raw.met.level);
    inst.met.where = str(raw.met.where, 24, 'somewhere');
  }

  inst.hp = num(raw.hp, 0, maxHp(inst), maxHp(inst));
  return inst;
}

function sanitizeIdMap(raw, validator, maxKeys, maxVal) {
  const out = Object.create(null);
  if (!raw || typeof raw !== 'object') return out;
  let n = 0;
  for (const k of Object.keys(raw)) {
    if (n >= maxKeys) break;
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (!validator(k)) continue;
    if (maxVal === true) { out[k] = true; n++; continue; }
    const v = num(raw[k], 0, maxVal, 0);
    if (v <= 0) continue;
    out[k] = v;
    n++;
  }
  return out;
}

// ---- explored chart codec ---------------------------------------------
// Save field `explored` (additive in v2 — older v2 saves simply lack it):
// the 9216-cell chart packed 8 cells per byte, LSB-first (cell i lives in
// byte i>>3, bit i&7; cell i = cy*EXPLORE_W + cx), then base64 (standard
// alphabet). 9216 cells -> 1152 bytes -> exactly 1536 base64 chars, no
// padding (1152 % 3 === 0). Cells are 0/1 in memory, so packing truthiness
// loses nothing and the round trip is byte-identical.
// Hand-rolled base64 keeps the module free of btoa/Buffer environment
// differences and gives strict character validation on the way in.
const EXPLORED_CELLS = EXPLORE_W * EXPLORE_H;      // 9216
const EXPLORED_BYTES = EXPLORED_CELLS >> 3;        // 1152
const EXPLORED_B64_LEN = (EXPLORED_BYTES / 3) * 4; // 1536
const B64_ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encodeExplored() {
  const src = S.explored;
  if (!(src instanceof Uint8Array) || src.length !== EXPLORED_CELLS) return undefined;
  const bytes = new Uint8Array(EXPLORED_BYTES);
  for (let i = 0; i < EXPLORED_CELLS; i++) {
    if (src[i]) bytes[i >> 3] |= 1 << (i & 7);
  }
  let out = '';
  for (let i = 0; i < EXPLORED_BYTES; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64_ALPHA[(n >> 18) & 63] + B64_ALPHA[(n >> 12) & 63]
         + B64_ALPHA[(n >> 6) & 63] + B64_ALPHA[n & 63];
  }
  return out;
}

// Full hostile-input treatment: wrong type, wrong length, or any character
// outside the alphabet -> null ("field absent"), never a throw. The length
// gate runs first so a huge string costs one comparison, not a decode.
function decodeExplored(v) {
  if (typeof v !== 'string' || v.length !== EXPLORED_B64_LEN) return null;
  const cells = new Uint8Array(EXPLORED_CELLS);
  for (let i = 0, o = 0; i < EXPLORED_B64_LEN; i += 4, o += 3) {
    const a = B64_ALPHA.indexOf(v[i]),     b = B64_ALPHA.indexOf(v[i + 1]);
    const c = B64_ALPHA.indexOf(v[i + 2]), d = B64_ALPHA.indexOf(v[i + 3]);
    if (a < 0 || b < 0 || c < 0 || d < 0) return null;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    const b0 = (n >> 16) & 255, b1 = (n >> 8) & 255, b2 = n & 255;
    for (let k = 0; k < 8; k++) {
      cells[(o << 3) + k] = (b0 >> k) & 1;
      cells[((o + 1) << 3) + k] = (b1 >> k) & 1;
      cells[((o + 2) << 3) + k] = (b2 >> k) & 1;
    }
  }
  return cells;
}

// ---- lifetime playtime watermark ---------------------------------------
// Seconds of S.playtime already credited to the Frontier Record. Module
// state, reset by the paths that run through save.js (loadGame). The
// approximation: playtime in a loaded save was credited when that save was
// written, and time played between the last save and a quit/load is never
// credited — so the record can undercount, never double-count. A New
// Journey started outside save.js leaves a stale (higher) watermark; the
// Math.max(0, ...) clamp in saveGame absorbs it at the cost of that first
// delta.
let playtimeSynced = 0;

// ---- serialise ---------------------------------------------------------
function packCreature(c) {
  return {
    species: c.species, nickname: c.nickname, level: c.level, exp: c.exp,
    ivs: c.ivs, hp: c.hp, status: c.status, sleepTurns: c.sleepTurns, variant: !!c.variant,
    moves: c.moves.map((m) => ({ id: m.id, pp: m.pp, ppMax: m.ppMax })),
    ball: c.ball, met: c.met,
  };
}

function snapshot() {
  return {
    v: SAVE_VERSION,
    at: Date.now(),
    seed: S.seed >>> 0,
    mapId: S.mapId,
    player: {
      x: S.player.x | 0, y: S.player.y | 0, dir: S.player.dir,
      name: S.player.name, money: S.player.money | 0, steps: S.player.steps | 0,
    },
    party: S.party.map(packCreature),
    boxes: S.boxes.slice(0, BOX_MAX).map(packCreature),
    bag: Object.assign({}, S.bag),
    dex: { seen: Object.assign({}, S.dex.seen), caught: Object.assign({}, S.dex.caught),
           variant: Object.assign({}, S.dex.variant || {}) },
    flags: Object.assign({}, S.flags),
    returnPoint: S.returnPoint ? { x: S.returnPoint.x | 0, y: S.returnPoint.y | 0 } : null,
    time: S.time | 0,
    playtime: Math.floor(S.playtime),
    // Packed+base64 chart (format above); undefined (field omitted) when the
    // in-memory chart is missing or malformed, which the loader treats as absent.
    explored: encodeExplored(),
    badges: S.badges | 0,
    options: {
      textSpeed: S.options.textSpeed | 0,
      music: !!S.options.music,
      sfx: !!S.options.sfx,
      autoRun: !!S.options.autoRun,
    },
  };
}

export function saveGame(slot) {
  const st = storage();
  if (!st) return false;
  try {
    st.setItem(keyFor(slot), JSON.stringify(snapshot()));
    // Lifetime playtime: credit the Frontier Record with the seconds gained
    // since the last sync (see the watermark comment above). updateRecord is
    // storage-guarded and never throws, so a blocked record store cannot
    // turn a successful save into a reported failure.
    const pt = Math.floor(S.playtime);
    updateRecord({ adds: { totalPlaytime: Math.max(0, pt - playtimeSynced) } });
    playtimeSynced = pt;
    return true;
  } catch (_) {
    return false;   // quota exceeded or serialization failure
  }
}

// ---- deserialise -------------------------------------------------------
function readRaw(slot) {
  const st = storage();
  if (!st) return null;
  let text;
  try { text = st.getItem(keyFor(slot)); } catch (_) { return null; }
  if (!text || typeof text !== 'string') return null;
  if (text.length > 2000000) return null;        // absurd payload, refuse it
  let data;
  try { data = JSON.parse(text); } catch (_) { return null; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const v = num(data.v, 0, 999, -1);
  // v1 saves load with a migration (see loadGame); anything else is refused.
  if (v !== SAVE_VERSION && v !== 1) return null;
  return data;
}

export function hasSave(slot) { return readRaw(slot) !== null; }

export function slotSummary(slot) {
  const d = readRaw(slot);
  if (!d) return null;
  const party = Array.isArray(d.party) ? d.party.slice(0, PARTY_MAX) : [];
  const caught = (d.dex && d.dex.caught && typeof d.dex.caught === 'object')
    ? Object.keys(d.dex.caught).length : 0;
  const secs = num(d.playtime, 0, 1e7, 0);
  return {
    name: str(d.player && d.player.name, 12, 'Rowan'),
    playtime: Math.floor(secs / 3600) + ':' + String(Math.floor((secs % 3600) / 60)).padStart(2, '0'),
    badges: num(d.badges, 0, 99, 0),
    dexCaught: caught,
    // Enough context to remember an hour of play before pressing Enter.
    money: num(d.player && d.player.money, 0, 999999, 0),
    seed: num(d.seed, 0, 0xffffffff, 0),
    where: { x: num(d.player && d.player.x, 0, 4096, 0), y: num(d.player && d.player.y, 0, 4096, 0) },
    party: party.map((c) => ({
      species: getSpecies(c && c.species).id,
      level: clampLevel(c && c.level),
      variant: !!(c && c.variant),
    })),
  };
}

// Rehydrates state. The caller regenerates the world from S.seed and re-enters the map.
export function loadGame(slot) {
  const d = readRaw(slot);
  if (!d) return false;

  try {
    resetState(num(d.seed, 0, 0xffffffff, 1), str(d.player && d.player.name, 12, 'Rowan'));
    playtimeSynced = 0;   // fresh journey until this load proves otherwise

    S.mapId = (typeof d.mapId === 'string' && /^[a-z]+(:[a-z0-9]+){0,3}$/i.test(d.mapId)) ? d.mapId : 'world';
    S.player.x = num(d.player && d.player.x, 0, 4096, 0);
    S.player.y = num(d.player && d.player.y, 0, 4096, 0);
    S.player.dir = DIRS.indexOf(d.player && d.player.dir) !== -1 ? d.player.dir : 'down';
    S.player.money = num(d.player && d.player.money, 0, 999999, 0);
    S.player.steps = num(d.player && d.player.steps, 0, 1e9, 0);

    S.party = (Array.isArray(d.party) ? d.party.slice(0, PARTY_MAX) : [])
      .map(sanitizeCreature).filter(Boolean);
    S.boxes = (Array.isArray(d.boxes) ? d.boxes.slice(0, BOX_MAX) : [])
      .map(sanitizeCreature).filter(Boolean);

    S.bag = sanitizeIdMap(d.bag, (k) => getItem(k).id === k, 64, 99);
    S.dex.seen = sanitizeIdMap(d.dex && d.dex.seen, (k) => getSpecies(k).id === k, 256, true);
    S.dex.caught = sanitizeIdMap(d.dex && d.dex.caught, (k) => getSpecies(k).id === k, 256, true);
    S.dex.variant = sanitizeIdMap(d.dex && d.dex.variant, (k) => getSpecies(k).id === k, 256, true);
    S.flags = sanitizeIdMap(d.flags, (k) => /^[a-z0-9_:]{1,48}$/i.test(k), 512, true);

    // Without this, a save made inside a building or cave forgot where its exit
    // led, and walking out teleported the player to the start town.
    S.returnPoint = (d.returnPoint && typeof d.returnPoint === 'object')
      ? { x: num(d.returnPoint.x, 0, 4096, 0), y: num(d.returnPoint.y, 0, 4096, 0) }
      : null;
    S.time = num(d.time, 0, 1439, 480);
    S.playtime = num(d.playtime, 0, 1e7, 0);
    S.badges = num(d.badges, 0, 99, 0);

    if (num(d.v, 0, 999, -1) === 1) {
      // Wave 5 changed how towns draw from the world seed, so a v1 save's
      // coordinates were recorded in a world that no longer exists exactly.
      // Surface the player outdoors at their last known WORLD point (interior
      // coordinates would land them near 0,0), keep everything they own, and
      // let overworld's spawn safety absorb any tile that turned solid. The
      // one-time banner is overworld's job (flag world_shifted).
      if (S.mapId !== 'world') {
        if (S.returnPoint) { S.player.x = S.returnPoint.x; S.player.y = S.returnPoint.y; }
        else { S.player.x = -1; S.player.y = -1; }   // forces the spawn fallback
      }
      S.mapId = 'world';
      S.returnPoint = null;
      S.flags.world_shifted = true;
    }

    // Explored chart. Runs after the v1 migration so a migrated save (now on
    // the world map) gets the same grace as a v2 save missing the field.
    // Absent/hostile payload -> keep resetState's blank chart and mark a
    // generous circle (radius 10) around what save.js can know: the player's
    // world position, and the returnPoint of an interior save (that is the
    // world tile they will surface at). Overworld re-charts the rest as the
    // player walks, so absence never strands anyone on a black map.
    const chart = decodeExplored(d.explored);
    if (chart) {
      S.explored = chart;
    } else {
      // x >= 0 skips the v1 spawn-fallback sentinel (-1,-1).
      if (S.mapId === 'world' && S.player.x >= 0 && S.player.y >= 0) {
        markExplored(S.player.x, S.player.y, 10);
      }
      if (S.returnPoint) markExplored(S.returnPoint.x, S.returnPoint.y, 10);
    }

    const o = (d.options && typeof d.options === 'object') ? d.options : {};
    S.options.textSpeed = num(o.textSpeed, 0, 3, 2);
    S.options.music = o.music !== false;
    S.options.sfx = o.sfx !== false;
    S.options.autoRun = !!o.autoRun;

    // A save with no usable party would softlock the overworld. Refuse it.
    if (!S.party.length) return false;
    // Guarantee at least one creature can act.
    if (S.party.every((c) => c.hp <= 0)) S.party[0].hp = Math.max(1, Math.floor(maxHp(S.party[0]) / 2));

    S.started = true;
    // The loaded playtime was credited to the record by whichever saveGame
    // wrote it; start counting new lifetime seconds from here.
    playtimeSynced = Math.floor(S.playtime);
    return true;
  } catch (_) {
    return false;
  }
}

export function deleteSave(slot) {
  const st = storage();
  if (!st) return false;
  try { st.removeItem(keyFor(slot)); return true; } catch (_) { return false; }
}

// ---- map RLE (contract surface; interiors are regenerated, so this is a utility) ----
export function encodeMap(mapData) {
  if (!mapData || !mapData.ground) return '';
  const enc = (arr) => {
    const parts = [];
    let run = 1;
    for (let i = 1; i <= arr.length; i++) {
      if (i < arr.length && arr[i] === arr[i - 1] && run < 9999) { run++; continue; }
      parts.push(run > 1 ? arr[i - 1] + 'x' + run : String(arr[i - 1]));
      run = 1;
    }
    return parts.join(',');
  };
  return [mapData.w, mapData.h, enc(mapData.ground), enc(mapData.overlay || [])].join('|');
}

export function decodeMap(text) {
  if (typeof text !== 'string' || !text) return null;
  const parts = text.split('|');
  if (parts.length < 4) return null;
  const w = num(parts[0], 1, 4096, 0), h = num(parts[1], 1, 4096, 0);
  if (!w || !h) return null;
  const dec = (s) => {
    const out = new Uint16Array(w * h);
    let i = 0;
    for (const tok of String(s).split(',')) {
      if (!tok) continue;
      const xi = tok.indexOf('x');
      const val = num(xi === -1 ? tok : tok.slice(0, xi), 0, 65535, 0);
      const run = xi === -1 ? 1 : num(tok.slice(xi + 1), 1, w * h, 1);
      for (let k = 0; k < run && i < out.length; k++) out[i++] = val;
    }
    return out;
  };
  return { w, h, ground: dec(parts[2]), overlay: dec(parts[3]) };
}
