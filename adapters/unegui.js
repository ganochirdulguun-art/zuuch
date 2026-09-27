// «Зууч» — unegui.mn адаптер (Ш2, ажиглах горим)
// Зарчим: зөвхөн ил HTML (Next.js RSC payload), robots.txt-ийн зөвшөөрсөн зам, шударга UA, эелдэг хурд,
// баримт л авна (тайлбар/зураг/жинхэнэ утас хадгалахгүй). 304 дэмждэггүй тул хуудасны агуулгын хэшээр «өөрчлөлтгүй»-г тодорхойлно.
const crypto = require('node:crypto');

const BASE = 'https://www.unegui.mn';
// Ангиллууд: key → зам, хэлцлийн төрөл, объектын ангилал, нэр (2026-09-27 сайтаас)
const CATS = {
  sale: { path: '/l-hdlh/l-hdlh-zarna/oron-suuts-zarna/', dealType: 'sale', category: 'apartment', label: 'Орон сууц зарна', regStart: 6 },
  rent: { path: '/l-hdlh/l-hdlh-treesllne/oron-suuts/', dealType: 'rent', category: 'apartment', label: 'Орон сууц түрээс', regStart: 4 },
  house_sale: { path: '/l-hdlh/l-hdlh-zarna/a-o-s-hauszuslan/', dealType: 'sale', category: 'house', label: 'АОС/хаус/зуслан зарна', regStart: 2 },
  house_rent: { path: '/l-hdlh/l-hdlh-treesllne/aos-haus/', dealType: 'rent', category: 'house', label: 'АОС/хаус түрээс', regStart: 2 },
  hashaa_sale: { path: '/l-hdlh/l-hdlh-zarna/hashaa-bajshin/', dealType: 'sale', category: 'house', label: 'Хашаа байшин зарна', regStart: 2 },
  hashaa_rent: { path: '/l-hdlh/l-hdlh-treesllne/hashaa-bajshinger/', dealType: 'rent', category: 'house', label: 'Хашаа байшин/гэр түрээс', regStart: 2 },
  office_sale: { path: '/l-hdlh/l-hdlh-zarna/azhlyin-bajroffis-zarna/', dealType: 'sale', category: 'office', label: 'Оффис зарна', regStart: 2 },
  office_rent: { path: '/l-hdlh/l-hdlh-treesllne/azhlyin-bajroffis/', dealType: 'rent', category: 'office', label: 'Оффис түрээс', regStart: 2 },
  commerce_sale: { path: '/l-hdlh/l-hdlh-zarna/hudaldaa-jlchilgeenij-talbaj-zarna/', dealType: 'sale', category: 'commercial', label: 'Худалдаа үйлчилгээ зарна', regStart: 2 },
  commerce_rent: { path: '/l-hdlh/l-hdlh-treesllne/hudaldaa-jlchilgeenij-talbaj-treesllne/', dealType: 'rent', category: 'commercial', label: 'Худалдаа үйлчилгээ түрээс', regStart: 2 },
  object_sale: { path: '/l-hdlh/l-hdlh-zarna/obekt/', dealType: 'sale', category: 'object', label: 'Объект зарна', regStart: 2 },
  warehouse_sale: { path: '/l-hdlh/l-hdlh-zarna/garazhskladkont-r/', dealType: 'sale', category: 'warehouse', label: 'Гараж/склад/контейнер зарна', regStart: 2 },
  warehouse_rent: { path: '/l-hdlh/l-hdlh-treesllne/jldver-aguulah-treesllne/', dealType: 'rent', category: 'warehouse', label: 'Үйлдвэр/агуулах түрээс', regStart: 2 },
  land_sale: { path: '/l-hdlh/l-hdlh-zarna/gazar/', dealType: 'sale', category: 'land', label: 'Газар зарна', regStart: 2 },
};
const CONTACT = process.env.ZUUCH_BOT_CONTACT || 'smartzuuch.mn@gmail.com';
// HTTP толгой = зөвхөн ASCII (кирилл бичвэл fetch ByteString алдаа өгнө)
const UA = process.env.ZUUCH_BOT_UA || `ZuuchBot/1.0 (+https://zuuch-production.up.railway.app/bot; ${CONTACT}; read-only monitoring)`;
const MIN_GAP_MS = Number(process.env.ZUUCH_UNEGUI_GAP_MS || 4000); // хүсэлт хоорондын доод зай
const TIMEOUT_MS = 25000;
const DISTRICTS = ['Сүхбаатар', 'Хан-Уул', 'Баянгол', 'Баянзүрх', 'Чингэлтэй', 'Сонгинохайрхан', 'Налайх', 'Багануур', 'Багахангай'];
// robots.txt (2026-09-27): /api /meta /admin /moderator /profile */edit */hide */author */change_version/* /ru/ /en/ *---* /map/ /static/ /get_banner/
const DISALLOW_PREFIX = ['/api', '/meta', '/admin', '/moderator', '/profile', '/ru/', '/en/', '/map/', '/static/', '/get_banner/'];
function allowed(path) {
  const p = String(path || '');
  if (!p.startsWith('/')) return false;
  if (p.includes('---')) return false;
  if (DISALLOW_PREFIX.some((d) => p.startsWith(d))) return false;
  if (/\/(edit|hide|author)(\/|$)|\/change_version\//.test(p)) return false;
  return true;
}

// ---- HTTP: node:https (Cloudflare Node-ийн fetch/undici-г challenge-ээр хаадаг, https модуль нэвтэрдэг); gzip дэмжинэ, 1 redirect дагана ----
const https = require('node:https');
const zlib = require('node:zlib');
function httpsGet(url, hops = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'mn,en;q=0.5', 'Accept-Encoding': 'gzip, deflate' }, timeout: TIMEOUT_MS }, (res) => {
      const status = res.statusCode || 0;
      if ([301, 302, 307, 308].includes(status) && res.headers.location && hops < 1) {
        res.resume();
        const next = new URL(res.headers.location, BASE);
        if (next.origin !== BASE || !allowed(next.pathname)) return resolve({ status, html: '' });
        return resolve(httpsGet(next.href, hops + 1));
      }
      const enc = String(res.headers['content-encoding'] || '');
      const stream = enc.includes('gzip') ? res.pipe(zlib.createGunzip()) : enc.includes('deflate') ? res.pipe(zlib.createInflate()) : res;
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => resolve({ status, html: status === 200 ? Buffer.concat(chunks).toString('utf8') : '' }));
      stream.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout ' + TIMEOUT_MS + 'ms')));
    req.on('error', reject);
  });
}

// ---- Эелдэг татагч: нэг эгнээ, MIN_GAP_MS зай, 429/503-д хөргөлт ----
const net = { lastAt: 0, cooldownUntil: 0, chain: Promise.resolve(), requests: 0, bytes: 0, lastStatus: null };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function politeFetch(path) {
  if (!allowed(path)) return Promise.reject(new Error('robots.txt хориотой зам: ' + path));
  const run = async () => {
    if (Date.now() < net.cooldownUntil) throw new Error('хөргөлтийн хугацаа (429/5xx дараах)');
    const wait = net.lastAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    net.lastAt = Date.now();
    const res = await httpsGet(BASE + path);
    net.requests++; net.lastStatus = res.status;
    if (res.status === 429 || res.status >= 500) { net.cooldownUntil = Date.now() + 10 * 60000; throw new Error('HTTP ' + res.status + ' — 10 мин хөргөлт'); }
    net.bytes += res.html.length;
    return res;
  };
  const p = net.chain.then(run, run);
  net.chain = p.catch(() => {});
  return p;
}

// ---- Next.js RSC payload: self.__next_f.push([1,"..."]) хэсгүүдийг нэгтгэнэ ----
function rscBlob(html) {
  const s = String(html || ''); const prefix = 'self.__next_f.push([1,"'; const parts = [];
  let i = 0;
  while ((i = s.indexOf(prefix, i)) >= 0) {
    let j = i + prefix.length; let out = '';
    while (j < s.length) {
      const c = s[j];
      if (c === '\\') { out += s.slice(j, j + 2); j += 2; continue; }
      if (c === '"') break;
      out += c; j++;
    }
    try { parts.push(JSON.parse('"' + out + '"')); } catch { /* эвдэрсэн хэсэг — алгасна */ }
    i = j;
  }
  return parts.join('');
}
// Хаалт тэнцүүлж JSON утгыг сугална (start = '[' эсвэл '{' байрлал)
function balancedJson(s, start) {
  const open = s[start]; if (open !== '[' && open !== '{') return null;
  let depth = 0, inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') { depth--; if (depth === 0) { try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

// ---- Талбарын хөрвүүлэлт ----
function relDays(txt) {
  const t = String(txt || '').trim();
  if (!t) return null;
  if (/өнөөдөр|минутын өмнө|цагийн өмнө|секунд/i.test(t)) return 0;
  if (/өчигдөр/i.test(t)) return 1;
  let m = t.match(/(\d+)\s*өдрийн өмнө/i); if (m) return Number(m[1]);
  m = t.match(/(\d+)\s*долоо хоногийн өмнө/i); if (m) return Number(m[1]) * 7;
  m = t.match(/(\d+)\s*сарын өмнө/i); if (m) return Number(m[1]) * 30;
  m = t.match(/(\d{4})-(\d{2})-(\d{2})/); if (m) return Math.max(0, Math.round((Date.now() - Date.parse(m[0])) / 864e5));
  return null;
}
function areaFromTitle(title) {
  const m = String(title || '').match(/(\d{2,3}(?:[.,]\d{1,2})?)\s*(?:м2|м²|мкв|mkv|m2|кв\.?м|мк\b)/i);
  if (!m) return null;
  const v = parseFloat(m[1].replace(',', '.'));
  return v >= 12 && v <= 600 ? v : null;
}
function roomsFromSlug(slug) {
  const m = String(slug || '').match(/^(\d)-r$/); return m ? Number(m[1]) : null;
}
const hashKey = (k, salt) => crypto.createHash('sha256').update(salt + '|' + k).digest('hex').slice(0, 20);

// ---- Жагсаалтын хуудас → түүхий зарууд (баримт л) ----
function parseList(html, catKey = 'sale') {
  const cat = CATS[catKey] || CATS.sale; const dealType = cat.dealType;
  const blob = rscBlob(html);
  const k = blob.indexOf('"adverts":[');
  if (k < 0) return { adverts: [], hash: null };
  const arr = balancedJson(blob, k + '"adverts":'.length) || [];
  const adverts = arr.map((a) => {
    const loc = String(a.location || '').split(' — ').map((x) => x.trim());
    const slug = a.rubric && a.rubric.slug;
    const rooms = roomsFromSlug(slug);
    const isRoom = slug === 'hazhuu-r';
    // Орон сууцны ангилалд өрөөний slug (N-r) шаардана; бусад ангилалд (оффис, объект, газар…) ангиллыг замаас авна
    const category = cat.category === 'apartment' ? (isRoom ? 'room' : rooms ? 'apartment' : 'other') : cat.category;
    return {
      source: 'unegui', source_id: String(a.id), deal_type: dealType, cat: catKey,
      title: String(a.title || '').trim(),
      category,
      cityText: loc[0] || '', districtText: loc[1] || '', khoroolol: loc[2] || '', // «Улаанбаатар — Дүүрэг — Хороолол» эсвэл «Аймаг — Сум — …»
      roomsText: rooms ? String(rooms) : '',
      areaText: areaFromTitle(a.title) != null ? String(areaFromTitle(a.title)) : '',
      priceText: a.price_without_currency ? String(Number(a.price_without_currency) / 1e6) : '',
      priceNegotiable: /тохирно/i.test(a.price_description || ''),
      images: Number(a.img_count) || 0,
      postedDaysAgo: relDays(a.published),
      publishedText: a.published || '',
      is_new: a.is_new ? 1 : 0,
      is_business: !!(a.user && a.user.is_bussiness),
      ad_type: (a.ad_type && a.ad_type.type) || 'regular',
      contactKey: a.user && a.user.id ? 'unegui-user-' + a.user.id : '',
      poster_name: String((a.user && a.user.name) || '').slice(0, 80), // нийтлэгчийн нэр (нийтэд ил) — эзэн/агент/компани ангилахад
      poster_verified: !!(a.user && (a.user.verified || a.user.emongolia_verified)),
      url: a.url ? BASE + a.url : '',
      descr: '',
      phone: '',
    };
  });
  const hash = crypto.createHash('sha1').update(adverts.map((a) => a.source_id + ':' + a.priceText).join(',')).digest('hex').slice(0, 12);
  return { adverts, hash };
}

// ---- Дэлгэрэнгүй хуудас → атрибутууд (талбай, давхар, он) ----
function parseDetail(html) {
  const blob = rscBlob(html);
  const out = { area: null, floor: null, total_floors: null, built_year: null, date_published: null, attrs: {} };
  // Хоосон зайд тэсвэртэй (сайт: {"name":"Талбай"}, фикстур: {"name": "Талбай"})
  const m = /\{\s*"name"\s*:\s*"Талбай"/.exec(blob); const k = m ? m.index : -1;
  let start = k >= 0 ? blob.lastIndexOf('[{', k) : -1;
  if (start < 0) { const m2 = /\[\s*\{\s*"name"\s*:/.exec(blob); start = m2 ? m2.index : -1; }
  const attrs = start >= 0 ? balancedJson(blob, start) : null;
  if (Array.isArray(attrs)) {
    for (const a of attrs) if (a && a.name) out.attrs[a.name] = String(a.value ?? '');
    const num = (s) => { const m = String(s || '').replace(',', '.').match(/[\d.]+/); return m ? parseFloat(m[0]) : null; };
    out.area = num(out.attrs['Талбай']);
    out.floor = num(out.attrs['Хэдэн давхарт']);
    out.total_floors = num(out.attrs['Барилгын давхар']);
    out.built_year = num(out.attrs['Ашиглалтанд орсон он']);
  }
  const dp = blob.match(/"datePublished":"(\d{4}-\d{2}-\d{2})"/); if (dp) out.date_published = dp[1];
  return out;
}

// ---- Нэг мөчлөг: ангилал бүрд VIP толгой (1-р хуудас) + энгийн зарын толгой хуудас ----
const regStart = Object.fromEntries(Object.entries(CATS).map(([k, c]) => [k, c.regStart || 2]));
async function fetchPage(catKey, page) {
  const cat = CATS[catKey]; if (!cat) throw new Error('ангилал алга: ' + catKey);
  const path = cat.path + (page > 1 ? `?page=${page}` : '');
  const r = await politeFetch(path);
  const parsed = parseList(r.html, catKey);
  return { page, status: r.status, ...parsed };
}
// Нэг ангиллын мөчлөг: VIP толгой (1-р хуудас) + энгийн зарын эхний хуудас (+1 бүгд шинэ бол)
async function cycle(catKey, opts = {}) {
  const cat = CATS[catKey]; if (!cat) throw new Error('ангилал алга: ' + catKey);
  const maxPages = opts.maxPages || 4;
  const pages = []; const seen = new Set(); const adverts = [];
  const push = (p) => { pages.push({ page: p.page, n: p.adverts.length, hash: p.hash, status: p.status }); for (const a of p.adverts) if (!seen.has(a.source_id)) { seen.add(a.source_id); adverts.push(a); } };
  const first = await fetchPage(catKey, 1); push(first);
  // Жижиг ангилалд 1-р хуудсанд энгийн зар шууд байдаг → нэмэлт хуудас хэрэггүй
  if (first.adverts.some((a) => a.ad_type === 'regular') && first.adverts.length < 60) return { catKey, dealType: cat.dealType, category: cat.category, label: cat.label, pages, adverts };
  let p = Math.max(2, regStart[catKey]); let found = first.adverts.some((a) => a.ad_type === 'regular') ? first : null;
  for (let tries = 0; !found && tries < 3 && pages.length < maxPages; tries++) {
    const pg = await fetchPage(catKey, p);
    push(pg);
    const firstRegular = pg.adverts.findIndex((a) => a.ad_type === 'regular');
    if (firstRegular === 0 && p > 2) { regStart[catKey] = p - 1; found = pg; break; }
    if (firstRegular > 0) { regStart[catKey] = p; found = pg; break; }
    if (!pg.adverts.length) break;
    p++;
  }
  if (found && opts.knownIds && pages.length < maxPages) {
    const regs = found.adverts.filter((a) => a.ad_type === 'regular');
    if (regs.length && regs.every((a) => !opts.knownIds.has(a.source_id))) push(await fetchPage(catKey, p + 1));
  }
  return { catKey, dealType: cat.dealType, category: cat.category, label: cat.label, pages, adverts };
}
async function detail(url) {
  const path = String(url || '').replace(BASE, '');
  if (!/^\/adv\//.test(path)) throw new Error('дэлгэрэнгүйн зам биш');
  const r = await politeFetch(path);
  return { status: r.status, ...(r.status === 200 ? parseDetail(r.html) : {}) };
}
// Зар сайт дээр хэвээр байгаа эсэх (404/410 = хасагдсан)
async function stillListed(url) {
  const path = String(url || '').replace(BASE, '');
  if (!/^\/adv\//.test(path)) return null;
  const r = await politeFetch(path);
  if (r.status === 404 || r.status === 410) return false;
  if (r.status !== 200) return null;
  return !/зар идэвхгүй|зар олдсонгүй|устгагдсан/i.test(r.html.slice(0, 200000)) ;
}
function stats() { return { ua: UA, requests: net.requests, bytes: net.bytes, lastStatus: net.lastStatus, cooldownUntil: net.cooldownUntil || null, regStart: { ...regStart }, gapMs: MIN_GAP_MS, cats: Object.fromEntries(Object.entries(CATS).map(([k, c]) => [k, c.label])) }; }

module.exports = { allowed, rscBlob, balancedJson, relDays, areaFromTitle, roomsFromSlug, parseList, parseDetail, cycle, detail, stillListed, stats, hashKey, DISTRICTS, BASE, UA, CATS };
