// «Зууч» — өгөгдлийн сан (PostgreSQL, async). Ш1.2: SQLite-аас шилжсэн.
const { Pool } = require('pg');
const crypto = require('node:crypto');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL тохируулаагүй байна (PostgreSQL холболтын мөр). .env.example-ийг үзнэ үү.');
  process.exit(1);
}
// Railway дотоод сүлжээ (*.railway.internal) SSL шаардахгүй; гадаад proxy/бусад хост бол SSL
const needsSSL = !/railway\.internal|localhost|127\.0\.0\.1/.test(DATABASE_URL);
const pool = new Pool({ connectionString: DATABASE_URL, ssl: needsSSL ? { rejectUnauthorized: false } : undefined, max: 10 });
pool.on('error', (e) => console.error('[pg pool]', e.message));

// '?' placeholder → $1,$2… (манай SQL-д мөр доторх '?' байхгүй)
const fix = (sql) => { let i = 0; return sql.replace(/\?/g, () => '$' + (++i)); };
function wrap(client) {
  return {
    all: async (sql, ...p) => (await client.query(fix(sql), p)).rows,
    one: async (sql, ...p) => (await client.query(fix(sql), p)).rows[0] || null,
    run: async (sql, ...p) => { const r = await client.query(fix(sql), p); return { changes: r.rowCount, rows: r.rows }; },
    exec: async (sql) => client.query(sql),
  };
}
const db = {
  ...wrap(pool),
  // Транзакц: fn(t) дотор t.all/one/run ашиглана
  tx: async (fn) => {
    const c = await pool.connect();
    try { await c.query('BEGIN'); const r = await fn(wrap(c)); await c.query('COMMIT'); return r; }
    catch (e) { await c.query('ROLLBACK'); throw e; }
    finally { c.release(); }
  },
};

function hash(pw) {
  const salt = crypto.randomBytes(8).toString('hex');
  return salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
}
function verify(pw, stored) {
  const [salt, h] = String(stored || '').split(':');
  try { return crypto.timingSafeEqual(Buffer.from(h, 'hex'), crypto.scryptSync(pw, salt, 32)); }
  catch { return false; }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS companies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  license_no TEXT DEFAULT '',
  plan TEXT NOT NULL DEFAULT 'trial',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT 1,
  username TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('zahiral','agent')),
  phone TEXT DEFAULT '',
  is_owner INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS properties (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT 1,
  deal_type TEXT NOT NULL CHECK(deal_type IN ('sale','rent')),
  district TEXT NOT NULL,
  khoroolol TEXT DEFAULT '',
  rooms INTEGER NOT NULL,
  area DOUBLE PRECISION NOT NULL,
  floor INTEGER DEFAULT 0,
  total_floors INTEGER DEFAULT 0,
  is_new INTEGER DEFAULT 0,
  price DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','contracted','closed')),
  agent_id INTEGER,
  owner_name TEXT DEFAULT '',
  owner_phone TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS clients (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  type TEXT NOT NULL CHECK(type IN ('buyer','seller','renter','landlord')),
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS requests (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT 1,
  client_id INTEGER NOT NULL,
  deal_type TEXT NOT NULL DEFAULT 'sale',
  budget DOUBLE PRECISION NOT NULL,
  districts TEXT NOT NULL,
  rooms INTEGER NOT NULL,
  area_min DOUBLE PRECISION DEFAULT 0,
  area_max DOUBLE PRECISION DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','matched','closed')),
  agent_id INTEGER,
  last_contact TEXT DEFAULT to_char(NOW() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS deals (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT 1,
  property_id INTEGER,
  client_id INTEGER,
  deal_type TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  commission DOUBLE PRECISION DEFAULT 0,
  payment_form TEXT DEFAULT 'transfer',
  contract_end TEXT DEFAULT NULL,
  deal_date TEXT DEFAULT to_char(NOW(),'YYYY-MM-DD'),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS market_listings (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'demo',
  source_id TEXT DEFAULT '',
  deal_type TEXT NOT NULL DEFAULT 'sale',
  district TEXT NOT NULL,
  rooms INTEGER NOT NULL,
  area DOUBLE PRECISION NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  prev_price DOUBLE PRECISION DEFAULT NULL,
  is_new INTEGER DEFAULT 0,
  listed_at TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  fit_score DOUBLE PRECISION, dedup_group TEXT, collected_at TEXT, contact_hash TEXT, title TEXT, images INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS price_index (
  district TEXT NOT NULL,
  is_new INTEGER NOT NULL,
  median_m2 DOUBLE PRECISION NOT NULL,
  p25_m2 DOUBLE PRECISION NOT NULL,
  p75_m2 DOUBLE PRECISION NOT NULL,
  sample INTEGER NOT NULL,
  month TEXT NOT NULL,
  PRIMARY KEY (district, is_new, month)
);
CREATE TABLE IF NOT EXISTS location_scores (
  district TEXT PRIMARY KEY,
  total INTEGER NOT NULL,
  education INTEGER, transport INTEGER, commerce INTEGER, environment INTEGER,
  health INTEGER, parking INTEGER, gov INTEGER, green INTEGER,
  growth TEXT NOT NULL DEFAULT 'stable',
  growth_note TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS sources (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,
  auto INTEGER NOT NULL DEFAULT 1,
  trust DOUBLE PRECISION NOT NULL DEFAULT 0.7,
  max_concurrency INTEGER NOT NULL DEFAULT 2,
  interval_sec INTEGER NOT NULL DEFAULT 20,
  status TEXT NOT NULL DEFAULT 'active',
  collected INTEGER NOT NULL DEFAULT 0,
  rejected INTEGER NOT NULL DEFAULT 0,
  note TEXT DEFAULT '',
  tier TEXT DEFAULT 'yellow'
);
CREATE TABLE IF NOT EXISTS fetch_jobs (
  id SERIAL PRIMARY KEY,
  source_name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'delta',
  priority INTEGER NOT NULL DEFAULT 5,
  status TEXT NOT NULL DEFAULT 'queued',
  claimed_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS takedown (
  key TEXT PRIMARY KEY,
  reason TEXT DEFAULT '',
  at TIMESTAMPTZ DEFAULT NOW()
);
-- Ш3а: Листингийн AI студи
CREATE TABLE IF NOT EXISTS listing_assets (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  property_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT DEFAULT 'image/jpeg',
  size INTEGER DEFAULT 0,
  room TEXT DEFAULT '',
  quality INTEGER DEFAULT NULL,
  wow INTEGER DEFAULT NULL,
  issues TEXT DEFAULT '',
  rank INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS listing_assets_prop ON listing_assets(company_id, property_id);
CREATE TABLE IF NOT EXISTS listing_drafts (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  property_id INTEGER NOT NULL,
  model TEXT DEFAULT '',
  texts JSONB DEFAULT '{}'::jsonb,
  advantages JSONB DEFAULT '[]'::jsonb,
  price JSONB DEFAULT '{}'::jsonb,
  plan JSONB DEFAULT '[]'::jsonb,
  photo_notes JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS listing_drafts_prop ON listing_drafts(company_id, property_id);
`;

// ---- Жишиг өгөгдөл (сан хоосон үед л) ----
async function seed() {
  const { c } = await db.one('SELECT COUNT(*)::int c FROM users');
  if (c > 0) return;

  await db.run("INSERT INTO companies (id, name, license_no, plan) VALUES (1, ?, ?, 'demo') ON CONFLICT (id) DO NOTHING", 'Демо агентлаг ХХК', 'СЗХ-2026-001');
  for (const [u, n, r, ph] of [['zahiral', 'Ганбат (захирал)', 'zahiral', '9911xxxx'], ['agent1', 'Сарнай (агент)', 'agent', '9902xxxx'], ['agent2', 'Тэмүүлэн (агент)', 'agent', '9515xxxx']]) {
    await db.run('INSERT INTO users (company_id, username, pass_hash, name, role, phone) VALUES (1,?,?,?,?,?)', u, hash('zuuch2026'), n, r, ph);
  }

  const idx = [['Сүхбаатар', 6.25, 5.20], ['Хан-Уул', 5.10, 4.60], ['Баянгол', 4.60, 4.20], ['Баянзүрх', 4.40, 4.00], ['Чингэлтэй', 4.30, 3.90], ['Сонгинохайрхан', 3.60, 3.30]];
  for (const [d, nu, ol] of idx) {
    await db.run('INSERT INTO price_index (district,is_new,median_m2,p25_m2,p75_m2,sample,month) VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING', d, 1, nu, nu * 0.92, nu * 1.09, 40 + Math.floor(nu * 10), '2026-02');
    await db.run('INSERT INTO price_index (district,is_new,median_m2,p25_m2,p75_m2,sample,month) VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING', d, 0, ol, ol * 0.90, ol * 1.10, 60 + Math.floor(ol * 12), '2026-02');
  }

  const loc = [
    ['Сүхбаатар', 88, 90, 95, 55, 90, 35, 95, 60, 'stable', 'Төвийн бүс — дэд бүтэц бүрэн ч зогсоол хомс, үнэ өндөр'],
    ['Хан-Уул', 75, 70, 85, 80, 75, 70, 70, 75, 'high', 'Шинэ хороолол + Яармагийн шинэ зам, наадмын бүсийн хөгжил'],
    ['Баянгол', 82, 85, 85, 60, 85, 45, 80, 55, 'stable', 'Хуучин ч дэд бүтэц сайтай, 3/4-р хороолол эрэлттэй'],
    ['Баянзүрх', 70, 65, 70, 55, 65, 55, 65, 60, 'growing', '13-р хороолол, Офицер орчим BRT шугамын дагуу'],
    ['Чингэлтэй', 72, 75, 70, 45, 70, 40, 85, 45, 'stable', 'Төвийн хойд хэсэг; гэр хорооллын зэргэлдээ агаарын асуудал'],
    ['Сонгинохайрхан', 55, 60, 55, 40, 50, 65, 55, 45, 'growing', 'Метроны баруун чиглэл (2030) + хямд үнийн давуу'],
  ];
  for (const [d, e, t, c2, en, h, p, g, gr, growth, note] of loc) {
    const total = Math.round(e * .20 + t * .15 + c2 * .15 + en * .15 + h * .10 + p * .10 + g * .08 + gr * .07);
    await db.run('INSERT INTO location_scores (district,education,transport,commerce,environment,health,parking,gov,green,total,growth,growth_note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING', d, e, t, c2, en, h, p, g, gr, total, growth, note);
  }

  let sid = 1000;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const roomsK = { 1: 1.06, 2: 1.0, 3: 0.95, 4: 0.92 };
  for (const [d, nu, ol] of idx) {
    for (let i = 0; i < 7; i++) {
      const isNew = Math.random() < 0.4 ? 1 : 0;
      const rooms = [1, 2, 2, 3, 3, 4][Math.floor(Math.random() * 6)];
      const area = Math.round(rooms * rnd(24, 34));
      const base = (isNew ? nu : ol) * roomsK[rooms];
      const m2 = base * rnd(0.85, 1.15);
      const daysAgo = Math.floor(rnd(1, 90));
      const listed = new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 10);
      const price = Math.round(m2 * area * 10) / 10;
      const prev = Math.random() < 0.2 ? Math.round(price * rnd(1.06, 1.12) * 10) / 10 : null;
      await db.run('INSERT INTO market_listings (source,source_id,deal_type,district,rooms,area,price,prev_price,is_new,listed_at,active) VALUES (?,?,?,?,?,?,?,?,?,?,1)', 'unegui-demo', String(sid++), 'sale', d, rooms, area, price, prev, isNew, listed);
    }
  }

  const P = 'INSERT INTO properties (deal_type,district,khoroolol,rooms,area,floor,total_floors,is_new,price,status,agent_id,owner_name,owner_phone,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)';
  const props = [
    ['sale', 'Хан-Уул', 'Жардин хотхон', 2, 55, 7, 16, 1, 305, 'active', 2, 'Оюунаа', '8811xxxx', 'Бүрэн тавилгатай, баруун урд зүг'],
    ['sale', 'Баянгол', '4-р хороолол', 3, 68, 3, 5, 0, 285, 'active', 2, 'Батсайхан', '9909xxxx', 'Хуучин засвартай, сургууль ойрхон'],
    ['sale', 'Сүхбаатар', 'Хүүхдийн 100 орчим', 2, 52, 9, 12, 0, 292, 'active', 3, 'Дэлгэрмаа', '9191xxxx', ''],
    ['sale', 'Баянзүрх', '13-р хороолол', 1, 33, 4, 9, 0, 128, 'active', 3, 'Нямдорж', '9515xxxx', 'Түлхүүр бэлэн'],
    ['rent', 'Сүхбаатар', 'Төв талбай орчим', 2, 58, 5, 10, 0, 2.1, 'active', 2, 'Энхжин', '9860xxxx', 'Сарын түрээс, барьцаа 1 сар'],
    ['sale', 'Хан-Уул', 'Гоёо хотхон', 3, 82, 12, 20, 1, 470, 'contracted', 2, 'Мөнхбат', '9111xxxx', 'Урьдчилгаа авсан'],
    ['rent', 'Баянгол', '10-р хороолол', 1, 32, 2, 5, 0, 1.25, 'active', 3, 'Сувдаа', '9414xxxx', ''],
    ['sale', 'Сонгинохайрхан', 'Москва хороолол', 2, 50, 6, 9, 0, 168, 'active', 3, 'Ганзориг', '9090xxxx', 'Яаралтай зарна'],
  ];
  for (const p of props) await db.run(P, ...p);

  for (const c2 of [['Билгүүн', '9911yyyy', 'buyer', 'Ипотек урьдчилан зөвшөөрөгдсөн, 320 сая хүртэл'], ['Наранцэцэг', '8800yyyy', 'buyer', 'Бэлэн мөнгө, яаралтай'], ['Төгөлдөр', '9515yyyy', 'renter', 'Гэр бүл 3 ам бүл'], ['Оюунаа', '8811xxxx', 'seller', 'Жардины 2 өрөөний эзэн'], ['Энхтуяа', '9902yyyy', 'buyer', 'Хүүхэд сургуульд ойрхон байлгах хүсэлтэй']]) {
    await db.run('INSERT INTO clients (name,phone,type,notes) VALUES (?,?,?,?)', ...c2);
  }
  const R = 'INSERT INTO requests (client_id,deal_type,budget,districts,rooms,area_min,area_max,status,agent_id,last_contact) VALUES (?,?,?,?,?,?,?,?,?,?)';
  await db.run(R, 1, 'sale', 310, 'Хан-Уул,Баянгол', 2, 45, 65, 'open', 2, new Date(Date.now() - 4 * 864e5).toISOString());
  await db.run(R, 2, 'sale', 180, 'Баянзүрх,Сонгинохайрхан', 2, 40, 60, 'open', 3, new Date().toISOString());
  await db.run(R, 3, 'rent', 1.6, 'Баянгол,Чингэлтэй', 1, 28, 45, 'open', 3, new Date(Date.now() - 1 * 864e5).toISOString());
  await db.run(R, 5, 'sale', 300, 'Баянгол,Сүхбаатар', 3, 60, 80, 'open', 2, new Date().toISOString());
  const D = 'INSERT INTO deals (property_id,client_id,deal_type,amount,commission,payment_form,contract_end,deal_date) VALUES (?,?,?,?,?,?,?,?)';
  await db.run(D, 6, 2, 'sale', 470, 9.4, 'mortgage', null, '2026-08-28');
  await db.run(D, 5, 3, 'rent', 2.1, 2.1, 'transfer', new Date(Date.now() + 18 * 864e5).toISOString().slice(0, 10), '2026-08-12');
}

async function seedSources() {
  const { c } = await db.one('SELECT COUNT(*)::int c FROM sources');
  if (c > 0) return;
  const S = 'INSERT INTO sources (name,label,kind,auto,trust,max_concurrency,interval_sec,note) VALUES (?,?,?,?,?,?,?,?)';
  await db.run(S, 'unegui', 'Unegui.mn', 'listing_site', 1, 0.72, 3, 8, 'Өндөр урсгал, чанар холимог');
  await db.run(S, 'barilga', 'Barilga.mn', 'listing_site', 1, 0.80, 2, 12, 'Шинэ орон сууц голлоно');
  await db.run(S, 'remax', 'RE/MAX брокер вэб', 'broker', 1, 0.90, 2, 15, 'Бага урсгал, өндөр чанар');
  await db.run(S, 'orgil', 'Оргил зууч вэб', 'broker', 1, 0.85, 2, 18, 'Брокерын өөрийн листинг');
  await db.run(S, 'fb_group', 'FB «УБ орон сууц» групп', 'fb', 0, 0.50, 1, 0, 'ГАР оруулалт — ToS-оор автомат ухахгүй');
}
async function ensureTiers() {
  const tiers = { remax: 'green', orgil: 'green', unegui: 'yellow', barilga: 'yellow', fb_group: 'red' };
  for (const [name, t] of Object.entries(tiers)) await db.run('UPDATE sources SET tier=? WHERE name=?', t, name);
}
// Платформын эзэн — ЗӨВХӨН env-ээс (repo public тул кодод нууц үг бичихгүй)
async function ensureOwner() {
  const u = String(process.env.ZUUCH_OWNER_USER || '').trim().toLowerCase();
  const p = String(process.env.ZUUCH_OWNER_PASS || '');
  if (u.length < 3 || p.length < 6) return;
  const existing = await db.one('SELECT id FROM users WHERE username=?', u);
  if (existing) {
    if (String(process.env.ZUUCH_OWNER_RESET || '') === '1') await db.run('UPDATE users SET is_owner=1, pass_hash=? WHERE id=?', hash(p), existing.id);
    else await db.run('UPDATE users SET is_owner=1 WHERE id=?', existing.id);
  } else {
    await db.run("INSERT INTO users (company_id, username, pass_hash, name, role, is_owner) VALUES (1, ?, ?, ?, 'zahiral', 1)", u, hash(p), 'Платформ эзэн');
  }
}

// Ш2: бодит адаптерийн баганууд (байгаа санг эвдэхгүй — IF NOT EXISTS)
const MIGRATE_LIVE = `
ALTER TABLE market_listings ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ;
ALTER TABLE market_listings ADD COLUMN IF NOT EXISTS delisted_at TIMESTAMPTZ;
ALTER TABLE market_listings ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE market_listings ADD COLUMN IF NOT EXISTS khoroolol TEXT;
ALTER TABLE market_listings ADD COLUMN IF NOT EXISTS floor INTEGER;
ALTER TABLE market_listings ADD COLUMN IF NOT EXISTS total_floors INTEGER;
ALTER TABLE market_listings ADD COLUMN IF NOT EXISTS ad_type TEXT;
ALTER TABLE market_listings ADD COLUMN IF NOT EXISTS is_business INTEGER DEFAULT 0;
ALTER TABLE market_listings ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'apartment';
DELETE FROM market_listings a USING market_listings b
  WHERE a.id < b.id AND a.source = b.source AND a.source_id = b.source_id AND a.source_id <> '' AND a.collected_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS market_listings_src ON market_listings(source, source_id) WHERE source_id <> '';
CREATE INDEX IF NOT EXISTS market_listings_seen ON market_listings(source, active, last_seen);
ALTER TABLE listing_assets ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'photo';
ALTER TABLE listing_assets ADD COLUMN IF NOT EXISTS room_id TEXT;
-- Ш3д: Virtual POV Tour (объект бүрд нэг план + нийтийн хуваалцах token)
CREATE TABLE IF NOT EXISTS tours (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  property_id INTEGER NOT NULL,
  token TEXT UNIQUE NOT NULL,
  plan JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (company_id, property_id)
);
`;

async function init() {
  await db.exec(SCHEMA);
  await db.exec(MIGRATE_LIVE);
  await seed();
  await db.run("INSERT INTO companies (id, name, license_no, plan) VALUES (1, 'Демо агентлаг ХХК', 'СЗХ-2026-001', 'demo') ON CONFLICT (id) DO NOTHING");
  await db.exec("SELECT setval(pg_get_serial_sequence('companies','id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM companies),1))");
  await seedSources();
  await ensureTiers();
  await ensureOwner();
  console.log('[db] PostgreSQL бэлэн');
}
const ready = init().catch((e) => { console.error('[db] init алдаа:', e); process.exit(1); });

module.exports = { db, hash, verify, ready };
