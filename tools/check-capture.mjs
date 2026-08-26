// Catching must actually keep the creature. This exists because it once did not:
// the ball was spent, "Gotcha!" printed, and the creature evaporated.
import { S, resetState, addItem } from '../game/js/state.js';
import { makeCreature, addToParty, displayName } from '../game/js/party.js';
import { catchChance, catchOdds, maxHp } from '../game/js/battlecalc.js';
import { getItem } from '../game/js/items.js';
import { allSpecies } from '../game/js/creatures.js';
import { mulberry32 } from '../game/js/rng.js';

let fails = 0;
const t = (name, fn) => {
  try {
    const r = fn();
    if (r === true) return;
    fails++; console.log('  FAIL ' + name + ' -> ' + r);
  } catch (e) { fails++; console.log('  THREW ' + name + ' -> ' + e.message); }
};

resetState(1234, 'Tester');

t('a caught creature lands in the party', () => {
  const before = S.party.length;
  const c = makeCreature('mottlemouse', 8, {});
  const dest = addToParty(c);
  return dest === 'party' && S.party.length === before + 1 && S.party[S.party.length - 1] === c;
});

t('catching marks the dex', () => {
  const c = makeCreature('flitterwing', 6, {});
  addToParty(c);
  return S.dex.caught.flitterwing === true && S.dex.seen.flitterwing === true;
});

t('a full party overflows to storage, not the void', () => {
  resetState(99, 'Tester');
  for (let i = 0; i < 6; i++) addToParty(makeCreature('mottlemouse', 5, {}));
  const boxBefore = S.boxes.length;
  const dest = addToParty(makeCreature('zapkit', 5, {}));
  return dest === 'box' && S.boxes.length === boxBefore + 1 && S.party.length === 6;
});

t('a full party AND full storage reports full rather than silently dropping', () => {
  resetState(7, 'Tester');
  for (let i = 0; i < 6; i++) addToParty(makeCreature('mottlemouse', 5, {}));
  for (let i = 0; i < 60; i++) addToParty(makeCreature('zapkit', 5, {}));
  return addToParty(makeCreature('pebblit', 5, {})) === 'full';
});

// Catch rates must be sane: possible for commons, hard for legendaries, and
// weakening the target must always help.
console.log('=== CATCH ODDS (per throw) ===');
console.log('rarity       full HP    25% HP    25% HP + sleep   ultra orb @25%');
for (const rarity of ['common', 'uncommon', 'rare', 'legendary']) {
  const list = allSpecies().filter((s) => s.rarity === rarity);
  if (!list.length) continue;
  const avg = (fn) => list.reduce((a, s) => a + fn(s), 0) / list.length;
  const mk = (s, frac, status) => {
    const c = makeCreature(s.id, 25, {});
    c.hp = Math.max(1, Math.floor(maxHp(c) * frac));
    c.status = status;
    return c;
  };
  const full = avg((s) => catchOdds(mk(s, 1, null), 1, null));
  const low = avg((s) => catchOdds(mk(s, 0.25, null), 1, null));
  const slp = avg((s) => catchOdds(mk(s, 0.25, 'slp'), 1, 'slp'));
  const ultra = avg((s) => catchOdds(mk(s, 0.25, null), 2, null));
  console.log('  ' + rarity.padEnd(11) +
    (full * 100).toFixed(1).padStart(6) + '%' +
    (low * 100).toFixed(1).padStart(9) + '%' +
    (slp * 100).toFixed(1).padStart(15) + '%' +
    (ultra * 100).toFixed(1).padStart(15) + '%');
  if (low <= full) { fails++; console.log('    FAIL weakening a ' + rarity + ' does not improve capture'); }
  if (slp <= low) { fails++; console.log('    FAIL sleeping a ' + rarity + ' does not improve capture'); }
  if (ultra <= low) { fails++; console.log('    FAIL a better ball does not improve capture for ' + rarity); }
  if (rarity === 'common' && low < 0.35) { fails++; console.log('    FAIL commons are too hard to catch'); }
  if (rarity === 'legendary' && slp > 0.35) { fails++; console.log('    FAIL legendaries are too easy'); }
}

t('a failed store does NOT mark the dex as caught', () => {
  resetState(4242, 'Tester');
  for (let i = 0; i < 6; i++) addToParty(makeCreature('mottlemouse', 5, {}));
  for (let i = 0; i < 60; i++) addToParty(makeCreature('zapkit', 5, {}));
  const before = Object.keys(S.dex.caught).length;
  const dest = addToParty(makeCreature('aurorix', 40, {}));
  return dest === 'full'
      && S.dex.caught.aurorix === undefined
      && S.dex.seen.aurorix === true
      && Object.keys(S.dex.caught).length === before;
});

t('a variant is only recorded when it is actually kept', () => {
  resetState(99, 'Tester');
  for (let i = 0; i < 6; i++) addToParty(makeCreature('mottlemouse', 5, {}));
  for (let i = 0; i < 60; i++) addToParty(makeCreature('zapkit', 5, {}));
  addToParty(makeCreature('rimewolf', 30, { variant: true }));
  return !(S.dex.variant && S.dex.variant.rimewolf);
});

// The shake animation must agree with the outcome.
t('four shakes always means caught, fewer never does', () => {
  const rng = mulberry32(42);
  for (let i = 0; i < 4000; i++) {
    const c = makeCreature('mottlemouse', 10, {});
    c.hp = Math.max(1, Math.floor(maxHp(c) * (0.05 + rng() * 0.9)));
    const r = catchChance(c, 1 + rng() * 2, null, { rng });
    if (r.caught !== (r.shakes >= 4)) return 'shakes ' + r.shakes + ' but caught=' + r.caught;
  }
  return true;
});

// The dex counter promises n/34, so that promise must be keepable.
{
  const { encounterTableFor, BIOMES, generateWorld } = await import('../game/js/worldgen.js');
  const { STARTERS, getSpecies } = await import('../game/js/creatures.js');
  const obtainable = new Set();
  for (const b of BIOMES) for (const e of (encounterTableFor(b) || [])) obtainable.add(e.species);
  // Legendaries left the encounter lottery for fixed shrines. Count them
  // obtainable only if a generated world actually places their shrine —
  // an outcome check, not a rarity whitelist. (check-huntable asserts this
  // across seeds; here one world guards the completability claim.)
  for (const sh of (generateWorld(60601).shrines || [])) obtainable.add(sh.species);
  for (let pass = 0; pass < 4; pass++) {
    for (const sp of allSpecies()) if (obtainable.has(sp.id) && sp.evolve) obtainable.add(sp.evolve.into);
  }
  // Every starter line is reachable: one by choosing it, the other two as Seal
  // milestones at the third and sixth Warden (overworld.grantStarterMilestone),
  // which retries rather than burning the grant if storage was full.
  for (const st of STARTERS) {
    obtainable.add(st);
    const sp = getSpecies(st);
    if (sp.evolve) obtainable.add(sp.evolve.into);
  }
  const missing = allSpecies().filter((sp) => !obtainable.has(sp.id)).map((sp) => sp.id);
  console.log('\n=== DEX COMPLETABILITY ===');
  console.log('  obtainable: ' + obtainable.size + ' / ' + allSpecies().length);
  if (missing.length) {
    fails++;
    console.log('  FAIL unobtainable, so the dex can never be completed: ' + missing.join(', '));
  } else {
    console.log('  every species is obtainable in a single playthrough');
  }
}

console.log('\n' + (fails ? 'CAPTURE: ' + fails + ' FAILURES' : 'CAPTURE: catching keeps the creature and the odds behave'));
process.exit(fails ? 1 : 0);
