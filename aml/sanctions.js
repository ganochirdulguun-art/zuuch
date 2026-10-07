// «Зууч» МУТСТ — хориг арга хэмжээний жагсаалт (санхүүгийн зорилтот хориг).
// Заавал шалгах жагсаалт: НҮБ-ын Аюулгүйн зөвлөлийн нэгдсэн жагсаалт + Засгийн газрын баталсан дотоодын жагсаалт (ҮОХЗДТТХ 3.1.17–3.1.18, УСҮАЖ 14.2).
// НҮБ-ынхыг албан ёсны XML-ээс өдөр бүр татна; дотоодын жагсаалтыг (nctc.gov.mn) платформын эзэн гараар оруулна.
'use strict';
const rules = require('./rules');

const UN_URL = process.env.ZUUCH_UN_LIST_URL || 'https://scsanctions.un.org/resources/xml/en/consolidated.xml';
let DB = null; let cache = null; let meta = { un: null, mn: null, lastError: null };

const unxml = (s) => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&').trim();
const tag = (blk, t) => { const m = new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(blk); return m ? unxml(m[1]) : ''; };
const all = (blk, t) => { const out = []; const re = new RegExp(`<${t}>([\\s\\S]*?)</${t}>`, 'g'); let m; while ((m = re.exec(blk))) out.push(m[1]); return out; };

// НҮБ-ын XML → [{ source:'UN', ref, kind, names[], dob[], nationality, listed_on, info }]
function parseUN(xml) {
  const out = [];
  for (const [wrapTag, kind, aliasTag] of [['INDIVIDUAL', 'individual', 'INDIVIDUAL_ALIAS'], ['ENTITY', 'entity', 'ENTITY_ALIAS']]) {
    for (const b of all(xml, wrapTag)) {
      const ref = tag(b, 'REFERENCE_NUMBER') || tag(b, 'DATAID'); if (!ref) continue;
      const main = ['FIRST_NAME', 'SECOND_NAME', 'THIRD_NAME', 'FOURTH_NAME'].map((t) => tag(b, t)).filter(Boolean).join(' ');
      const names = [main, tag(b, 'NAME_ORIGINAL_SCRIPT'), ...all(b, aliasTag).map((a) => tag(a, 'ALIAS_NAME'))].filter((n) => n && n.length > 1);
      const dob = all(b, 'INDIVIDUAL_DATE_OF_BIRTH').map((d) => tag(d, 'DATE') || tag(d, 'YEAR')).filter(Boolean);
      const nat = all(b, 'NATIONALITY').map((n) => all(n, 'VALUE').map(unxml).join(', ')).join(', ');
      out.push({ source: 'UN', ref, kind, names: [...new Set(names)], dob, nationality: nat, listed_on: tag(b, 'LISTED_ON'), info: (tag(b, 'UN_LIST_TYPE') + ' · ' + tag(b, 'COMMENTS1')).slice(0, 600) });
    }
  }
  return out;
}

async function load(db) {
  DB = db || DB; if (!DB) return [];
  const rows = await DB.all('SELECT id, source, ref, kind, names, dob, nationality, listed_on FROM aml_sanctions');
  cache = rows.map((r) => ({ ...r, names: r.names || [], dob: r.dob || [] }));
  const m = await DB.all("SELECT source, COUNT(*)::int n, MAX(updated_at) at FROM aml_sanctions GROUP BY source");
  for (const r of m) meta[r.source === 'UN' ? 'un' : 'mn'] = { n: r.n, at: r.at };
  return cache;
}
const entries = async () => cache || load();

// НҮБ-ын жагсаалт шинэчлэх: бүрэн солих (жагсаалтаас хасагдсаныг устгана)
async function refreshUN({ fetchImpl = fetch, xml } = {}) {
  try {
    if (!xml) { const r = await fetchImpl(UN_URL, { headers: { 'User-Agent': 'Zuuch-AML/1.0' } }); if (!r.ok) throw new Error('НҮБ-ын жагсаалт татагдсангүй: HTTP ' + r.status); xml = await r.text(); }
    const gen = /dateGenerated="([^"]+)"/.exec(xml); const list = parseUN(xml);
    if (list.length < 100) throw new Error(`НҮБ-ын жагсаалт хэт цөөн (${list.length}) — хадгалсангүй`);
    await DB.tx(async (t) => {
      await t.run("DELETE FROM aml_sanctions WHERE source='UN'");
      for (const e of list) await t.run('INSERT INTO aml_sanctions (source, ref, kind, names, dob, nationality, listed_on, info) VALUES (?,?,?,?::jsonb,?::jsonb,?,?,?) ON CONFLICT (source, ref) DO NOTHING', 'UN', e.ref, e.kind, JSON.stringify(e.names), JSON.stringify(e.dob), e.nationality, e.listed_on, e.info);
    });
    meta.lastError = null; meta.generated = gen ? gen[1] : null; await load();
    return { ok: true, n: list.length, generated: meta.generated };
  } catch (e) { meta.lastError = { at: new Date().toISOString(), msg: e.message }; throw e; }
}

async function addNational(e) {
  const names = (Array.isArray(e.names) ? e.names : String(e.names || '').split(/[;\n]/)).map((s) => String(s).trim()).filter((s) => s.length > 1);
  if (!names.length) throw new Error('Нэр оруулна уу');
  const ref = String(e.ref || '').trim() || 'MN-' + Date.now().toString(36);
  await DB.run('INSERT INTO aml_sanctions (source, ref, kind, names, dob, nationality, listed_on, info) VALUES (?,?,?,?::jsonb,?::jsonb,?,?,?) ON CONFLICT (source, ref) DO UPDATE SET names=EXCLUDED.names, dob=EXCLUDED.dob, kind=EXCLUDED.kind, info=EXCLUDED.info, updated_at=NOW()',
    'MN', ref, e.kind === 'entity' ? 'entity' : 'individual', JSON.stringify(names), JSON.stringify(e.dob ? [String(e.dob)] : []), String(e.nationality || ''), String(e.listed_on || ''), String(e.info || '').slice(0, 600));
  await load(); return { ok: true, ref };
}
async function removeNational(ref) { await DB.run("DELETE FROM aml_sanctions WHERE source='MN' AND ref=?", ref); await load(); }

// Профайлын бүх нэрийг (кирилл + латин, эцсийн өмчлөгч, төлөөлөгч) жагсаалттай тулгана
function profileNames(p) {
  const d = p.data || {}; const out = [];
  if (p.kind === 'legal') { if (d.name) out.push({ names: [d.name, d.name_latin].filter(Boolean), kind: 'entity', who: 'Хуулийн этгээд' }); if (d.rep_name) out.push({ names: [d.rep_name], kind: 'individual', who: 'Төлөөлөгч' }); }
  else out.push({ names: [...new Set([[d.parent_name, d.given_name].filter(Boolean).join(' '), [d.given_name, d.parent_name].filter(Boolean).join(' '), [d.surname, d.given_name].filter(Boolean).join(' '), d.name_latin].filter((x) => x && x.trim().includes(' ') || (x && d.name_latin === x)))], kind: 'individual', dob: d.birth_date || null, who: 'Харилцагч' }); // эцэг/эхийн нэр + өөрийн нэр (ургийн овог нэмэлтээр)
  for (const b of Array.isArray(p.bo) ? p.bo : []) if (b.name) out.push({ names: [b.name, b.name_latin].filter(Boolean), kind: 'individual', dob: b.birth_date || null, who: 'Эцсийн өмчлөгч' });
  if (d.acting_for_name) out.push({ names: [d.acting_for_name], kind: undefined, who: 'Төлөөлүүлэгч' });
  return out;
}
async function screenProfile(p) {
  const list = await entries(); const hits = [];
  for (const person of profileNames(p)) for (const h of rules.screen(person, list)) hits.push({ ...h, who: person.who });
  const prev = (p.sanctions && p.sanctions.hits) || [];
  // Өмнө нь «худал тохирол» гэж шийдсэнийг хадгална (ижил жагсаалтын бичлэг + ижил нэр)
  for (const h of hits) { const o = prev.find((x) => x.source === h.source && x.ref === h.ref && x.who === h.who); if (o && o.cleared) Object.assign(h, { cleared: o.cleared, cleared_by: o.cleared_by, cleared_at: o.cleared_at, note: o.note }); if (o && o.confirmed) Object.assign(h, { confirmed: o.confirmed, confirmed_by: o.confirmed_by, confirmed_at: o.confirmed_at }); }
  return { checked_at: new Date().toISOString(), lists: { un: meta.un && meta.un.n, mn: meta.mn && meta.mn.n }, hits };
}

function schedule(db, onUpdated) {
  DB = db; load(db).catch(() => {});
  const tick = async () => { try { const r = await refreshUN(); console.log(`[МУТСТ] НҮБ-ын хориг жагсаалт: ${r.n} бичлэг (${r.generated || ''})`); if (onUpdated) await onUpdated(); } catch (e) { console.error('[МУТСТ] жагсаалт:', e.message); } };
  if (process.env.ZUUCH_UN_LIST !== '0') { setTimeout(tick, 120e3).unref(); setInterval(tick, 24 * 3600e3).unref(); }
}
const status = () => ({ ...meta, url: UN_URL });

module.exports = { parseUN, load, entries, refreshUN, addNational, removeNational, screenProfile, profileNames, schedule, status };
