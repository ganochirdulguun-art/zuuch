// «Зууч» — өгөгдлийн сангийн өдөр тутмын логик нөөц: бүх хүснэгт → JSON Lines + gzip.
// Postgres-ийн volume-оос ТУСДАА (zuuch service-ийн /data volume) хадгална — Postgres эвдэрвэл энэ нөөцөөс сэргээнэ (tools/restore_backup.js).
// Хадгалах: сүүлийн KEEP ширхэг. sessions (нэвтрэлтийн токен) нөөцлөхгүй.
const fs = require('fs'); const path = require('path'); const zlib = require('zlib');

const DIR = process.env.ZUUCH_BACKUPS || (process.env.RAILWAY_VOLUME_MOUNT_PATH ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'backups') : path.join(__dirname, 'backups'));
const KEEP = Math.max(3, Number(process.env.ZUUCH_BACKUP_KEEP) || 14);
const SKIP = new Set(['sessions']);
const NAME_RE = /^zuuch-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.jsonl\.gz$/;
let running = null;

const ubDate = (d = new Date()) => new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 10); // Улаанбаатарын огноо

function list() {
  try {
    return fs.readdirSync(DIR).filter((f) => NAME_RE.test(f)).sort().reverse()
      .map((f) => { const st = fs.statSync(path.join(DIR, f)); return { name: f, size: st.size, at: st.mtime.toISOString() }; });
  } catch { return []; }
}
function prune() { for (const b of list().slice(KEEP)) { try { fs.unlinkSync(path.join(DIR, b.name)); } catch { /* дараа дахин */ } } }
const filePath = (name) => (NAME_RE.test(String(name)) ? path.join(DIR, name) : null);

async function dump(db, reason) {
  fs.mkdirSync(DIR, { recursive: true });
  const tables = (await db.all("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map((r) => r.tablename).filter((t) => !SKIP.has(t));
  const now = new Date(); const ub = new Date(now.getTime() + 8 * 3600e3).toISOString();
  const name = `zuuch-${ub.slice(0, 10)}-${ub.slice(11, 13)}-${ub.slice(14, 16)}.jsonl.gz`; const file = path.join(DIR, name), tmp = file + '.part';
  const gz = zlib.createGzip({ level: 6 }); const out = fs.createWriteStream(tmp); gz.pipe(out);
  const done = new Promise((res, rej) => { out.on('finish', res); out.on('error', rej); gz.on('error', rej); });
  const w = (s) => (gz.write(s) ? null : new Promise((r) => gz.once('drain', r)));
  const counts = {};
  await w(JSON.stringify({ _meta: { v: 1, at: now.toISOString(), reason, tables } }) + '\n');
  for (const t of tables) {
    const cols = (await db.all("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=? ORDER BY ordinal_position", t)).map((r) => r.column_name);
    const order = cols.includes('id') ? 'id' : '1'; let n = 0; const B = 1000;
    for (let off = 0; ; off += B) {
      const rows = await db.all(`SELECT * FROM "${t}" ORDER BY ${order} LIMIT ${B} OFFSET ${off}`);
      for (const r of rows) { const p = w(JSON.stringify({ t, r }) + '\n'); if (p) await p; }
      n += rows.length; if (rows.length < B) break;
    }
    counts[t] = n;
  }
  await w(JSON.stringify({ _end: { counts } }) + '\n');
  gz.end(); await done;
  fs.renameSync(tmp, file); prune();
  return { name, size: fs.statSync(file).size, counts };
}

// Нэг удаад нэг л нөөцлөлт (давхар дарвал эхнийхийг хүлээнэ)
function run(db, { reason = 'manual' } = {}) {
  if (!running) running = dump(db, reason).finally(() => { running = null; });
  return running;
}

// Өдөрт нэг удаа: сервер асаад 3 минутын дараа, дараа нь цаг тутам шалгаж өнөөдрийн (УБ) нөөц байхгүй бол хийнэ
function schedule(db, log = console.log) {
  const tick = async () => {
    try {
      const today = ubDate(); if (list().some((b) => b.name.startsWith('zuuch-' + today))) return;
      const r = await run(db, { reason: 'daily' }); log(`[нөөц] ${r.name} ${(r.size / 1048576).toFixed(1)} MB, ${Object.values(r.counts).reduce((a, b) => a + b, 0)} мөр`);
    } catch (e) { log('[нөөц] алдаа: ' + e.message); }
  };
  setTimeout(tick, 3 * 60e3).unref(); setInterval(tick, 3600e3).unref();
}

module.exports = { run, list, schedule, filePath, DIR, KEEP };
