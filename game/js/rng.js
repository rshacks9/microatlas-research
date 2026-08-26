// Seeded deterministic randomness. No DOM. Node-importable.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(seed, x, y) {
  let h = (seed ^ 0x9E3779B9) >>> 0;
  h = Math.imul(h ^ (x | 0), 0x85EBCA6B) >>> 0;
  h = Math.imul(h ^ (y | 0), 0xC2B2AE35) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 0x27D4EB2D) >>> 0; h ^= h >>> 16;
  return h >>> 0;
}

function hashFloat(seed, x, y) { return hash2(seed, x, y) / 4294967296; }

export function makeRng(seed) {
  const next = mulberry32(seed);
  const api = {
    next,
    float: () => next(),
    int: (n) => Math.floor(next() * n),
    range: (a, b) => a + Math.floor(next() * (b - a + 1)),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    shuffle: (arr) => {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const t = out[i]; out[i] = out[j]; out[j] = t;
      }
      return out;
    },
    weighted: (entries, weightKey = 'weight') => {
      let total = 0;
      for (const e of entries) total += (e[weightKey] || 0);
      if (total <= 0) return entries[0] || null;
      let r = next() * total;
      for (const e of entries) { r -= (e[weightKey] || 0); if (r <= 0) return e; }
      return entries[entries.length - 1];
    },
  };
  return api;
}

const smooth = (t) => t * t * (3 - 2 * t);

export function valueNoise2(seed, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = smooth(x - x0), fy = smooth(y - y0);
  const a = hashFloat(seed, x0, y0);
  const b = hashFloat(seed, x0 + 1, y0);
  const c = hashFloat(seed, x0, y0 + 1);
  const d = hashFloat(seed, x0 + 1, y0 + 1);
  const top = a + (b - a) * fx;
  const bot = c + (d - c) * fx;
  return top + (bot - top) * fy;
}

export function fbm(seed, x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2(seed + i * 1013, x * freq, y * freq);
    norm += amp;
    amp *= gain; freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

// Ridged noise, good for mountain spines.
export function ridge(seed, x, y, octaves = 4) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(valueNoise2(seed + i * 7717, x * freq, y * freq) * 2 - 1);
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5; freq *= 2;
  }
  return norm > 0 ? sum / norm : 0;
}

// Unseeded convenience RNG for VFX and battle rolls.
export const rand = {
  float: () => Math.random(),
  int: (n) => Math.floor(Math.random() * n),
  range: (a, b) => a + Math.floor(Math.random() * (b - a + 1)),
  chance: (p) => Math.random() < p,
  pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
};
