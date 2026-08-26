// The Entity wrapper and the liveness filters, checked as OUTCOMES.
// This checker exists because the wrapper's field whitelist silently dropped
// spec.warden / spec.seal / spec.challenge / shrine species+level — so Seals
// never incremented and every Warden spoke a fallback line — while every
// spec-level checker stayed green. Specs are not what the game plays with;
// wrapped entities are, so this asserts on the wrapped side.
// Run: node tools/check-entities.mjs
import { generateWorld } from '../game/js/worldgen.js';
import { GameMap } from '../game/js/tilemap.js';
import { makeEntities } from '../game/js/entities.js';
import { setFlag, S } from '../game/js/state.js';
import { getSpecies } from '../game/js/creatures.js';

let fails = 0;
const fail = (m) => { fails++; console.log('  FAIL ' + m); };

const w = generateWorld(60601);
const ents = makeEntities(w.map.entities);

// --- identity fields must survive wrapping --------------------------------
const wardens = ents.filter((e) => e.warden);
console.log('=== WRAPPED ENTITY FIELDS ===');
console.log('  wardens: ' + wardens.length);
if (wardens.length !== 10) fail('expected 10 wardens on the world map, got ' + wardens.length);
for (const e of wardens) {
  if (typeof e.seal !== 'string' || !e.seal) fail('warden "' + e.name + '" lost its seal in wrapping');
  if (typeof e.challenge !== 'string' || !e.challenge) fail('warden "' + e.name + '" lost its challenge line');
  if (!Array.isArray(e.team) || !e.team.length) fail('warden "' + e.name + '" lost its team');
  if (!e.flag) fail('warden "' + e.name + '" has no flag — Seal could be re-earned forever');
}

const shrines = ents.filter((e) => e.kind === 'shrine');
console.log('  shrines: ' + shrines.length);
if (shrines.length !== 3) fail('expected 3 shrines, got ' + shrines.length);
for (const e of shrines) {
  if (getSpecies(e.species).id !== e.species) fail('shrine lost/garbled species: ' + e.species);
  if (!(e.level >= 40)) fail('shrine ' + e.species + ' lost its level (' + e.level + ')');
}

const trainers = ents.filter((e) => e.kind === 'trainer' && !e.warden);
let withChallenge = 0;
for (const e of trainers) if (typeof e.challenge === 'string' && e.challenge) withChallenge++;
console.log('  trainers: ' + trainers.length + ' (' + withChallenge + ' carry a challenge line)');
if (trainers.length && withChallenge === 0) fail('no trainer kept its challenge line through wrapping');

// --- liveness: beaten trainers and stilled shrines REMAIN ------------------
console.log('\n=== LIVENESS FILTERS ===');
const map = new GameMap({ ...w.map, entities: ents });
if (map.reindex) map.reindex();

const wd = wardens[0];
if (map.entityAt(wd.x, wd.y) !== wd) fail('warden not returned by entityAt before defeat');
setFlag(wd.flag, true);
if (map.entityAt(wd.x, wd.y) !== wd) {
  fail('beaten warden vanished from entityAt — after-lines and blocking are gone');
}
if (!map.entityList().includes(wd)) {
  fail('beaten warden dropped from entityList — disappears on map re-entry');
}
if (wd.hidden) fail('beaten warden reports hidden=true — would not render');

const sh = shrines[0];
setFlag('shrine_' + sh.species, true);
sh.flag = 'shrine_' + sh.species;
if (map.entityAt(sh.x, sh.y) !== sh) fail('stilled shrine vanished from entityAt');

// One-shot pickups DO vanish once flagged.
const item = ents.find((e) => e.kind === 'item' && e.flag);
if (item) {
  setFlag(item.flag, true);
  if (map.entityAt(item.x, item.y) === item) fail('collected pickup still returned by entityAt');
  if (item.hidden !== true) fail('collected pickup not hidden');
}

// --- the Verdant Trial gauntlet must be fightable ---------------------------
console.log('\n=== TRIAL KEEPERS ===');
{
  const { TRIAL_KEEPERS } = await import('../game/js/overworld.js');
  if (!Array.isArray(TRIAL_KEEPERS) || TRIAL_KEEPERS.length !== 3) {
    fail('expected 3 Trial Keepers, got ' + (TRIAL_KEEPERS && TRIAL_KEEPERS.length));
  }
  for (const k of TRIAL_KEEPERS || []) {
    if (!k.team || !k.team.length) { fail(k.name + ' has no team'); continue; }
    for (const m of k.team) {
      const sp = getSpecies(m.species);
      if (sp.id !== m.species) fail(k.name + ' fields unknown species "' + m.species + '"');
      if (sp.rarity === 'legendary') fail(k.name + ' fields a legendary — the player hunts those');
      if (!(m.level >= 50 && m.level <= 64)) fail(k.name + ': ' + m.species + ' level ' + m.level + ' outside the endgame band');
    }
  }
  console.log('  keepers: ' + TRIAL_KEEPERS.length + ', team members: ' +
    TRIAL_KEEPERS.reduce((n, k) => n + k.team.length, 0));
}

// Leave no test flags behind for any later in-process import of state.
S.flags = {};

console.log('\n' + (fails ? 'ENTITIES: ' + fails + ' FAILURES'
                          : 'ENTITIES: identity survives wrapping; the beaten remain, the spent vanish'));
process.exit(fails ? 1 : 0);
