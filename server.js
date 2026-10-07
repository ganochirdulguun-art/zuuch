// «Зууч» — үл хөдлөхийн агентлагийн платформ (production, multi-tenant, PostgreSQL)
const express = require('express');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const multer = require('multer');
const { db, hash, verify, ready } = require('./db');
const A = require('./algorithms');
const collector = require('./collector');
const studio = require('./studio');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));

// ---- Аюулгүй байдлын толгойнууд ----
app.use((req, res, next) => {
  // Аяллын хуудас (/tour/…) — аппын «3D урьдчилан харах» болон брокерын өөрийн вэбсайтад шигтгэж болно (нууц үйлдэлгүй);
  // бусад бүх хуудас зөвхөн өөрийн сайтын iframe-д (DENY нь аппын доторх урьдчилан харахыг ч хааж байсан)
  const embeddable = req.path.startsWith('/tour/');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!embeddable) res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    `font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; img-src 'self' data: blob: https://*.tile.openstreetmap.org https://tile.openstreetmap.org; connect-src 'self' blob:; media-src 'self' blob:; worker-src 'self' blob:; ` +
    `frame-ancestors ${embeddable ? '*' : "'self'"}`);
  next();
});
// Нүүр/апп хуудас: туршилтын эрхийн мөр (.dev-only) зөвхөн локал хөгжүүлэлтэд — production-д эх кодонд ч очихгүй
const isLocalReq = (req) => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(req.hostname || '');
const PAGES = {}; const DEV_ONLY = /<span class="[^"]*dev-only[^"]*">[\s\S]*?<\/span>/g;
const sendPage = (name) => (req, res) => { const html = PAGES[name] || (PAGES[name] = fs.readFileSync(path.join(__dirname, 'public', name), 'utf8')); res.type('html').setHeader('Cache-Control', 'no-cache'); res.send(isLocalReq(req) ? html : html.replace(DEV_ONLY, '')); };
app.get(['/', '/landing.html'], sendPage('landing.html'));
app.get(['/app', '/index.html'], sendPage('index.html'));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Async route алдааг барих туслах
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---- Сесс: Postgres-д хадгална (Ш1.3) + санах ойн кэш — redeploy, олон instance-д нэвтрэлт тасрахгүй ----
const sessions = new Map();
const SESSION_TTL = 12 * 3600 * 1000;
async function newSession(user) {
  const token = crypto.randomBytes(24).toString('hex');
  const data = { id: user.id, role: user.role, name: user.name, company_id: user.company_id, is_owner: user.is_owner ? 1 : 0, exp: Date.now() + SESSION_TTL };
  sessions.set(token, data);
  await db.run('INSERT INTO sessions (token, user_id, data, exp) VALUES (?,?,?,?)', token, user.id, JSON.stringify(data), new Date(data.exp).toISOString()).catch((e) => console.error('[session save]', e.message));
  return token;
}
async function loadSession(token) {
  if (!token) return null;
  const cached = sessions.get(token); if (cached) return cached;
  const row = await db.one('SELECT data FROM sessions WHERE token=? AND exp > NOW()', token).catch(() => null);
  if (!row) return null;
  const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data; sessions.set(token, data); return data;
}
setInterval(() => { db.run('DELETE FROM sessions WHERE exp < NOW()').catch(() => {}); for (const [t, s] of sessions) if (Date.now() > s.exp) sessions.delete(t); }, 3600 * 1000).unref();
const attempts = new Map();
function rateLimited(ip) { const a = attempts.get(ip); return !!(a && Date.now() - a.ts < 15 * 60000 && a.n >= 8); }
function noteFail(ip) { const a = attempts.get(ip) || { n: 0, ts: Date.now() }; if (Date.now() - a.ts >= 15 * 60000) { a.n = 0; a.ts = Date.now(); } a.n++; attempts.set(ip, a); }

app.post('/api/login', wrap(async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || '?';
  if (rateLimited(ip)) return res.status(429).json({ error: 'Хэт олон оролдлого — 15 минутын дараа дахин оролдоно уу' });
  const { username, password } = req.body || {};
  const user = await db.one('SELECT * FROM users WHERE username=?', String(username || '').toLowerCase());
  if (!user || !verify(String(password || ''), user.pass_hash)) { noteFail(ip); return res.status(401).json({ error: 'Нэвтрэх нэр эсвэл нууц үг буруу байна' }); }
  attempts.delete(ip);
  if (!user.is_owner) {
    const co = await db.one('SELECT status FROM companies WHERE id=?', user.company_id);
    if (co && co.status !== 'active') return res.status(403).json({ error: 'Таны компанийн хандалт түр хаагдсан. Платформын админтай холбогдоно уу.' });
    if (guests.expired(await guests.info(db, user.company_id))) return res.status(403).json({ error: guests.EXPIRED_MSG });
  }
  const token = await newSession(user);
  const company = await db.one('SELECT name FROM companies WHERE id=?', user.company_id);
  res.json({ token, user: { id: user.id, name: user.name, role: user.role, company: company?.name || '', company_id: user.company_id, is_owner: user.is_owner ? 1 : 0, guest: await guestMe(user.company_id) } });
}));

app.post('/api/register', wrap(async (req, res) => {
  const b = req.body || {};
  const company = String(b.company || '').trim(), name = String(b.name || '').trim();
  const username = String(b.username || '').trim().toLowerCase(), password = String(b.password || '');
  if (!company || !name || username.length < 3 || password.length < 6) return res.status(400).json({ error: 'Компанийн нэр, өөрийн нэр, нэвтрэх нэр (3+), нууц үг (6+) шаардлагатай' });
  if (await db.one('SELECT 1 FROM users WHERE username=?', username)) return res.status(409).json({ error: 'Энэ нэвтрэх нэр бүртгэлтэй байна' });
  const cid = (await db.one("INSERT INTO companies (name, license_no, plan) VALUES (?, ?, 'trial') RETURNING id", company, String(b.license || ''))).id;
  const uid = (await db.one("INSERT INTO users (company_id, username, pass_hash, name, role, phone) VALUES (?,?,?,?,'zahiral',?) RETURNING id", cid, username, hash(password), name, String(b.phone || ''))).id;
  const token = await newSession({ id: uid, role: 'zahiral', name, company_id: cid });
  res.json({ token, user: { id: uid, name, role: 'zahiral', company, company_id: cid, is_owner: 0 } });
}));

async function auth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '') || String(req.query.token || '');
    const s = await loadSession(token);
    if (!s) return res.status(401).json({ error: 'Нэвтрээгүй байна' });
    if (Date.now() > s.exp) { sessions.delete(token); db.run('DELETE FROM sessions WHERE token=?', token).catch(() => {}); return res.status(401).json({ error: 'Сесс дууссан' }); }
    req.user = s; req.token = token;
    if (!s.is_owner && req.path !== '/logout' && guests.expired(await guests.info(db, s.company_id))) return res.status(403).json({ error: guests.EXPIRED_MSG });
    next();
  } catch (e) { next(e); }
}
async function guestMe(cid) { const g = await guests.info(db, cid); return g ? { days_left: guests.daysLeft(g), expires_at: g.expires_at, paid_used: g.paid.length, limit: g.limit } : null; }
// Төлбөртэй функц (AI, Google Routes, медиа боловсруулалт): зочин компанид LIMIT объект хүртэл
const paid = (param) => async (req, res, next) => {
  try {
    const pid = Number(req.params[param]); if (!(await db.one('SELECT 1 FROM properties WHERE id=? AND company_id=?', pid, req.user.company_id))) return next(); // өөрийнх биш бол маршрут 404 өгнө
    const r = await guests.allowPaid(db, req.user.company_id, pid); if (!r.ok) return res.status(r.status).json({ error: r.error }); next();
  } catch (e) { next(e); }
};
const OPEN = new Set(['/login', '/register']);
app.use('/api', (req, res, next) => (OPEN.has(req.path) ? next() : auth(req, res, next)));

app.post('/api/logout', (req, res) => { sessions.delete(req.token); db.run('DELETE FROM sessions WHERE token=?', req.token).catch(() => {}); res.json({ ok: true }); });
app.get('/api/me', wrap(async (req, res) => {
  const company = await db.one('SELECT name FROM companies WHERE id=?', req.user.company_id);
  res.json({ id: req.user.id, name: req.user.name, role: req.user.role, company: company?.name || '', company_id: req.user.company_id, is_owner: req.user.is_owner ? 1 : 0, guest: await guestMe(req.user.company_id), credits: await credits.balance(db, req.user.company_id, req.user.id) });
}));
app.post('/api/me/password', wrap(async (req, res) => {
  const { current, next: nx } = req.body || {};
  const u = await db.one('SELECT * FROM users WHERE id=?', req.user.id);
  if (!u || !verify(String(current || ''), u.pass_hash)) return res.status(401).json({ error: 'Одоогийн нууц үг буруу' });
  if (String(nx || '').length < 6) return res.status(400).json({ error: 'Шинэ нууц үг 6+ тэмдэгт байх ёстой' });
  await db.run('UPDATE users SET pass_hash=? WHERE id=?', hash(String(nx)), req.user.id);
  res.json({ ok: true });
}));

app.get('/api/meta', wrap(async (req, res) => {
  res.json({
    districts: ['Сүхбаатар', 'Хан-Уул', 'Баянгол', 'Баянзүрх', 'Чингэлтэй', 'Сонгинохайрхан'],
    agents: await db.all('SELECT id, name FROM users WHERE company_id=? ORDER BY role, name', req.user.company_id),
    ai: !!process.env.ANTHROPIC_API_KEY,
  });
}));

function zahiralOnly(req, res, next) { if (req.user.role !== 'zahiral') return res.status(403).json({ error: 'Зөвхөн захирал энэ үйлдлийг хийнэ' }); next(); }
function ownerOnly(req, res, next) { if (!req.user.is_owner) return res.status(403).json({ error: 'Зөвхөн платформын эзэн' }); next(); }

// ---- Эзэн самбар ----
app.get('/api/owner/overview', ownerOnly, wrap(async (req, res) => {
  const companies = await db.all(`
    SELECT c.id, c.name, c.plan, c.status, c.created_at,
      (SELECT COUNT(*)::int FROM users u WHERE u.company_id=c.id) AS users,
      (SELECT COUNT(*)::int FROM properties p WHERE p.company_id=c.id) AS properties,
      (SELECT COUNT(*)::int FROM clients cl WHERE cl.company_id=c.id) AS clients,
      (SELECT COUNT(*)::int FROM deals d WHERE d.company_id=c.id) AS deals,
      (SELECT COALESCE(SUM(commission),0)::float FROM deals d WHERE d.company_id=c.id) AS commission
    FROM companies c ORDER BY c.id`);
  const t = await db.one(`SELECT (SELECT COUNT(*)::int FROM users) users, (SELECT COUNT(*)::int FROM properties) properties,
    (SELECT COUNT(*)::int FROM deals) deals, (SELECT COALESCE(SUM(commission),0)::float FROM deals) commission,
    (SELECT COUNT(*)::int FROM market_listings WHERE active=1) "marketListings"`);
  res.json({ companies, totals: { companies: companies.length, ...t } });
}));
app.post('/api/owner/company/:id', ownerOnly, wrap(async (req, res) => {
  const id = Number(req.params.id), b = req.body || {};
  const sets = [], vals = [];
  if (b.status && ['active', 'suspended'].includes(b.status)) { sets.push('status=?'); vals.push(b.status); }
  if (b.plan && ['demo', 'trial', ...Object.keys(credits.PLANS)].includes(b.plan)) { sets.push('plan=?'); vals.push(b.plan); }
  if (!sets.length) return res.json({ ok: false, error: 'Өөрчлөх утга алга' });
  const r = await db.run(`UPDATE companies SET ${sets.join(',')} WHERE id=?`, ...vals, id);
  const grant = credits.PLANS[b.plan] ? await credits.monthly(db, id) : null; // багц идэвхжмэгц энэ сарын кредит
  res.json({ ok: r.changes > 0, grant });
}));
app.delete('/api/owner/company/:id', ownerOnly, wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.company_id) return res.status(400).json({ error: 'Өөрийн харьяа компанийг устгах боломжгүй' });
  const amlHold = await aml.retentionBlock(id); if (amlHold && req.query.aml !== 'keep') return res.status(409).json({ error: `Компанид МУТСТ-ийн бүртгэл байна (ХТМ ${amlHold.p}, гүйлгээ ${amlHold.t}, тайлан ${amlHold.r}) — хуулиар 5 жил хадгална (МУТСТХ 8.1). Экспортолж хүлээлгэн өгсний дараа МУТСТ бүртгэлийг хадгалан устгана (?aml=keep).` });
  await db.tx(async (t) => {
    await t.run('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE company_id=?)', id);
    for (const tb of ['listing_assets', 'listing_drafts', 'tours', 'properties', 'clients', 'requests', 'deals', 'users']) await t.run(`DELETE FROM ${tb} WHERE company_id=?`, id); // бодит медиаг (tour_media) хадгалалтын ажил эзэнгүй гэж цэвэрлэнэ
    await t.run('DELETE FROM companies WHERE id=?', id);
  });
  for (const [tok, s] of sessions) if (s.company_id === id) sessions.delete(tok); guests.forget(id);
  res.json({ ok: true });
}));

// ---- Нөөцлөлт (эзэн): өдөр бүр автоматаар, гараар ч; татаж аваад өөрийн компьютерт хадгална ----
app.get('/api/owner/storage', ownerOnly, wrap(async (req, res) => {
  const byCo = await db.all("SELECT m.company_id, c.name, m.kind, COUNT(*)::int n, COALESCE(SUM(m.size),0)::bigint bytes FROM tour_media m LEFT JOIN companies c ON c.id=m.company_id WHERE m.status='ready' GROUP BY 1,2,3 ORDER BY bytes DESC");
  res.json({ retention: { days: retention.RETENTION_DAYS, last: retention.lastRun(), next7: await retention.upcoming(db, 7) }, anon: await media.anon.status(), disk: media.diskInfo(), media: byCo, mediaDir: media.MEDIA_DIR, uploads: await media.dirSize(path.join(media.MEDIA_DIR, '_uploads')), backups: await media.dirSize(backup.DIR), assets: await media.dirSize(UPLOAD_DIR), ffmpeg: !!media.tools().ffmpeg, queue: media.queueLength(),
    brand: await db.one("SELECT COUNT(*) FILTER (WHERE meta->>'brand'='true')::int done, COUNT(*) FILTER (WHERE COALESCE(meta->>'brand','false')<>'true' AND meta->>'brand_err' IS NULL AND meta->>'brand_skip' IS NULL)::int pending, COUNT(*) FILTER (WHERE meta->>'brand_err' IS NOT NULL)::int err FROM tour_media WHERE status='ready' AND file IS NOT NULL AND kind IN ('walk_ext','walk_in') AND COALESCE(projection,'flat')<>'equirect'") });
}));
app.post('/api/owner/media/rebrand', ownerOnly, wrap(async (req, res) => res.json({ queued: await media.rebrandAll(db), queue: media.queueLength() }))); // хуучин бичлэгт брэнд тэмдэг
// Ш3: хотын хэмжээний замын хугацаа — урьдчилсан зардал, эхлүүлэх (төсвийн хязгаартай), зогсоох
app.get('/api/owner/city-commute', ownerOnly, wrap(async (req, res) => res.json({ estimate: await cityCommute.estimate(db), job: cityCommute.status(), hasKey: !!process.env.GOOGLE_MAPS_KEY })));
app.post('/api/owner/city-commute', ownerOnly, wrap(async (req, res) => {
  const b = req.body || {}; if (b.stop) { cityCommute.stop(); return res.json({ ok: true, job: cityCommute.status() }); }
  try { res.json({ ok: true, job: await cityCommute.run(db, { maxElements: b.maxElements }) }); } catch (e) { res.status(400).json({ error: e.message }); }
}));
// Танилцуулгын эрх: үүсгэх (нууц үгийг эзэн оруулна), жагсаалт, сунгах — устгах нь DELETE /api/owner/company/:id
app.get('/api/owner/guests', ownerOnly, wrap(async (req, res) => res.json({ items: await guests.list(db), limit: guests.LIMIT })));
app.post('/api/owner/guests', ownerOnly, wrap(async (req, res) => {
  const b = req.body || {};
  try { res.json(await guests.create(db, { prefix: b.prefix, count: b.count, start: b.start, password: b.password, days: b.days, template: Number(b.template) || req.user.company_id, hash })); }
  catch (e) { res.status(400).json({ error: e.message }); }
}));
app.post('/api/owner/guests/:id/extend', ownerOnly, wrap(async (req, res) => { await guests.extend(db, Number(req.params.id), (req.body || {}).days); res.json({ ok: true }); }));
// ---- Кредит: захирал — нөөц, агентын үлдэгдэл, шилжүүлэг, тохиргоо; агент — өөрийн үлдэгдэл, түүх ----
app.get('/api/credits', wrap(async (req, res) => {
  const cid = req.user.company_id; const s = await credits.settings(db, cid); const isZ = req.user.role === 'zahiral' || req.user.is_owner;
  const mine = await credits.balance(db, cid, req.user.id);
  const myHist = await db.all('SELECT delta, kind, note, created_at FROM credit_ledger WHERE company_id=? AND user_id=? ORDER BY id DESC LIMIT 30', cid, req.user.id);
  const out = { plan: s.plan ? { key: s.plan, ...credits.PLANS[s.plan] } : null, plans: credits.PLANS, packs: credits.PACKS, special: credits.SPECIAL, perAgentHint: credits.PER_AGENT, reserveHint: credits.RESERVE_HINT, mine, myHistory: myHist, settings: s, zahiral: !!isZ };
  if (isZ) {
    const b = await credits.balances(db, cid); const m = credits.ubMonth() + '-01';
    const spent = new Map((await db.all("SELECT user_id, COALESCE(-SUM(delta),0)::int n FROM credit_ledger WHERE company_id=? AND kind='spend' AND user_id IS NOT NULL AND created_at >= (?::date - INTERVAL '8 hours') GROUP BY user_id", cid, m)).map((r) => [r.user_id, r.n]));
    const deals = new Map((await db.all("SELECT p.agent_id, COUNT(*)::int n FROM deals d JOIN properties p ON p.id=d.property_id WHERE d.company_id=? AND d.deal_date >= to_char(NOW() - INTERVAL '90 days','YYYY-MM-DD') GROUP BY p.agent_id", cid)).map((r) => [r.agent_id, r.n]));
    const users = await db.all('SELECT id, name, role, created_at FROM users WHERE company_id=? ORDER BY role DESC, name', cid);
    out.reserve = b.reserve; out.users = users.map((u) => ({ ...u, bal: b.users.get(u.id) || 0, spentMonth: spent.get(u.id) || 0, deals90: deals.get(u.id) || 0 }));
    out.usage = await credits.usage(db, cid);
    out.history = await db.all('SELECT l.delta, l.kind, l.note, l.created_at, u.name AS user_name FROM credit_ledger l LEFT JOIN users u ON u.id=l.user_id WHERE l.company_id=? AND l.user_id IS NULL ORDER BY l.id DESC LIMIT 40', cid);
  }
  res.json(out);
}));
app.post('/api/credits/transfer', zahiralOnly, wrap(async (req, res) => {
  const b = req.body || {}; const kind = b.kind === 'reward' ? 'reward' : 'transfer';
  try { res.json(await credits.transfer(db, { cid: req.user.company_id, uid: Number(b.uid), n: Number(b.n), note: String(b.note || '').slice(0, 120), by: req.user.id, kind })); } catch (e) { res.status(400).json({ error: e.message }); }
}));
app.put('/api/credits/settings', zahiralOnly, wrap(async (req, res) => res.json(await credits.saveSettings(db, req.user.company_id, req.body || {}))));
app.post('/api/credits/allocate', zahiralOnly, wrap(async (req, res) => { // одоо бүх ажилтанд perAgent хүртэл нөхөх (хэн нь дутуу байна)
  const cid = req.user.company_id; const s = await credits.settings(db, cid); const b = await credits.balances(db, cid); let left = b.reserve, given = 0, n = 0;
  for (const u of await db.all('SELECT id FROM users WHERE company_id=? ORDER BY id', cid)) { const need = Math.max(0, s.perAgent - (b.users.get(u.id) || 0)); if (!need || need > left) continue; await credits.transfer(db, { cid, uid: u.id, n: need, note: 'нөхөн хуваарилалт', by: req.user.id }); left -= need; given += need; n++; }
  res.json({ ok: true, given, users: n, reserve: left });
}));
app.post('/api/owner/company/:id/credits', ownerOnly, wrap(async (req, res) => { // эзэн: кредит нэмэх (худалдан авалт, урамшуулал)
  const n = Math.trunc(Number((req.body || {}).n)); if (!n) return res.status(400).json({ error: 'Тоо буруу' });
  await db.tx((t) => credits.add(t, { cid: Number(req.params.id), delta: n, kind: n > 0 ? 'bonus' : 'refund', note: String((req.body || {}).note || 'Эзэн нэмсэн').slice(0, 120), by: req.user.id })); res.json({ ok: true });
}));
app.get('/api/owner/backups', ownerOnly, wrap(async (req, res) => res.json({ items: backup.list(), keep: backup.KEEP })));
app.post('/api/owner/backups', ownerOnly, wrap(async (req, res) => res.json({ ok: true, ...(await backup.run(db, { reason: 'manual:' + (req.user.name || req.user.id) })) })));
app.get('/api/owner/backups/:name', ownerOnly, (req, res) => {
  const f = backup.filePath(req.params.name); if (!f || !fs.existsSync(f)) return res.status(404).json({ error: 'Нөөц олдсонгүй' });
  res.download(f, req.params.name);
});

// ---- Баг ----
app.get('/api/users', wrap(async (req, res) => res.json(await db.all('SELECT id, username, name, role, phone FROM users WHERE company_id=? ORDER BY role, name', req.user.company_id))));
app.post('/api/users', zahiralOnly, wrap(async (req, res, next) => { if (await guests.info(db, req.user.company_id)) return res.status(403).json({ error: 'Танилцуулгын эрхэд хэрэглэгч нэмэх боломжгүй' }); next(); }), wrap(async (req, res) => {
  const b = req.body || {};
  const username = String(b.username || '').trim().toLowerCase(), password = String(b.password || ''), name = String(b.name || '').trim();
  if (!name || username.length < 3 || password.length < 6) return res.status(400).json({ error: 'Нэр, нэвтрэх нэр (3+), нууц үг (6+) шаардлагатай' });
  if (await db.one('SELECT 1 FROM users WHERE username=?', username)) return res.status(409).json({ error: 'Нэвтрэх нэр бүртгэлтэй байна' });
  const role = b.role === 'zahiral' ? 'zahiral' : 'agent';
  const r = await db.one('INSERT INTO users (company_id, username, pass_hash, name, role, phone) VALUES (?,?,?,?,?,?) RETURNING id', req.user.company_id, username, hash(password), name, role, String(b.phone || ''));
  res.json({ id: r.id });
}));
app.delete('/api/users/:id', zahiralOnly, wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Өөрийгөө устгах боломжгүй' });
  const reclaimed = await db.tx(async (t) => { const u = await t.one('SELECT name FROM users WHERE id=? AND company_id=?', id, req.user.company_id); const n = u ? await credits.reclaim(t, req.user.company_id, id, u.name) : 0; await t.run('DELETE FROM users WHERE id=? AND company_id=?', id, req.user.company_id); return n; });
  res.json({ ok: true, reclaimed }); // ашиглаагүй кредит компанийн нөөц рүү
}));

// ---- Хянах самбар ----
app.get('/api/dashboard', wrap(async (req, res) => {
  const cid = req.user.company_id;
  const month = new Date().toISOString().slice(0, 7);
  const [md, ap, orq, ml, expiring, staleReqs, opportunities] = await Promise.all([
    db.one('SELECT COUNT(*)::int c, COALESCE(SUM(commission),0)::float s FROM deals WHERE company_id=? AND substr(deal_date,1,7)=?', cid, month),
    db.one("SELECT COUNT(*)::int c FROM properties WHERE company_id=? AND status='active'", cid),
    db.one("SELECT COUNT(*)::int c FROM requests WHERE company_id=? AND status='open'", cid),
    db.one('SELECT COUNT(*)::int c FROM market_listings WHERE active=1'),
    db.all(`SELECT d.*, p.district, p.khoroolol FROM deals d LEFT JOIN properties p ON p.id=d.property_id
      WHERE d.company_id=? AND d.contract_end IS NOT NULL AND d.contract_end::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30`, cid),
    db.all(`SELECT r.*, c.name client_name FROM requests r JOIN clients c ON c.id=r.client_id
      WHERE r.company_id=? AND r.status='open' AND r.last_contact::timestamptz < NOW() - INTERVAL '3 days'`, cid),
    A.opportunities(),
  ]);
  res.json({ activeProperties: ap.c, openRequests: orq.c, monthDeals: md.c, monthCommission: md.s, marketListings: ml.c, expiring, staleReqs, opportunities: opportunities.slice(0, 5) });
}));

// ---- Tenant-scoped CRUD ----
function crud(name, table, fields, after) {
  app.get(`/api/${name}`, wrap(async (req, res) => res.json(await db.all(`SELECT * FROM ${table} WHERE company_id=? ORDER BY id DESC`, req.user.company_id))));
  app.post(`/api/${name}`, wrap(async (req, res) => {
    const cols = ['company_id', ...fields];
    const vals = [req.user.company_id, ...fields.map(f => (req.body[f] === '' || req.body[f] === undefined) ? null : req.body[f])];
    const r = await db.one(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')}) RETURNING id`, ...vals);
    if (after) await after(req, r.id);
    res.json({ id: r.id });
  }));
  app.put(`/api/${name}/:id`, wrap(async (req, res) => {
    const sets = fields.filter(f => f in req.body);
    if (!sets.length) return res.json({ ok: true });
    const r = await db.run(`UPDATE ${table} SET ${sets.map(f => f + '=?').join(',')} WHERE id=? AND company_id=?`, ...sets.map(f => (req.body[f] === '' ? null : req.body[f])), req.params.id, req.user.company_id);
    if (after && r.changes) await after(req, Number(req.params.id));
    res.json({ ok: r.changes > 0 });
  }));
  app.delete(`/api/${name}/:id`, wrap(async (req, res) => {
    const r = await db.run(`DELETE FROM ${table} WHERE id=? AND company_id=?`, req.params.id, req.user.company_id);
    res.json({ ok: r.changes > 0 });
  }));
}
crud('properties', 'properties', ['deal_type', 'district', 'khoroolol', 'rooms', 'area', 'floor', 'total_floors', 'is_new', 'price', 'status', 'agent_id', 'owner_name', 'owner_phone', 'notes', 'lat', 'lng']);
app.delete('/api/clients/:id', wrap(async (req, res, next) => { await db.run('UPDATE aml_profiles SET client_id=NULL WHERE client_id=? AND company_id=?', req.params.id, req.user.company_id); next(); })); // ХТМ профайл 5 жил хадгалагдана (МУТСТХ 8.1)
crud('clients', 'clients', ['name', 'phone', 'type', 'notes']);
crud('requests', 'requests', ['client_id', 'deal_type', 'budget', 'districts', 'rooms', 'area_min', 'area_max', 'status', 'agent_id', 'last_contact']);
crud('deals', 'deals', ['property_id', 'client_id', 'deal_type', 'amount', 'commission', 'payment_form', 'contract_end', 'deal_date'], (req, id) => aml.syncDeal(req, id)); // худалдах хэлцэл → МУТСТ гүйлгээний бүртгэл

app.get('/api/requests-full', wrap(async (req, res) => res.json(await db.all(`SELECT r.*, c.name client_name, u.name agent_name FROM requests r
  JOIN clients c ON c.id=r.client_id LEFT JOIN users u ON u.id=r.agent_id WHERE r.company_id=? ORDER BY r.id DESC`, req.user.company_id))));
app.get('/api/deals-full', wrap(async (req, res) => res.json(await db.all(`SELECT d.*, c.name client_name, p.district, p.khoroolol, p.rooms FROM deals d
  LEFT JOIN clients c ON c.id=d.client_id LEFT JOIN properties p ON p.id=d.property_id WHERE d.company_id=? ORDER BY d.id DESC`, req.user.company_id))));

// ---- Алгоритмууд ----
app.get('/api/valuation', wrap(async (req, res) => {
  const v = await A.valuation({ district: req.query.district, rooms: req.query.rooms, area: req.query.area, isNew: req.query.is_new === '1', floor: req.query.floor, totalFloors: req.query.total_floors });
  res.json(v || { error: 'Индекс олдсонгүй' });
}));
app.get('/api/matches/:id', wrap(async (req, res) => res.json(await A.matchesForRequest(req.params.id, req.user.company_id))));
app.get('/api/market/index', wrap(async (req, res) => res.json(await db.all('SELECT * FROM price_index ORDER BY median_m2 DESC'))));
app.get('/api/market/opportunities', wrap(async (req, res) => res.json(await A.opportunities())));
app.get('/api/location-score', wrap(async (req, res) => res.json((await A.locationScore(req.query.district, req.query.lat, req.query.lng)) || { error: 'Оноо олдсонгүй' })));
// ---- Д-5: Замын/түгжрэлийн профайл ----
const commute = require('./commute');
const cityCommute = require('./citycommute'); // Ш3: хотын хэмжээний замын хугацаа (Google Route Matrix)
const exterior = require('./exterior');
const geostore = require('./geostore'); // хотын 500×500 м хавтан сан (data/geo)
const backup = require('./backup'); // өдөр тутмын нөөц (/data/backups)
const priceIndex = require('./priceindex'); // дүүргийн үнийн индекс бодит зараас
const dedupX = require('./dedup'); // эх сурвалж хоорондын давхардал
const media = require('./media'); // POV аяллын бодит медиа (бичлэг, 360, splat)
const retention = require('./retention'); // хаагдсан объектын медиаг 30 хоногийн дараа устгана
const credits = require('./credits'); // сарын багц, AI студийн кредит (компанийн нөөц → агент)
const guests = require('./guests'); // танилцуулгын эрх (зочин компани, хугацаа, төлбөртэй функцийн хязгаар)
const roomplan = require('./roomplan'); // iPhone LiDAR RoomPlan → план
app.get('/api/commute/meta', (req, res) => res.json({ hasKey: commute.hasKey(), destinations: commute.destinations(), slots: commute.SLOTS }));
app.get('/api/properties/:id/commute', wrap(async (req, res) => {
  const p = await db.one('SELECT id, lat, lng, district, khoroolol FROM properties WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!p) return res.status(404).json({ error: 'Объект олдсонгүй' });
  if (p.lat == null || p.lng == null) return res.json({ property: p, profile: null, hasKey: commute.hasKey(), needLocation: true });
  const c = await db.one("SELECT * FROM commute_cells WHERE cell=? AND computed_at > NOW() - INTERVAL '30 days'", commute.cellOf(p.lat, p.lng));
  const city = c ? null : await cityCommute.lookup(db, Number(p.lat), Number(p.lng)); // хотын 500 м нүд (Ш3)
  res.json({ property: p, profile: c ? { ...c.profile, cached: true } : city ? { ...city, cached: true } : null, hasKey: commute.hasKey() });
}));
app.post('/api/properties/:id/commute', paid('id'), wrap(async (req, res) => {
  const p = await db.one('SELECT id, lat, lng FROM properties WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!p) return res.status(404).json({ error: 'Объект олдсонгүй' });
  if (p.lat == null || p.lng == null) return res.status(400).json({ error: 'Эхлээд объектын байршлыг газрын зураг дээр заана уу' });
  try { res.json({ profile: await commute.profile(Number(p.lat), Number(p.lng), { force: req.body && req.body.force === true }) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
}));
// Зах зээлийн нэг зарын бүрэн мэдээлэл + судалгаа (индекс, үнэлгээ, ижил төстэй зарууд, зах зээлд байсан хоног, дотоод тохирох хүсэлтүүд)
app.get('/api/market/:id', wrap(async (req, res) => {
  const l = await db.one('SELECT * FROM market_listings WHERE id=?', req.params.id);
  if (!l) return res.status(404).json({ error: 'Зар олдсонгүй' });
  const idx = await db.one('SELECT * FROM price_index WHERE district=? AND is_new=? ORDER BY month DESC LIMIT 1', l.district, l.is_new ? 1 : 0);
  const val = l.deal_type === 'sale' && l.area > 0 ? await A.valuation({ district: l.district, rooms: l.rooms, area: l.area, isNew: !!l.is_new }) : null;
  const similar = await db.all(`SELECT id, source, title, rooms, area, price, prev_price, listed_at, khoroolol, source_url, is_new FROM market_listings
    WHERE active=1 AND id<>? AND deal_type=? AND district=? AND rooms=? AND area BETWEEN ? AND ? ORDER BY ABS(price-?) LIMIT 8`, l.id, l.deal_type, l.district, l.rooms, l.area * 0.8, l.area * 1.2, l.price);
  const loc = await A.locationScore(l.district);
  // Дотоод хүсэлтүүдээс тохирох худалдан авагчид (А4)
  const reqs = await db.all("SELECT r.*, c.name client_name, c.phone client_phone FROM requests r JOIN clients c ON c.id=r.client_id WHERE r.company_id=? AND r.status<>'closed'", req.user.company_id);
  const buyers = reqs.map((r) => ({ id: r.id, client_name: r.client_name, client_phone: r.client_phone, budget: r.budget, rooms: r.rooms, districts: r.districts, score: A.matchScore(r, { ...l, created_at: l.listed_at }) })).filter((b) => b.score >= 50).sort((a, b) => b.score - a.score).slice(0, 10);
  const days = l.listed_at ? Math.floor((Date.now() - new Date(l.listed_at).getTime()) / 864e5) : null;
  const m2 = l.area > 0 ? l.price / l.area : null; const baseline = idx ? idx.median_m2 * ({ 1: 1.06, 2: 1.0, 3: 0.95, 4: 0.92, 5: 0.9 }[l.rooms] || 1) : null;
  // Нийтлэгч: ангилал (эзэн/агент/агентлаг/хөгжүүлэгч) + тэдний бусад зарууд; lead-ийн төлөв (энэ компанийн)
  const poster = l.poster_key ? await db.one('SELECT * FROM posters WHERE key=?', l.poster_key) : null;
  const posterListings = l.poster_key ? await db.all('SELECT id, title, category, deal_type, district, rooms, area, price, active, listed_at FROM market_listings WHERE poster_key=? AND id<>? ORDER BY id DESC LIMIT 12', l.poster_key, l.id) : [];
  const lead = await db.one('SELECT * FROM leads WHERE company_id=? AND listing_id=?', req.user.company_id, l.id);
  const dups = l.dedup_group ? await db.all('SELECT id, source, title, price, area, source_url, active, last_seen FROM market_listings WHERE dedup_group=? AND id<>? ORDER BY active DESC, id DESC LIMIT 10', l.dedup_group, l.id) : [];
  res.json({ listing: l, dups, index: idx, valuation: val, similar, location: loc, buyers, days, m2, baseline, vsIndex: m2 && baseline ? Math.round((m2 / baseline - 1) * 100) : null, poster, posterListings, lead });
}));
// ---- Гэрээний боломж (lead): эзэн өөрөө нийтэлсэн шинэ зарууд → брокер оффист санал ----
// Утас ХАДГАЛАХГҮЙ (сайт нуудаг + хувь хүний мэдээллийн хууль): агент эх зарын холбоосоор өөрөө холбогдож, зөвшөөрөлтэйгээр харилцагч болгоно
app.get('/api/leads', wrap(async (req, res) => {
  const days = Math.min(60, Math.max(1, Number(req.query.days) || 14));
  // Шүүлтүүр: төрөл (apartment|house|office|commercial|object|warehouse|land|all), хэлцэл (sale|rent|all), дүүрэг
  const CATS = ['apartment', 'house', 'office', 'commercial', 'object', 'warehouse', 'land'];
  const cat = CATS.includes(req.query.category) ? req.query.category : null;
  const deal = ['sale', 'rent'].includes(req.query.deal) ? req.query.deal : null;
  const district = String(req.query.district || '').slice(0, 40) || null;
  const city = String(req.query.city || '').slice(0, 40) || null;
  const khoroolol = String(req.query.khoroolol || '').slice(0, 60) || null;
  const params = [req.user.company_id, days]; let where = '';
  if (cat) { where += ' AND l.category=?'; params.push(cat); } else where += " AND l.category IN ('apartment','house','office','commercial','object','warehouse','land')";
  if (deal) { where += ' AND l.deal_type=?'; params.push(deal); }
  if (city) { where += " AND COALESCE(l.city,'Улаанбаатар')=?"; params.push(city); }
  if (district) { where += ' AND l.district=?'; params.push(district); }
  if (khoroolol) { where += ' AND l.khoroolol ILIKE ?'; params.push('%' + khoroolol + '%'); }
  // Байршлын мод (хот/аймаг → дүүрэг/сум → хороо/хороолол) — шүүлтүүрийн сонголтуудад
  const locations = await db.all(`SELECT COALESCE(l.city,'Улаанбаатар') city, l.district, COALESCE(l.khoroolol,'') khoroolol, COUNT(*)::int n FROM market_listings l JOIN posters p ON p.key=l.poster_key
    WHERE l.active=1 AND l.collected_at IS NOT NULL AND p.kind='owner' AND l.listed_at::date >= (CURRENT_DATE - ?::int) GROUP BY 1,2,3 ORDER BY 1,2,3`, days);
  const rows0 = await db.all(`SELECT l.id, l.dedup_group, l.title, l.category, l.deal_type, l.district, l.khoroolol, l.rooms, l.area, l.price, l.prev_price, l.listed_at, l.source, l.source_url, l.images, l.ad_type, l.last_seen, l.poster_key,
      p.name poster_name, p.kind poster_kind, p.listings poster_listings, p.active_listings poster_active, p.verified poster_verified, p.company_guess,
      ld.status lead_status, ld.agent_id lead_agent, ld.client_id lead_client, ld.note lead_note
    FROM market_listings l JOIN posters p ON p.key=l.poster_key LEFT JOIN leads ld ON ld.listing_id=l.id AND ld.company_id=?
    WHERE l.active=1 AND l.collected_at IS NOT NULL AND p.kind='owner' AND l.listed_at::date >= (CURRENT_DATE - ?::int) AND ld.id IS NULL${where}
    ORDER BY l.listed_at DESC, l.id DESC LIMIT 300`, ...params);
  // Нэг объект олон сайтад (dedup_group) → нэг мөр, бусад эх сурвалжийг also-д
  const seenG = new Map(); const rows = [];
  for (const r of rows0) { const g = r.dedup_group; if (g && seenG.has(g)) { seenG.get(g).also.push({ source: r.source, url: r.source_url, price: r.price }); continue; } const o = { ...r, also: [] }; if (g) seenG.set(g, o); rows.push(o); }
  // Авч ажиллаж буй lead — огноо/шүүлтүүр/300-ийн хязгаараас үл хамааран үргэлж харагдана (өмнө нь жагсаалтын төгсгөлд таслагдаж алга болдог байв)
  const claimed = await db.all(`SELECT l.id, l.title, l.category, l.deal_type, l.district, l.khoroolol, l.rooms, l.area, l.price, l.prev_price, l.listed_at, l.source, l.source_url, l.active,
      l.poster_key, p.name poster_name, p.kind poster_kind, ld.status lead_status, ld.agent_id lead_agent, ld.client_id lead_client, ld.note lead_note, ld.created_at lead_at, u.name agent_name
    FROM leads ld JOIN market_listings l ON l.id=ld.listing_id LEFT JOIN posters p ON p.key=l.poster_key LEFT JOIN users u ON u.id=ld.agent_id
    WHERE ld.company_id=? ORDER BY (ld.status IN ('signed','rejected')), ld.created_at DESC LIMIT 200`, req.user.company_id);
  const counts = await db.all(`SELECT l.category, l.deal_type, COUNT(*)::int n FROM market_listings l JOIN posters p ON p.key=l.poster_key
    WHERE l.active=1 AND l.collected_at IS NOT NULL AND p.kind='owner' AND l.listed_at::date >= (CURRENT_DATE - ?::int) GROUP BY l.category, l.deal_type`, days);
  const idxRows = await db.all('SELECT DISTINCT ON (district, is_new) * FROM price_index ORDER BY district, is_new, month DESC');
  const idxMap = new Map(idxRows.map((i) => [i.district + '|' + i.is_new, i]));
  const out = rows.map((r) => {
    const idx = idxMap.get(r.district + '|0'); const m2 = r.area > 0 ? r.price / r.area : null;
    const vs = idx && m2 && r.deal_type === 'sale' && r.category === 'apartment' ? Math.round((m2 / (idx.median_m2 * ({ 1: 1.06, 2: 1.0, 3: 0.95, 4: 0.92, 5: 0.9 }[r.rooms] || 1)) - 1) * 100) : null;
    const age = r.listed_at ? Math.floor((Date.now() - new Date(r.listed_at).getTime()) / 864e5) : 30;
    // Lead оноо: эзэн (1–2 зар) + шинэ + зарах + үнэ индекст ойр/дээгүүр (эзэн үнээ мэдэхгүй байж магад) + зураг цөөн (мэргэжлийн туслалцаа хэрэгтэй)
    let score = 50 + (r.deal_type === 'sale' ? 15 : 5) + Math.max(0, 15 - age) + (r.images <= 3 ? 10 : 0) + (vs != null && vs >= 5 ? 8 : 0) + (r.prev_price && r.prev_price > r.price ? 6 : 0) + (r.poster_listings === 1 ? 5 : 0);
    return { ...r, m2, vsIndex: vs, age, score: Math.min(99, score) };
  }).sort((a, b) => (a.lead_status ? 1 : 0) - (b.lead_status ? 1 : 0) || b.score - a.score);
  res.json({ leads: out, claimed, days, counts, locations, filters: { category: cat, deal, city, district, khoroolol } });
}));
app.post('/api/leads/:lid/claim', wrap(async (req, res) => {
  const l = await db.one('SELECT * FROM market_listings WHERE id=?', req.params.lid);
  if (!l) return res.status(404).json({ error: 'Зар олдсонгүй' });
  const p = l.poster_key ? await db.one('SELECT * FROM posters WHERE key=?', l.poster_key) : null;
  const ex = await db.one('SELECT * FROM leads WHERE company_id=? AND listing_id=?', req.user.company_id, l.id);
  if (ex) return res.json({ ok: true, lead: ex, existed: true });
  // Харилцагч (эзэн) — утасгүй; агент холбогдсоны дараа зөвшөөрөлтэйгээр нөхнө
  const c = await db.one("INSERT INTO clients (company_id, name, phone, type, notes) VALUES (?,?,?,?,?) RETURNING id", req.user.company_id, (p && p.name) || 'Зарын эзэн', '', l.deal_type === 'rent' ? 'landlord' : 'seller', `Зарын эзэн (lead): ${l.title || ''} · ${l.district} ${l.khoroolol || ''} · ${l.rooms}ө ${l.area}м² · ${l.price} сая · эх: ${l.source_url || l.source}. Утас — эх зарын «Дугаар харах»-аар холбогдож, зөвшөөрөлтэйгээр бүртгэнэ.`);
  const lead = await db.one("INSERT INTO leads (company_id, listing_id, status, agent_id, client_id, note) VALUES (?,?,'working',?,?,?) RETURNING *", req.user.company_id, l.id, req.user.id, c.id, String(req.body && req.body.note || ''));
  res.json({ ok: true, lead, client_id: c.id });
}));
app.put('/api/leads/:lid', wrap(async (req, res) => {
  const st = ['new', 'working', 'contacted', 'signed', 'rejected'].includes(req.body.status) ? req.body.status : 'working';
  await db.run("INSERT INTO leads (company_id, listing_id, status, agent_id, note) VALUES (?,?,?,?,?) ON CONFLICT (company_id, listing_id) DO UPDATE SET status=EXCLUDED.status, note=COALESCE(NULLIF(EXCLUDED.note,''), leads.note)", req.user.company_id, req.params.lid, st, req.user.id, String(req.body.note || ''));
  res.json({ ok: true });
}));
app.get('/api/posters/:key', wrap(async (req, res) => {
  const p = await db.one('SELECT * FROM posters WHERE key=?', req.params.key); if (!p) return res.status(404).json({ error: 'Олдсонгүй' });
  const listings = await db.all('SELECT id, title, category, deal_type, district, khoroolol, rooms, area, price, active, listed_at, source_url FROM market_listings WHERE poster_key=? ORDER BY id DESC LIMIT 50', p.key);
  res.json({ poster: p, listings });
}));
// Объектод тохирох худалдан авагчид (А4 урвуу): компанийн нээлттэй хүсэлтүүдийг оноогоор
app.get('/api/properties/:id/buyers', wrap(async (req, res) => {
  const p = await db.one('SELECT * FROM properties WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!p) return res.status(404).json({ error: 'Объект олдсонгүй' });
  const reqs = await db.all("SELECT r.*, c.name client_name, c.phone client_phone, u.name agent_name FROM requests r JOIN clients c ON c.id=r.client_id LEFT JOIN users u ON u.id=r.agent_id WHERE r.company_id=? AND r.status<>'closed'", req.user.company_id);
  const out = reqs.map((r) => ({ ...r, score: A.matchScore(r, p) })).filter((r) => r.score >= 40).sort((a, b) => b.score - a.score);
  res.json({ property: p, buyers: out, total: reqs.length });
}));

// ---- Цуглуулагч ----
// Ботын ил бодлогын хуудас — UA доторх холбоос энд заана (эх сурвалжийн админ юу, яаж, хэрхэн хасуулахыг харна)
app.get('/bot', (req, res) => {
  const contact = process.env.ZUUCH_BOT_CONTACT || 'smartzuuch.mn@gmail.com';
  res.type('html').send(`<!doctype html><html lang="mn"><head><meta charset="utf-8"><title>ZuuchBot — ажиглах горимын бот</title>
<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:Inter,system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;line-height:1.55;color:#0f172a}h1{color:#2563eb}code{background:#eff6ff;padding:1px 5px;border-radius:4px}li{margin:4px 0}</style></head><body>
<h1>ZuuchBot</h1>
<p>Энэ бот нь <b>«Зууч»</b> — Монголын үл хөдлөх хөрөнгийн зуучлалын компаниудад зориулсан дотоод шинжилгээний платформын <b>зах зээлийн ажиглагч</b> юм.</p>
<h3>Юу хийдэг вэ</h3>
<ul><li>Нийтэд ил орон сууцны зарын <b>баримт</b> (үнэ, талбай, өрөө, дүүрэг, огноо) л уншиж, дүүргийн үнийн индекс, дундаж хугацаа зэрэг <b>нэгтгэсэн статистик</b> гаргана.</li>
<li>Зарын <b>тайлбар, зураг, утасны дугаар хадгалахгүй</b>; зарыг дахин нийтлэхгүй, олон нийтэд түгээхгүй.</li>
<li><code>robots.txt</code>-г мөрдөнө; хүсэлт хооронд ≥4 сек зайтай, цөөн хуудас (ойролцоогоор 10 минут тутам 5–15 хуудас); 429/5xx хариунд 10 мин зогсоно.</li></ul>
<h3>User-Agent</h3><p><code>${collector.status ? 'ZuuchBot/1.0 (+https://zuuch-production.up.railway.app/bot)' : ''}</code></p>
<h3>Хасуулах / асуулт</h3><p>Эх сурвалжийн админ эсвэл зарын эзэн: <b>${contact}</b> — хүсэлт ирмэгц тухайн зар/эх сурвалжийг 24 цагийн дотор хасаж, дахин уншихыг хориглоно.</p>
<p style="color:#64748b;font-size:13px">This is a low-rate, read-only monitoring crawler for aggregate real-estate market statistics in Mongolia. It respects robots.txt, sends ≤1 request / 4 s, stores facts only (no photos, descriptions or phone numbers). Contact ${contact} to opt out.</p>
</body></html>`);
});
app.get('/api/collector/status', wrap(async (req, res) => res.json(await collector.status())));
app.post('/api/collector/start', zahiralOnly, wrap(async (req, res) => { collector.start(); res.json(await collector.status()); }));
app.post('/api/collector/stop', zahiralOnly, wrap(async (req, res) => { collector.stop(); res.json(await collector.status()); }));
app.post('/api/collector/reset', zahiralOnly, wrap(async (req, res) => { await collector.reset(); res.json(await collector.status()); }));
app.post('/api/collector/takedown', zahiralOnly, wrap(async (req, res) => { const r = await collector.takedownLatest(); res.json({ ...r, ...(await collector.status()) }); }));

// ---- Ш3а: Листингийн AI студи ----
const UPLOAD_DIR = process.env.ZUUCH_UPLOADS || (process.env.RAILWAY_VOLUME_MOUNT_PATH ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'uploads') : path.join(__dirname, 'uploads')); // Railway: байнгын диск (deploy бүрт устахгүй)
const aml = require('./aml/routes')(app, { db, wrap, ownerOnly, UPLOAD_DIR }); // комплаенс: МУТСТ + СЗХ
const photofix = require('./photofix'); // зургийн автомат засвар (өнцөг, перспектив, цагаан тэнцвэр, гэрэл)
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => { const d = path.join(UPLOAD_DIR, String(req.user.company_id), String(req.params.pid)); fs.mkdirSync(d, { recursive: true }); cb(null, d); },
    filename: (req, file, cb) => cb(null, crypto.randomBytes(8).toString('hex') + (path.extname(file.originalname || '').toLowerCase() || '.jpg')),
  }),
  limits: { files: 30, fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(file.mimetype)),
});
async function ownProperty(req) { return db.one('SELECT * FROM properties WHERE id=? AND company_id=?', req.params.pid, req.user.company_id); }
const assetPath = (a) => path.join(UPLOAD_DIR, String(a.company_id), String(a.property_id), a.filename);
const assetUse = (a) => (a.enh_file ? path.join(UPLOAD_DIR, String(a.company_id), String(a.property_id), a.enh_file) : assetPath(a)); // засвартай бол засварласныг (AI шинжилгээ, харагдац)

app.get('/api/studio/:pid', wrap(async (req, res) => {
  const prop = await ownProperty(req);
  if (!prop) return res.status(404).json({ error: 'Объект олдсонгүй' });
  const assets = await db.all('SELECT id, filename, mime, size, room, quality, wow, issues, rank, enh_mode, enh_note, created_at FROM listing_assets WHERE company_id=? AND property_id=? AND COALESCE(kind,\'photo\')=\'photo\' ORDER BY CASE WHEN rank>0 THEN rank ELSE 9999 END, id', req.user.company_id, prop.id);
  const draft = await db.one('SELECT * FROM listing_drafts WHERE company_id=? AND property_id=? ORDER BY id DESC LIMIT 1', req.user.company_id, prop.id);
  res.json({ property: prop, assets, draft, ai: !!process.env.ANTHROPIC_API_KEY, enhance: fixJobs.get(`${req.user.company_id}:${prop.id}`) || null });
}));
app.post('/api/studio/:pid/photos', wrap(async (req, res, next) => {
  const prop = await ownProperty(req);
  if (!prop) return res.status(404).json({ error: 'Объект олдсонгүй' });
  upload.array('photos', 30)(req, res, async (err) => {
    if (err) return res.status(400).json({ error: 'Зураг оруулахад алдаа: ' + err.message });
    try {
      const ids = [];
      for (const f of req.files || []) {
        const r = await db.one('INSERT INTO listing_assets (company_id, property_id, filename, mime, size) VALUES (?,?,?,?,?) RETURNING id', req.user.company_id, prop.id, f.filename, f.mimetype, f.size);
        ids.push(r.id);
      }
      res.json({ ok: true, added: ids.length, ids });
    } catch (e) { next(e); }
  });
}));
app.get('/api/studio/asset/:id', wrap(async (req, res) => {
  const a = await db.one('SELECT * FROM listing_assets WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!a) return res.status(404).end();
  res.setHeader('Cache-Control', 'private, max-age=3600');
  if (a.enh_file && req.query.v !== 'orig') return res.type('image/jpeg').sendFile(assetUse(a));
  res.type(a.mime || 'image/jpeg').sendFile(assetPath(a));
}));
app.delete('/api/studio/asset/:id', wrap(async (req, res) => {
  const a = await db.one('SELECT * FROM listing_assets WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!a) return res.status(404).json({ error: 'Олдсонгүй' });
  await db.run('DELETE FROM listing_assets WHERE id=?', a.id);
  fs.promises.unlink(assetPath(a)).catch(() => {}); if (a.enh_file) fs.promises.unlink(assetUse(a)).catch(() => {});
  res.json({ ok: true });
}));
// Зургийн автомат засвар (AI-гүй, үнэгүй): mode = 'natural' (бодит) | 'vivid' (тод) | 'none' (засваргүй — эх рүү буцаана). Арын горимд, явцыг асууна.
const fixJobs = new Map(); // "company:pid" → { status, done, total, msg }
app.post('/api/studio/:pid/enhance', wrap(async (req, res) => {
  const prop = await ownProperty(req); if (!prop) return res.status(404).json({ error: 'Объект олдсонгүй' });
  const mode = ['natural', 'vivid', 'none'].includes((req.body || {}).mode) ? req.body.mode : 'natural'; const only = Array.isArray((req.body || {}).ids) ? req.body.ids.map(Number) : null;
  const key = `${req.user.company_id}:${prop.id}`; const cur = fixJobs.get(key); if (cur && cur.status === 'running') return res.json(cur);
  const rows = (await db.all("SELECT * FROM listing_assets WHERE company_id=? AND property_id=? AND COALESCE(kind,'photo')='photo' ORDER BY id", req.user.company_id, prop.id)).filter((a) => !only || only.includes(a.id));
  const job = { status: 'running', done: 0, total: rows.length, mode, msg: '' }; fixJobs.set(key, job); res.json(job);
  for (const a of rows) {
    try {
      if (a.enh_file) await fs.promises.unlink(path.join(path.dirname(assetPath(a)), a.enh_file)).catch(() => {});
      if (mode === 'none') { await db.run('UPDATE listing_assets SET enh_file=NULL, enh_mode=NULL, enh_note=NULL WHERE id=?', a.id); }
      else { const out = a.filename.replace(/\.[a-z0-9]+$/i, '') + '-' + mode + '.jpg'; const r = await photofix.fix(assetPath(a), path.join(path.dirname(assetPath(a)), out), mode); await db.run('UPDATE listing_assets SET enh_file=?, enh_mode=?, enh_note=? WHERE id=?', out, mode, r.note, a.id); }
    } catch (e) { job.msg = 'Зарим зураг засагдсангүй: ' + e.message.slice(0, 120); }
    job.done++;
  }
  job.status = 'done';
}));
app.get('/api/studio/:pid/enhance', wrap(async (req, res) => res.json(fixJobs.get(`${req.user.company_id}:${Number(req.params.pid)}`) || null)));
app.post('/api/studio/:pid/analyze', paid('pid'), wrap(async (req, res) => {
  const prop = await ownProperty(req);
  if (!prop) return res.status(404).json({ error: 'Объект олдсонгүй' });
  const rows = await db.all("SELECT * FROM listing_assets WHERE company_id=? AND property_id=? AND COALESCE(kind,'photo')='photo' ORDER BY id", req.user.company_id, prop.id);
  const assets = rows.map(a => ({ ...a, path: assetUse(a), mime: a.enh_file ? 'image/jpeg' : a.mime })); // засвартай бол засварласан зургийг шинжилнэ
  const [loc, val] = await Promise.all([
    db.one('SELECT local_pois FROM tours WHERE company_id=? AND property_id=?', req.user.company_id, prop.id).then((t) => A.locationScore(prop.district, prop.lat, prop.lng, (t && t.local_pois) || [])), // цэгийн түвшний А8 + бодит зай + оршин суугчийн нэмсэн газар
    prop.deal_type === 'sale' ? A.valuation({ district: prop.district, rooms: prop.rooms, area: prop.area, isNew: !!prop.is_new, floor: prop.floor, totalFloors: prop.total_floors }) : null,
  ]);
  const out = await studio.run({ property: prop, assets, loc, val });
  for (const r of out.ranked) await db.run('UPDATE listing_assets SET room=?, quality=?, wow=?, issues=?, rank=? WHERE id=?', r.room, r.quality, r.wow, (r.issues || []).join(', '), r.rank, r.id);
  const draft = await db.one('INSERT INTO listing_drafts (company_id, property_id, model, texts, advantages, price, plan, photo_notes) VALUES (?,?,?,?,?,?,?,?) RETURNING *',
    req.user.company_id, prop.id, out.model, JSON.stringify(out.texts), JSON.stringify(out.advantages), JSON.stringify(out.price), JSON.stringify(out.plan), JSON.stringify(out.photo_notes));
  const assetsOut = await db.all('SELECT id, filename, mime, size, room, quality, wow, issues, rank FROM listing_assets WHERE company_id=? AND property_id=? AND COALESCE(kind,\'photo\')=\'photo\' ORDER BY CASE WHEN rank>0 THEN rank ELSE 9999 END, id', req.user.company_id, prop.id);
  res.json({ property: prop, assets: assetsOut, draft, ai: !!process.env.ANTHROPIC_API_KEY });
}));

// ---- Хуудсууд ----
// ---- Ш3д: Virtual POV Tour ----
const tourLib = require('./tour');
const ROOM_TYPE_OF = { 'зочны': 'living', 'гал тогоо': 'kitchen', 'унтлагын': 'bedroom', 'угаалгын': 'bath', 'коридор': 'hall', 'тагт': 'balcony' };
async function tourProp(req, res) {
  const prop = await db.one('SELECT * FROM properties WHERE id=? AND company_id=?', req.params.pid, req.user.company_id);
  if (!prop) { res.status(404).json({ error: 'Объект олдсонгүй' }); return null; }
  return prop;
}
async function saveTour(companyId, propId, plan) {
  const existing = await db.one('SELECT id, token FROM tours WHERE company_id=? AND property_id=?', companyId, propId);
  if (existing) { await db.run('UPDATE tours SET plan=?, updated_at=NOW() WHERE id=?', JSON.stringify(plan), existing.id); }
  else await db.run('INSERT INTO tours (company_id, property_id, token, plan) VALUES (?,?,?,?)', companyId, propId, tourLib.newToken(), JSON.stringify(plan));
  return db.one('SELECT * FROM tours WHERE company_id=? AND property_id=?', companyId, propId);
}
async function tourAssets(companyId, propId) {
  const rows = await db.all('SELECT id, room, rank, quality, kind, room_id FROM listing_assets WHERE company_id=? AND property_id=? ORDER BY CASE WHEN rank>0 THEN rank ELSE 9999 END, id', companyId, propId);
  return rows.map((a) => ({ id: a.id, room: a.room || '', type: ROOM_TYPE_OF[a.room] || 'other', rank: a.rank, kind: a.kind || 'photo', room_id: a.room_id || null }));
}
// 360° панорам (equirectangular 2:1) — өрөө бүрд нэг; том файл зөвшөөрнө (≤25MB)
const uploadPano = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => { const d = path.join(UPLOAD_DIR, String(req.user.company_id), String(req.params.pid)); fs.mkdirSync(d, { recursive: true }); cb(null, d); },
    filename: (req, file, cb) => cb(null, 'pano_' + crypto.randomBytes(8).toString('hex') + (path.extname(file.originalname || '').toLowerCase() || '.jpg')),
  }),
  limits: { files: 1, fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(file.mimetype)),
});
app.post('/api/tour/:pid/pano', auth, wrap(async (req, res, next) => {
  const prop = await tourProp(req, res); if (!prop) return;
  uploadPano.single('pano')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: 'Панорам оруулахад алдаа: ' + err.message });
    try {
      const roomId = String(req.body.room || '').slice(0, 40);
      if (!req.file || !roomId) return res.status(400).json({ error: 'Өрөө болон зураг шаардлагатай' });
      const old = await db.all("SELECT * FROM listing_assets WHERE company_id=? AND property_id=? AND kind='pano' AND room_id=?", req.user.company_id, prop.id, roomId);
      for (const a of old) { await db.run('DELETE FROM listing_assets WHERE id=?', a.id); fs.promises.unlink(assetPath(a)).catch(() => {}); }
      const r = await db.one("INSERT INTO listing_assets (company_id, property_id, filename, mime, size, kind, room_id, room) VALUES (?,?,?,?,?,'pano',?,'360°') RETURNING id", req.user.company_id, prop.id, req.file.filename, req.file.mimetype, req.file.size, roomId);
      res.json({ ok: true, id: r.id, assets: await tourAssets(req.user.company_id, prop.id) });
    } catch (e) { next(e); }
  });
}));
// Бичлэгийн кадрууд (браузер дээр бичлэгээс гаргасан JPEG) — kind='frame', өрөөний шошготой; AI шинжилгээнд орно, студид харагдахгүй
app.post('/api/tour/:pid/frames', auth, wrap(async (req, res, next) => {
  const prop = await tourProp(req, res); if (!prop) return;
  upload.array('frames', 24)(req, res, async (err) => {
    if (err) return res.status(400).json({ error: 'Кадр оруулахад алдаа: ' + err.message });
    try {
      const room = String(req.body.room || '').slice(0, 40);
      if (req.body.replace === '1') { const old = await db.all("SELECT * FROM listing_assets WHERE company_id=? AND property_id=? AND kind='frame' AND COALESCE(room,'')=?", req.user.company_id, prop.id, room); for (const a of old) { await db.run('DELETE FROM listing_assets WHERE id=?', a.id); fs.promises.unlink(assetPath(a)).catch(() => {}); } }
      let n = 0;
      for (const f of req.files || []) { await db.run("INSERT INTO listing_assets (company_id, property_id, filename, mime, size, kind, room) VALUES (?,?,?,?,?,'frame',?)", req.user.company_id, prop.id, f.filename, f.mimetype, f.size, room || null); n++; }
      const { c } = await db.one("SELECT COUNT(*)::int c FROM listing_assets WHERE company_id=? AND property_id=? AND kind='frame'", req.user.company_id, prop.id);
      res.json({ ok: true, added: n, frames: c });
    } catch (e) { next(e); }
  });
}));
app.delete('/api/tour/:pid/frames', auth, wrap(async (req, res) => {
  const prop = await tourProp(req, res); if (!prop) return;
  const old = await db.all("SELECT * FROM listing_assets WHERE company_id=? AND property_id=? AND kind='frame'", req.user.company_id, prop.id);
  for (const a of old) { await db.run('DELETE FROM listing_assets WHERE id=?', a.id); fs.promises.unlink(assetPath(a)).catch(() => {}); }
  res.json({ ok: true, removed: old.length });
}));
app.delete('/api/tour/:pid/pano/:id', auth, wrap(async (req, res) => {
  const prop = await tourProp(req, res); if (!prop) return;
  const a = await db.one("SELECT * FROM listing_assets WHERE id=? AND company_id=? AND property_id=? AND kind='pano'", req.params.id, req.user.company_id, prop.id);
  if (!a) return res.status(404).json({ error: 'Олдсонгүй' });
  await db.run('DELETE FROM listing_assets WHERE id=?', a.id); fs.promises.unlink(assetPath(a)).catch(() => {});
  res.json({ ok: true, assets: await tourAssets(req.user.company_id, prop.id) });
}));
app.get('/api/tour/:pid', auth, wrap(async (req, res) => {
  const prop = await tourProp(req, res); if (!prop) return;
  let t = await db.one('SELECT * FROM tours WHERE company_id=? AND property_id=?', req.user.company_id, prop.id);
  if (!t) t = await saveTour(req.user.company_id, prop.id, tourLib.autoPlan(prop));
  res.json({ tour: t, property: prop, assets: await tourAssets(req.user.company_id, prop.id), types: tourLib.TYPES });
}));
// ---- Бодит медиа: хэсэгчилсэн upload (8 MB), боловсруулалт, жагсаалт, засвар ----
app.get('/api/tour/:pid/media', auth, wrap(async (req, res) => {
  const prop = await tourProp(req, res); if (!prop) return;
  const items = await db.all('SELECT id, kind, room_id, label, seq, projection, status, msg, orig_name, orig_size, size, duration, width, height, (track IS NOT NULL) AS has_track, meta, created_at FROM tour_media WHERE company_id=? AND property_id=? ORDER BY kind, seq, id', req.user.company_id, prop.id);
  const t = await db.one('SELECT token FROM tours WHERE company_id=? AND property_id=?', req.user.company_id, prop.id);
  const used = items.reduce((s, m) => s + Number(m.size || 0), 0); const disk = media.diskInfo();
  res.json({ items, token: t && t.token, used, disk, limits: media.LIMITS, chunk: media.CHUNK, ffmpeg: !!media.tools().ffmpeg, queue: media.queueLength(),
    status: prop.status, closed_at: prop.closed_at || null, purge_at: prop.status === 'closed' ? retention.purgeDate(prop.closed_at || new Date()) : null, retention_days: retention.RETENTION_DAYS, anon: await media.anon.status() });
}));
app.post('/api/tour/:pid/media/init', auth, paid('pid'), wrap(async (req, res) => {
  const prop = await tourProp(req, res); if (!prop) return; const b = req.body || {};
  const kind = String(b.kind || ''), size = Number(b.size), filename = String(b.filename || '').slice(0, 160);
  const chk = media.canAccept(kind, filename, size); if (chk.error) return res.status(chk.code === 'disk' ? 507 : 400).json({ error: chk.error });
  if (size > guests.MEDIA_MAX && (await guests.info(db, req.user.company_id))) return res.status(400).json({ error: `Танилцуулгын эрхэд нэг файл ${Math.round(guests.MEDIA_MAX / 1048576)} MB хүртэл` });
  let t = await db.one('SELECT id FROM tours WHERE company_id=? AND property_id=?', req.user.company_id, prop.id);
  if (!t) t = await saveTour(req.user.company_id, prop.id, tourLib.autoPlan(prop));
  const roomId = b.room_id ? String(b.room_id).slice(0, 60) : null;
  const seq = Number.isFinite(Number(b.seq)) ? Number(b.seq) : ((await db.one('SELECT COALESCE(MAX(seq),0)+1 AS n FROM tour_media WHERE company_id=? AND property_id=? AND kind=?', req.user.company_id, prop.id, kind)).n);
  const track = Array.isArray(b.track) && b.track.length >= 2 ? JSON.stringify(b.track.slice(0, 20000).map((p) => [+Number(p[0]).toFixed(2), +Number(p[1]).toFixed(6), +Number(p[2]).toFixed(6), p[3] != null ? Math.round(Number(p[3])) : null])) : null;
  const m = await db.one('INSERT INTO tour_media (company_id, property_id, kind, room_id, label, seq, projection, orig_name, orig_size, mime, track, meta) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *',
    req.user.company_id, prop.id, kind, roomId, String(b.label || '').slice(0, 80), seq, ['flat', 'equirect'].includes(b.projection) ? b.projection : null, filename, size, String(b.mime || '').slice(0, 80), track, JSON.stringify({ source: b.source === 'capture' ? 'capture' : 'file' }));
  const s = await media.initUpload({ mediaId: m.id, size, filename });
  res.json({ media_id: m.id, upload_id: s.id, chunk: media.CHUNK, chunks: s.chunks, received: [] });
}));
const ownUpload = async (req, res) => {
  const s = await media.getSession(req.params.uid); if (!s) { res.status(404).json({ error: 'Upload олдсонгүй (хугацаа дууссан?)' }); return null; }
  const m = await db.one('SELECT id, company_id FROM tour_media WHERE id=?', s.mediaId); if (!m || m.company_id !== req.user.company_id) { res.status(403).json({ error: 'Хандах эрхгүй' }); return null; }
  return s;
};
app.get('/api/media/upload/:uid', auth, wrap(async (req, res) => { const s = await ownUpload(req, res); if (!s) return; res.json({ received: [...s.received], chunks: s.chunks, chunk: media.CHUNK }); }));
app.put('/api/media/upload/:uid/:index', auth, express.raw({ type: () => true, limit: media.CHUNK + 1024 * 1024 }), wrap(async (req, res) => {
  const s = await ownUpload(req, res); if (!s) return;
  const n = await media.writeChunk(s, req.params.index, req.body); res.json({ ok: true, received: n, chunks: s.chunks });
}));
app.post('/api/media/upload/:uid/complete', auth, wrap(async (req, res) => {
  const s = await ownUpload(req, res); if (!s) return;
  const file = await media.finishUpload(s);
  await db.run("UPDATE tour_media SET status='processing', msg='Дараалалд…' WHERE id=?", s.mediaId); media.enqueue(s.mediaId, file);
  res.json({ ok: true, media_id: s.mediaId, queue: media.queueLength() });
}));
app.delete('/api/media/upload/:uid', auth, wrap(async (req, res) => { const s = await ownUpload(req, res); if (!s) return; await media.abortUpload(s); await db.run('DELETE FROM tour_media WHERE id=? AND status=\'uploading\'', s.mediaId); res.json({ ok: true }); }));
app.put('/api/tour/:pid/media/:id', auth, wrap(async (req, res) => {
  const prop = await tourProp(req, res); if (!prop) return; const b = req.body || {};
  const m = await db.one('SELECT * FROM tour_media WHERE id=? AND company_id=? AND property_id=?', Number(req.params.id), req.user.company_id, prop.id); if (!m) return res.status(404).json({ error: 'Олдсонгүй' });
  const meta = { ...(m.meta || {}) }; if (Array.isArray(b.rot) && b.rot.length === 3) meta.rot = b.rot.map((v) => ((Math.round(Number(v) / 90) * 90) % 360 + 360) % 360); // splat эргүүлэлт (X,Y,Z градус, 90-ээр)
  await db.run('UPDATE tour_media SET label=?, seq=?, room_id=?, meta=? WHERE id=?', b.label != null ? String(b.label).slice(0, 80) : m.label, Number.isFinite(Number(b.seq)) ? Number(b.seq) : m.seq, b.room_id !== undefined ? (b.room_id ? String(b.room_id).slice(0, 60) : null) : m.room_id, JSON.stringify(meta), m.id);
  res.json({ ok: true });
}));
// GPS зам: GPX эсвэл [[t, lat, lng], …] — бичлэгийн хугацаатай тааруулна (GPX-ийн цагийг эхлэлээс секунд болгоно)
// Гараар бүдгэрүүлэх (автомат илрүүлэгч алдсан хэсэг): regions = [{ k: [{ t, b: [x1,y1,x2,y2] (0..1) }], hold }] — одоогийн файл дээр мозайк нэмнэ
app.post('/api/tour/:pid/media/:id/blur', auth, wrap(async (req, res) => {
  const prop = await tourProp(req, res); if (!prop) return;
  const m = await db.one('SELECT * FROM tour_media WHERE id=? AND company_id=? AND property_id=?', Number(req.params.id), req.user.company_id, prop.id); if (!m) return res.status(404).json({ error: 'Олдсонгүй' });
  if (m.status !== 'ready' || !['walk_ext', 'walk_in', 'pano'].includes(m.kind)) return res.status(400).json({ error: 'Зөвхөн бэлэн болсон бичлэг эсвэл 360 зураг' });
  const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null; };
  const regions = []; const dur = Number(m.duration) || 0;
  for (const r of Array.isArray(req.body && req.body.regions) ? req.body.regions.slice(0, 60) : []) {
    const k = (Array.isArray(r.k) ? r.k : []).slice(0, 30).map((x) => { const b = (Array.isArray(x.b) ? x.b : []).map((v) => num(v, 0, 1)); return { t: num(x.t, 0, Math.max(dur, 0)) || 0, b }; })
      .filter((x) => x.b.length === 4 && !x.b.includes(null) && x.b[2] - x.b[0] > 0.002 && x.b[3] - x.b[1] > 0.002);
    if (k.length) regions.push({ k, hold: num(r.hold, 0, 600) || 0 });
  }
  if (!regions.length) return res.status(400).json({ error: 'Бүдгэрүүлэх хэсэг зураагүй байна' });
  await db.run("UPDATE tour_media SET status='processing', msg='Гараар бүдгэрүүлэх — дараалалд…' WHERE id=?", m.id);
  media.enqueue(m.id, null, { op: 'reblur', regions }); res.json({ ok: true, regions: regions.length, queue: media.queueLength() });
}));
app.post('/api/tour/:pid/media/:id/track', auth, express.raw({ type: () => true, limit: '20mb' }), wrap(async (req, res) => {
  const prop = await tourProp(req, res); if (!prop) return;
  const m = await db.one('SELECT id FROM tour_media WHERE id=? AND company_id=? AND property_id=?', Number(req.params.id), req.user.company_id, prop.id); if (!m) return res.status(404).json({ error: 'Олдсонгүй' });
  const txt = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || ''); let pts = [];
  if (/<gpx|<trkpt/i.test(txt)) { let t0 = null; for (const mm of txt.matchAll(/<trkpt[^>]*lat="([-\d.]+)"[^>]*lon="([-\d.]+)"[^>]*>([\s\S]*?)<\/trkpt>/g)) { const tm = /<time>([^<]+)<\/time>/.exec(mm[3]); const ts = tm ? Date.parse(tm[1]) / 1000 : null; if (t0 == null && ts != null) t0 = ts; pts.push([ts != null ? +(ts - t0).toFixed(1) : pts.length, +Number(mm[1]).toFixed(6), +Number(mm[2]).toFixed(6), null]); } }
  else { try { const j = JSON.parse(txt); pts = (Array.isArray(j) ? j : j.track || []).map((p) => [Number(p[0]), Number(p[1]), Number(p[2]), p[3] != null ? Number(p[3]) : null]); } catch { /* */ } }
  pts = pts.filter((p) => Number.isFinite(p[1]) && Number.isFinite(p[2]) && Math.abs(p[1]) <= 90).slice(0, 20000);
  if (pts.length < 2) return res.status(400).json({ error: 'GPS зам уншигдсангүй (GPX эсвэл JSON)' });
  await db.run('UPDATE tour_media SET track=? WHERE id=?', JSON.stringify(pts), m.id); res.json({ ok: true, points: pts.length });
}));
app.delete('/api/tour/:pid/media/:id', auth, wrap(async (req, res) => {
  const prop = await tourProp(req, res); if (!prop) return;
  const m = await db.one('SELECT * FROM tour_media WHERE id=? AND company_id=? AND property_id=?', Number(req.params.id), req.user.company_id, prop.id); if (!m) return res.status(404).json({ error: 'Олдсонгүй' });
  if (m.status === 'processing') return res.status(409).json({ error: 'Боловсруулж байна — дууссаны дараа устгана уу' });
  await media.removeFiles(m); await db.run('DELETE FROM tour_media WHERE id=?', m.id); res.json({ ok: true });
}));
// RoomPlan (iPhone Pro LiDAR) JSON → план: ?apply=1 бол аяллын планыг солино, үгүй бол урьдчилан харна
app.post('/api/tour/:pid/roomplan', auth, express.raw({ type: () => true, limit: '50mb' }), wrap(async (req, res) => {
  const prop = await tourProp(req, res); if (!prop) return;
  let r; try { r = roomplan.convert(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body); } catch (e) { return res.status(400).json({ error: 'RoomPlan JSON уншигдсангүй: ' + e.message }); }
  if (req.query.apply === '1') { const t = await saveTour(req.user.company_id, prop.id, tourLib.finalize(r.plan)); return res.json({ ok: true, applied: true, ...r, tour: t }); }
  res.json({ ok: true, ...r, preview: tourLib.finalize(r.plan) });
}));
// Хуваалцах холбоосын нууцлал: компанийн нэр нуух, хаягийг зөвхөн дүүргээр
app.put('/api/tour/:pid/settings', auth, wrap(async (req, res) => {
  const prop = await tourProp(req, res); if (!prop) return; const b = req.body || {};
  const st = { hideCompany: !!b.hideCompany, districtOnly: !!b.districtOnly };
  let t = await db.one('SELECT id FROM tours WHERE company_id=? AND property_id=?', req.user.company_id, prop.id);
  if (!t) t = await saveTour(req.user.company_id, prop.id, tourLib.autoPlan(prop));
  await db.run('UPDATE tours SET settings=? WHERE id=?', JSON.stringify(st), t.id);
  res.json({ ok: true, settings: st });
}));
app.post('/api/tour/:pid/auto', auth, wrap(async (req, res) => {
  const prop = await tourProp(req, res); if (!prop) return;
  const t = await saveTour(req.user.company_id, prop.id, tourLib.autoPlan(prop));
  res.json({ tour: t });
}));
app.put('/api/tour/:pid', auth, wrap(async (req, res) => {
  const prop = await tourProp(req, res); if (!prop) return;
  const plan = tourLib.finalize(req.body && req.body.plan ? req.body.plan : {});
  if (!plan.rooms.length) return res.status(400).json({ error: 'Дор хаяж нэг өрөө хэрэгтэй' });
  const t = await saveTour(req.user.company_id, prop.id, plan);
  res.json({ tour: t });
}));
// Ш3д-3 Гадаах орчны 3D нислэг: OSM (+ Google Routes цаг тус бүр) → tours.exterior. Удаан (1–3 мин) тул арын горимд, төлөвийг асууна.
const extJobs = new Map(); // "company:pid" → { status, msg, started, error }
// Гадаах орчин бэлтгэх (арын горим): хотын хавтан сан (эсвэл OSM) + агент/оршин суугчийн ойрын газар; keepStudy — замын хугацааг дахин тооцохгүй (Google Routes зардалгүй), хуучнаа хадгална
function startExterior(companyId, prop, { keepStudy = false } = {}) {
  const key = `${companyId}:${prop.id}`; const cur = extJobs.get(key);
  if (cur && cur.status === 'running') return cur;
  const job = { status: 'running', msg: 'Эхэлж байна…', started: new Date().toISOString() }; extJobs.set(key, job);
  (async () => {
    try {
      // Хотын хавтан сангийн хүрээнд: Overpass-гүй, Overture контур + GHSL өндөр + нэгтгэсэн орчны цэг (өндөр чанар, хурдан); гадуур — шууд OSM
      const geo = geostore.covers(prop.lat, prop.lng) ? geostore.options(prop.lat, prop.lng) : null;
      if (geo) job.msg = 'Хотын хавтан сангаас бэлтгэж байна…';
      const lr = await db.one('SELECT local_pois, exterior->\'study\' AS study FROM tours WHERE company_id=? AND property_id=?', companyId, prop.id);
      const local = ((lr && lr.local_pois) || []).map((q) => ({ ...q, src: 'agent', verified: true }));
      const reuse = keepStudy && lr && lr.study;
      const data = await exterior.generate(prop.lat, prop.lng, { ...(geo || {}), extraPois: [...local, ...((geo && geo.extraPois) || [])], commuteHours: !reuse, log: (m) => { job.msg = m; } });
      if (reuse && !data.study) data.study = lr.study;
      data.data_source = geo ? { kind: 'geostore', ...(geostore.info() || {}) } : { kind: 'overpass' };
      let t = await db.one('SELECT id FROM tours WHERE company_id=? AND property_id=?', companyId, prop.id);
      if (!t) t = await saveTour(companyId, prop.id, tourLib.autoPlan(prop));
      await db.run('UPDATE tours SET exterior=?, updated_at=NOW() WHERE company_id=? AND property_id=?', JSON.stringify(data), companyId, prop.id);
      Object.assign(job, { status: 'done', msg: `Бэлэн: ${data.buildings.length} барилга, ${data.pois.length} цэг` });
    } catch (e) { Object.assign(job, { status: 'error', msg: String(e.message || e).slice(0, 200) }); }
  })();
  return job;
}
app.post('/api/tour/:pid/exterior', auth, paid('pid'), wrap(async (req, res) => {
  const prop = await tourProp(req, res); if (!prop) return;
  if (!Number.isFinite(prop.lat) || !Number.isFinite(prop.lng)) return res.status(400).json({ error: 'Объектын байршлыг газрын зураг дээр заана уу (lat/lng)' });
  res.status(202).json(startExterior(req.user.company_id, prop));
}));
// ---- Эзний аяллын хэрэгсэл: бүх компанийн аялал, дахин бэлтгэх, нэг файлаар объект + план + ойрын газар оруулах ----
app.put('/api/owner/tours/:id/settings', ownerOnly, wrap(async (req, res) => {
  const t = await db.one('SELECT id, settings FROM tours WHERE id=?', Number(req.params.id)); if (!t) return res.status(404).json({ error: 'Аялал олдсонгүй' });
  const b = req.body || {}, cur = t.settings || {};
  const st = { hideCompany: b.hideCompany !== undefined ? !!b.hideCompany : !!cur.hideCompany, districtOnly: b.districtOnly !== undefined ? !!b.districtOnly : !!cur.districtOnly };
  await db.run('UPDATE tours SET settings=? WHERE id=?', JSON.stringify(st), t.id); res.json({ ok: true, settings: st });
}));
app.get('/api/owner/tours', ownerOnly, wrap(async (req, res) => {
  const rows = await db.all(`SELECT t.id, t.token, t.company_id, c.name AS company, p.id AS property_id, p.district, p.khoroolol, p.rooms, p.area, p.lat, p.lng,
      t.exterior->>'generated_at' AS ext_at, t.exterior->'data_source'->>'kind' AS ext_src, jsonb_typeof(t.exterior->'study') = 'object' AS study,
      jsonb_array_length(COALESCE(t.local_pois, '[]'::jsonb)) AS local, jsonb_array_length(COALESCE(t.plan->'rooms', '[]'::jsonb)) AS rooms_n, t.settings, t.updated_at
    FROM tours t JOIN properties p ON p.id=t.property_id JOIN companies c ON c.id=t.company_id ORDER BY t.updated_at DESC NULLS LAST LIMIT 200`);
  res.json({ items: rows.map((r) => ({ ...r, job: extJobs.get(`${r.company_id}:${r.property_id}`) || null })) });
}));
app.post('/api/owner/tours/:id/exterior', ownerOnly, wrap(async (req, res) => {
  const t = await db.one('SELECT company_id, property_id FROM tours WHERE id=?', Number(req.params.id)); if (!t) return res.status(404).json({ error: 'Аялал олдсонгүй' });
  const prop = await db.one('SELECT * FROM properties WHERE id=?', t.property_id);
  if (!prop || !Number.isFinite(prop.lat)) return res.status(400).json({ error: 'Объектын байршил алга' });
  res.status(202).json(startExterior(t.company_id, prop, { keepStudy: !(req.body && req.body.commute) }));
}));
// Импорт: { company | company_id, property:{district,khoroolol,rooms,area,floor,total_floors,lat,lng,notes,deal_type,price}, plan:{rooms,entry,ceiling}, local:[{cat,name,lat,lng}] }
app.post('/api/owner/import', ownerOnly, wrap(async (req, res) => {
  const b = req.body || {}; const pr = b.property || {};
  const lat = Number(pr.lat), lng = Number(pr.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'property.lat / property.lng шаардлагатай' });
  let c = b.company_id ? await db.one('SELECT id FROM companies WHERE id=?', Number(b.company_id)) : b.company ? await db.one('SELECT id FROM companies WHERE name=?', String(b.company)) : null;
  if (!c && b.company) c = await db.one("INSERT INTO companies (name, plan, status) VALUES (?, 'demo', 'active') RETURNING id", String(b.company).slice(0, 80));
  if (!c) return res.status(400).json({ error: 'company эсвэл company_id шаардлагатай' });
  const f = { district: String(pr.district || '').slice(0, 40), khoroolol: String(pr.khoroolol || '').slice(0, 80), rooms: Number(pr.rooms) || 1, area: Number(pr.area) || 0, floor: Number(pr.floor) || 0, total_floors: Number(pr.total_floors) || 0, price: Number(pr.price) || 0, deal_type: pr.deal_type === 'rent' ? 'rent' : 'sale', notes: String(pr.notes || '').slice(0, 500) };
  let p = await db.one('SELECT id FROM properties WHERE company_id=? AND ABS(lat-?)<0.0001 AND ABS(lng-?)<0.0001 ORDER BY id LIMIT 1', c.id, lat, lng);
  if (p) await db.run('UPDATE properties SET district=?, khoroolol=?, rooms=?, area=?, floor=?, total_floors=?, price=?, deal_type=?, notes=?, lat=?, lng=? WHERE id=?', f.district, f.khoroolol, f.rooms, f.area, f.floor, f.total_floors, f.price, f.deal_type, f.notes, lat, lng, p.id);
  else p = await db.one("INSERT INTO properties (company_id, deal_type, district, khoroolol, rooms, area, floor, total_floors, price, status, notes, lat, lng) VALUES (?,?,?,?,?,?,?,?,?,'active',?,?,?) RETURNING id", c.id, f.deal_type, f.district, f.khoroolol, f.rooms, f.area, f.floor, f.total_floors, f.price, f.notes, lat, lng);
  const prop = await db.one('SELECT * FROM properties WHERE id=?', p.id);
  const plan = b.plan && Array.isArray(b.plan.rooms) && b.plan.rooms.length ? tourLib.finalize(b.plan) : tourLib.autoPlan(prop);
  const t = await saveTour(c.id, p.id, plan);
  if (Array.isArray(b.local)) {
    const kx = Math.cos((lat * Math.PI) / 180) * 111320;
    const items = b.local.slice(0, 60).map((q) => ({ cat: String(q.cat || ''), name: String(q.name || '').slice(0, 60), lat: +Number(q.lat).toFixed(6), lng: +Number(q.lng).toFixed(6) }))
      .filter((q) => exterior.CAT[q.cat] && Number.isFinite(q.lat) && Number.isFinite(q.lng) && Math.hypot((q.lng - lng) * kx, (q.lat - lat) * 110540) <= 2500);
    await db.run('UPDATE tours SET local_pois=? WHERE id=?', JSON.stringify(items), t.id);
  }
  const job = startExterior(c.id, prop, { keepStudy: b.commute === false });
  res.json({ ok: true, company_id: c.id, property_id: p.id, tour_id: t.id, token: t.token, url: '/tour/' + t.token, rooms: plan.rooms.length, job });
}));
// Ойрын газар (агент/оршин суугчийн баталсан): нээлттэй газрын зурагт байхгүй дэлгүүр, эмийн сан, тоглоомын талбай г.м. — дараагийн «бэлтгэх»-д нэгтгэгдэнэ
app.get('/api/tour/:pid/local-pois', auth, wrap(async (req, res) => {
  const prop = await tourProp(req, res); if (!prop) return;
  const t = await db.one('SELECT local_pois FROM tours WHERE company_id=? AND property_id=?', req.user.company_id, prop.id);
  res.json({ items: (t && t.local_pois) || [], cats: Object.fromEntries(Object.entries(exterior.CAT).map(([k, v]) => [k, v.mn])), center: { lat: prop.lat, lng: prop.lng } });
}));
app.put('/api/tour/:pid/local-pois', auth, wrap(async (req, res) => {
  const prop = await tourProp(req, res); if (!prop) return;
  if (!Number.isFinite(prop.lat) || !Number.isFinite(prop.lng)) return res.status(400).json({ error: 'Объектын байршлыг эхлээд заана уу' });
  const kx = Math.cos((prop.lat * Math.PI) / 180) * 111320;
  const items = (Array.isArray(req.body && req.body.items) ? req.body.items : []).slice(0, 60).map((q) => ({ cat: String(q.cat || ''), name: String(q.name || '').trim().slice(0, 60), lat: Number(q.lat), lng: Number(q.lng) }))
    .filter((q) => exterior.CAT[q.cat] && Number.isFinite(q.lat) && Number.isFinite(q.lng) && Math.hypot((q.lng - prop.lng) * kx, (q.lat - prop.lat) * 110540) <= 2500)
    .map((q) => ({ ...q, lat: +q.lat.toFixed(6), lng: +q.lng.toFixed(6) }));
  let t = await db.one('SELECT id FROM tours WHERE company_id=? AND property_id=?', req.user.company_id, prop.id);
  if (!t) t = await saveTour(req.user.company_id, prop.id, tourLib.autoPlan(prop));
  await db.run('UPDATE tours SET local_pois=?, updated_at=NOW() WHERE company_id=? AND property_id=?', JSON.stringify(items), req.user.company_id, prop.id);
  res.json({ ok: true, items });
}));
// Хотын хавтан сан Ш2: аль ч цэгийн алхалтын хүртээмж (ангилал бүрийн хамгийн ойр байгууллага, зай, минут, алхалтын оноо)
app.get('/api/geo/access', auth, wrap(async (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat/lng шаардлагатай' });
  const a = geostore.access(lat, lng);
  res.json(a ? { ok: true, ...a, labels: Object.fromEntries(Object.keys(a.cats).map((k) => [k, (exterior.CAT[k] || {}).mn || k])) } : { ok: false, error: 'Энэ байршил хотын өгөгдлийн сангийн хүрээнээс гадуур' });
}));
app.get('/api/geo/info', auth, wrap(async (req, res) => res.json(geostore.info() || { error: 'хавтан сан алга' })));
app.get('/api/tour/:pid/exterior', auth, wrap(async (req, res) => {
  const prop = await tourProp(req, res); if (!prop) return;
  const job = extJobs.get(`${req.user.company_id}:${prop.id}`) || null;
  const t = await db.one("SELECT (exterior IS NOT NULL) AS has, exterior->>'generated_at' AS at, jsonb_array_length(COALESCE(exterior->'pois','[]'::jsonb)) AS pois FROM tours WHERE company_id=? AND property_id=?", req.user.company_id, prop.id);
  res.json({ job, has: !!(t && t.has), generated_at: t && t.at, pois: t ? t.pois : 0, geostore: Number.isFinite(prop.lat) && geostore.covers(prop.lat, prop.lng) });
}));
// AI зургийн шинжилгээ → бодит орон зайн параметр (таазны өндөр, хаалга/цонх/довжоо, дам нуруу, шал, ханын өнгө) → plan.style
app.post('/api/tour/:pid/analyze', auth, paid('pid'), wrap(async (req, res) => {
  const prop = await tourProp(req, res); if (!prop) return;
  if (!process.env.ANTHROPIC_API_KEY) return res.status(400).json({ error: 'ANTHROPIC_API_KEY тохируулаагүй' });
  // Студийн зураг + бичлэгийн кадрууд (kind='frame', өрөөний шошготой) — өрөө тус бүрийн зөвлөмж гаргана
  const rows = await db.all("SELECT * FROM listing_assets WHERE company_id=? AND property_id=? AND COALESCE(kind,'photo') IN ('photo','frame') ORDER BY (COALESCE(kind,'photo')='frame'), CASE WHEN rank>0 THEN rank ELSE 9999 END, id LIMIT 20", req.user.company_id, prop.id);
  if (!rows.length) return res.status(400).json({ error: 'Эхлээд Студид зураг эсвэл POV Tour-д бичлэг оруулна уу' });
  const Anthropic = require('@anthropic-ai/sdk'); const ai = new Anthropic();
  const content = [];
  for (let i = 0; i < rows.length; i++) {
    const buf = await fs.promises.readFile(assetUse(rows[i])).catch(() => null); if (!buf) continue;
    content.push({ type: 'text', text: `${rows[i].kind === 'frame' ? 'Бичлэгийн кадр' : 'Зураг'} #${i + 1}${rows[i].room ? ' — өрөө: ' + rows[i].room : ''}` });
    content.push({ type: 'image', source: { type: 'base64', media_type: rows[i].mime || 'image/jpeg', data: buf.toString('base64') } });
  }
  content.push({ type: 'text', text: `Дээрх зураг/кадрууд нь Улаанбаатар дахь нэг орон сууцны бодит зургууд (${prop.rooms} өрөө, ${prop.area} м², ${prop.floor || '?'}/${prop.total_floors || '?'} давхар). Барилгын хэмжээсийг стандарт лавлагаагаар (хаалга ≈2.0–2.1 м, хавтан 0.6 м, цонхны тавцан 0.8–0.9 м, сандал 0.45 м, плита 0.3/0.6 м) тооцоолж 3D дахин бүтээхэд шаардлагатай параметрүүдийг ТААМАГЛА. Тодорхойгүй бол ердийн УБ-ын орон сууцны утга.
Мөн өрөө ТУС БҮРД (зочны, унтлагын, гал тогоо, угаалгын, коридор — зурагт харагдсан өрөөнүүд л): цонхны тоо, цонхны өргөн (м), хаалганы тоо, дам нуруу (зөвхөн ТОДОРХОЙ харагдвал), ханын өнгө (#hex), шал, богино тэмдэглэл.
ЗӨВХӨН JSON: {"ceiling_m":2.7,"door_h":2.05,"window_sill":0.85,"window_top":2.2,"threshold_cm":2,"beams":[],"floor":"parquet|laminate|tile|carpet","wall_color":"#e3d9cb","ceiling_cove":false,"window_style":"vacuum|wood","condition":"шинэ|сайн|дунд|засвар шаардлагатай","notes":["богино тэмдэглэл"],
"rooms":[{"room":"зочны","windows":1,"window_w":1.8,"doors":1,"beams":false,"wall_color":"#e3d9cb","floor":"laminate","notes":"…"}]}` });
  const r = await ai.messages.create({ model: process.env.ZUUCH_AI_MODEL || 'claude-sonnet-5', max_tokens: 6000, messages: [{ role: 'user', content }] });
  const txt = (r.content || []).map((c) => c.text || '').join('');
  let j = null; try { const m = txt.match(/```(?:json)?\s*([\s\S]*?)```/) || txt.match(/\{[\s\S]*\}/); j = JSON.parse(m ? (m[1] || m[0]) : txt); } catch { return res.status(502).json({ error: 'AI JSON буцаасангүй — дахин оролдоно уу' }); }
  const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
  const style = {
    ceiling_m: num(j.ceiling_m, 2.3, 4, 2.7), door_h: num(j.door_h, 1.9, 2.4, 2.05), window_sill: num(j.window_sill, 0.3, 1.3, 0.85), window_top: num(j.window_top, 1.8, 2.6, 2.2),
    threshold_cm: num(j.threshold_cm, 0, 15, 0), beams: Array.isArray(j.beams) ? j.beams.slice(0, 6) : [], floor: ['parquet', 'laminate', 'tile', 'carpet'].includes(j.floor) ? j.floor : 'laminate',
    wall_color: /^#[0-9a-f]{6}$/i.test(String(j.wall_color || '')) ? j.wall_color : '#e3d9cb', ceiling_cove: !!j.ceiling_cove, window_style: j.window_style || 'vacuum', condition: String(j.condition || ''), notes: Array.isArray(j.notes) ? j.notes.slice(0, 8) : [],
    analyzed_at: new Date().toISOString(), photos: rows.length, model: process.env.ZUUCH_AI_MODEL || 'claude-sonnet-5',
    // Өрөө тус бүрийн зөвлөмж — finalize() автомат цонхны тоо/өргөнд, үзэгч ханын өнгө/шалд хэрэглэнэ
    rooms: (Array.isArray(j.rooms) ? j.rooms : []).slice(0, 12).map((h) => ({
      room: String(h.room || '').slice(0, 30), windows: h.windows == null ? null : num(h.windows, 0, 4, 1), window_w: h.window_w == null ? null : num(h.window_w, 0.5, 4, 1.5),
      doors: h.doors == null ? null : num(h.doors, 0, 4, 1), beams: !!h.beams, wall_color: /^#[0-9a-f]{6}$/i.test(String(h.wall_color || '')) ? h.wall_color : null,
      floor: ['parquet', 'laminate', 'tile', 'carpet'].includes(h.floor) ? h.floor : null, notes: String(h.notes || '').slice(0, 200),
    })),
  };
  // Өрөөний зөвлөмжийг өрөөнүүдэд (гар оролт байхгүй бол) шууд тусгана: ханын өнгө, шал
  const hintOf = (r) => style.rooms.find((h) => h.room.toLowerCase().includes(tourLib.TYPE_MN[r.type] || '—'));
  const t = await db.one('SELECT * FROM tours WHERE company_id=? AND property_id=?', req.user.company_id, prop.id);
  const base = t ? t.plan : tourLib.autoPlan(prop);
  const roomsApplied = (base.rooms || []).map((r) => { const h = hintOf(r); return h ? { ...r, wallColor: r.wallColor || h.wall_color || null, floor: r.floor || h.floor || null } : r; });
  const plan = tourLib.finalize({ ...base, rooms: roomsApplied, ceiling: style.ceiling_m, style });
  const saved = await saveTour(req.user.company_id, prop.id, plan);
  res.json({ tour: saved, style });
}));

// Нийтийн үзэгч (худалдан авагчид хуваалцах холбоос — нэвтрэлт шаардахгүй, зөвхөн план + зургууд)
app.get('/tour/:token', (req, res) => res.sendFile(path.join(__dirname, 'public', 'tour.html')));
app.get('/tour-data/:token', wrap(async (req, res) => {
  const t = await db.one('SELECT * FROM tours WHERE token=?', req.params.token);
  if (!t) return res.status(404).json({ error: 'Аялал олдсонгүй' });
  const p = await db.one('SELECT district, khoroolol, rooms, area, floor, total_floors, is_new, deal_type, price FROM properties WHERE id=?', t.property_id);
  const c = await db.one('SELECT name FROM companies WHERE id=?', t.company_id);
  const st = t.settings || {}; if (p && st.districtOnly) p.khoroolol = null; // нууцлал: хуваалцах холбоост хаягийг зөвхөн дүүргээр
  res.json({ plan: t.plan, property: p, company: c && !st.hideCompany ? c.name : '', assets: await tourAssets(t.company_id, t.property_id), exterior: t.exterior || null, media: await publicMedia(t) });
}));
// ---- Бодит медиа (бичлэг/360/splat): нийтийн хандалт (аяллын токеноор), Range дэмжинэ ----
async function publicMedia(t) {
  const rows = await db.all("SELECT id, kind, room_id, label, seq, projection, duration, width, height, track, meta, poster, size FROM tour_media WHERE company_id=? AND property_id=? AND status='ready' ORDER BY kind, seq, id", t.company_id, t.property_id);
  return rows.map((m) => ({ id: m.id, kind: m.kind, room_id: m.room_id, label: m.label || '', seq: m.seq, projection: m.projection, duration: m.duration, width: m.width, height: m.height, track: m.track || null,
    meta: m.meta ? { center: m.meta.center, min: m.meta.min, max: m.meta.max, count: m.meta.count, format: m.meta.format, partial: m.meta.partial, rot: m.meta.rot || null } : {},
    url: `/tour-media/${t.token}/${m.id}?v=${m.size || 0}`, poster: m.poster ? `/tour-media/${t.token}/${m.id}/poster?v=${m.size || 0}` : null })); // v: гараар бүдгэрүүлсний дараа кэш шинэчлэгдэнэ
}
app.get('/tour-media/:token/:id{/:variant}', wrap(async (req, res) => {
  const t = await db.one('SELECT company_id, property_id FROM tours WHERE token=?', req.params.token); if (!t) return res.status(404).end();
  const m = await db.one("SELECT * FROM tour_media WHERE id=? AND company_id=? AND property_id=? AND status='ready'", Number(req.params.id), t.company_id, t.property_id); if (!m) return res.status(404).end();
  const f = media.filePath(m, req.params.variant === 'poster' ? m.poster : m.file); if (!f || !fs.existsSync(f)) return res.status(404).end();
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(f, { acceptRanges: true });
}));
app.get('/tour-public/:token/asset/:id', wrap(async (req, res) => {
  const t = await db.one('SELECT company_id, property_id FROM tours WHERE token=?', req.params.token);
  if (!t) return res.status(404).end();
  const a = await db.one('SELECT * FROM listing_assets WHERE id=? AND company_id=? AND property_id=?', req.params.id, t.company_id, t.property_id);
  if (!a) return res.status(404).end();
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.type(a.enh_file ? 'image/jpeg' : a.mime || 'image/jpeg').sendFile(assetUse(a)); // засвартай бол засварласан зураг
}));

app.get('/capture', (req, res) => res.sendFile(path.join(__dirname, 'public', 'capture.html'))); // утсаар алхалтын бичлэг (GPS-тэй)
app.get('/healthz', (req, res) => res.json({ ok: true }));

// ---- Алдааны нэгдсэн боловсруулагч ----
app.use((err, req, res, next) => {
  console.error('[api]', req.method, req.path, err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Серверийн алдаа: ' + err.message });
});

const PORT = process.env.PORT || 3300;
ready.then(() => { app.listen(PORT, () => console.log(`«Зууч» сервер ажиллаж байна: http://localhost:${PORT}`)); if (process.env.ZUUCH_BACKUP !== '0') backup.schedule(db); priceIndex.schedule(db); dedupX.schedule(db); media.boot(db); retention.schedule(db); credits.schedule(db); });
