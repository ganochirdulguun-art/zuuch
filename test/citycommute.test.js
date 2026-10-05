// Ш3 хотын замын хугацаа: нүдний сүлжээ, Route Matrix хариу задлах, зардал, нүднээс профайл үүсгэх (API дуудахгүй)
const test = require('node:test');
const assert = require('node:assert/strict');
const cc = require('../citycommute');
const commute = require('../commute');

test('нүд: барилгатай хавтан, cellOf нь төвийнхөө нүдийг буцаана', () => {
  const cs = cc.cells(); assert.ok(cs.length > 500, 'нүдний тоо ' + cs.length);
  for (const c of cs.slice(0, 50)) assert.equal(cc.cellOf(c.lat, c.lng), c.cell);
});

test('зардал: сард 5 000 үнэгүй, дараа нь $10 / 1000', () => {
  assert.equal(cc.usd(4000), 0); assert.equal(cc.usd(15000), 100); assert.equal(cc.usd(15000, 0), 150);
  assert.equal(cc.usd(205000), 950 + 840); // (205k − 5k үнэгүй): 95k×$10 + 105k×$8
});

test('Route Matrix хариу → минут, км; замгүй элемент алгасна', () => {
  const r = cc.parseMatrix([
    { originIndex: 1, destinationIndex: 2, duration: '1260s', staticDuration: '900s', distanceMeters: 8350, condition: 'ROUTE_EXISTS' },
    { originIndex: 0, destinationIndex: 0, condition: 'ROUTE_NOT_FOUND' },
    { destinationIndex: 1, duration: '60s', staticDuration: '60s', distanceMeters: 400, condition: 'ROUTE_EXISTS', status: { code: 5 } },
  ]);
  assert.deepEqual(r[0], { o: 1, d: 2, ok: true, min: 21, freeMin: 15, km: 8.4 });
  assert.equal(r[1].ok, false); assert.equal(r[2].ok, false); assert.equal(r[2].o, 0);
});

test('нүдний өгөгдлөөс профайл: бүх цэг/цонх, оноо commute.scoreProfile-тэй ижил', () => {
  const data = {}; for (const d of commute.destinations()) data[d.id] = { am_peak: { min: 30, freeMin: 18, km: 9 }, midday: { min: 24, freeMin: 18, km: 9 }, pm_peak: { min: 34, freeMin: 18, km: 9 }, free: { min: 18, freeMin: 18, km: 9 } };
  const p = cc.profileFromCell({ cell: '38_16', lat: 47.906, lng: 106.898, data, computed_at: new Date().toISOString() });
  assert.equal(p.rows.length, commute.destinations().length); assert.equal(p.city, true);
  assert.equal(p.peakMin, 34); assert.equal(p.freeMin, 18); assert.ok(p.score > 0 && p.score <= 100);
  assert.equal(cc.profileFromCell(null), null);
});
