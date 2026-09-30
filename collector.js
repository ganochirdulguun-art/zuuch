// «Зууч» — цуглуулах хөдөлгүүр (Шат 2, async/PostgreSQL)
// Хоёр горим: ДЕМО (симуляц эх сурвалж, жинхэнэ сайт руу хандахгүй) ба БОДИТ (ZUUCH_COLLECTOR_LIVE=1 →
// adapters/unegui.js ажиглах горимоор). orchestrator + 10 worker + гинжин хэлхээ + итгэлцүүрийн шүүлт +
// ажиглах горимын хамгаалалтууд хоёуланд нь адил ажиллана.
const crypto = require('node:crypto');
const { db, ready } = require('./db');
const unegui = require('./adapters/unegui');
const omch = require('./adapters/omch');
const myzar = require('./adapters/myzar');
// unegui-ээс гадна бодит адаптертай эх сурвалжууд: мөчлөгийн давтамж (сек) + нэг мөчлөгт татах дэлгэрэнгүйн дээд хэмжээ
const EXTRA = {
  omch: { adapter: omch, intervalSec: Number(process.env.ZUUCH_OMCH_INTERVAL || 1800), detailPerCycle: 60 },
  myzar: { adapter: myzar, intervalSec: Number(process.env.ZUUCH_MYZAR_INTERVAL || 900) },
};
const LIVE_SOURCES = ['unegui', ...Object.keys(EXTRA)];

const LIVE = process.env.ZUUCH_COLLECTOR_LIVE === '1';
const LIVE_INTERVAL_SEC = Math.max(120, Number(process.env.ZUUCH_UNEGUI_INTERVAL || 600));
const DETAIL_PER_CYCLE = 8;     // талбайгүй шинэ зарын дэлгэрэнгүйг нэг мөчлөгт хамгийн ихдээ
const RECHECK_PER_CYCLE = 5;    // «сайтад хэвээр байна уу» шалгалт нэг мөчлөгт
const DELIST_CHECK_DAYS = 7;    // толгой хуудсанд 7 хоног харагдаагүй зарыг дахин шалгана
const WORKER_COUNT = 10;
const FIT_THRESHOLD = 55;
const COLLECT_CATS = new Set(['apartment', 'house', 'office', 'commercial', 'object', 'warehouse', 'land']);
const COLLECT_CAP = LIVE ? 50000 : 400;
const MONITORING_MODE = true;
const SALT = process.env.ZUUCH_SALT || 'zuuch-monitor-salt-2026';
const USER_AGENT = LIVE ? unegui.UA : 'ZuuchBot/1.0 (+smartzuuch.mn@gmail.com; зөвхөн ажиглах, дотоод шинжилгээ)';
const RETENTION_DAYS = 90;
const P_304 = 0.30;
const DISTRICTS = ['Сүхбаатар', 'Хан-Уул', 'Баянгол', 'Баянзүрх', 'Чингэлтэй', 'Сонгинохайрхан'];
const KHOROOLOL = { 'Сүхбаатар': ['Төв талбай', '100 айл', 'Их сургууль'], 'Хан-Уул': ['Жардин', 'Гоёо', 'Яармаг'], 'Баянгол': ['3-р хороолол', '4-р хороолол', '10-р хороолол'], 'Баянзүрх': ['13-р хороолол', 'Офицер', 'Гандан'], 'Чингэлтэй': ['5-р хороолол', 'Сансар', 'Тахилт'], 'Сонгинохайрхан': ['Москва', '5 шар', 'Толгойт'] };
const ROOMS_K = { 1: 1.06, 2: 1.0, 3: 0.95, 4: 0.92 };
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hashPhone = (p) => (p ? crypto.createHash('sha256').update(SALT + '|' + p).digest('hex').slice(0, 20) : null);
// Холбоо барих хэш: утас байвал утас, үгүй бол эх сурвалжийн хэрэглэгчийн ID (хоёулаа давсласан — жинхэнэ утга хадгалагдахгүй)
const contactOf = (l) => (l.phone ? hashPhone(l.phone) : l.contactKey ? hashPhone(l.contactKey) : null);
const tdKey = (l) => (l.contactHash || contactOf(l)) + '|' + l.district;

const freshLive = () => ({ lastCycleAt: null, cycles: 0, updated: 0, priceChanges: 0, detailFetched: 0, delisted: 0, errors: 0, known: new Map(), pageHash: {}, memo: {}, bySource: {} });
const state = {
  running: false,
  workers: Array.from({ length: WORKER_COUNT }, (_, i) => ({ id: i + 1, status: 'сул', source: '', since: Date.now() })),
  stats: { fetched: 0, skipped304: 0, parsed: 0, collected: 0, rejected: 0, retired: 0, takedowns: 0, startedAt: null },
  rejectReasons: {}, activePerSource: {}, events: [], note: '', live: freshLive(),
};
function logEvent(e) { state.events.unshift({ ...e, t: Date.now() }); if (state.events.length > 120) state.events.pop(); }
function bump(map, k) { map[k] = (map[k] || 0) + 1; }

// Индексийн кэш (30 сек) — worker бүр давтан асуухгүй
let idxCache = { at: 0, map: new Map() };
async function indexMap() {
  if (Date.now() - idxCache.at > 30000) {
    const rows = await db.all('SELECT DISTINCT ON (district, is_new) * FROM price_index ORDER BY district, is_new, month DESC');
    idxCache = { at: Date.now(), map: new Map(rows.map(r => [r.district + '|' + r.is_new, r])) };
  }
  return idxCache.map;
}

let sidSeq = 5000;
async function generateRaw(source) {
  const roll = Math.random();
  const district = pick(DISTRICTS);
  const rooms = pick([1, 2, 2, 3, 3, 4]);
  const area = Math.round(rooms * rnd(24, 34));
  const idx = (await indexMap()).get(district + '|0');
  const isNew = Math.random() < 0.4 ? 1 : 0;
  const baseM2 = (idx ? idx.median_m2 : 4) * (ROOMS_K[rooms] || 1) * (isNew ? 1.12 : 1);
  const daysAgo = Math.floor(rnd(0, 95));
  const phone = '+976' + Math.floor(rnd(80000000, 99999999));
  const raw = {
    source: source.name, source_id: 'L' + (sidSeq++) + '-' + crypto.randomBytes(2).toString('hex'),
    title: `${district} ${rooms} өрөө байр`, category: 'apartment',
    districtText: district, khoroolol: pick(KHOROOLOL[district] || ['']),
    roomsText: String(rooms), areaText: area + ' м2', is_new: isNew,
    priceText: (Math.round(baseM2 * area * 10) / 10) + ' сая',
    phone, images: Math.floor(rnd(0, 9)), postedDaysAgo: daysAgo, descr: 'Тавилгатай, наран талдаа',
    prev_price: Math.random() < 0.18 ? Math.round(baseM2 * area * rnd(1.06, 1.12) * 10) / 10 : null,
  };
  if (roll < 0.08) { raw.category = 'car'; raw.title = 'Toyota Prius 2015'; }
  else if (roll < 0.16) { raw.districtText = ''; }
  else if (roll < 0.24) { raw._dupOf = true; }
  else if (roll < 0.30) { raw.priceText = (Math.round(baseM2 * area * 0.25 * 10) / 10) + ' сая'; }
  else if (roll < 0.34) { raw.descr += '. Урьдчилгаа 500мянга шилжүүлбэл түлхүүр өгнө'; }
  else if (roll < 0.46) { if (Math.random() < 0.5) raw.phone = ''; else raw.areaText = ''; }
  return raw;
}

function normalize(raw) {
  const num = (s) => { const m = String(s || '').replace(/,/g, '').match(/[\d.]+/); return m ? parseFloat(m[0]) : null; };
  const phone = String(raw.phone || '').replace(/[^\d+]/g, '');
  const daysAgo = raw.postedDaysAgo == null ? 30 : raw.postedDaysAgo;
  return {
    source: raw.source, source_id: raw.source_id, title: raw.title, category: raw.category || 'apartment', is_new: raw.is_new ? 1 : 0,
    deal_type: raw.deal_type === 'rent' ? 'rent' : 'sale',
    // Байршил: УБ-ын дүүрэг эсвэл аймаг/сум — бүгдийг хадгална (индекс/үнэлгээ зөвхөн УБ-ын 6 дүүрэгт)
    city: (raw.cityText || 'Улаанбаатар').slice(0, 40), district: (raw.districtText || '').slice(0, 40) || null, khoroolol: (raw.khoroolol || '').slice(0, 60),
    isUB: DISTRICTS.includes(raw.districtText),
    rooms: num(raw.roomsText), area: num(raw.areaText), price: num(raw.priceText),
    floor: raw.floor || null, total_floors: raw.total_floors || null,
    prev_price: raw.prev_price, images: raw.images | 0,
    phone: /^\+976\d{8}$/.test(phone) ? phone : (phone || null), phoneValid: /^\+976\d{8}$/.test(phone),
    contactKey: raw.contactKey || '', url: raw.url || '', ad_type: raw.ad_type || '', is_business: raw.is_business ? 1 : 0,
    poster_name: raw.poster_name || '', poster_verified: raw.poster_verified ? 1 : 0,
    postedDaysAgo: daysAgo, descr: raw.descr, _dupOf: raw._dupOf,
    listed_at: new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 10),
  };
}

async function dedup(l) {
  if (await db.one('SELECT id FROM market_listings WHERE source=? AND source_id=?', l.source, l.source_id)) return 'update';
  if (l._dupOf) {
    const g = await db.one('SELECT dedup_group FROM market_listings WHERE district=? AND rooms=? AND active=1 AND dedup_group IS NOT NULL LIMIT 1', l.district, l.rooms);
    if (g) { l._group = g.dedup_group; return 'cross_dup'; }
  }
  if (l.contactHash && l.area) {
    // Өөр эх сурвалж/өөр зараар давхардсан: нэг холбоо + нэг дүүрэг + ижил талбай
    const near = await db.one('SELECT dedup_group FROM market_listings WHERE contact_hash=? AND district=? AND ABS(area-?)<=2 AND active=1 AND NOT (source=? AND source_id=?) LIMIT 1', l.contactHash, l.district, l.area, l.source, l.source_id);
    if (near) { l._group = near.dedup_group; return 'cross_dup'; }
  }
  return 'new';
}

async function enrich(l) {
  const idx = (await indexMap()).get(l.district + '|' + l.is_new);
  l.m2 = l.price && l.area ? l.price / l.area : null;
  l.indexM2 = idx ? idx.median_m2 * (ROOMS_K[l.rooms] || 1) : null;
  return l;
}

async function fitScore(l, source) {
  // Хүлээн авах ангиллууд: орон сууц, хаус/хашаа байшин, оффис, худалдаа үйлчилгээ, объект, агуулах, газар; «хажуу өрөө»/бусад — татгалзана
  if (!COLLECT_CATS.has(l.category)) return { collect: false, reason: 'ангилал таарахгүй', score: 0 };
  if (!l.district) return { collect: false, reason: 'байршил тодорхойгүй', score: 0 };
  const isApt = l.category === 'apartment';
  l.contactHash = contactOf(l);
  if (await db.one('SELECT 1 FROM takedown WHERE key=?', tdKey(l))) return { collect: false, reason: 'хасалтын жагсаалтад', score: 0 };
  const dd = await dedup(l);
  if (dd === 'cross_dup') return { collect: false, reason: 'давхардсан (өөр суваг)', score: 0, dd };

  const flags = [];
  // Үнийн индекс зөвхөн зарах зах зээлийнх — түрээст харьцаа тооцохгүй
  const ratio = isApt && l.deal_type === 'sale' && l.m2 && l.indexM2 ? l.m2 / l.indexM2 : 1; // индекс = зөвхөн орон сууц зарах
  if (ratio < 0.35) flags.push('хэт хямд');
  if (/урьдчилгаа/i.test(l.descr || '')) return { collect: false, reason: 'скам сэжигтэй (урьдчилгаа)', score: 0, flags: ['урьдчилгаа_шаардсан'] };
  if (l.contactHash && !l.is_business) {
    const { c } = await db.one('SELECT COUNT(*)::int c FROM market_listings WHERE contact_hash=? AND active=1', l.contactHash);
    if (c >= 4) flags.push('олон байр 1 холбоо');
  }
  const complete = 0.3 * (l.price ? 1 : 0) + 0.2 * (l.area ? 1 : 0) + 0.2 * (isApt ? (l.rooms ? 1 : 0) : 1) + 0.15 * (l.district ? 1 : 0) + 0.15 * (l.contactHash ? 1 : 0);
  const priceHealthy = ratio >= 0.4 && ratio <= 2.5 ? 1 : Math.max(0, 1 - Math.abs(ratio - 1.4) / 2);
  const imageScore = l.images >= 3 ? 1 : l.images >= 1 ? 0.6 : 0;
  const fresh = l.postedDaysAgo <= 7 ? 1 : Math.max(0, 1 - (l.postedDaysAgo - 7) / 83);
  const contactScore = l.phoneValid ? 1 : l.contactKey ? 0.7 : 0;
  let s = 20 * complete + 15 * priceHealthy + 10 * source.trust + 10 * contactScore + 8 * imageScore + 7 * fresh + 15 * (dd === 'new' ? 1 : 0.4);
  s -= 12 * flags.length;
  s = Math.max(0, Math.round(s));
  return { collect: s >= FIT_THRESHOLD, score: s, flags, dd, reason: s >= FIT_THRESHOLD ? null : 'оноо босго хүрээгүй' };
}

// ---- Нийтлэгчийн бүртгэл: нийтэд ил профайлын баримт (нэр, бизнес, баталгаажсан, зарын тоо/ангилал/дүүрэг) → эзэн/агент/компани ангилал ----
const COMPANY_RX = /ххк|llc|realty|real ?estate|зуучлал|агентлаг|property|properties|хотхон|барилга|констракшн|construction|групп|group|invest|инвест|девелоп|develop|resid/i;
function classifyPoster(p) {
  const cats = Object.keys(p.categories || {}).length, n = p.listings || 0;
  if (COMPANY_RX.test(p.name || '')) return { kind: n >= 5 ? 'developer' : 'agency', company: p.name };
  if (p.is_business || n >= 4 || cats >= 3) return { kind: 'agent', company: '' };
  if (n <= 2) return { kind: 'owner', company: '' };
  return { kind: 'unknown', company: '' };
}
async function upsertPoster(l) {
  if (!l.contactKey) return;
  const key = l.contactKey;
  const ex = await db.one('SELECT * FROM posters WHERE key=?', key);
  const cats = ex ? { ...(ex.categories || {}) } : {}; cats[l.category] = (cats[l.category] || 0) + (ex && ex.listings ? 0 : 0);
  const { c } = await db.one('SELECT COUNT(*)::int c FROM market_listings WHERE poster_key=?', key);
  const { a } = await db.one('SELECT COUNT(*)::int a FROM market_listings WHERE poster_key=? AND active=1', key);
  const catRows = await db.all('SELECT category, COUNT(*)::int n FROM market_listings WHERE poster_key=? GROUP BY category', key);
  const distRows = await db.all('SELECT district, COUNT(*)::int n FROM market_listings WHERE poster_key=? GROUP BY district', key);
  const categories = Object.fromEntries(catRows.map((r) => [r.category || 'apartment', r.n])); const districts = Object.fromEntries(distRows.map((r) => [r.district, r.n]));
  const base = { name: l.poster_name || (ex && ex.name) || '', is_business: l.is_business || (ex && ex.is_business) || 0, listings: c, categories };
  const cls = classifyPoster(base);
  if (ex) await db.run('UPDATE posters SET name=?, is_business=?, verified=GREATEST(verified,?), listings=?, active_listings=?, categories=?, districts=?, kind=?, company_guess=?, last_seen=NOW() WHERE key=?', base.name, base.is_business, l.poster_verified || 0, c, a, JSON.stringify(categories), JSON.stringify(districts), cls.kind, cls.company, key);
  else await db.run('INSERT INTO posters (key, source, name, is_business, verified, listings, active_listings, categories, districts, kind, company_guess) VALUES (?,?,?,?,?,?,?,?,?,?,?)', key, l.source, base.name, base.is_business, l.poster_verified || 0, c, a, JSON.stringify(categories), JSON.stringify(districts), cls.kind, cls.company);
}

async function process1(raw, source) {
  state.stats.parsed++;
  const l = await enrich(normalize(raw));
  // Өмнө нь цуглуулсан зар дахин харагдвал: «амьд» тэмдэглэнэ, үнэ өөрчлөгдсөн бол түүхэнд (prev_price) үлдээнэ
  if (l.source_id) {
    const ex = await db.one('SELECT id, price, active FROM market_listings WHERE source=? AND source_id=?', l.source, l.source_id);
    if (ex) {
      const priceChanged = l.price && Math.abs(Number(ex.price) - l.price) > 0.01;
      if (priceChanged) await db.run('UPDATE market_listings SET last_seen=NOW(), active=1, delisted_at=NULL, images=?, ad_type=?, prev_price=price, price=? WHERE id=?', l.images, l.ad_type, l.price, ex.id);
      else await db.run('UPDATE market_listings SET last_seen=NOW(), active=1, delisted_at=NULL, images=?, ad_type=? WHERE id=?', l.images, l.ad_type, ex.id);
      state.live.updated++;
      if (priceChanged) { state.live.priceChanges++; logEvent({ kind: 'price', lid: ex.id, source: source.name, title: l.title, district: l.district, price: l.price, prev: Number(ex.price), url: l.url }); }
      if (l.contactKey) { await db.run('UPDATE market_listings SET poster_key=? WHERE id=? AND poster_key IS NULL', l.contactKey, ex.id); if (Math.random() < 0.2) await upsertPoster(l).catch(() => {}); }
      return;
    }
  }
  const r = await fitScore(l, source);
  if (r.collect) {
    const group = l._group || 'g' + crypto.randomBytes(4).toString('hex');
    const ins = await db.one(`INSERT INTO market_listings (source,source_id,deal_type,district,rooms,area,price,prev_price,is_new,listed_at,active,fit_score,dedup_group,collected_at,contact_hash,title,images,
        last_seen,source_url,khoroolol,floor,total_floors,ad_type,is_business,category,poster_key,city)
      VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?, NOW(),?,?,?,?,?,?,?,?,?) RETURNING id`, l.source, l.source_id, l.deal_type, l.district, l.rooms || 0, l.area || 0, l.price || 0,
      l.prev_price, l.is_new, l.listed_at, r.score, group, new Date().toISOString(), l.contactHash, l.title, l.images,
      l.url || null, l.khoroolol || null, l.floor, l.total_floors, l.ad_type || null, l.is_business, l.category, l.contactKey || null, l.city);
    state.stats.collected++;
    await upsertPoster(l).catch((e) => console.error('[poster]', e.message));
    await db.run('UPDATE sources SET collected=collected+1 WHERE name=?', source.name);
    logEvent({ kind: 'collected', lid: ins && ins.id, source: source.name, title: l.title, district: l.district, price: l.price, deal: l.deal_type, score: r.score, flags: r.flags || [], url: l.url });
  } else {
    state.stats.rejected++;
    bump(state.rejectReasons, r.reason);
    await db.run('UPDATE sources SET rejected=rejected+1 WHERE name=?', source.name);
    logEvent({ kind: 'rejected', source: source.name, title: l.title, reason: r.reason, score: r.score });
  }
}

const lastRun = {};
async function orchestrate() {
  if (!state.running) return;
  try {
    const { c } = await db.one('SELECT COUNT(*)::int c FROM market_listings WHERE collected_at IS NOT NULL');
    if (c >= COLLECT_CAP) { state.note = 'Демо хязгаар (' + COLLECT_CAP + ' цуглуулсан) — Reset дарж дахин эхлүүлнэ үү'; return; }
    await retentionTick();
    const q = await db.one("SELECT COUNT(*)::int c FROM fetch_jobs WHERE status='queued'");
    if (!LIVE && q.c > 30) return;
    // Бодит горимд зөвхөн адаптертай эхүүд (unegui, omch, my-zar) ажиллана; симуляц эхүүд зогсоно
    const sources = LIVE
      ? await db.all(`SELECT * FROM sources WHERE name IN (${LIVE_SOURCES.map(() => '?').join(',')}) AND status='active'`, ...LIVE_SOURCES)
      : await db.all("SELECT * FROM sources WHERE auto=1 AND status='active' AND tier <> 'red'");
    for (const s of sources) {
      const intervalSec = LIVE ? (EXTRA[s.name] ? EXTRA[s.name].intervalSec : LIVE_INTERVAL_SEC) : s.interval_sec;
      const due = !lastRun[s.name] || Date.now() - lastRun[s.name] >= intervalSec * 1000;
      if (!due) continue;
      if (LIVE) { // тухайн эхийн өмнөх мөчлөгийн ажлууд дуусаагүй бол хүлээнэ (эхүүд бие биеэ хүлээхгүй)
        const pend = await db.one("SELECT COUNT(*)::int c FROM fetch_jobs WHERE source_name=? AND status IN ('queued','running')", s.name);
        if (pend.c > 0) continue;
      }
      lastRun[s.name] = Date.now();
      if (LIVE && s.name === 'omch') { await db.run("INSERT INTO fetch_jobs (source_name,kind,priority) VALUES (?, 'sitemap', 6)", s.name); continue; }
      if (LIVE && s.name === 'myzar') { for (const key of Object.keys(myzar.CATS)) await db.run('INSERT INTO fetch_jobs (source_name,kind,priority) VALUES (?, ?, ?)', s.name, key, key.startsWith('apt') ? 6 : 4); continue; }
      if (LIVE && s.name === 'unegui') {
        // Ангилал бүр = тусдаа ажил → олон бот зэрэг (адаптерийн 4 сек зай нийтлэг тул сайтад ачаалал нэмэгдэхгүй)
        for (const key of Object.keys(unegui.CATS)) await db.run('INSERT INTO fetch_jobs (source_name,kind,priority) VALUES (?, ?, ?)', s.name, key, key === 'sale' || key === 'rent' ? 9 : 5);
        await db.run("INSERT INTO fetch_jobs (source_name,kind,priority) VALUES (?, 'recheck', 3)", s.name);
        continue;
      }
      await db.run("INSERT INTO fetch_jobs (source_name,kind,priority) VALUES (?, 'delta', ?)", s.name, Math.round(s.trust * 10));
    }
  } catch (e) { console.error('[collector orchestrate]', e.message); }
}

let lastRetention = 0;
async function retentionTick() {
  if (Date.now() - lastRetention < 15000) return;
  lastRetention = Date.now();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 864e5).toISOString().slice(0, 10);
  const r = await db.run('UPDATE market_listings SET active=0 WHERE active=1 AND collected_at IS NOT NULL AND listed_at < ?', cutoff);
  if (r.changes) { state.stats.retired += r.changes; logEvent({ kind: 'retired', count: r.changes, reason: `${RETENTION_DAYS}+ хоног — хадгалалтын хугацаа` }); }
}

async function takedownLatest() {
  const row = await db.one('SELECT dedup_group, contact_hash, district, title FROM market_listings WHERE collected_at IS NOT NULL AND active=1 ORDER BY id DESC LIMIT 1');
  if (!row) return { ok: false, msg: 'Устгах зар алга' };
  const r = await db.run('UPDATE market_listings SET active=0 WHERE dedup_group=?', row.dedup_group);
  if (row.contact_hash && row.district) await db.run("INSERT INTO takedown (key,reason) VALUES (?, 'эх/эзний хүсэлт') ON CONFLICT DO NOTHING", row.contact_hash + '|' + row.district);
  state.stats.takedowns++;
  logEvent({ kind: 'takedown', title: row.title, reason: `бүлэг устгагдаж дахин цуглуулахыг блоклов (${r.changes} зар)` });
  return { ok: true };
}

// ---- Бодит горим: unegui.mn нэг мөчлөг (зарна + түрээс толгой хуудсууд → шүүлт → сан) ----
// Нэг ангиллын ажил (catKey: sale/rent/office_sale/…) — ботууд ангилал бүрийг зэрэг авна; адаптерийн 4 сек зай нийтлэг
async function liveCycle(source, w, catKey) {
  const live = state.live; const cat = unegui.CATS[catKey]; if (!cat) return;
  w.status = 'unegui · ' + cat.label; w.source = cat.label;
  let r;
  try { r = await unegui.cycle(catKey, { knownIds: live.known }); }
  catch (e) { live.errors++; logEvent({ kind: 'error', source: source.name, reason: cat.label + ': ' + e.message }); return; }
  state.stats.fetched += r.pages.length;
  for (const p of r.pages) {
    const key = catKey + ':' + p.page;
    if (p.hash && live.pageHash[key] === p.hash) state.stats.skipped304++; // агуулга өөрчлөгдөөгүй (304-тэй адил утга)
    live.pageHash[key] = p.hash;
  }
  let detailBudget = cat.category === 'apartment' ? DETAIL_PER_CYCLE : 3;
  w.status = 'боловсруулж · ' + cat.label;
  for (const raw of r.adverts) {
    const isNew = !live.known.has(raw.source_id);
    if (isNew && raw.category === 'apartment' && !raw.areaText && detailBudget > 0 && raw.url) {
      detailBudget--;
      try {
        const d = await unegui.detail(raw.url); live.detailFetched++;
        if (d.area) raw.areaText = String(d.area);
        raw.floor = d.floor; raw.total_floors = d.total_floors;
        if (d.built_year && d.built_year >= new Date().getFullYear() - 1) raw.is_new = 1;
      } catch (e) { live.errors++; }
    }
    try { await process1(raw, source); } catch (e) { live.errors++; console.error('[collector live process1]', e.message); }
    live.known.set(raw.source_id, raw.priceText);
  }
  live.byCat = live.byCat || {}; live.byCat[catKey] = { label: cat.label, adverts: r.adverts.length, pages: r.pages.length, at: Date.now() };
  if (catKey === 'sale') { live.cycles++; live.lastCycleAt = Date.now(); }
}
// Өмнө нь боловсруулсан, үнэ нь өөрчлөгдөөгүй зарыг дахин тоолохгүй (татгалзсан зар мөчлөг бүр «татгалзсан» статистикийг хөөргөхгүй)
function memoSkip(srcName, raw) {
  const m = (state.live.memo[srcName] = state.live.memo[srcName] || new Map());
  const key = raw.priceText + '|' + raw.districtText;
  if (m.get(raw.source_id) === key) return true;
  m.set(raw.source_id, key); return false;
}
function noteSource(name, info) { state.live.bySource[name] = { ...(state.live.bySource[name] || {}), ...info, at: Date.now() }; }
const jsonIds = (ids) => JSON.stringify(ids.map(String));

// ---- omch.mn: sitemap → шинэ/өөрчлөгдсөн зарын дэлгэрэнгүй (JSON-LD) → шүүлт → сан; sitemap-аас алга болсон = хасагдсан ----
async function omchCycle(source, w) {
  const live = state.live; const cfg = EXTRA.omch;
  w.status = 'omch · sitemap'; w.source = 'omch.mn';
  let entries;
  try { entries = await omch.sitemap(); } catch (e) { live.errors++; logEvent({ kind: 'error', source: source.name, reason: 'sitemap: ' + e.message }); return; }
  state.stats.fetched++;
  const rows = await db.all("SELECT source_id, last_seen FROM market_listings WHERE source='omch'");
  const have = new Map(rows.map((r) => [r.source_id, r.last_seen ? new Date(r.last_seen).getTime() : 0]));
  const ids = entries.map((e) => e.id);
  // Өөрчлөгдөөгүй, sitemap-д байгаа → амьд
  if (ids.length) await db.run("UPDATE market_listings SET last_seen=NOW(), active=1, delisted_at=NULL WHERE source='omch' AND source_id IN (SELECT jsonb_array_elements_text(?::jsonb))", jsonIds(ids.filter((id) => have.has(id))));
  // sitemap-аас алга болсон идэвхтэй зар = хасагдсан (зарагдсан/буцаасан) — sitemap хоосорсон мэт алдааг хамгаалж 20+ мөртэй үед л
  if (ids.length >= 20) {
    const r = await db.run("UPDATE market_listings SET active=0, delisted_at=NOW() WHERE source='omch' AND active=1 AND collected_at IS NOT NULL AND source_id NOT IN (SELECT jsonb_array_elements_text(?::jsonb))", jsonIds(ids));
    if (r.changes) { live.delisted += r.changes; logEvent({ kind: 'delisted', source: source.name, count: r.changes, reason: 'omch sitemap-аас хасагдсан' }); }
  }
  // Шинэ эсвэл манай сүүлд харснаас хойш өөрчлөгдсөн (lastmod) зар л дэлгэрэнгүйг нь татна
  const todo = entries.filter((e) => !have.has(e.id) || (e.lastmod && Date.parse(e.lastmod) > have.get(e.id) + 60000)).slice(0, cfg.detailPerCycle);
  let done = 0;
  for (const e of todo) {
    w.status = `omch · ${++done}/${todo.length}`;
    let d;
    try { d = await omch.detail(e); live.detailFetched++; state.stats.fetched++; }
    catch (err) { live.errors++; if (/хөргөлт/.test(err.message)) break; continue; }
    if (d.gone || (d.raw && d.raw.active === false)) { await db.run("UPDATE market_listings SET active=0, delisted_at=NOW() WHERE source='omch' AND source_id=? AND active=1", e.id); continue; }
    if (!d.raw) continue;
    try { await process1(d.raw, source); } catch (err) { live.errors++; console.error('[collector omch process1]', err.message); }
  }
  noteSource('omch', { label: 'omch.mn', listed: entries.length, detailed: done, pending: Math.max(0, entries.filter((e) => !have.has(e.id)).length - done) });
}

// ---- my-zar.mn: ангиллын жагсаалт хуудсууд → (дүүрэггүй шинэ зарын дэлгэрэнгүй) → шүүлт → сан ----
let myzarKnown = null;
async function myzarCycle(source, w, catKey) {
  const live = state.live; const cat = myzar.CATS[catKey]; if (!cat) return;
  if (!myzarKnown) myzarKnown = new Set((await db.all("SELECT source_id FROM market_listings WHERE source='myzar'")).map((r) => r.source_id));
  w.status = 'my-zar · ' + cat.label; w.source = cat.label;
  let r;
  try { r = await myzar.cycle(catKey, { isKnown: (id) => myzarKnown.has(id) }); }
  catch (e) { live.errors++; logEvent({ kind: 'error', source: source.name, reason: cat.label + ': ' + e.message }); return; }
  state.stats.fetched += r.pages.length + (r.details || 0); live.detailFetched += r.details || 0;
  w.status = 'боловсруулж · ' + cat.label;
  for (const raw of r.adverts) {
    if (memoSkip('myzar', raw)) continue;
    // «Мэдэгдэж буй» = дахин дэлгэрэнгүй татах шаардлагагүй (дүүрэгтэй, дэлгэрэнгүйг үзсэн, эсвэл үнэгүй)
    try { await process1(raw, source); if (raw.districtText || raw._detailTried || !raw.priceText) myzarKnown.add(raw.source_id); } catch (e) { live.errors++; console.error('[collector myzar process1]', e.message); }
  }
  const bs = live.bySource.myzar || {}; const cats = { ...(bs.cats || {}), [catKey]: { label: cat.label, total: r.total, adverts: r.adverts.length, pages: r.pages.length } };
  noteSource('myzar', { label: 'my-zar.mn', cats, listed: Object.values(cats).reduce((s, c) => s + (c.total || 0), 0) });
}

// Толгой хуудсанд удаан харагдаагүй зар сайтад хэвээр байна уу — 404 бол «хасагдсан» (зарагдсан/буцаасан): зах зээлд байсан хоног = баримт
async function recheckDelisted(source, w) {
  const rows = await db.all(`SELECT id, source_url, title FROM market_listings WHERE source=? AND active=1 AND collected_at IS NOT NULL AND source_url IS NOT NULL
    AND last_seen < NOW() - INTERVAL '${DELIST_CHECK_DAYS} days' ORDER BY last_seen ASC LIMIT ${RECHECK_PER_CYCLE}`, source.name);
  if (rows.length) w.status = 'хасагдсан эсэх шалгаж';
  for (const row of rows) {
    let ok;
    try { ok = await unegui.stillListed(row.source_url); } catch { continue; }
    if (ok === false) {
      await db.run('UPDATE market_listings SET active=0, delisted_at=NOW() WHERE id=?', row.id);
      state.live.delisted++;
      logEvent({ kind: 'delisted', source: source.name, title: row.title, reason: 'сайтаас хасагдсан (зарагдсан/буцаасан)' });
    } else if (ok === true) await db.run('UPDATE market_listings SET last_seen=NOW() WHERE id=?', row.id);
  }
}

// Атомик нэхэмжлэл — зохиомжийн дагуу FOR UPDATE SKIP LOCKED (нэг ажил = нэг бот)
// Эх бүрийн зэрэг ажиллах дээд хэмжээ (30 сек кэш) — дүүрсэн эхийн ажлыг сонгохгүй (бусад эхийн ажил өлсөхгүй)
let maxConc = { at: 0, map: {} };
async function claimJob(wid) {
  if (Date.now() - maxConc.at > 30000) maxConc = { at: Date.now(), map: Object.fromEntries((await db.all('SELECT name, max_concurrency FROM sources')).map((r) => [r.name, r.max_concurrency])) };
  const full = Object.keys(maxConc.map).filter((n) => (state.activePerSource[n] || 0) >= maxConc.map[n]);
  const r = await db.run(`UPDATE fetch_jobs SET status='running', claimed_by=? WHERE id = (
    SELECT id FROM fetch_jobs WHERE status='queued' AND NOT (source_name = ANY(?::text[])) ORDER BY priority DESC, id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`, 'w' + wid, '{' + full.map((n) => '"' + n + '"').join(',') + '}');
  return r.rows[0] || null;
}

async function worker(w) {
  while (true) {
    try {
      if (!state.running) { w.status = 'сул'; w.source = ''; await sleep(400); continue; }
      const job = await claimJob(w.id);
      if (!job) { w.status = 'сул'; w.source = ''; await sleep(rnd(300, 800)); continue; }
      const source = await db.one('SELECT * FROM sources WHERE name=?', job.source_name);
      const active = state.activePerSource[source.name] || 0;
      if (active >= source.max_concurrency) {
        await db.run("UPDATE fetch_jobs SET status='queued', claimed_by=NULL WHERE id=?", job.id);
        await sleep(rnd(200, 500)); continue;
      }
      state.activePerSource[source.name] = active + 1;
      w.status = 'татаж байна'; w.source = source.label; w.since = Date.now();
      try {
        if (LIVE) {
          if (source.name === 'unegui') { if (job.kind === 'recheck') await recheckDelisted(source, w); else await liveCycle(source, w, job.kind); }
          else if (source.name === 'omch') await omchCycle(source, w);
          else if (source.name === 'myzar') await myzarCycle(source, w, job.kind);
          await db.run("UPDATE fetch_jobs SET status='done' WHERE id=?", job.id);
          continue;
        }
        await sleep(rnd(300, 750));
        state.stats.fetched++;
        if (Math.random() < P_304) {
          state.stats.skipped304++; w.status = '304 өөрчлөлтгүй';
          await db.run("UPDATE fetch_jobs SET status='done' WHERE id=?", job.id);
          await sleep(120); continue;
        }
        const batch = Math.floor(rnd(2, 6));
        w.status = 'боловсруулж';
        for (let i = 0; i < batch; i++) { await process1(await generateRaw(source), source); await sleep(rnd(60, 160)); }
        await db.run("UPDATE fetch_jobs SET status='done' WHERE id=?", job.id);
      } catch (e) {
        console.error('[collector worker]', e.message);
        await db.run("UPDATE fetch_jobs SET status='queued', claimed_by=NULL WHERE id=?", job.id).catch(() => {});
      } finally {
        state.activePerSource[source.name]--;
      }
    } catch (e) { console.error('[collector loop]', e.message); await sleep(1000); }
  }
}

let started = false;
function boot() {
  if (started) return; started = true;
  // Өмнөх процессын үлдэгдэл ажлууд (тасарсан «running», хуучин «queued») — хаяна; orchestrate шинэ мөчлөгийг өөрөө үүсгэнэ
  db.run("UPDATE fetch_jobs SET status='done', claimed_by=NULL WHERE status IN ('running','queued')").catch(() => {})
    .finally(() => { for (const w of state.workers) worker(w); setInterval(orchestrate, 2000); });
}
function start() { boot(); state.running = true; state.note = ''; if (!state.stats.startedAt) state.stats.startedAt = Date.now(); }
function stop() { state.running = false; }
async function reset() {
  state.running = false;
  await db.exec('DELETE FROM market_listings WHERE collected_at IS NOT NULL');
  await db.exec('DELETE FROM fetch_jobs');
  await db.exec('DELETE FROM takedown');
  await db.exec('UPDATE sources SET collected=0, rejected=0');
  state.stats = { fetched: 0, skipped304: 0, parsed: 0, collected: 0, rejected: 0, retired: 0, takedowns: 0, startedAt: null };
  state.rejectReasons = {}; state.events = []; state.note = ''; state.live = freshLive();
  for (const k in lastRun) delete lastRun[k];
}
// Бодит горимд сервер асмагц автоматаар ажиглалт эхэлнэ (эзэн/захирал зогсоож болно)
if (LIVE) ready.then(() => setTimeout(start, 3000)).catch(() => {});
async function status() {
  const mins = state.stats.startedAt ? Math.max((Date.now() - state.stats.startedAt) / 60000, 0.05) : 1;
  const [td, q, sources] = await Promise.all([
    db.one('SELECT COUNT(*)::int c FROM takedown'),
    db.one("SELECT COUNT(*)::int c FROM fetch_jobs WHERE status='queued'"),
    db.all("SELECT name,label,kind,auto,tier,trust,max_concurrency,collected,rejected,note,status FROM sources ORDER BY (tier='green') DESC, auto DESC, trust DESC"),
  ]);
  const { known, pageHash, memo, ...liveInfo } = state.live;
  return {
    live: LIVE, liveInfo: { ...liveInfo, knownCount: known.size, intervalSec: LIVE_INTERVAL_SEC, nextCycleIn: LIVE && lastRun.unegui ? Math.max(0, Math.round((lastRun.unegui + LIVE_INTERVAL_SEC * 1000 - Date.now()) / 1000)) : null, adapter: LIVE ? unegui.stats() : null, adapters: LIVE ? { omch: omch.stats(), myzar: myzar.stats() } : null },
    running: state.running, note: state.note || '', monitoring: MONITORING_MODE, ua: USER_AGENT, retentionDays: RETENTION_DAYS,
    takedownCount: td.c, workers: state.workers.map((w) => ({ id: w.id, status: w.status, source: w.source })),
    queued: q.c, stats: { ...state.stats, ratePerMin: Math.round(state.stats.collected / mins) },
    rejectReasons: state.rejectReasons, sources, events: state.events.slice(0, 40), cap: COLLECT_CAP, threshold: FIT_THRESHOLD,
  };
}

module.exports = { start, stop, reset, status, takedownLatest };
