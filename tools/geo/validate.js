// Хавтан сангаас үүсгэсэн гадаах орчныг жишиг (гараар бэлтгэсэн) өгөгдөлтэй харьцуулна
// Хэрэглээ: node validate.js <lat> <lng> [жишиг ext.json] [гаралт.json]
const fs = require('fs'); const path = require('path');
const ex = require('../../exterior.js'); const gs = require('../../geostore.js');
const [lat, lng] = [Number(process.argv[2]), Number(process.argv[3])]; const REF = process.argv[4]; const OUT = process.argv[5];
(async () => {
  if (!gs.covers(lat, lng)) throw new Error('хавтан сангийн хүрээнээс гадуур');
  const t0 = Date.now(); const opt = gs.options(lat, lng);
  console.log('оролт:', 'барилга', opt.buildings.features.length, 'footprint', opt.footprints.features.length, 'нэгтгэсэн цэг', opt.extraPois.length, ((Date.now() - t0) / 1000).toFixed(1) + 'с');
  const d = await ex.generate(lat, lng, { ...opt, commuteHours: false, log: (m) => console.log('  ·', m) });
  console.log('үүсгэсэн:', ((Date.now() - t0) / 1000).toFixed(1) + 'с', 'барилга', d.buildings.length, 'цэг', d.pois.length);
  const lv = {}; for (const b of d.buildings) { const k = b.lv == null ? '?' : b.lv >= 12 ? '12+' : b.lv >= 5 ? '5-11' : String(b.lv); lv[k] = (lv[k] || 0) + 1; } console.log('давхар:', JSON.stringify(lv));
  const sum = (x) => { const by = {}; for (const p of x.pois) (by[p.cat] = by[p.cat] || []).push(p); return by; };
  const A = sum(d), B = REF ? sum(JSON.parse(fs.readFileSync(REF, 'utf8'))) : {};
  for (const cat of Object.keys(ex.CAT)) {
    const a = (A[cat] || []).sort((p, q) => (p.m || p.d || 0) - (q.m || q.d || 0)), b = (B[cat] || []);
    const nm = (p) => `${p.name || '?'}${p.m ? ' ' + p.m + 'м' : ''}`;
    console.log(cat.padEnd(10), String(a.length).padStart(3), REF ? '| жишиг ' + String(b.length).padStart(3) : '', '::', a.slice(0, 5).map(nm).join(' · '));
    if (REF) { const miss = b.filter((q) => q.name && !a.some((p) => p.name && ex.nameSim(ex.normName(p.name), ex.normName(q.name), false))).map((q) => q.name); if (miss.length) console.log('           ✗ жишигт байгаа, энд алга:', miss.slice(0, 8).join(' · ')); }
  }
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(d));
})().catch((e) => { console.error('ERR', e); process.exit(1); });
