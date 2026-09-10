// «Зууч» — цуглуулах хөдөлгүүр (Шат 2 демо)
// Симуляц эх сурвалжтай: жинхэнэ сайт руу хандахгүй, харин зохиомжийн (артифакт №4)
// orchestrator + 10 worker + 7 үе гинжин хэлхээ + 10 итгэлцүүрийн шүүлтийг БОДИТООР ажиллуулна.
const crypto = require('node:crypto');
const { db } = require('./db');

const WORKER_COUNT = 10;
const FIT_THRESHOLD = 55;            // итгэлцүүрийн босго (артифакт §06)
const COLLECT_CAP = 400;             // демо: сангийн хэт өсөлтөөс сэргийлэх
// ---- Ажиглах горимын хамгаалалтууд (артифакт №5) ----
const MONITORING_MODE = true;        // зөвхөн баримт; жинхэнэ утас дискэнд буухгүй
const SALT = process.env.ZUUCH_SALT || 'zuuch-monitor-salt-2026'; // хэшийн давс (жинхэнэд env)
const USER_AGENT = 'ZuuchBot/1.0 (+holboo@zuuch.mn; зөвхөн ажиглах, дотоод шинжилгээ)'; // честный бот
const RETENTION_DAYS = 90;           // хадгалалтын хугацаа — хуучин зарыг агрегатлаж устгана
const P_304 = 0.30;                  // нөхцөлт татах: ~30% нь «өөрчлөлтгүй» (304)
const DISTRICTS = ['Сүхбаатар', 'Хан-Уул', 'Баянгол', 'Баянзүрх', 'Чингэлтэй', 'Сонгинохайрхан'];
const KHOROOLOL = { 'Сүхбаатар': ['Төв талбай', '100 айл', 'Их сургууль'], 'Хан-Уул': ['Жардин', 'Гоёо', 'Яармаг'], 'Баянгол': ['3-р хороолол', '4-р хороолол', '10-р хороолол'], 'Баянзүрх': ['13-р хороолол', 'Офицер', 'Гандан'], 'Чингэлтэй': ['5-р хороолол', 'Сансар', 'Тахилт'], 'Сонгинохайрхан': ['Москва', '5 шар', 'Толгойт'] };
const ROOMS_K = { 1: 1.06, 2: 1.0, 3: 0.95, 4: 0.92 };
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Давсласан, эргэлт буцаах боломжгүй хэш — жинхэнэ дугаар хэзээ ч хадгалагдахгүй (§05)
const hashPhone = (p) => (p ? crypto.createHash('sha256').update(SALT + '|' + p).digest('hex').slice(0, 20) : null);
const tdKey = (l) => (l.contactHash || hashPhone(l.phone)) + '|' + l.district;

// ---------- Төлөв (санах ойд) ----------
const state = {
  running: false,
  workers: Array.from({ length: WORKER_COUNT }, (_, i) => ({ id: i + 1, status: 'сул', source: '', since: Date.now() })),
  stats: { fetched: 0, skipped304: 0, parsed: 0, collected: 0, rejected: 0, retired: 0, takedowns: 0, startedAt: null },
  rejectReasons: {},
  activePerSource: {},
  events: [],   // сүүлийн ~120 үйл явдал
};
function logEvent(e) { state.events.unshift({ ...e, t: Date.now() }); if (state.events.length > 120) state.events.pop(); }
function bump(map, k) { map[k] = (map[k] || 0) + 1; }

// ---------- Adapter: эх сурвалж бүр «түүхий зар» үүсгэнэ (симуляц) ----------
// Бодит хувилбарт энэ нь HTTP татаж, HTML задлана. Демо-д чанарын тархалттайгаар үүсгэнэ.
let sidSeq = 5000;
function generateRaw(source) {
  const roll = Math.random();
  const district = pick(DISTRICTS);
  const rooms = pick([1, 2, 2, 3, 3, 4]);
  const area = Math.round(rooms * rnd(24, 34));
  const idx = db.prepare('SELECT median_m2 FROM price_index WHERE district=? AND is_new=0 ORDER BY month DESC LIMIT 1').get(district);
  const isNew = Math.random() < 0.4 ? 1 : 0;
  const baseM2 = (idx ? idx.median_m2 : 4) * (ROOMS_K[rooms] || 1) * (isNew ? 1.12 : 1);
  const daysAgo = Math.floor(rnd(0, 95));
  const phone = '+976' + Math.floor(rnd(80000000, 99999999));
  const raw = {
    source: source.name, source_id: 'L' + (sidSeq++),
    title: `${district} ${rooms} өрөө байр`, category: 'apartment',
    districtText: district, khoroolol: pick(KHOROOLOL[district] || ['']),
    roomsText: String(rooms), areaText: area + ' м2', is_new: isNew,
    priceText: (Math.round(baseM2 * area * 10) / 10) + ' сая',
    phone, images: Math.floor(rnd(0, 9)), postedDaysAgo: daysAgo, descr: 'Тавилгатай, наран талдаа',
    prev_price: Math.random() < 0.18 ? Math.round(baseM2 * area * rnd(1.06, 1.12) * 10) / 10 : null,
  };
  // — Чанарын мутаци (шүүлт бодитоор ажиллахын тулд) —
  if (roll < 0.08) { raw.category = 'car'; raw.title = 'Toyota Prius 2015'; }        // ангилал (hard)
  else if (roll < 0.16) { raw.districtText = ''; }                                    // байршил (hard)
  else if (roll < 0.24) { raw._dupOf = true; }                                        // дупликат (hard)
  else if (roll < 0.30) { raw.priceText = (Math.round(baseM2 * area * 0.25 * 10) / 10) + ' сая'; } // скам: хэт хямд
  else if (roll < 0.34) { raw.descr += '. Урьдчилгаа 500мянга шилжүүлбэл түлхүүр өгнө'; } // скам: урьдчилгаа
  else if (roll < 0.46) { if (Math.random() < 0.5) raw.phone = ''; else raw.areaText = ''; } // дутуу (soft)
  return raw;
}

// ---------- Гинжин хэлхээ ----------
// Үе 2: Нормчлол
function normalize(raw) {
  const num = (s) => { const m = String(s || '').replace(/,/g, '').match(/[\d.]+/); return m ? parseFloat(m[0]) : null; };
  const phone = String(raw.phone || '').replace(/[^\d+]/g, '');
  return {
    source: raw.source, source_id: raw.source_id, title: raw.title,
    category: raw.category, is_new: raw.is_new ? 1 : 0,
    district: DISTRICTS.includes(raw.districtText) ? raw.districtText : null,
    khoroolol: raw.khoroolol || '',
    rooms: num(raw.roomsText), area: num(raw.areaText), price: num(raw.priceText),
    prev_price: raw.prev_price, images: raw.images | 0,
    phone: /^\+976\d{8}$/.test(phone) ? phone : (phone || null),
    phoneValid: /^\+976\d{8}$/.test(phone),
    postedDaysAgo: raw.postedDaysAgo, descr: raw.descr, _dupOf: raw._dupOf,
    listed_at: new Date(Date.now() - (raw.postedDaysAgo || 0) * 864e5).toISOString().slice(0, 10),
  };
}

// Үе 3: Дедуп (кросс-суваг)
function dedup(l) {
  if (db.prepare('SELECT id FROM market_listings WHERE source=? AND source_id=?').get(l.source, l.source_id)) return 'update';
  if (l._dupOf) {
    // симуляц: аль хэдийн байгаа ижил төстэйг зориуд олно
    const g = db.prepare('SELECT dedup_group FROM market_listings WHERE district=? AND rooms=? AND active=1 AND dedup_group IS NOT NULL LIMIT 1').get(l.district, l.rooms);
    if (g) { l._group = g.dedup_group; return 'cross_dup'; }
  }
  if (l.phone) {
    const ch = hashPhone(l.phone);
    const near = db.prepare('SELECT dedup_group FROM market_listings WHERE contact_hash=? AND district=? AND ABS(area-?)<=2 AND active=1 LIMIT 1').get(ch, l.district, l.area || 0);
    if (near) { l._group = near.dedup_group; return 'cross_dup'; }
  }
  return 'new';
}

// Үе 4: Баяжуулах
function enrich(l) {
  const idx = db.prepare('SELECT median_m2 FROM price_index WHERE district=? AND is_new=? ORDER BY month DESC LIMIT 1').get(l.district, l.is_new);
  l.m2 = l.price && l.area ? l.price / l.area : null;
  l.indexM2 = idx ? idx.median_m2 * (ROOMS_K[l.rooms] || 1) : null;
  return l;
}

// Үе 5: Итгэлцүүрийн оноо (артифакт §06)
function fitScore(l, source) {
  // — Hard-fail —
  if (l.category !== 'apartment') return { collect: false, reason: 'ангилал таарахгүй', score: 0 };
  if (!l.district) return { collect: false, reason: 'байршил тодорхойгүй', score: 0 };
  // Хасалтын жагсаалт (takedown §07) — дахин цуглуулахыг блоклоно
  l.contactHash = hashPhone(l.phone);
  if (l.district && db.prepare('SELECT 1 FROM takedown WHERE key=?').get(tdKey(l))) {
    return { collect: false, reason: 'хасалтын жагсаалтад', score: 0 };
  }
  const dd = dedup(l);
  if (dd === 'cross_dup') return { collect: false, reason: 'давхардсан (өөр суваг)', score: 0, dd };

  // — Скам дохио —
  const flags = [];
  const ratio = l.m2 && l.indexM2 ? l.m2 / l.indexM2 : 1;
  if (ratio < 0.35) flags.push('хэт хямд');
  if (/урьдчилгаа/i.test(l.descr || '')) return { collect: false, reason: 'скам сэжигтэй (урьдчилгаа)', score: 0, flags: ['урьдчилгаа_шаардсан'] };
  if (l.phone) {
    const cnt = db.prepare('SELECT COUNT(*) c FROM market_listings WHERE contact_hash=? AND active=1').get(hashPhone(l.phone)).c;
    if (cnt >= 4) flags.push('олон байр 1 утас');
  }

  // — Soft оноо (макс ~85) —
  const complete = 0.3 * (l.price ? 1 : 0) + 0.2 * (l.area ? 1 : 0) + 0.2 * (l.rooms ? 1 : 0) + 0.15 * (l.district ? 1 : 0) + 0.15 * (l.phone ? 1 : 0);
  const priceHealthy = ratio >= 0.4 && ratio <= 2.5 ? 1 : Math.max(0, 1 - Math.abs(ratio - 1.4) / 2);
  const imageScore = l.images >= 3 ? 1 : l.images >= 1 ? 0.6 : 0;
  const fresh = l.postedDaysAgo <= 7 ? 1 : Math.max(0, 1 - (l.postedDaysAgo - 7) / 83);
  let s = 20 * complete + 15 * priceHealthy + 10 * source.trust + 10 * (l.phoneValid ? 1 : 0)
    + 8 * imageScore + 7 * fresh + 15 * (dd === 'new' ? 1 : 0.4);
  s -= 12 * flags.length;
  s = Math.max(0, Math.round(s));
  return { collect: s >= FIT_THRESHOLD, score: s, flags, dd, reason: s >= FIT_THRESHOLD ? null : 'оноо босго хүрээгүй' };
}

// Үе 6–7: Шүүх + хадгалах
const insCollected = db.prepare(`INSERT INTO market_listings
  (source,source_id,deal_type,district,rooms,area,price,prev_price,is_new,listed_at,active,fit_score,dedup_group,collected_at,contact_hash,title,images)
  VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?)`);

function process1(raw, source) {
  state.stats.parsed++;
  const l = enrich(normalize(raw));
  const r = fitScore(l, source);
  if (r.collect) {
    const group = l._group || 'g' + crypto.randomBytes(4).toString('hex');
    insCollected.run(l.source, l.source_id, 'sale', l.district, l.rooms || 0, l.area || 0, l.price || 0,
      l.prev_price, l.is_new, l.listed_at, r.score, group, new Date().toISOString(), hashPhone(l.phone), l.title, l.images);
    state.stats.collected++;
    db.prepare('UPDATE sources SET collected=collected+1 WHERE name=?').run(source.name);
    logEvent({ kind: 'collected', source: source.name, title: l.title, district: l.district, price: l.price, score: r.score, flags: r.flags || [] });
  } else {
    state.stats.rejected++;
    bump(state.rejectReasons, r.reason);
    db.prepare('UPDATE sources SET rejected=rejected+1 WHERE name=?').run(source.name);
    logEvent({ kind: 'rejected', source: source.name, title: l.title, reason: r.reason, score: r.score });
  }
}

// ---------- Orchestrator: хуваарь гаргаж queue-д ажил нэмнэ ----------
const lastRun = {};
function orchestrate() {
  if (!state.running) return;
  if (db.prepare("SELECT COUNT(*) c FROM market_listings WHERE collected_at IS NOT NULL").get().c >= COLLECT_CAP) {
    if (state.running) { state.note = 'Демо хязгаар (' + COLLECT_CAP + ' цуглуулсан) — Reset дарж дахин эхлүүлнэ үү'; }
    return;
  }
  retentionTick();
  const queued = db.prepare("SELECT COUNT(*) c FROM fetch_jobs WHERE status='queued'").get().c;
  if (queued > 30) return; // дараалал дүүрэн бол хүлээнэ
  // Зөвхөн ногоон/шар эх сурвалж — улаан (FB, robots хориотой) автоматаар хөндөгдөхгүй
  const sources = db.prepare("SELECT * FROM sources WHERE auto=1 AND status='active' AND tier != 'red'").all();
  for (const s of sources) {
    const due = !lastRun[s.name] || Date.now() - lastRun[s.name] >= s.interval_sec * 1000;
    if (!due) continue;
    lastRun[s.name] = Date.now();
    const priority = Math.round(s.trust * 10);
    db.prepare("INSERT INTO fetch_jobs (source_name,kind,priority) VALUES (?, 'delta', ?)").run(s.name, priority);
  }
}

// ---------- Хадгалалтын хугацаа (retention §07): хуучин зарыг идэвхгүй болгоно ----------
let lastRetention = 0;
function retentionTick() {
  if (Date.now() - lastRetention < 15000) return; // 15 сек тутам
  lastRetention = Date.now();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 864e5).toISOString().slice(0, 10);
  const r = db.prepare("UPDATE market_listings SET active=0 WHERE active=1 AND collected_at IS NOT NULL AND listed_at < ?").run(cutoff);
  if (r.changes) { state.stats.retired += r.changes; logEvent({ kind: 'retired', count: r.changes, reason: `${RETENTION_DAYS}+ хоног — хадгалалтын хугацаа` }); }
}

// ---------- Хасалт (takedown §07): эх/эзний хүсэлтээр бүлгийг устгаж, дахин цуглуулахыг блоклоно ----------
function takedownLatest() {
  const row = db.prepare("SELECT dedup_group, contact_hash, district, title FROM market_listings WHERE collected_at IS NOT NULL AND active=1 ORDER BY id DESC LIMIT 1").get();
  if (!row) return { ok: false, msg: 'Устгах зар алга' };
  const r = db.prepare("UPDATE market_listings SET active=0 WHERE dedup_group=?").run(row.dedup_group);
  if (row.contact_hash && row.district) {
    db.prepare("INSERT OR IGNORE INTO takedown (key,reason) VALUES (?, 'эх/эзний хүсэлт')").run(row.contact_hash + '|' + row.district);
  }
  state.stats.takedowns++;
  logEvent({ kind: 'takedown', title: row.title, reason: `бүлэг устгагдаж дахин цуглуулахыг блоклов (${r.changes} зар)` });
  return { ok: true };
}

// ---------- Worker: queue-аас ажил татаж гүйцэтгэнэ ----------
// node:sqlite синхрон тул SELECT+UPDATE хооронд await байхгүй → атомик нэхэмжлэл (нэг ажил = нэг бот)
function claimJob() {
  const job = db.prepare("SELECT * FROM fetch_jobs WHERE status='queued' ORDER BY priority DESC, id LIMIT 1").get();
  if (!job) return null;
  db.prepare("UPDATE fetch_jobs SET status='running', claimed_by=? WHERE id=?").run('w', job.id);
  return job;
}

async function worker(w) {
  while (true) {
    if (!state.running) { w.status = 'сул'; w.source = ''; await sleep(400); continue; }
    const job = claimJob();
    if (!job) { w.status = 'сул'; w.source = ''; await sleep(rnd(300, 800)); continue; }

    const source = db.prepare('SELECT * FROM sources WHERE name=?').get(job.source_name);
    // Эх сурвалжийн зэрэгцээ хязгаар (эелдэг байдал)
    const active = state.activePerSource[source.name] || 0;
    if (active >= source.max_concurrency) {
      db.prepare("UPDATE fetch_jobs SET status='queued', claimed_by=NULL WHERE id=?").run(job.id);
      await sleep(rnd(200, 500)); continue;
    }
    state.activePerSource[source.name] = active + 1;
    w.status = 'татаж байна'; w.source = source.label; w.since = Date.now();

    try {
      await sleep(rnd(300, 750));            // «фетч» саатал (симуляц)
      state.stats.fetched++;
      // Нөхцөлт татах (If-Modified-Since/ETag § L6): өөрчлөгдөөгүй бол 304 — юу ч татахгүй
      if (Math.random() < P_304) {
        state.stats.skipped304++;
        w.status = '304 өөрчлөлтгүй';
        db.prepare("UPDATE fetch_jobs SET status='done' WHERE id=?").run(job.id);
        await sleep(120);
        continue;   // finally нь activePerSource-г буулгана
      }
      const batch = Math.floor(rnd(2, 6));   // нэг хуудаснаас хэдэн зар
      w.status = 'боловсруулж';
      for (let i = 0; i < batch; i++) {
        process1(generateRaw(source), source);
        await sleep(rnd(60, 160));           // эелдэг хэмнэл
      }
      db.prepare("UPDATE fetch_jobs SET status='done' WHERE id=?").run(job.id);
    } catch (e) {
      db.prepare("UPDATE fetch_jobs SET status='queued', claimed_by=NULL WHERE id=?").run(job.id);
    } finally {
      state.activePerSource[source.name]--;
    }
  }
}

// ---------- Удирдлага ----------
let started = false;
function boot() {
  if (started) return; started = true;
  for (const w of state.workers) worker(w);
  setInterval(orchestrate, 2000);
}
function start() { boot(); state.running = true; state.note = ''; if (!state.stats.startedAt) state.stats.startedAt = Date.now(); }
function stop() { state.running = false; }
function reset() {
  state.running = false;
  db.exec("DELETE FROM market_listings WHERE collected_at IS NOT NULL");
  db.exec("DELETE FROM fetch_jobs");
  db.exec("DELETE FROM takedown");
  db.exec("UPDATE sources SET collected=0, rejected=0");
  state.stats = { fetched: 0, skipped304: 0, parsed: 0, collected: 0, rejected: 0, retired: 0, takedowns: 0, startedAt: null };
  state.rejectReasons = {}; state.events = []; state.note = '';
  for (const k in lastRun) delete lastRun[k];
}
function status() {
  const mins = state.stats.startedAt ? Math.max((Date.now() - state.stats.startedAt) / 60000, 0.05) : 1;
  return {
    running: state.running, note: state.note || '',
    monitoring: MONITORING_MODE, ua: USER_AGENT, retentionDays: RETENTION_DAYS,
    takedownCount: db.prepare('SELECT COUNT(*) c FROM takedown').get().c,
    workers: state.workers.map((w) => ({ id: w.id, status: w.status, source: w.source })),
    queued: db.prepare("SELECT COUNT(*) c FROM fetch_jobs WHERE status='queued'").get().c,
    stats: { ...state.stats, ratePerMin: Math.round(state.stats.collected / mins) },
    rejectReasons: state.rejectReasons,
    sources: db.prepare('SELECT name,label,kind,auto,tier,trust,max_concurrency,collected,rejected,note,status FROM sources ORDER BY (tier=\'green\') DESC, auto DESC, trust DESC').all(),
    events: state.events.slice(0, 40),
    cap: COLLECT_CAP, threshold: FIT_THRESHOLD,
  };
}

module.exports = { start, stop, reset, status, takedownLatest };
