// «Зууч» — Virtual POV Tour үзэгч (three.js): серверийн планаар 3D орчин, бодит CC0 glTF тавилга (Poly Haven), PBR текстур, 360° панорам
import * as THREE from 'three';
import { GLTFLoader } from '/vendor/GLTFLoader.js';
import { RoundedBoxGeometry } from '/vendor/RoundedBoxGeometry.js';
import { RoomEnvironment } from '/vendor/RoomEnvironment.js';
import { mergeGeometries } from '/vendor/BufferGeometryUtils.js';
import { EffectComposer } from '/vendor/EffectComposer.js';
import { RenderPass } from '/vendor/RenderPass.js';
import { UnrealBloomPass } from '/vendor/UnrealBloomPass.js';
import { OutputPass } from '/vendor/OutputPass.js';
import { createExterior } from '/tour-ext.js';
import { createMedia } from '/tour-media.js';

const $ = (s) => document.querySelector(s);
const token = location.pathname.split('/').filter(Boolean).pop();
const EYE = 1.4, WALL_T = 0.12, HFOV = 92; // нүдний өндөр 1.4 м (интерьер рендерийн стандарт), хэвтээ харах өнцөг 92° (өргөн өнцөг, босоо шугам босоо)
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


let data, plan, scene, camera, renderer, rooms = [], byId = {}, doorGraph = {};
let EXT = null, SCENE_MODE = 'interior'; // гадаах орчны 3D нислэг (Ш3д-3), байрны дотор, 'walk' (бодит алхалтын бичлэг), 'splat' (бодит 3D өрөө)
let MEDIA = null; // бодит медиа (tour-media.js)
const mats = {};
const furnGroup = new THREE.Group();
// Плита: хэмжээ sx × sy м, заадас (grout) нарийн; world-UV-д 1 давталт = 1 плита
const texTile = (base = '#eeece8', sx = 0.6, sy = 0.6, grout = 'rgba(90,80,70,.28)', gloss = 0) => canvasTex((g, s) => {
  const h = Math.round(s * sy / sx); g.canvas.height = h; g.fillStyle = base; g.fillRect(0, 0, s, h);
  const R = rng(sx * 1000 + sy * 7), n = 900; for (let i = 0; i < n; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '255,255,255' : '120,105,90'},${0.025 + R() * 0.03})`; g.fillRect(R() * s, R() * h, 2 + R() * 6, 2 + R() * 6); } // зөөлөн толбо (цул биш)
  if (gloss) { const gr = g.createLinearGradient(0, 0, s, h); gr.addColorStop(0, 'rgba(255,255,255,.10)'); gr.addColorStop(1, 'rgba(0,0,0,.05)'); g.fillStyle = gr; g.fillRect(0, 0, s, h); }
  g.strokeStyle = grout; g.lineWidth = 3; g.strokeRect(1.5, 1.5, s - 3, h - 3);
}, 256);
// Детерминист санамсаргүй (mulberry32) — хэвийн хоёр захад таарах банз ижил өнгөтэй (заадас үүсэхгүй)
const rng = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
// Ёлочка паркет (herringbone, процедур): 9 × 54 см зүсмэл, зөгийн бал царс; хэвийг тэнхлэгтэй зурж 45° эргүүлнэ — 1 давталт 12 × 9 см = 1.08 м (МОНГОЛ байранд гантиг биш — паркет/ламинат)
const texHerring = () => canvasTex((g, s) => {
  const n = 6, P = 2 * n, u = s / P; g.fillStyle = '#5b3f26'; g.fillRect(0, 0, s, s);
  const plank = (x, y, w, h, vert, key) => {
    const R = rng(key * 7919 + 13), l = 0.84 + R() * 0.24, hu = R() * 12 - 6; g.fillStyle = `rgb(${Math.round((196 + hu) * l)},${Math.round(148 * l)},${Math.round((98 - hu) * l)})`; g.fillRect(x + 0.9, y + 0.9, w - 1.8, h - 1.8);
    for (let k = 0; k < 10; k++) { g.strokeStyle = `rgba(92,58,28,${0.05 + R() * 0.1})`; g.lineWidth = 0.5 + R() * 1.2; g.beginPath(); const wv = (R() - 0.5) * 3; if (vert) { const gx = x + 2 + R() * (w - 4); g.moveTo(gx, y + 1); g.bezierCurveTo(gx + wv, y + h / 3, gx - wv, y + 2 * h / 3, gx + wv / 2, y + h - 1); } else { const gy = y + 2 + R() * (h - 4); g.moveTo(x + 1, gy); g.bezierCurveTo(x + w / 3, gy + wv, x + 2 * w / 3, gy - wv, x + w - 1, gy + wv / 2); } g.stroke(); }
    const gr = vert ? g.createLinearGradient(x, 0, x + w, 0) : g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, 'rgba(255,238,215,.12)'); gr.addColorStop(0.5, 'rgba(255,238,215,0)'); gr.addColorStop(1, 'rgba(55,32,14,.12)'); g.fillStyle = gr; g.fillRect(x + 0.9, y + 0.9, w - 1.8, h - 1.8); // зөөлөн фаск
  };
  for (let a = -n - 2; a <= P + 2; a++) for (let b = -2; b <= 2; b++) { // тор t1=(1,1), t2=(n,−n): хэвтээ банз [0,n]×[0,1], босоо [0,1]×[1,1+n]; key = үелэх торын анги
    const X = (a + b * n) * u, Y = (a - b * n) * u, key = (((a - b * n) % P) + P) % P; plank(X, Y, n * u, u, false, key * 2); plank(X, Y + u, u, n * u, true, key * 2 + 1);
  }
}, 1024);
// Модон өнгөлгөө (veneer): босоо ширхэг — тавилга, ханын банз (fluted)
const texVeneer = (base = [196, 150, 104]) => canvasTex((g, s) => {
  g.fillStyle = `rgb(${base.join(',')})`; g.fillRect(0, 0, s, s); const R = rng(base[0] * 31 + base[2]);
  for (let k = 0; k < 140; k++) { const x = R() * s, wv = (R() - 0.5) * 10; g.strokeStyle = `rgba(${R() < 0.7 ? '80,50,25' : '255,235,200'},${0.04 + R() * 0.08})`; g.lineWidth = 0.6 + R() * 2.2; g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + wv, s / 3, x - wv, 2 * s / 3, x, s); g.stroke(); }
}, 256);
// Шугаман (NoColorSpace) гэрлийн маск текстурууд: хананы «хясаа» (scallop), градиент тууз, зөөлөн сүүдэр
function maskTex(W, H, f) { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'), im = g.createImageData(W, H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = Math.max(0, Math.min(1, f((x + 0.5) / W, (y + 0.5) / H))) * 255, k = (y * W + x) * 4; im.data[k] = im.data[k + 1] = im.data[k + 2] = v; im.data[k + 3] = 255; } g.putImageData(im, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t; }
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const texScallop = () => maskTex(128, 256, (x, y) => { const u = Math.abs(x * 2 - 1), d = y - 0.04; if (d <= 0) return 0; const hw = Math.min(1, 0.12 + 0.95 * Math.sqrt(d / 0.7)); return sstep(hw, hw * 0.5, u) * Math.exp(-d * 2.3) * sstep(0, 0.06, d) * Math.sqrt(Math.max(0, 1 - y)) + 0.55 * Math.exp(-((d - 0.07) ** 2) / 0.003 - (u * u) / 0.04); }); // канвасын дээд мөр (UV v=1) = гэрэл, доош сарнина
const texGlow = () => maskTex(4, 128, (x, y) => { const v = 1 - y; return Math.exp(-v * 3.4) * (1 - v) + 0.35 * Math.exp(-v * 18); }); // v=0 (y=1 дээд зах) хамгийн тод
const texBlob = () => maskTex(64, 64, (x, y) => { const px = Math.abs(x * 2 - 1), py = Math.abs(y * 2 - 1), d = Math.hypot(Math.max(0, px - 0.5), Math.max(0, py - 0.5)) / 0.5; return Math.pow(Math.max(0, 1 - d), 1.6) * 0.95; });
const texHalo = () => maskTex(64, 64, (x, y) => { const d = Math.hypot(x * 2 - 1, y * 2 - 1); return Math.pow(Math.max(0, 1 - d), 2.2); });
function initMats() {
  const herr = texHerring(); herr.repeat.set(1 / 1.08, 1 / 1.08); herr.rotation = Math.PI / 4; herr.anisotropy = 8; // world-UV (м) дээр 45° ёлочка
  const hn = tex('/textures/wood_nor.jpg', [1 / 1.2, 1 / 1.2], false); hn.rotation = Math.PI / 4;
  mats.floorWood = new THREE.MeshStandardMaterial({ map: herr, roughness: 0.4, normalMap: hn, normalScale: new THREE.Vector2(0.22, 0.22), envMapIntensity: 1.25 }); // сатин лак: зөөлөн тусгал
  mats.wall = () => new THREE.MeshStandardMaterial({ color: 0xece5da, roughness: 0.93 }); // гөлгөр будаг (дулаан цагаан/greige) — судалтай ханын цаас биш
  mats.wood = mats.oakV = new THREE.MeshStandardMaterial({ map: texVeneer(), roughness: 0.55 }); // цайвар царс өнгөлгөө
  mats.walnut = new THREE.MeshStandardMaterial({ map: texVeneer([128, 88, 58]), roughness: 0.5 });
  mats.fabricNor = tex('/textures/fabric_nor.jpg', [3, 3], false); mats.fabricRough = tex('/textures/fabric_rough.jpg', [3, 3], false);
  mats.quartz = new THREE.MeshStandardMaterial({ color: 0xefebe4, roughness: 0.28 }); // кварц тавцан (гантиг биш)
  mats.cab = new THREE.MeshStandardMaterial({ color: 0xd3c9bc, roughness: 0.6 }); mats.cabUp = new THREE.MeshStandardMaterial({ color: 0xf1ede6, roughness: 0.55 }); // гал тогоо: кашемир доод, цагаан дээд
  mats.backsplash = new THREE.MeshStandardMaterial({ map: texTile('#f3efe8', 0.3, 0.075, 'rgba(120,110,95,.35)', 1), roughness: 0.18 }); // гялгар «subway» плита
  mats.bathFloor = new THREE.MeshStandardMaterial({ map: texTile('#b9afa4', 0.6, 0.6, 'rgba(70,60,50,.3)'), roughness: 0.35 });
  mats.tile = new THREE.MeshStandardMaterial({ map: texTile('#d8d1c6', 0.6, 0.6, 'rgba(80,70,60,.3)'), roughness: 0.32 }); for (const m of [mats.bathFloor, mats.tile]) m.map.repeat.set(1 / 0.6, 1 / 0.6); // шал world-UV (м)
  mats.carpet = new THREE.MeshStandardMaterial({ color: 0xb9b2a6, roughness: 1, normalMap: mats.fabricNor });
  mats.bathWall = new THREE.MeshStandardMaterial({ map: texTile('#ebe5dc', 0.3, 0.6, 'rgba(120,108,95,.3)', 1), roughness: 0.2 }); // том хэмжээний дулаан шаргал плита (цэнхэр тууз хасав)
  mats.bathAccent = new THREE.MeshStandardMaterial({ map: texTile('#8a7b6d', 0.3, 0.6, 'rgba(50,42,35,.35)', 1), roughness: 0.25 });
  mats.plinth = new THREE.MeshStandardMaterial({ color: 0xf4f1ec, roughness: 0.5 });
  mats.ceil = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, emissive: 0xfff1e2, emissiveIntensity: 0.1 }); // сул ойлт (bounce) — тааз саарал биш
  // Гэрлийн эх үүсвэрүүд (HDR > 1 → bloom): LED тууз 2700K, суулгасан спот, унжлага
  const warm = (k) => new THREE.Color(0xffc68a).multiplyScalar(k);
  mats.led = new THREE.MeshBasicMaterial({ color: warm(3.2) }); mats.dl = new THREE.MeshBasicMaterial({ color: warm(7) }); mats.bulb = new THREE.MeshBasicMaterial({ color: warm(5) });
  mats.opal = new THREE.MeshStandardMaterial({ color: 0xfff6ea, emissive: 0xffd7a8, emissiveIntensity: 2.2, roughness: 0.4 }); // сүүн шил бөмбөлөг
  const add = (map, k, op = 1) => new THREE.MeshBasicMaterial({ map, color: warm(k), transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  mats.scallop = add(texScallop(), 0.34); mats.glow = add(texGlow(), 0.55); mats.halo = add(texHalo(), 0.9); mats.haloRect = add(texBlob(), 0.6);
  for (const m of [mats.scallop, mats.glow, mats.halo, mats.haloRect]) m.side = THREE.DoubleSide;
  mats.blob = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: texBlob(), transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }); // тавилгын доорх зөөлөн сүүдэр (contact shadow)
  mats.oak = new THREE.MeshStandardMaterial({ map: texVeneer([214, 176, 132]), roughness: 0.6 });
  mats.headboard = new THREE.MeshStandardMaterial({ color: 0xcdbfae, roughness: 1, normalMap: mats.fabricNor, roughnessMap: mats.fabricRough });
  mats.uph = new THREE.MeshStandardMaterial({ color: 0x8c8375, roughness: 1, normalMap: mats.fabricNor, roughnessMap: mats.fabricRough }); // зөөлөвчтэй ханын хавтан (bed2)
  // Шил: transmission сценийг 2 дахин рендерлэдэг (FPS унадаг) → энгийн тунгалаг материал
  mats.glass = new THREE.MeshStandardMaterial({ color: 0xdff0ff, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false });
  mats.frame = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5 });
  mats.door = new THREE.MeshStandardMaterial({ color: 0x3a3b3e, roughness: 0.45, metalness: 0.35 }); // орцны ган хаалга (графит)
  mats.dark = new THREE.MeshStandardMaterial({ color: 0x1d1d20, roughness: 0.4, metalness: 0.2 }); mats.black = new THREE.MeshStandardMaterial({ color: 0x19191b, roughness: 0.5, metalness: 0.4 }); mats.blackDS = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.45, metalness: 0.5, side: THREE.DoubleSide });
  mats.coatA = new THREE.MeshStandardMaterial({ color: 0xa4835e, roughness: 1, normalMap: mats.fabricNor }); mats.coatB = new THREE.MeshStandardMaterial({ color: 0x3a3b3f, roughness: 1, normalMap: mats.fabricNor }); // өвлийн хүрэм
  mats.brass = new THREE.MeshStandardMaterial({ color: 0xc7a064, roughness: 0.32, metalness: 1 });
  mats.screen = new THREE.MeshPhysicalMaterial({ color: 0x0b1020, roughness: 0.08, metalness: 0.3, clearcoat: 1 });
  mats.white = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.15, clearcoat: 0.8, clearcoatRoughness: 0.1 });
  mats.linen = new THREE.MeshStandardMaterial({ color: 0xf1f0ec, roughness: 1, normalMap: mats.fabricNor, roughnessMap: mats.fabricRough });
  mats.duvet = new THREE.MeshStandardMaterial({ color: 0xc9bca9, roughness: 1, normalMap: mats.fabricNor, roughnessMap: mats.fabricRough }); mats.duvet2 = new THREE.MeshStandardMaterial({ color: 0x8e9a8c, roughness: 1, normalMap: mats.fabricNor, roughnessMap: mats.fabricRough });
  mats.curtain = new THREE.MeshStandardMaterial({ color: 0xf0ebe2, roughness: 1, side: THREE.DoubleSide, normalMap: mats.fabricNor, normalScale: new THREE.Vector2(0.4, 0.4) }); // маалинган хөшиг
  mats.rug = new THREE.MeshStandardMaterial({ color: 0xd9d1c4, roughness: 1, normalMap: mats.fabricNor }); mats.rug2 = new THREE.MeshStandardMaterial({ color: 0xb7aa98, roughness: 1, normalMap: mats.fabricNor });
  mats.steel = new THREE.MeshStandardMaterial({ color: 0xcfd4da, roughness: 0.25, metalness: 0.9 });
  mats.mirror = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.04, metalness: 1, envMap: scene.environment, envMapIntensity: 1 }); // толь: орчныг бүрэн тусгана
  mats.tWood = new THREE.MeshStandardMaterial({ map: texVeneer([150, 106, 70]), roughness: 0.5 }); // хоолны ширээ/сандал: дунд өнгийн мод
  mats.matteWhite = new THREE.MeshStandardMaterial({ color: 0xf5f3ef, roughness: 0.6 });
  mats.sofa = new THREE.MeshStandardMaterial({ color: 0xb4ab9e, roughness: 1, normalMap: mats.fabricNor, roughnessMap: mats.fabricRough }); mats.sofaCus = new THREE.MeshStandardMaterial({ color: 0xc2baad, roughness: 1, normalMap: mats.fabricNor, roughnessMap: mats.fabricRough });
  mats.pillowA = new THREE.MeshStandardMaterial({ color: 0xc58f62, roughness: 1, normalMap: mats.fabricNor }); mats.pillowB = new THREE.MeshStandardMaterial({ color: 0x6f7d69, roughness: 1, normalMap: mats.fabricNor }); mats.pillowC = new THREE.MeshStandardMaterial({ color: 0xe8e1d4, roughness: 1, normalMap: mats.fabricNor });
  mats.shade = new THREE.MeshStandardMaterial({ color: 0xf3ead9, emissive: 0xffd6a4, emissiveIntensity: 1.2, roughness: 0.9, side: THREE.DoubleSide }); mats.leaf = new THREE.MeshStandardMaterial({ color: 0x3f6b3a, roughness: 0.6 });
  mats.water = new THREE.MeshStandardMaterial({ color: 0xdfe8ee, roughness: 0.08, metalness: 0.1 }); mats.seam = new THREE.MeshStandardMaterial({ color: 0xa9a399, roughness: 0.8 });
  mats.ceramic = new THREE.MeshStandardMaterial({ color: 0xe9e3d8, roughness: 0.35 }); mats.terra = new THREE.MeshStandardMaterial({ color: 0xb8704b, roughness: 0.7 });
  mats.books = [0x7d8b77, 0xc9b79b, 0x3f4a55, 0xb46a4a, 0xe4dccd, 0x8a6f58].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }));
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
// Нэг бүлэг доторх ижил материалтай mesh-үүдийг нэг геометр болгоно (draw call ↓ — Intel UHD-д CPU саатал багасна); userData.keep бол үлдээнэ
function mergeByMat(root) {
  root.updateMatrixWorld(true); const inv = root.matrixWorld.clone().invert(), bins = new Map();
  root.traverse((o) => { if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || o.userData.keep || Array.isArray(o.material) || o.morphTargetInfluences) return; const ge = o.geometry, ks = Object.keys(ge.attributes).sort().join(); if (ks !== 'normal,position,uv' || o.matrixWorld.determinant() < 0) return; const key = `${o.material.uuid}|${!!ge.index}|${o.castShadow}${o.receiveShadow}|${o.userData.ceil ? 1 : 0}|${o.renderOrder}`; if (!bins.has(key)) bins.set(key, []); bins.get(key).push(o); });
  for (const list of bins.values()) {
    if (list.length < 2) continue; const m4 = new THREE.Matrix4(), geos = list.map((o) => o.geometry.clone().applyMatrix4(m4.multiplyMatrices(inv, o.matrixWorld)));
    const mg = mergeGeometries(geos, false); geos.forEach((q) => q.dispose()); if (!mg) continue;
    const o0 = list[0], m = new THREE.Mesh(mg, o0.material); m.castShadow = o0.castShadow; m.receiveShadow = o0.receiveShadow; m.renderOrder = o0.renderOrder; if (o0.userData.ceil) m.userData.ceil = 1;
    for (const o of list) o.parent.remove(o); root.add(m);
  }
  return root;
}
// Гэрлийн маскын дөрвөлжин(үүд) нэг mesh-д: q = [a, b, c, d] — a,b = UV v=0 зах, d,c = v=1 зах (a→d, b→c)
function quadMesh(qs, mat) {
  const p = [], u = [], ix = []; qs.forEach((q, k) => { for (const v of q) p.push(...v); u.push(0, 0, 1, 0, 1, 1, 0, 1); const o = k * 4; ix.push(o, o + 1, o + 2, o, o + 2, o + 3); });
  const ge = new THREE.BufferGeometry(); ge.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); ge.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2)); ge.setIndex(ix); ge.computeBoundingSphere();
  const m = new THREE.Mesh(ge, mat); m.userData.keep = 1; m.renderOrder = 2; return m;
}
const vLights = []; // виртуал гэрлүүд (тааз/унжлага) → тогтмол тооны PointLight санд хамгийн ойрыг ононо (гэрлийн тоо өөрчлөгдөхгүй → шэйдер дахин компиляцгүй)
function buildRoom(r) {
  const H = plan.ceiling; const g = new THREE.Group(), glows = [], scal = [], X0 = r.x + WALL_T, X1 = r.x + r.w - WALL_T, Z0 = r.y + WALL_T, Z1 = r.y + r.h - WALL_T;
  const floorKind = r.floor || (STYLE && STYLE.floor) || null; // өрөөний гар сонголт > AI > анхдагч
  const wet = r.type === 'bath' || (floorKind ? floorKind === 'tile' : r.type === 'kitchen');
  const floorMat = r.type === 'bath' ? mats.bathFloor : wet ? mats.tile : floorKind === 'carpet' ? mats.carpet : mats.floorWood; // хуваалцсан материал (world-UV) — өрөө хооронд паркет үргэлжилнэ
  const fg = new THREE.PlaneGeometry(r.w, r.h), fp = fg.attributes.position, fu = fg.attributes.uv; for (let i = 0; i < fp.count; i++) fu.setXY(i, r.x + r.w / 2 + fp.getX(i), fp.getY(i) - (r.y + r.h / 2));
  const floor = new THREE.Mesh(fg, floorMat); floor.rotation.x = -Math.PI / 2; floor.position.set(r.x + r.w / 2, 0, r.y + r.h / 2); floor.receiveShadow = true; g.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.h), mats.ceil); ceil.rotation.x = Math.PI / 2; ceil.position.set(r.x + r.w / 2, H, r.y + r.h / 2); ceil.userData.ceil = 1; g.add(ceil); // ceil: debug дээрээс харахад нуугдана
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
  // Сунадаг таазны тавиур (tray): ханын дагуу 0.42 м өргөн, 0.12 м унжсан зурвас; дотор хонхорхойн захад LED (2700K) — таазыг гэрэлтүүлсэн градиент + нарийн тод шугам
  const cove = r.w > 2 && r.h > 2 && r.type !== 'bath' && !beam && (!STYLE || STYLE.ceiling_cove !== false), bw = cove ? 0.42 : 0, bh = cove ? 0.12 : 0;
  if (cove) {
    for (const [px, pz, sx, sz] of [[r.x + r.w / 2, r.y + bw / 2, r.w, bw], [r.x + r.w / 2, r.y + r.h - bw / 2, r.w, bw], [r.x + bw / 2, r.y + r.h / 2, bw, r.h - 2 * bw], [r.x + r.w - bw / 2, r.y + r.h / 2, bw, r.h - 2 * bw]]) { const b = box(sx, bh, sz, mats.ceil); b.position.set(px, H - bh / 2, pz); b.userData.ceil = 1; g.add(b); }
    const a0 = r.x + bw, a1 = r.x + r.w - bw, c0 = r.y + bw, c1 = r.y + r.h - bw, y = H - 0.003, gw = 0.6, lw = 0.016;
    for (const [px, pz, sx, sz] of [[(a0 + a1) / 2, c0 + lw / 2 + 0.004, a1 - a0, lw], [(a0 + a1) / 2, c1 - lw / 2 - 0.004, a1 - a0, lw], [a0 + lw / 2 + 0.004, (c0 + c1) / 2, lw, c1 - c0], [a1 - lw / 2 - 0.004, (c0 + c1) / 2, lw, c1 - c0]]) { const s = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.01, sz), mats.led); s.position.set(px, H - 0.012, pz); s.userData.ceil = 1; g.add(s); }
    glows.push([[a0, y, c0], [a1, y, c0], [a1 - gw, y, c0 + gw], [a0 + gw, y, c0 + gw]], [[a1, y, c1], [a0, y, c1], [a0 + gw, y, c1 - gw], [a1 - gw, y, c1 - gw]], [[a0, y, c1], [a0, y, c0], [a0 + gw, y, c0 + gw], [a0 + gw, y, c1 - gw]], [[a1, y, c0], [a1, y, c1], [a1 - gw, y, c1 - gw], [a1 - gw, y, c0 + gw]]); // булангийн трапец — давхцалгүй
  }
  const wallMat = r.type === 'bath' ? mats.bathWall : mats.wall(), accS = r.type === 'bath' ? OPP[doorSide(r)] : null; // угаалга: хаалганы эсрэг хана бараан өргөлт плита
  if (r.type !== 'bath') { const wc = r.wallColor || (STYLE && STYLE.wall_color); if (wc) wallMat.color.set(wc); }
  const [su, sv] = r.type === 'bath' ? [0.3, 0.6] : [2.12, 2.12]; // ханын UV дэлхийн координатаар (угаалгын плита 0.3 × 0.6 м)
  const edges = [
    { side: 'N', axis: 'x', c: r.y, a: r.x, b: r.x + r.w, inward: +1 }, { side: 'S', axis: 'x', c: r.y + r.h, a: r.x, b: r.x + r.w, inward: -1 },
    { side: 'W', axis: 'y', c: r.x, a: r.y, b: r.y + r.h, inward: +1 }, { side: 'E', axis: 'y', c: r.x + r.w, a: r.y, b: r.y + r.h, inward: -1 },
  ];
  const dls = []; // суулгасан спотууд [x, z, хананы тал | null]
  for (const e of edges) {
    const ops = [], wm = e.side === accS ? mats.bathAccent : wallMat;
    for (const d of plan.doors) { if (d.a !== r.id && d.b !== r.id) continue; const o = segOnEdge(d, e); if (o) ops.push({ lo: o[0], hi: o[1], t: 'door', d }); }
    // Цонх: өөрийн өрөө + дундын ханын нөгөө талын өрөө (тагт г.м.) — тэнд ч нээлхий гарна (шилний ард хатуу хана нэг хавтгайд анивчдаг байсан)
    for (const wn of plan.windows) { const own = wn.room === r.id, ow = byId[wn.room]; if (!own && !(ow && ((e.axis === 'x' ? ow.y + ow.h / 2 : ow.x + ow.w / 2) - e.c) * e.inward < 0)) continue; const o = segOnEdge(wn, e); if (o) ops.push({ lo: o[0], hi: o[1], t: 'win', own, sill: wn.sill || WIN_LO, top: Math.max((wn.sill || WIN_LO) + 0.4, wn.top || WIN_HI) }); }
    ops.sort((p, q) => p.lo - q.lo);
    const cc = e.c + e.inward * WALL_T / 2;
    const put = (lo, hi, y0, y1, m = wm) => {
      if (hi - lo < 0.01 || y1 - y0 < 0.01) return;
      const wl = m === wm, ex = wl ? 0.002 : 0, lo2 = lo - ex, hi2 = hi + ex, ya = y0 > 0 ? y0 - ex : y0, yb = y1 < H ? y1 + ex : y1; // хана 2 мм давхцана — T-холбоосын ан цав (хар босоо зураас) гарахгүй
      const len = hi2 - lo2, hgt = yb - ya, mid = (lo2 + hi2) / 2;
      // Хүрээ (frame): ар тал нь ханын шугам (e.c) дээр — хөрш өрөөний хүрээтэй давхцахгүй; урд тал ханаас 2.5 см цухуйна
      const fr = m === mats.frame, th = fr ? WALL_T + 0.025 : WALL_T, c0 = fr ? e.c + e.inward * th / 2 : cc;
      const b = e.axis === 'x' ? box(len, hgt, th, m) : box(th, hgt, len, m);
      if (wl) { const ge = b.geometry, p = ge.attributes.position, n = ge.attributes.normal, uv = ge.attributes.uv, ox = e.axis === 'x' ? mid : c0, oz = e.axis === 'x' ? c0 : mid, oy = ya + hgt / 2; for (let i = 0; i < p.count; i++) { const X = p.getX(i) + ox, Y = p.getY(i) + oy, Z = p.getZ(i) + oz, ay = Math.abs(n.getY(i)) > 0.5; uv.setXY(i, (ay || Math.abs(n.getZ(i)) > 0.5 ? X : Z) / su, (ay ? Z : Y) / sv); } const drop = e.axis === 'x' ? [0, 1] : [4, 5], ix = []; ge.groups.forEach((gr, gi) => { if (!drop.includes(gi)) ix.push(...ge.index.array.slice(gr.start, gr.start + gr.count)); }); ge.setIndex(ix); ge.clearGroups(); } // ханын дагуух үзүүрийн нүүрийг хасна: хөрш хэсэг/хүрээнд нуугддаг ч ирмэг нь урд хавтгайд шүргэж бүдэг босоо зураас (seam) гаргадаг байв
      b.position.set(e.axis === 'x' ? mid : c0, ya + hgt / 2, e.axis === 'x' ? c0 : mid); g.add(b);
      // Шалны хөвөө (plinth) — хана/шалны зааг тодорхой (хаалганы нээлхийд байхгүй); үзүүр 1 мм давхцаж, үзүүрийн нүүргүй (хүрээ/хөрш хөвөөнд нуугдана) — ховил/зураас гарахгүй
      if (y0 === 0 && wl) { const p = e.axis === 'x' ? box(hi - lo + 0.002, 0.08, WALL_T + 0.03, mats.plinth) : box(WALL_T + 0.03, 0.08, hi - lo + 0.002, mats.plinth), pg = p.geometry, pd = e.axis === 'x' ? [0, 1] : [4, 5], pix = []; pg.groups.forEach((gr, gi) => { if (!pd.includes(gi)) pix.push(...pg.index.array.slice(gr.start, gr.start + gr.count)); }); pg.setIndex(pix); pg.clearGroups(); p.position.set(e.axis === 'x' ? (lo + hi) / 2 : cc, 0.04, e.axis === 'x' ? cc : (lo + hi) / 2); g.add(p); }
    };
    let cur = e.a;
    ops.forEach((o, i) => {
      // Хана хүрээний ГАДНА ирмэгт (lo−fw / hi+fw) зогсоно — хүрээтэй давхцаж нэг хавтгайд анивчихгүй (z-fighting)
      const fw = o.t === 'door' ? 0.06 : 0.05, nx = ops[i + 1];
      const L = Math.max(cur, o.lo - fw), R = Math.max(L, Math.min(o.hi + fw, nx ? (o.hi + nx.lo) / 2 : e.b));
      put(cur, L, 0, H);
      if (o.t === 'door') {
        put(L, R, DOOR_H + fw, H);
        put(o.lo - fw, o.lo, 0, DOOR_H + fw, mats.frame); put(o.hi, o.hi + fw, 0, DOOR_H + fw, mats.frame); put(o.lo, o.hi, DOOR_H, DOOR_H + fw, mats.frame);
        if (o.d.b === 'out') { const leaf = e.axis === 'x' ? box(o.hi - o.lo, DOOR_H, 0.05, mats.door) : box(0.05, DOOR_H, o.hi - o.lo, mats.door); leaf.position.set(e.axis === 'x' ? (o.lo + o.hi) / 2 : e.c, DOOR_H / 2, e.axis === 'x' ? e.c : (o.lo + o.hi) / 2); g.add(leaf); const hd = e.axis === 'x' ? box(0.02, 0.3, 0.03, mats.black) : box(0.03, 0.3, 0.02, mats.black); hd.position.copy(leaf.position).add(new THREE.Vector3(e.axis === 'x' ? (o.hi - o.lo) / 2 - 0.1 : e.inward * 0.04, 0.02, e.axis === 'x' ? e.inward * 0.04 : (o.hi - o.lo) / 2 - 0.1)); g.add(hd); }
      } else {
        const WIN_LO = o.sill, WIN_HI = o.top; // цонх бүрийн өөрийн тавцан/дээд (гар хэмжээс эсвэл AI)
        put(L, R, 0, WIN_LO - fw); put(L, R, WIN_HI + fw, H);
        put(o.lo - fw, o.lo, WIN_LO - fw, WIN_HI + fw, mats.frame); put(o.hi, o.hi + fw, WIN_LO - fw, WIN_HI + fw, mats.frame); put(o.lo, o.hi, WIN_LO - fw, WIN_LO, mats.frame); put(o.lo, o.hi, WIN_HI, WIN_HI + fw, mats.frame);
        if (o.own) { // шил/хөндлөвч/тавцан зөвхөн эзэн өрөөнд; шил + хөндлөвч ханын шугамаас 4 см дотогш
          const mid = (o.lo + o.hi) / 2, gz = e.c + e.inward * 0.04;
          const gl = new THREE.Mesh(new THREE.PlaneGeometry(o.hi - o.lo, WIN_HI - WIN_LO), mats.glass);
          gl.position.set(e.axis === 'x' ? mid : gz, (WIN_LO + WIN_HI) / 2, e.axis === 'x' ? gz : mid); if (e.axis === 'y') gl.rotation.y = Math.PI / 2; g.add(gl);
          const bar = e.axis === 'x' ? box(0.04, WIN_HI - WIN_LO, 0.05, mats.frame) : box(0.05, WIN_HI - WIN_LO, 0.04, mats.frame); bar.position.set(e.axis === 'x' ? mid : gz, (WIN_LO + WIN_HI) / 2, e.axis === 'x' ? gz : mid); g.add(bar);
          const sl = o.hi - o.lo + 2 * fw + 0.02; const sill = e.axis === 'x' ? box(sl, 0.04, 0.3, mats.frame) : box(0.3, 0.04, sl, mats.frame); sill.position.set(e.axis === 'x' ? mid : cc + e.inward * 0.1, WIN_LO, e.axis === 'x' ? cc + e.inward * 0.1 : mid); g.add(sill);
        }
      }
      cur = R;
    });
    put(cur, e.b, 0, H);
    // Спотууд: зурвасын төвд (ханаас 0.21 м), зөвхөн хатуу хананы дагуу (нээлхийгээс ≥0.3 м), ~1.15 м зайтай — доор нь хананд гэрлийн «хясаа»
    if (cove) {
      const lo0 = e.a + bw, hi0 = e.b - bw; let iv = [[lo0 + 0.1, hi0 - 0.1]]; for (const o of ops) iv = iv.flatMap(([a, b]) => [[a, Math.min(b, o.lo - 0.3)], [Math.max(a, o.hi + 0.3), b]]).filter(([a, b]) => b - a > 0.2);
      for (const [a, b] of iv) { const n = Math.max(1, Math.round((b - a) / 1.15)); for (let k = 0; k < n; k++) { const t = a + (k + 0.5) * (b - a) / n, o = e.c + e.inward * (WALL_T + 0.18); dls.push(e.axis === 'x' ? [t, o, e] : [o, t, e]); } }
    }
  }
  if (!cove) { // тавиургүй (угаалга, жижиг/урт өрөө): таазны төв шугамаар 1–6 спот
    const lx = r.w >= r.h, L = lx ? r.w : r.h, n = Math.max(1, Math.min(6, Math.round(L / 1.25))); for (let k = 0; k < n; k++) { const t = (k + 0.5) / n; dls.push(lx ? [r.x + r.w * t, r.y + r.h / 2, null] : [r.x + r.w / 2, r.y + r.h * t, null]); }
  }
  const yD = H - bh - 0.002;
  for (const [x, z, e] of dls) {
    const d = new THREE.Mesh(new THREE.CircleGeometry(0.034, 16), mats.dl), rg = new THREE.Mesh(new THREE.RingGeometry(0.034, 0.05, 20), mats.steel); for (const m of [d, rg]) { m.rotation.x = Math.PI / 2; m.position.set(x, yD - (m === d ? 0.001 : 0), z); m.userData.ceil = 1; g.add(m); }
    if (e) { const w = 1.15, top = yD - 0.02, bot = Math.max(0.12, top - 1.95), o = e.c + e.inward * (WALL_T + 0.004), t = e.axis === 'x' ? x : z, P = (tt, yy) => (e.axis === 'x' ? [tt, yy, o] : [o, yy, tt]); scal.push([P(t - w / 2, bot), P(t + w / 2, bot), P(t + w / 2, top), P(t - w / 2, top)]); }
  }
  // Виртуал гэрэл: том өрөөнд урт тэнхлэгийн дагуу 2, бусад 1 (дулаан 3000K); хүрээ (distance) хязгаартай — хөрш өрөө рүү бага нэвчинэ
  const big = r.w * r.h > 14, lx = r.w >= r.h, I = (r.type === 'bath' ? 0.9 : r.type === 'balcony' ? 0.9 : r.type === 'hall' ? 1.5 : big ? 2.0 : 1.8) * Math.min(1, Math.max(0.4, r.w * r.h / 8)), D = Math.hypot(r.w, r.h) * (big ? 0.42 : 0.55) + 1.0;
  for (const t of big ? [0.27, 0.73] : [0.5]) vLights.push({ x: lx ? r.x + r.w * t : r.x + r.w / 2, y: H - 1.0, z: lx ? r.y + r.h / 2 : r.y + r.h * t, i: I, d: D, room: r.id });
  r.bh = bh; // таазны тавиурын өндөр (тавилгын унжлага гэрэлд)
  mergeByMat(g);
  if (glows.length) g.add(quadMesh(glows, mats.glow)); if (scal.length) g.add(quadMesh(scal, mats.scallop));
  for (const o of g.children) if (o.material === mats.glow) o.userData.ceil = 1;
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
  if (!it.curt) for (const w of c.wins) if (y1 > w.y0 && it.y0 < w.y1 && ov(r, w, it.deco ? -0.08 : e)) return 'цонхны өмнө'; // хөшиг цонхны хажууд (зориуд)
  for (const k of it.keep) if (!inRoom(c, k)) return 'урд чөлөө өрөөнд багтахгүй';
  // Чөлөөт (хананд наалдаагүй) том шалны эд зүйл ханатай «үхмэл зурвас» (0.06–0.7 м) үүсгэхгүй: хананд наалдана эсвэл гарц үлдээнэ (ургамал г.м. жижиг зүйлд үйлчлэхгүй)
  if (it.floor && !it.side && !it.deco && it.h > 0.3 && Math.min(it.w, it.d) >= 0.4 && [r.x0 - c.x0, c.x1 - r.x1, r.z0 - c.z0, c.z1 - r.z1].some((g) => g > 0.06 && nar(g, it))) return 'ханатай нарийн зай';
  for (const o of c.items) {
    if (it.under || o.under) { if (it.under && o.under && ov(r, o.rect, e)) return 'хивс давхцана'; continue; }
    if (y1 > o.y0 + 0.005 && it.y0 < o.y0 + o.h - 0.005 && ov(r, o.rect, e) && !(o.grp === it.grp && it.pull !== o.pull)) return `${o.k}-тэй давхцана`; // сандал ширээн доор 8 см түлхэгдсэн (staging) — өөрийн ширээтэй давхцаж болно
    if (o.grp === it.grp) continue;
    if (it.floor) for (const k of o.keep) if (ov(r, k, e)) return `${o.k}-ийн өмнөх чөлөөнд`;
    if (o.floor) for (const k of it.keep) if (ov(k, o.rect, e)) return `өмнөх чөлөөнд ${o.k}`;
    if (it.floor && o.floor && !it.deco && !o.deco) { const px = Math.min(r.x1, o.rect.x1) - Math.max(r.x0, o.rect.x0), pz = Math.min(r.z1, o.rect.z1) - Math.max(r.z0, o.rect.z0), g = px > 0.05 ? -pz : pz > 0.05 ? -px : 0; if (g > (it.side && o.side ? 0.12 : 0.002) && nar(g, it, o)) return `${o.k}-тэй гарц нарийн`; } // хоёулаа хананд наалдсан бол зэрэгцэж (≤0.12) болно
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
    c.items.length -= cd.its.length; await c.tick(); if (++n >= (c.lookN || 8)) break;
  }
  if (best) { tryAdd(c, best.cd.its); return best.cd; }
  return { fail: Object.entries(why).sort((p, q) => q[1] - p[1])[0]?.[0] || 'тохирох байр алга' };
}
const peek = (c, cands) => { const cd = choose(c, cands, true, 20); if (cd.fail) return null; c.items.length -= cd.its.length; return cd; }; // түр шалгаад буцаана (≤20 замын шалгалт — хурдан)
// Сонгосон эд зүйлсийг бодит объект болгоно (прототип анх бүтээгдэж, дараа нь clone)
const BLOB_G = new THREE.PlaneGeometry(1, 1);
function commit(c, its) {
  for (const it of its) {
    const o = it.ref.n++ ? it.ref.obj.clone() : (it.ref.obj ||= it.ref.mk()), cs = Math.cos(it.th), sn = Math.sin(it.th), R = it.rect;
    o.rotation.set(0, it.th + it.rot0, 0); o.position.set(it.x - (it.cx * cs + it.cz * sn), it.y0, it.z - (-it.cx * sn + it.cz * cs)); if (it.ceil) o.userData.ceil = 1;
    if (it.floor && !it.deco && !it.under && it.h > 0.3 && !o.userData.blob) { o.updateMatrix(); const bl = new THREE.Mesh(BLOB_G, mats.blob); bl.matrixAutoUpdate = false; bl.matrix.copy(o.matrix.clone().invert().multiply(new THREE.Matrix4().compose(new THREE.Vector3((R.x0 + R.x1) / 2, 0.007, (R.z0 + R.z1) / 2), new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), new THREE.Vector3(R.x1 - R.x0 + 0.18, R.z1 - R.z0 + 0.18, 1)))); bl.userData.keep = 1; bl.renderOrder = 1; o.add(bl); o.userData.blob = 1; } // шалан дээрх зөөлөн сүүдэр (contact shadow) — clone-д дагаж хуулагдана
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
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.016, 0.08, 8), mats.black), sx * (L / 2 - 0.1), 0.04, sz * (D / 2 - 0.1));
  add(rbox(L, 0.2, D, mats.sofa, 0.03), 0, 0.18, 0); add(rbox(L, 0.48, 0.18, mats.sofa, 0.04), 0, 0.52, -D / 2 + 0.09);
  for (const s of [-1, 1]) add(rbox(0.16, 0.34, D, mats.sofa, 0.05), s * (L / 2 - 0.08), 0.45, 0);
  const n = L > 1.75 ? 3 : 2, cw = (L - 0.32) / n;
  for (let i = 0; i < n; i++) { const x = -L / 2 + 0.16 + cw * (i + 0.5); add(rbox(cw - 0.012, 0.14, D - 0.24, mats.sofaCus, 0.05), x, 0.35, 0.06); add(rbox(cw - 0.03, 0.38, 0.16, mats.sofaCus, 0.07), x, 0.55, -D / 2 + 0.25).rotation.x = -0.1; }
  for (const [s, m, dx] of [[-1, mats.pillowA, 0.42], [1, mats.pillowB, 0.42], [1, mats.pillowC, 0.78]]) add(rbox(0.4, 0.38, 0.12, m, 0.06), s * (L / 2 - dx), 0.56, -D / 2 + 0.38 + (dx > 0.5 ? 0.04 : 0)).rotation.set(-0.18, s * 0.2, 0);
  const th = add(rbox(0.5, 0.03, 0.62, mats.rug2, 0.012), -L / 2 + 0.5, 0.435, 0.02); th.rotation.y = 0.12; // нөмрөг
  return g;
}
function mkHeadboard(bw, led) { // зөөлөвчтэй толгой (босоо оёдол); led бол ард нь 2700K тууз → хана/банз дээр дээш сарних туяа
  const g = new THREE.Group(), H = 1.12, hb = rbox(bw + 0.1, H, 0.08, mats.headboard, 0.03); hb.position.y = H / 2; g.add(hb);
  for (let i = 1; i < 6; i++) { const l = box(0.006, H - 0.12, 0.004, mats.seam); l.castShadow = false; l.position.set(-bw / 2 - 0.05 + i * (bw + 0.1) / 6, H / 2, 0.041); g.add(l); }
  if (led) { const l = box(bw + 0.02, 0.01, 0.012, mats.led); l.castShadow = false; l.position.set(0, H + 0.004, -0.03); g.add(l); g.add(quadMesh([[[-bw / 2 - 0.12, H, -0.037], [bw / 2 + 0.12, H, -0.037], [bw / 2 + 0.12, H + 0.8, -0.037], [-bw / 2 - 0.12, H + 0.8, -0.037]]], mats.glow)); }
  return g;
}
function mkUphPanel(W, h) { // зөөлөвчтэй ханын хавтан (босоо суваг) + дээд захад LED → хананд дээш туяа
  const g = new THREE.Group(), b = box(W, h, 0.02, mats.uph); b.position.y = h / 2; g.add(b);
  const n = Math.max(3, Math.round(W / 0.22)); for (let i = 1; i < n; i++) { const l = box(0.008, h - 0.02, 0.004, mats.seam); l.castShadow = false; l.position.set(-W / 2 + i * W / n, h / 2, 0.011); g.add(l); }
  const l = box(W - 0.04, 0.01, 0.012, mats.led); l.castShadow = false; l.position.set(0, h + 0.005, 0); g.add(l);
  g.add(quadMesh([[[-W / 2, h, -0.008], [W / 2, h, -0.008], [W / 2, h + 0.9, -0.008], [-W / 2, h + 0.9, -0.008]]], mats.glow)); return g;
}
function mkBedBody(bw, dv = mats.duvet) { // царс хүрээ, цагаан даавуу, хөнжил, хөлийн даавуу, дэр; урт 2.02
  const g = new THREE.Group(), add = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); return m; };
  add(rbox(bw, 0.28, 2.02, mats.oak, 0.02), 0, 0.14, 0); add(rbox(bw - 0.06, 0.22, 1.96, mats.linen, 0.06), 0, 0.39, 0);
  add(rbox(bw + 0.02, 0.12, 1.3, dv, 0.05), 0, 0.53, 0.35); add(rbox(bw + 0.04, 0.03, 0.42, mats.rug2, 0.015), 0, 0.6, 0.72);
  for (const s of [-1, 1]) add(rbox(bw / 2 - 0.12, 0.14, 0.4, mats.linen, 0.06), s * bw / 4, 0.58, -0.72).rotation.x = -0.25;
  add(rbox(0.42, 0.3, 0.1, mats.pillowA, 0.05), 0, 0.62, -0.52).rotation.x = -0.3; // гоёлын дэр
  return g;
}
function mkNightstand(lamp = true, plant = false) { // царс 2 шургуулга + (ширээний гэрэл | жижиг ургамал)
  const g = new THREE.Group(), add = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); return m; };
  add(rbox(0.45, 0.46, 0.4, mats.oak, 0.015), 0, 0.27, 0); add(box(0.43, 0.004, 0.004, mats.seam), 0, 0.27, 0.201); for (const y of [0.16, 0.38]) add(box(0.12, 0.01, 0.012, mats.black), 0, y, 0.206);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(box(0.018, 0.04, 0.018, mats.black), sx * 0.19, 0.02, sz * 0.16);
  if (lamp) { add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.2, 20), mats.ceramic), 0.07, 0.6, -0.05); const sh = add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.19, 24, 1, true), mats.shade), 0.07, 0.8, -0.05); sh.castShadow = false; }
  if (plant) { const p = mkPlantG('potted_plant_04', 0.25); if (p) add(p, 0.09, 0.5, -0.04); }
  return g;
}
function mkWardrobe(w, h = 2.2, dm = mats.matteWhite) { // хувцасны шүүгээ: хаалганы заадас + хар нарийн бариул
  const g = new THREE.Group(), n = Math.max(2, Math.round(w / 0.5)), b = rbox(w, h, 0.6, dm, 0.01); b.position.y = h / 2; g.add(b);
  for (let i = 1; i < n; i++) { const x = -w / 2 + i * w / n, l = box(0.005, h - 0.08, 0.004, mats.seam); l.position.set(x, h / 2, 0.301); g.add(l); if (i % 2) for (const k of [-1, 1]) { const hd = box(0.012, 0.5, 0.018, mats.black); hd.position.set(x + k * 0.04, h * 0.48, 0.31); g.add(hd); } }
  return g;
}
function mkScreen(sw) { // ТВ + ард нь гэрэлтэлт (bias light)
  const g = new THREE.Group(), sh = sw * 0.5625 + 0.03, s = rbox(sw, sh, 0.04, mats.screen, 0.01); s.position.y = sh / 2; g.add(s);
  g.add(quadMesh([[[-sw / 2 - 0.28, -0.22, -0.022], [sw / 2 + 0.28, -0.22, -0.022], [sw / 2 + 0.28, sh + 0.22, -0.022], [-sw / 2 - 0.28, sh + 0.22, -0.022]]], mats.haloRect)); return g;
}
function mkFluted(w, h, m, led) { // модон банзан хана (fluted): 2.8 см банз, 1.2 см завсар — нэг геометр; led бол хоёр захад босоо LED + хананд туяа
  const g = new THREE.Group(), base = box(w, h, 0.008, mats.dark); base.position.set(0, h / 2, -0.006); g.add(base);
  const n = Math.max(3, Math.floor(w / 0.04)), sw = w / n, gs = []; for (let i = 0; i < n; i++) { const b = new THREE.BoxGeometry(sw - 0.012, h, 0.016); b.translate(-w / 2 + (i + 0.5) * sw, h / 2, 0.002); gs.push(b); }
  const sl = new THREE.Mesh(mergeGeometries(gs), m); sl.castShadow = sl.receiveShadow = true; g.add(sl); gs.forEach((q) => q.dispose());
  if (led) { for (const s of [-1, 1]) { const l = box(0.01, h - 0.06, 0.01, mats.led); l.castShadow = false; l.position.set(s * (w / 2 + 0.006), h / 2, -0.002); g.add(l); } g.add(quadMesh([-1, 1].map((s) => [[s * (w / 2 + 0.01), 0.04, -0.009], [s * (w / 2 + 0.01), h - 0.04, -0.009], [s * (w / 2 + 0.42), h - 0.04, -0.009], [s * (w / 2 + 0.42), 0.04, -0.009]]), mats.glow)); }
  return g;
}
// Доод шүүгээ (кашемир, хар нарийн бариул) + кварц тавцан + далд суурь; sx = угаалтуур (холигч tapH — цонхны доор намхан), kx = плита + доор нь шарах шүүгээ (тавцангийн локал x)
function mkCounter(len, sx = null, tapH = 0.28, kx = null) {
  const g = new THREE.Group(), add = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); return m; };
  add(box(len - 0.04, 0.1, 0.5, mats.dark), 0, 0.05, -0.04); add(rbox(len - 0.01, 0.76, 0.58, mats.cab, 0.006), 0, 0.48, 0.01); add(rbox(len, 0.03, 0.63, mats.quartz, 0.004), 0, 0.875, 0.015);
  const n = Math.max(1, Math.round(len / 0.6)); for (let i = 1; i < n; i++) add(box(0.004, 0.74, 0.004, mats.seam), -len / 2 + i * len / n, 0.48, 0.301);
  add(box(len - 0.02, 0.004, 0.004, mats.seam), 0, 0.71, 0.301);
  for (let i = 0; i < n; i++) { const x = -len / 2 + (i + 0.5) * len / n; if (kx == null || Math.abs(x - kx) > 0.35) add(box(Math.min(0.3, len / n - 0.12), 0.012, 0.016, mats.black), x, 0.79, 0.308); }
  if (sx != null) {
    add(rbox(0.52, 0.012, 0.42, mats.steel, 0.006), sx, 0.892, 0.02); add(rbox(0.44, 0.012, 0.32, mats.dark, 0.006), sx, 0.896, 0.03);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, tapH, 10), mats.black), sx, 0.89 + tapH / 2, -0.2); add(new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.16, 8), mats.black), sx, 0.89 + tapH - 0.01, -0.13).rotation.x = Math.PI / 2;
  }
  if (kx != null) { add(rbox(0.58, 0.01, 0.5, mats.screen, 0.004), kx, 0.894, 0.02); add(rbox(0.56, 0.5, 0.01, mats.screen, 0.004), kx, 0.44, 0.302); add(box(0.42, 0.016, 0.02, mats.steel), kx, 0.64, 0.318); }
  return g;
}
function mkBacksplash(len, h) { const g = new THREE.Group(), m = box(len, h, 0.008, mats.backsplash), p = m.geometry.attributes.position, uv = m.geometry.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + len / 2) / 0.3, (p.getY(i) + h / 2) / 0.075); m.castShadow = false; m.position.y = h / 2; g.add(m); return g; } // гялгар плита (0.3 × 0.075)
// Хөргөгч-багана: ган бие + дээд шүүгээ; hs = бариулын тал (локал x тэмдэг — нугас эсрэг талд), pn = ил талын бүтэн өндөр хавтан (−1/+1, 0 = үгүй)
function mkFridge(w, hs = 1, pn = 0) {
  const g = new THREE.Group(), bw = w - (pn ? 0.025 : 0), bx = -pn * 0.0125, add = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); return m; };
  add(rbox(bw, 1.85, 0.65, mats.steel, 0.02), bx, 0.925, 0); add(box(bw - 0.02, 0.006, 0.005, mats.dark), bx, 1.25, 0.326);
  for (const [y, h] of [[1.55, 0.4], [0.85, 0.5]]) add(box(0.018, h, 0.03, mats.black), bx + hs * (bw / 2 - 0.05), y, 0.34);
  add(rbox(bw, 0.36, 0.6, mats.cabUp, 0.006), bx, 2.05, -0.025);
  if (pn) add(box(0.025, 2.24, 0.66, mats.cab), pn * (w / 2 - 0.0125), 1.12, 0.005);
  return g;
}
function mkUpper(len, h = 0.7, d = 0.35) { // дээд шүүгээ + доор нь LED → хормойд доош туяа
  const g = new THREE.Group(), b = rbox(len, h, d, mats.cabUp, 0.006); b.position.y = h / 2; g.add(b);
  const n = Math.max(1, Math.round(len / 0.5)); for (let i = 1; i < n; i++) { const l = box(0.005, h - 0.04, 0.004, mats.seam); l.position.set(-len / 2 + i * len / n, h / 2, d / 2 + 0.001); g.add(l); }
  const l = box(len - 0.04, 0.008, 0.012, mats.led); l.castShadow = false; l.position.set(0, -0.004, d / 2 - 0.05); g.add(l);
  g.add(quadMesh([[[-len / 2 + 0.02, -0.01, -d / 2 - 0.011], [len / 2 - 0.02, -0.01, -d / 2 - 0.011], [len / 2 - 0.02, -0.58, -d / 2 - 0.011], [-len / 2 + 0.02, -0.58, -d / 2 - 0.011]]], mats.glow)); return g;
}
function mkHood(h) { const g = new THREE.Group(), cp = rbox(0.6, 0.06, 0.5, mats.black, 0.01), ch = box(0.3, h - 0.06, 0.25, mats.black); cp.position.y = 0.03; ch.position.set(0, 0.06 + (h - 0.06) / 2, -0.125); g.add(cp, ch); return g; } // яндан (хар)
function mkTub(L, D) { const g = new THREE.Group(), o = rbox(L, 0.56, D, mats.white, 0.06), i = rbox(L - 0.14, 0.02, D - 0.14, mats.water, 0.04), f = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.18, 10), mats.steel); o.position.y = 0.28; i.position.y = 0.555; f.position.set(L / 2 - 0.14, 0.62, -D / 2 + 0.06); g.add(o, i, f); return g; }
function mkWC() { // ханын суултуур (далд бак): аяга 0.42 м өндөрт, ханын хайрцаг + ган товч
  const g = new THREE.Group(), add = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); };
  add(rbox(0.38, 1.05, 0.14, mats.matteWhite, 0.01), 0, 0.525, -0.24); add(rbox(0.2, 0.13, 0.012, mats.steel, 0.004), 0, 0.93, -0.165);
  add(rbox(0.36, 0.3, 0.46, mats.white, 0.1), 0, 0.27, 0.06); add(rbox(0.36, 0.025, 0.44, mats.white, 0.012), 0, 0.432, 0.07); return g;
}
function mkVanity(w, D = 0.45) { const g = new THREE.Group(), add = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); }; add(rbox(w, 0.45, D, mats.oakV, 0.01), 0, 0.575, 0); add(rbox(w + 0.01, 0.05, D + 0.01, mats.white, 0.012), 0, 0.825, 0.005); add(rbox(w - 0.16, 0.012, D - 0.17, mats.water, 0.01), 0, 0.852, 0.03); add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.2, 10), mats.black), 0, 0.95, -D / 2 + 0.055); return g; } // дүүжин царс шүүгээтэй угаалтуур
function mkWasherSink(D = 0.55) { // «угаалгын машин дээрх хавтгай угаалтуур» (жижиг угаалгын өрөөнд түгээмэл): 0.6 өргөн, D гүн (нимгэн машин 0.45), өндөр 0.94
  const g = new THREE.Group(), add = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); return m; }, f = D / 2 - 0.01;
  add(rbox(0.6, 0.84, D - 0.04, mats.matteWhite, 0.02), 0, 0.42, -0.02); add(new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.024, 10, 32), mats.steel), 0, 0.42, f - 0.008); add(new THREE.Mesh(new THREE.CircleGeometry(0.15, 32), mats.screen), 0, 0.42, f - 0.01);
  add(box(0.56, 0.09, 0.008, mats.cabUp), 0, 0.77, f - 0.01); add(box(0.1, 0.025, 0.01, mats.dark), 0.16, 0.77, f - 0.005); add(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 16), mats.steel), -0.16, 0.77, f - 0.004).rotation.x = Math.PI / 2;
  add(rbox(0.62, 0.07, D + 0.02, mats.white, 0.02), 0, 0.905, 0); add(rbox(0.44, 0.01, D - 0.22, mats.water, 0.005), 0, 0.941, 0.04);
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.2, 10), mats.black), 0, 1.04, -D / 2 + 0.03); add(new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.14, 8), mats.black), 0, 1.13, -D / 2 + 0.1).rotation.x = Math.PI / 2;
  return g;
}
function rrGeo(w, h, r, arch = false) { // бөөрөнхий өнцөгтэй (эсвэл нуман оройтой) хавтгай
  const s = new THREE.Shape(), x0 = -w / 2, y0 = 0; s.moveTo(x0 + r, y0); s.lineTo(x0 + w - r, y0); s.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
  if (arch) { s.lineTo(x0 + w, h - w / 2); s.absarc(0, h - w / 2, w / 2, 0, Math.PI, false); s.lineTo(x0, y0 + r); } else { s.lineTo(x0 + w, h - r); s.quadraticCurveTo(x0 + w, h, x0 + w - r, h); s.lineTo(x0 + r, h); s.quadraticCurveTo(x0, h, x0, h - r); s.lineTo(x0, y0 + r); }
  s.quadraticCurveTo(x0, y0, x0 + r, y0); const ge = new THREE.ShapeGeometry(s, 16), p = ge.attributes.position, uv = ge.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + w / 2) / w, p.getY(i) / h); return ge;
}
function mkMirror(w, h, kind = 'slim') { // орчин үеийн толь: slim (нарийн хар хүрээ), led (арын гэрэлтэй, бөөрөнхий өнцөг), round (гууль хүрээ) — нэг байранд давтагдахгүй
  const g = new THREE.Group();
  if (kind === 'round') { const r = w / 2, m = new THREE.Mesh(new THREE.CircleGeometry(r - 0.012, 48), mats.mirror), f = new THREE.Mesh(new THREE.TorusGeometry(r - 0.006, 0.009, 8, 64), mats.brass); m.position.set(0, h / 2, 0.006); f.position.set(0, h / 2, 0.008); g.add(m, f); return g; }
  if (kind === 'led') { const b = new THREE.Mesh(rrGeo(w - 0.04, h - 0.04, 0.06), mats.dark), m = new THREE.Mesh(rrGeo(w, h, 0.08), mats.mirror), l = new THREE.Mesh(rrGeo(w - 0.03, h - 0.03, 0.07), mats.led); b.position.set(0, 0.02, -0.004); l.position.set(0, 0.015, -0.006); m.position.z = 0.012; g.add(b, l, m); g.add(quadMesh([[[-w / 2 - 0.18, -0.18, -0.013], [w / 2 + 0.18, -0.18, -0.013], [w / 2 + 0.18, h + 0.18, -0.013], [-w / 2 - 0.18, h + 0.18, -0.013]]], mats.haloRect)); return g; }
  const f = rbox(w, h, 0.02, mats.black, 0.004), m = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.024, h - 0.024), mats.mirror); f.position.y = h / 2; m.position.set(0, h / 2, 0.0105); g.add(f, m); return g;
}
function mkPlant() { // сансевиер: цагаан ваар + босоо навч (~0.75 м)
  const g = new THREE.Group(), pot = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.09, 0.26, 20), mats.ceramic), soil = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.01, 16), mats.dark); pot.position.y = 0.13; pot.castShadow = true; soil.position.y = 0.255; g.add(pot, soil);
  for (let i = 0; i < 9; i++) { const h = 0.3 + ((i * 37) % 10) / 10 * 0.18, a = i * 2.4, l = box(0.045, h, 0.01, mats.leaf); l.position.set(Math.cos(a) * 0.045, 0.26 + h / 2, Math.sin(a) * 0.045); l.rotation.set(Math.sin(a) * 0.12, a, Math.cos(a) * 0.12); g.add(l); }
  return g;
}
function mkPlantG(name, h) { const m = FUR[name]; return m ? mdl(name, h / m.userData.size.y) : name === 'potted_plant_04' ? null : mkPlant(); } // Poly Haven ургамал (өндрөөр масштаб)
function mkTable(L, D) { // модерн ширээ: 3.5 см модон тавцан, нимгэн 4 хөл, нарийн хүрээ
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
function mkPendant(kind, drop) { // унжлага гэрэл: доод ирмэг y=0, утсаар таазанд (drop м) — globe (сүүн шил), dome (хар бүрхүүл + гэрэлтэх диск)
  const g = new THREE.Group(), add = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); return m; }; let top;
  if (kind === 'globe') { add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 16), mats.opal), 0, 0.1, 0); add(new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.03, 0.04, 16), mats.brass), 0, 0.215, 0); top = 0.235; }
  else { add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.15, 0.17, 28, 1, true), mats.blackDS), 0, 0.085, 0); add(new THREE.Mesh(new THREE.CircleGeometry(0.125, 24), mats.bulb), 0, 0.03, 0).rotation.x = Math.PI / 2; add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.03, 12), mats.brass), 0, 0.185, 0); top = 0.2; }
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, Math.max(0.01, drop - top), 6), mats.black), 0, (drop + top) / 2, 0); add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.015, 20), mats.brass), 0, drop - 0.008, 0);
  for (const o of g.children) o.castShadow = false; return g;
}
// Хийсвэр урлаг (процедур, 6 хувилбар — байр даяар давтагдахгүй); ar = өргөн/өндөр
function artTex(i, ar = 0.75) {
  const W = 512, H = Math.round(512 / ar), c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'), m = Math.min(W, H);
  const circ = (x, y, r, col) => { g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
  const bg = ['#efe6d8', '#e8e0d2', '#f1ebe1', '#f3eee5', '#ece5d9', '#f4efe7'][i % 6]; g.fillStyle = bg; g.fillRect(0, 0, W, H);
  if (i % 6 === 0) { circ(W * 0.5, H * 0.32, m * 0.15, '#c9774f'); g.fillStyle = '#8fa18a'; g.beginPath(); g.moveTo(W * 0.28, H * 0.92); g.lineTo(W * 0.28, H * 0.62); g.arc(W * 0.5, H * 0.62, W * 0.22, Math.PI, 0); g.lineTo(W * 0.72, H * 0.92); g.fill(); g.strokeStyle = '#3a3a3a'; g.lineWidth = 3; g.beginPath(); g.moveTo(W * 0.2, H * 0.52); g.lineTo(W * 0.8, H * 0.52); g.stroke(); }
  else if (i % 6 === 1) { g.fillStyle = '#d7b98e'; g.fillRect(W * 0.26, H * 0.14, W * 0.48, H * 0.5); g.fillStyle = '#2f3437'; g.beginPath(); g.arc(W * 0.5, H * 0.72, W * 0.2, Math.PI, 0); g.fill(); circ(W * 0.64, H * 0.28, m * 0.07, '#c9774f'); }
  else if (i % 6 === 2) { circ(W * 0.7, H * 0.3, m * 0.08, '#d69a52'); for (const [y, col, a] of [[0.55, '#c9b79b', 0.06], [0.66, '#9c8a74', 0.05], [0.78, '#4b4a47', 0.04]]) { g.fillStyle = col; g.beginPath(); g.moveTo(0, H); g.lineTo(0, H * y); g.bezierCurveTo(W * 0.3, H * (y - a * 2), W * 0.6, H * (y + a), W, H * (y - a)); g.lineTo(W, H); g.fill(); } }
  else if (i % 6 === 3) { for (let k = 0; k < 6; k++) { const a = -0.9 + k * 0.36, x = W * (0.5 + Math.sin(a) * 0.18), y = H * (0.55 - Math.cos(a) * 0.25); g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = k % 2 ? '#56704f' : '#8a9a6a'; g.beginPath(); g.ellipse(0, 0, m * 0.05, m * 0.14, 0, 0, Math.PI * 2); g.fill(); g.restore(); g.strokeStyle = '#4a5a44'; g.lineWidth = 2; g.beginPath(); g.moveTo(W * 0.5, H * 0.88); g.quadraticCurveTo(W * 0.5, H * 0.7, x, y); g.stroke(); } }
  else if (i % 6 === 4) { g.globalAlpha = 0.9; g.fillStyle = '#b9643f'; g.fillRect(W * 0.18, H * 0.18, W * 0.38, H * 0.42); g.fillStyle = '#34465a'; g.fillRect(W * 0.44, H * 0.38, W * 0.38, H * 0.42); g.globalAlpha = 1; circ(W * 0.3, H * 0.72, m * 0.09, '#d8c29a'); }
  else { g.strokeStyle = '#1f1f1f'; g.lineWidth = 4; g.beginPath(); g.moveTo(W * 0.3, H * 0.15); g.bezierCurveTo(W * 0.62, H * 0.2, W * 0.35, H * 0.42, W * 0.58, H * 0.5); g.bezierCurveTo(W * 0.72, H * 0.56, W * 0.4, H * 0.7, W * 0.62, H * 0.86); g.stroke(); circ(W * 0.42, H * 0.36, m * 0.11, 'rgba(214,154,82,.85)'); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function mkArt(w, h, i, fm = mats.black) { // нимгэн хүрээтэй зураг (урлаг дотроо)
  const g = new THREE.Group(), t = 0.022, add = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); return m; };
  for (const [x, y, sx, sy] of [[0, h - t / 2, w, t], [0, t / 2, w, t], [-w / 2 + t / 2, h / 2, t, h - 2 * t], [w / 2 - t / 2, h / 2, t, h - 2 * t]]) add(box(sx, sy, 0.03, fm), x, y, 0);
  const pic = new THREE.Mesh(new THREE.PlaneGeometry(w - 2 * t, h - 2 * t), new THREE.MeshStandardMaterial({ map: artTex(i, (w - 2 * t) / (h - 2 * t)), roughness: 0.85 })); pic.receiveShadow = true; add(pic, 0, h / 2, -0.004); return g;
}
function mkCurtain(w, h) { // маалинган хөшиг: долгиолсон хавтгай (далд зам — тааз/тавиураас)
  const ge = new THREE.PlaneGeometry(w, h, Math.max(8, Math.round(w / 0.025)), 1), p = ge.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin((p.getX(i) + w / 2) / 0.1 * Math.PI) * 0.028); ge.computeVertexNormals();
  const m = new THREE.Mesh(ge, mats.curtain), g = new THREE.Group(); m.position.y = h / 2; m.castShadow = m.receiveShadow = true; g.add(m); return g;
}
function mkBench(w) { // коридорын вандан: царс суудал + дэвсгэр, хар металл хүрээ, доор гутлын тавиур
  const g = new THREE.Group(), add = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); return m; };
  add(rbox(w, 0.04, 0.38, mats.oak, 0.008), 0, 0.46, 0); add(rbox(w - 0.06, 0.05, 0.34, mats.pillowC, 0.02), 0, 0.505, 0); add(box(w - 0.06, 0.02, 0.32, mats.oak), 0, 0.13, 0);
  for (const s of [-1, 1]) { for (const z of [-0.16, 0.16]) add(box(0.025, 0.44, 0.025, mats.black), s * (w / 2 - 0.03), 0.22, z); add(box(0.025, 0.025, 0.34, mats.black), s * (w / 2 - 0.03), 0.12, 0); }
  for (const [x, m] of [[-w / 4, mats.dark], [w / 6, mats.rug2]]) for (const dx of [-0.055, 0.055]) add(rbox(0.09, 0.08, 0.26, m, 0.03), x + dx, 0.18, 0.02); // гутал
  return g;
}
function mkHooks(w) { // хувцасны өлгүүр (царс тууз + хар дэгээ) + 2 өвлийн хүрэм (УБ өвөл)
  const g = new THREE.Group(), add = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); return m; };
  add(rbox(w, 0.1, 0.025, mats.oak, 0.006), 0, 1.0, -0.085); const n = Math.max(3, Math.round(w / 0.22)); for (let i = 0; i < n; i++) add(box(0.018, 0.018, 0.08, mats.black), -w / 2 + (i + 0.5) * w / n, 1.0, -0.04);
  for (const [k, m, r] of [[0, mats.coatA, 0.03], [n - 1, mats.coatB, -0.03]]) { const x = -w / 2 + (k + 0.5) * w / n, c = add(rbox(0.4, 0.86, 0.07, m, 0.03), x, 0.54, -0.045); c.rotation.z = r; add(rbox(0.16, 0.1, 0.06, m, 0.025), x, 0.97, -0.05); add(box(0.05, 0.6, 0.075, mats.seam), x, 0.6, -0.04).rotation.z = r; } // нимгэн хүрэм (өлгөөтэй)
  return g;
}
function mkConsole(w) { // хөвөгч консол (хушга) + доор нь LED → хананд туяа, дээр нь ваар
  const g = new THREE.Group(), add = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); return m; };
  add(rbox(w, 0.09, 0.28, mats.walnut, 0.01), 0, 0.045, 0); const l = add(box(w - 0.06, 0.006, 0.01, mats.led), 0, -0.004, 0.08); l.castShadow = false;
  g.add(quadMesh([[[-w / 2 + 0.03, -0.005, -0.138], [w / 2 - 0.03, -0.005, -0.138], [w / 2 - 0.03, -0.45, -0.138], [-w / 2 + 0.03, -0.45, -0.138]]], mats.glow));
  const v = mdl('ceramic_vase_04', 0.8); if (v) add(v, w / 4, 0.09, 0); const bk = mkBooks(3, 11, true); add(bk, -w / 4, 0.09, 0); return g;
}
function mkBooks(n, seed, lay = false) { // ном (өнгө/өндөр санамсаргүй); lay = хэвтээ овоо
  const g = new THREE.Group(), R = rng(seed); let x = 0;
  for (let i = 0; i < n; i++) { const h = 0.17 + R() * 0.07, t = 0.022 + R() * 0.02, d = 0.13 + R() * 0.03, m = mats.books[Math.floor(R() * mats.books.length)]; const b = box(lay ? h : t, lay ? t : h, d, m); b.castShadow = false; if (lay) { b.position.set(0, x + t / 2, 0); x += t; } else { b.position.set(x + t / 2, h / 2, 0); x += t + 0.003; } g.add(b); }
  if (!lay) g.children.forEach((b) => { b.position.x -= x / 2; }); return g;
}
function mkShelves(w) { // хөвөгч царс тавиур ×3 (LED доор нь → хананд туяа) + ном, ваар, ургамал, жижиг зураг
  const g = new THREE.Group(), add = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); return m; }, qs = [];
  for (let i = 0; i < 3; i++) { const y = 0.34 + i * 0.4; add(rbox(w, 0.035, 0.24, mats.oak, 0.006), 0, y + 0.0175, 0); const l = add(box(w - 0.06, 0.006, 0.01, mats.led), 0, y - 0.003, 0.08); l.castShadow = false; qs.push([[-w / 2 + 0.03, y - 0.005, -0.117], [w / 2 - 0.03, y - 0.005, -0.117], [w / 2 - 0.03, y - 0.33, -0.117], [-w / 2 + 0.03, y - 0.33, -0.117]]); }
  g.add(quadMesh(qs, mats.glow));
  add(mkBooks(6, 3), -w / 2 + 0.2, 0.375, 0); const v4 = mdl('ceramic_vase_04', 0.75); if (v4) add(v4, w / 4, 0.375, 0);
  const p4 = mkPlantG('potted_plant_04', 0.24); if (p4) add(p4, -w / 4, 0.775, 0); const a = add(mkArt(0.2, 0.26, 5, mats.oak), w / 4, 0.775, 0.02); a.rotation.x = -0.08;
  const v3 = mdl('ceramic_vase_03', 0.62); if (v3) add(v3, -w / 5, 1.175, 0); add(mkBooks(3, 8, true), w / 5, 1.175, 0);
  return g;
}
function mkBathShelf(w) { const g = new THREE.Group(), add = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); return m; }; add(rbox(w, 0.025, 0.16, mats.oakV, 0.005), 0, 0.0125, 0); const p = mkPlantG('potted_plant_04', 0.22); if (p) add(p, -w / 4, 0.025, 0); for (const [x, m] of [[0.08, mats.pillowC], [0.17, mats.rug2]]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.14, 16), m), x, 0.065, 0).rotation.z = Math.PI / 2; return g; } // угаалгын тавиур: ургамал + ороосон алчуур
function mkFruitBowl() { const g = new THREE.Group(), b = new THREE.Mesh(new THREE.SphereGeometry(0.14, 24, 8, 0, Math.PI * 2, Math.PI * 0.58, Math.PI * 0.42), new THREE.MeshStandardMaterial({ color: 0xe9e3d8, roughness: 0.35, side: THREE.DoubleSide })); b.scale.y = 0.55; b.position.y = 0.08; g.add(b); const R = rng(5), cols = [0xe0822c, 0xd9a036, 0x8fae3a, 0xb8352c, 0xe0822c]; cols.forEach((c, i) => { const a = i * 1.26, f = new THREE.Mesh(new THREE.SphereGeometry(0.038, 12, 8), new THREE.MeshStandardMaterial({ color: c, roughness: 0.45 })); f.position.set(Math.cos(a) * 0.05 * (i ? 1 : 0), 0.06 + (i ? 0 : 0.035) + R() * 0.01, Math.sin(a) * 0.05 * (i ? 1 : 0)); f.castShadow = true; g.add(f); }); return g; } // жимстэй керамик таваг
function mkTableDecor() { const g = new THREE.Group(), bk = mkBooks(2, 21, true); bk.position.set(-0.05, 0, 0); g.add(bk); const cd = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.09, 16), mats.pillowC); cd.position.set(0.1, 0.045, 0.02); g.add(cd); const fl = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), mats.bulb); fl.position.set(0.1, 0.1, 0.02); g.add(fl); return g; } // ном + лаа
function mkLounge() { // тагтны сандал: царс хүрээ, маалинган дэр
  const g = new THREE.Group(), add = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); return m; };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(box(0.03, 0.36, 0.03, mats.oak), sx * 0.25, 0.18, sz * 0.26);
  add(rbox(0.56, 0.03, 0.56, mats.oak, 0.006), 0, 0.37, 0); add(rbox(0.52, 0.08, 0.5, mats.pillowC, 0.03), 0, 0.42, 0.02);
  for (const sx of [-1, 1]) add(box(0.03, 0.42, 0.03, mats.oak), sx * 0.25, 0.58, -0.27); add(rbox(0.52, 0.34, 0.07, mats.pillowC, 0.03), 0, 0.64, -0.23).rotation.x = -0.18; add(rbox(0.3, 0.26, 0.1, mats.pillowA, 0.04), 0.08, 0.56, -0.14).rotation.set(-0.2, 0.2, 0);
  return g;
}
function mkSideTable() { const g = new THREE.Group(), t = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.025, 28), mats.oak), s = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.48, 8), mats.black), b = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.015, 24), mats.black); t.position.y = 0.5; s.position.y = 0.25; b.position.y = 0.008; for (const m of [t, s, b]) { m.castShadow = m.receiveShadow = true; g.add(m); } const c = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.09, 16), mats.terra); c.position.set(0.05, 0.557, 0); g.add(c); return g; } // жижиг дугуй ширээ + аяга

// ---------- Өрөөний хөтөлбөрүүд ----------
const DECOR = { bed: 0, art: 0, clock: 0, washer: 0 }; // байр даяар давтагдахгүй чимэглэл (зураг, цаг, толь, угаалгын машин)
const nextArt = () => DECOR.art++ % 6;
const ceilAt = (c, x, z) => { const r = c.r, e = Math.min(x - r.x, r.x + r.w - x, z - r.y, r.y + r.h - z); return plan.ceiling - (r.bh && e < 0.44 ? r.bh : 0); }; // таазны тавиурын доор бол доогуур
function floorPlant(c, name, h, k, near) { // шалны ургамал: буланд (хаалганаас хол, цонхны хажууд илүү)
  const p = proto(mkPlantG(name, h), k, { grp: k, deco: true }); if (!p) return null; const cands = [];
  const sc = (it, corner) => Math.min(2.5, ...c.zones.map((zz) => rdist(it.rect, zz))) + (c.wins.some((w) => rdist(it.rect, w) < 0.5) ? 1 : 0) + (near ? Math.max(0, 2 - rdist(it.rect, near.rect)) : 0) + (corner ? 0.8 : 0);
  for (const [x, z] of [[c.x0, c.z0], [c.x1, c.z0], [c.x0, c.z1], [c.x1, c.z1]]) { const it = at(p, x + (x === c.x0 ? 1 : -1) * (p.w / 2 + 0.04), z + (z === c.z0 ? 1 : -1) * (p.d / 2 + 0.04), 0); cands.push({ score: sc(it, 1), its: [it] }); }
  for (const s of SIDES) { const W = c.walls[s]; for (let t = W.a0 + 0.4; t <= W.a1 - 0.4; t += 0.25) { const it = at(p, ...wPt(c, s, t, Math.max(p.w, p.d) / 2 + 0.04), 0); cands.push({ score: sc(it, 0), its: [it] }); } }
  return put1(c, cands, k);
}
function curtains(c) { // цонх бүрийн хоёр талд маалинган хөшиг (тааз/тавиурын доороос шал хүртэл); хоёулаа багтахгүй бол алгасна
  const h = plan.ceiling - (c.r.bh || 0) - 0.02;
  for (const s of SIDES) { if (s === c.r.kitchen) continue; for (const o of c.walls[s].ops) { if (o.t !== 'win') continue; let ok = false; for (const w of [0.42, 0.32]) { const p = proto(P(w, 0.09, h, () => mkCurtain(w, h)), 'хөшиг', { grp: 'curt', wall: true, deco: true }), its = [onWall(c, p, s, o.lo - w / 2 + 0.1, 0.2), onWall(c, p, s, o.hi + w / 2 - 0.1, 0.2)]; its.forEach((it) => { it.curt = 1; }); if (!tryAdd(c, its)) { commit(c, its); ok = true; break; } } if (!ok) skip(c, 'хөшиг', 'цонхны хажууд зай алга'); } }
}
async function progBedroom(c) {
  // Ор: толгой нь хатуу хананд (хаалгатай хана, цонхны доороос зайлсхийнэ), хананы төвд, нэг талд ≥0.6 м, хөлд ≥0.7 м чөлөө
  const v = DECOR.bed++ % 2; // 0: модон банзан хана + LED + унжлага гэрэл; 1: зөөлөвчтэй хавтан + зураг + ширээний гэрэл (өрөө бүр өөр)
  const sh = Math.min(c.x1 - c.x0, c.z1 - c.z0), bw = sh > 3.2 ? 1.6 : sh > 2.7 ? 1.4 : 0.9, H = plan.ceiling;
  const head = proto(P(bw + 0.1, 0.08, 1.13, () => mkHeadboard(bw, !v)), 'орны толгой', { grp: 'bed' }), body = proto(P(bw + 0.04, 2.02, 0.7, () => mkBedBody(bw, v ? mats.duvet2 : mats.duvet)), 'ор', { grp: 'bed' }), cands = [], L = LAY.gap + head.d + body.d;
  for (const s of SIDES) {
    const W = c.walls[s], door = W.ops.some((o) => o.t === 'door'), win = W.ops.some((o) => o.t === 'win'), mid = (W.a0 + W.a1) / 2;
    for (const [a, b] of solid(c, s, 0, head.h)) for (const t of steps(a + head.w / 2, b - head.w / 2)) {
      const Hd = onWall(c, head, s, t), B = onWall(c, body, s, t, LAY.gap + head.d);
      const sides = [wRect(c, s, t - bw / 2 - 0.6, t - bw / 2, 0.5, L), wRect(c, s, t + bw / 2, t + bw / 2 + 0.6, 0.5, L)].filter((k) => inRoom(c, k)); if (!sides.length) continue;
      B.keep = [{ ...wRect(c, s, t - bw / 2, t + bw / 2, L, L + 0.7), reach: 1 }, ...sides];
      cands.push({ key: s + Math.round(t / 0.3), score: (door ? 0 : 2) + (win ? 0 : 0.5) + sides.length * 0.6 - Math.abs(t - mid) * 2 + (c.main ? Math.min(3, rdist(B.rect, c.main)) * 0.4 : 0), its: [Hd, B] });
    }
  }
  // Хувцасны шүүгээ: хатуу хэсэгт, урд нь 0.8 м чөлөө (цонх/тагтны хаалганы өмнө биш), буланд илүү
  const wm = v ? mats.oakV : mats.matteWhite, wps = [2.0, 1.8, 1.6, 1.4, 1.2, 1.1, 1.0].map((w) => proto(P(w, 0.62, 2.3, () => mkWardrobe(w, 2.3, wm)), 'хувцасны шүүгээ', { grp: 'ward' }));
  const wardC = () => { const wc = []; for (const p of wps) for (const s of SIDES) { const W = c.walls[s]; for (const [a, b] of solid(c, s, 0, p.h)) for (const t of steps(a + p.w / 2, b - p.w / 2)) { const it = onWall(c, p, s, t); it.keep = [{ ...wRect(c, s, t - p.w / 2, t + p.w / 2, LAY.gap + p.d, LAY.gap + p.d + 0.8), reach: 1 }]; wc.push({ score: p.w * 1.2 + (Math.min(t - p.w / 2 - W.a0, W.a1 - t - p.w / 2) < 0.03 ? 0.8 : 0), its: [it] }); } } return wc; };
  const WC = wardC(), ns = proto(P(0.45, 0.4, v ? 0.9 : 0.75, () => mkNightstand(!!v, !v)), 'орны шүүгээ', { grp: 'bed' }), nsAt = (Hd) => [-1, 1].map((k) => onWall(c, ns, Hd.side, Hd.t + k * (bw / 2 + 0.1 + ns.w / 2)));
  const bed = await put1L(c, cands, 'ор', (cc) => { // орыг сонгохдоо хоёр шүүгээ + хувцасны шүүгээ багтах эсэхийг урьдчилан харна
    const Hd = cc.items[cc.items.length - 2]; let n = 0; for (const it of nsAt(Hd)) if (!fits(cc, it)) { cc.items.push(it); n++; }
    const w = peek(cc, WC); cc.items.length -= n; return n * 0.4 + (w ? 1.5 + w.its[0].w : 0);
  });
  await c.tick();
  if (bed) {
    const { side: s, t } = bed[0];
    // Толгойн ханын хавтан: v0 — таазны тавиур хүртэл царс банз, v1 — 1.3 м зөөлөвчтэй хавтан (LED дээд захад); орны төвд тэгш хэмтэй
    const ph = v ? 1.3 : H - (c.r.bh || 0) - 0.02, span = solid(c, s, 0, ph).find(([a, b]) => a <= t + 1e-6 && b >= t - 1e-6); let pw = 0;
    if (span) { const W = Math.min(bw + (v ? 1.3 : 1.7), 2 * Math.min(t - span[0], span[1] - t) - 0.02); if (W >= bw + 0.3) { const pp = proto(P(W, 0.02, ph, () => (v ? mkUphPanel(W, ph) : mkFluted(W, ph, mats.oakV, false))), 'ханын хавтан', { grp: 'bed', wall: true }); if (add1(c, onWall(c, pp, s, t, 0))) pw = W; } }
    const nss = nsAt(bed[0]).map((it) => add1(c, it)).filter(Boolean).map((q) => q[0]);
    if (!v) for (const it of nss) { const top = ceilAt(c, it.x, it.z), pd = proto(P(0.22, 0.22, top - 1.2, () => mkPendant('globe', top - 1.2)), 'унжлага гэрэл', { grp: 'bed', y0: 1.2, ceil: true }); add1(c, at(pd, it.x, it.z, 0)); } // орны хажуугийн унжлага (шүүгээнээс 0.45 м дээш)
    if (v && pw) { const aw = Math.min(1.2, pw - 0.3), ah = 0.72, ap = proto(P(aw, 0.03, ah, () => mkArt(aw, ah, nextArt(), mats.oak)), 'зураг', { grp: 'bed', wall: true, deco: true, y0: 1.48 }); add1(c, onWall(c, ap, s, t, 0.025)); }
    else if (!pw) { const nF = head.w >= 1.5 ? 2 : 1; for (let i = 0; i < nF; i++) { const p = proto(P(0.5, 0.03, 0.66, () => mkArt(0.5, 0.66, nextArt())), 'зураг', { grp: 'bed', wall: true, deco: true, y0: 1.3 }); add1(c, onWall(c, p, s, t + (nF === 2 ? (i ? 0.33 : -0.33) : 0), 0.005)); } }
    rug(c, s, t, bw + 0.8, 0.62, [L + 0.6, L + 0.45], 'bed', v ? mats.rug2 : mats.rug); // хивс: орны доод 2/3 + хөлөөс ≥0.45 м гарна
  }
  put1(c, WC, 'хувцасны шүүгээ'); await c.tick();
  if (!v && bed) wallDeco(c, proto(P(0.6, 0.03, 0.8, () => mkArt(0.6, 0.8, nextArt())), 'зураг', { grp: 'art', wall: true, deco: true, y0: 1.15 }), bed[1]); // банзтай өрөөнд зураг өөр хананд
  curtains(c); if (v) floorPlant(c, 'potted_plant_02', 0.8, 'ургамал');
}
// Гал тогоо: эгнээ = хамгийн урт чөлөөт хана (цонхтой бол угаалтуур доор нь). Хувилбар бүр = хөргөгч (эгнээний төгсгөл / хөрш хана — булан эсвэл L эргэлтийн цаана) × плита (эгнээнд / L эргэлтэд) → оноо, дараа нь мөргөлдөөн + хөдөлгөөний зам.
// Хатуу дүрэм: плита цонхноос ≥0.3 м (цонхны доор ХЭЗЭЭ Ч биш, өөр байр байвал), хоёр талдаа ≥0.3 м тавцан, угаалтууртай хооронд ≥0.6 м. Хөргөгч хаалганы дэргэд (орох харагдацыг хаадаг) бол торгууль.
function progKitchen(c, sides) {
  let run = null;
  for (const s of sides) for (const [a, b] of bandIv(c, s, 0, 0.92, 0.66)) { const win = c.walls[s].ops.some((o) => o.t === 'win' && o.hi > a && o.lo < b), sc = b - a + (win ? 0.6 : 0); if (b - a >= 1.5 && (!run || sc > run.sc)) run = { s, a, b, sc }; }
  if (!run) return skip(c, 'гал тогооны эгнээ', 'чөлөөт хана алга (хаалга/цонх)');
  const { s } = run, W = c.walls[s], CD = 0.63, sgn = (q) => (q === 'N' || q === 'E' ? 1 : -1), sg = sgn(s), lo = s === 'N' || s === 'W', H = plan.ceiling;
  const cor = (t) => (Math.abs(t - W.a0) < 0.05 ? -1 : Math.abs(t - W.a1) < 0.05 ? 1 : 0), side2 = (k) => (alongX(s) ? (k > 0 ? 'E' : 'W') : (k > 0 ? 'S' : 'N'));
  const winOk = (q, t0, t1) => c.walls[q].ops.every((o) => o.t !== 'win' || o.sill > 2 || t1 <= o.lo - 0.3 || t0 >= o.hi + 0.3);
  const kp = (it, q, t0, t1) => { it.keep = [{ ...wRect(c, q, t0, t1, LAY.gap + it.d, LAY.gap + it.d + 0.9), reach: 1 }]; return it; };
  const mkF = (fw, q, t, hs, pn) => kp(onWall(c, proto(P(fw, 0.66, 2.24, () => mkFridge(fw, hs, pn)), 'хөргөгч', { grp: 'kit' }), q, t), q, t - fw / 2, t + fw / 2);
  const Lret = (k, a, b) => { // L эргэлт: 1.2 м (0.3 тавцан + 0.6 плита + 0.3 тавцан), булангийн тавцангийн ард
    if (cor(k > 0 ? b : a) !== k) return null; const q = side2(k), W2 = c.walls[q], di = lo ? 1 : -1, r0 = (lo ? W2.a0 : W2.a1) + di * (LAY.gap + CD), l0 = Math.min(r0, r0 + di * 1.2), l1 = l0 + 1.2, t2 = (l0 + l1) / 2;
    if (!bandIv(c, q, 0, 0.92, 0.66).some(([x, y]) => x <= l0 + 0.01 && y >= l1 - 0.01) || !winOk(q, t2 - 0.3, t2 + 0.3)) return null;
    return { q, t: t2, l0, l1, k, ret: kp(onWall(c, proto(P(1.2, CD, 0.92, () => mkCounter(1.2, null, 0, 0)), 'тавцан (L)', { grp: 'kit' }), q, t2), q, l0, l1), sc: 0.8 };
  };
  const cands = [];
  for (const fw of [0.6, 0.55]) {
    const F = [{ f: null, r: [run.a, run.b], sc: -3 }];
    for (const end of [0, 1]) { const k = cor(end ? run.b : run.a), t = end ? run.b - fw / 2 : run.a + fw / 2, hs = sg * (end ? -1 : 1); F.push({ f: mkF(fw, s, t, hs, k ? 0 : -hs), r: end ? [run.a, run.b - fw - 0.02] : [run.a + fw + 0.02, run.b], sc: 2 - (k ? 0.8 : 0) }); }
    for (const k of [-1, 1]) { if (cor(k > 0 ? run.b : run.a) !== k) continue; const q = side2(k), W2 = c.walls[q], di = lo ? 1 : -1, c0 = lo ? W2.a0 : W2.a1; for (const far of [0, 1]) { const t2 = c0 + di * (LAY.gap + CD + 0.02 + (far ? 1.2 : 0) + fw / 2), h2 = sgn(q) * -di; F.push({ f: mkF(fw, q, t2, h2, -h2), r: [run.a, run.b], sc: 1.6, adj: k, far }); } }
    for (const fo of F) {
      const [a, b] = fo.r, len = b - a, tc = (a + b) / 2; if (len < 1.2) continue;
      const wn = W.ops.find((o) => o.t === 'win' && o.hi > a + 0.3 && o.lo < b - 0.3), fs = fo.f && fo.f.side === s ? (fo.f.t < tc ? a : b) : null;
      const ts = wn ? Math.min(b - 0.35, Math.max(a + 0.35, (wn.lo + wn.hi) / 2)) : fs != null ? (fs === a ? a + 0.65 : b - 0.65) : a + Math.min(0.9, len * 0.35), tapH = wn && ts > wn.lo - 0.3 && ts < wn.hi + 0.3 ? Math.max(0.06, Math.min(0.28, wn.sill - 0.97)) : 0.28;
      const S = []; for (let t = a + 0.6; t <= b - 0.6 + 1e-6; t += 0.05) if (Math.abs(t - ts) >= 1.16 && winOk(s, t - 0.3, t + 0.3)) S.push({ q: s, t, sc: 1 - Math.abs(Math.abs(t - ts) - 1.3) * 0.3 });
      for (const k of [1, -1]) { if (fo.adj === k && !fo.far) continue; const L2 = Lret(k, a, b); if (L2) S.push(L2); }
      if (!S.length) { let best = null; for (let t = a + 0.35; t <= b - 0.35 + 1e-6; t += 0.05) { if (Math.abs(t - ts) < 0.9) continue; const d = Math.min(9, ...W.ops.filter((o) => o.t === 'win').map((o) => Math.max(o.lo - t - 0.3, t - 0.3 - o.hi))); if (!best || d > best.d) best = { q: s, t, d, near: d < 0.3, sc: d < 0.3 ? -4 : 0 }; } if (best) S.push(best); } // нөөц: цонхноос аль болох хол
      for (const st of S) {
        if (fo.far && !(st.ret && st.k === fo.adj)) continue; // L эргэлтийн цаадах хөргөгч зөвхөн тэр эргэлттэй
        const mp = proto(P(len, CD, 0.92, () => mkCounter(len, (ts - tc) * sg, tapH, st.q === s ? (st.t - tc) * sg : null)), 'тавцан', { grp: 'kit' }), main = kp(onWall(c, mp, s, tc), s, a, b);
        const fz = fo.f ? Math.min(9, ...c.zones.map((z) => rdist(fo.f.rect, z))) : 9, side = Math.min(ts - 0.26 - a, b - ts - 0.26);
        const score = fo.sc + st.sc + len * 0.3 + (fz < 0.5 ? -2.5 : 0) + (c.main && fo.f && rdist(fo.f.rect, c.main) < 1.2 ? -1.5 : 0) + (wn ? 0.5 : 0) + (side >= 0.4 ? 0.5 : 0);
        cands.push({ score, its: [...(fo.f ? [fo.f] : []), main, ...(st.ret ? [st.ret] : [])], info: { st, a, b } });
      }
    }
  }
  const pick = choose(c, cands); if (pick.fail) { skip(c, 'гал тогоо', pick.fail); return []; }
  commit(c, pick.its); const { st, a, b } = pick.info, keeps = pick.its.flatMap((i) => i.keep); if (st.near) c.log.push({ k: 'плита', note: 'цонхны ойр (өөр байр алга)' });
  // Яндан плитагийн дээр (тавцангаас 0.72 м), дээд шүүгээ (доор LED) — цонх/яндан/хөргөгчөөс бусад хатуу хэсэгт (≥0.25 м), хормой плита тавцан ↔ дээд шүүгээний хооронд
  const y0 = 1.62; add1(c, onWall(c, proto(P(0.6, 0.5, H - 0.1 - y0, () => mkHood(H - 0.1 - y0)), 'яндан', { grp: 'kit', wall: true, y0 }), st.q, st.t));
  for (const [q, u0, u1] of [[s, a, b], ...(st.ret ? [[st.q, st.l0, st.l1]] : [])]) {
    let iv = bandIv(c, q, 1.5, 2.2, 0.36, 0.25).map(([x, y]) => [Math.max(x, u0), Math.min(y, u1)]); if (st.q === q) iv = iv.flatMap(([x, y]) => [[x, Math.min(y, st.t - 0.31)], [Math.max(x, st.t + 0.31), y]]);
    for (const [x, y] of iv.filter(([x, y]) => y - x >= 0.25)) add1(c, onWall(c, proto(P(y - x - 0.01, 0.35, 0.7, () => mkUpper(y - x - 0.01)), 'дээд шүүгээ', { grp: 'kit', wall: true, y0: 1.5 }), q, (x + y) / 2));
    for (const [x, y] of solid(c, q, 0.9, 1.5).map(([x, y]) => [Math.max(x, u0), Math.min(y, u1)]).filter(([x, y]) => y - x >= 0.2)) add1(c, Object.assign(onWall(c, proto(P(y - x, 0.008, 0.6, () => mkBacksplash(y - x, 0.6)), 'хормой', { grp: 'kit', wall: true, deco: true, y0: 0.9 }), q, (x + y) / 2, 0), { curt: 1 }));
  }
  return keeps;
}
async function progDining(c, prefer, band, noLook = false) {
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
        cands.push({ key: L + '/' + th + '/' + Math.round(x / 0.3) + '/' + Math.round(z / 0.3), score: Math.min(4, chairs.length) * 1.5 + (sym ? 1.2 : 0) + L * 0.8 - d * 2 - bal * 0.6, its }); // тэгш хэмтэй (эсрэг талдаа хос) сандал илүү
      }
      await c.tick();
    }
  }
  // Урьдчилан харах: хэмжээ/чиглэл бүрийн шилдэг байрлалд зочны бүлэг (буйдан + ТВ) багтах эсэх
  const SC = c.r.type === 'living' && !noLook ? seatCands(c, band).cands : null, res = SC ? await put1L(c, cands, 'хоолны ширээ', (cc) => { const p = peek(cc, SC); return p ? 2 + p.score * 0.2 : 0; }) : put1(c, cands, 'хоолны ширээ'); if (!res) return null;
  // Унжлага: ширээний урт тэнхлэгийн дагуу 1–3 бүрхүүл, доод ирмэг ширээнээс 0.8 м дээш (1.55 м); ширээний төвд ваар
  const T = res[0], n = T.w >= 1.35 ? 3 : T.w >= 1.1 ? 2 : 1, sp = n === 3 ? 0.42 : 0.34, az = Math.abs(Math.sin(T.th)) > 0.5, py = 1.55;
  for (let i = 0; i < n; i++) { const u = (i - (n - 1) / 2) * sp, x = T.x + (az ? 0 : u), z = T.z + (az ? u : 0), top = ceilAt(c, x, z), pd = proto(P(0.3, 0.3, top - py, () => mkPendant('dome', top - py)), 'унжлага гэрэл', { grp: 'dine', y0: py, ceil: true }); add1(c, at(pd, x, z, 0)); }
  vLights.push({ x: T.x, y: 1.45, z: T.z, i: 2.2, d: 2.6, room: c.r.id, furn: true }); // унжлагын дулаан гэрэл (тавилга асаалттай үед л)
  add1(c, at(proto(P(0.28, 0.28, 0.12, mkFruitBowl), 'жимсний таваг', { grp: 'dine', y0: 0.751 }), T.x, T.z, 0));
  return T;
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
  if (cab) {
    // ТВ-ийн хана: хушга модон банз (fluted) таазны тавиур хүртэл, хоёр захад LED + хананд туяа; дэлгэцийн ард гэрэлтэлт (mkScreen)
    const ph = plan.ceiling - (c.r.bh || 0) - 0.02, span = solid(c, cab.side, 0, ph).find(([a, b]) => a <= cab.t + 1e-6 && b >= cab.t - 1e-6);
    if (span) { const W = Math.min(cab.w + 1.0, 2 * (Math.min(cab.t - span[0], span[1] - cab.t) - 0.45)); if (W >= cab.w + 0.2) add1(c, onWall(c, proto(P(W, 0.02, ph, () => mkFluted(W, ph, mats.walnut, true)), 'ТВ-ийн банз', { grp: 'seat', wall: true }), cab.side, cab.t, 0)); }
    const vp = proto(mdl('ceramic_vase_01'), 'ваар', { grp: 'seat', y0: cab.h + 0.001 }); if (vp) { let ok = false; for (const k of [1, -1]) { const it = onWall(c, vp, cab.side, cab.t + k * (cab.w / 2 - 0.2), LAY.gap + cab.d / 2 - vp.d / 2); if (!tryAdd(c, [it])) { commit(c, [it]); ok = true; break; } } if (!ok) skip(c, 'ваар', 'шүүгээн дээр зай алга'); }
  }
  if (table) add1(c, at(proto(P(0.3, 0.3, 0.12, mkTableDecor), 'ном + лаа', { grp: 'seat', y0: table.h + 0.001 }), table.x, table.z, 0));
  return { sofa, table, s };
}
function seatExtras(c, sp) { // зочны бүлгийн нэмэлт (хоолны ширээний дараа): түшлэгтэй сандал, том ургамал
  if (!sp || !sp.sofa) return; const { sofa, table, s } = sp, ct = proto(mdl('modern_coffee_table_01', 0.9), 'кофены ширээ', { rot0: Math.PI / 2 });
  // Түшлэгтэй сандал (зай байвал): кофены ширээний үзүүрт, ширээ рүү харсан (хананд наалдах эсвэл гарц үлдээх хүртэл ойртуулж/холдуулна)
  const ap = proto(mdl('modern_arm_chair_01', 0.95), 'түшлэгтэй сандал', { grp: 'seat' });
  if (ap && table) {
    const u = alongX(s) ? [1, 0] : [0, 1], n = { N: [0, 1], S: [0, -1], W: [1, 0], E: [-1, 0] }[s], ac = [];
    for (const k of [-1, 1]) for (const du of [0, -0.05, -0.1, -0.15, -0.2, 0.1]) for (const dv of [0, 0.15, -0.15]) { const d0 = ct.w / 2 + 0.3 + ap.d / 2 + du, x = table.x + u[0] * k * d0 + n[0] * dv, z = table.z + u[1] * k * d0 + n[1] * dv, it = at(ap, x, z, Math.atan2(-k * u[0], -k * u[1])); ac.push({ score: Math.min(2, ...c.zones.map((zz) => rdist(it.rect, zz))) * 0.5 - Math.abs(dv) - Math.abs(du) * 0.5, its: [it] }); }
    put1(c, ac, 'түшлэгтэй сандал');
  }
  floorPlant(c, 'potted_plant_01', 1.3, 'том ургамал', sofa);
}
// Хивс: хананаас o0..o1 гүн, дагуу w өргөн (дараалсан гүнээр оролдоно — хаалганы чөлөөнд орохгүй)
function rug(c, s, t, w, o0, o1s, grp, m = mats.rug) {
  for (const o1 of o1s) { const it = at(proto(P(w, o1 - o0, 0.01, () => flat(w, o1 - o0, m)), 'хивс', { grp, under: true, y0: 0.004, h: 0.01 }), ...wPt(c, s, t, (o0 + o1) / 2), FACE[s]); if (!tryAdd(c, [it])) return commit(c, [it]); }
  return skip(c, 'хивс', 'хаалганы чөлөөнд эсвэл өрөөнөөс гарна');
}
// Ханын чимэглэл (цаг, зураг, тавиур, листингийн зураг): хамгийн их чөлөөтэй хатуу хананы төвд, нээлхий/хүрээ/бусад ханын эд зүйлээс зайтай; near бол түүний ойролцоо
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
  let kk = null; if (band) { kk = progKitchen(c, [band]); await c.tick(); c.lookN = 20; dine = await progDining(c, kk || [], band); c.lookN = 0; await c.tick(); } // гал тогоо → хоолны хэсэг (шилжилтийн бүс) → зочны бүлэг
  const snap = [c.items.length, c.log.length, vLights.length]; let sp = progSeating(c, band); await c.tick();
  if (band && dine && !c.items.some((i) => i.k === 'ТВ-ийн шүүгээ')) { // ТВ багтсангүй → хоолны хэсгийг буцааж, зочны бүлгийг эхэлж байрлуулна
    const i0 = c.items.findIndex((i) => i.grp === 'dine'), l0 = c.log.findIndex((e) => e.k === 'хоолны ширээ'); c.items.length = i0 >= 0 ? i0 : snap[0]; c.log.length = l0 >= 0 ? l0 : snap[1]; vLights.length = snap[2] - 1; c.log.push({ k: 'дараалал', note: 'ТВ багтаагүй → зочны бүлэг эхэлж' });
    sp = progSeating(c, band); await c.tick(); dine = await progDining(c, kk || [], band, true); await c.tick();
  }
  seatExtras(c, sp); await c.tick(); const sofa = sp && sp.sofa;
  wallDeco(c, proto(P(1.1, 0.26, 1.46, () => mkShelves(1.1)), 'тавиур (хөвөгч)', { grp: 'shelf', wall: true, y0: 0.9 }), sofa); // LED-тэй хөвөгч тавиур
  if (!DECOR.clock++) wallDeco(c, proto(mdl('wall_clock'), 'цаг', { grp: 'clock', wall: true, deco: true, y0: 1.74 }), dine ? { rect: dine.rect } : null); // байранд ганц цаг
  curtains(c);
}
function progBath(c) {
  // Ванн (хаалганаас хол, хамгийн урт хатуу хана; ≥2.1 м² өрөөнд), суултуур (хаалганы эсрэг хананы төвд; хажуу бүрт ≥0.38 м), угаалтуур (том өрөөнд машин дээрх), LED толь — бүгд хаалганы чөлөөнд орохгүй
  const W = c.x1 - c.x0, D = c.z1 - c.z0, opp = c.main ? OPP[c.main.s] : null, big = W * D >= 2.1 && Math.min(W, D) >= 1.1;
  if (big) {
    const cands = [];
    for (const L of [1.7, 1.6, 1.5, 1.4, 1.3, 1.2]) for (const dd of [0.75, 0.7, 0.65, 0.6]) { const p = proto(P(L, dd, 0.72, () => mkTub(L, dd)), 'ванн', { grp: 'tub' }); for (const s of SIDES) for (const [a, b] of solid(c, s, 0, p.h)) for (const t of steps(a + L / 2, b - L / 2)) { const it = onWall(c, p, s, t); cands.push({ score: L * 2 + dd + (c.main ? Math.min(2, rdist(it.rect, c.main)) * 0.5 : 0), its: [it] }); } }
    put1(c, cands, 'ванн');
  } else skip(c, 'ванн', 'өрөө жижиг (WC)');
  const wp = proto(P(0.38, 0.62, 1.05, mkWC), 'суултуур', { grp: 'wc' }), wcs = [];
  for (const s of SIDES) { const Wl = c.walls[s]; for (const [a, b] of solid(c, s, 0, wp.h)) for (const t of steps(a + 0.38, b - 0.38, 0.05)) { const it = onWall(c, wp, s, t); it.keep = [wRect(c, s, t - 0.3, t + 0.3, LAY.gap + wp.d, LAY.gap + wp.d + 0.5), wRect(c, s, t - 0.38, t + 0.38, 0, LAY.gap + wp.d)]; wcs.push({ score: (s === opp ? 1 : 0) - Math.abs(t - (Wl.a0 + Wl.a1) / 2) * 0.6, its: [it] }); } }
  const wc = put1(c, wcs, 'суултуур'), wr = wc && wc[0].rect, vc = [];
  for (const [w, dd, ws] of [...(big && !DECOR.washer ? [[0.6, 0.55, 1], [0.6, 0.45, 1]] : []), [0.6, 0.45], [0.5, 0.45], [0.45, 0.4], [0.4, 0.3]]) {
    const p = proto(P(w + 0.02, dd + (ws ? 0.03 : 0.01), ws ? 1.14 : 1.06, ws ? () => mkWasherSink(dd) : () => mkVanity(w, dd)), ws ? 'угаалтуур + угаалгын машин' : 'угаалтуур', { grp: 'sink' });
    for (const s of SIDES) for (const [a, b] of solid(c, s, 0, p.h)) for (const t of steps(a + p.w / 2, b - p.w / 2)) { const it = onWall(c, p, s, t); if (wr && rdist(it.rect, wr) < 0.22) continue; it.keep = [wRect(c, s, t - p.w / 2, t + p.w / 2, LAY.gap + p.d, LAY.gap + p.d + 0.5)]; vc.push({ score: w + (ws ? 1.5 : 0) - (c.main ? rdist(it.rect, c.main) * 0.2 : 0), its: [it] }); }
  }
  const v = put1(c, vc, 'угаалтуур'); if (v && v[0].k.includes('машин')) DECOR.washer = 1;
  const mw = v && Math.min(0.55, v[0].w - 0.04), mp = v && proto(P(mw, 0.03, 0.75, () => mkMirror(mw, 0.75, 'led')), 'толь (LED)', { grp: 'sink', wall: true, deco: true, y0: 1.2 });
  if (mp) { const Wv = c.walls[v[0].side]; add1(c, onWall(c, mp, v[0].side, Math.min(Wv.a1 - mp.w / 2 - 0.03, Math.max(Wv.a0 + mp.w / 2 + 0.03, v[0].t)), 0.005)); }
  if (!v && wc) add1(c, onWall(c, proto(P(0.5, 0.16, 0.3, () => mkBathShelf(0.5)), 'тавиур', { grp: 'wc', wall: true, deco: true, y0: 1.25 }), wc[0].side, wc[0].t, 0.005)); // WC: суултуурын дээр тавиур (ургамал, алчуур)
}
function progHall(c) {
  // Орцны хувцасны шүүгээ (УБ өвөл — зузаан хувцас), вандан + өлгүүр, орцны эсрэг хананд хөвөгч консол + дугуй толь (анхны харагдац); цаг байхгүй (байранд ганц — зочны өрөөнд)
  const ent = c.zones.find((z) => z.door.to === 'out') || c.main, nar = Math.min(c.x1 - c.x0, c.z1 - c.z0), ec = (s) => (ent ? (alongX(s) ? (ent.x0 + ent.x1) / 2 : (ent.z0 + ent.z1) / 2) : 0);
  if (nar < 1.2) { skip(c, 'хувцасны шүүгээ', 'коридор хэт нарийн (<1.2 м)'); return; }
  if (nar >= 1.6) {
    const wc = []; for (const w of [1.8, 1.6, 1.4, 1.2, 1.0]) { const p = proto(P(w, 0.6, 2.3, () => mkWardrobe(w, 2.3, mats.oakV)), 'хувцасны шүүгээ (орц)', { grp: 'ward' }); for (const s of SIDES) for (const [a, b] of solid(c, s, 0, p.h)) for (const t of steps(a + w / 2, b - w / 2)) { const it = onWall(c, p, s, t); it.keep = [{ ...wRect(c, s, t - w / 2, t + w / 2, LAY.gap + p.d, LAY.gap + p.d + 0.7), reach: 1 }]; wc.push({ score: w * 1.5 - (ent ? rdist(it.rect, ent) : 0) * 0.8 + (ent && s === ent.s ? 1.2 : 0) - (ent && s === OPP[ent.s] ? 1 : 0), its: [it] }); } }
    put1(c, wc, 'хувцасны шүүгээ (орц)');
  } else skip(c, 'хувцасны шүүгээ (орц)', 'коридор нарийн (<1.6 м)');
  const bc = []; for (const w of [1.0, 0.8]) { const bp = proto(P(w, 0.4, 0.53, () => mkBench(w)), 'вандан', { grp: 'bench' }), hp = proto(P(w, 0.2, 1.1, () => mkHooks(w)), 'өлгүүр', { grp: 'bench', wall: true, y0: 0.66 }); for (const s of SIDES) for (const [a, b] of solid(c, s, 0, 1.76)) for (const t of steps(a + w / 2, b - w / 2)) bc.push({ score: w - Math.abs((ent ? rdist(onWall(c, bp, s, t).rect, ent) : 1.2) - 1.2) * 0.7, its: [onWall(c, bp, s, t), onWall(c, hp, s, t, 0.005)] }); }
  put1(c, bc, 'вандан + өлгүүр');
  const cp = proto(P(0.9, 0.3, 0.33, () => mkConsole(0.9)), 'консол', { grp: 'cons', wall: true, y0: 0.8 }), mp = proto(P(0.7, 0.03, 0.7, () => mkMirror(0.7, 0.7, 'round')), 'толь (дугуй)', { grp: 'cons', wall: true, deco: true, y0: 1.28 }), cc = [];
  for (const s of SIDES) for (const [a, b] of solid(c, s, 0.8, 1.98)) for (const t of steps(a + 0.45, b - 0.45, 0.05)) cc.push({ score: (ent && s === OPP[ent.s] ? 2 : 0) - Math.abs(t - ec(s)) * 0.8, its: [onWall(c, cp, s, t, 0.005), onWall(c, mp, s, t, 0.005)] });
  put1(c, cc, 'консол + толь');
}
function progBalcony(c) {
  // Тагт: хаалганаас хол төгсгөлд сандал + жижиг ширээ, ургамал (хаалга хоорондын зам чөлөөтэй); нарийн тагтанд зөвхөн ургамал
  if (Math.min(c.r.w, c.r.h) < 1.0) return skip(c, 'ургамал', 'тагт нарийн (<1.0 м)');
  const lx = c.x1 - c.x0 >= c.z1 - c.z0, ch = proto(P(0.56, 0.6, 0.8, mkLounge), 'сандал', { grp: 'lounge' }), stp = proto(P(0.4, 0.4, 0.6, mkSideTable), 'жижиг ширээ', { grp: 'lounge' }), cc = [];
  for (const end of [0, 1]) { const sd = lx ? (end ? 'E' : 'W') : (end ? 'S' : 'N'), th = FACE[sd], dz = [0, 0.08, -0.08]; for (const o of dz) { const [x, z] = wPt(c, sd, (lx ? (c.z0 + c.z1) / 2 : (c.x0 + c.x1) / 2) + o, LAY.gap + ch.d / 2), chair = at(ch, x, z, th, { side: sd }), [tx, tz] = wPt(c, sd, (lx ? c.z0 + 0.25 : c.x0 + 0.25), LAY.gap + ch.d + 0.28), tb = at(stp, tx, tz, 0, { side: sd }); cc.push({ score: Math.min(3, ...c.zones.map((zz) => rdist(chair.rect, zz))) - Math.abs(o), its: [chair, tb] }); } }
  const lg = put1(c, cc, 'сандал + ширээ');
  const p2 = proto(mkPlantG('potted_plant_02', 0.7), 'ургамал', { grp: 'plant0', deco: true });
  if (p2 && lg) { const sd = lg[0].side, cands = []; for (let u = 0.9; u <= 2.2; u += 0.1) { const [x, z] = wPt(c, sd, lx ? c.z0 + p2.d / 2 + 0.03 : c.x0 + p2.w / 2 + 0.03, u); cands.push({ score: -u * 0.3, its: [at(p2, x, z, 0)] }); } put1(c, cands, 'ургамал'); }
  const p = proto(P(0.23, 0.23, 0.76, mkPlant), 'ургамал (жижиг)', { grp: 'plant1', deco: true }), cands = [];
  for (const [x, z] of [[c.x0, c.z0], [c.x1, c.z0], [c.x0, c.z1], [c.x1, c.z1]]) { const it = at(p, x + (x === c.x0 ? 1 : -1) * (p.w / 2 + 0.03), z + (z === c.z0 ? 1 : -1) * (p.d / 2 + 0.03), 0); cands.push({ score: Math.min(3, ...c.zones.map((zz) => rdist(it.rect, zz))), its: [it] }); }
  put1(c, cands, 'ургамал (жижиг)');
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
const MODEL_LIST = ['modern_wooden_cabinet', 'modern_coffee_table_01', 'modern_arm_chair_01', 'ceramic_vase_01', 'ceramic_vase_03', 'ceramic_vase_04', 'wall_clock', 'potted_plant_01', 'potted_plant_02', 'potted_plant_04'];
let furP = null; const layP = {};
const loadFur = () => (furP ||= Promise.all(MODEL_LIST.map(async (n) => { FUR[n] = await loadModel(n); })).then(() => { // ургамлын вааз хэт нягт (60–120k гурвалжин) → 28 талт цилиндр (зөвхөн *_pot зангилаа; иш/навч хэвээр) — Intel UHD-д гурвалжин ~40% ↓
  for (const k of ['potted_plant_01', 'potted_plant_02']) if (FUR[k]) FUR[k].traverse((o) => { if (!o.isMesh || !/_pot$/.test(o.name)) return; o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox, sz = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3()), r = Math.max(sz.x, sz.z) / 2, cy = new THREE.CylinderGeometry(r, r * 0.78, sz.y, 28, 1); cy.translate(c.x, c.y, c.z); o.geometry = cy; });
}));
const layoutRoom = (r) => (layP[r.id] ||= (async () => { await loadFur(); await brk(); try { await furnish(r); } catch (e) { console.error('furnish', r.id, e); } furnDirty = true; })());
async function ensureFurn() { for (const r of rooms) await layoutRoom(r); furnReady = true; refreshStops(); }
async function furnish(r) {
  const c = roomCtx(r), g = new THREE.Group(), T = r.type; let ms = 0, mx = 0, t0 = performance.now(); roomLay[r.id] = c;
  c.tick = async () => { const d = performance.now() - t0; ms += d; mx = Math.max(mx, d); await brk(); t0 = performance.now(); }; // тооцооны цэвэр хугацаа (амсхийлтгүй) + хамгийн урт тасралтгүй хэсэг
  if (T === 'living') await progLiving(c); else if (T === 'bedroom') await progBedroom(c); else if (T === 'kitchen') { const k = progKitchen(c, SIDES); await c.tick(); await progDining(c, k, null); curtains(c); } else if (T === 'bath') progBath(c);
  else if (T === 'hall') progHall(c); else if (T === 'office') progOffice(c); else if (T === 'other') progShelves(c, 2); else if (T === 'balcony') progBalcony(c);
  // «Тохижуулах» дараалал: хивс → том эд зүйлс (талбайгаар) → ханын/жижиг чимэглэл; эд зүйл бүрийн доторх ижил материалтай mesh нэгтгэнэ (draw call ↓)
  const rank = (it) => (it.under ? 0 : it.floor ? 1 : 2);
  for (const it of c.items.filter((o) => o.obj).sort((p, q) => rank(p) - rank(q) || (rank(p) === 1 ? q.w * q.d - p.w * p.d : 0))) { mergeByMat(it.obj); g.add(it.obj); }
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
  scene.add(new THREE.HemisphereLight(0xfff3e4, 0xcdbba5, 0.32)); // интерьерт дулаан, сул дүүргэлт (гол гэрэл — өрөөний 3000K гэрлүүд)
  const sun = new THREE.DirectionalLight(0xffe2b8, 2.0); sun.position.set(b.x + b.w / 2 - 10, 13, b.y + b.h / 2 + 16); // орой нар баруун-өмнөөс (УБ: өмнөд цонх) sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.0004;
  const s = Math.max(b.w, b.h) + 4; Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 60 }); sun.target.position.set(b.x + b.w / 2, 0, b.y + b.h / 2); scene.add(sun, sun.target);
  scene.add(new THREE.AmbientLight(0xffe9d2, 0.1));
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
    const r = byId[order[i]], sp = stopPose(r, i === 0 && r.id === plan.entry); pts.push({ x: sp.x, z: sp.z, yawC: sp.yaw, room: r.id, pause: true });
    if (i + 1 < order.length) {
      const seq = pathBetween(order[i], order[i + 1]);
      for (let k = 0; k + 1 < seq.length; k++) { const m = doorMid(seq[k], seq[k + 1]); if (m) pts.push({ x: m[0], z: m[1], room: seq[k + 1] }); if (k + 2 < seq.length) { const rr = byId[seq[k + 1]]; pts.push({ x: rr.x + rr.w / 2, z: rr.y + rr.h / 2, room: rr.id }); } }
    }
  }
  return pts;
}
function refreshStops() { tourPts.forEach((p, i) => { if (!p.pause || (i === tourI && pauseT > 0)) return; const sp = stopPose(byId[p.room], i === 0 && p.room === plan.entry); Object.assign(p, { x: sp.x, z: sp.z, yawC: sp.yaw }); }); } // тавилга асаахад зогсоолыг тавилгаас зайлуулна
// Зогсоолын ракурс (интерьер рендерийн хэв маяг): өрөөний тэнхлэгийн дагуу нэг цэгийн перспектив — арын хананаас 0.35–1.3 м (жижиг өрөөнд хаалганы нээлхийд), хөндлөнгөөр төвд (тэгш хэм),
// тавилгаас ≥0.3 м, өмнө нь 1.4 м дотор өндөр эд зүйл байхгүй; харах чиглэл = гүн + цонх/тагтны хаалгатай хана; орцонд — орцны хаалганы шугам дээр коридорын тэнхлэгээр
const edgeOf = (r, s) => (s === 'N' ? { axis: 'x', c: r.y, a: r.x, b: r.x + r.w } : s === 'S' ? { axis: 'x', c: r.y + r.h, a: r.x, b: r.x + r.w } : s === 'W' ? { axis: 'y', c: r.x, a: r.y, b: r.y + r.h } : { axis: 'y', c: r.x + r.w, a: r.y, b: r.y + r.h });
function stopPose(r, entry = false) {
  const obs = furnGroup.visible ? Object.entries(roomLay).flatMap(([id, c]) => c.items.filter((o) => o.obj && !o.under && !o.ceil && o.y0 < 1.5 && o.h > 0.2).map((o) => ({ ...o.rect, tall: o.h > 1.1 && !o.wall, rid: id }))) : [], small = Math.min(r.w, r.h) < 2.05;
  const x0 = r.x + WALL_T, x1 = r.x + r.w - WALL_T, z0 = r.y + WALL_T, z1 = r.y + r.h - WALL_T, oth = (d) => byId[d.a === r.id ? d.b : d.a];
  const dOn = (s) => plan.doors.filter((d) => (d.a === r.id || d.b === r.id) && segOnEdge(d, edgeOf(r, s))), mid = (d, ax) => (ax ? (d.x1 + d.x2) / 2 : (d.y1 + d.y2) / 2);
  const glass = (s) => plan.windows.filter((w) => w.room === r.id && segOnEdge(w, edgeOf(r, s))).length + dOn(s).filter((d) => oth(d) && oth(d).type === 'balcony').length;
  const out = plan.doors.find((d) => d.b === 'out' && d.a === r.id), bal = r.type === 'balcony'; let best = null;
  for (const [s, yaw] of [['N', 0], ['S', Math.PI], ['W', Math.PI / 2], ['E', -Math.PI / 2]]) {
    const ax = alongX(s), cA = ax ? (x0 + x1) / 2 : (z0 + z1) / 2, wA = ax ? x1 - x0 : z1 - z0, bk = { N: z1, S: z0, W: x1, E: x0 }[s], far = { N: z0, S: z1, W: x0, E: x1 }[s], sg = Math.sign(far - bk), bd = dOn(OPP[s]);
    const acr = [0, 0.15, -0.15, 0.3, -0.3, 0.5, -0.5].filter((d) => Math.abs(d) <= wA / 2 - 0.3).map((d) => [cA + d, 0]); for (const d of bd) acr.push([mid(d, ax), 1]); // хаалганы нээлхийн төв
    const dm = [0.35, 0.5, 0.7, 0.9, 1.1, 1.3]; let em = null; if (entry && out && !segOnEdge(out, edgeOf(r, s)) && !segOnEdge(out, edgeOf(r, OPP[s]))) { em = Math.abs(mid(out, !ax) - bk); dm.push(em); } // орцны хаалганы шугам (коридорын тэнхлэг)
    const dd = new Set(); if (bal) for (const q of SIDES) if (q !== s && q !== OPP[s]) for (const d of dOn(q)) { const mm = Math.abs(mid(d, !ax) - bk); dm.push(mm); dd.add(mm); } // тагт: хаалганы шугам дээрээс (урт коридор биш, булан руу)
    for (const [aP, inD] of acr) for (const m of inD ? (small ? [-0.6, -0.08] : [0.35, 0.5]) : dm) {
      const vd = r.type === 'hall' ? dOn(s).filter((d) => (!oth(d) || oth(d).type !== 'balcony') && Math.abs(mid(d, ax) - aP) < 0.5)[0] : null, vt = !!vd, vq = vd ? 0.5 - Math.abs(mid(vd, ax) - aP) + (oth(vd) && /living|bedroom|kitchen/.test(oth(vd).type) ? 0.5 : 0) : 0, dP = bk + sg * m, D = Math.abs(far - dP) + (vt ? 1.5 : 0); if (D < 1.2) continue; const x = ax ? aP : dP, z = ax ? dP : aP; // vt: цаад хананы хаалгаар цааш харна
      if (m >= 0 ? x < x0 + 0.25 || x > x1 - 0.25 || z < z0 + 0.25 || z > z1 - 0.25 : !roomAt(x, z, 0.2) && m < -0.3) continue;
      if (obs.some((o) => Math.hypot(Math.max(o.x0 - x, 0, x - o.x1), Math.max(o.z0 - z, 0, z - o.z1)) < 0.3)) continue;
      const vx0 = ax ? x - 0.25 : Math.min(x, x + sg * 1.3), vx1 = ax ? x + 0.25 : Math.max(x, x + sg * 1.3), vz0 = ax ? Math.min(z, z + sg * 1.3) : z - 0.25, vz1 = ax ? Math.max(z, z + sg * 1.3) : z + 0.25, blk = obs.some((o) => o.tall && o.x0 < vx1 && o.x1 > vx0 && o.z0 < vz1 && o.z1 > vz0), nearLow = obs.some((o) => !o.tall && o.x0 < vx1 && o.x1 > vx0 && o.z0 < vz1 && o.z1 > vz0 && Math.hypot(Math.max(o.x0 - x, 0, x - o.x1), Math.max(o.z0 - z, 0, z - o.z1)) < 0.9); // урд 0.9 м-т нам эд зүйл (сандал) ракурсыг хаана
      const cont = obs.filter((o) => { if (o.rid !== r.id) return false; const cx = (o.x0 + o.x1) / 2 - x, cz = (o.z0 + o.z1) / 2 - z, fw = -Math.sin(yaw) * cx - Math.cos(yaw) * cz, lat = Math.cos(yaw) * cx - Math.sin(yaw) * cz; return fw > 0.3 && fw < 4.5 && Math.abs(lat) < fw * 0.9; }).length; // харагдах тавилга (баатар ракурс)
      const sc = Math.min(D, bal ? 3 : 6) + Math.min(1.5, cont * 0.25) + (dd.has(m) ? 1 : 0) + glass(s) * 1.2 + (bd.length ? 0.5 : 0) - Math.abs(aP - cA) * (inD ? 1.2 : 2.2) - (m === em || dd.has(m) ? 0 : Math.abs(m - 0.55) * 0.6) - (blk ? 3 : 0) + (D >= wA ? 0.8 : 0) + (vt ? 0.8 + vq : dOn(s).some((d) => !oth(d) || oth(d).type !== 'balcony') ? 0.3 : 0) + (em != null && m === em ? 4 : 0) - (nearLow ? 1.5 : 0) + (r.kitchen && s === OPP[r.kitchen] ? 0.8 : 0);
      if (!best || sc > best.sc) best = { x, z, yaw, sc };
    }
  }
  return best || { x: r.x + r.w / 2, z: r.y + r.h / 2, yaw: 0 };
}

// ---------- Камер, удирдлага ----------
const cam = { x: 0, z: 0, yaw: 0, pitch: 0 };
function enterRoom(r) { const sp = stopPose(r); cam.x = sp.x; cam.z = sp.z; cam.yaw = sp.yaw; cam.pitch = 0; if (camera) stepFov(0, true); } // автомат аяллын зогсоолтой ижил ракурс, түвшин тэнцүү
const keys = {};
let mode = 'auto', tourPts = [], tourI = 0, pauseT = 0, sweep = 0;
function setMode(m) {
  mode = m; $('#bAuto').classList.toggle('on', m === 'auto'); $('#bFree').classList.toggle('on', m === 'free');
  if (m === 'free') stagingReset();
  // Автомат руу шилжихэд маршрутыг ОДОО байгаа өрөөнөөс үргэлжлүүлнэ (хана нэвтлэн эхлэл рүү шууд явахгүй)
  if (m === 'auto' && tourPts.length) {
    const r = roomAt(cam.x, cam.z); const i = r ? tourPts.findIndex((p) => p.pause && p.room === r.id) : -1;
    if (i >= 0) { tourI = i; const p = tourPts[i]; if (Math.hypot(p.x - cam.x, p.z - cam.z) < 0.05) { p.yaw0 = p.yawC ?? cam.yaw; sweep = 0; pauseT = AUTO.pausePlain; } else pauseT = 0; }
    if (phase === 'ext' || phase === 'pano') phase = 'walk';
  }
}
function moveTo(x, z) { if (walkable(x, z)) { cam.x = x; cam.z = z; return true; } if (walkable(x, cam.z)) { cam.x = x; return true; } if (walkable(cam.x, z)) { cam.z = z; return true; } return false; }
// Автомат аялал (анхдагч): гадаах 360° цэгүүд → орц → өрөө бүр. Хөдөлгөөн удаан, жигд (0.75 м/с, эргэлт зөөлөн);
// өрөөнд 360° панорам байвал тэр өрөөнд хүрмэгц панорам руу зөөлөн шилжиж бүтэн эргэж үзүүлнэ, дараа нь буцна.
const AUTO = { walk: 0.75, turn: 1.6, pausePlain: 10, panoSpin: 16, extSpin: 12, spinRate: (2 * Math.PI) / 16 };
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
  furnGroup.visible = on; stagingReset(); furnDirty = true; refreshStops(); Q.hold = performance.now() + 2500; // furnDirty: шэйдер компиляц + сүүдэр дараагийн frame-д; зогсоолууд тавилгаас зайлна; компиляцын гацалтыг FPS-т тооцохгүй
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
  if (phase === 'splat') return; // бодит 3D өрөө (tour-media) — гарахад phase='walk'
  if (phase === 'pano') { if (!panoActive) return; panoT += dt; cam.yaw += AUTO.spinRate * dt; cam.pitch += (-0.02 - cam.pitch) * 0.03; if (panoT >= AUTO.panoSpin) { phase = 'walk'; fadeTo(() => { hidePano(); cam.yaw = p.yaw0; pauseT = 0.8; }); } return; }
  // 3) өрөөний төвд зогсоод зөөлөн эргэж харах
  // Зогсоол: эхний 3 с ракурсаа барина (тэнхлэгийн дагуу, тэнгэрийн хаяа түвшин), дараа нь ±0.75 рад зөөлөн эргэж буцна; pitch = 0 (босоо шугам босоо)
  if (p.pause && pauseT > 0) { pauseT -= dt; sweep += dt; const ty = p.yaw0 + (sweep < 3 ? 0 : Math.sin((sweep - 3) * 2 * Math.PI / Math.max(4, AUTO.pausePlain - 3)) * 0.75); let d = ty - cam.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); cam.yaw += d * Math.min(1, dt * 2.4); cam.pitch += (0 - cam.pitch) * Math.min(1, dt * 4); if (pauseT <= 0) { tourI = (tourI + 1) % tourPts.length; if (tourI === 0 && EXT) { const oh = EXT.segs.find((q) => q.kind === 'orbitHome'); goExterior(oh ? oh.t0 : 0); return; } if (tourI === 0 && extNodes.length) { phase = 'ext'; extI = 0; extT = 0; fadeTo(() => showPano(extNodes[0], true)); } } return; }
  // 4) явах
  const dx = p.x - cam.x, dz = p.z - cam.z, dist = Math.hypot(dx, dz);
  const targetYaw = Math.atan2(-dx, -dz);
  let dy = targetYaw - cam.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); cam.yaw += dy * Math.min(1, dt * AUTO.turn);
  cam.pitch += (0 - cam.pitch) * Math.min(1, dt * 4);
  const sp = AUTO.walk * dt;
  if (dist <= sp) {
    cam.x = p.x; cam.z = p.z;
    if (p.pause) { p.yaw0 = p.yawC ?? cam.yaw; sweep = 0; const pn = panoByRoom[p.room];
      if (MEDIA && MEDIA.splatByRoom[p.room]) { phase = 'splat'; pauseT = 0; enterSplatMode(p.room, true, () => { phase = 'walk'; cam.yaw = p.yaw0; pauseT = 0.8; }); return; }
      if (pn) { phase = 'pano'; panoT = 0; pauseT = 0; fadeTo(() => showPano(pn, false)); } else { pauseT = AUTO.pausePlain; stageRoom(p.room); } }
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
  c.addEventListener('pointermove', (e) => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY }; if ((SCENE_MODE === 'walk' || SCENE_MODE === 'splat') && MEDIA) { MEDIA.drag(dx, dy); return; } if (SCENE_MODE === 'exterior' && EXT) { if (Math.abs(dx) + Math.abs(dy) > 1) { EXT.drag(dx, dy); markModeButtons(); } return; } if (mode === 'auto' && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) setMode('free'); cam.yaw -= dx * 0.004; cam.pitch = Math.max(-1.2, Math.min(1.2, cam.pitch - dy * 0.003)); });
  c.addEventListener('pointerup', () => { drag = null; }); c.addEventListener('pointercancel', () => { drag = null; });
  const keyOf = (e) => (e.key.length === 1 ? e.key.toLowerCase() : e.key);
  window.addEventListener('keydown', (e) => { const k = keyOf(e); keys[k] = true; if (['w', 'a', 's', 'd', 'q', 'e', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) { if (SCENE_MODE === 'exterior' && EXT) { EXT.setFree(true); markModeButtons(); } else setMode('free'); e.preventDefault(); } });
  window.addEventListener('keyup', (e) => { keys[keyOf(e)] = false; });
  document.querySelectorAll('.pad button').forEach((b) => { const k = b.dataset.k; const on = (e) => { e.preventDefault(); keys[k] = true; setMode('free'); }; const off = () => { keys[k] = false; }; b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off); });
  $('#bAuto').onclick = () => { if (SCENE_MODE === 'exterior' && EXT) { EXT.setFree(false); markModeButtons(); return; } if (panoActive) togglePano(); setMode('auto'); };
  $('#bOut').onclick = () => goExterior(0); $('#bIn').onclick = () => goInterior();
  $('#bWalk').onclick = () => startWalkMode(); $('#b3D').onclick = () => { if (curRoomId && MEDIA && MEDIA.splatByRoom[curRoomId]) { setMode('free'); enterSplatMode(curRoomId, false, null); } };
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
    const sg = new THREE.SphereGeometry(8, 64, 40); sg.scale(-1, 1, 1); // дотроос толин тусгалгүй (BackSide нь зургийг урвуулдаг байв)
    panoMesh = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ map: t }));
    panoMesh.position.set(cam.x, EYE, cam.z); scene.add(panoMesh); panoActive = true; panoMesh.userData.exterior = exterior;
    $('#bPano').classList.add('on'); $('#bPano').textContent = '✕ 360° хаах'; $('#bPano').style.display = '';
    if (exterior) { $('#rName').textContent = a.label || 'Гадаах орчин'; $('#rArea').textContent = '360° панорам'; }
  };
  if (panoTexCache[a.id]) return apply(panoTexCache[a.id]);
  $('#bPano').textContent = '360° ачаалж…';
  const load = (url, cb) => texLoader.load(url, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; cb(t); }, undefined, () => { $('#bPano').textContent = '360° панорам'; });
  if (a.preview) load(a.preview, (t) => { if (!panoTexCache[a.id]) apply(t); load(a.url, (tf) => { panoTexCache[a.id] = tf; if (panoActive && panoMesh) { panoMesh.material.map = tf; panoMesh.material.needsUpdate = true; } }); }); // эхлээд 2048, дараа нь бүтэн
  else load(a.url || assetUrl(a.id), (t) => { panoTexCache[a.id] = t; apply(t); });
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
  document.body.classList.toggle('touring', auto && SCENE_MODE === 'exterior');
  $('#bOut').classList.toggle('on', SCENE_MODE === 'exterior'); $('#bIn').classList.toggle('on', SCENE_MODE === 'interior'); $('#bWalk').classList.toggle('on', SCENE_MODE === 'walk');
}
function showInteriorHud(on) { for (const q of ['.room', '.help']) { const el = $(q); if (el) el.style.display = on ? '' : 'none'; } $('#bFurn').style.display = on ? '' : 'none'; }
function goExterior(at = 0) {
  if (!EXT) return;
  fadeTo(() => { if (MEDIA) MEDIA.stopAll(); SCENE_MODE = 'exterior'; if (panoActive) hidePano(true); EXT.setVisible(true); showInteriorHud(false); EXT.start(at); markModeButtons(); });
}
// Бодит алхалтын бичлэг (гадна → орц, шат) — дуусмагц байрны дотор
function startWalkMode() {
  if (!MEDIA || !MEDIA.hasWalk) return goInterior();
  fadeTo(() => { if (panoActive) hidePano(true); SCENE_MODE = 'walk'; if (EXT) EXT.setVisible(false); showInteriorHud(false); MEDIA.startWalk(() => goInterior()); markModeButtons(); });
}
// Бодит 3D өрөө (splat): auto бол 20 с эргээд буцна
function enterSplatMode(roomId, auto, after) {
  fadeTo(() => { if (panoActive) hidePano(true); SCENE_MODE = 'splat'; showInteriorHud(false); markModeButtons();
    MEDIA.enterSplat(roomId, { auto, name: (byId[roomId] || {}).name || 'Бодит 3D', onExit: () => fadeTo(() => { SCENE_MODE = 'interior'; showInteriorHud(true); markModeButtons(); if (after) after(); }) }); });
}
// Орцны хаалганаас 0.7 м дотор, өрөөний хамгийн урт чөлөөтэй чиглэл рүү харна (ханыг ширтэхгүй)
function entryPose() {
  const e = byId[plan.entry] || rooms[0]; cam.x = e.x + e.w / 2; cam.z = e.y + e.h / 2; cam.pitch = 0;
  const ent = plan.doors.find((d) => d.b === 'out'); if (!ent) return;
  if (ent.a === e.id) { const sp = stopPose(e, true); cam.x = sp.x; cam.z = sp.z; cam.yaw = sp.yaw; return; } // орцны хаалганы шугам дээр, коридорын тэнхлэгээр (нэг цэгийн перспектив)
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
    if (MEDIA) MEDIA.stopAll(); SCENE_MODE = 'interior'; if (EXT) EXT.setVisible(false); showInteriorHud(true);
    entryPose();
    tourI = 0; pauseT = AUTO.pausePlain; sweep = 0; phase = 'walk'; if (tourPts[0]) tourPts[0].yaw0 = tourPts[0].yawC ?? cam.yaw; setMode('auto'); markModeButtons(); stepLights(0, true); Q.hold = performance.now() + 2500;
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
  cam.x = r.x + r.w / 2; cam.z = r.y + r.h / 2; stepLights(0, true);
  const c = roomLay[r.id]; if (c) { topDbg = dbgRects(c); scene.add(topDbg); }
  renderer.shadowMap.needsUpdate = true; return JSON.stringify(c ? c.log : []);
}

/// ---------- Чанарын түвшин (quality tier) + гэрлийн сан + bloom ----------
// 2 = өндөр (салангид GPU: bloom бүтэн нягтрал, MSAA 4, 4 гэрэл), 1 = дунд (Intel UHD/Iris, нэгдмэл AMD, гар утас: bloom ¼ нягтрал, 3 гэрэл), 0 = бага (програм рендер/сул: bloom-гүй, 2 гэрэл).
// Эхлээд GPU нэрээр таамаглаж, дараа нь FPS-ээр (2 с цонх) доошлуулна: < 38 fps → нэг түвшин доош; түвшин 0 дээр < 30 fps → pixel ratio ↓. ?q=low|mid|high — гараар (автомат өөрчлөлтгүй).
const Q = { tier: 1, cap: 2, forced: false, gpu: '', composer: null, rp: null, bloom: null, hold: 0, t0: 0, n: 0, fps: 0, log: [] }, INT_EXP = 1.0;
const LPOOL = []; // тогтмол тооны PointLight — тоо нь өөрчлөгдвөл бүх шэйдер дахин компиляцлагдаж гацдаг тул өрөө солигдоход байрлал/хүчийг л шилжүүлнэ
function detectTier() {
  const qp = new URLSearchParams(location.search).get('q'), m = { low: 0, mid: 1, high: 2 };
  try { const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info'); Q.gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)); } catch { Q.gpu = '?'; }
  if (qp in m) { Q.forced = true; return m[qp]; }
  const g = Q.gpu.toLowerCase(), mob = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 900, mem = navigator.deviceMemory || 8, cpu = navigator.hardwareConcurrency || 8;
  if (/swiftshader|llvmpipe|softpipe|software|basic render/.test(g)) return 0;
  let t = /nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|apple m\d/.test(g) && !/\bmx ?\d{3}\b/.test(g) ? 2 : 1; // салангид GPU → өндөр; Intel UHD/Iris, AMD Vega (нэгдмэл), MX → дунд
  if (mob || mem <= 4 || cpu <= 4) t = Math.min(t, mob && mem <= 3 ? 0 : 1);
  return t;
}
function setTier(t, why) {
  Q.tier = Math.max(0, Math.min(Q.cap, t)); Q.log.push(`${Q.tier}:${why}`);
  const n = [2, 3, 4][Q.tier]; while (LPOOL.length > n) scene.remove(LPOOL.pop()); while (LPOOL.length < n) { const l = new THREE.PointLight(0xffd2a0, 0, 1, 1.6); l.userData.v = null; scene.add(l); LPOOL.push(l); }
  if (Q.tier >= 1 && !Q.composer) { Q.composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 })); Q.rp = new RenderPass(scene, camera); Q.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.5, 1.05); Q.composer.addPass(Q.rp); Q.composer.addPass(Q.bloom); Q.composer.addPass(new OutputPass()); }
  if (Q.tier < 1 && Q.composer) { Q.bloom.dispose(); Q.composer.dispose(); Q.composer = Q.rp = Q.bloom = null; } // bloom-гүй: шууд рендер (canvas MSAA)
  sizePost(); stepLights(0, true); renderer.shadowMap.needsUpdate = true; furnDirty = true;
}
function sizePost() { if (!Q.composer) return; const pr = renderer.getPixelRatio(); Q.composer.setPixelRatio(pr); Q.composer.setSize(innerWidth, innerHeight); if (Q.tier < 2) Q.bloom.setSize(Math.round(innerWidth * pr / 2), Math.round(innerHeight * pr / 2)); } // дунд түвшинд bloom ¼ нягтралтай
// Гэрлийн сан: камерт хамгийн ойр (одоогийн өрөө давуу) виртуал гэрлүүдийг тогтмол PointLight-уудад оноож, зөөлөн асааж/унтраана (гэнэт тасрахгүй)
let lightT = 0, lr1 = null, lr2 = null;
const viewRoom = () => roomAt(cam.x - Math.sin(cam.yaw) * 0.9, cam.z - Math.cos(cam.yaw) * 0.9) || roomAt(cam.x, cam.z); // камерын өмнөх 0.9 м дахь өрөө (хаалганаас харах үед)
const mine = (v) => (lr1 && v.room === lr1.id) || (lr2 && v.room === lr2.id);
function stepLights(dt, force = false) {
  lr1 = roomAt(cam.x, cam.z); lr2 = viewRoom();
  lightT += dt; if (force || lightT >= 0.15) {
    lightT = 0; const pri = (v) => Math.hypot(v.x - cam.x, v.z - cam.z) - (mine(v) ? 4 : 0) + (v.furn ? 0.6 : 0);
    const want = vLights.filter((v) => !v.furn || furnGroup.visible).sort((a, b) => pri(a) - pri(b)).slice(0, LPOOL.length);
    for (const l of LPOOL) l.userData.out = !want.includes(l.userData.v);
    for (const v of want) if (!LPOOL.some((l) => l.userData.v === v)) { const l = LPOOL.find((q) => !q.userData.v) || LPOOL.find((q) => q.userData.out && (force || q.intensity < 0.05)); if (l) { l.userData.v = v; l.userData.out = false; l.position.set(v.x, v.y, v.z); l.distance = v.d; if (!force) l.intensity = 0; } }
  }
  for (const l of LPOOL) { const v = l.userData.v, tg = v && !l.userData.out ? v.i * (mine(v) ? 1 : 0.35) : 0; l.intensity = force ? tg : l.intensity + (tg - l.intensity) * Math.min(1, dt * 5); if (l.userData.out && l.intensity < 0.03) { l.userData.v = null; l.intensity = 0; } }
}
const fovFor = (hf, asp) => Math.min(84, Math.max(50, 2 * Math.atan(Math.tan(hf * Math.PI / 360) / asp) * 180 / Math.PI));
function stepFov(dt, snap) { const vr = viewRoom(), hf = vr && Math.min(vr.w, vr.h) < 2.05 ? 106 : HFOV, tg = fovFor(hf, camera.aspect); if (Math.abs(tg - camera.fov) < 0.02) return; camera.fov = snap ? tg : camera.fov + (tg - camera.fov) * Math.min(1, dt * 2.5); camera.updateProjectionMatrix(); } // жижиг өрөө (угаалга, үүдний) → хэвтээ 106°
function perfTick(now) { // FPS хяналт (бодит хугацаа; нуугдсан таб, компиляц/тавилга асаалтын дараах 2.5 с тооцохгүй)
  if (document.hidden) { Q.t0 = 0; return; } if (!Q.t0) { Q.t0 = now; Q.n = 0; return; } Q.n++; const el = now - Q.t0; if (el < 2000) return;
  const fps = Q.n * 1000 / el; Q.t0 = now; Q.n = 0; Q.fps = Math.round(fps); if (Q.forced || now < Q.hold) return;
  if (fps < 38 && Q.tier > 0) { setTier(Q.tier - 1, `fps ${Q.fps}`); Q.hold = now + 3000; return; }
  const pr = renderer.getPixelRatio(), mx = Math.min(devicePixelRatio, Q.tier >= 2 ? 1.5 : 1.25); let np = pr; if (fps < 30 && pr > 0.7) np = Math.max(0.7, pr - 0.15); else if (fps > 56 && pr < mx) np = Math.min(mx, pr + 0.1);
  if (np !== pr) { renderer.setPixelRatio(np); renderer.setSize(innerWidth, innerHeight, false); sizePost(); Q.hold = now + 1500; }
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
  for (const m of data.media || []) if (m.kind === 'pano') { const a = { id: 'm' + m.id, url: m.url, preview: m.poster, kind: 'pano', room_id: m.room_id }; if (String(m.room_id || '').startsWith('ext:')) extNodes.push({ ...a, label: m.room_id.slice(4) }); else if (m.room_id) panoByRoom[m.room_id] = a; } // шинэ (том файл) нь хуучныг дарна
  const p = data.property || {};
  $('#title').textContent = `${p.district || ''}${p.khoroolol ? ', ' + p.khoroolol : ''} · ${p.rooms || rooms.length} өрөө · ${p.area || plan.totalArea} м²${p.floor ? ` · ${p.floor}/${p.total_floors || '—'} давхар` : ''}${data.company ? ' · ' + data.company : ''}`;
  document.title = `POV Tour — ${p.district || 'Зууч'}`;
  // FPS: pixel ratio ≤1.5, статик сүүдэр (зөвхөн тавилга гарч ирэх үед шинэчилнэ), high-performance GPU
  renderer = new THREE.WebGLRenderer({ canvas: $('#c'), antialias: true, powerPreference: 'high-performance' }); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25)); // canvas MSAA — bloom-гүй (түвшин 0) болон гадаах нислэгт renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  // near 0.05: 0.1 үед дэлгэцийн захад хана таслагдаж байсан
  scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(60, 1, 0.05, 200); // fov-г resize-д хэвтээ 92°-аар тооцно
  // Оношилгоо: консолоос zuuchBench(20) → нэг frame-ийн дундаж мс (GPU finish-тэй), pixel ratio, draw calls
  window.zuuch = { renderer, scene, camera, LPOOL, vLights, mats, THREE, cam, furnGroup, ensureFurn, setFurn, stopPose, enterRoom, byId, tourPts: () => tourPts, Q, quality: () => ({ tier: Q.tier, cap: Q.cap, forced: Q.forced, gpu: Q.gpu, bloom: !!Q.composer, lights: LPOOL.length, fps: Q.fps, pr: renderer.getPixelRatio(), log: Q.log }) };
  window.zuuchBench = (n = 20) => { const gl = renderer.getContext(), R = () => (Q.composer ? Q.composer.render(0.016) : renderer.render(scene, camera)); R(); gl.finish(); const t = performance.now(); for (let i = 0; i < n; i++) { camera.position.set(cam.x, EYE, cam.z); R(); } gl.finish(); const ms = (performance.now() - t) / n; renderer.info.autoReset = false; renderer.info.reset(); renderer.render(scene, camera); const calls = renderer.info.render.calls, tris = renderer.info.render.triangles; renderer.info.autoReset = true; return { frameMs: Math.round(ms * 10) / 10, estFps: Math.round(1000 / ms), pixelRatio: renderer.getPixelRatio(), calls, triangles: tris, lights: LPOOL.length, tier: Q.tier, bloom: !!Q.composer, gpu: Q.gpu }; };
  const pmrem = new THREE.PMREMGenerator(renderer); scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.38;
  initMats(); outdoors(); scene.add(furnGroup);
  Q.cap = detectTier(); setTier(Q.cap, 'gpu: ' + Q.gpu); // GPU-гээр анхны түвшин (дээш автоматаар өсгөхгүй)
  const furn0 = new URLSearchParams(location.search).get('furn') === '1'; furnWant = furnGroup.visible = furn0; $('#bFurn').classList.toggle('on', furn0); // тавилга анхдагчаар унтраалттай
  for (const r of rooms) scene.add(buildRoom(r));
  if (furn0) ensureFurn(); // ?furn=1: ачааллын дэлгэцийн ард байрлуулна; унтраалттай бол огт тооцохгүй (анх асаахад л)
  hangPhotos();
  if (Object.values(assetsByType).flat().length) $('#bPhotos').disabled = false;
  $('#bPhotos').onclick = showPhotos; $('#bClosePhotos').onclick = () => { $('#photos').style.display = 'none'; }; $('#bPano').onclick = togglePano;
  entryPose();
  tourPts = buildTour(); tourI = 0; pauseT = AUTO.pausePlain; sweep = 0; if (tourPts[0]) tourPts[0].yaw0 = tourPts[0].yawC ?? cam.yaw;
  try { MEDIA = createMedia({ data, renderer, onWalkEnd: () => goInterior() }); window.zuuch.media = MEDIA; if (MEDIA.hasWalk) $('#bWalk').style.display = ''; } catch (err) { console.error('media', err); MEDIA = null; }
  if (data.exterior && Array.isArray(data.exterior.buildings)) {
    $('#load').lastElementChild.textContent = 'Гадаах орчныг бүтээж байна…'; await new Promise((r) => setTimeout(r, 30));
    try { EXT = createExterior(data.exterior, { title: $('#title').textContent, keys, renderer, onDone: () => (MEDIA && MEDIA.hasWalk ? startWalkMode() : goInterior()) }); window.zuuch.ext = EXT; $('#bOut').style.display = ''; $('#bIn').style.display = ''; }
    catch (err) { console.error('exterior', err); EXT = null; }
  }
  const q = new URLSearchParams(location.search); const sr = byId[q.get('start')];
  if (EXT && !sr && q.get('in') !== '1') { SCENE_MODE = 'exterior'; EXT.setVisible(true); showInteriorHud(false); EXT.start(Number(q.get('at')) || 0); } else if (EXT) EXT.setVisible(false);
  if (sr) { enterRoom(sr); if (q.get('yaw')) cam.yaw = Number(q.get('yaw')); setMode('free'); }
  const walkFirst = MEDIA && MEDIA.hasWalk && !sr && q.get('in') !== '1' && (!EXT || q.get('walk') === '1'); // гадаах нислэггүй бол бичлэгээр эхэлнэ (?walk=1 — шууд)
  if (q.get('debug') === 'top') { window.zuuch.topView = async (id) => { await ensureFurn(); return topView(id); }; window.zuuch.layout = async () => { await ensureFurn(); return Object.fromEntries(Object.entries(roomLay).map(([k, c]) => [k, [...c.log, { ms: c.ms, mx: c.mx }]])); }; window.zuuch.dbg = { roomLay, wallDeco, proto, P }; }
  bindControls();
  const resize = () => { renderer.setSize(innerWidth, innerHeight, false); const asp = innerWidth / innerHeight; camera.aspect = asp; stepFov(0, true); camera.updateProjectionMatrix(); sizePost(); if (EXT) { EXT.camera.aspect = asp; EXT.camera.fov = Math.min(78, Math.max(55, (2 * Math.atan(Math.tan((22 * Math.PI) / 180) / asp) * 180) / Math.PI)); EXT.camera.updateProjectionMatrix(); /* босоо утсанд хэвтээ өнцөг ≥44° байхаар босоо FOV-ийг өргөсгөнө (хэвтээ дэлгэцэд 55° хэвээр) */ } }; addEventListener('resize', resize); resize();
  // Тавилга асаалттай (?furn=1) бол загвар ачаалж байрлуулахыг (≤8с) хүлээнэ; унтраалттай бол огт хүлээхгүй
  const t0 = Date.now(); while (((furn0 && !furnReady) || texDone < texPending) && Date.now() - t0 < 8000) { $('#load').lastElementChild.textContent = furn0 && !furnReady ? (loadedN < pending ? `Тавилга ачаалж байна… ${loadedN}/${pending}` : 'Тавилга байрлуулж байна…') : 'Текстур ачаалж байна…'; await new Promise((r) => setTimeout(r, 120)); }
  // Шэйдерүүдийг урьдчилан компиляц — тавилга гарч ирэх/өрөө солигдох мөчид гацахгүй (бенчмарк: эхний frame 62 мс, дараа нь 2 мс)
  // Тавилга унтраалттай бол түүнийг компиляцад хамруулахгүй — асаахад (furnDirty) нэг удаа компиляц хийгдэнэ
  const compileAll = () => { try { renderer.compile(scene, camera); } catch { /* зарим GPU-д алгасна */ } };
  if (sr && furn0 && furnReady) { enterRoom(sr); if (q.get('yaw')) cam.yaw = Number(q.get('yaw')); } // тавилга байрласны дараа зогсоолыг дахин (тавилгаас зайлуулсан)
  stepLights(0, true); stepFov(0, true); compileAll(); try { if (EXT) renderer.compile(EXT.scene, EXT.camera); } catch { /* зарим GPU-д алгасна */ }
  markModeButtons();
  $('#load').style.display = 'none';
  if (walkFirst) { if (EXT) EXT.setVisible(false); SCENE_MODE = 'walk'; showInteriorHud(false); MEDIA.startWalk(() => goInterior()); markModeButtons(); }
  let last = performance.now(), mapT = 1, frameN = 0, shadowLoaded = -1, fpsAcc = 0, fpsN = 0; // эхний frame-д минимап зурагдана
  // Гадаах/дотоод рендер төлөв солих (зөвхөн шилжих үед; материалууд дахин компиляц)
  const INT_RS = { sh: renderer.shadowMap.enabled, tm: renderer.toneMapping, type: renderer.shadowMap.type }; let extRS = null;
  const extRenderState = (on) => {
    if (extRS === on) return; extRS = on;
    if (on) { renderer.shadowMap.enabled = !!(EXT && EXT.shadows); renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.toneMapping = THREE.ACESFilmicToneMapping; }
    else { renderer.shadowMap.enabled = INT_RS.sh; renderer.shadowMap.type = INT_RS.type; renderer.toneMapping = INT_RS.tm; }
    const sc = on ? EXT && EXT.scene : scene; if (sc) sc.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); });
  };
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if ((SCENE_MODE === 'walk' || SCENE_MODE === 'splat') && MEDIA) { // бодит медиа: өөрийн сцен/камер
      MEDIA.render(dt); mapT += dt; if (mapT > 0.12) { mapT = 0; MEDIA.drawMap($('#map').getContext('2d'), 440, 340); }
      requestAnimationFrame(frame); return;
    }
    if (SCENE_MODE === 'exterior' && EXT) {
      EXT.update(dt); mapT += dt; if (mapT > 0.1) { mapT = 0; EXT.drawMap($('#map').getContext('2d'), 440, 340); }
      fpsAcc += dt; fpsN++;
      if (fpsAcc >= 2) { const fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; const pr = renderer.getPixelRatio(); if (fps < 28 && pr > 0.6) renderer.setPixelRatio(Math.max(0.6, pr - 0.15)); else if (fps > 55 && pr < Math.min(devicePixelRatio, 1.25)) renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25, pr + 0.1)); if (renderer.getPixelRatio() !== pr) renderer.setSize(innerWidth, innerHeight, false); }
      extRenderState(true); renderer.toneMappingExposure = EXT.exposure || 1.0; renderer.shadowMap.needsUpdate = true; renderer.render(EXT.scene, EXT.camera); requestAnimationFrame(frame); return; // гадаах: bloom-гүй; нарны сүүдэр камерыг дагадаг тул кадр бүр
    }
    if (mode === 'auto') stepAuto(dt); else if (!panoActive) stepFree(dt);
    stepStaging(dt);
    camera.position.set(cam.x, EYE, cam.z); camera.rotation.set(0, 0, 0, 'YXZ'); camera.rotation.y = cam.yaw; camera.rotation.x = cam.pitch;
    const r = roomAt(cam.x, cam.z); const id = r ? r.id : null;
    const extShown = panoActive && panoMesh && panoMesh.userData.exterior;
    if (id !== curRoomId && !extShown) { curRoomId = id; $('#rName').textContent = r ? r.name : '—'; $('#rArea').textContent = r ? `${(r.w * r.h).toFixed(1)} м² · ${r.w} × ${r.h} м` : ''; $('#bPano').style.display = (r && panoByRoom[r.id]) || panoActive ? '' : 'none'; $('#b3D').style.display = r && MEDIA && MEDIA.splatByRoom[r.id] ? '' : 'none'; }
    mapT += dt; if (mapT > 0.08) { mapT = 0; drawMap(); }
    // Сүүдэр: сцен статик — зөвхөн тавилга гарч ирэх/байрлуулах/загвар ачаалагдах үед л шинэчилнэ; шэйдер компиляц зөвхөн тавилга харагдаж байхад (furnDirty)
    if (staging || furnDirty || loadedN !== shadowLoaded || frameN < 30) { renderer.shadowMap.needsUpdate = true; if (furnDirty && furnGroup.visible) compileAll(); shadowLoaded = loadedN; furnDirty = false; } frameN++;
    // Гэрлийн сан (ойрын гэрлүүд, тогтмол тоо) + чанарын хяналт (FPS → түвшин/нягтрал)
    extRenderState(false); stepLights(dt); stepFov(dt, false); perfTick(now); renderer.toneMappingExposure = INT_EXP;
    if (Q.composer) { Q.rp.camera = topCam || camera; Q.composer.render(dt); } else renderer.render(scene, topCam || camera); // bloom зөвхөн интерьерт
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
main().catch((e) => { console.error(e); $('#load').textContent = 'Алдаа: ' + e.message; });
