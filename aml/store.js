// «Зууч» комплаенс — өгөгдлийн давхарга: тохиргоо, ХТМ профайл, баримт (шифрлэлттэй), гүйлгээ, СМА-ны тайлан, сэжиг, сургалт,
// ажилтны гэрчилгээ, СЗХ-ны мэдэгдэл/тайлан, аудитын бүртгэл, хянах самбарын ажлууд, шалгалтын экспорт.
'use strict';
const crypto = require('crypto');
const fs = require('fs'); const fsp = fs.promises; const path = require('path');
const R = require('./rules');
const sanctions = require('./sanctions');

// ---------- Тохиргоо (companies.meta.aml) ----------
const DEF = { officers: [], license: { no: '', issued: '', expires: '', note: '' }, program: { approved_at: '', decision: '', frc_registered_at: '', frc_ref: '' }, risk_assessment: { date: '', summary: '' },
  fatf: R.FATF_DEFAULT, review_months: { high: 12, medium: 24, low: 36 }, strict: false, weights: {} };
async function settings(db, cid) {
  const r = await db.one('SELECT name, license_no, meta FROM companies WHERE id=?', cid); const m = (r && r.meta && r.meta.aml) || {};
  const s = { ...DEF, ...m, license: { ...DEF.license, ...(m.license || {}) }, program: { ...DEF.program, ...(m.program || {}) }, risk_assessment: { ...DEF.risk_assessment, ...(m.risk_assessment || {}) }, fatf: { ...DEF.fatf, ...(m.fatf || {}) }, review_months: { ...DEF.review_months, ...(m.review_months || {}) } };
  if (!s.license.no && r && r.license_no) s.license.no = r.license_no;
  s.company = r ? r.name : ''; return s;
}
const tgs = (n) => String(Math.round(Number(n || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const str = (v, n = 300) => String(v ?? '').trim().slice(0, n);
const ymd = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
async function saveSettings(db, cid, b) {
  const cur = await settings(db, cid); const users = new Set((await db.all('SELECT id FROM users WHERE company_id=?', cid)).map((u) => u.id));
  const v = {
    officers: Array.isArray(b.officers) ? b.officers.map(Number).filter((id) => users.has(id)).slice(0, 5) : cur.officers,
    license: b.license ? { no: str(b.license.no, 60), issued: ymd(b.license.issued), expires: ymd(b.license.expires), note: str(b.license.note) } : cur.license,
    program: b.program ? { approved_at: ymd(b.program.approved_at), decision: str(b.program.decision, 120), frc_registered_at: ymd(b.program.frc_registered_at), frc_ref: str(b.program.frc_ref, 120) } : cur.program,
    risk_assessment: b.risk_assessment ? { date: ymd(b.risk_assessment.date), summary: str(b.risk_assessment.summary, 2000) } : cur.risk_assessment,
    fatf: b.fatf ? { black: codes(b.fatf.black), grey: codes(b.fatf.grey), updated: ymd(b.fatf.updated) || null, src: R.FATF_DEFAULT.src } : cur.fatf,
    review_months: b.review_months ? { high: clampInt(b.review_months.high, 1, 60, 12), medium: clampInt(b.review_months.medium, 1, 60, 24), low: clampInt(b.review_months.low, 1, 60, 36) } : cur.review_months,
    strict: b.strict !== undefined ? !!b.strict : cur.strict,
    weights: b.weights && typeof b.weights === 'object' ? Object.fromEntries(R.FACTORS.map((f) => [f.k, clampInt(b.weights[f.k], 0, 10, f.w)])) : cur.weights,
  };
  await db.run("UPDATE companies SET meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{aml}', ?::jsonb) WHERE id=?", JSON.stringify(v), cid);
  if (b.license && b.license.no !== undefined) await db.run('UPDATE companies SET license_no=? WHERE id=?', v.license.no, cid);
  return settings(db, cid);
}
const codes = (a) => (Array.isArray(a) ? a : String(a || '').split(/[\s,;]+/)).map((x) => String(x).trim().toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x)).slice(0, 80);
const clampInt = (v, lo, hi, d) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const isOfficer = (s, user) => user.role === 'zahiral' || !!user.is_owner || (s.officers || []).includes(user.id);

// ---------- Аудитын бүртгэл (зөвхөн нэмнэ; устгах API байхгүй) ----------
async function audit(db, req, action, entity, entityId, detail) {
  await db.run('INSERT INTO aml_audit (company_id, user_id, user_name, action, entity, entity_id, detail, ip) VALUES (?,?,?,?,?,?,?::jsonb,?)',
    req.user.company_id, req.user.id, req.user.name || '', action, entity, entityId == null ? null : Number(entityId), JSON.stringify(detail || {}), String(req.ip || '').slice(0, 64)).catch((e) => console.error('[МУТСТ аудит]', e.message));
}

// ---------- ХТМ профайл ----------
const IND_KEYS = ['surname', 'parent_name', 'given_name', 'name_latin', 'birth_date', 'register_no', 'id_doc_type', 'id_doc_no', 'citizenship', 'country', 'address', 'address_current', 'phone', 'email', 'occupation', 'employer', 'position', 'income_source', 'acting_for', 'acting_for_name', 'purpose', 'source_of_funds', 'channel', 'note'];
const LEG_KEYS = ['name', 'name_latin', 'state_reg_no', 'tax_no', 'country', 'address', 'phone', 'email', 'activity', 'management', 'rep_name', 'rep_position', 'rep_authority', 'ownership_note', 'acting_for', 'acting_for_name', 'purpose', 'source_of_funds', 'channel', 'note'];
const BOOL_KEYS = new Set(['acting_for']);
function cleanData(kind, d = {}) {
  const out = {}; for (const k of kind === 'legal' ? LEG_KEYS : IND_KEYS) { if (d[k] === undefined) continue; out[k] = BOOL_KEYS.has(k) ? !!d[k] : k === 'birth_date' ? ymd(d[k]) : str(d[k], k === 'note' || k === 'management' || k === 'ownership_note' ? 2000 : 300); }
  if (out.country) out.country = out.country.toUpperCase().slice(0, 2);
  return out;
}
function cleanBo(a) { return (Array.isArray(a) ? a : []).slice(0, 20).map((b) => ({ name: str(b.name, 160), name_latin: str(b.name_latin, 160), register_no: str(b.register_no, 40), birth_date: ymd(b.birth_date), country: str(b.country, 2).toUpperCase(), pct: Math.max(0, Math.min(100, Number(b.pct) || 0)), control: !!b.control, pep: !!b.pep, note: str(b.note, 200) })).filter((b) => b.name); }
function cleanPep(p = {}) { return { is: !!p.is, position: str(p.position, 160), relation: R.PEP_RELATIONS[p.relation] ? p.relation : 'self', pep_name: str(p.pep_name, 160), source_of_funds: str(p.source_of_funds, 1000), source_of_wealth: str(p.source_of_wealth, 1000) }; }
function cleanFactors(f = {}) { const out = {}; for (const x of R.FACTORS) if (f[x.k]) out[x.k] = true; for (const k of ['remote', 'fatf_black', 'suspicion']) if (f[k]) out[k] = true; return out; }

function derive(p, s) {
  const f = { ...(p.factors || {}) }; const d = p.data || {};
  const countries = [d.country, d.citizenship, ...(p.bo || []).map((b) => b.country)].map((c) => String(c || '').toUpperCase().slice(0, 2)).filter(Boolean);
  if (countries.some((c) => (s.fatf.black || []).includes(c))) f.fatf_black = true;
  if (countries.some((c) => (s.fatf.grey || []).includes(c))) f.grey_country = true;
  if (d.channel === 'remote' || d.channel === 'third_party') f.remote = true;
  if ((p.bo || []).some((b) => b.pep)) p = { ...p, pep: { ...(p.pep || {}), is: true, relation: (p.pep && p.pep.relation) || 'associate', position: (p.pep && p.pep.position) || 'Эцсийн өмчлөгч нь УТНБЭ' } };
  const confirmed = ((p.sanctions && p.sanctions.hits) || []).some((h) => h.confirmed);
  const risk = R.assessRisk({ ...p, factors: f, sanction_confirmed: confirmed }, s.weights || {});
  const months = s.review_months[risk.level] || 12; const due = new Date(); due.setUTCMonth(due.getUTCMonth() + months);
  return { factors: f, risk, review_due: due.toISOString().slice(0, 10), pep: p.pep, blocked: confirmed };
}
const PROFILE_COLS = 'p.id, p.company_id, p.client_id, p.kind, p.data, p.pep, p.bo, p.factors, p.risk, p.risk_score, p.risk_reasons, p.cdd, p.status, p.verified_by, p.verified_at, p.edd_approved_by, p.edd_approved_at, p.sanctions, p.review_due, p.ended_at, p.created_by, p.created_at, p.updated_at';
const displayName = (p) => (p.kind === 'legal' ? p.data.name : [p.data.parent_name ? p.data.parent_name.slice(0, 1) + '.' : '', p.data.given_name].filter(Boolean).join(' ')) || '—';
async function listProfiles(db, cid, { q, uid } = {}) {
  const rows = await db.all(`SELECT ${PROFILE_COLS}, c.name AS client_name, u.name AS created_by_name FROM aml_profiles p LEFT JOIN clients c ON c.id=p.client_id LEFT JOIN users u ON u.id=p.created_by WHERE p.company_id=? ${uid ? 'AND p.created_by=?' : ''} ORDER BY p.updated_at DESC LIMIT 500`, ...(uid ? [cid, uid] : [cid]));
  const ql = String(q || '').toLowerCase();
  return rows.map((p) => ({ ...p, display: displayName(p) })).filter((p) => !ql || JSON.stringify([p.display, p.data.register_no, p.data.state_reg_no, p.client_name]).toLowerCase().includes(ql));
}
async function getProfile(db, cid, id) {
  const p = await db.one(`SELECT ${PROFILE_COLS}, c.name AS client_name FROM aml_profiles p LEFT JOIN clients c ON c.id=p.client_id WHERE p.company_id=? AND p.id=?`, cid, id); if (!p) return null;
  const docs = await db.all('SELECT id, kind, filename, mime, size, enc, original_seen, note, uploaded_by, created_at FROM aml_docs WHERE company_id=? AND owner_type=? AND owner_id=? ORDER BY id', cid, 'profile', id);
  return { ...p, display: displayName(p), docs, gaps: R.cddGaps(p, docs) };
}
async function saveProfile(db, req, id, b) {
  const cid = req.user.company_id; const s = await settings(db, cid);
  const cur = id ? await db.one('SELECT * FROM aml_profiles WHERE company_id=? AND id=?', cid, id) : null; if (id && !cur) return null;
  if (cur && cur.status === 'blocked' && !isOfficer(s, req.user)) throw Object.assign(new Error('Энэ харилцагчийг комплаенсын ажилтан хаасан'), { status: 403 });
  const kind = cur ? cur.kind : b.kind === 'legal' ? 'legal' : 'individual';
  let clientId = cur ? cur.client_id : null;
  if (b.client_id !== undefined) { clientId = b.client_id ? Number(b.client_id) : null; if (clientId && !(await db.one('SELECT 1 FROM clients WHERE id=? AND company_id=?', clientId, cid))) throw Object.assign(new Error('Харилцагч олдсонгүй'), { status: 400 }); }
  const p = { kind, data: { ...(cur ? cur.data : {}), ...cleanData(kind, b.data) }, bo: b.bo !== undefined ? cleanBo(b.bo) : (cur ? cur.bo : []), pep: b.pep !== undefined ? cleanPep(b.pep) : (cur ? cur.pep : {}), factors: b.factors !== undefined ? cleanFactors(b.factors) : (cur ? cur.factors : {}), sanctions: cur ? cur.sanctions : {}, edd_approved_by: cur ? cur.edd_approved_by : null };
  // Мэдээлэл өөрчлөгдвөл хориг жагсаалтаар дахин шалгана (МУТСТХ 5.11 байнгын хяналт)
  p.sanctions = await sanctions.screenProfile(p);
  const dv = derive(p, s);
  const changedCore = cur && JSON.stringify([cur.data, cur.bo, cur.pep]) !== JSON.stringify([p.data, p.bo, p.pep]);
  // Баталгаажсан профайлд гол мэдээлэл өөрчлөгдвөл дахин тулгаж баталгаажуулна (УСҮАЖ 3.5)
  let status = cur ? cur.status : 'draft'; let verified = cur ? [cur.verified_by, cur.verified_at] : [null, null]; let edd = cur ? [cur.edd_approved_by, cur.edd_approved_at] : [null, null];
  if (changedCore && status === 'verified') { status = 'draft'; verified = [null, null]; }
  if (cur && dv.risk.level === 'high' && cur.risk !== 'high') edd = [null, null];
  if (dv.blocked) status = 'blocked';
  const vals = [clientId, JSON.stringify(p.data), JSON.stringify(dv.pep || {}), JSON.stringify(p.bo), JSON.stringify(dv.factors), dv.risk.level, dv.risk.score, JSON.stringify(dv.risk.reasons), dv.risk.cdd, status, verified[0], verified[1], edd[0], edd[1], JSON.stringify(p.sanctions), dv.review_due];
  let out;
  if (cur) { await db.run('UPDATE aml_profiles SET client_id=?, data=?::jsonb, pep=?::jsonb, bo=?::jsonb, factors=?::jsonb, risk=?, risk_score=?, risk_reasons=?::jsonb, cdd=?, status=?, verified_by=?, verified_at=?, edd_approved_by=?, edd_approved_at=?, sanctions=?::jsonb, review_due=?, updated_at=NOW() WHERE id=? AND company_id=?', ...vals, id, cid); out = id; }
  else out = (await db.one('INSERT INTO aml_profiles (client_id, data, pep, bo, factors, risk, risk_score, risk_reasons, cdd, status, verified_by, verified_at, edd_approved_by, edd_approved_at, sanctions, review_due, kind, company_id, created_by) VALUES (?,?::jsonb,?::jsonb,?::jsonb,?::jsonb,?,?,?::jsonb,?,?,?,?,?,?,?::jsonb,?,?,?,?) RETURNING id', ...vals, kind, cid, req.user.id)).id;
  await audit(db, req, cur ? 'profile.update' : 'profile.create', 'profile', out, { risk: dv.risk.level, cdd: dv.risk.cdd, status, hits: p.sanctions.hits.length });
  const open = p.sanctions.hits.filter((h) => !h.cleared && !h.confirmed);
  if (open.length) await audit(db, req, 'sanctions.potential_match', 'profile', out, { hits: open.map((h) => ({ source: h.source, ref: h.ref, score: h.score })) });
  return getProfile(db, cid, out);
}
async function verifyProfile(db, req, id) {
  const p = await getProfile(db, req.user.company_id, id); if (!p) return null;
  if (p.status === 'blocked') throw Object.assign(new Error('Хориг жагсаалтын тохиролтой — баталгаажуулах боломжгүй'), { status: 409 });
  const gaps = p.gaps;
  if (gaps.length) throw Object.assign(new Error('Дутуу: ' + gaps.join('; ')), { status: 409 });
  if (!p.docs.some((d) => d.original_seen)) throw Object.assign(new Error('Хуулбарыг эх хувьтай нь тулгасныг тэмдэглэнэ үү (МУТСТХ 5.2.1)'), { status: 409 });
  await db.run("UPDATE aml_profiles SET status='verified', verified_by=?, verified_at=NOW(), updated_at=NOW() WHERE id=? AND company_id=?", req.user.id, id, req.user.company_id);
  await audit(db, req, 'profile.verify', 'profile', id, { risk: p.risk, cdd: p.cdd }); return getProfile(db, req.user.company_id, id);
}
async function approveEdd(db, req, id, note) {
  const p = await getProfile(db, req.user.company_id, id); if (!p) return null;
  if (p.cdd !== 'enhanced') throw Object.assign(new Error('Нарийвчилсан ХТМ шаардлагагүй профайл'), { status: 409 });
  if (!String((p.pep && p.pep.source_of_funds) || p.data.source_of_funds || '').trim()) throw Object.assign(new Error('Эхлээд хөрөнгийн эх үүсвэрийг бүртгэнэ үү (УСҮАЖ 7.5.1)'), { status: 409 });
  await db.run('UPDATE aml_profiles SET edd_approved_by=?, edd_approved_at=NOW(), updated_at=NOW() WHERE id=? AND company_id=?', req.user.id, id, req.user.company_id);
  await audit(db, req, 'profile.edd_approve', 'profile', id, { note: str(note, 300) }); return getProfile(db, req.user.company_id, id);
}
// Хориг жагсаалтын тохиролд шийдвэр: худал тохирол (clear) эсвэл баталгаажсан (confirm → хаана, 24 цагийн тайлан)
async function decideHit(db, req, id, idx, decision, note) {
  const p = await db.one('SELECT * FROM aml_profiles WHERE id=? AND company_id=?', id, req.user.company_id); if (!p) return null;
  const s = p.sanctions || {}; const h = (s.hits || [])[idx]; if (!h) throw Object.assign(new Error('Тохирол олдсонгүй'), { status: 404 });
  if (!String(note || '').trim()) throw Object.assign(new Error('Шийдвэрийн үндэслэлийг бичнэ үү'), { status: 400 });
  const now = new Date().toISOString();
  if (decision === 'clear') Object.assign(h, { cleared: true, cleared_by: req.user.id, cleared_at: now, note: str(note, 500), confirmed: false });
  else Object.assign(h, { confirmed: true, confirmed_by: req.user.id, confirmed_at: now, note: str(note, 500), cleared: false });
  const st = await settings(db, req.user.company_id); const dv = derive({ ...p, sanctions: s }, st);
  await db.run('UPDATE aml_profiles SET sanctions=?::jsonb, status=?, risk=?, risk_score=?, risk_reasons=?::jsonb, cdd=?, updated_at=NOW() WHERE id=?', JSON.stringify(s), dv.blocked ? 'blocked' : p.status === 'blocked' ? 'draft' : p.status, dv.risk.level, dv.risk.score, JSON.stringify(dv.risk.reasons), dv.risk.cdd, id);
  if (decision === 'confirm') { // ЗГ-464 5.1, МУТСТХ 6¹.2, УСҮАЖ 14.4 — царцааж, тагнуулын байгууллага болон СМА-д 24 цагийн дотор
    await db.run('INSERT INTO aml_reports (company_id, type, profile_id, status, detected_at, due_at, grounds, content, created_by) VALUES (?,?,?,?,NOW(),?,?,?::jsonb,?)', req.user.company_id, 'TFS', id, 'draft', R.strDue(Date.now()), `Хориг жагсаалтын баталгаажсан тохирол: ${h.source} ${h.ref} (${h.name})`, JSON.stringify({ hit: h }), req.user.id);
  }
  await audit(db, req, 'sanctions.' + decision, 'profile', id, { source: h.source, ref: h.ref, score: h.score, note: str(note, 300) });
  return getProfile(db, req.user.company_id, id);
}
async function rescreenAll(db) {
  const rows = await db.all('SELECT * FROM aml_profiles WHERE ended_at IS NULL'); let n = 0;
  for (const p of rows) { const sc = await sanctions.screenProfile(p); const before = ((p.sanctions && p.sanctions.hits) || []).length; await db.run('UPDATE aml_profiles SET sanctions=?::jsonb WHERE id=?', JSON.stringify(sc), p.id); if (sc.hits.length > before) n++; }
  return { profiles: rows.length, newHits: n };
}

// ---------- Баримт: AES-256-GCM шифрлэлт (ZUUCH_DOC_KEY) ----------
const DOC_KEY = process.env.ZUUCH_DOC_KEY ? crypto.createHash('sha256').update(process.env.ZUUCH_DOC_KEY).digest() : null;
const MAGIC = Buffer.from('ZENC1');
function encrypt(buf) { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', DOC_KEY, iv); const ct = Buffer.concat([c.update(buf), c.final()]); return Buffer.concat([MAGIC, iv, c.getAuthTag(), ct]); }
function decrypt(buf) {
  if (!buf.subarray(0, 5).equals(MAGIC)) return buf; if (!DOC_KEY) throw new Error('Баримт шифрлэгдсэн боловч ZUUCH_DOC_KEY тохируулаагүй');
  const iv = buf.subarray(5, 17), tag = buf.subarray(17, 33); const d = crypto.createDecipheriv('aes-256-gcm', DOC_KEY, iv); d.setAuthTag(tag); return Buffer.concat([d.update(buf.subarray(33)), d.final()]);
}
const DOC_KINDS = { id: 'Иргэний үнэмлэх / паспорт', cert: 'Улсын бүртгэлийн гэрчилгээ', poa: 'Итгэмжлэл / төлөөлөх эрх', bo: 'Эцсийн өмчлөгчийн баримт', sof: 'Хөрөнгийн эх үүсвэрийн баримт', contract: 'Гэрээ', program: 'Дотоод хяналтын хөтөлбөр', decision: 'Шийдвэр, тушаал', license: 'Зөвшөөрөл', training: 'Сургалтын баримт', certificate: 'Мэргэжлийн гэрчилгээ', fit: 'Тохиромжтой этгээдийн тодорхойлолт', report: 'Тайлан', other: 'Бусад' };
const DOC_OWNERS = new Set(['profile', 'company', 'user', 'training', 'change', 'report']);
async function saveDoc(db, req, dir, { ownerType, ownerId, kind, file, note }) {
  if (!DOC_OWNERS.has(ownerType)) throw Object.assign(new Error('Буруу төрөл'), { status: 400 });
  if (!file || !file.buffer || !file.buffer.length) throw Object.assign(new Error('Файл алга'), { status: 400 });
  if (!/^(image\/(jpeg|png|webp|heic)|application\/pdf)$/.test(file.mimetype)) throw Object.assign(new Error('Зөвхөн PDF, JPG, PNG'), { status: 400 });
  const sha = crypto.createHash('sha256').update(file.buffer).digest('hex');
  const d = path.join(dir, 'aml', String(req.user.company_id)); await fsp.mkdir(d, { recursive: true });
  const fname = crypto.randomBytes(12).toString('hex') + (DOC_KEY ? '.enc' : path.extname(file.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 6));
  await fsp.writeFile(path.join(d, fname), DOC_KEY ? encrypt(file.buffer) : file.buffer, { mode: 0o600 });
  const r = await db.one('INSERT INTO aml_docs (company_id, owner_type, owner_id, kind, filename, orig_name, mime, size, sha256, enc, note, uploaded_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id',
    req.user.company_id, ownerType, ownerId == null ? null : Number(ownerId), DOC_KINDS[kind] ? kind : 'other', fname, str(file.originalname, 160), file.mimetype, file.buffer.length, sha, !!DOC_KEY, str(note, 300), req.user.id);
  await audit(db, req, 'doc.upload', 'doc', r.id, { owner: ownerType, owner_id: ownerId, kind, sha256: sha, enc: !!DOC_KEY });
  return r.id;
}
async function readDoc(db, req, dir, id) {
  const d = await db.one('SELECT * FROM aml_docs WHERE id=? AND company_id=?', id, req.user.company_id); if (!d) return null;
  const buf = decrypt(await fsp.readFile(path.join(dir, 'aml', String(d.company_id), d.filename)));
  await audit(db, req, 'doc.view', 'doc', id, { owner: d.owner_type, owner_id: d.owner_id }); return { doc: d, buf };
}

// ---------- Гүйлгээ (МУТСТХ 7.1 — БМГТ; 5.1.2–5.1.3 — ХТМ-ийн босго) ----------
async function saveTx(db, req, id, b) {
  const cid = req.user.company_id; const amount = Math.round(Number(b.amount)); if (!(amount > 0)) throw Object.assign(new Error('Дүн буруу'), { status: 400 });
  const method = R.METHODS[b.method] ? b.method : 'transfer'; const date = ymd(b.tx_date) || R.ubDate(Date.now());
  for (const k of ['buyer_id', 'seller_id']) if (b[k] && !(await db.one('SELECT 1 FROM aml_profiles WHERE id=? AND company_id=?', b[k], cid))) throw Object.assign(new Error('Профайл олдсонгүй'), { status: 400 });
  const vals = [b.deal_id ? Number(b.deal_id) : null, b.buyer_id ? Number(b.buyer_id) : null, b.seller_id ? Number(b.seller_id) : null, amount, method, date, str(b.purpose, 300), !!b.third_party, str(b.note, 1000)];
  let txId = id;
  if (id) { const r = await db.run('UPDATE aml_tx SET deal_id=?, buyer_id=?, seller_id=?, amount=?, method=?, tx_date=?, purpose=?, third_party=?, note=? WHERE id=? AND company_id=?', ...vals, id, cid); if (!r.changes) return null; }
  else txId = (await db.one('INSERT INTO aml_tx (deal_id, buyer_id, seller_id, amount, method, tx_date, purpose, third_party, note, company_id, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING id', ...vals, cid, req.user.id)).id;
  await audit(db, req, id ? 'tx.update' : 'tx.create', 'tx', txId, { amount, method, date });
  if (R.ctrRequired(method, amount) && !(await db.one("SELECT 1 FROM aml_reports WHERE company_id=? AND type='CTR' AND tx_id=?", cid, txId))) {
    await db.run('INSERT INTO aml_reports (company_id, type, tx_id, profile_id, status, detected_at, due_at, grounds, created_by) VALUES (?,?,?,?,?,NOW(),?,?,?)', cid, 'CTR', txId, vals[1] || vals[2], 'draft', R.ctrDue(date) + 'T15:59:59Z', `${R.METHODS[method].t} ${tgs(amount)}₮ (≥ 20 сая ₮)`, req.user.id);
    await audit(db, req, 'report.ctr_auto', 'tx', txId, { due: R.ctrDue(date) });
  }
  return db.one('SELECT * FROM aml_tx WHERE id=?', txId);
}
// Хэлцэл (худалдах) бүртгэгдэх/засагдахад гүйлгээний бүртгэлд тусгана — дүн «сая ₮», төлбөрийн хэлбэр: transfer|mortgage|cash
async function syncDeal(db, req, dealId) {
  const d = await db.one('SELECT * FROM deals WHERE id=? AND company_id=?', dealId, req.user.company_id); if (!d || !R.inScope(d.deal_type)) return null;
  const buyer = d.client_id ? await db.one('SELECT id FROM aml_profiles WHERE company_id=? AND client_id=? ORDER BY id DESC LIMIT 1', req.user.company_id, d.client_id) : null;
  const ex = await db.one('SELECT * FROM aml_tx WHERE company_id=? AND deal_id=? ORDER BY id LIMIT 1', req.user.company_id, dealId);
  const body = { deal_id: dealId, buyer_id: ex ? ex.buyer_id || (buyer && buyer.id) : buyer && buyer.id, seller_id: ex ? ex.seller_id : null, amount: Math.round(Number(d.amount) * R.MNT), method: d.payment_form === 'cash' ? 'cash' : d.payment_form === 'mortgage' ? 'mortgage' : (ex && ex.method !== 'transfer' && ex.method !== 'cash' && ex.method !== 'mortgage' ? ex.method : 'transfer'), tx_date: d.deal_date, purpose: ex ? ex.purpose : 'Үл хөдлөх хөрөнгө худалдах, худалдан авах', third_party: ex ? ex.third_party : false, note: ex ? ex.note : '' };
  return saveTx(db, req, ex ? ex.id : null, body);
}
// 24 цагийн дотор хийсэн холбоотой гүйлгээний нийлбэр ≥ 20 сая ₮ (МУТСТХ 5.1.3)
async function linkedOver(db, cid) {
  return db.all(`SELECT p_id, MIN(tx_date)::text d, SUM(amount)::bigint total, COUNT(*)::int n FROM (
      SELECT buyer_id p_id, tx_date, amount FROM aml_tx WHERE company_id=? AND buyer_id IS NOT NULL UNION ALL SELECT seller_id, tx_date, amount FROM aml_tx WHERE company_id=? AND seller_id IS NOT NULL) x
    GROUP BY p_id, tx_date HAVING COUNT(*) > 1 AND SUM(amount) >= ?`, cid, cid, R.THRESHOLD);
}

// ---------- СМА-ны тайлан: CTR (БМГТ), STR (СГТ), TFS (хориг), RFI (нэмэлт мэдээллийн хүсэлт) ----------
async function saveReport(db, req, id, b) {
  const cid = req.user.company_id; const type = ['CTR', 'STR', 'TFS', 'RFI'].includes(b.type) ? b.type : 'STR';
  const detected = b.detected_at ? new Date(b.detected_at) : new Date(); if (Number.isNaN(detected.getTime())) throw Object.assign(new Error('Огноо буруу'), { status: 400 });
  const due = type === 'STR' || type === 'TFS' ? R.strDue(detected.getTime()) : type === 'RFI' ? new Date(R.addWorkdays(R.ubDate(detected.getTime()), R.RFI_WORKDAYS) + 'T15:59:59Z') : b.due_at ? new Date(b.due_at) : null;
  const vals = [b.tx_id ? Number(b.tx_id) : null, b.profile_id ? Number(b.profile_id) : null, b.referral_id ? Number(b.referral_id) : null, str(b.grounds, 4000), JSON.stringify(Array.isArray(b.indicators) ? b.indicators.map((x) => str(x, 200)).slice(0, 20) : []), JSON.stringify(b.content && typeof b.content === 'object' ? b.content : {})];
  if (id) {
    const cur = await db.one('SELECT * FROM aml_reports WHERE id=? AND company_id=?', id, cid); if (!cur) return null;
    if (cur.status === 'submitted') throw Object.assign(new Error('Илгээсэн тайланг засах боломжгүй — шинэ мэдээлэл гарвал нэмэлт тайлан үүсгэнэ (А-171 2.5)'), { status: 409 });
    await db.run('UPDATE aml_reports SET tx_id=?, profile_id=?, referral_id=?, grounds=?, indicators=?::jsonb, content=?::jsonb WHERE id=?', ...vals, id);
  } else id = (await db.one('INSERT INTO aml_reports (tx_id, profile_id, referral_id, grounds, indicators, content, company_id, type, status, detected_at, due_at, created_by) VALUES (?,?,?,?,?::jsonb,?::jsonb,?,?,?,?,?,?) RETURNING id', ...vals, cid, type, 'draft', detected, due, req.user.id)).id;
  await audit(db, req, 'report.save', 'report', id, { type }); return getReport(db, cid, id);
}
async function submitReport(db, req, id, b) {
  const ref = str(b.goaml_ref, 80); if (!ref) throw Object.assign(new Error('goAML-ийн бүртгэлийн дугаарыг оруулна уу'), { status: 400 });
  const at = b.submitted_at ? new Date(b.submitted_at) : new Date();
  const r = await db.run("UPDATE aml_reports SET status='submitted', goaml_ref=?, submitted_at=?, submitted_by=? WHERE id=? AND company_id=? AND status='draft'", ref, at, req.user.id, id, req.user.company_id);
  if (!r.changes) throw Object.assign(new Error('Тайлан олдсонгүй эсвэл илгээгдсэн'), { status: 409 });
  await audit(db, req, 'report.submit', 'report', id, { goaml_ref: ref }); return getReport(db, req.user.company_id, id);
}
async function getReport(db, cid, id) {
  const r = await db.one('SELECT * FROM aml_reports WHERE id=? AND company_id=?', id, cid); if (!r) return null;
  const p = r.profile_id ? await db.one('SELECT * FROM aml_profiles WHERE id=?', r.profile_id) : null; const tx = r.tx_id ? await db.one('SELECT * FROM aml_tx WHERE id=?', r.tx_id) : null;
  const c = await db.one('SELECT name, license_no FROM companies WHERE id=?', cid); const s = await settings(db, cid);
  const officers = s.officers.length ? await db.all('SELECT name, phone FROM users WHERE id = ANY(?)', s.officers) : [];
  // МУТСТХ 9.1 — тайланд заавал тусгах мэдээлэл (goAML-д оруулах бэлтгэл)
  const form = {
    reporter: { name: c.name, license: s.license.no || c.license_no || '', officer: officers.map((o) => `${o.name}${o.phone ? ' (' + o.phone + ')' : ''}`).join(', ') },
    customer: p ? { kind: p.kind, ...p.data, bo: p.bo, pep: p.pep, risk: p.risk } : null,
    transaction: tx ? { date: tx.tx_date, amount: Number(tx.amount), currency: 'MNT', method: (R.METHODS[tx.method] || {}).t, purpose: tx.purpose, third_party: tx.third_party, deal_id: tx.deal_id } : null,
    grounds: r.grounds, indicators: r.indicators,
  };
  return { ...r, form };
}

// ---------- Хянах самбарын ажлууд (хугацаатай) ----------
async function tasks(db, cid, s, nowMs = Date.now()) {
  const out = []; const today = R.ubDate(nowMs);
  const add = (lvl, t, due, link, cite) => out.push({ lvl, t, due: due || null, link: link || null, cite: cite || null, overdue: !!(due && String(due).slice(0, 10) < today) });
  for (const r of await db.all("SELECT id, type, due_at, grounds FROM aml_reports WHERE company_id=? AND status='draft' ORDER BY due_at NULLS LAST", cid))
    add('high', `${{ CTR: 'Бэлэн мөнгөний гүйлгээний тайлан (БМГТ)', STR: 'Сэжигтэй гүйлгээний тайлан (СГТ)', TFS: 'Хориг арга хэмжээ — царцаах, мэдээлэх', RFI: 'СМА-ны нэмэлт мэдээллийн хүсэлтэд хариу' }[r.type]} №${r.id}: ${r.grounds || ''}`.slice(0, 220), r.due_at ? new Date(new Date(r.due_at).getTime() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') : null, { tab: 'reports', id: r.id }, { CTR: 'МУТСТХ 7.1', STR: 'МУТСТХ 7.2', TFS: 'ҮОХЗДТТХ 23.6', RFI: 'МУТСТХ 9.2' }[r.type]);
  for (const p of await db.all("SELECT id, kind, data, sanctions FROM aml_profiles WHERE company_id=? AND sanctions->'hits' @> '[{}]'", cid)) {
    const open = ((p.sanctions && p.sanctions.hits) || []).filter((h) => !h.cleared && !h.confirmed); if (open.length) add('high', `Хориг жагсаалтын боломжит тохирол: ${displayName(p)} (${open.length})`, null, { tab: 'profiles', id: p.id }, 'УСҮАЖ 3.9, 14');
  }
  const ref = await db.one("SELECT COUNT(*)::int n FROM aml_referrals WHERE company_id=? AND status='open'", cid); if (ref.n) add('high', `Шийдээгүй дотоод сэжгийн мэдээлэл: ${ref.n}`, null, { tab: 'referrals' }, 'МУТСТХ 7.2');
  for (const p of await db.all("SELECT id, kind, data FROM aml_profiles WHERE company_id=? AND cdd='enhanced' AND edd_approved_by IS NULL AND status NOT IN ('ended','blocked')", cid)) add('mid', `Нарийвчилсан ХТМ — гүйцэтгэх удирдлагын зөвшөөрөл хүлээгдэж байна: ${displayName(p)}`, null, { tab: 'profiles', id: p.id }, 'УСҮАЖ 7.5.2');
  for (const t of await db.all(`SELECT t.id, t.amount, t.tx_date::text d, t.buyer_id, t.seller_id, pb.status bs, ps.status ss FROM aml_tx t LEFT JOIN aml_profiles pb ON pb.id=t.buyer_id LEFT JOIN aml_profiles ps ON ps.id=t.seller_id WHERE t.company_id=? AND t.tx_date >= (NOW() - INTERVAL '400 days')::date AND (t.buyer_id IS NULL OR t.seller_id IS NULL OR pb.status <> 'verified' OR ps.status <> 'verified')`, cid))
    add(s.strict ? 'high' : 'mid', `Гүйлгээ №${t.id} (${t.d}, ${tgs(t.amount)}₮): ${!t.buyer_id ? 'худалдан авагчийн ' : t.bs !== 'verified' ? 'худалдан авагчийн баталгаажсан ' : ''}${!t.seller_id ? 'худалдагчийн ' : t.ss !== 'verified' ? 'худалдагчийн баталгаажсан ' : ''}ХТМ дутуу`, null, { tab: 'tx', id: t.id }, 'МУТСТХ 5.1.1');
  for (const x of await linkedOver(db, cid)) add('mid', `24 цагийн дотор холбоотой ${x.n} гүйлгээ, нийт ${tgs(x.total)}₮ (${x.d}) — ХТМ-ийг шалгах`, null, { tab: 'profiles', id: x.p_id }, 'МУТСТХ 5.1.3');
  for (const p of await db.all("SELECT id, kind, data, review_due::text rd FROM aml_profiles WHERE company_id=? AND status='verified' AND review_due <= (NOW() + INTERVAL '30 days')::date", cid)) add('low', `ХТМ-ийг дахин шинэчлэх: ${displayName(p)}`, p.rd, { tab: 'profiles', id: p.id }, 'МУТСТХ 5.11');
  // СЗХ: зөвшөөрөл, хөтөлбөр, ажилтан, мэдэгдэл, календарь
  if (!s.license.no) add('mid', 'СЗХ-ны зөвшөөрлийн дугаарыг бүртгэх', null, { tab: 'program' }, 'СЗХ №648');
  else if (s.license.expires && s.license.expires <= R.ubDate(nowMs + 90 * 864e5)) add('high', `СЗХ-ны зөвшөөрлийн хугацаа дуусах: ${s.license.expires}`, s.license.expires, { tab: 'program' }, 'Зөвшөөрөл, мэдэгдлийн тухай хууль');
  if (!s.officers.length) add('high', 'МУТСТ-ийн хэрэгжилтэд хяналт тавих ажилтан томилоогүй', null, { tab: 'program' }, 'СЗХ №648, 2.1.5; УСҮАЖ 11.4');
  if (!s.program.approved_at) add('high', 'Дотоод хяналт, эрсдэлийн удирдлагын хөтөлбөр батлагдаагүй', null, { tab: 'program' }, 'МУТСТХ 14.1');
  else if (!s.program.frc_registered_at) add('high', 'Дотоод хяналтын хөтөлбөрийг СЗХ-д бүртгүүлээгүй', null, { tab: 'program' }, 'МУТСТХ 14.5');
  if (!s.risk_assessment.date || s.risk_assessment.date < R.ubDate(nowMs - 365 * 864e5)) add('mid', 'Байгууллагын МУТСТ эрсдэлийн үнэлгээг шинэчлэх (жил бүр санал болгож буй)', null, { tab: 'program' }, 'МУТСТХ 4.3');
  if (!s.fatf.updated || s.fatf.updated < R.ubDate(nowMs - 150 * 864e5)) add('low', 'ФАТФ-ын хар, саарал жагсаалтыг шинэчлэх (жилд 3 удаа өөрчлөгддөг)', null, { tab: 'program' }, 'МУТСТХ 5.9.2');
  const tr = await db.one("SELECT MAX(date)::text d FROM aml_training WHERE company_id=?", cid); if (!tr.d || tr.d < R.ubDate(nowMs - 365 * 864e5)) add('mid', 'Ажилтнуудын МУТСТ / хориг арга хэмжээний дотоод сургалт (сүүлийн 12 сард алга)', null, { tab: 'program' }, 'МУТСТХ 14.4; ЗГ-464 6.1.5');
  for (const st of await db.all("SELECT s.*, u.name FROM aml_staff s JOIN users u ON u.id=s.user_id WHERE s.company_id=? AND s.position IN ('broker','agent','sales','aml_officer')", cid)) {
    if (!st.cert_no) add('mid', `${st.name}: мэргэжлийн гэрчилгээний мэдээлэл алга`, null, { tab: 'staff' }, 'СЗХ №648, 2.1.7');
    else if (st.cert_expires && String(st.cert_expires).slice(0, 10) <= R.ubDate(nowMs + 60 * 864e5)) add('mid', `${st.name}: гэрчилгээний хугацаа дуусах`, String(st.cert_expires).slice(0, 10), { tab: 'staff' }, 'СЗХ №648, 2.1.7');
  }
  const pos = await db.all("SELECT position, COUNT(*)::int n FROM aml_staff WHERE company_id=? GROUP BY position", cid); const pc = Object.fromEntries(pos.map((x) => [x.position, x.n]));
  if (!pc.broker) add('mid', 'Брокер бүртгэгдээгүй (1-ээс доошгүй)', null, { tab: 'staff' }, 'СЗХ №648, 2.1.4');
  if (!pc.agent && !pc.sales) add('mid', 'Агент эсвэл борлуулалтын ажилтан бүртгэгдээгүй', null, { tab: 'staff' }, 'СЗХ №648, 2.1.6');
  for (const c of await db.all("SELECT id, type, due::text due FROM aml_changes WHERE company_id=? AND submitted_at IS NULL ORDER BY due", cid)) add('high', `СЗХ-д өөрчлөлт мэдэгдэх: ${R.CHANGE_TYPES[c.type] || c.type}`, c.due, { tab: 'frc' }, 'СЗХ №648, 6.1, 9.2');
  const filed = new Set((await db.all('SELECT key, period FROM aml_filings WHERE company_id=?', cid)).map((f) => f.key + '|' + f.period));
  for (const c of R.calendar(R.ubDate(nowMs - 120 * 864e5), R.ubDate(nowMs + 45 * 864e5))) if (!filed.has(c.key + '|' + c.period)) add(c.due < today ? 'high' : 'low', `${c.t} — ${c.period}${c.soft ? ' (хугацааг журамд заагаагүй)' : ''}`, c.due, { tab: 'frc', key: c.key, period: c.period }, c.cite);
  const order = { high: 0, mid: 1, low: 2 };
  return out.sort((a, b) => (b.overdue - a.overdue) || (order[a.lvl] - order[b.lvl]) || String(a.due || '9').localeCompare(String(b.due || '9')));
}
async function stats(db, cid) {
  const p = await db.all("SELECT risk, status, COUNT(*)::int n FROM aml_profiles WHERE company_id=? GROUP BY risk, status", cid);
  const r = await db.all("SELECT type, status, COUNT(*)::int n FROM aml_reports WHERE company_id=? GROUP BY type, status", cid);
  const t = await db.one("SELECT COUNT(*)::int n, COALESCE(SUM(amount),0)::bigint total FROM aml_tx WHERE company_id=? AND tx_date >= date_trunc('year', NOW())::date", cid);
  const pep = await db.one("SELECT COUNT(*)::int n FROM aml_profiles WHERE company_id=? AND (pep->>'is')::boolean IS TRUE", cid);
  return { profiles: p, reports: r, txYear: t, pep: pep.n };
}
// СЗХ-ны улирлын маягт 6 (худалдах, худалдан авах, шилжүүлэх) ба 7 (түрээс)-д ашиглах нэгтгэл — хэлцлийн бүртгэлээс
async function quarter(db, cid, period) {
  const m = /^(\d{4})-Q([1-4])$/.exec(String(period || '')); if (!m) throw Object.assign(new Error('Улирал буруу (жишээ: 2026-Q3)'), { status: 400 });
  const y = Number(m[1]), q = Number(m[2]); const from = `${y}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01`; const to = q === 4 ? `${y + 1}-01-01` : `${y}-${String(q * 3 + 1).padStart(2, '0')}-01`;
  const rows = await db.all(`SELECT d.deal_type, d.payment_form, COUNT(*)::int n, COALESCE(SUM(d.amount),0)::float amount, COALESCE(SUM(d.commission),0)::float commission FROM deals d WHERE d.company_id=? AND d.deal_date >= ? AND d.deal_date < ? GROUP BY 1,2 ORDER BY 1,2`, cid, from, to);
  const ctr = await db.one("SELECT COUNT(*)::int n FROM aml_reports r JOIN aml_tx t ON t.id=r.tx_id WHERE r.company_id=? AND r.type='CTR' AND t.tx_date >= ?::date AND t.tx_date < ?::date", cid, from, to);
  return { period, from, to, rows, ctr: ctr.n, note: 'Дүн «сая ₮»-өөр. Маягтын яг бүтцийг СЗХ-ны тухайн үеийн Excel загвартай тулгаж бөглөнө (№235, 5.1).' };
}

// ---------- Шалгалтын экспорт (СЗХ №22, 7.1 — шалгалтад гаргуулах баримт) ----------
async function exportPack(db, req) {
  const cid = req.user.company_id; const s = await settings(db, cid);
  const pack = {
    generated_at: new Date().toISOString(), company: s.company, license: s.license, program: s.program, risk_assessment: s.risk_assessment, officers: s.officers,
    staff: await db.all('SELECT s.*, u.name, u.role FROM aml_staff s JOIN users u ON u.id=s.user_id WHERE s.company_id=?', cid),
    profiles: await db.all('SELECT * FROM aml_profiles WHERE company_id=? ORDER BY id', cid),
    documents: await db.all('SELECT id, owner_type, owner_id, kind, orig_name, mime, size, sha256, enc, original_seen, uploaded_by, created_at FROM aml_docs WHERE company_id=? ORDER BY id', cid),
    transactions: await db.all('SELECT * FROM aml_tx WHERE company_id=? ORDER BY id', cid),
    reports: await db.all('SELECT * FROM aml_reports WHERE company_id=? ORDER BY id', cid),
    referrals: await db.all('SELECT * FROM aml_referrals WHERE company_id=? ORDER BY id', cid),
    training: await db.all('SELECT * FROM aml_training WHERE company_id=? ORDER BY date', cid),
    changes: await db.all('SELECT * FROM aml_changes WHERE company_id=? ORDER BY id', cid),
    filings: await db.all('SELECT * FROM aml_filings WHERE company_id=? ORDER BY due', cid),
    audit: await db.all('SELECT * FROM aml_audit WHERE company_id=? ORDER BY id', cid),
  };
  await audit(db, req, 'export', 'company', cid, { counts: Object.fromEntries(Object.entries(pack).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length])) });
  return pack;
}

// Хадгалах хугацаа: харилцаа дууссан/гүйлгээнээс хойш 5 жил (МУТСТХ 8.1) — энэ хугацаанд устгахыг хориглоно
async function retentionBlock(db, cid) {
  const r = await db.one(`SELECT (SELECT COUNT(*) FROM aml_profiles WHERE company_id=? AND (ended_at IS NULL OR ended_at > (NOW() - INTERVAL '5 years')::date))::int p,
    (SELECT COUNT(*) FROM aml_tx WHERE company_id=? AND tx_date > (NOW() - INTERVAL '5 years')::date)::int t, (SELECT COUNT(*) FROM aml_reports WHERE company_id=? AND created_at > NOW() - INTERVAL '5 years')::int r`, cid, cid, cid);
  return r.p + r.t + r.r > 0 ? r : null;
}

module.exports = { settings, saveSettings, isOfficer, audit, listProfiles, getProfile, saveProfile, verifyProfile, approveEdd, decideHit, rescreenAll, saveDoc, readDoc, DOC_KINDS, DOC_KEY: !!DOC_KEY, encrypt, decrypt,
  saveTx, syncDeal, linkedOver, saveReport, submitReport, getReport, tasks, stats, quarter, exportPack, retentionBlock, displayName, derive, cleanData, cleanBo };
