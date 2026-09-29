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
  bank: { c: '#0891b2', ic: 'building-2', mn: 'Банк' }, post: { c: '#64748b', ic: 'archive', mn: 'Шуудан' }, gov: { c: '#475569', ic: 'shield-check', mn: 'Төрийн үйлчилгээ' },
};
const FLY_ORDER = ['grocery', 'pharmacy', 'health', 'parking', 'playground', 'park', 'sport', 'kinder', 'school', 'bus', 'mall'];
const LIST_ORDER = [...FLY_ORDER, 'college', 'bank', 'post', 'gov']; // жагсаалтад бүгд; нислэг зөвхөн fly тэмдэгтэй (эсвэл ангилал бүрийн хамгийн ойр)
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
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.3; scene.add(ground);

  // Талбай (ногоон байгууламж, тоглоомын талбай, зогсоол, сургуулийн хашаа)
  const AREA_C = { park: '#8fb56a', grass: '#9fbd78', playground: '#e2b98a', pitch: '#6aa35c', parking: '#8a8e95', school: '#d8c8a4' };
  const areaY = { school: 0.05, grass: 0.07, park: 0.08, parking: 0.1, pitch: 0.11, playground: 0.12 };
  const ag = new GB(); for (const a of ext.areas || []) ag.poly(pairs(a.p), areaY[a.k] || 0.06, hex(AREA_C[a.k] || '#b0b0b0'));
  const areaMesh = ag.mesh(new THREE.MeshLambertMaterial({ vertexColors: true, map: noiseTex('#ffffff', 26, 128), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })); if (areaMesh) scene.add(areaMesh);

  // Замууд: ангиллаар өргөн, асфальт/явган замын өнгө, гол замд төвийн шугам
  const RC = { major: '#4a4e55', mid: '#575b62', minor: '#62666d', service: '#6d7178', path: '#c4bdae' };
  const RY = { major: 0.34, mid: 0.31, minor: 0.28, service: 0.25, path: 0.22 };
  const rg = new GB();
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
  }
  const roadMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, map: noiseTex('#ffffff', 16, 128), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const roadMesh = rg.mesh(roadMat); if (roadMesh) scene.add(roadMesh);

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
  const homeInfo = { c: [0, 0], h: 27, pts: null }; const playRoof = new GB();
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
  for (const b of ext.buildings || []) if (b.rp === 'playground') { const pts = pairs(b.p); if (pts.length >= 3) playRoof.poly(pts, Math.max(2.8, b.lv * FL + (b.lv > 1 ? 0.6 : 0)) + 0.08, [1, 1, 1], 14); }
  for (const b of ext.far || []) { const pts = pairs(b.p); if (pts.length < 3) continue; const h = b.lv * FL; const c = hex(['#d6d4ce', '#cfd3d7', '#dcd3c4', '#c9ced4'][Math.floor(hash(pts[0][0]) * 4)]); walls(B.far, pts, h, c, 0.7, false); B.far.poly(pts, h, hex('#8f9296')); }
  const blockTex = facadeBlock(), comTex = facadeCom(), houseTex = facadeHouse();
  const addM = (G, mat) => { const m = G.mesh(mat); if (m) scene.add(m); return m; };
  addM(B.block, new THREE.MeshLambertMaterial({ vertexColors: true, map: blockTex }));
  addM(B.com, new THREE.MeshLambertMaterial({ vertexColors: true, map: comTex }));
  addM(B.house, new THREE.MeshLambertMaterial({ vertexColors: true, map: houseTex }));
  addM(B.roof, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, map: noiseTex('#ffffff', 34, 128) }));
  addM(B.far, new THREE.MeshLambertMaterial({ vertexColors: true }));
  addM(playRoof, new THREE.MeshLambertMaterial({ vertexColors: true, map: canvasTex(256, 256, (g, w, h) => { // резин хучилттай тоглоомын талбай
    g.fillStyle = '#c8664f'; g.fillRect(0, 0, w, h); const C = ['#e7c24a', '#6f9fd8', '#79b98a', '#d98fa6', '#ef8f4f']; let sd = 7; const r = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    for (let i = 0; i < 14; i++) { g.fillStyle = C[i % C.length]; g.beginPath(); g.ellipse(r() * w, r() * h, 18 + r() * 40, 14 + r() * 30, r() * 3, 0, 7); g.fill(); }
    g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 3; g.beginPath(); g.arc(w / 2, h / 2, 60, 0, 7); g.stroke();
  }), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
  const homeMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: facadeBlock(), emissive: new THREE.Color('#3a1a12'), emissiveIntensity: 0.12 });
  addM(B.home, homeMat);

  // Арк (угсармал байрны доорх явган гарц): маршрут байрыг нэвт гардаг газарт харанхуй нүх (хоёр фасадаас харагдана)
  { const archMat = new THREE.MeshLambertMaterial({ color: '#2b2d31' }); for (const [x, z, ang, len] of ext.arches || []) { const m = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3.6, len + 1.2), archMat); m.position.set(x, 1.8, z); m.rotation.y = ang; scene.add(m); } }
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
      for (let i = 0; i < n; i++) { const [x, z, r] = spots[i]; q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r); M.compose(new THREE.Vector3(x, 0.13, z), q, new THREE.Vector3(1, 1, 1)); cm.setMatrixAt(i, M); col.set(CC[Math.floor(hash(i * 5.3) * CC.length)]); cm.setColorAt(i, col); }
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
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.5, z); scene.add(m); return m;
  }
  function addLabel(kind, x, y, z, title, sub, extra = '') {
    const s = CAT[kind] || CAT.home; const el = document.createElement('div'); el.className = `xl xl-${kind === 'home' ? 'home' : 'poi'}`; el.style.willChange = 'transform';
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
    p.lbl = addLabel(p.cat, p.x, 24, p.z, p.cat === 'main' ? p.name : p.name, `${fmtM(p.m)} · алхаж ${p.walkMin} мин`);
  }
  const dests = (ext.dests || []).map((d) => ({ ...d, cat: d.id }));
  for (const d of dests) { const s = CAT[d.cat] || CAT.center; d.beam = beam(d.x, d.z, 380, s.c, 9, 0.28); const row = ext.study && ext.study.rows && ext.study.rows.find((r) => r.id === d.id); d.kmShow = row && row.km ? row.km : d.km; d.lbl = addLabel(d.cat, d.x, 70, d.z, d.name, d.kmShow ? `машинаар ${d.kmShow} км` : ''); }

  // ---------- Маршрут: тасралтгүй нарийн тод шугам + үзүүрийн сум ----------
  // Шугамын өргөн дэлгэц дээр тогтмол (пикселээр) — өндрөөс ч, ойроос ч нарийн, тод; урагшлалт нь тасралтгүй (shader-ийн uHead)
  const LINE_U = { uPx: { value: 0.0012 }, uTime: { value: 0 } }; // uPx: 1 м зайд 1 пиксел хэдэн метр
  const LINE_VS = `attribute float aDist; attribute float aSide; attribute vec2 aOff;
    uniform float uPx; uniform float uHalfPx; uniform float uMinW;
    varying float vDist; varying float vSide;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      float hw = max(uMinW, distance(wp.xyz, cameraPosition) * uPx * uHalfPx);
      wp.xz += aOff * hw; vDist = aDist; vSide = aSide;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`;
  const LINE_FS = `uniform vec3 uColor; uniform float uHead; uniform float uOpacity; uniform float uTime; uniform float uCore;
    varying float vDist; varying float vSide;
    void main() {
      if (vDist > uHead) discard;
      float e = abs(vSide);
      float a = uCore > 0.5 ? 1.0 - smoothstep(0.6, 1.0, e) : (1.0 - e) * (1.0 - e);
      float flow = 0.5 + 0.5 * sin((vDist - uTime * 10.0) * 0.22);
      vec3 c = uCore > 0.5 ? mix(uColor, vec3(1.0), 0.3 * (1.0 - e) + 0.08 * flow) : uColor;
      gl_FragColor = vec4(c, a * uOpacity);
      #include <colorspace_fragment>
    }`;
  const lines = [];
  function dedupe(pts, min = 0.8) { const P = []; for (const q of pts) { const l = P[P.length - 1]; if (!l || Math.hypot(q[0] - l[0], q[1] - l[1]) > min) P.push(q); } return P; }
  function cleanRoute(pts) { // алхах маршрутын эхлэл/төгсгөлийн «гаргалт», >120° буцалтыг арилгана (шугам, камер савлахгүй)
    const P = dedupe(pts || []); let guard = 0, changed = true;
    while (changed && P.length > 2 && guard++ < 60) {
      changed = false;
      for (let i = 1; i < P.length - 1; i++) {
        const a = P[i - 1], b = P[i], c = P[i + 1]; const ux = b[0] - a[0], uz = b[1] - a[1], vx = c[0] - b[0], vz = c[1] - b[1]; const lu = Math.hypot(ux, uz), lv = Math.hypot(vx, vz);
        if (lu > 0.01 && lv > 0.01 && (ux * vx + uz * vz) / (lu * lv) < -0.5 && Math.min(lu, lv) < 35) {
          // буцалтын оройг хасахгүй (тэгвэл барилга огтолдог): өмнөх цэгээс дараагийн хэрчим рүү перпендикуляр буулгана → явган замаа дагана
          const t = Math.max(0, Math.min(1, ((a[0] - b[0]) * vx + (a[1] - b[1]) * vz) / (lv * lv))); P[i] = [b[0] + vx * t, b[1] + vz * t];
          if (Math.hypot(P[i][0] - c[0], P[i][1] - c[1]) < 0.8) P.splice(i, 1); changed = true; break;
        }
      }
    }
    return P;
  }
  function smoothCurve(pts) { // centripetal Catmull-Rom; нумын уртын нягт хуваалт → жигд хурд
    const P = cleanRoute(pts); if (P.length < 2) return null;
    const c = new THREE.CatmullRomCurve3(P.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal', 0.5);
    let L0 = 0; for (let i = 1; i < P.length; i++) L0 += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
    c.arcLengthDivisions = Math.max(200, Math.ceil(L0 / 0.5)); c.updateArcLengths(); return c;
  }
  function arrowShape(k) { // үзүүр (0,0) → урагш −Z; k = хүрээний томруулалт (жингийн төвөөр)
    const cy = -0.66; const P = [[0, 0], [0.62, -1.1], [0, -0.78], [-0.62, -1.1]].map(([x, y]) => [x * k, cy + (y - cy) * k]);
    const sh = new THREE.Shape(); sh.moveTo(P[0][0], P[0][1]); for (const q of P.slice(1)) sh.lineTo(q[0], q[1]); sh.closePath();
    const g = new THREE.ShapeGeometry(sh); g.rotateX(-Math.PI / 2); return g;
  }
  // Барилгын тор: маршрутын шугамыг ханаас ≥1.6 м зайд байлгах (дотор нь орсон бол гадагш түлхэнэ); аркийн гарц үл хамаарна
  const BG = (() => { const cs = 20, key = (i, j) => i * 100003 + j, M = new Map(), polys = [];
    for (const b of ext.buildings || []) { const P = pairs(b.p); if (P.length < 3) continue; const bi = polys.length; polys.push(P); let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of P) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } for (let i = Math.floor((x0 - 3) / cs); i <= Math.floor((x1 + 3) / cs); i++) for (let j = Math.floor((z0 - 3) / cs); j <= Math.floor((z1 + 3) / cs); j++) { const k = key(i, j); if (!M.has(k)) M.set(k, []); M.get(k).push(bi); } }
    return { cs, key, M, polys };
  })();
  const inArch = (x, z) => (ext.arches || []).some(([ax, az, ang, len]) => { const dx = x - ax, dz = z - az, fx = Math.sin(ang), fz = Math.cos(ang); return Math.abs(dx * fx + dz * fz) < len / 2 + 2 && Math.abs(-dx * fz + dz * fx) < 2.5; });
  function pushOut(x, z, clear = 1.6) {
    if (inArch(x, z)) return [x, z];
    for (let it = 0; it < 3; it++) {
      const L = BG.M.get(BG.key(Math.floor(x / BG.cs), Math.floor(z / BG.cs))); if (!L) break; let moved = false;
      for (const bi of L) { const P = BG.polys[bi]; const inside = inPolyB(x, z, P); let bd = Infinity, fx = 0, fz = 0;
        for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[j], c = P[i], dx = c[0] - a[0], dz = c[1] - a[1], L2 = dx * dx + dz * dz || 1; const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2)); const qx = a[0] + dx * t, qz = a[1] + dz * t, d = Math.hypot(x - qx, z - qz); if (d < bd) { bd = d; fx = qx; fz = qz; } }
        if (inside) { const ux = fx - x, uz = fz - z, l = Math.hypot(ux, uz) || 1; x = fx + (ux / l) * clear; z = fz + (uz / l) * clear; moved = true; }
        else if (bd < clear) { const ux = x - fx, uz = z - fz, l = Math.hypot(ux, uz) || 1; x = fx + (ux / l) * clear; z = fz + (uz / l) * clear; moved = true; }
      }
      if (!moved) break;
    }
    return [x, z];
  }
  function routeLine(pts, color, far) {
    const c = smoothCurve(pts); if (!c) return null;
    const total = c.getLength(), n = Math.max(2, Math.ceil(total / (far ? 3 : 1)) + 1);
    let S = c.getSpacedPoints(n - 1).map((v) => (far ? [v.x, v.z] : pushOut(v.x, v.z))); if (!far) S = S.map((q, i) => (i === 0 || i === S.length - 1 ? q : [(S[i - 1][0] + 2 * q[0] + S[i + 1][0]) / 4, (S[i - 1][1] + 2 * q[1] + S[i + 1][1]) / 4])); const cum = [0]; // ханаас хол, бага зэрэг тэгшилсэн
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(S[i][0] - S[i - 1][0], S[i][1] - S[i - 1][1]));
    const y = far ? 2.2 : 0.6; const pos = [], off = [], side = [], dist = [], idx = [];
    for (let i = 0; i < n; i++) {
      const a = S[Math.max(0, i - 1)], b = S[Math.min(n - 1, i + 1)]; let tx = b[0] - a[0], tz = b[1] - a[1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      for (const sd of [1, -1]) { pos.push(S[i][0], y, S[i][1]); off.push(-tz * sd, tx * sd); side.push(sd); dist.push(cum[i]); }
      if (i < n - 1) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aOff', new THREE.Float32BufferAttribute(off, 2));
    g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1)); g.setAttribute('aDist', new THREE.Float32BufferAttribute(dist, 1)); g.setIndex(idx);
    const col = new THREE.Color(color), head = { value: 0 };
    const mk = (core, halfPx, op, xray, add) => {
      const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: { uPx: LINE_U.uPx, uTime: LINE_U.uTime, uHead: head, uHalfPx: { value: halfPx }, uMinW: { value: far ? 1.5 : 0.15 }, uColor: { value: col }, uOpacity: { value: op }, uCore: { value: core } },
        vertexShader: LINE_VS, fragmentShader: LINE_FS, transparent: true, depthWrite: false, depthTest: !xray, side: THREE.DoubleSide, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending }));
      m.frustumCulled = false; m.renderOrder = xray ? 13 : core ? 12 : 11; m.visible = false; scene.add(m); return m;
    };
    const meshes = [mk(0, 8, 0.28, false, true), mk(1, 2.6, 1, false, false)]; // гэрэлтэлт, гол шугам (барилгын цаагуур нэвт харуулахгүй — камер өөрөө харагдах өнцгөө сонгоно)
    const arrow = new THREE.Group(); const am = (k, clr, ro) => { const m = new THREE.Mesh(arrowShape(k), new THREE.MeshBasicMaterial({ color: clr, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -10 })); m.renderOrder = ro; arrow.add(m); };
    am(1.34, '#ffffff', 14); am(1, col.clone().lerp(new THREE.Color('#ffffff'), 0.1), 15); arrow.visible = false; scene.add(arrow);
    const pointAt = (d) => { const r = at(d); return [r[0], r[1]]; };
    const at = (d) => { d = Math.max(0, Math.min(total, d)); let lo = 0, hi = n - 1; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid; } const k = (d - cum[lo]) / (cum[hi] - cum[lo] || 1); let tx = S[hi][0] - S[lo][0], tz = S[hi][1] - S[lo][1]; const tl = Math.hypot(tx, tz) || 1; return [S[lo][0] + (S[hi][0] - S[lo][0]) * k, S[lo][1] + (S[hi][1] - S[lo][1]) * k, tx / tl, tz / tl]; };
    let mode = 'off';
    const L = {
      total, pointAt,
      setHead(d) { head.value = d; },
      setMode(m) { mode = m; for (const q of meshes) q.visible = m !== 'off'; if (m === 'off') arrow.visible = false; },
      distNear(x, z) { let bd = Infinity, bi = 0; for (let i = 0; i < n; i++) { const dd = Math.hypot(S[i][0] - x, S[i][1] - z); if (dd < bd) { bd = dd; bi = i; } } return cum[bi]; },
      tick() { // сумыг шугамын үзүүрт тавьж, дэлгэц дээр тогтмол хэмжээтэй (≈20 px) болгоно
        if (mode === 'off') return; const d = Math.min(head.value, total); if (d < 1.5) { arrow.visible = false; return; }
        const [x, z, tx, tz] = at(d); const dd = Math.hypot(camera.position.x - x, camera.position.y - y, camera.position.z - z); const s = Math.max(far ? 12 : 1.1, dd * LINE_U.uPx.value * 20);
        arrow.visible = true; arrow.position.set(x + tx * s * 0.78, y + 0.05, z + tz * s * 0.78); arrow.rotation.y = Math.atan2(-tx, -tz); arrow.scale.setScalar(s);
      },
    };
    lines.push(L); return L;
  }
  const hasFly = pois.some((p) => p.fly); const flySet = new Set(hasFly ? pois.filter((p) => p.fly) : FLY_ORDER.map((cat) => pois.find((p) => p.cat === cat)).filter(Boolean));
  for (const p of [...pois, ...(main ? [main] : [])]) { p.pts = pairs(p.route || []); p.flyOn = p === main || flySet.has(p); if (p.lbl) p.lbl.fly = p.flyOn; p.line = p.flyOn ? routeLine(p.pts, (CAT[p.cat] || CAT.home).c, false) : null; }
  for (const d of dests) if (d.route) { d.pts = pairs(d.route); d.line = routeLine(d.pts, (CAT[d.cat] || CAT.center).c, true); }
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
  // Толгой эргүүлэхгүй зарчим: зураг авалт бүр зөвхөн шулуун шилжилт (эргэлт/хазайлт/хэлбэлзэлгүй), зураг авалт хооронд
  // зөөлөн fade-ээр шууд дараагийн эхлэлд очно (байрны дээгүүр буцаж нисэхгүй); бүх хөдөлгөөн пүршээр тэгшлэгдэнэ.
  const home3 = new THREE.Vector3(homeInfo.c[0], homeInfo.h * 0.55, homeInfo.c[1]);
  const pose = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const cruise = (u, a = 0.2) => { // жигд хурд: зөөлөн хурдасч, тогтмол хурдтай явж, зөөлөн зогсоно (оргил хурд = дундажийн 1/(1−a))
    u = Math.max(0, Math.min(1, u)); const A = 1 - a, F = (x) => x / 2 - (a / (2 * Math.PI)) * Math.sin((Math.PI * x) / a);
    return (u < a ? F(u) : u > 1 - a ? A - F(1 - u) : a / 2 + (u - a)) / A;
  };
  function pathSampler(pts) { // камерын зам: цэвэрлэсэн маршрутыг ±30 м цонхоор тэгшилсэн (төгсгөл хэвээр) → хажуу тийш савлахгүй
    const c = smoothCurve(pts); if (!c) return null; const L0 = c.getLength(), n = Math.max(2, Math.ceil(L0 / 2) + 1); const S = c.getSpacedPoints(n - 1); const step = L0 / (n - 1);
    const Q = S.map((_, i) => { const w = Math.min(Math.round(30 / step), i, n - 1 - i); let x = 0, z = 0; for (let k = -w; k <= w; k++) { x += S[i + k].x; z += S[i + k].z; } return [x / (2 * w + 1), z / (2 * w + 1)]; });
    const cum = [0]; for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(Q[i][0] - Q[i - 1][0], Q[i][1] - Q[i - 1][1])); const L = cum[n - 1];
    return { L, at: (d) => { d = Math.max(0, Math.min(L, d)); let lo = 0, hi = n - 1; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid; } const k = (d - cum[lo]) / (cum[hi] - cum[lo] || 1); return V(Q[lo][0] + (Q[hi][0] - Q[lo][0]) * k, 0, Q[lo][1] + (Q[hi][1] - Q[lo][1]) * k); } };
  }
  function headingOf(sp) { const h = sp.at(sp.L).sub(sp.at(0)).setY(0); return h.lengthSq() < 400 ? V(0, 0, -1) : h.normalize(); } // эхлэлээс очих газар руу (тогтмол)
  const flyByOrder = FLY_ORDER.flatMap((cat) => pois.filter((p) => p.cat === cat && p.flyOn).sort((a, b) => a.m - b.m));
  const A0 = 1.35; // тойм: байрны урд (нартай) талаас хойш харна
  const FADE = 1.3;
  const segs = [];
  segs.push({ kind: 'intro', dur: 12, cap: { icon: 'plane-landing', t: 'Бодит орчны 3D нислэг', s: opts.title || 'Таны байрны орчин', d: 'OpenStreetMap + хиймэл дагуулын ML барилгын контур · GHSL өндөр' } });
  segs.push({ kind: 'orbitHome', dur: 7, cap: { icon: 'house', t: 'Таны байр', s: ext.home && ext.home.lv ? `${ext.home.lv} давхар байр` : 'Орон сууц', d: 'Эргэн тойрны үйлчилгээний цэгүүд' } });
  for (const p of [...flyByOrder, ...(main ? [main] : [])]) {
    const sp = p.pts && p.pts.length > 1 ? pathSampler(p.pts) : null; if (!sp) continue; p.sp = sp; const H = headingOf(sp);
    segs.push({ kind: 'fade', dur: FADE, to: p });
    segs.push({ kind: 'fly', dur: Math.max(6.5, Math.min(22, sp.L / 20)), p, sp, H });
    segs.push({ kind: 'hover', dur: p.cat === 'main' ? 6 : 4.5, p, sp, H });
  }
  const w4 = dests.find((d) => d.id === 'west4'), ce = dests.find((d) => d.id === 'center');
  if (w4 && w4.pts) { const sp = pathSampler(w4.pts); if (sp) { const H = headingOf(sp); segs.push({ kind: 'fade', dur: FADE, to: w4 }); segs.push({ kind: 'far', dur: Math.max(10, Math.min(20, sp.L / 140)), d: w4, sp, H, startD: 0 }); segs.push({ kind: 'farHover', dur: 6, d: w4, sp, H }); } }
  if (ce && ce.pts) {
    let i0 = 0; if (w4) { let bd = Infinity; ce.pts.forEach(([x, z], i) => { const dd = Math.hypot(x - w4.x, z - w4.z); if (dd < bd) { bd = dd; i0 = i; } }); }
    const sub = ce.pts.slice(Math.max(0, i0)); const sp = pathSampler(sub.length > 1 ? sub : ce.pts);
    if (sp) { const H = headingOf(sp); const startD = i0 > 0 && ce.line ? ce.line.distNear(ce.pts[i0][0], ce.pts[i0][1]) : 0; segs.push({ kind: 'fade', dur: FADE, to: ce }); segs.push({ kind: 'far', dur: Math.max(10, Math.min(20, sp.L / 140)), d: ce, sp, H, startD }); segs.push({ kind: 'farHover', dur: 6, d: ce, sp, H }); }
  }
  const capEnt = { icon: 'footprints', t: 'Орц', s: 'Байрны дотор руу', d: '' };
  segs.push({ kind: 'fade', dur: FADE, to: null, cap: capEnt });
  segs.push({ kind: 'approach', dur: 12, cap: capEnt });
  segs.forEach((s, i) => { if (s.kind === 'fade') s.next = segs[i + 1]; });
  let t0 = 0; for (const s of segs) { s.t0 = t0; t0 += s.dur; } const TOTAL = t0;

  let T = 0, segI = -1, running = false, free = false, fromPose = null;
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
  const base = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() }; // сценарийн (тэгшлээгүй, өргөлтгүй) байрлал
  function capture() { return { pos: base.pos.clone(), tgt: base.tgt.clone() }; }
  // Критик сааруулалттай пүрш: камерын байрлал/харах цэг огцом эргэхгүй, чичрэхгүй (кадрын хугацаанаас хамаарахгүй)
  const sm = { p: new THREE.Vector3(), v: new THREE.Vector3(), t: new THREE.Vector3(), tv: new THREE.Vector3(), init: false };
  function spring(x, v, target, w, dt) { const f = 1 + 2 * dt * w, hoo = dt * w * w, hhoo = dt * hoo, det = 1 / (f + hhoo); for (const k of ['x', 'y', 'z']) { const nx = (f * x[k] + dt * v[k] + hhoo * target[k]) * det; v[k] = (v[k] + hoo * (target[k] - x[k])) * det; x[k] = nx; } }
  const want = new THREE.Vector3();
  function applyPose(pz, t, dt, snap) {
    base.pos.copy(pz.pos); base.tgt.copy(pz.tgt); want.copy(pz.pos); want.y += liftAt(t);
    if (snap || !sm.init || !(dt > 0)) { sm.p.copy(want); sm.t.copy(pz.tgt); sm.v.set(0, 0, 0); sm.tv.set(0, 0, 0); sm.init = true; }
    else { spring(sm.p, sm.v, want, 2.8, dt); spring(sm.t, sm.tv, pz.tgt, 2.8, dt); }
    camera.position.copy(sm.p); pose.tgt.copy(sm.t); camera.up.set(0, 1, 0); camera.lookAt(sm.t); camera.updateMatrixWorld();
  }
  // Өргөлтийн профайл: бүх аяллын хугацааны дагуу (0.2 с алхам) барилга халхлахгүй байх нэмэлт өндөр
  const LIFT_DT = 0.2; let LIFT = null;
  function liftAt(t) { if (!LIFT) return 0; const f = Math.max(0, Math.min(LIFT.length - 1, t / LIFT_DT)); const i = Math.floor(f), k = f - i; return LIFT[i] * (1 - k) + LIFT[Math.min(LIFT.length - 1, i + 1)] * k; }
  function planLift() {
    const LK = new Set(['orbitHome', 'fly', 'hover']); const n = Math.ceil(TOTAL / LIFT_DT) + 2; const need = new Float32Array(n);
    let prev = null; const starts = segs.map((sg) => { fromPose = prev; const st = prev; prev = segPose(sg, 1); return st; });
    let si = 0;
    for (let i = 0; i < n; i++) {
      const t = Math.min(TOTAL - 1e-3, i * LIFT_DT); while (si < segs.length - 1 && t >= segs[si + 1].t0) si++;
      const sg = segs[si]; if (!LK.has(sg.kind)) continue; fromPose = starts[si];
      const uu = Math.min(1, (t - sg.t0) / sg.dur), pz = segPose(sg, uu); need[i] = Math.min(40, Math.max(0, needY(pz.pos, pz.tgt, sg.kind === 'hover' ? 0.8 : 0.55) - pz.pos.y));
      const ln = sg.p && sg.p.line; if (ln && (sg.kind === 'fly' || sg.kind === 'hover')) { // сумны үзүүр (≈0.7 с дараах) харагдах хүртэл камерыг өргөнө (эргэлтээр шийдэгдээгүй үлдэгдэл)
        const hd = sg.kind === 'hover' ? ln.total : ln.total * cruise(Math.min(1, (uu + 0.7 / sg.dur) * 1.1)); const B = ln.pointAt(hd); let dh = 0; while (dh < 45 && !losClear(pz.pos.x, pz.pos.y + dh, pz.pos.z, B[0], B[1])) dh += 3; need[i] = Math.max(need[i], Math.min(45, dh));
      }
    }
    fromPose = null;
    const shot = new Int32Array(n); { let id = 0, fi = 0; const cuts = segs.filter((q) => q.kind === 'fade').map((q) => q.t0 + q.dur / 2); for (let i = 0; i < n; i++) { while (fi < cuts.length && i * LIFT_DT >= cuts[fi]) { fi++; id++; } shot[i] = id; } }
    const w = 3; const L = need.map((_, i) => { let m = 0; for (let k = -w; k <= w; k++) { const j = i + k; if (j >= 0 && j < n && shot[j] === shot[i] && need[j] > m) m = need[j]; } return m; });
    const rise = 8 * LIFT_DT, fall = 5 * LIFT_DT; // м/с хязгаар: огцом үсрэлтгүй (зураг авалт дотроо)
    for (let i = n - 2; i >= 0; i--) if (shot[i] === shot[i + 1]) L[i] = Math.max(L[i], L[i + 1] - rise);
    for (let i = 1; i < n; i++) if (shot[i] === shot[i - 1]) L[i] = Math.max(L[i], L[i - 1] - fall);
    LIFT = L.map((_, i) => { let a = 0, c = 0; for (let k = -3; k <= 3; k++) { const j = i + k; if (j >= 0 && j < n && shot[j] === shot[i]) { a += L[j]; c++; } } return a / c; });
  }
  // Зураг авалтууд (бүгд эргэлтгүй): нислэг = маршрутын дагуу гулсах, очих газар руу тогтмол чиглэл, ≈44° налуу
  const MODES = [{ back: 40, up: 52, ahead: 12 }, { back: 20, up: 68, ahead: 8 }, { back: 7, up: 88, ahead: 4 }]; // энгийн ≈45°, огцом ≈70°, бараг дээрээс (маш нарийн завсарт)
  // Харааны шугам: барилга бүрийн яг контур + өндөр, мод (5 м тороос нарийн) — сум барилга/модоор халхлагдах эсэх
  const OCC = (() => { const cs = 20, key = (i, j) => i * 100003 + j, E = new Map(), Tr = new Map(); const put = (M, i, j, v) => { const k = key(i, j); if (!M.has(k)) M.set(k, []); M.get(k).push(v); };
    for (const b of ext.buildings || []) { const P = pairs(b.p); if (P.length < 3) continue; const h = Math.max(2.8, b.lv * FL + (b.lv > 1 ? 0.6 : 0)) + (b.lv <= 2 ? 1.7 : 1.2); for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[j], c = P[i]; for (let x = Math.floor(Math.min(a[0], c[0]) / cs); x <= Math.floor(Math.max(a[0], c[0]) / cs); x++) for (let z = Math.floor(Math.min(a[1], c[1]) / cs); z <= Math.floor(Math.max(a[1], c[1]) / cs); z++) put(E, x, z, [a[0], a[1], c[0], c[1], h]); } }
    for (const [x, z] of treePts) put(Tr, Math.floor(x / cs), Math.floor(z / cs), [x, z]);
    return { cs, key, E, Tr };
  })();
  function losClear(cx, cy, cz, tx, tz) {
    const dx = tx - cx, dz = tz - cz, dy = 1 - cy, cs = OCC.cs; const i0 = Math.floor(Math.min(cx, tx) / cs), i1 = Math.floor(Math.max(cx, tx) / cs), j0 = Math.floor(Math.min(cz, tz) / cs), j1 = Math.floor(Math.max(cz, tz) / cs); const L2 = dx * dx + dz * dz || 1;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const L = OCC.E.get(OCC.key(i, j)); if (L) for (const [ax, az, bx, bz, h] of L) { const sx = bx - ax, sz = bz - az, den = dx * sz - dz * sx; if (Math.abs(den) < 1e-9) continue; const t = ((ax - cx) * sz - (az - cz) * sx) / den, u = ((ax - cx) * dz - (az - cz) * dx) / den; if (t <= 0.002 || t >= 0.995 || u < 0 || u > 1) continue; if (h + 0.4 > cy + dy * t) return false; }
      const R = OCC.Tr.get(OCC.key(i, j)); if (R) for (const [x, z] of R) { const t = Math.max(0, Math.min(1, ((x - cx) * dx + (z - cz) * dz) / L2)); if (t > 0.97) continue; if (Math.hypot(cx + dx * t - x, cz + dz * t - z) < 2.6 && cy + dy * t < 7.5) return false; }
    }
    return true;
  }
  function planView(s) { // маршрут ба сумны үзүүр барилгаар халхлагдахгүй байх камерын чиглэл — динамик програмчлал (Витерби)
    const N = Math.max(2, Math.ceil(s.dur / 1.0) + 1), K = 24, Y0 = Math.atan2(s.H.x, s.H.z), line = s.p.line, S = MODES.length * K; const C = [];
    for (let i = 0; i < N; i++) {
      const row = new Float32Array(S); const subs = [-0.35, 0, 0.35];
      for (let m = 0; m < MODES.length; m++) for (let k = 0; k < K; k++) {
        const dk = k < K / 2 ? k : k - K, yaw = Y0 + (dk * 2 * Math.PI) / K, fx = Math.sin(yaw), fz = Math.cos(yaw), M = MODES[m]; let c = (Math.abs(dk) / (K / 4)) ** 2 * 4 + m * 4;
        for (const ds of subs) {
          // бодит камер пүршийн улмаас ≈0.7 с хоцордог: хоцорсон байрлалаас одоогийн сумны үзүүр, камерын дор байгаа замын хэсэг хоёуланг шалгана
          const u = Math.max(0, Math.min(1, (i + ds) / (N - 1))), uc = Math.max(0, u - 0.7 / s.dur), p = s.sp.at(s.sp.L * cruise(uc)); const cx = p.x - fx * M.back, cz = p.z - fz * M.back;
          const A = line ? line.pointAt(line.total * cruise(uc)) : [p.x, p.z], B = line ? line.pointAt(line.total * cruise(Math.min(1, u * 1.1))) : A;
          if (!losClear(cx, M.up, cz, A[0], A[1])) c += 12; if (!losClear(cx, M.up, cz, B[0], B[1])) c += 24; if (HG.at(cx, cz) + 8 > M.up) c += 10;
        }
        row[m * K + k] = c;
      }
      C.push(row);
    }
    const D = [C[0].slice()], BK = [];
    for (let i = 1; i < N; i++) { const d = new Float32Array(S), bk = new Int32Array(S); for (let st = 0; st < S; st++) { const m = Math.floor(st / K), k = st % K; let best = Infinity, bi = 0; for (let pm = Math.max(0, m - 1); pm <= Math.min(MODES.length - 1, m + 1); pm++) for (let dd = -1; dd <= 1; dd++) { const pk = (k + dd + K) % K, ps = pm * K + pk, v = D[i - 1][ps] + Math.abs(dd) * 1.5 + (pm !== m ? 4 : 0); if (v < best) { best = v; bi = ps; } } d[st] = best + C[i][st]; bk[st] = bi; } D.push(d); BK.push(bk); }
    let st = 0; for (let q = 1; q < S; q++) if (D[N - 1][q] < D[N - 1][st]) st = q; const seq = [st]; for (let i = N - 1; i > 0; i--) { st = BK[i - 1][st]; seq.unshift(st); }
    const yaw = [], mode = []; let prev = null; for (const q of seq) { const k = q % K, dk = k < K / 2 ? k : k - K; let y = Y0 + (dk * 2 * Math.PI) / K; if (prev != null) while (y - prev > Math.PI) y -= 2 * Math.PI; while (prev != null && prev - y > Math.PI) y += 2 * Math.PI; yaw.push(y); mode.push(Math.floor(q / K)); prev = y; }
    const sm = (a) => a.map((_, i) => (a[Math.max(0, i - 1)] + 2 * a[i] + a[Math.min(a.length - 1, i + 1)]) / 4); // зөөлрүүлэлт
    return { yaw: sm(sm(yaw)), mode: sm(sm(mode)) };
  }
  const cr = (a, f) => { const n = a.length; f = Math.max(0, Math.min(n - 1, f)); const i = Math.min(n - 2, Math.floor(f)), t = f - i; const p0 = a[Math.max(0, i - 1)], p1 = a[i], p2 = a[i + 1], p3 = a[Math.min(n - 1, i + 2)]; return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t); }; // Catmull-Rom (жигд эргэлт)
  function flyPose(s, u) {
    const p = s.sp.at(s.sp.L * cruise(u)); const P = s.plan; const f = P ? u * (P.yaw.length - 1) : 0; const yaw = P ? cr(P.yaw, f) : Math.atan2(s.H.x, s.H.z), w = P ? Math.max(0, Math.min(MODES.length - 1, cr(P.mode, f))) : 0;
    const d = V(Math.sin(yaw), 0, Math.cos(yaw)); const mi = Math.min(MODES.length - 2, Math.floor(w)), mt = w - mi, M0 = MODES[mi], M1 = MODES[mi + 1]; const back = M0.back + (M1.back - M0.back) * mt, up = M0.up + (M1.up - M0.up) * mt, ahead = M0.ahead + (M1.ahead - M0.ahead) * mt;
    return { pos: p.clone().addScaledVector(d, -back).setY(up), tgt: p.clone().addScaledVector(d, ahead).setY(0) };
  }
  const dolly = (f, k) => { const dir = f.tgt.clone().sub(f.pos).normalize(); f.pos.addScaledVector(dir, k); return f; }; // харах чиглэл өөрчлөгдөхгүй ойртолт
  function hoverPose(s, u) { return dolly(flyPose(s, 1), 16 * ease(u)); }
  function farPose(s, u) { const p = s.sp.at(s.sp.L * cruise(u)); return { pos: p.clone().addScaledVector(s.H, -270).setY(280), tgt: p.clone().addScaledVector(s.H, 10).setY(0) }; }
  function farHoverPose(s, u) { return dolly(farPose(s, 1), 90 * ease(u)); }
  // Орцны өмнөх чөлөөт зай: орцноос гадагш цацрагийн дагуу хамгийн ойрын барилгын хана хүртэл (контуртай огтлолцуулж)
  let entFree = null;
  function freeAhead() {
    if (entFree != null) return entFree; const d = entDir(); const ox = ent[0] + d.x * 2, oz = ent[1] + d.z * 2, ex = ox + d.x * 40, ez = oz + d.z * 40; let best = 40;
    for (const b of ext.buildings || []) {
      if (b.t) continue; const P = pairs(b.p); if (P.length < 3 || Math.hypot(P[0][0] - ent[0], P[0][1] - ent[1]) > 140) continue;
      for (let i = 0; i < P.length; i++) { const a = P[i], c = P[(i + 1) % P.length]; const rx = ex - ox, rz = ez - oz, sx = c[0] - a[0], sz = c[1] - a[1]; const den = rx * sz - rz * sx; if (Math.abs(den) < 1e-9) continue; const t = ((a[0] - ox) * sz - (a[1] - oz) * sx) / den, q = ((a[0] - ox) * rz - (a[1] - oz) * rx) / den; if (t >= 0 && t <= 1 && q >= 0 && q <= 1) best = Math.min(best, t * 40); }
    }
    return (entFree = best + 2); // орцноос хэмжсэн зай, м
  }
  function approachPose(u) { // хашаанд (хөрш барилгад хүрэхгүй) бараг босоо бууж (5 с), дараа нь хаалга руу алхана
    const e = V(ent[0], 0, ent[1]); const d = entDir(); const fa = freeAhead(); const x2 = Math.max(5.5, Math.min(13, fa - 2.5)), x1 = Math.max(x2, Math.min(x2 + 4, fa - 1.5)), x3 = Math.min(5.2, x2 - 1.5);
    const p1 = { pos: e.clone().addScaledVector(d, x1).setY(8.5), tgt: e.clone().setY(1.6) };
    const p2 = { pos: e.clone().addScaledVector(d, x2).setY(1.7), tgt: e.clone().addScaledVector(d, -1.5).setY(2.4) };
    const p3 = { pos: e.clone().addScaledVector(d, x3).setY(1.7), tgt: e.clone().addScaledVector(d, -1.5).setY(1.9) };
    const lerp = (a, b, k) => ({ pos: a.pos.clone().lerp(b.pos, k), tgt: a.tgt.clone().lerp(b.tgt, k) });
    return u < 0.58 ? lerp(p1, p2, ease(u / 0.58)) : lerp(p2, p3, ease((u - 0.58) / 0.42));
  }
  function segPose(s, u) { // u ∈ [0,1] сегментийн дотор
    const k = s.kind;
    if (k === 'intro') { const e = ease(u); const r = 2200 - 1950 * e, h = 1500 - 1330 * smooth5(u), a = A0; return { pos: V(home3.x + Math.cos(a) * r, h, home3.z + Math.sin(a) * r), tgt: home3.clone() }; }
    if (k === 'orbitHome') { const e = ease(u); const r = 250 - 40 * e; return { pos: V(home3.x + Math.cos(A0) * r, 170 - 27 * e, home3.z + Math.sin(A0) * r), tgt: home3.clone() }; }
    if (k === 'fade') return u < 0.5 && fromPose ? { pos: fromPose.pos.clone(), tgt: fromPose.tgt.clone() } : segPose(s.next, 0); // эхний хагаст зогсоно, дунд нь таслана
    if (k === 'fly') return flyPose(s, u);
    if (k === 'hover') return hoverPose(s, u);
    if (k === 'far') return farPose(s, u);
    if (k === 'farHover') return farHoverPose(s, u);
    if (k === 'approach') return approachPose(u);
    return { pos: camera.position.clone(), tgt: pose.tgt.clone() };
  }
  // Идэвхтэй зорилт: зөвхөн одоогийн маршрут, цэг, шошго (өмнөх/дараагийнх нуугдана)
  function focusTarget(s) {
    const act = s ? s.p || s.to || s.d || null : null;
    for (const p of [...pois, ...(main ? [main] : [])]) p.lbl.active = p === act;
    for (const d of dests) d.lbl.active = d === act;
    for (const L of lines) L.setMode(act && L === act.line && s.kind !== 'approach' ? 'active' : 'off');
    homeBeam.visible = !!s && ['intro', 'orbitHome', 'far', 'farHover'].includes(s.kind);
  }
  function enterSeg(i) {
    segI = i; const s = segs[i]; fromPose = capture(); s._cut = false;
    if (s.kind !== 'fade') focusTarget(s);
    const cap = s.cap || captionFor(s); if (cap) showCaption(cap, s);
    opts.onSegment && opts.onSegment(i, s);
  }
  const isDest = (o) => dests.includes(o);
  function captionFor(s) {
    const o = s.p || s.to || s.d; if (!o) return null;
    if (isDest(o)) { const st = CAT[o.cat] || CAT.center; const row = ext.study && ext.study.rows.find((r) => r.id === o.id); return { icon: st.ic, t: o.name, s: row ? `Машинаар ${row.km} км · ажлын өдрийн түгжрэлтэй хугацаа` : `Машинаар ${o.km} км`, d: row ? studyLine(row) : 'Замын хугацаа тооцоогүй', c: st.c, chart: row }; }
    const st = CAT[o.cat] || CAT.home; const row = o.cat === 'main' && ext.study ? ext.study.rows.find((r) => r.id === 'main') : null;
    return { icon: st.ic, t: o.cat === 'main' ? `Төв зам — ${o.name}` : st.mn, s: o.cat === 'main' ? `Алхаж ${fmtM(o.m)} · ${o.walkMin} мин` : o.name, d: row ? `Машинаар ${row.km} км · ${studyLine(row)}` : `Алхаж ${fmtM(o.m)} · ${o.walkMin} мин`, c: st.c, chart: row };
  }
  function studyLine(row) { if (!row || !row.byHour) return ''; const at = (h) => { const b = row.byHour.find((x) => x[0] === h); return b && b[1] != null ? `${b[1]} мин` : '—'; }; return `08:00 — ${at(8)} · 13:00 — ${at(13)} · 18:00 — ${at(18)} · хамгийн чөлөөтэй — ${row.free != null ? row.free + ' мин' : '—'}`; }
  let capKey = '';
  function showCaption(c, s) {
    const el = $('#extCaption'); if (!el) return; const o = s.p || s.to || s.d;
    document.querySelectorAll('#extList li').forEach((li) => li.classList.toggle('on', !!o && li.dataset.key === keyOf(o)));
    const key = `${c.t}|${c.s}|${c.d}`; if (key === capKey) return; capKey = key; // ижил тайлбарыг дахин хөдөлгөхгүй
    el.style.setProperty('--c', c.c || '#38bdf8'); el.style.zIndex = '6';
    el.innerHTML = `<div class="xc-ic">${ic(c.icon || 'map-pin')}</div><div class="xc-b"><div class="xc-t">${esc(c.t)}</div>${c.s ? `<div class="xc-s">${esc(c.s)}</div>` : ''}${c.d ? `<div class="xc-d">${esc(c.d)}</div>` : ''}${c.chart ? chartSvg(c.chart) : ''}</div>`;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }
  const keyOf = (p) => (p.cat === 'main' ? 'main' : isDest(p) ? p.id : `${p.cat}:${p.idx}`);
  function chartSvg(row) { // ажлын өдрийн цаг тус бүрийн хугацаа (06–23), машинаар
    const hs = row.byHour.filter((b) => b[1] != null); if (!hs.length) return ''; const mx = Math.max(...hs.map((b) => b[1])); const W = 300, Hh = 64;
    const bars = row.byHour.map((b, i) => { const v = b[1] || 0; const h = mx ? (v / mx) * (Hh - 18) : 0; const x = 6 + i * ((W - 12) / row.byHour.length); const peak = v === mx; return `<rect x="${x.toFixed(1)}" y="${(Hh - 12 - h).toFixed(1)}" width="${((W - 12) / row.byHour.length - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="${peak ? '#f43f5e' : 'rgba(255,255,255,.78)'}"/>${b[0] % 3 === 0 ? `<text x="${(x + 4).toFixed(1)}" y="${Hh - 1}" font-size="9" fill="rgba(255,255,255,.7)">${b[0]}</text>` : ''}`; }).join('');
    return `<svg class="xc-chart" viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}">${bars}<text x="4" y="10" font-size="10" fill="rgba(255,255,255,.75)">Ажлын өдөр, машинаар</text><text x="${W - 4}" y="10" font-size="10" text-anchor="end" fill="#fecdd3">оргил ${mx} мин</text></svg>`;
  }
  // Баруун самбар: бүх цэгийн жагсаалт (дарахад fade-ээр тэр хэсэг рүү шилжинэ)
  function syncBaseFromCamera() { base.pos.copy(camera.position); base.pos.y -= liftAt(T); camera.getWorldDirection(base.tgt); base.tgt.multiplyScalar(80).add(camera.position); sm.p.copy(camera.position); sm.t.copy(base.tgt); sm.v.set(0, 0, 0); sm.tv.set(0, 0, 0); sm.init = true; }
  let pend = null; // fade-гүй зорилт руу шилжих түр fade { i, t, cut }
  function jumpTo(i) { free = false; running = true; if (segs[i].kind === 'fade') { T = segs[i].t0; syncBaseFromCamera(); enterSeg(i); pend = null; } else { syncBaseFromCamera(); pend = { i, t: 0, cut: false }; } }
  function buildList() {
    const el = $('#extList'); if (!el) return;
    const rows = []; const fly = new Map(); segs.forEach((s, i) => { if (s.kind === 'fade' && s.to && !fly.has(keyOf(s.to))) fly.set(keyOf(s.to), i); });
    for (const cat of LIST_ORDER) for (const p of pois.filter((q) => q.cat === cat).sort((a, b) => a.m - b.m)) { const st = CAT[p.cat]; const si = fly.get(keyOf(p)); rows.push(`<li ${si != null ? `data-seg="${si}"` : ''} data-key="${keyOf(p)}" style="--c:${st.c}">${ic(st.ic)}<span><b>${esc(p.name)}</b><i>${esc(st.mn)}</i></span><em>${fmtM(p.m)}<small>${p.walkMin} мин</small></em></li>`); }
    if (main) { const row = ext.study && ext.study.rows.find((r) => r.id === 'main'); rows.push(`<li data-seg="${fly.get('main') ?? ''}" data-key="main" style="--c:${CAT.main.c}">${ic('route')}<span><b>${esc(main.name)}</b><i>Төв зам${row && row.peak != null ? ` · машинаар ${row.free}–${row.peak} мин` : ''}</i></span><em>${fmtM(main.m)}<small>${main.walkMin} мин</small></em></li>`); }
    for (const d of dests) { const row = ext.study && ext.study.rows.find((r) => r.id === d.id); const st = CAT[d.cat] || CAT.center; rows.push(`<li data-seg="${fly.get(d.id) ?? ''}" data-key="${d.id}" style="--c:${st.c}">${ic(st.ic)}<span><b>${esc(d.name)}</b><i>${row && row.peak != null ? `оргил ${row.peak} мин (${row.peakHour}:00)` : 'машинаар'}</i></span><em>${row && row.km ? row.km : d.km ? d.km : '—'} км<small>${row && row.free != null ? row.free + '–' + row.peak + ' мин' : ''}</small></em></li>`); }
    el.innerHTML = rows.join('');
    el.querySelectorAll('li[data-seg]').forEach((li) => li.addEventListener('click', () => { const i = +li.dataset.seg; if (li.dataset.seg !== '' && Number.isFinite(i)) { jumpTo(i); opts.onResume && opts.onResume(); } }));
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
  // Fade давхарга (зураг авалт хоорондын зөөлөн шилжилт); тайлбар (z 6) болон дээд самбар дээгүүр биш
  const fadeEl = document.createElement('div'); fadeEl.style.cssText = 'position:fixed;inset:0;background:#0b1220;opacity:0;pointer-events:none;z-index:3'; document.body.appendChild(fadeEl); let fadeO = 0;
  for (const q of ['.top', '#map']) { const el = $(q); if (el && !el.style.zIndex) el.style.zIndex = '5'; }
  const setFade = (o) => { if (Math.abs(o - fadeO) > 0.004 || (o === 0 && fadeO !== 0)) { fadeO = o; fadeEl.style.opacity = o.toFixed(3); } };
  for (let i = 0; i < segs.length; i++) if (segs[i].kind === 'fly') { segs[i].plan = planView(segs[i]); if (segs[i + 1] && segs[i + 1].kind === 'hover') segs[i + 1].plan = segs[i].plan; } // камерын чиглэл (халхлалтгүй)
  planLift();
  buildList();

  // ---------- Шинэчлэлт ----------
  const tmpV = new THREE.Vector3();
  function effSeg() { const s = segs[segI]; if (!s || s.kind !== 'fade') return s; return s._cut ? s.next : segs[segI - 1] || null; } // fade-ийн үеийн «бодит» зураг авалт
  function updateLabels(now) {
    const w = innerWidth, h = innerHeight; const cand = []; const es = effSeg(); const kind = es ? es.kind : '';
    const overview = kind === 'intro' || kind === 'orbitHome'; const farK = kind === 'far' || kind === 'farHover';
    for (const m of markers) {
      tmpV.copy(m.pos).project(camera); const vis = tmpV.z < 1 && tmpV.z > -1 && Math.abs(tmpV.x) < 1.1 && Math.abs(tmpV.y) < 1.1;
      const dist = camera.position.distanceTo(m.pos); const far = m.kind === 'west4' || m.kind === 'center';
      const x = ((tmpV.x + 1) / 2) * w; let y = ((1 - tmpV.y) / 2) * h; if (m.active && vis && y <= 92) y = 92; // идэвхтэй шошгыг дэлгэцэн дотор барина
      const allow = m.active || (m.kind === 'home' && kind !== 'approach') || (overview && !far && m.fly && dist < 900) || (farK && far);
      if (!(vis && y > 86 && allow)) { if (m.shown !== false) { m.el.style.display = 'none'; m.shown = false; } m.hv = false; m.hp = null; continue; }
      cand.push({ m, x, y, dist, far, pri: m.active ? 0 : m.kind === 'home' ? 1 : far ? 2 : 3 });
    }
    cand.sort((a, b) => a.pri - b.pri || a.dist - b.dist); const placed = [];
    for (const id of ['#extCaption', '#extPanel', '#map']) { const el = $(id); if (el && el.offsetParent !== null) { const b = el.getBoundingClientRect(); if (b.width) placed.push([b.left, b.top, b.right, b.bottom]); } }
    for (const c of cand) {
      const { m } = c; const mini = !m.active && m.kind !== 'home' && !c.far; const bw = m.bw || 40 + m.tl * (mini ? 6.3 : 8), bh = m.bh || (mini ? 26 : 44);
      const r = [c.x - bw / 2, c.y - bh, c.x + bw / 2, c.y];
      const over = c.pri !== 0 && placed.some((q) => r[0] < q[2] + 4 && r[2] + 4 > q[0] && r[1] < q[3] + 3 && r[3] + 3 > q[1]);
      // Гистерезис: давхцал 0.5 с үргэлжилбэл нууна, чөлөөлөгдөөд 0.3 с болсны дараа гаргана (анивчихгүй)
      if (c.pri === 0) { m.hv = true; m.hp = null; } else if (over === !!m.hv) { if (m.hp == null) m.hp = now; if (now - m.hp > (over ? 0.5 : 0.3)) { m.hv = !over; m.hp = null; } } else m.hp = null;
      if (!m.hv) { if (m.shown !== false) { m.el.style.display = 'none'; m.shown = false; } continue; }
      placed.push(r); if (m.shown !== true) { m.el.style.display = ''; m.shown = true; }
      m.el.style.transform = `translate3d(${c.x.toFixed(2)}px, ${c.y.toFixed(2)}px, 0) translate(-50%, -100%)`;
      if (m.on !== m.active || m.mini !== mini) { m.on = m.active; m.mini = mini; m.el.classList.toggle('on', m.active); m.el.classList.toggle('mini', mini); m.bw = m.el.offsetWidth; m.bh = m.el.offsetHeight; } // ангилал солигдоход л хэмжинэ
      const op = m.active || m.kind === 'home' ? 1 : c.far ? 0.95 : Math.max(0.5, 1 - c.dist / 1200); if (Math.abs((m.op ?? -1) - op) > 0.03) { m.op = op; m.el.style.opacity = op.toFixed(2); }
    }
    for (const p of [...pois, ...(main ? [main] : [])]) { const on = p.lbl.active; p.ring.visible = on || (overview && p.flyOn); p.beam.visible = on || (overview && p.flyOn); p.ring.scale.setScalar(on ? 1.35 : 1); p.beam.material.opacity = on ? 0.75 : 0.3; p.beam.scale.y = on ? 1.6 : 1; p.ring.material.depthTest = true; p.beam.material.depthTest = true; }
    for (const d of dests) d.beam.visible = farK || overview || d.lbl.active;
  }
  function update(dt) {
    const now = performance.now() / 1000; let fo = null;
    if (pend && running && !free) { pend.t += dt; const pu = Math.min(1, pend.t / FADE); fo = ease(1 - Math.abs(2 * pu - 1)); if (!pend.cut && pu >= 0.5) { pend.cut = true; T = segs[pend.i].t0; enterSeg(pend.i); applyPose(segPose(segs[pend.i], 0), T, 0, true); } if (pu >= 1) pend = null; }
    if (running && !free && !(pend && !pend.cut)) {
      T += dt; while (segI < segs.length - 1 && T >= segs[segI + 1].t0) enterSeg(segI + 1);
      if (segI < 0) enterSeg(0);
      if (T >= TOTAL) { running = false; opts.onDone && opts.onDone(); }
      const s = segs[segI]; const u = Math.min(1, (T - s.t0) / s.dur); let snap = false;
      if (s.kind === 'fade' && u >= 0.5 && !s._cut) { s._cut = true; snap = true; if (s.next) focusTarget(s.next); } // харанхуй үед таслана
      applyPose(segPose(s, u), T, dt, snap);
      setFade(fo != null ? fo : s.kind === 'fade' ? ease(1 - Math.abs(2 * u - 1)) : 0);
      // маршрут жигд, тасралтгүй урагшилна (камераас бага зэрэг түрүүлнэ)
      if (s.kind === 'fly' && s.p.line) s.p.line.setHead(s.p.line.total * cruise(Math.min(1, u * 1.1)));
      else if (s.kind === 'hover' && s.p.line) s.p.line.setHead(s.p.line.total);
      else if (s.kind === 'far' && s.d.line) s.d.line.setHead(s.startD + (s.d.line.total - s.startD) * cruise(Math.min(1, u * 1.08)));
      else if (s.kind === 'farHover' && s.d.line) s.d.line.setHead(s.d.line.total);
      else if (s.kind === 'fade' && s._cut && s.next) { const tg = s.next.p || s.next.d; if (tg && tg.line) tg.line.setHead(s.next.kind === 'far' ? s.next.startD : 0); }
    } else if (free) {
      const sp = Math.max(8, camera.position.y * 0.9) * dt; let f = 0, st = 0, up = 0;
      if (keys.w || keys.ArrowUp) f += 1; if (keys.s || keys.ArrowDown) f -= 1; if (keys.a || keys.ArrowLeft) st -= 1; if (keys.d || keys.ArrowRight) st += 1; if (keys.e || keys.PageUp) up += 1; if (keys.q || keys.PageDown) up -= 1;
      const fx = -Math.sin(look.yaw), fz = -Math.cos(look.yaw), rx = Math.cos(look.yaw), rz = -Math.sin(look.yaw);
      camera.position.x += (fx * f + rx * st) * sp; camera.position.z += (fz * f + rz * st) * sp; camera.position.y = Math.max(1.7, Math.min(2500, camera.position.y + up * sp));
      camera.rotation.set(look.pitch, look.yaw, 0, 'YXZ'); setFade(0);
    } else if (fo != null) setFade(fo);
    // Ойрын хавтгай камерын доорх гадаргуугаас хамаарна → алсын зам/талбай/газар анивчихгүй (z-fighting)
    const clr = camera.position.y - HG.at(camera.position.x, camera.position.z); const nr = Math.max(0.25, Math.min(30, clr * 0.15));
    if (Math.abs(nr - camera.near) > camera.near * 0.08) { camera.near = nr; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
    LINE_U.uPx.value = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, innerHeight); LINE_U.uTime.value = now;
    for (const L of lines) L.tick();
    updateLabels(now);
  }
  function start(atSeconds = 0) {
    free = false; running = true; T = Math.max(0, Math.min(TOTAL - 0.01, atSeconds)); segI = -1; let i = 0; while (i < segs.length - 1 && T >= segs[i + 1].t0) i++;
    pend = null; for (let k = 0; k <= i; k++) { segI = k - 1; enterSeg(k); if (k < i) { const s = segs[k]; applyPose(segPose(s, 1), s.t0 + s.dur, 0, true); const tg = (s.kind === 'fly' || s.kind === 'hover') ? s.p : (s.kind === 'far' || s.kind === 'farHover') ? s.d : null; if (tg && tg.line) tg.line.setHead(tg.line.total); } }
    const s = segs[i]; const u = Math.min(1, (T - s.t0) / s.dur); if (s.kind === 'fade' && u >= 0.5) { s._cut = true; if (s.next) focusTarget(s.next); }
    applyPose(segPose(s, u), T, 0, true); setFade(s.kind === 'fade' ? ease(1 - Math.abs(2 * u - 1)) : 0);
  }
  function setFree(on) {
    if (on && !free) { const d = pose.tgt.clone().sub(camera.position); look.yaw = Math.atan2(-d.x, -d.z); look.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)); }
    if (on) { free = true; return; }
    if (!free) return; let k = segI; while (k > 0 && segs[k].kind !== 'fade') k--; if (k <= 0 || segs[k].kind !== 'fade') k = 1; // өмнөх fade-ээс, эсвэл тоймоос (түр fade-ээр) үргэлжилнэ
    jumpTo(Math.min(k, segs.length - 1));
  }
  function drag(dx, dy) { if (!free) setFree(true); look.yaw -= dx * 0.004; look.pitch = Math.max(-1.45, Math.min(1.2, look.pitch - dy * 0.003)); }
  function setVisible(on) { if (labelsEl) labelsEl.style.display = on ? '' : 'none'; const hud = $('#extHud'); if (hud) hud.style.display = on ? '' : 'none'; if (!on) setFade(0); }
  // Минимап (дээрээс): барилга, зам, маршрут, камер
  const mapPts = { b: (ext.buildings || []).map((b) => pairs(b.p)), r: (ext.roads || []).filter((r) => r.k !== 'path').map((r) => ({ p: pairs(r.p), k: r.k })) };
  function drawMap(g, W, H) {
    const R = 420 + Math.min(1600, camera.position.y * 2.2); const cx = camera.position.x, cz = camera.position.z; const sc = Math.min(W, H) / (2 * R);
    const X = (x) => W / 2 + (x - cx) * sc, Y = (z) => H / 2 + (z - cz) * sc;
    g.fillStyle = '#e9e4d8'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#9aa0a8'; for (const r of mapPts.r) { g.lineWidth = Math.max(1, (r.k === 'major' ? 14 : r.k === 'mid' ? 9 : 5) * sc); g.beginPath(); r.p.forEach(([x, z], i) => (i ? g.lineTo(X(x), Y(z)) : g.moveTo(X(x), Y(z)))); g.stroke(); }
    g.fillStyle = '#c7c2b8'; for (const p of mapPts.b) { if (Math.abs(p[0][0] - cx) > R * 1.2 || Math.abs(p[0][1] - cz) > R * 1.2) continue; g.beginPath(); p.forEach(([x, z], i) => (i ? g.lineTo(X(x), Y(z)) : g.moveTo(X(x), Y(z)))); g.closePath(); g.fill(); }
    if (homeInfo.pts) { g.fillStyle = '#fb7185'; g.beginPath(); homeInfo.pts.forEach(([x, z], i) => (i ? g.lineTo(X(x), Y(z)) : g.moveTo(X(x), Y(z)))); g.closePath(); g.fill(); }
    const s = effSeg(); const act = s && (s.p || s.to || s.d);
    if (act && act.pts) { g.strokeStyle = (CAT[act.cat] || CAT.home).c; g.lineWidth = 4; g.beginPath(); act.pts.forEach(([x, z], i) => (i ? g.lineTo(X(x), Y(z)) : g.moveTo(X(x), Y(z)))); g.stroke(); }
    for (const p of [...pois, ...(main ? [main] : [])]) { g.fillStyle = (CAT[p.cat] || CAT.home).c; g.beginPath(); g.arc(X(p.x), Y(p.z), p.lbl.active ? 7 : 4, 0, 7); g.fill(); }
    const d = pose.tgt.clone().sub(camera.position); const yaw = free ? look.yaw : Math.atan2(-d.x, -d.z);
    g.fillStyle = 'rgba(37,99,235,.28)'; g.beginPath(); g.moveTo(W / 2, H / 2); g.arc(W / 2, H / 2, 40, -yaw - Math.PI / 2 - 0.55, -yaw - Math.PI / 2 + 0.55); g.closePath(); g.fill();
    g.fillStyle = '#2563eb'; g.beginPath(); g.arc(W / 2, H / 2, 6, 0, 7); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke();
  }
  const liftInfo = () => segs.map((sg) => `${sg.kind}${sg.p || sg.to ? '/' + (sg.p || sg.to).cat : ''}:${Math.round(Math.max(0, ...(LIFT || []).slice(Math.floor(sg.t0 / LIFT_DT), Math.ceil((sg.t0 + sg.dur) / LIFT_DT) + 1)))}`).join(' ');
  return { scene, camera, update, start, setFree, drag, setVisible, drawMap, segs, TOTAL, liftInfo, _los: losClear, get free() { return free; }, get running() { return running; }, get T() { return T; } };
}
