// «Зууч» — алгоритмууд (async/PostgreSQL): А3 үнэлгээ, А4 тохирол, А5 боломж, А8 байршил
const { db } = require('./db');

const ROOMS_K = { 1: 1.06, 2: 1.0, 3: 0.95, 4: 0.92, 5: 0.9 };

// ---- А3: Объектын үнэлгээ (CMA — индекс + зах зээлийн зарын түүвэр) ----
async function valuation({ district, rooms, area, isNew, floor, totalFloors }) {
  rooms = Math.min(Number(rooms) || 2, 5);
  area = Number(area) || 50;
  const idx = await db.one('SELECT * FROM price_index WHERE district=? AND is_new=? ORDER BY month DESC LIMIT 1', district, isNew ? 1 : 0);
  if (!idx) return null;

  const comps = await db.all(`SELECT price, area FROM market_listings
    WHERE active=1 AND deal_type='sale' AND COALESCE(category,'apartment')='apartment' AND district=? AND rooms=? AND area BETWEEN ? AND ?`, district, rooms, area * 0.8, area * 1.2);

  let baseM2 = idx.median_m2 * (ROOMS_K[rooms] || 1);
  let source = 'индекс';
  let cleanN = 0;
  if (comps.length >= 5) {
    const m2s = comps.map(c => c.price / c.area).sort((a, b) => a - b);
    const q1 = m2s[Math.floor(m2s.length * 0.25)], q3 = m2s[Math.floor(m2s.length * 0.75)];
    const iqr = q3 - q1;
    const clean = m2s.filter(v => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr);
    const median = clean[Math.floor(clean.length / 2)];
    baseM2 = (median + baseM2) / 2;
    cleanN = clean.length;
    source = `индекс + ${clean.length} зарын түүвэр`;
  }

  let k = 1.0;
  const notes = [];
  if (floor && totalFloors && (Number(floor) === 1 || Number(floor) === Number(totalFloors))) { k *= 0.97; notes.push('1/дээд давхар −3%'); }
  const est = baseM2 * k * area;
  const conf = Math.min(95, 40 + comps.length * 5 + (idx.sample > 50 ? 15 : 5));
  return {
    estimate: Math.round(est * 10) / 10,
    low: Math.round(idx.p25_m2 * (ROOMS_K[rooms] || 1) * k * area * 10) / 10,
    high: Math.round(idx.p75_m2 * (ROOMS_K[rooms] || 1) * k * area * 10) / 10,
    m2: Math.round(baseM2 * k * 100) / 100,
    confidence: conf, sample: comps.length, source, notes,
  };
}

// ---- А4: Хүсэлт ↔ объект тохирол (жинтэй оноо) ----
function matchScore(req, prop) {
  if (req.deal_type !== prop.deal_type) return 0;
  let score = 0;
  const lo = req.budget * 0.9, hi = req.budget * 1.05;
  if (prop.price >= lo && prop.price <= hi) score += 35;
  else {
    const over = prop.price > hi ? (prop.price - hi) / req.budget : (lo - prop.price) / req.budget;
    score += Math.max(0, 35 * (1 - over * 4));
  }
  const districts = String(req.districts || '').split(',').map(s => s.trim()).filter(Boolean);
  if (districts.includes(prop.district)) score += 25;
  const dr = Math.abs(Number(req.rooms) - Number(prop.rooms));
  score += dr === 0 ? 20 : dr === 1 ? 10 : 0;
  if (req.area_min || req.area_max) {
    const min = req.area_min || 0, max = req.area_max || 1e9;
    if (prop.area >= min && prop.area <= max) score += 10;
    else if (prop.area >= min * 0.85 && prop.area <= max * 1.15) score += 5;
  } else score += 5;
  const ageDays = (Date.now() - new Date(prop.created_at || prop.listed_at).getTime()) / 864e5;
  if (ageDays <= 7) score += 10;
  else if (ageDays <= 30) score += 5;
  return Math.round(score);
}

async function matchesForRequest(reqId, companyId) {
  const req = companyId
    ? await db.one('SELECT * FROM requests WHERE id=? AND company_id=?', reqId, companyId)
    : await db.one('SELECT * FROM requests WHERE id=?', reqId);
  if (!req) return { request: null, internal: [], market: [] };
  const props = companyId
    ? await db.all("SELECT * FROM properties WHERE status='active' AND company_id=?", companyId)
    : await db.all("SELECT * FROM properties WHERE status='active'");
  const internal = props.map(p => ({ ...p, score: matchScore(req, p) })).filter(p => p.score >= 50).sort((a, b) => b.score - a.score).slice(0, 10);
  const mls = await db.all("SELECT * FROM market_listings WHERE active=1 AND COALESCE(category,'apartment')='apartment'");
  const market = mls.map(m => ({ ...m, created_at: m.listed_at, score: matchScore(req, m) })).filter(m => m.score >= 60).sort((a, b) => b.score - a.score).slice(0, 10);
  return { request: req, internal, market };
}

// ---- А5: Боломж илрүүлэгч ----
async function opportunities() {
  // Бодит зарын талбай тодорхойгүй (0) байж болно — м² үнэ тооцохгүй
  const rows = await db.all("SELECT * FROM market_listings WHERE active=1 AND deal_type='sale' AND COALESCE(category,'apartment')='apartment' AND area > 0 AND price > 0");
  const idxRows = await db.all('SELECT DISTINCT ON (district, is_new) * FROM price_index ORDER BY district, is_new, month DESC');
  const idxMap = new Map(idxRows.map(i => [i.district + '|' + i.is_new, i]));
  const out = [];
  for (const r of rows) {
    const idx = idxMap.get(r.district + '|' + r.is_new);
    if (!idx) continue;
    const m2 = r.price / r.area;
    const baseline = idx.median_m2 * (ROOMS_K[r.rooms] || 1);
    const tags = [];
    if (m2 <= baseline * 0.9) tags.push({ t: 'under', label: `Индексээс ${Math.round((1 - m2 / baseline) * 100)}% доогуур` });
    if (r.prev_price && r.prev_price > r.price * 1.05) tags.push({ t: 'drop', label: `Үнэ ${Math.round((1 - r.price / r.prev_price) * 100)}% буусан` });
    const days = Math.floor((Date.now() - new Date(r.listed_at).getTime()) / 864e5);
    if (days >= 60) tags.push({ t: 'stale', label: `${days} хоног зарагдаагүй` });
    if (tags.length) out.push({ ...r, m2: Math.round(m2 * 100) / 100, baseline: Math.round(baseline * 100) / 100, days, tags });
  }
  return out.sort((a, b) => b.tags.length - a.tags.length || a.m2 / a.baseline - b.m2 / b.baseline).slice(0, 20);
}

// ---- А8: Байршлын оноо ----
// Байршил (lat/lng) заасан бол ЦЭГИЙН түвшинд: хотын өгөгдлийн сангийн явган зай (ангилал бүрийн хамгийн ойр байгууллага) + замын профайлын кэш (байвал — шинээр API дуудахгүй).
// Үгүй бол дүүргийн жишиг оноо. growth/орчин (environment) нь дүүргийнхээр.
const sc = (m, full, zero) => (m == null ? null : Math.round(100 * Math.max(0, Math.min(1, (zero - m) / (zero - full)))));
const avg = (...v) => { const a = v.filter((x) => x != null); return a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : null; };
async function locationScore(district, lat, lng, extra = []) { // extra = агент/оршин суугчийн нэмсэн ойрын газар (tours.local_pois)
  const base = (await db.one('SELECT * FROM location_scores WHERE district=?', district)) || null;
  lat = Number(lat); lng = Number(lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return base;
  let a = null; try { const gs = require('./geostore'); a = gs.covers(lat, lng) ? gs.access(lat, lng) : null; } catch { a = null; }
  if (!a) return base;
  const C = { ...a.cats }, m = (k) => (C[k] ? C[k].m : null);
  const kx = Math.cos((lat * Math.PI) / 180) * 111320;
  for (const q of extra || []) { // нээлттэй газрын зурагт байхгүй ойрын газар — шулуун зай × 1.15 (хашаагаар алхах)
    if (!q || !q.cat || !Number.isFinite(Number(q.lat))) continue; const dm = Math.round(Math.hypot((Number(q.lng) - lng) * kx, (Number(q.lat) - lat) * 110540) * 1.15);
    if (!C[q.cat] || dm < C[q.cat].m) C[q.cat] = { m: dm, min: Math.max(1, Math.round(dm / 75)), name: q.name || '', lat: q.lat, lng: q.lng, verified: true, agent: true };
  }
  let commute = null;
  try { const cm = require('./commute'); let c = await db.one("SELECT profile, score FROM commute_cells WHERE cell=? AND computed_at > NOW() - INTERVAL '30 days'", cm.cellOf(lat, lng)); if (c) commute = { score: c.score, peakMin: c.profile && c.profile.peakMin, freeMin: c.profile && c.profile.freeMin };
    else { const city = await require('./citycommute').lookup(db, lat, lng); if (city) commute = { score: city.score, peakMin: city.peakMin, freeMin: city.freeMin, city: true }; } } catch { commute = null; } // хотын 500 м нүд (Ш3)
  const s = {
    education: avg(sc(m('kinder'), 250, 1500), sc(m('school'), 300, 1800)),
    transport: avg(sc(m('bus'), 150, 1000), commute ? commute.score : null),
    commerce: Math.max(sc(m('grocery'), 150, 1200) || 0, sc(m('mall'), 400, 2500) || 0),
    health: avg(sc(m('pharmacy'), 200, 1200), sc(m('health'), 400, 2000)),
    green: Math.max(sc(m('park'), 250, 1500) || 0, sc(m('playground'), 150, 1000) || 0),
    gov: sc(m('gov'), 400, 2500),
    parking: base ? base.parking : null,
    environment: base ? base.environment : null,
  };
  const W = { education: 1.3, transport: 1.3, commerce: 1.1, health: 1, green: 0.8, gov: 0.4, environment: 0.6, parking: 0.5 };
  let t = 0, w = 0; for (const [k, v] of Object.entries(W)) if (s[k] != null) { t += s[k] * v; w += v; }
  const L = { kinder: 'цэцэрлэг', school: 'сургууль', grocery: 'хүнсний дэлгүүр', pharmacy: 'эмийн сан', health: 'эмнэлэг', bus: 'автобусны буудал', park: 'ногоон байгууламж', playground: 'тоглоомын талбай' };
  const facts = Object.entries(L).filter(([k]) => C[k] && C[k].m <= 1200).map(([k, l]) => `${l} ${C[k].name ? '«' + C[k].name + '» ' : ''}${C[k].m} м (алхаж ${C[k].min} мин)`);
  if (commute && commute.peakMin) facts.push(`гол цэгүүд рүү машинаар оргил цагт дунджаар ${commute.peakMin} мин`);
  return { ...(base || { district, growth: 'stable', growth_note: '' }), ...s, total: w ? Math.round(t / w) : (base ? base.total : null), point: true, walkScore: a.score, walk: C, commute, facts };
}

module.exports = { valuation, matchScore, matchesForRequest, opportunities, locationScore };
