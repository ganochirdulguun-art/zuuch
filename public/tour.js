// «Зууч» — Virtual POV Tour үзэгч (three.js, серверээс ирсэн планаар 3D орчин барьж, POV аялал)
import * as THREE from '/vendor/three.module.min.js';

const $ = (s) => document.querySelector(s);
const token = location.pathname.split('/').filter(Boolean).pop();
const EYE = 1.6, WALL_T = 0.12, DOOR_H = 2.05, WIN_LO = 0.9, WIN_HI = 2.15;
const TYPE_LABEL = { living: 'Зочны', kitchen: 'Гал тогоо', bedroom: 'Унтлагын', bath: 'Угаалгын', hall: 'Коридор', balcony: 'Тагт', office: 'Ажлын', other: 'Өрөө' };
const MAP_FILL = { living: '#93c5fd', kitchen: '#fde68a', bedroom: '#c4b5fd', bath: '#a5f3fc', hall: '#e2e8f0', balcony: '#bbf7d0', office: '#fdba74', other: '#e5e7eb' };

// ---------- Процедур текстур (гадаад файлгүй) ----------
function canvasTex(draw, size = 512, repeat = [1, 1]) {
  const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
const texParquet = () => canvasTex((g, s) => {
  g.fillStyle = '#b9895a'; g.fillRect(0, 0, s, s);
  const rows = 8, cols = 4;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const off = (r % 2) * (s / cols / 2); const x = c * (s / cols) + off - s / cols, y = r * (s / rows);
    const l = 0.85 + Math.random() * 0.3; g.fillStyle = `rgb(${Math.round(185 * l)},${Math.round(135 * l)},${Math.round(88 * l)})`;
    g.fillRect(x + 1, y + 1, s / cols - 2, s / rows - 2);
    g.strokeStyle = 'rgba(80,50,20,.25)'; g.strokeRect(x + 1, y + 1, s / cols - 2, s / rows - 2);
  }
});
const texTile = (base = '#e7e5e4') => canvasTex((g, s) => {
  g.fillStyle = base; g.fillRect(0, 0, s, s); g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 3;
  const n = 4; for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * s / n, 0); g.lineTo(i * s / n, s); g.stroke(); g.beginPath(); g.moveTo(0, i * s / n); g.lineTo(s, i * s / n); g.stroke(); }
});
const texWall = (base = '#f3f1ec') => canvasTex((g, s) => {
  g.fillStyle = base; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.045})`; g.fillRect(Math.random() * s, Math.random() * s, 2, 2); }
}, 256);

// ---------- Дэлхийн координат: план (x баруун, y урагш=өмнө) → three (x, z=y) ----------
const W = (x, y, h = 0) => new THREE.Vector3(x, h, y);

let data, plan, scene, camera, renderer, rooms = [], byId = {}, doorGraph = {};
const mats = {};
function initMats() {
  const parquet = texParquet(); const tile = texTile(); const wallT = texWall();
  mats.parquet = new THREE.MeshStandardMaterial({ map: parquet, roughness: 0.55 });
  mats.tile = new THREE.MeshStandardMaterial({ map: tile, roughness: 0.35 });
  mats.wall = new THREE.MeshStandardMaterial({ map: wallT, roughness: 0.95 });
  mats.ceil = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  mats.glass = new THREE.MeshPhysicalMaterial({ color: 0xbfe3ff, transmission: 0.85, transparent: true, opacity: 0.55, roughness: 0.05, side: THREE.DoubleSide });
  mats.frame = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.6 });
  mats.door = new THREE.MeshStandardMaterial({ color: 0x7c5a3a, roughness: 0.6 });
  mats.wood = new THREE.MeshStandardMaterial({ color: 0x8b5e3c, roughness: 0.6 });
  mats.dark = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.5 });
  mats.fabric = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.9 });
  mats.fabric2 = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.9 });
  mats.white = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 });
  mats.linen = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.95 });
  mats.green = new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.8 });
  mats.rug = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 1 });
  mats.steel = new THREE.MeshStandardMaterial({ color: 0xd1d5db, roughness: 0.3, metalness: 0.6 });
  mats.wallTex = wallT; mats.parquetTex = parquet; mats.tileTex = tile;
}
const box = (w, h, d, m) => { const g = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); g.castShadow = g.receiveShadow = true; return g; };
// Хэвтээ хавтгай (хивс) — Group дотор эргүүлснээр place()-ийн y-эргэлт хэвтээ байдлыг эвдэхгүй
const flat = (w, d, m) => { const g = new THREE.Group(); const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m); p.rotation.x = -Math.PI / 2; p.receiveShadow = true; g.add(p); return g; };

// ---------- Хана: нэг тал = нээлхийгээр (хаалга/цонх) хэсэглэсэн хайрцгууд ----------
function segOnEdge(seg, edge) {
  // seg: {x1,y1,x2,y2}; edge: {axis:'x'|'y', c, a, b} → [lo,hi] эсвэл null
  if (edge.axis === 'x') { if (Math.abs(seg.y1 - edge.c) > 0.07 || Math.abs(seg.y2 - edge.c) > 0.07) return null; const lo = Math.max(Math.min(seg.x1, seg.x2), edge.a), hi = Math.min(Math.max(seg.x1, seg.x2), edge.b); return hi > lo ? [lo, hi] : null; }
  if (Math.abs(seg.x1 - edge.c) > 0.07 || Math.abs(seg.x2 - edge.c) > 0.07) return null; const lo = Math.max(Math.min(seg.y1, seg.y2), edge.a), hi = Math.min(Math.max(seg.y1, seg.y2), edge.b); return hi > lo ? [lo, hi] : null;
}
function buildRoom(r) {
  const H = plan.ceiling; const g = new THREE.Group();
  const floorMat = (r.type === 'kitchen' || r.type === 'bath') ? mats.tile.clone() : mats.parquet.clone();
  floorMat.map = floorMat.map.clone(); floorMat.map.repeat.set(r.w / (r.type === 'kitchen' || r.type === 'bath' ? 1.2 : 2), r.h / (r.type === 'kitchen' || r.type === 'bath' ? 1.2 : 2)); floorMat.map.needsUpdate = true;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.h), floorMat); floor.rotation.x = -Math.PI / 2; floor.position.set(r.x + r.w / 2, 0, r.y + r.h / 2); floor.receiveShadow = true; g.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.h), mats.ceil); ceil.rotation.x = Math.PI / 2; ceil.position.set(r.x + r.w / 2, H, r.y + r.h / 2); g.add(ceil);
  const wallMat = mats.wall.clone(); wallMat.map = mats.wallTex.clone(); wallMat.map.repeat.set(2, 1); wallMat.map.needsUpdate = true;
  if (r.type === 'bath') { wallMat.map = mats.tileTex.clone(); wallMat.map.repeat.set(3, 2); wallMat.roughness = 0.35; }
  const edges = [
    { side: 'N', axis: 'x', c: r.y, a: r.x, b: r.x + r.w, inward: +1 }, { side: 'S', axis: 'x', c: r.y + r.h, a: r.x, b: r.x + r.w, inward: -1 },
    { side: 'W', axis: 'y', c: r.x, a: r.y, b: r.y + r.h, inward: +1 }, { side: 'E', axis: 'y', c: r.x + r.w, a: r.y, b: r.y + r.h, inward: -1 },
  ];
  for (const e of edges) {
    const ops = [];
    for (const d of plan.doors) { if (d.a !== r.id && d.b !== r.id) continue; const o = segOnEdge(d, e); if (o) ops.push({ lo: o[0], hi: o[1], t: 'door', d }); }
    for (const wn of plan.windows) { if (wn.room !== r.id) continue; const o = segOnEdge(wn, e); if (o) ops.push({ lo: o[0], hi: o[1], t: 'win' }); }
    ops.sort((p, q) => p.lo - q.lo);
    const cc = e.c + e.inward * WALL_T / 2; // ханын төв шугам — өрөө рүү дотогш
    const put = (lo, hi, y0, y1, m = wallMat) => {
      if (hi - lo < 0.01 || y1 - y0 < 0.01) return;
      const len = hi - lo, hgt = y1 - y0, mid = (lo + hi) / 2;
      const b = e.axis === 'x' ? box(len, hgt, WALL_T, m) : box(WALL_T, hgt, len, m);
      b.position.set(e.axis === 'x' ? mid : cc, y0 + hgt / 2, e.axis === 'x' ? cc : mid); g.add(b);
    };
    let cur = e.a;
    for (const o of ops) {
      put(cur, o.lo, 0, H);
      if (o.t === 'door') {
        put(o.lo, o.hi, DOOR_H, H);
        // хаалганы хүрээ + нээлттэй хавтас (орцны хаалга хаалттай)
        const fw = 0.06; put(o.lo - fw, o.lo, 0, DOOR_H + fw, mats.frame); put(o.hi, o.hi + fw, 0, DOOR_H + fw, mats.frame); put(o.lo, o.hi, DOOR_H, DOOR_H + fw, mats.frame);
        if (o.d.b === 'out') { const leaf = e.axis === 'x' ? box(o.hi - o.lo, DOOR_H, 0.05, mats.door) : box(0.05, DOOR_H, o.hi - o.lo, mats.door); leaf.position.set(e.axis === 'x' ? (o.lo + o.hi) / 2 : e.c, DOOR_H / 2, e.axis === 'x' ? e.c : (o.lo + o.hi) / 2); g.add(leaf); }
      } else {
        put(o.lo, o.hi, 0, WIN_LO); put(o.lo, o.hi, WIN_HI, H);
        const gl = e.axis === 'x' ? new THREE.Mesh(new THREE.PlaneGeometry(o.hi - o.lo, WIN_HI - WIN_LO), mats.glass) : new THREE.Mesh(new THREE.PlaneGeometry(o.hi - o.lo, WIN_HI - WIN_LO), mats.glass);
        gl.position.set(e.axis === 'x' ? (o.lo + o.hi) / 2 : e.c, (WIN_LO + WIN_HI) / 2, e.axis === 'x' ? e.c : (o.lo + o.hi) / 2); if (e.axis === 'y') gl.rotation.y = Math.PI / 2; g.add(gl);
        const fw = 0.05; put(o.lo - fw, o.lo, WIN_LO - fw, WIN_HI + fw, mats.frame); put(o.hi, o.hi + fw, WIN_LO - fw, WIN_HI + fw, mats.frame); put(o.lo, o.hi, WIN_LO - fw, WIN_LO, mats.frame); put(o.lo, o.hi, WIN_HI, WIN_HI + fw, mats.frame);
        const mid = (o.lo + o.hi) / 2; const bar = e.axis === 'x' ? box(0.04, WIN_HI - WIN_LO, 0.05, mats.frame) : box(0.05, WIN_HI - WIN_LO, 0.04, mats.frame); bar.position.set(e.axis === 'x' ? mid : e.c, (WIN_LO + WIN_HI) / 2, e.axis === 'x' ? e.c : mid); g.add(bar);
        // цонхны тавцан
        const sill = e.axis === 'x' ? box(o.hi - o.lo + 0.1, 0.04, 0.3, mats.frame) : box(0.3, 0.04, o.hi - o.lo + 0.1, mats.frame); sill.position.set(e.axis === 'x' ? mid : cc + e.inward * 0.1, WIN_LO, e.axis === 'x' ? cc + e.inward * 0.1 : mid); g.add(sill);
      }
      cur = o.hi;
    }
    put(cur, e.b, 0, H);
  }
  // Гэрэл: өрөө бүрд таазны цэгэн гэрэл
  const pl = new THREE.PointLight(0xfff4e0, r.w * r.h > 14 ? 12 : 7, 0, 1.6); pl.position.set(r.x + r.w / 2, H - 0.25, r.y + r.h / 2); g.add(pl);
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 20), mats.white); lamp.position.copy(pl.position).setY(H - 0.03); g.add(lamp);
  furnish(r, g);
  return g;
}

// ---------- Тавилга: хаалганы талаас «урагш» чиглэсэн локал координат ----------
function doorSide(r) {
  for (const d of plan.doors) {
    if (d.b === 'out' && d.a === r.id) continue;
    if (d.a !== r.id && d.b !== r.id) continue;
    if (Math.abs(d.y1 - r.y) < 0.07 && Math.abs(d.y2 - r.y) < 0.07) return 'N';
    if (Math.abs(d.y1 - (r.y + r.h)) < 0.07) return 'S';
    if (Math.abs(d.x1 - r.x) < 0.07) return 'W';
    if (Math.abs(d.x1 - (r.x + r.w)) < 0.07) return 'E';
  }
  return 'S';
}
// Гол хана (ТВ, орны толгой, тавцан): хаалганы эсрэг тал, гэхдээ цонхтой бол цонх/хаалгагүй ханыг сонгоно
function mainSide(r) {
  const ds = doorSide(r); const opp = { S: 'N', N: 'S', W: 'E', E: 'W' }[ds];
  const winSides = new Set(plan.windows.filter((w) => w.room === r.id).map((w) => w.side));
  const doorSides = new Set(); for (const d of plan.doors) { if (d.a !== r.id && d.b !== r.id) continue; if (Math.abs(d.y1 - r.y) < 0.07 && Math.abs(d.y2 - r.y) < 0.07) doorSides.add('N'); else if (Math.abs(d.y1 - (r.y + r.h)) < 0.07) doorSides.add('S'); else if (Math.abs(d.x1 - r.x) < 0.07) doorSides.add('W'); else doorSides.add('E'); }
  if (!winSides.has(opp)) return opp;
  const free = ['W', 'E', 'N', 'S'].filter((s) => !winSides.has(s) && !doorSides.has(s) && s !== ds);
  return free[0] || opp;
}
function furnish(r, g) {
  const side = { N: 'S', S: 'N', W: 'E', E: 'W' }[mainSide(r)]; // «хаалганы тал» = гол ханын эсрэг
  const cx = r.x + r.w / 2, cz = r.y + r.h / 2;
  // локал: u = баруун, v = урагш (гол хана руу); халф хэмжээ
  const fwd = { S: [0, -1], N: [0, 1], W: [1, 0], E: [-1, 0] }[side];
  const rgt = [-fwd[1], fwd[0]];
  const depth = (side === 'N' || side === 'S') ? r.h : r.w, width = (side === 'N' || side === 'S') ? r.w : r.h;
  const rotY = Math.atan2(fwd[0], fwd[1]); // урагш чиглэлийн эргэлт (three: -z урагш)
  const place = (m, u, v, y = 0, rot = 0) => { m.position.set(cx + rgt[0] * u + fwd[0] * v, y, cz + rgt[1] * u + fwd[1] * v); m.rotation.y = rotY + Math.PI + rot; g.add(m); return m; };
  const backV = depth / 2 - 0.35; // хаалганы эсрэг хана
  const T = r.type;
  if (T === 'living') {
    const sofa = new THREE.Group(); sofa.add(box(1.9, 0.42, 0.9, mats.fabric).translateY(0.21)); const bk = box(1.9, 0.5, 0.25, mats.fabric); bk.position.set(0, 0.6, 0.33); sofa.add(bk);
    for (const s of [-1, 1]) { const arm = box(0.2, 0.58, 0.9, mats.fabric); arm.position.set(s * 0.95, 0.29, 0); sofa.add(arm); }
    place(sofa, 0, Math.min(-0.3, -depth / 2 + 1.4), 0, Math.PI); // хаалга/явах зам хаахгүй
    place(flat(2.6, 1.8, mats.rug), 0, 0.1, 0.005);
    place(box(1.1, 0.4, 0.6, mats.wood), 0, 0.2, 0.2);
    place(box(1.6, 0.45, 0.42, mats.white), 0, backV, 0.225);
    place(box(1.3, 0.75, 0.05, mats.dark), 0, backV + 0.15, 1.05);
    if (width > 3.4) { place(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.14, 0.35, 12), mats.wood), width / 2 - 0.45, backV - 0.2, 0.175); place(new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 10), mats.green), width / 2 - 0.45, backV - 0.2, 0.8); }
    if (width > 4) place(box(0.8, 1.9, 0.35, mats.wood), -width / 2 + 0.6, backV + 0.05, 0.95);
  } else if (T === 'bedroom') {
    const bed = new THREE.Group(); bed.add(box(1.7, 0.3, 2.05, mats.wood).translateY(0.15)); bed.add(box(1.62, 0.22, 1.95, mats.linen).translateY(0.41));
    for (const s of [-1, 1]) { const p = box(0.6, 0.14, 0.4, mats.white); p.position.set(s * 0.4, 0.58, -0.7); bed.add(p); }
    const hb = box(1.7, 0.9, 0.08, mats.wood); hb.position.set(0, 0.45, -1.02); bed.add(hb);
    place(bed, 0, backV - 0.75, 0);
    for (const s of [-1, 1]) if (width > 3) place(box(0.45, 0.5, 0.4, mats.wood), s * 1.1, backV - 0.15, 0.25);
    place(box(Math.min(1.8, width - 1), 2.1, 0.6, mats.wood), 0, -depth / 2 + 0.35, 1.05);
    place(flat(2.2, 1.2, mats.rug), 0, 0.1, 0.005);
  } else if (T === 'kitchen') {
    // тавцан + шүүгээ хаалганы эсрэг хананд, дээд шүүгээ, хөргөгч, ширээ
    const cw = width - 0.3;
    place(box(cw, 0.88, 0.6, mats.white), 0, backV + 0.05, 0.44);
    place(box(cw, 0.04, 0.64, mats.dark), 0, backV + 0.05, 0.9);
    place(box(cw, 0.7, 0.35, mats.white), 0, backV + 0.17, 1.85);
    place(box(0.5, 0.02, 0.4, mats.steel), -cw / 4, backV + 0.05, 0.915);
    place(box(0.45, 0.02, 0.4, mats.dark), cw / 4, backV + 0.05, 0.915);
    place(box(0.7, 1.8, 0.7, mats.steel), -width / 2 + 0.45, -depth / 2 + 0.5, 0.9);
    if (width > 2.8 && depth > 2.8) {
      place(box(1.1, 0.05, 0.8, mats.wood), 0.3, -0.3, 0.75); place(box(0.08, 0.72, 0.08, mats.wood), 0.3, -0.3, 0.36);
      for (const [u, v] of [[-0.3, -0.3], [0.9, -0.3], [0.3, 0.25], [0.3, -0.85]]) place(box(0.4, 0.45, 0.4, mats.wood), u, v, 0.225);
    }
  } else if (T === 'bath') {
    place(box(Math.min(1.7, width - 0.3), 0.6, 0.75, mats.white), 0, backV - 0.05, 0.3);
    place(box(0.6, 0.85, 0.45, mats.white), -width / 2 + 0.5, -depth / 2 + 0.4, 0.425);
    place(box(0.5, 0.6, 0.02, mats.steel), -width / 2 + 0.5, -depth / 2 + 0.17, 1.4);
    const wc = new THREE.Group(); wc.add(box(0.38, 0.4, 0.55, mats.white).translateY(0.2)); const tank = box(0.38, 0.4, 0.18, mats.white); tank.position.set(0, 0.6, -0.2); wc.add(tank);
    place(wc, width / 2 - 0.45, -depth / 2 + 0.45, 0);
  } else if (T === 'hall') {
    place(box(Math.min(1.0, width - 0.6), 0.5, 0.35, mats.wood), 0, backV, 0.25);
    place(box(0.5, 1.2, 0.02, mats.steel), 0, backV + 0.15, 1.5);
  } else if (T === 'office') {
    place(box(1.4, 0.04, 0.7, mats.wood), 0, backV - 0.1, 0.74); place(box(0.5, 0.5, 0.5, mats.dark), 0, backV - 0.9, 0.25); place(box(0.6, 0.4, 0.03, mats.dark), 0, backV, 1.05);
  } else if (T === 'balcony') {
    place(box(0.5, 0.45, 0.5, mats.wood), 0, 0, 0.225);
  } else if (T === 'other') {
    // хувцасны өрөө / агуулах: гол ханын дагуу шүүгээ + тавиурууд
    place(box(Math.max(0.8, width - 0.4), 2.1, 0.55, mats.wood), 0, backV + 0.08, 1.05);
    for (const y of [0.4, 0.9, 1.4]) place(box(Math.max(0.8, width - 0.4), 0.03, 0.3, mats.white), 0, -depth / 2 + 0.4, y);
  }
}

// ---------- Гадаад орчин: тэнгэр, газар, алс холын барилгууд ----------
function outdoors() {
  scene.background = new THREE.Color(0xcfe6ff);
  scene.fog = new THREE.Fog(0xcfe6ff, 30, 120);
  const g = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x9fc38a, roughness: 1 })); g.rotation.x = -Math.PI / 2; g.position.y = -0.02; scene.add(g);
  const b = plan.bounds; const rnd = (a, c) => a + Math.random() * (c - a);
  for (let i = 0; i < 40; i++) {
    const ang = rnd(0, Math.PI * 2), dist = rnd(18, 60); const w = rnd(8, 18), h = rnd(9, 40);
    const m = box(w, h, w, new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.58, 0.08, rnd(0.55, 0.8)), roughness: 0.9 }));
    m.position.set(b.x + b.w / 2 + Math.cos(ang) * dist, h / 2 - 0.5, b.y + b.h / 2 + Math.sin(ang) * dist); m.castShadow = false; scene.add(m);
  }
  const hemi = new THREE.HemisphereLight(0xdbeafe, 0xd6d3d1, 0.9); scene.add(hemi); // доод өнгө саарал — тааз ногоон туяатай болохгүй
  const sun = new THREE.DirectionalLight(0xfff5e0, 2.2); sun.position.set(b.x + b.w / 2 + 12, 18, b.y + b.h / 2 - 14); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  const s = Math.max(b.w, b.h) + 4; Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 60 }); sun.target.position.set(b.x + b.w / 2, 0, b.y + b.h / 2); scene.add(sun, sun.target);
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
}

// ---------- Байрлал: өрөө дотор эсвэл хаалганы бүсэд л явна ----------
function roomAt(x, z, pad = 0) { return rooms.find((r) => x >= r.x + pad && x <= r.x + r.w - pad && z >= r.y + pad && z <= r.y + r.h - pad); }
function walkable(x, z) {
  if (roomAt(x, z, 0.28)) return true;
  for (const d of plan.doors) { if (d.b === 'out') continue; const lo = Math.min(d.x1, d.x2) - 0.05, hi = Math.max(d.x1, d.x2) + 0.05, lz = Math.min(d.y1, d.y2) - 0.05, hz = Math.max(d.y1, d.y2) + 0.05; if (x >= lo - 0.35 && x <= hi + 0.35 && z >= lz - 0.35 && z <= hz + 0.35) return true; }
  return false;
}

// ---------- Автомат аялал: өрөөнүүдээр (хаалганы графаар) зам ----------
function pathBetween(a, b) {
  if (a === b) return [a];
  const prev = { [a]: null }; const q = [a];
  while (q.length) { const c = q.shift(); if (c === b) break; for (const n of doorGraph[c] || []) if (!(n in prev)) { prev[n] = c; q.push(n); } }
  if (!(b in prev)) return [a, b];
  const out = []; for (let c = b; c; c = prev[c]) out.unshift(c); return out;
}
function doorMid(a, b) { const d = plan.doors.find((d) => (d.a === a && d.b === b) || (d.a === b && d.b === a)); return d ? [(d.x1 + d.x2) / 2, (d.y1 + d.y2) / 2] : null; }
function buildTour() {
  const order = plan.tourOrder.filter((id) => byId[id]);
  const pts = []; // {x,z,room,pause}
  for (let i = 0; i < order.length; i++) {
    const r = byId[order[i]]; pts.push({ x: r.x + r.w / 2, z: r.y + r.h / 2, room: r.id, pause: true });
    if (i + 1 < order.length) {
      const seq = pathBetween(order[i], order[i + 1]);
      for (let k = 0; k + 1 < seq.length; k++) { const m = doorMid(seq[k], seq[k + 1]); if (m) pts.push({ x: m[0], z: m[1], room: seq[k + 1] }); if (k + 2 < seq.length) { const rr = byId[seq[k + 1]]; pts.push({ x: rr.x + rr.w / 2, z: rr.y + rr.h / 2, room: rr.id }); } }
    }
  }
  return pts;
}

// ---------- Камер, удирдлага ----------
const cam = { x: 0, z: 0, yaw: 0, pitch: 0 };
// Өрөөнд орох: хаалганы талын хананаас 0.8 м дотогш, гол хана руу харна
function enterRoom(r) {
  const ds = doorSide(r); const cx = r.x + r.w / 2, cz = r.y + r.h / 2;
  const back = { S: [0, 1], N: [0, -1], W: [-1, 0], E: [1, 0] }[ds]; const half = (ds === 'N' || ds === 'S') ? r.h / 2 : r.w / 2;
  const d = Math.max(0.3, half - 0.8);
  cam.x = cx + back[0] * d; cam.z = cz + back[1] * d; cam.pitch = -0.03;
  cam.yaw = { S: 0, N: Math.PI, W: -Math.PI / 2, E: Math.PI / 2 }[ds];
}
const keys = {};
let mode = 'auto', tourPts = [], tourI = 0, pauseT = 0, sweep = 0;
function setMode(m) { mode = m; $('#bAuto').classList.toggle('on', m === 'auto'); $('#bFree').classList.toggle('on', m === 'free'); }
function moveTo(x, z) { if (walkable(x, z)) { cam.x = x; cam.z = z; return true; } if (walkable(x, cam.z)) { cam.x = x; return true; } if (walkable(cam.x, z)) { cam.z = z; return true; } return false; }
function stepAuto(dt) {
  if (!tourPts.length) return;
  const p = tourPts[tourI];
  if (p.pause && pauseT > 0) { pauseT -= dt; sweep += dt; cam.yaw = p.yaw0 + Math.sin(sweep * 0.9) * 1.1; cam.pitch += (-0.05 - cam.pitch) * 0.05; if (pauseT <= 0) { tourI = (tourI + 1) % tourPts.length; } return; }
  const dx = p.x - cam.x, dz = p.z - cam.z, dist = Math.hypot(dx, dz);
  const targetYaw = Math.atan2(-dx, -dz);
  let dy = targetYaw - cam.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); cam.yaw += dy * Math.min(1, dt * 3);
  cam.pitch += (0 - cam.pitch) * 0.05;
  const sp = 1.15 * dt;
  if (dist <= sp) { cam.x = p.x; cam.z = p.z; if (p.pause) { pauseT = 3.2; sweep = 0; p.yaw0 = cam.yaw; } else tourI = (tourI + 1) % tourPts.length; }
  else { cam.x += dx / dist * sp; cam.z += dz / dist * sp; }
}
function stepFree(dt) {
  const sp = 1.8 * dt; let f = 0, s = 0;
  if (keys.w || keys.ArrowUp) f += 1; if (keys.s || keys.ArrowDown) f -= 1; if (keys.a || keys.ArrowLeft) s -= 1; if (keys.d || keys.ArrowRight) s += 1;
  if (!f && !s) return;
  const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw); const rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
  moveTo(cam.x + (fx * f + rx * s) * sp, cam.z + (fz * f + rz * s) * sp);
}
function bindControls() {
  const c = renderer.domElement; let drag = null;
  const onDown = (e) => { drag = { x: e.clientX, y: e.clientY }; if (mode === 'auto' && e.pointerType !== 'touch') { /* чирж харвал автомат аялал түр зогсохгүй, зөвхөн харах өнцөг */ } };
  c.addEventListener('pointerdown', (e) => { onDown(e); c.setPointerCapture(e.pointerId); });
  c.addEventListener('pointermove', (e) => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY }; if (mode === 'auto' && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) setMode('free'); cam.yaw -= dx * 0.004; cam.pitch = Math.max(-1.2, Math.min(1.2, cam.pitch - dy * 0.003)); });
  c.addEventListener('pointerup', () => { drag = null; }); c.addEventListener('pointercancel', () => { drag = null; });
  window.addEventListener('keydown', (e) => { keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = true; if (['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key.length === 1 ? e.key.toLowerCase() : e.key)) { setMode('free'); e.preventDefault(); } });
  window.addEventListener('keyup', (e) => { keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = false; });
  document.querySelectorAll('.pad button').forEach((b) => { const k = b.dataset.k; const on = (e) => { e.preventDefault(); keys[k] = true; setMode('free'); }; const off = () => { keys[k] = false; }; b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off); });
  $('#bAuto').onclick = () => { setMode('auto'); };
  $('#bFree').onclick = () => setMode('free');
  $('#bFull').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); };
  $('#map').addEventListener('click', (e) => {
    const rect = e.currentTarget.getBoundingClientRect(); const mx = (e.clientX - rect.left) / rect.width * 440, my = (e.clientY - rect.top) / rect.height * 340;
    const { sc, ox, oy } = mapXform(); const px = (mx - ox) / sc + plan.bounds.x, pz = (my - oy) / sc + plan.bounds.y;
    const r = roomAt(px, pz); if (!r) return;
    const fade = $('#fade'); fade.style.opacity = 1; setTimeout(() => { enterRoom(r); setMode('free'); fade.style.opacity = 0; }, 360);
  });
}

// ---------- Минимап ----------
function mapXform() { const b = plan.bounds; const sc = Math.min(400 / b.w, 300 / b.h); return { sc, ox: (440 - b.w * sc) / 2, oy: (340 - b.h * sc) / 2 }; }
function drawMap() {
  const c = $('#map'), g = c.getContext('2d'); g.clearRect(0, 0, 440, 340);
  const { sc, ox, oy } = mapXform(); const b = plan.bounds; const X = (x) => ox + (x - b.x) * sc, Y = (y) => oy + (y - b.y) * sc;
  for (const r of rooms) { g.fillStyle = MAP_FILL[r.type] || '#e5e7eb'; g.fillRect(X(r.x), Y(r.y), r.w * sc, r.h * sc); g.strokeStyle = '#1e293b'; g.lineWidth = 3; g.strokeRect(X(r.x), Y(r.y), r.w * sc, r.h * sc); }
  for (const d of plan.doors) { g.strokeStyle = d.b === 'out' ? '#dc2626' : '#f8fafc'; g.lineWidth = 5; g.beginPath(); g.moveTo(X(d.x1), Y(d.y1)); g.lineTo(X(d.x2), Y(d.y2)); g.stroke(); }
  for (const w of plan.windows) { g.strokeStyle = '#2563eb'; g.lineWidth = 5; g.beginPath(); g.moveTo(X(w.x1), Y(w.y1)); g.lineTo(X(w.x2), Y(w.y2)); g.stroke(); }
  g.fillStyle = '#0f172a'; g.font = '600 13px Inter,sans-serif'; g.textAlign = 'center';
  for (const r of rooms) if (r.w * sc > 40) g.fillText(r.name, X(r.x + r.w / 2), Y(r.y + r.h / 2) + 4);
  // камер
  const px = X(cam.x), py = Y(cam.z); g.fillStyle = 'rgba(37,99,235,.25)'; g.beginPath(); g.moveTo(px, py); g.arc(px, py, 34, -cam.yaw - Math.PI / 2 - 0.6, -cam.yaw - Math.PI / 2 + 0.6); g.closePath(); g.fill();
  g.fillStyle = '#2563eb'; g.beginPath(); g.arc(px, py, 7, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke();
}

// ---------- Зургууд: өрөөний хананд жаазтай, overlay, 360° ----------
const assetsByType = {}; let curRoomId = null; let panoMesh = null, panoActive = false, savedCam = null;
function assetUrl(id) { return `/tour-public/${token}/asset/${id}`; }
function hangPhotos() {
  const loader = new THREE.TextureLoader();
  for (const r of rooms) {
    const list = assetsByType[r.type] || []; if (!list.length) continue;
    const a = list[0]; const side = doorSide(r);
    // хаалганы эсрэг хананд (тавилгын арын хана) жааз; зураг ачаалагдмагц харьцаа тааруулна
    loader.load(assetUrl(a.id), (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace; const ar = tex.image.width / tex.image.height; if (ar > 1.9) { a.pano = true; return; }
      const w = 0.9, h = w / ar; const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
      const fr = box(w + 0.08, h + 0.08, 0.03, mats.dark);
      const cx = r.x + r.w / 2, cz = r.y + r.h / 2, off = 0.08; let pos, rot = 0;
      if (side === 'S') { pos = [cx + (r.type === 'living' ? -1.2 : 0.9), r.y + WALL_T + off, 0]; } else if (side === 'N') { pos = [cx + 0.9, r.y + r.h - WALL_T - off, Math.PI]; } else if (side === 'W') { pos = [r.x + r.w - WALL_T - off, cz + 0.9, -Math.PI / 2]; } else { pos = [r.x + WALL_T + off, cz + 0.9, Math.PI / 2]; }
      [m, fr].forEach((o, i) => { o.position.set(pos[0], 1.55, pos[1]); o.rotation.y = pos[2]; if (i === 1) o.position.add(new THREE.Vector3(Math.sin(pos[2]) * -0.01, 0, Math.cos(pos[2]) * -0.01)); scene.add(o); });
    });
  }
}
function showPhotos() {
  const r = byId[curRoomId]; const list = r ? (assetsByType[r.type] || []) : []; const all = list.length ? list : Object.values(assetsByType).flat();
  $('#photoGrid').innerHTML = all.map((a) => `<img src="${assetUrl(a.id)}" alt="">`).join('') || '<p>Зураг оруулаагүй байна.</p>';
  $('#photos').style.display = 'block';
}
function togglePano() {
  if (panoActive) { scene.remove(panoMesh); panoActive = false; Object.assign(cam, savedCam); $('#bPano').classList.remove('on'); return; }
  const r = byId[curRoomId]; const a = (assetsByType[r && r.type] || []).find((x) => x.pano); if (!a) return;
  new THREE.TextureLoader().load(assetUrl(a.id), (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace; panoMesh = new THREE.Mesh(new THREE.SphereGeometry(6, 48, 32), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide }));
    panoMesh.position.set(cam.x, EYE, cam.z); scene.add(panoMesh); panoActive = true; savedCam = { ...cam }; setMode('free'); $('#bPano').classList.add('on');
  });
}

// ---------- Эхлэл ----------
async function main() {
  const res = await fetch(`/tour-data/${token}`); if (!res.ok) { $('#load').textContent = 'Аялал олдсонгүй'; return; }
  data = await res.json(); plan = data.plan; rooms = plan.rooms; byId = Object.fromEntries(rooms.map((r) => [r.id, r]));
  for (const d of plan.doors) { if (d.b === 'out') continue; (doorGraph[d.a] ||= []).push(d.b); (doorGraph[d.b] ||= []).push(d.a); }
  for (const a of data.assets) (assetsByType[a.type] ||= []).push(a);
  const p = data.property || {};
  $('#title').textContent = `${p.district || ''}${p.khoroolol ? ', ' + p.khoroolol : ''} · ${p.rooms || rooms.length} өрөө · ${p.area || plan.totalArea} м²${p.floor ? ` · ${p.floor}/${p.total_floors || '—'} давхар` : ''}${data.company ? ' · ' + data.company : ''}`;
  document.title = `POV Tour — ${p.district || 'Зууч'}`;
  renderer = new THREE.WebGLRenderer({ canvas: $('#c'), antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(72, 1, 0.05, 200);
  initMats(); outdoors();
  for (const r of rooms) scene.add(buildRoom(r));
  hangPhotos();
  if (data.assets.length) $('#bPhotos').disabled = false;
  $('#bPhotos').onclick = showPhotos; $('#bClosePhotos').onclick = () => { $('#photos').style.display = 'none'; }; $('#bPano').onclick = togglePano;
  // эхлэл: орцны өрөөний төв, орцны хаалганаас дотогш харна
  const e = byId[plan.entry] || rooms[0]; cam.x = e.x + e.w / 2; cam.z = e.y + e.h / 2;
  const ent = plan.doors.find((d) => d.b === 'out'); if (ent) { const dx = (ent.x1 + ent.x2) / 2 - cam.x, dz = (ent.y1 + ent.y2) / 2 - cam.z; cam.yaw = Math.atan2(-dx, -dz) + Math.PI; }
  tourPts = buildTour(); tourI = 0; pauseT = 2.5; sweep = 0; if (tourPts[0]) tourPts[0].yaw0 = cam.yaw;
  // ?start=<өрөө id>&yaw=<рад> — тодорхой өрөөнөөс эхлэх (хуваалцах, зураг авах)
  const q = new URLSearchParams(location.search); const sr = byId[q.get('start')];
  if (sr) { enterRoom(sr); if (q.get('yaw')) cam.yaw = Number(q.get('yaw')); setMode('free'); }
  bindControls();
  const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }; addEventListener('resize', resize); resize();
  $('#load').style.display = 'none';
  let last = performance.now(), mapT = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!panoActive) { if (mode === 'auto') stepAuto(dt); else stepFree(dt); }
    camera.position.set(cam.x, EYE, cam.z); camera.rotation.set(0, 0, 0, 'YXZ'); camera.rotation.y = cam.yaw; camera.rotation.x = cam.pitch;
    const r = roomAt(cam.x, cam.z); const id = r ? r.id : null;
    if (id !== curRoomId) { curRoomId = id; $('#rName').textContent = r ? r.name : '—'; $('#rArea').textContent = r ? `${(r.w * r.h).toFixed(1)} м² · ${r.w} × ${r.h} м` : ''; const hasPano = r && (assetsByType[r.type] || []).some((x) => x.pano); $('#bPano').style.display = hasPano ? '' : 'none'; }
    mapT += dt; if (mapT > 0.08) { mapT = 0; drawMap(); }
    renderer.render(scene, camera); requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
main().catch((e) => { console.error(e); $('#load').textContent = 'Алдаа: ' + e.message; });
