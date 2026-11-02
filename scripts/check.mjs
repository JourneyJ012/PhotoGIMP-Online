// Sanity checks with no dependencies: every module parses, every relative
// import exists, and the service worker precaches every module.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const pub = join(root, 'public');
const files = [];
const walk = (d) => readdirSync(d).forEach((f) => { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') && files.push(p); });
walk(join(pub, 'js'));
let failed = 0;
for (const f of [...files, join(pub, 'sw.js'), join(root, 'src/worker.js')]) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { failed++; console.error(`✗ ${relative(root, f)}\n${e.stderr}`); }
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/^\s*import\s[^'"]*['"](\.[^'"]+)['"]/gm)) {
    if (!existsSync(resolve(dirname(f), m[1]))) { failed++; console.error(`✗ ${relative(root, f)}: missing import ${m[1]}`); }
  }
}
// Every named import must be exported by the target module.
const exportsOf = (f) => {
  const src = readFileSync(f, 'utf8'), names = new Set();
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([\w$]+)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export\s*\{([^}]+)\}/gm)) m[1].split(',').forEach((n) => names.add(n.trim().split(/\s+as\s+/).pop()));
  return names;
};
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"](\.[^'"]+)['"]/g)) {
    const target = resolve(dirname(f), m[2]);
    if (!existsSync(target)) continue;
    const ex = exportsOf(target);
    for (const n of m[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
      if (!ex.has(n)) { failed++; console.error(`✗ ${relative(root, f)}: ${n} is not exported by ${m[2]}`); }
    }
  }
}

const sw = readFileSync(join(pub, 'sw.js'), 'utf8');
for (const f of files) {
  const url = '/' + relative(pub, f);
  if (!sw.includes(`'${url}'`)) { failed++; console.error(`✗ sw.js does not precache ${url}`); }
}
console.log(failed ? `${failed} problem(s)` : `ok: ${files.length} modules`);
process.exit(failed ? 1 : 0);
