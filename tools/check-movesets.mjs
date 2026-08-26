// Every creature the game generates must be able to fight. Enumerates every
// species at every level and asserts the generated moveset holds real offence.
import { allSpecies, getSpecies } from '../game/js/creatures.js';
import { getMove } from '../game/js/moves.js';
import { movesAtLevel } from '../game/js/party.js';

let fails = 0;
const worst = [];

for (const sp of allSpecies()) {
  for (let lv = 1; lv <= 60; lv++) {
    const set = movesAtLevel(sp.id, lv);
    const moves = set.map((m) => getMove(m.id));
    const damaging = moves.filter((m) => m.power > 0);
    const stab = damaging.filter((m) => sp.types.indexOf(m.type) !== -1);
    const bestPower = damaging.reduce((a, m) => Math.max(a, m.power), 0);

    if (!damaging.length) {
      fails++;
      console.log('  FAIL ' + sp.id + ' L' + lv + ' has NO damaging move: ' + set.map((m) => m.id).join(','));
      continue;
    }

    // Does the species KNOW a same-type attack by this level? If so it must hold one.
    const learnableStab = (sp.learnset || [])
      .filter((e) => e[0] <= lv)
      .map((e) => getMove(e[1]))
      .some((m) => m.power > 0 && sp.types.indexOf(m.type) !== -1);
    if (learnableStab && !stab.length) {
      fails++;
      console.log('  FAIL ' + sp.id + ' L' + lv + ' knows a same-type attack but holds none: ' + set.map((m) => m.id).join(','));
    }

    // Does it hold the strongest attack it could? Allow one tier of slack.
    const learnableBest = (sp.learnset || [])
      .filter((e) => e[0] <= lv)
      .map((e) => getMove(e[1]))
      .reduce((a, m) => Math.max(a, m.power || 0), 0);
    if (learnableBest >= 60 && bestPower < learnableBest * 0.6) {
      worst.push(sp.id + ' L' + lv + ': best held ' + bestPower + ' of available ' + learnableBest);
    }
  }
}

console.log('species x levels checked: ' + (allSpecies().length * 60));
if (worst.length) {
  console.log('\nweak-offence bands (held power well below available), first 10:');
  for (const w of worst.slice(0, 10)) console.log('  ' + w);
  console.log('  total: ' + worst.length);
}
console.log('\n' + (fails ? 'MOVESETS: ' + fails + ' FAILURES' : 'MOVESETS: every species can fight at every level'));
process.exit(fails ? 1 : 0);
