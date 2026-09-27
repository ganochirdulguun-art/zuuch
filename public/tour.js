// «Зууч» — Virtual POV Tour үзэгч (three.js): серверийн планаар 3D орчин, бодит CC0 glTF тавилга (Poly Haven), PBR текстур, 360° панорам
import * as THREE from 'three';
import { GLTFLoader } from '/vendor/GLTFLoader.js';
import { RoundedBoxGeometry } from '/vendor/RoundedBoxGeometry.js';
import { RoomEnvironment } from '/vendor/RoomEnvironment.js';

const $ = (s) => document.querySelector(s);
const token = location.pathname.split('/').filter(Boolean).pop();
const EYE = 1.6, WALL_T = 0.12;
let DOOR_H = 2.05, WIN_LO = 0.9, WIN_HI = 2.15; // AI шинжилгээний style-аар дарагдана
let STYLE = null;
const MAP_FILL = { living: '#93c5fd', kitchen: '#fde68a', bedroom: '#c4b5fd', bath: '#a5f3fc', hall: '#e2e8f0', balcony: '#bbf7d0', office: '#fdba74', other: '#e5e7eb' };
const TYPE_MN = { living: 'зочны', kitchen: 'гал тогоо', bedroom: 'унтлагын', bath: 'угаалгын', hall: 'коридор', balcony: 'тагт', office: 'ажлын', other: 'бусад' };

// ---------- Текстур: Poly Haven (CC0, /textures) + процедур нөөц ----------
const texLoader = new THREE.TextureLoader();
function tex(url, repeat = [1, 1], srgb = true) {
  const t = texLoader.load(url); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function pbr(name, repeat, extra = {}) {
  return new THREE.MeshStandardMaterial({ map: tex(`/textures/${name}_diff.jpg`, repeat), normalMap: tex(`/textures/${name}_nor.jpg`, repeat, false), roughnessMap: tex(`/textures/${name}_rough.jpg`, repeat, false), roughness: 1, ...extra });
}
function canvasTex(draw, size = 512, repeat = [1, 1]) {
  const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
const texTile = (base = '#eeece8', n = 4) => canvasTex((g, s) => {
  g.fillStyle = base; g.fillRect(0, 0, s, s); g.strokeStyle = 'rgba(0,0,0,.16)'; g.lineWidth = 3;
  for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * s / n, 0); g.lineTo(i * s / n, s); g.stroke(); g.beginPath(); g.moveTo(0, i * s / n); g.lineTo(s, i * s / n); g.stroke(); }
});

let data, plan, scene, camera, renderer, rooms = [], byId = {}, doorGraph = {};
const mats = {};
const furnGroup = new THREE.Group();
const roomLights = []; // өрөө бүрийн цэгэн гэрэл — зайгаар хасна (FPS)
// Цайвар царс банзан шал (процедур): 0.2 × 1.6 м банз, шаталсан, нарийн зүүн шугам, зөөлөн ширхэг — лавлагаа рендерийн хэв маяг
const texOakPlanks = () => canvasTex((g, s) => {
  g.fillStyle = '#d8c3a3'; g.fillRect(0, 0, s, s);
  const cols = 4, rows = 8; // 4 банз өргөнөөр (0.8 м), 1 давталт = 0.8 × 3.2 м
  for (let c = 0; c < cols; c++) {
    const off = (c % 2) * (s / rows / 2);
    for (let r = -1; r <= rows; r++) {
      const x = c * (s / cols), y = r * (s / rows) + off; const l = 0.93 + Math.random() * 0.12;
      g.fillStyle = `rgb(${Math.round(216 * l)},${Math.round(195 * l)},${Math.round(163 * l)})`; g.fillRect(x + 1, y + 1, s / cols - 2, s / rows - 2);
      for (let k = 0; k < 6; k++) { g.strokeStyle = `rgba(120,90,55,${0.05 + Math.random() * 0.07})`; g.lineWidth = 1 + Math.random(); const gx = x + 4 + Math.random() * (s / cols - 8); g.beginPath(); g.moveTo(gx, y + 2); g.bezierCurveTo(gx + 6, y + s / rows / 3, gx - 6, y + s / rows / 1.5, gx + 3, y + s / rows - 2); g.stroke(); }
      g.strokeStyle = 'rgba(70,50,30,.35)'; g.lineWidth = 1.2; g.strokeRect(x + 1, y + 1, s / cols - 2, s / rows - 2);
    }
  }
}, 1024);
function initMats() {
  const planks = texOakPlanks();
  mats.floorWood = () => { const m = new THREE.MeshStandardMaterial({ map: planks.clone(), roughness: 0.55, normalMap: tex('/textures/wood_nor.jpg', [2, 2], false), normalScale: new THREE.Vector2(0.35, 0.35) }); m.map.needsUpdate = true; return m; };
  mats.wall = () => pbr('wall', [1, 1], { color: 0xe3d9cb }); // бежевэр (greige) хана
  mats.wood = pbr('wood', [1, 1]);
  mats.marble = pbr('marble', [1, 1], { roughness: 0.35 });
  mats.fabricNor = tex('/textures/fabric_nor.jpg', [3, 3], false); mats.fabricRough = tex('/textures/fabric_rough.jpg', [3, 3], false);
  mats.tile = new THREE.MeshStandardMaterial({ map: texTile('#e9e6e0'), roughness: 0.3, metalness: 0.02 });
  mats.bathFloor = new THREE.MeshStandardMaterial({ map: texTile('#b9c0c8', 5), roughness: 0.35 });
  // Угаалгын хана: цайвар плита + 1.15 м-т цэнхэр-саарал туузан хүрээ (шал/хана/тааз ялгарна)
  mats.bathWall = new THREE.MeshStandardMaterial({ map: canvasTex((g, s) => {
    g.fillStyle = '#eef0f2'; g.fillRect(0, 0, s, s); g.strokeStyle = 'rgba(0,0,0,.14)'; g.lineWidth = 3;
    const cols = 4, rows = 12; for (let i = 0; i <= cols; i++) { g.beginPath(); g.moveTo(i * s / cols, 0); g.lineTo(i * s / cols, s); g.stroke(); } for (let i = 0; i <= rows; i++) { g.beginPath(); g.moveTo(0, i * s / rows); g.lineTo(s, i * s / rows); g.stroke(); }
    const band = s * (1 - 1.2 / 2.7); g.fillStyle = '#7c93a8'; g.fillRect(0, band - s / rows, s, s / rows);
  }, 512, [1, 1]), roughness: 0.2 });
  mats.plinth = new THREE.MeshStandardMaterial({ color: 0xf6f4f0, roughness: 0.5 }); // цагаан хөвөө (лавлагаа шиг)
  mats.ceil = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
  mats.led = new THREE.MeshBasicMaterial({ color: 0xfff0d2 }); // таазны хонхорхойн LED тууз (өөрөө гэрэлтэнэ)
  mats.oak = new THREE.MeshStandardMaterial({ color: 0xd9c4a4, roughness: 0.6, normalMap: tex('/textures/wood_nor.jpg', [1, 1], false), normalScale: new THREE.Vector2(0.4, 0.4) });
  mats.headboard = new THREE.MeshStandardMaterial({ color: 0xcdbfae, roughness: 1, normalMap: mats.fabricNor, roughnessMap: mats.fabricRough });
  // Шил: transmission сценийг 2 дахин рендерлэдэг (FPS унадаг) → энгийн тунгалаг материал
  mats.glass = new THREE.MeshStandardMaterial({ color: 0xdff0ff, transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false });
  mats.frame = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5 });
  mats.door = new THREE.MeshStandardMaterial({ map: tex('/textures/wood_diff.jpg', [1, 2]), roughness: 0.55 });
  mats.dark = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.3, metalness: 0.2 });
  mats.screen = new THREE.MeshPhysicalMaterial({ color: 0x0b1020, roughness: 0.08, metalness: 0.3, clearcoat: 1 });
  mats.white = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.15, clearcoat: 0.8, clearcoatRoughness: 0.1 });
  mats.linen = new THREE.MeshStandardMaterial({ color: 0xf1f0ec, roughness: 1, normalMap: mats.fabricNor, roughnessMap: mats.fabricRough });
  mats.duvet = new THREE.MeshStandardMaterial({ color: 0x9aa7b8, roughness: 1, normalMap: mats.fabricNor, roughnessMap: mats.fabricRough });
  mats.rug = new THREE.MeshStandardMaterial({ color: 0xd6d3cd, roughness: 1, normalMap: mats.fabricNor });
  mats.steel = new THREE.MeshStandardMaterial({ color: 0xcfd4da, roughness: 0.25, metalness: 0.9 });
  mats.mirror = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.02, metalness: 1 });
  mats.matteWhite = new THREE.MeshStandardMaterial({ color: 0xf7f7f5, roughness: 0.6 });
}
const box = (w, h, d, m) => { const g = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); g.castShadow = g.receiveShadow = true; return g; };
const rbox = (w, h, d, m, r = 0.04) => { const g = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r), m); g.castShadow = g.receiveShadow = true; return g; };
const flat = (w, d, m) => { const g = new THREE.Group(); const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m); p.rotation.x = -Math.PI / 2; p.receiveShadow = true; g.add(p); return g; };
// Цэвэрхэн цагаан тавиур (хуучирсан Shelf_01 моделийн оронд): хажуу хана + n тавиур, суурь y=0, төв x/z=0
function shelfUnit(w = 0.9, h = 1.9, d = 0.3, n = 4) {
  const g = new THREE.Group(); const t = 0.025;
  for (const s of [-1, 1]) { const side = rbox(t, h, d, mats.matteWhite, 0.005); side.position.set(s * (w / 2 - t / 2), h / 2, 0); g.add(side); }
  const back = box(w, h, 0.01, mats.matteWhite); back.position.set(0, h / 2, -d / 2 + 0.005); g.add(back);
  for (let i = 0; i <= n; i++) { const sh = rbox(w - 2 * t, t, d, mats.matteWhite, 0.005); sh.position.set(0, i * (h - t) / n + t / 2, 0); g.add(sh); }
  return g;
}

// ---------- glTF моделууд (Poly Haven CC0, /models/<нэр>/<нэр>.gltf), кэштэй; суурь y=0, төв x/z=0 ----------
const gltf = new GLTFLoader(); const modelCache = {}; let pending = 0, loadedN = 0;
function loadModel(name) {
  if (!modelCache[name]) {
    pending++;
    modelCache[name] = new Promise((res) => gltf.load(`/models/${name}/${name}.gltf`, (g) => {
      const root = g.scene; root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      const bb = new THREE.Box3().setFromObject(root); const c = bb.getCenter(new THREE.Vector3());
      root.position.set(-c.x, -bb.min.y, -c.z);
      const wrap = new THREE.Group(); wrap.add(root); wrap.userData.size = bb.getSize(new THREE.Vector3());
      loadedN++; res(wrap);
    }, undefined, () => { loadedN++; res(null); }));
  }
  return modelCache[name];
}
// Загварын «урд тал» (эргэлтийн залруулга, рад) — дэлгэцээр шалгаж тохируулсан
const FRONT = { sofa_03: 0, modern_arm_chair_01: 0, dining_chair_02: 0, modern_wooden_cabinet: 0, painted_wooden_nightstand: 0, Shelf_01: 0, electric_stove: 0, hanging_picture_frame_01: 0, ornate_mirror_01: 0, wall_clock: 0 };

// ---------- Дэлхийн координат: план (x баруун, y урагш=өмнө) → three (x, z=y) ----------
function segOnEdge(seg, edge) {
  if (edge.axis === 'x') { if (Math.abs(seg.y1 - edge.c) > 0.07 || Math.abs(seg.y2 - edge.c) > 0.07) return null; const lo = Math.max(Math.min(seg.x1, seg.x2), edge.a), hi = Math.min(Math.max(seg.x1, seg.x2), edge.b); return hi > lo ? [lo, hi] : null; }
  if (Math.abs(seg.x1 - edge.c) > 0.07 || Math.abs(seg.x2 - edge.c) > 0.07) return null; const lo = Math.max(Math.min(seg.y1, seg.y2), edge.a), hi = Math.min(Math.max(seg.y1, seg.y2), edge.b); return hi > lo ? [lo, hi] : null;
}
function buildRoom(r) {
  const H = plan.ceiling; const g = new THREE.Group();
  const floorKind = r.floor || (STYLE && STYLE.floor) || null; // өрөөний гар сонголт > AI > анхдагч
  const wet = r.type === 'bath' || (floorKind ? floorKind === 'tile' : r.type === 'kitchen');
  const floorMat = r.type === 'bath' ? mats.bathFloor.clone() : wet ? mats.tile.clone() : mats.floorWood();
  if (!wet && floorKind === 'carpet') { floorMat.map = null; floorMat.color.set(0xb9b2a6); floorMat.roughness = 1; }
  if (wet) { floorMat.map = floorMat.map.clone(); floorMat.map.repeat.set(r.w / 1.2, r.h / 1.2); floorMat.map.needsUpdate = true; }
  else { floorMat.map.repeat.set(r.w / 0.8, r.h / 3.2); floorMat.map.needsUpdate = true; floorMat.normalMap = floorMat.normalMap.clone(); floorMat.normalMap.repeat.set(r.w / 1.5, r.h / 1.5); floorMat.normalMap.needsUpdate = true; }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.h), floorMat); floor.rotation.x = -Math.PI / 2; floor.position.set(r.x + r.w / 2, 0, r.y + r.h / 2); floor.receiveShadow = true; g.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.h), mats.ceil); ceil.rotation.x = Math.PI / 2; ceil.position.set(r.x + r.w / 2, H, r.y + r.h / 2); g.add(ceil);
  // Таазны хонхорхой (cove): ханын дагуу 0.3 м өргөн, 0.1 м зузаан цагаан ирмэг + дотор талд нь дулаан LED тууз (лавлагаа рендерийн хэв маяг)
  // Дам нуруу (AI шинжилгээ: style.beams[{room}]) — таазны доор өрөөний богино тэнхлэгийн дагуу 0.3 × 0.25 м
  // Дам нуруу: гар хэмжээс (r.beams: axis x = зүүнээс баруун тийш урттай, off = хойд/зүүн захаас) давуу; үгүй бол AI (style.beams[{room}])
  let beamList = Array.isArray(r.beams) && r.beams.length ? r.beams : null;
  if (!beamList && STYLE && Array.isArray(STYLE.beams) && STYLE.beams.find((b) => String(b.room || '').toLowerCase().includes((TYPE_MN[r.type] || '').toLowerCase()) || String(b.room || '') === r.id)) beamList = [{ axis: r.w >= r.h ? 'y' : 'x', off: (r.w >= r.h ? r.w : r.h) / 2, w: 0.3, h: 0.25 }];
  const beam = !!beamList;
  for (const b of beamList || []) {
    const bm = b.axis === 'x' ? box(r.w, b.h, b.w, mats.ceil) : box(b.w, b.h, r.h, mats.ceil);
    bm.position.set(b.axis === 'x' ? r.x + r.w / 2 : r.x + Math.min(r.w - b.w / 2, Math.max(b.w / 2, b.off)), H - b.h / 2, b.axis === 'x' ? r.y + Math.min(r.h - b.w / 2, Math.max(b.w / 2, b.off)) : r.y + r.h / 2); g.add(bm);
  }
  // Довжоо (орцны хаалганы босго) — style.threshold_cm
  if (STYLE && STYLE.threshold_cm > 0) for (const d of plan.doors) if (d.b === 'out' && d.a === r.id) { const th = box(Math.max(Math.abs(d.x2 - d.x1), 0.2), STYLE.threshold_cm / 100, Math.max(Math.abs(d.y2 - d.y1), 0.2), mats.plinth); th.position.set((d.x1 + d.x2) / 2, STYLE.threshold_cm / 200, (d.y1 + d.y2) / 2); g.add(th); }
  if (r.w > 2 && r.h > 2 && r.type !== 'bath' && !beam && (!STYLE || STYLE.ceiling_cove !== false)) {
    const bw = 0.3, bh = 0.1, led = 0.025;
    const ring = [[r.x + r.w / 2, r.y + bw / 2, r.w, bw], [r.x + r.w / 2, r.y + r.h - bw / 2, r.w, bw], [r.x + bw / 2, r.y + r.h / 2, bw, r.h], [r.x + r.w - bw / 2, r.y + r.h / 2, bw, r.h]];
    for (const [px, pz, sx, sz] of ring) { const b = box(sx, bh, sz, mats.ceil); b.position.set(px, H - bh / 2, pz); g.add(b); }
    const inner = [[r.x + r.w / 2, r.y + bw + led / 2, r.w - 2 * bw, led], [r.x + r.w / 2, r.y + r.h - bw - led / 2, r.w - 2 * bw, led], [r.x + bw + led / 2, r.y + r.h / 2, led, r.h - 2 * bw], [r.x + r.w - bw - led / 2, r.y + r.h / 2, led, r.h - 2 * bw]];
    for (const [px, pz, sx, sz] of inner) { const s = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.02, sz), mats.led); s.position.set(px, H - bh + 0.01, pz); g.add(s); }
  }
  const wallMat = r.type === 'bath' ? mats.bathWall.clone() : mats.wall();
  if (r.type === 'bath') { wallMat.map = wallMat.map.clone(); wallMat.map.repeat.set(Math.max(r.w, r.h) / 0.9, 1); wallMat.map.needsUpdate = true; }
  else { for (const k of ['map', 'normalMap', 'roughnessMap']) { wallMat[k].repeat.set(2.2, 1.4); } const wc = r.wallColor || (STYLE && STYLE.wall_color); if (wc) wallMat.color.set(wc); }
  const edges = [
    { side: 'N', axis: 'x', c: r.y, a: r.x, b: r.x + r.w, inward: +1 }, { side: 'S', axis: 'x', c: r.y + r.h, a: r.x, b: r.x + r.w, inward: -1 },
    { side: 'W', axis: 'y', c: r.x, a: r.y, b: r.y + r.h, inward: +1 }, { side: 'E', axis: 'y', c: r.x + r.w, a: r.y, b: r.y + r.h, inward: -1 },
  ];
  for (const e of edges) {
    const ops = [];
    for (const d of plan.doors) { if (d.a !== r.id && d.b !== r.id) continue; const o = segOnEdge(d, e); if (o) ops.push({ lo: o[0], hi: o[1], t: 'door', d }); }
    for (const wn of plan.windows) { if (wn.room !== r.id) continue; const o = segOnEdge(wn, e); if (o) ops.push({ lo: o[0], hi: o[1], t: 'win', sill: wn.sill || WIN_LO, top: Math.max((wn.sill || WIN_LO) + 0.4, wn.top || WIN_HI) }); }
    ops.sort((p, q) => p.lo - q.lo);
    const cc = e.c + e.inward * WALL_T / 2;
    const put = (lo, hi, y0, y1, m = wallMat) => {
      if (hi - lo < 0.01 || y1 - y0 < 0.01) return;
      const len = hi - lo, hgt = y1 - y0, mid = (lo + hi) / 2;
      // Хүрээ (frame) ханаас 2.5 см цухуйна — хананы хайрцагтай нэг хавтгайд давхцаж анивчихгүй (z-fighting)
      const th = m === mats.frame ? WALL_T + 0.05 : WALL_T;
      const b = e.axis === 'x' ? box(len, hgt, th, m) : box(th, hgt, len, m);
      b.position.set(e.axis === 'x' ? mid : cc, y0 + hgt / 2, e.axis === 'x' ? cc : mid); g.add(b);
      // Шалны хөвөө (plinth) — хана/шалны зааг тодорхой харагдана (хаалганы нээлхийд байхгүй)
      if (y0 === 0 && m === wallMat) { const p = e.axis === 'x' ? box(len, 0.08, WALL_T + 0.03, mats.plinth) : box(WALL_T + 0.03, 0.08, len, mats.plinth); p.position.set(e.axis === 'x' ? mid : cc, 0.04, e.axis === 'x' ? cc : mid); g.add(p); }
    };
    let cur = e.a;
    for (const o of ops) {
      put(cur, o.lo, 0, H);
      if (o.t === 'door') {
        put(o.lo, o.hi, DOOR_H, H);
        const fw = 0.06; put(o.lo - fw, o.lo, 0, DOOR_H + fw, mats.frame); put(o.hi, o.hi + fw, 0, DOOR_H + fw, mats.frame); put(o.lo, o.hi, DOOR_H, DOOR_H + fw, mats.frame);
        if (o.d.b === 'out') { const leaf = e.axis === 'x' ? box(o.hi - o.lo, DOOR_H, 0.05, mats.door) : box(0.05, DOOR_H, o.hi - o.lo, mats.door); leaf.position.set(e.axis === 'x' ? (o.lo + o.hi) / 2 : e.c, DOOR_H / 2, e.axis === 'x' ? e.c : (o.lo + o.hi) / 2); g.add(leaf); const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), mats.steel); knob.position.copy(leaf.position).add(new THREE.Vector3(e.axis === 'x' ? (o.hi - o.lo) / 2 - 0.1 : e.inward * 0.05, -0.05, e.axis === 'x' ? e.inward * 0.05 : (o.hi - o.lo) / 2 - 0.1)); g.add(knob); }
      } else {
        const WIN_LO = o.sill, WIN_HI = o.top; // цонх бүрийн өөрийн тавцан/дээд (гар хэмжээс эсвэл AI)
        put(o.lo, o.hi, 0, WIN_LO); put(o.lo, o.hi, WIN_HI, H);
        const gl = new THREE.Mesh(new THREE.PlaneGeometry(o.hi - o.lo, WIN_HI - WIN_LO), mats.glass);
        gl.position.set(e.axis === 'x' ? (o.lo + o.hi) / 2 : e.c, (WIN_LO + WIN_HI) / 2, e.axis === 'x' ? e.c : (o.lo + o.hi) / 2); if (e.axis === 'y') gl.rotation.y = Math.PI / 2; g.add(gl);
        const fw = 0.05; put(o.lo - fw, o.lo, WIN_LO - fw, WIN_HI + fw, mats.frame); put(o.hi, o.hi + fw, WIN_LO - fw, WIN_HI + fw, mats.frame); put(o.lo, o.hi, WIN_LO - fw, WIN_LO, mats.frame); put(o.lo, o.hi, WIN_HI, WIN_HI + fw, mats.frame);
        const mid = (o.lo + o.hi) / 2; const bar = e.axis === 'x' ? box(0.04, WIN_HI - WIN_LO, 0.05, mats.frame) : box(0.05, WIN_HI - WIN_LO, 0.04, mats.frame); bar.position.set(e.axis === 'x' ? mid : e.c, (WIN_LO + WIN_HI) / 2, e.axis === 'x' ? e.c : mid); g.add(bar);
        const sill = e.axis === 'x' ? box(o.hi - o.lo + 0.1, 0.04, 0.3, mats.frame) : box(0.3, 0.04, o.hi - o.lo + 0.1, mats.frame); sill.position.set(e.axis === 'x' ? mid : cc + e.inward * 0.1, WIN_LO, e.axis === 'x' ? cc + e.inward * 0.1 : mid); g.add(sill);
      }
      cur = o.hi;
    }
    put(cur, e.b, 0, H);
  }
  // Хавтгай шалны хөвөө (plinth)
  const pl = new THREE.PointLight(0xfff1dc, r.w * r.h > 14 ? 9 : 5, 0, 1.7); pl.position.set(r.x + r.w / 2, H - 0.3, r.y + r.h / 2); g.add(pl); roomLights.push(pl);
  if (r.type === 'bath' || r.type === 'hall' || r.type === 'kitchen' || r.type === 'other') { const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.04, 20), mats.matteWhite); lamp.position.copy(pl.position).setY(H - 0.02); g.add(lamp); }
  furnish(r);
  return g;
}

// ---------- Тавилга: гол хана (ТВ, орны толгой) = хаалганы эсрэг; цонхтой бол чөлөөт хана ----------
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
function mainSide(r) {
  const ds = doorSide(r); const opp = { S: 'N', N: 'S', W: 'E', E: 'W' }[ds];
  const winSides = new Set(plan.windows.filter((w) => w.room === r.id).map((w) => w.side));
  const doorSides = new Set(); for (const d of plan.doors) { if (d.a !== r.id && d.b !== r.id) continue; if (Math.abs(d.y1 - r.y) < 0.07 && Math.abs(d.y2 - r.y) < 0.07) doorSides.add('N'); else if (Math.abs(d.y1 - (r.y + r.h)) < 0.07) doorSides.add('S'); else if (Math.abs(d.x1 - r.x) < 0.07) doorSides.add('W'); else doorSides.add('E'); }
  if (!winSides.has(opp)) return opp;
  const free = ['W', 'E', 'N', 'S'].filter((s) => !winSides.has(s) && !doorSides.has(s) && s !== ds);
  return free[0] || opp;
}
function furnish(r) {
  const side = { N: 'S', S: 'N', W: 'E', E: 'W' }[mainSide(r)];
  const cx = r.x + r.w / 2, cz = r.y + r.h / 2; const H = plan.ceiling;
  const fwd = { S: [0, -1], N: [0, 1], W: [1, 0], E: [-1, 0] }[side]; const rgt = [-fwd[1], fwd[0]];
  const depth = (side === 'N' || side === 'S') ? r.h : r.w, width = (side === 'N' || side === 'S') ? r.w : r.h;
  const rotY = Math.atan2(fwd[0], fwd[1]);
  const g = new THREE.Group(); furnGroup.add(g); roomFurn[r.id] = g;
  // локал: u баруун, v урагш (гол хана руу); rot = загварын урд тал -v (камер руу) харна гэж үзнэ
  const place = (m, u, v, y = 0, rot = 0) => { if (!m) return null; m.position.set(cx + rgt[0] * u + fwd[0] * v, y, cz + rgt[1] * u + fwd[1] * v); m.rotation.y = rotY + Math.PI + rot; g.add(m); return m; };
  const model = (name, u, v, rot = 0, y = 0, scale = 1) => loadModel(name).then((m) => { if (!m) return; const c = m.clone(); c.scale.setScalar(scale); place(c, u, v, y, (FRONT[name] || 0) + rot); });
  const backV = depth / 2 - WALL_T; // гол хананы дотоод гадаргуу
  const T = r.type;
  if (T === 'living') {
    // ТВ-ийн шүүгээ + дэлгэц гол хананд; буйдан эсрэг талд ТВ рүү харна; дунд нь ширээ + хивс; сандал, ваар, зураг, цаг
    model('modern_wooden_cabinet', 0, backV - 0.36, 0);
    place(rbox(1.35, 0.78, 0.04, mats.screen, 0.01), 0, backV - 0.03, 1.25);
    model('ceramic_vase_01', -0.9, backV - 0.36, 0, 0.68);
    model('sofa_03', 0, Math.max(-depth / 2 + 0.6, -1.6), Math.PI);
    model('throw_pillows_01', -0.8, Math.max(-depth / 2 + 0.6, -1.6), Math.PI, 0.42);
    place(flat(2.4, 1.7, mats.rug), 0, 0.15, 0.004);
    model('modern_coffee_table_01', 0, 0.1, Math.PI / 2);
    if (width > 3.4) model('modern_arm_chair_01', width / 2 - 0.75, 0.3, -Math.PI / 2);
    model('wall_clock', -1.4, backV - 0.03, 0, 1.95); // ТВ-ийн хананд, дэлгэцийн хажууд
    if (width > 4.6) place(shelfUnit(0.9, 1.9, 0.3), -width / 2 + 0.62, backV - 0.16, 0);
  } else if (T === 'bedroom') {
    // Лавлагааны хэв маяг: цайвар царс хүрээ, бежевэр даавуун толгой, цагаан шүүгээ/тавиур
    const bw = width > 3.2 ? 1.7 : 1.45;
    const bed = new THREE.Group();
    bed.add(rbox(bw, 0.28, 2.05, mats.oak, 0.02).translateY(0.14));
    bed.add(rbox(bw - 0.06, 0.24, 1.98, mats.linen, 0.06).translateY(0.4));
    const duvet = rbox(bw + 0.02, 0.14, 1.35, mats.duvet, 0.06); duvet.position.set(0, 0.56, 0.3); bed.add(duvet);
    for (const s of [-1, 1]) { const p = rbox(0.62, 0.15, 0.42, mats.linen, 0.06); p.position.set(s * (bw / 4), 0.6, -0.72); p.rotation.x = -0.25; bed.add(p); }
    const hb = rbox(bw + 0.9, 1.1, 0.08, mats.headboard, 0.03); hb.position.set(0, 0.55, -1.05); bed.add(hb);
    const hbLed = new THREE.Mesh(new THREE.BoxGeometry(bw + 0.9, 0.015, 0.02), mats.led); hbLed.position.set(0, 1.09, -1.0); bed.add(hbLed);
    place(bed, 0, backV - 1.1, 0);
    for (const s of [-1, 1]) if (width > 2.9) { const ns = new THREE.Group(); ns.add(rbox(0.5, 0.5, 0.42, mats.matteWhite, 0.02).translateY(0.25)); const hnd = box(0.16, 0.015, 0.02, mats.steel); hnd.position.set(0, 0.3, 0.22); ns.add(hnd); place(ns, s * (bw / 2 + 0.4), backV - 0.35, 0); }
    const ward = rbox(Math.min(1.8, width - 1.0), 2.2, 0.6, mats.matteWhite, 0.01); place(ward, 0, -depth / 2 + 0.33, 1.1);
    for (const s of [-1, 1]) { const h = box(0.015, 0.7, 0.02, mats.steel); place(h, s * 0.05, -depth / 2 + 0.64, 1.15); }
    place(flat(2.0, 1.2, mats.rug), 0, 0.15, 0.004);
    model('hanging_picture_frame_01', 0, backV - 0.02, 0, 1.7);
    model('modern_ceiling_lamp_01', 0, 0, 0, H - 0.57, 0.6); // тааз дор 0.57 м — доод ирмэг ~2.1 м (нүүрэнд тулахгүй)
  } else if (T === 'kitchen') {
    // Тавцан (модон шүүгээ + гантиг), дээд шүүгээ, угаалтуур, плита (модель), хөргөгч, хоолны ширээ
    const cw = width - 0.3;
    place(rbox(cw, 0.86, 0.6, mats.wood, 0.01), 0, backV - 0.3, 0.43);
    place(rbox(cw + 0.04, 0.04, 0.64, mats.marble, 0.01), 0, backV - 0.31, 0.88);
    for (let i = 0; i < Math.floor(cw / 0.6); i++) { const hnd = box(0.14, 0.02, 0.02, mats.steel); place(hnd, -cw / 2 + 0.3 + i * 0.6, backV - 0.6, 0.72); }
    place(rbox(cw, 0.7, 0.35, mats.matteWhite, 0.01), 0, backV - 0.175, 1.9);
    const sink = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.18, 0.4, 3, 0.03), mats.steel); place(sink, -cw / 4, backV - 0.31, 0.83);
    const tap = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 10), mats.steel); place(tap, -cw / 4, backV - 0.12, 1.05);
    model('electric_stove', cw / 4 - 0.1, backV - 0.31, 0);
    place(rbox(0.7, 1.85, 0.7, mats.steel, 0.03), -width / 2 + 0.5, -depth / 2 + 0.5, 0.925);
    if (width > 2.8 && depth > 2.9) { model('dining_table', 0.3, -0.4, 0, 0, 0.75); for (const [u, v, rr] of [[-0.55, -0.4, -Math.PI / 2], [1.15, -0.4, Math.PI / 2], [0.3, 0.15, Math.PI], [0.3, -0.95, 0]]) model('dining_chair_02', u, v, rr); }
    model('wall_clock', width / 2 - 0.1, 0.3, Math.PI / 2, 1.9);
  } else if (T === 'bath') {
    const tub = new THREE.Group(); tub.add(rbox(Math.min(1.7, width - 0.3), 0.58, 0.75, mats.white, 0.08).translateY(0.29)); const inner = rbox(Math.min(1.7, width - 0.3) - 0.16, 0.4, 0.55, mats.tile, 0.08); inner.position.y = 0.42; tub.add(inner);
    place(tub, 0, backV - 0.4, 0);
    place(rbox(0.6, 0.8, 0.45, mats.wood, 0.02), -width / 2 + 0.5, -depth / 2 + 0.36, 0.4);
    place(rbox(0.5, 0.12, 0.4, mats.white, 0.05), -width / 2 + 0.5, -depth / 2 + 0.36, 0.86);
    place(new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.25, 8), mats.steel), -width / 2 + 0.5, -depth / 2 + 0.2, 1.0);
    model('ornate_mirror_01', -width / 2 + 0.5, -depth / 2 + 0.14, Math.PI, 1.45);
    const wc = new THREE.Group(); wc.add(rbox(0.38, 0.4, 0.55, mats.white, 0.06).translateY(0.2)); const tank = rbox(0.38, 0.4, 0.18, mats.white, 0.03); tank.position.set(0, 0.6, -0.2); wc.add(tank);
    place(wc, width / 2 - 0.4, -depth / 2 + 0.45, 0);
    const towel = rbox(0.5, 0.35, 0.03, mats.linen, 0.01); place(towel, width / 2 - 0.4, backV - 0.02, 1.3);
  } else if (T === 'hall') {
    place(shelfUnit(Math.min(1.0, width - 0.6), 1.0, 0.32, 2), width > 2.6 ? -width / 2 + 0.7 : 0, backV - 0.17, 0);
    model('ornate_mirror_01', width > 2.6 ? width / 2 - 0.8 : 0, backV - 0.02, 0, 1.5);
    model('wall_clock', -width / 2 + 0.1, 0, -Math.PI / 2, 1.9);
  } else if (T === 'office') {
    model('dining_table', 0, backV - 0.75, 0, 0, 0.7); model('dining_chair_02', 0, backV - 1.6, 0);
    place(shelfUnit(0.9, 1.9, 0.3), width / 2 - 0.6, backV - 0.16, 0);
  } else if (T === 'other') {
    place(shelfUnit(Math.min(1.0, width - 0.3), 2.1, 0.35, 5), width > 2 ? -0.55 : 0, backV - 0.19, 0); if (width > 2) place(shelfUnit(1.0, 2.1, 0.35, 5), 0.5, backV - 0.19, 0);
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, Math.max(0.8, width - 0.5), 10), mats.steel); rail.rotation.z = Math.PI / 2; place(rail, 0, -depth / 2 + 0.35, 1.8);
  } else if (T === 'balcony') {
    model('dining_chair_02', 0, 0, 0);
  }
}

// ---------- Гадаад орчин ----------
function outdoors() {
  scene.background = new THREE.Color(0xd9ebff);
  scene.fog = new THREE.Fog(0xd9ebff, 30, 120);
  const g = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x9fbf86, roughness: 1 })); g.rotation.x = -Math.PI / 2; g.position.y = -0.02; scene.add(g);
  const b = plan.bounds; const rnd = (a, c) => a + Math.random() * (c - a);
  for (let i = 0; i < 40; i++) {
    const ang = rnd(0, Math.PI * 2), dist = rnd(18, 60); const w = rnd(8, 18), h = rnd(9, 40);
    const m = box(w, h, w, new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.58, 0.08, rnd(0.55, 0.8)), roughness: 0.9 }));
    m.position.set(b.x + b.w / 2 + Math.cos(ang) * dist, h / 2 - 0.5, b.y + b.h / 2 + Math.sin(ang) * dist); m.castShadow = false; scene.add(m);
  }
  scene.add(new THREE.HemisphereLight(0xdbeafe, 0xd6d3d1, 0.7));
  const sun = new THREE.DirectionalLight(0xfff5e0, 2.4); sun.position.set(b.x + b.w / 2 + 12, 18, b.y + b.h / 2 - 14); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.0004;
  const s = Math.max(b.w, b.h) + 4; Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 60 }); sun.target.position.set(b.x + b.w / 2, 0, b.y + b.h / 2); scene.add(sun, sun.target);
  scene.add(new THREE.AmbientLight(0xffffff, 0.25));
}

// ---------- Байрлал ----------
function roomAt(x, z, pad = 0) { return rooms.find((r) => x >= r.x + pad && x <= r.x + r.w - pad && z >= r.y + pad && z <= r.y + r.h - pad); }
function walkable(x, z) {
  if (roomAt(x, z, 0.28)) return true;
  for (const d of plan.doors) { if (d.b === 'out') continue; const lo = Math.min(d.x1, d.x2) - 0.05, hi = Math.max(d.x1, d.x2) + 0.05, lz = Math.min(d.y1, d.y2) - 0.05, hz = Math.max(d.y1, d.y2) + 0.05; if (x >= lo - 0.35 && x <= hi + 0.35 && z >= lz - 0.35 && z <= hz + 0.35) return true; }
  return false;
}

// ---------- Автомат аялал ----------
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
  const pts = [];
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
function enterRoom(r) {
  const ds = doorSide(r); const cx = r.x + r.w / 2, cz = r.y + r.h / 2;
  const back = { S: [0, 1], N: [0, -1], W: [-1, 0], E: [1, 0] }[ds]; const half = (ds === 'N' || ds === 'S') ? r.h / 2 : r.w / 2;
  const d = Math.max(0.3, half - 0.8);
  cam.x = cx + back[0] * d; cam.z = cz + back[1] * d; cam.pitch = -0.03;
  cam.yaw = { S: 0, N: Math.PI, W: -Math.PI / 2, E: Math.PI / 2 }[ds];
}
const keys = {};
let mode = 'auto', tourPts = [], tourI = 0, pauseT = 0, sweep = 0;
function setMode(m) {
  mode = m; $('#bAuto').classList.toggle('on', m === 'auto'); $('#bFree').classList.toggle('on', m === 'free');
  if (m === 'free') stagingReset();
  // Автомат руу шилжихэд маршрутыг ОДОО байгаа өрөөнөөс үргэлжлүүлнэ (хана нэвтлэн эхлэл рүү шууд явахгүй)
  if (m === 'auto' && tourPts.length) {
    const r = roomAt(cam.x, cam.z); const i = r ? tourPts.findIndex((p) => p.pause && p.room === r.id) : -1;
    if (i >= 0) { tourI = i; const p = tourPts[i]; if (Math.hypot(p.x - cam.x, p.z - cam.z) < 0.05) { p.yaw0 = cam.yaw; sweep = 0; pauseT = AUTO.pausePlain; } else pauseT = 0; }
    if (phase === 'ext' || phase === 'pano') phase = 'walk';
  }
}
function moveTo(x, z) { if (walkable(x, z)) { cam.x = x; cam.z = z; return true; } if (walkable(x, cam.z)) { cam.x = x; return true; } if (walkable(cam.x, z)) { cam.z = z; return true; } return false; }
// Автомат аялал (анхдагч): гадаах 360° цэгүүд → орц → өрөө бүр. Хөдөлгөөн удаан, жигд (0.75 м/с, эргэлт зөөлөн);
// өрөөнд 360° панорам байвал тэр өрөөнд хүрмэгц панорам руу зөөлөн шилжиж бүтэн эргэж үзүүлнэ, дараа нь буцна.
const AUTO = { walk: 0.75, turn: 1.6, pausePlain: 9, panoSpin: 16, extSpin: 12, spinRate: (2 * Math.PI) / 16 };
// «Тохижуулах» анимаци: өрөөнд орж зогсоход хоосон өрөө 1.2 с харагдаад, тавилга нэг нэгээрээ зөөлөн гарч ирнэ (интерьерийн санал)
const roomFurn = {}; let staging = null; // { items:[{obj, t0}], t }
const easeOutBack = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
function stageRoom(id) {
  const g = roomFurn[id]; if (!g || !furnGroup.visible) return;
  const items = g.children.map((obj, i) => { obj.userData.s = obj.scale.x || 1; obj.visible = false; return { obj, t0: 1.2 + i * 0.45 }; });
  staging = { items, t: 0 };
}
function stepStaging(dt) {
  if (!staging) return; staging.t += dt; let done = true;
  for (const it of staging.items) {
    const k = (staging.t - it.t0) / 0.7;
    if (k < 0) { done = false; continue; }
    if (k >= 1) { it.obj.visible = true; it.obj.scale.setScalar(it.obj.userData.s); it.obj.position.y = it.obj.userData.y ?? it.obj.position.y; continue; }
    done = false; it.obj.visible = true; if (it.obj.userData.y == null) it.obj.userData.y = it.obj.position.y;
    const e = easeOutBack(k); it.obj.scale.setScalar(it.obj.userData.s * Math.max(0.01, e)); it.obj.position.y = it.obj.userData.y + (1 - Math.min(1, k)) * 0.25;
  }
  if (done) staging = null;
}
function stagingReset() { staging = null; for (const g of Object.values(roomFurn)) for (const o of g.children) { o.visible = true; if (o.userData.s) o.scale.setScalar(o.userData.s); if (o.userData.y != null) o.position.y = o.userData.y; } }
let extI = -1, extT = 0, phase = 'start', panoT = 0;
function fadeTo(fn) { const f = $('#fade'); f.style.opacity = 1; setTimeout(() => { fn(); f.style.opacity = 0; }, 380); }
function stepAuto(dt) {
  // 1) гадаах панорамууд (эхлэлд нэг удаа, дараа мөчлөгт дахин)
  if (phase === 'start') { phase = extNodes.length ? 'ext' : 'walk'; if (phase === 'ext') { extI = 0; extT = 0; showPano(extNodes[0], true); } return; }
  if (phase === 'ext') {
    if (!panoActive) return; // ачаалж байна
    extT += dt; cam.yaw += AUTO.spinRate * 0.75 * dt; cam.pitch += (-0.02 - cam.pitch) * 0.03;
    if (extT >= AUTO.extSpin) { extI++; extT = 0; if (extI < extNodes.length) { const n = extNodes[extI]; fadeTo(() => showPano(n, true)); } else { fadeTo(() => { hidePano(); phase = 'walk'; }); } }
    return;
  }
  if (!tourPts.length) return;
  const p = tourPts[tourI];
  // 2) өрөөний панорам: бүтэн эргэлт
  if (phase === 'pano') { if (!panoActive) return; panoT += dt; cam.yaw += AUTO.spinRate * dt; cam.pitch += (-0.02 - cam.pitch) * 0.03; if (panoT >= AUTO.panoSpin) { phase = 'walk'; fadeTo(() => { hidePano(); cam.yaw = p.yaw0; pauseT = 0.8; }); } return; }
  // 3) өрөөний төвд зогсоод зөөлөн эргэж харах
  if (p.pause && pauseT > 0) { pauseT -= dt; sweep += dt; cam.yaw = p.yaw0 + Math.sin(sweep * 0.55) * 1.25; cam.pitch += (-0.04 - cam.pitch) * 0.04; if (pauseT <= 0) { tourI = (tourI + 1) % tourPts.length; if (tourI === 0 && extNodes.length) { phase = 'ext'; extI = 0; extT = 0; fadeTo(() => showPano(extNodes[0], true)); } } return; }
  // 4) явах
  const dx = p.x - cam.x, dz = p.z - cam.z, dist = Math.hypot(dx, dz);
  const targetYaw = Math.atan2(-dx, -dz);
  let dy = targetYaw - cam.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); cam.yaw += dy * Math.min(1, dt * AUTO.turn);
  cam.pitch += (0 - cam.pitch) * 0.04;
  const sp = AUTO.walk * dt;
  if (dist <= sp) {
    cam.x = p.x; cam.z = p.z;
    if (p.pause) { p.yaw0 = cam.yaw; sweep = 0; const pn = panoByRoom[p.room]; if (pn) { phase = 'pano'; panoT = 0; pauseT = 0; fadeTo(() => showPano(pn, false)); } else { pauseT = AUTO.pausePlain; stageRoom(p.room); } }
    else tourI = (tourI + 1) % tourPts.length;
  } else { cam.x += dx / dist * sp; cam.z += dz / dist * sp; }
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
  c.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; c.setPointerCapture(e.pointerId); });
  c.addEventListener('pointermove', (e) => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY }; if (mode === 'auto' && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) setMode('free'); cam.yaw -= dx * 0.004; cam.pitch = Math.max(-1.2, Math.min(1.2, cam.pitch - dy * 0.003)); });
  c.addEventListener('pointerup', () => { drag = null; }); c.addEventListener('pointercancel', () => { drag = null; });
  const keyOf = (e) => (e.key.length === 1 ? e.key.toLowerCase() : e.key);
  window.addEventListener('keydown', (e) => { const k = keyOf(e); keys[k] = true; if (['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) { setMode('free'); e.preventDefault(); } });
  window.addEventListener('keyup', (e) => { keys[keyOf(e)] = false; });
  document.querySelectorAll('.pad button').forEach((b) => { const k = b.dataset.k; const on = (e) => { e.preventDefault(); keys[k] = true; setMode('free'); }; const off = () => { keys[k] = false; }; b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off); });
  $('#bAuto').onclick = () => { if (panoActive) togglePano(); setMode('auto'); };
  $('#bFree').onclick = () => { if (panoActive && panoMesh.userData.exterior) hidePano(false); setMode('free'); };
  $('#bFurn').onclick = () => { furnGroup.visible = !furnGroup.visible; $('#bFurn').classList.toggle('on', furnGroup.visible); };
  $('#bFull').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); };
  $('#map').addEventListener('click', (e) => {
    const rect = e.currentTarget.getBoundingClientRect(); const mx = (e.clientX - rect.left) / rect.width * 440, my = (e.clientY - rect.top) / rect.height * 340;
    const { sc, ox, oy } = mapXform(); const px = (mx - ox) / sc + plan.bounds.x, pz = (my - oy) / sc + plan.bounds.y;
    const r = roomAt(px, pz); if (!r) return;
    if (panoActive) togglePano();
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
  for (const r of rooms) { if (r.w * sc > 40) g.fillText(r.name, X(r.x + r.w / 2), Y(r.y + r.h / 2) + 4); if (panoByRoom[r.id]) { g.fillStyle = '#2563eb'; g.font = '700 11px Inter,sans-serif'; g.fillText('360°', X(r.x + r.w / 2), Y(r.y + r.h / 2) + 18); g.fillStyle = '#0f172a'; g.font = '600 13px Inter,sans-serif'; } }
  const px = X(cam.x), py = Y(cam.z); g.fillStyle = 'rgba(37,99,235,.25)'; g.beginPath(); g.moveTo(px, py); g.arc(px, py, 34, -cam.yaw - Math.PI / 2 - 0.6, -cam.yaw - Math.PI / 2 + 0.6); g.closePath(); g.fill();
  g.fillStyle = '#2563eb'; g.beginPath(); g.arc(px, py, 7, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke();
}

// ---------- Зургууд: өрөөний хананд жаазтай (студи), overlay; 360° панорам (өрөө бүрд, засварлагчаас) ----------
const assetsByType = {}, panoByRoom = {}; let curRoomId = null; let panoMesh = null, panoActive = false, savedCam = null;
function assetUrl(id) { return `/tour-public/${token}/asset/${id}`; }
function hangPhotos() {
  for (const r of rooms) {
    const list = assetsByType[r.type] || []; if (!list.length) continue;
    const a = list[0];
    texLoader.load(assetUrl(a.id), (t) => {
      t.colorSpace = THREE.SRGBColorSpace; const ar = t.image.width / t.image.height; if (ar > 1.9) return;
      const w = 0.9, h = w / ar; const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 }));
      const fr = box(w + 0.08, h + 0.08, 0.03, mats.dark);
      const side = mainSide(r); const cx = r.x + r.w / 2, cz = r.y + r.h / 2, off = WALL_T + 0.02; let pos;
      // гол ханын хажуу тал (ТВ/орны толгойтой давхцахгүй)
      if (side === 'N') pos = [cx - Math.min(1.3, r.w / 2 - 0.6), r.y + off, 0]; else if (side === 'S') pos = [cx - Math.min(1.3, r.w / 2 - 0.6), r.y + r.h - off, Math.PI]; else if (side === 'W') pos = [r.x + off, cz - Math.min(1.3, r.h / 2 - 0.6), Math.PI / 2]; else pos = [r.x + r.w - off, cz - Math.min(1.3, r.h / 2 - 0.6), -Math.PI / 2];
      [m, fr].forEach((o, i) => { o.position.set(pos[0], 1.55, pos[1]); o.rotation.y = pos[2]; if (i === 1) o.position.add(new THREE.Vector3(Math.sin(pos[2]) * -0.01, 0, Math.cos(pos[2]) * -0.01)); scene.add(o); });
    });
  }
}
function showPhotos() {
  const r = byId[curRoomId]; const list = r ? (assetsByType[r.type] || []) : []; const all = list.length ? list : Object.values(assetsByType).flat();
  $('#photoGrid').innerHTML = all.map((a) => `<img src="${assetUrl(a.id)}" alt="">`).join('') || '<p>Зураг оруулаагүй байна.</p>';
  $('#photos').style.display = 'block';
}
// 360° панорам: бөмбөрцөг камерын эргэн тойронд; exterior=true бол гадаах цэг (нэр дэлгэцэнд)
const extNodes = []; const panoTexCache = {};
function showPano(a, exterior) {
  const apply = (t) => {
    hidePano(true);
    panoMesh = new THREE.Mesh(new THREE.SphereGeometry(8, 64, 40), new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide }));
    panoMesh.position.set(cam.x, EYE, cam.z); scene.add(panoMesh); panoActive = true; panoMesh.userData.exterior = exterior;
    $('#bPano').classList.add('on'); $('#bPano').textContent = '✕ 360° хаах'; $('#bPano').style.display = '';
    if (exterior) { $('#rName').textContent = a.label || 'Гадаах орчин'; $('#rArea').textContent = '360° панорам'; }
  };
  if (panoTexCache[a.id]) return apply(panoTexCache[a.id]);
  $('#bPano').textContent = '360° ачаалж…';
  texLoader.load(assetUrl(a.id), (t) => { t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearFilter; panoTexCache[a.id] = t; apply(t); }, undefined, () => { $('#bPano').textContent = '360° панорам'; });
}
function hidePano(keepCam) {
  if (!panoActive) return;
  scene.remove(panoMesh); panoActive = false; $('#bPano').classList.remove('on'); $('#bPano').textContent = '360° панорам';
  if (!keepCam && savedCam) Object.assign(cam, savedCam);
  savedCam = null; curRoomId = null; // дэлгэцийн өрөөний нэр дахин тооцогдоно
}
function togglePano() {
  if (panoActive) { hidePano(false); if (mode === 'auto') { phase = 'walk'; pauseT = 0.5; } return; }
  const a = panoByRoom[curRoomId]; if (!a) return;
  savedCam = { ...cam }; setMode('free'); showPano(a, false);
}

// ---------- Эхлэл ----------
async function main() {
  const res = await fetch(`/tour-data/${token}`); if (!res.ok) { $('#load').textContent = 'Аялал олдсонгүй'; return; }
  data = await res.json(); plan = data.plan; rooms = plan.rooms; byId = Object.fromEntries(rooms.map((r) => [r.id, r]));
  STYLE = plan.style || null;
  if (STYLE) { DOOR_H = STYLE.door_h || DOOR_H; WIN_LO = STYLE.window_sill || WIN_LO; WIN_HI = Math.max(WIN_LO + 0.6, STYLE.window_top || WIN_HI); }
  for (const d of plan.doors) { if (d.b === 'out') continue; (doorGraph[d.a] ||= []).push(d.b); (doorGraph[d.b] ||= []).push(d.a); }
  for (const a of data.assets) {
    if (a.kind === 'pano') { if (String(a.room_id || '').startsWith('ext:')) extNodes.push({ ...a, label: a.room_id.slice(4) }); else if (a.room_id) panoByRoom[a.room_id] = a; }
    else if (a.kind !== 'frame') (assetsByType[a.type] ||= []).push(a); // бичлэгийн кадрууд зөвхөн AI шинжилгээнд
  }
  const p = data.property || {};
  $('#title').textContent = `${p.district || ''}${p.khoroolol ? ', ' + p.khoroolol : ''} · ${p.rooms || rooms.length} өрөө · ${p.area || plan.totalArea} м²${p.floor ? ` · ${p.floor}/${p.total_floors || '—'} давхар` : ''}${data.company ? ' · ' + data.company : ''}`;
  document.title = `POV Tour — ${p.district || 'Зууч'}`;
  // FPS: pixel ratio ≤1.5, статик сүүдэр (зөвхөн тавилга гарч ирэх үед шинэчилнэ), high-performance GPU
  renderer = new THREE.WebGLRenderer({ canvas: $('#c'), antialias: true, powerPreference: 'high-performance' }); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
  // Оношилгоо: консолоос zuuchBench(20) → нэг frame-ийн дундаж мс (GPU finish-тэй), pixel ratio, draw calls
  window.zuuch = { renderer, scene, camera, roomLights, mats, THREE };
  window.zuuchBench = (n = 20) => { const gl = renderer.getContext(); renderer.render(scene, camera); gl.finish(); const t = performance.now(); for (let i = 0; i < n; i++) { camera.position.set(cam.x, EYE, cam.z); renderer.render(scene, camera); } gl.finish(); const ms = (performance.now() - t) / n; return { frameMs: Math.round(ms * 10) / 10, estFps: Math.round(1000 / ms), pixelRatio: renderer.getPixelRatio(), calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, lights: roomLights.filter((l) => l.visible).length }; };
  const pmrem = new THREE.PMREMGenerator(renderer); scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.45;
  initMats(); outdoors(); scene.add(furnGroup);
  for (const r of rooms) scene.add(buildRoom(r));
  hangPhotos();
  if (Object.values(assetsByType).flat().length) $('#bPhotos').disabled = false;
  $('#bPhotos').onclick = showPhotos; $('#bClosePhotos').onclick = () => { $('#photos').style.display = 'none'; }; $('#bPano').onclick = togglePano;
  const e = byId[plan.entry] || rooms[0]; cam.x = e.x + e.w / 2; cam.z = e.y + e.h / 2;
  const ent = plan.doors.find((d) => d.b === 'out'); if (ent) { const dx = (ent.x1 + ent.x2) / 2 - cam.x, dz = (ent.y1 + ent.y2) / 2 - cam.z; cam.yaw = Math.atan2(-dx, -dz) + Math.PI; }
  tourPts = buildTour(); tourI = 0; pauseT = 2.5; sweep = 0; if (tourPts[0]) tourPts[0].yaw0 = cam.yaw;
  const q = new URLSearchParams(location.search); const sr = byId[q.get('start')];
  if (sr) { enterRoom(sr); if (q.get('yaw')) cam.yaw = Number(q.get('yaw')); setMode('free'); }
  bindControls();
  const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }; addEventListener('resize', resize); resize();
  // Загварууд ачаалагдтал (≤6с) хүлээнэ, дараа нь эхэлнэ
  const t0 = Date.now(); while (loadedN < pending && Date.now() - t0 < 6000) { $('#load').lastElementChild.textContent = `Тавилга ачаалж байна… ${loadedN}/${pending}`; await new Promise((r) => setTimeout(r, 120)); }
  // Шэйдерүүдийг урьдчилан компиляц — тавилга гарч ирэх/өрөө солигдох мөчид гацахгүй (бенчмарк: эхний frame 62 мс, дараа нь 2 мс)
  try { renderer.compile(scene, camera); } catch { /* зарим GPU-д алгасна */ }
  $('#load').style.display = 'none';
  let last = performance.now(), mapT = 1, frameN = 0, shadowLoaded = -1, fpsAcc = 0, fpsN = 0; // эхний frame-д минимап зурагдана
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (mode === 'auto') stepAuto(dt); else if (!panoActive) stepFree(dt);
    stepStaging(dt);
    camera.position.set(cam.x, EYE, cam.z); camera.rotation.set(0, 0, 0, 'YXZ'); camera.rotation.y = cam.yaw; camera.rotation.x = cam.pitch;
    const r = roomAt(cam.x, cam.z); const id = r ? r.id : null;
    const extShown = panoActive && panoMesh && panoMesh.userData.exterior;
    if (id !== curRoomId && !extShown) { curRoomId = id; $('#rName').textContent = r ? r.name : '—'; $('#rArea').textContent = r ? `${(r.w * r.h).toFixed(1)} м² · ${r.w} × ${r.h} м` : ''; $('#bPano').style.display = (r && panoByRoom[r.id]) || panoActive ? '' : 'none'; }
    mapT += dt; if (mapT > 0.08) { mapT = 0; drawMap(); }
    // Сүүдэр: сцен статик — зөвхөн тавилга гарч ирэх/загвар ачаалагдах үед л шинэчилнэ
    if (staging || loadedN !== shadowLoaded || frameN < 30) { renderer.shadowMap.needsUpdate = true; if (loadedN !== shadowLoaded) { try { renderer.compile(scene, camera); } catch {} } shadowLoaded = loadedN; } frameN++;
    // Гэрлийн хасалт: 9 м-ээс хол өрөөний цэгэн гэрлийг унтраана (fragment бүр бүх гэрлийг тооцдог)
    if (frameN % 10 === 0) for (const l of roomLights) l.visible = Math.hypot(l.position.x - cam.x, l.position.z - cam.z) < 9;
    // Адаптив нягтрал: FPS < 28 бол pixel ratio-г бууруулна (доод 0.7), > 55 бол өсгөнө (дээд 1.25)
    fpsAcc += dt; fpsN++; if (fpsAcc >= 2) { const fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; const pr = renderer.getPixelRatio(); if (fps < 28 && pr > 0.7) renderer.setPixelRatio(Math.max(0.7, pr - 0.15)); else if (fps > 55 && pr < Math.min(devicePixelRatio, 1.25)) renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25, pr + 0.1)); if (renderer.getPixelRatio() !== pr) renderer.setSize(innerWidth, innerHeight, false); }
    renderer.render(scene, camera); requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
main().catch((e) => { console.error(e); $('#load').textContent = 'Алдаа: ' + e.message; });
