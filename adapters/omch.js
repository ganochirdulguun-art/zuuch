// «Зууч» — omch.mn адаптер (ажиглах горим)
// Эх: sitemap (хайлтын системд зориулсан бүх идэвхтэй зарын жагсаалт, lastmod-той) → зөвхөн шинэ/өөрчлөгдсөн зарын хуудас →
// schema.org RealEstateListing JSON-LD + breadcrumb (хэлцэл/дүүрэг/төрөл). Баримт л авна: тайлбар, зураг, нэр хадгалахгүй; утсыг давсласан хэш болгоно.
// robots.txt (2026-09-30): Disallow /api/ /dashboard /auth /favorites — хуудаслалтын API-г (/api/) ашиглахгүй.
const { makeFetcher, UA } = require('./polite');
const geo = require('./geo');

const BASE = 'https://omch.mn';
const allowed = (p) => typeof p === 'string' && p.startsWith('/') && !/^\/(api\/|dashboard|auth|favorites)/.test(p);
const f = makeFetcher({ base: BASE, allowed, gapMs: Number(process.env.ZUUCH_OMCH_GAP_MS || 5000) });

// breadcrumb-ийн төрлийн slug → манай ангилал
const TYPE = { apartment: 'apartment', 'new-apartment': 'apartment', 'used-apartment': 'apartment', house: 'house', townhouse: 'house', 'hashaa-baishin': 'house', office: 'office', 'service-space': 'commercial', commercial: 'commercial', object: 'object', warehouse: 'warehouse', garage: 'warehouse', land: 'land', room: 'room' };
const UUID = /\/listing\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

// Бүх зарын жагсаалт: [{ id, url, lastmod }]
async function sitemap() {
  const idx = await f.fetch('/sitemap.xml');
  if (idx.status !== 200) throw new Error('sitemap HTTP ' + idx.status);
  const maps = [...idx.html.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => /\/sitemaps\/listings-\d+\.xml$/.test(u));
  const out = [];
  for (const u of maps) {
    const r = await f.fetch(new URL(u).pathname);
    if (r.status !== 200) throw new Error('listings sitemap HTTP ' + r.status);
    for (const m of r.html.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*(?:<lastmod>([^<]+)<\/lastmod>)?/g)) {
      const id = (m[1].match(UUID) || [])[1];
      if (id) out.push({ id, url: BASE + '/listing/' + id, lastmod: m[2] || null });
    }
  }
  return out;
}

function ldBlocks(html) {
  const out = [];
  for (const m of String(html).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { const j = JSON.parse(m[1]); out.push(...(Array.isArray(j) ? j : [j])); } catch { /* эвдэрсэн — алгасна */ }
  }
  return out;
}
const daysSince = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 864e5)) : null; };

// Дэлгэрэнгүй хуудас → зарын түүхий мөр (collector.normalize-ийн хэлбэр)
function parseDetail(html, id) {
  const blocks = ldBlocks(html);
  const L = blocks.find((b) => b['@type'] === 'RealEstateListing'); if (!L) return null;
  const crumbs = ((blocks.find((b) => b['@type'] === 'BreadcrumbList') || {}).itemListElement || []).map((x) => String(x.item || ''));
  // …/sale|rent/<дүүрэг>/<төрөл>
  const path = crumbs.map((u) => { try { return new URL(u).pathname.split('/').filter(Boolean); } catch { return []; } }).filter((p) => p[0] === 'sale' || p[0] === 'rent').sort((a, b) => b.length - a.length)[0] || [];
  const place = L.about || {}; const addr = place.address || {}; const offer = L.offers || {};
  const fn = String(offer.businessFunction || '');
  const deal = path[0] === 'rent' || /LeaseOut/i.test(fn) ? 'rent' : 'sale';
  const typeSlug = path[2] || '';
  const title = String(L.name || '').trim();
  const district = geo.districtFromName(addr.addressLocality) || geo.districtFromSlug(path[1]) || geo.districtOf(title);
  const khoroo = (String(addr.streetAddress || '').match(/(\d+)-р хороо/) || [])[1];
  const city = /улаанбаатар/i.test(addr.addressRegion || '') || geo.UB.includes(district) ? 'Улаанбаатар' : String(addr.addressRegion || '').slice(0, 40);
  const phone = (String(html).match(new RegExp('propertyId\\\\?":\\\\?"' + id + '\\\\?",\\\\?"phone\\\\?":\\\\?"(\\d{8})')) || [])[1] || '';
  const price = Number(offer.price) || 0;
  const area = Number(place.floorSize && place.floorSize.value) || geo.areaOf(title);
  return {
    source: 'omch', source_id: id, deal_type: deal, title,
    category: TYPE[typeSlug] || (typeSlug ? 'other' : 'apartment'),
    cityText: city, districtText: district || '', khoroolol: khoroo ? khoroo + '-р хороо' : '',
    roomsText: geo.roomsOf(title) ? String(geo.roomsOf(title)) : '',
    areaText: area ? String(area) : '',
    priceText: price ? String(price / 1e6) : '',
    images: Array.isArray(L.image) ? L.image.length : 0,
    postedDaysAgo: daysSince(L.datePosted),
    is_new: /new-apartment|шинэ/i.test(typeSlug + ' ' + title) ? 1 : 0,
    is_business: 0, ad_type: 'regular',
    phone: phone ? '+976' + phone : '', contactKey: '',
    url: BASE + '/listing/' + id, descr: '',
    active: !/OutOfStock|SoldOut|Discontinued/i.test(String(offer.availability || '')),
  };
}

async function detail(entry) {
  const r = await f.fetch('/listing/' + entry.id);
  if (r.status === 404 || r.status === 410) return { gone: true };
  if (r.status !== 200) throw new Error('HTTP ' + r.status);
  return { raw: parseDetail(r.html, entry.id) };
}

function stats() { return { ua: UA, base: BASE, ...f.stats() }; }
module.exports = { name: 'omch', label: 'omch.mn', BASE, allowed, sitemap, parseDetail, detail, stats };
