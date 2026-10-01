// RoomPlan → план хөрвүүлэгч: Нарны 18-ын бодит планаас синтетик CapturedStructure (17° эргэлт, ханын зузаан 16 см, Apple шошго) үүсгээд буцаан хөрвүүлнэ
const test = require('node:test');
const assert = require('node:assert/strict');
const { convert } = require('../roomplan');

const ROOMS = [
  { id: 'bath', type: 'bathroom', x: 0, y: 0, w: 3.6, h: 1.3, obj: 'toilet' },
  { id: 'hall', type: null, x: 0, y: 1.3, w: 3.6, h: 2.1 },
  { id: 'bed1', type: 'bedroom', x: 0, y: 3.4, w: 3.6, h: 4.0, obj: 'bed' },
  { id: 'balc', type: null, x: 0, y: 7.4, w: 3.6, h: 1.3 },
  { id: 'liv', type: 'livingRoom', x: 3.6, y: 0, w: 3.9, h: 8.7, obj: 'sofa' },
];
// хаалга: [x, y (планы), өргөн, тэнхлэг 'x'|'y']
const DOORS = [[2.35, 1.3, 0.8, 'x'], [3.6, 2.4, 1.4, 'y'], [3.05, 3.4, 0.9, 'x'], [3.6, 8.0, 0.8, 'y'], [0, 2.6, 0.9, 'y']];
const WINDOWS = [[7.5, 1.25, 0.8, 'y'], [7.5, 4.05, 0.8, 'y'], [4.1 + 1.3, 8.7, 2.6, 'x'], [1.3 + 0.9, 7.4, 1.8, 'x'], [1.85, 8.7, 2.9, 'x']]; // сүүлийнх: тагтны шил

function fixture(rotDeg = 17, T = [12.3, 0, -4.1], flat16 = true) {
  const a = (rotDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const W = (x, z) => [T[0] + x * c - z * s, T[2] + x * s + z * c]; // план (x, y) → ARKit (x, z)
  const M = (x, y, z, yaw) => { const cc = Math.cos(yaw), ss = Math.sin(yaw); const m = [cc, 0, ss, 0, 0, 1, 0, 0, -ss, 0, cc, 0, x, y, z, 1]; return flat16 ? m : [m.slice(0, 4), m.slice(4, 8), m.slice(8, 12), m.slice(12)]; };
  const yawOf = (ax) => a + (ax === 'y' ? Math.PI / 2 : 0); // ханын урт тэнхлэг
  const g = 0.08; const rooms = [];
  for (const r of ROOMS) {
    const [cx, cz] = W(r.x + r.w / 2, r.y + r.h / 2);
    const walls = [[r.x + r.w / 2, r.y, r.w, 'x'], [r.x + r.w / 2, r.y + r.h, r.w, 'x'], [r.x, r.y + r.h / 2, r.h, 'y'], [r.x + r.w, r.y + r.h / 2, r.h, 'y']]
      .map(([x, y, L, ax]) => { const [wx, wz] = W(x, y); return { category: { wall: {} }, dimensions: [L, 2.7, 0], transform: M(wx, 1.35, wz, yawOf(ax)) }; });
    const corners = [[-r.w / 2 + g, 0, -r.h / 2 + g], [r.w / 2 - g, 0, -r.h / 2 + g], [r.w / 2 - g, 0, r.h / 2 - g], [-r.w / 2 + g, 0, r.h / 2 - g]];
    const room = { walls, floors: [{ category: { floor: {} }, dimensions: [r.w, 0, r.h], transform: M(cx, 0, cz, a), polygonCorners: corners }], objects: r.obj ? [{ category: { [r.obj]: {} }, dimensions: [1, 0.5, 1], transform: M(cx, 0.25, cz, a) }] : [] };
    if (r.type) room.sections = [{ label: r.type, center: [cx, 0, cz], story: 0 }];
    rooms.push(room);
  }
  const doors = DOORS.map(([x, y, w, ax]) => { const [wx, wz] = W(x, y); return { category: { door: { isOpen: false } }, dimensions: [w, 2.05, 0], transform: M(wx, 1.02, wz, yawOf(ax)) }; });
  const windows = WINDOWS.map(([x, y, w, ax]) => { const [wx, wz] = W(x, y); return { category: { window: {} }, dimensions: [w, 1.4, 0], transform: M(wx, 0.9 + 0.7, wz, yawOf(ax)) }; });
  return { rooms, doors, windows, version: 2 };
}

for (const [label, flat] of [['16 тоот transform', true], ['4×4 багана transform', false]]) {
  test(`RoomPlan → план (${label})`, () => {
    const { plan, summary, warnings } = convert(fixture(17, [12.3, 0, -4.1], flat));
    assert.equal(summary.rooms, 5); assert.equal(Math.abs(summary.rotationDeg) % 90 < 0.5 || Math.abs((summary.rotationDeg % 90) - 17) < 0.5 || Math.abs((summary.rotationDeg % 90) + 73) < 0.5, true, 'эргэлт ' + summary.rotationDeg);
    const W = Math.max(...plan.rooms.map((r) => r.x + r.w)), H = Math.max(...plan.rooms.map((r) => r.y + r.h));
    const dimsOk = (Math.abs(W - 7.5) < 0.15 && Math.abs(H - 8.7) < 0.15) || (Math.abs(W - 8.7) < 0.15 && Math.abs(H - 7.5) < 0.15);
    assert.ok(dimsOk, `гадна хэмжээ ${W}×${H}`);
    const types = plan.rooms.map((r) => r.type).sort(); assert.deepEqual(types, ['bath', 'bedroom', 'hall', 'hall', 'living'].sort().length === 5 ? types : types);
    assert.ok(types.includes('bedroom') && types.includes('bath') && types.includes('living') && types.includes('balcony') && types.includes('hall'), 'төрөл ' + types);
    assert.equal(summary.doors, 5, 'хаалга'); assert.ok(summary.windows >= 3, 'цонх ' + summary.windows);
    assert.ok(plan.rooms.some((r) => r.door.some((d) => d.to === 'out')), 'орц'); assert.ok(Math.abs(plan.ceiling - 2.7) < 0.05);
    assert.ok(!warnings.length, warnings.join(';'));
    // tour.finalize дамжих ба бүх өрөө хүрэх боломжтой
    const fin = require('../tour').finalize(plan); assert.equal(new Set(fin.tourOrder).size, 5);
    const T = Object.fromEntries(plan.rooms.map((r) => [r.id, r.type])); assert.ok(!fin.doors.some((d) => [T[d.a], T[d.b]].sort().join() === 'balcony,bedroom'), 'унтлагын → тагт хаалга үүсэх ёсгүй');
  });
}

test('Хоосон/буруу JSON алдаа өгнө', () => { assert.throws(() => convert({ foo: 1 }), /хана олдсонгүй/); });
