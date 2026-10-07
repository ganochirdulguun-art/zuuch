// «Зууч» — танилцуулгын (зочин) эрх: зочин бүрт ТУСДАА жишээ компани (демо компанийн өгөгдлийн хуулбар), хугацаатай,
// төлбөртэй функц (AI студи, гадна 3D орчин, замын профайл, бодит медиа боловсруулалт) зөвхөн LIMIT объект дээр.
// Эзэн самбараас үүсгэнэ (нууц үгийг эзэн өөрөө оруулна); хугацаа дуусахад нэвтрэлт хаагдана; «Устгах» нь компанийг бүх өгөгдөлтэй нь арилгана.
const tourLib = require('./tour');

const LIMIT = Math.max(0, Number(process.env.ZUUCH_GUEST_PAID_LIMIT) || 2);
const MEDIA_MAX = 500 * 1024 * 1024; // зочны нэг бичлэг/файлын дээд хэмжээ
const cache = new Map(); // company_id → { at, g }

async function info(db, cid) {
  const c = cache.get(cid); if (c && Date.now() - c.at < 60000) return c.g;
  const row = await db.one('SELECT plan, expires_at, meta FROM companies WHERE id=?', cid).catch(() => null);
  const g = row && row.plan === 'guest' ? { expires_at: row.expires_at, paid: (row.meta && row.meta.paid_props) || [], limit: LIMIT } : null;
  cache.set(cid, { at: Date.now(), g }); return g;
}
const expired = (g) => !!(g && g.expires_at && new Date(g.expires_at).getTime() < Date.now());
const daysLeft = (g) => (g && g.expires_at ? Math.max(0, Math.ceil((new Date(g.expires_at).getTime() - Date.now()) / 864e5)) : null);
const EXPIRED_MSG = 'Танилцуулгын эрхийн хугацаа дууссан. Бүрэн эрх авах бол Зууч-тэй холбогдоно уу: smartzuuch.mn@gmail.com';

// Төлбөртэй функц: зочин компанид шинэ объект нэмэгдэх бүрт LIMIT хүртэл бүртгэнэ
async function allowPaid(db, cid, pid) {
  const g = await info(db, cid); if (!g) return { ok: true };
  if (expired(g)) return { ok: false, status: 403, error: EXPIRED_MSG };
  pid = Number(pid); if (g.paid.includes(pid)) return { ok: true };
  if (g.paid.length >= LIMIT) return { ok: false, status: 402, error: `Танилцуулгын эрхэд төлбөртэй функцүүдийг (AI студи, гадна 3D орчин, замын профайл, бодит медиа) ${LIMIT} объект дээр туршиж болно — та ${g.paid.length} объект дээр ашигласан. Тэдгээр объект дээр үргэлжлүүлэн туршиж болно.` };
  const paid = [...g.paid, pid];
  await db.run("UPDATE companies SET meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{paid_props}', ?::jsonb) WHERE id=?", JSON.stringify(paid), cid);
  cache.delete(cid); return { ok: true, first: true, used: paid.length, limit: LIMIT };
}

// Мөрийг өөр компанид хуулна (id-г шинээр, JSON талбарыг текстээр)
async function copyRow(t, table, row, patch) {
  const o = { ...row, ...patch }; delete o.id;
  const cols = Object.keys(o).filter((k) => o[k] !== undefined); const vals = cols.map((k) => (o[k] !== null && typeof o[k] === 'object' && !(o[k] instanceof Date) ? JSON.stringify(o[k]) : o[k]));
  return (await t.one(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')}) RETURNING id`, ...vals)).id;
}
async function cloneDemo(t, from, to, uid) {
  const pmap = new Map(), cmap = new Map(); let n = { properties: 0, clients: 0, requests: 0, deals: 0, tours: 0 };
  for (const p of await t.all('SELECT * FROM properties WHERE company_id=? ORDER BY id', from)) { pmap.set(p.id, await copyRow(t, 'properties', p, { company_id: to, agent_id: uid, closed_at: undefined })); n.properties++; }
  for (const c of await t.all('SELECT * FROM clients WHERE company_id=? ORDER BY id', from)) { cmap.set(c.id, await copyRow(t, 'clients', c, { company_id: to })); n.clients++; }
  for (const r of await t.all('SELECT * FROM requests WHERE company_id=? ORDER BY id', from)) { if (!cmap.has(r.client_id)) continue; await copyRow(t, 'requests', r, { company_id: to, client_id: cmap.get(r.client_id), agent_id: uid }); n.requests++; }
  for (const d of await t.all('SELECT * FROM deals WHERE company_id=? ORDER BY id', from)) { await copyRow(t, 'deals', d, { company_id: to, property_id: d.property_id ? pmap.get(d.property_id) || null : null, client_id: d.client_id ? cmap.get(d.client_id) || null : null }); n.deals++; }
  for (const tr of await t.all('SELECT * FROM tours WHERE company_id=? ORDER BY id', from)) { if (!pmap.has(tr.property_id)) continue; await copyRow(t, 'tours', tr, { company_id: to, property_id: pmap.get(tr.property_id), token: tourLib.newToken(), settings: { hideCompany: true } }); n.tours++; }
  return n;
}
// Зочдыг үүсгэх: prefix1..prefixN, бүгд өөрийн компанитай (захирал эрхтэй)
async function create(db, { prefix = 'guest', count = 5, start = 1, password, days = 14, template, hash }) {
  prefix = String(prefix).trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 20) || 'guest';
  count = Math.max(1, Math.min(20, Number(count) || 1)); days = Math.max(1, Math.min(90, Number(days) || 14));
  if (String(password || '').length < 6) throw new Error('Нууц үг 6+ тэмдэгт');
  const out = [];
  const made = () => out.filter((x) => !x.skipped).length; // бүртгэлтэй нэрийг алгасаад дараагийн дугаараар үргэлжилнэ
  for (let i = Number(start) || 1; made() < count && i < (Number(start) || 1) + 100; i++) {
    const username = prefix + i;
    if (await db.one('SELECT 1 FROM users WHERE username=?', username)) { out.push({ username, skipped: 'бүртгэлтэй' }); continue; }
    const r = await db.tx(async (t) => {
      const cid = (await t.one("INSERT INTO companies (name, plan, status, expires_at, meta) VALUES (?, 'guest', 'active', NOW() + make_interval(days => ?), ?) RETURNING id", `Танилцуулга · ${username}`, days, JSON.stringify({ paid_props: [], guest: true }))).id;
      const uid = (await t.one("INSERT INTO users (company_id, username, pass_hash, name, role) VALUES (?,?,?,?,'zahiral') RETURNING id", cid, username, hash(String(password)), `Зочин ${i}`)).id;
      const n = await cloneDemo(t, template, cid, uid);
      return { username, company_id: cid, ...n };
    });
    out.push(r);
  }
  return { created: out.filter((x) => !x.skipped), skipped: out.filter((x) => x.skipped), days, limit: LIMIT };
}
async function list(db) {
  return db.all(`SELECT c.id, c.name, c.status, c.created_at, c.expires_at, COALESCE(jsonb_array_length(c.meta->'paid_props'), 0) AS paid, (SELECT username FROM users u WHERE u.company_id=c.id ORDER BY id LIMIT 1) AS username,
      (SELECT MAX(s.exp) - INTERVAL '1 second' * 0 FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.company_id=c.id) AS last_session,
      (SELECT COUNT(*)::int FROM properties p WHERE p.company_id=c.id) AS properties FROM companies c WHERE c.plan='guest' ORDER BY c.id`);
}
async function extend(db, cid, days) { await db.run("UPDATE companies SET expires_at = GREATEST(COALESCE(expires_at, NOW()), NOW()) + make_interval(days => ?) WHERE id=? AND plan='guest'", Math.max(1, Math.min(90, Number(days) || 7)), cid); cache.delete(cid); }

module.exports = { LIMIT, MEDIA_MAX, info, expired, daysLeft, allowPaid, create, list, extend, cloneDemo, EXPIRED_MSG, forget: (cid) => cache.delete(cid) };
