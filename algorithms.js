// «Зууч» — алгоритмууд: А3 үнэлгээ, А4 тохирол, А5 боломж, А8 байршил
const { db } = require('./db');

const ROOMS_K = { 1: 1.06, 2: 1.0, 3: 0.95, 4: 0.92, 5: 0.9 };

// ---- А3: Объектын үнэлгээ (CMA — индекс + зах зээлийн зарын түүвэр) ----
function valuation({ district, rooms, area, isNew, floor, totalFloors }) {
  rooms = Math.min(Number(rooms) || 2, 5);
  area = Number(area) || 50;
  const idx = db.prepare('SELECT * FROM price_index WHERE district=? AND is_new=? ORDER BY month DESC LIMIT 1')
    .get(district, isNew ? 1 : 0);
  if (!idx) return null;

  // Зах зээлийн заруудаас нэмэлт түүвэр (ижил дүүрэг, өрөө, талбай ±20%)
  const comps = db.prepare(`SELECT price, area FROM market_listings
    WHERE active=1 AND deal_type='sale' AND district=? AND rooms=? AND area BETWEEN ? AND ?`)
    .all(district, rooms, area * 0.8, area * 1.2);

  let baseM2 = idx.median_m2 * (ROOMS_K[rooms] || 1);
  let source = 'индекс';
  if (comps.length >= 5) {
    const m2s = comps.map(c => c.price / c.area).sort((a, b) => a - b);
    const q1 = m2s[Math.floor(m2s.length * 0.25)], q3 = m2s[Math.floor(m2s.length * 0.75)];
    const iqr = q3 - q1;
    const clean = m2s.filter(v => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr);
    const median = clean[Math.floor(clean.length / 2)];
    baseM2 = (median + baseM2) / 2; // индекс + бодит зарын дундажлал
    source = `индекс + ${clean.length} зарын түүвэр`;
  }

  let k = 1.0;
  const notes = [];
  if (floor && totalFloors) {
    if (Number(floor) === 1 || Number(floor) === Number(totalFloors)) { k *= 0.97; notes.push('1/дээд давхар −3%'); }
  }
  const est = baseM2 * k * area;
  const conf = Math.min(95, 40 + comps.length * 5 + (idx.sample > 50 ? 15 : 5));
  return {
    estimate: Math.round(est * 10) / 10,
    low: Math.round(idx.p25_m2 * (ROOMS_K[rooms] || 1) * k * area * 10) / 10,
    high: Math.round(idx.p75_m2 * (ROOMS_K[rooms] || 1) * k * area * 10) / 10,
    m2: Math.round(baseM2 * k * 100) / 100,
    confidence: conf,
    sample: comps.length,
    source,
    notes,
  };
}

// ---- А4: Хүсэлт ↔ объект тохирол (жинтэй оноо) ----
function matchScore(req, prop) {
  if (req.deal_type !== prop.deal_type) return 0;
  let score = 0;
  // Төсөв 35
  const lo = req.budget * 0.9, hi = req.budget * 1.05;
  if (prop.price >= lo && prop.price <= hi) score += 35;
  else {
    const over = prop.price > hi ? (prop.price - hi) / req.budget : (lo - prop.price) / req.budget;
    score += Math.max(0, 35 * (1 - over * 4));
  }
  // Байршил 25
  const districts = String(req.districts || '').split(',').map(s => s.trim()).filter(Boolean);
  if (districts.includes(prop.district)) score += 25;
  // Өрөө 20
  const dr = Math.abs(Number(req.rooms) - Number(prop.rooms));
  score += dr === 0 ? 20 : dr === 1 ? 10 : 0;
  // Талбай 10
  if (req.area_min || req.area_max) {
    const min = req.area_min || 0, max = req.area_max || 1e9;
    if (prop.area >= min && prop.area <= max) score += 10;
    else if (prop.area >= min * 0.85 && prop.area <= max * 1.15) score += 5;
  } else score += 5;
  // Шинэлэг 10 (7 хоногт нэмэгдсэн)
  const ageDays = (Date.now() - new Date(prop.created_at || prop.listed_at).getTime()) / 864e5;
  if (ageDays <= 7) score += 10;
  else if (ageDays <= 30) score += 5;
  return Math.round(score);
}

function matchesForRequest(reqId, companyId) {
  // Хүсэлт нь дуудсан компанийнх мөн эсэхийг шалгана (tenant тусгаарлалт)
  const req = companyId
    ? db.prepare('SELECT * FROM requests WHERE id=? AND company_id=?').get(reqId, companyId)
    : db.prepare('SELECT * FROM requests WHERE id=?').get(reqId);
  if (!req) return { request: null, internal: [], market: [] };
  // Дотоод объект зөвхөн тухайн компанийнх; зах зээлийн зар нийтлэг
  const props = companyId
    ? db.prepare("SELECT * FROM properties WHERE status='active' AND company_id=?").all(companyId)
    : db.prepare("SELECT * FROM properties WHERE status='active'").all();
  const internal = props
    .map(p => ({ ...p, score: matchScore(req, p) }))
    .filter(p => p.score >= 50).sort((a, b) => b.score - a.score).slice(0, 10);
  const mls = db.prepare('SELECT * FROM market_listings WHERE active=1').all();
  const market = mls
    .map(m => ({ ...m, deal_type: m.deal_type, created_at: m.listed_at, score: matchScore(req, m) }))
    .filter(m => m.score >= 60).sort((a, b) => b.score - a.score).slice(0, 10);
  return { request: req, internal, market };
}

// ---- А5: Боломж илрүүлэгч ----
function opportunities() {
  const rows = db.prepare('SELECT * FROM market_listings WHERE active=1 AND deal_type=\'sale\'').all();
  const out = [];
  for (const r of rows) {
    const idx = db.prepare('SELECT * FROM price_index WHERE district=? AND is_new=? ORDER BY month DESC LIMIT 1')
      .get(r.district, r.is_new);
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

// ---- А8: Байршлын оноо (демо: дүүргийн түвшин; бодит хувилбарт 150м торлол) ----
function locationScore(district) {
  return db.prepare('SELECT * FROM location_scores WHERE district=?').get(district) || null;
}

module.exports = { valuation, matchScore, matchesForRequest, opportunities, locationScore };
