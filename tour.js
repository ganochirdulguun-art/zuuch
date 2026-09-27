// «Зууч» — Virtual POV Tour (Ш3д MVP): орон сууцны план → 3D аялалд бэлэн бүтэц
// План = өрөөнүүд (метр, дээрээс харсан: x баруун тийш, y урагш/өмнө зүг), хаалга/цонх = дэлхийн координатаар (автомат)
const crypto = require('node:crypto');

const TYPES = {
  living: 'Зочны', kitchen: 'Гал тогоо', bedroom: 'Унтлагын', bath: 'Угаалгын', hall: 'Коридор', balcony: 'Тагт', office: 'Ажлын', other: 'Бусад',
};
const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

// ---- Автомат план: объектын баримтаас (өрөө, талбай) УБ-ын орон сууцны ердийн зохион байгуулалт ----
// Дээд эгнээ: унтлагын өрөөнүүд + зочны (гадна хана хойд зүг = цонх); доод эгнээ: угаалгын, коридор (орц урд талд), гал тогоо
function autoPlan(prop) {
  const n = Math.max(1, Math.min(5, Number(prop.rooms) || 2));
  const A = Math.max(24, Math.min(300, Number(prop.area) || 24 + n * 18));
  const bedrooms = Math.max(0, n - 1);
  const bedroomA = bedrooms ? Math.min(16, Math.max(9, (A * 0.4) / bedrooms)) : 0;
  const kitchenA = Math.max(6, Math.min(14, A * 0.13)), bathA = Math.max(3.5, Math.min(7, A * 0.07));
  const livingA = Math.max(12, A - bedroomA * bedrooms - kitchenA - bathA - Math.max(3, A * 0.08));
  const hallA = Math.max(3, A * 0.08);
  const topArea = livingA + bedroomA * bedrooms + bathA;
  const W = round(Math.sqrt((topArea + kitchenA + hallA) * 1.5), 1); // өргөн/гүн ≈ 1.5
  const hT = round(Math.max(2.8, topArea / W), 1);
  const hB = round(Math.max(2.2, Math.min(3.2, (kitchenA + hallA) / W)), 1);
  const rooms = [];
  // дээд эгнээ (y=0..hT): унтлагын … → угаалгын (цонхгүй, коридороос) → зочны (баруун талд, хойд цонх)
  let x = 0;
  for (let i = 0; i < bedrooms; i++) { const w = round(bedroomA / hT, 1); rooms.push({ id: 'bed' + (i + 1), type: 'bedroom', name: bedrooms > 1 ? `Унтлагын ${i + 1}` : 'Унтлагын', x, y: 0, w, h: hT }); x = round(x + w, 1); }
  const wBath = round(Math.min(2.2, Math.max(1.4, bathA / hT)), 1);
  rooms.push({ id: 'bath', type: 'bath', name: 'Угаалгын', x, y: 0, w: wBath, h: hT }); x = round(x + wBath, 1);
  const livingX = x;
  let living = { id: 'living', type: 'living', name: 'Зочны', x, y: 0, w: round(Math.max(3.6, W - x), 1), h: hT };
  rooms.push(living);
  const Wf = round(livingX + living.w, 1);
  // доод эгнээ (y=hT..hT+hB): коридор (унтлагын, угаалгын, зочны бүгдтэй хиллэнэ; орц урд) → гал тогоо (зочны доор — зочноос хаалга)
  const hallEnd = round(Math.min(Wf - 2.4, Math.max(1.5, livingX + 1.2)), 1);
  rooms.push({ id: 'hall', type: 'hall', name: 'Коридор', x: 0, y: hT, w: hallEnd, h: hB });
  rooms.push({ id: 'kitchen', type: 'kitchen', name: 'Гал тогоо', x: hallEnd, y: hT, w: round(Wf - hallEnd, 1), h: hB });
  return finalize({ unit: 'm', ceiling: 2.7, entry: 'hall', rooms });
}

// ---- Хаалга/цонхыг автоматаар тооцоолж, аялалын дарааллыг гаргана ----
function overlap(a1, a2, b1, b2) { const lo = Math.max(a1, b1), hi = Math.min(a2, b2); return hi - lo > 0.05 ? [lo, hi] : null; }
function edges(r) {
  return { N: { c: r.y, a: r.x, b: r.x + r.w }, S: { c: r.y + r.h, a: r.x, b: r.x + r.w }, W: { c: r.x, a: r.y, b: r.y + r.h }, E: { c: r.x + r.w, a: r.y, b: r.y + r.h } };
}
function finalize(plan) {
  const rooms = (plan.rooms || []).map((r, i) => ({
    id: String(r.id || 'r' + (i + 1)), type: TYPES[r.type] ? r.type : 'other', name: String(r.name || TYPES[r.type] || 'Өрөө').slice(0, 40),
    x: round(Number(r.x) || 0), y: round(Number(r.y) || 0), w: round(Math.max(1, Math.min(20, Number(r.w) || 3))), h: round(Math.max(1, Math.min(20, Number(r.h) || 3))),
  })).slice(0, 14);
  const byId = Object.fromEntries(rooms.map((r) => [r.id, r]));
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
  // Холболт: орцны өрөөнөөс (коридор) BFS — мод хэлбэрээр хаалга тавина (өрөө бүр нэг замаар хүрнэ); коридор бол бүх хөршид хаалга
  const entry = byId[plan.entry] ? plan.entry : (rooms.find((r) => r.type === 'hall') || rooms[0] || {}).id;
  const doors = [];
  const visited = new Set(entry ? [entry] : []);
  const queue = entry ? [entry] : [];
  const order = entry ? [entry] : [];
  const mkDoor = (e, a, b) => {
    const mid = (e.lo + e.hi) / 2, w = Math.min(0.9, e.hi - e.lo - 0.2);
    return e.axis === 'x' ? { a, b, x1: round(mid - w / 2, 2), y1: e.c, x2: round(mid + w / 2, 2), y2: e.c } : { a, b, x1: e.c, y1: round(mid - w / 2, 2), x2: e.c, y2: round(mid + w / 2, 2) };
  };
  while (queue.length) {
    const cur = queue.shift();
    const isHall = byId[cur] && byId[cur].type === 'hall';
    const nbrs = adj.filter((e) => e.a === cur || e.b === cur).map((e) => ({ e, other: e.a === cur ? e.b : e.a }));
    // Коридороос бүх хөршид, бусдаас зөвхөн хараахан хүрээгүй хөршид
    for (const { e, other } of nbrs) {
      if (visited.has(other)) continue;
      if (!isHall && byId[other].type === 'bath') continue; // угаалгын өрөө коридороос л
      visited.add(other); queue.push(other); order.push(other); doors.push(mkDoor(e, cur, other));
    }
  }
  // Тусгаарлагдсан өрөө (хана хуваалцаагүй) — хамгийн ойрын өрөөтэй холбоно (хананд «шууд» хаалга)
  for (const r of rooms) if (!visited.has(r.id)) {
    const cand = adj.filter((e) => e.a === r.id || e.b === r.id)[0];
    if (cand) { const other = cand.a === r.id ? cand.b : cand.a; doors.push(mkDoor(cand, other, r.id)); }
    visited.add(r.id); order.push(r.id);
  }
  // Орцны хаалга: коридорын гадна ханан дээр (өмнө зүг давуу)
  if (entry && byId[entry]) {
    const h = byId[entry];
    const sharedS = adj.some((e) => e.axis === 'x' && Math.abs(e.c - (h.y + h.h)) < 0.05 && (e.a === entry || e.b === entry));
    const side = sharedS ? (adj.some((e) => e.axis === 'y' && Math.abs(e.c - h.x) < 0.05 && (e.a === entry || e.b === entry)) ? 'E' : 'W') : 'S';
    const w = 0.95;
    if (side === 'S') doors.push({ a: entry, b: 'out', x1: round(h.x + h.w / 2 - w / 2, 2), y1: round(h.y + h.h, 2), x2: round(h.x + h.w / 2 + w / 2, 2), y2: round(h.y + h.h, 2), entry: true });
    else doors.push({ a: entry, b: 'out', x1: side === 'W' ? h.x : round(h.x + h.w, 2), y1: round(h.y + h.h / 2 - w / 2, 2), x2: side === 'W' ? h.x : round(h.x + h.w, 2), y2: round(h.y + h.h / 2 + w / 2, 2), entry: true });
  }
  // Цонх: гадна хана (өөр өрөөтэй хуваалцаагүй хэсэг) — угаалгын/коридороос бусад өрөө бүрд 1 (зочны 2)
  const windows = [];
  for (const r of rooms) {
    if (r.type === 'bath' || r.type === 'hall') continue;
    const ex = edges(r);
    const sides = ['N', 'S', 'W', 'E'].filter((s) => {
      const e = ex[s];
      const axis = s === 'N' || s === 'S' ? 'x' : 'y';
      return !adj.some((q) => (q.a === r.id || q.b === r.id) && q.axis === axis && Math.abs(q.c - e.c) < 0.05);
    });
    const want = r.type === 'living' ? 2 : 1;
    for (const s of sides.slice(0, want)) {
      const e = ex[s]; const len = e.b - e.a; const w = Math.min(r.type === 'living' ? 2.2 : 1.5, len - 0.8); if (w < 0.6) continue;
      const mid = (e.a + e.b) / 2;
      if (s === 'N' || s === 'S') windows.push({ room: r.id, x1: round(mid - w / 2, 2), y1: e.c, x2: round(mid + w / 2, 2), y2: e.c, side: s });
      else windows.push({ room: r.id, x1: e.c, y1: round(mid - w / 2, 2), x2: e.c, y2: round(mid + w / 2, 2), side: s });
    }
  }
  const minX = Math.min(...rooms.map((r) => r.x), 0), minY = Math.min(...rooms.map((r) => r.y), 0);
  const maxX = Math.max(...rooms.map((r) => r.x + r.w), 1), maxY = Math.max(...rooms.map((r) => r.y + r.h), 1);
  return {
    unit: 'm', ceiling: Math.max(2.3, Math.min(4, Number(plan.ceiling) || 2.7)), entry, rooms, doors, windows,
    tourOrder: order, bounds: { x: minX, y: minY, w: round(maxX - minX), h: round(maxY - minY) },
    totalArea: round(rooms.reduce((s, r) => s + r.w * r.h, 0)),
  };
}

const newToken = () => crypto.randomBytes(9).toString('base64url');
module.exports = { autoPlan, finalize, newToken, TYPES };
