// «Зууч» — үл хөдлөхийн агентлагийн платформ (production, multi-tenant)
const express = require('express');
const crypto = require('node:crypto');
const path = require('node:path');
const { db, hash, verify } = require('./db');
const A = require('./algorithms');
const collector = require('./collector');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

// ---- Аюулгүй байдлын толгойнууд ----
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'");
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ---- Сесс (санах ойд, хугацаатай) ----
const sessions = new Map();
const SESSION_TTL = 12 * 3600 * 1000;
function newSession(user) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { id: user.id, role: user.role, name: user.name, company_id: user.company_id, is_owner: user.is_owner ? 1 : 0, exp: Date.now() + SESSION_TTL });
  return token;
}

// ---- Нэвтрэлтийн хамгаалалт (brute-force хязгаар) ----
const attempts = new Map(); // ip -> { n, ts }
function rateLimited(ip) {
  const a = attempts.get(ip);
  if (a && Date.now() - a.ts < 15 * 60000 && a.n >= 8) return true;
  return false;
}
function noteFail(ip) {
  const a = attempts.get(ip) || { n: 0, ts: Date.now() };
  if (Date.now() - a.ts >= 15 * 60000) { a.n = 0; a.ts = Date.now(); }
  a.n++; attempts.set(ip, a);
}

app.post('/api/login', (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || '?';
  if (rateLimited(ip)) return res.status(429).json({ error: 'Хэт олон оролдлого — 15 минутын дараа дахин оролдоно уу' });
  const { username, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(String(username || '').toLowerCase());
  if (!user || !verify(String(password || ''), user.pass_hash)) {
    noteFail(ip);
    return res.status(401).json({ error: 'Нэвтрэх нэр эсвэл нууц үг буруу байна' });
  }
  attempts.delete(ip);
  // Түр хаагдсан компанийн хэрэглэгч нэвтрэхгүй (эзэн үл хамаарна)
  if (!user.is_owner) {
    const co = db.prepare('SELECT status FROM companies WHERE id=?').get(user.company_id);
    if (co && co.status !== 'active') return res.status(403).json({ error: 'Таны компанийн хандалт түр хаагдсан. Платформын админтай холбогдоно уу.' });
  }
  const token = newSession(user);
  const company = db.prepare('SELECT name FROM companies WHERE id=?').get(user.company_id);
  res.json({ token, user: { id: user.id, name: user.name, role: user.role, company: company?.name || '', company_id: user.company_id, is_owner: user.is_owner ? 1 : 0 } });
});

// ---- Компани + захирал бүртгэх (өөрөө онбординг) ----
app.post('/api/register', (req, res) => {
  const b = req.body || {};
  const company = String(b.company || '').trim();
  const name = String(b.name || '').trim();
  const username = String(b.username || '').trim().toLowerCase();
  const password = String(b.password || '');
  if (!company || !name || username.length < 3 || password.length < 6) {
    return res.status(400).json({ error: 'Компанийн нэр, өөрийн нэр, нэвтрэх нэр (3+), нууц үг (6+) шаардлагатай' });
  }
  if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) {
    return res.status(409).json({ error: 'Энэ нэвтрэх нэр бүртгэлтэй байна' });
  }
  const cid = Number(db.prepare("INSERT INTO companies (name, license_no, plan) VALUES (?, ?, 'trial')").run(company, String(b.license || '')).lastInsertRowid);
  const uid = Number(db.prepare('INSERT INTO users (company_id, username, pass_hash, name, role, phone) VALUES (?,?,?,?,?,?)')
    .run(cid, username, hash(password), name, 'zahiral', String(b.phone || '')).lastInsertRowid);
  const token = newSession({ id: uid, role: 'zahiral', name, company_id: cid });
  res.json({ token, user: { id: uid, name, role: 'zahiral', company } });
});

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const s = sessions.get(token);
  if (!s) return res.status(401).json({ error: 'Нэвтрээгүй байна' });
  if (Date.now() > s.exp) { sessions.delete(token); return res.status(401).json({ error: 'Сесс дууссан' }); }
  req.user = s; req.token = token;
  next();
}
const OPEN = new Set(['/login', '/register']);
app.use('/api', (req, res, next) => (OPEN.has(req.path) ? next() : auth(req, res, next)));

app.post('/api/logout', (req, res) => { sessions.delete(req.token); res.json({ ok: true }); });
app.get('/api/me', (req, res) => {
  const company = db.prepare('SELECT name FROM companies WHERE id=?').get(req.user.company_id);
  res.json({ id: req.user.id, name: req.user.name, role: req.user.role, company: company?.name || '', company_id: req.user.company_id, is_owner: req.user.is_owner ? 1 : 0 });
});

// Нууц үг солих (нэвтэрсэн хэн ч өөрийнхөө)
app.post('/api/me/password', (req, res) => {
  const { current, next } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!u || !verify(String(current || ''), u.pass_hash)) return res.status(401).json({ error: 'Одоогийн нууц үг буруу' });
  if (String(next || '').length < 6) return res.status(400).json({ error: 'Шинэ нууц үг 6+ тэмдэгт байх ёстой' });
  db.prepare('UPDATE users SET pass_hash=? WHERE id=?').run(hash(String(next)), req.user.id);
  res.json({ ok: true });
});

// ---- Лавлагаа (компанид хамаарах) ----
app.get('/api/meta', (req, res) => {
  res.json({
    districts: ['Сүхбаатар', 'Хан-Уул', 'Баянгол', 'Баянзүрх', 'Чингэлтэй', 'Сонгинохайрхан'],
    agents: db.prepare('SELECT id, name FROM users WHERE company_id=? ORDER BY role, name').all(req.user.company_id),
  });
});

// ---- Багийн удирдлага (зөвхөн захирал) ----
function zahiralOnly(req, res, next) {
  if (req.user.role !== 'zahiral') return res.status(403).json({ error: 'Зөвхөн захирал энэ үйлдлийг хийнэ' });
  next();
}
function ownerOnly(req, res, next) {
  if (!req.user.is_owner) return res.status(403).json({ error: 'Зөвхөн платформын эзэн' });
  next();
}

// ---- Эзэн самбар (бүх компанийн тойм) ----
app.get('/api/owner/overview', ownerOnly, (req, res) => {
  const companies = db.prepare(`
    SELECT c.id, c.name, c.plan, c.status, c.created_at,
      (SELECT COUNT(*) FROM users u WHERE u.company_id=c.id) AS users,
      (SELECT COUNT(*) FROM properties p WHERE p.company_id=c.id) AS properties,
      (SELECT COUNT(*) FROM clients cl WHERE cl.company_id=c.id) AS clients,
      (SELECT COUNT(*) FROM deals d WHERE d.company_id=c.id) AS deals,
      (SELECT COALESCE(SUM(commission),0) FROM deals d WHERE d.company_id=c.id) AS commission
    FROM companies c ORDER BY c.id`).all();
  const totals = {
    companies: companies.length,
    users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
    properties: db.prepare('SELECT COUNT(*) c FROM properties').get().c,
    deals: db.prepare('SELECT COUNT(*) c FROM deals').get().c,
    commission: db.prepare('SELECT COALESCE(SUM(commission),0) s FROM deals').get().s,
    marketListings: db.prepare('SELECT COUNT(*) c FROM market_listings WHERE active=1').get().c,
  };
  res.json({ companies, totals });
});

// Компанийн төлөв/багц өөрчлөх (эзэн)
app.post('/api/owner/company/:id', ownerOnly, (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const sets = [], vals = [];
  if (b.status && ['active', 'suspended'].includes(b.status)) { sets.push('status=?'); vals.push(b.status); }
  if (b.plan && ['demo', 'trial', 'basic', 'pro'].includes(b.plan)) { sets.push('plan=?'); vals.push(b.plan); }
  if (!sets.length) return res.json({ ok: false, error: 'Өөрчлөх утга алга' });
  vals.push(id);
  const r = db.prepare(`UPDATE companies SET ${sets.join(',')} WHERE id=?`).run(...vals);
  res.json({ ok: r.changes > 0 });
});

// Компани устгах (эзэн) — өгөгдлийг нь бүрэн цэвэрлэнэ; эзний өөрийн компанийг устгахгүй
app.delete('/api/owner/company/:id', ownerOnly, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.company_id) return res.status(400).json({ error: 'Өөрийн харьяа компанийг устгах боломжгүй' });
  const tx = db.prepare('BEGIN'); tx.run();
  try {
    for (const t of ['properties', 'clients', 'requests', 'deals', 'users']) db.prepare(`DELETE FROM ${t} WHERE company_id=?`).run(id);
    db.prepare('DELETE FROM companies WHERE id=?').run(id);
    db.prepare('COMMIT').run();
  } catch (e) { db.prepare('ROLLBACK').run(); return res.status(500).json({ error: 'Устгах үед алдаа' }); }
  res.json({ ok: true });
});
app.get('/api/users', (req, res) => {
  res.json(db.prepare('SELECT id, username, name, role, phone FROM users WHERE company_id=? ORDER BY role, name').all(req.user.company_id));
});
app.post('/api/users', zahiralOnly, (req, res) => {
  const b = req.body || {};
  const username = String(b.username || '').trim().toLowerCase();
  const password = String(b.password || '');
  const name = String(b.name || '').trim();
  if (!name || username.length < 3 || password.length < 6) return res.status(400).json({ error: 'Нэр, нэвтрэх нэр (3+), нууц үг (6+) шаардлагатай' });
  if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) return res.status(409).json({ error: 'Нэвтрэх нэр бүртгэлтэй байна' });
  const role = b.role === 'zahiral' ? 'zahiral' : 'agent';
  const id = Number(db.prepare('INSERT INTO users (company_id, username, pass_hash, name, role, phone) VALUES (?,?,?,?,?,?)')
    .run(req.user.company_id, username, hash(password), name, role, String(b.phone || '')).lastInsertRowid);
  res.json({ id });
});
app.delete('/api/users/:id', zahiralOnly, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Өөрийгөө устгах боломжгүй' });
  db.prepare('DELETE FROM users WHERE id=? AND company_id=?').run(id, req.user.company_id);
  res.json({ ok: true });
});

// ---- Хянах самбар (компанид хамаарах) ----
app.get('/api/dashboard', (req, res) => {
  const cid = req.user.company_id;
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const month = new Date().toISOString().slice(0, 7);
  const md = one("SELECT COUNT(*) c, COALESCE(SUM(commission),0) s FROM deals WHERE company_id=? AND substr(deal_date,1,7)=?", cid, month);
  const expiring = db.prepare(`SELECT d.*, p.district, p.khoroolol FROM deals d LEFT JOIN properties p ON p.id=d.property_id
    WHERE d.company_id=? AND d.contract_end IS NOT NULL AND date(d.contract_end) BETWEEN date('now') AND date('now','+30 day')`).all(cid);
  const staleReqs = db.prepare(`SELECT r.*, c.name client_name FROM requests r JOIN clients c ON c.id=r.client_id
    WHERE r.company_id=? AND r.status='open' AND datetime(r.last_contact) < datetime('now','-3 day')`).all(cid);
  res.json({
    activeProperties: one("SELECT COUNT(*) c FROM properties WHERE company_id=? AND status='active'", cid).c,
    openRequests: one("SELECT COUNT(*) c FROM requests WHERE company_id=? AND status='open'", cid).c,
    monthDeals: md.c, monthCommission: md.s,
    marketListings: one('SELECT COUNT(*) c FROM market_listings WHERE active=1').c,
    expiring, staleReqs,
    opportunities: A.opportunities().slice(0, 5),
  });
});

// ---- Tenant-scoped CRUD туслах ----
function crud(name, table, fields) {
  app.get(`/api/${name}`, (req, res) => {
    res.json(db.prepare(`SELECT * FROM ${table} WHERE company_id=? ORDER BY id DESC`).all(req.user.company_id));
  });
  app.post(`/api/${name}`, (req, res) => {
    const cols = ['company_id', ...fields];
    const vals = [req.user.company_id, ...fields.map(f => req.body[f] ?? null)];
    const info = db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals);
    res.json({ id: Number(info.lastInsertRowid) });
  });
  app.put(`/api/${name}/:id`, (req, res) => {
    const sets = fields.filter(f => f in req.body);
    if (!sets.length) return res.json({ ok: true });
    const r = db.prepare(`UPDATE ${table} SET ${sets.map(f => f + '=?').join(',')} WHERE id=? AND company_id=?`)
      .run(...sets.map(f => req.body[f]), req.params.id, req.user.company_id);
    res.json({ ok: r.changes > 0 });
  });
  app.delete(`/api/${name}/:id`, (req, res) => {
    const r = db.prepare(`DELETE FROM ${table} WHERE id=? AND company_id=?`).run(req.params.id, req.user.company_id);
    res.json({ ok: r.changes > 0 });
  });
}
crud('properties', 'properties', ['deal_type', 'district', 'khoroolol', 'rooms', 'area', 'floor', 'total_floors', 'is_new', 'price', 'status', 'agent_id', 'owner_name', 'owner_phone', 'notes']);
crud('clients', 'clients', ['name', 'phone', 'type', 'notes']);
crud('requests', 'requests', ['client_id', 'deal_type', 'budget', 'districts', 'rooms', 'area_min', 'area_max', 'status', 'agent_id', 'last_contact']);
crud('deals', 'deals', ['property_id', 'client_id', 'deal_type', 'amount', 'commission', 'payment_form', 'contract_end', 'deal_date']);

app.get('/api/requests-full', (req, res) => {
  res.json(db.prepare(`SELECT r.*, c.name client_name, u.name agent_name FROM requests r
    JOIN clients c ON c.id=r.client_id LEFT JOIN users u ON u.id=r.agent_id
    WHERE r.company_id=? ORDER BY r.id DESC`).all(req.user.company_id));
});
app.get('/api/deals-full', (req, res) => {
  res.json(db.prepare(`SELECT d.*, c.name client_name, p.district, p.khoroolol, p.rooms FROM deals d
    LEFT JOIN clients c ON c.id=d.client_id LEFT JOIN properties p ON p.id=d.property_id
    WHERE d.company_id=? ORDER BY d.id DESC`).all(req.user.company_id));
});

// ---- Алгоритмын API (зах зээлийн өгөгдөл нийтлэг, тохирол компанид хамаарна) ----
app.get('/api/valuation', (req, res) => {
  const v = A.valuation({
    district: req.query.district, rooms: req.query.rooms, area: req.query.area,
    isNew: req.query.is_new === '1', floor: req.query.floor, totalFloors: req.query.total_floors,
  });
  res.json(v || { error: 'Индекс олдсонгүй' });
});
app.get('/api/matches/:id', (req, res) => res.json(A.matchesForRequest(req.params.id, req.user.company_id)));
app.get('/api/market/index', (req, res) => res.json(db.prepare('SELECT * FROM price_index ORDER BY median_m2 DESC').all()));
app.get('/api/market/opportunities', (req, res) => res.json(A.opportunities()));
app.get('/api/location-score', (req, res) => res.json(A.locationScore(req.query.district) || { error: 'Оноо олдсонгүй' }));

// ---- Цуглуулах хөдөлгүүр (зах зээлийн нийтлэг мэдээлэл — бүх компанид үйлчилнэ) ----
app.get('/api/collector/status', (req, res) => res.json(collector.status()));
app.post('/api/collector/start', zahiralOnly, (req, res) => { collector.start(); res.json(collector.status()); });
app.post('/api/collector/stop', zahiralOnly, (req, res) => { collector.stop(); res.json(collector.status()); });
app.post('/api/collector/reset', zahiralOnly, (req, res) => { collector.reset(); res.json(collector.status()); });
app.post('/api/collector/takedown', zahiralOnly, (req, res) => { const r = collector.takedownLatest(); res.json({ ...r, ...collector.status() }); });

// ---- Хуудсууд: / = landing (нүүр), /app = систем ----
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3300;
app.listen(PORT, () => console.log(`«Зууч» сервер ажиллаж байна: http://localhost:${PORT}`));
