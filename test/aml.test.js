// Комплаенс дүрмүүд: хуулийн босго, хугацаа, эрсдэлийн ангилал, ХТМ-ийн бүрдэл, нэр тулгалт, НҮБ-ын XML задлалт
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../aml/rules');
const { parseUN } = require('../aml/sanctions');

test('БМГТ босго: 20 сая ₮ ба түүнээс дээш, бэлэн/гадаад/виртуал/чек (МУТСТХ 7.1, 3.1.3)', () => {
  assert.equal(R.THRESHOLD, 20000000);
  assert.equal(R.ctrRequired('cash', 20000000), true);
  assert.equal(R.ctrRequired('cash', 19999999), false);
  assert.equal(R.ctrRequired('foreign', 25000000), true);
  assert.equal(R.ctrRequired('virtual', 20000000), true);
  assert.equal(R.ctrRequired('cheque', 30000000), true);
  assert.equal(R.ctrRequired('transfer', 500000000), false);
  assert.equal(R.ctrRequired('mortgage', 500000000), false);
  assert.equal(R.inScope('sale'), true); assert.equal(R.inScope('rent'), false); // МУТСТХ 4.1.7 — түрээс хамаарахгүй
});

test('Ажлын 5 өдөр: амралтын өдөр, тогтмол баярыг хасна', () => {
  assert.equal(R.ctrDue('2026-10-07'), '2026-10-14'); // Лх → дараа долоо хоногийн Лх
  assert.equal(R.ctrDue('2026-10-09'), '2026-10-16'); // Ба
  assert.equal(R.ctrDue('2026-11-24'), '2026-12-02'); // 11-26 Тусгаар тогтнолын өдөр хасагдана
  assert.equal(R.ctrDue('2026-07-09'), '2026-07-21'); // Наадам 07-11..15 (10, 16, 17, 20, 21)
  assert.equal(R.ctrDue('2026-12-28'), '2027-01-06'); // 12-29, 01-01 хасагдана (30, 31, 4, 5, 6)
  assert.equal(R.changeDue('2026-12-24'), '2027-01-11'); // СЗХ №648 9.2 — ажлын 10 өдөр
});

test('СГТ 24 цаг, хадгалах 5 жил', () => {
  const t0 = Date.parse('2026-10-07T02:00:00Z');
  assert.equal(R.strDue(t0).toISOString(), '2026-10-08T02:00:00.000Z');
  assert.equal(R.retainUntil('2026-10-07'), '2031-10-07');
});

test('СЗХ-ны календарь: улирлын 1/10, 4/10, 7/10, 10/10; МУТСТ 7/10, 1/20; аудит 5/10', () => {
  const c = R.calendar('2027-01-01', '2027-12-31');
  const f = (k) => c.filter((x) => x.key === k).map((x) => x.due);
  assert.deepEqual(f('frc_q'), ['2027-01-10', '2027-04-10', '2027-07-10', '2027-10-10']);
  assert.deepEqual(f('frc_aml'), ['2027-01-20', '2027-07-10']);
  assert.deepEqual(f('frc_audit'), ['2027-05-10']);
  assert.equal(c.find((x) => x.key === 'frc_q' && x.due === '2027-01-10').period, '2026-Q4');
});

test('Эрсдэл: УТНБЭ, ФАТФ хар жагсаалт, зайнаас ХТМ → автоматаар өндөр; бага эрсдэлд хялбаршуулсан', () => {
  assert.equal(R.assessRisk({}).level, 'low'); assert.equal(R.assessRisk({}).cdd, 'simplified');
  assert.equal(R.assessRisk({ pep: { is: true } }).level, 'high');
  assert.equal(R.assessRisk({ pep: { is: true } }).cdd, 'enhanced');
  assert.equal(R.assessRisk({ factors: { fatf_black: true } }).level, 'high');
  assert.equal(R.assessRisk({ factors: { remote: true } }).level, 'high');
  assert.equal(R.assessRisk({ factors: { third_party_payer: true } }).level, 'medium');
  assert.equal(R.assessRisk({ factors: { cash_large: true, third_party_payer: true } }).level, 'high'); // 3+2
  assert.equal(R.assessRisk({ factors: { suspicion: true } }).cdd, 'standard'); // сэжигтэй үед хялбаршуулахгүй (УСҮАЖ 5.4)
  assert.equal(R.assessRisk({ factors: { nonresident: true } }, { nonresident: 0 }).level, 'low'); // компанийн жин
});

test('ХТМ-ийн бүрдэл: иргэн ба хуулийн этгээд, эцсийн өмчлөгч 33%', () => {
  const ind = { kind: 'individual', data: { surname: 'Боржигин', parent_name: 'Дорж', given_name: 'Бат', birth_date: '1990-01-01', register_no: 'УБ90010112', id_doc_no: '123', address: 'УБ', phone: '9911', occupation: 'Инженер', purpose: 'Орон сууц худалдан авах' }, sanctions: { checked_at: 'x', hits: [] } };
  assert.deepEqual(R.cddGaps(ind, [{ kind: 'id' }]), []);
  assert.ok(R.cddGaps(ind, []).some((g) => /үнэмлэх/.test(g)));
  const leg = { kind: 'legal', data: { name: 'ХХК', state_reg_no: '1', tax_no: '2', address: 'a', phone: 'p', management: 'm', rep_name: 'r', rep_authority: 'итгэмжлэл', purpose: 'p' }, bo: [{ name: 'А', pct: 20 }], sanctions: { checked_at: 'x', hits: [] } };
  assert.ok(R.cddGaps(leg, [{ kind: 'cert' }]).some((g) => /33%/.test(g)));
  assert.deepEqual(R.cddGaps({ ...leg, bo: [{ name: 'А', pct: 40 }] }, [{ kind: 'cert' }]), []);
  assert.deepEqual(R.cddGaps({ ...leg, bo: [{ name: 'А', pct: 10, control: true }] }, [{ kind: 'cert' }]), []);
  const pep = { ...ind, pep: { is: true } };
  const g = R.cddGaps(pep, [{ kind: 'id' }]);
  assert.ok(g.some((x) => /эх үүсвэр/.test(x)) && g.some((x) => /удирдлагын зөвшөөрөл/.test(x)));
  assert.ok(R.cddGaps({ ...ind, sanctions: { checked_at: 'x', hits: [{ cleared: false }] } }, [{ kind: 'id' }]).some((x) => /шийдээгүй/.test(x)));
});

test('Нэр тулгах: кирилл ↔ латин, дараалал, худал тохиролгүй', () => {
  assert.equal(R.normName('Хүрэлбаатар Өлзий'), 'hurelbaatar olzii');
  assert.ok(R.nameScore('Эрик Бадеге', 'ERIC BADEGE') >= R.MATCH_MIN);
  assert.ok(R.nameScore('BADEGE Eric', 'ERIC BADEGE') >= R.MATCH_MIN);
  assert.ok(R.nameScore('Дорж Бат', 'ERIC BADEGE') < 0.8);
  const list = [{ id: 1, ref: 'X.1', source: 'UN', kind: 'individual', names: ['ERIC BADEGE'], dob: ['1971'] }];
  assert.equal(R.screen({ names: ['Эрик Бадеге'], kind: 'individual' }, list).length, 1);
  assert.equal(R.screen({ names: ['Эрик Бадеге'], kind: 'individual', dob: '1971-05-01' }, list)[0].dob, true);
  assert.equal(R.screen({ names: ['Эрик Бадеге'], kind: 'entity' }, list).length, 0);
});

test('НҮБ-ын XML задлах', () => {
  const xml = `<CONSOLIDATED_LIST dateGenerated="2026-10-06T23:00:04Z"><INDIVIDUALS><INDIVIDUAL><DATAID>1</DATAID><FIRST_NAME>ERIC</FIRST_NAME><SECOND_NAME>BADEGE</SECOND_NAME><UN_LIST_TYPE>DRC</UN_LIST_TYPE><REFERENCE_NUMBER>CDi.001</REFERENCE_NUMBER><LISTED_ON>2012-12-31</LISTED_ON><NATIONALITY><VALUE>Congo</VALUE></NATIONALITY><INDIVIDUAL_ALIAS><QUALITY>Good</QUALITY><ALIAS_NAME>E. B&amp;D</ALIAS_NAME></INDIVIDUAL_ALIAS><INDIVIDUAL_DATE_OF_BIRTH><YEAR>1971</YEAR></INDIVIDUAL_DATE_OF_BIRTH></INDIVIDUAL></INDIVIDUALS><ENTITIES><ENTITY><FIRST_NAME>ACME TRADING</FIRST_NAME><REFERENCE_NUMBER>QDe.1</REFERENCE_NUMBER><ENTITY_ALIAS><ALIAS_NAME>ACME LLC</ALIAS_NAME></ENTITY_ALIAS></ENTITY></ENTITIES></CONSOLIDATED_LIST>`;
  const l = parseUN(xml);
  assert.equal(l.length, 2);
  assert.deepEqual(l[0].names, ['ERIC BADEGE', 'E. B&D']); assert.deepEqual(l[0].dob, ['1971']); assert.equal(l[0].ref, 'CDi.001');
  assert.equal(l[1].kind, 'entity'); assert.deepEqual(l[1].names, ['ACME TRADING', 'ACME LLC']);
});
