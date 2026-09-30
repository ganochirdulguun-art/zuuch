// «Зууч» — орчны цэгийн 3 судалгааг (OSM Overpass, Overture Places/Buildings/Base, барилгын footprint) нэгтгэж давхардлыг арилгана.
// Google өгөгдөл ашиглаагүй. Гаралт: poi_merged.json (цэг бүрт бүх эх сурвалжийн provenance), poi_merged.meta.json.
// Дүрэм: ижил байгууллага = ижил OSM/Overture id, эсвэл хэвийн болгосон нэр төстэй (дугаар заавал таарна) 120 м дотор,
// эсвэл ижил ангилал 25 м дотор (нэг нь нэргүй/ерөнхий нэртэй эсвэл нэр төстэй). Геометр/нэр — OSM давуу.
const fs = require('fs'); const path = require('path');
// «Зууч» хотын хавтан сан: хэрэглээ — node poi_merge_city.js <raw_dir>  (merge_pois.js-аас, хотын хэмжээнд)
const ex = require(path.join(__dirname, '..', '..', 'exterior.js'));
const D = process.argv[2];
const LAT0 = 47.9187, LNG0 = 106.9176; const KX = Math.cos((LAT0 * Math.PI) / 180) * 111320, KZ = 110540; // хотын төв (зөвхөн эрэмбэлэх зайд)
const XZ = (lat, lng) => [(lng - LNG0) * KX, (LAT0 - lat) * KZ];
const rd = (f) => JSON.parse(fs.readFileSync(path.join(D, f), 'utf8'));
const osm = rd('poi_osm.json'), ov = rd('poi_overture.json'), bld = fs.existsSync(path.join(D, 'poi_bld.json')) ? rd('poi_bld.json') : []; const osmMeta = rd('poi_osm.meta.json');
const LATIN = /^[\x00-\x7F’‘`´–—]*$/;
const idOsm = (s) => { s = String(s || ''); let m = s.match(/^(node|way|relation)\/(\d+)/); if (m) return `osm:${m[1]}/${m[2]}`; m = s.match(/^([nwr])(\d+)/); return m ? `osm:${{ n: 'node', w: 'way', r: 'relation' }[m[1]]}/${m[2]}` : null; };
const CYRX = /[А-Яа-яӨөҮүЁё]/;
// Дэлгэцийн нэр: хоёр хэлтэй Overture нэрээс кирилл хэсгийг үлдээнэ («Скай эмнэлэг / SKY Hospital» → «Скай эмнэлэг», «Содон Ухаан Сургууль Sodon Ukhaan School» → «Содон Ухаан Сургууль»)
// Латин хэсгийг зөвхөн ОРЧУУЛГА/ГАЛИГЛАЛ бол хасна (brand биш: «Eco Mart - Будааны төрөлжсөн дэлгүүр» хэвээр), кирилл хэсэг нь ерөнхий бол («Шүдний эмнэлэг») хасахгүй
const EN_GEN = /\b(hospital|clinic|school|pharmacy|dental|cent(er|re)|university|college|store|shop|fitness|gym|kindergarten|secondary|elementary|branch|med(ical)?|emneleg|surguuli|tsetserleg)\b/i;
const DIST_MN = { bgd: 'БГД', chd: 'ЧД', sbd: 'СБД', hud: 'ХУД', bzd: 'БЗД', shd: 'СХД' };
const cleanName = (n) => {
  const n0 = String(n || '').replace(/\s+/g, ' ').trim();
  const kh = n0.match(/^(BGD|ChD|CHD|SBD|HUD|BZD|SHD)?[,\s]*(?:khoroo|horoo)\s*(\d+)$/i) || n0.match(/^(BGD|ChD|CHD|SBD|HUD|BZD|SHD)?[,\s]*(\d+)\s*(?:-?r|th)?\s*(?:khoroo|horoo)$/i);
  if (kh) return `${kh[1] ? DIST_MN[kh[1].toLowerCase()] + ', ' : ''}${kh[2]}-р хороо`; // «BGD, Khoroo 14» → «БГД, 14-р хороо»
  if (!CYRX.test(n0)) return n0;
  const isTr = (lat, cyr) => EN_GEN.test(lat) || ex.nameSim(ex.normName(lat), ex.normName(cyr), false);
  let parts = n0.split(/\s*[/\\]\s*|\s+[-–—]\s+/).map((x) => x.trim()).filter(Boolean);
  const cyr = parts.filter((x) => CYRX.test(x)).join(' ');
  if (parts.length > 1 && cyr && !ex.genericName(ex.normName(cyr))) parts = parts.filter((x) => CYRX.test(x) || !isTr(x, cyr));
  let out = parts.join(' - ');
  const m = out.match(/^(.*[А-Яа-яӨөҮүЁё][^A-Za-z]*?)\s+([A-Za-z][A-Za-z0-9 '&.,()-]*)$/);
  if (m && m[2].trim().split(/\s+/).length >= 2 && !ex.genericName(ex.normName(m[1])) && isTr(m[2], m[1])) out = m[1].trim();
  return out.replace(/[\s,.\-–—/\\]+$/, '').trim() || n0;
};
const isAnnex = (n) => /заал/i.test(n || '') && /сургуул/i.test(n || ''); // сургуулийн биеийн тамирын заал = сургуулийн хэсэг
const NMX = { // нэрээр нотлох (Overture Places-ийн taxonomy алдаатай: 133-р цэцэрлэг = childrens_clothing_store г.м.)
  kinder: /цэцэрлэг(?!т)|kindergarten|preschool/i, school: /сургууль|school|гимнази/i, college: /их сургууль|дээд сургууль|коллеж|институт|академи|university|college|institute/i,
  health: /эмнэлэг|клиник|ӨЭМТ|өрхийн|эрүүл мэндийн төв|hospital|clinic|dental|dent|шүд|med/i, pharmacy: /эмийн сан|pharm|аптек|emiin san/i,
  bank: /банк|bank/i, gov: /хороо(?!лол)|khoroo|horoo|цагдаа|police/i, mall: /худалдааны төв|их дэлгүүр|плаза|plaza|зах|mall|department|center|төв/i,
  grocery: /хүнс|дэлгүүр|маркет|market|mart|супер|super|foods?/i, sport: /gym|фитнес|фитнэс|fitness|спорт|sport|заал|клуб|club|taekwondo|тэквондо|бокс|box|skate|tennis|volley|волейбол/i,
  playground: /тоглоом|playground/i, park: /парк|park|цэцэрлэгт хүрээлэн/i,
};
const OV_DENY = new Set(['beauty_salon', 'massage_therapy', 'laboratory_testing', 'media_service', 'professional_service', 'real_estate_service', 'party_and_event_planning', 'food_delivery_service', 'professional_sport_team', 'sport_league', 'clothing_store', 'womens_clothing_store', 'childrens_clothing_store', 'computer_store', 'home_improvement_store', 'historic_site']);
const OV_STRONG_MALL = new Set(['shopping_mall', 'department_store', 'shopping_center']);
const OSM_MAP = { kinder: 'kinder', school: 'school', college: 'college', health: 'health', pharmacy: 'pharmacy', grocery: 'grocery', mall: 'mall', bus: 'bus', park: 'park', playground: 'playground', sport: 'sport', bank: 'bank', post: 'post', gov: 'gov', police: 'gov', parking: 'parking' };
const OV_MAP = { grocery: 'grocery', health: 'health', dental: 'health', gov: 'gov', park: 'park', playground: 'playground', sport: 'sport', kinder: 'kinder', mall: 'mall', bank: 'bank', bus: 'bus', school: 'school', college: 'college', pharmacy: 'pharmacy' };
const BLD_MAP = { kinder: 'kinder', school: 'school', college: 'college', health: 'health', pharmacy: 'pharmacy', grocery: 'grocery', mall: 'mall', bus: 'bus', sport: 'sport', bank: 'bank', civic: 'gov' };
const nameCat = (name) => { const c = ex.poiCat({ name, building: 'yes' }); return ['mall', 'grocery', 'gov', 'health', 'post', 'bank', 'pharmacy', 'kinder', 'school', 'college'].includes(c) ? c : null; };
const recs = []; const drop = {}; const dr = (why) => { drop[why] = (drop[why] || 0) + 1; };
const push = (r) => { const [x, z] = XZ(r.lat, r.lng); r.x = x; r.z = z; r.d0 = Math.hypot(x, z); r.ids = new Set([...r.ids].filter(Boolean)); recs.push(r); };

// 1) OpenStreetMap (Overpass) — бүх таг хадгалагдсан тул exterior.js-ийн poiCat-аар дахин ангилна (генератортой ижил дүрэм), үгүй бол судалгааны cat_guess
for (const p of osm) {
  const t = { ...(p.tags || {}) }; if (p.name && !t.name) t.name = p.name; const name = ex.poiName(t);
  let cat = ex.poiCat(t); if (!cat) cat = OSM_MAP[p.cat_guess] || null; // poiCat нэрээр ангилдаг (зөрчилтэй shop/amenity тагтай бол үгүй: «The Bank» = shop=clothes)
  cat = ex.poiRefine(cat, name, t); if (!cat) { dr('osm:ангилалгүй/хассан'); continue; }
  const ids = new Set([idOsm(p.id)]); if (p.group) ids.add('osmgrp:' + p.group);
  push({ src: 'osm', tier: name ? 0 : 2, gtier: String(p.id).startsWith('node') ? 0 : 1, cat, name, lat: p.lat, lng: p.lng, ids, sub: ex.poiSub(cat, name, t), annex: isAnnex(name), geomId: idOsm(p.id),
    prov: [{ dataset: 'OpenStreetMap', license: 'ODbL-1.0', record_id: p.id, via: `Overpass API (overpass-api.de), osm_base ${p.osm_base || osmMeta.osm_base}` }] });
}
// 2) Барилгын footprint судалгаа (OSM барилга + Overture Buildings) — нэргүй «generic» нэр = нэргүй
for (const p of bld) {
  let cat = BLD_MAP[p.cat_guess] || (['shop', 'food', 'other', 'office', 'service'].includes(p.cat_guess) ? nameCat(p.name) : null);
  const name = p.name_src === 'generic' || p.unnamed ? '' : String(p.name || '').replace(/\s+/g, ' ').trim();
  const t = { ...(p.tags || {}), building: (p.tags && p.tags.building) || p.class || 'yes' }; if (p.cat_guess === 'civic') t.strong = !!name; // civic барилга (хороо, цагдаа) — OSM building=civic/government
  cat = ex.poiRefine(cat, name, t); if (!cat) { dr('bld:ангилалгүй/хассан'); continue; }
  const ids = new Set([idOsm(p.osm_id), p.overture_id ? 'overture:' + p.overture_id : null, p.facility_key ? 'bldfac:' + p.facility_key : null]);
  const osmB = p.src === 'osm-bld';
  push({ src: p.src, tier: osmB ? 1 : 3, gtier: osmB ? 0 : 2, cat, name, lat: p.lat, lng: p.lng, ids, sub: ex.poiSub(cat, name, t), annex: isAnnex(name), geomId: osmB ? idOsm(p.osm_id) : 'overture:' + p.overture_id,
    prov: (p.provenance || []).map((q) => ({ ...q, note: `footprint centroid (${p.name_src})` })) });
}
// 3) Overture Maps (Places — Meta/Foursquare/…; Buildings/Base — OSM-ээс гаралтай)
for (const p of ov) {
  if (p.geo_quality === 'bad') { dr('overture:geocode fallback цэг (bad)'); continue; }
  const name = String(p.name || '').replace(/\s+/g, ' ').trim(); let cat = OV_MAP[p.cat_guess]; if (!cat) { dr('overture:ангилалгүй'); continue; }
  const pl = p.theme === 'places'; const prim = (p.categories && p.categories.primary) || '';
  if (pl) {
    if (p.trust === 'low') { dr('overture:places trust=low'); continue; }
    if (p.geo_quality === 'shared' && cat !== 'mall') { dr('overture:places олон газар нэг цэгт (shared)'); continue; }
    const nmOk = NMX[p.cat_guess === 'dental' ? 'health' : cat] ? NMX[p.cat_guess === 'dental' ? 'health' : cat].test(name) : false;
    if ((p.confidence || 0) < 0.3 || (!nmOk && (OV_DENY.has(prim) || (p.confidence || 0) < 0.4))) { dr('overture:places taxonomy сул/итгэл бага (<0.3, нэргүй нотолгоо <0.4)'); continue; }
  }
  const t = { building: pl ? '' : 'yes', strong: pl && cat === 'mall' && OV_STRONG_MALL.has(prim) };
  if (!pl && (cat === 'health' || cat === 'kinder' || cat === 'school' || cat === 'college') && !name) t.strong = true;
  cat = ex.poiRefine(cat, name, t); if (!cat) { dr('overture:нэрээр хассан'); continue; }
  const ids = new Set(['overture:' + p.id, ...(p.upstream || []).map((u) => (u.dataset === 'OpenStreetMap' ? idOsm(u.record_id) : null))]);
  push({ src: 'overture:' + (pl ? 'places' : p.theme), tier: pl ? 4 : 3, gtier: pl ? 3 : 2, cat, name, lat: p.lat, lng: p.lng, ids, sub: ex.poiSub(cat, name, { amenity: p.cat_guess === 'dental' ? 'dentist' : '' }), annex: isAnnex(name), geomId: 'overture:' + p.id, conf: p.confidence,
    prov: [{ dataset: `Overture Maps ${pl ? 'Places' : p.theme} ${p.release}`, license: pl ? 'CDLA-Permissive-2.0' : 'ODbL-1.0 (OSM-derived)', record_id: p.id, upstream: p.upstream }] });
}

// 4) Бүлэглэх (эрэмбэ: OSM нэртэй → OSM барилга → OSM нэргүй → Overture барилга/base → Overture places; дотроо гэрээс ойроор)
recs.sort((a, b) => a.tier - b.tier || a.d0 - b.d0);
const groups0 = ex.clusterPois(recs);
// 4б) Дугаартай цэцэрлэг/сургууль: Улаанбаатарт дугаар давтагдахгүй — ижил ангилал + ижил дугаар + ижил төрлийн үг бол зай харгалзахгүй нэг
// (Overture Places-ийн цэг ихэвчлэн 100–500 м зөрдөг: «13 р сургууль», «Нийслэлийн ЕБ-ын 47 дугаар сургууль», «78 сургууль»). Хороо биш (дүүрэг бүрт давтагдана).
const KWR = { kinder: /цэцэрлэг|kindergarten/i, school: /сургууль|school/i };
const CAMPUS_NUM = new Set(['kinder', 'school']);
const numKey = (g) => { const h = g.find((m) => m.name && !m.annex && (m.nk || ex.normName(m.name)).nums && KWR[m.cat] && KWR[m.cat].test(m.name)); if (!h) return null; const N = h.nk || ex.normName(h.name); if (N.nums.includes(',')) return null; return g[0].cat + '#' + N.nums + (/төмөр зам|tumur zam/i.test(h.name) ? '#rail' : ''); }; // Төмөр замын 180-р цэцэрлэг ≠ нийслэлийн 180-р
const byNum = new Map(); const groups = [];
for (const g of groups0) { const k = CAMPUS_NUM.has(g[0].cat) ? numKey(g) : null; if (k && byNum.has(k)) { const t = byNum.get(k); const tOsm = t.some((m) => m.tier <= 2), gOsm = g.some((m) => m.tier <= 2); if (tOsm && gOsm && Math.min(...t.flatMap((a) => g.map((b) => Math.hypot(a.x - b.x, a.z - b.z)))) > 400) { groups.push(g); continue; } t.push(...g); dr('бүлэг: ижил дугаартай цэцэрлэг/сургууль нэгтгэсэн (зай харгалзахгүй)'); continue; } if (k) byNum.set(k, g); groups.push(g); }
for (const g of groups) g.sort((a, b) => a.tier - b.tier || a.d0 - b.d0);
const commonPrefix = (a, b) => { const A = a.split(/\s+/), B = b.split(/\s+/); const o = []; for (let i = 0; i < Math.min(A.length, B.length) && A[i].toLowerCase() === B[i].toLowerCase(); i++) o.push(A[i]); return o.join(' '); };
const out = []; if (process.env.DBG) for (const g of groups) if (g.some((m) => new RegExp(process.env.DBG).test(m.name))) console.log("DBG", g.map((m) => `${m.src}/${m.cat}/${m.sub || ""}/${m.name}/${Math.round(m.d0)}`).join(" ; "));
for (const g of groups) {
  const named0 = g.filter((m) => m.name && !m.annex); // тодорхой нэр («57-р цэцэрлэг», «Бөмбөөхөн») ерөнхий нэрээс («Цэцэрлэг») түрүүлнэ
  const named = [...named0.filter((m) => !ex.genericName(m.nk || ex.normName(m.name))), ...named0.filter((m) => ex.genericName(m.nk || ex.normName(m.name)))];
  if (g.every((m) => m.annex)) { dr('бүлэг: зөвхөн сургуулийн заал (тусдаа байгууллага биш)'); continue; }
  const vote = {}; for (const m of g) vote[m.cat] = (vote[m.cat] || 0) + (m.tier <= 1 ? 2 : 1); // ангилал: жигнэсэн санал (OSM нэртэй/барилга ×2) — «Supermarket» shop=mall ганц таг < 3 хүнсний
  const cat = Object.keys(vote).sort((a, b) => vote[b] - vote[a] || g.findIndex((m) => m.cat === a) - g.findIndex((m) => m.cat === b))[0];
  const gm = [...g].sort((a, b) => a.gtier - b.gtier || a.d0 - b.d0)[0]; // геометр: OSM цэг/барилга → OSM талбай → Overture; дотроо гэрт хамгийн ойр
  const isO = (m) => m.src === 'osm' || m.src === 'osm-bld'; const spec = named.filter((m) => !ex.genericName(m.nk || ex.normName(m.name)));
  const osmN = spec.filter(isO); const osmNames = [...new Set(osmN.map((m) => m.name))];
  // нэр: OSM тодорхой → бусад тодорхой (Luxdent… > OSM «Шүдний эмнэлэг») → OSM ерөнхий → бусад
  let nameM = osmN[0] || spec[0] || named.find(isO) || named[0] || null; let name = nameM ? nameM.name : '';
  for (const m of osmN) { const A = ex.normName(name), B = m.nk || ex.normName(m.name); if (B.dist.length && B.dist.length < A.dist.length && B.nums === A.nums && B.dist.every((w) => A.dist.includes(w))) { name = m.name; nameM = m; } } // үндсэн нэр: «…үндэсний төв» < «…төвийн захиргаа», «Хаан банк» < «…Баянгол салбар»
  if (osmNames.length >= 2) { const cp = commonPrefix(osmNames[0], osmNames[1]).replace(/[\s,.-]+$/, ''); if (cp.split(/\s+/).length >= 2 && /сургууль|цэцэрлэг|эмнэлэг|хороо/i.test(cp)) name = cp; } // «28-р сургууль дунд» + «… ахлах» → «28-р сургууль»
  if (name && LATIN.test(name)) { const cyr = named.find((m) => !LATIN.test(m.name)); if (cyr) { name = cyr.name; nameM = cyr; } } // монгол (кирилл) нэр давуу
  name = cleanName(name);
  const subs = g.filter((m) => m.cat === cat).map((m) => m.sub).filter(Boolean); const sub = subs.includes('family') ? 'family' : subs.includes('police') ? 'police' : (nameM && nameM.cat === cat && nameM.sub) || subs[0] || null;
  const srcs = [...new Set(g.map((m) => m.src))]; const hasOsm = srcs.some((s) => s === 'osm' || s === 'osm-bld'), hasOv = srcs.some((s) => /overture/.test(s));
  const prov = []; const pk = new Set(); for (const m of g) for (const q of m.prov) { const k = q.dataset + '|' + q.record_id; if (!pk.has(k)) { pk.add(k); prov.push(q); } }
  const o = { name, cat, mn: ex.CAT[cat].mn, lat: +gm.lat.toFixed(7), lng: +gm.lng.toFixed(7), x: Math.round(gm.x * 10) / 10, z: Math.round(gm.z * 10) / 10, dist_m: Math.round(gm.d0),
    src: hasOsm ? (hasOv ? 'osm+overture' : 'osm') : 'overture', geom: gm.geomId, sources: srcs, names: [...new Set(g.map((m) => m.name).filter(Boolean))], ids: [...new Set(g.flatMap((m) => [...m.ids]))].filter((i) => !/^(osmgrp|bldfac):/.test(i)), members: g.length, provenance: prov };
  if (sub) o.sub = sub;
  // verified: OSM-д бий, эсвэл Overture-ийн 2+ давхарга/эх сурвалж давхцсан, эсвэл Places итгэл ≥ 0.6 — зөвхөн эдгээр рүү «нисэх» (ганц сул Places цэг рүү биш)
  o.verified = hasOsm || new Set(g.map((m) => m.src)).size >= 2 || g.some((m) => (m.conf || 0) >= 0.6);
  out.push(o);
}
const order = Object.keys(ex.CAT); out.sort((a, b) => order.indexOf(a.cat) - order.indexOf(b.cat) || a.dist_m - b.dist_m);
fs.writeFileSync(path.join(D, 'poi_merged.json'), JSON.stringify(out));
const byCat = {}; for (const o of out) { const c = (byCat[o.cat] = byCat[o.cat] || { n: 0, le1500: 0, src: {} }); c.n++; if (o.dist_m <= 1500) c.le1500++; c.src[o.src] = (c.src[o.src] || 0) + 1; }
const meta = { generated_at: new Date().toISOString(), home: { lat: LAT0, lng: LNG0 }, projection: 'x=(lng-lng0)*cos(lat0)*111320, z=(lat0-lat)*110540 (z урагш)', inputs: { 'poi_osm.json': osm.length, 'poi_overture.json': ov.length, 'poi_bld.json': bld.length }, records_used: recs.length, facilities: out.length, dropped: drop, by_cat: byCat,
  sources: ['OpenStreetMap (ODbL-1.0) via Overpass overpass-api.de, osm_base ' + osmMeta.osm_base, 'Overture Maps 2026-09-23.1: Places (CDLA-Permissive-2.0), Buildings/Base (ODbL-1.0, OSM-derived)'], no_google: true };
fs.writeFileSync(path.join(D, 'poi_merged.meta.json'), JSON.stringify(meta, null, 1));
console.log('records', recs.length, '→ facilities', out.length); console.log(JSON.stringify(Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, v.n])))); console.log('dropped', JSON.stringify(drop));
