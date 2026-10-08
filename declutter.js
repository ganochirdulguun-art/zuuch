// «Зууч» — виртуал цэгцлэлт (Gemini 2.5 Flash Image): түр зуурын эд зүйл, хог, барилгын үлдэгдэл, хүүхдийн тоглоом, хүнийг арилгаж,
// архитектур (хана, шал, цонх, хаалга, тааз, гэрэлтүүлэг, суурилуулсан тоноглол) болон камерын өнцгийг яг хэвээр нь үлдээнэ. Тавилга нэмэхгүй.
// GEMINI_API_KEY шаардлагатай. ZUUCH_GEMINI_MOCK=1 — локал туршилт (API дуудахгүй, зургийг хуулна).
'use strict';
const fsp = require('fs').promises;
const { spawn } = require('child_process');

const MODEL = process.env.ZUUCH_GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const key = () => process.env.GEMINI_API_KEY || '';
const enabled = () => !!key() || process.env.ZUUCH_GEMINI_MOCK === '1';

const PROMPT = `Edit this real estate listing photo. Remove all clutter and temporary objects: children's toys, construction debris, dust, scraps, packaging, tools, ladders, buckets, paint cans, cables lying on the floor, boxes, bags, trash, and any people or workers.
Fill every removed area realistically so it matches the surrounding floor, walls and lighting.
Keep the architecture exactly the same: walls, windows, doors, floor material and pattern, ceiling, light fixtures, built-in cabinets, radiators, switches and outlets.
Keep the exact camera position, perspective, framing, field of view and image proportions.
Do not add furniture, plants, decorations or any new objects. Do not change colors, materials, the time of day or the room layout.
The result must be a photorealistic photograph with no text, logos or watermarks.`;

const RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
function aspect(w, h) { const r = w / h; let best = '4:3', d = 9; for (const x of RATIOS) { const [a, b] = x.split(':').map(Number); const e = Math.abs(Math.log(r / (a / b))); if (e < d) { d = e; best = x; } } return best; }

function ff(args) { return new Promise((res, rej) => { const p = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args]); let err = ''; p.stderr.on('data', (d) => { err += d; }); p.on('error', rej); p.on('close', (c) => (c === 0 ? res() : rej(new Error(err.slice(-300) || 'ffmpeg ' + c)))); }); }

async function call(body, fetchImpl) {
  const r = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key() }, body: JSON.stringify(body), signal: AbortSignal.timeout(150000),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}

// src: JPEG/PNG/WEBP → out (JPEG). w, h: эх зургийн хэмжээ (гаралтыг эх өргөнд нь буцааж масштаблана)
async function run(src, out, { w, h, fetchImpl = fetch } = {}) {
  if (process.env.ZUUCH_GEMINI_MOCK === '1') { await ff(['-i', src, '-vf', 'eq=brightness=0.03', '-q:v', '2', out]); return { note: 'туршилтын горим (Gemini дуудаагүй)', model: 'mock' }; }
  if (!key()) throw Object.assign(new Error('Виртуал цэгцлэлт идэвхжээгүй: GEMINI_API_KEY тохируулаагүй'), { status: 503 });
  // Gemini-д ≤2048 JPEG илгээнэ (хурд, хэмжээ)
  const tmpIn = out + '.in.jpg'; await ff(['-i', src, '-vf', "scale='min(2048,iw)':-2", '-q:v', '3', tmpIn]);
  const data = (await fsp.readFile(tmpIn)).toString('base64'); await fsp.unlink(tmpIn).catch(() => {});
  const parts = [{ text: PROMPT }, { inline_data: { mime_type: 'image/jpeg', data } }];
  let body = { contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect(w || 4, h || 3) } } };
  let r = await call(body, fetchImpl);
  if (!r.ok && r.status === 400 && /imageConfig|aspect/i.test(JSON.stringify(r.j))) { delete body.generationConfig.imageConfig; r = await call(body, fetchImpl); } // хуучин загварт aspectRatio дэмжигдэхгүй
  if (!r.ok) throw new Error(`Gemini алдаа ${r.status}: ${((r.j.error && r.j.error.message) || '').slice(0, 200)}`);
  const cand = (r.j.candidates || [])[0] || {};
  const img = ((cand.content && cand.content.parts) || []).find((p) => p.inlineData || p.inline_data);
  if (!img) { const txt = ((cand.content && cand.content.parts) || []).map((p) => p.text || '').join(' ').slice(0, 160); throw new Error(`Gemini зураг буцаасангүй (${cand.finishReason || (r.j.promptFeedback && r.j.promptFeedback.blockReason) || 'шалтгаангүй'})${txt ? ': ' + txt : ''}`); }
  const d = img.inlineData || img.inline_data; const raw = out + '.raw'; await fsp.writeFile(raw, Buffer.from(d.data, 'base64'));
  // Эх зургийн өргөнд (≤2560) буцааж масштаблаад JPEG болгоно
  const W = Math.min(2560, w || 2048); await ff(['-i', raw, '-vf', `scale=${Math.round(W / 2) * 2}:-2:flags=lanczos`, '-q:v', '2', out]); await fsp.unlink(raw).catch(() => {});
  return { note: 'хог, тоглоом, барилгын үлдэгдэл, хүн арилгав (AI)', model: MODEL };
}

module.exports = { run, enabled, aspect, MODEL, PROMPT };
