// «Зууч» МУТСТ комплаенс — хуулийн дүрмүүд (цэвэр логик, өгөгдлийн сангүй).
// Эх сурвалж (2026-10-07-нд legalinfo.mn, fiu.mongolbank.mn-ээс шалгасан):
//   МУТСТХ  — Мөнгө угаах болон терроризмыг санхүүжүүлэхтэй тэмцэх тухай хууль (2024-06-05-ны өөрчлөлт хүртэл)
//   УСҮАЖ   — Монголбанкны Ерөнхийлөгчийн 2019 оны А-26 тушаал (2021 А-31, 2023-01-25 өөрчлөлттэй)
//   А-171   — СМА-нд мэдээлэл ирүүлэх журам (2022-06-07, goAML)
//   ЗГ-464  — Санхүүгийн зорилтот хориг арга хэмжээ авах журам (2019)
//   СЗХ-22  — СЗХ-ны 2023-01-13-ны 22 дугаар тогтоол (хяналт шалгалтын журам)
//   АСЗХ    — Нийтийн албанд ... ашиг сонирхлын зөрчлөөс урьдчилан сэргийлэх тухай хууль
'use strict';

const MNT = 1e6; // хэлцлийн дүн системд «сая ₮»-өөр хадгалагддаг
const THRESHOLD = 20 * MNT; // МУТСТХ 5.1.2, 5.1.3, 7.1 — 20 сая ₮ буюу түүнтэй тэнцэх валют
const CTR_WORKDAYS = 5; // МУТСТХ 7.1 — ажлын 5 өдөр
const STR_HOURS = 24; // МУТСТХ 7.2 — 24 цаг
const TFS_HOURS = 24; // ҮОХЗДТТХ 23.6, УСҮАЖ 14.4 — 24 цаг
const RFI_WORKDAYS = 5; // МУТСТХ 9.2, А-171 3.3 — СМА-ны нэмэлт мэдээллийн хүсэлт
const RETENTION_YEARS = 5; // МУТСТХ 8.1, УСҮАЖ 15.1 — 5-аас доошгүй жил
const BO_PERCENT = 33; // УСҮАЖ 4.3 — эцсийн өмчлөгчийн босго (шууд + шууд бус)

// Хамрах хүрээ: зөвхөн үл хөдлөх хөрөнгө худалдах/худалдан авах (МУТСТХ 4.1.7) — түрээс хамаарахгүй
const inScope = (dealType) => dealType === 'sale';

// Бэлэн мөнгөний гүйлгээний тайланд (БМГТ) хамаарах төлбөрийн хэлбэр — МУТСТХ 7.1, 3.1.3 (чек, вексель, үнэт цаас «бэлэн мөнгө»-нд орно)
const METHODS = {
  cash: { t: 'Бэлэн мөнгө', ctr: true },
  cheque: { t: 'Чек, вексель, үнэт цаас', ctr: true },
  foreign: { t: 'Гадаад төлбөр тооцоо', ctr: true },
  virtual: { t: 'Виртуал хөрөнгө', ctr: true },
  transfer: { t: 'Дотоодын банкны шилжүүлэг', ctr: false },
  mortgage: { t: 'Ипотекийн зээл (банкаар)', ctr: false },
};
const ctrRequired = (method, amountMnt) => !!(METHODS[method] && METHODS[method].ctr) && Number(amountMnt) >= THRESHOLD;

// АСЗХ 20.2 — улс төрд нөлөө бүхий этгээдийн (УТНБЭ) албан тушаал; «эрхэлж байсан болон эрхэлж байгаа» — хуучин албан тушаалтан ч хамаарна
const PEP_POSITIONS = [
  'Монгол Улсын Ерөнхийлөгч', 'УИХ-ын гишүүн', 'Ерөнхий сайд', 'Засгийн газрын гишүүн', 'Үндсэн хуулийн цэцийн гишүүн', 'Улсын дээд шүүхийн шүүгч',
  'Улсын ерөнхий прокурор', 'УИХ-д шууд тайлагнадаг байгууллагын дарга, дэд дарга', 'Аймаг, нийслэлийн Засаг дарга', 'Аймаг, нийслэлийн ИТХ-ын дарга',
  'Яамны Төрийн нарийн бичгийн дарга', 'Агентлагийн дарга', 'УИХ-д суудалтай намын дарга', 'Төрийн өмчит компанийн дарга, захирал', 'Олон улсын байгууллагын дарга, захирал',
  'Гадаад улсын адилтгах албан тушаалтан', 'Олон улсын байгууллагын албан тушаалтан',
];
const PEP_RELATIONS = { self: 'Өөрөө', family: 'Гэр бүлийн гишүүн / хамаарал бүхий этгээд', associate: 'Нэгдмэл сонирхолтой, ойр дотны этгээд' }; // УСҮАЖ 6.3

// ФАТФ «call for action» (хар) жагсаалт — МУТСТХ 5.9.2-оор өндөр эрсдэлтэй. Жагсаалт өөрчлөгддөг тул комплаенсын ажилтан шинэчилнэ (companies.meta.aml.fatf)
const FATF_DEFAULT = { black: ['KP', 'IR', 'MM'], grey: [], updated: null, src: 'https://www.fatf-gafi.org/en/countries/black-and-grey-lists.html' };

// ---- Эрсдэлийн үнэлгээ (МУТСТХ 4.3: харилцагч, бүтээгдэхүүн/үйлчилгээ, хүргэх суваг, газарзүй) ----
// Автомат «өндөр»: УТНБЭ (5.9.1), ФАТФ-ын хар жагсаалтын улс (5.9.2), зайнаас/гуравдагч этгээдээр ХТМ (УСҮАЖ 7.2), хориг жагсаалтын тохирол
// Оноо: компанийн аргачлал — тохируулах боломжтой жинтэй. 0–1 бага, 2–4 дунд, ≥5 өндөр
const FACTORS = [
  { k: 'bo_unknown', g: 'customer', w: 3, t: 'Эцсийн өмчлөгч тогтоогдоогүй' },
  { k: 'complex_structure', g: 'customer', w: 2, t: 'Өмчлөлийн олон шаттай, ээдрээтэй бүтэц' },
  { k: 'nominee', g: 'customer', w: 2, t: 'Өөр этгээдийг төлөөлж / итгэмжлэлээр ажиллаж буй' },
  { k: 'nonresident', g: 'geography', w: 1, t: 'Монгол Улсад байнга оршин суудаггүй' },
  { k: 'grey_country', g: 'geography', w: 2, t: 'ФАТФ-ын хяналт сайжруулах (саарал) жагсаалтын улстай холбоотой' },
  { k: 'cash_large', g: 'product', w: 3, t: '20 сая ₮-с дээш бэлэн мөнгөөр төлөх' },
  { k: 'third_party_payer', g: 'product', w: 2, t: 'Төлбөрийг гуравдагч этгээд төлж буй' },
  { k: 'foreign_funds', g: 'product', w: 2, t: 'Хөрөнгө гадаадаас шилжиж ирсэн' },
  { k: 'virtual_assets', g: 'product', w: 3, t: 'Виртуал хөрөнгөөр төлөх' },
  { k: 'price_anomaly', g: 'product', w: 2, t: 'Үнэ зах зээлийн үнээс эрс зөрүүтэй (±30%+)' },
  { k: 'rapid_resale', g: 'product', w: 2, t: 'Богино хугацаанд (6 сар дотор) дахин худалдах' },
  { k: 'profile_mismatch', g: 'customer', w: 2, t: 'Гүйлгээ харилцагчийн орлого, ажил эрхлэлттэй нийцэхгүй' },
];
const AUTO_HIGH = {
  pep: 'Улс төрд нөлөө бүхий этгээд (МУТСТХ 5.9.1)',
  fatf_black: 'ФАТФ-ын хар жагсаалтын улстай холбоотой (МУТСТХ 5.9.2)',
  remote: 'Зайнаас эсвэл гуравдагч этгээдээр ХТМ хийсэн (УСҮАЖ 7.2)',
  sanction_hit: 'Хориг жагсаалтын баталгаажсан тохирол (МУТСТХ 6¹)',
};

function assessRisk(p = {}, weights = {}) {
  const reasons = []; let score = 0; let auto = false;
  const f = p.factors || {};
  if (p.pep && p.pep.is) { auto = true; reasons.push({ k: 'pep', t: AUTO_HIGH.pep, auto: true }); }
  if (f.fatf_black) { auto = true; reasons.push({ k: 'fatf_black', t: AUTO_HIGH.fatf_black, auto: true }); }
  if (f.remote) { auto = true; reasons.push({ k: 'remote', t: AUTO_HIGH.remote, auto: true }); }
  if (p.sanction_confirmed) { auto = true; reasons.push({ k: 'sanction_hit', t: AUTO_HIGH.sanction_hit, auto: true }); }
  for (const x of FACTORS) if (f[x.k]) { const w = Number.isFinite(weights[x.k]) ? weights[x.k] : x.w; score += w; reasons.push({ k: x.k, t: x.t, w, g: x.g }); }
  const level = auto || score >= 5 ? 'high' : score >= 2 ? 'medium' : 'low';
  // Хялбаршуулсан ХТМ зөвхөн бага эрсдэлтэй, сэжиггүй үед (МУТСТХ 5.5, УСҮАЖ 5.4); өндөр эрсдэлд нарийвчилсан ХТМ заавал (МУТСТХ 5.3)
  const cdd = level === 'high' ? 'enhanced' : level === 'low' && !f.suspicion ? 'simplified' : 'standard';
  return { level, score, auto, cdd, reasons };
}

// ---- ХТМ-ийн бүрдэл шалгах: дутуу зүйлсийн жагсаалт ----
// Иргэн: МУТСТХ 5.2.1, УСҮАЖ 3.2 (Хүснэгт 1) · Хуулийн этгээд: МУТСТХ 5.2.2–5.2.5, УСҮАЖ 3.3 (Хүснэгт 2), 4.3
const IND_FIELDS = [['surname', 'Овог'], ['parent_name', 'Эцэг/эхийн нэр'], ['given_name', 'Өөрийн нэр'], ['birth_date', 'Төрсөн огноо'], ['register_no', 'Регистрийн дугаар'], ['id_doc_no', 'Иргэний үнэмлэх / паспортын дугаар'], ['address', 'Оршин суугаа хаяг'], ['phone', 'Утас'], ['occupation', 'Эрхэлж буй ажил, бизнес']];
const LEG_FIELDS = [['name', 'Хуулийн этгээдийн нэр'], ['state_reg_no', 'Улсын бүртгэлийн дугаар'], ['tax_no', 'Татвар төлөгчийн дугаар'], ['address', 'Хаяг'], ['phone', 'Утас'], ['management', 'Удирдлагын мэдээлэл'], ['rep_name', 'Төлөөлөгчийн нэр'], ['rep_authority', 'Төлөөлөх эрхийн баримт']];
function cddGaps(p = {}, docs = []) {
  const d = p.data || {}; const gaps = [];
  const fields = p.kind === 'legal' ? LEG_FIELDS : IND_FIELDS;
  for (const [k, t] of fields) if (!String(d[k] || '').trim()) gaps.push(t);
  const has = (kind) => docs.some((x) => x.kind === kind);
  if (p.kind === 'legal') {
    if (!has('cert')) gaps.push('Улсын бүртгэлийн гэрчилгээний хуулбар');
    const bo = Array.isArray(p.bo) ? p.bo : [];
    if (!bo.length) gaps.push('Эцсийн өмчлөгч (33%+ эсвэл хяналт тавигч)');
    else if (!bo.some((b) => Number(b.pct) >= BO_PERCENT || b.control)) gaps.push(`${BO_PERCENT}%-иас дээш эзэмшигч эсвэл хяналт тавигч хүн тодорхойлогдоогүй`);
  } else if (!has('id')) gaps.push('Иргэний үнэмлэх / паспортын хуулбар');
  if (d.acting_for && !String(d.acting_for_name || '').trim()) gaps.push('Төлөөлж буй этгээдийн мэдээлэл');
  if (!String(d.purpose || '').trim()) gaps.push('Харилцааны зорилго, гүйлгээний утга (МУТСТХ 5.2.3)');
  const r = assessRisk(p);
  if (r.cdd === 'enhanced') { // УСҮАЖ 7.5
    if (!String((p.pep && p.pep.source_of_funds) || d.source_of_funds || '').trim()) gaps.push('Хөрөнгийн эх үүсвэр (нарийвчилсан ХТМ)');
    if (!p.edd_approved_by) gaps.push('Гүйцэтгэх удирдлагын зөвшөөрөл (нарийвчилсан ХТМ)');
  }
  if (!p.sanctions || !p.sanctions.checked_at) gaps.push('Хориг жагсаалтаар шалгаагүй');
  else if ((p.sanctions.hits || []).some((h) => !h.cleared)) gaps.push('Хориг жагсаалтын шийдээгүй тохирол');
  return gaps;
}

// ---- Хугацаа ----
// Ажлын өдөр: Даваа–Баасан, тогтмол огноотой нийтийн амралтын өдрүүдийг хасна (Хөдөлмөрийн тухай хууль). Цагаан сар, Чингис хааны өдөр
// сарны тооллоор жил бүр өөр тул тооцохгүй — хугацаа хэзээ ч бодитоос хойш гарахгүй (болгоомжтой тал руу).
const FIXED_HOLIDAYS = ['01-01', '03-08', '06-01', '07-11', '07-12', '07-13', '07-14', '07-15', '11-26', '12-29'];
const UB = 8 * 3600e3;
const ubDate = (ms) => new Date(ms + UB).toISOString().slice(0, 10);
function isWorkday(ymd, extraHolidays = []) {
  const d = new Date(ymd + 'T00:00:00Z'); const wd = d.getUTCDay();
  if (wd === 0 || wd === 6) return false;
  return !FIXED_HOLIDAYS.includes(ymd.slice(5)) && !extraHolidays.includes(ymd);
}
// Гүйлгээ хийгдсэн өдрөөс хойш N ажлын өдрийн сүүлийн өдөр (УБ цагаар 23:59)
function addWorkdays(ymd, n, extra = []) {
  let d = new Date(ymd + 'T00:00:00Z'); let left = n;
  while (left > 0) { d = new Date(d.getTime() + 864e5); if (isWorkday(d.toISOString().slice(0, 10), extra)) left--; }
  return d.toISOString().slice(0, 10);
}
const ctrDue = (txDate, extra) => addWorkdays(txDate, CTR_WORKDAYS, extra);
const strDue = (detectedMs) => new Date(detectedMs + STR_HOURS * 3600e3);
const retainUntil = (ymd) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCFullYear(d.getUTCFullYear() + RETENTION_YEARS); return d.toISOString().slice(0, 10); };

// ---- СЗХ-ны тайлангийн календарь ----
//   frc_q    — улирлын 11 маягт: дараа улирлын эхний сарын 10 (СЗХ 2023 №235, 5.1; 2026 №108-аар өөрчлөгдсөн)
//   frc_aml  — МУТСТ дотоод хяналтын хөтөлбөрийн хэрэгжилт + эрсдэлийн асуулга: 7/10 ба дараа оны 1/20 (СЗХ 2023 №22, 3.5)
//   frc_audit — аудитлагдсан санхүүгийн тайлан: дараа оны 5/10 (СЗХ 2024 №648, 1-р хавсралт 3.2)
//   tfs_q    — хориг арга хэмжээний хэрэгжилтийн тайлан улирал бүр (УСҮАЖ 14.8) — эцсийн хугацааг журамд заагаагүй тул улирлын тайлантай хамт
const CAL_KINDS = {
  frc_q: { t: 'СЗХ-ны улирлын тайлан (11 маягт)', cite: 'СЗХ №235, 5.1' },
  frc_aml: { t: 'МУТСТ хөтөлбөрийн хэрэгжилт, эрсдэлийн асуулга', cite: 'СЗХ №22, 3.5' },
  frc_audit: { t: 'Аудитлагдсан санхүүгийн тайлан', cite: 'СЗХ №648, 3.2' },
  tfs_q: { t: 'Хориг арга хэмжээний хэрэгжилтийн тайлан', cite: 'УСҮАЖ 14.8', soft: true },
};
function calendar(fromYmd, toYmd) {
  const y0 = Number(fromYmd.slice(0, 4)) - 1, y1 = Number(toYmd.slice(0, 4)) + 1; const out = [];
  for (let y = y0; y <= y1; y++) {
    for (let q = 1; q <= 4; q++) { const ny = q === 4 ? y + 1 : y; const m = q === 4 ? 1 : q * 3 + 1; const due = `${ny}-${String(m).padStart(2, '0')}-10`; out.push({ key: 'frc_q', period: `${y}-Q${q}`, due }, { key: 'tfs_q', period: `${y}-Q${q}`, due }); }
    out.push({ key: 'frc_aml', period: `${y}-H1`, due: `${y}-07-10` }, { key: 'frc_aml', period: `${y}-H2`, due: `${y + 1}-01-20` }, { key: 'frc_audit', period: `${y}`, due: `${y + 1}-05-10` });
  }
  return out.filter((x) => x.due >= fromYmd && x.due <= toYmd).map((x) => ({ ...x, ...CAL_KINDS[x.key] })).sort((a, b) => a.due.localeCompare(b.due));
}
// СЗХ-д урьдчилан мэдэгдэх өөрчлөлт — шийдвэр гарснаас хойш ажлын 10 өдөр (СЗХ №648, 6.1, 9.2)
const CHANGE_TYPES = {
  capital: 'Хувь нийлүүлсэн хөрөнгө, хувьцаа эзэмшигчдийн бүтэц', name: 'Оноосон нэр', officer: 'Эрх бүхий албан тушаалтан', aml_officer: 'МУТСТ-ийн хэрэгжилтэд хяналт тавих ажилтан',
  broker: 'Брокер', terms: 'Үйлчилгээний ерөнхий нөхцөл, хөлс, шагнал', agent: 'Агент, борлуулалтын ажилтан', address: 'Төв, салбар, төлөөлөгчийн газрын хаяг', bo: 'Хувьцаа эзэмшигчийн эцсийн өмчлөгч (№648, 7.4)',
};
const CHANGE_WORKDAYS = 10;
const changeDue = (decisionYmd, extra) => addWorkdays(decisionYmd, CHANGE_WORKDAYS, extra);

// ---- Нэр тулгах (хориг жагсаалт): кирилл → латин, жижиг үсэг, авиа ойролцоолол, токен бүрийн Jaro-Winkler ----
const CYR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', ө: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ү: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
function normName(s) {
  let x = String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  x = x.replace(/[а-яёөү]/g, (c) => CYR[c] ?? c);
  x = x.replace(/kh/g, 'h').replace(/ph/g, 'f').replace(/dzh|dj|zh/g, 'j').replace(/w/g, 'v').replace(/[öø]/g, 'o').replace(/ü/g, 'u').replace(/y(?=[aeiou])/g, 'y');
  return x.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function jaroWinkler(a, b) {
  if (a === b) return 1; const la = a.length, lb = b.length; if (!la || !lb) return 0;
  const md = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1); const ma = new Array(la).fill(false), mb = new Array(lb).fill(false); let m = 0;
  for (let i = 0; i < la; i++) for (let j = Math.max(0, i - md); j < Math.min(lb, i + md + 1); j++) if (!mb[j] && a[i] === b[j]) { ma[i] = mb[j] = true; m++; break; }
  if (!m) return 0; let t = 0, k = 0;
  for (let i = 0; i < la; i++) if (ma[i]) { while (!mb[k]) k++; if (a[i] !== b[k]) t++; k++; }
  const j = (m / la + m / lb + (m - t / 2) / m) / 3; let p = 0; while (p < 4 && a[p] === b[p]) p++;
  return j + p * 0.1 * (1 - j);
}
// Хүний нэр (a) жагсаалтын нэртэй (b) хэр тохирох 0..1: a-ийн ҮГ БҮРТ b-ээс хамгийн сайн тохирохыг олж дундажлана (дараалал хамаарахгүй).
// Хоёр ба түүнээс дээш үгтэй нэрд дор хаяж 2 өөр үг таарах ёстой — нэг үгтэй хоч нэр (жишээ нь «Hassan») ганц үгээр тохирол үүсгэхгүй.
const PARTICLES = new Set(['al', 'el', 'bin', 'ibn', 'bint', 'abu', 'ould', 'dr', 'mr', 'haji', 'hajji', 'mullah', 'mawlawi', 'sheikh', 'shaykh', 'de', 'la', 'van', 'von', 'der']);
// Угтвар, цол, 3-аас богино үгийг (Ba, Al, Dr) тулгалтад тооцохгүй
const toks = (s) => normName(s).replace(/-/g, ' ').split(' ').filter((t) => t.length >= 3 && !PARTICLES.has(t));
function nameScore(a, b) {
  const P = normName(a).replace(/-/g, ' ').split(' ').filter((t) => t.length >= 2 && !PARTICLES.has(t)), L = toks(b); // хүний нэрийн богино үг (Ли) хасагдахгүй
  if (!P.length || !L.length) return 0;
  let sum = 0, worst = 1; const used = new Set();
  for (const x of P) { let best = 0, bj = -1; L.forEach((y, j) => { const sc = jaroWinkler(x, y); if (sc > best) { best = sc; bj = j; } }); sum += best; worst = Math.min(worst, best); if (best >= 0.85) used.add(bj); }
  let sc = sum / P.length;
  if (used.size < Math.min(2, P.length, L.length)) sc *= 0.8;
  if (worst < 0.82) sc *= 0.85; // хүний нэрийн аль нэг үг огт таараагүй
  return sc;
}
const MATCH_MIN = 0.9;
// entries: [{ id, names: [..], dob, kind }]; хүн: { names: [..], dob, kind }
function screen(person, entries, min = MATCH_MIN) {
  const hits = [];
  for (const e of entries) {
    if (person.kind && e.kind && person.kind !== e.kind) continue;
    let best = 0, on = ''; for (const n of person.names || []) for (const m of e.names || []) { const sc = nameScore(n, m); if (sc > best) { best = sc; on = m; } }
    if (best < min) continue;
    const dobMatch = person.dob && e.dob && e.dob.length ? e.dob.some((d) => String(d).slice(0, 10) === person.dob || (d.length === 4 && person.dob.startsWith(d))) : null;
    if (dobMatch === false && best < 0.97) continue; // төрсөн огноо зөрвөл зөвхөн маш өндөр нэрийн тохиролыг үлдээнэ
    hits.push({ id: e.id, ref: e.ref, source: e.source, name: on, score: Math.round(best * 1000) / 1000, dob: dobMatch });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 10);
}

// ---- Сэжигтэй гүйлгээний жишиг шинж тэмдэг (ФАТФ, Үл хөдлөх хөрөнгийн салбарын эрсдэлд суурилсан хандлагын удирдамж, 2022) ----
const INDICATORS = [
  'Их хэмжээний бэлэн мөнгөөр төлөх, эсвэл дүнг босгоос доош хувааж төлөх оролдлого',
  'Гүйлгээнд хамааралгүй гуравдагч этгээд төлбөр төлж буй',
  'Үнэ зах зээлийн үнээс эрс өндөр эсвэл бага, эдийн засгийн үндэслэлгүй',
  'Богино хугацаанд олон удаа худалдаж, худалдан авах',
  'Эцсийн өмчлөгчөө нуух, ээдрээтэй бүтэц, нэр төлөөлөгч ашиглах',
  'Мэдээлэл өгөхөөс зайлсхийх, худал эсвэл зөрүүтэй баримт ирүүлэх',
  'Харилцагчийн орлого, ажил эрхлэлттэй нийцэхгүй хэмжээний худалдан авалт',
  'Хөрөнгө өндөр эрсдэлтэй улсаас шилжиж ирсэн, эсвэл виртуал хөрөнгө ашигласан',
  'Үл хөдлөх хөрөнгийг үзэлгүйгээр, нөхцөлийг сонирхолгүйгээр яаран худалдан авах',
  'Гэрээ байгуулсны дараа удалгүй цуцалж, төлбөрөө өөр данс руу буцаахыг хүсэх',
];

module.exports = { MNT, THRESHOLD, CTR_WORKDAYS, STR_HOURS, TFS_HOURS, RFI_WORKDAYS, RETENTION_YEARS, BO_PERCENT, METHODS, PEP_POSITIONS, PEP_RELATIONS, FATF_DEFAULT, FACTORS, AUTO_HIGH, INDICATORS, FIXED_HOLIDAYS,
  inScope, ctrRequired, assessRisk, cddGaps, isWorkday, addWorkdays, ctrDue, strDue, retainUntil, calendar, CAL_KINDS, CHANGE_TYPES, CHANGE_WORKDAYS, changeDue, ubDate, normName, jaroWinkler, nameScore, screen, MATCH_MIN };
