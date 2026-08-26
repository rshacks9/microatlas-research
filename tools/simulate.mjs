// Headless battle simulation for balance analysis. Pure logic, no DOM.
// Usage: node tools/simulate.mjs [trials]
import { SPECIES, allSpecies, getSpecies } from '../game/js/creatures.js';
import { getMove } from '../game/js/moves.js';
import { makeCreature, movesAtLevel } from '../game/js/party.js';
import { statsFor, maxHp, damage, accuracyCheck, speedOf, aiChooseMove,
         endOfTurnDamage, expGain, catchOdds, STRUGGLE } from '../game/js/battlecalc.js';
import { effectiveness, TYPES } from '../game/js/types.js';
import { mulberry32 } from '../game/js/rng.js';

const TRIALS = parseInt(process.argv[2] || '400', 10);

function comb(inst) {
  return { inst, stages:{atk:0,def:0,spa:0,spd:0,spe:0,acc:0,eva:0}, confused:0, flinched:false };
}

// One deterministic battle. Returns 'a' | 'b' | 'draw' and turn count.
function fight(a, b, rng) {
  const A = comb(a), B = comb(b);
  for (let turn = 0; turn < 300; turn++) {
    const ai = aiChooseMove(A, B, 1, { rng });
    const bi = aiChooseMove(B, A, 1, { rng });
    // aiChooseMove returns -1 when all PP is spent, which battle.js resolves as
    // STRUGGLE. Treating it as "no move" made both sides stand still forever and
    // produced phantom 300-turn stalls plus skewed win rates.
    const am = ai >= 0 ? getMove(A.inst.moves[ai].id) : STRUGGLE;
    const bm = bi >= 0 ? getMove(B.inst.moves[bi].id) : STRUGGLE;
    const apri = am ? am.priority : 0, bpri = bm ? bm.priority : 0;
    let aFirst;
    if (apri !== bpri) aFirst = apri > bpri;
    else { const as = speedOf(A), bs = speedOf(B); aFirst = as === bs ? rng() < 0.5 : as > bs; }

    const order = aFirst ? [[A,B,am,ai],[B,A,bm,bi]] : [[B,A,bm,bi],[A,B,am,ai]];
    for (const [atk, def, mv, idx] of order) {
      if (atk.inst.hp <= 0 || def.inst.hp <= 0) continue;
      if (!mv) continue;
      if (idx >= 0) atk.inst.moves[idx].pp--;
      if (!accuracyCheck(atk, def, mv, rng)) continue;
      if (mv.category === 'status') {
        const ef = mv.effect;
        if (ef && ef.kind === 'stat') {
          const t = ef.target === 'self' ? atk : def;
          t.stages[ef.stat] = Math.max(-6, Math.min(6, (t.stages[ef.stat]||0) + ef.stages));
        } else if (ef && ef.kind === 'status' && !def.inst.status) {
          def.inst.status = ef.status;
        } else if (ef && ef.kind === 'heal') {
          atk.inst.hp = Math.min(maxHp(atk.inst), atk.inst.hp + Math.floor(maxHp(atk.inst)*(ef.frac||0.5)));
        }
        continue;
      }
      const r = damage(atk, def, mv, { rng });
      def.inst.hp = Math.max(0, def.inst.hp - r.dmg);
      if (mv.effect && mv.effect.kind === 'recoil') {
        atk.inst.hp = Math.max(0, atk.inst.hp - Math.max(1, Math.floor(r.dmg*(mv.effect.frac||0.33))));
      }
      if (mv.effect && mv.effect.kind === 'drain') {
        atk.inst.hp = Math.min(maxHp(atk.inst), atk.inst.hp + Math.floor(r.dmg*(mv.effect.frac||0.5)));
      }
    }
    for (const c of [A, B]) {
      if (c.inst.hp <= 0) continue;
      c.inst.hp = Math.max(0, c.inst.hp - endOfTurnDamage(c.inst));
    }
    if (A.inst.hp <= 0 && B.inst.hp <= 0) return { w:'draw', turns:turn+1 };
    if (A.inst.hp <= 0) return { w:'b', turns:turn+1 };
    if (B.inst.hp <= 0) return { w:'a', turns:turn+1 };
  }
  return { w:'draw', turns:300 };
}

const species = allSpecies();
const LEVEL = 40;
const rng = mulberry32(0xC0FFEE);

// Pacing must be reported across the level range, not just at one level: the
// tuning target in battlecalc.js was measured at L40 and does not describe L20.
function pacingAt(level, reps) {
  const r2 = mulberry32(0xBEEF + level);
  let turns = 0, n = 0, oneShot = 0, stall = 0;
  const all = [];
  for (let i = 0; i < reps; i++) {
    const a = species[Math.floor(r2() * species.length)];
    const b = species[Math.floor(r2() * species.length)];
    if (a.id === b.id) continue;
    const ai = makeCreature(a.id, level, { rng: r2 });
    const bi = makeCreature(b.id, level, { rng: r2 });
    const res = fight(ai, bi, r2);
    turns += res.turns; n++; all.push(res.turns);
    if (res.turns <= 1) oneShot++;
    if (res.turns >= 300) stall++;
  }
  all.sort((x, y) => x - y);
  return {
    level, n,
    avg: (turns / Math.max(1, n)).toFixed(2),
    median: all[(all.length / 2) | 0] || 0,
    p95: all[Math.floor(all.length * 0.95)] || 0,
    oneShot: ((oneShot / Math.max(1, n)) * 100).toFixed(2) + '%',
    stalls: stall,
  };
}

// ---- 1. round-robin win rates at equal level -----------------------------
const wins = Object.create(null), games = Object.create(null);
for (const s of species) { wins[s.id]=0; games[s.id]=0; }

let totalTurns = 0, battles = 0, draws = 0, stalls = 0;
for (let t = 0; t < TRIALS; t++) {
  const a = species[Math.floor(rng()*species.length)];
  const b = species[Math.floor(rng()*species.length)];
  if (a.id === b.id) continue;
  const ai = makeCreature(a.id, LEVEL, { rng });
  const bi = makeCreature(b.id, LEVEL, { rng });
  const r = fight(ai, bi, rng);
  games[a.id]++; games[b.id]++;
  if (r.w === 'a') wins[a.id]++;
  else if (r.w === 'b') wins[b.id]++;
  else draws++;
  if (r.turns >= 300) stalls++;
  totalTurns += r.turns; battles++;
}

const rates = species
  .filter(s => games[s.id] >= 6)
  .map(s => ({ id: s.id, rate: wins[s.id]/games[s.id], n: games[s.id],
               bst: Object.values(s.base).reduce((x,y)=>x+y,0), rarity: s.rarity }))
  .sort((a,b)=>b.rate-a.rate);

console.log('=== BALANCE REPORT ===');
console.log('battles:', battles, ' avg turns:', (totalTurns/Math.max(1,battles)).toFixed(1),
            ' draws:', draws, ' stalls(300t):', stalls);
console.log('\n-- strongest 6 --');
for (const r of rates.slice(0,6)) console.log('  ', r.id.padEnd(13), (r.rate*100).toFixed(0)+'%', 'BST', r.bst, r.rarity);
console.log('-- weakest 6 --');
for (const r of rates.slice(-6)) console.log('  ', r.id.padEnd(13), (r.rate*100).toFixed(0)+'%', 'BST', r.bst, r.rarity);

const dominant = rates.filter(r => r.rate > 0.82 && r.rarity !== 'legendary');
const hopeless = rates.filter(r => r.rate < 0.18 && r.rarity !== 'starter');
console.log('\nDOMINANT (>82% win, non-legendary):', dominant.map(r=>r.id+' '+(r.rate*100).toFixed(0)+'%').join(', ')||'none');
console.log('HOPELESS (<18% win):', hopeless.map(r=>r.id+' '+(r.rate*100).toFixed(0)+'%').join(', ')||'none');

// ---- 2. type coverage ----------------------------------------------------
console.log('\n=== PACING ACROSS LEVELS ===');
console.log('lvl    n   avg  median  p95   one-shot  stalls');
for (const lv of [5, 10, 20, 30, 40, 60, 100]) {
  const p = pacingAt(lv, 700);
  console.log(String(p.level).padStart(3) + String(p.n).padStart(6) + String(p.avg).padStart(7) +
              String(p.median).padStart(8) + String(p.p95).padStart(6) +
              String(p.oneShot).padStart(10) + String(p.stalls).padStart(8));
}

console.log('\n=== TYPE COVERAGE ===');
const bad = [];
for (const t of TYPES) {
  const off = TYPES.filter(d => effectiveness(t, [d]) > 1).length;
  const def = TYPES.filter(a => effectiveness(a, [t]) < 1).length;
  const weak = TYPES.filter(a => effectiveness(a, [t]) > 1).length;
  if (off === 0) bad.push(t + ' hits nothing super-effectively');
  if (weak === 0) bad.push(t + ' has no weaknesses');
  console.log('  ', t.padEnd(6), 'se-vs:'+String(off).padStart(2), 'resists:'+String(def).padStart(2), 'weak-to:'+String(weak).padStart(2));
}
console.log(bad.length ? 'TYPE ISSUES: '+bad.join('; ') : 'type chart is balanced enough');

// ---- 3. early game: can a level-5 starter beat level 2-4 wilds? ----------
console.log('\n=== EARLY GAME ===');
const STARTERS = ['sproutle','cindercub','driblet'];
for (const s of STARTERS) {
  let w=0,n=0;
  for (let i=0;i<120;i++){
    const foe = species.filter(x=>x.rarity==='common' && x.biomes.length);
    const f = foe[Math.floor(rng()*foe.length)];
    const a = makeCreature(s,5,{rng}), b = makeCreature(f.id, 3+Math.floor(rng()*2), {rng});
    if (fight(a,b,rng).w==='a') w++;
    n++;
  }
  console.log('  ', s.padEnd(11), 'wins', (w/n*100).toFixed(0)+'% vs L3-4 commons', w/n<0.6?'  <-- TOO HARD':'');
}

// ---- 4. move usability ---------------------------------------------------
console.log('\n=== MOVE REACHABILITY ===');
const used = new Set();
for (const s of species) for (const [,id] of s.learnset||[]) used.add(id);
const { MOVES } = await import('../game/js/moves.js');
const orphan = Object.keys(MOVES).filter(id => !used.has(id));
console.log('  moves defined:', Object.keys(MOVES).length, ' reachable via learnsets:', used.size);
console.log('  ORPHANED (no species learns them):', orphan.length ? orphan.join(', ') : 'none');

// ---- 5. catch rates ------------------------------------------------------
console.log('\n=== CATCH ODDS (at 25% HP, no status, basic orb) ===');
for (const rarity of ['common','uncommon','rare','legendary']) {
  const list = species.filter(s=>s.rarity===rarity);
  if (!list.length) continue;
  let sum=0;
  for (const s of list){
    const c = makeCreature(s.id, 25, { rng });
    c.hp = Math.max(1, Math.floor(maxHp(c)*0.25));
    sum += catchOdds(c, 1, null);
  }
  console.log('  ', rarity.padEnd(11), (sum/list.length*100).toFixed(1)+'% per throw');
}
