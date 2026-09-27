// unegui.mn адаптерийн задлагчийн тест — сүлжээ рүү хандахгүй (фикстур HTML)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const u = require('../adapters/unegui');

const fx = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');

test('robots.txt зам шүүлт', () => {
  assert.equal(u.allowed('/l-hdlh/l-hdlh-zarna/oron-suuts-zarna/?page=6'), true);
  assert.equal(u.allowed('/adv/10735422_x/'), true);
  assert.equal(u.allowed('/api/x'), false);
  assert.equal(u.allowed('/map/'), false);
  assert.equal(u.allowed('/items/author/405330/'), false);
  assert.equal(u.allowed('/l-hdlh/l-hdlh-zarna/oron-suuts-zarna/4-r/talbai_min---133/'), false);
  assert.equal(u.allowed('/ru/l-hdlh/'), false);
});

test('огнооны харьцангуй текст → хоног', () => {
  assert.equal(u.relDays('13 минутын өмнө'), 0);
  assert.equal(u.relDays('2 цагийн өмнө'), 0);
  assert.equal(u.relDays('Өнөөдөр'), 0);
  assert.equal(u.relDays('Өчигдөр'), 1);
  assert.equal(u.relDays('4 өдрийн өмнө'), 4);
  assert.equal(u.relDays('1 долоо хоногийн өмнө'), 7);
  assert.equal(u.relDays('1 сарын өмнө'), 30);
  assert.equal(u.relDays(''), null);
});

test('гарчгаас талбай', () => {
  assert.equal(u.areaFromTitle('Рапид хороололд 1 өрөө орон сууц 34,4мкв'), 34.4);
  assert.equal(u.areaFromTitle('Хотын төвд z64 хотхонд 87.33 мкв 3 өрөө'), 87.33);
  assert.equal(u.areaFromTitle('King tower 133м2 4 өрөө байр'), 133);
  assert.equal(u.areaFromTitle('Натураас урагш амартүвшин хотхонд 2 өрөө 62m2'), 62);
  assert.equal(u.areaFromTitle('220k residence-д 4 өрөө байр 118,8мкв'), 118.8);
  assert.equal(u.areaFromTitle('Схд 1 хороолол 32 автобусны буудлын урд 33 байранд 20 мкв 1 өрөө байр'), 20);
  assert.equal(u.areaFromTitle('3 өрөө байр зарна'), null);
});

test('жагсаалтын хуудас задлах', () => {
  const { adverts, hash } = u.parseList(fx('unegui-list.html'), 'sale');
  assert.equal(adverts.length, 2);
  const a = adverts[0];
  assert.equal(a.source, 'unegui');
  assert.equal(a.source_id, '10735422');
  assert.equal(a.deal_type, 'sale');
  assert.equal(a.category, 'apartment');
  assert.equal(a.districtText, 'Сонгинохайрхан');
  assert.equal(a.khoroolol, '1-р хороолол');
  assert.equal(a.roomsText, '1');
  assert.equal(a.areaText, '20');
  assert.equal(a.priceText, '89');
  assert.equal(a.priceNegotiable, true);
  assert.equal(a.images, 14);
  assert.equal(a.postedDaysAgo, 0);
  assert.equal(a.ad_type, 'premium');
  assert.equal(a.contactKey, 'unegui-user-5556641');
  assert.equal(a.url, 'https://www.unegui.mn/adv/10735422_skhd-1-khoroolol-32-avtobusny-buudlyn-urd-33-bairand-20-mkv-1-oroo-bair/');
  assert.equal(a.phone, '');
  assert.equal(a.descr, '');
  assert.equal(typeof hash, 'string');
  assert.equal(adverts[1].source_id, '10732489');
  assert.equal(adverts[1].roomsText, '4');
  assert.equal(adverts[1].priceText, '837.9');
});

test('жагсаалт хоосон/эвдэрсэн HTML', () => {
  assert.deepEqual(u.parseList('<html></html>').adverts, []);
  assert.deepEqual(u.parseList('').adverts, []);
});

test('дэлгэрэнгүй хуудас задлах', () => {
  const d = u.parseDetail(fx('unegui-detail.html'));
  assert.equal(d.area, 133);
  assert.equal(d.floor, 10);
  assert.equal(d.total_floors, 16);
  assert.equal(d.built_year, 2026);
  assert.equal(d.date_published, '2026-09-27');
  assert.equal(d.attrs['Барилгын явц'], 'Ашиглалтад орсон');
});
