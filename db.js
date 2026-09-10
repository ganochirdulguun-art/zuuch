// «Зууч» — өгөгдлийн сан (node:sqlite, файлд хадгална)
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const path = require('node:path');

// Өгөгдлийн сангийн зам — Railway volume-д тааруулж env-ээр солино (байнгын хадгалалт)
const DB_PATH = process.env.ZUUCH_DB || path.join(__dirname, 'zuuch.db');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  license_no TEXT DEFAULT '',
  plan TEXT NOT NULL DEFAULT 'trial',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL DEFAULT 1,
  username TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('zahiral','agent')),
  phone TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL DEFAULT 1,
  deal_type TEXT NOT NULL CHECK(deal_type IN ('sale','rent')),
  district TEXT NOT NULL,
  khoroolol TEXT DEFAULT '',
  rooms INTEGER NOT NULL,
  area REAL NOT NULL,
  floor INTEGER DEFAULT 0,
  total_floors INTEGER DEFAULT 0,
  is_new INTEGER DEFAULT 0,
  price REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','contracted','closed')),
  agent_id INTEGER,
  owner_name TEXT DEFAULT '',
  owner_phone TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  type TEXT NOT NULL CHECK(type IN ('buyer','seller','renter','landlord')),
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL DEFAULT 1,
  client_id INTEGER NOT NULL,
  deal_type TEXT NOT NULL DEFAULT 'sale',
  budget REAL NOT NULL,
  districts TEXT NOT NULL,
  rooms INTEGER NOT NULL,
  area_min REAL DEFAULT 0,
  area_max REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','matched','closed')),
  agent_id INTEGER,
  last_contact TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS deals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL DEFAULT 1,
  property_id INTEGER,
  client_id INTEGER,
  deal_type TEXT NOT NULL,
  amount REAL NOT NULL,
  commission REAL DEFAULT 0,
  payment_form TEXT DEFAULT 'transfer',
  contract_end TEXT DEFAULT NULL,
  deal_date TEXT DEFAULT (date('now')),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS market_listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL DEFAULT 'demo',
  source_id TEXT DEFAULT '',
  deal_type TEXT NOT NULL DEFAULT 'sale',
  district TEXT NOT NULL,
  rooms INTEGER NOT NULL,
  area REAL NOT NULL,
  price REAL NOT NULL,
  prev_price REAL DEFAULT NULL,
  is_new INTEGER DEFAULT 0,
  listed_at TEXT NOT NULL,
  active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS price_index (
  district TEXT NOT NULL,
  is_new INTEGER NOT NULL,
  median_m2 REAL NOT NULL,
  p25_m2 REAL NOT NULL,
  p75_m2 REAL NOT NULL,
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
-- Цуглуулах хөдөлгүүр (Шат 2 демо)
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,            -- listing_site | broker | rss | fb
  auto INTEGER NOT NULL DEFAULT 1,
  trust REAL NOT NULL DEFAULT 0.7,
  max_concurrency INTEGER NOT NULL DEFAULT 2,
  interval_sec INTEGER NOT NULL DEFAULT 20,
  status TEXT NOT NULL DEFAULT 'active',
  collected INTEGER NOT NULL DEFAULT 0,
  rejected INTEGER NOT NULL DEFAULT 0,
  note TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS fetch_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'delta',
  priority INTEGER NOT NULL DEFAULT 5,
  status TEXT NOT NULL DEFAULT 'queued',   -- queued | running | done
  claimed_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS takedown (
  key TEXT PRIMARY KEY,           -- contact_hash|district — дахин цуглуулахыг блоклоно
  reason TEXT DEFAULT '',
  at TEXT DEFAULT (datetime('now'))
);
`);

// tier багана (эх сурвалжийн бодлогын шатлал: green|yellow|red)
try { db.exec("ALTER TABLE sources ADD COLUMN tier TEXT DEFAULT 'yellow'"); } catch { /* байвал алгасна */ }

// ---- Миграци: market_listings-д цуглуулагчийн багана нэмэх (хуучин sqlite.db дээр) ----
for (const col of [
  'fit_score REAL', 'dedup_group TEXT', 'collected_at TEXT', 'contact_hash TEXT', 'title TEXT', 'images INTEGER DEFAULT 1',
]) {
  try { db.exec(`ALTER TABLE market_listings ADD COLUMN ${col}`); } catch { /* багана байвал алгасна */ }
}

function hash(pw) {
  const salt = crypto.randomBytes(8).toString('hex');
  return salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
}
function verify(pw, stored) {
  const [salt, h] = stored.split(':');
  try { return crypto.timingSafeEqual(Buffer.from(h, 'hex'), crypto.scryptSync(pw, salt, 32)); }
  catch { return false; }
}

// ---- Жишиг өгөгдөл (анх удаа ажиллахад л) ----
function seed() {
  const userCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (userCount > 0) return;

  // Демо компани (id=1) — одоо байгаа хэрэглэгчид үүнд харьяална
  db.prepare("INSERT INTO companies (id, name, license_no, plan) VALUES (1, ?, ?, 'demo')").run('Демо агентлаг ХХК', 'СЗХ-2026-001');

  const insUser = db.prepare('INSERT INTO users (company_id, username, pass_hash, name, role, phone) VALUES (1,?,?,?,?,?)');
  insUser.run('zahiral', hash('zuuch2026'), 'Ганбат (захирал)', 'zahiral', '9911xxxx');
  insUser.run('agent1', hash('zuuch2026'), 'Сарнай (агент)', 'agent', '9902xxxx');
  insUser.run('agent2', hash('zuuch2026'), 'Тэмүүлэн (агент)', 'agent', '9515xxxx');

  // Үнийн индекс — 2026.02 нээлттэй эх сурвалжид тулгуурласан ЖИШИГ утгууд (сая ₮/м²)
  const idx = [
    // district, шинэ медиан, хуучин медиан
    ['Сүхбаатар', 6.25, 5.20], ['Хан-Уул', 5.10, 4.60], ['Баянгол', 4.60, 4.20],
    ['Баянзүрх', 4.40, 4.00], ['Чингэлтэй', 4.30, 3.90], ['Сонгинохайрхан', 3.60, 3.30],
  ];
  const insIdx = db.prepare('INSERT INTO price_index (district,is_new,median_m2,p25_m2,p75_m2,sample,month) VALUES (?,?,?,?,?,?,?)');
  for (const [d, nu, ol] of idx) {
    insIdx.run(d, 1, nu, nu * 0.92, nu * 1.09, 40 + Math.floor(nu * 10), '2026-02');
    insIdx.run(d, 0, ol, ol * 0.90, ol * 1.10, 60 + Math.floor(ol * 12), '2026-02');
  }

  // Байршлын оноо (А8) — дүүргийн түвшний ЖИШИГ утгууд; бодит хувилбарт 150м торлолоор OSM/Google-ээс тооцно
  const loc = [
    // district, edu, trans, comm, env, health, park, gov, green, growth, note
    ['Сүхбаатар', 88, 90, 95, 55, 90, 35, 95, 60, 'stable', 'Төвийн бүс — дэд бүтэц бүрэн ч зогсоол хомс, үнэ өндөр'],
    ['Хан-Уул', 75, 70, 85, 80, 75, 70, 70, 75, 'high', 'Шинэ хороолол + Яармагийн шинэ зам, наадмын бүсийн хөгжил'],
    ['Баянгол', 82, 85, 85, 60, 85, 45, 80, 55, 'stable', 'Хуучин ч дэд бүтэц сайтай, 3/4-р хороолол эрэлттэй'],
    ['Баянзүрх', 70, 65, 70, 55, 65, 55, 65, 60, 'growing', '13-р хороолол, Офицер орчим BRT шугамын дагуу'],
    ['Чингэлтэй', 72, 75, 70, 45, 70, 40, 85, 45, 'stable', 'Төвийн хойд хэсэг; гэр хорооллын зэргэлдээ агаарын асуудал'],
    ['Сонгинохайрхан', 55, 60, 55, 40, 50, 65, 55, 45, 'growing', 'Метроны баруун чиглэл (2030) + хямд үнийн давуу'],
  ];
  const insLoc = db.prepare('INSERT INTO location_scores (district,education,transport,commerce,environment,health,parking,gov,green,total,growth,growth_note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  for (const [d, e, t, c, en, h, p, g, gr, growth, note] of loc) {
    const total = Math.round(e * .20 + t * .15 + c * .15 + en * .15 + h * .10 + p * .10 + g * .08 + gr * .07);
    insLoc.run(d, e, t, c, en, h, p, g, gr, total, growth, note);
  }

  // Зах зээлийн зарууд (А1 цуглуулагч холбогдох хүртэлх демо — индексийн орчимд тархаасан 40 зар)
  const insML = db.prepare('INSERT INTO market_listings (source,source_id,deal_type,district,rooms,area,price,prev_price,is_new,listed_at,active) VALUES (?,?,?,?,?,?,?,?,?,?,1)');
  let sid = 1000;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const roomsK = { 1: 1.06, 2: 1.0, 3: 0.95, 4: 0.92 };
  for (const [d, nu, ol] of idx) {
    for (let i = 0; i < 7; i++) {
      const isNew = Math.random() < 0.4 ? 1 : 0;
      const rooms = [1, 2, 2, 3, 3, 4][Math.floor(Math.random() * 6)];
      const area = Math.round(rooms * rnd(24, 34));
      const base = (isNew ? nu : ol) * roomsK[rooms];
      let m2 = base * rnd(0.85, 1.15);
      const daysAgo = Math.floor(rnd(1, 90));
      const listed = new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 10);
      let price = Math.round(m2 * area * 10) / 10;
      let prev = null;
      if (Math.random() < 0.2) prev = Math.round(price * rnd(1.06, 1.12) * 10) / 10; // үнэ буулгасан зар
      insML.run('unegui-demo', String(sid++), 'sale', d, rooms, area, price, prev, isNew, listed);
    }
  }

  // Демо объект, харилцагч, хүсэлт, хэлцэл
  const insP = db.prepare(`INSERT INTO properties (deal_type,district,khoroolol,rooms,area,floor,total_floors,is_new,price,status,agent_id,owner_name,owner_phone,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  insP.run('sale', 'Хан-Уул', 'Жардин хотхон', 2, 55, 7, 16, 1, 305, 'active', 2, 'Оюунаа', '8811xxxx', 'Бүрэн тавилгатай, баруун урд зүг');
  insP.run('sale', 'Баянгол', '4-р хороолол', 3, 68, 3, 5, 0, 285, 'active', 2, 'Батсайхан', '9909xxxx', 'Хуучин засвартай, сургууль ойрхон');
  insP.run('sale', 'Сүхбаатар', 'Хүүхдийн 100 орчим', 2, 52, 9, 12, 0, 292, 'active', 3, 'Дэлгэрмаа', '9191xxxx', '');
  insP.run('sale', 'Баянзүрх', '13-р хороолол', 1, 33, 4, 9, 0, 128, 'active', 3, 'Нямдорж', '9515xxxx', 'Түлхүүр бэлэн');
  insP.run('rent', 'Сүхбаатар', 'Төв талбай орчим', 2, 58, 5, 10, 0, 2.1, 'active', 2, 'Энхжин', '9860xxxx', 'Сарын түрээс, барьцаа 1 сар');
  insP.run('sale', 'Хан-Уул', 'Гоёо хотхон', 3, 82, 12, 20, 1, 470, 'contracted', 2, 'Мөнхбат', '9111xxxx', 'Урьдчилгаа авсан');
  insP.run('rent', 'Баянгол', '10-р хороолол', 1, 32, 2, 5, 0, 1.25, 'active', 3, 'Сувдаа', '9414xxxx', '');
  insP.run('sale', 'Сонгинохайрхан', 'Москва хороолол', 2, 50, 6, 9, 0, 168, 'active', 3, 'Ганзориг', '9090xxxx', 'Яаралтай зарна');

  const insC = db.prepare('INSERT INTO clients (name,phone,type,notes) VALUES (?,?,?,?)');
  insC.run('Билгүүн', '9911yyyy', 'buyer', 'Ипотек урьдчилан зөвшөөрөгдсөн, 320 сая хүртэл');
  insC.run('Наранцэцэг', '8800yyyy', 'buyer', 'Бэлэн мөнгө, яаралтай');
  insC.run('Төгөлдөр', '9515yyyy', 'renter', 'Гэр бүл 3 ам бүл');
  insC.run('Оюунаа', '8811xxxx', 'seller', 'Жардины 2 өрөөний эзэн');
  insC.run('Энхтуяа', '9902yyyy', 'buyer', 'Хүүхэд сургуульд ойрхон байлгах хүсэлтэй');

  const insR = db.prepare('INSERT INTO requests (client_id,deal_type,budget,districts,rooms,area_min,area_max,status,agent_id,last_contact) VALUES (?,?,?,?,?,?,?,?,?,?)');
  insR.run(1, 'sale', 310, 'Хан-Уул,Баянгол', 2, 45, 65, 'open', 2, new Date(Date.now() - 4 * 864e5).toISOString());
  insR.run(2, 'sale', 180, 'Баянзүрх,Сонгинохайрхан', 2, 40, 60, 'open', 3, new Date().toISOString());
  insR.run(3, 'rent', 1.6, 'Баянгол,Чингэлтэй', 1, 28, 45, 'open', 3, new Date(Date.now() - 1 * 864e5).toISOString());
  insR.run(5, 'sale', 300, 'Баянгол,Сүхбаатар', 3, 60, 80, 'open', 2, new Date().toISOString());

  const insD = db.prepare('INSERT INTO deals (property_id,client_id,deal_type,amount,commission,payment_form,contract_end,deal_date) VALUES (?,?,?,?,?,?,?,?)');
  insD.run(6, 2, 'sale', 470, 9.4, 'mortgage', null, '2026-08-28');
  insD.run(5, 3, 'rent', 2.1, 2.1, 'transfer', new Date(Date.now() + 18 * 864e5).toISOString().slice(0, 10), '2026-08-12');
}
seed();

// Демо компани (id=1) байхыг баталгаажуулна (хуучин сан дээр ч)
try { db.prepare("INSERT OR IGNORE INTO companies (id, name, license_no, plan) VALUES (1, 'Демо агентлаг ХХК', 'СЗХ-2026-001', 'demo')").run(); } catch {}

// Эх сурвалжийн бүртгэл (цуглуулагчид) — тусад нь, хоосон бол
function seedSources() {
  if (db.prepare('SELECT COUNT(*) c FROM sources').get().c > 0) return;
  const ins = db.prepare('INSERT INTO sources (name,label,kind,auto,trust,max_concurrency,interval_sec,note) VALUES (?,?,?,?,?,?,?,?)');
  ins.run('unegui', 'Unegui.mn', 'listing_site', 1, 0.72, 3, 8, 'Өндөр урсгал, чанар холимог');
  ins.run('barilga', 'Barilga.mn', 'listing_site', 1, 0.80, 2, 12, 'Шинэ орон сууц голлоно');
  ins.run('remax', 'RE/MAX брокер вэб', 'broker', 1, 0.90, 2, 15, 'Бага урсгал, өндөр чанар');
  ins.run('orgil', 'Оргил зууч вэб', 'broker', 1, 0.85, 2, 18, 'Брокерын өөрийн листинг');
  ins.run('fb_group', 'FB «УБ орон сууц» групп', 'fb', 0, 0.50, 1, 0, 'ГАР оруулалт — ToS-оор автомат ухахгүй');
}
seedSources();

// Эх сурвалжийн бодлогын шатлал (идемпотент — боот бүрт баталгаажуулна)
function ensureTiers() {
  const tiers = { remax: 'green', orgil: 'green', unegui: 'yellow', barilga: 'yellow', fb_group: 'red' };
  const upd = db.prepare('UPDATE sources SET tier=? WHERE name=?');
  for (const [name, t] of Object.entries(tiers)) upd.run(t, name);
}
ensureTiers();

module.exports = { db, hash, verify };
