// Party / box management, creature construction, levelling and evolution.
// No DOM. Node-importable.
import { getSpecies } from './creatures.js';
import { getMove } from './moves.js';
import { statsFor, maxHp, expForLevel, levelForExp, clampLevel, MAX_LEVEL } from './battlecalc.js';
import { S, PARTY_MAX, BOX_MAX, catchSpecies, seeSpecies } from './state.js';
import { rand } from './rng.js';

export const MOVE_SLOTS = 4;

function rollIvs(rng) {
  const r = rng || (() => Math.random());
  const iv = {};
  for (const k of ['hp', 'atk', 'def', 'spa', 'spd', 'spe']) iv[k] = Math.floor(r() * 32);
  return iv;
}

// The 4 most recent moves learnable at or below `level`.
export function movesAtLevel(speciesId, level) {
  const sp = getSpecies(speciesId);
  const lv = clampLevel(level);
  const eligible = (sp.learnset || []).filter((e) => Array.isArray(e) && e[0] <= lv);
  const ids = [];
  for (const [, id] of eligible) {
    const i = ids.indexOf(id);
    if (i !== -1) ids.splice(i, 1);
    ids.push(id);
  }
  const chosen = ids.slice(-MOVE_SLOTS);
  if (!chosen.length) chosen.push('tackle');
  return chosen.map((id) => {
    const mv = getMove(id);
    return { id, pp: mv.pp, ppMax: mv.pp };
  });
}

// opts: { rng, ivs, moves, nickname, ball, where, hp }
export function makeCreature(speciesId, level, opts = {}) {
  const sp = getSpecies(speciesId);
  const lv = clampLevel(level);
  const rollRare = opts.rng || (() => Math.random());
  const inst = {
    species: sp.id,
    nickname: opts.nickname || null,
    // ~1 in 320. The whole point of a rare variant is that the player keeps
    // taking one more step because the next one MIGHT be it.
    variant: opts.variant !== undefined ? !!opts.variant : rollRare() < 1 / 320,
    level: lv,
    exp: expForLevel(sp.growth, lv),
    ivs: opts.ivs || rollIvs(opts.rng),
    hp: 0,
    status: null,
    sleepTurns: 0,
    moves: opts.moves || movesAtLevel(sp.id, lv),
    ball: opts.ball || 'orb',
    met: { level: lv, where: opts.where || 'the wild' },
  };
  inst.hp = opts.hp !== undefined ? Math.max(0, Math.min(maxHp(inst), opts.hp | 0)) : maxHp(inst);
  return inst;
}

export function displayName(inst) {
  if (!inst) return '???';
  return inst.nickname || getSpecies(inst.species).name;
}

export function isFainted(inst) { return !inst || inst.hp <= 0; }

export function heal(inst) {
  if (!inst) return;
  inst.hp = maxHp(inst);
  inst.status = null;
  inst.sleepTurns = 0;
  for (const m of inst.moves || []) m.pp = m.ppMax;
}

export function healParty() { for (const c of S.party) heal(c); }

export function firstHealthy() {
  for (let i = 0; i < S.party.length; i++) if (!isFainted(S.party[i])) return i;
  return -1;
}

export function partyWiped() {
  return S.party.length === 0 || S.party.every(isFainted);
}

export function partyCount() { return S.party.length; }
export function healthyCount() { return S.party.filter((c) => !isFainted(c)).length; }

export function addToParty(inst) {
  if (!inst) return 'full';
  catchSpecies(inst.species);
  if (S.party.length < PARTY_MAX) { S.party.push(inst); return 'party'; }
  if (S.boxes.length < BOX_MAX) { S.boxes.push(inst); return 'box'; }
  return 'full';
}

export function swapParty(i, j) {
  if (i < 0 || j < 0 || i >= S.party.length || j >= S.party.length || i === j) return false;
  const t = S.party[i]; S.party[i] = S.party[j]; S.party[j] = t;
  return true;
}

// ---- experience & levelling -------------------------------------------
// Returns { leveled:[levels], learned:[{level,moveId}], evolved:speciesId|null, gained }
export function giveExp(inst, amount) {
  const out = { leveled: [], learned: [], evolved: null, gained: 0 };
  if (!inst || isFainted(inst)) return out;
  const sp = getSpecies(inst.species);
  if (inst.level >= MAX_LEVEL) return out;

  const amt = Math.max(0, Math.floor(amount || 0));
  out.gained = amt;
  inst.exp = (inst.exp | 0) + amt;

  const cap = expForLevel(sp.growth, MAX_LEVEL);
  if (inst.exp > cap) inst.exp = cap;

  const newLevel = levelForExp(sp.growth, inst.exp);
  while (inst.level < newLevel) {
    const before = maxHp(inst);
    inst.level++;
    const after = maxHp(inst);
    inst.hp = Math.min(after, inst.hp + (after - before));   // level-up grants the HP delta
    out.leveled.push(inst.level);
    for (const entry of sp.learnset || []) {
      if (Array.isArray(entry) && entry[0] === inst.level) {
        out.learned.push({ level: inst.level, moveId: entry[1] });
      }
    }
  }
  return out;
}

export function knowsMove(inst, moveId) {
  return (inst.moves || []).some((m) => m && m.id === moveId);
}

// replaceIndex null/undefined => append if there is room, else no-op.
export function learnMove(inst, moveId, replaceIndex) {
  if (!inst || !moveId) return false;
  if (knowsMove(inst, moveId)) return false;
  const mv = getMove(moveId);
  const slot = { id: moveId, pp: mv.pp, ppMax: mv.pp };
  if (replaceIndex === null || replaceIndex === undefined) {
    if (inst.moves.length < MOVE_SLOTS) { inst.moves.push(slot); return true; }
    return false;
  }
  const i = replaceIndex | 0;
  if (i < 0 || i >= inst.moves.length) return false;
  inst.moves[i] = slot;
  return true;
}

export function tryEvolve(inst) {
  if (!inst) return null;
  const sp = getSpecies(inst.species);
  const ev = sp.evolve;
  if (!ev || !ev.into || inst.level < ev.level) return null;
  const target = getSpecies(ev.into);
  if (!target || target.id === sp.id) return null;
  return target.id;
}

// Perform the evolution, preserving current/max HP ratio and known moves.
export function evolveInto(inst, speciesId) {
  const before = maxHp(inst);
  const frac = before > 0 ? inst.hp / before : 1;
  inst.species = getSpecies(speciesId).id;
  const after = maxHp(inst);
  inst.hp = Math.max(1, Math.min(after, Math.round(after * frac)));
  seeSpecies(inst.species);
  catchSpecies(inst.species);
  return inst;
}

// ---- pp ----------------------------------------------------------------
export function restorePp(inst, index, amount) {
  const m = inst.moves[index];
  if (!m) return false;
  m.pp = amount === undefined ? m.ppMax : Math.min(m.ppMax, m.pp + amount);
  return true;
}

export function hasUsableMove(inst) {
  return (inst.moves || []).some((m) => m && m.pp > 0);
}

// ---- helpers used by the UI --------------------------------------------
export function statsOf(inst) { return statsFor(inst); }
export function hpFrac(inst) {
  const m = maxHp(inst);
  return m > 0 ? Math.max(0, Math.min(1, inst.hp / m)) : 0;
}

export function partySummary() {
  return S.party.map((c) => ({
    name: displayName(c), level: c.level, hp: c.hp, max: maxHp(c), status: c.status,
    species: c.species,
  }));
}

// Build a trainer's team from an EntitySpec.team array.
export function buildTeam(teamSpec, rng) {
  const r = rng || rand.float;
  const list = Array.isArray(teamSpec) ? teamSpec : [];
  return list.slice(0, PARTY_MAX).map((t) =>
    makeCreature(t.species, t.level, { rng: r, where: 'a trainer' })
  );
}
