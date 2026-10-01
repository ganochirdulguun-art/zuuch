// «Зууч» — нөөцөөс сэргээх (backup.js-ийн zuuch-*.jsonl.gz). ХООСОН өгөгдлийн сан руу сэргээнэ (схемийг db.js автоматаар үүсгэнэ).
// Хэрэглээ: DATABASE_URL=... node tools/restore_backup.js <zuuch-....jsonl.gz> [--replace | --force]
//   --replace: нөөцөд байгаа хүснэгт бүрийг эхлээд ХООСОЛЖ сэргээнэ (шинэ санд db.js демо өгөгдөл оруулдаг тул ихэвчлэн хэрэгтэй)
//   --force:   хүснэгтэд мөр байсан ч нэмнэ (ON CONFLICT DO NOTHING — давхардал алгасна)
const fs = require('fs'); const zlib = require('zlib'); const readline = require('readline'); const path = require('path');
const FILE = process.argv[2]; const FORCE = process.argv.includes('--force'); const REPLACE = process.argv.includes('--replace');
if (!FILE || !fs.existsSync(FILE)) { console.error('Нөөцийн файл заана уу'); process.exit(1); }
const { db, ready } = require(path.join(__dirname, '..', 'db.js'));

(async () => {
  await ready;
  const rl = readline.createInterface({ input: fs.createReadStream(FILE).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  const colsOf = new Map(); const checked = new Set(); const counts = {}; let meta = null, end = null;
  const buf = new Map(); const B = 300;
  const flush = async (t) => {
    const rows = buf.get(t); if (!rows || !rows.length) return; buf.set(t, []);
    let cols = colsOf.get(t);
    if (!cols) {
      const info = await db.all("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=?", t);
      cols = new Map(info.map((c) => [c.column_name, c.data_type])); colsOf.set(t, cols);
      if (!cols.size) { console.warn(`  ! «${t}» хүснэгт схемд алга — алгасав`); return; }
    }
    if (!cols.size) return;
    if (!checked.has(t)) {
      checked.add(t);
      if (REPLACE) await db.exec(`TRUNCATE "${t}"`);
      else { const c = await db.one(`SELECT COUNT(*)::int n FROM "${t}"`); if (c.n && !FORCE) throw new Error(`«${t}» хүснэгтэд ${c.n} мөр байна — --replace (хоослоод сэргээх) эсвэл --force`); }
    }
    const keys = Object.keys(rows[0]).filter((k) => cols.has(k));
    const vals = []; const tuples = rows.map((r) => '(' + keys.map((k) => { let v = r[k]; const dt = cols.get(k); if (v !== null && typeof v === 'object' && /json/.test(dt)) v = JSON.stringify(v); vals.push(v); return '?'; }).join(',') + ')');
    const r = await db.run(`INSERT INTO "${t}" (${keys.map((k) => `"${k}"`).join(',')}) VALUES ${tuples.join(',')} ON CONFLICT DO NOTHING`, ...vals);
    counts[t] = (counts[t] || 0) + r.changes;
  };
  for await (const line of rl) {
    if (!line) continue; const o = JSON.parse(line);
    if (o._meta) { meta = o._meta; console.log('нөөц:', meta.at, meta.reason, meta.tables.length, 'хүснэгт'); continue; }
    if (o._end) { end = o._end; continue; }
    if (!buf.has(o.t)) buf.set(o.t, []); buf.get(o.t).push(o.r); if (buf.get(o.t).length >= B) await flush(o.t);
  }
  for (const t of buf.keys()) await flush(t);
  if (REPLACE && meta) for (const t of meta.tables) if (!checked.has(t)) await db.exec(`TRUNCATE "${t}"`).catch(() => {}); // нөөцөд хоосон байсан хүснэгт (демо мөр үлдээхгүй)
  // SERIAL дарааллыг хамгийн их id-аас үргэлжлүүлнэ
  for (const t of colsOf.keys()) if (colsOf.get(t).has('id')) await db.exec(`SELECT setval(pg_get_serial_sequence('"${t}"','id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM "${t}"),1))`).catch(() => {});
  const bad = end ? Object.entries(end.counts).filter(([t, n]) => (counts[t] || 0) !== n && n > 0) : [];
  console.log('сэргээсэн:', JSON.stringify(counts));
  if (!end) console.warn('! нөөцийн төгсгөлийн тэмдэг алга — файл дутуу байж магадгүй');
  if (bad.length) console.warn('! тоо зөрсөн (давхардал эсвэл схемийн ялгаа):', bad.map(([t, n]) => `${t} ${counts[t] || 0}/${n}`).join(', '));
  process.exit(0);
})().catch((e) => { console.error('АЛДАА', e.message); process.exit(1); });
