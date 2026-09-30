// «Зууч» — Гадаах орчны 3D нислэгийн аялалын өгөгдөл (Ш3д-3)
// Эх сурвалж: OpenStreetMap (© OpenStreetMap contributors, ODbL) — барилга, зам, ногоон байгууламж, үйлчилгээний цэгүүд.
// • Ойрын бүс: бүх барилга/зам/талбай (нарийвчилсан), орчны цэгүүд хүртэлх АЛХАХ маршрут OSM замын сүлжээгээр (Dijkstra).
// • Алс бүс: Баруун 4 зам / хотын төв хүртэлх томоохон барилга, гол зам (хотын дүр төрх) + жолоодох маршрутын геометр (OSM).
// • Хугацаа: Google Routes API (TRAFFIC_AWARE_OPTIMAL, ажлын өдөр цаг тус бүр) — зөвхөн тоо; маршрутын шугам OSM-ынх.
const commute = require('./commute');

const ENDPOINTS = ['https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const UA = 'ZuuchBot/1.0 (+https://zuuch-production.up.railway.app/bot; smartzuuch.mn@gmail.com)';
const WEST4 = { id: 'west4', name: 'Баруун 4 зам', lat: 47.91528, lng: 106.8952 };
const CENTER = { id: 'center', name: 'Хотын төв (Сүхбаатарын талбай)', lat: 47.9187, lng: 106.9176 };
const WALK_MS = 1.25; // алхах хурд 4.5 км/ц

async function overpass(q, timeoutMs = 170000) {
  let lastErr;
  for (const ep of ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(ep, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(timeoutMs) });
        const txt = await r.text();
        if (r.ok && txt.trim().startsWith('{')) return JSON.parse(txt);
        lastErr = new Error(`Overpass ${r.status} (${ep.split('/')[2]}): ${txt.slice(0, 100)}`);
      } catch (e) { lastErr = e; }
      await new Promise((res) => setTimeout(res, 2000));
    }
  }
  throw lastErr;
}

// ---------- Геометр ----------
const r1 = (v) => Math.round(v * 10) / 10;
function projector(lat0, lng0) {
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111320, kz = 110540;
  return { f: (lat, lng) => [(lng - lng0) * kx, (lat0 - lat) * kz], inv: (x, z) => ({ lat: lat0 - z / kz, lng: lng0 + x / kx }) };
}
function simplify(pts, tol) { // Douglas–Peucker
  if (pts.length <= 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); const [ax, az] = pts[a], [bx, bz] = pts[b]; const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1e-9;
    let best = -1, bi = -1; const closed = Math.hypot(dx, dz) < 1e-6;
    for (let i = a + 1; i < b; i++) { const d = closed ? Math.hypot(pts[i][0] - ax, pts[i][1] - az) : Math.abs(dx * (az - pts[i][1]) - (ax - pts[i][0]) * dz) / L; if (d > best) { best = d; bi = i; } }
    if (best > tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const area = (p) => { let s = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]); return s / 2; };
const centroid = (p) => { let x = 0, z = 0; for (const q of p) { x += q[0]; z += q[1]; } return [x / p.length, z / p.length]; };
function inPoly(x, z, p) { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { if (((p[i][1] > z) !== (p[j][1] > z)) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c; } return c; }
function segDist(px, pz, ax, az, bx, bz) { const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9; const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2)); const qx = ax + t * dx, qz = az + t * dz; return [Math.hypot(px - qx, pz - qz), qx, qz]; }
function hull(p) { // гүдгэр бүрхүүл (Andrew-ийн монотон гинж)
  const s = p.map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]); if (s.length < 3) return s;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); const lo = [], up = [];
  for (const q of s) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = s.length - 1; i >= 0; i--) { const q = s[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  lo.pop(); up.pop(); return lo.concat(up);
}
// Урт/өргөн: хамгийн бага талбайтай хүрээлэгч тэгш өнцөгт (гүдгэр бүрхүүл + rotating calipers) — оройн тооноос хамаардаггүй
// (оройн PCA шаталсан ML контурт тэнхлэгээ хазайлгадаг байсан). Буцаах: [L, W, θ] — θ = урт тэнхлэгийн чиг, [0, π)
function dims(p) {
  const h = hull(p); let best = null;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l < 1e-6) continue;
    const ux = (b[0] - a[0]) / l, uz = (b[1] - a[1]) / l; let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
    for (const [x, z] of h) { const s = x * ux + z * uz, t = -x * uz + z * ux; if (s < s0) s0 = s; if (s > s1) s1 = s; if (t < t0) t0 = t; if (t > t1) t1 = t; }
    const e1 = s1 - s0, e2 = t1 - t0; if (!best || e1 * e2 < best[0]) best = [e1 * e2, e1, e2, Math.atan2(uz, ux)];
  }
  if (!best) return [0, 0, 0];
  const [, e1, e2, th] = best; const t = e1 >= e2 ? th : th + Math.PI / 2;
  return [Math.max(e1, e2), Math.min(e1, e2), ((t % Math.PI) + Math.PI) % Math.PI];
}
const flat = (pts) => pts.flatMap(([x, z]) => [r1(x), r1(z)]);

// ---------- Барилгын төрөл ба давхар (OSM-д давхар ховор бичигддэг) ----------
// Зарчим: бодит байдлыг гажуудуулахгүй — эргэлзээтэй бол БОЛГООМЖТОЙ (нам) утга өгч, «таамаг» (e:1) гэж тэмдэглэнэ.
// kn=1 МЭДЭГДЭХ: building:levels / height таг, Overture num_floors, оршин суугчийн засвар, гэр, эргэлзээгүй жижиг төрөл (саравч/гараж/ТҮЦ → 1).
// kn=0 ТААМАГ: төрөл/нэр/хэлбэрийн урьдчилсан утга; угсармал блок (slab) → орон сууцны нотолгоо + мэдэгдэх хөршөөр generate() дотор;
// алс бүсийн том таггүй барилга → ойр орчны таглагдсан барилгын доод гуравны нэгээр. Таамаг ≤ 9 давхар.
const FLH = 3; // нэг давхрын өндөр, м
const EST_MAX = 9; // таамаг давхрын дээд хязгаар
const SMALL_B = new Set(['shed', 'garage', 'garages', 'barn', 'roof', 'kiosk', 'container', 'carport', 'hangar', 'shelter', 'toilets', 'transformer_tower', 'service', 'greenhouse', 'sty', 'stable', 'cowshed', 'gatehouse', 'guardhouse']);
const HOUSE_B = new Set(['house', 'detached', 'hut', 'cabin', 'bungalow', 'semidetached_house', 'terrace']);
const RES_B = new Set(['apartments', 'residential', 'dormitory']);
const COM_B = new Set(['commercial', 'retail', 'office', 'supermarket', 'mall', 'hotel', 'public', 'civic', 'government', 'market', 'shop', 'shopping', 'cafe', 'museum', 'temple', 'church', 'mosque', 'cathedral', 'chapel', 'monastery', 'religious', 'train_station', 'transportation', 'fire_station', 'bank', 'parking', 'theatre', 'cinema', 'library']);
const IND_B = new Set(['industrial', 'warehouse', 'factory', 'manufacture']);
const RE_KINDER = /цэцэрлэг|kindergarten|детский сад/i;
const RE_UNIV = /их сургууль|дээд сургууль|университет|институт|коллеж|академи|university|college|institute|academy/i;
const RE_GYM = /заал|спорт|gym|фитнес|fitness|бассейн/i;
const RE_SCHOOL = /сургууль|school|лицей|гимнази/i;
const RE_HEALTH = /эмнэлэг|hospital|clinic|клиник|амбулатори|поликлиник|төрөх/i;
const RE_COM = /зах|дэлгүүр|худалдаа|маркет|market|store|плаза|plaza|center|centre|центр|төв|телевиз|радио|театр|кино|cinema|оффис|office|банк|bank|зочид буудал|hotel|ресторан|restaurant|mall|молл|үйлчилгээний|шатахуун|газар|яам|захиргаа|ордон|музей|сүм|хийд|цагдаа|шүүх|шуудан|номын сан/i;
const RE_RESNAME = /байр|хотхон|орон сууц|residence|apartment/i; // орон сууцны нэр → нэрээр худалдааны гэж ангилахгүй
const RE_GARAGE = /гараж|граж|garage/i;
const RE_UTIL = /ЦТП|дулааны төв|дулааны станц|подстанц|бойлер|насос|трансформатор/i; // инженерийн байгууламж (дулааны төв г.м.) → үйлдвэр/агуулахын нам утга
// Ангилал: ger | shed | house | apt | kinder | univ | gym | school | health | ind | com | bld (таггүй / yes / ML)
function category(t) {
  const b = t.building || 'yes', am = t.amenity || '', nm = String(t.name || ''), sub = t._sub || '', le = t.leisure || '';
  const byName = nm && !RE_RESNAME.test(nm);
  if (b === 'ger' || b === 'yurt') return 'ger';
  if (SMALL_B.has(b) || am === 'toilets' || am === 'shelter') return 'shed';
  if (HOUSE_B.has(b)) return 'house';
  if (RES_B.has(b)) return 'apt'; // орон сууцны таг нэр/amenity-ээс давуу
  if (b === 'kindergarten' || am === 'kindergarten' || (byName && RE_KINDER.test(nm))) return 'kinder';
  if (['university', 'college'].includes(b) || ['university', 'college'].includes(am) || (byName && RE_UNIV.test(nm))) return GENERAL_ED.test(nm) && !HIGHER_ED.test(nm) ? 'school' : 'univ';
  if (['sports_hall', 'sports_centre', 'stadium', 'grandstand'].includes(b) || ['sports_centre', 'fitness_centre', 'sports_hall'].includes(le) || (byName && RE_GYM.test(nm))) return 'gym';
  if (b === 'school' || am === 'school' || sub === 'education' || (byName && RE_SCHOOL.test(nm))) return 'school';
  if (['hospital', 'clinic'].includes(b) || ['hospital', 'clinic', 'doctors', 'dentist'].includes(am) || sub === 'medical' || (byName && RE_HEALTH.test(nm))) return 'health';
  if (IND_B.has(b) || sub === 'industrial' || (byName && RE_UTIL.test(nm))) return 'ind';
  if (COM_B.has(b) || am || t.shop || ['commercial', 'entertainment', 'civic', 'religious', 'transportation'].includes(sub) || (byName && RE_COM.test(nm))) return 'com';
  return 'bld';
}
const KIND = { ger: 'ger', shed: 'shed', house: 'house', apt: 'apt', kinder: 'edu', univ: 'edu', school: 'edu', health: 'com', ind: 'com', com: 'com', bld: 'bld' };
// Угсармал (бичил хорооллын) блокийн хэлбэр: дундаж гүн D = A/L 10–16.5 м, урт ≥ 36 м (хамгийн бага тэгш өнцөгтөөр), сунасан (L/W ≥ 2),
// хүрээлэгч тэгш өнцөгт гүнээсээ хэт өргөн биш (W ≤ 2.2·D — Г/П хэлбэр, муруй контурыг хасна)
const slabShape = (q) => q.L >= 36 && q.D >= 10 && q.D <= 16.5 && q.L / Math.max(q.W, 1) >= 2 && q.W <= 2.2 * q.D;
// q: { t, A, L, W, D, src } → { k, lv, kn, cat, rule, slab }
function classify(q) {
  const t = q.t, A = q.A, b = t.building || 'yes';
  const lvTag = parseFloat(t['building:levels']); const hTag = parseFloat(String(t.height || '').replace(/[^0-9.]/g, ''));
  const cat = category(t); const k = KIND[cat] || 'bld';
  if (Number.isFinite(lvTag) && lvTag > 0) return { k, cat, lv: Math.min(60, Math.round(lvTag)), kn: 1, tg: 1, rule: 'таг: давхар' };
  if (Number.isFinite(hTag) && hTag > 2) return { k, cat, lv: Math.max(1, Math.round(hTag / FLH)), kn: 1, tg: 1, rule: 'таг: өндөр' };
  if (cat === 'ger') return { k, cat, lv: 1, kn: 1, rule: 'гэр' };
  if (cat === 'shed') return { k, cat, lv: 1, kn: b === 'service' && A >= 200 ? 0 : 1, rule: 'жижиг төрөл (' + b + ')' };
  const pr = (lv, rule) => ({ k, cat, lv, kn: 0, rule });
  switch (cat) {
    case 'kinder': return pr(A > 2500 ? 3 : 2, 'цэцэрлэг');
    case 'univ': return pr(A < 300 ? 2 : A < 3000 ? 3 : 4, 'их/дээд сургууль'); // таглагдсан 13: медиан 3
    case 'gym': return pr(2, 'заал/спорт');
    case 'school': return pr(A < 300 ? 2 : A > 1500 ? 4 : 3, 'сургууль');
    case 'health': return pr(A < 800 ? 2 : A < 2500 ? 3 : 4, 'эмнэлэг'); // өмнөх хувилбарын утгаас (com: > 800 м² → 3) өсгөхгүй — таглагдсан эмнэлэг цөөн (алс бүсэд 5)
    case 'ind': return pr(A < 300 ? 1 : 2, 'үйлдвэр/агуулах');
    case 'com': return pr(A < 300 ? 1 : A < 1500 ? 2 : A < 4000 ? 3 : 4, 'худалдаа/олон нийт');
    case 'house': return pr(A < 130 ? 1 : 2, 'house');
    default:
  }
  // Угсармал: давхрыг generate() дотор (мэдэгдэх хөрш, алга бол 5). Таггүй/ML контур бол зөвхөн ОРОН СУУЦНЫ НОТОЛГОО байвал (generate() шалгана),
  // үгүй бол alt (таггүй барилгын утга) хэвээр — гэр хороолол/авто баазын дундах сунасан хайрцаг 5 давхар болохгүй.
  const slabOk = (RES_B.has(b) || b === 'yes' || q.src === 'ml') && slabShape(q);
  if (slabOk) return { ...pr(5, 'угсармал'), slab: 1, slabRes: RES_B.has(b) || RE_RESNAME.test(String(t.name || '')) ? 1 : 0, alt: plainPrior(q) };
  if (cat === 'apt') return pr(A < 150 ? 2 : 5, 'apartments'); // таглагдсан apartments < 300 м²: 24-өөс 17 нь ≥ 5 давхар (нэг орцтой цамхаг) — 2 гэвэл хэт бага
  const pp = plainPrior(q); return pr(pp.lv, pp.rule);
}
// Таггүй (yes/ML) барилгын болгоомжтой урьдчилсан утга
function plainPrior(q) {
  if (RE_GARAGE.test(String(q.t.name || ''))) return { lv: 1, rule: 'гаражийн нэр' };
  if (q.D < 9 && q.L / Math.max(q.W, 1) > 3) return { lv: 1, rule: 'нарийн эгнээ (гараж/лангуу)' }; // дундаж гүн < 9 м, сунасан → гараж/лангууны эгнээ
  return { lv: q.A < 150 ? 1 : 2, rule: q.L / Math.max(q.W, 1) < 1.8 ? 'таггүй бөөрөнхий' : 'таггүй сунасан' };
}

// ---------- Орчны цэгийн ангилал ----------
const HIGHER_ED = /(дээд сургууль|их сургууль|институт|коллеж|university|college|institute)/i;
// OSM-д «college» гэж тэмдэглэсэн ч нэрээрээ ерөнхий боловсролын сургууль (жишээ: «Хүрээ дунд сургууль»)
const GENERAL_ED = /(дунд сургууль|бага сургууль|ерөнхий боловсрол|ЕБС|цогцолбор сургууль|secondary|high school|elementary)/i;
// Цэгийн ангилалд (барилгын category()-д нөлөөлөхгүйгээр) өргөтгөсөн хувилбар
const POI_HIGHER = /(дээд сургууль|их сургууль|институт|коллеж|академи|university|college|institute|academy)/i;
const POI_GENERAL = /(дунд сургууль|бага сургууль|ахлах сургууль|ерөнхий боловсрол|ЕБС|цогцолбор сургууль|secondary|high school|elementary)/i;
// OSM-д олон цэцэрлэг/сургууль/хороо зөвхөн НЭРТЭЙ БАРИЛГА (building=yes/school/kindergarten, amenity таггүй) — amenity-гоор л хайвал
// орхигдоно (2026-09-30: 15, 30-р цэцэрлэг, 28, 40-р сургууль гэрээс 410 м дотор байсан ч аялалд ороогүй). Тиймээс таг + барилгын таг + нэрээр.
const LATIN = /^[\x00-\x7F’‘`´–—]*$/;
// Монгол интерфэйст: name нь латин, name:mn нь кирилл бол name:mn («Bichil Manal» → «Бичилманал-ӨЭМТ»)
const poiName = (t) => { const n = String(t.name || '').replace(/\s+/g, ' ').trim(), mn = String(t['name:mn'] || '').replace(/\s+/g, ' ').trim(); return (mn && (!n || (LATIN.test(n) && !LATIN.test(mn))) ? mn : n || mn).slice(0, 60); };
const NM = { // нэрээр ангилах
  kinder: /цэцэрлэг(?!т)|kindergarten|детский сад/i,
  school: /сургууль|school|лицей|гимнази/i,
  health: /эмнэлэг|эмнэлг|клиник|поликлиник|ӨЭМТ|өрхийн|эрүүл мэндийн төв|төрөх|hospital|clinic|dental|шүдний/i,
  pharmacy: /эмийн сан|pharm|аптек/i,
  bank: /банк|bank/i,
  post: /шуудан|post office/i,
  gov: /хороо(?!лол)|khoroo|horoo|цагдаа|police|засаг дарга|нийгмийн даатгал|татварын|иргэний бүртгэл|бүртгэлийн|халамж|хөдөлмөр|төрийн үйлчилгээ|онцгой байдал|гал команд/i,
  mall: /худалдаа(ны)?,? ?(үйлчилгээний )?төв|их дэлгүүр|их дэлүүр|плаза|plaza|(^|[\s"«])зах($|[\s"»])|market(?!.*mini)|молл|(^|\s)mall($|\s)|megastore|department store|shopping|центр|(^|\s)cent(er|re)($|\s)|(^|\s)төв$/i,
};
const NOT = { // нэрээр хасах (ангиллын таг байсан ч): лаборатори, ББСБ, сургалтын төв, биллиард, ресторан г.м.
  health: /лаборатори|laborator|бариа|массаж|massage|гоо сайхан|тураах|салон|(^|\s)spa($|\s)|мал эмнэлэг|малын|амьтны|(^|\s)vet|эмийн сан|pharm|аптек|тоног төхөөрөмж|сургалт|халдварын сэргийлэлт|хяналт/i,
  bank: /банк бус|ББСБ|финанс|financ|кредит|credit|ХЗХ|хадгаламж зээлийн|(^|\s)ATM($|\s)|АТМ|даатгал|ломбард/i,
  school: /сургалтын|сургалт|авто сургууль|жолооч|бүжг|dance|ballet|балет|art school|хөгжим|music|хэлний|language|educat|organization|холбоо|байгууллага|спорт/i,
  college: /сургалтын төв|тэнхим|практик сургалт/i,
  sport: /биллиард|billiard|караоке|karaoke|компьютер|тоглоомын газар|бүжиг|бүжг|dance|ballet|балет|тураах|гоо сайхан|салон/i,
  mall: /ресторан|restaurant|шашлык|shashlik|кафе|(^|\s)cafe|паб|(^|\s)pub($|\s)|караоке|karaoke|lounge|зочид буудал|hotel|сэлбэг|(^|\s)auto($|\s)|авто|ХХК|LLC|AVON|соёлын|ордон|palace|палас|спорт|сургалтын|эрүүл мэнд|эмнэлэг|эмнэлг|шүдний|оношилгоо/i,
  grocery: /барилг|barilga|гутал|гутл|хувцас|гар утас|электрон|сэлбэг|тавилг|цэцгийн|номын|бичиг хэрэг|гоо сайхан|косметик|эмийн сан|оёдол|хими цэвэрлэгээ|үсчин|салон|ресторан|кафе|паб|билет|касс|(^|\s)pc($|\s)/i,
  gov: /нотариат|notary|(^|\s)сан$|чөлөөт бүс|зохицуулалтын газар|хяналт хэрэгжүүлэх|ерөнхий зөвлөл|council|суралцахуй/i,
  pharmacy: /малын|(^|\s)vet/i,
  post: /даатгал|insurance|unitel|юнител|mobicom|мобиком|skytel|скайтел|банк|bank/i, // OSM-д post_office гэж алдаатай тэмдэглэсэн оффисууд
};
// t = OSM таг → ангилал (CAT-ийн түлхүүр) эсвэл null
function poiCat(t) {
  const am = t.amenity || '', sh = t.shop || '', le = t.leisure || '', hw = t.highway || '', pt = t.public_transport || '', hc = t.healthcare || '', b = t.building || '', of = t.office || '';
  const nm = poiName(t);
  if (hw === 'bus_stop' || (pt === 'platform' && t.bus !== 'no')) return 'bus';
  if (am === 'kindergarten' || b === 'kindergarten') return 'kinder';
  if (am === 'school' || b === 'school') return POI_HIGHER.test(nm) && !POI_GENERAL.test(nm) ? 'college' : 'school';
  if (['university', 'college'].includes(am) || ['university', 'college'].includes(b)) return POI_GENERAL.test(nm) && !POI_HIGHER.test(nm) ? 'school' : 'college';
  if (['mall', 'department_store'].includes(sh) || am === 'marketplace') return 'mall';
  if (['supermarket', 'convenience', 'greengrocer', 'butcher', 'bakery', 'general', 'food'].includes(sh)) return 'grocery';
  if (am === 'pharmacy' || hc === 'pharmacy') return 'pharmacy';
  if (['hospital', 'clinic', 'doctors', 'dentist'].includes(am) || ['hospital', 'clinic', 'doctor', 'dentist', 'centre'].includes(hc) || ['hospital', 'clinic'].includes(b)) return 'health';
  if (am === 'bank') return 'bank';
  if (am === 'post_office') return 'post';
  if (['police', 'townhall'].includes(am) || of === 'government' || (am === 'community_centre' && NM.gov.test(nm))) return am !== 'police' && NM.health.test(nm) ? 'health' : am !== 'police' && NM.kinder.test(nm) ? 'kinder' : am !== 'police' && NM.school.test(nm) ? 'school' : 'gov';
  if (le === 'playground') return 'playground';
  if (['park', 'garden'].includes(le)) return 'park';
  if (['pitch', 'sports_centre', 'fitness_station', 'fitness_centre', 'sports_hall', 'stadium'].includes(le)) return 'sport';
  if (am === 'parking') return 'parking';
  if (!nm || am || sh || le) return null; // өөр төрлийн тагтай (ресторан, зочид буудал…) → нэрээр ангилахгүй
  if (NM.kinder.test(nm)) return 'kinder';
  if (NM.school.test(nm) || POI_HIGHER.test(nm)) return POI_HIGHER.test(nm) && !POI_GENERAL.test(nm) ? 'college' : 'school';
  if (NM.pharmacy.test(nm)) return 'pharmacy';
  if (NM.health.test(nm)) return 'health';
  if (NM.post.test(nm)) return 'post';
  if (NM.bank.test(nm)) return 'bank';
  if (NM.gov.test(nm)) return 'gov';
  if (b && NM.mall.test(nm)) return 'mall';
  return null;
}
// Нэрээр засах/хасах: cat → cat | null. t: {building, office, amenity, strong} (strong = эх сурвалжийн найдвартай ангилал)
function poiRefine(cat, nm, t = {}) {
  if (!cat) return null; const n = String(nm || '');
  if (cat === 'school' && POI_HIGHER.test(n) && !POI_GENERAL.test(n)) cat = 'college';
  if (cat === 'college' && POI_GENERAL.test(n) && !POI_HIGHER.test(n)) cat = 'school';
  if (cat === 'college' && /эрүүл мэндийн төв/i.test(n)) cat = 'health'; // «МУБИС-Эрүүл мэндийн төв»
  if (cat === 'health' && NM.pharmacy.test(n) && !/эмнэлэг|клиник|clinic|hospital/i.test(n)) cat = 'pharmacy';
  if (cat === 'grocery' && ((/худалдааны төв|их дэлгүүр|плаза|plaza|megastore|(^|\s)төв$/i.test(n) && !/хүнс/i.test(n)) || /(^|\s)зах($|\s)/i.test(n))) cat = 'mall'; // «зурагт зах» shop=supermarket → зах = худалдааны төв
  if (cat === 'mall' && !n) return null; // нэргүй худалдааны барилга ≠ худалдааны төв
  if (NOT[cat] && NOT[cat].test(n)) {
    if (cat === 'health' && /эмнэлэг|клиник|clinic|hospital/i.test(n) && !/мал|амьтны|(^|\s)vet/i.test(n)) return cat;
    if (cat === 'grocery' && /хүнс/i.test(n)) return cat;
    return null;
  }
  // mall: таг л (shop=mall/department_store) бөгөөд нэр нь худалдааны төв биш, бүтэн барилга ч биш → жижиг дэлгүүр (Adidas, CAN DO…)
  if (cat === 'mall' && !NM.mall.test(n) && !t.building && !t.strong) return null;
  if (cat === 'gov' && n && !NM.gov.test(n) && !(t.office === 'government' || ['police', 'townhall'].includes(t.amenity) || t.strong)) return null;
  return cat;
}
// Дэд төрөл (жагсаалтад тайлбар): health → family (ӨЭМТ) | dental | hospital | clinic; gov → khoroo | police | office
function poiSub(cat, nm, t = {}) {
  const n = String(nm || '');
  if (cat === 'health') {
    if (t['healthcare_facility:type'] === 'family_clinic' || /ӨЭМТ|өрхийн|family/i.test(n)) return 'family';
    if (t.amenity === 'dentist' || t.healthcare === 'dentist' || /шүд|dent/i.test(n)) return 'dental';
    if (t.amenity === 'hospital' || t.healthcare === 'hospital' || t.building === 'hospital' || /эмнэлэг|hospital|үндэсний төв/i.test(n)) return 'hospital';
    return 'clinic';
  }
  if (cat === 'gov') return /цагдаа|police/i.test(n) || t.amenity === 'police' ? 'police' : /хороо(?!лол)|khoroo|horoo/i.test(n) ? 'khoroo' : 'office';
  return null;
}

// ---------- Нэг байгууллагыг таних (олон эх сурвалжийн давхардал) ----------
// Нэрийг хэвийн болгох: «-р», «дугаар», «№», том/жижиг үсэг, хоосон зай, цэг таслал хасна; кирилл/латиныг нэг «араг» болгоно
// (Bichil Manal ≈ Бичилманал-ӨЭМТ, 28th school ≈ 28-р сургууль, Moskva Ikh Delguur ≈ Москва их дэлгүүр). Дугаар заавал таарна.
const CYR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'j', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', ө: 'u', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ү: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: 'i', э: 'e', ю: 'yu', я: 'ya' };
const SYN = { school: 'сургууль', schools: 'сургууль', secondary: 'дунд', elementary: 'бага', kindergarten: 'цэцэрлэг', hospital: 'эмнэлэг', clinic: 'эмнэлэг', klinik: 'эмнэлэг', клиник: 'эмнэлэг', поликлиник: 'эмнэлэг', emneleg: 'эмнэлэг', dental: 'шүдний', bank: 'банк', khoroo: 'хороо', horoo: 'хороо', center: 'төв', centre: 'төв', центр: 'төв', tuv: 'төв', moscow: 'москва', state: 'төрийн', pharmacy: 'эмийн сан', university: 'сургууль', college: 'сургууль', institute: 'сургууль', store: 'дэлгүүр', department: 'их', police: 'цагдаа' };
const STEM_RE = /(ийн|ын|ийг|ний|ны|ий|ь)$/;
const STEM_LAT = /(iin|iyn|yn|nii)$/; // латин галиглал: Turiin → Tur (≈ Төрийн → Төр)
const stem = (w) => { const re = /[а-яёөү]/.test(w) ? STEM_RE : STEM_LAT; const s = w.replace(re, ''); return s.length >= 3 ? s : w; };
const skel = (w) => [...w].map((c) => (CYR[c] != null ? CYR[c] : c)).join('').replace(/kh/g, 'h').replace(/zh/g, 'j').replace(/o/g, 'u').replace(/y/g, 'i').replace(/w/g, 'v').replace(/q/g, 'k').replace(/c(?!h)/g, 'k').replace(/(.)\1+/g, '$1');
const wordKey = (w) => (SYN[w] || w).split(' ').map((x) => skel(stem(x)));
// Ерөнхий үг (нэрийн «ялгах» хэсэгт тооцохгүй): ангиллын үг, дүүрэг, салбар, ХХК г.м.
const GEN = new Set('дэлгүүр хүнсний хүнс супермаркет супер маркет минимаркет мини market mini mart minimarket supermarket shop эмнэлэг эмнэлгийн эмийн сан цэцэрлэг сургууль сургуулийн тоглоомын талбай хүүхдийн сагсны сагсний спорт автобусны буудал зогсоол авто үйлчилгээний худалдаа худалдааны төв байр байрны хорооны хороо дүүрэг дүүргийн банк банкны салбар branch the of and ххк llc ltd co mongolia улаанбаатар нийслэлийн нийслэл цаг цагийн шүдний fitness фитнесс фитнэсс gym club клуб цогцолбор complex олон улсын international тусламж эрүүл мэндийн өэмт өрхийн эцэс зам гудамж ба болон их дээд'.split(' ').flatMap(wordKey));
const KW = new Set('сургууль цэцэрлэг хороо эмнэлэг байр эцэс'.split(' ').flatMap(wordKey)); // дугаартай нэрийн төрөл
function normName(s) {
  let t = String(s || '').toLowerCase().replace(/№/g, ' ').replace(/\d{4}[-\s]\d{4}/g, ' ').replace(/(^|\s)24\s*цаг\S*/g, ' ');
  t = t.replace(/(\d+)\s*-?\s*(р|r|th|st|nd|rd|дугаар|дүгээр|дахь|дэх|dugaar)(?![a-zа-яёөү])/g, ' $1 ').replace(/дугаар|дүгээр/g, ' ');
  const nums = new Set(), toks = [];
  for (const w of t.split(/[^\p{L}\p{N}]+/u)) {
    if (!w) continue; const m = w.match(/^(\d+)[a-zа-яёөү]*$/);
    if (m) { if (m[1].length <= 5) nums.add(String(+m[1])); continue; }
    for (const k of wordKey(w)) if (k && !toks.includes(k)) toks.push(k);
  }
  const dist = toks.filter((k) => !GEN.has(k) && k.length >= 2);
  return { nums: [...nums].sort().join(','), toks, dist, joined: toks.join('') };
}
function nameSim(A, B, strictNum) {
  if (A.nums || B.nums) {
    if (A.nums && B.nums) { if (A.nums !== B.nums) return false; if (A.toks.some((w) => KW.has(w) && B.toks.includes(w)) || A.joined === B.joined) return true; } // 28-р сургууль дунд ≈ 28th school
    else if (strictNum) return false; // цэцэрлэг/сургууль/хороо: нэг талд л дугаартай бол нэрээр таних боломжгүй
  }
  const a = A.dist, b = B.dist; if (!a.length || !b.length) return false; // ерөнхий нэр («Хүнсний дэлгүүр») — нэрээр нийлүүлэхгүй
  if (A.joined === B.joined) return true;
  const inter = a.filter((w) => b.includes(w)).length;
  if (inter && inter >= Math.min(a.length, b.length)) return true; // нэг нь нөгөөгийнхөө хэсэг
  if (inter / (a.length + b.length - inter) >= 0.6) return true;
  const ja = a.join(''), jb = b.join(''); return Math.min(ja.length, jb.length) >= 6 && (ja.includes(jb) || jb.includes(ja)); // Бичил манал ≈ Бичилманал
}
const bigramDice = (s, t) => { if (s.length < 2 || t.length < 2) return 0; const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } let c = 0; for (let i = 0; i < t.length - 1; i++) { const g = t.slice(i, i + 2); const k = m.get(g); if (k) { c++; m.set(g, k - 1); } } return (2 * c) / (s.length + t.length - 2); };
const STRICT_NUM = new Set(['kinder', 'school', 'gov']);
const CAMPUS = new Set(['kinder', 'school', 'college']); // нэргүй хавсарга барилга (заал, байр) нэртэй байгууллагадаа нийлнэ
const OBJ_ID = /^(osm|overture):/; // бодит объектын id (osm:way/1, overture:<GERS>); бусад = судалгааны бүлгийн id
const genericName = (N) => !N.dist.length && !N.nums; // нэргүй / зөвхөн ерөнхий үгтэй нэр («Хүнсний дэлгүүр», «Цэцэрлэг»)
// Нэр нийцтэй эсэх (ижил ангилал, d = зай): нэр төстэй (120 м), ижил бүтэн нэр (кампус, 400 м), 25 м дотор ялгах хэсэг төстэй
const ONE_SITE = new Set(['kinder', 'school', 'college', 'health', 'gov', 'park']); // салбар сүлжээгүй төрөл: ижил бүтэн нэр = нэг байгууллага (том кампус)
function nameCompat(A, B, cat, d) {
  if (d <= 120 && nameSim(A, B, STRICT_NUM.has(cat))) return true;
  if (d <= 400 && ONE_SITE.has(cat) && !genericName(A) && A.joined === B.joined && A.nums === B.nums) return true;
  return d <= 25 && bigramDice(A.dist.join(''), B.dist.join('')) >= 0.5;
}
const compatAt = (A, B, cat, d) => (cat === 'bus' ? d <= 250 && nameCompat(A, B, cat, Math.min(d, 120)) : nameCompat(A, B, cat, d)); // автобус: хоёр чигийн ижил нэртэй буудал (≤ 250 м) = нэг
const shareObj = (a, b) => { if (a.ids && b.ids) for (const id of b.ids) if (OBJ_ID.test(id) && a.ids.has(id)) return true; return false; };
// a, b: { cat, x, z, name, nk?, ids: Set } — ижил байгууллага эсэх
function samePoi(a, b) {
  if (shareObj(a, b)) return true; // ижил OSM/Overture объект
  const A = a.nk || (a.nk = normName(a.name)), B = b.nk || (b.nk = normName(b.name));
  if (A.nums && B.nums && A.nums !== B.nums) return false; // өөр дугаартай цэцэрлэг/сургууль/хороо хэзээ ч нийлэхгүй
  if (a.cat !== b.cat) return false;
  if (a.ids && b.ids) for (const id of b.ids) if (a.ids.has(id)) return true; // судалгааны бүлэг (нэг кампус / давхардал)
  const d = Math.hypot(a.x - b.x, a.z - b.z); if (d > 400) return false;
  if (compatAt(A, B, a.cat, d)) return true;
  const gA = genericName(A), gB = genericName(B);
  if (d <= 25 && (gA || gB)) return true; // ижил ангилал 25 м дотор, нэг нь нэргүй/ерөнхий (өөр тодорхой нэртэй бол тусдаа)
  return d <= (a.cat === 'kinder' ? 100 : 150) && CAMPUS.has(a.cat) && gA !== gB; // нэргүй хавсарга → тодорхой нэртэй байгууллага (нэргүй хоорондоо 150 м-ээр гинжлэхгүй)
}
// p (тодорхой нэртэй) бүлэгт зөвхөн нэргүй/ерөнхий гишүүнээр дамжиж орох гэж байгаа бөгөөд бүлэгт өөр тодорхой нэртэй гишүүн байвал — зөрчил
// («нэргүй барилга» дамжсан гинжин хэт нийлэлтээс сэргийлнэ: Бөмбөөхөн ↔ «Цэцэрлэг» ↔ …). Аль нэг тодорхой гишүүнтэй нэрээр нийцвэл зөрчилгүй.
function poiConflict(g, p) {
  if (genericName(p.nk)) return false; if (g.some((m) => shareObj(m, p))) return false;
  let spec = false;
  for (const m of g) { if (m.cat !== p.cat || genericName(m.nk)) continue; spec = true; if (compatAt(m.nk, p.nk, p.cat, Math.hypot(m.x - p.x, m.z - p.z))) return false; }
  return spec;
}
// Бүлгийн төлөөлөгч (өөрийн OSM цэгүүд): нэр — тодорхой нэртэй гишүүн («85-р цэцэрлэг», нэргүй кампусын талбай биш), байрлал — гэрт хамгийн ойр гишүүн (барилга)
function pickRep(g) {
  const nm = g.find((m) => !genericName(m.nk || normName(m.name))) || g.find((m) => m.name) || g[0]; const near = g.reduce((a, b) => (b.d0 < a.d0 ? b : a), g[0]);
  if (nm === near) return nm; const o = { ...nm, x: near.x, z: near.z, d0: near.d0, ids: new Set(g.flatMap((m) => [...(m.ids || [])])) }; if (!o.sub) { const sb = g.find((m) => m.sub); if (sb) o.sub = sb.sub; } return o;
}
// Шуналтай бүлэглэл: list (эрэмбэ = давуу эрэмбэ; {cat,x,z,name,ids:Set}) → [[гишүүд]], эхний гишүүн = төлөөлөгч.
// Шинэ цэг хамгийн ойр тохирох гишүүнтэй бүлэгт орно (бүлгүүдийг хооронд нь нийлүүлэхгүй); ижил бодит объект (OSM/Overture id)-той бүлгүүд л нийлнэ.
function clusterPois(list) {
  const cell = 400, grid = new Map(), key = (i, j) => i * 100003 + j, groups = [];
  for (const p of list) {
    if (!p.nk) p.nk = normName(p.name); const ci = Math.floor(p.x / cell), cj = Math.floor(p.z / cell); let best = null, bd = Infinity;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const g of grid.get(key(ci + di, cj + dj)) || []) {
      let gd = Infinity; for (const m of g) { if (!samePoi(m, p)) continue; const d = Math.hypot(m.x - p.x, m.z - p.z); if (d < gd) gd = d; }
      if (gd < bd && !poiConflict(g, p)) { bd = gd; best = g; }
    }
    if (best) best.push(p); else { best = [p]; groups.push(best); }
    const k = key(ci, cj); if (!grid.has(k)) grid.set(k, []); const L = grid.get(k); if (!L.includes(best)) L.push(best);
  }
  const byId = new Map(), out = []; // ижил OSM/Overture объект алслагдсан (том талбайн төв ≠ барилга) бол ч нийлүүлнэ
  for (const g of groups) {
    let tgt = null; for (const m of g) for (const id of m.ids || []) if (!tgt && OBJ_ID.test(id) && byId.has(id)) tgt = byId.get(id);
    if (tgt) tgt.push(...g); else out.push(g);
    for (const m of g) for (const id of m.ids || []) if (OBJ_ID.test(id) && !byId.has(id)) byId.set(id, tgt || g);
  }
  return out;
}
// Ангилал бүр: reach = алхах сүлжээгээр хүрэх зай (м) — дотор нь БҮГДИЙГ; cap = маршруттай хадгалах тоо (хамгийн ойр, үлдсэн нь poisMore-д маршрутгүй);
// fly = нисэх тоо (хамгийн ойр). Дараалал = нислэгийн дараалал.
const CAT = {
  grocery: { mn: 'Хүнсний дэлгүүр', reach: 1500, cap: 12, fly: 1 }, pharmacy: { mn: 'Эмийн сан', reach: 1500, cap: 12, fly: 1 },
  parking: { mn: 'Авто зогсоол', reach: 600, cap: 4, fly: 1 },
  playground: { mn: 'Хүүхдийн тоглоомын талбай', reach: 1500, cap: 12, fly: 1 }, park: { mn: 'Ногоон байгууламж', reach: 1500, cap: 12, fly: 1 },
  sport: { mn: 'Спорт талбай', reach: 1500, cap: 12, fly: 1 }, bus: { mn: 'Автобусны буудал', reach: 1500, cap: 12, fly: 1 },
  kinder: { mn: 'Цэцэрлэг', reach: 1500, cap: 12, fly: 2 }, school: { mn: 'Ерөнхий боловсролын сургууль', reach: 1500, cap: 12, fly: 2 },
  health: { mn: 'Эмнэлэг', reach: 1500, cap: 12, fly: 1 }, bank: { mn: 'Банк', reach: 1500, cap: 12, fly: 1 },
  post: { mn: 'Шуудан', reach: 1500, cap: 12, fly: 1 }, gov: { mn: 'Төрийн үйлчилгээ', reach: 1500, cap: 12, fly: 1 },
  mall: { mn: 'Худалдаа, үйлчилгээний төв', reach: 2000, cap: 12, fly: 1 }, college: { mn: 'Их, дээд сургууль', reach: 2000, cap: 12, fly: 1 },
};
const POI_REACH = Math.max(...Object.values(CAT).map((c) => c.reach));

// ---------- Замын сүлжээ + Dijkstra ----------
const WALK_OK = (hw) => hw && !['motorway', 'motorway_link', 'construction', 'proposed', 'raceway', 'bus_guideway', 'escape', 'abandoned'].includes(hw);
const DRIVE_W = { trunk: 0.6, trunk_link: 0.7, primary: 0.65, primary_link: 0.75, secondary: 0.75, secondary_link: 0.8, tertiary: 0.85, tertiary_link: 0.9, unclassified: 1.1, residential: 1.1, living_street: 1.4, service: 1.6 };
function graph(ways, costFn, P) {
  const nodes = new Map(); // osm id → {x,z,adj:[[id,w,len]]}
  for (const w of ways) {
    const f = costFn(w.tags || {}); if (!f || !w.nodes || !w.geometry) continue;
    for (let i = 0; i < w.nodes.length; i++) {
      const id = w.nodes[i], g = w.geometry[i]; if (!g) continue;
      if (!nodes.has(id)) { const [x, z] = P.f(g.lat, g.lon); nodes.set(id, { x, z, adj: [] }); }
      if (i) { const a = nodes.get(w.nodes[i - 1]), b = nodes.get(id); if (!a) continue; const len = Math.hypot(a.x - b.x, a.z - b.z); a.adj.push([id, len * f, len]); b.adj.push([w.nodes[i - 1], len * f, len]); }
    }
  }
  return nodes;
}
function dijkstra(nodes, src) {
  const dist = new Map([[src, 0]]), len = new Map([[src, 0]]), prev = new Map(); const heap = [[0, src]];
  const push = (it) => { heap.push(it); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [d, u] = pop(); if (d > dist.get(u)) continue;
    for (const [v, w, l] of nodes.get(u).adj) { const nd = d + w; if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); len.set(v, len.get(u) + l); prev.set(v, u); push([nd, v]); } }
  }
  return { dist, len, prev };
}
function addConnectors(G, polys, { maxD = 45, perNode = 6, within = Infinity } = {}) {
  const cell = 25, key = (i, j) => i * 1000003 + j, grid = new Map();
  for (const poly of polys) for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    for (let ii = Math.floor(Math.min(a[0], b[0]) / cell); ii <= Math.floor(Math.max(a[0], b[0]) / cell); ii++) for (let jj = Math.floor(Math.min(a[1], b[1]) / cell); jj <= Math.floor(Math.max(a[1], b[1]) / cell); jj++) { const k = key(ii, jj); if (!grid.has(k)) grid.set(k, []); grid.get(k).push([a[0], a[1], b[0], b[1]]); }
  }
  const cross = (ax, az, bx, bz, cx, cz, dx, dz) => { const d1 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx), d2 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx), d3 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax), d4 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax); return (d1 > 0) !== (d2 > 0) && (d3 > 0) !== (d4 > 0); };
  const blocked = (ax, az, bx, bz) => { for (let ii = Math.floor(Math.min(ax, bx) / cell); ii <= Math.floor(Math.max(ax, bx) / cell); ii++) for (let jj = Math.floor(Math.min(az, bz) / cell); jj <= Math.floor(Math.max(az, bz) / cell); jj++) { const L = grid.get(key(ii, jj)); if (L) for (const q of L) if (cross(ax, az, bx, bz, q[0], q[1], q[2], q[3])) return true; } return false; };
  const ng = new Map(); for (const [id, n] of G) { if (Math.hypot(n.x, n.z) > within) continue; const k = key(Math.floor(n.x / maxD), Math.floor(n.z / maxD)); if (!ng.has(k)) ng.set(k, []); ng.get(k).push(id); }
  let added = 0;
  for (const L0 of ng.values()) for (const id of L0) {
    const n = G.get(id), ci = Math.floor(n.x / maxD), cj = Math.floor(n.z / maxD), cand = [];
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const L = ng.get(key(ci + di, cj + dj)); if (L) for (const o of L) { if (o === id) continue; const m = G.get(o), d = Math.hypot(m.x - n.x, m.z - n.z); if (d > 2 && d <= maxD) cand.push([d, o]); } }
    cand.sort((a, b) => a[0] - b[0]); const have = new Set(n.adj.map((a) => a[0])); let k = 0;
    for (const [d, o] of cand) { if (k >= perNode) break; if (have.has(o)) continue; const m = G.get(o); if (blocked(n.x, n.z, m.x, m.z)) continue; n.adj.push([o, d * 1.15, d]); m.adj.push([id, d * 1.15, d]); have.add(o); k++; added++; }
  }
  return added;
}
function bldIndex(list) { // барилгын контурын тор: хэрчим контур огтлох эсэх, барилга дотор явсан урт
  const cell = 25, key = (i, j) => i * 1000003 + j, E = new Map(), B = new Map();
  const put = (M, i, j, v) => { const k = key(i, j); if (!M.has(k)) M.set(k, []); M.get(k).push(v); };
  list.forEach((b, bi) => {
    const p = b.p; let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } b.bb = [x0, z0, x1, z1];
    for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++) for (let j = Math.floor(z0 / cell); j <= Math.floor(z1 / cell); j++) put(B, i, j, bi);
    for (let k = 0, m = p.length - 1; k < p.length; m = k++) { const a = p[m], c = p[k]; for (let i = Math.floor(Math.min(a[0], c[0]) / cell); i <= Math.floor(Math.max(a[0], c[0]) / cell); i++) for (let j = Math.floor(Math.min(a[1], c[1]) / cell); j <= Math.floor(Math.max(a[1], c[1]) / cell); j++) put(E, i, j, [a[0], a[1], c[0], c[1], bi]); }
  });
  const cross = (ax, az, bx, bz, cx, cz, dx, dz) => { const d1 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx), d2 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx), d3 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax), d4 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax); return (d1 > 0) !== (d2 > 0) && (d3 > 0) !== (d4 > 0); };
  const at = (x, z) => { const L = B.get(key(Math.floor(x / cell), Math.floor(z / cell))); if (L) for (const bi of L) { const b = list[bi]; if (x < b.bb[0] || x > b.bb[2] || z < b.bb[1] || z > b.bb[3]) continue; if (inPoly(x, z, b.p)) return bi; } return -1; };
  return {
    at,
    blocked(ax, az, bx, bz, allowInside) { const skip = allowInside ? at(ax, az) : -1; for (let i = Math.floor(Math.min(ax, bx) / cell); i <= Math.floor(Math.max(ax, bx) / cell); i++) for (let j = Math.floor(Math.min(az, bz) / cell); j <= Math.floor(Math.max(az, bz) / cell); j++) { const L = E.get(key(i, j)); if (L) for (const q of L) { if (q[4] === skip) continue; if (cross(ax, az, bx, bz, q[0], q[1], q[2], q[3])) return true; } } return false; },
    inside(ax, az, bx, bz) { const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L)); let len = 0, lv = 0, home = false, sx = 0, sz = 0, c = 0; for (let k = 0; k < n; k++) { const t = (k + 0.5) / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t; const bi = at(x, z); if (bi >= 0) { len += L / n; lv = Math.max(lv, list[bi].lv || 1); if (list[bi].home) home = true; sx += x; sz += z; c++; } } return { len, lv, home, cx: c ? sx / c : 0, cz: c ? sz / c : 0 }; },
  };
}
function nearestNode(nodes, x, z, maxD = 250) { let best = null, bd = maxD; for (const [id, n] of nodes) { const d = Math.hypot(n.x - x, n.z - z); if (d < bd) { bd = d; best = id; } } return best ? { id: best, d: bd } : null; }
function pathTo(nodes, prev, dst) { const out = []; for (let c = dst; c != null; c = prev.get(c)) { const n = nodes.get(c); out.unshift([n.x, n.z]); } return out; }

// ---------- Үндсэн: өгөгдөл цуглуулах ----------
// heightAt(lat,lng) → GHSL ANBH (м), cellAt(lat,lng) → нүдний түлхүүр (heightAt-тай ижил тор): давхарт нөлөөлөхгүй (зөвхөн debug / ghslRules=true туршилт) —
// тиймээс server.js (heightAt/cellAt-гүй) болон демо ижил дүрмээр давхар гаргана. overrides = оршин суугчийн засвар [{lat,lng}|{x,z}, lv, k?, rp?, note?]
// extraPois = бусад эх сурвалжаас нэгтгэсэн цэгүүд [{name, cat, lat, lng, src, ids?, sub?}] (жишээ: OSM + Overture Places/Buildings) — өөрийн OSM цэгтэй давхардлыг арилгаж нийлүүлнэ.
// footprints = GeoJSON барилгын контур (R-ээс гадуурх цэгийн маршрутыг барилгын ханан дээр зогсоох, холбох шугамыг барилга огтлуулахгүй) — заавал биш.
async function generate(lat, lng, { commuteHours = true, log = () => {}, buildings: extBuildings = null, heightAt = null, cellAt = null, homeLevels = null, overrides = null, ghslRules = false, debug = null, extraPois = null, footprints = null, osm = null, sat = null } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('Байршил (lat/lng) шаардлагатай');
  const P = projector(lat, lng);
  // 1) Орчны цэгүүд + гол зам (2 км): amenity/healthcare/office/shop/leisure таг + барилгын таг (school/kindergarten/…) + нэртэй барилга
  log('OSM: орчны цэгүүд…');
  const AR = `(around:${POI_REACH},${lat},${lng})`, AR2 = `(around:1600,${lat},${lng})`;
  const NAME_RE = '[Цц]эцэрлэг|[Сс]ургууль|[Ээ]мнэлэг|[Кк]линик|ӨЭМТ|[Хх]ороо|ХОРОО|[Ии]х [Дд]элгүүр|[Хх]удалдааны төв|[Пп]лаза|[Зз]ах|[Бб]анк|[Шш]уудан|[Цц]агдаа';
  const qPoi = `[out:json][timeout:150];(
    nwr["amenity"~"^(school|kindergarten|university|college|parking|pharmacy|hospital|clinic|doctors|dentist|marketplace|bank|post_office|police|townhall|community_centre)$"]${AR};
    nwr["healthcare"~"^(hospital|clinic|doctor|dentist|centre|pharmacy)$"]${AR};
    nwr["office"="government"]${AR};
    nwr["shop"~"^(mall|supermarket|department_store|convenience|greengrocer|butcher|bakery|general|food)$"]${AR};
    nwr["leisure"~"^(park|playground|garden|pitch|sports_centre|fitness_centre|sports_hall|stadium)$"]${AR2};
    nwr["highway"="bus_stop"]${AR2};
    wr["building"~"^(school|kindergarten|university|college|hospital|clinic)$"]${AR};
    wr["building"]["name"~"${NAME_RE}"]${AR};
  );out center tags;`;
  const poiRaw = osm ? osm.poi(POI_REACH, 1600) : (await overpass(qPoi)).elements || []; // osm = хотын хавтан сан (geostore.js)
  let cands = []; const seenOsm = new Set();
  for (const e of poiRaw) {
    const c = e.center || e; if (c.lat == null) continue; const t = e.tags || {}; const nm = poiName(t); const cat = poiRefine(poiCat(t), nm, t); if (!cat || !CAT[cat]) continue;
    const id = `osm:${e.type}/${e.id}`; if (seenOsm.has(id)) continue; seenOsm.add(id);
    const [x, z] = P.f(c.lat, c.lon); const o = { cat, name: nm, x, z, d0: Math.hypot(x, z), src: 'osm', ids: new Set([id]), ver: 1 }; const sb = poiSub(cat, nm, t); if (sb) o.sub = sb; cands.push(o);
  }
  // Бусад эх сурвалжийн цэгүүд (давуу: нэгтгэсэн жагсаалтын нэр/ангилал) + өөрийн OSM цэг → нэг байгууллага нэг удаа
  if (Array.isArray(extraPois) && extraPois.length) {
    const ext = []; for (const q of extraPois) { if (!q || !CAT[q.cat] || !Number.isFinite(q.lat) || !Number.isFinite(q.lng)) continue; const [x, z] = P.f(q.lat, q.lng); const o = { cat: q.cat, name: String(q.name || '').slice(0, 60), x, z, d0: Math.hypot(x, z), src: q.src || 'ext', ids: new Set(q.ids || []), ext: 1, ver: q.verified === false ? 0 : 1 }; if (q.sub) o.sub = q.sub; ext.push(o); }
    const n0 = cands.length; const groups = clusterPois([...ext.sort((a, b) => a.d0 - b.d0), ...cands.sort((a, b) => a.d0 - b.d0)]);
    cands = groups.map((g) => { const h = g.find((m) => m.ext) ? g[0] : pickRep(g); if (g.some((m) => !m.ext)) { h.ver = 1; if (!/osm/.test(h.src)) h.src += '+osm'; } return h; });
    log(`цэг: OSM ${n0} + нэмэлт ${ext.length} → давхардалгүй ${cands.length}`);
  } else cands = clusterPois(cands.sort((a, b) => a.d0 - b.d0)).map(pickRep);
  if (debug) debug.cands = cands;
  // Сонгох цэгүүдийн радиус (шулуун зайгаар урьдчилан): ангилал бүрээс хамгийн ойр 4
  const pre = []; for (const cat of Object.keys(CAT)) pre.push(...cands.filter((c) => c.cat === cat).sort((a, b) => a.d0 - b.d0).slice(0, 4));
  const R = Math.max(450, Math.min(950, Math.max(...pre.filter((c) => c.cat !== 'college').map((c) => c.d0), 400) + 160));
  // 2) Ойрын бүс: барилга, зам, талбай, мод, орц
  log(`OSM: ойрын бүс (R=${Math.round(R)} м)…`);
  const qNear = `[out:json][timeout:170];(
    way["building"](around:${R},${lat},${lng});
    way["highway"](around:${R + 150},${lat},${lng});
    way["leisure"~"^(park|playground|garden|pitch)$"](around:${R},${lat},${lng});
    way["landuse"~"^(grass|recreation_ground|village_green|meadow|forest)$"](around:${R},${lat},${lng});
    way["amenity"~"^(parking|school|kindergarten)$"](around:${R},${lat},${lng});
    node["natural"="tree"](around:${R},${lat},${lng});
    node["entrance"](around:200,${lat},${lng});
  );out body geom;`;
  const near = osm ? osm.near(R) : (await overpass(qNear)).elements || [];
  // 3) Алс бүс: гэр → Баруун 4 зам → хотын төв (томоохон барилга + гол зам)
  const pts = [[lat, lng], [WEST4.lat, WEST4.lng], [CENTER.lat, CENTER.lng]];
  const s = 0.0065, bbN = [Math.min(...pts.map((p) => p[0])) - s, Math.min(...pts.map((p) => p[1])) - s * 1.5, Math.max(...pts.map((p) => p[0])) + s, Math.max(...pts.map((p) => p[1])) + s * 1.5], bb = bbN.map((v) => v.toFixed(5)).join(',');
  log('OSM: алс бүс (хотын төв хүртэл)…');
  const qFar = `[out:json][timeout:170];(way["building"](${bb});way["highway"~"^(trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link)$"](${bb}););out body geom;`;
  const farRaw = osm ? osm.far(...bbN) : (await overpass(qFar)).elements || [];
  // 3б) Алхах сүлжээ: хамгийн холын хүрэх зай (POI_REACH) хүртэлх БҮХ зам/явган зам — зөвхөн маршрутад (зурахгүй).
  // POI_REACH-ээс урт маршрутын бүх цэг гэрээс POI_REACH дотор байна → +100 м хангалттай.
  log(`OSM: алхах сүлжээ (${POI_REACH + 100} м)…`);
  const walkRaw = osm ? osm.walk(POI_REACH + 100) : (await overpass(`[out:json][timeout:170];way["highway"](around:${POI_REACH + 100},${lat},${lng});out body geom;`)).elements || [];

  // ---- Барилгууд ----
  // pool: бүх барилга (zn 0 = ойр, 1 = алс, 2 = R-ээс гадуурх Overture — зөвхөн нүдний барилгын талбайд, 3 = давхардал) → өндөр → гаралт
  const buildings = [], gers = [], far = [], pool = []; const seen = new Set();
  const addPoly = (p, t, zn, src, sid = null) => { // sid = эх сурвалжийн id (шинжилгээнд, гаралтад орохгүй)
    if (p.length > 1 && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < 0.01) p.pop();
    if (p.length < 3) return null; const A = Math.abs(area(p)); if (A < 6) return null; const [L, W, th] = dims(p); const [cx, cz] = centroid(p);
    // Гэр: жижиг, бөөрөнхий контур (OSM-д building=ger; ML контурт тэмдэггүй тул хэлбэрээр)
    let peri = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) peri += Math.hypot(p[i][0] - p[j][0], p[i][1] - p[j][1]);
    const round = (4 * Math.PI * A) / (peri * peri);
    const tt = !t.building && A < 50 && p.length >= 7 && round > 0.8 ? { ...t, building: 'ger' } : t;
    const q = { p, t: tt, A, L, W, th, D: A / Math.max(L, 1), cx, cz, zn, src, sid }; Object.assign(q, classify(q)); q.t = t;
    pool.push(q); return q;
  };
  const addBuilding = (w, zn) => {
    if (!w.geometry || w.geometry.length < 4 || seen.has(w.id)) return; seen.add(w.id);
    addPoly(w.geometry.map((g) => P.f(g.lat, g.lon)), w.tags || {}, zn, null, 'OSM w' + w.id);
  };
  const ovOsm = new Map(); // Overture доторх OSM way id → pool
  if (extBuildings && Array.isArray(extBuildings.features)) {
    // Overture Maps: OSM + ML контур (Microsoft, East Asian Buildings г.м. хиймэл дагуулын зургаас) — OSM-д ороогүй барилгууд ч багтана. R-ээс гадна = зөвхөн нүдний талбайн тооцоонд
    const CLS = { apartments: 'apartments', residential: 'residential', house: 'house', detached: 'house', garage: 'garage', garages: 'garage', shed: 'shed', barn: 'barn', roof: 'roof', ger: 'ger', school: 'school', kindergarten: 'kindergarten', university: 'university', college: 'college', commercial: 'commercial', retail: 'retail', supermarket: 'supermarket', office: 'office', industrial: 'industrial', warehouse: 'warehouse', hospital: 'hospital', hotel: 'hotel', service: 'service', hut: 'hut', church: 'church' };
    const osmT = new Map(); for (const e of near) if (e.type === 'way' && e.tags && e.tags.building) osmT.set(e.id, e.tags); // Overture-т алга OSM таг (amenity/shop/нэр/давхар)
    for (const f of extBuildings.features) {
      const g = f.geometry; if (!g) continue; const rings = g.type === 'Polygon' ? [g.coordinates[0]] : g.type === 'MultiPolygon' ? g.coordinates.map((c) => c[0]) : [];
      const pr = f.properties || {}; const t = {};
      if (pr.class && CLS[pr.class]) t.building = CLS[pr.class]; if (pr.subtype) t._sub = pr.subtype;
      if (pr.num_floors) t['building:levels'] = pr.num_floors; if (pr.height) t.height = pr.height; if (pr.roof_color) t._rc = pr.roof_color; // _rc = хиймэл дагуулаас хэмжсэн дээврийн өнгө
      const nm = pr.names && (pr.names.primary || (pr.names.common && Object.values(pr.names.common)[0])); if (nm) t.name = nm;
      const sr = pr.sources || [], os = sr.find((x) => x.dataset === 'OpenStreetMap'); const src = sr.length && !os ? 'ml' : null; // OSM биш бүх эх сурвалж = ML
      const oid = os && /^w\d+/.test(os.record_id || '') ? parseInt(os.record_id.slice(1), 10) : null;
      const ot = oid && osmT.get(oid);
      if (ot) { // OSM-ийн эх таг: ангилалд хэрэгтэйг нь нэмнэ (building=yes бол Overture class хоосон хэвээр — гэрийн хэлбэрийн шалгалт хэвээр)
        for (const kk of ['amenity', 'shop', 'leisure', 'building:levels', 'height', 'addr:housenumber']) if (ot[kk] && !t[kk]) t[kk] = ot[kk];
        if (ot.name && !t.name) t.name = ot.name; if (!t.building && ot.building && ot.building !== 'yes') t.building = ot.building;
      }
      for (const ring of rings) { const p = ring.map(([lo, la]) => P.f(la, lo)); const [cx, cz] = centroid(p); const q = addPoly(p, t, Math.hypot(cx, cz) <= R ? 0 : 2, src, oid ? 'OSM w' + oid : sr.length ? sr[0].dataset : null); if (q && oid) ovOsm.set(oid, q); }
    }
  } else for (const e of near) if (e.type === 'way' && e.tags && e.tags.building) addBuilding(e, 0);
  for (const e of farRaw) if (e.type === 'way' && e.tags && e.tags.building) {
    const g = e.geometry && e.geometry[0]; if (!g) continue; const [x, z] = P.f(g.lat, g.lon); if (Math.hypot(x, z) <= R) continue;
    const m = ovOsm.get(e.id); if (m && m.zn === 0) continue; if (m) m.zn = 3; addBuilding(e, 1); // Overture-т байгаа бол давхар тоолохгүй
  }
  const nearB = pool.filter((q) => q.zn === 0 && q.k !== 'ger');
  // Гэрийн барилга: зүүг агуулсан, эсвэл 60 м доторх хамгийн ойр
  let hq = nearB.find((q) => inPoly(0, 0, q.p));
  if (!hq) { let bd = 60; for (const q of nearB) { const d = Math.hypot(q.cx, q.cz); if (d < bd) { bd = d; hq = q; } } }
  // homeLevels-гүй (server.js) үед: зөвхөн орон сууц/таггүй, ≥ 150 м² контурт ≥ 5 (объект нь орон сууцны байранд) — house/оффис/цэцэрлэг г.м. өөрийн утгаараа
  if (hq) { if (homeLevels) { hq.lv = homeLevels; hq.kn = 1; hq.slab = 0; hq.rule = 'гэрийн байр (өгөгдсөн)'; } else if (!hq.kn && (hq.cat === 'apt' || hq.cat === 'bld') && hq.A >= 150) hq.mn = 5; }
  // Оршин суугчийн засвар: цэгийг агуулсан (эсвэл 12 м доторх хамгийн ойр төвтэй) барилга → мэдэгдэж буй
  for (const o of overrides || []) {
    const [ox, oz] = Number.isFinite(o.x) ? [o.x, o.z] : P.f(o.lat, o.lng); let q = nearB.find((b) => inPoly(ox, oz, b.p));
    if (!q) { let bd = 12; for (const b of nearB) { const d = Math.hypot(b.cx - ox, b.cz - oz); if (d < bd) { bd = d; q = b; } } }
    if (!q) { log(`засвар: барилга олдсонгүй (${r1(ox)}, ${r1(oz)}) ${o.note || ''}`); continue; }
    if (o.lv > 0) { q.lv = o.lv; q.kn = 1; q.slab = 0; q.rule = 'засвар'; } if (o.k) q.k = o.k; if (o.rp) q.rp = o.rp; q.uc = 1; log(`засвар: (${r1(q.cx)}, ${r1(q.cz)}) → ${q.lv} давхар ${o.note || ''}`);
  }
  // ---- GHSL (EU JRC ANBH R2023A, ~100 м нүдний барилгын дундаж өндөр) — ӨГӨГДМӨЛӨӨР ДАВХАРТ НӨЛӨӨЛӨХГҮЙ ----
  // Шалгалт (2026-09-30, энэ байршил, мэдэгдэх давхартай барилгууд): ойрын бүсийн 5 давхар угсармал блок 7/7-ийн ANBH 15–20 м (≥ 14 → 9 болох байсан),
  // 9 давхар 17–22 м; 2 давхар цэцэрлэг (нүдийнхээ барилгын 76–84%-ийг эзэлдэг) 18–20 м; 1 давхар таглагдсан барилга ~21 м; гэр p50 11.9 м.
  // Нэг барилгын түвшинд 1/2/3 ба 5/9 давхрыг ялгахгүй тул давхрыг зөвхөн таг/хэлбэр/мэдэгдэх хөршөөр тогтооно.
  // ghslRules=true → туршилтын 2 дүрэм (угсармал: ANBH ≥ 14 → 9, ≤ 10 → 5; бусад таамаг: +1 давхар) — хөрш үнэлгээнд илүү олон хэтрүүлэлт өгсөн.
  // Түүвэр: 4 м торны цэгүүд → anbh = өөрийн талбайгаар жигнэсэн ANBH; cellAt байвал share = өөрийн талбай / тэдгээр нүдний нийт барилгын талбай (шинжилгээнд).
  const cells = new Map();
  if (heightAt && (ghslRules || debug)) {
    for (const q of pool) {
      if (q.zn === 3) continue;
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of q.p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      const st = Math.max(4, Math.sqrt(q.A / 1500)), cnt = new Map(); let n = 0, sv = 0, nv = 0;
      const put = (x, z) => {
        const ll = P.inv(x, z), v = heightAt(ll.lat, ll.lng); n++; if (Number.isFinite(v) && v > 0) { sv += v; nv++; }
        if (cellAt) { const r = cellAt(ll.lat, ll.lng); if (r != null) { const key = Array.isArray(r) ? r.join(',') : String(r); cnt.set(key, (cnt.get(key) || 0) + 1); } }
      };
      for (let x = x0 + st / 2; x < x1; x += st) for (let z = z0 + st / 2; z < z1; z += st) if (inPoly(x, z, q.p)) put(x, z);
      if (!n) put(q.cx, q.cz);
      q.anbh = nv ? sv / nv : null; if (cellAt) q.cells = [...cnt].map(([key, c]) => [key, (q.A * c) / n]);
    }
    if (cellAt) {
      for (const q of pool) for (const [key, a] of q.cells || []) cells.set(key, (cells.get(key) || 0) + a);
      for (const q of pool) if (q.cells && q.cells.length) { let own = 0, tot = 0; for (const [key, a] of q.cells) { own += a; tot += cells.get(key); } q.share = tot > 0 ? own / tot : null; }
    }
  }
  // ---- Угсармал блок (таамаг) ----
  // (1) Орон сууцны нотолгоо: building=apartments/residential/dormitory таг эсвэл нэр («…байр», хотхон, орон сууц), ЭСВЭЛ 150 м дотор мэдэгдэх ≥ 4 давхар орон сууц/таггүй барилга,
  //     ЭСВЭЛ 100 м дотор OSM apartments/residential тагтай барилга. Нотолгоогүй таггүй/ML контур → таггүй барилгын утга (alt, 1–2 давхар).
  // (2) Давхар: 100 м доторх ижил чигтэй (±15°) МЭДЭГДЭХ хамгийн ойр угсармал хөршийн давхар (≤ 9); алга бол 5.
  //     5-аас дээш өсгөхөд: 60 м дотор илүү нам МЭДЭГДЭХ орон сууц (хэлбэрээс үл хамааран) байвал түүний давхраас хэтрүүлэхгүй.
  // Мэдэгдэх 205 угсармал блок дээрх leave-one-out: 100 м + 60 м дүрэм 62% зөв, ≥3 давхраар хэтрүүлсэн 2 (150 м: 68% / 6; ойрын бүсэд 100 м: 58% / 1).
  const multiKnown = (o) => o.kn && o.zn < 3 && (o.cat === 'apt' || o.cat === 'bld') && o.lv >= 4; // мэдэгдэх олон давхар орон сууц/таггүй
  const knownSlabs = pool.filter((o) => multiKnown(o) && slabShape(o));
  const knownApt = pool.filter((o) => o.kn && o.zn < 3 && (o.cat === 'apt' || (o.cat === 'bld' && o.lv >= 4)));
  const resTagged = pool.filter((o) => o.zn < 3 && RES_B.has(o.t.building));
  const sameDir = (a, b) => { const d = Math.abs(a - b) % Math.PI; return Math.min(d, Math.PI - d) <= (15 * Math.PI) / 180; };
  const dd = (a, b) => Math.hypot(a.cx - b.cx, a.cz - b.cz);
  for (const q of pool) {
    if (!q.slab || q.kn || q.zn === 3) continue;
    if (!q.slabRes) {
      const ev = pool.find((o) => o !== q && multiKnown(o) && dd(o, q) <= 150) || resTagged.find((o) => o !== q && dd(o, q) <= 100);
      if (!ev) { q.slab = 0; q.lv = q.alt.lv; q.rule = q.alt.rule + ' (угсармал хэлбэр, орон сууцны нотолгоогүй)'; continue; }
      // гэр хороолол давамгай (100 м дотор ≥ 10 барилгын ≥ 50% нь гэр/house) → угсармал гэж үзэхгүй
      let nA = 0, nG = 0; for (const o of pool) if (o !== q && o.zn < 3 && dd(o, q) <= 100) { nA++; if (o.cat === 'ger' || o.cat === 'house') nG++; }
      if (nA >= 10 && nG >= 0.5 * nA) { q.slab = 0; q.lv = q.alt.lv; q.rule = q.alt.rule + ` (угсармал хэлбэр, гэр хороолол давамгай ${nG}/${nA})`; continue; }
      q.ev = ev;
    }
    const H = ghslRules ? q.anbh : null;
    if (H != null && H >= 14) { q.lv = 9; q.rule = `угсармал: GHSL ${H.toFixed(1)} м ≥ 14`; continue; }
    if (H != null && H <= 10) { q.lv = 5; q.rule = `угсармал: GHSL ${H.toFixed(1)} м ≤ 10`; continue; }
    let nb = null, bd = 100; for (const o of knownSlabs) { if (o === q || !sameDir(o.th, q.th)) continue; const d = dd(o, q); if (d < bd) { bd = d; nb = o; } }
    if (!nb) { q.lv = 5; q.rule = 'угсармал: 100 м дотор мэдэгдэх хөршгүй → 5'; continue; }
    q.nb = nb; q.lv = Math.min(EST_MAX, nb.lv); q.rule = `угсармал: мэдэгдэх хөрш ${nb.lv} давхар (${Math.round(bd)} м)`;
    if (q.lv > 5) for (const o of knownApt) if (o !== q && o !== nb && o.lv < q.lv && dd(o, q) <= 60) { q.lv = Math.max(5, o.lv); q.rule += ` → 60 м доторх мэдэгдэх ${o.lv} давхраас хэтрүүлэхгүй`; q.lo = o; }
  }
  // ---- АЛС БҮС (хотын төвийн дүр төрх), том таггүй барилга (A ≥ 350 м², таамаг bld/com, нарийн эгнээ/гараж биш) ----
  // Ойр орчны ТАГЛАГДСАН (building:levels/height) ижил хэмжээний (×2.5) орон сууцны биш барилгуудын ДООД ДӨРӨВНИЙ НЭГ (p25) — таглагдсан түүвэр
  // өндөр рүү хазайдаг тул медиан биш. 400 м дотор ≥ 5, эсвэл 1000 м дотор ≥ 8; үр дүнг [3, 6]-д хязгаарлана; хөрш алга бол 3.
  // Алс бүсийн таглагдсан 350+ м² барилга дээрх leave-one-out (bld 130 / com 91): энэ дүрэм ±1 давхар 32% / 34%, ≥3 давхраар хэтрүүлсэн 3 / 2;
  // тогтмол 2 — 26% / 22% (≥3 давхраар дутуу 80 / 61); хуучин тогтмол 5 — 33% / 25%, ≥3 давхраар хэтрүүлсэн 25 / 8; медиан (p50) — хэтрүүлсэн 24 / 13.
  // Ойрын бүсэд ХЭРЭГЛЭХГҮЙ: гэрийн орчмын таглагдсан барилга цөөн (400 м дотор ≤ 7), өндөр рүү хазайсан — туршихад гэрийн хажуугийн 21×19 м ML контур,
  // «Supermarket», зах, ресторан 5–7 давхар болсон (өмнөх шалгалтаар татгалзсан төрлийн алдаа). Ойрын бүс ангиллын болгоомжтой утгаараа (e:1).
  const TAGNB = new Set(['bld', 'com', 'ind', 'health']);
  const tagNb = pool.filter((o) => o.tg && o.zn < 3 && TAGNB.has(o.cat) && o.A >= 150);
  for (const q of pool) {
    if (q.kn || q.slab || q.zn !== 1 || q.A < 350 || !(q.cat === 'bld' || q.cat === 'com') || /гараж|нарийн/.test(q.rule)) continue;
    let pick = null;
    for (const [rr, nmin] of [[400, 5], [1000, 8]]) {
      const v = []; for (const o of tagNb) if (o.A >= q.A / 2.5 && o.A <= q.A * 2.5 && dd(o, q) <= rr) v.push(o.lv);
      if (v.length >= nmin) { v.sort((a, b) => a - b); pick = { lv: v[Math.floor((v.length - 1) / 4)], n: v.length, rr }; break; }
    }
    const lv = Math.max(q.lv, Math.min(6, Math.max(3, pick ? pick.lv : 3)));
    if (lv !== q.lv) { q.lv0 = q.lv; q.lv = lv; q.rule += pick ? ` → алс бүс: таглагдсан хөрш p25 ${pick.lv} (${pick.n}, ${pick.rr} м) → ${lv}` : ' → алс бүс: таглагдсан хөршгүй → 3'; }
  }
  if (ghslRules) for (const q of pool) { // туршилтын: угсармал биш таамаг +1, хэрэв өөрийн нүднүүдийн ANBH ≥ 1.8 × урьдчилсан өндөр ба тэдгээр нүдний барилгын талбайн ≥ 50%-ийг эзэлдэг
    if (q.kn || q.slab || q.zn === 3 || q.share == null || q.anbh == null || q.A < 60 || /гараж/.test(q.rule)) continue;
    if (q.share >= 0.5 && q.anbh >= 1.8 * q.lv * FLH && q.lv < EST_MAX) { q.lv += 1; q.rule += ` +1 (GHSL ${q.anbh.toFixed(1)} м, эзлэх ${Math.round(q.share * 100)}%)`; }
  }
  for (const q of pool) if (!q.kn) { if (q.mn && q.lv < q.mn) { q.lv = q.mn; q.rule += ' → гэрийн байр ≥ 5'; } q.lv = Math.min(EST_MAX, q.lv); }
  if (debug) { debug.cells = cells; debug.pool = pool; debug.home = hq; }
  // ---- Гаралт ----
  let home = null;
  for (const q of pool) {
    if (q.zn >= 2) continue;
    if (q.zn === 1) { if (q.A < 350 && q.lv < 5) continue; const fb = { p: flat(simplify(q.p, 1.6)), lv: q.lv }; if (!q.kn) fb.e = 1; if (q.t && q.t._rc) fb.rc = q.t._rc; far.push(fb); continue; }
    if (q.k === 'ger') { gers.push([r1(q.cx), r1(q.cz), r1(Math.max(2.2, Math.min(4.5, Math.sqrt(q.A / Math.PI))))]); continue; }
    const sp = simplify(q.p, 0.45); if (sp.length < 3) continue; const t = q.t;
    const b = { p: flat(sp), lv: q.lv, k: q.k }; if (t.name) b.n = String(t.name).slice(0, 40); if (t['addr:housenumber']) b.no = String(t['addr:housenumber']).slice(0, 10); if (q.src) b.s = q.src;
    if (!q.kn) b.e = 1; if (q.rp) b.rp = q.rp; if (t._rc) b.rc = t._rc; if (q === hq) { b.t = 1; home = b; } // e = таамаг өндөр; rp = дээвэр дээрх (playground г.м.)
    // rf = 'flat': ≥ 300 м², 1–2 давхар, байшин/саравч/худалдаа/сургууль биш → хавтгай дээвэр (үзэгч одоогоор 1–2 давхар 'bld'-г байшин загвараар зурдаг)
    if (q.lv <= 2 && q.A >= 300 && !['house', 'shed', 'com', 'edu', 'ger'].includes(q.k)) b.rf = 'flat';
    b._poly = sp; b._c = [q.cx, q.cz]; buildings.push(b);
  }

  // ---- Замууд / талбайнууд / мод ----
  const roads = [], areas = [], trees = []; const allWays = [];
  const RK = (hw) => (['trunk', 'primary', 'secondary', 'trunk_link', 'primary_link', 'secondary_link'].includes(hw) ? 'major' : ['tertiary', 'tertiary_link'].includes(hw) ? 'mid' : ['residential', 'unclassified', 'living_street'].includes(hw) ? 'minor' : hw === 'service' ? 'service' : ['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'track', 'corridor', 'bridleway'].includes(hw) ? 'path' : null);
  const RW = { major: 15, mid: 10, minor: 6.5, service: 4.5, path: 2.2 };
  const roadSeen = new Set();
  const addRoad = (w, isFar) => {
    const hw = w.tags && w.tags.highway; const k = RK(hw); if (!k || !w.geometry || roadSeen.has(w.id)) return; roadSeen.add(w.id);
    if (isFar && k !== 'major' && k !== 'mid') return;
    const p = simplify(w.geometry.map((g) => P.f(g.lat, g.lon)), isFar ? 1.2 : 0.4);
    let wd = RW[k]; const lanes = parseInt(w.tags.lanes, 10); if (Number.isFinite(lanes) && k !== 'path') wd = Math.max(4, Math.min(28, lanes * 3.3 + 1.5));
    if (hw === 'pedestrian') wd = 5; if (w.tags.service === 'parking_aisle') wd = 4;
    const o = { p: flat(p), w: r1(wd), k }; if (w.tags.name && (k === 'major' || k === 'mid')) o.n = String(w.tags.name).slice(0, 40); if (w.tags.bridge === 'yes') o.br = 1;
    roads.push(o);
  };
  for (const e of near) {
    if (e.type === 'way' && e.tags && e.tags.highway) { allWays.push(e); addRoad(e, false); continue; }
    if (e.type === 'node' && e.tags && e.tags.natural === 'tree') { const [x, z] = P.f(e.lat, e.lon); trees.push(r1(x), r1(z)); continue; }
    if (e.type === 'way' && e.tags && !e.tags.building && e.geometry && e.geometry.length >= 4) {
      const t = e.tags; const k = t.leisure === 'playground' ? 'playground' : ['park', 'garden'].includes(t.leisure) ? 'park' : t.leisure === 'pitch' ? 'pitch' : t.amenity === 'parking' ? 'parking' : ['school', 'kindergarten'].includes(t.amenity) ? 'school' : t.landuse === 'forest' ? 'park' : t.landuse ? 'grass' : null;
      if (!k) continue; const p = simplify(e.geometry.map((g) => P.f(g.lat, g.lon)), 0.6); if (Math.abs(area(p)) < 20) continue; areas.push({ p: flat(p), k });
    }
  }
  for (const e of farRaw) if (e.type === 'way' && e.tags && e.tags.highway) { allWays.push(e); addRoad(e, true); }

  // ---- Орц (гэрийн байрны хаалга) ----
  let entrance = null;
  if (home) {
    const ent = near.filter((e) => e.type === 'node' && e.tags && e.tags.entrance).map((e) => P.f(e.lat, e.lon)).filter(([x, z]) => { const p = home._poly; for (let i = 0, j = p.length - 1; i < p.length; j = i++) if (segDist(x, z, p[j][0], p[j][1], p[i][0], p[i][1])[0] < 2) return true; return false; });
    if (ent.length) entrance = ent.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]))[0];
  }
  // ---- Алхах сүлжээ: орцноос бүх цэг рүү (ойр бүсийн зам + POI_REACH хүртэлх бүх зам) ----
  const wayIds = new Set(allWays.map((w) => w.id));
  const walkWays = allWays.concat(walkRaw.filter((w) => w.type === 'way' && w.tags && w.tags.highway && !wayIds.has(w.id)));
  const walkG = graph(walkWays, (t) => (WALK_OK(t.highway) ? 1 : 0), P);
  const conn = addConnectors(walkG, buildings.map((b) => b._poly), { within: R + 200 }); log(`алхах сүлжээ: ${walkG.size} цэг, хашааны холболт +${conn}`);
  const BI = bldIndex(buildings.map((b) => ({ p: b._poly, lv: b.lv, home: b === home })));
  const archAt = []; let thruN = 0; // барилга нэвт гарах хэрчмүүд: арк (зөвшөөрнө) эсвэл хаалттай
  for (const [id, n] of walkG) for (const e of n.adj) {
    const m = walkG.get(e[0]); if (!m || segDist(0, 0, n.x, n.z, m.x, m.z)[0] > R + 120) continue; // ойрын бүсийн барилгуудтай л шалгана
    const r = BI.inside(n.x, n.z, m.x, m.z); if (r.len <= 0.5) continue;
    const arch = r.len <= 18 && r.lv >= 5 && !r.home; e[1] = e[2] * (arch ? 1.3 : 25); thruN++;
    if (arch && String(id) < String(e[0])) archAt.push({ x: r.cx, z: r.cz, dx: m.x - n.x, dz: m.z - n.z, len: r.len });
  }
  log(`барилга нэвт гарах хэрчим ${thruN} (арк байж болох ${archAt.length})`);
  // R-ээс гадуурх барилгын контур (алс бүсийн OSM + Overture, footprints): холбох шугам барилга огтлохгүй, маршрут барилгын ханан дээр зогсоно
  const farPolys = [];
  for (const q of pool) if ((q.zn === 1 || q.zn === 2) && Math.hypot(q.cx, q.cz) > R - 30) farPolys.push({ p: q.p });
  if (footprints && Array.isArray(footprints.features)) for (const f of footprints.features) {
    const g = f.geometry; if (!g) continue; const rings = g.type === 'Polygon' ? [g.coordinates[0]] : g.type === 'MultiPolygon' ? g.coordinates.map((c) => c[0]) : [];
    for (const ring of rings) { if (!ring || ring.length < 4) continue; const p = ring.map(([lo, la]) => P.f(la, lo)); const [cx, cz] = centroid(p); const d = Math.hypot(cx, cz); if (d > R - 30 && d < POI_REACH + 200) farPolys.push({ p }); }
  }
  const BF = farPolys.length ? bldIndex(farPolys) : null;
  const NGC = 100, NG = new Map(); // зангилааны тор (nearestSeg хурдан)
  for (const [id, n] of walkG) { const k = Math.floor(n.x / NGC) * 100003 + Math.floor(n.z / NGC); if (!NG.has(k)) NG.set(k, []); NG.get(k).push(id); }
  const nearestSeg = (x, z, maxD, allowInside) => { // хамгийн ойрын явган замын ХЭРЧИМ (зангилаа биш) — холбох шугам барилга огтлохгүй
    let best = null; const rr = maxD + 120;
    for (let i = Math.floor((x - rr) / NGC); i <= Math.floor((x + rr) / NGC); i++) for (let j = Math.floor((z - rr) / NGC); j <= Math.floor((z + rr) / NGC); j++) for (const uid of NG.get(i * 100003 + j) || []) {
      const u = walkG.get(uid); if (Math.abs(u.x - x) > rr || Math.abs(u.z - z) > rr) continue;
      for (const [vid, w, len] of u.adj) { const v = walkG.get(vid); if (!v || len < 0.01) continue; const dx = v.x - u.x, dz = v.z - u.z; const t = Math.max(0, Math.min(1, ((x - u.x) * dx + (z - u.z) * dz) / (len * len))); const fx = u.x + dx * t, fz = u.z + dz * t; const d = Math.hypot(x - fx, z - fz); if (d > maxD || (best && d >= best.d) || w > len * 2) continue; if (d > 0.5 && (BI.blocked(x, z, fx, fz, allowInside) || (BF && BF.blocked(x, z, fx, fz, allowInside)))) continue; best = { uid, vid, t, fx, fz, d, len, wr: w / len }; }
    }
    return best;
  };
  // Очих цэгийн холбох хэрчмийн нэр дэвшигчид: хамгийн ойр чөлөөт (барилга огтлохгүй) хэрчмээс +slack м дотор, хэрчим бүрт хамгийн ойр цэг (≤ k).
  // route() эдгээрээс НИЙТ алхах зай (сүлжээ + холбох шугам) хамгийн богиныг сонгоно — зөвхөн хамгийн ойр хэрчим бол барилгын ар талын замаар тойрох байсан.
  const nearSegs = (x, z, maxD, allowInside, slack = 60, k = 10) => {
    const all = []; const rr = maxD + 120;
    for (let i = Math.floor((x - rr) / NGC); i <= Math.floor((x + rr) / NGC); i++) for (let j = Math.floor((z - rr) / NGC); j <= Math.floor((z + rr) / NGC); j++) for (const uid of NG.get(i * 100003 + j) || []) {
      const u = walkG.get(uid); if (Math.abs(u.x - x) > rr || Math.abs(u.z - z) > rr) continue;
      for (const [vid, w, len] of u.adj) { const v = walkG.get(vid); if (!v || len < 0.01 || w > len * 2) continue; const dx = v.x - u.x, dz = v.z - u.z; const t = Math.max(0, Math.min(1, ((x - u.x) * dx + (z - u.z) * dz) / (len * len))); const fx = u.x + dx * t, fz = u.z + dz * t; const d = Math.hypot(x - fx, z - fz); if (d <= maxD) all.push({ uid, vid, t, fx, fz, d, len, wr: w / len }); }
    }
    all.sort((a, b) => a.d - b.d); const out = []; let d0 = null;
    for (const c of all) { if (d0 != null && c.d > d0 + slack) break; if (c.d > 0.5 && (BI.blocked(x, z, c.fx, c.fz, allowInside) || (BF && BF.blocked(x, z, c.fx, c.fz, allowInside)))) continue; if (d0 == null) d0 = c.d; out.push(c); if (out.length >= k) break; }
    return out;
  };
  let start = null;
  if (entrance) start = nearestNode(walkG, entrance[0], entrance[1], 150);
  if (!start && home) { // орц = байрны УРТ талын дунд (угсармал блокийн орцууд урт талдаа) — сүлжээнд ойр талыг сонгоно
    const p = home._poly; const [hx, hz] = home._c; let best = null;
    const edgesL = []; for (let i = 0, j = p.length - 1; i < p.length; j = i++) edgesL.push({ a: p[j], b: p[i], L: Math.hypot(p[i][0] - p[j][0], p[i][1] - p[j][1]) });
    edgesL.sort((u, v) => v.L - u.L);
    for (const e of edgesL.slice(0, 2)) {
      const mx = (e.a[0] + e.b[0]) / 2, mz = (e.a[1] + e.b[1]) / 2; const ox = mx - hx, oz = mz - hz, ol = Math.hypot(ox, oz) || 1;
      const q = [mx + (ox / ol) * 1.5, mz + (oz / ol) * 1.5]; const nn = nearestNode(walkG, q[0], q[1], 200);
      if (nn && (!best || nn.d < best.nn.d)) best = { nn, q };
    }
    if (best) { start = best.nn; entrance = best.q; }
  }
  if (!start) start = nearestNode(walkG, 0, 0, 400);
  if (!entrance) entrance = start ? [walkG.get(start.id).x, walkG.get(start.id).z] : [0, 0];
  if (entrance) { // орцноос хамгийн ойрын явган зам руу перпендикуляр (20 м «гаргалт»-гүй)
    const sg = nearestSeg(entrance[0], entrance[1], 150, false);
    if (sg) { walkG.set('E', { x: entrance[0], z: entrance[1], adj: [] }); walkG.set('EF', { x: sg.fx, z: sg.fz, adj: [] }); const link = (a, b, len, wr) => { walkG.get(a).adj.push([b, len * wr, len]); walkG.get(b).adj.push([a, len * wr, len]); }; link('E', 'EF', sg.d, 1); link('EF', sg.uid, sg.t * sg.len, sg.wr); link('EF', sg.vid, (1 - sg.t) * sg.len, sg.wr); start = { id: 'E', d: 0 }; }
  }
  const walk = start ? dijkstra(walkG, start.id) : null; const usedPaths = [];
  const route = (x, z) => {
    if (!walk) return null; let pth, lenM; let sg = null, best = Infinity, via = null;
    for (const c of nearSegs(x, z, 220, true)) { // нийт зай хамгийн бага холбох хэрчим
      const lu = walk.len.has(c.uid) ? walk.len.get(c.uid) + c.t * c.len : Infinity, lw = walk.len.has(c.vid) ? walk.len.get(c.vid) + (1 - c.t) * c.len : Infinity;
      const tot = Math.min(lu, lw) + c.d; if (tot < best) { best = tot; sg = c; via = lu <= lw ? c.uid : c.vid; }
    }
    if (sg && best < Infinity) { lenM = best; pth = [...pathTo(walkG, walk.prev, via), [sg.fx, sg.fz], [x, z]]; }
    else { const nn = nearestNode(walkG, x, z, 220); if (!nn || !walk.len.has(nn.id)) return null; pth = [...pathTo(walkG, walk.prev, nn.id), [x, z]]; lenM = walk.len.get(nn.id) + nn.d; }
    if (start && start.id !== 'E') { pth.unshift(entrance); lenM += start.d || 0; }
    // очих цэг барилга дотор бол (дэлгүүр, эмнэлэг…) шугам барилгын ханан дээр (хаалган дээр) зогсоно — ойр бүс: buildings, алс: farPolys
    const bi = BI.at(x, z); let P2 = bi >= 0 ? buildings[bi]._poly : null; if (!P2 && BF) { const fi = BF.at(x, z); if (fi >= 0) P2 = farPolys[fi].p; }
    if (P2 && pth.length >= 2) { const a0 = pth[pth.length - 2]; let bt = 1; for (let i = 0, j = P2.length - 1; i < P2.length; j = i++) { const rx = x - a0[0], rz = z - a0[1], sx = P2[i][0] - P2[j][0], sz = P2[i][1] - P2[j][1]; const den = rx * sz - rz * sx; if (Math.abs(den) < 1e-9) continue; const t = ((P2[j][0] - a0[0]) * sz - (P2[j][1] - a0[1]) * sx) / den, q = ((P2[j][0] - a0[0]) * rz - (P2[j][1] - a0[1]) * rx) / den; if (t >= 0 && t <= 1 && q >= 0 && q <= 1) bt = Math.min(bt, t); } if (bt < 1) { const ex = a0[0] + (x - a0[0]) * bt, ez = a0[1] + (z - a0[1]) * bt; lenM -= Math.hypot(x - ex, z - ez); pth[pth.length - 1] = [ex, ez]; } }
    return { p: flat(simplify(pth, 0.8)), m: Math.round(lenM), walkMin: Math.max(1, Math.round(lenM / WALK_MS / 60)), pth };
  };
  // ---- Цэгүүд: ангилал бүрт алхах зай ≤ reach БҮХ байгууллага (сүлжээгээр эрэмбэлсэн). Эхний cap нь маршруттай (pois), үлдсэн нь маршрутгүй (poisMore);
  //      fly = хамгийн ойр fly ширхэг (үзэгч зөвхөн тэдгээр рүү нисч, бусдыг жагсаана) ----
  const pois = [], poisMore = []; let nRouted = 0;
  for (const [cat, meta] of Object.entries(CAT)) {
    const got = [];
    for (const c of cands) { if (c.cat !== cat || c.d0 > meta.reach) continue; const r = route(c.x, c.z); nRouted++; if (r && r.m <= meta.reach) got.push({ c, r }); }
    got.sort((a, b) => a.r.m - b.r.m || a.c.d0 - b.c.d0);
    // нислэг: хамгийн ойр «баталгаатай» (OSM-д бий / олон эх сурвалж / Overture итгэл ≥ 0.6) fly ширхэг; ганц сул Places цэг рүү нисэхгүй
    let flyI = got.map((o, i) => (o.c.ver ? i : -1)).filter((i) => i >= 0).slice(0, meta.fly); if (!flyI.length) flyI = got.slice(0, meta.fly).map((_, i) => i);
    got.forEach(({ c, r }, i) => {
      const o = { cat, mn: meta.mn, name: c.name || meta.mn, x: r1(c.x), z: r1(c.z), m: r.m, walkMin: r.walkMin };
      if (i < meta.cap) { o.route = r.p; usedPaths.push(r.pth); }
      o.src = c.src || 'osm'; if (c.sub) o.sub = c.sub; if (flyI.includes(i)) o.fly = true;
      (i < meta.cap ? pois : poisMore).push(o);
    });
  }
  log(`цэг: ${pois.length} маршруттай + ${poisMore.length} маршрутгүй (${nRouted} маршрут тооцсон)`);
  // ---- Төв зам: гол замын хамгийн ойр цэг (сүлжээгээр) ----
  let mainRoad = null;
  if (walk) {
    let best = null, best2 = null;
    for (const w of allWays) {
      const hw = w.tags.highway; if (!['trunk', 'primary', 'secondary'].includes(hw) || !w.nodes) continue;
      for (const id of w.nodes) { const l = walk.len.get(id); if (l == null) continue; const o = { l, id, name: w.tags.name || w.tags.ref || 'Гол зам', hw }; if (hw === 'secondary') { if (!best2 || l < best2.l) best2 = o; } else if (!best || l < best.l) best = o; }
    }
    if (!best || best.l > 1500) best = best2 || best;
    if (best) { const n = walkG.get(best.id); const r = route(n.x, n.z); if (r) { usedPaths.push(r.pth); const ll = P.inv(n.x, n.z); mainRoad = { name: best.name, x: r1(n.x), z: r1(n.z), lat: +ll.lat.toFixed(6), lng: +ll.lng.toFixed(6), m: r.m, walkMin: r.walkMin, route: r.p }; } }
  }
  // ---- Жолоодох маршрут (OSM геометр): гэр → Баруун 4 зам → хотын төв ----
  const driveG = graph(allWays, (t) => DRIVE_W[t.highway] || 0, P);
  const dests = [];
  const ds = nearestNode(driveG, entrance[0], entrance[1], 400);
  if (ds) {
    const dj = dijkstra(driveG, ds.id);
    for (const D of [WEST4, CENTER]) {
      const [x, z] = P.f(D.lat, D.lng); const nn = nearestNode(driveG, x, z, 300);
      const o = { id: D.id, name: D.name, x: r1(x), z: r1(z), lat: D.lat, lng: D.lng };
      if (nn && dj.prev.has(nn.id)) { const pth = [entrance, ...pathTo(driveG, dj.prev, nn.id)]; o.route = flat(simplify(pth, 2)); o.km = Math.round((dj.len.get(nn.id) + ds.d) / 100) / 10; }
      dests.push(o);
    }
  }
  const study = commuteHours ? await computeStudy({ origin: { lat, lng }, entrance, mainRoad, dests }, { log }) : null;
  const arches = archAt.filter((a) => usedPaths.some((pth) => pth.some((q, i) => i && segDist(a.x, a.z, pth[i - 1][0], pth[i - 1][1], q[0], q[1])[0] < 2))).map((a) => [r1(a.x), r1(a.z), Math.round(Math.atan2(a.dx, a.dz) * 1000) / 1000, r1(a.len)]);
  for (const b of buildings) { delete b._poly; delete b._c; }
  log(`бэлэн: барилга ${buildings.length} (+гэр ${gers.length}, алс ${far.length}), зам ${roads.length}, талбай ${areas.length}, цэг ${pois.length} (+${poisMore.length})`);
  const attribution = '© OpenStreetMap contributors (ODbL)' + ([...pois, ...poisMore].some((p) => /overture/.test(p.src)) || (extBuildings && extBuildings.features) ? ' · Overture Maps Foundation (CDLA-Permissive-2.0 / ODbL)' : '') + (sat ? ' · Contains modified Copernicus Sentinel data 2025 · ESA WorldCover (CC BY 4.0)' : '');
  return {
    v: 1, origin: { lat, lng }, R: Math.round(R), attribution,
    home: home ? { p: home.p, lv: home.lv, n: home.n || '', no: home.no || '' } : null, entrance: entrance.map(r1),
    buildings, gers, far, roads, areas, trees, pois, poisMore, mainRoad, dests, arches, study, generated_at: new Date().toISOString(),
  };
}

// ---- Цаг тус бүрийн хугацаа (Google Routes, ажлын өдөр): орцноос төв зам / Баруун 4 зам / хотын төв ----
// Бэлэн гадаах өгөгдөл дээр тусад нь ажиллуулж болно (жишээ нь түлхүүртэй сервер дээр).
async function computeStudy(ext, { log = () => {} } = {}) {
  if (!commute.hasKey() || !ext || !ext.origin || !ext.entrance) return null;
  log('Google Routes: цаг тус бүрийн түгжрэлийн хугацаа…');
  const P = projector(ext.origin.lat, ext.origin.lng); const mr = ext.mainRoad;
  const targets = [...(mr && mr.lat ? [{ id: 'main', name: mr.name, lat: mr.lat, lng: mr.lng }] : []), ...(ext.dests || []).map((d) => ({ id: d.id, name: d.name, lat: d.lat, lng: d.lng }))];
  const o = P.inv(ext.entrance[0], ext.entrance[1]); const rows = [];
  for (const tg of targets) {
    const row = { id: tg.id, name: tg.name, byHour: [] };
    for (let h = 6; h <= 23; h++) { try { const r = await commute.routeOnce(o, tg, commute.nextTuesdayAt(h, 0)); row.byHour.push(r ? [h, r.min, r.km, r.freeMin] : [h, null, null, null]); } catch (e) { row.byHour.push([h, null, null, null]); row.error = String(e.message).slice(0, 120); } }
    const ok = row.byHour.filter((b) => b[1] != null); if (ok.length) { row.free = Math.min(...ok.map((b) => b[1])); row.freeHour = ok.find((b) => b[1] === row.free)[0]; row.peak = Math.max(...ok.map((b) => b[1])); row.km = ok[0][2]; row.peakHour = ok.find((b) => b[1] === row.peak)[0]; } // free = хамгийн чөлөөтэй цагийн бодит хугацаа
    rows.push(row);
  }
  return { provider: commute.provider() === 'tomtom' ? 'TomTom Routing (түүхэн түгжрэл)' : 'Google Routes API (TRAFFIC_AWARE_OPTIMAL)', day: 'Ажлын өдөр (Мягмар)', rows, computed_at: new Date().toISOString() };
}

module.exports = { generate, computeStudy, WEST4, CENTER, CAT, WALK_OK, poiCat, poiRefine, poiSub, poiName, normName, nameSim, samePoi, clusterPois, genericName };
