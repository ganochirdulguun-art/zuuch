// POV Tour планы finalize: гар хаалга/цонх, орц, тагтны дүрэм (Нарны 18-р байрны бодит план)
const test = require('node:test');
const assert = require('node:assert/strict');
const tour = require('../tour');

const NARNII = { ceiling: 2.7, entry: 'hall', rooms: [
  { id: 'bath', type: 'bath', name: 'Угаалгын өрөө', x: 0, y: 0, w: 3.6, h: 1.3 },
  { id: 'hall', type: 'hall', name: 'Коридор', x: 0, y: 1.3, w: 3.6, h: 2.1, door: [{ side: 'W', off: 0.85, w: 0.9, to: 'out' }, { side: 'N', off: 1.95, w: 0.8 }, { side: 'E', off: 0.4, w: 1.4 }] },
  { id: 'bed1', type: 'bedroom', name: 'Унтлагын өрөө', x: 0, y: 3.4, w: 3.6, h: 4, door: [{ side: 'N', off: 2.6, w: 0.9 }], win: [{ side: 'S', off: 1.3, w: 1.8, sill: 0.85, top: 2.2 }] },
  { id: 'balc', type: 'balcony', name: 'Тагт', x: 0, y: 7.4, w: 3.6, h: 1.3, win: [{ side: 'S', off: 0.4, w: 2.9, sill: 0.9, top: 2.3 }] },
  { id: 'liv', type: 'living', name: 'Зочны өрөө + гал тогоо', x: 3.6, y: 0, w: 3.9, h: 8.7, kitchen: 'N', door: [{ side: 'W', off: 7.6, w: 0.8 }], win: [{ side: 'E', off: 0.85, w: 0.8 }, { side: 'E', off: 3.65, w: 0.8 }, { side: 'S', off: 0.5, w: 2.6 }] },
] };
const pairs = (plan) => plan.doors.map((d) => [d.a, d.b].sort().join('-')).sort();

test('Нарны 18: зөвхөн заасан хаалганууд (унтлагын → тагт хаалга үүсэхгүй)', () => {
  const p = tour.finalize(NARNII);
  assert.deepEqual(pairs(p), ['balc-liv', 'bath-hall', 'bed1-hall', 'hall-liv', 'hall-out']);
  assert.equal(p.entry, 'hall');
  assert.equal(p.rooms.find((r) => r.id === 'liv').kitchen, 'N');
  assert.equal(p.windows.length, 5);
  assert.equal(p.doors.find((d) => d.b === 'out').entry, true);
});

test('Тагт гар хаалгагүй бол автоматаар холбогдоно', () => {
  const rooms = NARNII.rooms.map((r) => (r.id === 'liv' ? { ...r, door: [] } : r));
  const p = tour.finalize({ ...NARNII, rooms });
  assert.ok(pairs(p).some((k) => k.includes('balc')), 'тагт ямар нэг өрөөтэй холбогдох ёстой');
});

test('Автомат план: өрөө бүр хүрэх боломжтой, талбай ойролцоо', () => {
  for (const [rooms, area] of [[1, 32], [2, 55], [3, 81.4], [4, 120]]) {
    const p = tour.autoPlan({ rooms, area });
    assert.equal(new Set(p.tourOrder).size, p.rooms.length, `${rooms} өрөө: бүх өрөө аялалд орно`);
    assert.ok(Math.abs(p.totalArea - area) / area < 0.35, `${rooms} өрөө: талбай ${p.totalArea} ≈ ${area}`);
  }
});

test('Буруу оролт цэвэрлэгдэнэ (төрөл, хэмжээ)', () => {
  const p = tour.finalize({ rooms: [{ id: 'a', type: 'xxx', x: 0, y: 0, w: 99, h: -3 }] });
  assert.equal(p.rooms[0].type, 'other');
  assert.ok(p.rooms[0].w <= 20 && p.rooms[0].h >= 1);
});
