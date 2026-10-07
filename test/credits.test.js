// Кредит: багцын тогтмолууд эзний баталсан үнэтэй таарч буй эсэх, УБ цагийн сар (сарын 1-ний олголтын хил)
const test = require('node:test');
const assert = require('node:assert/strict');
const cr = require('../credits');

test('багц ба үнэ', () => {
  assert.deepEqual(Object.values(cr.PLANS).map((p) => p.price), [1800000, 2600000, 3400000]);
  for (const p of Object.values(cr.PLANS)) assert.ok(p.credits >= 20 * cr.PER_AGENT, p.name + ' — 20 агентад хүрэлцэх');
  assert.equal(cr.SPECIAL.price, 149000); assert.equal(cr.PACKS.L.price, 990000);
});
test('УБ цагийн сар', () => {
  assert.equal(cr.ubMonth(new Date('2026-10-31T16:30:00Z')), '2026-11'); // УБ 11-01 00:30
  assert.equal(cr.ubMonth(new Date('2026-10-31T15:30:00Z')), '2026-10');
});
