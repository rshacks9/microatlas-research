// items.js — Verdant Frontier item catalogue and use logic.
// Pure data + logic. No DOM at import time; safe to import in Node.
//
// Item record shape (see docs/CONTRACT.md):
//   { id, name, kind, price, desc, inBattle, inField, effect }
// kind: 'heal'|'ball'|'cure'|'revive'|'repel'|'boost'|'key'

import { displayName } from './party.js';
import { maxHp } from './battlecalc.js';

const STATUS_NAMES = {
  psn: 'poison',
  brn: 'burn',
  frz: 'frostbite',
  slp: 'drowsiness',
  par: 'numbness',
};

function item(id, name, kind, price, desc, inBattle, inField, effect) {
  return { id, name, kind, price, desc, inBattle, inField, effect: effect || null };
}

/** @type {Object<string, object>} */
export const ITEMS = {
  // ---- Capture orbs -------------------------------------------------------
  orb: item('orb', 'Orb', 'ball', 200,
    'A basic capture orb. Thrown at a wild creature to befriend it.',
    true, false, { kind: 'ball', rate: 1.0, name: 'Orb' }),
  greatorb: item('greatorb', 'Great Orb', 'ball', 600,
    'A tuned orb with a better capture rate than a plain Orb.',
    true, false, { kind: 'ball', rate: 1.5, name: 'Great Orb' }),
  ultraorb: item('ultraorb', 'Ultra Orb', 'ball', 1200,
    'A finely crafted orb with a very high capture rate.',
    true, false, { kind: 'ball', rate: 2.0, name: 'Ultra Orb' }),
  duskorb: item('duskorb', 'Dusk Orb', 'ball', 2600,
    'A rare orb of smoked glass that almost never fails.',
    true, false, { kind: 'ball', rate: 3.0, name: 'Dusk Orb' }),

  // ---- Healing ------------------------------------------------------------
  potion: item('potion', 'Potion', 'heal', 300,
    'Restores 20 HP to one creature.',
    true, true, { kind: 'heal', amount: 20 }),
  superpotion: item('superpotion', 'Super Potion', 'heal', 700,
    'Restores 60 HP to one creature.',
    true, true, { kind: 'heal', amount: 60 }),
  hyperpotion: item('hyperpotion', 'Hyper Potion', 'heal', 1500,
    'Restores 140 HP to one creature.',
    true, true, { kind: 'heal', amount: 140 }),
  fullrestore: item('fullrestore', 'Full Restore', 'heal', 3000,
    'Fully restores HP and clears any lingering condition.',
    true, true, { kind: 'heal', amount: 9999, cures: 'all' }),

  // ---- Status cures -------------------------------------------------------
  antidote: item('antidote', 'Antidote', 'cure', 200,
    'Draws venom out of a poisoned creature.',
    true, true, { kind: 'cure', status: 'psn' }),
  burnsalve: item('burnsalve', 'Burn Salve', 'cure', 250,
    'A cooling salve that soothes a burn.',
    true, true, { kind: 'cure', status: 'brn' }),
  icemelt: item('icemelt', 'Ice Melt', 'cure', 250,
    'A warming powder that thaws a frozen creature.',
    true, true, { kind: 'cure', status: 'frz' }),
  wakebell: item('wakebell', 'Wake Bell', 'cure', 250,
    'A bright chime that rouses a sleeping creature.',
    true, true, { kind: 'cure', status: 'slp' }),
  sparkdrop: item('sparkdrop', 'Spark Drop', 'cure', 250,
    'A bitter drop that settles paralysed nerves.',
    true, true, { kind: 'cure', status: 'par' }),
  cureall: item('cureall', 'Cure-All', 'cure', 600,
    'A broad remedy that clears any status condition.',
    true, true, { kind: 'cure', status: 'all' }),

  // ---- Revival ------------------------------------------------------------
  revive: item('revive', 'Revive', 'revive', 1500,
    'Rouses a fainted creature and restores half its HP.',
    true, true, { kind: 'revive', frac: 0.5 }),
  fullrevive: item('fullrevive', 'Full Revive', 'revive', 4000,
    'Rouses a fainted creature and restores all of its HP.',
    true, true, { kind: 'revive', frac: 1.0 }),

  // ---- Repellents ---------------------------------------------------------
  repel: item('repel', 'Repellent', 'repel', 350,
    'Keeps weaker wild creatures away for 100 steps.',
    false, true, { kind: 'repel', steps: 100 }),
  superrepel: item('superrepel', 'Super Repellent', 'repel', 700,
    'Keeps weaker wild creatures away for 250 steps.',
    false, true, { kind: 'repel', steps: 250 }),

  // ---- Tonics: permanent, repeatable IV training (money sink) -------------
  ironbrew: item('ironbrew', 'Ironbrew', 'tonic', 2200,
    'A bitter iron draught that permanently hones a creature\'s Attack.',
    false, true, { kind: 'tonic', stat: 'atk', amount: 4 }),
  stonehide: item('stonehide', 'Stonehide', 'tonic', 2200,
    'A mineral paste that permanently toughens a creature\'s Defense.',
    false, true, { kind: 'tonic', stat: 'def', amount: 4 }),
  quickstep: item('quickstep', 'Quickstep', 'tonic', 2200,
    'A fizzing cordial that permanently quickens a creature\'s Speed.',
    false, true, { kind: 'tonic', stat: 'spe', amount: 4 }),
  clearmind: item('clearmind', 'Clearmind', 'tonic', 2200,
    'A clarifying infusion that permanently sharpens a creature\'s Sp. Attack.',
    false, true, { kind: 'tonic', stat: 'spa', amount: 4 }),
  stoutheart: item('stoutheart', 'Stoutheart', 'tonic', 2200,
    'A hearty brew that permanently bolsters a creature\'s HP.',
    false, true, { kind: 'tonic', stat: 'hp', amount: 4 }),

  // ---- Key items ----------------------------------------------------------
  runningshoes: item('runningshoes', 'Running Shoes', 'key', 0,
    'Well-worn shoes. Hold the run key to move at double pace.',
    false, true, null),
  townmap: item('townmap', 'Town Map', 'key', 0,
    'A folded chart of the frontier, marked with every town you have found.',
    false, true, null),
  oldrod: item('oldrod', 'Old Rod', 'key', 0,
    'A battered fishing rod. Use it at the water\'s edge.',
    false, true, null),
};

const FALLBACK = Object.freeze(item(
  'unknown', 'Unknown Item', 'key', 0,
  'A mysterious object. It does not seem to do anything.',
  false, false, null,
));

/** Never returns undefined — an unknown id yields a safe inert placeholder. */
export function getItem(id) {
  if (typeof id !== 'string') return FALLBACK;
  return Object.prototype.hasOwnProperty.call(ITEMS, id) ? ITEMS[id] : FALLBACK;
}

export function allItems() {
  return Object.keys(ITEMS).map((k) => ITEMS[k]);
}

function fail(message) { return { ok: false, message, consumed: false }; }
function done(message) { return { ok: true, message, consumed: true }; }

function isFaintedInst(inst) { return !inst || (inst.hp | 0) <= 0; }

const IV_CAP = 31;
const TONIC_STATS = {
  hp: 'HP', atk: 'Attack', def: 'Defense', spa: 'Sp. Attack', spd: 'Sp. Defense', spe: 'Speed',
};

function statusLabel(st) { return STATUS_NAMES[st] || 'condition'; }

/**
 * Apply an item to a creature instance.
 * @param {string} id item id
 * @param {object} targetInst creature instance (may be null for repels/key items)
 * @param {'battle'|'field'} context
 * @returns {{ok:boolean, message:string, consumed:boolean}}
 */
export function useItem(id, targetInst, context) {
  const it = getItem(id);
  const ctx = context === 'battle' ? 'battle' : 'field';

  if (it === FALLBACK) return fail('Nothing happens.');

  // Context gate, checked before anything else.
  if (ctx === 'battle' && !it.inBattle) {
    return fail(`The ${it.name} cannot be used in the middle of a battle.`);
  }
  if (ctx === 'field' && !it.inField && it.kind !== 'ball') {
    return fail(`The ${it.name} is only useful during a battle.`);
  }

  const eff = it.effect;

  // ---- Balls: battle.js owns the throw; never resolve one here. -----------
  if (it.kind === 'ball') {
    if (ctx === 'field') {
      return fail(`There is nothing here to aim the ${it.name} at.`);
    }
    return { ok: false, message: `The ${it.name} is thrown in battle.`, consumed: false };
  }

  // ---- Key items: flavour only, never consumed. ---------------------------
  if (it.kind === 'key' || !eff) {
    return { ok: true, message: `You look over the ${it.name}.`, consumed: false };
  }

  // ---- Repels: caller applies the step counter. ---------------------------
  if (eff.kind === 'repel') {
    return done(`A repellent scent spreads out around you for ${eff.steps} steps.`);
  }

  // Everything below needs a real target.
  if (!targetInst || typeof targetInst !== 'object') {
    return fail(`The ${it.name} needs a creature to be used on.`);
  }
  const who = displayName(targetInst);
  const max = Math.max(1, Math.floor(maxHp(targetInst)) || 1);
  const cur = Math.max(0, Math.min(max, Math.floor(Number(targetInst.hp) || 0)));

  // ---- Revives ------------------------------------------------------------
  if (eff.kind === 'revive') {
    if (!isFaintedInst(targetInst)) {
      return fail(`${who} is still standing, so the ${it.name} would be wasted.`);
    }
    const frac = Math.max(0, Math.min(1, Number(eff.frac) || 0));
    const restored = Math.max(1, Math.min(max, Math.round(max * frac)));
    targetInst.hp = restored;
    targetInst.status = null;
    targetInst.sleepTurns = 0;
    return done(`${who} stirs back awake with ${restored} HP.`);
  }

  // ---- Cures --------------------------------------------------------------
  if (eff.kind === 'cure') {
    if (isFaintedInst(targetInst)) {
      return fail(`${who} has fainted and cannot be treated with the ${it.name}.`);
    }
    const st = targetInst.status;
    if (eff.status === 'all') {
      if (!st) return fail(`${who} has no condition to clear.`);
      targetInst.status = null;
      targetInst.sleepTurns = 0;
      return done(`${who} shakes off the ${statusLabel(st)} completely.`);
    }
    if (st !== eff.status) {
      return fail(`${who} is not suffering from ${statusLabel(eff.status)}.`);
    }
    targetInst.status = null;
    if (eff.status === 'slp') targetInst.sleepTurns = 0;
    return done(`${who} is free of the ${statusLabel(eff.status)}.`);
  }

  // ---- Healing ------------------------------------------------------------
  if (eff.kind === 'heal') {
    if (isFaintedInst(targetInst)) {
      return fail(`${who} has fainted — only a Revive can help now.`);
    }
    if (cur >= max) {
      return fail(`${who} is already at full health.`);
    }
    const amount = Math.max(0, Math.floor(Number(eff.amount) || 0));
    const healed = Math.min(amount, max - cur);
    targetInst.hp = Math.max(0, Math.min(max, cur + healed));
    let msg = `${who} recovers ${healed} HP.`;
    if (eff.cures === 'all') {
      if (targetInst.status) {
        msg = `${who} recovers ${healed} HP and shakes off the ${statusLabel(targetInst.status)}.`;
      }
      targetInst.status = null;
      targetInst.sleepTurns = 0;
    }
    return done(msg);
  }

  // ---- Tonics: permanent +IV, capped at 31 --------------------------------
  if (eff.kind === 'tonic') {
    if (isFaintedInst(targetInst)) {
      return fail(`${who} has fainted and cannot keep a tonic down.`);
    }
    if (!targetInst.ivs || typeof targetInst.ivs !== 'object') {
      targetInst.ivs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
    }
    const stat = TONIC_STATS[eff.stat] ? eff.stat : null;
    if (!stat) return fail('Nothing happens.');
    const curIv = Math.max(0, Math.min(IV_CAP, Math.floor(Number(targetInst.ivs[stat]) || 0)));
    if (curIv >= IV_CAP) {
      return fail(`${who} can grow no further that way.`);
    }
    const amount = Math.max(1, Math.floor(Number(eff.amount) || 0)) || 1;
    const nextIv = Math.min(IV_CAP, curIv + amount);
    if (stat === 'hp') {
      const before = max;
      targetInst.ivs.hp = nextIv;
      const after = Math.max(1, Math.floor(maxHp(targetInst)) || 1);
      // Keep the same amount of missing HP so the gain is felt immediately.
      targetInst.hp = Math.max(1, Math.min(after, cur + Math.max(0, after - before)));
      return done(`${who} drinks the ${it.name}. Max HP grew from ${before} to ${after} — for good!`);
    }
    targetInst.ivs[stat] = nextIv;
    return done(`${who} drinks the ${it.name}. Its ${TONIC_STATS[stat]} grew — for good!`);
  }

  // ---- Temporary stat boosts (battle only by design) ----------------------
  if (eff.kind === 'boost') {
    if (isFaintedInst(targetInst)) {
      return fail(`${who} has fainted and cannot be boosted.`);
    }
    return done(`${who} is fired up by the ${it.name}.`);
  }

  return fail('Nothing happens.');
}

// Shop stock grows with tier; each tier is a superset of the one before it,
// plus one specialty item per tier so towns feel different:
//   tier 2 -> superrepel, tier 3 -> cureall + revive + the first tonics,
//   tier 4 -> duskorb + every tonic. All five tonics must be buyable somewhere
//   or their IV grades in the summary are frozen decoration.
const SHOP_TIERS = [
  ['orb', 'potion', 'antidote'],
  ['orb', 'greatorb', 'potion', 'superpotion', 'antidote', 'burnsalve', 'wakebell', 'repel',
    'superrepel'],
  ['orb', 'greatorb', 'potion', 'superpotion', 'antidote', 'burnsalve', 'icemelt',
    'wakebell', 'sparkdrop', 'cureall', 'revive', 'repel', 'superrepel',
    'stonehide', 'quickstep'],
  ['orb', 'greatorb', 'ultraorb', 'duskorb', 'potion', 'superpotion', 'hyperpotion',
    'fullrestore', 'antidote', 'burnsalve', 'icemelt', 'wakebell', 'sparkdrop', 'cureall',
    'revive', 'fullrevive', 'repel', 'superrepel',
    'ironbrew', 'stonehide', 'quickstep', 'clearmind', 'stoutheart'],
];

/** @returns {string[]} item ids sold at this tier (1..4). */
export function shopStock(tier) {
  let t = Math.floor(Number(tier));
  if (!Number.isFinite(t)) t = 1;
  t = Math.max(1, Math.min(SHOP_TIERS.length, t));
  return SHOP_TIERS[t - 1].slice();
}

export function itemPrice(id) {
  return getItem(id).price | 0;
}

export function isSellable(id) {
  const it = getItem(id);
  // Tonics are a pure money sink: never resellable, so no buy/sell arbitrage.
  return it.kind !== 'key' && it.kind !== 'tonic' && it.price > 0;
}

/** Resale value: half the shop price, rounded down. */
export function sellPrice(id) {
  return isSellable(id) ? Math.floor(getItem(id).price / 2) : 0;
}
