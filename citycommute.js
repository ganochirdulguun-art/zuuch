// «Зууч» — хотын хэмжээний замын/түгжрэлийн хугацаа (Ш3): барилгатай 500 м нүд бүрээс 11 гол цэг хүртэл 4 цагийн цонхоор (Google Routes computeRouteMatrix, TRAFFIC_AWARE_OPTIMAL).
// Үр дүн: city_commute (нүд → цэг → цонх → мин). Объектын профайл/А8 эхлээд 100 м кэш, байхгүй бол энэ хотын нүдийг ашиглана → дахин API дуудахгүй.
// Зардал хяналт: эзэн самбараас урьдчилсан тооцоо (элемент × $) харж эхлүүлнэ; maxElements-ээс давахгүй; тасалдвал дахин эхлүүлэхэд дууссан нүдийг алгасна.
const commute = require('./commute');
const geostore = require('./geostore');

const MIN_BUILDINGS = Number(process.env.CITY_COMMUTE_MIN_BLD) || 30; // ≥30 барилгатай нүд (орон сууц/гэр хороолол)
const FRESH_DAYS = 120;
const BATCH = 9; // 9 эх × 11 зорилго = 99 ≤ 100 (TRAFFIC_AWARE_OPTIMAL-ийн хүсэлт бүрийн дээд хязгаар)
const EPM = Number(process.env.CITY_COMMUTE_EPM) || 2400; // минутад элемент (квот 3 000)
// Google Maps Platform — Routes: Compute Route Matrix Pro (2025-03-аас): сард 5 000 үнэгүй, дараа нь $10 / 1000 (100k хүртэл), $8 (500k хүртэл)
function usd(elements, free = 5000) { let e = Math.max(0, elements - free), c = 0; const t = [[95000, 10], [400000, 8], [500000, 6], [4e6, 3], [Infinity, 0.75]]; for (const [n, p] of t) { const k = Math.min(e, n); c += (k / 1000) * p; e -= k; if (e <= 0) break; } return Math.round(c * 100) / 100; }

// Барилгатай нүдүүд (хавтангийн төв)
function cells() {
  const I = geostore.index ? geostore.index() : null; if (!I) return [];
  const G = I.grid; const out = [];
  for (const [k, v] of Object.entries(I.tiles)) { if ((v[1] || 0) < MIN_BUILDINGS) continue; const [i, j] = k.split('_').map(Number); out.push({ cell: k, lat: +(G.lat0 + (j + 0.5) * G.dlat).toFixed(6), lng: +(G.lng0 + (i + 0.5) * G.dlng).toFixed(6) }); }
  return out;
}
function cellOf(lat, lng) { const I = geostore.index ? geostore.index() : null; if (!I) return null; const G = I.grid; return `${Math.floor((lng - G.lng0) / G.dlng)}_${Math.floor((lat - G.lat0) / G.dlat)}`; }

async function pending(db) {
  const all = cells(); const done = new Set((await db.all(`SELECT cell FROM city_commute WHERE computed_at > NOW() - make_interval(days => ?)`, FRESH_DAYS)).map((r) => r.cell));
  return { all, todo: all.filter((c) => !done.has(c.cell)), done: done.size };
}
async function estimate(db) {
  const { all, todo, done } = await pending(db); const D = commute.destinations().length, S = commute.SLOTS.length;
  const elements = todo.length * D * S; const requests = Math.ceil(todo.length / BATCH) * S;
  return { cells: all.length, done, todo: todo.length, destinations: D, slots: S, elements, requests, usd: usd(elements), usdNoFree: usd(elements, 0), minutes: Math.ceil(elements / EPM), minBuildings: MIN_BUILDINGS };
}

// computeRouteMatrix (JSON массив хариу)
async function matrix(origins, dests, departure) {
  const wp = (p) => ({ waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } } });
  for (let a = 0; ; a++) {
    const r = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
      method: 'POST', signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': process.env.GOOGLE_MAPS_KEY || '', 'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,staticDuration,distanceMeters,condition,status' },
      body: JSON.stringify({ origins: origins.map(wp), destinations: dests.map(wp), travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE_OPTIMAL', departureTime: departure.toISOString() }),
    }).catch((e) => ({ ok: false, status: 0, text: async () => e.message }));
    if (r.ok) return parseMatrix(await r.json());
    const msg = String(await r.text()).slice(0, 200);
    if ((r.status === 429 || r.status >= 500 || r.status === 0) && a < 5) { await new Promise((ok) => setTimeout(ok, 4000 * 2 ** a)); continue; }
    throw new Error(`Route Matrix ${r.status}: ${msg}`);
  }
}
function parseMatrix(arr) {
  const sec = (s) => Math.round(parseFloat(String(s || '0').replace('s', '')));
  return (Array.isArray(arr) ? arr : []).map((e) => ({ o: e.originIndex || 0, d: e.destinationIndex || 0, ok: e.condition === 'ROUTE_EXISTS' && !(e.status && e.status.code),
    min: Math.round(sec(e.duration) / 60), freeMin: Math.round(sec(e.staticDuration) / 60), km: Math.round((e.distanceMeters || 0) / 100) / 10 }));
}

// Нүдний өгөгдлөөс объектын профайл (commute.profile-тэй ижил хэлбэр)
function profileFromCell(row) {
  if (!row || !row.data) return null; const rows = [];
  for (const d of commute.destinations()) { const v = row.data[d.id] || {}; const r = { id: d.id, name: d.name, w: d.w || 1 }; for (const s of commute.SLOTS) r[s.id] = v[s.id] || null; rows.push(r); }
  const sc = commute.scoreProfile(rows);
  return { lat: row.lat, lng: row.lng, cell: 'city:' + row.cell, slots: commute.SLOTS, rows, ...sc, provider: 'Google Routes API (TRAFFIC_AWARE_OPTIMAL, Мягмар) — хотын 500 м нүд', computed_at: row.computed_at, city: true };
}
async function lookup(db, lat, lng) {
  const c = cellOf(lat, lng); if (!c) return null;
  const row = await db.one(`SELECT * FROM city_commute WHERE cell=? AND computed_at > NOW() - make_interval(days => ?)`, c, FRESH_DAYS).catch(() => null);
  return row ? profileFromCell(row) : null;
}

// ---- Ажил (нэг удаад нэг) ----
let job = null;
function status() { return job ? { ...job, stopReq: undefined } : null; }
function stop() { if (job && job.running) job.stopReq = true; }
async function run(db, { maxElements } = {}) {
  if (job && job.running) throw new Error('Тооцоолол аль хэдийн явж байна');
  if (!process.env.GOOGLE_MAPS_KEY) throw new Error('GOOGLE_MAPS_KEY тохируулаагүй');
  const { todo } = await pending(db); const dests = commute.destinations(); const S = commute.SLOTS;
  const cap = Number(maxElements) > 0 ? Number(maxElements) : Infinity;
  job = { running: true, started: new Date().toISOString(), cells: todo.length, doneCells: 0, elements: 0, errors: 0, lastError: '', usd: 0, cap: Number.isFinite(cap) ? cap : null };
  (async () => {
    const perMin = []; const throttle = async (n) => { for (;;) { const now = Date.now(); while (perMin.length && now - perMin[0][0] > 60000) perMin.shift(); const used = perMin.reduce((s, x) => s + x[1], 0); if (used + n <= EPM) { perMin.push([now, n]); return; } await new Promise((ok) => setTimeout(ok, 1500)); } };
    try {
      for (let b = 0; b < todo.length; b += BATCH) {
        if (job.stopReq) { job.msg = 'Зогсоосон'; break; }
        const batch = todo.slice(b, b + BATCH); const need = batch.length * dests.length * S.length;
        if (job.elements + need > cap) { job.msg = 'Төсвийн дээд хязгаарт хүрсэн'; break; }
        const data = batch.map(() => ({}));
        for (const s of S) {
          await throttle(batch.length * dests.length);
          const res = await matrix(batch, dests, commute.nextTuesdayAt(s.hour, s.minute)); job.elements += batch.length * dests.length;
          for (const e of res) { if (!e.ok || !batch[e.o] || !dests[e.d]) continue; const o = data[e.o]; (o[dests[e.d].id] ||= {})[s.id] = { min: e.min, freeMin: e.freeMin, km: e.km }; }
        }
        for (let k = 0; k < batch.length; k++) {
          const c = batch[k]; await db.run(`INSERT INTO city_commute (cell, lat, lng, data, computed_at) VALUES (?,?,?,?,NOW()) ON CONFLICT (cell) DO UPDATE SET lat=EXCLUDED.lat, lng=EXCLUDED.lng, data=EXCLUDED.data, computed_at=NOW()`, c.cell, c.lat, c.lng, JSON.stringify(data[k]));
        }
        job.doneCells += batch.length; job.usd = usd(job.elements);
      }
      if (!job.msg) job.msg = 'Дууссан';
    } catch (e) { job.errors++; job.lastError = String(e.message || e).slice(0, 300); job.msg = 'Алдаа: ' + job.lastError; console.error('[хотын зам]', job.lastError); }
    finally { job.running = false; job.finished = new Date().toISOString(); console.log(`[хотын зам] ${job.msg}: ${job.doneCells}/${job.cells} нүд, ${job.elements} элемент (~$${job.usd})`); }
  })();
  return status();
}

module.exports = { cells, cellOf, estimate, run, stop, status, lookup, profileFromCell, parseMatrix, usd, BATCH };
