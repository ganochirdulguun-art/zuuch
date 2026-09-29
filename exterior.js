// «Зууч» — Гадаах орчны 3D нислэгийн аялалын өгөгдөл (Ш3д-3)
// Эх сурвалж: OpenStreetMap (© OpenStreetMap contributors, ODbL) — барилга, зам, ногоон байгууламж, үйлчилгээний цэгүүд.
// • Ойрын бүс: бүх барилга/зам/талбай (нарийвчилсан), орчны цэгүүд хүртэлх АЛХАХ маршрут OSM замын сүлжээгээр (Dijkstra).
// • Алс бүс: Баруун 4 зам / хотын төв хүртэлх томоохон барилга, гол зам (хотын дүр төрх) + жолоодох маршрутын геометр (OSM).
// • Хугацаа: Google Routes API (TRAFFIC_AWARE_OPTIMAL, ажлын өдөр цаг тус бүр) — зөвхөн тоо; маршрутын шугам OSM-ынх.
const commute = require('./commute');

const ENDPOINTS = ['https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const UA = 'ZuuchBot/1.0 (+https://zuuch-production.up.railway.app/bot; smartzuuch.mn@gmail.com)';
const WEST4 = { id: 'west4', name: 'Баруун 4 зам', lat: 47.91528, lng: 106.8952 };
const CENTER = { id: 'center', name: 'Хотын төв (Сүхбаатарын талбай)', lat: 47.9187, lng: 106.9176 };
const WALK_MS = 1.25; // алхах хурд 4.5 км/ц

async function overpass(q, timeoutMs = 170000) {
  let lastErr;
  for (const ep of ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(ep, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(timeoutMs) });
        const txt = await r.text();
        if (r.ok && txt.trim().startsWith('{')) return JSON.parse(txt);
        lastErr = new Error(`Overpass ${r.status} (${ep.split('/')[2]}): ${txt.slice(0, 100)}`);
      } catch (e) { lastErr = e; }
      await new Promise((res) => setTimeout(res, 2000));
    }
  }
  throw lastErr;
}

// ---------- Геометр ----------
const r1 = (v) => Math.round(v * 10) / 10;
function projector(lat0, lng0) {
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111320, kz = 110540;
  return { f: (lat, lng) => [(lng - lng0) * kx, (lat0 - lat) * kz], inv: (x, z) => ({ lat: lat0 - z / kz, lng: lng0 + x / kx }) };
}
function simplify(pts, tol) { // Douglas–Peucker
  if (pts.length <= 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); const [ax, az] = pts[a], [bx, bz] = pts[b]; const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1e-9;
    let best = -1, bi = -1; const closed = Math.hypot(dx, dz) < 1e-6;
    for (let i = a + 1; i < b; i++) { const d = closed ? Math.hypot(pts[i][0] - ax, pts[i][1] - az) : Math.abs(dx * (az - pts[i][1]) - (ax - pts[i][0]) * dz) / L; if (d > best) { best = d; bi = i; } }
    if (best > tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const area = (p) => { let s = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]); return s / 2; };
const centroid = (p) => { let x = 0, z = 0; for (const q of p) { x += q[0]; z += q[1]; } return [x / p.length, z / p.length]; };
function inPoly(x, z, p) { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { if (((p[i][1] > z) !== (p[j][1] > z)) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c; } return c; }
function segDist(px, pz, ax, az, bx, bz) { const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9; const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2)); const qx = ax + t * dx, qz = az + t * dz; return [Math.hypot(px - qx, pz - qz), qx, qz]; }
function hull(p) { // гүдгэр бүрхүүл (Andrew-ийн монотон гинж)
  const s = p.map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]); if (s.length < 3) return s;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); const lo = [], up = [];
  for (const q of s) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = s.length - 1; i >= 0; i--) { const q = s[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  lo.pop(); up.pop(); return lo.concat(up);
}
// Урт/өргөн: хамгийн бага талбайтай хүрээлэгч тэгш өнцөгт (гүдгэр бүрхүүл + rotating calipers) — оройн тооноос хамаардаггүй
// (оройн PCA шаталсан ML контурт тэнхлэгээ хазайлгадаг байсан). Буцаах: [L, W, θ] — θ = урт тэнхлэгийн чиг, [0, π)
function dims(p) {
  const h = hull(p); let best = null;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l < 1e-6) continue;
    const ux = (b[0] - a[0]) / l, uz = (b[1] - a[1]) / l; let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
    for (const [x, z] of h) { const s = x * ux + z * uz, t = -x * uz + z * ux; if (s < s0) s0 = s; if (s > s1) s1 = s; if (t < t0) t0 = t; if (t > t1) t1 = t; }
    const e1 = s1 - s0, e2 = t1 - t0; if (!best || e1 * e2 < best[0]) best = [e1 * e2, e1, e2, Math.atan2(uz, ux)];
  }
  if (!best) return [0, 0, 0];
  const [, e1, e2, th] = best; const t = e1 >= e2 ? th : th + Math.PI / 2;
  return [Math.max(e1, e2), Math.min(e1, e2), ((t % Math.PI) + Math.PI) % Math.PI];
}
const flat = (pts) => pts.flatMap(([x, z]) => [r1(x), r1(z)]);

// ---------- Барилгын төрөл ба давхар (OSM-д давхар ховор бичигддэг) ----------
// Зарчим: бодит байдлыг гажуудуулахгүй — эргэлзээтэй бол БОЛГООМЖТОЙ (нам) утга өгч, «таамаг» (e:1) гэж тэмдэглэнэ.
// kn=1 МЭДЭГДЭХ: building:levels / height таг, Overture num_floors, оршин суугчийн засвар, гэр, эргэлзээгүй жижиг төрөл (саравч/гараж/ТҮЦ → 1).
// kn=0 ТААМАГ: төрөл/нэр/хэлбэрийн урьдчилсан утга; угсармал блок (slab) → орон сууцны нотолгоо + мэдэгдэх хөршөөр generate() дотор;
// алс бүсийн том таггүй барилга → ойр орчны таглагдсан барилгын доод гуравны нэгээр. Таамаг ≤ 9 давхар.
const FLH = 3; // нэг давхрын өндөр, м
const EST_MAX = 9; // таамаг давхрын дээд хязгаар
const SMALL_B = new Set(['shed', 'garage', 'garages', 'barn', 'roof', 'kiosk', 'container', 'carport', 'hangar', 'shelter', 'toilets', 'transformer_tower', 'service', 'greenhouse', 'sty', 'stable', 'cowshed', 'gatehouse', 'guardhouse']);
const HOUSE_B = new Set(['house', 'detached', 'hut', 'cabin', 'bungalow', 'semidetached_house', 'terrace']);
const RES_B = new Set(['apartments', 'residential', 'dormitory']);
const COM_B = new Set(['commercial', 'retail', 'office', 'supermarket', 'mall', 'hotel', 'public', 'civic', 'government', 'market', 'shop', 'shopping', 'cafe', 'museum', 'temple', 'church', 'mosque', 'cathedral', 'chapel', 'monastery', 'religious', 'train_station', 'transportation', 'fire_station', 'bank', 'parking', 'theatre', 'cinema', 'library']);
const IND_B = new Set(['industrial', 'warehouse', 'factory', 'manufacture']);
const RE_KINDER = /цэцэрлэг|kindergarten|детский сад/i;
const RE_UNIV = /их сургууль|дээд сургууль|университет|институт|коллеж|академи|university|college|institute|academy/i;
const RE_GYM = /заал|спорт|gym|фитнес|fitness|бассейн/i;
const RE_SCHOOL = /сургууль|school|лицей|гимнази/i;
const RE_HEALTH = /эмнэлэг|hospital|clinic|клиник|амбулатори|поликлиник|төрөх/i;
const RE_COM = /зах|дэлгүүр|худалдаа|маркет|market|store|плаза|plaza|center|centre|центр|төв|телевиз|радио|театр|кино|cinema|оффис|office|банк|bank|зочид буудал|hotel|ресторан|restaurant|mall|молл|үйлчилгээний|шатахуун|газар|яам|захиргаа|ордон|музей|сүм|хийд|цагдаа|шүүх|шуудан|номын сан/i;
const RE_RESNAME = /байр|хотхон|орон сууц|residence|apartment/i; // орон сууцны нэр → нэрээр худалдааны гэж ангилахгүй
const RE_GARAGE = /гараж|граж|garage/i;
const RE_UTIL = /ЦТП|дулааны төв|дулааны станц|подстанц|бойлер|насос|трансформатор/i; // инженерийн байгууламж (дулааны төв г.м.) → үйлдвэр/агуулахын нам утга
// Ангилал: ger | shed | house | apt | kinder | univ | gym | school | health | ind | com | bld (таггүй / yes / ML)
function category(t) {
  const b = t.building || 'yes', am = t.amenity || '', nm = String(t.name || ''), sub = t._sub || '', le = t.leisure || '';
  const byName = nm && !RE_RESNAME.test(nm);
  if (b === 'ger' || b === 'yurt') return 'ger';
  if (SMALL_B.has(b) || am === 'toilets' || am === 'shelter') return 'shed';
  if (HOUSE_B.has(b)) return 'house';
  if (RES_B.has(b)) return 'apt'; // орон сууцны таг нэр/amenity-ээс давуу
  if (b === 'kindergarten' || am === 'kindergarten' || (byName && RE_KINDER.test(nm))) return 'kinder';
  if (['university', 'college'].includes(b) || ['university', 'college'].includes(am) || (byName && RE_UNIV.test(nm))) return GENERAL_ED.test(nm) && !HIGHER_ED.test(nm) ? 'school' : 'univ';
  if (['sports_hall', 'sports_centre', 'stadium', 'grandstand'].includes(b) || ['sports_centre', 'fitness_centre', 'sports_hall'].includes(le) || (byName && RE_GYM.test(nm))) return 'gym';
  if (b === 'school' || am === 'school' || sub === 'education' || (byName && RE_SCHOOL.test(nm))) return 'school';
  if (['hospital', 'clinic'].includes(b) || ['hospital', 'clinic', 'doctors', 'dentist'].includes(am) || sub === 'medical' || (byName && RE_HEALTH.test(nm))) return 'health';
  if (IND_B.has(b) || sub === 'industrial' || (byName && RE_UTIL.test(nm))) return 'ind';
  if (COM_B.has(b) || am || t.shop || ['commercial', 'entertainment', 'civic', 'religious', 'transportation'].includes(sub) || (byName && RE_COM.test(nm))) return 'com';
  return 'bld';
}
const KIND = { ger: 'ger', shed: 'shed', house: 'house', apt: 'apt', kinder: 'edu', univ: 'edu', school: 'edu', health: 'com', ind: 'com', com: 'com', bld: 'bld' };
// Угсармал (бичил хорооллын) блокийн хэлбэр: дундаж гүн D = A/L 10–16.5 м, урт ≥ 36 м (хамгийн бага тэгш өнцөгтөөр), сунасан (L/W ≥ 2),
// хүрээлэгч тэгш өнцөгт гүнээсээ хэт өргөн биш (W ≤ 2.2·D — Г/П хэлбэр, муруй контурыг хасна)
const slabShape = (q) => q.L >= 36 && q.D >= 10 && q.D <= 16.5 && q.L / Math.max(q.W, 1) >= 2 && q.W <= 2.2 * q.D;
// q: { t, A, L, W, D, src } → { k, lv, kn, cat, rule, slab }
function classify(q) {
  const t = q.t, A = q.A, b = t.building || 'yes';
  const lvTag = parseFloat(t['building:levels']); const hTag = parseFloat(String(t.height || '').replace(/[^0-9.]/g, ''));
  const cat = category(t); const k = KIND[cat] || 'bld';
  if (Number.isFinite(lvTag) && lvTag > 0) return { k, cat, lv: Math.min(60, Math.round(lvTag)), kn: 1, tg: 1, rule: 'таг: давхар' };
  if (Number.isFinite(hTag) && hTag > 2) return { k, cat, lv: Math.max(1, Math.round(hTag / FLH)), kn: 1, tg: 1, rule: 'таг: өндөр' };
  if (cat === 'ger') return { k, cat, lv: 1, kn: 1, rule: 'гэр' };
  if (cat === 'shed') return { k, cat, lv: 1, kn: b === 'service' && A >= 200 ? 0 : 1, rule: 'жижиг төрөл (' + b + ')' };
  const pr = (lv, rule) => ({ k, cat, lv, kn: 0, rule });
  switch (cat) {
    case 'kinder': return pr(A > 2500 ? 3 : 2, 'цэцэрлэг');
    case 'univ': return pr(A < 300 ? 2 : A < 3000 ? 3 : 4, 'их/дээд сургууль'); // таглагдсан 13: медиан 3
    case 'gym': return pr(2, 'заал/спорт');
    case 'school': return pr(A < 300 ? 2 : A > 1500 ? 4 : 3, 'сургууль');
    case 'health': return pr(A < 800 ? 2 : A < 2500 ? 3 : 4, 'эмнэлэг'); // өмнөх хувилбарын утгаас (com: > 800 м² → 3) өсгөхгүй — таглагдсан эмнэлэг цөөн (алс бүсэд 5)
    case 'ind': return pr(A < 300 ? 1 : 2, 'үйлдвэр/агуулах');
    case 'com': return pr(A < 300 ? 1 : A < 1500 ? 2 : A < 4000 ? 3 : 4, 'худалдаа/олон нийт');
    case 'house': return pr(A < 130 ? 1 : 2, 'house');
    default:
  }
  // Угсармал: давхрыг generate() дотор (мэдэгдэх хөрш, алга бол 5). Таггүй/ML контур бол зөвхөн ОРОН СУУЦНЫ НОТОЛГОО байвал (generate() шалгана),
  // үгүй бол alt (таггүй барилгын утга) хэвээр — гэр хороолол/авто баазын дундах сунасан хайрцаг 5 давхар болохгүй.
  const slabOk = (RES_B.has(b) || b === 'yes' || q.src === 'ml') && slabShape(q);
  if (slabOk) return { ...pr(5, 'угсармал'), slab: 1, slabRes: RES_B.has(b) || RE_RESNAME.test(String(t.name || '')) ? 1 : 0, alt: plainPrior(q) };
  if (cat === 'apt') return pr(A < 150 ? 2 : 5, 'apartments'); // таглагдсан apartments < 300 м²: 24-өөс 17 нь ≥ 5 давхар (нэг орцтой цамхаг) — 2 гэвэл хэт бага
  const pp = plainPrior(q); return pr(pp.lv, pp.rule);
}
// Таггүй (yes/ML) барилгын болгоомжтой урьдчилсан утга
function plainPrior(q) {
  if (RE_GARAGE.test(String(q.t.name || ''))) return { lv: 1, rule: 'гаражийн нэр' };
  if (q.D < 9 && q.L / Math.max(q.W, 1) > 3) return { lv: 1, rule: 'нарийн эгнээ (гараж/лангуу)' }; // дундаж гүн < 9 м, сунасан → гараж/лангууны эгнээ
  return { lv: q.A < 150 ? 1 : 2, rule: q.L / Math.max(q.W, 1) < 1.8 ? 'таггүй бөөрөнхий' : 'таггүй сунасан' };
}

// ---------- Орчны цэгийн ангилал ----------
const HIGHER_ED = /(дээд сургууль|их сургууль|институт|коллеж|university|college|institute)/i;
// OSM-д «college» гэж тэмдэглэсэн ч нэрээрээ ерөнхий боловсролын сургууль (жишээ: «Хүрээ дунд сургууль»)
const GENERAL_ED = /(дунд сургууль|бага сургууль|ерөнхий боловсрол|ЕБС|цогцолбор сургууль|secondary|high school|elementary)/i;
function poiCat(t) {
  const am = t.amenity || '', sh = t.shop || '', le = t.leisure || '', hw = t.highway || '', pt = t.public_transport || '';
  if (am === 'kindergarten') return 'kinder';
  if (am === 'school') return HIGHER_ED.test(t.name || '') ? 'college' : 'school';
  if (am === 'university' || am === 'college') return GENERAL_ED.test(t.name || '') && !HIGHER_ED.test(t.name || '') ? 'school' : 'college';
  if (hw === 'bus_stop' || (pt === 'platform' && t.bus !== 'no')) return 'bus';
  if (['mall', 'department_store'].includes(sh) || am === 'marketplace') return 'mall';
  if (['supermarket', 'convenience'].includes(sh)) return 'grocery';
  if (am === 'pharmacy') return 'pharmacy';
  if (['hospital', 'clinic', 'doctors'].includes(am)) return 'health';
  if (le === 'playground') return 'playground';
  if (['park', 'garden'].includes(le)) return 'park';
  if (['pitch', 'sports_centre', 'fitness_station'].includes(le)) return 'sport';
  if (am === 'parking') return 'parking';
  return null;
}
const CAT = { // дараалал = нислэгийн дараалал; n = хэдэн цэг сонгох
  grocery: { mn: 'Хүнсний дэлгүүр', n: 1 }, pharmacy: { mn: 'Эмийн сан', n: 1 }, parking: { mn: 'Авто зогсоол', n: 2 },
  playground: { mn: 'Хүүхдийн тоглоомын талбай', n: 2 }, park: { mn: 'Ногоон байгууламж', n: 1 }, sport: { mn: 'Спорт талбай', n: 1 },
  bus: { mn: 'Автобусны буудал', n: 2 }, kinder: { mn: 'Цэцэрлэг', n: 2 }, school: { mn: 'Ерөнхий боловсролын сургууль', n: 2 },
  health: { mn: 'Эмнэлэг', n: 1 }, mall: { mn: 'Худалдаа, үйлчилгээний төв', n: 2 }, college: { mn: 'Их, дээд сургууль', n: 1 },
};

// ---------- Замын сүлжээ + Dijkstra ----------
const WALK_OK = (hw) => hw && !['motorway', 'motorway_link', 'construction', 'proposed', 'raceway', 'bus_guideway', 'escape', 'abandoned'].includes(hw);
const DRIVE_W = { trunk: 0.6, trunk_link: 0.7, primary: 0.65, primary_link: 0.75, secondary: 0.75, secondary_link: 0.8, tertiary: 0.85, tertiary_link: 0.9, unclassified: 1.1, residential: 1.1, living_street: 1.4, service: 1.6 };
function graph(ways, costFn, P) {
  const nodes = new Map(); // osm id → {x,z,adj:[[id,w,len]]}
  for (const w of ways) {
    const f = costFn(w.tags || {}); if (!f || !w.nodes || !w.geometry) continue;
    for (let i = 0; i < w.nodes.length; i++) {
      const id = w.nodes[i], g = w.geometry[i]; if (!g) continue;
      if (!nodes.has(id)) { const [x, z] = P.f(g.lat, g.lon); nodes.set(id, { x, z, adj: [] }); }
      if (i) { const a = nodes.get(w.nodes[i - 1]), b = nodes.get(id); if (!a) continue; const len = Math.hypot(a.x - b.x, a.z - b.z); a.adj.push([id, len * f, len]); b.adj.push([w.nodes[i - 1], len * f, len]); }
    }
  }
  return nodes;
}
function dijkstra(nodes, src) {
  const dist = new Map([[src, 0]]), len = new Map([[src, 0]]), prev = new Map(); const heap = [[0, src]];
  const push = (it) => { heap.push(it); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [d, u] = pop(); if (d > dist.get(u)) continue;
    for (const [v, w, l] of nodes.get(u).adj) { const nd = d + w; if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); len.set(v, len.get(u) + l); prev.set(v, u); push([nd, v]); } }
  }
  return { dist, len, prev };
}
function addConnectors(G, polys, { maxD = 45, perNode = 6, within = Infinity } = {}) {
  const cell = 25, key = (i, j) => i * 1000003 + j, grid = new Map();
  for (const poly of polys) for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    for (let ii = Math.floor(Math.min(a[0], b[0]) / cell); ii <= Math.floor(Math.max(a[0], b[0]) / cell); ii++) for (let jj = Math.floor(Math.min(a[1], b[1]) / cell); jj <= Math.floor(Math.max(a[1], b[1]) / cell); jj++) { const k = key(ii, jj); if (!grid.has(k)) grid.set(k, []); grid.get(k).push([a[0], a[1], b[0], b[1]]); }
  }
  const cross = (ax, az, bx, bz, cx, cz, dx, dz) => { const d1 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx), d2 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx), d3 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax), d4 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax); return (d1 > 0) !== (d2 > 0) && (d3 > 0) !== (d4 > 0); };
  const blocked = (ax, az, bx, bz) => { for (let ii = Math.floor(Math.min(ax, bx) / cell); ii <= Math.floor(Math.max(ax, bx) / cell); ii++) for (let jj = Math.floor(Math.min(az, bz) / cell); jj <= Math.floor(Math.max(az, bz) / cell); jj++) { const L = grid.get(key(ii, jj)); if (L) for (const q of L) if (cross(ax, az, bx, bz, q[0], q[1], q[2], q[3])) return true; } return false; };
  const ng = new Map(); for (const [id, n] of G) { if (Math.hypot(n.x, n.z) > within) continue; const k = key(Math.floor(n.x / maxD), Math.floor(n.z / maxD)); if (!ng.has(k)) ng.set(k, []); ng.get(k).push(id); }
  let added = 0;
  for (const L0 of ng.values()) for (const id of L0) {
    const n = G.get(id), ci = Math.floor(n.x / maxD), cj = Math.floor(n.z / maxD), cand = [];
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const L = ng.get(key(ci + di, cj + dj)); if (L) for (const o of L) { if (o === id) continue; const m = G.get(o), d = Math.hypot(m.x - n.x, m.z - n.z); if (d > 2 && d <= maxD) cand.push([d, o]); } }
    cand.sort((a, b) => a[0] - b[0]); const have = new Set(n.adj.map((a) => a[0])); let k = 0;
    for (const [d, o] of cand) { if (k >= perNode) break; if (have.has(o)) continue; const m = G.get(o); if (blocked(n.x, n.z, m.x, m.z)) continue; n.adj.push([o, d * 1.15, d]); m.adj.push([id, d * 1.15, d]); have.add(o); k++; added++; }
  }
  return added;
}
function nearestNode(nodes, x, z, maxD = 250) { let best = null, bd = maxD; for (const [id, n] of nodes) { const d = Math.hypot(n.x - x, n.z - z); if (d < bd) { bd = d; best = id; } } return best ? { id: best, d: bd } : null; }
function pathTo(nodes, prev, dst) { const out = []; for (let c = dst; c != null; c = prev.get(c)) { const n = nodes.get(c); out.unshift([n.x, n.z]); } return out; }

// ---------- Үндсэн: өгөгдөл цуглуулах ----------
// heightAt(lat,lng) → GHSL ANBH (м), cellAt(lat,lng) → нүдний түлхүүр (heightAt-тай ижил тор): давхарт нөлөөлөхгүй (зөвхөн debug / ghslRules=true туршилт) —
// тиймээс server.js (heightAt/cellAt-гүй) болон демо ижил дүрмээр давхар гаргана. overrides = оршин суугчийн засвар [{lat,lng}|{x,z}, lv, k?, rp?, note?]
async function generate(lat, lng, { commuteHours = true, log = () => {}, buildings: extBuildings = null, heightAt = null, cellAt = null, homeLevels = null, overrides = null, ghslRules = false, debug = null } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('Байршил (lat/lng) шаардлагатай');
  const P = projector(lat, lng);
  // 1) Орчны цэгүүд + гол зам (2 км)
  log('OSM: орчны цэгүүд…');
  const qPoi = `[out:json][timeout:120];(
    nwr["amenity"~"^(school|kindergarten|university|college|parking|pharmacy|hospital|clinic|doctors|marketplace)$"](around:2000,${lat},${lng});
    nwr["shop"~"^(mall|supermarket|department_store|convenience)$"](around:2000,${lat},${lng});
    nwr["leisure"~"^(park|playground|garden|pitch|sports_centre)$"](around:1500,${lat},${lng});
    nwr["highway"="bus_stop"](around:1500,${lat},${lng});
  );out center tags;`;
  const poiRaw = (await overpass(qPoi)).elements || [];
  const cands = [];
  for (const e of poiRaw) {
    const c = e.center || e; if (c.lat == null) continue; const t = e.tags || {}; const cat = poiCat(t); if (!cat) continue;
    const [x, z] = P.f(c.lat, c.lon); cands.push({ cat, name: t.name || '', x, z, d0: Math.hypot(x, z), osm: `${e.type}/${e.id}` });
  }
  // Сонгох цэгүүдийн радиус (шулуун зайгаар урьдчилан): ангилал бүрээс хамгийн ойр 4
  const pre = []; for (const cat of Object.keys(CAT)) pre.push(...cands.filter((c) => c.cat === cat).sort((a, b) => a.d0 - b.d0).slice(0, 4));
  const R = Math.max(450, Math.min(950, Math.max(...pre.filter((c) => c.cat !== 'college').map((c) => c.d0), 400) + 160));
  // 2) Ойрын бүс: барилга, зам, талбай, мод, орц
  log(`OSM: ойрын бүс (R=${Math.round(R)} м)…`);
  const qNear = `[out:json][timeout:170];(
    way["building"](around:${R},${lat},${lng});
    way["highway"](around:${R + 150},${lat},${lng});
    way["leisure"~"^(park|playground|garden|pitch)$"](around:${R},${lat},${lng});
    way["landuse"~"^(grass|recreation_ground|village_green|meadow|forest)$"](around:${R},${lat},${lng});
    way["amenity"~"^(parking|school|kindergarten)$"](around:${R},${lat},${lng});
    node["natural"="tree"](around:${R},${lat},${lng});
    node["entrance"](around:200,${lat},${lng});
  );out body geom;`;
  const near = (await overpass(qNear)).elements || [];
  // 3) Алс бүс: гэр → Баруун 4 зам → хотын төв (томоохон барилга + гол зам)
  const pts = [[lat, lng], [WEST4.lat, WEST4.lng], [CENTER.lat, CENTER.lng]];
  const s = 0.0065, bb = [Math.min(...pts.map((p) => p[0])) - s, Math.min(...pts.map((p) => p[1])) - s * 1.5, Math.max(...pts.map((p) => p[0])) + s, Math.max(...pts.map((p) => p[1])) + s * 1.5].map((v) => v.toFixed(5)).join(',');
  log('OSM: алс бүс (хотын төв хүртэл)…');
  const qFar = `[out:json][timeout:170];(way["building"](${bb});way["highway"~"^(trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link)$"](${bb}););out body geom;`;
  const farRaw = (await overpass(qFar)).elements || [];

  // ---- Барилгууд ----
  // pool: бүх барилга (zn 0 = ойр, 1 = алс, 2 = R-ээс гадуурх Overture — зөвхөн нүдний барилгын талбайд, 3 = давхардал) → өндөр → гаралт
  const buildings = [], gers = [], far = [], pool = []; const seen = new Set();
  const addPoly = (p, t, zn, src, sid = null) => { // sid = эх сурвалжийн id (шинжилгээнд, гаралтад орохгүй)
    if (p.length > 1 && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < 0.01) p.pop();
    if (p.length < 3) return null; const A = Math.abs(area(p)); if (A < 6) return null; const [L, W, th] = dims(p); const [cx, cz] = centroid(p);
    // Гэр: жижиг, бөөрөнхий контур (OSM-д building=ger; ML контурт тэмдэггүй тул хэлбэрээр)
    let peri = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) peri += Math.hypot(p[i][0] - p[j][0], p[i][1] - p[j][1]);
    const round = (4 * Math.PI * A) / (peri * peri);
    const tt = !t.building && A < 50 && p.length >= 7 && round > 0.8 ? { ...t, building: 'ger' } : t;
    const q = { p, t: tt, A, L, W, th, D: A / Math.max(L, 1), cx, cz, zn, src, sid }; Object.assign(q, classify(q)); q.t = t;
    pool.push(q); return q;
  };
  const addBuilding = (w, zn) => {
    if (!w.geometry || w.geometry.length < 4 || seen.has(w.id)) return; seen.add(w.id);
    addPoly(w.geometry.map((g) => P.f(g.lat, g.lon)), w.tags || {}, zn, null, 'OSM w' + w.id);
  };
  const ovOsm = new Map(); // Overture доторх OSM way id → pool
  if (extBuildings && Array.isArray(extBuildings.features)) {
    // Overture Maps: OSM + ML контур (Microsoft, East Asian Buildings г.м. хиймэл дагуулын зургаас) — OSM-д ороогүй барилгууд ч багтана. R-ээс гадна = зөвхөн нүдний талбайн тооцоонд
    const CLS = { apartments: 'apartments', residential: 'residential', house: 'house', detached: 'house', garage: 'garage', garages: 'garage', shed: 'shed', barn: 'barn', roof: 'roof', ger: 'ger', school: 'school', kindergarten: 'kindergarten', university: 'university', college: 'college', commercial: 'commercial', retail: 'retail', supermarket: 'supermarket', office: 'office', industrial: 'industrial', warehouse: 'warehouse', hospital: 'hospital', hotel: 'hotel', service: 'service', hut: 'hut', church: 'church' };
    const osmT = new Map(); for (const e of near) if (e.type === 'way' && e.tags && e.tags.building) osmT.set(e.id, e.tags); // Overture-т алга OSM таг (amenity/shop/нэр/давхар)
    for (const f of extBuildings.features) {
      const g = f.geometry; if (!g) continue; const rings = g.type === 'Polygon' ? [g.coordinates[0]] : g.type === 'MultiPolygon' ? g.coordinates.map((c) => c[0]) : [];
      const pr = f.properties || {}; const t = {};
      if (pr.class && CLS[pr.class]) t.building = CLS[pr.class]; if (pr.subtype) t._sub = pr.subtype;
      if (pr.num_floors) t['building:levels'] = pr.num_floors; if (pr.height) t.height = pr.height;
      const nm = pr.names && (pr.names.primary || (pr.names.common && Object.values(pr.names.common)[0])); if (nm) t.name = nm;
      const sr = pr.sources || [], os = sr.find((x) => x.dataset === 'OpenStreetMap'); const src = sr.length && !os ? 'ml' : null; // OSM биш бүх эх сурвалж = ML
      const oid = os && /^w\d+/.test(os.record_id || '') ? parseInt(os.record_id.slice(1), 10) : null;
      const ot = oid && osmT.get(oid);
      if (ot) { // OSM-ийн эх таг: ангилалд хэрэгтэйг нь нэмнэ (building=yes бол Overture class хоосон хэвээр — гэрийн хэлбэрийн шалгалт хэвээр)
        for (const kk of ['amenity', 'shop', 'leisure', 'building:levels', 'height', 'addr:housenumber']) if (ot[kk] && !t[kk]) t[kk] = ot[kk];
        if (ot.name && !t.name) t.name = ot.name; if (!t.building && ot.building && ot.building !== 'yes') t.building = ot.building;
      }
      for (const ring of rings) { const p = ring.map(([lo, la]) => P.f(la, lo)); const [cx, cz] = centroid(p); const q = addPoly(p, t, Math.hypot(cx, cz) <= R ? 0 : 2, src, oid ? 'OSM w' + oid : sr.length ? sr[0].dataset : null); if (q && oid) ovOsm.set(oid, q); }
    }
  } else for (const e of near) if (e.type === 'way' && e.tags && e.tags.building) addBuilding(e, 0);
  for (const e of farRaw) if (e.type === 'way' && e.tags && e.tags.building) {
    const g = e.geometry && e.geometry[0]; if (!g) continue; const [x, z] = P.f(g.lat, g.lon); if (Math.hypot(x, z) <= R) continue;
    const m = ovOsm.get(e.id); if (m && m.zn === 0) continue; if (m) m.zn = 3; addBuilding(e, 1); // Overture-т байгаа бол давхар тоолохгүй
  }
  const nearB = pool.filter((q) => q.zn === 0 && q.k !== 'ger');
  // Гэрийн барилга: зүүг агуулсан, эсвэл 60 м доторх хамгийн ойр
  let hq = nearB.find((q) => inPoly(0, 0, q.p));
  if (!hq) { let bd = 60; for (const q of nearB) { const d = Math.hypot(q.cx, q.cz); if (d < bd) { bd = d; hq = q; } } }
  // homeLevels-гүй (server.js) үед: зөвхөн орон сууц/таггүй, ≥ 150 м² контурт ≥ 5 (объект нь орон сууцны байранд) — house/оффис/цэцэрлэг г.м. өөрийн утгаараа
  if (hq) { if (homeLevels) { hq.lv = homeLevels; hq.kn = 1; hq.slab = 0; hq.rule = 'гэрийн байр (өгөгдсөн)'; } else if (!hq.kn && (hq.cat === 'apt' || hq.cat === 'bld') && hq.A >= 150) hq.mn = 5; }
  // Оршин суугчийн засвар: цэгийг агуулсан (эсвэл 12 м доторх хамгийн ойр төвтэй) барилга → мэдэгдэж буй
  for (const o of overrides || []) {
    const [ox, oz] = Number.isFinite(o.x) ? [o.x, o.z] : P.f(o.lat, o.lng); let q = nearB.find((b) => inPoly(ox, oz, b.p));
    if (!q) { let bd = 12; for (const b of nearB) { const d = Math.hypot(b.cx - ox, b.cz - oz); if (d < bd) { bd = d; q = b; } } }
    if (!q) { log(`засвар: барилга олдсонгүй (${r1(ox)}, ${r1(oz)}) ${o.note || ''}`); continue; }
    if (o.lv > 0) { q.lv = o.lv; q.kn = 1; q.slab = 0; q.rule = 'засвар'; } if (o.k) q.k = o.k; if (o.rp) q.rp = o.rp; q.uc = 1; log(`засвар: (${r1(q.cx)}, ${r1(q.cz)}) → ${q.lv} давхар ${o.note || ''}`);
  }
  // ---- GHSL (EU JRC ANBH R2023A, ~100 м нүдний барилгын дундаж өндөр) — ӨГӨГДМӨЛӨӨР ДАВХАРТ НӨЛӨӨЛӨХГҮЙ ----
  // Шалгалт (2026-09-30, энэ байршил, мэдэгдэх давхартай барилгууд): ойрын бүсийн 5 давхар угсармал блок 7/7-ийн ANBH 15–20 м (≥ 14 → 9 болох байсан),
  // 9 давхар 17–22 м; 2 давхар цэцэрлэг (нүдийнхээ барилгын 76–84%-ийг эзэлдэг) 18–20 м; 1 давхар таглагдсан барилга ~21 м; гэр p50 11.9 м.
  // Нэг барилгын түвшинд 1/2/3 ба 5/9 давхрыг ялгахгүй тул давхрыг зөвхөн таг/хэлбэр/мэдэгдэх хөршөөр тогтооно.
  // ghslRules=true → туршилтын 2 дүрэм (угсармал: ANBH ≥ 14 → 9, ≤ 10 → 5; бусад таамаг: +1 давхар) — хөрш үнэлгээнд илүү олон хэтрүүлэлт өгсөн.
  // Түүвэр: 4 м торны цэгүүд → anbh = өөрийн талбайгаар жигнэсэн ANBH; cellAt байвал share = өөрийн талбай / тэдгээр нүдний нийт барилгын талбай (шинжилгээнд).
  const cells = new Map();
  if (heightAt && (ghslRules || debug)) {
    for (const q of pool) {
      if (q.zn === 3) continue;
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of q.p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      const st = Math.max(4, Math.sqrt(q.A / 1500)), cnt = new Map(); let n = 0, sv = 0, nv = 0;
      const put = (x, z) => {
        const ll = P.inv(x, z), v = heightAt(ll.lat, ll.lng); n++; if (Number.isFinite(v) && v > 0) { sv += v; nv++; }
        if (cellAt) { const r = cellAt(ll.lat, ll.lng); if (r != null) { const key = Array.isArray(r) ? r.join(',') : String(r); cnt.set(key, (cnt.get(key) || 0) + 1); } }
      };
      for (let x = x0 + st / 2; x < x1; x += st) for (let z = z0 + st / 2; z < z1; z += st) if (inPoly(x, z, q.p)) put(x, z);
      if (!n) put(q.cx, q.cz);
      q.anbh = nv ? sv / nv : null; if (cellAt) q.cells = [...cnt].map(([key, c]) => [key, (q.A * c) / n]);
    }
    if (cellAt) {
      for (const q of pool) for (const [key, a] of q.cells || []) cells.set(key, (cells.get(key) || 0) + a);
      for (const q of pool) if (q.cells && q.cells.length) { let own = 0, tot = 0; for (const [key, a] of q.cells) { own += a; tot += cells.get(key); } q.share = tot > 0 ? own / tot : null; }
    }
  }
  // ---- Угсармал блок (таамаг) ----
  // (1) Орон сууцны нотолгоо: building=apartments/residential/dormitory таг эсвэл нэр («…байр», хотхон, орон сууц), ЭСВЭЛ 150 м дотор мэдэгдэх ≥ 4 давхар орон сууц/таггүй барилга,
  //     ЭСВЭЛ 100 м дотор OSM apartments/residential тагтай барилга. Нотолгоогүй таггүй/ML контур → таггүй барилгын утга (alt, 1–2 давхар).
  // (2) Давхар: 100 м доторх ижил чигтэй (±15°) МЭДЭГДЭХ хамгийн ойр угсармал хөршийн давхар (≤ 9); алга бол 5.
  //     5-аас дээш өсгөхөд: 60 м дотор илүү нам МЭДЭГДЭХ орон сууц (хэлбэрээс үл хамааран) байвал түүний давхраас хэтрүүлэхгүй.
  // Мэдэгдэх 205 угсармал блок дээрх leave-one-out: 100 м + 60 м дүрэм 62% зөв, ≥3 давхраар хэтрүүлсэн 2 (150 м: 68% / 6; ойрын бүсэд 100 м: 58% / 1).
  const multiKnown = (o) => o.kn && o.zn < 3 && (o.cat === 'apt' || o.cat === 'bld') && o.lv >= 4; // мэдэгдэх олон давхар орон сууц/таггүй
  const knownSlabs = pool.filter((o) => multiKnown(o) && slabShape(o));
  const knownApt = pool.filter((o) => o.kn && o.zn < 3 && (o.cat === 'apt' || (o.cat === 'bld' && o.lv >= 4)));
  const resTagged = pool.filter((o) => o.zn < 3 && RES_B.has(o.t.building));
  const sameDir = (a, b) => { const d = Math.abs(a - b) % Math.PI; return Math.min(d, Math.PI - d) <= (15 * Math.PI) / 180; };
  const dd = (a, b) => Math.hypot(a.cx - b.cx, a.cz - b.cz);
  for (const q of pool) {
    if (!q.slab || q.kn || q.zn === 3) continue;
    if (!q.slabRes) {
      const ev = pool.find((o) => o !== q && multiKnown(o) && dd(o, q) <= 150) || resTagged.find((o) => o !== q && dd(o, q) <= 100);
      if (!ev) { q.slab = 0; q.lv = q.alt.lv; q.rule = q.alt.rule + ' (угсармал хэлбэр, орон сууцны нотолгоогүй)'; continue; }
      // гэр хороолол давамгай (100 м дотор ≥ 10 барилгын ≥ 50% нь гэр/house) → угсармал гэж үзэхгүй
      let nA = 0, nG = 0; for (const o of pool) if (o !== q && o.zn < 3 && dd(o, q) <= 100) { nA++; if (o.cat === 'ger' || o.cat === 'house') nG++; }
      if (nA >= 10 && nG >= 0.5 * nA) { q.slab = 0; q.lv = q.alt.lv; q.rule = q.alt.rule + ` (угсармал хэлбэр, гэр хороолол давамгай ${nG}/${nA})`; continue; }
      q.ev = ev;
    }
    const H = ghslRules ? q.anbh : null;
    if (H != null && H >= 14) { q.lv = 9; q.rule = `угсармал: GHSL ${H.toFixed(1)} м ≥ 14`; continue; }
    if (H != null && H <= 10) { q.lv = 5; q.rule = `угсармал: GHSL ${H.toFixed(1)} м ≤ 10`; continue; }
    let nb = null, bd = 100; for (const o of knownSlabs) { if (o === q || !sameDir(o.th, q.th)) continue; const d = dd(o, q); if (d < bd) { bd = d; nb = o; } }
    if (!nb) { q.lv = 5; q.rule = 'угсармал: 100 м дотор мэдэгдэх хөршгүй → 5'; continue; }
    q.nb = nb; q.lv = Math.min(EST_MAX, nb.lv); q.rule = `угсармал: мэдэгдэх хөрш ${nb.lv} давхар (${Math.round(bd)} м)`;
    if (q.lv > 5) for (const o of knownApt) if (o !== q && o !== nb && o.lv < q.lv && dd(o, q) <= 60) { q.lv = Math.max(5, o.lv); q.rule += ` → 60 м доторх мэдэгдэх ${o.lv} давхраас хэтрүүлэхгүй`; q.lo = o; }
  }
  // ---- АЛС БҮС (хотын төвийн дүр төрх), том таггүй барилга (A ≥ 350 м², таамаг bld/com, нарийн эгнээ/гараж биш) ----
  // Ойр орчны ТАГЛАГДСАН (building:levels/height) ижил хэмжээний (×2.5) орон сууцны биш барилгуудын ДООД ДӨРӨВНИЙ НЭГ (p25) — таглагдсан түүвэр
  // өндөр рүү хазайдаг тул медиан биш. 400 м дотор ≥ 5, эсвэл 1000 м дотор ≥ 8; үр дүнг [3, 6]-д хязгаарлана; хөрш алга бол 3.
  // Алс бүсийн таглагдсан 350+ м² барилга дээрх leave-one-out (bld 130 / com 91): энэ дүрэм ±1 давхар 32% / 34%, ≥3 давхраар хэтрүүлсэн 3 / 2;
  // тогтмол 2 — 26% / 22% (≥3 давхраар дутуу 80 / 61); хуучин тогтмол 5 — 33% / 25%, ≥3 давхраар хэтрүүлсэн 25 / 8; медиан (p50) — хэтрүүлсэн 24 / 13.
  // Ойрын бүсэд ХЭРЭГЛЭХГҮЙ: гэрийн орчмын таглагдсан барилга цөөн (400 м дотор ≤ 7), өндөр рүү хазайсан — туршихад гэрийн хажуугийн 21×19 м ML контур,
  // «Supermarket», зах, ресторан 5–7 давхар болсон (өмнөх шалгалтаар татгалзсан төрлийн алдаа). Ойрын бүс ангиллын болгоомжтой утгаараа (e:1).
  const TAGNB = new Set(['bld', 'com', 'ind', 'health']);
  const tagNb = pool.filter((o) => o.tg && o.zn < 3 && TAGNB.has(o.cat) && o.A >= 150);
  for (const q of pool) {
    if (q.kn || q.slab || q.zn !== 1 || q.A < 350 || !(q.cat === 'bld' || q.cat === 'com') || /гараж|нарийн/.test(q.rule)) continue;
    let pick = null;
    for (const [rr, nmin] of [[400, 5], [1000, 8]]) {
      const v = []; for (const o of tagNb) if (o.A >= q.A / 2.5 && o.A <= q.A * 2.5 && dd(o, q) <= rr) v.push(o.lv);
      if (v.length >= nmin) { v.sort((a, b) => a - b); pick = { lv: v[Math.floor((v.length - 1) / 4)], n: v.length, rr }; break; }
    }
    const lv = Math.max(q.lv, Math.min(6, Math.max(3, pick ? pick.lv : 3)));
    if (lv !== q.lv) { q.lv0 = q.lv; q.lv = lv; q.rule += pick ? ` → алс бүс: таглагдсан хөрш p25 ${pick.lv} (${pick.n}, ${pick.rr} м) → ${lv}` : ' → алс бүс: таглагдсан хөршгүй → 3'; }
  }
  if (ghslRules) for (const q of pool) { // туршилтын: угсармал биш таамаг +1, хэрэв өөрийн нүднүүдийн ANBH ≥ 1.8 × урьдчилсан өндөр ба тэдгээр нүдний барилгын талбайн ≥ 50%-ийг эзэлдэг
    if (q.kn || q.slab || q.zn === 3 || q.share == null || q.anbh == null || q.A < 60 || /гараж/.test(q.rule)) continue;
    if (q.share >= 0.5 && q.anbh >= 1.8 * q.lv * FLH && q.lv < EST_MAX) { q.lv += 1; q.rule += ` +1 (GHSL ${q.anbh.toFixed(1)} м, эзлэх ${Math.round(q.share * 100)}%)`; }
  }
  for (const q of pool) if (!q.kn) { if (q.mn && q.lv < q.mn) { q.lv = q.mn; q.rule += ' → гэрийн байр ≥ 5'; } q.lv = Math.min(EST_MAX, q.lv); }
  if (debug) { debug.cells = cells; debug.pool = pool; debug.home = hq; }
  // ---- Гаралт ----
  let home = null;
  for (const q of pool) {
    if (q.zn >= 2) continue;
    if (q.zn === 1) { if (q.A < 350 && q.lv < 5) continue; const fb = { p: flat(simplify(q.p, 1.6)), lv: q.lv }; if (!q.kn) fb.e = 1; far.push(fb); continue; }
    if (q.k === 'ger') { gers.push([r1(q.cx), r1(q.cz), r1(Math.max(2.2, Math.min(4.5, Math.sqrt(q.A / Math.PI))))]); continue; }
    const sp = simplify(q.p, 0.45); if (sp.length < 3) continue; const t = q.t;
    const b = { p: flat(sp), lv: q.lv, k: q.k }; if (t.name) b.n = String(t.name).slice(0, 40); if (t['addr:housenumber']) b.no = String(t['addr:housenumber']).slice(0, 10); if (q.src) b.s = q.src;
    if (!q.kn) b.e = 1; if (q.rp) b.rp = q.rp; if (q === hq) { b.t = 1; home = b; } // e = таамаг өндөр; rp = дээвэр дээрх (playground г.м.)
    // rf = 'flat': ≥ 300 м², 1–2 давхар, байшин/саравч/худалдаа/сургууль биш → хавтгай дээвэр (үзэгч одоогоор 1–2 давхар 'bld'-г байшин загвараар зурдаг)
    if (q.lv <= 2 && q.A >= 300 && !['house', 'shed', 'com', 'edu', 'ger'].includes(q.k)) b.rf = 'flat';
    b._poly = sp; b._c = [q.cx, q.cz]; buildings.push(b);
  }

  // ---- Замууд / талбайнууд / мод ----
  const roads = [], areas = [], trees = []; const allWays = [];
  const RK = (hw) => (['trunk', 'primary', 'secondary', 'trunk_link', 'primary_link', 'secondary_link'].includes(hw) ? 'major' : ['tertiary', 'tertiary_link'].includes(hw) ? 'mid' : ['residential', 'unclassified', 'living_street'].includes(hw) ? 'minor' : hw === 'service' ? 'service' : ['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'track', 'corridor', 'bridleway'].includes(hw) ? 'path' : null);
  const RW = { major: 15, mid: 10, minor: 6.5, service: 4.5, path: 2.2 };
  const roadSeen = new Set();
  const addRoad = (w, isFar) => {
    const hw = w.tags && w.tags.highway; const k = RK(hw); if (!k || !w.geometry || roadSeen.has(w.id)) return; roadSeen.add(w.id);
    if (isFar && k !== 'major' && k !== 'mid') return;
    const p = simplify(w.geometry.map((g) => P.f(g.lat, g.lon)), isFar ? 1.2 : 0.4);
    let wd = RW[k]; const lanes = parseInt(w.tags.lanes, 10); if (Number.isFinite(lanes) && k !== 'path') wd = Math.max(4, Math.min(28, lanes * 3.3 + 1.5));
    if (hw === 'pedestrian') wd = 5; if (w.tags.service === 'parking_aisle') wd = 4;
    const o = { p: flat(p), w: r1(wd), k }; if (w.tags.name && (k === 'major' || k === 'mid')) o.n = String(w.tags.name).slice(0, 40); if (w.tags.bridge === 'yes') o.br = 1;
    roads.push(o);
  };
  for (const e of near) {
    if (e.type === 'way' && e.tags && e.tags.highway) { allWays.push(e); addRoad(e, false); continue; }
    if (e.type === 'node' && e.tags && e.tags.natural === 'tree') { const [x, z] = P.f(e.lat, e.lon); trees.push(r1(x), r1(z)); continue; }
    if (e.type === 'way' && e.tags && !e.tags.building && e.geometry && e.geometry.length >= 4) {
      const t = e.tags; const k = t.leisure === 'playground' ? 'playground' : ['park', 'garden'].includes(t.leisure) ? 'park' : t.leisure === 'pitch' ? 'pitch' : t.amenity === 'parking' ? 'parking' : ['school', 'kindergarten'].includes(t.amenity) ? 'school' : t.landuse === 'forest' ? 'park' : t.landuse ? 'grass' : null;
      if (!k) continue; const p = simplify(e.geometry.map((g) => P.f(g.lat, g.lon)), 0.6); if (Math.abs(area(p)) < 20) continue; areas.push({ p: flat(p), k });
    }
  }
  for (const e of farRaw) if (e.type === 'way' && e.tags && e.tags.highway) { allWays.push(e); addRoad(e, true); }

  // ---- Орц (гэрийн байрны хаалга) ----
  let entrance = null;
  if (home) {
    const ent = near.filter((e) => e.type === 'node' && e.tags && e.tags.entrance).map((e) => P.f(e.lat, e.lon)).filter(([x, z]) => { const p = home._poly; for (let i = 0, j = p.length - 1; i < p.length; j = i++) if (segDist(x, z, p[j][0], p[j][1], p[i][0], p[i][1])[0] < 2) return true; return false; });
    if (ent.length) entrance = ent.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]))[0];
  }
  // ---- Алхах сүлжээ: орцноос бүх цэг рүү ----
  const walkG = graph(allWays, (t) => (WALK_OK(t.highway) ? 1 : 0), P);
  const conn = addConnectors(walkG, buildings.map((b) => b._poly), { within: R + 200 }); log(`алхах сүлжээ: ${walkG.size} цэг, хашааны холболт +${conn}`);
  let start = null;
  if (entrance) start = nearestNode(walkG, entrance[0], entrance[1], 150);
  if (!start && home) { // орц = байрны УРТ талын дунд (угсармал блокийн орцууд урт талдаа) — сүлжээнд ойр талыг сонгоно
    const p = home._poly; const [hx, hz] = home._c; let best = null;
    const edgesL = []; for (let i = 0, j = p.length - 1; i < p.length; j = i++) edgesL.push({ a: p[j], b: p[i], L: Math.hypot(p[i][0] - p[j][0], p[i][1] - p[j][1]) });
    edgesL.sort((u, v) => v.L - u.L);
    for (const e of edgesL.slice(0, 2)) {
      const mx = (e.a[0] + e.b[0]) / 2, mz = (e.a[1] + e.b[1]) / 2; const ox = mx - hx, oz = mz - hz, ol = Math.hypot(ox, oz) || 1;
      const q = [mx + (ox / ol) * 1.5, mz + (oz / ol) * 1.5]; const nn = nearestNode(walkG, q[0], q[1], 200);
      if (nn && (!best || nn.d < best.nn.d)) best = { nn, q };
    }
    if (best) { start = best.nn; entrance = best.q; }
  }
  if (!start) start = nearestNode(walkG, 0, 0, 400);
  if (!entrance) entrance = start ? [walkG.get(start.id).x, walkG.get(start.id).z] : [0, 0];
  const walk = start ? dijkstra(walkG, start.id) : null;
  const route = (x, z) => {
    if (!walk) return null; const nn = nearestNode(walkG, x, z, 220); if (!nn || !walk.len.has(nn.id)) return null;
    const pth = [entrance, ...pathTo(walkG, walk.prev, nn.id), [x, z]]; const lenM = walk.len.get(nn.id) + (start ? start.d : 0) + nn.d;
    return { p: flat(simplify(pth, 0.8)), m: Math.round(lenM), walkMin: Math.max(1, Math.round(lenM / WALK_MS / 60)) };
  };
  // ---- Цэгүүд: ангилал бүрээс сүлжээгээр хамгийн ойр ----
  const pois = [];
  for (const [cat, meta] of Object.entries(CAT)) {
    const list = cands.filter((c) => c.cat === cat).sort((a, b) => a.d0 - b.d0).slice(0, 6).map((c) => ({ c, r: route(c.x, c.z) })).filter((o) => o.r).sort((a, b) => a.r.m - b.r.m);
    const used = [];
    for (const { c, r } of list) {
      if (used.length >= meta.n) break; if (used.some((u) => Math.hypot(u.x - c.x, u.z - c.z) < 60 || (c.name && u.name === c.name))) continue;
      const o = { cat, mn: meta.mn, name: c.name || meta.mn, x: r1(c.x), z: r1(c.z), m: r.m, walkMin: r.walkMin, route: r.p }; used.push(o); pois.push(o);
    }
  }
  // ---- Төв зам: гол замын хамгийн ойр цэг (сүлжээгээр) ----
  let mainRoad = null;
  if (walk) {
    let best = null, best2 = null;
    for (const w of allWays) {
      const hw = w.tags.highway; if (!['trunk', 'primary', 'secondary'].includes(hw) || !w.nodes) continue;
      for (const id of w.nodes) { const l = walk.len.get(id); if (l == null) continue; const o = { l, id, name: w.tags.name || w.tags.ref || 'Гол зам', hw }; if (hw === 'secondary') { if (!best2 || l < best2.l) best2 = o; } else if (!best || l < best.l) best = o; }
    }
    if (!best || best.l > 1500) best = best2 || best;
    if (best) { const n = walkG.get(best.id); const r = route(n.x, n.z); if (r) { const ll = P.inv(n.x, n.z); mainRoad = { name: best.name, x: r1(n.x), z: r1(n.z), lat: +ll.lat.toFixed(6), lng: +ll.lng.toFixed(6), m: r.m, walkMin: r.walkMin, route: r.p }; } }
  }
  // ---- Жолоодох маршрут (OSM геометр): гэр → Баруун 4 зам → хотын төв ----
  const driveG = graph(allWays, (t) => DRIVE_W[t.highway] || 0, P);
  const dests = [];
  const ds = nearestNode(driveG, entrance[0], entrance[1], 400);
  if (ds) {
    const dj = dijkstra(driveG, ds.id);
    for (const D of [WEST4, CENTER]) {
      const [x, z] = P.f(D.lat, D.lng); const nn = nearestNode(driveG, x, z, 300);
      const o = { id: D.id, name: D.name, x: r1(x), z: r1(z), lat: D.lat, lng: D.lng };
      if (nn && dj.prev.has(nn.id)) { const pth = [entrance, ...pathTo(driveG, dj.prev, nn.id)]; o.route = flat(simplify(pth, 2)); o.km = Math.round((dj.len.get(nn.id) + ds.d) / 100) / 10; }
      dests.push(o);
    }
  }
  const study = commuteHours ? await computeStudy({ origin: { lat, lng }, entrance, mainRoad, dests }, { log }) : null;
  for (const b of buildings) { delete b._poly; delete b._c; }
  log(`бэлэн: барилга ${buildings.length} (+гэр ${gers.length}, алс ${far.length}), зам ${roads.length}, талбай ${areas.length}, цэг ${pois.length}`);
  return {
    v: 1, origin: { lat, lng }, R: Math.round(R), attribution: '© OpenStreetMap contributors (ODbL)',
    home: home ? { p: home.p, lv: home.lv, n: home.n || '', no: home.no || '' } : null, entrance: entrance.map(r1),
    buildings, gers, far, roads, areas, trees, pois, mainRoad, dests, study, generated_at: new Date().toISOString(),
  };
}

// ---- Цаг тус бүрийн хугацаа (Google Routes, ажлын өдөр): орцноос төв зам / Баруун 4 зам / хотын төв ----
// Бэлэн гадаах өгөгдөл дээр тусад нь ажиллуулж болно (жишээ нь түлхүүртэй сервер дээр).
async function computeStudy(ext, { log = () => {} } = {}) {
  if (!commute.hasKey() || !ext || !ext.origin || !ext.entrance) return null;
  log('Google Routes: цаг тус бүрийн түгжрэлийн хугацаа…');
  const P = projector(ext.origin.lat, ext.origin.lng); const mr = ext.mainRoad;
  const targets = [...(mr && mr.lat ? [{ id: 'main', name: mr.name, lat: mr.lat, lng: mr.lng }] : []), ...(ext.dests || []).map((d) => ({ id: d.id, name: d.name, lat: d.lat, lng: d.lng }))];
  const o = P.inv(ext.entrance[0], ext.entrance[1]); const rows = [];
  for (const tg of targets) {
    const row = { id: tg.id, name: tg.name, byHour: [] };
    for (let h = 6; h <= 23; h++) { try { const r = await commute.routeOnce(o, tg, commute.nextTuesdayAt(h, 0)); row.byHour.push(r ? [h, r.min, r.km, r.freeMin] : [h, null, null, null]); } catch (e) { row.byHour.push([h, null, null, null]); row.error = String(e.message).slice(0, 120); } }
    const ok = row.byHour.filter((b) => b[1] != null); if (ok.length) { row.free = Math.min(...ok.map((b) => b[1])); row.freeHour = ok.find((b) => b[1] === row.free)[0]; row.peak = Math.max(...ok.map((b) => b[1])); row.km = ok[0][2]; row.peakHour = ok.find((b) => b[1] === row.peak)[0]; } // free = хамгийн чөлөөтэй цагийн бодит хугацаа
    rows.push(row);
  }
  return { provider: commute.provider() === 'tomtom' ? 'TomTom Routing (түүхэн түгжрэл)' : 'Google Routes API (TRAFFIC_AWARE_OPTIMAL)', day: 'Ажлын өдөр (Мягмар)', rows, computed_at: new Date().toISOString() };
}

module.exports = { generate, computeStudy, WEST4, CENTER, CAT };
