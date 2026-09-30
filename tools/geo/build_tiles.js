// «Зууч» хотын хавтан сан — 500×500 м хавтан бүтээгч
// Хэрэглээ: node build_tiles.js <raw_dir> [out_dir=data/geo]
//   <raw_dir>/osm/{hw,area,poi}_*.json   Overpass (osm_fetch.js)
//   <raw_dir>/ov_b.ndjson                Overture барилга (export_overture.py)
//   <raw_dir>/poi_merged.json            нэгтгэсэн орчны цэг (poi_osm_city → poi_overture_city → poi_merge_city)
//   <raw_dir>/ghsl_city.json             GHSL өндөр (EU JRC)
// Гаралт: <out_dir>/index.json, <out_dir>/t/<i>_<j>.json.gz, <out_dir>/ghsl.json.gz
// Кодчлол: координат = round(град·1e6), мөр доторх дараагийн цэгүүд зөрөөгөөр; OSM цэгийн id — эхнийх бүтэн, дараагийнх зөрөө.
const fs = require('fs'); const path = require('path'); const zlib = require('zlib'); const readline = require('readline');
const RAW = process.argv[2]; const OUT = process.argv[3] || path.join(__dirname, '..', '..', 'data', 'geo');
const G = { lat0: 47.83, lng0: 106.64, dlat: 0.0045, dlng: 0.0067, bbox: [106.64, 47.83, 107.14, 48.01] };
const ti = (lng) => Math.floor((lng - G.lng0) / G.dlng), tj = (lat) => Math.floor((lat - G.lat0) / G.dlat);
const inBox = (lat, lng) => lng >= G.bbox[0] && lng < G.bbox[2] && lat >= G.bbox[1] && lat < G.bbox[3];
const Q = (v) => Math.round(v * 1e6);
const tiles = new Map(); const T = (k) => { let t = tiles.get(k); if (!t) { t = { w: [], n: [], p: [], b: [], x: [] }; tiles.set(k, t); } return t; };
// Хэрэггүй таг (орчуулгын нэр, эх сурвалж, тэмдэглэл) — хэмжээг багасгана
const keepTag = (k) => !/^(source|note|fixme|FIXME|created_by|description|wikidata|wikipedia|image|mapillary|check_date|survey)/.test(k) && (!k.startsWith('name:') || k === 'name:mn' || k === 'name:en') && !/^(old_name|alt_name|official_name):/.test(k);
const ftags = (t) => { if (!t) return undefined; const o = {}; for (const [k, v] of Object.entries(t)) if (keepTag(k)) o[k] = v; return Object.keys(o).length ? o : undefined; };
const encLine = (pts) => { const o = []; let a = 0, b = 0; pts.forEach(([la, lo], i) => { const x = Q(la), y = Q(lo); if (i) o.push(x - a, y - b); else o.push(x, y); a = x; b = y; }); return o; };
const encIds = (ids) => { const o = []; let p = 0; ids.forEach((v, i) => { o.push(i ? v - p : v); p = v; }); return o; };

function readOverpass(prefix) {
  const seen = new Map(); let files = 0;
  for (const f of fs.readdirSync(path.join(RAW, 'osm'))) {
    if (!f.startsWith(prefix + '_')) continue; files++;
    const j = JSON.parse(fs.readFileSync(path.join(RAW, 'osm', f), 'utf8'));
    for (const e of j.elements || []) seen.set(e.type[0] + e.id, e);
    if (j.osm3s && j.osm3s.timestamp_osm_base) G.osm_base = j.osm3s.timestamp_osm_base;
  }
  console.log(prefix, 'файл', files, 'элемент', seen.size);
  return [...seen.values()];
}

(async () => {
  // 1) OSM зам + талбай (way geom) + мод/орц (node)
  let nw = 0, nn = 0;
  for (const e of [...readOverpass('hw'), ...readOverpass('area')]) {
    if (e.type === 'way' && e.geometry && e.geometry.length >= 2) {
      const g = e.geometry.filter(Boolean); if (g.length < 2) continue;
      const rec = [e.id, ftags(e.tags) || {}, encIds(e.nodes || []), encLine(e.geometry.map((p) => (p ? [p.lat, p.lon] : [g[0].lat, g[0].lon])))];
      // Хэрчим бүрийн дайрсан хавтнууд (хагас хавтнаас бага алхмаар) — урт зам олон хавтанд давтагдана, ачаалахдаа id-аар нэгтгэнэ
      const keys = new Set();
      for (let s = 0; s < g.length; s++) {
        const a = g[s], b = g[Math.min(s + 1, g.length - 1)];
        const n = Math.max(1, Math.ceil(Math.max(Math.abs(b.lon - a.lon) / (G.dlng / 3), Math.abs(b.lat - a.lat) / (G.dlat / 3))));
        for (let k = 0; k <= n; k++) { const lo = a.lon + ((b.lon - a.lon) * k) / n, la = a.lat + ((b.lat - a.lat) * k) / n; if (inBox(la, lo)) keys.add(ti(lo) + '_' + tj(la)); }
      }
      for (const k of keys) T(k).w.push(rec);
      nw++;
    } else if (e.type === 'node' && Number.isFinite(e.lat) && inBox(e.lat, e.lon)) { T(ti(e.lon) + '_' + tj(e.lat)).n.push([e.id, Q(e.lat), Q(e.lon), ftags(e.tags) || {}]); nn++; }
  }
  // 2) OSM орчны цэг (out center tags)
  let np = 0;
  for (const e of readOverpass('poi')) {
    const c = e.type === 'node' ? e : e.center; if (!c || !Number.isFinite(c.lat) || !inBox(c.lat, c.lon)) continue;
    if (e.tags && (e.tags.highway && e.tags.highway !== 'bus_stop') && !e.tags.amenity && !e.tags.shop) continue; // нэртэй зам — орчны цэг биш (замыг hw-д хадгалсан)
    T(ti(c.lon) + '_' + tj(c.lat)).p.push([e.type[0], e.id, Q(c.lat), Q(c.lon), ftags(e.tags) || {}]); np++;
  }
  // 3) Overture барилга (эхний цагирагийн эхний цэгээр хавтан)
  // Дээврийн бодит өнгө (build_sat.py: Sentinel-2 10 м, ≥ 250 м² барилга) — холимог пикселийн хэт ханасан/хэт цайвар утгыг бодит хүрээнд шахна
  let RC = {}; try { RC = JSON.parse(fs.readFileSync(path.join(RAW, 'roof_colors.json'), 'utf8')); } catch { console.log('roof_colors.json алга — дээврийн өнгөгүй'); }
  const saneRoof = (hx) => {
    let r = parseInt(hx.slice(1, 3), 16) / 255, g = parseInt(hx.slice(3, 5), 16) / 255, b = parseInt(hx.slice(5, 7), 16) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let l = (mx + mn) / 2, s = mx === mn ? 0 : l > 0.5 ? (mx - mn) / (2 - mx - mn) : (mx - mn) / (mx + mn);
    let h = 0; if (mx !== mn) { const d = mx - mn; h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; }
    s = Math.min(s, l > 0.7 ? 0.12 : 0.42); l = Math.max(0.24, Math.min(0.8, l));
    const q2 = l < 0.5 ? l * (1 + s) : l + s - l * s, p2 = 2 * l - q2;
    const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p2 + (q2 - p2) * 6 * t : t < 0.5 ? q2 : t < 2 / 3 ? p2 + (q2 - p2) * (2 / 3 - t) * 6 : p2; };
    return '#' + [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
  };
  let nb = 0, nrc = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(RAW, 'ov_b.ndjson'), 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue; const b = JSON.parse(line); const p0 = b.r && b.r[0] && b.r[0][0]; if (!p0 || !inBox(p0[1], p0[0])) continue;
    const rec = { r: b.r.map((ring) => encLine(ring.map(([lo, la]) => [la, lo]))) };
    for (const k of ['c', 's', 'f', 'h', 'n', 'w', 'm']) if (b[k] != null) rec[k] = b[k];
    if (b.i && RC[b.i]) { rec.rc = saneRoof(RC[b.i]); nrc++; }
    T(ti(p0[0]) + '_' + tj(p0[1])).b.push(rec); nb++;
  }
  // 4) Нэгтгэсэн орчны цэг (extraPois)
  let nx = 0; const merged = JSON.parse(fs.readFileSync(path.join(RAW, 'poi_merged.json'), 'utf8'));
  for (const q of merged) {
    if (!inBox(q.lat, q.lng)) continue;
    const rec = { n: q.name || '', c: q.cat, a: Q(q.lat), o: Q(q.lng), s: q.src }; if (q.sub) rec.u = q.sub; if (q.verified) rec.v = 1; if (q.ids && q.ids.length) rec.i = q.ids;
    T(ti(q.lng) + '_' + tj(q.lat)).x.push(rec); nx++;
  }
  // 5) Бичих
  fs.mkdirSync(path.join(OUT, 't'), { recursive: true });
  const index = {}; let bytes = 0;
  for (const [k, t] of tiles) {
    if (!t.w.length && !t.b.length && !t.p.length && !t.x.length && !t.n.length) continue;
    const gz = zlib.gzipSync(JSON.stringify(t), { level: 9 }); fs.writeFileSync(path.join(OUT, 't', k + '.json.gz'), gz); bytes += gz.length;
    index[k] = [t.w.length, t.b.length, t.x.length];
  }
  const gh = zlib.gzipSync(fs.readFileSync(path.join(RAW, 'ghsl_city.json')), { level: 9 }); fs.writeFileSync(path.join(OUT, 'ghsl.json.gz'), gh);
  const meta = { v: 1, built_at: new Date().toISOString(), grid: G, tiles: index, counts: { ways: nw, nodes: nn, osm_pois: np, buildings: nb, roof_colors: nrc, pois: nx },
    sources: ['OpenStreetMap © contributors (ODbL-1.0) via Overpass API, osm_base ' + (G.osm_base || '?'), 'Overture Maps 2026-09-23.1: Buildings (ODbL-1.0, OSM + ML), Places (CDLA-Permissive-2.0), Base', 'GHS-BUILT-H ANBH E2018 R2023A (EU JRC, CC BY 4.0)', ...(nrc ? ['Contains modified Copernicus Sentinel data 2025 (Sentinel-2 L2A) — дээврийн өнгө', 'ESA WorldCover 2021 v200 (CC BY 4.0) — мод'] : [])] };
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(meta));
  console.log('хавтан', Object.keys(index).length, 'нийт', (bytes / 1048576).toFixed(1), 'MB gz + ghsl', (gh.length / 1024).toFixed(0), 'KB', JSON.stringify(meta.counts));
})().catch((e) => { console.error(e); process.exit(1); });
