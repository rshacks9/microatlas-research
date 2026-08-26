// Bundle the game into ONE self-contained HTML fragment suitable for publishing
// as a claude.ai Artifact (which serves exactly one page, wrapped in its own
// doctype/head/body skeleton — so this file emits page CONTENT only: title,
// style, markup, and a single inline module script).
//
// The 25 ES modules are topologically sorted and each is wrapped in an IIFE that
// registers its exports in a module map:
//   __m['rng.js'] = (function () { 'use strict'; ...; return { mulberry32, ... }; })();
// Static imports become destructuring consts from the map; dynamic import('./x.js')
// becomes Promise.resolve(__m['x.js']). IIFE scoping means top-level names in
// different modules can never collide.
//
// Known limitation, asserted below: snapshot destructuring breaks ESM live
// bindings, so `export let` would silently freeze — this codebase has none, and
// the build fails loudly if one appears.
//
// Usage: node tools/build-artifact.mjs [outFile]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const JS_DIR = 'game/js';
const OUT = process.argv[2] || 'verdant-frontier.html';
const ENTRY = 'main.js';

// ---------------------------------------------------------------- load
const sources = new Map();
for (const f of readdirSync(JS_DIR).filter((f) => f.endsWith('.js'))) {
  sources.set(f, readFileSync(join(JS_DIR, f), 'utf8'));
}

// ---------------------------------------------------------------- parse
const IMPORT_RE = /^import\s+([\s\S]*?)\s+from\s+['"]\.\/([\w.-]+)['"]\s*;/gm;
const IMPORT_BARE_RE = /^import\s+['"]\.\/([\w.-]+)['"]\s*;/gm;
const DYN_RE = /import\(\s*['"]\.\/([\w.-]+)['"]\s*\)/g;

function parseModule(name, src) {
  const deps = [];
  const importConsts = [];

  // static imports -> consts reading from the registry (hoisted to IIFE top,
  // which matches ESM hoisting semantics for the one bottom-of-file import).
  let code = src.replace(IMPORT_RE, (m, clause, dep) => {
    deps.push(dep);
    clause = clause.trim();
    if (clause.startsWith('{')) {
      const inner = clause.slice(1, clause.lastIndexOf('}'));
      const parts = inner.split(',').map((p) => p.trim()).filter(Boolean).map((p) => {
        const mm = p.split(/\s+as\s+/);
        return mm.length === 2 ? `${mm[0]}: ${mm[1]}` : mm[0];
      });
      importConsts.push(`const { ${parts.join(', ')} } = __m['${dep}'];`);
    } else if (/^\*\s+as\s+/.test(clause)) {
      const ns = clause.replace(/^\*\s+as\s+/, '').trim();
      importConsts.push(`const ${ns} = __m['${dep}'];`);
    } else {
      throw new Error(`${name}: unsupported import clause: ${clause.slice(0, 60)}`);
    }
    return '';
  });
  code = code.replace(IMPORT_BARE_RE, (m, dep) => { deps.push(dep); return ''; });

  // dynamic imports -> resolved registry lookups
  code = code.replace(DYN_RE, (m, dep) => {
    deps.push(dep);                        // ensure the dep is ordered before us
    return `Promise.resolve(__m['${dep}'])`;
  });

  // exports -> plain declarations + a recorded {exported: local} map
  const exports = [];                      // [exportedName, localName]

  if (/^export\s+(let|var)\s/m.test(code)) {
    throw new Error(`${name}: 'export let/var' would lose live bindings under this bundler`);
  }

  code = code.replace(/^export\s+(async\s+function|function|class)\s+([A-Za-z_$][\w$]*)/gm,
    (m, kw, id) => { exports.push([id, id]); return `${kw} ${id}`; });

  code = code.replace(/^export\s+const\s+([^\n]*)/gm, (m, rest) => {
    // Declarator names from the same-line fragment: split on top-level commas.
    let depth = 0, cur = '';
    const decls = [];
    for (const ch of rest) {
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth--;
      if (ch === ',' && depth === 0) { decls.push(cur); cur = ''; } else cur += ch;
    }
    decls.push(cur);
    for (const d of decls) {
      const id = d.trim().split('=')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(id)) exports.push([id, id]);
    }
    return `const ${rest}`;
  });

  code = code.replace(/^export\s*\{([^}]*)\}\s*;?/gm, (m, inner) => {
    for (const p of inner.split(',').map((x) => x.trim()).filter(Boolean)) {
      const mm = p.split(/\s+as\s+/);
      exports.push(mm.length === 2 ? [mm[1], mm[0]] : [mm[0], mm[0]]);
    }
    return '';
  });

  code = code.replace(/^export\s+default\s+([^\n]*);\s*$/gm, (m, expr) => {
    exports.push(['default', '__default_export']);
    return `const __default_export = ${expr};`;
  });
  if (/^export\s/m.test(code)) {
    const line = code.split('\n').find((l) => /^export\s/.test(l));
    throw new Error(`${name}: unhandled export form: ${line}`);
  }

  const seen = new Set();
  const retParts = exports.filter(([e]) => (seen.has(e) ? false : seen.add(e)))
    .map(([e, l]) => (e === l ? e : `'${e}': ${l}`));

  return { name, deps: [...new Set(deps)], importConsts, code, ret: retParts };
}

const mods = new Map();
for (const [name, src] of sources) mods.set(name, parseModule(name, src));

// ---------------------------------------------------------------- topo sort
const order = [];
const state = new Map();                   // 0 unseen, 1 visiting, 2 done
function visit(name, chain) {
  if (state.get(name) === 2) return;
  if (state.get(name) === 1) throw new Error('cycle: ' + [...chain, name].join(' -> '));
  state.set(name, 1);
  const mod = mods.get(name);
  if (!mod) throw new Error('missing module: ' + name);
  for (const d of mod.deps) visit(d, [...chain, name]);
  state.set(name, 2);
  order.push(name);
}
visit(ENTRY, []);

// ---------------------------------------------------------------- emit js
const parts = ["const __m = Object.create(null);"];
for (const name of order) {
  const m = mods.get(name);
  parts.push(
    `\n// ==== ${name} ${'='.repeat(Math.max(1, 60 - name.length))}\n` +
    `__m['${name}'] = (function () {\n'use strict';\n` +
    m.importConsts.join('\n') + (m.importConsts.length ? '\n' : '') +
    m.code +
    `\nreturn { ${m.ret.join(', ')} };\n})();`
  );
}
const bundleJs = parts.join('\n');

// ---------------------------------------------------------------- emit html
const css = readFileSync('game/css/game.css', 'utf8');
const indexHtml = readFileSync('game/index.html', 'utf8');
const bodyMatch = /<body>([\s\S]*?)<script type="module"/.exec(indexHtml);
if (!bodyMatch) throw new Error('could not extract body markup from game/index.html');
const markup = bodyMatch[1].trim();

const html = `<title>Verdant Frontier</title>
<style>
${css}
/* Artifact host: the page is embedded rather than owning the window, so pin the
   shell to the viewport explicitly instead of relying on body height. */
#shell { min-height: 100vh; min-height: 100dvh; }
</style>
${markup}
<script type="module">
${bundleJs}
</script>
`;

writeFileSync(OUT, html);
console.log('modules bundled:', order.length, '(entry last: ' + order[order.length - 1] + ')');
console.log('output:', OUT, Math.round(html.length / 1024) + 'KB');
