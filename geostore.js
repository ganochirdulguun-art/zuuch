// «Зууч» — хотын 500×500 м хавтан сан (data/geo): гадаах орчны 3D-ийн өгөгдлийг Overpass-гүйгээр, өндөр чанартай (Overture контур + GHSL + нэгтгэсэн орчны цэг)
// exterior.generate-ийн 4 OSM асуулгыг (орчны цэг / ойрын бүс / алс бүс / алхах сүлжээ) ижил утгаар орлуулна.
const fs = require('fs'); const path = require('path'); const zlib = require('zlib');
const DIR = process.env.ZUUCH_GEO_DIR || path.join(__dirname, 'data', 'geo');
let INDEX = null, GHSL = null;
function index() { if (INDEX === null) { try { INDEX = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8')); } catch { INDEX = false; } } return INDEX; }
function ghsl() { if (GHSL === null) { try { GHSL = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(DIR, 'ghsl.json.gz'))).toString('utf8')); } catch { GHSL = false; } } return GHSL; }
function covers(lat, lng) { const I = index(); if (!I) return false; const b = I.grid.bbox; return lng >= b[0] + 0.02 && lng < b[2] - 0.02 && lat >= b[1] + 0.015 && lat < b[3] - 0.015; }

// ---- Хавтан ачаалах (LRU) + задлах ----
const cache = new Map(); const CACHE_MAX = 600;
const decLine = (a) => { const o = []; let x = 0, y = 0; for (let i = 0; i < a.length; i += 2) { x = i ? x + a[i] : a[i]; y = i ? y + a[i + 1] : a[i + 1]; o.push([x / 1e6, y / 1e6]); } return o; };
const decIds = (a) => { const o = []; let p = 0; a.forEach((v, i) => { p = i ? p + v : v; o.push(p); }); return o; };
function tile(key) {
  if (cache.has(key)) { const t = cache.get(key); cache.delete(key); cache.set(key, t); return t; }
  const I = index(); if (!I || !I.tiles[key]) return null;
  const raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(DIR, 't', key + '.json.gz'))).toString('utf8'));
  const t = {
    ways: raw.w.map(([id, tags, nodes, line]) => ({ type: 'way', id, tags, nodes: decIds(nodes), geometry: decLine(line).map(([lat, lon]) => ({ lat, lon })) })),
    nodes: raw.n.map(([id, a, o, tags]) => ({ type: 'node', id, lat: a / 1e6, lon: o / 1e6, tags })),
    pois: raw.p.map(([ty, id, a, o, tags]) => { const type = { n: 'node', w: 'way', r: 'relation' }[ty]; return type === 'node' ? { type, id, lat: a / 1e6, lon: o / 1e6, tags } : { type, id, center: { lat: a / 1e6, lon: o / 1e6 }, tags }; }),
    blds: raw.b.map((b) => ({ rings: b.r.map((r) => decLine(r).map(([la, lo]) => [lo, la])), c: b.c, s: b.s, f: b.f, h: b.h, n: b.n, w: b.w, m: b.m })),
    xp: raw.x.map((q) => ({ name: q.n, cat: q.c, lat: q.a / 1e6, lng: q.o / 1e6, src: q.s, sub: q.u, verified: !!q.v, ids: q.i || [] })),
  };
  cache.set(key, t); if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return t;
}
function tilesAround(lat, lng, R) {
  const G = index().grid; const dLat = R / 110540 + G.dlat, dLng = R / (111320 * Math.cos((lat * Math.PI) / 180)) + G.dlng;
  const i0 = Math.floor((lng - dLng - G.lng0) / G.dlng), i1 = Math.floor((lng + dLng - G.lng0) / G.dlng), j0 = Math.floor((lat - dLat - G.lat0) / G.dlat), j1 = Math.floor((lat + dLat - G.lat0) / G.dlat);
  const out = []; for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const t = tile(i + '_' + j); if (t) out.push(t); } return out;
}
function tilesInBox(s, w, n, e) {
  const G = index().grid; const out = [];
  for (let i = Math.floor((w - G.lng0) / G.dlng); i <= Math.floor((e - G.lng0) / G.dlng); i++) for (let j = Math.floor((s - G.lat0) / G.dlat); j <= Math.floor((n - G.lat0) / G.dlat); j++) { const t = tile(i + '_' + j); if (t) out.push(t); }
  return out;
}

// ---- Overpass-ийн «around» утга: цэг/хэрчмийн зай (метрээр, орон нутгийн хавтгай) ----
function meter(lat0, lng0) { const kx = Math.cos((lat0 * Math.PI) / 180) * 111320, kz = 110540; return (lat, lng) => [(lng - lng0) * kx, (lat0 - lat) * kz]; }
function segDist(px, pz, ax, az, bx, bz) { const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz; let t = L ? ((px - ax) * dx + (pz - az) * dz) / L : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - (ax + t * dx), pz - (az + t * dz)); }
function wayWithin(w, M, R) { const g = w.geometry; let prev = null; for (const p of g) { const [x, z] = M(p.lat, p.lon); if (Math.hypot(x, z) <= R) return true; if (prev && segDist(0, 0, prev[0], prev[1], x, z) <= R) return true; prev = [x, z]; } return false; }
const uniq = (arr) => { const m = new Map(); for (const e of arr) m.set(e.type + e.id, e); return [...m.values()]; };

// exterior.generate qPoi-ийн тагийн шүүлтүүр (ижил)
const NAME_RE = /[Цц]эцэрлэг|[Сс]ургууль|[Ээ]мнэлэг|[Кк]линик|ӨЭМТ|[Хх]ороо|ХОРОО|[Ии]х [Дд]элгүүр|[Хх]удалдааны төв|[Пп]лаза|[Зз]ах|[Бб]анк|[Шш]уудан|[Цц]агдаа/;
function poiMatch(e, d, reach, reach2) {
  const t = e.tags || {};
  if (d <= reach) {
    if (/^(school|kindergarten|university|college|parking|pharmacy|hospital|clinic|doctors|dentist|marketplace|bank|post_office|police|townhall|community_centre)$/.test(t.amenity || '')) return true;
    if (/^(hospital|clinic|doctor|dentist|centre|pharmacy)$/.test(t.healthcare || '')) return true;
    if (t.office === 'government') return true;
    if (/^(mall|supermarket|department_store|convenience|greengrocer|butcher|bakery|general|food)$/.test(t.shop || '')) return true;
    if (e.type !== 'node' && /^(school|kindergarten|university|college|hospital|clinic)$/.test(t.building || '')) return true;
    if (e.type !== 'node' && t.building && NAME_RE.test(t.name || '')) return true;
  }
  if (d <= reach2) {
    if (/^(park|playground|garden|pitch|sports_centre|fitness_centre|sports_hall|stadium)$/.test(t.leisure || '')) return true;
    if (t.highway === 'bus_stop') return true;
  }
  return false;
}
const CLS = (c) => c || 'yes';

// generate(lat, lng, { ...options(lat, lng) }) — хавтан сангаас бүх оролт
function options(lat, lng) {
  const M = meter(lat, lng);
  const bldFeature = (b) => ({ type: 'Feature', geometry: b.rings.length > 1 ? { type: 'MultiPolygon', coordinates: b.rings.map((r) => [r]) } : { type: 'Polygon', coordinates: [b.rings[0]] },
    properties: { class: b.c || null, subtype: b.s || null, num_floors: b.f || null, height: b.h || null, names: b.n ? { primary: b.n } : null, sources: b.w ? [{ dataset: 'OpenStreetMap', record_id: 'w' + b.w }] : b.m ? [{ dataset: 'ml' }] : [] } });
  const bldNear = (R) => { const out = []; const seen = new Set(); for (const t of tilesAround(lat, lng, R + 60)) for (const b of t.blds) { const [lo, la] = b.rings[0][0]; const [x, z] = M(la, lo); if (Math.hypot(x, z) > R + 40) continue; const k = b.w || lo + ',' + la; if (seen.has(k)) continue; seen.add(k); out.push(b); } return out; };
  const osm = {
    poi(reach, reach2) {
      const out = []; for (const t of tilesAround(lat, lng, Math.max(reach, reach2))) for (const e of t.pois) { const c = e.center || e; const [x, z] = M(c.lat, c.lon); if (poiMatch(e, Math.hypot(x, z), reach, reach2)) out.push(e); }
      return uniq(out);
    },
    near(R) {
      const out = []; const ts = tilesAround(lat, lng, R + 150);
      for (const t of ts) {
        for (const w of t.ways) { const tg = w.tags || {}; if (tg.highway ? wayWithin(w, M, R + 150) : ((/^(park|playground|garden|pitch)$/.test(tg.leisure || '') || /^(grass|recreation_ground|village_green|meadow|forest)$/.test(tg.landuse || '') || /^(parking|school|kindergarten)$/.test(tg.amenity || '')) && wayWithin(w, M, R))) out.push(w); }
        for (const n of t.nodes) { const [x, z] = M(n.lat, n.lon); const d = Math.hypot(x, z); const tg = n.tags || {}; if ((tg.natural === 'tree' && d <= R) || (tg.entrance && d <= 200)) out.push(n); }
      }
      // OSM барилгын таг (Overture-т OSM way id-тай) — generate зөвхөн тагийн нэмэлтэд ашиглана
      for (const b of bldNear(R)) if (b.w) out.push({ type: 'way', id: b.w, tags: { building: CLS(b.c), ...(b.n ? { name: b.n } : {}), ...(b.f ? { 'building:levels': String(b.f) } : {}) }, geometry: b.rings[0].map(([lo, la]) => ({ lat: la, lon: lo })) });
      return uniq(out);
    },
    far(s, w, n, e) {
      const out = []; const seen = new Set();
      for (const t of tilesInBox(s, w, n, e)) {
        for (const wy of t.ways) { if (/^(trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link)$/.test((wy.tags || {}).highway || '') && !seen.has('w' + wy.id)) { seen.add('w' + wy.id); out.push(wy); } }
        // Алс бүсийн барилга = OSM-ийн барилга (Overture-т OSM way id-тай нь) — ML контур алс бүсэд орохгүй (Overpass-тай ижил)
        for (const b of t.blds) { if (!b.w || seen.has('b' + b.w)) continue; const [lo, la] = b.rings[0][0]; if (la < s || la > n || lo < w || lo > e) continue; seen.add('b' + b.w); out.push({ type: 'way', id: b.w, tags: { building: CLS(b.c), ...(b.f ? { 'building:levels': String(b.f) } : {}) }, geometry: b.rings[0].map(([x, y]) => ({ lat: y, lon: x })) }); }
      }
      return out;
    },
    walk(dist) { const out = []; for (const t of tilesAround(lat, lng, dist)) for (const w of t.ways) if (w.tags && w.tags.highway && wayWithin(w, M, dist)) out.push(w); return uniq(out); },
  };
  // Overture барилга: ойрын ~1.7 км (gen_home-ийн ov_near-тэй адил) + footprint (маршрутын барилгын хана) ~2.3 км
  const near = bldNear(1700).map(bldFeature);
  const foot = bldNear(2300).map(bldFeature);
  const extraPois = []; const sx = new Set();
  for (const t of tilesAround(lat, lng, 2300)) for (const q of t.xp) { const k = q.cat + '|' + q.lat + '|' + q.lng; if (sx.has(k)) continue; sx.add(k); const [x, z] = M(q.lat, q.lng); if (Math.hypot(x, z) <= 2300) extraPois.push(q); }
  // Оршин суугч/агентын баталсан засвар (давхар, төрөл, дээврийн тоглоомын талбай) — координатаар, 1.7 км дотор
  let overrides = []; try { overrides = JSON.parse(fs.readFileSync(path.join(DIR, 'overrides.json'), 'utf8')).filter((o) => { const [x, z] = M(o.lat, o.lng); return Math.hypot(x, z) <= 1700; }); } catch { /* засваргүй */ }
  const Gh = ghsl();
  const cr = (la, lo) => { if (!Gh) return null; const c = Math.floor((lo - Gh.x0) / Gh.sc) - Gh.c0, r = Math.floor((Gh.y0 - la) / Gh.sc) - Gh.r0; return c < 0 || r < 0 || c >= Gh.w || r >= Gh.h ? null : [c, r]; };
  return {
    osm, buildings: { type: 'FeatureCollection', features: near }, footprints: { type: 'FeatureCollection', features: foot }, extraPois, overrides,
    heightAt: Gh ? (la, lo) => { const q = cr(la, lo); return q ? Gh.v[q[1] * Gh.w + q[0]] : null; } : null,
    cellAt: Gh ? (la, lo) => cr(la, lo) : null,
  };
}
function info() { const I = index(); return I ? { built_at: I.built_at, tiles: Object.keys(I.tiles).length, counts: I.counts, sources: I.sources, bbox: I.grid.bbox } : null; }

// ---- Ш2: алхалтын хүртээмж (50 м нүд, build_access.js) — хотын аль ч цэгт ангилал бүрийн хамгийн ойр байгууллага хүртэлх алхах зай ----
let ACC = null;
function accessData() { if (ACC === null) { try { const m = JSON.parse(fs.readFileSync(path.join(DIR, 'access.json'), 'utf8')); m.buf = zlib.gunzipSync(fs.readFileSync(path.join(DIR, 'access.bin.gz'))); ACC = m; } catch { ACC = false; } } return ACC; }
const WALK_MPM = 75; // алхах хурд ≈ 4.5 км/ц
function access(lat, lng) {
  const A = accessData(); if (!A) return null;
  const x = (lng - A.bbox[0]) * A.kx, y = (A.bbox[3] - lat) * A.kz; const cx = Math.floor(x / A.cell), cy = Math.floor(y / A.cell);
  if (cx < 0 || cy < 0 || cx >= A.nx || cy >= A.ny) return null;
  const out = {}; const c = cy * A.nx + cx;
  A.cats.forEach((cat, ci) => {
    const o = (c * A.cats.length + ci) * 4; const d = A.buf.readUInt16LE(o), f = A.buf.readUInt16LE(o + 2);
    out[cat] = d === 0xffff || f === 0xffff ? null : { m: d, min: Math.max(1, Math.round(d / WALK_MPM)), name: A.facilities[f][0], lat: A.facilities[f][2], lng: A.facilities[f][3], verified: !!A.facilities[f][4] };
  });
  // Алхалтын оноо (0–100): өдөр тутмын 8 хэрэгцээ, 400 м дотор бүтэн, 1600 м-ээс хол 0
  const W = { grocery: 1.5, bus: 1.5, kinder: 1.2, school: 1.2, pharmacy: 1, health: 1, park: 0.8, playground: 0.8 };
  let s = 0, ws = 0; for (const [k, w] of Object.entries(W)) { ws += w; const v = out[k]; if (v) s += w * Math.max(0, Math.min(1, (1600 - v.m) / 1200)); }
  return { cats: out, score: Math.round((100 * s) / ws), cell: A.cell, built_at: A.built_at };
}
module.exports = { covers, options, info, tile, index, access };
