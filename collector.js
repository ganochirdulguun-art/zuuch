// «Зууч» — цуглуулах хөдөлгүүр (Шат 2 демо, async/PostgreSQL)
// Симуляц эх сурвалжтай: жинхэнэ сайт руу хандахгүй; orchestrator + 10 worker + 7 үе гинжин хэлхээ +
// 10 итгэлцүүрийн шүүлт + ажиглах горимын хамгаалалтууд БОДИТООР ажиллана.
const crypto = require('node:crypto');
const { db } = require('./db');

const WORKER_COUNT = 10;
const FIT_THRESHOLD = 55;
const COLLECT_CAP = 400;
const MONITORING_MODE = true;
const SALT = process.env.ZUUCH_SALT || 'zuuch-monitor-salt-2026';
const USER_AGENT = 'ZuuchBot/1.0 (+holboo@zuuch.mn; зөвхөн ажиглах, дотоод шинжилгээ)';
const RETENTION_DAYS = 90;
const P_304 = 0.30;
const DISTRICTS = ['Сүхбаатар', 'Хан-Уул', 'Баянгол', 'Баянзүрх', 'Чингэлтэй', 'Сонгинохайрхан'];
const KHOROOLOL = { 'Сүхбаатар': ['Төв талбай', '100 айл', 'Их сургууль'], 'Хан-Уул': ['Жардин', 'Гоёо', 'Яармаг'], 'Баянгол': ['3-р хороолол', '4-р хороолол', '10-р хороолол'], 'Баянзүрх': ['13-р хороолол', 'Офицер', 'Гандан'], 'Чингэлтэй': ['5-р хороолол', 'Сансар', 'Тахилт'], 'Сонгинохайрхан': ['Москва', '5 шар', 'Толгойт'] };
const ROOMS_K = { 1: 1.06, 2: 1.0, 3: 0.95, 4: 0.92 };
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hashPhone = (p) => (p ? crypto.createHash('sha256').update(SALT + '|' + p).digest('hex').slice(0, 20) : null);
const tdKey = (l) => (l.contactHash || hashPhone(l.phone)) + '|' + l.district;

const state = {
  running: false,
  workers: Array.from({ length: WORKER_COUNT }, (_, i) => ({ id: i + 1, status: 'сул', source: '', since: Date.now() })),
  stats: { fetched: 0, skipped304: 0, parsed: 0, collected: 0, rejected: 0, retired: 0, takedowns: 0, startedAt: null },
  rejectReasons: {}, activePerSource: {}, events: [], note: '',
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
  return {
    source: raw.source, source_id: raw.source_id, title: raw.title, category: raw.category, is_new: raw.is_new ? 1 : 0,
    district: DISTRICTS.includes(raw.districtText) ? raw.districtText : null, khoroolol: raw.khoroolol || '',
    rooms: num(raw.roomsText), area: num(raw.areaText), price: num(raw.priceText),
    prev_price: raw.prev_price, images: raw.images | 0,
    phone: /^\+976\d{8}$/.test(phone) ? phone : (phone || null), phoneValid: /^\+976\d{8}$/.test(phone),
    postedDaysAgo: raw.postedDaysAgo, descr: raw.descr, _dupOf: raw._dupOf,
    listed_at: new Date(Date.now() - (raw.postedDaysAgo || 0) * 864e5).toISOString().slice(0, 10),
  };
}

async function dedup(l) {
  if (await db.one('SELECT id FROM market_listings WHERE source=? AND source_id=?', l.source, l.source_id)) return 'update';
  if (l._dupOf) {
    const g = await db.one('SELECT dedup_group FROM market_listings WHERE district=? AND rooms=? AND active=1 AND dedup_group IS NOT NULL LIMIT 1', l.district, l.rooms);
    if (g) { l._group = g.dedup_group; return 'cross_dup'; }
  }
  if (l.phone) {
    const near = await db.one('SELECT dedup_group FROM market_listings WHERE contact_hash=? AND district=? AND ABS(area-?)<=2 AND active=1 LIMIT 1', hashPhone(l.phone), l.district, l.area || 0);
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
  if (l.category !== 'apartment') return { collect: false, reason: 'ангилал таарахгүй', score: 0 };
  if (!l.district) return { collect: false, reason: 'байршил тодорхойгүй', score: 0 };
  l.contactHash = hashPhone(l.phone);
  if (await db.one('SELECT 1 FROM takedown WHERE key=?', tdKey(l))) return { collect: false, reason: 'хасалтын жагсаалтад', score: 0 };
  const dd = await dedup(l);
  if (dd === 'cross_dup') return { collect: false, reason: 'давхардсан (өөр суваг)', score: 0, dd };

  const flags = [];
  const ratio = l.m2 && l.indexM2 ? l.m2 / l.indexM2 : 1;
  if (ratio < 0.35) flags.push('хэт хямд');
  if (/урьдчилгаа/i.test(l.descr || '')) return { collect: false, reason: 'скам сэжигтэй (урьдчилгаа)', score: 0, flags: ['урьдчилгаа_шаардсан'] };
  if (l.phone) {
    const { c } = await db.one('SELECT COUNT(*)::int c FROM market_listings WHERE contact_hash=? AND active=1', l.contactHash);
    if (c >= 4) flags.push('олон байр 1 утас');
  }
  const complete = 0.3 * (l.price ? 1 : 0) + 0.2 * (l.area ? 1 : 0) + 0.2 * (l.rooms ? 1 : 0) + 0.15 * (l.district ? 1 : 0) + 0.15 * (l.phone ? 1 : 0);
  const priceHealthy = ratio >= 0.4 && ratio <= 2.5 ? 1 : Math.max(0, 1 - Math.abs(ratio - 1.4) / 2);
  const imageScore = l.images >= 3 ? 1 : l.images >= 1 ? 0.6 : 0;
  const fresh = l.postedDaysAgo <= 7 ? 1 : Math.max(0, 1 - (l.postedDaysAgo - 7) / 83);
  let s = 20 * complete + 15 * priceHealthy + 10 * source.trust + 10 * (l.phoneValid ? 1 : 0) + 8 * imageScore + 7 * fresh + 15 * (dd === 'new' ? 1 : 0.4);
  s -= 12 * flags.length;
  s = Math.max(0, Math.round(s));
  return { collect: s >= FIT_THRESHOLD, score: s, flags, dd, reason: s >= FIT_THRESHOLD ? null : 'оноо босго хүрээгүй' };
}

async function process1(raw, source) {
  state.stats.parsed++;
  const l = await enrich(normalize(raw));
  const r = await fitScore(l, source);
  if (r.collect) {
    const group = l._group || 'g' + crypto.randomBytes(4).toString('hex');
    await db.run(`INSERT INTO market_listings (source,source_id,deal_type,district,rooms,area,price,prev_price,is_new,listed_at,active,fit_score,dedup_group,collected_at,contact_hash,title,images)
      VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?)`, l.source, l.source_id, 'sale', l.district, l.rooms || 0, l.area || 0, l.price || 0,
      l.prev_price, l.is_new, l.listed_at, r.score, group, new Date().toISOString(), l.contactHash, l.title, l.images);
    state.stats.collected++;
    await db.run('UPDATE sources SET collected=collected+1 WHERE name=?', source.name);
    logEvent({ kind: 'collected', source: source.name, title: l.title, district: l.district, price: l.price, score: r.score, flags: r.flags || [] });
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
    if (q.c > 30) return;
    const sources = await db.all("SELECT * FROM sources WHERE auto=1 AND status='active' AND tier <> 'red'");
    for (const s of sources) {
      const due = !lastRun[s.name] || Date.now() - lastRun[s.name] >= s.interval_sec * 1000;
      if (!due) continue;
      lastRun[s.name] = Date.now();
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

// Атомик нэхэмжлэл — зохиомжийн дагуу FOR UPDATE SKIP LOCKED (нэг ажил = нэг бот)
async function claimJob(wid) {
  const r = await db.run(`UPDATE fetch_jobs SET status='running', claimed_by=? WHERE id = (
    SELECT id FROM fetch_jobs WHERE status='queued' ORDER BY priority DESC, id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`, 'w' + wid);
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
function boot() { if (started) return; started = true; for (const w of state.workers) worker(w); setInterval(orchestrate, 2000); }
function start() { boot(); state.running = true; state.note = ''; if (!state.stats.startedAt) state.stats.startedAt = Date.now(); }
function stop() { state.running = false; }
async function reset() {
  state.running = false;
  await db.exec('DELETE FROM market_listings WHERE collected_at IS NOT NULL');
  await db.exec('DELETE FROM fetch_jobs');
  await db.exec('DELETE FROM takedown');
  await db.exec('UPDATE sources SET collected=0, rejected=0');
  state.stats = { fetched: 0, skipped304: 0, parsed: 0, collected: 0, rejected: 0, retired: 0, takedowns: 0, startedAt: null };
  state.rejectReasons = {}; state.events = []; state.note = '';
  for (const k in lastRun) delete lastRun[k];
}
async function status() {
  const mins = state.stats.startedAt ? Math.max((Date.now() - state.stats.startedAt) / 60000, 0.05) : 1;
  const [td, q, sources] = await Promise.all([
    db.one('SELECT COUNT(*)::int c FROM takedown'),
    db.one("SELECT COUNT(*)::int c FROM fetch_jobs WHERE status='queued'"),
    db.all("SELECT name,label,kind,auto,tier,trust,max_concurrency,collected,rejected,note,status FROM sources ORDER BY (tier='green') DESC, auto DESC, trust DESC"),
  ]);
  return {
    running: state.running, note: state.note || '', monitoring: MONITORING_MODE, ua: USER_AGENT, retentionDays: RETENTION_DAYS,
    takedownCount: td.c, workers: state.workers.map((w) => ({ id: w.id, status: w.status, source: w.source })),
    queued: q.c, stats: { ...state.stats, ratePerMin: Math.round(state.stats.collected / mins) },
    rejectReasons: state.rejectReasons, sources, events: state.events.slice(0, 40), cap: COLLECT_CAP, threshold: FIT_THRESHOLD,
  };
}

module.exports = { start, stop, reset, status, takedownLatest };
