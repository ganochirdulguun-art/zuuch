// Эх сурвалж хоорондын давхардлын дүрэм — бодит гарчгуудаар (локал өгөгдлөөс)
const test = require('node:test');
const assert = require('node:assert/strict');
const { isDup, tokens } = require('../dedup');

const L = (title, area, price) => ({ title, area, price });

test('Жинхэнэ давхардал', () => {
  assert.ok(isDup(L('СБД, Regency Residence 3 өрөө байр түрээслүүлнэ', 125, 5), L('Хотын төвд regency residence-д 125 мкв 3 өрөө байp', 125, 5)));
  assert.ok(isDup(L('Tara center 43.54мкв үйлчилгээний талбай худалдана', 43.54, 783), L('Tara center hudaldaanii towd 43mkv uilchilgeenii talbai', 43, 783.72)));
  assert.ok(isDup(L('БЗД, Grand Residence 88.68мкв үйлчилгээний талбай', 88.68, 532.08), L('Баянзүрх дүүрэг үйлчилгээний 88,68м2 талбай', 88.68, 532.08)), 'бутархай талбай яг таарсан');
  assert.ok(isDup(L('БГД, Шонхор плаза, 32.5мкв', 32.5, 1.3), L('Бгд 7-р хороо шонхор плазад ажлын байр 32мкв', 32, 1.3)));
});

test('Андуурах ёсгүй (түгээмэл түрээс, ерөнхий үг)', () => {
  assert.ok(!isDup(L('БЗД, Тарвалин Хотхон 2 өрөө байр түрээслүүлнэ', 41.1, 1.8), L('Натурт бүрэн тавилгатай 2 өрөө 41мкв', 41, 1.8)));
  assert.ok(!isDup(L('Wizard Town-д 65мкв 2 өрөө', 65.14, 210), L('ХУД, Aero Town 2 өрөө байр худалдана', 64.32, 200)));
  assert.ok(!isDup(L('БЗД, Central Garden 2 өрөө байр түрээслүүлнэ', 51, 2.5), L('Sunny town хотхонд 2 өрөө 50мкв', 50, 2.4)));
});

test('Кирилл ↔ латин адилтгал', () => {
  assert.ok([...tokens('Ривер гарден хотхон')].includes('river'));
  assert.ok(!tokens('2 өрөө байр зарна').size, 'ерөнхий үг үлдэхгүй');
});
