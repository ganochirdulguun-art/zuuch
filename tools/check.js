// Синтакс шалгалт: CommonJS файлууд `node --check`, хөтчийн ESM (public/*.js доторх import/export) — түр .mjs хуулбараар
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
const ROOT = path.join(__dirname, '..');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(d, e.name);
  if (e.isDirectory()) return /^(node_modules|vendor|uploads|backups|data|\.git)$/.test(e.name) ? [] : walk(p);
  return e.name.endsWith('.js') ? [p] : [];
});
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zuuch-check-')); let bad = 0, n = 0;
for (const f of walk(ROOT)) {
  const src = fs.readFileSync(f, 'utf8'); const esm = /^\s*(import|export)\s/m.test(src); let target = f;
  if (esm) { target = path.join(tmp, path.basename(f, '.js') + '-' + n + '.mjs'); fs.writeFileSync(target, src); }
  try { execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' }); n++; }
  catch (e) { bad++; console.error('✗', path.relative(ROOT, f), '\n', String(e.stderr || e.message).split('\n').slice(0, 6).join('\n')); }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`синтакс: ${n} файл зөв${bad ? `, ${bad} алдаатай` : ''}`);
process.exit(bad ? 1 : 0);
