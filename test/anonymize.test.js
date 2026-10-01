// Бүдгэрүүлэлт: дагах (tracking), хайрцгийн интерполяц, 360 захын давталт, мозайк. Загвар шаардахгүй (CI-д ч ажиллана).
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../anonymize');

test('span: мужийг давхцалтайгаар бүрэн хамарна', () => {
  for (const [a, b, T, ov] of [[0, 3840, 1280, 192], [0, 1000, 1280, 192], [100, 2000, 640, 96]]) {
    const s = A._t.span(a, b, T, ov); assert.equal(s[0][0], a); const last = s[s.length - 1]; assert.ok(Math.abs(last[0] + last[1] - b) < 1e-6);
    for (let i = 1; i < s.length; i++) assert.ok(s[i][0] < s[i - 1][0] + s[i - 1][1] - ov + 1e-6, 'давхцал');
  }
});

test('buildTracks: хурдан хөдөлж буй нүүрийг нэг дагалт болгож, завсрыг шугаман нөхнө', () => {
  // 0.25 с тутам 75 px зүүн тийш (нүүр 26 px — IoU 0) → хурдны таамаглалаар холбогдоно
  const frames = []; for (let i = 0; i < 12; i++) frames.push({ t: i * 0.25, dets: [{ c: 'face', s: 0.85, b: [1000 - i * 75, 500, 1026 - i * 75, 532] }, ...(i === 5 ? [{ c: 'face', s: 0.65, b: [200, 900, 210, 912] }] : [])] });
  const tr = A.buildTracks(frames, { W: 1920 });
  assert.equal(tr.filter((t) => t.c === 'face').length, 1, 'ганц, бага итгэлтэй хуурамч нүүр хасагдана, үндсэн нь нэг дагалт');
  assert.equal(tr[0].k.length, 12);
  const [b] = A.boxesAt(tr, 0.375, 1920, 1080); // 0.25 ба 0.5-ын дунд → x1 ≈ 1000 − 112.5, томсгосон
  const cx = (b.b[0] + b.b[2]) / 2; assert.ok(Math.abs(cx - (1013 - 112.5)) < 2, 'интерполяц ' + cx);
  assert.ok(b.b[2] - b.b[0] > 26 * 1.4, 'нүүрний хайрцаг томсгогдсон');
  assert.equal(A.boxesAt(tr, 3.5, 1920, 1080).length, 0, 'дагалт дууссаны дараа (pad-аас хойш) хайрцаггүй');
});

test('buildTracks: 360 захын давталтыг (seam) гатлахад тасрахгүй, boxesAt [0,W) рүү буцаана', () => {
  const W = 3840; const frames = []; for (let i = 0; i < 8; i++) { const x = (200 - i * 60 + W) % W; frames.push({ t: i * 0.25, dets: [{ c: 'plate', s: 0.8, b: [x, 1100, x + 50, 1118] }] }); }
  const tr = A.buildTracks(frames, { W, wrap: true }); assert.equal(tr.length, 1, 'нэг дагалт'); assert.equal(tr[0].k.length, 8);
  for (let t = 0; t <= 1.75; t += 0.125) { const [b] = A.boxesAt(tr, t, W, 1920, true); const c = (b.b[0] + b.b[2]) / 2; assert.ok(c >= 0 && c < W, `t=${t} төв ${c}`); }
});

test('mosaicYUV: хайрцаг доторх блок нэг өнгөтэй, гадна хэвээр; 360 зах хуваагдана', () => {
  const W = 64, H = 32; const buf = Buffer.alloc((W * H * 3) / 2); for (let i = 0; i < W * H; i++) buf[i] = (i * 37) % 251; buf.fill(128, W * H);
  const orig = Buffer.from(buf);
  A.mosaicYUV(buf, W, H, [8, 8, 24, 24], 'plate', false);
  const blk = A._t.blockOf('plate', 16, 16); assert.equal(blk, 4);
  const v = buf[8 * W + 8]; for (let y = 8; y < 12; y++) for (let x = 8; x < 12; x++) assert.equal(buf[y * W + x], v, 'блок нэг өнгө');
  assert.equal(buf[0], orig[0]); assert.equal(buf[30 * W + 40], orig[30 * W + 40], 'гадна хөндөгдөхгүй');
  const b2 = Buffer.from(orig); A.mosaicYUV(b2, W, H, [56, 0, 72, 8], 'plate', true); // x2 > W → [56,64) + [0,8)
  assert.notDeepEqual(b2.subarray(0, 8), orig.subarray(0, 8), 'зүүн зах ч бүдгэрнэ'); assert.equal(b2[2 * W + 30], orig[2 * W + 30]);
});

test('гараар нэмсэн хайрцаг: түлхүүр кадр хооронд шилжинэ, hold хугацаанд үлдэнэ', () => {
  const tr = [{ c: 'manual', hold: 1, k: [{ t: 1, b: [0, 0, 100, 100] }, { t: 3, b: [200, 0, 300, 100] }] }];
  assert.equal(A.boxesAt(tr, 0.9, 1000, 500).length, 0);
  assert.deepEqual(A.boxesAt(tr, 2, 1000, 500)[0].b, [100, 0, 200, 100]);
  assert.equal(A.boxesAt(tr, 3.9, 1000, 500).length, 1); assert.equal(A.boxesAt(tr, 4.1, 1000, 500).length, 0);
});
