// «Зууч» — бодит медиагийн хадгалах бодлого: хаагдсан (зарагдсан/түрээслэгдсэн) объектын POV медиаг (бичлэг, 360 зураг, 3D)
// хаагдсанаас RETENTION_DAYS (30) хоногийн дараа устгана. Устгагдсан объект/компанийн медиаг (эзэнгүй) шууд устгана.
// Хаагдсан огноо = properties.closed_at (db.js-ийн trigger тэмдэглэнэ; объектыг дахин идэвхжүүлбэл хугацаа тэглэгдэнэ).
const media = require('./media');

const RETENTION_DAYS = Math.max(1, Number(process.env.ZUUCH_MEDIA_RETENTION_DAYS) || 30);
let last = null; // сүүлийн ажиллалтын тайлан (эзний самбарт)

async function due(db) {
  return db.all(`SELECT m.*, CASE WHEN p.id IS NULL THEN 'orphan' ELSE 'closed' END AS why FROM tour_media m
    LEFT JOIN properties p ON p.id=m.property_id AND p.company_id=m.company_id
    WHERE p.id IS NULL OR (p.status='closed' AND p.closed_at < NOW() - make_interval(days => ?))`, RETENTION_DAYS);
}
async function run(db) {
  const rows = await due(db); let bytes = 0; const props = new Set();
  for (const m of rows) {
    await media.removeFiles(m); bytes += Number(m.size) || 0; props.add(`${m.company_id}/${m.property_id}`);
    await db.run('DELETE FROM tour_media WHERE id=?', m.id);
  }
  for (const k of props) { const [c, p] = k.split('/'); await media.removeDirIfEmpty(c, p); }
  last = { at: new Date().toISOString(), removed: rows.length, bytes, properties: props.size, orphans: rows.filter((r) => r.why === 'orphan').length };
  if (rows.length) console.log(`[хадгалалт] ${rows.length} медиа (${(bytes / 1048576).toFixed(0)} MB) устгав — ${props.size} объект`);
  return last;
}
// Ойрын хугацаанд устах медиа (эзний самбар): хоног → тоо/хэмжээ
async function upcoming(db, days = 7) {
  return db.one(`SELECT COUNT(*)::int n, COALESCE(SUM(m.size),0)::bigint bytes FROM tour_media m JOIN properties p ON p.id=m.property_id AND p.company_id=m.company_id
    WHERE p.status='closed' AND p.closed_at < NOW() - make_interval(days => ?)`, Math.max(0, RETENTION_DAYS - days));
}
function schedule(db) {
  const tick = () => run(db).catch((e) => console.error('[хадгалалт]', e.message));
  setTimeout(tick, 5 * 60e3).unref(); setInterval(tick, 6 * 3600e3).unref(); // асаснаас 5 мин дараа, дараа нь 6 цаг тутам
}
// Объектын медиа устах огноо (хаагдаагүй бол null)
const purgeDate = (closedAt) => (closedAt ? new Date(new Date(closedAt).getTime() + RETENTION_DAYS * 864e5).toISOString() : null);

module.exports = { RETENTION_DAYS, run, due, upcoming, schedule, purgeDate, lastRun: () => last };
