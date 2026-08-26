// Pure battle mathematics. NO DOM — importable in Node for headless simulation.
import { getSpecies } from './creatures.js';
import { getMove } from './moves.js';
import { effectiveness } from './types.js';
import { rand } from './rng.js';

// Tuned empirically via tools/simulate.mjs. Raising this lengthens battles.
//
// A FLAT divisor cannot hold pacing steady across the level range, because the
// attack/defence ratio drifts with level: the constant +5 in the stat formula
// dominates at low level (so A/D sits near 1) and vanishes at high level (so a
// high-attack species pulls well clear). A flat 80 gave 6.1-turn battles at L20
// but 3.5 turns with 6.7% one-shots at L60.
//
// Scaling the divisor with level flattens it. Measured over 500 same-level
// battles per level with the faithful engine:
//   flat 80          L5 5.5t/0.2%  L20 6.1t/0.8%  L40 3.8t/2.9%  L60 3.5t/6.7%  L100 3.8t/7.3%
//   70 + lv*0.55     L5 5.5t/0.6%  L20 5.7t/0.8%  L40 4.3t/1.0%  L60 4.8t/2.1%  L100 5.6t/0.6%
export const DAMAGE_DIVISOR = 80;          // kept for reference; use damageDivisor()
export function damageDivisor(level) {
  return 70 + clampLevel(level) * 0.55;
}

export const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
export const MAX_LEVEL = 100;

// ---- stats -------------------------------------------------------------
export function statsFor(inst) {
  const sp = getSpecies(inst.species);
  const lv = clampLevel(inst.level);
  const iv = inst.ivs || {};
  const out = {};
  // The +lv*0.6 term is a deliberate deviation from the classic formula: without it,
  // 28% of same-level battles ended on a single hit (measured with tools/simulate.mjs).
  // With it, plus DAMAGE_DIVISOR below, battles average ~5 turns and one-shots are ~1%.
  out.hp = Math.floor(((2 * sp.base.hp + (iv.hp | 0)) * lv) / 100) + lv + 10 + Math.floor(lv * 0.6);
  for (const k of ['atk', 'def', 'spa', 'spd', 'spe']) {
    out[k] = Math.floor(((2 * sp.base[k] + (iv[k] | 0)) * lv) / 100) + 5;
  }
  return out;
}

export function maxHp(inst) { return statsFor(inst).hp; }

export function clampLevel(lv) {
  lv = Math.floor(Number(lv) || 1);
  return Math.max(1, Math.min(MAX_LEVEL, lv));
}

// ---- experience --------------------------------------------------------
const GROWTH_MUL = { fast: 0.8, medium: 1, slow: 1.25 };

export function expForLevel(growth, level) {
  const lv = clampLevel(level);
  const m = GROWTH_MUL[growth] !== undefined ? GROWTH_MUL[growth] : 1;
  return Math.floor(m * lv * lv * lv);
}

export function levelForExp(growth, exp) {
  exp = Math.max(0, Math.floor(Number(exp) || 0));
  let lv = 1;
  while (lv < MAX_LEVEL && expForLevel(growth, lv + 1) <= exp) lv++;
  return lv;
}

export function expToNext(inst) {
  const sp = getSpecies(inst.species);
  const lv = clampLevel(inst.level);
  if (lv >= MAX_LEVEL) return { have: 1, need: 1, frac: 1 };
  const cur = expForLevel(sp.growth, lv);
  const next = expForLevel(sp.growth, lv + 1);
  const have = Math.max(0, (inst.exp | 0) - cur);
  const need = Math.max(1, next - cur);
  return { have, need, frac: Math.max(0, Math.min(1, have / need)) };
}

// winnerLevel is optional. When supplied, beating something above your level pays
// more and grinding well below it pays less, so walking outward is how you grow
// and farming the starting meadow stops being optimal.
export function expGain(defeatedInst, participants, isTrainer, winnerLevel) {
  const sp = getSpecies(defeatedInst.species);
  const n = Math.max(1, participants | 0);
  const foeLv = clampLevel(defeatedInst.level);
  const base = (sp.expYield * foeLv) / 7;

  let gapMul = 1;
  if (winnerLevel) {
    const gap = foeLv - clampLevel(winnerLevel);
    gapMul = Math.max(0.35, Math.min(2.2, 1 + gap * 0.09));
  }
  return Math.max(1, Math.floor((base * (isTrainer ? 1.5 : 1) * gapMul) / n));
}

// ---- stat stages -------------------------------------------------------
export function stageMul(stage) {
  const s = Math.max(-6, Math.min(6, stage | 0));
  return s >= 0 ? (2 + s) / 2 : 2 / (2 - s);
}

export function accStageMul(stage) {
  const s = Math.max(-6, Math.min(6, stage | 0));
  return s >= 0 ? (3 + s) / 3 : 3 / (3 - s);
}

// ---- damage ------------------------------------------------------------
// combatant: { inst, stages:{atk,def,spa,spd,spe,acc,eva}, status }
function effStat(c, key) {
  const base = statsFor(c.inst)[key];
  const st = (c.stages && c.stages[key]) || 0;
  let v = Math.floor(base * stageMul(st));
  if (key === 'spe' && c.inst.status === 'par') v = Math.floor(v * 0.5);
  if (key === 'atk' && c.inst.status === 'brn') v = Math.floor(v * 0.5);
  return Math.max(1, v);
}

export function speedOf(c) { return effStat(c, 'spe'); }

export function accuracyCheck(attacker, defender, move, roll) {
  const r = roll || rand.float;
  if (!move.accuracy || move.accuracy <= 0) return true;   // 0 = never misses
  const acc = accStageMul((attacker.stages && attacker.stages.acc) || 0);
  const eva = accStageMul((defender.stages && defender.stages.eva) || 0);
  const chance = Math.min(100, move.accuracy * (acc / eva));
  return r() * 100 < chance;
}

export function critChance(stages) {
  const s = Math.max(0, Math.min(4, stages | 0));
  return [1 / 16, 1 / 8, 1 / 4, 1 / 3, 1 / 2][s];
}

// opts: { rng, critStages, forceCrit, forceNoCrit }
export function damage(attacker, defender, move, opts = {}) {
  const r = opts.rng || rand.float;
  const mv = typeof move === 'string' ? getMove(move) : move;
  const defTypes = getSpecies(defender.inst.species).types;
  const mult = effectiveness(mv.type, defTypes);

  if (mv.category === 'status' || !mv.power) {
    return { dmg: 0, mult, crit: false, missed: false, status: true };
  }
  if (mult === 0) {
    return { dmg: 0, mult: 0, crit: false, missed: false, immune: true };
  }

  const physical = mv.category === 'physical';
  const aKey = physical ? 'atk' : 'spa';
  const dKey = physical ? 'def' : 'spd';

  let crit = false;
  if (opts.forceCrit) crit = true;
  else if (!opts.forceNoCrit) crit = r() < critChance(opts.critStages || 0);

  // Crits ignore the attacker's negative stages and the defender's positive ones.
  const aStage = crit ? Math.max(0, (attacker.stages && attacker.stages[aKey]) || 0) : ((attacker.stages && attacker.stages[aKey]) || 0);
  const dStage = crit ? Math.min(0, (defender.stages && defender.stages[dKey]) || 0) : ((defender.stages && defender.stages[dKey]) || 0);

  const baseA = statsFor(attacker.inst)[aKey];
  const baseD = statsFor(defender.inst)[dKey];
  let A = Math.max(1, Math.floor(baseA * stageMul(aStage)));
  const D = Math.max(1, Math.floor(baseD * stageMul(dStage)));
  if (physical && attacker.inst.status === 'brn') A = Math.max(1, Math.floor(A * 0.5));

  const lv = clampLevel(attacker.inst.level);
  let dmg = Math.floor(Math.floor((Math.floor((2 * lv) / 5) + 2) * mv.power * A / D) / damageDivisor(lv)) + 2;

  if (crit) dmg = Math.floor(dmg * 1.5);

  const atkTypes = getSpecies(attacker.inst.species).types;
  if (atkTypes.indexOf(mv.type) !== -1) dmg = Math.floor(dmg * 1.5);

  dmg = Math.floor(dmg * mult);

  const spread = 0.85 + r() * 0.15;
  dmg = Math.floor(dmg * spread);

  return { dmg: Math.max(1, dmg), mult, crit, missed: false };
}

// ---- catching ----------------------------------------------------------
const STATUS_CATCH_BONUS = { slp: 2.5, frz: 2.5, par: 1.5, psn: 1.5, brn: 1.5 };

export function catchChance(targetInst, ballRate, statusName, opts = {}) {
  const r = opts.rng || rand.float;
  const sp = getSpecies(targetInst.species);
  const max = maxHp(targetInst);
  const cur = Math.max(1, Math.min(max, targetInst.hp | 0));
  const bonus = STATUS_CATCH_BONUS[statusName || targetInst.status] || 1;

  let a = (((3 * max - 2 * cur) * sp.catchRate * (ballRate || 1)) / (3 * max)) * bonus;
  a = Math.max(1, Math.min(255, a));

  if (a >= 255) return { shakes: 4, caught: true, a };

  const b = 65536 / Math.pow(255 / a, 0.25);
  let shakes = 0;
  for (let i = 0; i < 4; i++) {
    if (r() * 65536 < b) shakes++;
    else break;
  }
  return { shakes, caught: shakes >= 4, a };
}

export function catchOdds(targetInst, ballRate, statusName) {
  const sp = getSpecies(targetInst.species);
  const max = maxHp(targetInst);
  const cur = Math.max(1, Math.min(max, targetInst.hp | 0));
  const bonus = STATUS_CATCH_BONUS[statusName || targetInst.status] || 1;
  let a = (((3 * max - 2 * cur) * sp.catchRate * (ballRate || 1)) / (3 * max)) * bonus;
  a = Math.max(1, Math.min(255, a));
  if (a >= 255) return 1;
  const b = 65536 / Math.pow(255 / a, 0.25);
  return Math.pow(Math.min(1, b / 65536), 4);
}

// ---- fleeing -----------------------------------------------------------
export function fleeChance(playerC, wildC, attempts) {
  const a = speedOf(playerC), b = speedOf(wildC);
  if (a >= b) return 1;
  const odds = (Math.floor((a * 128) / Math.max(1, b)) + 30 * Math.max(1, attempts)) % 256;
  return Math.min(1, odds / 256);
}

// ---- status ticks ------------------------------------------------------
export function endOfTurnDamage(inst) {
  const max = maxHp(inst);
  if (inst.status === 'psn') return Math.max(1, Math.floor(max / 8));
  if (inst.status === 'brn') return Math.max(1, Math.floor(max / 16));
  return 0;
}

// ---- AI ----------------------------------------------------------------
// difficulty: 0 = random, 1 = greedy damage, 2 = smart (status/setup aware)
export function aiChooseMove(self, foe, difficulty = 1, opts = {}) {
  const r = opts.rng || rand.float;
  const usable = [];
  for (let i = 0; i < self.inst.moves.length; i++) {
    const slot = self.inst.moves[i];
    if (!slot || slot.pp <= 0) continue;
    usable.push(i);
  }
  if (!usable.length) return -1;              // -1 => Struggle
  if (difficulty <= 0) return usable[Math.floor(r() * usable.length)];

  const foeMax = maxHp(foe.inst);
  let best = usable[0], bestScore = -Infinity;

  for (const i of usable) {
    const mv = getMove(self.inst.moves[i].id);
    let score = 0;

    if (mv.category === 'status') {
      score = 12;
      const ef = mv.effect;
      if (ef && ef.kind === 'status') {
        score = foe.inst.status ? 0 : 30;      // never re-apply status
      } else if (ef && ef.kind === 'stat') {
        const target = ef.target === 'self' ? self : foe;
        const cur = (target.stages && target.stages[ef.stat]) || 0;
        const wouldCap = ef.stages > 0 ? cur >= 4 : cur <= -4;
        score = wouldCap ? 0 : 22;
        // Setup is only worth it while healthy.
        if (ef.target === 'self' && self.inst.hp < maxHp(self.inst) * 0.5) score *= 0.4;
      } else if (ef && ef.kind === 'heal') {
        const missing = 1 - self.inst.hp / maxHp(self.inst);
        score = missing > 0.55 ? 55 : 0;
      }
      if (difficulty < 2) score *= 0.5;
    } else {
      const est = damage(self, foe, mv, { rng: () => 0.925, forceNoCrit: true });
      score = (est.dmg / foeMax) * 100;
      if (mv.accuracy > 0) score *= mv.accuracy / 100;
      if (est.dmg >= foe.inst.hp) score += 60;          // lethal is heavily preferred
      if (difficulty >= 2 && mv.priority > 0 && est.dmg >= foe.inst.hp) score += 25;
    }

    score *= 0.85 + r() * 0.3;                          // keep it from being perfectly readable
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}

export const STRUGGLE = {
  id: '__struggle', name: 'Struggle', type: 'PLAIN', category: 'physical',
  power: 40, accuracy: 0, pp: 1, priority: 0,
  desc: 'Used when no moves remain. The user is hurt too.',
  effect: { kind: 'recoil', frac: 0.25 },
};
