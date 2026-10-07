// «Зууч» — зургийн автомат засвар (AI-гүй, сервер дээр үнэгүй): өнцөг (далийлт), босоо шугамын перспектив, цагаан тэнцвэр, гэрэл/өнгө.
// Олон улсын үл хөдлөхийн зургийн жишиг: босоо шугам босоо, өнгө саармаг (шар/хөх туяагүй), дунд аяыг тод, тодорхой.
// Горим: 'natural' (бодит — зөөлөн засвар), 'vivid' (тод — илүү гэрэл, ханалт, тодрол). Эх зураг хэвээр, засвар нь тусдаа файл.
const { spawn } = require('child_process');

const AW = 640; // шинжилгээний өргөн
const runOut = (cmd, args) => new Promise((res, rej) => { const p = spawn(cmd, args); const ch = []; let err = ''; p.stdout.on('data', (d) => ch.push(d)); p.stderr.on('data', (d) => { err += d; }); p.on('error', rej); p.on('close', (c) => (c === 0 ? res(Buffer.concat(ch)) : rej(new Error(err.slice(-200) || cmd + ' ' + c)))); });
async function decode(file, w = AW) {
  let W = 0, H = 0; try { const s = JSON.parse(String(await runOut('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', file]))).streams[0]; W = s.width; H = s.height; } catch { /* */ }
  if (!W) throw new Error('Зураг уншигдсангүй');
  const h = Math.max(2, Math.round((w * H) / W / 2) * 2);
  const raw = await runOut('ffmpeg', ['-v', 'error', '-i', file, '-vf', `scale=${w}:${h},format=rgb24`, '-frames:v', '1', '-f', 'rawvideo', 'pipe:1']);
  if (!raw || raw.length < w * h * 3) throw new Error('Зураг задлагдсангүй');
  return { data: raw, w, h, W, H };
}
// Жинлэсэн гистограммын оргил (0.1° алхам, ±0.3° зөөлрүүлэлт): архитектурын босоо шугамууд нэг өнцөгт төвлөрдөг тул медианаас найдвартай
function peak(pairs) {
  if (pairs.length < 20) return null; const N = 241, hist = new Float64Array(N); for (const [v, wt] of pairs) { const b = Math.round((v + 12) * 10); if (b >= 0 && b < N) hist[b] += wt; }
  let best = -1, bi = 0; for (let i = 0; i < N; i++) { let s = 0; for (let k = -3; k <= 3; k++) { const j = i + k; if (j >= 0 && j < N) s += hist[j] * (4 - Math.abs(k)); } if (s > best) { best = s; bi = i; } }
  let sw = 0, sv = 0; for (let k = -4; k <= 4; k++) { const j = bi + k; if (j >= 0 && j < N) { sw += hist[j]; sv += hist[j] * (j / 10 - 12); } } return sw ? sv / sw : bi / 10 - 12;
}
const wmedian = (pairs) => { if (!pairs.length) return null; pairs.sort((a, b) => a[0] - b[0]); const tot = pairs.reduce((s, p) => s + p[1], 0); let acc = 0; for (const [v, wt] of pairs) { acc += wt; if (acc >= tot / 2) return v; } return pairs[pairs.length - 1][0]; };

// Босоо ирмэгүүдийн хазайлт (градус): бүх зураг (далийлт) ба зүүн/баруун гуравны нэг (перспектив)
function verticals(img) {
  const { data, w, h } = img; const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = data[i * 3] * 0.299 + data[i * 3 + 1] * 0.587 + data[i * 3 + 2] * 0.114;
  const all = [], left = [], right = [];
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
    const i = y * w + x;
    const gx = (L[i - w + 1] + 2 * L[i + 1] + L[i + w + 1]) - (L[i - w - 1] + 2 * L[i - 1] + L[i + w - 1]);
    const gy = (L[i + w - 1] + 2 * L[i + w] + L[i + w + 1]) - (L[i - w - 1] + 2 * L[i - w] + L[i - w + 1]);
    const ax = Math.abs(gx), ay = Math.abs(gy); if (ax < 90 || ax < 3 * ay) continue; // хүчтэй, бараг босоо ирмэг
    const deg = (Math.atan2(gy, gx > 0 ? gx : -gx) * 180) / Math.PI * (gx > 0 ? 1 : -1); // ирмэгийн босооноос хазайлт
    if (Math.abs(deg) > 12) continue;
    const p = [deg, ax]; all.push(p); if (x < w / 3) left.push(p); else if (x > (2 * w) / 3) right.push(p);
  }
  return { roll: peak(all), left: peak(left), right: peak(right), median: wmedian(all.slice()), n: all.length, nl: left.length, nr: right.length };
}
// Цагаан тэнцвэр (тод, хэт цайраагүй пикселийн дундаж саармаг болох) + гэрэлтэлтийн медиан
function tones(img) {
  const { data, w, h } = img; const lum = []; const px = [];
  for (let i = 0; i < w * h; i += 2) { const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2]; const l = 0.299 * r + 0.587 * g + 0.114 * b; lum.push(l); if (l > 40 && Math.max(r, g, b) < 248) px.push([l, r, g, b]); }
  lum.sort((a, b) => a - b); const med = lum[lum.length >> 1];
  px.sort((a, b) => b[0] - a[0]); const top = px.slice(0, Math.max(50, Math.floor(px.length * 0.3)));
  let R = 0, G = 0, B = 0; for (const p of top) { R += p[1]; G += p[2]; B += p[3]; } R /= top.length; G /= top.length; B /= top.length; const M = (R + G + B) / 3;
  const k = 0.75; const g = (c) => Math.max(0.82, Math.min(1.22, 1 + ((M / c) - 1) * k)); // 75%-ийг засна (дулаан өнгийг бүрэн устгахгүй)
  return { gains: [g(R), g(G), g(B)], cast: +(Math.max(R, G, B) / Math.min(R, G, B)).toFixed(3), median: Math.round(med) };
}
// Засварын параметр
async function plan(file, mode = 'natural') {
  const img = await decode(file); const v = verticals(img); const t = tones(img);
  const P = { W: img.W, H: img.H, mode, roll: 0, keystone: 0, gains: t.gains, gamma: 1, sat: mode === 'vivid' ? 1.14 : 1.04, contrast: mode === 'vivid' ? 1.06 : 1.02, sharpen: mode === 'vivid' ? 0.6 : 0.3, info: { verticals: v, tones: t } };
  // Зүүн/баруун гуравны нэгийн хазайлт: дундаж = далийлт (камер эргэсэн), зөрүүний хагас = перспектив (камер дээш/доош харсан)
  let roll = v.roll, key = 0;
  if (v.nl > 60 && v.nr > 60 && v.left != null && v.right != null) { roll = (v.left + v.right) / 2; key = (v.left - v.right) / 2; }
  if (v.n > 150 && roll != null && Math.abs(roll) >= 0.3 && Math.abs(roll) <= 8) P.roll = +roll.toFixed(2);
  if (v.nl >= 250 && v.nr >= 250 && Math.abs(key) >= 0.6 && Math.abs(key) <= 6) P.keystone = +key.toFixed(2); // босоо шугам цөөн / хэт их хазайлт (дээрээс авсан зураг) → перспективыг хөндөхгүй (гажуудуулна)
  // Гэрэл: үл хөдлөхийн зураг цайвар, тод байх жишигтэй — харанхуй бол гэрэлтүүлнэ; маш цайвар (≥215) бол бага зэрэг бууруулна, бусад үед хөндөхгүй
  const target = mode === 'vivid' ? 162 : 152; const m = Math.max(20, Math.min(240, t.median));
  const gam = Math.log(m / 255) / Math.log(target / 255);
  P.gamma = m < target ? +Math.min(1.6, gam).toFixed(3) : m >= 215 ? +Math.max(0.88, Math.log(m / 255) / Math.log(205 / 255)).toFixed(3) : 1; // eq gamma > 1 → гэрэлтүүлнэ
  return P;
}
// ffmpeg шүүлтүүрийн гинж
function filterChain(P) {
  const f = [];
  if (P.keystone) { const dx = Math.round(P.H * Math.tan((Math.abs(P.keystone) * Math.PI) / 180)); const top = P.keystone > 0; // дээшээ нарийссан → дээд булангуудыг сунгана
    f.push(top ? `perspective=x0=${dx}:y0=0:x1=W-${dx}:y1=0:x2=0:y2=H:x3=W:y3=H:interpolation=linear` : `perspective=x0=0:y0=0:x1=W:y1=0:x2=${dx}:y2=H:x3=W-${dx}:y3=H:interpolation=linear`); }
  if (P.roll) { const a = (-P.roll * Math.PI) / 180; const k = Math.cos(Math.abs(a)) + Math.sin(Math.abs(a)) * Math.max(P.W / P.H, P.H / P.W);
    f.push(`rotate=${a.toFixed(5)}:ow=iw:oh=ih:c=black`, `crop=iw/${k.toFixed(4)}:ih/${k.toFixed(4)}`, `scale=${P.W}:${P.H}:flags=lanczos`); }
  f.push(`colorchannelmixer=rr=${P.gains[0].toFixed(3)}:gg=${P.gains[1].toFixed(3)}:bb=${P.gains[2].toFixed(3)}`);
  f.push(`eq=gamma=${P.gamma}:saturation=${P.sat}:contrast=${P.contrast}`);
  if (P.sharpen) f.push(`unsharp=5:5:${P.sharpen}:5:5:0`);
  return f.join(',');
}
function render(src, out, P) {
  return new Promise((res, rej) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vf', filterChain(P), '-frames:v', '1', '-q:v', '2', out]); let err = '';
    p.stderr.on('data', (d) => { err += d; }); p.on('error', rej); p.on('close', (c) => (c === 0 ? res(out) : rej(new Error(err.slice(-300) || 'ffmpeg ' + c))));
  });
}
// Хэрэглэгчид ойлгомжтой тайлбар
function describe(P) {
  const s = []; if (P.roll) s.push(`${Math.abs(P.roll).toFixed(1)}° далийлт засав`); if (P.keystone) s.push('босоо шугам тэгшлэв');
  const c = P.info.tones.cast; if (c > 1.06) s.push('өнгөний туяа арилгав'); if (P.gamma > 1.08) s.push('гэрэл нэмэв'); else if (P.gamma < 0.93) s.push('хэт цайралт бууруулав');
  return s.length ? s.join(', ') : 'өнгө, тодрол сайжруулав';
}
async function fix(src, out, mode = 'natural') { const P = await plan(src, mode); await render(src, out, P); return { mode, roll: P.roll, keystone: P.keystone, gains: P.gains.map((g) => +g.toFixed(3)), gamma: P.gamma, note: describe(P) }; }

module.exports = { fix, plan, render, filterChain, verticals, tones, decode, describe };
