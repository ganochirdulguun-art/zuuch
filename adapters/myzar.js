// «Зууч» — my-zar.mn (OSMO) адаптер (ажиглах горим)
// Эх: үл хөдлөхийн дэд ангиллын жагсаалт хуудсууд (сервер талд зурагддаг, 50 зар/хуудас). Картаас л баримт авна
// (гарчиг, үнэ, огноо) — дэлгэрэнгүй хуудас татахгүй тул сайтад ачаалал бага. Байршил/талбай/өрөөг гарчгаас болгоомжтой таамаглана.
// robots.txt (2026-09-30): Allow /zar* /zaruud/* /page* · Disallow /static /resource /sms
const { makeFetcher, UA, stripTags } = require('./polite');
const geo = require('./geo');

const BASE = 'https://www.my-zar.mn';
const allowed = (p) => typeof p === 'string' && /^\/(zar|zaruud|page)/.test(p) && !/^\/(static|resource|sms)/.test(p);
const f = makeFetcher({ base: BASE, allowed, gapMs: Number(process.env.ZUUCH_MYZAR_GAP_MS || 5000) });

// deal: ангиллаас тодорхой бол 'sale'/'rent', холимог бол null (гарчиг/дэлгэрэнгүйгээс)
const CATS = {
  apt_sale: { path: '/zaruud/1801-bair-zarna', category: 'apartment', deal: 'sale', label: 'Байр зарна' },
  apt_rent: { path: '/zaruud/1803-tureesluulne', category: 'apartment', deal: 'rent', label: 'Байр түрээслүүлнэ' },
  hashaa: { path: '/zaruud/600-hashaa-baishin-zarna', category: 'house', deal: 'sale', label: 'Хашаа байшин зарна' },
  aos: { path: '/zaruud/603-' + encodeURIComponent('аос-зуслан-хаус') + '-aos-zuslan-house', category: 'house', deal: null, label: 'АОС, зуслан, хаус' },
  land: { path: '/zaruud/613-gazar-zarna', category: 'land', deal: 'sale', label: 'Газар зарна' },
  office: { path: '/zaruud/615-ajliin-bair-offis', category: 'office', deal: null, label: 'Ажлын байр, оффис' },
  object: { path: '/zaruud/618-uildver-uilchilgeenii-obiekt-zarna', category: 'object', deal: 'sale', label: 'Объект зарна' },
  garage: { path: '/zaruud/627-graj-konteiner', category: 'warehouse', deal: null, label: 'Гараж, контейнер' },
};
const FRESH_PAGES = 2;      // мөчлөг бүрт шинэ зарын хуудас
const BACKFILL_PAGES = 2;   // мөчлөг бүрт хуучин зарын хуудас (эхний бүрэн цуглуулалт аажмаар)
const DETAIL_PER_CYCLE = 5;  // үнэтэй боловч дүүрэггүй ШИНЭ зарын дэлгэрэнгүйг нэг мөчлөгт хамгийн ихдээ
const backfill = {};        // ангилал → дараагийн хуучин хуудас

function daysAgo(txt) {
  const t = String(txt || '').trim();
  if (/мин|цаг|сек|саяхан|өнөөдөр/i.test(t)) return 0;
  if (/өчигдөр/i.test(t)) return 1;
  const d = t.match(/(\d+)\s*өдөр/); if (d) return Number(d[1]);
  const iso = Date.parse(t); return Number.isFinite(iso) ? Math.max(0, Math.floor((Date.now() - iso) / 864e5)) : null;
}

function parseList(html, catKey) {
  const cat = CATS[catKey]; const out = []; const s = String(html);
  // Карт бүр: <a … href="/zar/ID-…" [onclick=…] class="my-ad-card" title="…"> … дараагийн карт хүртэл
  const heads = [...s.matchAll(/<a\s[^>]*href="\/zar\/(\d+)-[^"]*"[^>]*class="my-ad-card"[^>]*title="([^"]*)"[^>]*>/g)];
  heads.forEach((h, i) => {
    const body = s.slice(h.index, i + 1 < heads.length ? heads[i + 1].index : h.index + 6000);
    const id = h[1]; const title = stripTags(h[2]);
    const priceTxt = stripTags((body.match(/my-ad-card__price">([\s\S]*?)<\/div>/) || [])[1] || '');
    const published = stripTags((body.match(/my-ad-card__published">([\s\S]*?)<\/div>/) || [])[1] || '');
    const img = Number((stripTags((body.match(/my-ad-card__ic">([\s\S]*?)<\/div>/) || [])[1] || '').match(/\d+/) || [0])[0]);
    const pm = priceTxt.replace(/[,\s]/g, '').match(/(\d{4,})/);
    const rent = cat.deal ? cat.deal === 'rent' : geo.isRent(title);
    let price = pm ? Number(pm[1]) : 0;
    // Худалдах байр/байшинд 15 саяас доош «үнэ» = урьдчилгаа/м²-ийн үнэ байх магадлалтай → индекс бохирдуулахгүйн тулд үнэгүй гэж үзнэ
    if (!rent && ['apartment', 'house', 'office', 'object'].includes(cat.category) && price < 15e6) price = 0;
    if (price > 1e11 || (rent && price < 1e5)) price = 0;
    const rooms = geo.roomsOf(title), area = geo.areaOf(title);
    out.push({
      source: 'myzar', source_id: id, deal_type: rent ? 'rent' : 'sale', title,
      category: cat.category === 'apartment' && /хажуу өрөө|нийтийн байр|дотуур байр/i.test(title) ? 'room' : cat.category,
      cityText: 'Улаанбаатар', districtText: geo.districtOf(title) || '', khoroolol: '',
      roomsText: rooms ? String(rooms) : '', areaText: area ? String(area) : '',
      priceText: price ? String(price / 1e6) : '',
      images: img || 0, postedDaysAgo: daysAgo(published), publishedText: published,
      is_new: /шинэ байр|шинэ орон сууц|ашиглалтад орсон/i.test(title) ? 1 : 0,
      is_business: 0, ad_type: 'regular', contactKey: '', phone: '',
      url: BASE + '/zar/' + id, descr: '',
    });
  });
  const total = Number(((String(html).match(/ad-counter">([\d,\s]+)</) || [])[1] || '').replace(/[,\s]/g, '')) || null;
  return { adverts: out, total };
}

// Дэлгэрэнгүй: гарчиг + тайлбар (зөвхөн байршил/талбай/өрөө таних; тайлбарыг хадгалахгүй), breadcrumb-ийн өрөө, нийтлэгчийн ID
function parseDetail(html) {
  const s = String(html);
  const text = stripTags((s.match(/<h1 class="my-ad__name">([\s\S]*?)<\/h1>/) || [])[1] || '') + ' ' + stripTags((s.match(/class="my-ad__text">([\s\S]*?)<\/div>/) || [])[1] || '');
  const crumbRooms = (s.match(/\/zaruud\/\d+-(\d)-uruu-bair/) || [])[1];
  const user = (s.match(/href="\/user\/(\d+)\/zaruud"/) || [])[1];
  const rentCrumb = /\/zaruud\/\d+-[^"]*tureesl/.test(s);
  return { district: geo.districtOf(text), area: geo.areaOf(text), rooms: crumbRooms ? Number(crumbRooms) : geo.roomsOf(text), user, rentCrumb, rentText: geo.isRent(text) };
}
async function enrich(a) {
  a._detailTried = true;
  const r = await f.fetch('/zar/' + a.source_id);
  if (r.status !== 200) return false;
  const d = parseDetail(r.html);
  if (d.district) a.districtText = d.district;
  if (!a.areaText && d.area) a.areaText = String(d.area);
  if (!a.roomsText && d.rooms) a.roomsText = String(d.rooms);
  if (d.user) a.contactKey = 'myzar-user-' + d.user; // нийтлэгчийн сайт дээрх ID (collector давсласан хэш болгоно)
  return true;
}

async function fetchPage(catKey, page) {
  const cat = CATS[catKey];
  const r = await f.fetch(cat.path + (page > 1 ? `?page=${page}&size=50` : ''));
  if (r.status !== 200) throw new Error(cat.label + ' HTTP ' + r.status);
  return { page, ...parseList(r.html, catKey) };
}

// Нэг ангиллын мөчлөг: эхний FRESH_PAGES хуудас + хуучин зарын BACKFILL_PAGES хуудас (дуусвал дахин эхнээс)
async function cycle(catKey, opts = {}) {
  const cat = CATS[catKey]; if (!cat) throw new Error('ангилал алга: ' + catKey);
  const isKnown = opts.isKnown || (() => false);
  const seen = new Set(); const adverts = []; const pages = [];
  const push = (p) => { pages.push({ page: p.page, n: p.adverts.length }); for (const a of p.adverts) if (!seen.has(a.source_id)) { seen.add(a.source_id); adverts.push(a); } };
  let total = null;
  for (let p = 1; p <= FRESH_PAGES; p++) { const pg = await fetchPage(catKey, p); total = total || pg.total; push(pg); if (pg.adverts.length < 50) break; }
  const last = total ? Math.ceil(total / 50) : 0;
  let b = backfill[catKey] || FRESH_PAGES + 1;
  for (let k = 0; k < BACKFILL_PAGES && last && b <= last; k++, b++) {
    const pg = await fetchPage(catKey, b); push(pg);
    // Хуудас бүхэлдээ 90+ хоногийн хуучин зар (хадгалалтын хугацаанаас гадуур) эсвэл хоосон → цааш гүнзгийрэхгүй, эхнээс нь
    if (!pg.adverts.length || pg.adverts.every((a) => a.postedDaysAgo != null && a.postedDaysAgo > 90)) { b = last + 1; break; }
  }
  backfill[catKey] = b > last ? FRESH_PAGES + 1 : b;
  let details = 0;
  for (const a of adverts) {
    if (details >= DETAIL_PER_CYCLE) break;
    if (a.districtText || !a.priceText || a.category === 'room' || isKnown(a.source_id)) continue;
    details++;
    try { await enrich(a); } catch { /* дараагийн мөчлөгт */ }
  }
  return { catKey, label: cat.label, pages, adverts, total, details };
}

function stats() { return { ua: UA, base: BASE, backfill: { ...backfill }, ...f.stats() }; }
module.exports = { name: 'myzar', label: 'my-zar.mn (OSMO)', BASE, CATS, allowed, parseList, parseDetail, cycle, stats };
