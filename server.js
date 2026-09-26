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
    "font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'");
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Async route алдааг барих туслах
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---- Сесс (санах ойд, хугацаатай) ----
const sessions = new Map();
const SESSION_TTL = 12 * 3600 * 1000;
function newSession(user) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { id: user.id, role: user.role, name: user.name, company_id: user.company_id, is_owner: user.is_owner ? 1 : 0, exp: Date.now() + SESSION_TTL });
  return token;
}
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
  const token = newSession(user);
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
  const token = newSession({ id: uid, role: 'zahiral', name, company_id: cid });
  res.json({ token, user: { id: uid, name, role: 'zahiral', company, company_id: cid, is_owner: 0 } });
}));

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || String(req.query.token || '');
  const s = sessions.get(token);
  if (!s) return res.status(401).json({ error: 'Нэвтрээгүй байна' });
  if (Date.now() > s.exp) { sessions.delete(token); return res.status(401).json({ error: 'Сесс дууссан' }); }
  req.user = s; req.token = token; next();
}
const OPEN = new Set(['/login', '/register']);
app.use('/api', (req, res, next) => (OPEN.has(req.path) ? next() : auth(req, res, next)));

app.post('/api/logout', (req, res) => { sessions.delete(req.token); res.json({ ok: true }); });
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
crud('properties', 'properties', ['deal_type', 'district', 'khoroolol', 'rooms', 'area', 'floor', 'total_floors', 'is_new', 'price', 'status', 'agent_id', 'owner_name', 'owner_phone', 'notes']);
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

// ---- Цуглуулагч ----
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
  const assets = await db.all('SELECT id, filename, mime, size, room, quality, wow, issues, rank, created_at FROM listing_assets WHERE company_id=? AND property_id=? ORDER BY CASE WHEN rank>0 THEN rank ELSE 9999 END, id', req.user.company_id, prop.id);
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
  const rows = await db.all('SELECT * FROM listing_assets WHERE company_id=? AND property_id=? ORDER BY id', req.user.company_id, prop.id);
  const assets = rows.map(a => ({ ...a, path: assetPath(a) }));
  const [loc, val] = await Promise.all([
    A.locationScore(prop.district),
    prop.deal_type === 'sale' ? A.valuation({ district: prop.district, rooms: prop.rooms, area: prop.area, isNew: !!prop.is_new, floor: prop.floor, totalFloors: prop.total_floors }) : null,
  ]);
  const out = await studio.run({ property: prop, assets, loc, val });
  for (const r of out.ranked) await db.run('UPDATE listing_assets SET room=?, quality=?, wow=?, issues=?, rank=? WHERE id=?', r.room, r.quality, r.wow, (r.issues || []).join(', '), r.rank, r.id);
  const draft = await db.one('INSERT INTO listing_drafts (company_id, property_id, model, texts, advantages, price, plan, photo_notes) VALUES (?,?,?,?,?,?,?,?) RETURNING *',
    req.user.company_id, prop.id, out.model, JSON.stringify(out.texts), JSON.stringify(out.advantages), JSON.stringify(out.price), JSON.stringify(out.plan), JSON.stringify(out.photo_notes));
  const assetsOut = await db.all('SELECT id, filename, mime, size, room, quality, wow, issues, rank FROM listing_assets WHERE company_id=? AND property_id=? ORDER BY CASE WHEN rank>0 THEN rank ELSE 9999 END, id', req.user.company_id, prop.id);
  res.json({ property: prop, assets: assetsOut, draft, ai: !!process.env.ANTHROPIC_API_KEY });
}));

// ---- Хуудсууд ----
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
