// «Зууч» — хувийн мэдээллийн бүдгэрүүлэлт (Хүний хувийн мэдээлэл хамгаалах тухай хууль): хүний нүүр, машины улсын дугаар, орцны домофон (код/товчлуурын самбар).
// Илрүүлэгч (бүгд ONNX, onnxruntime-node, CPU):
//   • нүүр — YuNet 2023mar (OpenCV Zoo, MIT), 640×640 хавтан
//   • улсын дугаар — YOLOv9-t 640 end2end (open-image-models, MIT)
//   • домофон — OWL-ViT B/32 int8 (Google, Apache-2.0; нээлттэй үгсийн сан — «intercom panel» гэх мэт текстээр хайна)
// Загварууд анх хэрэглэх үед MODELS_DIR-д татагдана (sha256 шалгана); сервер асахад урьдчилан татна (prepare).
// Бичлэг: 1) бага давтамжаар (4 кадр/с) илрүүлж, 2) кадр хооронд дагаж (track) завсрыг нөхөн, 3) хөрвүүлэх үед кадр бүрт мозайк (yuv420p, эх чанарыг алдагдуулахгүй нэг удаа кодлоно).
// 360 (equirect): зөвхөн тэнгэрийн хаяаны орчмын бүс (нүүр/дугаар/домофон байх өндөр), баруун-зүүн захын давталтыг (seam) тооцно.
const fs = require('fs'); const fsp = fs.promises; const path = require('path'); const os = require('os'); const crypto = require('crypto');
const { spawn } = require('child_process');

let ort = null; const ORT_OK = (() => { try { require.resolve('onnxruntime-node'); return true; } catch { return false; } })(); // сервер процесс native санг ачаалахгүй — зөвхөн хүүхэд процесс (session) ачаална

const MODELS_DIR = process.env.ZUUCH_MODELS || (process.env.RAILWAY_VOLUME_MOUNT_PATH ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'models') : path.join(__dirname, 'models'));
const MODELS = {
  face: { file: 'face_yunet_2023mar.onnx', bytes: 232589, sha256: '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4', url: 'https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx' },
  plate: { file: 'plate_yolov9t_640_e2e.onnx', bytes: 7835770, sha256: 'c3c1026ca7d0585dd88084d68182dd897113712fa734ae1557ca70174440c076', url: 'https://github.com/ankandrew/open-image-models/releases/download/assets/yolo-v9-t-640-license-plates-end2end.onnx' },
  owl: { file: 'owlvit_b32_int8.onnx', bytes: 155431700, sha256: '06af49bd5db977936bcddad2b45d0031072673517579d15b8cb42bf015a94156', url: 'https://huggingface.co/Xenova/owlvit-base-patch32/resolve/main/onnx/model_quantized.onnx' },
};
// OWL-ViT хайлтын текст (CLIP BPE токен — урьдчилан тооцсон: <|startoftext|> … <|endoftext|>); эхний INTERCOM_Q нь домофон, бусад нь харьцуулах «сөрөг» анги (гэрлийн унтраалга, цонх г.м.) — домофон тэдгээрээс өндөр байх ёстой
const OWL_Q = [
  ['intercom panel with buttons', [49406, 1006, 2464, 3724, 593, 16188, 49407]],
  ['door entry keypad', [49406, 2489, 5362, 2891, 7601, 49407]],
  ['a photo of an intercom', [49406, 320, 1125, 539, 550, 1006, 2464, 49407]],
  ['doorbell buttons', [49406, 7188, 3718, 16188, 49407]],
];
const ENABLED = ORT_OK && process.env.ZUUCH_BLUR !== '0';
const THREADS = Math.max(1, Math.min(Number(process.env.ZUUCH_ANON_THREADS) || 4, os.cpus().length));
const TH = { face: Number(process.env.ZUUCH_TH_FACE) || 0.6, plate: Number(process.env.ZUUCH_TH_PLATE) || 0.35, intercom: Number(process.env.ZUUCH_TH_INTERCOM) || 0.12 };

// ---- Загвар татах / ачаалах ----
const sha256 = (f) => new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(f).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });
const fetching = {};
async function ensureModel(key) {
  const M = MODELS[key]; const file = path.join(MODELS_DIR, M.file);
  try { const st = await fsp.stat(file); if (st.size === M.bytes) return file; } catch { /* татна */ }
  if (fetching[key]) return fetching[key];
  fetching[key] = (async () => {
    await fsp.mkdir(MODELS_DIR, { recursive: true }); const tmp = `${file}.${process.pid}.part`; // сервер ба хүүхэд процесс зэрэг татаж болно
    for (let a = 0; ; a++) {
      try {
        const r = await fetch(M.url, { redirect: 'follow' }); if (!r.ok) throw new Error('HTTP ' + r.status);
        const out = fs.createWriteStream(tmp); for await (const ch of r.body) { if (!out.write(ch)) await new Promise((ok) => out.once('drain', ok)); }
        await new Promise((ok, no) => { out.end(ok); out.on('error', no); });
        if ((await sha256(tmp)) !== M.sha256) throw new Error('sha256 таарсангүй');
        await fsp.rename(tmp, file); return file;
      } catch (e) { await fsp.unlink(tmp).catch(() => {}); if (a >= 3) throw new Error(`Бүдгэрүүлэх загвар (${key}) татагдсангүй: ${e.message}`); await new Promise((ok) => setTimeout(ok, 3000 * (a + 1))); }
    }
  })().finally(() => { delete fetching[key]; });
  return fetching[key];
}
const S = {}; // ачаалсан сессүүд
async function session(key) {
  if (S[key]) return S[key];
  if (!ORT_OK) throw new Error('onnxruntime-node суугаагүй'); if (!ort) ort = require('onnxruntime-node');
  S[key] = ort.InferenceSession.create(await ensureModel(key), { intraOpNumThreads: THREADS, interOpNumThreads: 1, graphOptimizationLevel: 'all', executionMode: 'sequential' })
    .catch((e) => { delete S[key]; throw e; });
  return S[key];
}
// Сервер асахад бүх загварыг арын горимд татна (эхний upload хүлээхгүй)
function prepare() { if (!ENABLED) return; Promise.all(Object.keys(MODELS).map(ensureModel)).then(() => console.log('[бүдгэрүүлэлт] загварууд бэлэн')).catch((e) => console.error('[бүдгэрүүлэлт]', e.message)); }
async function status() { const r = { enabled: ENABLED, models: {} }; for (const [k, M] of Object.entries(MODELS)) { try { r.models[k] = (await fsp.stat(path.join(MODELS_DIR, M.file))).size === M.bytes; } catch { r.models[k] = false; } } return r; }

// ---- Тензор: RGB зурагны (sx,sy,sw,sh) хэсгийг dw×dh хэмжээтэй RGB хавтан болгоно (bilinear, нэг удаа; wrap: 360 зургийн хэвтээ давталт),
// дараа нь загвар бүрийн хэлбэрт (chw) хөнгөн хөрвүүлнэ ----
const MODE = {
  yunet: { bgr: true, mul: [1, 1, 1], add: [0, 0, 0], pad: [0, 0, 0] },
  yolo: { bgr: false, mul: [1 / 255, 1 / 255, 1 / 255], add: [0, 0, 0], pad: [114 / 255, 114 / 255, 114 / 255] },
  clip: (() => { const m = [0.48145466, 0.4578275, 0.40821073], s = [0.26862954, 0.26130258, 0.27577711]; return { bgr: false, mul: s.map((v) => 1 / (255 * v)), add: m.map((v, i) => -v / s[i]), pad: [0, 0, 0] }; })(),
};
function resample(img, sx, sy, sw, sh, dw, dh) {
  const { data, w, h, wrap } = img; const out = new Uint8Array(dw * dh * 3); const kx = sw / dw, ky = sh / dh;
  const X0 = new Int32Array(dw), X1 = new Int32Array(dw), WX = new Float32Array(dw);
  for (let x = 0; x < dw; x++) {
    let fx = sx + (x + 0.5) * kx - 0.5;
    if (wrap) { fx = ((fx % w) + w) % w; X0[x] = fx | 0; X1[x] = X0[x] + 1 < w ? X0[x] + 1 : 0; } else { if (fx < 0) fx = 0; else if (fx > w - 1) fx = w - 1; X0[x] = fx | 0; X1[x] = X0[x] + 1 < w ? X0[x] + 1 : X0[x]; }
    WX[x] = fx - X0[x]; X0[x] *= 3; X1[x] *= 3;
  }
  for (let y = 0; y < dh; y++) {
    let fy = sy + (y + 0.5) * ky - 0.5; if (fy < 0) fy = 0; else if (fy > h - 1) fy = h - 1;
    const y0 = fy | 0, y1 = y0 + 1 < h ? y0 + 1 : y0, wy = fy - y0, iy = 1 - wy; const r0 = y0 * w * 3, r1 = y1 * w * 3; let o = y * dw * 3;
    for (let x = 0; x < dw; x++) {
      const wx = WX[x], ix = 1 - wx, a = r0 + X0[x], b = r0 + X1[x], c = r1 + X0[x], d = r1 + X1[x];
      out[o++] = (data[a] * ix + data[b] * wx) * iy + (data[c] * ix + data[d] * wx) * wy + 0.5;
      out[o++] = (data[a + 1] * ix + data[b + 1] * wx) * iy + (data[c + 1] * ix + data[d + 1] * wx) * wy + 0.5;
      out[o++] = (data[a + 2] * ix + data[b + 2] * wx) * iy + (data[c + 2] * ix + data[d + 2] * wx) * wy + 0.5;
    }
  }
  return out;
}
// RGB хавтан (dw×dh) → N×N CHW float (ox,oy байрлалд; бусад нь pad)
function chw(tile, dw, dh, N, mode, ox = 0, oy = 0) {
  const plane = N * N; const t = new Float32Array(3 * plane);
  for (let c = 0; c < 3; c++) if (mode.pad[c]) t.fill(mode.pad[c], c * plane, (c + 1) * plane);
  const p0 = (mode.bgr ? 2 : 0) * plane, p1 = plane, p2 = (mode.bgr ? 0 : 2) * plane; const [m0, m1, m2] = mode.mul, [a0, a1, a2] = mode.add;
  for (let y = 0; y < dh; y++) { let i = y * dw * 3; const row = (oy + y) * N + ox; for (let x = 0; x < dw; x++, i += 3) { const o = row + x; t[p0 + o] = tile[i] * m0 + a0; t[p1 + o] = tile[i + 1] * m1 + a1; t[p2 + o] = tile[i + 2] * m2 + a2; } }
  return t;
}

// ---- Хайрцгийн туслахууд ----
const area = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
function iou(a, b) { const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]), x2 = Math.min(a[2], b[2]), y2 = Math.min(a[3], b[3]); const i = Math.max(0, x2 - x1) * Math.max(0, y2 - y1); return i / (area(a) + area(b) - i || 1); }
function nms(list, thr = 0.4) { // list: [{b:[x1,y1,x2,y2], s}] — давхардсаныг хасна (бага хайрцаг томд бүрэн багтсан бол мөн)
  const out = []; for (const d of list.sort((p, q) => q.s - p.s)) { if (!out.some((o) => iou(o.b, d.b) > thr || (area(d.b) && inter(o.b, d.b) / area(d.b) > 0.8))) out.push(d); } return out;
}
function inter(a, b) { return Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1])); }
// [a, b) мужийг T хэмжээтэй, ov давхцалтай хэсгүүдэд хуваана
function span(a, b, T, ov) { const L = b - a; if (L <= T) return [[a, L]]; const n = Math.ceil((L - ov) / (T - ov)); const st = (L - T) / (n - 1); return Array.from({ length: n }, (_, i) => [a + i * st, T]); }

// ---- Илрүүлэгчид (бүс → нэг хавтан → нүүр/дугаарын загвар → зурагны координат) ----
async function faceplateRegion(img, sx, sy, sw, sh, doFace, doPlate) {
  const N = 640, sc = Math.max(sw, sh) / N, dw = Math.max(1, Math.round(sw / sc)), dh = Math.max(1, Math.round(sh / sc));
  const tile = resample(img, sx, sy, sw, sh, dw, dh); const out = [];
  if (doFace) {
    const s = await session('face'); const r = await s.run({ input: new ort.Tensor('float32', chw(tile, dw, dh, N, MODE.yunet), [1, 3, N, N]) });
    for (const st of [8, 16, 32]) {
      const cols = N / st, cls = r['cls_' + st].data, obj = r['obj_' + st].data, bb = r['bbox_' + st].data;
      for (let i = 0; i < cls.length; i++) {
        const sc0 = Math.sqrt(Math.min(1, Math.max(0, cls[i])) * Math.min(1, Math.max(0, obj[i]))); if (sc0 < TH.face) continue;
        const c = i % cols, rr = (i / cols) | 0; const cx = (c + bb[i * 4]) * st, cy = (rr + bb[i * 4 + 1]) * st, w = Math.exp(bb[i * 4 + 2]) * st, h = Math.exp(bb[i * 4 + 3]) * st;
        if (cx > dw + 2 || cy > dh + 2) continue; // дүүргэлтийн хэсэг
        out.push({ c: 'face', s: sc0, b: [sx + (cx - w / 2) * sc, sy + (cy - h / 2) * sc, sx + (cx + w / 2) * sc, sy + (cy + h / 2) * sc] });
      }
    }
  }
  if (doPlate) {
    const ox = (N - dw) >> 1, oy = (N - dh) >> 1; const s = await session('plate');
    const r = await s.run({ images: new ort.Tensor('float32', chw(tile, dw, dh, N, MODE.yolo, ox, oy), [1, 3, N, N]) }); const d = r.output0.data;
    for (let i = 0; i + 6 < d.length; i += 7) { if (d[i + 6] < TH.plate) continue; out.push({ c: 'plate', s: d[i + 6], b: [sx + (d[i + 1] - ox) * sc, sy + (d[i + 2] - oy) * sc, sx + (d[i + 3] - ox) * sc, sy + (d[i + 4] - oy) * sc] }); }
  }
  return out;
}
let OWL_IDS = null;
function owlText() {
  if (OWL_IDS) return OWL_IDS; const L = 16, Q = OWL_Q.length; const ids = new BigInt64Array(Q * L), mask = new BigInt64Array(Q * L);
  OWL_Q.forEach(([, tk], q) => tk.slice(0, L).forEach((v, j) => { ids[q * L + j] = BigInt(v); mask[q * L + j] = 1n; }));
  return (OWL_IDS = { input_ids: new ort.Tensor('int64', ids, [Q, L]), attention_mask: new ort.Tensor('int64', mask, [Q, L]) });
}
async function owlRegion(img, sx, sy, sw, sh) {
  const N = 768; const s = await session('owl');
  const r = await s.run({ ...owlText(), pixel_values: new ort.Tensor('float32', chw(resample(img, sx, sy, sw, sh, N, N), N, N, N, MODE.clip), [1, 3, N, N]) });
  const lg = r.logits.data, pb = r.pred_boxes.data, Q = OWL_Q.length, out = [];
  for (let i = 0; i < 576; i++) {
    let m = -1e9; for (let q = 0; q < Q; q++) m = Math.max(m, lg[i * Q + q]); const sc0 = 1 / (1 + Math.exp(-m)); if (sc0 < TH.intercom) continue;
    const cx = pb[i * 4] * sw, cy = pb[i * 4 + 1] * sh, w = pb[i * 4 + 2] * sw, h = pb[i * 4 + 3] * sh;
    if (w * h > sw * sh * 0.35) continue; // бүхэл хаалга/хана — домофон биш
    out.push({ c: 'intercom', s: sc0, b: [sx + cx - w / 2, sy + cy - h / 2, sx + cx + w / 2, sy + cy + h / 2] });
  }
  return out;
}

// ---- Нэг кадр/зураг: { data: RGB Uint8Array, w, h, wrap } ----
// opt: { face, plate, intercom: bool, band: [y0,y1] (0..1, мөрийн хэсэг), scale: эх px/тензор px (нүүр/дугаарын хавтан), iscale: домофоны хавтан, iband }
async function detectImage(img, opt = {}) {
  const { w, h, wrap } = img; const band = opt.band || [0, 1]; const y0 = band[0] * h, y1 = band[1] * h, bh = y1 - y0;
  const sc = opt.scale || 1; const T = 640 * sc, ov = Math.round(T * 0.15); const xEnd = wrap ? w + ov : w;
  const regions = [];
  for (const [yy, hh] of span(y0, y1, T, ov)) for (const [xx, ww] of span(0, xEnd, T, ov)) regions.push([xx, yy, ww, hh]);
  if (regions.length > 1) regions.push([0, y0, xEnd, bh]); // бүтэн бүс (хавтангийн заагт тасарсан том/ойрын нүүр, дугаар)
  let dets = []; const doF = opt.face !== false, doP = opt.plate !== false;
  if (doF || doP) for (const [rx, ry, rw, rh] of regions) dets = dets.concat(await faceplateRegion(img, rx, ry, rw, rh, doF, doP));
  if (wrap) for (const d of dets) if (d.b[0] >= w) { d.b[0] -= w; d.b[2] -= w; } // давталтын хэсгээс буцаана (NMS-ээс өмнө — ижил объект давхардахгүй)
  if (opt.intercom) {
    const ib = opt.iband || band, iy0 = ib[0] * h, iy1 = ib[1] * h; const isc = opt.iscale || 1, IT = 768 * isc, iov = Math.round(IT * 0.15);
    for (const [yy, hh] of span(iy0, iy1, IT, iov)) for (const [xx, ww] of span(0, wrap ? w + iov : w, IT, iov)) {
      for (const d of await owlRegion(img, xx, yy, Math.min(ww, IT), Math.min(hh, IT))) { if (wrap && d.b[0] >= w) { d.b[0] -= w; d.b[2] -= w; } dets.push(d); }
    }
  }
  const out = [];
  for (const c of ['face', 'plate', 'intercom']) out.push(...nms(dets.filter((d) => d.c === c), c === 'intercom' ? 0.3 : 0.4));
  return out; // 360: x2 > w байж болно (захын давталт — mosaicYUV хуваана)
}

// ---- Дагах (tracking): тусгай давтамжаар илрүүлсэн кадруудыг цаг хугацаагаар холбож, завсрыг шугаман нөхнө ----
const GAP = { face: 1.0, plate: 1.6, intercom: 4.5 }; // хамгийн их завсар (с)
const PAD_T = { face: 0.35, plate: 0.5, intercom: 1.6 }; // эхлэл/төгсгөлийг сунгах (с) — илрүүлэгч алдсан кадрууд
const GROW = { face: [0.55, 0.7], plate: [0.3, 0.45], intercom: [0.3, 0.3], manual: [0, 0] }; // хайрцгийг томсгох (өргөн, өндөр) — нүүрэнд үс/чих, дугаарт хүрээ
// frames: [{ t, dets }] (t өсөх дарааллаар). W: зургийн өргөн (360-д давталт).
function buildTracks(frames, { W = 0, wrap = false } = {}) {
  const tracks = []; const step = W ? W * 0.06 : 160; // 0.25 с-д хамгийн их шилжилт (алхаж яваа камерын хажуугаар өнгөрөх хүн)
  const cen = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  const unwrapTo = (b, rx) => { if (!wrap) return b; const k = Math.round((rx - (b[0] + b[2]) / 2) / W); return k ? [b[0] + k * W, b[1], b[2] + k * W, b[3]] : b; };
  for (const f of frames) {
    const cand = [];
    for (const tr of tracks) {
      const L = tr.k[tr.k.length - 1], dt = f.t - L.t; if (dt > GAP[tr.c] || dt <= 0) continue;
      const [lx, ly] = cen(L.b); const P = tr.k.length > 1 ? tr.k[tr.k.length - 2] : null; // хурдаар урьдчилан тааварлах
      let vx = 0, vy = 0; if (P) { const [px, py] = cen(P.b); const pdt = L.t - P.t || 1; vx = (lx - px) / pdt; vy = (ly - py) / pdt; }
      const qx = lx + vx * dt, qy = ly + vy * dt; const sz = Math.max(L.b[2] - L.b[0], L.b[3] - L.b[1], 8); const lim = Math.max(2 * sz, step * (dt / 0.25));
      const shifted = [L.b[0] + vx * dt, L.b[1] + vy * dt, L.b[2] + vx * dt, L.b[3] + vy * dt];
      for (const [di, d] of f.dets.entries()) {
        if (d.c !== tr.c) continue; const b = unwrapTo(d.b, qx); const [cx, cy] = cen(b); const dist = Math.hypot(cx - qx, cy - qy); if (dist > lim) continue;
        const rs = Math.max(b[2] - b[0], b[3] - b[1]) / sz; if (rs > 3 || rs < 1 / 3) continue; // хэмжээ огцом өөрчлөгдвөл өөр объект
        cand.push({ tr, di, b, score: iou(b, shifted) + (1 - dist / lim) * 0.6 });
      }
    }
    const usedT = new Set(), usedD = new Set();
    for (const c of cand.sort((p, q) => q.score - p.score)) { if (usedT.has(c.tr) || usedD.has(c.di)) continue; usedT.add(c.tr); usedD.add(c.di); const d = f.dets[c.di]; c.tr.k.push({ t: f.t, b: c.b, s: d.s }); c.tr.smax = Math.max(c.tr.smax, d.s); }
    for (const [di, d] of f.dets.entries()) if (!usedD.has(di)) tracks.push({ c: d.c, k: [{ t: f.t, b: d.b, s: d.s }], smax: d.s });
  }
  // Ганц удаа, бага итгэлтэй илэрсэн нь хуурамч байх магадлал өндөр (дугаар/домофон: ≥1.6×босго; нүүр: ≥0.72) — илүү бүдгэрүүлэх нь аюулгүй тул нүүрэнд зөөлөн
  const keep = (tr) => tr.k.length > 1 || tr.smax >= (tr.c === 'face' ? Math.max(0.72, TH.face) : TH[tr.c] * 1.6);
  return tracks.filter(keep).map((tr) => ({ c: tr.c, k: tr.k.map((k) => ({ t: +k.t.toFixed(3), b: k.b.map((v) => Math.round(v)) })) }));
}
function grow(b, c, W, H) {
  const [gw, gh] = GROW[c] || [0.2, 0.2]; const w = b[2] - b[0], h = b[3] - b[1]; const up = c === 'face' ? h * 0.12 : 0; // нүүрэнд дээшээ (үс)
  return [b[0] - (w * gw) / 2, Math.max(0, b[1] - (h * gh) / 2 - up), b[2] + (w * gw) / 2, Math.min(H, b[3] + (h * gh) / 2)];
}
// t агшинд идэвхтэй хайрцгууд (томсгосон)
function boxesAt(tracks, t, W, H, wrap = false) {
  const out = [];
  for (const tr of tracks) {
    const k = tr.k; const pad = tr.c === 'manual' ? 0 : PAD_T[tr.c] || 0.3; if (t < k[0].t - pad || t > k[k.length - 1].t + (tr.c === 'manual' ? tr.hold || 0 : pad)) continue;
    let b; if (t <= k[0].t) b = k[0].b; else if (t >= k[k.length - 1].t) b = k[k.length - 1].b;
    else { let i = 0; while (k[i + 1].t < t) i++; const a = k[i], z = k[i + 1], u = (t - a.t) / (z.t - a.t || 1); b = a.b.map((v, j) => v + (z.b[j] - v) * u); }
    const g = grow(b, tr.c, W, H);
    if (wrap && W) { const sh = Math.floor((g[0] + g[2]) / 2 / W) * W; if (sh) { g[0] -= sh; g[2] -= sh; } } // 360: дагалтын координат [0, W)-ээс гарсан байж болно
    out.push({ c: tr.c, b: g });
  }
  return out;
}

// ---- Мозайк (yuv420p кадр дээр): blk хэмжээтэй дөрвөлжин бүрийг дундаж өнгөөр — буцааж сэргээх боломжгүй ----
function blockOf(c, w, h) { const m = Math.min(w, h); return Math.max(4, (Math.round(m / (c === 'face' ? 6 : 4)) + 1) & ~1); }
function mosaicYUV(buf, W, H, box, c, wrap) {
  let [x1, y1, x2, y2] = box; if (wrap && x2 > W) { mosaicYUV(buf, W, H, [0, y1, x2 - W, y2], c, false); x2 = W; } if (wrap && x1 < 0) { mosaicYUV(buf, W, H, [W + x1, y1, W, y2], c, false); x1 = 0; }
  x1 = Math.max(0, Math.floor(x1 / 2) * 2); y1 = Math.max(0, Math.floor(y1 / 2) * 2); x2 = Math.min(W, Math.ceil(x2 / 2) * 2); y2 = Math.min(H, Math.ceil(y2 / 2) * 2);
  if (x2 - x1 < 2 || y2 - y1 < 2) return;
  const blk = blockOf(c, x2 - x1, y2 - y1); const ell = c === 'face'; const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx = (x2 - x1) / 2, ry = (y2 - y1) / 2;
  const inside = (x, y) => !ell || ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1;
  const W2 = W >> 1, uOff = W * H, vOff = uOff + W2 * (H >> 1);
  for (let by = y1; by < y2; by += blk) {
    const ey = Math.min(y2, by + blk);
    for (let bx = x1; bx < x2; bx += blk) {
      const ex = Math.min(x2, bx + blk); let sy = 0, n = 0;
      for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) { sy += buf[y * W + x]; n++; }
      const my = Math.round(sy / n); let su = 0, sv = 0, m = 0;
      const cy0 = by >> 1, cy1 = (ey + 1) >> 1, cx0 = bx >> 1, cx1 = (ex + 1) >> 1;
      for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++) { su += buf[uOff + y * W2 + x]; sv += buf[vOff + y * W2 + x]; m++; }
      const mu = Math.round(su / (m || 1)), mv = Math.round(sv / (m || 1));
      for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) if (inside(x, y)) buf[y * W + x] = my;
      for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++) if (inside(x * 2, y * 2)) { buf[uOff + y * W2 + x] = mu; buf[vOff + y * W2 + x] = mv; }
    }
  }
}

// ---- ffmpeg-ээс тогтмол хэмжээтэй кадрууд унших ----
function spawnFF(ff, args, stdio) { const nice = ff.nice; return spawn(nice || ff.ffmpeg, nice ? ['-n', '15', ff.ffmpeg, ...args] : args, { stdio }); }
// stdout-оос frameBytes хэмжээтэй кадр бүрийг onFrame(buf, i)-д (async; дуустал унших түр зогсоно)
function readFrames(proc, frameBytes, onFrame) {
  return new Promise((res, rej) => {
    let cur = Buffer.allocUnsafe(frameBytes), fill = 0, i = 0, err = '', chain = Promise.resolve(), failed = null;
    proc.stderr.on('data', (d) => { err += d; if (err.length > 2e4) err = err.slice(-1e4); });
    proc.stdout.on('data', (chunk) => {
      let off = 0;
      while (off < chunk.length) {
        const n = Math.min(frameBytes - fill, chunk.length - off); chunk.copy(cur, fill, off, off + n); fill += n; off += n;
        if (fill === frameBytes) {
          const fr = cur, idx = i++; cur = Buffer.allocUnsafe(frameBytes); fill = 0;
          proc.stdout.pause(); chain = chain.then(() => (failed ? null : onFrame(fr, idx))).catch((e) => { failed = e; proc.kill('SIGKILL'); }).then(() => proc.stdout.resume());
        }
      }
    });
    proc.on('error', rej);
    proc.on('close', (code) => { chain.then(() => { if (failed) return rej(failed); if (code !== 0) return rej(new Error((err.trim().split('\n').slice(-2).join(' ') || 'ffmpeg код ' + code).slice(0, 300))); res(i); }); });
  });
}

// ---- Бичлэг: илрүүлэх (бага давтамж) ----
// o: { ff, src, pre (hdr шүүлтүүр, ','-ээр төгссөн эсвэл ''), W, H, eq, duration, kind, onMsg }
// Домофон: walk_in — бүхэлд нь; walk_ext — сүүлийн 35% (орц руу ойртох хэсэг); бусад — хийхгүй
async function detectVideo(o) {
  const FPS = Number(process.env.ZUUCH_DETECT_FPS) || 4; const eq = !!o.eq;
  // Кадрыг ЯГ индексээр сонгоно: эхлээд кодлох үеийн адил тогтмол давтамж (fps=o.fps), дараа нь K кадр тутамд нэг — fps=4 шүүлтүүр интервалын голоос (+0.125 с) авдаг тул хурдан хөдөлгөөнд хайрцаг хоцордог байв
  const fpsS = String(o.fps || '30'), fpsN = fpsS.includes('/') ? fpsS.split('/').reduce((a, b) => a / b) : Number(fpsS); const K = Math.max(1, Math.round(fpsN / FPS));
  const band = eq ? [0.3, 0.84] : [0, 1]; // 360: тэнгэрийн хаяанаас дээш ~35°, доош ~60° (нүүр, машин, домофон)
  const by0 = Math.floor((band[0] * o.H) / 2) * 2, bh = Math.floor(((band[1] - band[0]) * o.H) / 2) * 2;
  const vf = `fps=${fpsS},select='not(mod(n\,${K}))',${o.pre}scale=${o.W}:${o.H}:flags=bilinear${eq ? `,crop=${o.W}:${bh}:0:${by0}` : ''},format=rgb24`;
  const p = spawnFF(o.ff, ['-hide_banner', '-loglevel', 'error', '-i', o.src, '-map', '0:v:0', '-an', '-sn', '-dn', '-vf', vf, '-fps_mode', 'passthrough', '-f', 'rawvideo', 'pipe:1'], ['ignore', 'pipe', 'pipe']);
  const fb = o.W * (eq ? bh : o.H) * 3; const frames = []; const total = Math.max(1, Math.round(((o.duration || 1) * fpsN) / K)); const t0 = Date.now();
  const D = o.duration || 0; const [iFrom, iTo] = o.kind === 'walk_in' ? [0, D * 0.4 + 3] : o.kind === 'walk_ext' ? [D * 0.7 - 2, Infinity] : [Infinity, 0]; // орцны үүд: гадна алхалтын төгсгөл, дотор алхалтын эхлэл
  const ib = eq ? [(0.39 - band[0]) / (band[1] - band[0]), (0.75 - band[0]) / (band[1] - band[0])] : [0, 1]; // домофон: тэнгэрийн хаяанаас +20°…−45°
  const scale = eq ? Math.max(1, o.W / 1920) : Math.max(1, Math.max(o.W, o.H) / 960); // нүүр ≥ ~20 px (эх) илэрнэ
  const iscale = eq ? 1 : Math.max(1, Math.min(o.W, o.H) / 768); // домофон: 360-д жижиг (1–2 м-т ~60–120 px) тул эх нягтралаар
  let ic = 0, lastI = -1e9;
  await readFrames(p, fb, async (buf, i) => {
    const t = (i * K) / fpsN; const doI = t >= iFrom && t <= iTo && t - lastI >= 1.95; if (doI) lastI = t; // домофон: 2 с тутам (хөдөлгөөнгүй самбар, ойртох үед хэдэн секунд харагдана)
    const img = { data: buf, w: o.W, h: eq ? bh : o.H, wrap: eq };
    const dets = await detectImage(img, { band: [0, 1], scale, plate: i % 2 === 0, intercom: doI, iband: ib, iscale }); // дугаар: 2 кадр/с (зогсож буй машин удаан харагдана), нүүр: 4 кадр/с
    if (eq) for (const d of dets) { d.b[1] += by0; d.b[3] += by0; }
    if (doI) ic++;
    frames.push({ t, dets });
    if (o.onMsg && i % 4 === 0) o.onMsg(`Нүүр, дугаар, домофон хайж байна… ${Math.min(99, Math.round(((i + 1) / total) * 100))}%`);
  });
  const tracks = buildTracks(frames, { W: o.W, wrap: eq });
  const cnt = (c) => tracks.filter((tr) => tr.c === c).length;
  return { tracks, stats: { face: cnt('face'), plate: cnt('plate'), intercom: cnt('intercom'), frames: frames.length, intercomFrames: ic, sec: Math.round((Date.now() - t0) / 1000) } };
}

// ---- Бичлэг: кодлох (decode → кадр бүрт мозайк → x264). enc: x264-ийн аргументууд (гаралтын файлыг оруулаад) ----
async function renderVideo({ ff, src, vf, W, H, fps, tracks, eq, enc, duration, onMsg, brand }) {
  const fb = (W * H * 3) / 2; const total = Math.max(1, Math.round((duration || 1) * fps));
  const dec = spawnFF(ff, ['-hide_banner', '-loglevel', 'error', '-i', src, '-map', '0:v:0', '-an', '-sn', '-dn', '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'yuv420p', 'pipe:1'], ['ignore', 'pipe', 'pipe']);
  const encP = spawnFF(ff, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${W}x${H}`, '-framerate', String(fps), '-i', 'pipe:0', ...(brand ? ['-i', brand.file, '-filter_complex', `[1:v]scale=${brand.bw}:-1:flags=lanczos[zb];[0:v][zb]overlay=W-w-${brand.m}:${brand.m}:format=auto,format=yuv420p[zv]`, '-map', '[zv]'] : []), ...enc], ['pipe', 'ignore', 'pipe']); // brand: брэнд тэмдэг (media.js brandFor)
  let encErr = ''; encP.stderr.on('data', (d) => { encErr += d; if (encErr.length > 2e4) encErr = encErr.slice(-1e4); });
  const encDone = new Promise((res, rej) => { encP.on('error', rej); encP.on('close', (c) => (c === 0 ? res() : rej(new Error((encErr.trim().split('\n').slice(-2).join(' ') || 'x264 код ' + c).slice(0, 300))))); });
  encP.stdin.on('error', () => { /* кодлогч унтарвал encDone алдааг мэдээлнэ */ });
  const fpsN = typeof fps === 'string' && fps.includes('/') ? fps.split('/').reduce((a, b) => a / b) : Number(fps);
  let blurred = 0;
  try {
    const n = await readFrames(dec, fb, async (buf, i) => {
      const t = i / fpsN; const bx = tracks && tracks.length ? boxesAt(tracks, t, W, H, eq) : [];
      for (const b of bx) mosaicYUV(buf, W, H, b.b, b.c, eq); if (bx.length) blurred++;
      if (!encP.stdin.write(buf)) await new Promise((ok) => encP.stdin.once('drain', ok));
      if (onMsg && i % 15 === 0) onMsg(`Бүдгэрүүлж хөрвүүлж байна… ${Math.min(99, Math.round(((i + 1) / total) * 100))}%`);
    });
    encP.stdin.end(); await encDone; return { frames: n, blurredFrames: blurred };
  } catch (e) { encP.kill('SIGKILL'); dec.kill('SIGKILL'); throw e; }
}

// ---- Зураг (360 эсвэл энгийн JPEG): илрүүлээд байвал мозайк хийж дахин хадгална ----
// o: { ff, file, eq, intercom, manual: [{b:[x1,y1,x2,y2] (0..1 харьцаа)}] }
async function anonymizeImage(o) {
  const run = (args, stdio = ['ignore', 'pipe', 'pipe']) => spawnFF(o.ff, ['-hide_banner', '-loglevel', 'error', ...args], stdio);
  const W0 = o.width, H0 = o.height; const t0 = Date.now();
  // илрүүлэлт: ≤4096 өргөнтэй хувилбар дээр
  const dw = Math.min(4096, W0) & ~1, dh = Math.round((dw * H0) / W0) & ~1; const k = W0 / dw;
  let dets = [];
  if (!o.skipDetect) {
    const img = { data: Buffer.alloc(dw * dh * 3), w: dw, h: dh, wrap: !!o.eq };
    await readFrames(run(['-i', o.file, '-vf', `scale=${dw}:${dh}:flags=bilinear,format=rgb24`, '-frames:v', '1', '-f', 'rawvideo', 'pipe:1']), dw * dh * 3, async (buf) => { buf.copy(img.data); });
    dets = await detectImage(img, { band: o.eq ? [0.25, 0.86] : [0, 1], scale: o.eq ? Math.max(1, dw / 2560) : Math.max(1, Math.max(dw, dh) / 1600), intercom: !!o.intercom, iband: o.eq ? [0.36, 0.78] : [0, 1], iscale: o.eq ? Math.max(1, dw / 3072) : Math.max(1, Math.min(dw, dh) / 768) });
    for (const d of dets) d.b = d.b.map((v) => v * k);
  }
  const boxes = dets.map((d) => ({ c: d.c, b: grow(d.b, d.c, W0, H0) })).concat((o.manual || []).map((m) => ({ c: 'manual', b: [m.b[0] * W0, m.b[1] * H0, m.b[2] * W0, m.b[3] * H0] })));
  const stats = { face: dets.filter((d) => d.c === 'face').length, plate: dets.filter((d) => d.c === 'plate').length, intercom: dets.filter((d) => d.c === 'intercom').length, manual: (o.manual || []).length, sec: 0 };
  if (boxes.length) {
    const W = W0 & ~1, H = H0 & ~1, fb = (W * H * 3) / 2; let frame = null;
    await readFrames(run(['-i', o.file, '-vf', `crop=${W}:${H}:0:0,format=yuv420p`, '-frames:v', '1', '-f', 'rawvideo', 'pipe:1']), fb, async (buf) => { frame = buf; });
    for (const b of boxes) mosaicYUV(frame, W, H, b.b, b.c === 'manual' ? 'plate' : b.c, !!o.eq);
    const tmp = o.file + '.anon.jpg';
    const enc = run(['-y', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${W}x${H}`, '-i', 'pipe:0', '-frames:v', '1', '-q:v', '3', tmp], ['pipe', 'ignore', 'pipe']);
    let err = ''; enc.stderr.on('data', (d) => { err += d; });
    await new Promise((res, rej) => { enc.on('close', (c) => (c === 0 ? res() : rej(new Error(err.slice(-300) || 'jpeg код ' + c)))); enc.on('error', rej); enc.stdin.on('error', () => {}); enc.stdin.end(frame); });
    await fsp.rename(tmp, o.file);
  }
  stats.sec = Math.round((Date.now() - t0) / 1000);
  return { dets: dets.map((d) => ({ c: d.c, s: +d.s.toFixed(2), b: d.b.map((v) => Math.round(v)) })), stats };
}

// ---- Хүүхэд процесс: media.js нь хүнд ажлыг (илрүүлэх + кадр бүрийн мозайк) тусдаа процесст ажиллуулна — сервер (вэб хүсэлт) удаашрахгүй, санах ой тусгаарлагдана.
// stdin: { op: 'video' | 'render' | 'image', ... } → stdout мөр бүр: {msg} явц, эцэст нь {result} эсвэл {error}
if (require.main === module) {
  const say = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  let inp = ''; process.stdin.on('data', (d) => { inp += d; }).on('end', async () => {
    try {
      const job = JSON.parse(inp); const onMsg = (m) => say({ msg: m }); let result;
      if (job.op === 'video') { const det = await detectVideo({ ...job, onMsg }); const r = await renderVideo({ ...job, tracks: det.tracks, onMsg }); result = { ...det, render: r }; }
      else if (job.op === 'render') result = await renderVideo({ ...job, onMsg });
      else if (job.op === 'image') result = await anonymizeImage(job);
      else throw new Error('op буруу');
      say({ result }); process.exit(0);
    } catch (e) { say({ error: String((e && e.message) || e) }); process.exit(1); }
  });
}

module.exports = { ENABLED, MODELS_DIR, MODELS, TH, prepare, status, ensureModel, detectImage, buildTracks, boxesAt, grow, mosaicYUV, detectVideo, renderVideo, anonymizeImage, _t: { resample, chw, nms, iou, span, blockOf } };
