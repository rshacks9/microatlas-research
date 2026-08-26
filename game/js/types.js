// Original 13-type system. No DOM. Node-importable.

export const TYPES = ['PLAIN','EMBER','TIDE','BLOOM','SPARK','FROST','BRAWL','TOXIN','TERRA','GALE','PSION','UMBRA','ALLOY'];

export const TYPE_NAMES = {
  PLAIN:'Plain', EMBER:'Ember', TIDE:'Tide', BLOOM:'Bloom', SPARK:'Spark', FROST:'Frost',
  BRAWL:'Brawl', TOXIN:'Toxin', TERRA:'Terra', GALE:'Gale', PSION:'Psion', UMBRA:'Umbra', ALLOY:'Alloy',
};

export const TYPE_COLORS = {
  PLAIN:'#a8a090', EMBER:'#e8603c', TIDE:'#4880d8', BLOOM:'#58b048', SPARK:'#e8c030',
  FROST:'#78d0d8', BRAWL:'#c03028', TOXIN:'#a040a0', TERRA:'#c8a038', GALE:'#88a8e8',
  PSION:'#f05888', UMBRA:'#5a4868', ALLOY:'#98a8b8',
};

// Anything not listed is 1x. Values: 0 (immune), 0.5 (resist), 2 (weak).
const CHART = {
  PLAIN: { ALLOY:0.5, UMBRA:0.5 },
  EMBER: { BLOOM:2, FROST:2, ALLOY:2, EMBER:0.5, TIDE:0.5, TERRA:0.5 },
  TIDE:  { EMBER:2, TERRA:2, TIDE:0.5, BLOOM:0.5 },
  BLOOM: { TIDE:2, TERRA:2, EMBER:0.5, BLOOM:0.5, TOXIN:0.5, GALE:0.5, ALLOY:0.5 },
  SPARK: { TIDE:2, GALE:2, BLOOM:0.5, SPARK:0.5, TERRA:0 },
  FROST: { BLOOM:2, TERRA:2, GALE:2, EMBER:0.5, TIDE:0.5, FROST:0.5, ALLOY:0.5 },
  BRAWL: { PLAIN:2, FROST:2, UMBRA:2, ALLOY:2, TOXIN:0.5, GALE:0.5, PSION:0.5 },
  TOXIN: { BLOOM:2, TOXIN:0.5, TERRA:0.5, ALLOY:0 },
  TERRA: { EMBER:2, SPARK:2, TOXIN:2, ALLOY:2, BLOOM:0.5, GALE:0 },
  GALE:  { BLOOM:2, BRAWL:2, SPARK:0.5, TERRA:0.5, ALLOY:0.5 },
  PSION: { BRAWL:2, TOXIN:2, PSION:0.5, UMBRA:0.5, ALLOY:0.5 },
  UMBRA: { PSION:2, BRAWL:0.5, UMBRA:0.5, ALLOY:0.5 },
  ALLOY: { FROST:2, TERRA:2, EMBER:0.5, TIDE:0.5, SPARK:0.5, ALLOY:0.5 },
};

export function effectiveness(atkType, defTypes) {
  const row = CHART[atkType];
  if (!row) return 1;
  const list = Array.isArray(defTypes) ? defTypes : [defTypes];
  let mult = 1;
  for (const d of list) {
    const v = row[d];
    mult *= (v === undefined ? 1 : v);
  }
  return mult;
}

export function matchupText(mult) {
  if (mult === 0) return 'It had no effect...';
  if (mult >= 4) return "It's devastatingly effective!";
  if (mult > 1) return "It's super effective!";
  if (mult <= 0.25) return 'It barely registered...';
  if (mult < 1) return "It's not very effective...";
  return '';
}

export function isType(t) { return TYPES.indexOf(t) !== -1; }
