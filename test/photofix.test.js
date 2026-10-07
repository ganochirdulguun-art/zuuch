// Зургийн автомат засвар: зохиомол босоо шугамтай зургийг 3° эргүүлж, шар туяа нэмээд — илрүүлж, засаж чадаж буйг шалгана (ffmpeg шаардлагатай)
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const pf = require('../photofix');

const hasFF = (() => { try { return spawnSync('ffmpeg', ['-version']).status === 0; } catch { return false; } })();
test('далийлт, өнгөний туяа илрүүлж засна', { skip: hasFF ? false : 'ffmpeg алга', timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-')); const base = path.join(dir, 'base.jpg'), bad = path.join(dir, 'bad.jpg'), out = path.join(dir, 'out.jpg');
  // цагаан хана дээрх босоо бараан зураасууд (хаалганы хүрээ, тавиур мэт)
  const stripes = Array.from({ length: 9 }, (_, i) => `drawbox=x=${100 + i * 130}:y=60:w=14:h=600:color=0x404040:t=fill`).join(',');
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xe8e4dc:s=1400x720', '-vf', stripes, '-frames:v', '1', base]);
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', base, '-vf', 'rotate=3*PI/180:ow=iw:oh=ih:c=0xe8e4dc,crop=iw*0.86:ih*0.86,colorchannelmixer=rr=1.1:bb=0.85', '-frames:v', '1', bad]);
  const p0 = await pf.plan(base); assert.equal(p0.roll, 0, 'тэгш зураг хөндөгдөхгүй');
  const p1 = await pf.plan(bad); assert.ok(Math.abs(Math.abs(p1.roll) - 3) < 0.8, 'далийлт ' + p1.roll); assert.ok(p1.info.tones.cast > 1.15, 'туяа илэрсэн');
  const r = await pf.fix(bad, out, 'natural'); assert.match(r.note, /далийлт/);
  const p2 = await pf.plan(out); assert.ok(Math.abs(p2.info.verticals.roll) < 0.6, 'засварын дараах үлдэгдэл ' + p2.info.verticals.roll); assert.ok(p2.info.tones.cast < p1.info.tones.cast, 'туяа буурсан');
  fs.rmSync(dir, { recursive: true, force: true });
});
