// «Зууч» — POV аяллын бодит медиа: гадна/дотор алхалтын бичлэг (утас эсвэл 360 камер), өрөөний 360 зураг, бодит 3D (Gaussian splat).
// • Хэсэгчилсэн (chunked) upload: 8 MB хэсгүүд, тасарвал үргэлжилнэ, дарааллаас үл хамааран бичнэ (offset), диск чөлөөтэй эсэхийг урьдчилан шалгана.
// • Боловсруулалт (нэг удаад нэг, бага тэргүүлэх): ffmpeg — бичлэгийг вэб/гар утсанд тохирох H.264 (360: 3840×1920, энгийн: ≤1920), дуугүй (хувь хүний яриа),
//   зургийг ≤8192 JPEG + 2048 урьдчилсан харагдац (2:1 биш бол 360 хүрээнд нөхнө); splat: .ply → .splat (8 дахин бага), .spz/.splat-ийн төв/хүрээг тооцно.
// • Хадгалах: MEDIA_DIR (Railway: /data/media). Хадгалах сангийн шийдлийг (R2/S3) дараа нь энэ модулийн put/path/remove-ийг солиход хангалттай.
const fs = require('fs'); const fsp = fs.promises; const path = require('path'); const crypto = require('crypto'); const zlib = require('zlib');
const { spawn, spawnSync } = require('child_process');
const anon = require('./anonymize');

const MEDIA_DIR = process.env.ZUUCH_MEDIA || (process.env.RAILWAY_VOLUME_MOUNT_PATH ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'media') : path.join(__dirname, 'media'));
const TMP_DIR = path.join(MEDIA_DIR, '_uploads');
const MB = 1024 * 1024;
const CHUNK = 8 * MB;
// Хэмжээний дээд хязгаар (бодит төхөөрөмжөөс илүү зайтай; env-ээр өөрчилнө). Бодит хязгаар = дискний чөлөөт зай (canAccept).
const LIMITS = {
  video: Number(process.env.ZUUCH_MAX_VIDEO_MB || 4096) * MB, // Insta360 X4 8K ≈ 900 MB/мин → ~4.5 мин; iPhone 4K HEVC ≈ 170 MB/мин → ~24 мин; 1080p ≈ 60 MB/мин → ~1 цаг
  pano: Number(process.env.ZUUCH_MAX_PANO_MB || 150) * MB,    // 72MP 360 JPEG ≈ 25–35 MB, DNG ≈ 60 MB
  splat: Number(process.env.ZUUCH_MAX_SPLAT_MB || 600) * MB,  // Scaniverse SPZ өрөө ≈ 5–40 MB, .splat ≈ 30–150 MB
  ply: Number(process.env.ZUUCH_MAX_PLY_MB || 2048) * MB,     // Polycam/Luma PLY ≈ 100 MB – 1.5 GB (сервер .splat болгож 8× багасгана)
  roomplan: 50 * MB, track: 20 * MB,
};
const KINDS = { walk_ext: 'video', walk_in: 'video', pano: 'pano', splat: 'splat' };
const EXT_OK = { video: /\.(mp4|mov|m4v|webm|mkv|insv|avi|3gp)$/i, pano: /\.(jpe?g|png|webp|tiff?)$/i, splat: /\.(spz|splat|ksplat|ply)$/i };

let FF = null; // { ffmpeg, ffprobe, zscale }
function tools() {
  if (FF) return FF;
  const ok = (bin) => { try { return spawnSync(bin, ['-version'], { timeout: 8000 }).status === 0; } catch { return false; } };
  const ffmpeg = ok('ffmpeg') ? 'ffmpeg' : null, ffprobe = ok('ffprobe') ? 'ffprobe' : null;
  let zscale = false; if (ffmpeg) { try { zscale = /zscale/.test(spawnSync(ffmpeg, ['-hide_banner', '-filters'], { encoding: 'utf8', timeout: 8000 }).stdout || ''); } catch { /* */ } }
  const nice = process.platform !== 'win32' && ok('nice') ? 'nice' : null;
  FF = { ffmpeg, ffprobe, zscale, nice }; return FF;
}
function freeBytes(dir = MEDIA_DIR) { try { fs.mkdirSync(dir, { recursive: true }); const s = fs.statfsSync(dir); return s.bavail * s.bsize; } catch { return Infinity; } }
function diskInfo() { try { fs.mkdirSync(MEDIA_DIR, { recursive: true }); const s = fs.statfsSync(MEDIA_DIR); return { total: s.blocks * s.bsize, free: s.bavail * s.bsize }; } catch { return null; } }
async function dirSize(dir) { let n = 0; try { for (const e of await fsp.readdir(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); n += e.isDirectory() ? await dirSize(p) : (await fsp.stat(p)).size; } } catch { /* */ } return n; }
const gb = (b) => (b / 1024 / 1024 / 1024).toFixed(1) + ' GB';

// Хүлээн авах эсэх: төрөл, өргөтгөл, хэмжээ, диск (эх файл + хөрвүүлэлт + 300 MB нөөц)
function canAccept(kind, filename, size) {
  const cls = KINDS[kind]; if (!cls) return { error: 'Медиагийн төрөл буруу' };
  if (!EXT_OK[cls].test(filename || '')) return { error: { video: 'Бичлэг (mp4, mov, webm …) сонгоно уу', pano: '360 зураг (jpg, png, webp) сонгоно уу', splat: 'Бодит 3D файл (.spz, .ply, .splat, .ksplat) сонгоно уу' }[cls] };
  const isPly = cls === 'splat' && /\.ply$/i.test(filename);
  const lim = isPly ? LIMITS.ply : LIMITS[cls];
  if (!(size > 0)) return { error: 'Файлын хэмжээ тодорхойгүй' };
  if (size > lim) return { error: `Файл хэт том: ${(size / MB).toFixed(0)} MB (дээд хязгаар ${(lim / MB).toFixed(0)} MB)${cls === 'video' ? ' — 360 камерын апп-аас 5.7K/4K-ээр экспортлоно уу' : isPly ? ' — Scaniverse/Polycam-аас .spz-ээр экспортлоно уу' : ''}` };
  const need = size * (cls === 'video' ? 1.6 : cls === 'pano' ? 1.3 : 1.25) + 300 * MB; const free = freeBytes();
  if (free < need) return { error: `Сервер дээр зай хүрэлцэхгүй: чөлөөтэй ${gb(free)}, шаардлагатай ~${gb(need)}. Хуучин медиа устгах эсвэл хадгалах санг өргөтгөх хэрэгтэй.`, code: 'disk' };
  return { ok: true, cls, limit: lim };
}

// ---- Хэсэгчилсэн upload ----
const sessions = new Map(); // id → { id, mediaId, file, size, chunks, received:Set, meta, at }
async function initUpload({ mediaId, size, filename }) {
  await fsp.mkdir(TMP_DIR, { recursive: true });
  const id = crypto.randomBytes(12).toString('hex'); const file = path.join(TMP_DIR, id + path.extname(filename || '').toLowerCase().slice(0, 8));
  const fh = await fsp.open(file, 'w'); await fh.truncate(size); await fh.close(); // урьдчилан хуваарилсан файл — хэсгүүд offset-оор бичигдэнэ
  const s = { id, mediaId, file, size, chunks: Math.ceil(size / CHUNK), received: new Set(), at: Date.now(), filename };
  sessions.set(id, s); await saveSession(s); return s;
}
const sessFile = (id) => path.join(TMP_DIR, id + '.json');
async function saveSession(s) { await fsp.writeFile(sessFile(s.id), JSON.stringify({ ...s, received: [...s.received] })); }
async function getSession(id) {
  if (!/^[0-9a-f]{24}$/.test(String(id))) return null;
  if (sessions.has(id)) return sessions.get(id);
  try { const j = JSON.parse(await fsp.readFile(sessFile(id), 'utf8')); const s = { ...j, received: new Set(j.received) }; sessions.set(id, s); return s; } catch { return null; } // сервер дахин асвал дискнээс (resume)
}
async function writeChunk(s, index, buf) {
  index = Number(index); if (!Number.isInteger(index) || index < 0 || index >= s.chunks) throw new Error('Хэсгийн дугаар буруу');
  const expect = index === s.chunks - 1 ? s.size - index * CHUNK : CHUNK;
  if (buf.length !== expect) throw new Error(`Хэсгийн хэмжээ буруу (${buf.length} ≠ ${expect})`);
  const fh = await fsp.open(s.file, 'r+'); try { await fh.write(buf, 0, buf.length, index * CHUNK); } finally { await fh.close(); }
  s.received.add(index); s.at = Date.now(); if (s.received.size % 8 === 0 || s.received.size === s.chunks) await saveSession(s);
  return s.received.size;
}
async function finishUpload(s) {
  if (s.received.size !== s.chunks) throw new Error(`Дутуу: ${s.received.size}/${s.chunks} хэсэг`);
  sessions.delete(s.id); fsp.unlink(sessFile(s.id)).catch(() => {});
  return s.file;
}
async function abortUpload(s) { sessions.delete(s.id); await fsp.unlink(s.file).catch(() => {}); await fsp.unlink(sessFile(s.id)).catch(() => {}); }
// Хаягдсан upload-уудыг (24 цаг) цэвэрлэнэ
async function sweep() {
  try { for (const f of await fsp.readdir(TMP_DIR)) { const p = path.join(TMP_DIR, f); const st = await fsp.stat(p); if (Date.now() - st.mtimeMs > 24 * 3600e3) await fsp.unlink(p).catch(() => {}); } } catch { /* */ }
}

// ---- ffmpeg туслахууд ----
function run(bin, args, { onLine, timeoutMs = 6 * 3600e3 } = {}) {
  return new Promise((res, rej) => {
    const T = tools(); const cmd = T.nice ? T.nice : bin; const a = T.nice ? ['-n', '15', bin, ...args] : args;
    const p = spawn(cmd, a, { stdio: ['ignore', 'pipe', 'pipe'] }); let err = '', out = '';
    const to = setTimeout(() => { p.kill('SIGKILL'); rej(new Error('хугацаа хэтэрсэн')); }, timeoutMs);
    p.stdout.on('data', (d) => { out += d; if (onLine) for (const l of String(d).split('\n')) onLine(l); if (out.length > 4e6) out = out.slice(-1e6); });
    p.stderr.on('data', (d) => { err += d; if (err.length > 2e5) err = err.slice(-1e5); });
    p.on('error', (e) => { clearTimeout(to); rej(e); });
    p.on('close', (c) => { clearTimeout(to); c === 0 ? res(out) : rej(new Error((err.trim().split('\n').slice(-3).join(' ') || 'код ' + c).slice(0, 300))); });
  });
}
async function probe(file) {
  const T = tools(); if (!T.ffprobe) return null;
  const j = JSON.parse(await run(T.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { timeoutMs: 120000 }));
  const v = (j.streams || []).find((s) => s.codec_type === 'video'); if (!v) return { format: j.format };
  let w = v.width, h = v.height; const rot = Number((v.tags && v.tags.rotate) || ((v.side_data_list || []).find((d) => d.rotation != null) || {}).rotation || 0);
  if (Math.abs(rot) % 180 === 90) [w, h] = [h, w];
  const spherical = (v.side_data_list || []).some((d) => /spherical/i.test(d.side_data_type || '')) || /equirect/i.test(JSON.stringify(v.tags || {}));
  return { w, h, codec: v.codec_name, duration: Number(v.duration || (j.format && j.format.duration) || 0), transfer: v.color_transfer || '', fps: v.avg_frame_rate, spherical, pixfmt: v.pix_fmt, still: (Number(v.nb_frames) || 0) <= 1 && !Number(v.duration) };
}

// Гаралтын хэмжээ (тэгш тоо): 360 → ≤3840×1920 (2:1), энгийн → урт тал ≤1920
function outDims(pr, eq) {
  const ev = (v) => Math.max(2, Math.round(v / 2) * 2);
  if (eq) { const W = ev(Math.min(3840, pr.w)); return { W, H: ev(W / 2) }; }
  if (pr.w >= pr.h) { const W = ev(Math.min(1920, pr.w)); return { W, H: ev((W * pr.h) / pr.w) }; }
  const H = ev(Math.min(1920, pr.h)); return { W: ev((H * pr.w) / pr.h), H };
}
// Кадрын давтамж (≤30): 29.97/23.976-г хадгална
function outFps(rate) {
  const [a, b] = String(rate || '').split('/').map(Number); const n = b ? a / b : a;
  if (!(n > 0) || n > 30.5) return '30';
  for (const [v, s] of [[30000 / 1001, '30000/1001'], [24000 / 1001, '24000/1001'], [25, '25'], [24, '24'], [30, '30']]) if (Math.abs(n - v) < 0.006) return s;
  return String(Math.max(10, Math.min(30, Math.round(n))));
}
const X264 = (eq, out, crfAdj = 0) => ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', String((eq ? 23 : 24) + crfAdj), '-maxrate', eq ? '16M' : '8M', '-bufsize', eq ? '32M' : '16M', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-threads', '4', '-movflags', '+faststart', out];
const blurOn = (m) => anon.ENABLED && !(m.meta && m.meta.blur === false);
// Бүдгэрүүлэлтийг тусдаа Node процесст (nice 15): илрүүлэгч + кадр бүрийн мозайк вэб серверийн event loop-ыг ачаалахгүй
function anonChild(job, onMsg, timeoutMs = 6 * 3600e3) {
  return new Promise((res, rej) => {
    const T = tools(); const node = process.execPath, script = path.join(__dirname, 'anonymize.js');
    const p = spawn(T.nice || node, T.nice ? ['-n', '15', node, script] : [script], { stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '', err = '', result = null, fail = null;
    const to = setTimeout(() => { p.kill('SIGKILL'); fail = 'хугацаа хэтэрсэн'; }, timeoutMs);
    p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { const o = JSON.parse(line); if (o.msg && onMsg) onMsg(o.msg); if (o.result) result = o.result; if (o.error) fail = o.error; } catch { /* лог мөр */ } } });
    p.stderr.on('data', (d) => { err += d; if (err.length > 2e4) err = err.slice(-1e4); });
    p.on('error', (e) => { clearTimeout(to); rej(e); });
    p.on('close', (c) => { clearTimeout(to); if (result && c === 0) res(result); else rej(new Error((fail || err.trim().split('\n').slice(-2).join(' ') || 'бүдгэрүүлэгч код ' + c).slice(0, 300))); });
    p.stdin.on('error', () => {}); p.stdin.end(JSON.stringify({ ...job, ff: { ffmpeg: T.ffmpeg, nice: T.nice } }));
  });
}
async function makePoster(T, out, poster, dur, eq) { await run(T.ffmpeg, ['-y', '-hide_banner', '-ss', String(Math.min(1, dur / 3)), '-i', out, '-frames:v', '1', '-vf', eq ? 'scale=1024:512' : "scale='min(960,iw)':-2", '-q:v', '4', poster], { timeoutMs: 120000 }).catch(() => {}); }

// Энгийн (360 биш) бичлэгт баруун дээд буланд брэнд тэмдэг (QR + «Смарт Зууч · Virtual POV Tour технологи») шигтгэнэ — татаж авсан файлд ч үлдэнэ
const BADGE = path.join(__dirname, 'public', 'brand', 'video-badge.png');
function brandFor(W, eq, H = 0) { if (eq || process.env.ZUUCH_VIDEO_BRAND === '0' || !fs.existsSync(BADGE)) return null; return { file: BADGE, bw: Math.round(W * (H > W ? 0.44 : 0.27) / 2) * 2, m: Math.round(Math.min(W, H || W) * 0.03) }; } // босоо (утасны) бичлэгт томоор
const brandFilter = (b, base) => `[1:v]scale=${b.bw}:-1:flags=lanczos[zb];${base}[zb]overlay=W-w-${b.m}:${b.m}:format=auto,format=yuv420p[zv]`;

async function processVideo(m, src, outDir, onMsg) {
  const T = tools(); if (!T.ffmpeg) throw new Error('Сервер дээр ffmpeg суугаагүй — бичлэг хөрвүүлэх боломжгүй');
  const pr = await probe(src); if (!pr || !pr.w) throw new Error('Бичлэг уншигдсангүй (кодек дэмжигдэхгүй?)');
  const eq = m.projection === 'equirect' || (m.projection !== 'flat' && (pr.spherical || Math.abs(pr.w / pr.h - 2) < 0.06));
  const out = path.join(outDir, `${m.id}.mp4`), poster = path.join(outDir, `${m.id}-poster.jpg`), tmp = path.join(outDir, `${m.id}.part.mp4`);
  const hdr = /arib-std-b67|smpte2084/.test(pr.transfer) && T.zscale ? 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,' : ''; // iPhone HDR → SDR
  const { W, H } = outDims(pr, eq); const fps = outFps(pr.fps); const dur = pr.duration || 1;
  const brand = brandFor(W, eq, H);
  const meta = { src_codec: pr.codec, src_w: pr.w, src_h: pr.h, hdr: !!hdr, brand: !!brand };
  if (blurOn(m)) {
    // 1) илрүүлэх (4 кадр/с) → 2) нэг удаа кодлох: кадр бүрт мозайк (нүүр, улсын дугаар, домофон)
    const det = await anonChild({ op: 'video', src, pre: hdr, W, H, eq, fps, duration: dur, kind: m.kind, vf: `${hdr}scale=${W}:${H}:flags=lanczos,fps=${fps},setsar=1,format=yuv420p`, enc: X264(eq, tmp), brand }, onMsg);
    await fsp.rename(tmp, out);
    await fsp.writeFile(path.join(outDir, `${m.id}-blur.json`), JSON.stringify({ W, H, fps, tracks: det.tracks })).catch(() => {}); // гараар засах үед харуулах (нийтэд үйлчлэхгүй)
    meta.anon = det.stats;
  } else {
    const vf = `${hdr}scale=${W}:${H}:flags=lanczos,fps=${fps},setsar=1,format=yuv420p`;
    const vargs = brand ? ['-i', brand.file, '-filter_complex', `[0:v:0]${vf}[zbase];` + brandFilter(brand, '[zbase]'), '-map', '[zv]'] : ['-map', '0:v:0', '-vf', vf];
    await run(T.ffmpeg, ['-y', '-hide_banner', '-i', src, ...vargs, '-an', '-sn', '-dn', '-map_metadata', '-1', '-progress', 'pipe:1', '-nostats', ...X264(eq, out)],
      { onLine: (l) => { const mm = /^out_time_ms=(\d+)/.exec(l); if (mm) onMsg(`Хөрвүүлж байна… ${Math.min(99, Math.round(Number(mm[1]) / 1e6 / dur * 100))}%`); } });
    meta.anon = { off: true };
  }
  await makePoster(T, out, poster, dur, eq);
  const po = await probe(out);
  return { file: path.basename(out), poster: fs.existsSync(poster) ? path.basename(poster) : null, size: (await fsp.stat(out)).size, duration: po ? po.duration : pr.duration, width: po ? po.w : W, height: po ? po.h : H, projection: eq ? 'equirect' : 'flat', meta };
}

async function processPano(m, src, outDir, onMsg) {
  const T = tools(); if (!T.ffmpeg) throw new Error('Сервер дээр ffmpeg суугаагүй');
  const pr = await probe(src); if (!pr || !pr.w) throw new Error('Зураг уншигдсангүй');
  const ar = pr.w / pr.h; const out = path.join(outDir, `${m.id}.jpg`), prev = path.join(outDir, `${m.id}-preview.jpg`);
  // 2:1 биш (утасны хэвтээ панорам ~4:1, эсвэл бүтэн биш) → 360 хүрээнд саарал хүрээгээр нөхнө
  const pad = ar > 2.04 ? 'pad=iw:ceil(iw/4)*2:0:(oh-ih)/2:color=0x6b6f75,' : ar < 1.96 ? 'pad=ceil(ih*2/2)*2:ih:(ow-iw)/2:0:color=0x6b6f75,' : '';
  await run(T.ffmpeg, ['-y', '-hide_banner', '-i', src, '-map_metadata', '-1', '-vf', `${pad}scale='min(8192,iw)':-2:flags=lanczos`, '-q:v', blurOn(m) ? '2' : '3', out], { timeoutMs: 300000 });
  let po = await probe(out); const meta = { partial: !!pad, src_w: pr.w, src_h: pr.h };
  if (blurOn(m)) { if (onMsg) onMsg('Нүүр, дугаар, домофон хайж байна…'); const r = await anonChild({ op: 'image', file: out, width: po.w, height: po.h, eq: true, intercom: true }, onMsg); meta.anon = r.stats; po = await probe(out); }
  await run(T.ffmpeg, ['-y', '-hide_banner', '-i', out, '-vf', 'scale=2048:1024', '-q:v', '5', prev], { timeoutMs: 120000 });
  return { file: path.basename(out), poster: path.basename(prev), size: (await fsp.stat(out)).size + (await fsp.stat(prev)).size, width: po.w, height: po.h, projection: 'equirect', meta };
}

// Гараар нэмсэн бүдгэрүүлэлт (автомат илрүүлэгч алдсан хэсэг): одоогийн файл дээр мозайк нэмж дахин кодлоно.
// regions: [{ k: [{ t, b: [x1,y1,x2,y2] (0..1) }], hold (с) }] — бичлэгт түлхүүр кадр хооронд шугаман шилжинэ; зурагт t хамаарахгүй
async function reblur(m, regions, onMsg) {
  const T = tools(); if (!T.ffmpeg) throw new Error('Сервер дээр ffmpeg суугаагүй');
  const file = filePath(m, m.file); if (!file || !fs.existsSync(file)) throw new Error('Медиа файл олдсонгүй');
  const dir = path.dirname(file);
  if (KINDS[m.kind] === 'pano') {
    await anonChild({ op: 'image', file, width: m.width, height: m.height, eq: true, skipDetect: true, manual: regions.map((r) => ({ b: r.k[0].b })) }, onMsg);
    const prev = path.join(dir, `${m.id}-preview.jpg`); await run(T.ffmpeg, ['-y', '-hide_banner', '-i', file, '-vf', 'scale=2048:1024', '-q:v', '5', prev], { timeoutMs: 120000 });
    return { size: (await fsp.stat(file)).size + (await fsp.stat(prev)).size };
  }
  const pr = await probe(file); const eq = m.projection === 'equirect'; const W = pr.w, H = pr.h; const fps = outFps(pr.fps); const tmp = path.join(dir, `${m.id}.part.mp4`);
  const tracks = regions.map((r) => ({ c: 'manual', hold: Number(r.hold) || 0, k: r.k.map((k) => ({ t: Number(k.t) || 0, b: [k.b[0] * W, k.b[1] * H, k.b[2] * W, k.b[3] * H] })).sort((a, b) => a.t - b.t) }));
  await anonChild({ op: 'render', src: file, vf: 'format=yuv420p', W, H, fps, tracks, eq, duration: pr.duration, enc: X264(eq, tmp, -2) }, onMsg); // CRF −2: дахин кодлолтын алдагдлыг багасгана
  await fsp.rename(tmp, file); await makePoster(T, file, path.join(dir, `${m.id}-poster.jpg`), pr.duration || 1, eq);
  return { size: (await fsp.stat(file)).size };
}

// ---- Splat ----
// Хүрээ: 10–90 перцентилийн дунд (сул цэгүүд нөлөөлөхгүй)
function boundsOf(xs, ys, zs) {
  const q = (a, p) => { const s = Float32Array.from(a).sort(); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))]; };
  const lo = [q(xs, 0.05), q(ys, 0.05), q(zs, 0.05)], hi = [q(xs, 0.95), q(ys, 0.95), q(zs, 0.95)];
  return { min: lo.map((v) => +v.toFixed(3)), max: hi.map((v) => +v.toFixed(3)), center: lo.map((v, i) => +((v + hi[i]) / 2).toFixed(3)) };
}
// .ply (3DGS: f_dc/opacity/scale/rot; эсвэл энгийн цэгэн үүл) → antimatter15 .splat (32 байт/цэг) — урсгалаар, санах ой бага
async function plyToSplat(src, dst, onMsg) {
  const fd = await fsp.open(src, 'r'); const head = Buffer.alloc(64 * 1024); await fd.read(head, 0, head.length, 0);
  const end = head.indexOf('end_header'); if (end < 0) { await fd.close(); throw new Error('PLY толгой олдсонгүй'); }
  const hdr = head.slice(0, end).toString('latin1'); const dataStart = head.indexOf('\n', end) + 1;
  if (!/format binary_little_endian/.test(hdr)) { await fd.close(); throw new Error('Зөвхөн binary_little_endian PLY дэмжинэ'); }
  const vm = /element vertex (\d+)/.exec(hdr); const N = vm ? Number(vm[1]) : 0; if (!N) { await fd.close(); throw new Error('PLY-д цэг алга'); }
  const TY = { char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int16: 2, uint16: 2, int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };
  const props = []; let off = 0; const vsec = hdr.split(/element vertex \d+/)[1].split(/element /)[0];
  for (const m of vsec.matchAll(/property (\w+) (\w+)/g)) { props.push({ type: m[1], name: m[2], off }); off += TY[m[1]] || 4; }
  const stride = off; const P = Object.fromEntries(props.map((p) => [p.name, p]));
  const rd = (b, o, p) => { if (!p) return null; const t = p.type; return t === 'float' || t === 'float32' ? b.readFloatLE(o + p.off) : t === 'double' || t === 'float64' ? b.readDoubleLE(o + p.off) : t === 'uchar' || t === 'uint8' ? b.readUInt8(o + p.off) : b.readFloatLE(o + p.off); };
  const gauss = !!(P.f_dc_0 && P.opacity && P.scale_0 && P.rot_0); const SH_C0 = 0.28209479177387814;
  const out = await fsp.open(dst, 'w'); const B = 65536; const inBuf = Buffer.alloc(B * stride); const ob = Buffer.alloc(B * 32);
  const sx = [], sy = [], sz = []; const every = Math.max(1, Math.floor(N / 200000));
  try {
    for (let i0 = 0; i0 < N; i0 += B) {
      const n = Math.min(B, N - i0); await fd.read(inBuf, 0, n * stride, dataStart + i0 * stride);
      for (let k = 0; k < n; k++) {
        const o = k * stride, w = k * 32; const x = rd(inBuf, o, P.x), y = rd(inBuf, o, P.y), z = rd(inBuf, o, P.z);
        ob.writeFloatLE(x, w); ob.writeFloatLE(y, w + 4); ob.writeFloatLE(z, w + 8);
        if ((i0 + k) % every === 0) { sx.push(x); sy.push(y); sz.push(z); }
        if (gauss) {
          ob.writeFloatLE(Math.exp(rd(inBuf, o, P.scale_0)), w + 12); ob.writeFloatLE(Math.exp(rd(inBuf, o, P.scale_1)), w + 16); ob.writeFloatLE(Math.exp(rd(inBuf, o, P.scale_2)), w + 20);
          const c = (v) => Math.max(0, Math.min(255, Math.round((0.5 + SH_C0 * v) * 255)));
          ob[w + 24] = c(rd(inBuf, o, P.f_dc_0)); ob[w + 25] = c(rd(inBuf, o, P.f_dc_1)); ob[w + 26] = c(rd(inBuf, o, P.f_dc_2)); ob[w + 27] = Math.max(0, Math.min(255, Math.round(255 / (1 + Math.exp(-rd(inBuf, o, P.opacity))))));
          let q0 = rd(inBuf, o, P.rot_0), q1 = rd(inBuf, o, P.rot_1), q2 = rd(inBuf, o, P.rot_2), q3 = rd(inBuf, o, P.rot_3); const ql = Math.hypot(q0, q1, q2, q3) || 1;
          ob[w + 28] = Math.round((q0 / ql) * 128 + 128); ob[w + 29] = Math.round((q1 / ql) * 128 + 128); ob[w + 30] = Math.round((q2 / ql) * 128 + 128); ob[w + 31] = Math.round((q3 / ql) * 128 + 128);
        } else { // цэгэн үүл: 1 см бөмбөлөг, бүрэн тунгалаг биш
          for (const j of [12, 16, 20]) ob.writeFloatLE(0.01, w + j);
          const r = rd(inBuf, o, P.red || P.r), g = rd(inBuf, o, P.green || P.g), b = rd(inBuf, o, P.blue || P.b);
          ob[w + 24] = r == null ? 200 : r > 1 ? r : r * 255; ob[w + 25] = g == null ? 200 : g > 1 ? g : g * 255; ob[w + 26] = b == null ? 200 : b > 1 ? b : b * 255; ob[w + 27] = 255;
          ob[w + 28] = 255; ob[w + 29] = 128; ob[w + 30] = 128; ob[w + 31] = 128;
        }
      }
      await out.write(ob, 0, n * 32); if (onMsg) onMsg(`3D хөрвүүлж байна… ${Math.round(((i0 + n) / N) * 100)}%`);
    }
  } finally { await fd.close(); await out.close(); }
  return { count: N, gauss, ...boundsOf(sx, sy, sz) };
}
// .splat-ийн хүрээ (32 байт/цэг)
async function splatBounds(src) {
  const st = await fsp.stat(src); const N = Math.floor(st.size / 32); const fd = await fsp.open(src, 'r'); const every = Math.max(1, Math.floor(N / 200000)); const b = Buffer.alloc(12); const sx = [], sy = [], sz = [];
  try { for (let i = 0; i < N; i += every) { await fd.read(b, 0, 12, i * 32); sx.push(b.readFloatLE(0)); sy.push(b.readFloatLE(4)); sz.push(b.readFloatLE(8)); } } finally { await fd.close(); }
  return { count: N, ...boundsOf(sx, sy, sz) };
}
// .spz (Niantic, gzip): толгой 16 байт (NGSP, хувилбар, цэгийн тоо, SH зэрэг, бутархай бит, туг), дараа нь байрлал 24-бит fixed point ×3
async function spzBounds(src) {
  const raw = zlib.gunzipSync(await fsp.readFile(src), { maxOutputLength: 3 * 1024 * MB });
  if (raw.readUInt32LE(0) !== 0x5053474e) throw new Error('SPZ толгой буруу');
  const version = raw.readUInt32LE(4), N = raw.readUInt32LE(8), shDeg = raw[12], fb = raw[13];
  const every = Math.max(1, Math.floor(N / 200000)); const sx = [], sy = [], sz = []; const s = 1 / (1 << fb); const base = 16;
  const i24 = (o) => { let v = raw[o] | (raw[o + 1] << 8) | (raw[o + 2] << 16); if (v & 0x800000) v |= ~0xffffff; return v * s; };
  if (version >= 2) for (let i = 0; i < N; i += every) { const o = base + i * 9; sx.push(i24(o)); sy.push(i24(o + 3)); sz.push(i24(o + 6)); }
  return { count: N, version, shDegree: shDeg, ...boundsOf(sx, sy, sz) };
}
async function processSplat(m, src, outDir, onMsg) {
  const ext = path.extname(src).toLowerCase();
  if (ext === '.ply') { const out = path.join(outDir, `${m.id}.splat`); const r = await plyToSplat(src, out, onMsg); return { file: path.basename(out), size: (await fsp.stat(out)).size, meta: { format: 'splat', from: 'ply', ...r } }; }
  const out = path.join(outDir, `${m.id}${ext}`); await fsp.rename(src, out).catch(async () => { await fsp.copyFile(src, out); });
  let info = {}; try { info = ext === '.splat' ? await splatBounds(out) : ext === '.spz' ? await spzBounds(out) : {}; } catch (e) { info = { warn: e.message }; }
  return { file: path.basename(out), size: (await fsp.stat(out)).size, meta: { format: ext.slice(1), ...info }, moved: true };
}

// ---- Боловсруулалтын дараалал (нэг удаад нэг) ----
const queue = []; let busy = false; let DB = null;
function setDb(db) { DB = db; }
const mediaDirOf = (m) => path.join(MEDIA_DIR, String(m.company_id), String(m.property_id));
function filePath(m, name) { if (!name || !/^[\w.-]+$/.test(name)) return null; return path.join(mediaDirOf(m), name); }
// Брэнд тэмдэггүй (өмнө нь боловсруулсан) энгийн бичлэгт брэнд шигтгэх: одоогийн файл дээр давхарлаж дахин кодлоно (бүдгэрүүлэлт хэвээр)
async function rebrand(m, onMsg) {
  const T = tools(); if (!T.ffmpeg) throw new Error('Сервер дээр ffmpeg суугаагүй');
  const file = filePath(m, m.file); if (!file || !fs.existsSync(file)) throw new Error('Медиа файл олдсонгүй');
  const pr = await probe(file); if (!pr || !pr.w) throw new Error('Бичлэг уншигдсангүй');
  const eq = m.projection === 'equirect'; const brand = brandFor(pr.w, eq, pr.h); if (!brand) return { skipped: true };
  const dir = path.dirname(file), tmp = path.join(dir, `${m.id}.part.mp4`), dur = pr.duration || 1;
  await run(T.ffmpeg, ['-y', '-hide_banner', '-i', file, '-i', brand.file, '-filter_complex', brandFilter(brand, '[0:v:0]'), '-map', '[zv]', '-an', '-sn', '-dn', '-map_metadata', '-1', '-progress', 'pipe:1', '-nostats', ...X264(eq, tmp, -2)],
    { onLine: (l) => { const mm = /^out_time_ms=(\d+)/.exec(l); if (mm && onMsg) onMsg(`Брэнд шигтгэж байна… ${Math.min(99, Math.round(Number(mm[1]) / 1e6 / dur * 100))}%`); } });
  await fsp.rename(tmp, file); await makePoster(T, file, path.join(dir, `${m.id}-poster.jpg`), dur, eq);
  return { size: (await fsp.stat(file)).size };
}
// Сервер асахад: брэндгүй хуучин энгийн бичлэгүүдийг дараалалд нэмнэ (нэг удаа — meta.brand тэмдэглэгдэнэ). ZUUCH_REBRAND_AUTO=0 унтраана
async function rebrandAll(db) {
  if (process.env.ZUUCH_VIDEO_BRAND === '0' || !fs.existsSync(BADGE)) return 0;
  const rows = await db.all("SELECT id FROM tour_media WHERE status='ready' AND file IS NOT NULL AND kind IN (" + Object.keys(KINDS).filter((k) => KINDS[k] === 'video').map((k) => `'${k}'`).join(',') + ") AND COALESCE(projection,'flat') <> 'equirect' AND COALESCE(meta->>'brand','false') <> 'true' AND meta->>'brand_err' IS NULL AND meta->>'brand_skip' IS NULL ORDER BY id");
  for (const r of rows) if (!queue.some((j) => j.mediaId === r.id)) enqueue(r.id, null, { op: 'rebrand' });
  const all = await db.one("SELECT COUNT(*)::int n, COUNT(*) FILTER (WHERE projection='equirect')::int eq, COUNT(*) FILTER (WHERE meta->>'brand'='true')::int done FROM tour_media WHERE status='ready' AND file IS NOT NULL AND kind IN ('walk_ext','walk_in')").catch(() => ({}));
  console.log(`[медиа] брэнд шигтгэх: ${rows.length} хуучин бичлэг дараалалд · нийт бэлэн бичлэг ${all.n} (360: ${all.eq}, брэндтэй: ${all.done})`);
  return rows.length;
}
function enqueue(mediaId, src, extra = {}) { queue.push({ mediaId, src, ...extra }); pump(); }
async function pump() {
  if (busy || !queue.length || !DB) return; busy = true; const job = queue.shift();
  const m = await DB.one('SELECT * FROM tour_media WHERE id=?', job.mediaId).catch(() => null);
  try {
    if (!m) throw new Error('Медиа олдсонгүй');
    const outDir = mediaDirOf(m); await fsp.mkdir(outDir, { recursive: true });
    let last = 0; const msg = (t) => { if (Date.now() - last > 1500) { last = Date.now(); DB.run('UPDATE tour_media SET msg=? WHERE id=?', t, m.id).catch(() => {}); } };
    if (job.op !== 'rebrand') await DB.run("UPDATE tour_media SET status='processing', msg='Боловсруулж байна…' WHERE id=?", m.id); // брэнд шигтгэх үед аялалд харагдсаар (файлыг эцэст нь солино)
    if (job.op === 'reblur') { // гараар нэмсэн бүдгэрүүлэлт — файл хэвээр, мозайк нэмнэ
      const r = await reblur(m, job.regions, msg);
      await DB.run(`UPDATE tour_media SET status='ready', msg='', size=?, meta=jsonb_set(COALESCE(meta,'{}'::jsonb), '{manual}', ?::jsonb) WHERE id=?`, r.size, JSON.stringify(job.regions), m.id);
      return;
    }
    if (job.op === 'rebrand') { // хуучин бичлэгт брэнд тэмдэг — алдаа гарвал файл хэвээр, бэлэн хэвээр
      const r = await rebrand(m, msg);
      await DB.run(`UPDATE tour_media SET status='ready', msg='', size=COALESCE(?, size), meta=COALESCE(meta,'{}'::jsonb) || ?::jsonb WHERE id=?`, r.size || null, JSON.stringify({ brand: !r.skipped, ...(r.skipped ? { brand_skip: true } : {}) }), m.id);
      return;
    }
    const cls = KINDS[m.kind];
    const r = cls === 'video' ? await processVideo(m, job.src, outDir, msg) : cls === 'pano' ? await processPano(m, job.src, outDir, msg) : await processSplat(m, job.src, outDir, msg);
    if (!r.moved && process.env.ZUUCH_KEEP_ORIGINALS !== '1') await fsp.unlink(job.src).catch(() => {});
    await DB.run(`UPDATE tour_media SET status='ready', msg='', file=?, poster=?, size=?, duration=?, width=?, height=?, projection=COALESCE(?, projection), meta=COALESCE(meta,'{}'::jsonb) || ?::jsonb WHERE id=?`,
      r.file, r.poster || null, r.size || 0, r.duration || null, r.width || null, r.height || null, r.projection || null, JSON.stringify(r.meta || {}), m.id);
  } catch (e) {
    if (job.src) await fsp.unlink(job.src).catch(() => {});
    if (m && (job.op === 'reblur' || job.op === 'rebrand')) await DB.run("UPDATE tour_media SET status='ready', msg=? WHERE id=?", ((job.op === 'reblur' ? 'Гараар бүдгэрүүлэлт амжилтгүй: ' : 'Брэнд шигтгэж чадсангүй: ') + String(e.message || e)).slice(0, 300), m.id).catch(() => {}); // файл хэвээр — бэлэн хэвээр үлдээнэ
    if (m && job.op === 'rebrand') { await fsp.unlink(path.join(mediaDirOf(m), `${m.id}.part.mp4`)).catch(() => {}); await DB.run("UPDATE tour_media SET meta=COALESCE(meta,'{}'::jsonb) || '{\"brand_err\":true}'::jsonb WHERE id=?", m.id).catch(() => {}); } // дахин дахин оролдохгүй
    else if (m) await DB.run("UPDATE tour_media SET status='error', msg=? WHERE id=?", String(e.message || e).slice(0, 300), m.id).catch(() => {});
    console.error('[медиа]', job.mediaId, e.message);
  } finally { busy = false; setImmediate(pump); }
}
async function removeFiles(m) { for (const n of [m.file, m.poster, `${m.id}-blur.json`, `${m.id}.part.mp4`]) { const p = filePath(m, n); if (p) await fsp.unlink(p).catch(() => {}); } }
async function removeDirIfEmpty(companyId, propertyId) { const d = path.join(MEDIA_DIR, String(Number(companyId)), String(Number(propertyId))); await fsp.rmdir(d).catch(() => {}); } // хоосон биш бол үлдэнэ
// Сервер дахин асахад: «processing» үлдсэн медиаг алдаа гэж тэмдэглэнэ (эх файл устсан байж болно)
async function boot(db) {
  setDb(db); await fsp.mkdir(TMP_DIR, { recursive: true }).catch(() => {});
  await db.run("UPDATE tour_media SET status='error', msg='Сервер дахин эхэлсэн — дахин оруулна уу' WHERE status='processing' AND file IS NULL").catch(() => {});
  await db.run("UPDATE tour_media SET status='ready', msg='' WHERE status='processing' AND file IS NOT NULL").catch(() => {}); // reblur/rebrand тасарсан: хуучин файл хэвээр
  if (process.env.ZUUCH_REBRAND_AUTO !== '0') setTimeout(() => rebrandAll(db).catch((e) => console.error('[медиа] rebrand', e.message)), 60e3).unref();
  anon.prepare(); // бүдгэрүүлэх загваруудыг урьдчилан татна
  sweep(); setInterval(sweep, 3600e3).unref();
}

module.exports = { rebrandAll, _t: { processVideo, processPano, reblur, rebrand }, MEDIA_DIR, CHUNK, LIMITS, KINDS, anon, outDims, outFps, removeDirIfEmpty, canAccept, initUpload, getSession, writeChunk, finishUpload, abortUpload, enqueue, filePath, removeFiles, boot, tools, diskInfo, dirSize, plyToSplat, splatBounds, spzBounds, probe, queueLength: () => queue.length + (busy ? 1 : 0) };
