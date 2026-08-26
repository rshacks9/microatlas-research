// localStorage save/load. The world is NOT serialized — it is regenerated from the seed,
// which keeps saves tiny and exercises worldgen determinism.
// Every field coming back from storage is treated as hostile.
import { S, resetState, PARTY_MAX, BOX_MAX } from './state.js';
import { getSpecies } from './creatures.js';
import { getMove } from './moves.js';
import { getItem } from './items.js';
import { maxHp, clampLevel } from './battlecalc.js';

export const SAVE_KEY_PREFIX = 'verdant.save.';
export const SAVE_VERSION = 1;
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
    dex: { seen: Object.assign({}, S.dex.seen), caught: Object.assign({}, S.dex.caught) },
    flags: Object.assign({}, S.flags),
    time: S.time | 0,
    playtime: Math.floor(S.playtime),
    badges: S.badges | 0,
    options: {
      textSpeed: S.options.textSpeed | 0,
      music: !!S.options.music,
      sfx: !!S.options.sfx,
    },
  };
}

export function saveGame(slot) {
  const st = storage();
  if (!st) return false;
  try {
    st.setItem(keyFor(slot), JSON.stringify(snapshot()));
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
  if (num(data.v, 0, 999, -1) !== SAVE_VERSION) return null;
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
    party: party.map((c) => ({
      species: getSpecies(c && c.species).id,
      level: clampLevel(c && c.level),
    })),
  };
}

// Rehydrates state. The caller regenerates the world from S.seed and re-enters the map.
export function loadGame(slot) {
  const d = readRaw(slot);
  if (!d) return false;

  try {
    resetState(num(d.seed, 0, 0xffffffff, 1), str(d.player && d.player.name, 12, 'Rowan'));

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
    S.flags = sanitizeIdMap(d.flags, (k) => /^[a-z0-9_:]{1,48}$/i.test(k), 512, true);

    S.time = num(d.time, 0, 1439, 480);
    S.playtime = num(d.playtime, 0, 1e7, 0);
    S.badges = num(d.badges, 0, 99, 0);

    const o = (d.options && typeof d.options === 'object') ? d.options : {};
    S.options.textSpeed = num(o.textSpeed, 0, 3, 2);
    S.options.music = o.music !== false;
    S.options.sfx = o.sfx !== false;

    // A save with no usable party would softlock the overworld. Refuse it.
    if (!S.party.length) return false;
    // Guarantee at least one creature can act.
    if (S.party.every((c) => c.hp <= 0)) S.party[0].hp = Math.max(1, Math.floor(maxHp(S.party[0]) / 2));

    S.started = true;
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
