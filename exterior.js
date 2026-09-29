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
function dims(p) { // гол тэнхлэгээр урт/өргөн (PCA)
  const [cx, cz] = centroid(p); let sxx = 0, szz = 0, sxz = 0; for (const [x, z] of p) { sxx += (x - cx) ** 2; szz += (z - cz) ** 2; sxz += (x - cx) * (z - cz); }
  const th = 0.5 * Math.atan2(2 * sxz, sxx - szz), ux = Math.cos(th), uz = Math.sin(th); let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const [x, z] of p) { const a = (x - cx) * ux + (z - cz) * uz, b = -(x - cx) * uz + (z - cz) * ux; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
  const L = a1 - a0, W = b1 - b0; return L >= W ? [L, W] : [W, L];
}
const flat = (pts) => pts.flatMap(([x, z]) => [r1(x), r1(z)]);

// ---------- Барилгын төрөл ба давхар (OSM-д давхар ховор бичигддэг тул хэлбэр/талбайгаар тооцно) ----------
function classify(t, A, L, W, anbh = null) {
  const b = t.building || 'yes', am = t.amenity || '';
  const lvTag = parseFloat(t['building:levels']); const hTag = parseFloat(String(t.height || '').replace(/[^0-9.]/g, ''));
  let k = 'bld';
  if (b === 'ger' || b === 'yurt') k = 'ger';
  else if (['house', 'detached', 'hut', 'cabin', 'bungalow', 'semidetached_house'].includes(b)) k = 'house';
  else if (['garage', 'garages', 'shed', 'barn', 'service', 'roof', 'kiosk', 'container', 'carport', 'hangar', 'shelter', 'toilets', 'transformer_tower'].includes(b)) k = 'shed';
  else if (['school', 'kindergarten', 'university', 'college'].includes(b) || ['school', 'kindergarten', 'university', 'college'].includes(am)) k = 'edu';
  else if (['commercial', 'retail', 'office', 'supermarket', 'mall', 'hotel', 'industrial', 'warehouse', 'hospital', 'public', 'civic', 'government'].includes(b)) k = 'com';
  else if (['apartments', 'residential', 'dormitory'].includes(b)) k = 'apt';
  let lv;
  if (Number.isFinite(lvTag) && lvTag > 0) lv = Math.min(60, lvTag);
  else if (Number.isFinite(hTag) && hTag > 2) lv = Math.max(1, Math.round(hTag / 3));
  else if (k === 'ger') lv = 1;
  else if (k === 'shed') lv = 1;
  else if (k === 'house') lv = A > 130 ? 2 : 1;
  else if (k === 'edu') lv = A > 700 ? 4 : 3;
  else if (k === 'com') lv = A > 2500 ? 5 : A > 800 ? 3 : 2;
  else {
    // «yes»/apt: угсармал блок (гүн 10–17 м, урт ≥ 36 м) → 9; том талбай → 5; жижиг → 1–2
    // anbh = GHSL (EU JRC, Sentinel хиймэл дагуулаар) 100 м торны барилгын дундаж өндөр, м
    const H = Number.isFinite(anbh) && anbh > 0 ? anbh : null;
    if (W >= 9 && W <= 17.5 && L >= 36) lv = H == null ? (L >= 70 ? 9 : 5) : H >= 12.5 ? 9 : 5;
    else if (A < 60) lv = 1; else if (A < 150) lv = H != null && H < 7 ? 1 : 2;
    else if (A < 350) lv = H == null ? 3 : Math.max(2, Math.min(9, Math.round(H / 3.2)));
    else lv = H == null ? 5 : Math.max(3, Math.min(16, Math.round(H / 3)));
    if (k === 'apt' && lv < 5) lv = 5;
  }
  return { k, lv };
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
async function generate(lat, lng, { commuteHours = true, log = () => {}, buildings: extBuildings = null, heightAt = null, homeLevels = null } = {}) {
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
  const buildings = [], gers = [], far = []; const seen = new Set();
  const anbhAt = (x, z) => { if (!heightAt) return null; const ll = P.inv(x, z); const v = heightAt(ll.lat, ll.lng); return Number.isFinite(v) ? v : null; };
  const addPoly = (p, t, isNear, src) => {
    if (p.length > 1 && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < 0.01) p.pop();
    if (p.length < 3) return; const A = Math.abs(area(p)); if (A < 6) return; const [L, W] = dims(p); const [cx, cz] = centroid(p);
    // Гэр: жижиг, бөөрөнхий контур (OSM-д building=ger; ML контурт тэмдэггүй тул хэлбэрээр)
    let peri = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) peri += Math.hypot(p[i][0] - p[j][0], p[i][1] - p[j][1]);
    const round = (4 * Math.PI * A) / (peri * peri);
    const tt = !t.building && A < 50 && p.length >= 7 && round > 0.8 ? { ...t, building: 'ger' } : t;
    const { k, lv } = classify(tt, A, L, W, anbhAt(cx, cz));
    if (!isNear) { if (A < 450 && lv < 5) return; far.push({ p: flat(simplify(p, 1.6)), lv }); return; }
    if (k === 'ger') { gers.push([r1(cx), r1(cz), r1(Math.max(2.2, Math.min(4.5, Math.sqrt(A / Math.PI))))]); return; }
    const sp = simplify(p, 0.45); if (sp.length < 3) return;
    const b = { p: flat(sp), lv, k }; if (t.name) b.n = String(t.name).slice(0, 40); if (t['addr:housenumber']) b.no = String(t['addr:housenumber']).slice(0, 10); if (src) b.s = src;
    b._poly = sp; b._c = [cx, cz]; buildings.push(b);
  };
  const addBuilding = (w, isNear) => {
    if (!w.geometry || w.geometry.length < 4 || seen.has(w.id)) return; seen.add(w.id);
    addPoly(w.geometry.map((g) => P.f(g.lat, g.lon)), w.tags || {}, isNear, null);
  };
  if (extBuildings && Array.isArray(extBuildings.features)) {
    // Overture Maps: OSM + Microsoft ML Buildings (хиймэл дагуулын шинэ зургаас) — OSM-д ороогүй шинэ барилгууд ч багтана
    const CLS = { apartments: 'apartments', residential: 'residential', house: 'house', detached: 'house', garage: 'garage', garages: 'garage', shed: 'shed', school: 'school', kindergarten: 'kindergarten', university: 'university', college: 'college', commercial: 'commercial', retail: 'retail', office: 'office', industrial: 'industrial', warehouse: 'warehouse', hospital: 'hospital', hotel: 'hotel', service: 'service', hut: 'hut' };
    for (const f of extBuildings.features) {
      const g = f.geometry; if (!g) continue; const rings = g.type === 'Polygon' ? [g.coordinates[0]] : g.type === 'MultiPolygon' ? g.coordinates.map((c) => c[0]) : [];
      const pr = f.properties || {}; const t = {};
      if (pr.class && CLS[pr.class]) t.building = CLS[pr.class];
      if (pr.num_floors) t['building:levels'] = pr.num_floors; if (pr.height) t.height = pr.height;
      const nm = pr.names && (pr.names.primary || (pr.names.common && Object.values(pr.names.common)[0])); if (nm) t.name = nm;
      const src = (pr.sources || []).map((s) => s.dataset).includes('Microsoft ML Buildings') ? 'ml' : null;
      for (const ring of rings) { const p = ring.map(([lo, la]) => P.f(la, lo)); const [cx, cz] = centroid(p); if (Math.hypot(cx, cz) <= R) addPoly(p, t, true, src); }
    }
  } else for (const e of near) if (e.type === 'way' && e.tags && e.tags.building) addBuilding(e, true);
  for (const e of farRaw) if (e.type === 'way' && e.tags && e.tags.building) { const g = e.geometry && e.geometry[0]; if (!g) continue; const [x, z] = P.f(g.lat, g.lon); if (Math.hypot(x, z) > R) addBuilding(e, false); }
  // Гэрийн барилга: зүүг агуулсан, эсвэл 60 м доторх хамгийн ойр
  let home = buildings.find((b) => inPoly(0, 0, b._poly));
  if (!home) { let bd = 60; for (const b of buildings) { const d = Math.hypot(b._c[0], b._c[1]); if (d < bd) { bd = d; home = b; } } }
  if (home) { home.t = 1; if (homeLevels) home.lv = homeLevels; else if (home.k === 'bld' || home.k === 'apt') home.lv = Math.max(home.lv, 5); }

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
    const ok = row.byHour.filter((b) => b[1] != null); if (ok.length) { row.free = Math.min(...ok.map((b) => b[3] || b[1])); row.peak = Math.max(...ok.map((b) => b[1])); row.km = ok[0][2]; row.peakHour = ok.find((b) => b[1] === row.peak)[0]; }
    rows.push(row);
  }
  return { provider: commute.provider() === 'tomtom' ? 'TomTom Routing (түүхэн түгжрэл)' : 'Google Routes API (TRAFFIC_AWARE_OPTIMAL)', day: 'Ажлын өдөр (Мягмар)', rows, computed_at: new Date().toISOString() };
}

module.exports = { generate, computeStudy, WEST4, CENTER, CAT };
