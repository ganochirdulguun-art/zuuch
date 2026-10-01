// «Зууч» — эх сурвалж хоорондын давхардал (unegui ↔ omch ↔ my-zar): нэг объектыг өөр сайтад давхар нийтэлсэн бол нэг dedup_group.
// Суурь нөхцөл: хэлцэл, ангилал, дүүрэг, өрөө ижил; талбай ±1.5% (≥ 1 м²); үнэ ±5%; давхар (байвал) ижил.
// Нэмэлт нотолгоо (аль нэг нь заавал): гарчигт ижил ОНЦЛОГ нэр (хотхон/төвийн нэр, кирилл↔латин адилтгана) ЭСВЭЛ бутархай талбай яг таарч үнэ ±1%.
// (Зөвхөн суурь нөхцөл хангалтгүй: 1.5 сая ₮-ийн түгээмэл 2 өрөө түрээс өөр хотхоных байхад андуурагдана.)
const CYR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'j', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', ө: 'u', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ү: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: 'i', э: 'e', ю: 'yu', я: 'ya' };
const STOP = new Set(('oroo uruu bair hothon hotkhon khothon zarna zarnaa zarah hudaldana turees tureesluulne tureeslene tureeslne tureesiin mkv mkb metr tavilgatai tavilga buren hagas horoo horoolol duureg ' +
  'davhar davhart davhriin shine hoid zuun baruun urd talin tald talaar hajuu hajuud haajuu deer dooroo ard oiroltsoo oir ' +
  'uilchilgeenii talbai ajliin ajlin bairshil bairshiltai bairlaltai bairlaltai sain tohilog dulaan dulaahan ongotsnii naran nartai ' +
  'zuuch zuuchlal hamt bolon baigaa onoo zereg zeregtei garaj garajtai avtozogsool zogsooltoi ulaanbaatar hotiin hotin tuv tuvd ' +
  'apartment apartments room rooms sale rent flat office house town city tower towers residence residences garden gardens park center centre plaza mall ' +
  'village complex home homes view hill side land grand royal golden green star sunny').split(/\s+/)); // ерөнхий англи үг — «Wizard Town» ≠ «Aero Town»
const translit = (s) => String(s || '').toLowerCase().replace(/[а-яёөү]/g, (c) => CYR[c] ?? c);
const tokens = (title) => new Set(translit(title).split(/[^a-z]+/).filter((w) => w.length >= 4 && !STOP.has(w)));
const shareToken = (a, b) => { const A = tokens(a); for (const w of tokens(b)) if (A.has(w)) return true; return false; };
const strongNum = (a, b) => a.area % 1 !== 0 && b.area % 1 !== 0 && Math.abs(a.area - b.area) < 0.02 && Math.abs(a.price - b.price) <= Math.max(a.price, b.price) * 0.01; // 88.68 = 88.68 (41.1 ≠ 41)
const isDup = (a, b) => shareToken(a.title, b.title) || strongNum(a, b);

const BASE = `a.source<>b.source AND a.deal_type=b.deal_type AND COALESCE(a.category,'')=COALESCE(b.category,'') AND a.district=b.district AND a.rooms=b.rooms
  AND ABS(a.area-b.area)<=GREATEST(1.0, a.area*0.015) AND ABS(a.price-b.price)<=GREATEST(a.price,b.price)*0.05 AND (a.floor IS NULL OR b.floor IS NULL OR a.floor=b.floor)`;

// Шинэ зар оруулахын өмнө: өөр эх сурвалжид ижил объект байвал түүний бүлэг
async function findGroup(db, l) {
  if (!l.area || !l.price || !l.district) return null;
  const cand = await db.all(`SELECT b.dedup_group, b.title, b.area, b.price FROM (SELECT ?::text source, ?::text deal_type, ?::text category, ?::text district, ?::int rooms, ?::float area, ?::float price, ?::int floor) a
    JOIN market_listings b ON ${BASE} WHERE b.collected_at IS NOT NULL AND b.active=1 AND b.dedup_group IS NOT NULL LIMIT 20`,
  l.source, l.deal_type, l.category || 'apartment', l.district, l.rooms || 0, l.area, l.price, Number.isFinite(l.floor) ? l.floor : null);
  const hit = cand.find((b) => isDup({ title: l.title, area: l.area, price: l.price }, b));
  return hit ? hit.dedup_group : null;
}

// Бүх идэвхтэй зарыг (сүүлийн 180 хоног) дахин бүлэглэнэ — union-find, бүлгийн нэр = хамгийн эртний зарын бүлэг
async function regroup(db, log = () => {}) {
  const pairs = await db.all(`SELECT a.id ai, b.id bi, a.dedup_group ga, b.dedup_group gb, a.title ta, b.title tb, a.area aa, b.area ba, a.price pa, b.price pb FROM market_listings a JOIN market_listings b ON a.id<b.id AND ${BASE}
    WHERE a.collected_at IS NOT NULL AND b.collected_at IS NOT NULL AND a.active=1 AND b.active=1 AND a.area>0 AND a.price>0
      AND COALESCE(a.last_seen, NOW()) > NOW() - INTERVAL '180 days' AND COALESCE(b.last_seen, NOW()) > NOW() - INTERVAL '180 days' LIMIT 50000`);
  const par = new Map(); const grp = new Map();
  const find = (x) => { while (par.get(x) !== x) { par.set(x, par.get(par.get(x))); x = par.get(x); } return x; };
  const add = (x, g) => { if (!par.has(x)) { par.set(x, x); grp.set(x, g); } };
  let n = 0;
  for (const p of pairs) {
    if (!isDup({ title: p.ta, area: p.aa, price: p.pa }, { title: p.tb, area: p.ba, price: p.pb })) continue;
    add(p.ai, p.ga); add(p.bi, p.gb); const ra = find(p.ai), rb = find(p.bi); if (ra !== rb) { if (ra < rb) par.set(rb, ra); else par.set(ra, rb); } n++;
  }
  const byRoot = new Map(); for (const id of par.keys()) { const r = find(id); if (!byRoot.has(r)) byRoot.set(r, []); byRoot.get(r).push(id); }
  let changed = 0;
  for (const [root, ids] of byRoot) {
    const g = grp.get(root) || 'g' + root;
    const r = await db.run(`UPDATE market_listings SET dedup_group=? WHERE id = ANY(?::int[]) AND dedup_group IS DISTINCT FROM ?`, g, ids, g); changed += r.changes;
  }
  log(`[давхардал] ${pairs.length} нэр дэвшигч хос → ${n} давхардал, ${byRoot.size} бүлэг, ${changed} зар шинэчлэгдэв`);
  return { candidates: pairs.length, dups: n, groups: byRoot.size, changed };
}

function schedule(db, log = console.log) {
  const tick = () => regroup(db, log).catch((e) => log('[давхардал] алдаа: ' + e.message));
  setTimeout(tick, 2 * 60e3).unref(); setInterval(tick, 12 * 3600e3).unref();
}

module.exports = { findGroup, regroup, schedule, isDup, tokens };
