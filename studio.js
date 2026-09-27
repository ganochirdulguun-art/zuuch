// «Зууч» — Листингийн AI студи (Ш3а MVP): зургийн шинжилгээ + зарын текст + давуу тал + үнийн стратеги + 30 хоногийн төлөвлөгөө
const fs = require('node:fs/promises');
let Anthropic = null;
try { Anthropic = require('@anthropic-ai/sdk'); } catch { /* сан байхгүй бол fallback */ }

const MODEL = process.env.ZUUCH_AI_MODEL || 'claude-sonnet-5';
const ROOM_ORDER = ['зочны', 'гал тогоо', 'унтлагын', 'угаалгын', 'коридор', 'тагт', 'гадна', 'харагдац', 'бусад'];
const KEY_ROOMS = ['зочны', 'гал тогоо', 'унтлагын', 'угаалгын', 'гадна'];

function client() {
  if (!Anthropic || !process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic();
}
// Загварын хариунаас JSON-ыг сугална: ```json ... ``` хашилт, өмнөх/дараах тайлбар текстийг үл тоож; олдохгүй бол null
function extractJSON(text) {
  const s = String(text || '');
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const cands = [fence && fence[1], s.match(/\[[\s\S]*\]/)?.[0], s.match(/\{[\s\S]*\}/)?.[0]].filter(Boolean);
  for (const c of cands) { try { return JSON.parse(c); } catch { /* дараагийнхыг үзнэ */ } }
  console.warn('[studio] JSON олдсонгүй, хариу:', s.slice(0, 200).replace(/\s+/g, ' '));
  return null;
}
const textOf = res => (res.content || []).map(c => c.text || '').join('');
// Бодох (thinking) токен max_tokens-д тооцогддог тул лимитийг өгөөмөр өгнө; таслагдвал шалтгааныг логлоно
const checkStop = (res, what) => { if (res.stop_reason !== 'end_turn') console.warn(`[studio] ${what}: stop_reason=${res.stop_reason}, output_tokens=${res.usage && res.usage.output_tokens}`); };

// ---- 1. Зургийн шинжилгээ (өрөө, чанар, wow, асуудал) ----
async function analyzePhotos(assets) {
  const ai = client();
  if (!ai || !assets.length) {
    return assets.map((a, i) => ({ id: a.id, room: 'тодорхойгүй', quality: 60, wow: 50 - i, issues: [] }));
  }
  const content = [];
  for (let i = 0; i < assets.length; i++) {
    const buf = await fs.readFile(assets[i].path);
    content.push({ type: 'text', text: `Зураг #${i + 1}` });
    content.push({ type: 'image', source: { type: 'base64', media_type: assets[i].mime || 'image/jpeg', data: buf.toString('base64') } });
  }
  content.push({ type: 'text', text: `Дээрх ${assets.length} зураг нь Улаанбаатар дахь нэг орон сууцны зарын зургууд. Зураг бүрд:
- room: ${ROOM_ORDER.join(' | ')} гэсэн ангиллаас нэгийг
- quality: 0–100 (гэрэл, хэвтээ тэнхлэг, тод байдал, эмх цэгц)
- wow: 0–100 (худалдан авагчийн анхаарлыг татах чадвар, эхний зураг болох чадвар)
- issues: Монголоор богино асуудлууд (ж: "бүдэг", "ташуу", "эмх цэгцгүй", "хүн харагдсан", "бичиг баримт харагдсан"), байхгүй бол []
ЗӨВХӨН JSON массив буцаа: [{"i":1,"room":"...","quality":80,"wow":70,"issues":[]}, ...]` });
  const res = await ai.messages.create({ model: MODEL, max_tokens: 6000, messages: [{ role: 'user', content }] });
  checkStop(res, 'зургийн шинжилгээ');
  const parsed = extractJSON(textOf(res));
  // JSON ирээгүй (ж: зураг танигдахгүй) бол студи унахгүй — анхдагч утгаар үргэлжилнэ
  const arr = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.photos) ? parsed.photos : []);
  return assets.map((a, i) => {
    const r = arr.find(x => Number(x.i) === i + 1) || {};
    return { id: a.id, room: ROOM_ORDER.includes(r.room) ? r.room : 'бусад', quality: clamp(r.quality, 60), wow: clamp(r.wow, 50), issues: Array.isArray(r.issues) ? r.issues.slice(0, 4) : [] };
  });
}
const clamp = (v, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : d; };

// ---- 2. Эрэмбэ: эхний зураг = хамгийн wow; дараа нь худалдан авагчийн аяллын дарааллаар ----
function rankPhotos(analyzed) {
  if (!analyzed.length) return [];
  const sorted = [...analyzed].sort((a, b) => b.wow - a.wow);
  const first = sorted[0];
  const rest = analyzed.filter(a => a.id !== first.id).sort((a, b) => {
    const ra = ROOM_ORDER.indexOf(a.room), rb = ROOM_ORDER.indexOf(b.room);
    return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb) || b.quality - a.quality;
  });
  return [first, ...rest].map((a, i) => ({ ...a, rank: i + 1 }));
}

// ---- 3. Зургийн зөвлөмж («дахин ав», дутуу өрөө, тоо) ----
function photoNotes(ranked) {
  const notes = [];
  const rooms = new Set(ranked.map(r => r.room));
  for (const k of KEY_ROOMS) if (!rooms.has(k)) notes.push(`«${k}» зураг алга — нэмж авна уу`);
  for (const r of ranked) if (r.quality < 55) notes.push(`#${r.rank} (${r.room}): чанар ${r.quality} — дахин авах (${r.issues.join(', ') || 'гэрэл/тэнхлэг'})`);
  if (ranked.length < 8) notes.push(`Зургийн тоо ${ranked.length} — зорилт 22–27 (өгөгдлөөр хамгийн үр дүнтэй)`);
  else if (ranked.length > 35) notes.push('35-аас олон зураг үзэлтийг бууруулдаг — хамгийн сайн 25-ыг үлдээ');
  if (!ranked.some(r => r.room === 'гадна')) notes.push('Гадна талын зургийг оройн бүрийд (twilight) авбал 12–32% хурдан зарагддаг');
  return notes;
}

// ---- 4. Давуу тал (А8 байршлын оноо + баримт) ----
function advantagesFrom(prop, loc) {
  const out = [];
  if (loc) {
    const cats = [['education', 'Сургууль, цэцэрлэг ойр'], ['transport', 'Нийтийн тээвэр, гол зам руу гарах хялбар'], ['commerce', 'Худалдаа үйлчилгээ төвлөрсөн'], ['health', 'Эмнэлэг, эмийн сан ойр'], ['parking', 'Авто зогсоолын хүртээмж сайн'], ['green', 'Ногоон байгууламж, тоглоомын талбайтай']];
    cats.filter(([k]) => Number(loc[k]) >= 75).sort((a, b) => loc[b[0]] - loc[a[0]]).slice(0, 3).forEach(([, t]) => out.push(t));
    if (loc.growth === 'high') out.push('Үнэ цэн эрчимтэй өсөх төлөвтэй бүс' + (loc.growth_note ? ' — ' + loc.growth_note : ''));
    else if (loc.growth === 'growing') out.push('Өсөх төлөвтэй бүс' + (loc.growth_note ? ' — ' + loc.growth_note : ''));
  }
  if (prop.is_new) out.push('Шинэ барилга');
  if (prop.floor && prop.total_floors && prop.floor > 1 && prop.floor < prop.total_floors) out.push(`${prop.floor}-р давхар (1 ба дээд давхар биш)`);
  return out.slice(0, 6);
}

// ---- 5. Үнийн стратеги (А3 интервалаас) ----
function priceStrategy(val, prop) {
  if (!val) return null;
  const cur = Number(prop.price) || val.estimate;
  return {
    current: cur,
    options: [
      { key: 'fast', label: 'Хурдан', price: Math.round(val.low * 10) / 10, days: '7–20 хоног', note: 'Индексийн P25 орчим — хамгийн олон үзэлт' },
      { key: 'balanced', label: 'Тэнцвэртэй', price: Math.round(val.estimate * 10) / 10, days: '20–45 хоног', note: 'Үнэлгээний төв — зах зээлийн бодит үнэ' },
      { key: 'premium', label: 'Дээд үнэ', price: Math.round(val.high * 10) / 10, days: '45–90 хоног', note: 'P75 — тэвчээртэй зарагчид; хугацаа уртасна' },
    ],
    position: cur && val.estimate ? Math.round((cur / val.estimate - 1) * 100) : null,
    confidence: val.confidence,
  };
}

// ---- 6. 30 хоногийн борлуулалтын төлөвлөгөө ----
function plan30(prop) {
  const t = prop.deal_type === 'rent' ? 'түрээслүүлэх' : 'зарах';
  return [
    { day: 1, task: 'Зарыг 3 сувагт нийтлэх (unegui, Facebook, сайт) — студийн текст, эрэмбэлсэн зургаар' },
    { day: 2, task: 'FB reel/бичлэг байршуулах; эзэмшигчид «нийтэлсэн» гэж мэдэгдэх' },
    { day: 3, task: 'Тохирсон хүсэлтүүдэд (А4) шууд санал илгээх, дуудлага хийх' },
    { day: 5, task: 'Эхний үзүүлэлтүүд — санал хүсэлтийг тэмдэглэх' },
    { day: 7, task: 'Шийдвэрийн цэг: үзэлт/хүсэлт цөөн бол зураг, гарчиг, эхний зургаа солих' },
    { day: 10, task: 'Follow-up: үзсэн бүх хүнтэй холбогдох' },
    { day: 14, task: 'Шийдвэрийн цэг: санал ирээгүй бол үнийн стратегийг «Хурдан» руу шилжүүлэх эсэхийг эзэмшигчтэй ярих' },
    { day: 21, task: 'Зараа шинэчлэн дахин нийтлэх (шинэлэг байдлын оноо)' },
    { day: 28, task: `Сарын тайлан: үзэлт, хүсэлт, санал — ${t} стратегийг дахин үнэлэх` },
  ];
}

// ---- 7. Зарын текст ×3 суваг (Claude; байхгүй бол загвар) ----
async function writeTexts(prop, loc, val, ranked, advantages) {
  const facts = `Төрөл: ${prop.deal_type === 'rent' ? 'түрээслүүлнэ' : 'зарна'}; Дүүрэг: ${prop.district}; Хороолол/байршил: ${prop.khoroolol || '—'}; Өрөө: ${prop.rooms}; Талбай: ${prop.area} м²; Давхар: ${prop.floor || '—'}/${prop.total_floors || '—'}; Барилга: ${prop.is_new ? 'шинэ' : 'хуучин'}; Үнэ: ${prop.price} сая ₮${prop.deal_type === 'rent' ? '/сар' : ''}; Агентын тэмдэглэл: ${prop.notes || '—'}`;
  const rooms = [...new Set(ranked.map(r => r.room))].filter(r => r !== 'бусад' && r !== 'тодорхойгүй').join(', ') || 'мэдээлэлгүй';
  const adv = advantages.join('; ') || '—';
  const ai = client();
  if (!ai) {
    const base = `${prop.district} дүүрэг, ${prop.khoroolol || ''} — ${prop.rooms} өрөө, ${prop.area} м² орон сууц ${prop.deal_type === 'rent' ? 'түрээслүүлнэ' : 'зарна'}. ${prop.is_new ? 'Шинэ барилга. ' : ''}${advantages.length ? advantages.join('. ') + '. ' : ''}Үнэ: ${prop.price} сая ₮${prop.deal_type === 'rent' ? '/сар' : ''}. Үзэх цаг товлохоор холбогдоно уу.`;
    return { unegui: base, facebook: `🏠 ${prop.district}, ${prop.rooms} өрөө ${prop.area} м² — ${prop.price} сая ₮\n${advantages.slice(0, 3).map(a => '✅ ' + a).join('\n')}\n📞 Үзэх цаг товлоорой!`, site: base, model: 'загвар (ANTHROPIC_API_KEY тохируулаагүй)' };
  }
  const prompt = `Та Монголын үл хөдлөх хөрөнгийн мэргэжлийн зар бичигч. Дараах БАРИМТ дээр л тулгуурлаж (тоо, байршлыг өөрчлөх, шинэ баримт зохиохгүй) Монголоор 3 хувилбар бич.
БАРИМТ: ${facts}
ЗУРАГТ ХАРАГДАХ ӨРӨӨНҮҮД: ${rooms}
ДАВУУ ТАЛУУД (баримт): ${adv}
${val ? `ЗАХ ЗЭЭЛИЙН ҮНЭЛГЭЭ (лавлагаа, зард бичихгүй): ~${val.estimate} сая (${val.low}–${val.high})` : ''}
Хувилбарууд:
1) unegui — 200–260 үг, бүтэцтэй (эхний өгүүлбэр гол давуу тал, дараа нь байр/орчин/нөхцөл, төгсгөлд дуудлага), түлхүүр үгс байгалиас
2) facebook — 60–90 үг, дулаан, emoji хэрэглэсэн, мөр мөрөөр
3) site — албан, 120–160 үг, брэндийн өнгө аястай
ЗӨВХӨН JSON: {"unegui":"...","facebook":"...","site":"..."}`;
  const res = await ai.messages.create({ model: MODEL, max_tokens: 8000, messages: [{ role: 'user', content: prompt }] });
  checkStop(res, 'зарын текст');
  const j = extractJSON(textOf(res));
  if (!j) throw new Error('AI зарын текстийг JSON хэлбэрээр буцаасангүй — дахин оролдоно уу');
  return { unegui: String(j.unegui || ''), facebook: String(j.facebook || ''), site: String(j.site || ''), model: MODEL };
}

// ---- Бүтэн урсгал ----
async function run({ property, assets, loc, val }) {
  const analyzed = await analyzePhotos(assets);
  const ranked = rankPhotos(analyzed);
  const notes = photoNotes(ranked);
  const advantages = advantagesFrom(property, loc);
  const texts = await writeTexts(property, loc, val, ranked, advantages);
  return { ranked, photo_notes: notes, advantages, texts, price: priceStrategy(val, property), plan: plan30(property), model: texts.model };
}

module.exports = { run, ROOM_ORDER };
