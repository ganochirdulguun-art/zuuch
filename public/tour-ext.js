// «Зууч» — Гадаах орчны 3D нислэгийн аялал (Ш3д-3): бодит газрын зураг (OpenStreetMap + Overture/Microsoft ML барилга + GHSL өндөр)
// дээр тэнгэрээс бууж, орчны цэг бүр рүү бодит алхах замаар нисэж, Баруун 4 зам / хотын төв рүү өндрөөс нисэн, эцэст нь орцоор орно.
import * as THREE from 'three';

const $ = (s) => document.querySelector(s);
const CAT = {
  grocery: { c: '#22c55e', ic: 'shopping-cart', mn: 'Хүнсний дэлгүүр' }, pharmacy: { c: '#06b6d4', ic: 'pill', mn: 'Эмийн сан' },
  health: { c: '#ef4444', ic: 'hospital', mn: 'Эмнэлэг' }, parking: { c: '#6366f1', ic: 'square-parking', mn: 'Авто зогсоол' },
  playground: { c: '#f59e0b', ic: 'ferris-wheel', mn: 'Хүүхдийн тоглоомын талбай' }, park: { c: '#16a34a', ic: 'trees', mn: 'Ногоон байгууламж' },
  sport: { c: '#10b981', ic: 'dumbbell', mn: 'Спорт талбай' }, kinder: { c: '#fb923c', ic: 'baby', mn: 'Цэцэрлэг' },
  school: { c: '#eab308', ic: 'school', mn: 'Ерөнхий боловсролын сургууль' }, college: { c: '#a16207', ic: 'graduation-cap', mn: 'Их, дээд сургууль' },
  bus: { c: '#d946ef', ic: 'bus', mn: 'Автобусны буудал' }, mall: { c: '#8b5cf6', ic: 'store', mn: 'Худалдаа, үйлчилгээний төв' },
  main: { c: '#f43f5e', ic: 'route', mn: 'Төв зам' }, west4: { c: '#38bdf8', ic: 'navigation', mn: 'Баруун 4 зам' }, center: { c: '#0ea5e9', ic: 'landmark', mn: 'Хотын төв' },
  home: { c: '#fb7185', ic: 'house', mn: 'Таны байр' },
};
const FLY_ORDER = ['grocery', 'pharmacy', 'health', 'parking', 'playground', 'park', 'sport', 'kinder', 'school', 'bus', 'mall'];
const ic = (n) => `<svg class="ic" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pairs = (p) => { const o = []; for (let i = 0; i < p.length; i += 2) o.push([p[i], p[i + 1]]); return o; };
const hash = (n) => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * x));
const smooth5 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * x * (x * (x * 6 - 15) + 10));
const fmtM = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} км` : `${Math.round(m / 10) * 10} м`);

// ---------- Геометр угсрагч (олон барилгыг нэг mesh болгож draw call цөөрүүлнэ) ----------
class GB {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.i = []; this.v = 0; }
  quad(a, b, c, d, nx, ny, nz, uvs, col, colTop = col) {
    const s = this.v; for (const [q, uvq, cl] of [[a, uvs[0], col], [b, uvs[1], col], [c, uvs[2], colTop], [d, uvs[3], colTop]]) { this.p.push(q[0], q[1], q[2]); this.n.push(nx, ny, nz); this.uv.push(uvq[0], uvq[1]); this.c.push(cl[0], cl[1], cl[2]); }
    this.i.push(s, s + 1, s + 2, s, s + 2, s + 3); this.v += 4;
  }
  tri(a, b, c, nx, ny, nz, col, uvf) {
    const s = this.v; for (const q of [a, b, c]) { this.p.push(q[0], q[1], q[2]); this.n.push(nx, ny, nz); const u = uvf ? uvf(q) : [q[0] / 8, q[2] / 8]; this.uv.push(u[0], u[1]); this.c.push(col[0], col[1], col[2]); }
    this.i.push(s, s + 1, s + 2); this.v += 3;
  }
  poly(pts, y, col, uvScale = 8) { // хэвтээ олон өнцөгт (дээш харсан)
    if (pts.length < 3) return; const v2 = pts.map(([x, z]) => new THREE.Vector2(x, z)); let tris; try { tris = THREE.ShapeUtils.triangulateShape(v2, []); } catch { return; }
    const s = this.v; for (const [x, z] of pts) { this.p.push(x, y, z); this.n.push(0, 1, 0); this.uv.push(x / uvScale, z / uvScale); this.c.push(col[0], col[1], col[2]); }
    for (const t of tris) this.i.push(s + t[0], s + t[2], s + t[1]); this.v += pts.length;
  }
  mesh(mat) {
    if (!this.v) return null; const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.v > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1)); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat); m.matrixAutoUpdate = false; return m;
  }
}
const hex = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

// ---------- Процедур текстур ----------
function canvasTex(w, h, draw, repeat = true) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv); if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
// 1 давталт = 1 цонхны зай (3.2 м) × 1 давхар (3.0 м): угсармал хавтан, цонх, хүрээ
const facadeBlock = () => canvasTex(256, 240, (g, w, h) => {
  g.fillStyle = '#f2f0ea'; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(0,0,0,.07)'; g.fillRect(0, h - 10, w, 10); g.fillRect(w - 6, 0, 6, h); // хавтангийн заадас
  g.fillStyle = '#5b6b7a'; g.fillRect(58, 58, 140, 120); // цонхны нүх
  const gr = g.createLinearGradient(0, 62, 0, 174); gr.addColorStop(0, '#9fb8cf'); gr.addColorStop(1, '#3f5366'); g.fillStyle = gr; g.fillRect(64, 64, 128, 108);
  g.fillStyle = '#f7f7f4'; g.fillRect(124, 64, 8, 108); g.fillRect(64, 112, 128, 6); // хүрээ
  g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(70, 68, 48, 40);
  g.fillStyle = '#dcd8cf'; g.fillRect(52, 176, 152, 10); // цонхны тавцан
});
const facadeCom = () => canvasTex(256, 240, (g, w, h) => {
  g.fillStyle = '#e8edf2'; g.fillRect(0, 0, w, h);
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#8fb1cc'); gr.addColorStop(1, '#3e5a73'); g.fillStyle = gr; g.fillRect(14, 30, w - 28, h - 60);
  g.fillStyle = '#e8edf2'; for (let x = 14; x < w; x += 76) g.fillRect(x, 30, 6, h - 60); g.fillRect(0, h / 2 - 3, w, 6);
  g.fillStyle = 'rgba(255,255,255,.22)'; g.fillRect(24, 40, 40, 60);
});
const facadeHouse = () => canvasTex(256, 240, (g, w, h) => {
  g.fillStyle = '#f4efe6'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(0,0,0,.05)'; for (let y = 0; y < h; y += 16) g.fillRect(0, y, w, 1);
  g.fillStyle = '#6b5a4a'; g.fillRect(84, 70, 88, 90); g.fillStyle = '#7f9ab0'; g.fillRect(90, 76, 76, 78); g.fillStyle = '#f4efe6'; g.fillRect(125, 76, 6, 78);
});
const noiseTex = (base, amp = 18, size = 256) => canvasTex(size, size, (g, w, h) => {
  const im = g.createImageData(w, h); const c = new THREE.Color(base); const R = c.r * 255, G = c.g * 255, B = c.b * 255;
  for (let i = 0; i < w * h; i++) { const n = (Math.random() - 0.5) * amp; im.data[i * 4] = R + n; im.data[i * 4 + 1] = G + n; im.data[i * 4 + 2] = B + n * 0.9; im.data[i * 4 + 3] = 255; }
  g.putImageData(im, 0, 0);
});

// ---------- Сцен барих ----------
export function createExterior(ext, opts = {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 12000);
  const SKY_H = new THREE.Color('#dfe9f3'), SKY_Z = new THREE.Color('#5d97d6');
  scene.fog = new THREE.Fog(SKY_H, 900, 6200);
  // Тэнгэр: босоо градиент бөмбөрцөг
  {
    const g = new THREE.SphereGeometry(9000, 32, 16); const col = []; const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) { const y = pos.getY(i) / 9000; const k = Math.pow(Math.max(0, y), 0.55); const c = SKY_H.clone().lerp(SKY_Z, k); col.push(c.r, c.g, c.b); }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));
  }
  scene.add(new THREE.HemisphereLight(0xdbeaff, 0xb9a88c, 1.05));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.1); sun.position.set(-900, 1100, 1300); scene.add(sun); // өмнөд-баруунаас (намрын үдээс хойш)
  scene.add(new THREE.AmbientLight(0xffffff, 0.18));

  // Газар
  const groundTex = noiseTex('#c4bdae', 20); groundTex.repeat.set(900, 900);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000), new THREE.MeshLambertMaterial({ map: groundTex }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05; scene.add(ground);

  // Талбай (ногоон байгууламж, тоглоомын талбай, зогсоол, сургуулийн хашаа)
  const AREA_C = { park: '#8fb56a', grass: '#9fbd78', playground: '#e2b98a', pitch: '#6aa35c', parking: '#8a8e95', school: '#d8c8a4' };
  const areaY = { school: 0.02, grass: 0.03, park: 0.035, parking: 0.045, pitch: 0.05, playground: 0.055 };
  const ag = new GB(); for (const a of ext.areas || []) ag.poly(pairs(a.p), areaY[a.k] || 0.03, hex(AREA_C[a.k] || '#b0b0b0'));
  const areaMesh = ag.mesh(new THREE.MeshLambertMaterial({ vertexColors: true, map: noiseTex('#ffffff', 26, 128), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })); if (areaMesh) scene.add(areaMesh);

  // Замууд: ангиллаар өргөн, асфальт/явган замын өнгө, гол замд төвийн шугам
  const RC = { major: '#4a4e55', mid: '#575b62', minor: '#62666d', service: '#6d7178', path: '#c4bdae' };
  const RY = { major: 0.16, mid: 0.14, minor: 0.12, service: 0.1, path: 0.08 };
  const rg = new GB(), lg = new GB();
  const ribbon = (B, pts, w, y, col) => {
    if (pts.length < 2) return; const hw = w / 2; const L = [], R = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      let nx = -dz, nz = dx, k = 1;
      if (i > 0 && i < pts.length - 1) { const d1 = [p[0] - a[0], p[1] - a[1]], d2 = [b[0] - p[0], b[1] - p[1]]; const l1 = Math.hypot(...d1) || 1, l2 = Math.hypot(...d2) || 1; const n1 = [-d1[1] / l1, d1[0] / l1], n2 = [-d2[1] / l2, d2[0] / l2]; nx = n1[0] + n2[0]; nz = n1[1] + n2[1]; const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl; k = Math.min(2.2, 1 / Math.max(0.35, nx * n1[0] + nz * n1[1])); }
      L.push([p[0] + nx * hw * k, y, p[1] + nz * hw * k]); R.push([p[0] - nx * hw * k, y, p[1] - nz * hw * k]);
    }
    for (let i = 0; i + 1 < pts.length; i++) B.quad(L[i], L[i + 1], R[i + 1], R[i], 0, 1, 0, [[0, 0], [1, 0], [1, 1], [0, 1]], col);
  };
  for (const r of ext.roads || []) {
    const pts = pairs(r.p); const col = hex(RC[r.k] || '#666'); ribbon(rg, pts, r.w, RY[r.k] || 0.1, col);
    if (r.k === 'major' || r.k === 'mid') ribbon(lg, pts, 0.25, (RY[r.k] || 0.1) + 0.03, hex('#e8e4d8'));
  }
  const roadMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, map: noiseTex('#ffffff', 16, 128), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const roadMesh = rg.mesh(roadMat); if (roadMesh) scene.add(roadMesh);
  const lineMesh = lg.mesh(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 })); if (lineMesh) scene.add(lineMesh);

  // Барилгууд: хана (давхрын өндөр 3 м, цонхны зай 3.2 м) + дээвэр; ёроол руу бараан (хуурамч AO)
  const FL = 3.0, BAY = 3.2;
  const PAL = { bld: ['#dcd6ca', '#d3d6d8', '#e0d6c4', '#cfd6c9', '#e3dccf', '#d9cfc3', '#cdd3da'], apt: ['#d8d3c8', '#cfd4d7', '#dfd5c2', '#cdd6c8'], com: ['#cfd9e3', '#d6dde4', '#c9d3dd'], edu: ['#ecc986', '#e9b87c', '#efd49a'], house: ['#e5d6b8', '#d9c4a0', '#ccb38f', '#e8dcc6', '#c7a57e'], shed: ['#b9b3a8', '#a9a39a', '#c3bcb0'] };
  const ROOF_H = ['#8a3a30', '#3d6b8a', '#56703a', '#8c8f94', '#6b4a3a'];
  const B = { block: new GB(), com: new GB(), house: new GB(), home: new GB(), roof: new GB(), far: new GB() };
  const orient = (pts) => { let s = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]); return s < 0 ? pts.slice().reverse() : pts; };
  function walls(G, pts, h, col, dark = 0.72, uvScale = true) {
    const P = orient(pts); let acc = 0; const n = P.length;
    for (let i = 0; i < n; i++) {
      const a = P[i], b = P[(i + 1) % n]; const len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 0.05) continue;
      const nx = (b[1] - a[1]) / len, nz = -(b[0] - a[0]) / len; // гадагш
      const u0 = uvScale ? acc / BAY : 0, u1 = uvScale ? (acc + len) / BAY : 1, v1 = uvScale ? h / FL : 1;
      G.quad([b[0], 0, b[1]], [a[0], 0, a[1]], [a[0], h, a[1]], [b[0], h, b[1]], nx, 0, nz, [[u1, 0], [u0, 0], [u0, v1], [u1, v1]], mul(col, dark), col); // гадагш харсан эргэлт
      acc += len;
    }
  }
  function gable(G, R, pts, h, colWall, colRoof) { // тэгш өнцөгт байшинд хоёр налуу дээвэр
    const P = orient(pts); const e = [0, 1, 2, 3].map((i) => Math.hypot(P[(i + 1) % 4][0] - P[i][0], P[(i + 1) % 4][1] - P[i][1]));
    const k = e[0] + e[2] >= e[1] + e[3] ? 0 : 1; const [a, b, c, d] = [P[k], P[(k + 1) % 4], P[(k + 2) % 4], P[(k + 3) % 4]];
    const m1 = [(a[0] + d[0]) / 2, h + 1.6, (a[1] + d[1]) / 2], m2 = [(b[0] + c[0]) / 2, h + 1.6, (b[1] + c[1]) / 2];
    const A = [a[0], h, a[1]], Bp = [b[0], h, b[1]], C = [c[0], h, c[1]], D = [d[0], h, d[1]];
    const nrm = (p, q, r) => { const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], v = [r[0] - p[0], r[1] - p[1], r[2] - p[2]]; const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; const l = Math.hypot(...n) || 1; return n.map((x) => x / l); };
    let n1 = nrm(A, Bp, m2); if (n1[1] < 0) n1 = n1.map((x) => -x); let n2 = nrm(C, D, m1); if (n2[1] < 0) n2 = n2.map((x) => -x);
    R.quad(A, Bp, m2, m1, ...n1, [[0, 0], [1, 0], [1, 1], [0, 1]], colRoof); R.quad(C, D, m1, m2, ...n2, [[0, 0], [1, 0], [1, 1], [0, 1]], colRoof);
    const g1 = nrm(A, D, m1), g2 = nrm(C, Bp, m2); G.tri(A, D, m1, ...g1, colWall, (q) => [0, 0]); G.tri(C, Bp, m2, ...g2, colWall, (q) => [0, 0]);
  }
  function parapet(G, pts, h, col, ph = 0.7) { const P = orient(pts); for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; const len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 0.3) continue; G.quad([a[0], h, a[1]], [b[0], h, b[1]], [b[0], h + ph, b[1]], [a[0], h + ph, a[1]], (b[1] - a[1]) / len, 0, -(b[0] - a[0]) / len, [[0, 0], [len / 8, 0], [len / 8, 0.1], [0, 0.1]], col); } }
  function roofBox(G, cx, cz, ux, uz, L, W, y0, H, col) { // тэнхлэгийн дагуух хайрцаг (лифтний машин өрөө)
    const vx = -uz, vz = ux; const c = (a, b) => [cx + ux * a + vx * b, cz + uz * a + vz * b]; const q = orient([c(-L / 2, -W / 2), c(L / 2, -W / 2), c(L / 2, W / 2), c(-L / 2, W / 2)]);
    for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4]; const len = Math.hypot(b[0] - a[0], b[1] - a[1]); G.quad([b[0], y0, b[1]], [a[0], y0, a[1]], [a[0], y0 + H, a[1]], [b[0], y0 + H, b[1]], (b[1] - a[1]) / len, 0, -(b[0] - a[0]) / len, [[0, 0], [1, 0], [1, 1], [0, 1]], mul(col, 0.88), col); }
    G.poly(q, y0 + H, mul(col, 1.04));
  }
  function longAxis(pts) { let best = 0, ux = 1, uz = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l > best) { best = l; ux = (b[0] - a[0]) / l; uz = (b[1] - a[1]) / l; } } return [ux, uz]; }
  const inPolyB = (x, z, p) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) if (((p[i][1] > z) !== (p[j][1] > z)) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c; return c; };
  const homeInfo = { c: [0, 0], h: 27, pts: null };
  let bi = 0;
  for (const b of ext.buildings || []) {
    const pts = pairs(b.p); if (pts.length < 3) continue; bi++;
    const h = Math.max(2.8, b.lv * FL + (b.lv > 1 ? 0.6 : 0)); const pal = PAL[b.k] || PAL.bld; const col = hex(pal[Math.floor(hash(bi) * pal.length)]);
    if (b.t) { walls(B.home, pts, h, hex('#f3e7d3'), 0.8); B.roof.poly(pts, h, hex('#b4533f')); parapet(B.roof, pts, h, hex('#d8d2c8')); homeInfo.pts = pts; homeInfo.h = h; let cx = 0, cz = 0; for (const [x, z] of pts) { cx += x; cz += z; } homeInfo.c = [cx / pts.length, cz / pts.length]; continue; }
    if (b.k === 'house' || b.k === 'shed' || (b.lv <= 2 && b.k !== 'com' && b.k !== 'edu')) {
      walls(B.house, pts, h, col, 0.78);
      const roofC = hex(ROOF_H[Math.floor(hash(bi * 7.1) * ROOF_H.length)]);
      if (pts.length === 4 && b.k !== 'shed' && b.lv <= 2) gable(B.house, B.roof, pts, h, col, roofC); else B.roof.poly(pts, h, b.k === 'shed' ? hex('#7d7f84') : roofC);
    } else if (b.k === 'com' || b.k === 'edu') { walls(B.com, pts, h, col, 0.75); B.roof.poly(pts, h, hex('#7f8388')); parapet(B.roof, pts, h, hex('#b9bcc0'), 0.6); }
    else {
      walls(B.block, pts, h, col, 0.7); B.roof.poly(pts, h, hex(hash(bi * 3.7) > 0.5 ? '#5f6368' : '#7b7f84')); parapet(B.roof, pts, h, mul(col, 0.92));
      if (b.lv >= 5) { // хэсэг (орц) бүрд дээвэр дээр лифтний машин өрөө
        const [ux, uz] = longAxis(pts); let cx = 0, cz = 0; for (const [x, z] of pts) { cx += x; cz += z; } cx /= pts.length; cz /= pts.length;
        let a0 = Infinity, a1 = -Infinity; for (const [x, z] of pts) { const a = (x - cx) * ux + (z - cz) * uz; a0 = Math.min(a0, a); a1 = Math.max(a1, a); }
        const len = a1 - a0, nsec = Math.max(1, Math.round(len / 26));
        for (let k = 0; k < nsec; k++) { const a = a0 + (len * (k + 0.5)) / nsec; const x = cx + ux * a, z = cz + uz * a; if (inPolyB(x, z, pts)) roofBox(B.roof, x, z, ux, uz, 4.2, 3.2, h, 2.6, hex('#a3a6aa')); }
      }
    }
  }
  for (const b of ext.far || []) { const pts = pairs(b.p); if (pts.length < 3) continue; const h = b.lv * FL; const c = hex(['#d6d4ce', '#cfd3d7', '#dcd3c4', '#c9ced4'][Math.floor(hash(pts[0][0]) * 4)]); walls(B.far, pts, h, c, 0.7, false); B.far.poly(pts, h, hex('#8f9296')); }
  const blockTex = facadeBlock(), comTex = facadeCom(), houseTex = facadeHouse();
  const addM = (G, mat) => { const m = G.mesh(mat); if (m) scene.add(m); return m; };
  addM(B.block, new THREE.MeshLambertMaterial({ vertexColors: true, map: blockTex }));
  addM(B.com, new THREE.MeshLambertMaterial({ vertexColors: true, map: comTex }));
  addM(B.house, new THREE.MeshLambertMaterial({ vertexColors: true, map: houseTex }));
  addM(B.roof, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, map: noiseTex('#ffffff', 34, 128) }));
  addM(B.far, new THREE.MeshLambertMaterial({ vertexColors: true }));
  const homeMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: facadeBlock(), emissive: new THREE.Color('#3a1a12'), emissiveIntensity: 0.12 });
  addM(B.home, homeMat);

  // Гэр (монгол гэр): эсгий хана + дээвэр — instanced
  const gers = ext.gers || [];
  if (gers.length) {
    const wallG = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true); wallG.translate(0, 0.5, 0);
    const roofG = new THREE.ConeGeometry(1.04, 1, 14, 1, true); roofG.translate(0, 0.5, 0);
    const wm = new THREE.InstancedMesh(wallG, new THREE.MeshLambertMaterial({ color: '#f4f1ea', side: THREE.DoubleSide }), gers.length);
    const rm = new THREE.InstancedMesh(roofG, new THREE.MeshLambertMaterial({ color: '#e7e1d3', side: THREE.DoubleSide }), gers.length);
    const M = new THREE.Matrix4(), q = new THREE.Quaternion();
    gers.forEach(([x, z, r], i) => { M.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(r, 1.55, r)); wm.setMatrixAt(i, M); M.compose(new THREE.Vector3(x, 1.55, z), q, new THREE.Vector3(r, 0.8 + r * 0.12, r)); rm.setMatrixAt(i, M); });
    scene.add(wm, rm);
  }

  // Мод: OSM мод + ногоон байгууламж/хашаанд санамсаргүй (давтагдахуйц seed)
  const treePts = pairs(ext.trees || []);
  const inPoly = (x, z, p) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) if (((p[i][1] > z) !== (p[j][1] > z)) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c; return c; };
  let seed = 1; const rnd = () => hash(seed++);
  for (const a of ext.areas || []) {
    if (!['park', 'grass', 'school'].includes(a.k)) continue; const p = pairs(a.p); let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const areaBox = (x1 - x0) * (z1 - z0); const n = Math.min(80, Math.round(areaBox / (a.k === 'school' ? 380 : 150)));
    for (let i = 0; i < n; i++) { const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0); if (inPoly(x, z, p) && (a.k !== 'school' || rnd() < 0.5)) treePts.push([x, z]); }
  }
  if (treePts.length) {
    const tn = Math.min(4000, treePts.length);
    const crown = new THREE.IcosahedronGeometry(1, 0); crown.translate(0, 0, 0);
    const trunk = new THREE.CylinderGeometry(0.12, 0.18, 1, 5); trunk.translate(0, 0.5, 0);
    const cm = new THREE.InstancedMesh(crown, new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), tn);
    const tm = new THREE.InstancedMesh(trunk, new THREE.MeshLambertMaterial({ color: '#6b5238' }), tn);
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
    const TC = ['#5f8a3e', '#6f9a45', '#4e7a36', '#c9a53a', '#d8b24a', '#8a9a3c'];
    for (let i = 0; i < tn; i++) {
      const [x, z] = treePts[i]; const s = 1.6 + hash(i * 3.3) * 1.6, th = 2 + hash(i * 1.7) * 2.2;
      M.compose(new THREE.Vector3(x, th + s * 0.7, z), q, new THREE.Vector3(s, s * 1.25, s)); cm.setMatrixAt(i, M);
      M.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(1, th + 0.4, 1)); tm.setMatrixAt(i, M);
      col.set(TC[Math.floor(hash(i * 9.1) * TC.length)]); cm.setColorAt(i, col);
    }
    scene.add(cm, tm);
  }

  // Зогсоол дээрх машинууд (хэлбэр: их бие + кабин)
  {
    const body = new THREE.BoxGeometry(1.8, 0.75, 4.4); body.translate(0, 0.55, 0); const cab = new THREE.BoxGeometry(1.6, 0.6, 2.3); cab.translate(0, 1.2, -0.2);
    const carG = mergeBoxes([body, cab]);
    const spots = [];
    for (const a of ext.areas || []) {
      if (a.k !== 'parking') continue; const p = pairs(a.p); if (p.length < 3) continue;
      let cx = 0, cz = 0; for (const [x, z] of p) { cx += x; cz += z; } cx /= p.length; cz /= p.length;
      let sxx = 0, szz = 0, sxz = 0; for (const [x, z] of p) { sxx += (x - cx) ** 2; szz += (z - cz) ** 2; sxz += (x - cx) * (z - cz); }
      const th = 0.5 * Math.atan2(2 * sxz, sxx - szz); const ux = Math.cos(th), uz = Math.sin(th);
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity; for (const [x, z] of p) { const u = (x - cx) * ux + (z - cz) * uz, v = -(x - cx) * uz + (z - cz) * ux; a0 = Math.min(a0, u); a1 = Math.max(a1, u); b0 = Math.min(b0, v); b1 = Math.max(b1, v); }
      for (let u = a0 + 1.6; u < a1 - 1.2; u += 2.7) for (let v = b0 + 2.8; v < b1 - 2.4; v += 6.2) {
        if (hash(u * 3.1 + v * 7.7) > 0.68) continue; const x = cx + u * ux - v * uz, z = cz + u * uz + v * ux; if (!inPoly(x, z, p)) continue;
        spots.push([x, z, -th + (hash(u + v) > 0.5 ? 0 : Math.PI) + Math.PI / 2]);
      }
    }
    if (spots.length) {
      const n = Math.min(3000, spots.length); const cm = new THREE.InstancedMesh(carG, new THREE.MeshLambertMaterial({ color: '#ffffff' }), n);
      const M = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color(); const CC = ['#f4f4f4', '#c9ccd1', '#1f2328', '#6b7280', '#b91c1c', '#1e3a8a', '#e5e7eb', '#9ca3af'];
      for (let i = 0; i < n; i++) { const [x, z, r] = spots[i]; q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r); M.compose(new THREE.Vector3(x, 0.05, z), q, new THREE.Vector3(1, 1, 1)); cm.setMatrixAt(i, M); col.set(CC[Math.floor(hash(i * 5.3) * CC.length)]); cm.setColorAt(i, col); }
      scene.add(cm);
    }
  }
  function mergeBoxes(list) { // BufferGeometryUtils-гүй энгийн нэгтгэл
    const pos = [], nor = [], idx = []; let off = 0;
    for (const g of list) { const gi = g.toNonIndexed ? g : g; const p = gi.attributes.position, n = gi.attributes.normal, ix = gi.index; for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); } for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + off); off += p.count; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setIndex(idx); return g;
  }

  // ---------- Тэмдэглэгээ: гэр, цэгүүд, алс чиглэл (3D багана + HTML шошго) ----------
  const markers = []; const labelsEl = $('#extLabels');
  function beam(x, z, h, color, r = 2.2, opacity = 0.35) {
    const g = new THREE.CylinderGeometry(r, r, h, 20, 1, true); g.translate(0, h / 2, 0);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
    m.position.set(x, 0, z); scene.add(m); return m;
  }
  function ring(x, z, r, color) {
    const m = new THREE.Mesh(new THREE.RingGeometry(r * 0.72, r, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.4, z); scene.add(m); return m;
  }
  function addLabel(kind, x, y, z, title, sub, extra = '') {
    const s = CAT[kind] || CAT.home; const el = document.createElement('div'); el.className = `xl xl-${kind === 'home' ? 'home' : 'poi'}`;
    el.style.setProperty('--c', s.c); el.innerHTML = `<span class="xl-ic">${ic(s.ic)}</span><span class="xl-t"><b>${esc(title)}</b>${sub ? `<i>${esc(sub)}</i>` : ''}</span>${extra}`;
    labelsEl && labelsEl.appendChild(el); const mk = { kind, el, pos: new THREE.Vector3(x, y, z), active: false, tl: String(title || '').length }; markers.push(mk); return mk;
  }
  const ent = ext.entrance || [0, 0];
  const homeBeam = beam(homeInfo.c[0], homeInfo.c[1], homeInfo.h + 90, '#fb7185', 3.2, 0.3);
  const homeLbl = addLabel('home', homeInfo.c[0], homeInfo.h + 14, homeInfo.c[1], 'Таны байр', ext.home && ext.home.lv ? `${ext.home.lv} давхар` : '');
  const pois = (ext.pois || []).map((p, i) => ({ ...p, idx: i }));
  const main = ext.mainRoad ? { ...ext.mainRoad, cat: 'main', mn: 'Төв зам' } : null;
  for (const p of [...pois, ...(main ? [main] : [])]) {
    const s = CAT[p.cat] || CAT.home; p.beam = beam(p.x, p.z, 34, s.c, 0.9, 0.55); p.ring = ring(p.x, p.z, 7, s.c);
    p.lbl = addLabel(p.cat, p.x, 40, p.z, p.cat === 'main' ? p.name : p.name, `${fmtM(p.m)} · алхаж ${p.walkMin} мин`);
  }
  const dests = (ext.dests || []).map((d) => ({ ...d, cat: d.id }));
  for (const d of dests) { const s = CAT[d.cat] || CAT.center; d.beam = beam(d.x, d.z, 380, s.c, 9, 0.28); d.lbl = addLabel(d.cat, d.x, 300, d.z, d.name, d.km ? `${d.km} км` : ''); }

  // Маршрутын гэрэлтсэн тууз (үзүүлэх үед урагшилж зурагдана)
  const ribbons = [];
  function focusRibbon(act, kind) { // идэвхтэй маршрут тод; орцонд буухад (нүдний түвшин) бүгдийг нууна; алс маршрут зөвхөн өндрөөс
    for (const r of ribbons) { const on = r === act; r.visible = kind !== 'approach' && (!r.userData.far || on || ['climb', 'far', 'farOrbit', 'return'].includes(kind)); r.material.opacity = act ? (on ? 0.95 : 0.22) : 0.55; r.renderOrder = on ? 8 : 4; r.userData.ghost.visible = on && r.visible; }
  }
  function routeRibbon(pts, w, color, y = 0.7) {
    const G = new GB(); const hw = w / 2; const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; const nx = -(b[1] - a[1]) / l * hw, nz = (b[0] - a[0]) / l * hw;
      G.quad([a[0] + nx, y, a[1] + nz], [b[0] + nx, y, b[1] + nz], [b[0] - nx, y, b[1] - nz], [a[0] - nx, y, a[1] - nz], 0, 1, 0, [[0, 0], [1, 0], [1, 1], [0, 1]], [1, 1, 1]);
    }
    const m = G.mesh(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false, fog: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
    if (!m) return null; m.geometry.setDrawRange(0, 0); m.userData = { cum, total: cum[cum.length - 1], segs: pts.length - 1 }; m.renderOrder = 5; scene.add(m);
    const ghost = new THREE.Mesh(m.geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.38, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide })); ghost.renderOrder = 6; ghost.matrixAutoUpdate = false; ghost.visible = false; scene.add(ghost); m.userData.ghost = ghost; ribbons.push(m);
    return m;
  }
  const setRibbon = (m, frac) => { if (!m) return; const { cum, total, segs } = m.userData; const d = frac * total; let k = 0; while (k < segs && cum[k + 1] <= d) k++; m.geometry.setDrawRange(0, Math.min(segs, k + (frac > 0 ? 1 : 0)) * 6); };
  for (const p of [...pois, ...(main ? [main] : [])]) { p.pts = pairs(p.route); p.rib = routeRibbon(p.pts, 5.5, (CAT[p.cat] || CAT.home).c, 0.9); }
  for (const d of dests) if (d.route) { d.pts = pairs(d.route); d.rib = routeRibbon(d.pts, 22, (CAT[d.cat] || CAT.center).c, 1.4); if (d.rib) d.rib.userData.far = true; }

  // ---------- Өндрийн тор: камер барилгад халхлагдахгүй, дотор нь орохгүй ----------
  const HG = (() => {
    const cs = 5, E = (ext.R || 950) + 300, n = Math.ceil((2 * E) / cs); const raw = new Float32Array(n * n);
    const put = (pts, h) => {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      const i0 = Math.max(0, Math.floor((x0 + E) / cs)), i1 = Math.min(n - 1, Math.floor((x1 + E) / cs)), j0 = Math.max(0, Math.floor((z0 + E) / cs)), j1 = Math.min(n - 1, Math.floor((z1 + E) / cs));
      let hit = false;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { if (inPoly(-E + (i + 0.5) * cs, -E + (j + 0.5) * cs, pts)) { const k = j * n + i; if (h > raw[k]) raw[k] = h; hit = true; } }
      if (!hit) { const i = Math.floor(((x0 + x1) / 2 + E) / cs), j = Math.floor(((z0 + z1) / 2 + E) / cs); if (i >= 0 && j >= 0 && i < n && j < n) raw[j * n + i] = Math.max(raw[j * n + i], h); }
    };
    for (const b of ext.buildings || []) { const pts = pairs(b.p); if (pts.length >= 3) put(pts, Math.max(2.8, b.lv * FL + (b.lv > 1 ? 0.6 : 0)) + (b.lv <= 2 ? 1.6 : 0)); }
    const dil = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { let m = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < n && b < n && raw[b * n + a] > m) m = raw[b * n + a]; } dil[j * n + i] = m; }
    const idx = (x, z) => { const i = Math.floor((x + E) / cs), j = Math.floor((z + E) / cs); return i < 0 || j < 0 || i >= n || j >= n ? -1 : j * n + i; };
    return { at: (x, z) => { const k = idx(x, z); return k < 0 ? 0 : dil[k]; }, raw: (x, z) => { const k = idx(x, z); return k < 0 ? 0 : raw[k]; } };
  })();
  // pos→tgt харааны шугам барилгаар халхлагдахгүй байх камерын хамгийн бага өндөр
  function needY(pos, tgt, frac = 0.55) {
    const ty = Math.max(tgt.y, HG.raw(tgt.x, tgt.z)); const dx = pos.x - tgt.x, dz = pos.z - tgt.z; const r = Math.hypot(dx, dz);
    const own = HG.at(pos.x, pos.z); let need = own > 0 ? own + 8 : 0;
    for (let q = Math.max(12, r * (1 - frac)); q < r - 2; q += 2.5) { const H = HG.raw(tgt.x + (dx * q) / r, tgt.z + (dz * q) / r) + 2.5; if (H > ty) need = Math.max(need, ty + ((H - ty) * r) / q); }
    return Math.min(need, 170);
  }

  // ---------- Камер ба найруулга ----------
  const home3 = new THREE.Vector3(homeInfo.c[0], homeInfo.h * 0.55, homeInfo.c[1]);
  const pose = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  function pathSampler(pts) { // тэгшилсэн муруй (камерын жигд хөдөлгөөн)
    const c = new THREE.CatmullRomCurve3(pts.map(([x, z]) => V(x, 0, z)), false, 'centripetal', 0.5); const L = c.getLength();
    return { L, at: (s) => c.getPointAt(Math.max(0, Math.min(1, s / Math.max(L, 0.01)))) };
  }
  const flyByOrder = FLY_ORDER.map((cat) => pois.find((p) => p.cat === cat)).filter(Boolean);
  const segs = [];
  segs.push({ kind: 'intro', dur: 13, cap: { icon: 'plane-landing', t: 'Бодит орчны 3D нислэг', s: opts.title || 'Таны байрны орчин', d: 'OpenStreetMap + хиймэл дагуулын ML барилгын контур · GHSL өндөр' } });
  segs.push({ kind: 'orbitHome', dur: 10, cap: { icon: 'house', t: 'Таны байр', s: ext.home && ext.home.lv ? `${ext.home.lv} давхар байр` : 'Орон сууц', d: 'Эргэн тойрны үйлчилгээний цэгүүд' } });
  for (const p of flyByOrder) {
    const sp = pathSampler(p.pts); p.sp = sp; const dur = Math.max(5.5, Math.min(13, sp.L / 24));
    segs.push({ kind: 'hop', dur: 2.6, to: p });
    segs.push({ kind: 'fly', dur, p, sp });
    segs.push({ kind: 'orbit', dur: 4.2, p });
  }
  if (main) { const sp = pathSampler(main.pts); main.sp = sp; segs.push({ kind: 'hop', dur: 2.6, to: main }); segs.push({ kind: 'fly', dur: Math.max(6, Math.min(14, sp.L / 24)), p: main, sp }); segs.push({ kind: 'orbit', dur: 5, p: main }); }
  const w4 = dests.find((d) => d.id === 'west4'), ce = dests.find((d) => d.id === 'center');
  if (w4 && w4.pts) { const sp = pathSampler(w4.pts); segs.push({ kind: 'climb', dur: 4, d: w4 }); segs.push({ kind: 'far', dur: Math.max(12, Math.min(24, sp.L / 110)), d: w4, sp }); segs.push({ kind: 'farOrbit', dur: 6, d: w4 }); }
  if (ce && ce.pts) {
    let i0 = 0; if (w4) { let bd = Infinity; ce.pts.forEach(([x, z], i) => { const dd = Math.hypot(x - w4.x, z - w4.z); if (dd < bd) { bd = dd; i0 = i; } }); }
    const sub = ce.pts.slice(Math.max(0, i0)); const sp = pathSampler(sub.length > 1 ? sub : ce.pts);
    segs.push({ kind: 'far', dur: Math.max(10, Math.min(22, sp.L / 110)), d: ce, sp, from: i0 }); segs.push({ kind: 'farOrbit', dur: 6.5, d: ce });
  }
  segs.push({ kind: 'return', dur: 8, cap: { icon: 'house', t: 'Буцаж таны байр руу', s: 'Орцоор орж байрны дотор аялна', d: '' } });
  segs.push({ kind: 'approach', dur: 9, cap: { icon: 'footprints', t: 'Орц', s: 'Байрны дотор руу', d: '' } });
  let t0 = 0; for (const s of segs) { s.t0 = t0; t0 += s.dur; } const TOTAL = t0;

  let T = 0, segI = -1, running = false, free = false, fromPose = null; let roll = 0, lastYaw = null;
  const look = { yaw: 0, pitch: -0.3 }; const keys = opts.keys || {};
  let entN = null, entW = null;
  function entDir() { // орцонд хамгийн ойр хананы гадагш нормаль
    if (entN) return entN.clone(); const P = homeInfo.pts; let best = null, bd = Infinity;
    if (P) for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length]; const dx = b[0] - a[0], dz = b[1] - a[1]; const L2 = dx * dx + dz * dz; if (L2 < 1) continue;
      const t = Math.max(0, Math.min(1, ((ent[0] - a[0]) * dx + (ent[1] - a[1]) * dz) / L2)); const px = a[0] + dx * t, pz = a[1] + dz * t; const d = Math.hypot(ent[0] - px, ent[1] - pz);
      if (d < bd) { bd = d; best = [dx, dz, px, pz]; }
    }
    if (best) { const [dx, dz, px, pz] = best; entN = V(-dz, 0, dx).normalize(); if (entN.x * (ent[0] - px) + entN.z * (ent[1] - pz) < 0) entN.negate(); entW = [px, pz]; }
    else { entN = V(ent[0] - homeInfo.c[0], 0, ent[1] - homeInfo.c[1]); if (entN.lengthSq() < 0.01) entN.set(0, 0, 1); entN.normalize(); }
    return entN.clone();
  }
  const base = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };
  function capture() { return { pos: base.pos.clone(), tgt: base.tgt.clone() }; }
  function applyPose(pz, t) { base.pos.copy(pz.pos); base.tgt.copy(pz.tgt); camera.position.copy(pz.pos); camera.position.y += liftAt(t); pose.tgt.copy(pz.tgt); camera.lookAt(pose.tgt); }
  // Өргөлтийн профайл: бүх аяллын хугацааны дагуу (0.2 с алхам) барилга халхлахгүй байх нэмэлт өндөр
  const LIFT_DT = 0.2; let LIFT = null;
  function liftAt(t) { if (!LIFT) return 0; const f = Math.max(0, Math.min(LIFT.length - 1, t / LIFT_DT)); const i = Math.floor(f), k = f - i; return LIFT[i] * (1 - k) + LIFT[Math.min(LIFT.length - 1, i + 1)] * k; }
  function planLift() {
    const LK = new Set(['orbitHome', 'hop', 'fly', 'orbit', 'return']); const n = Math.ceil(TOTAL / LIFT_DT) + 2; const need = new Float32Array(n);
    let prev = null; const starts = segs.map((sg) => { fromPose = prev; const st = prev; prev = segPose(sg, 1); return st; });
    let si = 0;
    for (let i = 0; i < n; i++) {
      const t = Math.min(TOTAL - 1e-3, i * LIFT_DT); while (si < segs.length - 1 && t >= segs[si + 1].t0) si++;
      const sg = segs[si]; if (!LK.has(sg.kind)) continue; fromPose = starts[si];
      const pz = segPose(sg, Math.min(1, (t - sg.t0) / sg.dur)); need[i] = Math.min(40, Math.max(0, needY(pz.pos, pz.tgt, sg.kind === 'orbit' ? 0.8 : 0.55) - pz.pos.y));
    }
    fromPose = null;
    const w = 3; let L = need.map((_, i) => { let m = 0; for (let k = -w; k <= w; k++) { const j = i + k; if (j >= 0 && j < n && need[j] > m) m = need[j]; } return m; });
    const rise = 12 * LIFT_DT, fall = 7 * LIFT_DT; // м/с хязгаар: огцом үсрэлтгүй
    for (let i = n - 2; i >= 0; i--) L[i] = Math.max(L[i], L[i + 1] - rise);
    for (let i = 1; i < n; i++) L[i] = Math.max(L[i], L[i - 1] - fall);
    LIFT = L.map((_, i) => { let a = 0, c = 0; for (let k = -2; k <= 2; k++) { const j = i + k; if (j >= 0 && j < n) { a += L[j]; c++; } } return a / c; });
  }
  function flyPose(sp, d, u) {
    const L = sp.L; const p = sp.at(d), ah = sp.at(Math.min(L, d + 30)), bh = sp.at(Math.max(0, d - 30)); const dir = ah.clone().sub(bh).setY(0); if (dir.lengthSq() < 1e-3) dir.set(0, 0, -1); dir.normalize();
    return { pos: p.clone().addScaledVector(dir, -28).setY(60 - 4 * u), tgt: sp.at(Math.min(L, d + 30)).setY(0) }; // ≈45° налуу
  }
  function hopTarget(p) { return p.sp ? flyPose(p.sp, 0, 0) : { pos: V(p.x, 90, p.z + 60), tgt: V(p.x, 0, p.z) }; }
  function blend(a, b, k, arc = 0) { const pos = a.pos.clone().lerp(b.pos, k); pos.y += Math.sin(Math.PI * k) * arc; return { pos, tgt: a.tgt.clone().lerp(b.tgt, k) }; }
  function segPose(s, u) { // u ∈ [0,1] сегментийн дотор
    const k = s.kind;
    if (k === 'intro') { const e = ease(u); const r = 2200 - 1950 * e, h = 1500 - 1330 * smooth5(u), a = -2.2 + 1.9 * e; return { pos: V(home3.x + Math.cos(a) * r, h, home3.z + Math.sin(a) * r), tgt: home3.clone() }; }
    if (k === 'orbitHome') { const a = -0.3 + u * 1.9; return { pos: V(home3.x + Math.cos(a) * 250, 170 - 40 * u, home3.z + Math.sin(a) * 250), tgt: home3.clone() }; }
    if (k === 'hop') { const b = hopTarget(s.to); const a = fromPose || b; return blend(a, b, ease(u), 55); }
    if (k === 'fly') return flyPose(s.sp, s.sp.L * smooth5(u), u);
    if (k === 'orbit') { const p = s.p; const a0 = fromPose ? Math.atan2(fromPose.pos.z - p.z, fromPose.pos.x - p.x) : 0; const a = a0 + u * 1.25; const r = 56 - 6 * u; const bl = ease(Math.min(1, u * 3)); const o = { pos: V(p.x + Math.cos(a) * r, 56 - 4 * u, p.z + Math.sin(a) * r), tgt: V(p.x, 2, p.z) }; return fromPose ? blend(fromPose, o, bl) : o; }
    if (k === 'climb') { const b = { pos: V(ent[0], 520, ent[1] + 420), tgt: V(s.d.x, 0, s.d.z) }; return blend(fromPose || b, b, ease(u)); }
    if (k === 'far') { const L = s.sp.L; const d = L * ease(u); const p = s.sp.at(d), ah = s.sp.at(Math.min(L, d + 420)); const dir = ah.clone().sub(p).setY(0); if (dir.lengthSq() < 1e-3) dir.set(1, 0, 0); dir.normalize(); const o = { pos: p.clone().addScaledVector(dir, -260).setY(260), tgt: ah.clone().setY(10) }; return u < 0.12 && fromPose ? blend(fromPose, o, ease(u / 0.12)) : o; }
    if (k === 'farOrbit') { const d = s.d; const a0 = fromPose ? Math.atan2(fromPose.pos.z - d.z, fromPose.pos.x - d.x) : 0; const a = a0 + u * 0.9; const o = { pos: V(d.x + Math.cos(a) * 520, 330, d.z + Math.sin(a) * 520), tgt: V(d.x, 20, d.z) }; return fromPose ? blend(fromPose, o, ease(Math.min(1, u * 2.5))) : o; }
    if (k === 'return') { const e = V(ent[0], 0, ent[1]); const d = entDir(); const b = { pos: e.clone().addScaledVector(d, 190).setY(150), tgt: e.clone().setY(8) }; return blend(fromPose || b, b, ease(u), 120); }
    if (k === 'approach') {
      // Орцны өмнөх хашаанд дрон шиг бууна (эсрэг талын байр халхлахгүй), дараа нь хаалга руу алхана
      const e = V(ent[0], 0, ent[1]); const d = entDir();
      const p1 = { pos: e.clone().addScaledVector(d, 26).setY(42), tgt: e.clone().setY(3) };
      const p2 = { pos: e.clone().addScaledVector(d, 13).setY(1.7), tgt: e.clone().addScaledVector(d, -1.5).setY(2.4) };
      const p3 = { pos: e.clone().addScaledVector(d, 5.2).setY(1.7), tgt: e.clone().addScaledVector(d, -1.5).setY(1.9) };
      if (u < 0.3) return blend(fromPose || p1, p1, ease(u / 0.3));
      if (u < 0.56) return blend(p1, p2, ease((u - 0.3) / 0.26));
      return blend(p2, p3, ease((u - 0.56) / 0.44));
    }
    return { pos: camera.position.clone(), tgt: pose.tgt.clone() };
  }
  function enterSeg(i) {
    segI = i; const s = segs[i]; fromPose = capture();
    for (const p of [...pois, ...(main ? [main] : [])]) { p.lbl.active = false; }
    const act = s.p || s.to || s.d; focusRibbon(act && act.rib ? act.rib : null, s.kind);
    homeBeam.visible = ['intro', 'orbitHome', 'climb', 'far', 'farOrbit', 'return'].includes(s.kind);
    if (s.kind === 'fly' || s.kind === 'orbit' || s.kind === 'hop') { const p = s.p || s.to; p.lbl.active = true; }
    if (s.kind === 'far' || s.kind === 'farOrbit' || s.kind === 'climb') { for (const d of dests) d.lbl.active = d === s.d; }
    const cap = s.cap || captionFor(s); if (cap) showCaption(cap, s);
    opts.onSegment && opts.onSegment(i, s);
  }
  function captionFor(s) {
    const p = s.p || s.to; if (p && (s.kind === 'fly' || s.kind === 'orbit' || s.kind === 'hop')) {
      const st = CAT[p.cat] || CAT.home; const extra = p.cat === 'main' && ext.study ? mainStudy() : '';
      return { icon: st.ic, t: p.cat === 'main' ? `Төв зам — ${p.name}` : st.mn, s: p.cat === 'main' ? '' : p.name, d: `Алхаж ${fmtM(p.m)} · ${p.walkMin} мин${extra}`, c: st.c };
    }
    const d = s.d; if (d) { const st = CAT[d.cat] || CAT.center; const row = ext.study && ext.study.rows.find((r) => r.id === d.id); return { icon: st.ic, t: d.name, s: d.km ? `Машинаар ${d.km} км` : '', d: row ? studyLine(row) : 'Замын хугацаа тооцоогүй', c: st.c, chart: row }; }
    return null;
  }
  function studyLine(row) { if (!row || !row.byHour) return ''; const at = (h) => { const b = row.byHour.find((x) => x[0] === h); return b && b[1] != null ? `${b[1]} мин` : '—'; }; return `08:00 — ${at(8)} · 13:00 — ${at(13)} · 18:00 — ${at(18)} · шөнө — ${row.free != null ? row.free + ' мин' : '—'}`; }
  function mainStudy() { const row = ext.study.rows.find((r) => r.id === 'main'); if (!row) return ''; const b8 = row.byHour.find((x) => x[0] === 8), b18 = row.byHour.find((x) => x[0] === 18); return ` · машинаар 08:00 — ${b8 && b8[1] != null ? b8[1] : '—'} мин, 18:00 — ${b18 && b18[1] != null ? b18[1] : '—'} мин`; }
  function showCaption(c, s) {
    const el = $('#extCaption'); if (!el) return;
    el.style.setProperty('--c', c.c || '#38bdf8');
    el.innerHTML = `<div class="xc-ic">${ic(c.icon || 'map-pin')}</div><div class="xc-b"><div class="xc-t">${esc(c.t)}</div>${c.s ? `<div class="xc-s">${esc(c.s)}</div>` : ''}${c.d ? `<div class="xc-d">${esc(c.d)}</div>` : ''}${c.chart ? chartSvg(c.chart) : ''}</div>`;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    document.querySelectorAll('#extList li').forEach((li) => li.classList.toggle('on', !!((s.p && li.dataset.key === keyOf(s.p)) || (s.to && li.dataset.key === keyOf(s.to)) || (s.d && li.dataset.key === s.d.id))));
  }
  const keyOf = (p) => (p.cat === 'main' ? 'main' : `${p.cat}:${p.idx}`);
  function chartSvg(row) { // цаг тус бүрийн хугацаа (06–23)
    const hs = row.byHour.filter((b) => b[1] != null); if (!hs.length) return ''; const mx = Math.max(...hs.map((b) => b[1])); const W = 300, Hh = 64;
    const bars = row.byHour.map((b, i) => { const v = b[1] || 0; const h = mx ? (v / mx) * (Hh - 18) : 0; const x = 6 + i * ((W - 12) / row.byHour.length); const peak = v === mx; return `<rect x="${x.toFixed(1)}" y="${(Hh - 12 - h).toFixed(1)}" width="${((W - 12) / row.byHour.length - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="${peak ? '#f43f5e' : 'rgba(255,255,255,.78)'}"/>${b[0] % 3 === 0 ? `<text x="${(x + 4).toFixed(1)}" y="${Hh - 1}" font-size="9" fill="rgba(255,255,255,.7)">${b[0]}</text>` : ''}`; }).join('');
    return `<svg class="xc-chart" viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}">${bars}<text x="${W - 4}" y="10" font-size="10" text-anchor="end" fill="#fecdd3">оргил ${mx} мин</text></svg>`;
  }
  // Баруун самбар: бүх цэгийн жагсаалт (дарахад тэр хэсэг рүү үсэрнэ)
  function buildList() {
    const el = $('#extList'); if (!el) return;
    const rows = []; const fly = new Map(); segs.forEach((s, i) => { if (s.kind === 'hop' && s.to) fly.set(keyOf(s.to), i); if (s.kind === 'climb' || (s.kind === 'far' && !fly.has(s.d.id))) fly.set(s.d.id, i); });
    for (const cat of [...FLY_ORDER, 'college']) for (const p of pois.filter((q) => q.cat === cat)) { const st = CAT[p.cat]; const si = fly.get(keyOf(p)); rows.push(`<li ${si != null ? `data-seg="${si}"` : ''} data-key="${keyOf(p)}" style="--c:${st.c}">${ic(st.ic)}<span><b>${esc(p.name)}</b><i>${esc(st.mn)}</i></span><em>${fmtM(p.m)}<small>${p.walkMin} мин</small></em></li>`); }
    if (main) rows.push(`<li data-seg="${fly.get('main') ?? ''}" data-key="main" style="--c:${CAT.main.c}">${ic('route')}<span><b>${esc(main.name)}</b><i>Төв зам</i></span><em>${fmtM(main.m)}<small>${main.walkMin} мин</small></em></li>`);
    for (const d of dests) { const row = ext.study && ext.study.rows.find((r) => r.id === d.id); const st = CAT[d.cat] || CAT.center; rows.push(`<li data-seg="${fly.get(d.id) ?? ''}" data-key="${d.id}" style="--c:${st.c}">${ic(st.ic)}<span><b>${esc(d.name)}</b><i>${row && row.peak != null ? `оргил ${row.peak} мин (${row.peakHour}:00)` : 'машинаар'}</i></span><em>${d.km ? d.km + ' км' : '—'}<small>${row && row.free != null ? row.free + '–' + row.peak + ' мин' : ''}</small></em></li>`); }
    el.innerHTML = rows.join('');
    el.querySelectorAll('li[data-seg]').forEach((li) => li.addEventListener('click', () => { const i = +li.dataset.seg; if (Number.isFinite(i)) { free = false; running = true; T = segs[i].t0; enterSeg(i); opts.onResume && opts.onResume(); } }));
  }
  { // Орц: хаалга, саравч, шат
    const nrm = entDir(); const wx = entW ? entW[0] : ent[0] - nrm.x * 1.5, wz = entW ? entW[1] : ent[1] - nrm.z * 1.5; const th = Math.atan2(nrm.x, nrm.z); // хананы гадаргуу
    const put = (geo, color, off, y) => { const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color })); m.position.set(wx + nrm.x * off, y, wz + nrm.z * off); m.rotation.y = th; scene.add(m); return m; };
    put(new THREE.BoxGeometry(2.4, 0.3, 1.3), '#b5b0a8', 0.65, 0.15);   // шат
    put(new THREE.BoxGeometry(1.4, 2.2, 0.1), '#8a6a4f', 0.05, 0.3 + 1.1); // хаалга (төмөр, хүрэн будагтай)
    put(new THREE.BoxGeometry(0.5, 0.35, 0.02), '#cbd5e1', 0.11, 0.3 + 1.75); // хаалганы шилэн цонх
    put(new THREE.BoxGeometry(1.6, 0.12, 0.14), '#e7e5e4', 0.1, 0.3 + 2.26); // хаалганы дээд хүрээ
    put(new THREE.BoxGeometry(2.8, 0.16, 1.5), '#c9ccd0', 0.75, 2.95);     // саравч
    const lamp = put(new THREE.BoxGeometry(0.35, 0.16, 0.2), '#fff7d6', 0.12, 2.75); lamp.material.emissive = new THREE.Color('#ffe9a8'); lamp.material.emissiveIntensity = 0.8;
  }
  planLift();
  buildList();

  // ---------- Шинэчлэлт ----------
  const tmpV = new THREE.Vector3();
  function updateLabels() {
    const w = innerWidth, h = innerHeight; const t = performance.now() / 1000; const cand = [];
    for (const m of markers) {
      tmpV.copy(m.pos).project(camera); const vis = tmpV.z < 1 && tmpV.z > -1 && Math.abs(tmpV.x) < 1.15 && Math.abs(tmpV.y) < 1.15;
      const dist = camera.position.distanceTo(m.pos); const far = m.kind === 'west4' || m.kind === 'center';
      const x = ((tmpV.x + 1) / 2) * w, y = ((1 - tmpV.y) / 2) * h;
      const eye = segs[segI] && segs[segI].kind === 'approach';
      if (!(vis && y > 86 && (m.active || m.kind === 'home' || (!eye && (far || dist < 700))))) { m.el.style.display = 'none'; continue; }
      cand.push({ m, x, y, dist, far, pri: m.active ? 0 : m.kind === 'home' ? 1 : far ? 2 : 3 });
    }
    cand.sort((a, b) => a.pri - b.pri || a.dist - b.dist); const placed = [];
    for (const id of ['#extCaption', '#extPanel', '#map']) { const el = $(id); if (el && el.offsetParent !== null) { const b = el.getBoundingClientRect(); if (b.width) placed.push([b.left, b.top, b.right, b.bottom]); } }
    for (const c of cand) {
      const { m } = c; const mini = !m.active && m.kind !== 'home' && !c.far; const bw = 40 + m.tl * (mini ? 6.3 : 8), bh = mini ? 26 : 44;
      const r = [c.x - bw / 2, c.y - bh, c.x + bw / 2, c.y];
      if ((c.pri >= 2 || placed.length) && c.pri !== 0 && placed.some((q) => r[0] < q[2] + 4 && r[2] + 4 > q[0] && r[1] < q[3] + 3 && r[3] + 3 > q[1])) { m.el.style.display = 'none'; continue; }
      placed.push(r); m.el.style.display = '';
      m.el.style.transform = `translate(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px) translate(-50%, -100%)`;
      m.el.classList.toggle('on', m.active); m.el.classList.toggle('mini', mini); m.el.style.opacity = m.active || m.kind === 'home' ? 1 : c.far ? 0.95 : Math.max(0.45, 1 - c.dist / 1100);
    }
    const pulse = 1 + Math.sin(t * 4) * 0.12;
    const overview = segs[segI] && (segs[segI].kind === 'orbitHome' || segs[segI].kind === 'intro');
    for (const p of [...pois, ...(main ? [main] : [])]) { const on = p.lbl.active; p.ring.scale.setScalar(on ? pulse * 1.35 : 1); p.beam.visible = on || overview; p.beam.material.opacity = on ? 0.8 : 0.35; p.beam.scale.y = on ? 1.6 : 1; p.ring.material.depthTest = !on; p.beam.material.depthTest = !on; p.ring.renderOrder = on ? 7 : 0; p.beam.renderOrder = on ? 7 : 0; }
    homeBeam.material.opacity = 0.22 + Math.sin(t * 2) * 0.06;
  }
  function update(dt) {
    if (running && !free) {
      T += dt; while (segI < segs.length - 1 && T >= segs[segI + 1].t0) enterSeg(segI + 1);
      if (segI < 0) enterSeg(0);
      if (T >= TOTAL) { running = false; opts.onDone && opts.onDone(); }
      const s = segs[segI]; const u = Math.min(1, (T - s.t0) / s.dur); const pz = segPose(s, u);
      applyPose(pz, T);
      // Эргэлтэд онгоц шиг хазайна (зүүн тийш эргэхэд зүүн тийш), нисэх үед бага зэрэг хэлбэлзэнэ
      const bank = s.kind === 'fly' || s.kind === 'hop' || s.kind === 'far' || s.kind === 'orbit' || s.kind === 'orbitHome';
      if (bank && dt > 0) { const dv = pose.tgt.clone().sub(camera.position); const yaw = Math.atan2(dv.x, dv.z); if (lastYaw != null) { const dy = Math.atan2(Math.sin(yaw - lastYaw), Math.cos(yaw - lastYaw)); const tr = Math.max(-0.16, Math.min(0.16, (dy / dt) * 0.35)); roll += (tr - roll) * (1 - Math.exp(-dt * 2.2)); } lastYaw = yaw; }
      else { roll += (0 - roll) * (1 - Math.exp(-dt * 3)); lastYaw = null; }
      if (s.kind === 'fly' || s.kind === 'orbit') { camera.position.y += Math.sin(T * 0.83) * 0.35; camera.lookAt(pose.tgt); }
      if (Math.abs(roll) > 1e-4) camera.rotateZ(roll);
      // маршрут урагшилж зурагдана
      if (s.kind === 'fly') setRibbon(s.p.rib, smooth5(u) * 1.02); if (s.kind === 'far') setRibbon(s.d.rib, s.from ? 1 : ease(u) * 1.02); if (s.kind === 'climb' && s.d.rib) setRibbon(s.d.rib, 0.02);
    } else if (free) {
      const sp = Math.max(8, camera.position.y * 0.9) * dt; let f = 0, st = 0, up = 0;
      if (keys.w || keys.ArrowUp) f += 1; if (keys.s || keys.ArrowDown) f -= 1; if (keys.a || keys.ArrowLeft) st -= 1; if (keys.d || keys.ArrowRight) st += 1; if (keys.e || keys.PageUp) up += 1; if (keys.q || keys.PageDown) up -= 1;
      const fx = -Math.sin(look.yaw), fz = -Math.cos(look.yaw), rx = Math.cos(look.yaw), rz = -Math.sin(look.yaw);
      camera.position.x += (fx * f + rx * st) * sp; camera.position.z += (fz * f + rz * st) * sp; camera.position.y = Math.max(1.7, Math.min(2500, camera.position.y + up * sp));
      camera.rotation.set(look.pitch, look.yaw, 0, 'YXZ');
    }
    updateLabels();
  }
  function start(atSeconds = 0) { free = false; running = true; roll = 0; lastYaw = null; T = Math.max(0, Math.min(TOTAL - 0.01, atSeconds)); segI = -1; let i = 0; while (i < segs.length - 1 && T >= segs[i + 1].t0) i++; for (let k = 0; k <= i; k++) { segI = k - 1; enterSeg(k); if (k < i) { const s = segs[k]; const pz = segPose(s, 1); applyPose(pz, s.t0 + s.dur); if (s.kind === 'fly') setRibbon(s.p.rib, 1); if (s.kind === 'far') setRibbon(s.d.rib, 1); } } }
  function setFree(on) {
    if (on && !free) { const d = pose.tgt.clone().sub(camera.position); look.yaw = Math.atan2(-d.x, -d.z); look.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)); }
    free = on; if (!on) { running = true; if (segI >= 0) { T = segs[segI].t0; base.pos.copy(camera.position); base.pos.y -= liftAt(T); camera.getWorldDirection(base.tgt); base.tgt.multiplyScalar(80).add(camera.position); enterSeg(segI); } }
  }
  function drag(dx, dy) { if (!free) setFree(true); look.yaw -= dx * 0.004; look.pitch = Math.max(-1.45, Math.min(1.2, look.pitch - dy * 0.003)); }
  function setVisible(on) { if (labelsEl) labelsEl.style.display = on ? '' : 'none'; const hud = $('#extHud'); if (hud) hud.style.display = on ? '' : 'none'; }
  // Минимап (дээрээс): барилга, зам, маршрут, камер
  const mapPts = { b: (ext.buildings || []).map((b) => pairs(b.p)), r: (ext.roads || []).filter((r) => r.k !== 'path').map((r) => ({ p: pairs(r.p), k: r.k })) };
  function drawMap(g, W, H) {
    const R = 420 + Math.min(1600, camera.position.y * 2.2); const cx = camera.position.x, cz = camera.position.z; const sc = Math.min(W, H) / (2 * R);
    const X = (x) => W / 2 + (x - cx) * sc, Y = (z) => H / 2 + (z - cz) * sc;
    g.fillStyle = '#e9e4d8'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#9aa0a8'; for (const r of mapPts.r) { g.lineWidth = Math.max(1, (r.k === 'major' ? 14 : r.k === 'mid' ? 9 : 5) * sc); g.beginPath(); r.p.forEach(([x, z], i) => (i ? g.lineTo(X(x), Y(z)) : g.moveTo(X(x), Y(z)))); g.stroke(); }
    g.fillStyle = '#c7c2b8'; for (const p of mapPts.b) { if (Math.abs(p[0][0] - cx) > R * 1.2 || Math.abs(p[0][1] - cz) > R * 1.2) continue; g.beginPath(); p.forEach(([x, z], i) => (i ? g.lineTo(X(x), Y(z)) : g.moveTo(X(x), Y(z)))); g.closePath(); g.fill(); }
    if (homeInfo.pts) { g.fillStyle = '#fb7185'; g.beginPath(); homeInfo.pts.forEach(([x, z], i) => (i ? g.lineTo(X(x), Y(z)) : g.moveTo(X(x), Y(z)))); g.closePath(); g.fill(); }
    const s = segs[segI]; const act = s && (s.p || s.to || s.d);
    if (act && act.pts) { g.strokeStyle = (CAT[act.cat] || CAT.home).c; g.lineWidth = 4; g.beginPath(); act.pts.forEach(([x, z], i) => (i ? g.lineTo(X(x), Y(z)) : g.moveTo(X(x), Y(z)))); g.stroke(); }
    for (const p of [...pois, ...(main ? [main] : [])]) { g.fillStyle = (CAT[p.cat] || CAT.home).c; g.beginPath(); g.arc(X(p.x), Y(p.z), p.lbl.active ? 7 : 4, 0, 7); g.fill(); }
    const d = pose.tgt.clone().sub(camera.position); const yaw = free ? look.yaw : Math.atan2(-d.x, -d.z);
    g.fillStyle = 'rgba(37,99,235,.28)'; g.beginPath(); g.moveTo(W / 2, H / 2); g.arc(W / 2, H / 2, 40, -yaw - Math.PI / 2 - 0.55, -yaw - Math.PI / 2 + 0.55); g.closePath(); g.fill();
    g.fillStyle = '#2563eb'; g.beginPath(); g.arc(W / 2, H / 2, 6, 0, 7); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke();
  }
  const liftInfo = () => segs.map((sg) => `${sg.kind}${sg.p || sg.to ? '/' + (sg.p || sg.to).cat : ''}:${Math.round(Math.max(0, ...(LIFT || []).slice(Math.floor(sg.t0 / LIFT_DT), Math.ceil((sg.t0 + sg.dur) / LIFT_DT) + 1)))}`).join(' ');
  return { scene, camera, update, start, setFree, drag, setVisible, drawMap, segs, TOTAL, liftInfo, get free() { return free; }, get running() { return running; }, get T() { return T; } };
}
