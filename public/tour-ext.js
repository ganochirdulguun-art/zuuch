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
const FLY_MAX = { grocery: 450, pharmacy: 450, health: 450, parking: 350, playground: 450, park: 500, sport: 450, bus: 600, kinder: 800, school: 800, mall: 800 }; // алхах, м — хол бол нисэхгүй (exterior.js-тэй ижил; хуучин өгөгдөлд ч үйлчилнэ)
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
// ---------- Бодит фасадын текстур: 1 текстур = FT_B цонхны зай × FT_F давхар; өнгө (map) + гялгар (roughnessMap) хос ----------
// Угсармал байр: хавтангийн заадас, цонх бүр өөр (хөшиг, тусгал), шилжүүлсэн тагт, доошоо бага зэрэг бохирдол
const FT_B = 4, FT_F = 3;
function texPair(w, h, draw) { // draw(g, w, h, rough) — rough=true үед гялгарын зургийг (цагаан = барзгар) зурна
  const mk = (rough) => canvasTex(w, h, (g) => draw(g, w, h, rough));
  const map = mk(false), rough = mk(true); rough.colorSpace = THREE.NoColorSpace; return { map, rough };
}
function rngOf(seed) { let sd = seed; return () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; }; }
const facadeBlock = () => texPair(512, 360, (g, w, h, R) => {
  const r = rngOf(11); const bw = w / FT_B, fh = h / FT_F;
  g.fillStyle = R ? '#ececec' : '#f0ece4'; g.fillRect(0, 0, w, h);
  if (!R) { // хавтангийн бүдэг толбо, заадас
    for (let k = 0; k < 90; k++) { g.fillStyle = `rgba(${r() < 0.5 ? '120,110,95' : '255,255,250'},${0.03 + r() * 0.04})`; g.fillRect(r() * w, r() * h, 20 + r() * 60, 10 + r() * 40); }
    g.fillStyle = 'rgba(70,60,50,.16)'; for (let f = 0; f <= FT_F; f++) g.fillRect(0, f * fh - 1, w, 2); for (let b = 0; b <= FT_B; b++) g.fillRect(b * bw - 1, 0, 2, h);
  }
  for (let f = 0; f < FT_F; f++) for (let b = 0; b < FT_B; b++) {
    const x0 = b * bw, y0 = f * fh; const balcony = (b % 2 === 1) && r() < 0.8;
    if (balcony) { // шилжүүлсэн (хаалттай) тагт — хүрээтэй шил, доод хэсэг хавтан
      const bx = x0 + 10, by = y0 + 18, bww = bw - 20, bh = fh - 26;
      g.fillStyle = R ? '#dedede' : '#e4dfd6'; g.fillRect(bx - 3, by - 3, bww + 6, bh + 6);
      g.fillStyle = R ? '#e0e0e0' : ['#d9d4ca', '#cfc6b8', '#e2ddd3'][Math.floor(r() * 3)]; g.fillRect(bx, by + bh * 0.58, bww, bh * 0.42);
      const gl = g.createLinearGradient(0, by, 0, by + bh * 0.58); gl.addColorStop(0, R ? '#303030' : '#aebfcc'); gl.addColorStop(1, R ? '#404040' : '#55677a'); g.fillStyle = gl; g.fillRect(bx, by, bww, bh * 0.58);
      g.fillStyle = R ? '#9a9a9a' : '#f3f1ec'; for (let k = 1; k < 4; k++) g.fillRect(bx + (bww * k) / 4 - 2, by, 4, bh * 0.58); g.fillRect(bx, by + bh * 0.58 - 3, bww, 5);
    } else { // энгийн цонх: гүн нүх, хүрээ, шил (хөшиг/тусгал өөр өөр)
      const ww = bw * 0.52, wh = fh * 0.56, wx = x0 + (bw - ww) / 2, wy = y0 + fh * 0.2;
      g.fillStyle = R ? '#c8c8c8' : 'rgba(60,55,50,.55)'; g.fillRect(wx - 4, wy - 4, ww + 8, wh + 10);
      const t = r(); const gl = g.createLinearGradient(wx, wy, wx + ww * 0.6, wy + wh);
      if (R) { gl.addColorStop(0, '#262626'); gl.addColorStop(1, '#3a3a3a'); }
      else if (t < 0.35) { gl.addColorStop(0, '#c3d3df'); gl.addColorStop(1, '#5d7185'); } // тэнгэрийн тусгал
      else if (t < 0.7) { gl.addColorStop(0, '#6f7a82'); gl.addColorStop(1, '#2f363d'); } // бараан
      else { gl.addColorStop(0, '#e9e1cf'); gl.addColorStop(1, '#b9ab8f'); } // хөшигтэй
      g.fillStyle = gl; g.fillRect(wx, wy, ww, wh);
      g.fillStyle = R ? '#8c8c8c' : (r() < 0.8 ? '#f4f2ed' : '#7a5a44'); g.fillRect(wx + ww * 0.5 - 2, wy, 4, wh); g.fillRect(wx, wy + wh * 0.32, ww, 4); // хүрээ
      g.fillStyle = R ? '#d0d0d0' : '#d8d3ca'; g.fillRect(wx - 6, wy + wh + 3, ww + 12, 6); // тавцан
    }
  }
  if (!R) { const gd = g.createLinearGradient(0, 0, 0, h); gd.addColorStop(0, 'rgba(255,255,255,0)'); gd.addColorStop(1, 'rgba(90,80,65,.08)'); g.fillStyle = gd; g.fillRect(0, 0, w, h); }
});
const facadeCom = () => texPair(512, 360, (g, w, h, R) => { // шилэн фасад + хөндлөн хавтан (худалдаа, оффис, сургууль)
  const r = rngOf(29); g.fillStyle = R ? '#e6e6e6' : '#e3e5e6'; g.fillRect(0, 0, w, h); const fh = h / FT_F;
  for (let f = 0; f < FT_F; f++) {
    const y = f * fh + fh * 0.18, hh = fh * 0.64; const gl = g.createLinearGradient(0, y, w * 0.3, y + hh);
    if (R) { gl.addColorStop(0, '#1e1e1e'); gl.addColorStop(1, '#2e2e2e'); } else { gl.addColorStop(0, '#9fb4c4'); gl.addColorStop(0.55, '#5f7486'); gl.addColorStop(1, '#3d4c5a'); }
    g.fillStyle = gl; g.fillRect(0, y, w, hh);
    g.fillStyle = R ? '#7a7a7a' : '#c9cdd0'; for (let x = 0; x < w; x += w / 8) g.fillRect(x - 2, y, 4, hh);
    if (!R) for (let k = 0; k < 5; k++) { g.fillStyle = `rgba(255,255,255,${0.05 + r() * 0.08})`; g.fillRect(r() * w, y, 30 + r() * 60, hh); }
  }
});
const facadeInd = () => texPair(512, 360, (g, w, h, R) => { // 1 текстур = 4 зай × 3 давхар өндөр; намхан барилгад доод 1–2 «давхар» л харагдана
  const r = rngOf(17); g.fillStyle = R ? '#e0e0e0' : '#dcd9d2'; g.fillRect(0, 0, w, h); const fh = h / FT_F, bw = w / FT_B;
  if (!R) { for (let x = 0; x < w; x += 16) { g.fillStyle = `rgba(0,0,0,${0.03 + (x / 16 % 2) * 0.03})`; g.fillRect(x, 0, 8, h); } for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(110,100,85,${0.03 + r() * 0.05})`; g.fillRect(r() * w, r() * h, 30 + r() * 60, 10 + r() * 30); } }
  for (let f = 0; f < FT_F; f++) for (let b = 0; b < FT_B; b++) { // давхар бүрийн дээд хэсэгт хэвтээ цонхны тууз
    const x = b * bw + 10, y = h - (f + 1) * fh + fh * 0.18, ww = bw - 20, hh = fh * 0.26; const gl = g.createLinearGradient(0, y, 0, y + hh);
    gl.addColorStop(0, R ? '#303030' : '#9fb0bd'); gl.addColorStop(1, R ? '#3a3a3a' : '#556573'); g.fillStyle = gl; g.fillRect(x, y, ww, hh);
    g.fillStyle = R ? '#8a8a8a' : '#e9e7e2'; for (let k = 1; k < 3; k++) g.fillRect(x + (ww * k) / 3 - 2, y, 4, hh);
  }
  g.fillStyle = R ? '#cfcfcf' : 'rgba(80,75,65,.22)'; for (let f = 0; f < FT_F; f++) g.fillRect(0, h - f * fh - 3, w, 3);
});
const TW_B = 8, TW_F = 4;
const facadeTower = (accent, edge, seed) => texPair(1024, 480, (g, w, h, R) => {
  const r = rngOf(seed); const bw = w / TW_B, fh = h / TW_F;
  g.fillStyle = R ? '#e8e8e8' : '#efede9'; g.fillRect(0, 0, w, h);
  if (!R) { g.fillStyle = 'rgba(120,115,105,.10)'; for (let y = 0; y < h; y += fh / 2) g.fillRect(0, y, w, 1.5); for (let x = 0; x < w; x += bw / 2) g.fillRect(x, 0, 1.5, h); for (let k = 0; k < 60; k++) { g.fillStyle = `rgba(${r() < 0.5 ? '130,120,105' : '255,255,255'},${0.02 + r() * 0.04})`; g.fillRect(r() * w, r() * h, 30 + r() * 80, 10 + r() * 40); } }
  const band = (x0, x1, col) => { // өнгөт тоосго/хавтангийн зурвас
    g.fillStyle = R ? '#f2f2f2' : col; g.fillRect(x0, 0, x1 - x0, h);
    if (!R) { g.fillStyle = 'rgba(0,0,0,.07)'; for (let y = 0, row = 0; y < h; y += 6, row++) { g.fillRect(x0, y, x1 - x0, 1); for (let x = x0 + (row % 2) * 7; x < x1; x += 14) g.fillRect(x, y, 1, 6); } }
  };
  band(3 * bw, 5 * bw, accent); if (edge) { band(0, bw * 0.7, edge); band(w - bw * 0.7, w, edge); }
  for (let f = 0; f < TW_F; f++) for (let b = 0; b < TW_B; b++) {
    const inBand = b === 3 || b === 4; const ww = bw * (inBand ? 0.36 : 0.5), wh = fh * (inBand ? 0.5 : 0.56), wx = b * bw + (bw - ww) / 2, wy = f * fh + fh * 0.2;
    g.fillStyle = R ? '#c4c4c4' : 'rgba(70,65,60,.45)'; g.fillRect(wx - 3, wy - 3, ww + 6, wh + 8);
    const t = r(); const gl = g.createLinearGradient(wx, wy, wx + ww * 0.7, wy + wh);
    if (R) { gl.addColorStop(0, '#222222'); gl.addColorStop(1, '#363636'); }
    else if (t < 0.45) { gl.addColorStop(0, '#c9d8e3'); gl.addColorStop(1, '#5f7488'); } else if (t < 0.78) { gl.addColorStop(0, '#76818a'); gl.addColorStop(1, '#323a42'); } else { gl.addColorStop(0, '#ece4d3'); gl.addColorStop(1, '#bcae93'); }
    g.fillStyle = gl; g.fillRect(wx, wy, ww, wh);
    g.fillStyle = R ? '#8a8a8a' : '#fafaf8'; g.fillRect(wx + ww * 0.5 - 2, wy, 4, wh); g.fillRect(wx - 2, wy - 2, ww + 4, 3); g.fillRect(wx - 2, wy + wh - 1, ww + 4, 3);
    if (!R) { g.fillStyle = 'rgba(90,85,75,.18)'; g.fillRect(wx - 5, wy + wh + 3, ww + 10, 4); }
  }
  if (!R) { g.fillStyle = 'rgba(90,85,75,.16)'; for (let f = 0; f <= TW_F; f++) g.fillRect(0, f * fh - 1.5, w, 3); }
});
const facadePodium = () => texPair(512, 240, (g, w, h, R) => { // цамхагийн доод 2 давхар: хүрэн тоосгон өнгөлгөө, 1-р давхарт үйлчилгээний том цонх
  const r = rngOf(37); const bw = w / 4, fh = h / 2; g.fillStyle = R ? '#ededed' : '#8d5d45'; g.fillRect(0, 0, w, h);
  if (!R) for (let y = 0, row = 0; y < h; y += 5, row++) { g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(0, y, w, 1); for (let x = (row % 2) * 6; x < w; x += 12) { g.fillRect(x, y, 1, 5); if (r() < 0.25) { g.fillStyle = `rgba(${r() < 0.5 ? '255,220,190' : '40,20,10'},.08)`; g.fillRect(x + 1, y + 1, 10, 4); g.fillStyle = 'rgba(0,0,0,.12)'; } } }
  for (let b = 0; b < 4; b++) {
    const gx = b * bw + 8, gy = h - fh + 14, gw = bw - 16, gh = fh - 16; const gl = g.createLinearGradient(0, gy, 0, gy + gh); gl.addColorStop(0, R ? '#202020' : '#8fa3b2'); gl.addColorStop(1, R ? '#303030' : '#3f4d58');
    g.fillStyle = R ? '#9a9a9a' : '#d9d6d0'; g.fillRect(gx - 4, gy - 4, gw + 8, gh + 4); g.fillStyle = gl; g.fillRect(gx, gy, gw, gh); g.fillStyle = R ? '#9a9a9a' : '#d9d6d0'; g.fillRect(gx + gw / 2 - 2, gy, 4, gh);
    const ww = bw * 0.5, wh = fh * 0.52, wx = b * bw + (bw - ww) / 2, wy = fh * 0.22; const g2 = g.createLinearGradient(wx, wy, wx + ww, wy + wh); g2.addColorStop(0, R ? '#262626' : '#b9c9d5'); g2.addColorStop(1, R ? '#383838' : '#56697a');
    g.fillStyle = R ? '#c0c0c0' : 'rgba(40,30,25,.5)'; g.fillRect(wx - 3, wy - 3, ww + 6, wh + 7); g.fillStyle = g2; g.fillRect(wx, wy, ww, wh); g.fillStyle = R ? '#8a8a8a' : '#f5f3ef'; g.fillRect(wx + ww / 2 - 2, wy, 4, wh);
  }
  if (!R) { g.fillStyle = '#d6d2ca'; g.fillRect(0, fh - 4, w, 6); }
});
const facadeHouse = () => texPair(256, 240, (g, w, h, R) => { // хувийн байшин: шавардлага/тоосго, жижиг цонх
  const r = rngOf(5); g.fillStyle = R ? '#efefef' : '#efe8dc'; g.fillRect(0, 0, w, h);
  if (!R) { for (let k = 0; k < 60; k++) { g.fillStyle = `rgba(110,90,70,${0.03 + r() * 0.05})`; g.fillRect(r() * w, r() * h, 8 + r() * 30, 4 + r() * 14); } g.fillStyle = 'rgba(0,0,0,.05)'; for (let y = 0; y < h; y += 14) g.fillRect(0, y, w, 1); }
  g.fillStyle = R ? '#bbbbbb' : '#5a4a3c'; g.fillRect(86, 72, 84, 92); const gl = g.createLinearGradient(0, 78, 0, 158); gl.addColorStop(0, R ? '#303030' : '#9fb2c0'); gl.addColorStop(1, R ? '#404040' : '#4c5d6b'); g.fillStyle = gl; g.fillRect(92, 78, 72, 80);
  g.fillStyle = R ? '#999' : '#efe8dc'; g.fillRect(125, 78, 6, 80);
});
// Зөөлөн, давтагдахгүй шуугиан (value noise, олон октав) → өнгөний шатлал
function fbmTex(size, stops, oct = 5, seed = 3) {
  return canvasTex(size, size, (g, w, h) => {
    const r = rngOf(seed); const grids = [];
    for (let o = 0; o < oct; o++) { const n = 4 << o; const a = new Float32Array((n + 1) * (n + 1)); for (let i = 0; i < a.length; i++) a[i] = r(); for (let k = 0; k <= n; k++) { a[k * (n + 1) + n] = a[k * (n + 1)]; a[n * (n + 1) + k] = a[k]; } grids.push([n, a]); }
    const im = g.createImageData(w, h); const cs = stops.map(([t, c]) => [t, new THREE.Color(c)]);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = 0, amp = 0.5, tot = 0;
      for (const [n, a] of grids) { const fx = (x / w) * n, fy = (y / h) * n, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy; const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty); const q = (i, j) => a[(iy + j) * (n + 1) + ix + i]; v += amp * ((q(0, 0) * (1 - sx) + q(1, 0) * sx) * (1 - sy) + (q(0, 1) * (1 - sx) + q(1, 1) * sx) * sy); tot += amp; amp *= 0.55; }
      v /= tot; let k = 0; while (k < cs.length - 2 && v > cs[k + 1][0]) k++; const [t0, c0] = cs[k], [t1, c1] = cs[k + 1]; const u = Math.max(0, Math.min(1, (v - t0) / (t1 - t0 || 1)));
      const o = (y * w + x) * 4; im.data[o] = (c0.r + (c1.r - c0.r) * u) * 255; im.data[o + 1] = (c0.g + (c1.g - c0.g) * u) * 255; im.data[o + 2] = (c0.b + (c1.b - c0.b) * u) * 255; im.data[o + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  });
}
const noiseTex = (base, amp = 18, size = 256) => canvasTex(size, size, (g, w, h) => {
  const im = g.createImageData(w, h); const c = new THREE.Color(base); const R = c.r * 255, G = c.g * 255, B = c.b * 255;
  for (let i = 0; i < w * h; i++) { const n = (Math.random() - 0.5) * amp; im.data[i * 4] = R + n; im.data[i * 4 + 1] = G + n; im.data[i * 4 + 2] = B + n * 0.9; im.data[i * 4 + 3] = 255; }
  g.putImageData(im, 0, 0);
});
const stdMat = (o) => new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, ...o });

// ---------- Сцен барих ----------
export function createExterior(ext, opts = {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 12000);
  const SKY_H = new THREE.Color('#e4e3dc'), SKY_Z = new THREE.Color('#6a9bcf');
  scene.fog = new THREE.FogExp2(SKY_H, 0.00021); // агаарын гүн: 1 км ≈ 4%, 3 км ≈ 33%, 5 км ≈ 67%
  // Тэнгэр: босоо градиент бөмбөрцөг
  {
    const g = new THREE.SphereGeometry(9000, 32, 16); const col = []; const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) { const y = pos.getY(i) / 9000; const k = Math.pow(Math.max(0, y), 0.55); const c = SKY_H.clone().lerp(SKY_Z, k); col.push(c.r, c.g, c.b); }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));
  }
  scene.add(new THREE.HemisphereLight(0xe2e6ea, 0x8b857a, 0.72));
  // Нар: өмнөд-баруунаас ~30° өндөрт (намрын үдээс хойш) — урт, бодит сүүдэр. Сүүдрийн хайрцаг камерын харж буй цэгийг дагана (update)
  const SUN_DIR = new THREE.Vector3(-900, 900, 1300).normalize();
  const sun = new THREE.DirectionalLight(0xfff0d6, 2.7); sun.position.copy(SUN_DIR).multiplyScalar(1600);
  const SH_MAP = Math.min(4096, (opts.renderer && opts.renderer.capabilities.maxTextureSize) || 2048) >= 4096 && !(navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) < 900) ? 4096 : 2048;
  sun.castShadow = true; sun.shadow.mapSize.set(SH_MAP, SH_MAP); sun.shadow.bias = -0.00035; sun.shadow.normalBias = 0.45;
  Object.assign(sun.shadow.camera, { near: 50, far: 4200, left: -400, right: 400, top: 400, bottom: -400 }); sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun, sun.target);
  // Орчны гэрэл/тусгал (цонхны шил тэнгэрийг тусгана): тэнгэр + газраас PMREM
  if (opts.renderer) {
    try {
      const es = new THREE.Scene(); const sg = new THREE.SphereGeometry(100, 32, 16); const sc = []; const sp = sg.attributes.position;
      for (let i = 0; i < sp.count; i++) { const y = sp.getY(i) / 100; const c = y < 0 ? new THREE.Color('#7d7563') : SKY_H.clone().lerp(SKY_Z, Math.pow(y, 0.55)); sc.push(c.r, c.g, c.b); }
      sg.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3)); es.add(new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
      const pm = new THREE.PMREMGenerator(opts.renderer); scene.environment = pm.fromScene(es, 0.03).texture; scene.environmentIntensity = 0.38; pm.dispose();
    } catch { /* сул GPU — орчны тусгалгүй */ }
  }

  // Газар
  const groundTex = fbmTex(512, [[0, '#a9a397'], [0.45, '#b8b2a5'], [0.62, '#b3aea1'], [0.8, '#aba898'], [1, '#bfbaad']], 5, 7); groundTex.repeat.set(1100, 1100);
  const macroTex = fbmTex(256, [[0, '#dcdcd0'], [0.4, '#f4f1ea'], [0.6, '#ffffff'], [0.85, '#e9e9dc'], [1, '#dfe2d2']], 4, 19); macroTex.colorSpace = THREE.SRGBColorSpace;
  const groundMat = stdMat({ map: groundTex, roughness: 1 });
  const GS = 14000, GR = 1100; // газрын хавтгайн хэмжээ (м) ба бүтцийн давталт
  const SAT_K = 0.94; // хиймэл дагуулын өнгө → 3D альбедо (газар ба дээвэрт ижил)
  const satU = { satMap: { value: new THREE.DataTexture(new Uint8Array(4), 1, 1) }, satRect: { value: new THREE.Vector4(0, 0, 1, 1) }, satOn: { value: 0 }, gAvg: { value: new THREE.Color('#b3aea1') } };
  groundMat.onBeforeCompile = (sh) => {
    sh.uniforms.macroMap = { value: macroTex }; Object.assign(sh.uniforms, satU);
    sh.fragmentShader = 'uniform sampler2D macroMap; uniform sampler2D satMap; uniform vec4 satRect; uniform float satOn; uniform vec3 gAvg;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
  vec3 gBase = diffuseColor.rgb * texture2D(macroMap, vMapUv * 0.018).rgb;
  if (satOn > 0.5) {
    vec2 gp = vec2((vMapUv.x / ${GR}.0 - 0.5) * ${GS}.0, (0.5 - vMapUv.y / ${GR}.0) * ${GS}.0);
    vec2 su = vec2((gp.x - satRect.x) / satRect.z, 1.0 - (gp.y - satRect.y) / satRect.w);
    vec4 sc = texture2D(satMap, clamp(su, 0.0, 1.0));
    float a = sc.a * step(0.0, su.x) * step(su.x, 1.0) * step(0.0, su.y) * step(su.y, 1.0);
    a *= mix(0.62, 1.0, smoothstep(70.0, 520.0, length(vViewPosition))); // ойрд 10 м-ийн пиксел бүдэг — нарийн бүтэцтэй холино
    vec3 det = mix(vec3(1.0), diffuseColor.rgb / gAvg, 0.6);
    diffuseColor.rgb = mix(gBase, sc.rgb * det * ${SAT_K.toFixed(3)}, a);
  } else diffuseColor.rgb = gBase;`);
  };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(GS, GS), groundMat);
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.3; ground.receiveShadow = true; scene.add(ground);

  // Хиймэл дагуулын газрын дэвсгэр (Contains modified Copernicus Sentinel data 2025): байхгүй/алдаатай бол fbm газар хэвээр
  let areaMesh = null;
  const loadSat = async () => {
    const o = ext.origin; if (!o || !Number.isFinite(o.lat)) return;
    const S = await (await fetch('/geo/s2/index.json')).json(); if (!S || !S.bbox) return;
    const [W, S0, E, N] = S.bbox, [TI, TJ] = S.tile, [DX, DY] = S.px, SR = 3400;
    const kx = Math.cos((o.lat * Math.PI) / 180) * 111320, kz = 110540;
    const lngA = Math.max(W, o.lng - SR / kx), lngB = Math.min(E, o.lng + SR / kx), latA = Math.max(S0, o.lat - SR / kz), latB = Math.min(N, o.lat + SR / kz);
    if (lngB <= lngA || latB <= latA) return;
    const px0 = Math.floor((lngA - W) / DX), px1 = Math.ceil((lngB - W) / DX), py0 = Math.floor((N - latB) / DY), py1 = Math.ceil((N - latA) / DY);
    const cv = document.createElement('canvas'); cv.width = px1 - px0; cv.height = py1 - py0; const g = cv.getContext('2d', { willReadFrequently: true });
    const jobs = [];
    for (let i = Math.floor((lngA - W) / TI); i <= Math.min(S.ni - 1, Math.floor((lngB - W) / TI)); i++) for (let j = Math.floor((latA - S0) / TJ); j <= Math.min(S.nj - 1, Math.floor((latB - S0) / TJ)); j++) {
      const x0 = Math.round((i * TI) / DX), yN = Math.max(0, Math.round((N - (S0 + (j + 1) * TJ)) / DY));
      jobs.push(new Promise((res) => { const im = new Image(); im.onload = () => { g.drawImage(im, x0 - px0, yN - py0); res(true); }; im.onerror = () => res(false); im.src = `/geo/s2/${i}_${j}.jpg`; }));
    }
    const ok = await Promise.all(jobs); if (!ok.some(Boolean)) return;
    // Ирмэг рүү уусах (эх байршлаас 72%-иас 100% хүртэл)
    const id = g.getImageData(0, 0, cv.width, cv.height), d = id.data; const cxp = (o.lng - W) / DX - px0, cyp = (N - o.lat) / DY - py0; const rx = SR / kx / DX, ry = SR / kz / DY;
    for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) { const q = Math.hypot((x - cxp) / rx, (y - cyp) / ry); const a = q < 0.72 ? 1 : q > 1 ? 0 : 1 - (q - 0.72) / 0.28; d[(y * cv.width + x) * 4 + 3] = Math.round(255 * a * a * (3 - 2 * a)); }
    g.putImageData(id, 0, 0);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = opts.renderer ? opts.renderer.capabilities.getMaxAnisotropy() : 8;
    const xL = (px0 * DX + W - o.lng) * kx, zT = (o.lat - (N - py0 * DY)) * kz;
    satU.satMap.value = tex; satU.satRect.value.set(xL, zT, cv.width * DX * kx, cv.height * DY * kz); satU.satOn.value = 1;
    if (areaMesh) { areaMesh.material.transparent = true; areaMesh.material.opacity = 0.5; areaMesh.material.depthWrite = false; areaMesh.material.needsUpdate = true; } // талбайн хил тод, өнгө нь хиймэл дагуулаас
    groundMat.needsUpdate = true; sat.on = true;
  };
  const sat = { on: false, ready: null };
  sat.ready = loadSat().catch(() => {});

  // Талбай (ногоон байгууламж, тоглоомын талбай, зогсоол, сургуулийн хашаа)
  const AREA_C = { park: '#77895a', grass: '#848f63', playground: '#a88a70', pitch: '#5e7d55', parking: '#6e7176', school: '#b6ab94' };
  const areaY = { school: 0.05, grass: 0.07, park: 0.08, parking: 0.1, pitch: 0.11, playground: 0.12 };
  // Агент/оршин суугчийн нэмсэн тоглоомын талбай (газрын зурагт контургүй) → 14×10 м резин хучилт
  const agentPlay = (ext.pois || []).filter((p) => p.cat === 'playground' && p.src === 'agent').map((p) => ({ k: 'playground', p: [p.x - 7, p.z - 5, p.x + 7, p.z - 5, p.x + 7, p.z + 5, p.x - 7, p.z + 5] }));
  const ag = new GB(); for (const a of [...(ext.areas || []), ...agentPlay]) ag.poly(pairs(a.p), areaY[a.k] || 0.06, hex(AREA_C[a.k] || '#b0b0b0'));
  areaMesh = ag.mesh(stdMat({ vertexColors: true, map: fbmTex(256, [[0, '#d9d9d9'], [0.5, '#ffffff'], [1, '#e6e6e6']], 4, 23), roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })); if (areaMesh) { areaMesh.receiveShadow = true; scene.add(areaMesh); }

  // Замууд: ангиллаар өргөн, асфальт/явган замын өнгө, гол замд төвийн шугам
  const RC = { major: '#3c3f44', mid: '#43464b', minor: '#4a4d52', service: '#55575b', path: '#aba597' };
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
  const sw = new GB(), mk = new GB(); const SWC = hex('#a7a296'), MKC = hex('#e6e4dc');
  // Тэмдэглэгээ: төвийн тасархай шугам (гол/дунд зам), гол замд захын тасралтгүй шугам
  const dashes = (pts, off, y, wd, dash, gap) => {
    let acc = 0, on = true, left = dash;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.01) continue; const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L, nx = -uz, nz = ux; let t = 0;
      while (t < L) { const step = Math.min(left, L - t); if (on) { const p0 = [a[0] + ux * t + nx * off, a[1] + uz * t + nz * off], p1 = [a[0] + ux * (t + step) + nx * off, a[1] + uz * (t + step) + nz * off]; ribbon(mk, [p0, p1], wd, y, MKC); } t += step; left -= step; if (left <= 1e-6) { on = !on; left = on ? dash : gap; } }
      acc += L;
    }
  };
  for (const r of ext.roads || []) {
    const pts = pairs(r.p); const col = hex(RC[r.k] || '#666'); const y = RY[r.k] || 0.1; ribbon(rg, pts, r.w, y, col);
    if (r.k === 'major' || r.k === 'mid' || r.k === 'minor') ribbon(sw, pts, r.w + (r.k === 'minor' ? 2.2 : 3.4), y - 0.012, SWC); // хашлага + явган хүний зам
    if (r.k === 'major') { dashes(pts, 0.25, y + 0.015, 0.16, 1e9, 0); dashes(pts, -0.25, y + 0.015, 0.16, 1e9, 0); dashes(pts, r.w / 2 - 0.6, y + 0.015, 0.15, 1e9, 0); dashes(pts, -(r.w / 2 - 0.6), y + 0.015, 0.15, 1e9, 0); }
    else if (r.k === 'mid' && r.w >= 7) dashes(pts, 0, y + 0.015, 0.15, 3, 6);
  }
  const roadMat = stdMat({ vertexColors: true, side: THREE.DoubleSide, map: fbmTex(256, [[0, '#cfcfcf'], [0.5, '#ffffff'], [1, '#d9d9d9']], 5, 31), roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const roadMesh = rg.mesh(roadMat); if (roadMesh) { roadMesh.receiveShadow = true; scene.add(roadMesh); }
  const swMesh = sw.mesh(stdMat({ vertexColors: true, side: THREE.DoubleSide, map: noiseTex('#ffffff', 14, 128), roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1.5, polygonOffsetUnits: -3 })); if (swMesh) { swMesh.receiveShadow = true; scene.add(swMesh); }
  const mkMesh = mk.mesh(stdMat({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 })); if (mkMesh) { mkMesh.receiveShadow = true; scene.add(mkMesh); }

  // Барилгууд: хана (давхрын өндөр 3 м, цонхны зай 3.2 м) + дээвэр; ёроол руу бараан (хуурамч AO)
  const FL = 3.0, BAY = 3.2;
  const PAL = { bld: ['#d3cbbb', '#c8c5bd', '#dcd2bf', '#c3c2bc', '#d1c6b1', '#c7cbca', '#d8ccb6', '#bfbfb8', '#c9cdc4', '#cfd0c7'], apt: ['#d3cbbb', '#c8c5bd', '#dad0bc', '#c3c2bc'], com: ['#b9c2ca', '#c3c9ce', '#adb7c0'], edu: ['#d6b98d', '#cfae85', '#dcc59c'], house: ['#d6cab2', '#cbb99b', '#c0ab8c', '#dad0be', '#b69b7d'], shed: ['#a6a298', '#99958d', '#afa99d'] };
  const ROOF_H = ['#7a4b43', '#4f6576', '#5a6a4b', '#7a7d81', '#6d5447', '#88837a'];
  const B = { block: new GB(), com: new GB(), house: new GB(), home: new GB(), roof: new GB(), far: new GB(), ind: new GB(), homeTw: new GB(), pod: new GB(), tw: [new GB(), new GB(), new GB(), new GB()] };
  const TWV = [['#a3513c', '#cf8f45'], ['#c98a42', null], ['#8c6955', '#d7cfc3'], ['#7d8a96', null]]; // зурвас, ирмэг: тоосгон улаан+улбар шар, улбар шар, хүрэн, саарал-цэнхэр
  const TW_COL = ['#f6f4f0', '#f1eee8', '#f3f1ec'];
  const podium = (pts, h0 = 2 * FL) => { let cx = 0, cz = 0; for (const [x, z] of pts) { cx += x; cz += z; } cx /= pts.length; cz /= pts.length; let md = 0; for (const [x, z] of pts) md += Math.hypot(x - cx, z - cz); md /= pts.length; const k = 1 + 0.18 / Math.max(md, 3); walls(B.pod, pts.map(([x, z]) => [cx + (x - cx) * k, cz + (z - cz) * k]), h0, [1, 1, 1], 0.84, true, 4, 2); };
  const pArea = (P) => { let a = 0; for (let i = 0, j = P.length - 1; i < P.length; j = i++) a += (P[j][0] + P[i][0]) * (P[j][1] - P[i][1]); return Math.abs(a / 2); };
  const orient = (pts) => { let s = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]); return s < 0 ? pts.slice().reverse() : pts; };
  function walls(G, pts, h, col, dark = 0.72, uvScale = true, tb = 1, tf = 1) {
    const P = orient(pts); let acc = 0; const n = P.length;
    for (let i = 0; i < n; i++) {
      const a = P[i], b = P[(i + 1) % n]; const len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 0.05) continue;
      const nx = (b[1] - a[1]) / len, nz = -(b[0] - a[0]) / len; // гадагш
      const u0 = uvScale ? acc / (BAY * tb) : 0, u1 = uvScale ? (acc + len) / (BAY * tb) : 1, v1 = uvScale ? h / (FL * tf) : 1;
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
  let bi = 0; const roofRC = (b, fb) => (b.rc ? mul(hex(b.rc), SAT_K) : hex(fb));
  for (const b of ext.buildings || []) {
    const pts = pairs(b.p); if (pts.length < 3) continue; bi++;
    const h = Math.max(2.8, b.lv * FL + (b.lv > 1 ? 0.6 : 0)); const pal = PAL[b.k] || PAL.bld; const col = hex(pal[Math.floor(hash(bi) * pal.length)]);
    if (b.t && b.lv >= 12) { walls(B.homeTw, pts, h, hex(TW_COL[0]), 0.84, true, TW_B, TW_F); podium(pts); B.roof.poly(pts, h, roofRC(b, '#a4523f')); parapet(B.roof, pts, h, hex('#e2ded6')); homeInfo.pts = pts; homeInfo.h = h; let cx = 0, cz = 0; for (const [x, z] of pts) { cx += x; cz += z; } homeInfo.c = [cx / pts.length, cz / pts.length]; continue; }
    if (b.t) { walls(B.home, pts, h, hex('#efe3cf'), 0.82, true, FT_B, FT_F); B.roof.poly(pts, h, roofRC(b, '#a4523f')); parapet(B.roof, pts, h, hex('#d8d2c8')); homeInfo.pts = pts; homeInfo.h = h; let cx = 0, cz = 0; for (const [x, z] of pts) { cx += x; cz += z; } homeInfo.c = [cx / pts.length, cz / pts.length]; continue; }
    if (b.lv <= 2 && b.k !== 'house' && b.k !== 'edu' && pArea(pts) >= 260) {
      walls(B.ind, pts, h, hex(['#d4d1ca', '#cbc9c3', '#d9d3c7', '#c6c8c9'][Math.floor(hash(bi * 2.9) * 4)]), 0.82, true, FT_B, FT_F);
      B.roof.poly(pts, h, roofRC(b, ['#9a9c9e', '#a6a7a8', '#8d9092', '#b0b0ae'][Math.floor(hash(bi * 4.1) * 4)])); parapet(B.roof, pts, h, hex('#b8b8b4'), 0.4);
    } else if (b.k === 'house' || b.k === 'shed' || (b.lv <= 2 && b.k !== 'com' && b.k !== 'edu')) {
      walls(B.house, pts, h, col, 0.78);
      const roofC = roofRC(b, ROOF_H[Math.floor(hash(bi * 7.1) * ROOF_H.length)]);
      if (pts.length === 4 && b.k !== 'shed' && b.lv <= 2) gable(B.house, B.roof, pts, h, col, roofC); else B.roof.poly(pts, h, b.k === 'shed' ? hex('#7d7f84') : roofC);
    } else if (b.k === 'com' || b.k === 'edu') { walls(B.com, pts, h, col, 0.8, true, FT_B, FT_F); B.roof.poly(pts, h, roofRC(b, hash(bi * 5.3) > 0.5 ? '#86888b' : '#949597')); parapet(B.roof, pts, h, hex('#aeb1b4'), 0.6); }
    else {
      if (b.lv >= 12) { const v = Math.floor(hash(bi * 6.1) * TWV.length); walls(B.tw[v], pts, h, hex(TW_COL[Math.floor(hash(bi * 2.3) * 3)]), 0.84, true, TW_B, TW_F); if (hash(bi * 8.7) < 0.6) podium(pts); B.roof.poly(pts, h, roofRC(b, '#9d9e9f')); parapet(B.roof, pts, h, hex('#e2ded6')); }
      else { walls(B.block, pts, h, col, 0.78, true, FT_B, FT_F); B.roof.poly(pts, h, roofRC(b, hash(bi * 3.7) > 0.5 ? '#8f9193' : '#9d9e9f')); parapet(B.roof, pts, h, mul(col, 0.9)); }
      if (b.lv >= 5) { // хэсэг (орц) бүрд дээвэр дээр лифтний машин өрөө
        const [ux, uz] = longAxis(pts); let cx = 0, cz = 0; for (const [x, z] of pts) { cx += x; cz += z; } cx /= pts.length; cz /= pts.length;
        let a0 = Infinity, a1 = -Infinity; for (const [x, z] of pts) { const a = (x - cx) * ux + (z - cz) * uz; a0 = Math.min(a0, a); a1 = Math.max(a1, a); }
        const len = a1 - a0, nsec = Math.max(1, Math.round(len / 26));
        for (let k = 0; k < nsec; k++) { const a = a0 + (len * (k + 0.5)) / nsec; const x = cx + ux * a, z = cz + uz * a; if (inPolyB(x, z, pts)) roofBox(B.roof, x, z, ux, uz, 4.2, 3.2, h, 2.6, hex('#a3a6aa')); }
      }
    }
  }
  for (const b of ext.buildings || []) if (b.rp === 'playground') { const pts = pairs(b.p); if (pts.length >= 3) playRoof.poly(pts, Math.max(2.8, b.lv * FL + (b.lv > 1 ? 0.6 : 0)) + 0.08, [1, 1, 1], 14); }
  for (const b of ext.far || []) {
    const pts = pairs(b.p); if (pts.length < 3) continue; const h = Math.max(2.8, b.lv * FL); const k = hash(pts[0][0] * 1.3 + pts[0][1]);
    if (b.lv >= 12) { walls(B.tw[Math.floor(hash(k * 5.9) * TWV.length)], pts, h, hex(TW_COL[Math.floor(k * 3)]), 0.84, true, TW_B, TW_F); B.roof.poly(pts, h, roofRC(b, '#9d9e9f')); }
    else if (b.lv >= 3) { walls(B.far, pts, h, hex(PAL.bld[Math.floor(k * PAL.bld.length)]), 0.8, true, FT_B, FT_F); B.roof.poly(pts, h, roofRC(b, k > 0.5 ? '#8f9193' : '#9d9e9f')); }
    else if (pArea(pts) >= 260) { walls(B.ind, pts, h, hex(['#d4d1ca', '#cbc9c3', '#d9d3c7'][Math.floor(k * 3)]), 0.82, true, FT_B, FT_F); B.roof.poly(pts, h, roofRC(b, ['#9a9c9e', '#a6a7a8', '#8d9092'][Math.floor(k * 3)])); }
    else { walls(B.house, pts, h, hex(PAL.house[Math.floor(k * PAL.house.length)]), 0.8); B.roof.poly(pts, h, roofRC(b, ROOF_H[Math.floor(hash(k * 7.7) * ROOF_H.length)])); }
  }
  const blockTex = facadeBlock(), comTex = facadeCom(), houseTex = facadeHouse(), indTex = facadeInd();
  const addM = (G, mat, cast = true) => { const m = G.mesh(mat); if (m) { m.castShadow = cast; m.receiveShadow = true; scene.add(m); } return m; };
  addM(B.block, stdMat({ vertexColors: true, map: blockTex.map, roughnessMap: blockTex.rough, roughness: 1 }));
  addM(B.com, stdMat({ vertexColors: true, map: comTex.map, roughnessMap: comTex.rough, roughness: 1 }));
  addM(B.house, stdMat({ vertexColors: true, map: houseTex.map, roughnessMap: houseTex.rough, roughness: 1 }));
  addM(B.roof, stdMat({ vertexColors: true, side: THREE.DoubleSide, map: fbmTex(256, [[0, '#e3e3e3'], [0.5, '#ffffff'], [1, '#ececec']], 5, 41), roughness: 0.9 }));
  addM(B.far, stdMat({ vertexColors: true, map: blockTex.map, roughnessMap: blockTex.rough, roughness: 1 }));
  addM(B.ind, stdMat({ vertexColors: true, map: indTex.map, roughnessMap: indTex.rough, roughness: 1 }));
  addM(playRoof, new THREE.MeshLambertMaterial({ vertexColors: true, map: canvasTex(256, 256, (g, w, h) => { // резин хучилттай тоглоомын талбай
    g.fillStyle = '#c8664f'; g.fillRect(0, 0, w, h); const C = ['#e7c24a', '#6f9fd8', '#79b98a', '#d98fa6', '#ef8f4f']; let sd = 7; const r = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    for (let i = 0; i < 14; i++) { g.fillStyle = C[i % C.length]; g.beginPath(); g.ellipse(r() * w, r() * h, 18 + r() * 40, 14 + r() * 30, r() * 3, 0, 7); g.fill(); }
    g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 3; g.beginPath(); g.arc(w / 2, h / 2, 60, 0, 7); g.stroke();
  }), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
  const homeTex = facadeBlock(); const homeMat = stdMat({ vertexColors: true, map: homeTex.map, roughnessMap: homeTex.rough, roughness: 1, emissive: new THREE.Color('#3a1a12'), emissiveIntensity: 0.08 });
  addM(B.home, homeMat);
  const twTex = TWV.map(([a, e], i) => facadeTower(a, e, 51 + i * 7)); B.tw.forEach((G, i) => addM(G, stdMat({ vertexColors: true, map: twTex[i].map, roughnessMap: twTex[i].rough, roughness: 1 })));
  addM(B.homeTw, stdMat({ vertexColors: true, map: twTex[0].map, roughnessMap: twTex[0].rough, roughness: 1, emissive: new THREE.Color('#3a1a12'), emissiveIntensity: 0.06 }));
  const podTex = facadePodium(); addM(B.pod, stdMat({ vertexColors: true, map: podTex.map, roughnessMap: podTex.rough, roughness: 1 }));

  // Арк (угсармал байрны доорх явган гарц): маршрут байрыг нэвт гардаг газарт харанхуй нүх (хоёр фасадаас харагдана)
  { const archMat = new THREE.MeshLambertMaterial({ color: '#2b2d31' }); for (const [x, z, ang, len] of ext.arches || []) { const m = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3.6, len + 1.2), archMat); m.position.set(x, 1.8, z); m.rotation.y = ang; scene.add(m); } }
  // Гэр (монгол гэр): эсгий хана + дээвэр — instanced
  const gers = ext.gers || [];
  if (gers.length) {
    const wallG = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true); wallG.translate(0, 0.5, 0);
    const roofG = new THREE.ConeGeometry(1.04, 1, 14, 1, true); roofG.translate(0, 0.5, 0);
    const wm = new THREE.InstancedMesh(wallG, stdMat({ color: '#e9e3d5', side: THREE.DoubleSide, roughness: 1 }), gers.length);
    const rm = new THREE.InstancedMesh(roofG, stdMat({ color: '#d9d1bf', side: THREE.DoubleSide, roughness: 1 }), gers.length);
    const tG = new THREE.CylinderGeometry(1, 1, 1, 10); tG.translate(0, 0.5, 0); const dG = new THREE.BoxGeometry(1, 1, 1); dG.translate(0, 0.5, 0);
    const tn = new THREE.InstancedMesh(tG, stdMat({ color: '#6e5b47' }), gers.length), dn = new THREE.InstancedMesh(dG, stdMat({ color: '#a8612f', roughness: 0.7 }), gers.length);
    const M = new THREE.Matrix4(), q = new THREE.Quaternion();
    gers.forEach(([x, z, r], i) => {
      M.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(r, 1.55, r)); wm.setMatrixAt(i, M); const rh = 0.8 + r * 0.12; M.compose(new THREE.Vector3(x, 1.55, z), q, new THREE.Vector3(r, rh, r)); rm.setMatrixAt(i, M);
      M.compose(new THREE.Vector3(x, 1.55 + rh * 0.86, z), q, new THREE.Vector3(r * 0.2, 0.14, r * 0.2)); tn.setMatrixAt(i, M); // тооно
      M.compose(new THREE.Vector3(x, 0, z + r * 0.98), q, new THREE.Vector3(0.8, 1.35, 0.12)); dn.setMatrixAt(i, M); // урд (өмнө) хаалга
    });
    for (const m of [wm, rm, tn, dn]) { m.castShadow = true; m.receiveShadow = true; } scene.add(wm, rm, tn, dn);
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
  // Гудамжны мод: гол/дунд замын явган замын дагуу ~15 м тутамд (барилгын дотор биш)
  {
    const bl = []; for (const b of ext.buildings || []) { const p = pairs(b.p); if (p.length < 3) continue; let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } bl.push([x0 - 1.5, x1 + 1.5, z0 - 1.5, z1 + 1.5, p]); }
    const G = new Map(), gk = (x, z) => Math.floor(x / 40) * 100003 + Math.floor(z / 40); for (const q of bl) for (let i = Math.floor(q[0] / 40); i <= Math.floor(q[1] / 40); i++) for (let j = Math.floor(q[2] / 40); j <= Math.floor(q[3] / 40); j++) { const k = i * 100003 + j; if (!G.has(k)) G.set(k, []); G.get(k).push(q); }
    const blocked = (x, z) => (G.get(gk(x, z)) || []).some((q) => x >= q[0] && x <= q[1] && z >= q[2] && z <= q[3]);
    for (const r of ext.roads || []) {
      if (r.k !== 'major' && r.k !== 'mid') continue; const pts = pairs(r.p); const off = r.w / 2 + 2.3; let carry = 7;
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.5) continue; const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
        for (let t = carry; t < L; t += 15) { for (const sd of [1, -1]) { const x = a[0] + ux * t - uz * off * sd, z = a[1] + uz * t + ux * off * sd; if (Math.hypot(x, z) < 1600 && hash(x * 0.37 + z * 0.11) > 0.18 && !blocked(x, z)) treePts.push([x, z]); } carry = t + 15 - L; }
        if (carry < 0) carry = 0;
      }
    }
  }
  if (treePts.length) {
    const tn = Math.min(7000, treePts.length);
    const crown = (() => { // 4 бөмбөлгөөс титэм (нэг mesh)
      const parts = [[0, 0, 0, 1], [0.45, 0.35, 0.2, 0.72], [-0.4, 0.25, -0.25, 0.7], [0.1, 0.62, -0.1, 0.62]].map(([x, y, z, r]) => { const g = new THREE.IcosahedronGeometry(r, 1); g.translate(x, y, z); return g; });
      const pos = [], nor = []; for (const g of parts) { const P = g.attributes.position, N = g.attributes.normal; for (let i = 0; i < P.count; i++) { pos.push(P.getX(i), P.getY(i), P.getZ(i)); nor.push(N.getX(i), N.getY(i), N.getZ(i)); } }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); return g;
    })();
    const trunk = new THREE.CylinderGeometry(0.12, 0.18, 1, 5); trunk.translate(0, 0.5, 0);
    const cm = new THREE.InstancedMesh(crown, stdMat({ color: '#ffffff', flatShading: true, roughness: 1 }), tn);
    const tm = new THREE.InstancedMesh(trunk, stdMat({ color: '#5e4a36' }), tn);
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
    const TC = ['#5d6f3e', '#6c7a44', '#7b7f45', '#96843d', '#a58d42', '#566a3c', '#8a7c3f', '#b0964a']; // намар: ногоон-шаргал холимог
    for (let i = 0; i < tn; i++) {
      const [x, z] = treePts[i]; const s = 1.6 + hash(i * 3.3) * 1.6, th = 2 + hash(i * 1.7) * 2.2;
      M.compose(new THREE.Vector3(x, th + s * 0.7, z), q, new THREE.Vector3(s, s * 1.25, s)); cm.setMatrixAt(i, M);
      M.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(1, th + 0.4, 1)); tm.setMatrixAt(i, M);
      col.set(TC[Math.floor(hash(i * 9.1) * TC.length)]); cm.setColorAt(i, col);
    }
    for (const m of [cm, tm]) { m.castShadow = true; m.receiveShadow = true; } scene.add(cm, tm);
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
      const n = Math.min(3000, spots.length); const cm = new THREE.InstancedMesh(carG, stdMat({ color: '#ffffff', roughness: 0.45, metalness: 0.25 }), n);
      const M = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color(); const CC = ['#e8e8e6', '#b9bcc0', '#2a2d31', '#5f646b', '#7d2a26', '#2f3f5e', '#d6d7d5', '#8f949a', '#4a4e44'];
      for (let i = 0; i < n; i++) { const [x, z, r] = spots[i]; q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r); M.compose(new THREE.Vector3(x, 0.13, z), q, new THREE.Vector3(1, 1, 1)); cm.setMatrixAt(i, M); col.set(CC[Math.floor(hash(i * 5.3) * CC.length)]); cm.setColorAt(i, col); }
      cm.castShadow = true; cm.receiveShadow = true; scene.add(cm);
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
  // Нислэгийн жагсаалт (худалдан авагчийг залхаахгүй): ① өдөр тутмын үйлчилгээ ≤ 5 (хүнс, эмийн сан, тоглоомын талбай эхэнд), ② сургууль/цэцэрлэг ≤ 5,
  // ③ эмнэлэг, төрийн үйлчилгээ (тус бүр хамгийн ойр 1) → дараа нь гарц/төв зам, хотын төв. Бусад нь зөвхөн жагсаалтад. 30 м дотор давхцсан газрыг нэг зогсоол гэж үзнэ.
  const flyNear = (p) => p.src === 'agent' || !(p.m > (FLY_MAX[p.cat] || 500));
  const pickGroup = (cats, must, n) => {
    const pool = pois.filter((p) => cats.includes(p.cat) && flyNear(p)).sort((a, b) => a.m - b.m); const out = [];
    const ok = (p) => !out.includes(p) && out.every((q) => q.cat !== p.cat || Math.hypot(q.x - p.x, q.z - p.z) > 30); // ижил ангиллын 30 м дотор = нэг зогсоол
    for (const c of must) { if (out.length >= n) break; const p = pool.find((q) => q.cat === c && ok(q)); if (p) out.push(p); }
    for (const p of pool) { if (out.length >= n) break; if (ok(p) && !out.some((q) => q.cat === p.cat)) out.push(p); } // эхлээд олон төрөл (спорт давамгайлахгүй)
    for (const p of pool) { if (out.length >= n) break; if (ok(p)) out.push(p); }
    return out.sort((a, b) => a.m - b.m);
  };
  const nearestOf = (cat, maxM) => pois.filter((p) => p.cat === cat && (p.src === 'agent' || p.m <= maxM) && !(cat === 'gov' && /хотхон|apartment|орон сууц|residential/i.test(p.name || ''))).sort((a, b) => a.m - b.m)[0];
  const flyList = [...pickGroup(['grocery', 'pharmacy', 'playground', 'mall', 'sport', 'park'], ['grocery', 'pharmacy', 'playground'], 5),
    ...pickGroup(['kinder', 'school'], ['kinder', 'school', 'kinder', 'school'], 5), nearestOf('health', 1000), nearestOf('gov', 1500)].filter(Boolean);
  const flySet = new Set(flyList);
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
  const flyByOrder = flyList;
  const A0 = 1.35; // тойм: байрны урд (нартай) талаас хойш харна
  const FADE = 1.3;
  const segs = [];
  segs.push({ kind: 'intro', dur: 12, cap: { icon: 'plane-landing', t: 'Бодит орчны 3D нислэг', s: opts.title || 'Таны байрны орчин', d: 'OpenStreetMap + хиймэл дагуулын ML барилгын контур · GHSL өндөр · Sentinel-2 газар, дээврийн өнгө' } });
  segs.push({ kind: 'orbitHome', dur: 7, cap: { icon: 'house', t: 'Таны байр', s: ext.home && ext.home.lv ? `${ext.home.lv} давхар байр` : 'Орон сууц', d: 'Эргэн тойрны үйлчилгээний цэгүүд' } });
  for (const p of [...flyByOrder, ...(main ? [main] : [])]) {
    const sp = p.pts && p.pts.length > 1 ? pathSampler(p.pts) : null; if (!sp) continue; p.sp = sp; const H = headingOf(sp);
    segs.push({ kind: 'fade', dur: FADE, to: p });
    segs.push({ kind: 'fly', dur: Math.max(5, Math.min(18, sp.L / 22)), p, sp, H }); // ойрын газар руу богино
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
    { // сүүдэр: харж буй цэг (pose.tgt) эсвэл камерын доор; хэмжээ өндрөөс хамаарч шатлалтай (200/400/800/1600 м)
      const tg = (pose && pose.tgt) ? pose.tgt : camera.position; const cl = Math.max(20, camera.position.y);
      let half = 200; while (half < 1600 && half < cl * 1.25) half *= 2;
      const sc = sun.shadow.camera; if (sc.right !== half) { Object.assign(sc, { left: -half, right: half, top: half, bottom: -half }); sc.updateProjectionMatrix(); }
      // Гэрлийн орон зайд текселийн хэмжээгээр бүхэлчилнэ → камер хөдлөхөд сүүдрийн ирмэг чичрэхгүй
      const tex = (2 * half) / SH_MAP; const lz = SUN_DIR.clone().negate(), lx = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), lz).normalize(), ly = new THREE.Vector3().crossVectors(lz, lx);
      const c = new THREE.Vector3(tg.x, 0, tg.z); const a = Math.round(c.dot(lx) / tex) * tex, b = Math.round(c.dot(ly) / tex) * tex, d = c.dot(lz);
      const snapped = lx.multiplyScalar(a).add(ly.multiplyScalar(b)).add(lz.multiplyScalar(d));
      sun.target.position.copy(snapped); sun.position.copy(snapped).addScaledVector(SUN_DIR, 1800); sun.target.updateMatrixWorld(); sun.updateMatrixWorld();
    }
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
  return { scene, camera, shadows: true, exposure: 1.12, sat, update, start, setFree, drag, setVisible, drawMap, segs, TOTAL, liftInfo, _los: losClear, get free() { return free; }, get running() { return running; }, get T() { return T; } };
}
