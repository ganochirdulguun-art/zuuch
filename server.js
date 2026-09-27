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
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.tile.openstreetmap.org https://tile.openstreetmap.org; connect-src 'self'");
  next();
});
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
  }
  const token = await newSession(user);
  const company = await db.one('SELECT name FROM companies WHERE id=?', user.company_id);
  res.json({ token, user: { id: user.id, name: user.name, role: user.role, company: company?.name || '', company_id: user.company_id, is_owner: user.is_owner ? 1 : 0 } });
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
    req.user = s; req.token = token; next();
  } catch (e) { next(e); }
}
const OPEN = new Set(['/login', '/register']);
app.use('/api', (req, res, next) => (OPEN.has(req.path) ? next() : auth(req, res, next)));

app.post('/api/logout', (req, res) => { sessions.delete(req.token); db.run('DELETE FROM sessions WHERE token=?', req.token).catch(() => {}); res.json({ ok: true }); });
app.get('/api/me', wrap(async (req, res) => {
  const company = await db.one('SELECT name FROM companies WHERE id=?', req.user.company_id);
  res.json({ id: req.user.id, name: req.user.name, role: req.user.role, company: company?.name || '', company_id: req.user.company_id, is_owner: req.user.is_owner ? 1 : 0 });
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
  if (b.plan && ['demo', 'trial', 'basic', 'pro'].includes(b.plan)) { sets.push('plan=?'); vals.push(b.plan); }
  if (!sets.length) return res.json({ ok: false, error: 'Өөрчлөх утга алга' });
  const r = await db.run(`UPDATE companies SET ${sets.join(',')} WHERE id=?`, ...vals, id);
  res.json({ ok: r.changes > 0 });
}));
app.delete('/api/owner/company/:id', ownerOnly, wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.company_id) return res.status(400).json({ error: 'Өөрийн харьяа компанийг устгах боломжгүй' });
  await db.tx(async (t) => {
    for (const tb of ['listing_assets', 'listing_drafts', 'properties', 'clients', 'requests', 'deals', 'users']) await t.run(`DELETE FROM ${tb} WHERE company_id=?`, id);
    await t.run('DELETE FROM companies WHERE id=?', id);
  });
  res.json({ ok: true });
}));

// ---- Баг ----
app.get('/api/users', wrap(async (req, res) => res.json(await db.all('SELECT id, username, name, role, phone FROM users WHERE company_id=? ORDER BY role, name', req.user.company_id))));
app.post('/api/users', zahiralOnly, wrap(async (req, res) => {
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
  await db.run('DELETE FROM users WHERE id=? AND company_id=?', id, req.user.company_id);
  res.json({ ok: true });
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
function crud(name, table, fields) {
  app.get(`/api/${name}`, wrap(async (req, res) => res.json(await db.all(`SELECT * FROM ${table} WHERE company_id=? ORDER BY id DESC`, req.user.company_id))));
  app.post(`/api/${name}`, wrap(async (req, res) => {
    const cols = ['company_id', ...fields];
    const vals = [req.user.company_id, ...fields.map(f => (req.body[f] === '' || req.body[f] === undefined) ? null : req.body[f])];
    const r = await db.one(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')}) RETURNING id`, ...vals);
    res.json({ id: r.id });
  }));
  app.put(`/api/${name}/:id`, wrap(async (req, res) => {
    const sets = fields.filter(f => f in req.body);
    if (!sets.length) return res.json({ ok: true });
    const r = await db.run(`UPDATE ${table} SET ${sets.map(f => f + '=?').join(',')} WHERE id=? AND company_id=?`, ...sets.map(f => (req.body[f] === '' ? null : req.body[f])), req.params.id, req.user.company_id);
    res.json({ ok: r.changes > 0 });
  }));
  app.delete(`/api/${name}/:id`, wrap(async (req, res) => {
    const r = await db.run(`DELETE FROM ${table} WHERE id=? AND company_id=?`, req.params.id, req.user.company_id);
    res.json({ ok: r.changes > 0 });
  }));
}
crud('properties', 'properties', ['deal_type', 'district', 'khoroolol', 'rooms', 'area', 'floor', 'total_floors', 'is_new', 'price', 'status', 'agent_id', 'owner_name', 'owner_phone', 'notes', 'lat', 'lng']);
crud('clients', 'clients', ['name', 'phone', 'type', 'notes']);
crud('requests', 'requests', ['client_id', 'deal_type', 'budget', 'districts', 'rooms', 'area_min', 'area_max', 'status', 'agent_id', 'last_contact']);
crud('deals', 'deals', ['property_id', 'client_id', 'deal_type', 'amount', 'commission', 'payment_form', 'contract_end', 'deal_date']);

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
app.get('/api/location-score', wrap(async (req, res) => res.json((await A.locationScore(req.query.district)) || { error: 'Оноо олдсонгүй' })));
// ---- Д-5: Замын/түгжрэлийн профайл ----
const commute = require('./commute');
app.get('/api/commute/meta', (req, res) => res.json({ hasKey: commute.hasKey(), destinations: commute.destinations(), slots: commute.SLOTS }));
app.get('/api/properties/:id/commute', wrap(async (req, res) => {
  const p = await db.one('SELECT id, lat, lng, district, khoroolol FROM properties WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!p) return res.status(404).json({ error: 'Объект олдсонгүй' });
  if (p.lat == null || p.lng == null) return res.json({ property: p, profile: null, hasKey: commute.hasKey(), needLocation: true });
  const c = await db.one("SELECT * FROM commute_cells WHERE cell=? AND computed_at > NOW() - INTERVAL '30 days'", commute.cellOf(p.lat, p.lng));
  res.json({ property: p, profile: c ? { ...c.profile, cached: true } : null, hasKey: commute.hasKey() });
}));
app.post('/api/properties/:id/commute', wrap(async (req, res) => {
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
  res.json({ listing: l, index: idx, valuation: val, similar, location: loc, buyers, days, m2, baseline, vsIndex: m2 && baseline ? Math.round((m2 / baseline - 1) * 100) : null, poster, posterListings, lead });
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
  const rows = await db.all(`SELECT l.id, l.title, l.category, l.deal_type, l.district, l.khoroolol, l.rooms, l.area, l.price, l.prev_price, l.listed_at, l.source, l.source_url, l.images, l.ad_type, l.last_seen, l.poster_key,
      p.name poster_name, p.kind poster_kind, p.listings poster_listings, p.active_listings poster_active, p.verified poster_verified, p.company_guess,
      ld.status lead_status, ld.agent_id lead_agent, ld.client_id lead_client, ld.note lead_note
    FROM market_listings l JOIN posters p ON p.key=l.poster_key LEFT JOIN leads ld ON ld.listing_id=l.id AND ld.company_id=?
    WHERE l.active=1 AND l.collected_at IS NOT NULL AND p.kind='owner' AND l.listed_at::date >= (CURRENT_DATE - ?::int)${where}
    ORDER BY (ld.status IS NULL) DESC, l.listed_at DESC, l.id DESC LIMIT 300`, ...params);
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
  res.json({ leads: out, days, counts, locations, filters: { category: cat, deal, city, district, khoroolol } });
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
const UPLOAD_DIR = process.env.ZUUCH_UPLOADS || path.join(__dirname, 'uploads');
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

app.get('/api/studio/:pid', wrap(async (req, res) => {
  const prop = await ownProperty(req);
  if (!prop) return res.status(404).json({ error: 'Объект олдсонгүй' });
  const assets = await db.all('SELECT id, filename, mime, size, room, quality, wow, issues, rank, created_at FROM listing_assets WHERE company_id=? AND property_id=? AND COALESCE(kind,\'photo\')=\'photo\' ORDER BY CASE WHEN rank>0 THEN rank ELSE 9999 END, id', req.user.company_id, prop.id);
  const draft = await db.one('SELECT * FROM listing_drafts WHERE company_id=? AND property_id=? ORDER BY id DESC LIMIT 1', req.user.company_id, prop.id);
  res.json({ property: prop, assets, draft, ai: !!process.env.ANTHROPIC_API_KEY });
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
      res.json({ ok: true, added: ids.length });
    } catch (e) { next(e); }
  });
}));
app.get('/api/studio/asset/:id', wrap(async (req, res) => {
  const a = await db.one('SELECT * FROM listing_assets WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!a) return res.status(404).end();
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.type(a.mime || 'image/jpeg').sendFile(assetPath(a));
}));
app.delete('/api/studio/asset/:id', wrap(async (req, res) => {
  const a = await db.one('SELECT * FROM listing_assets WHERE id=? AND company_id=?', req.params.id, req.user.company_id);
  if (!a) return res.status(404).json({ error: 'Олдсонгүй' });
  await db.run('DELETE FROM listing_assets WHERE id=?', a.id);
  fs.promises.unlink(assetPath(a)).catch(() => {});
  res.json({ ok: true });
}));
app.post('/api/studio/:pid/analyze', wrap(async (req, res) => {
  const prop = await ownProperty(req);
  if (!prop) return res.status(404).json({ error: 'Объект олдсонгүй' });
  const rows = await db.all("SELECT * FROM listing_assets WHERE company_id=? AND property_id=? AND COALESCE(kind,'photo')='photo' ORDER BY id", req.user.company_id, prop.id);
  const assets = rows.map(a => ({ ...a, path: assetPath(a) }));
  const [loc, val] = await Promise.all([
    A.locationScore(prop.district),
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
// AI зургийн шинжилгээ → бодит орон зайн параметр (таазны өндөр, хаалга/цонх/довжоо, дам нуруу, шал, ханын өнгө) → plan.style
app.post('/api/tour/:pid/analyze', auth, wrap(async (req, res) => {
  const prop = await tourProp(req, res); if (!prop) return;
  if (!process.env.ANTHROPIC_API_KEY) return res.status(400).json({ error: 'ANTHROPIC_API_KEY тохируулаагүй' });
  // Студийн зураг + бичлэгийн кадрууд (kind='frame', өрөөний шошготой) — өрөө тус бүрийн зөвлөмж гаргана
  const rows = await db.all("SELECT * FROM listing_assets WHERE company_id=? AND property_id=? AND COALESCE(kind,'photo') IN ('photo','frame') ORDER BY (COALESCE(kind,'photo')='frame'), CASE WHEN rank>0 THEN rank ELSE 9999 END, id LIMIT 20", req.user.company_id, prop.id);
  if (!rows.length) return res.status(400).json({ error: 'Эхлээд Студид зураг эсвэл POV Tour-д бичлэг оруулна уу' });
  const Anthropic = require('@anthropic-ai/sdk'); const ai = new Anthropic();
  const content = [];
  for (let i = 0; i < rows.length; i++) {
    const buf = await fs.promises.readFile(assetPath(rows[i])).catch(() => null); if (!buf) continue;
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
  res.json({ plan: t.plan, property: p, company: c ? c.name : '', assets: await tourAssets(t.company_id, t.property_id) });
}));
app.get('/tour-public/:token/asset/:id', wrap(async (req, res) => {
  const t = await db.one('SELECT company_id, property_id FROM tours WHERE token=?', req.params.token);
  if (!t) return res.status(404).end();
  const a = await db.one('SELECT * FROM listing_assets WHERE id=? AND company_id=? AND property_id=?', req.params.id, t.company_id, t.property_id);
  if (!a) return res.status(404).end();
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.type(a.mime || 'image/jpeg').sendFile(assetPath(a));
}));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/healthz', (req, res) => res.json({ ok: true }));

// ---- Алдааны нэгдсэн боловсруулагч ----
app.use((err, req, res, next) => {
  console.error('[api]', req.method, req.path, err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Серверийн алдаа: ' + err.message });
});

const PORT = process.env.PORT || 3300;
ready.then(() => app.listen(PORT, () => console.log(`«Зууч» сервер ажиллаж байна: http://localhost:${PORT}`)));
