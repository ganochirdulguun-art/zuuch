// «Зууч» — Virtual Tour (POV) (Ш3д): орон сууцны план → 3D аялалд бэлэн бүтэц
// План = өрөөнүүд (метр, дээрээс харсан: x баруун тийш, y урагш/өмнө зүг), хаалга/цонх = дэлхийн координатаар.
// Ш3д-2: өрөө бүрд ГАР хэмжээс (win/door/beams — аль хана, хананы зүүн/дээд захаас хэдэн м) + AI зөвлөмж (style.rooms) → автоматыг дарна.
const crypto = require('node:crypto');

const TYPES = {
  living: 'Зочны', kitchen: 'Гал тогоо', bedroom: 'Унтлагын', bath: 'Угаалгын', hall: 'Коридор', balcony: 'Тагт', office: 'Ажлын', other: 'Бусад',
};
const TYPE_MN = { living: 'зочны', kitchen: 'гал тогоо', bedroom: 'унтлагын', bath: 'угаалгын', hall: 'коридор', balcony: 'тагт', office: 'ажлын', other: 'бусад' };
const SIDES = ['N', 'S', 'W', 'E'];
const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };

// ---- Автомат план: объектын баримтаас (өрөө, талбай) УБ-ын орон сууцны ердийн зохион байгуулалт ----
function autoPlan(prop) {
  const n = Math.max(1, Math.min(5, Number(prop.rooms) || 2));
  const A = Math.max(24, Math.min(300, Number(prop.area) || 24 + n * 18));
  const bedrooms = Math.max(0, n - 1);
  const bedroomA = bedrooms ? Math.min(16, Math.max(9, (A * 0.4) / bedrooms)) : 0;
  const kitchenA = Math.max(6, Math.min(14, A * 0.13)), bathA = Math.max(3.5, Math.min(7, A * 0.07));
  const livingA = Math.max(12, A - bedroomA * bedrooms - kitchenA - bathA - Math.max(3, A * 0.08));
  const hallA = Math.max(3, A * 0.08);
  const topArea = livingA + bedroomA * bedrooms + bathA;
  const W = round(Math.sqrt((topArea + kitchenA + hallA) * 1.5), 1);
  const hT = round(Math.max(2.8, topArea / W), 1);
  const hB = round(Math.max(2.2, Math.min(3.2, (kitchenA + hallA) / W)), 1);
  const rooms = [];
  let x = 0;
  for (let i = 0; i < bedrooms; i++) { const w = round(bedroomA / hT, 1); rooms.push({ id: 'bed' + (i + 1), type: 'bedroom', name: bedrooms > 1 ? `Унтлагын ${i + 1}` : 'Унтлагын', x, y: 0, w, h: hT }); x = round(x + w, 1); }
  const wBath = round(Math.min(2.4, Math.max(1.6, Math.sqrt(bathA * 0.7))), 1);
  const hBath = round(Math.min(hT, Math.max(2.0, Math.min(3.5, bathA / wBath))), 1);
  const leftover = round(hT - hBath, 1);
  if (leftover >= 1.5) { rooms.push({ id: 'closet', type: 'other', name: 'Хувцасны өрөө', x, y: 0, w: wBath, h: leftover }); rooms.push({ id: 'bath', type: 'bath', name: 'Угаалгын', x, y: leftover, w: wBath, h: hBath }); }
  else rooms.push({ id: 'bath', type: 'bath', name: 'Угаалгын', x, y: 0, w: wBath, h: hT });
  x = round(x + wBath, 1);
  const livingX = x;
  const living = { id: 'living', type: 'living', name: 'Зочны', x, y: 0, w: round(Math.max(3.6, W - x), 1), h: hT };
  rooms.push(living);
  const Wf = round(livingX + living.w, 1);
  const hallEnd = round(Math.min(Wf - 2.4, Math.max(1.5, livingX + 1.2)), 1);
  rooms.push({ id: 'hall', type: 'hall', name: 'Коридор', x: 0, y: hT, w: hallEnd, h: hB });
  rooms.push({ id: 'kitchen', type: 'kitchen', name: 'Гал тогоо', x: hallEnd, y: hT, w: round(Wf - hallEnd, 1), h: hB });
  return finalize({ unit: 'm', ceiling: 2.7, entry: 'hall', rooms });
}

// ---- Геометрийн туслахууд ----
function overlap(a1, a2, b1, b2) { const lo = Math.max(a1, b1), hi = Math.min(a2, b2); return hi - lo > 0.05 ? [lo, hi] : null; }
function edges(r) {
  return { N: { c: r.y, a: r.x, b: r.x + r.w }, S: { c: r.y + r.h, a: r.x, b: r.x + r.w }, W: { c: r.x, a: r.y, b: r.y + r.h }, E: { c: r.x + r.w, a: r.y, b: r.y + r.h } };
}
// Өрөөний хананы (side) дагуух off..off+w хэсгийг дэлхийн сегмент болгоно (off = хананы зүүн/дээд захаас)
function segOnSide(r, side, off, w) {
  const e = edges(r)[side]; const len = e.b - e.a;
  const ww = Math.max(0.3, Math.min(w, len - 0.1)); const o = Math.max(0.05, Math.min(off, len - ww - 0.05));
  const lo = round(e.a + o, 2), hi = round(e.a + o + ww, 2);
  return side === 'N' || side === 'S' ? { x1: lo, y1: e.c, x2: hi, y2: e.c, side } : { x1: e.c, y1: lo, x2: e.c, y2: hi, side };
}
// Сегментийн дунд цэгийн эсрэг талд аль өрөө байна (хаалганы «to» автомат)
function roomAcross(rooms, r, side, seg) {
  const mx = (seg.x1 + seg.x2) / 2, my = (seg.y1 + seg.y2) / 2; const d = 0.1;
  const px = side === 'W' ? mx - d : side === 'E' ? mx + d : mx, py = side === 'N' ? my - d : side === 'S' ? my + d : my;
  return rooms.find((o) => o.id !== r.id && px >= o.x && px <= o.x + o.w && py >= o.y && py <= o.y + o.h) || null;
}
function sanitizeRoom(r, i) {
  const clean = (arr, fn) => (Array.isArray(arr) ? arr.slice(0, 8).map(fn).filter(Boolean) : []);
  return {
    id: String(r.id || 'r' + (i + 1)), type: TYPES[r.type] ? r.type : 'other', name: String(r.name || TYPES[r.type] || 'Өрөө').slice(0, 40),
    x: round(Number(r.x) || 0), y: round(Number(r.y) || 0), w: round(Math.max(1, Math.min(20, Number(r.w) || 3))), h: round(Math.max(1, Math.min(20, Number(r.h) || 3))),
    // Ш3д-2 гар хэмжээс (хоосон = автомат)
    win: clean(r.win, (w) => SIDES.includes(w.side) ? { side: w.side, off: num(w.off, 0, 20, 0.5), w: num(w.w, 0.3, 6, 1.4), sill: num(w.sill, 0, 2, 0.85), top: num(w.top, 0.5, 4, 2.2) } : null),
    door: clean(r.door, (d) => SIDES.includes(d.side) ? { side: d.side, off: num(d.off, 0, 20, 0.5), w: num(d.w, 0.6, 2.5, 0.9), to: d.to === 'out' ? 'out' : 'auto' } : null),
    beams: clean(r.beams, (b) => ({ axis: b.axis === 'y' ? 'y' : 'x', off: num(b.off, 0, 20, 1), w: num(b.w, 0.1, 1.5, 0.3), h: num(b.h, 0.1, 1, 0.25) })),
    wallColor: /^#[0-9a-f]{6}$/i.test(String(r.wallColor || '')) ? r.wallColor : null,
    floor: ['parquet', 'laminate', 'tile', 'carpet'].includes(r.floor) ? r.floor : null,
    ceiling: r.ceiling ? num(r.ceiling, 2.2, 4.5, null) : null,
    kitchen: r.type === 'living' && SIDES.includes(r.kitchen) ? r.kitchen : null, // зочны өрөөн доторх гал тогоо (аль хананд)
  };
}

// ---- Хаалга/цонхыг тооцоолж (гар оролт давуу), аялалын дарааллыг гаргана ----
function finalize(plan) {
  const rooms = (plan.rooms || []).map(sanitizeRoom).slice(0, 14);
  const byId = Object.fromEntries(rooms.map((r) => [r.id, r]));
  const style = plan.style && typeof plan.style === 'object' ? plan.style : null;
  const hintFor = (r) => (style && Array.isArray(style.rooms) ? style.rooms.find((h) => String(h.room || '').toLowerCase().includes(TYPE_MN[r.type]) || h.room === r.id) : null);
  // Хөрш: хэвтээ (N/S) эсвэл босоо (W/E) хана хуваалцсан, ≥1 м давхцалтай
  const adj = [];
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
    const a = rooms[i], b = rooms[j], ea = edges(a), eb = edges(b);
    let o;
    if (Math.abs(ea.S.c - eb.N.c) < 0.05 && (o = overlap(ea.S.a, ea.S.b, eb.N.a, eb.N.b)) && o[1] - o[0] >= 1) adj.push({ a: a.id, b: b.id, axis: 'x', c: ea.S.c, lo: o[0], hi: o[1] });
    else if (Math.abs(eb.S.c - ea.N.c) < 0.05 && (o = overlap(eb.S.a, eb.S.b, ea.N.a, ea.N.b)) && o[1] - o[0] >= 1) adj.push({ a: a.id, b: b.id, axis: 'x', c: eb.S.c, lo: o[0], hi: o[1] });
    else if (Math.abs(ea.E.c - eb.W.c) < 0.05 && (o = overlap(ea.E.a, ea.E.b, eb.W.a, eb.W.b)) && o[1] - o[0] >= 1) adj.push({ a: a.id, b: b.id, axis: 'y', c: ea.E.c, lo: o[0], hi: o[1] });
    else if (Math.abs(eb.E.c - ea.W.c) < 0.05 && (o = overlap(eb.E.a, eb.E.b, ea.W.a, ea.W.b)) && o[1] - o[0] >= 1) adj.push({ a: a.id, b: b.id, axis: 'y', c: eb.E.c, lo: o[0], hi: o[1] });
  }
  const entry = byId[plan.entry] ? plan.entry : (rooms.find((r) => r.type === 'hall') || rooms[0] || {}).id;
  // 1) ГАР хаалганууд — өрөөний хананд заасан байрлалд; «to» = эсрэг талын өрөө эсвэл гадна
  const doors = []; const pairKey = (a, b) => [a, b].sort().join('|'); const manualPairs = new Set(); let manualEntry = false;
  for (const r of rooms) for (const d of r.door) {
    const seg = segOnSide(r, d.side, d.off, d.w);
    const across = d.to === 'out' ? null : roomAcross(rooms, r, d.side, seg);
    const b = across ? across.id : 'out';
    if (b === 'out') manualEntry = true; else manualPairs.add(pairKey(r.id, b));
    doors.push({ a: r.id, b, x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2, manual: true, ...(b === 'out' ? { entry: r.id === entry || !manualEntry } : {}) });
  }
  // 2) Автомат хаалга: орцны өрөөнөөс BFS — гар хаалгатай хос = холбогдсон гэж үзнэ, шинээр үүсгэхгүй
  const mkDoor = (e, a, b) => {
    const mid = (e.lo + e.hi) / 2, w = Math.min(0.9, e.hi - e.lo - 0.2);
    return e.axis === 'x' ? { a, b, x1: round(mid - w / 2, 2), y1: e.c, x2: round(mid + w / 2, 2), y2: e.c } : { a, b, x1: e.c, y1: round(mid - w / 2, 2), x2: e.c, y2: round(mid + w / 2, 2) };
  };
  const nbrsOf = (id) => {
    const out = [];
    for (const e of adj) if (e.a === id || e.b === id) out.push({ e, other: e.a === id ? e.b : e.a, manual: manualPairs.has(pairKey(e.a, e.b)) });
    for (const d of doors) if (d.manual && d.b !== 'out' && (d.a === id || d.b === id) && !out.some((o) => o.other === (d.a === id ? d.b : d.a))) out.push({ e: null, other: d.a === id ? d.b : d.a, manual: true });
    return out;
  };
  const balcManual = new Set(); for (const k of manualPairs) for (const id of k.split('|')) if (byId[id] && byId[id].type === 'balcony') balcManual.add(id);
  // Коридор өрөөнүүдийг ТЭРГҮҮНД боловсруулна → өрөөнүүд коридороос орно (унтлагын хооронд хаалга үүсэхгүй)
  const visited = new Set(entry ? [entry] : []); const hallQ = [], otherQ = []; const order = entry ? [entry] : [];
  const enqueue = (id) => ((byId[id] && byId[id].type === 'hall') ? hallQ : otherQ).push(id); if (entry) enqueue(entry);
  const queue = { get length() { return hallQ.length + otherQ.length; }, shift: () => (hallQ.length ? hallQ.shift() : otherQ.shift()), push: enqueue };
  while (queue.length) {
    const cur = queue.shift(); const isHall = byId[cur] && byId[cur].type === 'hall';
    for (const { e, other, manual } of nbrsOf(cur)) {
      if (visited.has(other)) continue;
      if (!manual && !isHall && byId[other].type === 'bath') continue;
      if (!manual && byId[other].type === 'balcony' && balcManual.has(other)) continue; // гар хаалгатай тагт — зөвхөн тэр хаалгаар (унтлагын өрөөний тагт тал нь цонх байж болно)
      visited.add(other); queue.push(other); order.push(other);
      if (!manual && e) doors.push(mkDoor(e, cur, other));
    }
  }
  for (const r of rooms) if (!visited.has(r.id)) {
    const cand = adj.filter((e) => e.a === r.id || e.b === r.id)[0];
    if (cand) { const other = cand.a === r.id ? cand.b : cand.a; if (!manualPairs.has(pairKey(r.id, other))) doors.push(mkDoor(cand, other, r.id)); }
    visited.add(r.id); order.push(r.id);
  }
  // 3) Орцны хаалга (гар оруулаагүй бол): коридорын гадна хананд, өмнө зүг давуу
  if (!manualEntry && entry && byId[entry]) {
    const h = byId[entry];
    const sharedS = adj.some((e) => e.axis === 'x' && Math.abs(e.c - (h.y + h.h)) < 0.05 && (e.a === entry || e.b === entry));
    const side = sharedS ? (adj.some((e) => e.axis === 'y' && Math.abs(e.c - h.x) < 0.05 && (e.a === entry || e.b === entry)) ? 'E' : 'W') : 'S';
    const w = 0.95;
    if (side === 'S') doors.push({ a: entry, b: 'out', x1: round(h.x + h.w / 2 - w / 2, 2), y1: round(h.y + h.h, 2), x2: round(h.x + h.w / 2 + w / 2, 2), y2: round(h.y + h.h, 2), entry: true });
    else doors.push({ a: entry, b: 'out', x1: side === 'W' ? h.x : round(h.x + h.w, 2), y1: round(h.y + h.h / 2 - w / 2, 2), x2: side === 'W' ? h.x : round(h.x + h.w, 2), y2: round(h.y + h.h / 2 + w / 2, 2), entry: true });
  }
  // 4) Цонх: гар оруулсан бол тэр; үгүй бол гадна хананд автомат (AI зөвлөмж: тоо/өргөн/тавцан)
  const windows = [];
  for (const r of rooms) {
    if (r.win.length) { for (const w of r.win) windows.push({ room: r.id, ...segOnSide(r, w.side, w.off, w.w), sill: w.sill, top: w.top, manual: true }); continue; }
    if (r.type === 'bath' || r.type === 'hall') continue;
    const hint = hintFor(r);
    const ex = edges(r);
    const sides = SIDES.filter((s) => {
      const e = ex[s]; const axis = s === 'N' || s === 'S' ? 'x' : 'y';
      return !adj.some((q) => (q.a === r.id || q.b === r.id) && q.axis === axis && Math.abs(q.c - e.c) < 0.05);
    });
    const want = hint && hint.windows != null ? Math.max(0, Math.min(3, Number(hint.windows) || 0)) : (r.type === 'living' ? 2 : 1);
    const wantW = hint && hint.window_w ? num(hint.window_w, 0.5, 4, 1.5) : (r.type === 'living' ? 2.2 : 1.5);
    for (const s of sides.slice(0, want)) {
      const e = ex[s]; const len = e.b - e.a; const w = Math.min(wantW, len - 0.8); if (w < 0.6) continue;
      const mid = (e.a + e.b) / 2;
      const seg = s === 'N' || s === 'S' ? { x1: round(mid - w / 2, 2), y1: e.c, x2: round(mid + w / 2, 2), y2: e.c } : { x1: e.c, y1: round(mid - w / 2, 2), x2: e.c, y2: round(mid + w / 2, 2) };
      windows.push({ room: r.id, ...seg, side: s, ...(style ? { sill: style.window_sill, top: style.window_top } : {}) });
    }
  }
  const minX = Math.min(...rooms.map((r) => r.x), 0), minY = Math.min(...rooms.map((r) => r.y), 0);
  const maxX = Math.max(...rooms.map((r) => r.x + r.w), 1), maxY = Math.max(...rooms.map((r) => r.y + r.h), 1);
  return {
    unit: 'm', ceiling: Math.max(2.3, Math.min(4, Number(plan.ceiling) || (style && style.ceiling_m) || 2.7)), entry, rooms, doors, windows, style,
    tourOrder: order, bounds: { x: minX, y: minY, w: round(maxX - minX), h: round(maxY - minY) },
    totalArea: round(rooms.reduce((s, r) => s + r.w * r.h, 0)),
  };
}

const newToken = () => crypto.randomBytes(9).toString('base64url');
module.exports = { autoPlan, finalize, newToken, TYPES, TYPE_MN };
