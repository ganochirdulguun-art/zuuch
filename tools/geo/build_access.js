// «Зууч» хотын хавтан сан Ш2 — алхалтын хүртээмжийн сүлжээ (50 м нүд)
// Хэрэглээ: node build_access.js [geo_dir=data/geo]   (build_tiles.js-ийн дараа)
// Хотын бүх явган замын граф + ангилал бүрт олон эх үүсвэрт Dijkstra (бүх байгууллагаас зэрэг) → нүд бүрт хамгийн ойр байгууллага хүртэлх алхах зай (м) ба байгууллагын дугаар.
// Гаралт: <geo_dir>/access.bin.gz (нүд×ангилал: uint16 зай, uint16 байгууллага), <geo_dir>/access.json (сүлжээ, ангилал, байгууллагын жагсаалт)
const fs = require('fs'); const path = require('path'); const zlib = require('zlib');
const ex = require('../../exterior.js');
const DIR = process.argv[2] || path.join(__dirname, '..', '..', 'data', 'geo');
const I = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));
process.env.ZUUCH_GEO_DIR = DIR; const gs = require('../../geostore.js');
const CATS = ['kinder', 'school', 'health', 'pharmacy', 'grocery', 'mall', 'bus', 'park', 'playground', 'sport', 'bank', 'post', 'gov', 'college'];
const CAP = 3000;            // хамгийн их алхах зай (м) — түүнээс хол бол «алга»
const CELL = 50;             // нүдний хэмжээ (м)
const [W0, S0, E0, N0] = I.grid.bbox; const LAT0 = (S0 + N0) / 2, LNG0 = (W0 + E0) / 2;
const KX = Math.cos((LAT0 * Math.PI) / 180) * 111320, KZ = 110540;
const XY = (lat, lng) => [(lng - W0) * KX, (N0 - lat) * KZ]; // баруун-хойд булангаас метрээр
const NX = Math.ceil(((E0 - W0) * KX) / CELL), NY = Math.ceil(((N0 - S0) * KZ) / CELL);

// 1) Граф
const t0 = Date.now(); const ways = new Map(); const pois = new Map();
for (const key of Object.keys(I.tiles)) { const t = gs.tile(key); for (const w of t.ways) if (w.tags && ex.WALK_OK(w.tags.highway)) ways.set(w.id, w); for (const q of t.xp) pois.set(q.cat + '|' + q.lat + '|' + q.lng, q); }
const idx = new Map(); const X = [], Y = [], ADJ = [];
const nid = (id, g) => { let i = idx.get(id); if (i == null) { i = X.length; idx.set(id, i); const [x, y] = XY(g.lat, g.lon); X.push(x); Y.push(y); ADJ.push([]); } return i; };
for (const w of ways.values()) for (let k = 1; k < w.nodes.length; k++) { const a = nid(w.nodes[k - 1], w.geometry[k - 1]), b = nid(w.nodes[k], w.geometry[k]); const L = Math.hypot(X[a] - X[b], Y[a] - Y[b]); ADJ[a].push(b, L); ADJ[b].push(a, L); }
const N = X.length; console.log('граф: зам', ways.size, 'цэг', N, ((Date.now() - t0) / 1000).toFixed(1) + 'с');
// Цэгийн орон зайн хэш (100 м)
const H = new Map(); const hk = (x, y) => Math.floor(x / 100) * 100000 + Math.floor(y / 100);
for (let i = 0; i < N; i++) { const k = hk(X[i], Y[i]); let a = H.get(k); if (!a) H.set(k, (a = [])); a.push(i); }
function nearestNodes(x, y, R, max) { const out = []; const r = Math.ceil(R / 100); const cx = Math.floor(x / 100), cy = Math.floor(y / 100); for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (const i of H.get((cx + dx) * 100000 + cy + dy) || []) { const d = Math.hypot(X[i] - x, Y[i] - y); if (d <= R) out.push([d, i]); } out.sort((a, b) => a[0] - b[0]); return out.slice(0, max); }

// 2) Олон эх үүсвэрт Dijkstra (хоёртын овоо)
function dijkstra(sources) { // sources: [[node, d0, fac]]
  const dist = new Float64Array(N).fill(Infinity), fac = new Int32Array(N).fill(-1); // Float64: овооны зайтай яг тэнцүү байх (Float32 дугуйралт цэгийг «хуучирсан» гэж алгасуулдаг)
  const heap = []; const push = (d, i) => { heap.push([d, i]); let c = heap.length - 1; while (c) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
  for (const [i, d0, f] of sources) if (d0 < dist[i]) { dist[i] = d0; fac[i] = f; push(d0, i); }
  while (heap.length) { const [d, i] = pop(); if (d > dist[i] || d > CAP) continue; const A = ADJ[i]; for (let k = 0; k < A.length; k += 2) { const j = A[k], nd = d + A[k + 1]; if (nd < dist[j]) { dist[j] = nd; fac[j] = fac[i]; push(nd, j); } } }
  return { dist, fac };
}

// 3) Ангилал бүр → нүд бүр
const facilities = []; const catFac = {};
for (const q of pois.values()) { if (!CATS.includes(q.cat)) continue; (catFac[q.cat] = catFac[q.cat] || []).push(facilities.length); facilities.push(q); }
const cellNodes = new Array(NX * NY); // нүдний төвөөс 250 м доторх хамгийн ойр 3 цэг
for (let cy = 0; cy < NY; cy++) for (let cx = 0; cx < NX; cx++) { const nn = nearestNodes((cx + 0.5) * CELL, (cy + 0.5) * CELL, 250, 3); if (nn.length) cellNodes[cy * NX + cx] = nn; }
const buf = Buffer.alloc(NX * NY * CATS.length * 4); // [нүд][ангилал] → uint16 зай (65535 = алга), uint16 байгууллага (65535 = алга)
buf.fill(0xff);
CATS.forEach((cat, ci) => {
  const t1 = Date.now(); const src = [];
  for (const f of catFac[cat] || []) { const q = facilities[f]; const [x, y] = XY(q.lat, q.lng); for (const [d, i] of nearestNodes(x, y, 250, 3)) src.push([i, d, f]); }
  const { dist, fac } = dijkstra(src); let filled = 0;
  for (let c = 0; c < NX * NY; c++) {
    const nn = cellNodes[c]; if (!nn) continue; let bd = Infinity, bf = -1;
    for (const [d, i] of nn) { const v = dist[i] + d; if (v < bd) { bd = v; bf = fac[i]; } }
    if (bd <= CAP && bf >= 0) { const o = (c * CATS.length + ci) * 4; buf.writeUInt16LE(Math.round(bd), o); buf.writeUInt16LE(bf, o + 2); filled++; }
  }
  console.log(cat.padEnd(10), 'байгууллага', (catFac[cat] || []).length, 'нүд', filled, ((Date.now() - t1) / 1000).toFixed(1) + 'с');
});
fs.writeFileSync(path.join(DIR, 'access.bin.gz'), zlib.gzipSync(buf, { level: 9 }));
fs.writeFileSync(path.join(DIR, 'access.json'), JSON.stringify({ v: 1, built_at: new Date().toISOString(), cell: CELL, cap: CAP, nx: NX, ny: NY, bbox: [W0, S0, E0, N0], kx: KX, kz: KZ, cats: CATS,
  facilities: facilities.map((q) => [q.name || '', q.cat, Math.round(q.lat * 1e6) / 1e6, Math.round(q.lng * 1e6) / 1e6, q.verified ? 1 : 0]) }));
console.log('нүд', NX, '×', NY, '→', (fs.statSync(path.join(DIR, 'access.bin.gz')).size / 1048576).toFixed(1), 'MB gz', ((Date.now() - t0) / 1000).toFixed(0) + 'с');
