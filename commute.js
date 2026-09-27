// «Зууч» — Д-5 Замын/түгжрэлийн профайл: объектын байршлаас худалдан авагчийн гол цэгүүд хүртэлх БОДИТ хугацаа
// Эх сурвалж: Google Routes API (computeRoutes, TRAFFIC_AWARE_OPTIMAL — тухайн цагийн түүхэн түгжрэлийн урьдчилсан тооцоо).
// Кэш: ~100 м торны нүд бүрд нэг удаа (commute_cells, 30 хоног) — ойролцоох объектууд дахин тооцохгүй.
const { db } = require('./db');

const KEY = () => process.env.GOOGLE_MAPS_KEY || '';
const TT = () => process.env.TOMTOM_KEY || ''; // TomTom Routing API (карт шаардахгүй, өдөрт 2 500 тооцоо үнэгүй) — Google түлхүүргүй бол үүнийг ашиглана
const provider = () => (KEY() ? 'google' : TT() ? 'tomtom' : null);
// Худалдан авагчийн гол судлагдахуун (УБ). Координатыг эзэн засварлаж болно (COMMUTE_DESTINATIONS env JSON давуу).
const DEFAULT_DESTS = [
  { id: 'center', name: 'Хотын төв (Сүхбаатарын талбай)', lat: 47.9187, lng: 106.9176, w: 3 },
  { id: 'gov', name: 'Төрийн ордон / яамд', lat: 47.9200, lng: 106.9180, w: 2 },
  { id: 'cityhall', name: 'Хотын захиргаа', lat: 47.9153, lng: 106.9214, w: 1 },
  { id: 'west4', name: 'Баруун 4 зам', lat: 47.9157, lng: 106.8967, w: 2 },
  { id: 'east4', name: 'Зүүн 4 зам', lat: 47.9198, lng: 106.9396, w: 2 },
  { id: 'peace_bridge', name: 'Энхтайвны гүүр', lat: 47.9066, lng: 106.9168, w: 2 },
  { id: 'sun_bridge', name: 'Нарны гүүр', lat: 47.9078, lng: 106.9340, w: 1 },
  { id: 'ikh_delguur', name: 'Улсын их дэлгүүр', lat: 47.9166, lng: 106.9058, w: 1 },
  { id: 'shangrila', name: 'Шангри-Ла молл', lat: 47.9132, lng: 106.9248, w: 1 },
  { id: 'hunnu', name: 'Хүннү молл', lat: 47.8922, lng: 106.8932, w: 1 },
  { id: 'airport', name: 'Чингис хаан нисэх буудал', lat: 47.6469, lng: 106.8205, w: 1 },
];
function destinations() {
  try { const j = JSON.parse(process.env.COMMUTE_DESTINATIONS || 'null'); if (Array.isArray(j) && j.length) return j; } catch { /* env буруу бол анхдагч */ }
  return DEFAULT_DESTS;
}
// Цагийн цонхууд (Улаанбаатар UTC+8): ажлын өдрийн өглөөний оргил, өдөр, оройн оргил, чөлөөт урсгал (шөнө)
const SLOTS = [
  { id: 'am_peak', name: 'Өглөө 08:30', hour: 8, minute: 30 },
  { id: 'midday', name: 'Өдөр 13:00', hour: 13, minute: 0 },
  { id: 'pm_peak', name: 'Орой 18:00', hour: 18, minute: 0 },
  { id: 'free', name: 'Чөлөөт (23:00)', hour: 23, minute: 0 },
];
// Дараагийн Мягмар гарагийн заасан цаг (UTC+8) — Routes API ирээдүйн departureTime шаарддаг
function nextTuesdayAt(hour, minute) {
  const now = new Date(); const ub = new Date(now.getTime() + 8 * 3600000);
  const d = new Date(Date.UTC(ub.getUTCFullYear(), ub.getUTCMonth(), ub.getUTCDate(), hour - 8, minute, 0));
  const dow = new Date(d.getTime() + 8 * 3600000).getUTCDay(); // UB-ийн гараг
  let add = (2 - dow + 7) % 7; if (add === 0 && d.getTime() < now.getTime() + 3600000) add = 7;
  return new Date(d.getTime() + add * 86400000);
}
const cellOf = (lat, lng) => `${lat.toFixed(3)},${lng.toFixed(3)}`; // ~110 м × ~75 м

// TomTom: calculateRoute + traffic=true + departAt (ирээдүйн цаг → түүхэн түгжрэлийн урьдчилсан тооцоо)
async function routeTomTom(origin, dest, departure) {
  const url = `https://api.tomtom.com/routing/1/calculateRoute/${origin.lat},${origin.lng}:${dest.lat},${dest.lng}/json?key=${encodeURIComponent(TT())}&traffic=true&travelMode=car&routeType=fastest&computeTravelTimeFor=all&departAt=${encodeURIComponent(departure.toISOString())}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('TomTom ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const j = await r.json(); const s = j.routes && j.routes[0] && j.routes[0].summary; if (!s) return null;
  const withTraffic = s.historicTrafficTravelTimeInSeconds || s.travelTimeInSeconds || 0;
  return { min: Math.round(withTraffic / 60), freeMin: Math.round((s.noTrafficTravelTimeInSeconds || s.travelTimeInSeconds || 0) / 60), km: Math.round((s.lengthInMeters || 0) / 100) / 10 };
}
async function routeOnce(origin, dest, departure) {
  if (provider() === 'tomtom') return routeTomTom(origin, dest, departure);
  const body = {
    origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
    destination: { location: { latLng: { latitude: dest.lat, longitude: dest.lng } } },
    travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE_OPTIMAL', departureTime: departure.toISOString(), languageCode: 'mn',
  };
  const r = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY(), 'X-Goog-FieldMask': 'routes.duration,routes.staticDuration,routes.distanceMeters' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('Routes API ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const j = await r.json(); const rt = j.routes && j.routes[0]; if (!rt) return null;
  const sec = (s) => Math.round(parseFloat(String(s || '0').replace('s', '')));
  return { min: Math.round(sec(rt.duration) / 60), freeMin: Math.round(sec(rt.staticDuration) / 60), km: Math.round((rt.distanceMeters || 0) / 100) / 10 };
}

// Оноо (0–100): хотын төв/гол цэгүүд рүү оргил цагийн жинлэсэн дундаж минут → 15 мин=100, 60 мин=0; түгжрэлийн зөрүү (оргил/чөлөөт) нэмэлт хасалт
function scoreProfile(rows) {
  const w = rows.reduce((s, r) => s + r.w, 0) || 1;
  const peak = rows.reduce((s, r) => s + r.w * Math.max(r.am_peak?.min || 0, r.pm_peak?.min || 0), 0) / w;
  const free = rows.reduce((s, r) => s + r.w * (r.free?.min || 0), 0) / w;
  let score = Math.round(100 - Math.max(0, Math.min(100, ((peak - 15) / 45) * 100)));
  const jam = free > 0 ? peak / free : 1; if (jam > 1.6) score -= Math.min(20, Math.round((jam - 1.6) * 25));
  return { score: Math.max(0, Math.min(100, score)), peakMin: Math.round(peak), freeMin: Math.round(free), jamRatio: Math.round(jam * 100) / 100 };
}

// Бүтэн профайл: цэг бүр × 4 цонх (11 × 4 = 44 дуудлага; нүд бүрд нэг удаа, 30 хоног кэш)
async function profile(lat, lng, { force = false } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('Байршил (lat/lng) шаардлагатай');
  const cell = cellOf(lat, lng);
  if (!force) { const c = await db.one("SELECT * FROM commute_cells WHERE cell=? AND computed_at > NOW() - INTERVAL '30 days'", cell); if (c) return { ...c.profile, score: c.score, cached: true, computed_at: c.computed_at }; }
  if (!provider()) throw new Error('Замын API түлхүүр тохируулаагүй — TOMTOM_KEY (карт шаардахгүй) эсвэл GOOGLE_MAPS_KEY');
  const dests = destinations(); const rows = [];
  for (const d of dests) {
    const row = { id: d.id, name: d.name, w: d.w || 1 };
    for (const s of SLOTS) { try { row[s.id] = await routeOnce({ lat, lng }, d, nextTuesdayAt(s.hour, s.minute)); } catch (e) { row[s.id] = null; row.error = e.message; } }
    rows.push(row);
  }
  const sc = scoreProfile(rows);
  const prof = { lat, lng, cell, slots: SLOTS, rows, ...sc, provider: provider() === 'tomtom' ? 'TomTom Routing API (түүхэн түгжрэл, Мягмар)' : 'Google Routes API (TRAFFIC_AWARE_OPTIMAL, Мягмар)', computed_at: new Date().toISOString() };
  await db.run(`INSERT INTO commute_cells (cell, lat, lng, profile, score, computed_at) VALUES (?,?,?,?,?,NOW())
    ON CONFLICT (cell) DO UPDATE SET profile=EXCLUDED.profile, score=EXCLUDED.score, computed_at=NOW()`, cell, lat, lng, JSON.stringify(prof), sc.score);
  return { ...prof, cached: false };
}
// Гэрээс гараад ГОЛ ЗАМ хүртэл: хамгийн ойрын гол цэг рүү чөлөөт урсгалын анхны 1–2 км — тусдаа маягаар хойшлуулав; одоо профайлд «хамгийн ойр 4 зам» гэж харуулна
module.exports = { profile, destinations, SLOTS, cellOf, hasKey: () => !!provider(), provider };
