// Static checks over the module graph: import cycles, missing files, unresolved
// named imports, and DOM access at import time in modules that must stay Node-safe.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';

const DIR = 'game/js';
const files = readdirSync(DIR).filter((f) => f.endsWith('.js'));

// Modules that must be importable in Node (no DOM at module top level).
const NODE_SAFE = new Set([
  'rng.js', 'types.js', 'tiles.js', 'state.js', 'creatures.js', 'moves.js',
  'items.js', 'battlecalc.js', 'party.js', 'worldgen.js', 'towns.js', 'font.js',
]);

const IMPORT_RE = /^\s*import\s+(?:([\s\S]*?)\s+from\s+)?['"]([^'"]+)['"]/gm;
const DYN_RE = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
const EXPORT_FN = /^\s*export\s+(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/gm;
// `export const A = 1, B = 2;` declares BOTH names — capture the whole declarator list.
const EXPORT_VAR = /^\s*export\s+(?:const|let|var)\s+([^;\n]+)/gm;
const EXPORT_LIST = /^\s*export\s*\{([^}]*)\}/gm;

const mods = new Map();
for (const f of files) {
  const src = readFileSync(join(DIR, f), 'utf8');
  const statics = [];
  const dynamics = [];
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(src))) statics.push({ clause: m[1] || '', spec: m[2] });
  DYN_RE.lastIndex = 0;
  while ((m = DYN_RE.exec(src))) dynamics.push(m[1]);

  const exports = new Set();
  EXPORT_FN.lastIndex = 0;
  while ((m = EXPORT_FN.exec(src))) exports.add(m[1]);
  EXPORT_VAR.lastIndex = 0;
  while ((m = EXPORT_VAR.exec(src))) {
    // split on top-level commas of the declarator list
    let depth = 0, cur = '';
    const decls = [];
    for (const ch of m[1]) {
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth--;
      if (ch === ',' && depth === 0) { decls.push(cur); cur = ''; } else cur += ch;
    }
    decls.push(cur);
    for (const dcl of decls) {
      const name = dcl.trim().split('=')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) exports.add(name);
    }
  }
  EXPORT_LIST.lastIndex = 0;
  while ((m = EXPORT_LIST.exec(src))) {
    for (const part of m[1].split(',')) {
      const bits = part.trim().split(/\s+as\s+/);
      const name = (bits[1] || bits[0] || '').trim();
      if (name) exports.add(name);
    }
  }
  if (/^\s*export\s+default/m.test(src)) exports.add('default');
  if (/^\s*export\s+\*/m.test(src)) exports.add('*');

  mods.set(f, { src, statics, dynamics, exports });
}

const problems = [];

// ---- 1. resolve every import ----
for (const [f, mod] of mods) {
  for (const im of [...mod.statics.map((s) => s.spec), ...mod.dynamics]) {
    if (!im.startsWith('.')) { problems.push(`${f}: non-relative import "${im}" (no bundler here)`); continue; }
    const target = basename(im);
    if (!mods.has(target)) problems.push(`${f}: imports "${im}" which does not exist`);
  }
}

// ---- 2. named imports must actually be exported ----
for (const [f, mod] of mods) {
  for (const { clause, spec } of mod.statics) {
    const target = basename(spec);
    const t = mods.get(target);
    if (!t || t.exports.has('*')) continue;
    const braced = clause.match(/\{([^}]*)\}/);
    if (!braced) continue;
    for (const part of braced[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (!name) continue;
      if (!t.exports.has(name)) {
        problems.push(`${f}: imports { ${name} } from ${target}, which does not export it`);
      }
    }
  }
}

// ---- 3. static import cycles ----
const graph = new Map();
for (const [f, mod] of mods) graph.set(f, mod.statics.map((s) => basename(s.spec)).filter((x) => mods.has(x)));

const WHITE = 0, GREY = 1, BLACK = 2;
const color = new Map(files.map((f) => [f, WHITE]));
const stack = [];
const cycles = [];
function dfs(n) {
  color.set(n, GREY);
  stack.push(n);
  for (const next of graph.get(n) || []) {
    if (color.get(next) === GREY) {
      const i = stack.indexOf(next);
      cycles.push(stack.slice(i).concat(next).join(' -> '));
    } else if (color.get(next) === WHITE) dfs(next);
  }
  stack.pop();
  color.set(n, BLACK);
}
for (const f of files) if (color.get(f) === WHITE) dfs(f);

const uniqueCycles = [...new Set(cycles.map((c) => {
  const parts = c.split(' -> ');
  parts.pop();
  const min = parts.indexOf([...parts].sort()[0]);
  return parts.slice(min).concat(parts.slice(0, min)).join(' -> ');
}))];

// ---- 4. top-level DOM access in Node-safe modules ----
const DOM_TOKENS = /\b(document|window|localStorage|navigator|AudioContext|requestAnimationFrame)\b/;
for (const f of NODE_SAFE) {
  const mod = mods.get(f);
  if (!mod) { problems.push(`node-safe module ${f} is missing`); continue; }
  const lines = mod.src.split('\n');
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Strip comments and string literals so a token inside text is not a false positive.
    const code = line
      .replace(/\/\/.*$/, '')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''")
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/`(?:[^`\\]|\\.)*`/g, '``');
    if (depth === 0 && DOM_TOKENS.test(code) && !/typeof\s/.test(code)) {
      problems.push(`${f}:${i + 1}: top-level DOM access -> ${code.trim().slice(0, 70)}`);
    }
    for (const ch of code) { if (ch === '{' || ch === '(') depth++; else if (ch === '}' || ch === ')') depth--; }
    if (depth < 0) depth = 0;
  }
}

// ---- report ----
console.log('modules:', files.length);
if (uniqueCycles.length) {
  console.log('\nIMPORT CYCLES (' + uniqueCycles.length + '):');
  for (const c of uniqueCycles) console.log('  ' + c);
} else {
  console.log('import cycles: none');
}
if (problems.length) {
  console.log('\nPROBLEMS (' + problems.length + '):');
  for (const p of problems) console.log('  ' + p);
} else {
  console.log('resolution + node-safety: clean');
}
process.exit(problems.length || uniqueCycles.length ? 1 : 0);
