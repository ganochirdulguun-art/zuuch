// «Зууч» — Virtual POV Tour үзэгч (three.js): серверийн планаар 3D орчин, бодит CC0 glTF тавилга (Poly Haven), PBR текстур, 360° панорам
import * as THREE from 'three';
import { GLTFLoader } from '/vendor/GLTFLoader.js';
import { RoundedBoxGeometry } from '/vendor/RoundedBoxGeometry.js';
import { RoomEnvironment } from '/vendor/RoomEnvironment.js';
import { createExterior } from '/tour-ext.js';

const $ = (s) => document.querySelector(s);
const token = location.pathname.split('/').filter(Boolean).pop();
const EYE = 1.6, WALL_T = 0.12;
let DOOR_H = 2.05, WIN_LO = 0.9, WIN_HI = 2.15; // AI шинжилгээний style-аар дарагдана
let STYLE = null;
const MAP_FILL = { living: '#93c5fd', kitchen: '#fde68a', bedroom: '#c4b5fd', bath: '#a5f3fc', hall: '#e2e8f0', balcony: '#bbf7d0', office: '#fdba74', other: '#e5e7eb' };
const TYPE_MN = { living: 'зочны', kitchen: 'гал тогоо', bedroom: 'унтлагын', bath: 'угаалгын', hall: 'коридор', balcony: 'тагт', office: 'ажлын', other: 'бусад' };

// ---------- Текстур: Poly Haven (CC0, /textures) + процедур нөөц ----------
const texLoader = new THREE.TextureLoader(); let texPending = 0, texDone = 0; // хана/шалны текстур ачаалагдтал эхлэлийг хүлээнэ
function tex(url, repeat = [1, 1], srgb = true) {
  texPending++; const t = texLoader.load(url, () => texDone++, undefined, () => texDone++); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
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
let EXT = null, SCENE_MODE = 'interior'; // гадаах орчны 3D нислэг (Ш3д-3) эсвэл байрны дотор
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
  mats.mirror = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, metalness: 1, envMap: scene.environment, envMapIntensity: 1 }); // толь: орчныг бүрэн тусгана (scene.environmentIntensity-ээр бүдгэрэхгүй)
  mats.tWood = new THREE.MeshStandardMaterial({ color: 0xa27a52, roughness: 0.5, normalMap: tex('/textures/wood_nor.jpg', [1, 1], false), normalScale: new THREE.Vector2(0.4, 0.4) }); // хоолны ширээ/сандал: дунд өнгийн мод (цайвар шалнаас ялгарна)
  mats.matteWhite = new THREE.MeshStandardMaterial({ color: 0xf7f7f5, roughness: 0.6 });
  // Буйдан (дулаан саарал даавуу), дэр, гэрлийн бүрхүүл, навч, ус, шүүгээний заадас
  mats.sofa = new THREE.MeshStandardMaterial({ color: 0x9a948b, roughness: 1, normalMap: mats.fabricNor, roughnessMap: mats.fabricRough }); mats.sofaCus = new THREE.MeshStandardMaterial({ color: 0xaaa49a, roughness: 1, normalMap: mats.fabricNor, roughnessMap: mats.fabricRough });
  mats.pillowA = new THREE.MeshStandardMaterial({ color: 0xc8b495, roughness: 1, normalMap: mats.fabricNor }); mats.pillowB = new THREE.MeshStandardMaterial({ color: 0x7f8f7c, roughness: 1, normalMap: mats.fabricNor });
  mats.shade = new THREE.MeshStandardMaterial({ color: 0xf3ead9, emissive: 0xffe2b8, emissiveIntensity: 0.35, roughness: 0.9, side: THREE.DoubleSide }); mats.leaf = new THREE.MeshStandardMaterial({ color: 0x3f6b3a, roughness: 0.6 });
  mats.water = new THREE.MeshStandardMaterial({ color: 0xdfe8ee, roughness: 0.08, metalness: 0.1 }); mats.seam = new THREE.MeshStandardMaterial({ color: 0xc9c6c0, roughness: 0.8 });
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
const FRONT = { modern_arm_chair_01: 0, modern_wooden_cabinet: 0, hanging_picture_frame_01: 0, wall_clock: 0 };

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
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.h), mats.ceil); ceil.rotation.x = Math.PI / 2; ceil.position.set(r.x + r.w / 2, H, r.y + r.h / 2); ceil.userData.ceil = 1; g.add(ceil); // ceil: debug дээрээс харахад нуугдана
  // Таазны хонхорхой (cove): ханын дагуу 0.3 м өргөн, 0.1 м зузаан цагаан ирмэг + дотор талд нь дулаан LED тууз (лавлагаа рендерийн хэв маяг)
  // Дам нуруу (AI шинжилгээ: style.beams[{room}]) — таазны доор өрөөний богино тэнхлэгийн дагуу 0.3 × 0.25 м
  // Дам нуруу: гар хэмжээс (r.beams: axis x = зүүнээс баруун тийш урттай, off = хойд/зүүн захаас) давуу; үгүй бол AI (style.beams[{room}])
  let beamList = Array.isArray(r.beams) && r.beams.length ? r.beams : null;
  if (!beamList && STYLE && Array.isArray(STYLE.beams) && STYLE.beams.find((b) => String(b.room || '').toLowerCase().includes((TYPE_MN[r.type] || '').toLowerCase()) || String(b.room || '') === r.id)) beamList = [{ axis: r.w >= r.h ? 'y' : 'x', off: (r.w >= r.h ? r.w : r.h) / 2, w: 0.3, h: 0.25 }];
  const beam = !!beamList;
  for (const b of beamList || []) {
    const bm = b.axis === 'x' ? box(r.w, b.h, b.w, mats.ceil) : box(b.w, b.h, r.h, mats.ceil);
    bm.position.set(b.axis === 'x' ? r.x + r.w / 2 : r.x + Math.min(r.w - b.w / 2, Math.max(b.w / 2, b.off)), H - b.h / 2, b.axis === 'x' ? r.y + Math.min(r.h - b.w / 2, Math.max(b.w / 2, b.off)) : r.y + r.h / 2); bm.userData.ceil = 1; g.add(bm);
  }
  // Довжоо (орцны хаалганы босго) — style.threshold_cm
  if (STYLE && STYLE.threshold_cm > 0) for (const d of plan.doors) if (d.b === 'out' && d.a === r.id) { const th = box(Math.max(Math.abs(d.x2 - d.x1), 0.2), STYLE.threshold_cm / 100, Math.max(Math.abs(d.y2 - d.y1), 0.2), mats.plinth); th.position.set((d.x1 + d.x2) / 2, STYLE.threshold_cm / 200, (d.y1 + d.y2) / 2); g.add(th); }
  if (r.w > 2 && r.h > 2 && r.type !== 'bath' && !beam && (!STYLE || STYLE.ceiling_cove !== false)) {
    const bw = 0.3, bh = 0.1, led = 0.025;
    const ring = [[r.x + r.w / 2, r.y + bw / 2, r.w, bw], [r.x + r.w / 2, r.y + r.h - bw / 2, r.w, bw], [r.x + bw / 2, r.y + r.h / 2, bw, r.h], [r.x + r.w - bw / 2, r.y + r.h / 2, bw, r.h]];
    for (const [px, pz, sx, sz] of ring) { const b = box(sx, bh, sz, mats.ceil); b.position.set(px, H - bh / 2, pz); b.userData.ceil = 1; g.add(b); }
    const inner = [[r.x + r.w / 2, r.y + bw + led / 2, r.w - 2 * bw, led], [r.x + r.w / 2, r.y + r.h - bw - led / 2, r.w - 2 * bw, led], [r.x + bw + led / 2, r.y + r.h / 2, led, r.h - 2 * bw], [r.x + r.w - bw - led / 2, r.y + r.h / 2, led, r.h - 2 * bw]];
    for (const [px, pz, sx, sz] of inner) { const s = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.02, sz), mats.led); s.position.set(px, H - bh + 0.01, pz); s.userData.ceil = 1; g.add(s); }
  }
  const wallMat = r.type === 'bath' ? mats.bathWall.clone() : mats.wall();
  if (r.type === 'bath') { wallMat.map = wallMat.map.clone(); wallMat.map.repeat.set(1, 1); wallMat.map.needsUpdate = true; }
  else { for (const k of ['map', 'normalMap', 'roughnessMap']) { wallMat[k].repeat.set(1, 1); } const wc = r.wallColor || (STYLE && STYLE.wall_color); if (wc) wallMat.color.set(wc); }
  // Ханын UV дэлхийн координатаар (нэг давталт su × sv м; ханын цаас 0.53 м тууз): нарийн хэсэг, нээлхийн хажуу (reveal) гадаргуу бүрт текстур ижил нягт — шахагдаж судал үүсэхгүй (нэг материал → draw call нэмэгдэхгүй)
  const [su, sv] = r.type === 'bath' ? [0.9, 2.7] : [2.12, 2.12];
  const edges = [
    { side: 'N', axis: 'x', c: r.y, a: r.x, b: r.x + r.w, inward: +1 }, { side: 'S', axis: 'x', c: r.y + r.h, a: r.x, b: r.x + r.w, inward: -1 },
    { side: 'W', axis: 'y', c: r.x, a: r.y, b: r.y + r.h, inward: +1 }, { side: 'E', axis: 'y', c: r.x + r.w, a: r.y, b: r.y + r.h, inward: -1 },
  ];
  for (const e of edges) {
    const ops = [];
    for (const d of plan.doors) { if (d.a !== r.id && d.b !== r.id) continue; const o = segOnEdge(d, e); if (o) ops.push({ lo: o[0], hi: o[1], t: 'door', d }); }
    // Цонх: өөрийн өрөө + дундын ханын нөгөө талын өрөө (тагт г.м.) — тэнд ч нээлхий гарна (шилний ард хатуу хана нэг хавтгайд анивчдаг байсан)
    for (const wn of plan.windows) { const own = wn.room === r.id, ow = byId[wn.room]; if (!own && !(ow && ((e.axis === 'x' ? ow.y + ow.h / 2 : ow.x + ow.w / 2) - e.c) * e.inward < 0)) continue; const o = segOnEdge(wn, e); if (o) ops.push({ lo: o[0], hi: o[1], t: 'win', own, sill: wn.sill || WIN_LO, top: Math.max((wn.sill || WIN_LO) + 0.4, wn.top || WIN_HI) }); }
    ops.sort((p, q) => p.lo - q.lo);
    const cc = e.c + e.inward * WALL_T / 2;
    const put = (lo, hi, y0, y1, m = wallMat) => {
      if (hi - lo < 0.01 || y1 - y0 < 0.01) return;
      const len = hi - lo, hgt = y1 - y0, mid = (lo + hi) / 2;
      // Хүрээ (frame): ар тал нь ханын шугам (e.c) дээр — хөрш өрөөний хүрээтэй давхцахгүй; урд тал ханаас 2.5 см цухуйна
      const fr = m === mats.frame, th = fr ? WALL_T + 0.025 : WALL_T, c0 = fr ? e.c + e.inward * th / 2 : cc;
      const b = e.axis === 'x' ? box(len, hgt, th, m) : box(th, hgt, len, m);
      if (m === wallMat) { const ge = b.geometry, p = ge.attributes.position, n = ge.attributes.normal, uv = ge.attributes.uv, ox = e.axis === 'x' ? mid : c0, oz = e.axis === 'x' ? c0 : mid, oy = y0 + hgt / 2; for (let i = 0; i < p.count; i++) { const X = p.getX(i) + ox, Y = p.getY(i) + oy, Z = p.getZ(i) + oz, ay = Math.abs(n.getY(i)) > 0.5; uv.setXY(i, (ay || Math.abs(n.getZ(i)) > 0.5 ? X : Z) / su, (ay ? Z : Y) / sv); } }
      b.position.set(e.axis === 'x' ? mid : c0, y0 + hgt / 2, e.axis === 'x' ? c0 : mid); g.add(b);
      // Шалны хөвөө (plinth) — хана/шалны зааг тодорхой харагдана (хаалганы нээлхийд байхгүй); үзүүр бүр 1 мм богино — ханын төгсгөлтэй давхцахгүй
      if (y0 === 0 && m === wallMat) { const p = e.axis === 'x' ? box(len - 0.002, 0.08, WALL_T + 0.03, mats.plinth) : box(WALL_T + 0.03, 0.08, len - 0.002, mats.plinth); p.position.set(e.axis === 'x' ? mid : cc, 0.04, e.axis === 'x' ? cc : mid); g.add(p); }
    };
    let cur = e.a;
    ops.forEach((o, i) => {
      // Хана хүрээний ГАДНА ирмэгт (lo−fw / hi+fw, дээд/доод хүрээний цаана) зогсоно — өмнө нь хана хүрээтэй давхцаж нээлхийн дээд/хажуу гадаргуу нэг хавтгайд анивчдаг байв (z-fighting)
      const fw = o.t === 'door' ? 0.06 : 0.05, nx = ops[i + 1];
      const L = Math.max(cur, o.lo - fw), R = Math.max(L, Math.min(o.hi + fw, nx ? (o.hi + nx.lo) / 2 : e.b));
      put(cur, L, 0, H);
      if (o.t === 'door') {
        put(L, R, DOOR_H + fw, H);
        put(o.lo - fw, o.lo, 0, DOOR_H + fw, mats.frame); put(o.hi, o.hi + fw, 0, DOOR_H + fw, mats.frame); put(o.lo, o.hi, DOOR_H, DOOR_H + fw, mats.frame);
        if (o.d.b === 'out') { const leaf = e.axis === 'x' ? box(o.hi - o.lo, DOOR_H, 0.05, mats.door) : box(0.05, DOOR_H, o.hi - o.lo, mats.door); leaf.position.set(e.axis === 'x' ? (o.lo + o.hi) / 2 : e.c, DOOR_H / 2, e.axis === 'x' ? e.c : (o.lo + o.hi) / 2); g.add(leaf); const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), mats.steel); knob.position.copy(leaf.position).add(new THREE.Vector3(e.axis === 'x' ? (o.hi - o.lo) / 2 - 0.1 : e.inward * 0.05, -0.05, e.axis === 'x' ? e.inward * 0.05 : (o.hi - o.lo) / 2 - 0.1)); g.add(knob); }
      } else {
        const WIN_LO = o.sill, WIN_HI = o.top; // цонх бүрийн өөрийн тавцан/дээд (гар хэмжээс эсвэл AI)
        put(L, R, 0, WIN_LO - fw); put(L, R, WIN_HI + fw, H);
        put(o.lo - fw, o.lo, WIN_LO - fw, WIN_HI + fw, mats.frame); put(o.hi, o.hi + fw, WIN_LO - fw, WIN_HI + fw, mats.frame); put(o.lo, o.hi, WIN_LO - fw, WIN_LO, mats.frame); put(o.lo, o.hi, WIN_HI, WIN_HI + fw, mats.frame);
        if (o.own) { // шил/хөндлөвч/тавцан зөвхөн эзэн өрөөнд; шил + хөндлөвч ханын шугамаас 4 см дотогш (хөрш хана, хүрээний ар талтай нэг хавтгайд биш)
          const mid = (o.lo + o.hi) / 2, gz = e.c + e.inward * 0.04;
          const gl = new THREE.Mesh(new THREE.PlaneGeometry(o.hi - o.lo, WIN_HI - WIN_LO), mats.glass);
          gl.position.set(e.axis === 'x' ? mid : gz, (WIN_LO + WIN_HI) / 2, e.axis === 'x' ? gz : mid); if (e.axis === 'y') gl.rotation.y = Math.PI / 2; g.add(gl);
          const bar = e.axis === 'x' ? box(0.04, WIN_HI - WIN_LO, 0.05, mats.frame) : box(0.05, WIN_HI - WIN_LO, 0.04, mats.frame); bar.position.set(e.axis === 'x' ? mid : gz, (WIN_LO + WIN_HI) / 2, e.axis === 'x' ? gz : mid); g.add(bar);
          // Тавцан хажуу хүрээнээс 1 см илүү гарна — төгсгөл нь хүрээний хажуу гадаргуутай нэг хавтгайд биш
          const sl = o.hi - o.lo + 2 * fw + 0.02; const sill = e.axis === 'x' ? box(sl, 0.04, 0.3, mats.frame) : box(0.3, 0.04, sl, mats.frame); sill.position.set(e.axis === 'x' ? mid : cc + e.inward * 0.1, WIN_LO, e.axis === 'x' ? cc + e.inward * 0.1 : mid); g.add(sill);
        }
      }
      cur = R;
    });
    put(cur, e.b, 0, H);
  }
  // Хавтгай шалны хөвөө (plinth)
  const pl = new THREE.PointLight(0xfff1dc, r.w * r.h > 14 ? 9 : 5, 0, 1.7); pl.position.set(r.x + r.w / 2, H - 0.3, r.y + r.h / 2); g.add(pl); roomLights.push(pl);
  if (r.type === 'bath' || r.type === 'hall' || r.type === 'kitchen' || r.type === 'other') { const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.04, 20), mats.matteWhite); lamp.position.copy(pl.position).setY(H - 0.02); lamp.userData.ceil = 1; g.add(lamp); }
  return g;
}

// ---------- Тавилга: дүрэмд суурилсан байрлуулалт (мэргэжлийн staging) ----------
// Зарчим: зөвхөн БОДИТ ханын хэсэг (хана − хаалга − өндөр эд зүйлд цонх); гал тогооны зурвасын дотоод зааг хана биш.
// Хаалга бүрийн өмнө чөлөө (нээлхий+0.2 × 0.9 м), тагтны хаалга руу зам (зочны өрөөнд 1.0 м, бусад 0.8 м), эд зүйлсийн хооронд ≥0.7 м гарц, тавцан ↔ хоолны ширээ ≥0.9 м, сандлын ард 0.6 м.
// Эд зүйл бүр: хэмжээ → ханад 2 см зайтай наалдуулна → өрөөнд багтаж, мөргөлдөхгүй, чөлөөт бүсэд орохгүй бол авна; үгүй бол дараагийн хувилбар, эс бөгөөс алгасна (шалтгаан тайланд).
// Залхуу: байрлал зөвхөн тавилга анх асаахад (эсвэл ?furn=1, листингийн зураг өлгөх үед) тооцогдоно; ~8 мс тутамд main thread-д амсхийлгэнэ.
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
const LAY = { gap: 0.02, doorW: 0.2, doorD: 0.9, balc: 1.0, balcBed: 0.8, walk: 0.7, back: 0.6, cell: 0.05, fcl: 0.6 };
const FACE = { N: 0, S: Math.PI, W: Math.PI / 2, E: -Math.PI / 2 }, OPP = { N: 'S', S: 'N', W: 'E', E: 'W' }, SIDES = ['N', 'S', 'W', 'E'];
const roomLay = {}, FUR = {}; let furnReady = false, furnDirty = false, furnWant = false; // өрөө бүрийн байрлалын тайлан; ачаалсан загварууд (прототип)
const ov = (a, b, m = 0) => a.x0 < b.x1 - m && b.x0 < a.x1 - m && a.z0 < b.z1 - m && b.z0 < a.z1 - m;
const rdist = (a, b) => Math.hypot(Math.max(0, a.x0 - b.x1, b.x0 - a.x1), Math.max(0, a.z0 - b.z1, b.z0 - a.z1));
const inRoom = (c, k, e = 0.002) => k.x0 >= c.x0 - e && k.x1 <= c.x1 + e && k.z0 >= c.z0 - e && k.z1 <= c.z1 + e;
const steps = (a, b, d = 0.1) => { if (b < a - 1e-6) return []; const o = [a, b, (a + b) / 2]; for (let t = a + d; t < b; t += d) o.push(t); return o; };
const alongX = (s) => s === 'N' || s === 'S';
let brkT = 0; const brk = async () => { if (performance.now() - brkT < 8) return; await (globalThis.scheduler && scheduler.yield ? scheduler.yield() : new Promise((r) => setTimeout(r, 0))); brkT = performance.now(); }; // ~8 мс тутамд амсхийлгэнэ
// Ханын локал координат: t = ханын дагуу, o = ханын дотоод гадаргуугаас өрөө рүү
function wRect(c, s, t0, t1, o0, o1) { return s === 'N' ? { x0: t0, x1: t1, z0: c.z0 + o0, z1: c.z0 + o1 } : s === 'S' ? { x0: t0, x1: t1, z0: c.z1 - o1, z1: c.z1 - o0 } : s === 'W' ? { x0: c.x0 + o0, x1: c.x0 + o1, z0: t0, z1: t1 } : { x0: c.x1 - o1, x1: c.x1 - o0, z0: t0, z1: t1 }; }
const wPt = (c, s, t, o) => (s === 'N' ? [t, c.z0 + o] : s === 'S' ? [t, c.z1 - o] : s === 'W' ? [c.x0 + o, t] : [c.x1 - o, t]);
// Өрөөний контекст: дотоод хил (ханын гадаргуу), хана бүрийн нээлхий, хаалганы чөлөө, цонхны өмнөх бүс (0.8 м), хаалганы хүрээ; тагт руу замын өргөн (зочны 1.0, бусад 0.8)
function roomCtx(r) {
  const c = { r, x0: r.x + WALL_T, x1: r.x + r.w - WALL_T, z0: r.y + WALL_T, z1: r.y + r.h - WALL_T, walls: {}, zones: [], wins: [], frames: [], items: [], log: [], balc: r.type === 'living' ? LAY.balc : LAY.balcBed, tick: async () => {} };
  for (const [s, axis, ec, a, b] of [['N', 'x', r.y, r.x, r.x + r.w], ['S', 'x', r.y + r.h, r.x, r.x + r.w], ['W', 'y', r.x, r.y, r.y + r.h], ['E', 'y', r.x + r.w, r.y, r.y + r.h]]) {
    const e = { axis, c: ec, a, b }, w = { s, a0: alongX(s) ? c.x0 : c.z0, a1: alongX(s) ? c.x1 : c.z1, ops: [] }; c.walls[s] = w;
    for (const d of plan.doors) { if (d.a !== r.id && d.b !== r.id) continue; const o = segOnEdge(d, e); if (!o) continue; const to = d.a === r.id ? d.b : d.a; w.ops.push({ t: 'door', lo: o[0], hi: o[1], to, balc: !!(byId[to] && byId[to].type === 'balcony') }); }
    for (const wn of plan.windows) { const o = segOnEdge(wn, e); if (o) w.ops.push({ t: 'win', lo: o[0], hi: o[1], sill: wn.sill || WIN_LO, top: Math.max((wn.sill || WIN_LO) + 0.4, wn.top || WIN_HI) }); }
    for (const o of w.ops) {
      if (o.t === 'door') { c.zones.push({ ...wRect(c, s, o.lo - LAY.doorW / 2, o.hi + LAY.doorW / 2, 0, LAY.doorD), s, door: o }); c.frames.push({ ...wRect(c, s, o.lo - 0.12, o.hi + 0.12, 0, 0.04), y1: DOOR_H + 0.12 }); }
      else c.wins.push({ ...wRect(c, s, o.lo - 0.05, o.hi + 0.05, 0, 0.8), s, y0: o.sill - 0.05, y1: o.top + 0.1 });
    }
  }
  c.main = c.zones.find((z) => z.door.to === 'out') || c.zones.find((z) => !z.door.balc) || c.zones[0] || null; // үндсэн орох хаалга
  return c;
}
// Ханын хатуу хэсгүүд [a,b]: y0..y1 өндрийн эд зүйлд — хаалга (хүрээ+0.12) ба тэр өндөрт давхцах цонхыг (хүрээ 0.05) хасна
function solid(c, s, y0, y1, pad = 0) {
  let iv = [[c.walls[s].a0 + pad, c.walls[s].a1 - pad]];
  for (const o of c.walls[s].ops) {
    if (o.t === 'win' ? y1 <= o.sill - 0.05 || y0 >= o.top + 0.1 : y0 >= DOOR_H + 0.12) continue;
    const m = (o.t === 'door' ? 0.12 : 0.05) + pad; iv = iv.flatMap(([a, b]) => [[a, Math.min(b, o.lo - m)], [Math.max(a, o.hi + m), b]]).filter(([a, b]) => b - a > 0.05);
  }
  return iv;
}
// Ханын дагуух тууз (гүн dep, өндөр y0..y1) дахь чөлөөт хэсгүүд: solid − туузтай огтлолцох хаалганы чөлөө (нам эд зүйлд) − цонхны бүс (хөрш хананых ч — булан дахь дээд шүүгээ цонхыг халхлахгүй)
function bandIv(c, s, y0, y1, dep, min = 0.3) {
  let iv = solid(c, s, y0, y1); const band = wRect(c, s, -1e3, 1e3, 0, dep), cut = (lo, hi) => { iv = iv.flatMap(([a, b]) => [[a, Math.min(b, lo - 0.02)], [Math.max(a, hi + 0.02), b]]); };
  for (const z of y0 < 1.0 ? c.zones : []) if (ov(band, z)) cut(alongX(s) ? z.x0 : z.z0, alongX(s) ? z.x1 : z.z1);
  for (const w of c.wins) if (y1 > w.y0 && y0 < w.y1 && ov(band, w)) cut(alongX(s) ? w.x0 : w.z0, alongX(s) ? w.x1 : w.z1);
  return iv.filter(([a, b]) => b - a >= min);
}
// Прототип (урд тал +Z, суурь y=0): glTF объект → хэмжээ Box3-аар (rot0 эргэлттэй); процедур P(w,d,h,mk) → хэмжээ урьдчилан мэдэгдэнэ, объект зөвхөн сонгогдвол бүтээгдэнэ (хурдан)
// grp = бүлэг (бүлэг дотроо гарц/чөлөөний дүрэм үйлчлэхгүй); pull = сандал (ард нь 0.6 м татах зай гарц гэж тооцогдоно)
const P = (w, d, h, mk) => ({ w, d, h, mk });
function proto(obj, k, o = {}) {
  if (!obj) return null; let { w, d, h } = obj, cx = 0, cz = 0;
  if (obj.isObject3D) { obj.position.set(0, 0, 0); obj.rotation.set(0, o.rot0 || 0, 0); obj.updateMatrixWorld(true); const bb = new THREE.Box3().setFromObject(obj), sz = bb.getSize(new THREE.Vector3()); [w, d, h, cx, cz] = [sz.x, sz.z, sz.y, (bb.min.x + bb.max.x) / 2, (bb.min.z + bb.max.z) / 2]; }
  return { ref: { obj: obj.isObject3D ? obj : null, mk: obj.mk, n: 0 }, k, w, d, h: o.h || h, cx, cz, rot0: o.rot0 || 0, y0: o.y0 || 0, grp: o.grp || k, wall: !!o.wall, deco: !!o.deco, under: !!o.under, ceil: !!o.ceil, pull: !!o.pull, floor: !o.wall && !o.under && !((o.y0 || 0) > 0.3) };
}
// Байрлал: төв (x,z), урд тал θ чиглэлд (0, ±π/2, π) → дэлхийн тэгш өнцөгт ул мөр
function at(p, x, z, th, ex) { const q = Math.abs(Math.sin(th)) > 0.5, hw = (q ? p.d : p.w) / 2, hd = (q ? p.w : p.d) / 2; return { ...p, x, z, th, rect: { x0: x - hw, x1: x + hw, z0: z - hd, z1: z + hd }, keep: [], ...ex }; }
function onWall(c, p, s, t, off = LAY.gap) { const [x, z] = wPt(c, s, t, off + p.d / 2); return at(p, x, z, FACE[s], { side: s, t, off }); }
// Нэг эд зүйлийн шалгалт → '' эсвэл шалтгаан
function fits(c, it) {
  const r = it.rect, e = 0.002, y1 = it.y0 + it.h, tall = (x) => x.wall || x.h > 1.4, nar = (g, x, y) => g > 0.002 && g < LAY.walk - 0.01 && !((x.pull || (y && y.pull)) && g >= LAY.back - 0.01); // нарийн гарц (сандлын ард 0.6 м татах зай болно)
  if (!inRoom(c, r)) return 'өрөөнд багтахгүй';
  if (it.y0 < 1.0) for (const z of c.zones) if (ov(r, z, e)) return 'хаалганы өмнөх чөлөөнд';
  if (!it.under) for (const f of c.frames) if (it.y0 < f.y1 && ov(r, f, e)) return 'хаалганы хүрээнд';
  for (const w of c.wins) if (y1 > w.y0 && it.y0 < w.y1 && ov(r, w, it.deco ? -0.08 : e)) return 'цонхны өмнө';
  for (const k of it.keep) if (!inRoom(c, k)) return 'урд чөлөө өрөөнд багтахгүй';
  // Чөлөөт (хананд наалдаагүй) том шалны эд зүйл ханатай «үхмэл зурвас» (0.06–0.7 м) үүсгэхгүй: хананд наалдана эсвэл гарц үлдээнэ (ургамал г.м. жижиг зүйлд үйлчлэхгүй)
  if (it.floor && !it.side && it.h > 0.3 && Math.min(it.w, it.d) >= 0.4 && [r.x0 - c.x0, c.x1 - r.x1, r.z0 - c.z0, c.z1 - r.z1].some((g) => g > 0.06 && nar(g, it))) return 'ханатай нарийн зай';
  for (const o of c.items) {
    if (it.under || o.under) { if (it.under && o.under && ov(r, o.rect, e)) return 'хивс давхцана'; continue; }
    if (y1 > o.y0 + 0.005 && it.y0 < o.y0 + o.h - 0.005 && ov(r, o.rect, e) && !(o.grp === it.grp && it.pull !== o.pull)) return `${o.k}-тэй давхцана`; // сандал ширээн доор 8 см түлхэгдсэн (staging) — өөрийн ширээтэй давхцаж болно
    if (o.grp === it.grp) continue;
    if (it.floor) for (const k of o.keep) if (ov(r, k, e)) return `${o.k}-ийн өмнөх чөлөөнд`;
    if (o.floor) for (const k of it.keep) if (ov(k, o.rect, e)) return `өмнөх чөлөөнд ${o.k}`;
    if (it.floor && o.floor) { const px = Math.min(r.x1, o.rect.x1) - Math.max(r.x0, o.rect.x0), pz = Math.min(r.z1, o.rect.z1) - Math.max(r.z0, o.rect.z0), g = px > 0.05 ? -pz : pz > 0.05 ? -px : 0; if (g > (it.side && o.side ? 0.12 : 0.002) && nar(g, it, o)) return `${o.k}-тэй гарц нарийн`; } // хоёулаа хананд наалдсан бол зэрэгцэж (≤0.12) болно
    if (it.side && it.side === o.side && (it.wall || o.wall) && tall(it) && tall(o)) { const g = alongX(it.side) ? Math.max(r.x0 - o.rect.x1, o.rect.x0 - r.x1) : Math.max(r.z0 - o.rect.z1, o.rect.z0 - r.z1); if (g < 0.3) return `${o.k}-тэй хананд шахцана`; }
  }
  return '';
}
function tryAdd(c, its) { let n = 0; for (const it of its) { const w = fits(c, it); if (w) { c.items.length -= n; return `${it.k}: ${w}`; } c.items.push(it); n++; } return ''; }
// Хөдөлгөөний зам (5 см сүлжээ): үндсэн хаалганаас бусад хаалганы чөлөө ба 'reach' чөлөөнүүд ≥0.7 м, тагтны хаалга c.balc өргөн замаар холбогдоно.
// Хурдан: ханын зайн суурь талбар + хаалганы бүсийн индекс өрөө бүрт нэг удаа; батлагдсан эд зүйлсийн талбар кэштэй, шинэ эд зүйл зөвхөн өөрийн ≤0.6 м орчны нүдийг шинэчилнэ
function fgrid(c) {
  if (c.G) return c.G;
  const nx = Math.max(1, Math.round((c.x1 - c.x0) / LAY.cell)), nz = Math.max(1, Math.round((c.z1 - c.z0) / LAY.cell)), N = nx * nz, sx = (c.x1 - c.x0) / nx, sz = (c.z1 - c.z0) / nz, D0 = new Float32Array(N), Z = new Int8Array(N).fill(-1);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const px = c.x0 + (i + 0.5) * sx, pz = c.z0 + (j + 0.5) * sz, k = j * nx + i; D0[k] = Math.min(LAY.fcl, px - c.x0, c.x1 - px, pz - c.z0, c.z1 - pz);
    for (let q = 0; q < c.zones.length; q++) { const z = c.zones[q]; if (px > z.x0 && px < z.x1 && pz > z.z0 && pz < z.z1) { Z[k] = q; break; } }
  }
  return (c.G = { nx, nz, N, sx, sz, D0, Z, B: null });
}
function stamp(c, G, D, o) { // o-гийн орчны (≤fcl) нүдний зайг шинэчилнэ
  const F = LAY.fcl, i0 = Math.max(0, Math.floor((o.x0 - F - c.x0) / G.sx)), i1 = Math.min(G.nx - 1, Math.ceil((o.x1 + F - c.x0) / G.sx)), j0 = Math.max(0, Math.floor((o.z0 - F - c.z0) / G.sz)), j1 = Math.min(G.nz - 1, Math.ceil((o.z1 + F - c.z0) / G.sz));
  for (let j = j0; j <= j1; j++) { const pz = c.z0 + (j + 0.5) * G.sz, dz = Math.max(o.z0 - pz, 0, pz - o.z1); for (let i = i0; i <= i1; i++) { const px = c.x0 + (i + 0.5) * G.sx, d = Math.hypot(Math.max(o.x0 - px, 0, px - o.x1), dz), k = j * G.nx + i; if (d < D[k]) D[k] = d; } }
}
function field(c) { // батлагдсан (кэш) + шинэ шалны эд зүйлсийн зайн талбар
  const G = fgrid(c), fl = c.items.filter((o) => o.floor), B = G.B; let n = 0, D;
  if (B && B.fl.length <= fl.length && B.fl.every((o, i) => o === fl[i])) { D = B.D.slice(); n = B.fl.length; } else D = G.D0.slice();
  for (let i = n; i < fl.length; i++) stamp(c, G, D, fl[i].rect);
  return D;
}
function flows(c) {
  if (!c.main) return true;
  const G = fgrid(c), { nx, nz, N, sx, sz, Z } = G, D = field(c), z0i = c.zones.indexOf(c.main);
  const reach = (rad) => {
    const seen = new Uint8Array(N), st = []; for (let k = 0; k < N; k++) if (Z[k] === z0i && D[k] > 0) { seen[k] = 1; st.push(k); }
    while (st.length) { const k = st.pop(), i = k % nx, j = (k - i) / nx; for (const kk of [i + 1 < nx ? k + 1 : -1, i > 0 ? k - 1 : -1, j + 1 < nz ? k + nx : -1, j > 0 ? k - nx : -1]) if (kk >= 0 && !seen[kk] && D[kk] > 0.001 && (Z[kk] >= 0 || D[kk] >= rad - LAY.cell / 2)) { seen[kk] = 1; st.push(kk); } }
    return seen;
  };
  const hit = (seen, rc) => { const i0 = Math.max(0, Math.floor((rc.x0 - c.x0) / sx - 0.5) + 1), i1 = Math.min(nx - 1, Math.ceil((rc.x1 - c.x0) / sx - 0.5) - 1), j0 = Math.max(0, Math.floor((rc.z0 - c.z0) / sz - 0.5) + 1), j1 = Math.min(nz - 1, Math.ceil((rc.z1 - c.z0) / sz - 0.5) - 1); for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (seen[j * nx + i]) return true; return false; };
  const a = reach(LAY.walk / 2);
  for (const z of c.zones) if (!hit(a, z)) return false;
  for (const o of c.items) for (const k of o.keep) if (k.reach && !hit(a, k)) return false;
  if (c.zones.some((z) => z.door.balc)) { const b = reach(c.balc / 2); for (const z of c.zones) if (z.door.balc && !hit(b, z)) return false; }
  return true;
}
// Хувилбаруудаас сонголт: хямд шалгалт → оноогоор эрэмбэлж → замын шалгалт; эхний тэнцсэнийг авна, эс бөгөөс хамгийн түгээмэл шалтгаан
function choose(c, cands, flow = true, maxFlow = 150) {
  const G = fgrid(c), B0 = G.B; G.B = { fl: c.items.filter((o) => o.floor), D: field(c) }; // батлагдсан талбарын кэш (дотоод peek дараа нь сэргээнэ)
  try {
    const ok = [], why = {}, bump = (w) => { why[w] = (why[w] || 0) + 1; };
    for (const cd of cands) { const w = tryAdd(c, cd.its); if (w) { bump(w); continue; } c.items.length -= cd.its.length; ok.push(cd); }
    ok.sort((p, q) => q.score - p.score); let n = 0;
    for (const cd of ok) { tryAdd(c, cd.its); if (!flow || flows(c)) return cd; bump('хөдөлгөөний зам хаагдана'); c.items.length -= cd.its.length; if (++n >= maxFlow) break; }
    return { fail: Object.entries(why).sort((p, q) => q[1] - p[1])[0]?.[0] || 'тохирох байр алга' };
  } finally { G.B = B0; }
}
// Урьдчилан харах сонголт: түлхүүр (key) бүрийн шилдэг хувилбарыг (≤8) түр байрлуулж look(c)-ийн оноог нэмнэ (дараагийн эд зүйл багтах эсэх); шалгалт бүрийн хооронд main thread-д амсхийлгэнэ
async function chooseLook(c, cands, look) {
  const why = {}, bump = (w) => { why[w] = (why[w] || 0) + 1; }, ok = [], seen = {}; let best = null, n = 0;
  for (const cd of cands) { const w = tryAdd(c, cd.its); if (w) { bump(w); continue; } c.items.length -= cd.its.length; ok.push(cd); }
  ok.sort((p, q) => q.score - p.score); await c.tick(); const G = fgrid(c); G.B = { fl: c.items.filter((o) => o.floor), D: field(c) }; // батлагдсан талбар нэг удаа
  for (const cd of ok) {
    if (seen[cd.key]) continue; seen[cd.key] = 1;
    tryAdd(c, cd.its); if (flows(c)) { const v = cd.score + look(c); if (!best || v > best.v) best = { cd, v }; } else bump('хөдөлгөөний зам хаагдана');
    c.items.length -= cd.its.length; await c.tick(); if (++n >= 8) break;
  }
  if (best) { tryAdd(c, best.cd.its); return best.cd; }
  return { fail: Object.entries(why).sort((p, q) => q[1] - p[1])[0]?.[0] || 'тохирох байр алга' };
}
const peek = (c, cands) => { const cd = choose(c, cands, true, 20); if (cd.fail) return null; c.items.length -= cd.its.length; return cd; }; // түр шалгаад буцаана (≤20 замын шалгалт — хурдан)
// Сонгосон эд зүйлсийг бодит объект болгоно (прототип анх бүтээгдэж, дараа нь clone)
function commit(c, its) {
  for (const it of its) {
    const o = it.ref.n++ ? it.ref.obj.clone() : (it.ref.obj ||= it.ref.mk()), cs = Math.cos(it.th), sn = Math.sin(it.th), R = it.rect;
    o.rotation.set(0, it.th + it.rot0, 0); o.position.set(it.x - (it.cx * cs + it.cz * sn), it.y0, it.z - (-it.cx * sn + it.cz * cs)); if (it.ceil) o.userData.ceil = 1;
    it.obj = o; c.log.push({ k: it.k, at: it.side ? `${it.side} хана` : 'чөлөөт', x: +it.x.toFixed(2), z: +it.z.toFixed(2), w: +(R.x1 - R.x0).toFixed(2), d: +(R.z1 - R.z0).toFixed(2) });
  }
  return its;
}
const skip = (c, k, why) => { c.log.push({ k, skip: why }); return null; };
const put1 = (c, cands, k, flow = true) => { const cd = choose(c, cands, flow); return cd.fail ? skip(c, k, cd.fail) : commit(c, cd.its); };
const put1L = async (c, cands, k, look) => { const cd = await chooseLook(c, cands, look); return cd.fail ? skip(c, k, cd.fail) : commit(c, cd.its); };
const add1 = (c, it) => { const w = tryAdd(c, [it]); return w ? skip(c, it.k, w) : commit(c, [it]); };
function mdl(name, sx = 1, sy = sx, sz = sx) { const m = FUR[name]; if (!m) return null; const g = new THREE.Group(), cl = m.clone(); cl.scale.set(sx, sy, sz); cl.rotation.y = FRONT[name] || 0; g.add(cl); return g; }
// Бүлгийн тэгш өнцөгтөөс 4 чиглэлд (W, E, N, S) хамгийн ойр саад (хана эсвэл шалны эд зүйл) хүртэлх зай — төвд байрлуулахад
function gaps(c, R, grp) {
  const g = [R.x0 - c.x0, c.x1 - R.x1, R.z0 - c.z0, c.z1 - R.z1];
  for (const o of c.items) {
    if (!o.floor || o.grp === grp) continue; const q = o.rect, oz = Math.min(R.z1, q.z1) - Math.max(R.z0, q.z0) > 0.02, ox = Math.min(R.x1, q.x1) - Math.max(R.x0, q.x0) > 0.02;
    if (oz && q.x1 <= R.x0 + 1e-3) g[0] = Math.min(g[0], R.x0 - q.x1); if (oz && q.x0 >= R.x1 - 1e-3) g[1] = Math.min(g[1], q.x0 - R.x1);
    if (ox && q.z1 <= R.z0 + 1e-3) g[2] = Math.min(g[2], R.z0 - q.z1); if (ox && q.z0 >= R.z1 - 1e-3) g[3] = Math.min(g[3], q.z0 - R.z1);
  }
  return g;
}

// ---------- Процедур тавилга (урд тал +Z, суурь y=0, төв x/z=0) ----------
function mkSofa(L) { // орчин үеийн нам буйдан (≤0.78 м — цонхны тавцангаас доош багтана)
  const g = new THREE.Group(), D = 0.9, add = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); return m; };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.016, 0.08, 8), mats.dark), sx * (L / 2 - 0.1), 0.04, sz * (D / 2 - 0.1));
  add(rbox(L, 0.2, D, mats.sofa, 0.03), 0, 0.18, 0); add(rbox(L, 0.48, 0.18, mats.sofa, 0.04), 0, 0.52, -D / 2 + 0.09);
  for (const s of [-1, 1]) add(rbox(0.16, 0.34, D, mats.sofa, 0.05), s * (L / 2 - 0.08), 0.45, 0);
  const n = L > 1.75 ? 3 : 2, cw = (L - 0.32) / n;
  for (let i = 0; i < n; i++) { const x = -L / 2 + 0.16 + cw * (i + 0.5); add(rbox(cw - 0.012, 0.14, D - 0.24, mats.sofaCus, 0.05), x, 0.35, 0.06); add(rbox(cw - 0.03, 0.38, 0.16, mats.sofaCus, 0.07), x, 0.55, -D / 2 + 0.25).rotation.x = -0.1; }
  for (const s of [-1, 1]) add(rbox(0.4, 0.38, 0.12, s < 0 ? mats.pillowA : mats.pillowB, 0.06), s * (L / 2 - 0.42), 0.56, -D / 2 + 0.38).rotation.set(-0.18, s * 0.2, 0);
  return g;
}
function mkHeadboard(bw) { const g = new THREE.Group(), hb = rbox(bw + 0.1, 1.05, 0.08, mats.headboard, 0.03); hb.position.y = 0.525; g.add(hb); const led = new THREE.Mesh(new THREE.BoxGeometry(bw + 0.06, 0.012, 0.02), mats.led); led.position.set(0, 1.056, 0.02); g.add(led); return g; }
function mkBedBody(bw) { // царс хүрээ, цагаан даавуу, хөнжил, хөлийн даавуу, дэр; урт 2.02
  const g = new THREE.Group(), add = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); return m; };
  add(rbox(bw, 0.28, 2.02, mats.oak, 0.02), 0, 0.14, 0); add(rbox(bw - 0.06, 0.22, 1.96, mats.linen, 0.06), 0, 0.39, 0);
  add(rbox(bw + 0.02, 0.12, 1.3, mats.duvet, 0.05), 0, 0.53, 0.35); add(rbox(bw + 0.04, 0.03, 0.4, mats.pillowA, 0.015), 0, 0.6, 0.72);
  for (const s of [-1, 1]) add(rbox(bw / 2 - 0.12, 0.14, 0.4, mats.linen, 0.06), s * bw / 4, 0.58, -0.72).rotation.x = -0.25;
  return g;
}
function mkNightstand() { // цагаан шүүгээ + ширээний гэрэл
  const g = new THREE.Group(), add = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); return m; };
  add(rbox(0.45, 0.5, 0.4, mats.matteWhite, 0.02), 0, 0.25, 0); add(box(0.16, 0.015, 0.02, mats.steel), 0, 0.36, 0.205);
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.03, 16), mats.oak), 0.06, 0.515, -0.04); add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.26, 8), mats.oak), 0.06, 0.66, -0.04);
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.17, 20, 1, true), mats.shade), 0.06, 0.83, -0.04);
  return g;
}
function mkWardrobe(w) { // 2.2 м цагаан шүүгээ: хаалганы заадас + бариул
  const g = new THREE.Group(), n = Math.max(2, Math.round(w / 0.5)), b = rbox(w, 2.2, 0.6, mats.matteWhite, 0.01); b.position.y = 1.1; g.add(b);
  for (let i = 1; i < n; i++) { const x = -w / 2 + i * w / n, l = box(0.006, 2.12, 0.004, mats.seam); l.position.set(x, 1.1, 0.301); g.add(l); if (i % 2) for (const k of [-1, 1]) { const h = box(0.015, 0.6, 0.02, mats.steel); h.position.set(x + k * 0.04, 1.1, 0.31); g.add(h); } }
  return g;
}
function mkScreen(sw) { const g = new THREE.Group(), sh = sw * 0.5625 + 0.03, s = rbox(sw, sh, 0.04, mats.screen, 0.01); s.position.y = sh / 2; g.add(s); return g; }
// Доод шүүгээ (мод) + гантиг тавцан + бариул; sx = угаалтуур (холигч tapH — цонхны доор намхан), kx = плита + доор нь шарах шүүгээ (тавцангийн локал x)
function mkCounter(len, sx = null, tapH = 0.28, kx = null) {
  const g = new THREE.Group(), add = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); return m; };
  add(rbox(len - 0.02, 0.86, 0.6, mats.wood, 0.01), 0, 0.43, 0); add(rbox(len, 0.04, 0.63, mats.marble, 0.01), 0, 0.88, 0.015);
  const n = Math.max(1, Math.floor(len / 0.6)); for (let i = 0; i < n; i++) { const x = -len / 2 + (i + 0.5) * len / n; if (kx == null || Math.abs(x - kx) > 0.35) add(box(0.14, 0.02, 0.02, mats.steel), x, 0.72, 0.31); }
  if (sx != null) {
    add(rbox(0.52, 0.02, 0.42, mats.steel, 0.01), sx, 0.905, 0.02); add(rbox(0.44, 0.012, 0.32, mats.dark, 0.01), sx, 0.912, 0.03);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, tapH, 10), mats.steel), sx, 0.9 + tapH / 2, -0.2); add(new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.16, 8), mats.steel), sx, 0.9 + tapH - 0.01, -0.13).rotation.x = Math.PI / 2;
  }
  if (kx != null) { add(rbox(0.58, 0.015, 0.5, mats.dark, 0.01), kx, 0.908, 0.02); add(rbox(0.56, 0.56, 0.01, mats.screen, 0.01), kx, 0.44, 0.302); add(box(0.4, 0.02, 0.02, mats.steel), kx, 0.68, 0.32); }
  return g;
}
// Хөргөгч-багана: ган бие + дээд шүүгээ; hs = бариулын тал (локал x тэмдэг — нугас эсрэг талд), pn = ил талын бүтэн өндөр цагаан хавтан (−1/+1, 0 = үгүй)
function mkFridge(w, hs = 1, pn = 0) {
  const g = new THREE.Group(), bw = w - (pn ? 0.025 : 0), bx = -pn * 0.0125, add = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); return m; };
  add(rbox(bw, 1.85, 0.65, mats.steel, 0.03), bx, 0.925, 0); add(box(bw - 0.02, 0.008, 0.005, mats.dark), bx, 1.25, 0.326);
  for (const y of [1.45, 0.95]) add(box(0.02, 0.32, 0.03, mats.dark), bx + hs * (bw / 2 - 0.06), y, 0.34);
  add(rbox(bw, 0.36, 0.6, mats.matteWhite, 0.01), bx, 2.05, -0.025); add(box(0.14, 0.015, 0.02, mats.steel), bx, 1.93, 0.285);
  if (pn) add(box(0.025, 2.24, 0.66, mats.matteWhite), pn * (w / 2 - 0.0125), 1.12, 0.005);
  return g;
}
function mkUpper(len, h = 0.7, d = 0.35) { const g = new THREE.Group(), b = rbox(len, h, d, mats.matteWhite, 0.01); b.position.y = h / 2; g.add(b); const n = Math.max(1, Math.round(len / 0.5)); for (let i = 1; i < n; i++) { const l = box(0.006, h - 0.04, 0.004, mats.seam); l.position.set(-len / 2 + i * len / n, h / 2, d / 2 + 0.001); g.add(l); } return g; }
function mkHood(h) { const g = new THREE.Group(), cp = rbox(0.6, 0.07, 0.5, mats.steel, 0.01), ch = box(0.3, h - 0.07, 0.25, mats.steel); cp.position.y = 0.035; ch.position.set(0, 0.07 + (h - 0.07) / 2, -0.125); g.add(cp, ch); return g; } // яндан (агаар соруулагч)
function mkTub(L, D) { const g = new THREE.Group(), o = rbox(L, 0.56, D, mats.white, 0.06), i = rbox(L - 0.14, 0.02, D - 0.14, mats.water, 0.04), f = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.18, 10), mats.steel); o.position.y = 0.28; i.position.y = 0.555; f.position.set(L / 2 - 0.14, 0.62, -D / 2 + 0.06); g.add(o, i, f); return g; }
function mkWC() { const g = new THREE.Group(), add = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); }; add(rbox(0.38, 0.4, 0.52, mats.white, 0.08), 0, 0.2, 0.05); add(rbox(0.37, 0.03, 0.46, mats.white, 0.015), 0, 0.415, 0.07); add(rbox(0.38, 0.38, 0.17, mats.white, 0.03), 0, 0.6, -0.225); return g; }
function mkVanity(w, D = 0.45) { const g = new THREE.Group(), add = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); }; add(rbox(w, 0.8, D, mats.wood, 0.02), 0, 0.4, 0); add(rbox(w + 0.02, 0.06, D + 0.01, mats.white, 0.02), 0, 0.83, 0.005); add(rbox(w - 0.2, 0.012, D - 0.17, mats.water, 0.01), 0, 0.862, 0.03); add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.2, 10), mats.steel), 0, 0.96, -D / 2 + 0.055); return g; }
function mkShoeCab(w) { const g = new THREE.Group(), b = rbox(w, 0.88, 0.32, mats.matteWhite, 0.01), t = rbox(w + 0.02, 0.025, 0.33, mats.oak, 0.005); b.position.y = 0.44; t.position.set(0, 0.8925, 0.005); g.add(b, t); const l = box(0.006, 0.8, 0.004, mats.seam); l.position.set(0, 0.44, 0.161); g.add(l); for (const k of [-1, 1]) { const h = box(0.1, 0.012, 0.02, mats.steel); h.position.set(k * 0.08, 0.78, 0.17); g.add(h); } return g; }
function mkPlant() { // сансевиер: цагаан ваар + босоо навч (~0.75 м)
  const g = new THREE.Group(), pot = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.09, 0.26, 20), mats.matteWhite), soil = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.01, 16), mats.dark); pot.position.y = 0.13; pot.castShadow = true; soil.position.y = 0.255; g.add(pot, soil);
  for (let i = 0; i < 9; i++) { const h = 0.3 + ((i * 37) % 10) / 10 * 0.18, a = i * 2.4, l = box(0.045, h, 0.01, mats.leaf); l.position.set(Math.cos(a) * 0.045, 0.26 + h / 2, Math.sin(a) * 0.045); l.rotation.set(Math.sin(a) * 0.12, a, Math.cos(a) * 0.12); g.add(l); }
  return g;
}
function mkTable(L, D) { // модерн ширээ: 3.5 см модон тавцан, нимгэн 4 хөл, нарийн хүрээ (хуучин glTF-ийн үрчийсэн бүтээлэгийн оронд)
  const g = new THREE.Group(), add = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); return m; };
  add(rbox(L, 0.035, D, mats.tWood, 0.008), 0, 0.7325, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(box(0.045, 0.715, 0.045, mats.tWood), sx * (L / 2 - 0.08), 0.3575, sz * (D / 2 - 0.08));
  for (const sz of [-1, 1]) add(box(L - 0.2, 0.06, 0.02, mats.tWood), 0, 0.685, sz * (D / 2 - 0.08)); for (const sx of [-1, 1]) add(box(0.02, 0.06, D - 0.2, mats.tWood), sx * (L / 2 - 0.08), 0.685, 0);
  return g;
}
function mkChair() { // модерн хоолны сандал: модон хөл/түшлэг, цайвар даавуун суудал
  const g = new THREE.Group(), add = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); return m; };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(box(0.032, 0.44, 0.032, mats.tWood), sx * 0.19, 0.22, sz * 0.19);
  add(rbox(0.46, 0.03, 0.46, mats.tWood, 0.008), 0, 0.455, 0); add(rbox(0.42, 0.05, 0.42, mats.headboard, 0.02), 0, 0.495, 0.01);
  for (const sx of [-1, 1]) add(box(0.03, 0.4, 0.03, mats.tWood), sx * 0.19, 0.67, -0.205);
  add(rbox(0.44, 0.13, 0.03, mats.tWood, 0.01), 0, 0.8, -0.215).rotation.x = -0.1;
  return g;
}
function mkMirror(w, h) { const g = new THREE.Group(), f = rbox(w, h, 0.025, mats.dark, 0.02), m = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.04, h - 0.04), mats.mirror); f.position.y = h / 2; m.position.set(0, h / 2, 0.0135); g.add(f, m); return g; } // нимгэн хар хүрээтэй толь (орчны тусгалтай)
// Зургийн жааз: урлагийг процедур хийсвэр зургаар солино (анхны нь «Ray Homes» саарал загвар байв)
function artTex(i) {
  const t = canvasTex((g, s) => {
    g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, s, s); g.fillStyle = i ? '#e8e0d2' : '#efe6d8'; g.fillRect(110, 26, 292, s - 52); // паспарту + дэвсгэр (урлагийн UV: x 0.165..0.835)
    if (i) { g.fillStyle = '#d7b98e'; g.fillRect(150, 90, 212, 240); g.fillStyle = '#2f3437'; g.beginPath(); g.arc(256, 350, 92, Math.PI, 0); g.fill(); g.fillStyle = '#c9774f'; g.beginPath(); g.arc(318, 150, 32, 0, Math.PI * 2); g.fill(); }
    else { g.fillStyle = '#c9774f'; g.beginPath(); g.arc(256, 180, 74, 0, Math.PI * 2); g.fill(); g.fillStyle = '#8fa18a'; g.beginPath(); g.moveTo(152, 470); g.lineTo(152, 350); g.arc(256, 350, 104, Math.PI, 0); g.lineTo(360, 470); g.closePath(); g.fill(); g.strokeStyle = '#3a3a3a'; g.lineWidth = 3; g.beginPath(); g.moveTo(132, 300); g.lineTo(380, 300); g.stroke(); }
  }, 512); t.flipY = false; return t; // glTF UV (v доош)
}
function mkFrame(i) { const g = mdl('hanging_picture_frame_01'); if (g) g.traverse((o) => { if (o.isMesh && /artwork$/.test(o.material.name)) { o.material = o.material.clone(); o.material.map = artTex(i); o.material.needsUpdate = true; } }); return g; }

// ---------- Өрөөний хөтөлбөрүүд ----------
async function progBedroom(c) {
  // Ор: толгой нь хатуу хананд (хаалгатай хана, цонхны доороос зайлсхийнэ), хананы төвд, нэг талд ≥0.6 м, хөлд ≥0.7 м чөлөө
  const sh = Math.min(c.x1 - c.x0, c.z1 - c.z0), bw = sh > 3.2 ? 1.6 : sh > 2.7 ? 1.4 : 0.9;
  const head = proto(P(bw + 0.1, 0.08, 1.06, () => mkHeadboard(bw)), 'орны толгой', { grp: 'bed' }), body = proto(P(bw + 0.04, 2.02, 0.7, () => mkBedBody(bw)), 'ор', { grp: 'bed' }), cands = [], L = LAY.gap + head.d + body.d;
  for (const s of SIDES) {
    const W = c.walls[s], door = W.ops.some((o) => o.t === 'door'), win = W.ops.some((o) => o.t === 'win'), mid = (W.a0 + W.a1) / 2;
    for (const [a, b] of solid(c, s, 0, head.h)) for (const t of steps(a + head.w / 2, b - head.w / 2)) {
      const H = onWall(c, head, s, t), B = onWall(c, body, s, t, LAY.gap + head.d);
      const sides = [wRect(c, s, t - bw / 2 - 0.6, t - bw / 2, 0.5, L), wRect(c, s, t + bw / 2, t + bw / 2 + 0.6, 0.5, L)].filter((k) => inRoom(c, k)); if (!sides.length) continue;
      B.keep = [{ ...wRect(c, s, t - bw / 2, t + bw / 2, L, L + 0.7), reach: 1 }, ...sides];
      cands.push({ key: s + Math.round(t / 0.3), score: (door ? 0 : 2) + (win ? 0 : 0.5) + sides.length * 0.6 - Math.abs(t - mid) * 2 + (c.main ? Math.min(3, rdist(B.rect, c.main)) * 0.4 : 0), its: [H, B] });
    }
  }
  // Хувцасны шүүгээ: хатуу хэсэгт, урд нь 0.8 м чөлөө (цонх/тагтны хаалганы өмнө биш), буланд илүү
  const wps = [2.0, 1.8, 1.6, 1.4, 1.2, 1.1, 1.0].map((w) => proto(P(w, 0.62, 2.2, () => mkWardrobe(w)), 'хувцасны шүүгээ', { grp: 'ward' }));
  const wardC = () => { const wc = []; for (const p of wps) for (const s of SIDES) { const W = c.walls[s]; for (const [a, b] of solid(c, s, 0, p.h)) for (const t of steps(a + p.w / 2, b - p.w / 2)) { const it = onWall(c, p, s, t); it.keep = [{ ...wRect(c, s, t - p.w / 2, t + p.w / 2, LAY.gap + p.d, LAY.gap + p.d + 0.8), reach: 1 }]; wc.push({ score: p.w * 1.2 + (Math.min(t - p.w / 2 - W.a0, W.a1 - t - p.w / 2) < 0.03 ? 0.8 : 0), its: [it] }); } } return wc; };
  const WC = wardC(), ns = proto(P(0.45, 0.4, 0.92, mkNightstand), 'орны шүүгээ', { grp: 'bed' }), nsAt = (H) => [-1, 1].map((k) => onWall(c, ns, H.side, H.t + k * (bw / 2 + 0.1 + ns.w / 2)));
  const bed = await put1L(c, cands, 'ор', (cc) => { // орыг сонгохдоо хоёр шүүгээ + хувцасны шүүгээ багтах эсэхийг урьдчилан харна
    const H = cc.items[cc.items.length - 2]; let n = 0; for (const it of nsAt(H)) if (!fits(cc, it)) { cc.items.push(it); n++; }
    const w = peek(cc, WC); cc.items.length -= n; return n * 0.4 + (w ? 1.5 + w.its[0].w : 0);
  });
  await c.tick();
  if (bed) {
    const { side: s, t } = bed[0]; for (const it of nsAt(bed[0])) add1(c, it);
    const nF = head.w >= 1.5 ? 2 : 1; // толгойн дээр 1–2 зураг, өрөө рүү харсан
    for (let i = 0; i < nF; i++) { const p = proto(mkFrame(i), 'зураг', { grp: 'bed', wall: true, deco: true, y0: 1.28 }); if (p) add1(c, onWall(c, p, s, t + (nF === 2 ? (i ? 0.36 : -0.36) : 0), 0.005)); }
    rug(c, s, t, bw + 0.8, 0.62, [L + 0.6, L + 0.45], 'bed'); // хивс: орны доод 2/3 + хөлөөс ≥0.45 м гарна (эс бөгөөс алгасна)
  }
  put1(c, WC, 'хувцасны шүүгээ'); await c.tick();
  const lp = proto(mdl('modern_ceiling_lamp_01', 0.6), 'таазны гэрэл', { grp: 'lamp', y0: plan.ceiling - 0.57, ceil: true }); // тааз дор 0.57 м — өрөөний төвд
  if (lp) add1(c, at(lp, (c.x0 + c.x1) / 2, (c.z0 + c.z1) / 2, 0));
}
// Гал тогоо: эгнээ = хамгийн урт чөлөөт хана (цонхтой бол угаалтуур доор нь). Хөргөгч = өндөр багана (дээд шүүгээ + ил талдаа бүтэн хавтан), эгнээний булан БИШ төгсгөлд, нугас нь тавцангаас холын талд.
// Плита: цонхноос ≥0.3 м, хоёр талдаа ≥0.3 м тавцан, угаалтууртай хооронд ≥0.6 м; эгнээнд багтахгүй бол буланд L эргэлт (хөрш хатуу хананд плита + яндан + дээд шүүгээ)
function progKitchen(c, sides) {
  let run = null;
  for (const s of sides) for (const [a, b] of bandIv(c, s, 0, 0.92, 0.66)) { const win = c.walls[s].ops.some((o) => o.t === 'win' && o.hi > a && o.lo < b), sc = b - a + (win ? 0.6 : 0); if (b - a >= 1.5 && (!run || sc > run.sc)) run = { s, a, b, sc }; }
  if (!run) return skip(c, 'гал тогооны эгнээ', 'чөлөөт хана алга (хаалга/цонх)');
  const { s } = run, W = c.walls[s], CD = 0.63, keeps = [], sgn = (q) => (q === 'N' || q === 'E' ? 1 : -1), sg = sgn(s), lo = s === 'N' || s === 'W';
  const cor = (t) => (Math.abs(t - W.a0) < 0.05 ? -1 : Math.abs(t - W.a1) < 0.05 ? 1 : 0), side2 = (k) => (alongX(s) ? (k > 0 ? 'E' : 'W') : (k > 0 ? 'S' : 'N'));
  const winOk = (q, t0, t1) => c.walls[q].ops.every((o) => o.t !== 'win' || o.sill > 2 || t1 <= o.lo - 0.3 || t0 >= o.hi + 0.3); // плита цонхноос ≥0.3 м
  const kp = (it, q, t0, t1) => { it.keep = [{ ...wRect(c, q, t0, t1, LAY.gap + it.d, LAY.gap + it.d + 0.9), reach: 1 }]; return it; };
  // 1) Хөргөгч-багана (0.6/0.55): эгнээний төгсгөл (булан биш төгсгөл илүү — булан L эргэлтэд үлдэнэ); эгнээ буланд хүрсэн бол хөрш хананд ч болно
  let a = run.a, b = run.b; const fc = [];
  for (const fw of [0.6, 0.55]) for (const end of [0, 1]) {
    const t = end ? b - fw / 2 : a + fw / 2, hs = sg * (end ? -1 : 1), k = cor(end ? b : a), f = proto(P(fw, 0.66, 2.24, () => mkFridge(fw, hs, k ? 0 : -hs)), 'хөргөгч', { grp: 'kit' });
    fc.push({ score: 2 + fw - (k ? 0.8 : 0), its: [kp(onWall(c, f, s, t), s, t - fw / 2, t + fw / 2)], run: end ? [a, b - fw - 0.02] : [a + fw + 0.02, b] });
    if (!k) continue; const q = side2(k), W2 = c.walls[q], di = lo ? 1 : -1, t2 = (lo ? W2.a0 : W2.a1) + di * (LAY.gap + CD + 0.02 + fw / 2), h2 = sgn(q) * -di, f2 = proto(P(fw, 0.66, 2.24, () => mkFridge(fw, h2, -h2)), 'хөргөгч', { grp: 'kit' });
    fc.push({ score: 1 + fw, its: [kp(onWall(c, f2, q, t2), q, t2 - fw / 2, t2 + fw / 2)], run: [a, b] });
  }
  const fr = choose(c, fc); if (fr.fail) skip(c, 'хөргөгч', fr.fail); else { commit(c, fr.its); [a, b] = fr.run; keeps.push(...fr.its[0].keep); }
  const len = b - a; if (len < 0.8) { skip(c, 'тавцан', 'зай хүрэлцэхгүй'); return keeps; }
  // 2) Угаалтуур: цонхны төвд (эс бөгөөс хөргөгчийн талаас 1/3-т); 3) плита эгнээнд, эс бөгөөс L эргэлтэд
  const wn = W.ops.filter((o) => o.t === 'win' && o.hi > a + 0.3 && o.lo < b - 0.3)[0], tc = (a + b) / 2;
  const ts = wn ? Math.min(b - 0.35, Math.max(a + 0.35, (wn.lo + wn.hi) / 2)) : a + Math.min(0.9, len * 0.35), tapH = wn && ts > wn.lo - 0.3 && ts < wn.hi + 0.3 ? Math.max(0.06, Math.min(0.28, wn.sill - 0.97)) : 0.28;
  let st = null, ret = null;
  for (let t = a + 0.6; t <= b - 0.6 + 1e-6; t += 0.05) if (Math.abs(t - ts) >= 1.16 && winOk(s, t - 0.3, t + 0.3) && (!st || Math.abs(t - ts) < Math.abs(st.t - ts))) st = { q: s, t };
  if (!st) for (const k of [1, -1]) { // L эргэлт: 1.2 м (0.3 тавцан + 0.6 плита + 0.3 тавцан), булангийн тавцангийн ард
    if (cor(k > 0 ? b : a) !== k) continue; const q = side2(k), W2 = c.walls[q], di = lo ? 1 : -1, r0 = (lo ? W2.a0 : W2.a1) + di * (LAY.gap + CD), l0 = Math.min(r0, r0 + di * 1.2), l1 = l0 + 1.2, t2 = (l0 + l1) / 2;
    if (!bandIv(c, q, 0, 0.92, 0.66).some(([x, y]) => x <= l0 + 0.01 && y >= l1 - 0.01) || !winOk(q, t2 - 0.3, t2 + 0.3)) continue;
    const pr = proto(P(1.2, CD, 0.92, () => mkCounter(1.2, null, 0, 0)), 'тавцан (L)', { grp: 'kit' }); ret = { q, l0, l1, it: kp(onWall(c, pr, q, t2), q, l0, l1) }; st = { q, t: t2 }; break;
  }
  let stF = null, bd = -1; for (let t = a + 0.35; t <= b - 0.35 + 1e-6; t += 0.05) { if (Math.abs(t - ts) < 0.9) continue; const d = Math.min(9, ...W.ops.filter((o) => o.t === 'win').map((o) => Math.max(o.lo - t - 0.3, t - 0.3 - o.hi))); if (d > bd) { bd = d; stF = { q: s, t, near: d < 0.3 }; } } // нөөц: эгнээнд цонхноос аль болох хол
  if (!st) st = stF;
  const mp = proto(P(len, CD, 0.92, () => mkCounter(len, (ts - tc) * sg, tapH, st && st.q === s ? (st.t - tc) * sg : null)), 'тавцан', { grp: 'kit' }), main = kp(onWall(c, mp, s, tc), s, a, b);
  let cr = choose(c, [{ score: 0, its: ret ? [main, ret.it] : [main] }]);
  if (cr.fail && ret) { skip(c, 'тавцан (L)', cr.fail); ret = null; st = stF; cr = choose(c, [{ score: 0, its: [kp(onWall(c, proto(P(len, CD, 0.92, () => mkCounter(len, (ts - tc) * sg, tapH, st ? (st.t - tc) * sg : null)), 'тавцан', { grp: 'kit' }), s, tc), s, a, b)] }]); }
  if (cr.fail) { skip(c, 'тавцан', cr.fail); return keeps; }
  commit(c, cr.its); for (const it of cr.its) keeps.push(...it.keep); if (st && st.near) c.log.push({ k: 'плита', note: 'цонхны ойр (өөр байр алга)' });
  // 4) Яндан плитагийн дээр (тавцангаас 0.72 м), дээд шүүгээ — цонх/яндан/хөргөгчөөс бусад хатуу хэсэгт (≥0.25 м)
  const H = plan.ceiling, y0 = 1.62; if (st) add1(c, onWall(c, proto(P(0.6, 0.5, H - 0.1 - y0, () => mkHood(H - 0.1 - y0)), 'яндан', { grp: 'kit', wall: true, y0 }), st.q, st.t));
  for (const [q, u0, u1] of [[s, a, b], ...(ret ? [[ret.q, ret.l0, ret.l1]] : [])]) {
    let iv = bandIv(c, q, 1.5, 2.2, 0.36, 0.25).map(([x, y]) => [Math.max(x, u0), Math.min(y, u1)]); if (st && st.q === q) iv = iv.flatMap(([x, y]) => [[x, Math.min(y, st.t - 0.31)], [Math.max(x, st.t + 0.31), y]]);
    for (const [x, y] of iv.filter(([x, y]) => y - x >= 0.25)) add1(c, onWall(c, proto(P(y - x - 0.01, 0.35, 0.7, () => mkUpper(y - x - 0.01)), 'дээд шүүгээ', { grp: 'kit', wall: true, y0: 1.5 }), q, (x + y) / 2));
  }
  return keeps;
}
async function progDining(c, prefer, band) {
  // Хоолны ширээ (процедур модон) + модерн сандал: сандлын ард 0.6 м татах зай, ширээ ↔ тавцан ≥0.9 м (тавцангийн чөлөө), хоёр талын гарц тэнцүү (төвд), хаалганы замыг хаахгүй; урт талд, дараа нь үзүүрт (≤4)
  const ch = proto(P(0.46, 0.48, 0.87, mkChair), 'сандал', { grp: 'dine', pull: true }), cands = [];
  for (const [L, D] of [[1.4, 0.85], [1.2, 0.8], [0.9, 0.9]]) {
    const tp = proto(P(L, D, 0.75, () => mkTable(L, D)), 'хоолны ширээ', { grp: 'dine' });
    for (const th of L === D ? [0] : [0, Math.PI / 2]) {
      const cs = Math.cos(th), sn = Math.sin(th), hw = (th ? D : L) / 2, hd = (th ? L : D) / 2, ex = ch.d / 2 - 0.08, slots = []; // суудлын урд ирмэг ширээн доор 8 см
      for (const v of [-1, 1]) for (const u of L >= 1.2 ? [-L / 4, L / 4] : [0]) slots.push([u, v * (D / 2 + ex), 0, -v, v < 0 ? 0 : 1]);
      for (const u of [-1, 1]) slots.push([u * (L / 2 + ex), 0, -u, 0, u < 0 ? 2 : 3]); // slot: 0/1 урт талууд, 2/3 үзүүрүүд
      for (let x = c.x0 + hw; x <= c.x1 - hw + 1e-6; x += 0.1) for (let z = c.z0 + hd; z <= c.z1 - hd + 1e-6; z += 0.05) {
        const tb = at(tp, x, z, th), d = prefer && prefer.length ? Math.min(...prefer.map((k) => rdist(tb.rect, k))) : 0; if (d > 2.5 || fits(c, tb)) continue; c.items.push(tb); const chairs = []; // гал тогооноос ≤2.5 м
        for (const [u, v, fu, fv, sl] of slots) { if (chairs.length >= 4) break; const it = at(ch, x + u * cs + v * sn, z - u * sn + v * cs, Math.atan2(fu * cs + fv * sn, -fu * sn + fv * cs), { slot: sl }), bx = -(fu * cs + fv * sn), bz = -(-fu * sn + fv * cs), R = it.rect, K = LAY.back; it.keep = [{ x0: bx > 0.5 ? R.x1 : bx < -0.5 ? R.x0 - K : R.x0, x1: bx > 0.5 ? R.x1 + K : bx < -0.5 ? R.x0 : R.x1, z0: bz > 0.5 ? R.z1 : bz < -0.5 ? R.z0 - K : R.z0, z1: bz > 0.5 ? R.z1 + K : bz < -0.5 ? R.z0 : R.z1 }]; if (!fits(c, it)) { c.items.push(it); chairs.push(it); } } // сандлын ард 0.6 м татах зай
        c.items.length -= 1 + chairs.length; if (chairs.length < 2) continue;
        const sym = [0, 1].every((q) => chairs.filter((h) => h.slot === q * 2).length === chairs.filter((h) => h.slot === q * 2 + 1).length), its = [tb, ...chairs], G = { x0: Math.min(...its.map((i) => i.rect.x0)), x1: Math.max(...its.map((i) => i.rect.x1)), z0: Math.min(...its.map((i) => i.rect.z0)), z1: Math.max(...its.map((i) => i.rect.z1)) }, g = gaps(c, G, 'dine');
        const bal = (g[0] < 2.5 && g[1] < 2.5 ? Math.abs(g[0] - g[1]) : 0) + (g[2] < 2.5 && g[3] < 2.5 ? Math.abs(g[2] - g[3]) : 0);
        cands.push({ key: L + '/' + th + '/' + Math.round(x / 0.3), score: Math.min(4, chairs.length) * 1.5 + (sym ? 1.2 : 0) + L * 0.8 - d * 2 - bal * 0.6, its }); // тэгш хэмтэй (эсрэг талдаа хос) сандал илүү
      }
      await c.tick();
    }
  }
  // Урьдчилан харах: хэмжээ/чиглэл бүрийн шилдэг байрлалд зочны бүлэг (буйдан + ТВ) багтах эсэх
  const SC = c.r.type === 'living' ? seatCands(c, band).cands : null, res = SC ? await put1L(c, cands, 'хоолны ширээ', (cc) => { const p = peek(cc, SC); return p ? 2 + p.score * 0.2 : 0; }) : put1(c, cands, 'хоолны ширээ'); if (!res) return null;
  const lp = proto(mdl('modern_ceiling_lamp_01', 0.6), 'унжлага гэрэл', { grp: 'dine', y0: plan.ceiling - 0.57, ceil: true }); if (lp) add1(c, at(lp, res[0].x, res[0].z, 0));
  return res[0];
}
// Зочны бүлэг: буйдан бодит хананд (нам тул цонхны доор болно), ТВ (шүүгээ + ханын дэлгэц) эсрэг БОДИТ хананд 2.2–3.2 м зайд, дунд нь кофены ширээ (буйдангаас 0.45 м)
// Буйдан хананд наалдана; зөвхөн ард нь ≥0.9 м гарц үлдэх том өрөөнд л хананаас холдоно (тэгвэл чөлөөт эд зүйл гэж тооцогдоно)
function seatCands(c, band) {
  const sofas = [2.2, 1.9, 1.6].map((L) => proto(P(L, 0.9, 0.78, () => mkSofa(L)), 'буйдан', { grp: 'seat' }));
  const tvs = [[1.8, 1.3], [1.5, 1.1]].map(([cw, sw]) => [proto(mdl('modern_wooden_cabinet', cw / 2.44, 0.5 / 0.68, 0.4 / 0.52), 'ТВ-ийн шүүгээ', { grp: 'seat' }), proto(P(sw, 0.04, sw * 0.5625 + 0.03, () => mkScreen(sw)), 'ТВ дэлгэц', { grp: 'seat', wall: true, y0: 0.95 })]).filter(([q]) => q);
  const ct = proto(mdl('modern_coffee_table_01', 0.9), 'кофены ширээ', { grp: 'seat', rot0: Math.PI / 2 }), cands = [], alone = [];
  let [lx0, lx1, lz0, lz1] = [c.x0, c.x1, c.z0, c.z1]; if (band === 'N') lz0 += 2.4; if (band === 'S') lz1 -= 2.4; if (band === 'W') lx0 += 2.4; if (band === 'E') lx1 -= 2.4; // зочны бүсийн төв
  for (const s of SIDES) {
    if (s === band) continue; const ts = OPP[s], span = alongX(s) ? c.z1 - c.z0 : c.x1 - c.x0, pc0 = alongX(s) ? (lx0 + lx1) / 2 : (lz0 + lz1) / 2;
    for (const so of sofas) {
      const vd0 = span - LAY.gap - 0.45 - 0.07, fl = vd0 - 3.0 >= 0.9 ? vd0 - 3.0 : 0, off = LAY.gap + fl, vd = vd0 - fl; // харах зай 3.0 м-ээс хэтэрсэн ч ард ≥0.9 м гарц үлдэхгүй бол хананд үлдэнэ
      for (const [a, b] of solid(c, s, 0, so.h)) for (const t of steps(a + so.w / 2, b - so.w / 2)) {
        const sofa = onWall(c, so, s, t, off), win = c.walls[s].ops.find((o) => o.t === 'win' && o.lo < t + so.w / 2 && o.hi > t - so.w / 2), pc = win ? (win.lo + win.hi) / 2 : pc0; if (fl) { sofa.wside = s; sofa.side = null; }
        const table = ct ? [at(ct, ...wPt(c, s, t, off + so.d + 0.45 + ct.d / 2), FACE[s])] : [], base = so.w * 1.5 - Math.abs(t - pc) * 0.8 + (c.main ? Math.min(3, rdist(sofa.rect, c.main)) * 0.3 : 0);
        alone.push({ score: base, its: [sofa, ...table] }, { score: base - 1, its: [sofa] });
        if (ts === band || vd < 2.2) continue;
        for (const [cab, scr] of tvs) cands.push({ score: base + cab.w * 0.5 - Math.abs(vd - 2.8), its: [sofa, ...table, onWall(c, cab, ts, t), onWall(c, scr, ts, t, 0.03)] });
      }
    }
  }
  return { cands, alone, ct };
}
function progSeating(c, band) {
  const { cands, alone, ct } = seatCands(c, band);
  let seat = choose(c, cands);
  if (seat.fail) { skip(c, 'ТВ', `эсрэг хананд багтсангүй (${seat.fail})`); seat = choose(c, alone); if (seat.fail) return skip(c, 'буйдан', seat.fail); }
  const its = commit(c, seat.its), sofa = its[0], s = sofa.wside || sofa.side, table = its.find((i) => i.k === 'кофены ширээ'), cab = its.find((i) => i.k === 'ТВ-ийн шүүгээ');
  if (table) rug(c, s, sofa.t, sofa.w + 0.3, sofa.off + sofa.d - 0.12, [0.45, 0.25, 0.1].map((ex) => sofa.off + sofa.d + 0.45 + ct.d + ex), 'seat'); // буйдангийн урд хөлийн доороос ширээний цаана
  if (cab) { const vp = proto(mdl('ceramic_vase_01'), 'ваар', { grp: 'seat', y0: cab.h + 0.001 }); if (vp) { let ok = false; for (const k of [1, -1]) { const it = onWall(c, vp, cab.side, cab.t + k * (cab.w / 2 - 0.2), LAY.gap + cab.d / 2 - vp.d / 2); if (!tryAdd(c, [it])) { commit(c, [it]); ok = true; break; } } if (!ok) skip(c, 'ваар', 'шүүгээн дээр зай алга'); } }
  // Түшлэгтэй сандал (зай байвал): кофены ширээний үзүүрт, ширээ рүү харсан (хананд наалдах эсвэл гарц үлдээх хүртэл ойртуулж/холдуулна)
  const ap = proto(mdl('modern_arm_chair_01', 0.95), 'түшлэгтэй сандал', { grp: 'seat' });
  if (ap && table) {
    const u = alongX(s) ? [1, 0] : [0, 1], n = { N: [0, 1], S: [0, -1], W: [1, 0], E: [-1, 0] }[s], ac = [];
    for (const k of [-1, 1]) for (const du of [0, -0.05, -0.1, -0.15, -0.2, 0.1]) for (const dv of [0, 0.15, -0.15]) { const d0 = ct.w / 2 + 0.3 + ap.d / 2 + du, x = table.x + u[0] * k * d0 + n[0] * dv, z = table.z + u[1] * k * d0 + n[1] * dv, it = at(ap, x, z, Math.atan2(-k * u[0], -k * u[1])); ac.push({ score: Math.min(2, ...c.zones.map((zz) => rdist(it.rect, zz))) * 0.5 - Math.abs(dv) - Math.abs(du) * 0.5, its: [it] }); }
    put1(c, ac, 'түшлэгтэй сандал');
  }
  return sofa;
}
// Хивс: хананаас o0..o1 гүн, дагуу w өргөн (дараалсан гүнээр оролдоно — хаалганы чөлөөнд орохгүй)
function rug(c, s, t, w, o0, o1s, grp) {
  for (const o1 of o1s) { const it = at(proto(P(w, o1 - o0, 0.01, () => flat(w, o1 - o0, mats.rug)), 'хивс', { grp, under: true, y0: 0.004, h: 0.01 }), ...wPt(c, s, t, (o0 + o1) / 2), FACE[s]); if (!tryAdd(c, [it])) return commit(c, [it]); }
  return skip(c, 'хивс', 'хаалганы чөлөөнд эсвэл өрөөнөөс гарна');
}
// Ханын чимэглэл (цаг, листингийн зураг): хамгийн их чөлөөтэй хатуу хананы төвд, нээлхий/хүрээ/бусад ханын эд зүйлээс зайтай; near бол түүний ойролцоо
function wallDeco(c, p, near) {
  if (!p) return null; const cands = [];
  for (const s of SIDES) for (const [a, b] of solid(c, s, p.y0, p.y0 + p.h, 0.15)) for (const t of steps(a + p.w / 2, b - p.w / 2)) {
    const it = onWall(c, p, s, t, 0.005); let cl = Math.min(t - a, b - t);
    for (const o of c.items) if (o.side === s && (o.wall || o.h > 1.4)) cl = Math.min(cl, Math.max(0, Math.abs(t - o.t) - (alongX(s) ? o.rect.x1 - o.rect.x0 : o.rect.z1 - o.rect.z0) / 2));
    cands.push({ score: Math.min(cl, 1.5) + (near ? Math.max(0, 2 - rdist(it.rect, near.rect)) : 0), its: [it] });
  }
  return put1(c, cands, p.k, false);
}
async function progLiving(c) {
  const band = c.r.kitchen && c.walls[c.r.kitchen] ? c.r.kitchen : null; let dine = null;
  if (band) { const kk = progKitchen(c, [band]); await c.tick(); dine = await progDining(c, kk, band); await c.tick(); } // гал тогоо → хоолны хэсэг (шилжилтийн бүс) → зочны бүлэг
  progSeating(c, band); await c.tick();
  wallDeco(c, proto(mdl('wall_clock'), 'цаг', { grp: 'clock', wall: true, deco: true, y0: 1.74 }), dine);
}
function progBath(c) {
  // Ванн (хаалганаас хол, хамгийн урт хатуу хана), суултуур (хаалганы эсрэг хана; төвөөс хажуу тал бүрт ≥0.4 м чөлөө), угаалтуур + толь — бүгд хаалганы чөлөөнд орохгүй
  const W = c.x1 - c.x0, D = c.z1 - c.z0, opp = c.main ? OPP[c.main.s] : null;
  if (W * D >= 1.8 && Math.min(W, D) >= 1.1) {
    const cands = [];
    for (const L of [1.7, 1.6, 1.5, 1.4, 1.3, 1.2]) for (const dd of [0.75, 0.7, 0.65, 0.6]) { const p = proto(P(L, dd, 0.72, () => mkTub(L, dd)), 'ванн', { grp: 'tub' }); for (const s of SIDES) for (const [a, b] of solid(c, s, 0, p.h)) for (const t of steps(a + L / 2, b - L / 2)) { const it = onWall(c, p, s, t); cands.push({ score: L * 2 + dd + (c.main ? Math.min(2, rdist(it.rect, c.main)) * 0.5 : 0), its: [it] }); } }
    put1(c, cands, 'ванн');
  } else skip(c, 'ванн', 'өрөө жижиг');
  const wp = proto(P(0.38, 0.62, 0.79, mkWC), 'суултуур', { grp: 'wc' }), wcs = [];
  for (const s of SIDES) { const Wl = c.walls[s]; for (const [a, b] of solid(c, s, 0, wp.h)) for (const t of steps(a + 0.4, b - 0.4, 0.05)) { const it = onWall(c, wp, s, t); it.keep = [wRect(c, s, t - 0.3, t + 0.3, LAY.gap + wp.d, LAY.gap + wp.d + 0.45), wRect(c, s, t - 0.4, t + 0.4, 0, LAY.gap + wp.d)]; wcs.push({ score: (s === opp ? 1 : 0) - Math.abs(t - (Wl.a0 + Wl.a1) / 2) * 0.1, its: [it] }); } }
  put1(c, wcs, 'суултуур');
  const vc = [];
  for (const [w, dd] of [[0.6, 0.45], [0.5, 0.45], [0.45, 0.4], [0.4, 0.28]]) { const p = proto(P(w + 0.02, dd + 0.01, 1.06, () => mkVanity(w, dd)), 'угаалтуур', { grp: 'sink' }); for (const s of SIDES) for (const [a, b] of solid(c, s, 0, p.h)) for (const t of steps(a + p.w / 2, b - p.w / 2)) { const it = onWall(c, p, s, t); it.keep = [wRect(c, s, t - p.w / 2, t + p.w / 2, LAY.gap + p.d, LAY.gap + p.d + 0.5)]; vc.push({ score: w - (c.main ? rdist(it.rect, c.main) * 0.2 : 0), its: [it] }); } }
  const v = put1(c, vc, 'угаалтуур'), mw = v && Math.min(0.5, v[0].w), mp = v && proto(P(mw, 0.03, 0.7, () => mkMirror(mw, 0.7)), 'толь', { grp: 'sink', wall: true, deco: true, y0: 1.15 });
  if (mp) { const Wv = c.walls[v[0].side]; add1(c, onWall(c, mp, v[0].side, Math.min(Wv.a1 - mp.w / 2 - 0.03, Math.max(Wv.a0 + mp.w / 2 + 0.03, v[0].t)), 0.005)); }
}
function progHall(c) {
  // Зөвхөн нарийн гутлын шүүгээ (орцны хаалганы ойр, чөлөөт хатуу хэсэгт) + толь (0.5 × 1.0); цаг хүрээнээс зайтай
  const ent = c.zones.find((z) => z.door.to === 'out') || c.main;
  if (Math.min(c.x1 - c.x0, c.z1 - c.z0) < 1.2) skip(c, 'гутлын шүүгээ', 'коридор хэт нарийн (<1.2 м)');
  else {
    const cands = [];
    for (const w of [1.0, 0.8, 0.6]) { const p = proto(P(w + 0.02, 0.34, 0.905, () => mkShoeCab(w)), 'гутлын шүүгээ', { grp: 'shoe' }); for (const s of SIDES) for (const [a, b] of solid(c, s, 0, p.h)) for (const t of steps(a + p.w / 2, b - p.w / 2)) { const it = onWall(c, p, s, t); cands.push({ score: w - (ent ? rdist(it.rect, ent) : 0), its: [it] }); } }
    const sc = put1(c, cands, 'гутлын шүүгээ'), mp = sc && proto(P(0.5, 0.03, 1.0, () => mkMirror(0.5, 1.0)), 'толь', { grp: 'shoe', wall: true, deco: true, y0: 1.0 });
    if (mp) add1(c, onWall(c, mp, sc[0].side, sc[0].t, 0.005));
  }
  if (c.zones.some((z) => z.door.to === 'out')) wallDeco(c, proto(mdl('wall_clock'), 'цаг', { grp: 'clock', wall: true, deco: true, y0: 1.74 }));
}
function progBalcony(c) {
  // Тагт: гүн ≥1.1 м бол 1–2 жижиг ургамал буланд, хаалга хоорондын зам чөлөөтэй
  if (Math.min(c.r.w, c.r.h) < 1.1) return skip(c, 'ургамал', 'тагт нарийн (<1.1 м)');
  for (let i = 0; i < 2; i++) {
    const p = proto(P(0.23, 0.23, 0.76, mkPlant), 'ургамал', { grp: 'plant' + i }), cands = [];
    for (const [x, z] of [[c.x0, c.z0], [c.x1, c.z0], [c.x0, c.z1], [c.x1, c.z1]]) { const it = at(p, x + (x === c.x0 ? 1 : -1) * (p.w / 2 + 0.03), z + (z === c.z0 ? 1 : -1) * (p.d / 2 + 0.03), 0); cands.push({ score: Math.min(3, ...c.zones.map((zz) => rdist(it.rect, zz))), its: [it] }); }
    put1(c, cands, 'ургамал');
  }
}
function progOffice(c) {
  const dp = proto(P(1.2, 0.6, 0.75, () => mkTable(1.2, 0.6)), 'ажлын ширээ', { grp: 'desk' }), ch = proto(P(0.46, 0.48, 0.87, mkChair), 'сандал', { grp: 'desk', pull: true }), cands = [];
  for (const s of SIDES) { const win = c.walls[s].ops.some((o) => o.t === 'win'); for (const [a, b] of solid(c, s, 0, dp.h)) for (const t of steps(a + dp.w / 2, b - dp.w / 2)) cands.push({ score: win ? 1 : 0, its: [onWall(c, dp, s, t), at(ch, ...wPt(c, s, t, LAY.gap + dp.d + 0.05 + ch.d / 2), FACE[s] + Math.PI)] }); }
  put1(c, cands, 'ажлын ширээ');
  progShelves(c, 1);
}
function progShelves(c, n) {
  for (let i = 0; i < n; i++) { const p = proto(P(0.9, 0.3, 1.9, () => shelfUnit(0.9, 1.9, 0.3)), 'тавиур', { grp: 'shelf' + i }), cands = []; for (const s of SIDES) { const W = c.walls[s]; for (const [a, b] of solid(c, s, 0, p.h)) for (const t of steps(a + p.w / 2, b - p.w / 2)) cands.push({ score: Math.min(t - p.w / 2 - W.a0, W.a1 - t - p.w / 2) < 0.03 ? 1 : 0, its: [onWall(c, p, s, t)] }); } put1(c, cands, 'тавиур'); }
}
// Загварууд + байрлал ЗАЛХУУ: тавилга анх асаахад (эсвэл ?furn=1, листингийн зураг өлгөх үед) л ачаалж тооцно — унтраалттай үед гадаах нислэг/аялалд main thread хөндөгдөхгүй
const MODEL_LIST = ['modern_wooden_cabinet', 'modern_coffee_table_01', 'modern_arm_chair_01', 'ceramic_vase_01', 'wall_clock', 'hanging_picture_frame_01', 'modern_ceiling_lamp_01'];
let furP = null; const layP = {};
const loadFur = () => (furP ||= Promise.all(MODEL_LIST.map(async (n) => { FUR[n] = await loadModel(n); })).then(() => {
  // Жаазны шил: 1k jpg-д тунгалаг суваг алга → шил тунгалаг биш болж урлагийг халхалдаг байв → цэвэр тунгалаг шил
  if (FUR.hanging_picture_frame_01) FUR.hanging_picture_frame_01.traverse((o) => { if (o.isMesh && /glass/.test(o.material.name)) o.material = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, roughness: 0.05, depthWrite: false }); });
}));
const layoutRoom = (r) => (layP[r.id] ||= (async () => { await loadFur(); await brk(); try { await furnish(r); } catch (e) { console.error('furnish', r.id, e); } furnDirty = true; })());
async function ensureFurn() { for (const r of rooms) await layoutRoom(r); furnReady = true; }
async function furnish(r) {
  const c = roomCtx(r), g = new THREE.Group(), T = r.type; let ms = 0, mx = 0, t0 = performance.now(); roomLay[r.id] = c;
  c.tick = async () => { const d = performance.now() - t0; ms += d; mx = Math.max(mx, d); await brk(); t0 = performance.now(); }; // тооцооны цэвэр хугацаа (амсхийлтгүй) + хамгийн урт тасралтгүй хэсэг
  if (T === 'living') await progLiving(c); else if (T === 'bedroom') await progBedroom(c); else if (T === 'kitchen') { const k = progKitchen(c, SIDES); await c.tick(); await progDining(c, k, null); } else if (T === 'bath') progBath(c);
  else if (T === 'hall') progHall(c); else if (T === 'office') progOffice(c); else if (T === 'other') progShelves(c, 2); else if (T === 'balcony') progBalcony(c);
  // «Тохижуулах» дараалал: хивс → том эд зүйлс (талбайгаар) → ханын/жижиг чимэглэл
  const rank = (it) => (it.under ? 0 : it.floor ? 1 : 2);
  for (const it of c.items.filter((o) => o.obj).sort((p, q) => rank(p) - rank(q) || (rank(p) === 1 ? q.w * q.d - p.w * p.d : 0))) g.add(it.obj);
  await c.tick(); furnGroup.add(g); roomFurn[r.id] = g; c.ms = Math.round(ms); c.mx = Math.round(mx); // байрлал тооцох хугацаа (debug)
}
// Debug (?debug=top): өрөөний бүсүүд — хаалганы чөлөө (улаан), цонхны бүс (цэнхэр), урд чөлөө (шар), эд зүйлс (ногоон)
function dbgRects(c) {
  const g = new THREE.Group(), add = (rc, col, y) => { const p = [[rc.x0, rc.z0], [rc.x1, rc.z0], [rc.x1, rc.z1], [rc.x0, rc.z1]], v = []; for (let i = 0; i < 4; i++) v.push(p[i][0], y, p[i][1], p[(i + 1) % 4][0], y, p[(i + 1) % 4][1]); const ge = new THREE.BufferGeometry(); ge.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); const l = new THREE.LineSegments(ge, new THREE.LineBasicMaterial({ color: col, depthTest: false, transparent: true })); l.renderOrder = 999; g.add(l); };
  for (const z of c.zones) add(z, 0xef4444, 2.4); for (const w of c.wins) add(w, 0x3b82f6, 2.41);
  for (const it of c.items) { if (!it.obj) continue; add(it.rect, it.wall ? 0x065f46 : it.under ? 0xa3a3a3 : 0x22c55e, 2.42); for (const k of it.keep) add(k, 0xf59e0b, 2.43); }
  return g;
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
function stageRoom(id, d0 = 1.2) {
  const g = roomFurn[id]; if (!g || !furnGroup.visible) return; // тавилга унтраалттай бол юу ч хийхгүй
  if (staging) stagingReset(); // өмнөх анимаци дуусаагүй бол эд зүйлсийг бүрэн харагдуулна (нуугдмал/жижиг үлдэхгүй)
  const items = g.children.map((obj, i) => { obj.userData.s = obj.scale.x || 1; obj.visible = false; return { obj, t0: d0 + i * 0.45 }; });
  staging = { items, t: 0 };
}
// Тавилга анхдагчаар УНТРААЛТТАЙ — хэрэглэгч «Тавилга» товчоор асаана (?furn=1 бол эхнээсээ асаалттай). Анх асаахад байрлал тооцогдоно («Байрлуулж…»)
async function setFurn(on) {
  furnWant = on; $('#bFurn').classList.toggle('on', on);
  // Анх асаахад: байрлал тооцоод шэйдерүүдийг зэрэгцээ (compileAsync) компиляцлана — тавилга нуугдмал хэвээр тул main thread гацахгүй
  if (on && !furnReady) { const b = $('#bFurn'), lb = b.lastChild, t = lb.textContent; lb.textContent = 'Байрлуулж…'; b.disabled = true; try { await ensureFurn(); if (renderer && renderer.compileAsync && renderer.extensions.has('KHR_parallel_shader_compile')) { furnGroup.visible = true; const p = renderer.compileAsync(scene, camera).catch(() => {}); furnGroup.visible = false; await p; } } finally { lb.textContent = t; b.disabled = false; } if (!furnWant) return; }
  furnGroup.visible = on; stagingReset(); furnDirty = true; // furnDirty: шэйдер компиляц + сүүдэр дараагийн frame-д
  // «тохижуулах» анимаци зөвхөн автомат аялалд камер тухайн өрөөний зогсоол дээр зогсож байхад; явж байхад/чөлөөт горимд шууд харагдана (давхар pop-in гаргахгүй)
  const p = tourPts[tourI]; if (on && mode === 'auto' && SCENE_MODE === 'interior' && !panoActive && phase === 'walk' && p && p.pause && pauseT > 0 && Math.hypot(p.x - cam.x, p.z - cam.z) < 0.05) stageRoom(p.room, 0.2);
  if (renderer) renderer.shadowMap.needsUpdate = true; // сүүдэр статик (autoUpdate=false) — асаах/унтраахад шинэчилнэ
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
function stagingReset() { staging = null; for (const g of Object.values(roomFurn)) for (const o of g.children) { o.visible = true; if (o.userData.s) o.scale.setScalar(o.userData.s); if (o.userData.y != null) o.position.y = o.userData.y; } if (renderer) renderer.shadowMap.needsUpdate = true; }
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
  if (p.pause && pauseT > 0) { pauseT -= dt; sweep += dt; cam.yaw = p.yaw0 + Math.sin(sweep * 0.55) * 1.25; cam.pitch += (-0.04 - cam.pitch) * 0.04; if (pauseT <= 0) { tourI = (tourI + 1) % tourPts.length; if (tourI === 0 && EXT) { const oh = EXT.segs.find((q) => q.kind === 'orbitHome'); goExterior(oh ? oh.t0 : 0); return; } if (tourI === 0 && extNodes.length) { phase = 'ext'; extI = 0; extT = 0; fadeTo(() => showPano(extNodes[0], true)); } } return; }
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
  c.addEventListener('pointermove', (e) => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY }; if (SCENE_MODE === 'exterior' && EXT) { if (Math.abs(dx) + Math.abs(dy) > 1) { EXT.drag(dx, dy); markModeButtons(); } return; } if (mode === 'auto' && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) setMode('free'); cam.yaw -= dx * 0.004; cam.pitch = Math.max(-1.2, Math.min(1.2, cam.pitch - dy * 0.003)); });
  c.addEventListener('pointerup', () => { drag = null; }); c.addEventListener('pointercancel', () => { drag = null; });
  const keyOf = (e) => (e.key.length === 1 ? e.key.toLowerCase() : e.key);
  window.addEventListener('keydown', (e) => { const k = keyOf(e); keys[k] = true; if (['w', 'a', 's', 'd', 'q', 'e', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) { if (SCENE_MODE === 'exterior' && EXT) { EXT.setFree(true); markModeButtons(); } else setMode('free'); e.preventDefault(); } });
  window.addEventListener('keyup', (e) => { keys[keyOf(e)] = false; });
  document.querySelectorAll('.pad button').forEach((b) => { const k = b.dataset.k; const on = (e) => { e.preventDefault(); keys[k] = true; setMode('free'); }; const off = () => { keys[k] = false; }; b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off); });
  $('#bAuto').onclick = () => { if (SCENE_MODE === 'exterior' && EXT) { EXT.setFree(false); markModeButtons(); return; } if (panoActive) togglePano(); setMode('auto'); };
  $('#bOut').onclick = () => goExterior(0); $('#bIn').onclick = () => goInterior();
  $('#bFree').onclick = () => { if (SCENE_MODE === 'exterior' && EXT) { EXT.setFree(true); markModeButtons(); return; } if (panoActive && panoMesh.userData.exterior) hidePano(false); setMode('free'); };
  $('#bFurn').onclick = () => setFurn(!furnWant);
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
    // Байрлал тавилгын хөдөлгүүрээр (wallDeco): тухайн өрөөний байрлал тооцогдсоны дараа ТВ/шүүгээ/орны зураг/дээд шүүгээнээс зайтай чөлөөт хананд; тавилга унтраалттай ч харагдана
    texLoader.load(assetUrl(a.id), async (t) => {
      t.colorSpace = THREE.SRGBColorSpace; const ar = t.image.width / t.image.height; if (ar > 1.9) return;
      const w = 0.9, h = w / ar, fh = h + 0.08, g = new THREE.Group(), m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 })), fr = box(w + 0.08, fh, 0.03, mats.dark);
      fr.position.set(0, fh / 2, 0.015); m.position.set(0, fh / 2, 0.031); g.add(fr, m);
      await layoutRoom(r); const c = roomLay[r.id]; if (!c) return;
      const res = wallDeco(c, proto(P(w + 0.08, 0.035, fh, () => g), 'зураг (листинг)', { grp: 'photo', wall: true, deco: true, y0: Math.max(0.95, 1.55 - fh / 2) }));
      if (res) { scene.add(res[0].obj); if (renderer) renderer.shadowMap.needsUpdate = true; }
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

// ---------- Гадаа ↔ дотор ----------
function markModeButtons() {
  const auto = SCENE_MODE === 'exterior' ? !!(EXT && !EXT.free) : mode === 'auto';
  $('#bAuto').classList.toggle('on', auto); $('#bFree').classList.toggle('on', !auto);
  $('#bOut').classList.toggle('on', SCENE_MODE === 'exterior'); $('#bIn').classList.toggle('on', SCENE_MODE === 'interior');
}
function showInteriorHud(on) { for (const q of ['.room', '.help']) { const el = $(q); if (el) el.style.display = on ? '' : 'none'; } $('#bFurn').style.display = on ? '' : 'none'; }
function goExterior(at = 0) {
  if (!EXT) return;
  fadeTo(() => { SCENE_MODE = 'exterior'; if (panoActive) hidePano(true); EXT.setVisible(true); showInteriorHud(false); EXT.start(at); markModeButtons(); });
}
// Орцны хаалганаас 0.7 м дотор, өрөөний хамгийн урт чөлөөтэй чиглэл рүү харна (ханыг ширтэхгүй)
function entryPose() {
  const e = byId[plan.entry] || rooms[0]; cam.x = e.x + e.w / 2; cam.z = e.y + e.h / 2;
  const ent = plan.doors.find((d) => d.b === 'out'); if (!ent) return;
  const mx = (ent.x1 + ent.x2) / 2, mz = (ent.y1 + ent.y2) / 2; const r = byId[ent.a] || e;
  let ix = r.x + r.w / 2 - mx, iz = r.y + r.h / 2 - mz; if (Math.abs(ent.x1 - ent.x2) > Math.abs(ent.y1 - ent.y2)) ix = 0; else iz = 0; const il = Math.hypot(ix, iz) || 1;
  cam.x = mx + (ix / il) * 0.7; cam.z = mz + (iz / il) * 0.7;
  const dirs = [['S', 0, 1, 0], ['N', 0, -1, Math.PI], ['W', -1, 0, -Math.PI / 2], ['E', 1, 0, Math.PI / 2]]; let best = null;
  for (const [, dx, dz, yaw] of dirs) {
    if (dx * ix + dz * iz < -0.01) continue; // хаалга руу биш
    const free = dx > 0 ? r.x + r.w - cam.x : dx < 0 ? cam.x - r.x : dz > 0 ? r.y + r.h - cam.z : cam.z - r.y;
    const doors = plan.doors.filter((d) => d.b !== 'out' && (d.a === r.id || d.b === r.id) && ((d.x1 + d.x2) / 2 - cam.x) * dx + ((d.y1 + d.y2) / 2 - cam.z) * dz > 0.3).length;
    const score = free + doors * 0.8; if (!best || score > best.score) best = { score, yaw };
  }
  if (best) cam.yaw = best.yaw;
}
function goInterior() {
  fadeTo(() => {
    SCENE_MODE = 'interior'; if (EXT) EXT.setVisible(false); showInteriorHud(true);
    entryPose();
    tourI = 0; pauseT = 2.5; sweep = 0; phase = 'walk'; if (tourPts[0]) tourPts[0].yaw0 = cam.yaw; setMode('auto'); markModeButtons();
  });
}

// ---------- Debug (?debug=top): өрөөг дээрээс ортографик харах — тавилга асаалттай, тааз нуугдана, бүсүүд зурагдана ----------
let topCam = null, topDbg = null;
function topView(id) {
  const r = byId[id]; if (topDbg) { scene.remove(topDbg); topDbg = null; }
  for (const q of ['.top', '#map', '.room', '.help', '.pad']) { const el = $(q); if (el) el.style.visibility = r ? 'hidden' : ''; } // зураг цэвэр харагдана
  if (!r) { topCam = null; scene.traverse((o) => { if (o.userData.ceil) o.visible = true; }); return 'off'; }
  setMode('free'); if (!furnGroup.visible) setFurn(true); stagingReset(); scene.traverse((o) => { if (o.userData.ceil) o.visible = false; }); // тааз + таазны гэрэл (stagingReset-ийн дараа)
  const asp = innerWidth / innerHeight, m = 0.3; let w = r.w + 2 * m, h = r.h + 2 * m; if (w / h < asp) w = h * asp; else h = w / asp;
  topCam = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.1, 30); topCam.position.set(r.x + r.w / 2, 12, r.y + r.h / 2); topCam.up.set(0, 0, -1); topCam.lookAt(r.x + r.w / 2, 0, r.y + r.h / 2);
  cam.x = r.x + r.w / 2; cam.z = r.y + r.h / 2; for (const l of roomLights) l.visible = Math.hypot(l.position.x - cam.x, l.position.z - cam.z) < 9;
  const c = roomLay[r.id]; if (c) { topDbg = dbgRects(c); scene.add(topDbg); }
  renderer.shadowMap.needsUpdate = true; return JSON.stringify(c ? c.log : []);
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
  // near 0.05: 0.1 үед дэлгэцийн захад хана таслагдаж байсан
  scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
  // Оношилгоо: консолоос zuuchBench(20) → нэг frame-ийн дундаж мс (GPU finish-тэй), pixel ratio, draw calls
  window.zuuch = { renderer, scene, camera, roomLights, mats, THREE, cam, furnGroup, ensureFurn, setFurn };
  window.zuuchBench = (n = 20) => { const gl = renderer.getContext(); renderer.render(scene, camera); gl.finish(); const t = performance.now(); for (let i = 0; i < n; i++) { camera.position.set(cam.x, EYE, cam.z); renderer.render(scene, camera); } gl.finish(); const ms = (performance.now() - t) / n; return { frameMs: Math.round(ms * 10) / 10, estFps: Math.round(1000 / ms), pixelRatio: renderer.getPixelRatio(), calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, lights: roomLights.filter((l) => l.visible).length }; };
  const pmrem = new THREE.PMREMGenerator(renderer); scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.45;
  initMats(); outdoors(); scene.add(furnGroup);
  const furn0 = new URLSearchParams(location.search).get('furn') === '1'; furnWant = furnGroup.visible = furn0; $('#bFurn').classList.toggle('on', furn0); // тавилга анхдагчаар унтраалттай
  for (const r of rooms) scene.add(buildRoom(r));
  if (furn0) ensureFurn(); // ?furn=1: ачааллын дэлгэцийн ард байрлуулна; унтраалттай бол огт тооцохгүй (анх асаахад л)
  hangPhotos();
  if (Object.values(assetsByType).flat().length) $('#bPhotos').disabled = false;
  $('#bPhotos').onclick = showPhotos; $('#bClosePhotos').onclick = () => { $('#photos').style.display = 'none'; }; $('#bPano').onclick = togglePano;
  entryPose();
  tourPts = buildTour(); tourI = 0; pauseT = 2.5; sweep = 0; if (tourPts[0]) tourPts[0].yaw0 = cam.yaw;
  if (data.exterior && Array.isArray(data.exterior.buildings)) {
    $('#load').lastElementChild.textContent = 'Гадаах орчныг бүтээж байна…'; await new Promise((r) => setTimeout(r, 30));
    try { EXT = createExterior(data.exterior, { title: $('#title').textContent, keys, onDone: () => goInterior() }); window.zuuch.ext = EXT; $('#bOut').style.display = ''; $('#bIn').style.display = ''; }
    catch (err) { console.error('exterior', err); EXT = null; }
  }
  const q = new URLSearchParams(location.search); const sr = byId[q.get('start')];
  if (EXT && !sr && q.get('in') !== '1') { SCENE_MODE = 'exterior'; EXT.setVisible(true); showInteriorHud(false); EXT.start(Number(q.get('at')) || 0); } else if (EXT) EXT.setVisible(false);
  if (sr) { enterRoom(sr); if (q.get('yaw')) cam.yaw = Number(q.get('yaw')); setMode('free'); }
  if (q.get('debug') === 'top') { window.zuuch.topView = async (id) => { await ensureFurn(); return topView(id); }; window.zuuch.layout = async () => { await ensureFurn(); return Object.fromEntries(Object.entries(roomLay).map(([k, c]) => [k, [...c.log, { ms: c.ms, mx: c.mx }]])); }; window.zuuch.dbg = { roomLay, wallDeco, proto, P }; }
  bindControls();
  const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); if (EXT) { EXT.camera.aspect = innerWidth / innerHeight; EXT.camera.updateProjectionMatrix(); } }; addEventListener('resize', resize); resize();
  // Тавилга асаалттай (?furn=1) бол загвар ачаалж байрлуулахыг (≤8с) хүлээнэ; унтраалттай бол огт хүлээхгүй
  const t0 = Date.now(); while (((furn0 && !furnReady) || texDone < texPending) && Date.now() - t0 < 8000) { $('#load').lastElementChild.textContent = furn0 && !furnReady ? (loadedN < pending ? `Тавилга ачаалж байна… ${loadedN}/${pending}` : 'Тавилга байрлуулж байна…') : 'Текстур ачаалж байна…'; await new Promise((r) => setTimeout(r, 120)); }
  // Шэйдерүүдийг урьдчилан компиляц — тавилга гарч ирэх/өрөө солигдох мөчид гацахгүй (бенчмарк: эхний frame 62 мс, дараа нь 2 мс)
  // Тавилга унтраалттай бол түүнийг компиляцад хамруулахгүй — асаахад (furnDirty) нэг удаа компиляц хийгдэнэ
  const compileAll = () => { try { renderer.compile(scene, camera); } catch { /* зарим GPU-д алгасна */ } };
  compileAll(); try { if (EXT) renderer.compile(EXT.scene, EXT.camera); } catch { /* зарим GPU-д алгасна */ }
  markModeButtons();
  $('#load').style.display = 'none';
  let last = performance.now(), mapT = 1, frameN = 0, shadowLoaded = -1, fpsAcc = 0, fpsN = 0; // эхний frame-д минимап зурагдана
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (SCENE_MODE === 'exterior' && EXT) {
      EXT.update(dt); mapT += dt; if (mapT > 0.1) { mapT = 0; EXT.drawMap($('#map').getContext('2d'), 440, 340); }
      fpsAcc += dt; fpsN++;
      if (fpsAcc >= 2) { const fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; const pr = renderer.getPixelRatio(); if (fps < 28 && pr > 0.6) renderer.setPixelRatio(Math.max(0.6, pr - 0.15)); else if (fps > 55 && pr < Math.min(devicePixelRatio, 1.25)) renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25, pr + 0.1)); if (renderer.getPixelRatio() !== pr) renderer.setSize(innerWidth, innerHeight, false); }
      renderer.render(EXT.scene, EXT.camera); requestAnimationFrame(frame); return;
    }
    if (mode === 'auto') stepAuto(dt); else if (!panoActive) stepFree(dt);
    stepStaging(dt);
    camera.position.set(cam.x, EYE, cam.z); camera.rotation.set(0, 0, 0, 'YXZ'); camera.rotation.y = cam.yaw; camera.rotation.x = cam.pitch;
    const r = roomAt(cam.x, cam.z); const id = r ? r.id : null;
    const extShown = panoActive && panoMesh && panoMesh.userData.exterior;
    if (id !== curRoomId && !extShown) { curRoomId = id; $('#rName').textContent = r ? r.name : '—'; $('#rArea').textContent = r ? `${(r.w * r.h).toFixed(1)} м² · ${r.w} × ${r.h} м` : ''; $('#bPano').style.display = (r && panoByRoom[r.id]) || panoActive ? '' : 'none'; }
    mapT += dt; if (mapT > 0.08) { mapT = 0; drawMap(); }
    // Сүүдэр: сцен статик — зөвхөн тавилга гарч ирэх/байрлуулах/загвар ачаалагдах үед л шинэчилнэ; шэйдер компиляц зөвхөн тавилга харагдаж байхад (furnDirty)
    if (staging || furnDirty || loadedN !== shadowLoaded || frameN < 30) { renderer.shadowMap.needsUpdate = true; if (furnDirty && furnGroup.visible) compileAll(); shadowLoaded = loadedN; furnDirty = false; } frameN++;
    // Гэрлийн хасалт: 9 м-ээс хол өрөөний цэгэн гэрлийг унтраана (fragment бүр бүх гэрлийг тооцдог)
    if (frameN % 10 === 0) for (const l of roomLights) l.visible = Math.hypot(l.position.x - cam.x, l.position.z - cam.z) < 9;
    // Адаптив нягтрал: FPS < 28 бол pixel ratio-г бууруулна (доод 0.7), > 55 бол өсгөнө (дээд 1.25)
    fpsAcc += dt; fpsN++; if (fpsAcc >= 2) { const fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; const pr = renderer.getPixelRatio(); if (fps < 28 && pr > 0.7) renderer.setPixelRatio(Math.max(0.7, pr - 0.15)); else if (fps > 55 && pr < Math.min(devicePixelRatio, 1.25)) renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25, pr + 0.1)); if (renderer.getPixelRatio() !== pr) renderer.setSize(innerWidth, innerHeight, false); }
    renderer.render(scene, topCam || camera); requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
main().catch((e) => { console.error(e); $('#load').textContent = 'Алдаа: ' + e.message; });
