// «Зууч» — барилгын фасадын зурагнаас (агент/эзэмшигчийн ӨӨРИЙН утасны зураг) ханын өнгө ба давхрын тоог тооцоолох.
// Хэрэглээ: node tools/facade/extract.js --lat 47.92 --lng 106.88 [--out preview.jpg] N.jpg E.jpg S.jpg W.jpg
// Гаралт: data/geo/overrides.json-д нэмэх засвар { lat, lng, wc, wc2?, lv?, note } (stdout JSON) + шалгах зураг.
// ⚠️ Google Street View / Earth зэрэг гуравдагч талын зургийг ашиглахгүй (үйлчилгээний нөхцөл) — зөвхөн өөрсдийн авсан зураг.
const { spawnSync } = require('child_process'); const path = require('path');

const W = 640; // шинжилгээний өргөн
function load(file) {
  const pr = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const [w0, h0] = String(pr.stdout).trim().split(',').map(Number); if (!w0) throw new Error('Зураг уншигдсангүй: ' + file);
  const H = Math.round((W * h0) / w0 / 2) * 2;
  const raw = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `scale=${W}:${H},format=rgb24`, '-frames:v', '1', '-f', 'rawvideo', 'pipe:1'], { maxBuffer: 1 << 28 }).stdout;
  return { data: raw, w: W, h: H, file };
}
// sRGB → Lab (өнгөний зайг хүний нүдэнд ойр хэмжинэ)
function lab(r, g, b) {
  const f = (c) => { c /= 255; return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92; };
  const R = f(r), G = f(g), B = f(b); let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, y = R * 0.2126 + G * 0.7152 + B * 0.0722, z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const t = (v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116); x = t(x); y = t(y); z = t(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

// Пикселийн ангилал: тэнгэр (дээд захаас эхлэн өнгө жигд, бүтэцгүй үргэлжлэх хэсэг — цэнхэр, бүдэг, үдшийн шаргал ч бай), ургамал (ногоон), газар/машин (доод 22%) — эдгээрийг хасна.
// Агентын зураг дээр гол барилга голдоо байдаг тул өнгө/давхрыг төвийн 40% баганаас.
function facadeMask(img, box) {
  const { data, w, h } = img; const m = new Uint8Array(w * h); const L = new Float32Array(w * h), A = new Float32Array(w * h), B = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { const [l, a, b] = lab(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]); L[i] = l; A[i] = a; B[i] = b; }
  const top = []; for (let x = 0; x < w; x += 4) for (let y = 0; y < Math.max(3, h * 0.03); y++) top.push(y * w + x);
  const med = (arr) => arr.sort((p, q) => p - q)[arr.length >> 1];
  const sky = [med(top.map((i) => L[i])), med(top.map((i) => A[i])), med(top.map((i) => B[i]))]; const skyBright = sky[0] > 55;
  const skyLine = new Int32Array(w);
  for (let x = 0; x < w; x++) {
    let y = 0;
    if (skyBright) for (; y < h * 0.85; y++) { const i = y * w + x; const d = Math.hypot(L[i] - sky[0], A[i] - sky[1], B[i] - sky[2]); const gr = y ? Math.abs(L[i] - L[i - w]) : 0; if (d > 16 || gr > 6) break; }
    skyLine[x] = y;
  }
  // Хүрээ (агент апп-д хуруугаараа хүрээлсэн фасад, 0..1) — байхгүй бол төвийн 40% × дээрээс 78%
  const bx = box || [0.3, 0, 0.7, 0.78]; const X0 = Math.round(w * bx[0]), X1 = Math.round(w * bx[2]), Y0 = Math.round(h * bx[1]), yBottom = Math.round(h * bx[3]);
  for (let y = Y0; y < yBottom; y++) for (let x = X0; x < X1; x++) {
    if (y < skyLine[x] + 4) continue; const i = (y * w + x) * 3, r = data[i], g = data[i + 1], b = data[i + 2];
    if (g > r + 8 && g > b + 8 && g - Math.min(r, b) > 18) continue; // ургамал
    m[y * w + x] = 1;
  }
  return { m, skyLine, yBottom, x0: X0, x1: X1 };
}
// k-means (Lab) → ханын өнгө: хамгийн их талбайтай, хэт бараан биш (цонх/сүүдэр биш) бөөгнөрөл
function wallColors(img, mask) {
  const { data, w, h } = img; const px = []; const step = 2;
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) if (mask.m[y * w + x]) { const i = (y * w + x) * 3; px.push([data[i], data[i + 1], data[i + 2], ...lab(data[i], data[i + 1], data[i + 2])]); }
  if (px.length < 500) return null;
  const K = 5; let C = Array.from({ length: K }, (_, k) => px[Math.floor(((k + 0.5) / K) * px.length)].slice(3));
  let asg = new Int32Array(px.length);
  for (let it = 0; it < 12; it++) {
    for (let p = 0; p < px.length; p++) { let bi = 0, bd = Infinity; for (let k = 0; k < K; k++) { const d = (px[p][3] - C[k][0]) ** 2 + (px[p][4] - C[k][1]) ** 2 + (px[p][5] - C[k][2]) ** 2; if (d < bd) { bd = d; bi = k; } } asg[p] = bi; }
    const S = Array.from({ length: K }, () => [0, 0, 0, 0]); for (let p = 0; p < px.length; p++) { const s = S[asg[p]]; s[0] += px[p][3]; s[1] += px[p][4]; s[2] += px[p][5]; s[3]++; }
    C = S.map((s, k) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : C[k]));
  }
  const cl = C.map((c, k) => ({ k, L: c[0], n: 0, rgb: [0, 0, 0] }));
  for (let p = 0; p < px.length; p++) { const c = cl[asg[p]]; c.n++; c.rgb[0] += px[p][0]; c.rgb[1] += px[p][1]; c.rgb[2] += px[p][2]; }
  for (const c of cl) { if (c.n) c.rgb = c.rgb.map((v) => v / c.n); c.share = c.n / px.length; }
  const cand = cl.filter((c) => c.L > 38 && c.share > 0.06).sort((a, b) => b.share - a.share); // цонх, сүүдэр (бараан) хасагдана
  if (!cand.length) return null;
  const main = cand[0]; const second = cand.find((c) => c !== main && Math.hypot(c.L - main.L, ...C[c.k].slice(1).map((v, i) => v - C[main.k][i + 1])) > 14 && c.share > 0.12);
  return { wc: hex(...main.rgb), share: +main.share.toFixed(2), wc2: second ? hex(...second.rgb) : null, share2: second ? +second.share.toFixed(2) : 0, clusters: cl.map((c) => ({ hex: hex(...c.rgb), L: Math.round(c.L), share: +c.share.toFixed(2) })) };
}
// Давхар: фасадын (төвийн) мөр бүрийн гэрэлтэлт → удаан хандлагыг (гэрэл, сүүдэр) хасаад → автокорреляцийн хамгийн өндөр орон нутгийн оргил = нэг давхрын өндөр (px)
function floors(img, mask) {
  const { data, w } = img; const prof = []; const rows = [];
  for (let y = 0; y < mask.yBottom; y++) { let s = 0, n = 0; for (let x = mask.x0; x < mask.x1; x++) if (mask.m[y * w + x]) { const i = (y * w + x) * 3; s += data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11; n++; } if (n > (mask.x1 - mask.x0) * 0.6) { prof.push(s / n); rows.push(y); } }
  if (prof.length < 80) return null;
  const R = 25; const v = prof.map((p, i) => { let s = 0, n = 0; for (let k = Math.max(0, i - R); k <= Math.min(prof.length - 1, i + R); k++) { s += prof[k]; n++; } return p - s / n; }); // high-pass
  const ac = [1]; const v0 = v.reduce((a, b) => a + b * b, 0) / v.length || 1;
  const maxLag = Math.min(140, Math.floor(prof.length / 2.5)); for (let lag = 1; lag <= maxLag; lag++) { let s = 0, n = 0; for (let i = 0; i + lag < v.length; i++) { s += v[i] * v[i + lag]; n++; } ac.push(s / n / v0); }
  let best = 0, bestLag = 0; for (let lag = 12; lag < ac.length - 1; lag++) if (ac[lag] > ac[lag - 1] && ac[lag] >= ac[lag + 1] && ac[lag] > best) { best = ac[lag]; bestLag = lag; }
  if (!bestLag || best < 0.2) return { lv: null, conf: +best.toFixed(2) };
  const span = rows[rows.length - 1] - rows[0] + 1;
  return { lv: Math.max(1, Math.round(span / bestLag / 0.92)), periodPx: bestLag, conf: +best.toFixed(2), top: rows[0], bottom: rows[rows.length - 1] }; // доод давхар машин/модонд далдлагддаг тул ~8% нэмнэ
}
// Шалгах зураг: эх зураг + фасадын маск (цайвар), давхрын шугам, өнгөний дээж
function preview(img, mask, col, fl, out) {
  const { w, h } = img; const filt = [];
  if (fl && fl.lv) for (let y = fl.top; y <= fl.bottom; y += fl.periodPx) filt.push(`drawbox=x=0:y=${y}:w=${w}:h=1:color=yellow@0.8:t=fill`);
  filt.push(`drawbox=x=${mask.x0}:y=0:w=${mask.x1 - mask.x0}:h=${mask.yBottom}:color=cyan@0.7:t=2`);
  if (col) { filt.push(`drawbox=x=8:y=8:w=90:h=60:color=${col.wc.replace('#', '0x')}:t=fill`); if (col.wc2) filt.push(`drawbox=x=100:y=8:w=60:h=60:color=${col.wc2.replace('#', '0x')}:t=fill`); }
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', img.file, '-vf', `scale=${w}:${h},${filt.join(',')}`, '-frames:v', '1', out]);
}
function analyze(file, out, box) { const img = load(file); const mask = facadeMask(img, box); const col = wallColors(img, mask); const fl = floors(img, mask); if (out) preview(img, mask, col, fl, out); return { file: path.basename(file), ...col, floors: fl }; }

// Олон зураг (4 тал) → нэг засвар: өнгө = талбайгаар жинлэсэн медиан, давхар = итгэлтэй тооцооллын медиан
function combine(results, lat, lng) {
  const ok = results.filter((r) => r.wc); if (!ok.length) return null;
  const med = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const wc = hex(...[0, 1, 2].map((k) => med(ok.map((r) => rgb(r.wc)[k]))));
  const lvs = results.map((r) => r.floors && r.floors.lv).filter(Boolean); const wc2s = ok.map((r) => r.wc2).filter(Boolean);
  const o = { lat, lng, wc, note: `фасадын зураг ${results.length} (өөрсдийн авсан), ${new Date().toISOString().slice(0, 10)}` };
  if (wc2s.length >= Math.ceil(ok.length / 2)) o.wc2 = wc2s[0];
  if (lvs.length) o.lv_est = med(lvs);
  return o;
}

if (require.main === module) {
  const a = process.argv.slice(2); const opt = {}; const files = [];
  for (let i = 0; i < a.length; i++) { if (a[i].startsWith('--')) opt[a[i].slice(2)] = a[++i]; else files.push(a[i]); }
  if (!files.length) { console.error('Хэрэглээ: node tools/facade/extract.js --lat <lat> --lng <lng> [--outdir dir] N.jpg E.jpg S.jpg W.jpg'); process.exit(1); }
  const boxes = opt.boxes ? opt.boxes.split(';').map((b) => (b ? b.split(',').map(Number) : null)) : []; // «x0,y0,x1,y1;…» зураг бүрт
  const res = files.map((f, i) => analyze(f, opt.outdir ? path.join(opt.outdir, 'facade-' + i + '-' + path.basename(f)) : null, boxes[i] || null));
  console.log(JSON.stringify({ photos: res, override: combine(res, Number(opt.lat), Number(opt.lng)) }, null, 1));
}
module.exports = { analyze, combine, lab };
