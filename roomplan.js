// «Зууч» — Apple RoomPlan (iPhone/iPad Pro LiDAR) сканы JSON → POV Tour план {ceiling, entry, rooms:[{type,x,y,w,h,door,win}]}
// Оролт: CapturedRoom эсвэл CapturedStructure (олон өрөө) JSON. Уян уншина: transform = 16 тоо (баганаар) эсвэл 4×4 багана; category = "door" эсвэл {"door":{…}}.
// Алхам: ханын зонхилох чиглэлээр тэнхлэгт эргүүлэх → шалны олон өнцөгт (эсвэл ханы хүрээ) → тэгш өнцөгт өрөө → ханын зузаанаар үүссэн завсрыг хаах →
// хаалга/нээлхий (2 өрөөний хооронд, эсвэл орц), цонх (тавцан/дээд өндөр) → өрөөний төрөл (Apple шошго эсвэл доторх эд зүйлс).
// ARKit: x баруун, y дээш, z камер руу (метр). План: x баруун, y «урагш» (= z).
const num = (v) => (typeof v === 'number' ? v : Number(v));
function mat(t) {
  if (!t) return null; let a = null;
  if (Array.isArray(t) && t.length === 16 && t.every((v) => typeof v === 'number')) a = t;
  else if (Array.isArray(t) && t.length === 4 && t.every((c) => Array.isArray(c) && c.length === 4)) a = t.flat();
  else if (t.columns) a = [].concat(...t.columns);
  return a && a.length === 16 ? a.map(num) : null; // баганаар: [c0x,c0y,c0z,c0w, c1…, c2…, c3x(tx),c3y,c3z,1]
}
const dims = (d) => (Array.isArray(d) ? d.map(num) : d && typeof d === 'object' ? [num(d.x), num(d.y), num(d.z)] : [0, 0, 0]);
const catOf = (c) => (typeof c === 'string' ? c : c && typeof c === 'object' ? Object.keys(c)[0] : '') || '';
const apply = (M, p) => [M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12], M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13], M[2] * p[0] + M[6] * p[1] + M[10] * p[2] + M[14]];

function collect(j) {
  const out = { walls: [], doors: [], windows: [], openings: [], floors: [], sections: [], objects: [], rooms: [] };
  const take = (o, roomIdx) => {
    for (const k of ['walls', 'doors', 'windows', 'openings', 'floors', 'objects']) for (const s of o[k] || []) out[k].push({ ...s, _room: roomIdx });
    for (const s of o.sections || []) out.sections.push(s);
  };
  if (Array.isArray(j.rooms) && j.rooms.length) j.rooms.forEach((r, i) => { take(r, i); out.rooms.push(i); });
  take(j, j.rooms && j.rooms.length ? -1 : 0); if (!out.rooms.length) out.rooms.push(0);
  return out;
}

function convert(json) {
  const j = typeof json === 'string' ? JSON.parse(json) : json; const C = collect(j); const warn = [];
  const walls = C.walls.map((w) => { const M = mat(w.transform); if (!M) return null; const d = dims(w.dimensions); const u = [M[0], M[2]]; const ul = Math.hypot(u[0], u[1]) || 1; return { p: [M[12], M[14]], y: M[13], u: [u[0] / ul, u[1] / ul], L: d[0], H: d[1], room: w._room }; }).filter((w) => w && w.L > 0.2);
  if (!walls.length) throw new Error('RoomPlan JSON-д хана олдсонгүй (CapturedRoom/CapturedStructure биш?)');
  // 1) Зонхилох чиглэл (90°-ын үетэй): 4θ-ийн жинлэсэн дундаж
  let s4 = 0, c4 = 0; for (const w of walls) { const a = Math.atan2(w.u[1], w.u[0]); s4 += w.L * Math.sin(4 * a); c4 += w.L * Math.cos(4 * a); }
  const th = Math.atan2(s4, c4) / 4; const cs = Math.cos(-th), sn = Math.sin(-th);
  const R = (x, z) => [x * cs - z * sn, x * sn + z * cs];
  const floorY = Math.min(...C.floors.map((f) => { const M = mat(f.transform); return M ? M[13] : Infinity; }), ...walls.map((w) => w.y - w.H / 2));
  // 2) Өрөөнүүд: шалны олон өнцөгт → хүрээ; шал алга бол өрөө тус бүрийн ханын хүрээ
  let rects = [];
  for (const f of C.floors) {
    const M = mat(f.transform); const pc = (f.polygonCorners || []).map((p) => (Array.isArray(p) ? p.map(num) : [num(p.x), num(p.y), num(p.z)]));
    let pts = [];
    if (M && pc.length >= 3) pts = pc.map((p) => { const q = apply(M, p); return R(q[0], q[2]); });
    else if (M) { const d = dims(f.dimensions); const cx = M[12], cz = M[14]; const ax = [M[0], M[2]], az = [M[8], M[10]]; for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const x = cx + (ax[0] * a * d[0] + az[0] * b * d[2]) / 2, z = cz + (ax[1] * a * d[0] + az[1] * b * d[2]) / 2; pts.push(R(x, z)); } }
    if (pts.length >= 3) rects.push({ x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), z0: Math.min(...pts.map((p) => p[1])), z1: Math.max(...pts.map((p) => p[1])), room: f._room });
  }
  if (!rects.length) {
    for (const ri of C.rooms) { const ws = walls.filter((w) => w.room === ri || C.rooms.length === 1); if (!ws.length) continue; const pts = ws.flatMap((w) => [R(w.p[0] - w.u[0] * w.L / 2, w.p[1] - w.u[1] * w.L / 2), R(w.p[0] + w.u[0] * w.L / 2, w.p[1] + w.u[1] * w.L / 2)]); rects.push({ x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), z0: Math.min(...pts.map((p) => p[1])), z1: Math.max(...pts.map((p) => p[1])), room: ri }); }
    if (C.rooms.length > 1 || rects.length) warn.push('Шалны олон өнцөгт алга — өрөөг ханын хүрээгээр тооцов');
  }
  rects = rects.filter((r) => (r.x1 - r.x0) > 0.8 && (r.z1 - r.z0) > 0.8);
  if (!rects.length) throw new Error('Өрөөний хэмжээ тодорхойлогдсонгүй');
  // 3) Хөрш өрөөний завсрыг (ханын зузаан ≤ 0.45 м) хаах — ирмэгийг дунд нь нийлүүлнэ
  for (let it = 0; it < 3; it++) for (let a = 0; a < rects.length; a++) for (let b = 0; b < rects.length; b++) {
    if (a === b) continue; const A = rects[a], Bq = rects[b];
    const ovZ = Math.min(A.z1, Bq.z1) - Math.max(A.z0, Bq.z0), ovX = Math.min(A.x1, Bq.x1) - Math.max(A.x0, Bq.x0);
    const gx = Bq.x0 - A.x1; if (gx > -0.05 && gx < 0.45 && ovZ > 0.6) { const m = (A.x1 + Bq.x0) / 2; A.x1 = m; Bq.x0 = m; }
    const gz = Bq.z0 - A.z1; if (gz > -0.05 && gz < 0.45 && ovX > 0.6) { const m = (A.z1 + Bq.z0) / 2; A.z1 = m; Bq.z0 = m; }
  }
  // 3б) Шалны олон өнцөгт = ханын ДОТОР тал; план = ханын тэнхлэг → хөршгүй гадна ирмэгийг ханын зузааны хагасаар (RoomPlan ≈ 16 см) тэлнэ
  if (C.floors.length) { const HW = 0.08; const touch = (A, side) => rects.some((Bq) => Bq !== A && (side === 'x0' ? Math.abs(Bq.x1 - A.x0) < 0.02 && Math.min(A.z1, Bq.z1) - Math.max(A.z0, Bq.z0) > 0.3 : side === 'x1' ? Math.abs(Bq.x0 - A.x1) < 0.02 && Math.min(A.z1, Bq.z1) - Math.max(A.z0, Bq.z0) > 0.3 : side === 'z0' ? Math.abs(Bq.z1 - A.z0) < 0.02 && Math.min(A.x1, Bq.x1) - Math.max(A.x0, Bq.x0) > 0.3 : Math.abs(Bq.z0 - A.z1) < 0.02 && Math.min(A.x1, Bq.x1) - Math.max(A.x0, Bq.x0) > 0.3));
    const ext = rects.map((A) => ({ x0: !touch(A, 'x0'), x1: !touch(A, 'x1'), z0: !touch(A, 'z0'), z1: !touch(A, 'z1') }));
    rects.forEach((A, i) => { if (ext[i].x0) A.x0 -= HW; if (ext[i].x1) A.x1 += HW; if (ext[i].z0) A.z0 -= HW; if (ext[i].z1) A.z1 += HW; }); }
  // 4) Тэг цэг рүү шилжүүлж, 0.05 м-ээр бөөрөнхийлнө
  const ox = Math.min(...rects.map((r) => r.x0)), oz = Math.min(...rects.map((r) => r.z0)); const r5 = (v) => Math.round(v * 20) / 20;
  const rooms = rects.map((r, i) => ({ id: 'r' + (i + 1), x: r5(r.x0 - ox), y: r5(r.z0 - oz), w: r5(r.x1 - r.x0), h: r5(r.z1 - r.z0), room: r.room, door: [], win: [], _objs: [] }));
  const P = (x, z) => { const q = R(x, z); return [q[0] - ox, q[1] - oz]; };
  // 5) Төрөл: Apple шошго (iOS 17 sections) → эсвэл доторх эд зүйлс
  const LBL = { livingRoom: 'living', bedroom: 'bedroom', bathroom: 'bath', kitchen: 'kitchen', diningRoom: 'living' };
  const inside = (r, x, y) => x >= r.x - 0.1 && x <= r.x + r.w + 0.1 && y >= r.y - 0.1 && y <= r.y + r.h + 0.1;
  for (const s of C.sections) { const c = Array.isArray(s.center) ? s.center.map(num) : s.center ? [num(s.center.x), num(s.center.y), num(s.center.z)] : null; if (!c) continue; const q = P(c[0], c[2]); const r = rooms.find((rr) => inside(rr, q[0], q[1])); const lb = catOf(s.label); if (r && LBL[lb]) r.type = LBL[lb]; }
  for (const o of C.objects) { const M = mat(o.transform); if (!M) continue; const q = P(M[12], M[14]); const r = rooms.find((rr) => inside(rr, q[0], q[1])); if (r) r._objs.push(catOf(o.category)); }
  for (const r of rooms) {
    if (r.type) continue; const o = new Set(r._objs);
    r.type = o.has('bed') ? 'bedroom' : (o.has('toilet') || o.has('bathtub')) ? 'bath' : (o.has('stove') || o.has('oven') || o.has('refrigerator') || o.has('dishwasher')) ? (o.has('sofa') ? 'living' : 'kitchen') : (o.has('sofa') || o.has('television')) ? 'living' : null;
  }
  const area = (r) => r.w * r.h;
  // 6) Хаалга/нээлхий ба цонх — ирмэгт оноох
  const edgeHits = (x, y, tol = 0.45) => { const hits = []; for (const r of rooms) {
    const ed = [['N', r.y, 'x', r.x, r.x + r.w], ['S', r.y + r.h, 'x', r.x, r.x + r.w], ['W', r.x, 'y', r.y, r.y + r.h], ['E', r.x + r.w, 'y', r.y, r.y + r.h]];
    for (const [side, c, ax, a0, a1] of ed) { const along = ax === 'x' ? x : y, perp = ax === 'x' ? y : x; if (Math.abs(perp - c) <= tol && along >= a0 - 0.1 && along <= a1 + 0.1) hits.push({ r, side, along, a0, d: Math.abs(perp - c) }); }
  } return hits.sort((a, b) => a.d - b.d); };
  let entryDone = false; const NM = { living: 'Зочны өрөө', bedroom: 'Унтлагын өрөө', bath: 'Угаалгын өрөө', kitchen: 'Гал тогоо', hall: 'Коридор', balcony: 'Тагт', other: 'Өрөө' };
  const doors = [...C.doors.map((d) => ({ ...d, _k: 'door' })), ...C.openings.map((d) => ({ ...d, _k: 'opening' }))];
  for (const d of doors) {
    const M = mat(d.transform); if (!M) continue; const w = Math.max(0.6, Math.min(2.5, dims(d.dimensions)[0])); const q = P(M[12], M[14]);
    const hits = edgeHits(q[0], q[1]); const pair = []; for (const h of hits) if (!pair.some((p) => p.r === h.r)) pair.push(h);
    if (pair.length >= 2) { const h = pair[0]; h.r.door.push({ side: h.side, off: +(h.along - h.a0 - w / 2).toFixed(2), w: +w.toFixed(2) }); }
    else if (pair.length === 1 && !entryDone && d._k === 'door') { const h = pair[0]; h.r.door.push({ side: h.side, off: +(h.along - h.a0 - w / 2).toFixed(2), w: +w.toFixed(2), to: 'out' }); entryDone = true; h.r._entry = true; }
  }
  for (const wdw of C.windows) {
    const M = mat(wdw.transform); if (!M) continue; const dd = dims(wdw.dimensions); const q = P(M[12], M[14]); const h = edgeHits(q[0], q[1], 0.5)[0]; if (!h) continue;
    const sill = Math.max(0, M[13] - dd[1] / 2 - floorY), top = Math.min(3.5, sill + dd[1]);
    h.r.win.push({ side: h.side, off: +(h.along - h.a0 - dd[0] / 2).toFixed(2), w: +Math.max(0.3, dd[0]).toFixed(2), sill: +sill.toFixed(2), top: +top.toFixed(2) });
  }
  // Шошгогүй өрөөний төрөл (хаалга/цонхны мэдээлэлтэй): орцтой → коридор; нарийн (≤ 1.7 м), гадна талдаа цонхтой, зөвхөн 1 хаалгатай → тагт;
  // сунасан жижиг → коридор; маш жижиг → угаалгын; бусад → зочны (нэг л) эсвэл «өрөө»
  const minS = (r) => Math.min(r.w, r.h), doorCount = (r) => r.door.length + rooms.filter((o) => o !== r && o.door.some((d) => { const hit = edgeHits(...doorPt(o, d))[0]; return hit && hit.r === r; })).length;
  function doorPt(o, d) { const c = d.side === 'N' ? [o.x + d.off + d.w / 2, o.y] : d.side === 'S' ? [o.x + d.off + d.w / 2, o.y + o.h] : d.side === 'W' ? [o.x, o.y + d.off + d.w / 2] : [o.x + o.w, o.y + d.off + d.w / 2]; const n = { N: [0, -0.2], S: [0, 0.2], W: [-0.2, 0], E: [0.2, 0] }[d.side]; return [c[0] + n[0], c[1] + n[1]]; }
  for (const r of rooms) {
    if (r.type) continue;
    const winLen = r.win.reduce((s2, w) => s2 + w.w, 0), longest = Math.max(r.w, r.h);
    if (r._entry) r.type = 'hall';
    else if (minS(r) <= 1.7 && winLen >= longest * 0.45 && doorCount(r) <= 1) r.type = 'balcony';
    else if (longest / minS(r) > 2.2 && area(r) < 9) r.type = 'hall';
    else if (area(r) < 3.5) r.type = 'bath';
  }
  const hasLiving = rooms.some((r) => r.type === 'living');
  const rest = rooms.filter((r) => !r.type).sort((a, b) => area(b) - area(a));
  rest.forEach((r, i) => { r.type = !hasLiving && i === 0 ? 'living' : 'other'; });
  // Нэр, дугаар, орц
  const cnt = {}; for (const r of rooms) { cnt[r.type] = (cnt[r.type] || 0) + 1; }
  const seen = {}; for (const r of rooms) { seen[r.type] = (seen[r.type] || 0) + 1; r.name = NM[r.type] + (cnt[r.type] > 1 ? ' ' + seen[r.type] : ''); if (r.type === 'kitchen') { /* тусдаа гал тогоо */ } }
  const ceiling = +(walls.reduce((s, w) => s + w.H * w.L, 0) / walls.reduce((s, w) => s + w.L, 0)).toFixed(2);
  const entry = (rooms.find((r) => r._entry) || rooms.find((r) => r.type === 'hall') || rooms[0]).id;
  if (!entryDone) warn.push('Орцны хаалга тодорхойлогдсонгүй — орцыг гараар заана уу');
  const out = { ceiling: Math.max(2.3, Math.min(4, ceiling || 2.7)), entry, rooms: rooms.map(({ room, _objs, _entry, ...r }) => r) };
  return { plan: out, summary: { rooms: out.rooms.length, doors: out.rooms.reduce((s, r) => s + r.door.length, 0), windows: out.rooms.reduce((s, r) => s + r.win.length, 0), rotationDeg: +((th * 180) / Math.PI).toFixed(1), walls: walls.length }, warnings: warn };
}

module.exports = { convert };
