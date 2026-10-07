// «Зууч» комплаенс — API. Эрх: захирал + томилогдсон МУТСТ ажилтан = бүрэн; агент = өөрийн үүсгэсэн ХТМ, сэжиг мэдээлэх.
// СМА-ны тайлан, хориг жагсаалтын тохирлын дэлгэрэнгүйг зөвхөн комплаенсын эрхтэй хүн харна (МУТСТХ 13.1 — задруулахыг хориглох).
'use strict';
const multer = require('multer');
const R = require('./rules');
const S = require('./store');
const sanctions = require('./sanctions');

module.exports = function mount(app, { db, wrap, ownerOnly, UPLOAD_DIR }) {
  const mem = multer({ storage: multer.memoryStorage(), limits: { files: 1, fileSize: 15 * 1024 * 1024 } });
  const err = (res, e) => res.status(e.status || 500).json({ error: e.message });
  const officer = wrap(async (req, res, next) => { req.aml = await S.settings(db, req.user.company_id); if (!S.isOfficer(req.aml, req.user)) return res.status(403).json({ error: 'Зөвхөн захирал эсвэл МУТСТ-ийн ажилтан' }); next(); });
  const zahiral = (req, res, next) => (req.user.role === 'zahiral' || req.user.is_owner ? next() : res.status(403).json({ error: 'Зөвхөн гүйцэтгэх удирдлага (захирал)' }));
  const ctx = wrap(async (req, res, next) => { req.aml = await S.settings(db, req.user.company_id); req.isOff = S.isOfficer(req.aml, req.user); next(); });
  // Агент зөвхөн өөрийн үүсгэсэн профайлд хандана
  const canProfile = async (req, id) => { const p = await db.one('SELECT created_by FROM aml_profiles WHERE id=? AND company_id=?', id, req.user.company_id); return p && (req.isOff || p.created_by === req.user.id); };
  const redact = (p, off) => (off || !p ? p : { ...p, sanctions: { checked_at: p.sanctions && p.sanctions.checked_at, pending: ((p.sanctions && p.sanctions.hits) || []).some((h) => !h.cleared) }, risk_reasons: [] });

  app.get('/api/aml/overview', ctx, wrap(async (req, res) => {
    const s = req.aml; const base = { officer: req.isOff, rules: { threshold: R.THRESHOLD, methods: R.METHODS, factors: R.FACTORS, pep_positions: R.PEP_POSITIONS, pep_relations: R.PEP_RELATIONS, indicators: R.INDICATORS, doc_kinds: S.DOC_KINDS, change_types: R.CHANGE_TYPES, cal_kinds: R.CAL_KINDS, bo_percent: R.BO_PERCENT }, encryption: S.DOC_KEY };
    if (!req.isOff) return res.json({ ...base, mine: (await S.listProfiles(db, req.user.company_id, { uid: req.user.id })).map((p) => redact(p, false)) });
    const users = await db.all('SELECT id, name, role FROM users WHERE company_id=? ORDER BY role DESC, name', req.user.company_id);
    res.json({ ...base, settings: s, users, tasks: await S.tasks(db, req.user.company_id, s), stats: await S.stats(db, req.user.company_id), sanctions: sanctions.status(), calendar: R.calendar(R.ubDate(Date.now() - 200 * 864e5), R.ubDate(Date.now() + 200 * 864e5)), filings: await db.all('SELECT * FROM aml_filings WHERE company_id=? ORDER BY due DESC', req.user.company_id) });
  }));
  app.put('/api/aml/settings', zahiral, wrap(async (req, res) => { const s = await S.saveSettings(db, req.user.company_id, req.body || {}); await S.audit(db, req, 'settings.update', 'company', req.user.company_id, { keys: Object.keys(req.body || {}) }); res.json(s); }));

  // ---- ХТМ профайл ----
  app.get('/api/aml/profiles', ctx, wrap(async (req, res) => res.json((await S.listProfiles(db, req.user.company_id, { q: req.query.q, uid: req.isOff ? null : req.user.id })).map((p) => redact(p, req.isOff)))));
  app.get('/api/aml/profiles/:id', ctx, wrap(async (req, res) => { if (!(await canProfile(req, req.params.id))) return res.status(404).json({ error: 'Олдсонгүй' }); const p = await S.getProfile(db, req.user.company_id, req.params.id); await S.audit(db, req, 'profile.view', 'profile', req.params.id); res.json(redact(p, req.isOff)); }));
  app.post('/api/aml/profiles', ctx, wrap(async (req, res) => { try { res.json(redact(await S.saveProfile(db, req, null, req.body || {}), req.isOff)); } catch (e) { err(res, e); } }));
  app.put('/api/aml/profiles/:id', ctx, wrap(async (req, res) => { if (!(await canProfile(req, req.params.id))) return res.status(404).json({ error: 'Олдсонгүй' }); try { res.json(redact(await S.saveProfile(db, req, Number(req.params.id), req.body || {}), req.isOff)); } catch (e) { err(res, e); } }));
  app.post('/api/aml/profiles/:id/verify', ctx, wrap(async (req, res) => { if (!(await canProfile(req, req.params.id))) return res.status(404).json({ error: 'Олдсонгүй' }); try { res.json(redact(await S.verifyProfile(db, req, Number(req.params.id)), req.isOff)); } catch (e) { err(res, e); } }));
  app.post('/api/aml/profiles/:id/approve', zahiral, wrap(async (req, res) => { try { res.json(await S.approveEdd(db, req, Number(req.params.id), (req.body || {}).note)); } catch (e) { err(res, e); } }));
  app.post('/api/aml/profiles/:id/hits/:i', officer, wrap(async (req, res) => { try { res.json(await S.decideHit(db, req, Number(req.params.id), Number(req.params.i), (req.body || {}).decision === 'confirm' ? 'confirm' : 'clear', (req.body || {}).note)); } catch (e) { err(res, e); } }));
  app.post('/api/aml/profiles/:id/end', officer, wrap(async (req, res) => { // харилцаа дууссан — 5 жилийн хадгалалт эндээс тоологдоно
    const d = /^\d{4}-\d{2}-\d{2}$/.test((req.body || {}).date || '') ? req.body.date : R.ubDate(Date.now());
    await db.run('UPDATE aml_profiles SET ended_at=?, updated_at=NOW() WHERE id=? AND company_id=?', d, req.params.id, req.user.company_id); await S.audit(db, req, 'profile.end', 'profile', req.params.id, { date: d, retain_until: R.retainUntil(d) }); res.json({ ok: true, retain_until: R.retainUntil(d) });
  }));
  app.post('/api/aml/profiles/:id/docs', ctx, mem.single('file'), wrap(async (req, res) => { if (!(await canProfile(req, req.params.id))) return res.status(404).json({ error: 'Олдсонгүй' }); try { const id = await S.saveDoc(db, req, UPLOAD_DIR, { ownerType: 'profile', ownerId: req.params.id, kind: req.body.kind, file: req.file, note: req.body.note }); res.json({ id, profile: redact(await S.getProfile(db, req.user.company_id, req.params.id), req.isOff) }); } catch (e) { err(res, e); } }));
  app.post('/api/aml/docs', officer, mem.single('file'), wrap(async (req, res) => { try { res.json({ id: await S.saveDoc(db, req, UPLOAD_DIR, { ownerType: req.body.owner_type, ownerId: req.body.owner_id || null, kind: req.body.kind, file: req.file, note: req.body.note }) }); } catch (e) { err(res, e); } }));
  app.get('/api/aml/docs', officer, wrap(async (req, res) => res.json(await db.all('SELECT id, owner_type, owner_id, kind, orig_name, mime, size, enc, original_seen, note, uploaded_by, created_at FROM aml_docs WHERE company_id=? AND owner_type <> ? ORDER BY id DESC', req.user.company_id, 'profile'))));
  app.post('/api/aml/docs/:id/seen', ctx, wrap(async (req, res) => { // хуулбарыг эх хувьтай нь тулгасан (МУТСТХ 5.2.1)
    const d = await db.one('SELECT owner_type, owner_id FROM aml_docs WHERE id=? AND company_id=?', req.params.id, req.user.company_id); if (!d || (d.owner_type === 'profile' && !(await canProfile(req, d.owner_id)))) return res.status(404).json({ error: 'Олдсонгүй' });
    await db.run('UPDATE aml_docs SET original_seen=TRUE WHERE id=?', req.params.id); await S.audit(db, req, 'doc.original_seen', 'doc', req.params.id); res.json({ ok: true });
  }));
  app.get('/api/aml/docs/:id', ctx, wrap(async (req, res) => {
    const d0 = await db.one('SELECT owner_type, owner_id FROM aml_docs WHERE id=? AND company_id=?', req.params.id, req.user.company_id); if (!d0 || (d0.owner_type === 'profile' ? !(await canProfile(req, d0.owner_id)) : !req.isOff)) return res.status(404).json({ error: 'Олдсонгүй' });
    try { const r = await S.readDoc(db, req, UPLOAD_DIR, req.params.id); res.set('Content-Type', r.doc.mime).set('Cache-Control', 'no-store').set('Content-Disposition', `inline; filename="doc-${r.doc.id}"`).send(r.buf); } catch (e) { err(res, e); }
  }));
  app.delete('/api/aml/docs/:id', officer, wrap(async (req, res) => { // зөвхөн алдаатай оруулсныг 24 цагийн дотор (бусад нь 5 жил хадгалагдана)
    const d = await db.one("SELECT * FROM aml_docs WHERE id=? AND company_id=? AND created_at > NOW() - INTERVAL '24 hours'", req.params.id, req.user.company_id); if (!d) return res.status(409).json({ error: 'Баримтыг 5 жил хадгална (МУТСТХ 8.1) — зөвхөн 24 цагийн дотор алдаатай оруулсныг устгана' });
    await db.run('DELETE FROM aml_docs WHERE id=?', d.id); await require('fs').promises.unlink(require('path').join(UPLOAD_DIR, 'aml', String(d.company_id), d.filename)).catch(() => {}); await S.audit(db, req, 'doc.delete', 'doc', d.id, { sha256: d.sha256, reason: String((req.query.reason || '')).slice(0, 200) }); res.json({ ok: true });
  }));

  // ---- Гүйлгээ ----
  app.get('/api/aml/tx', officer, wrap(async (req, res) => res.json(await db.all(`SELECT t.*, t.tx_date::text tx_date, pb.data->>'given_name' b_given, pb.data->>'name' b_name, pb.status b_status, ps.data->>'given_name' s_given, ps.data->>'name' s_name, ps.status s_status, p.district, p.khoroolol,
      (SELECT json_agg(json_build_object('id', r.id, 'type', r.type, 'status', r.status)) FROM aml_reports r WHERE r.tx_id=t.id) reports
    FROM aml_tx t LEFT JOIN aml_profiles pb ON pb.id=t.buyer_id LEFT JOIN aml_profiles ps ON ps.id=t.seller_id LEFT JOIN deals d ON d.id=t.deal_id LEFT JOIN properties p ON p.id=d.property_id WHERE t.company_id=? ORDER BY t.tx_date DESC, t.id DESC LIMIT 500`, req.user.company_id))));
  app.post('/api/aml/tx', officer, wrap(async (req, res) => { try { res.json(await S.saveTx(db, req, null, req.body || {})); } catch (e) { err(res, e); } }));
  app.put('/api/aml/tx/:id', officer, wrap(async (req, res) => { try { const r = await S.saveTx(db, req, Number(req.params.id), req.body || {}); if (!r) return res.status(404).json({ error: 'Олдсонгүй' }); res.json(r); } catch (e) { err(res, e); } }));

  // ---- СМА-ны тайлан (зөвхөн комплаенс) ----
  app.get('/api/aml/reports', officer, wrap(async (req, res) => res.json(await db.all('SELECT r.*, u.name created_by_name FROM aml_reports r LEFT JOIN users u ON u.id=r.created_by WHERE r.company_id=? ORDER BY (r.status=\'draft\') DESC, r.due_at NULLS LAST, r.id DESC', req.user.company_id))));
  app.get('/api/aml/reports/:id', officer, wrap(async (req, res) => { const r = await S.getReport(db, req.user.company_id, req.params.id); if (!r) return res.status(404).json({ error: 'Олдсонгүй' }); await S.audit(db, req, 'report.view', 'report', r.id); res.json(r); }));
  app.post('/api/aml/reports', officer, wrap(async (req, res) => { try { res.json(await S.saveReport(db, req, null, req.body || {})); } catch (e) { err(res, e); } }));
  app.put('/api/aml/reports/:id', officer, wrap(async (req, res) => { try { const r = await S.saveReport(db, req, Number(req.params.id), req.body || {}); if (!r) return res.status(404).json({ error: 'Олдсонгүй' }); res.json(r); } catch (e) { err(res, e); } }));
  app.post('/api/aml/reports/:id/submit', officer, wrap(async (req, res) => { try { res.json(await S.submitReport(db, req, Number(req.params.id), req.body || {})); } catch (e) { err(res, e); } }));

  // ---- Дотоод сэжгийн мэдээлэл: хэн ч илгээнэ, шийдвэрийг зөвхөн комплаенс харна ----
  app.post('/api/aml/referrals', ctx, wrap(async (req, res) => {
    const b = req.body || {}; const text = String(b.text || '').trim(); if (text.length < 10) return res.status(400).json({ error: 'Сэжиглэсэн шалтгааныг дэлгэрэнгүй бичнэ үү' });
    if (b.profile_id && !(await db.one('SELECT 1 FROM aml_profiles WHERE id=? AND company_id=?', b.profile_id, req.user.company_id))) return res.status(400).json({ error: 'Профайл олдсонгүй' });
    const r = await db.one('INSERT INTO aml_referrals (company_id, profile_id, deal_id, text, indicators, created_by) VALUES (?,?,?,?,?::jsonb,?) RETURNING id, created_at', req.user.company_id, b.profile_id || null, b.deal_id || null, text.slice(0, 4000), JSON.stringify(Array.isArray(b.indicators) ? b.indicators.slice(0, 20) : []), req.user.id);
    await S.audit(db, req, 'referral.create', 'referral', r.id); res.json({ id: r.id, msg: 'Комплаенсын ажилтанд хүргэгдлээ. Энэ талаар харилцагчид мэдэгдэхийг хуулиар хориглоно (МУТСТХ 13.1).' });
  }));
  app.get('/api/aml/referrals', ctx, wrap(async (req, res) => res.json(req.isOff
    ? await db.all('SELECT f.*, u.name created_by_name FROM aml_referrals f LEFT JOIN users u ON u.id=f.created_by WHERE f.company_id=? ORDER BY (f.status=\'open\') DESC, f.id DESC', req.user.company_id)
    : await db.all('SELECT id, profile_id, deal_id, text, created_at FROM aml_referrals WHERE company_id=? AND created_by=? ORDER BY id DESC', req.user.company_id, req.user.id))));
  app.put('/api/aml/referrals/:id', officer, wrap(async (req, res) => { // шийдвэр: str (СГТ үүсгэх) | no_action (үндэслэлтэй тайлбартай)
    const b = req.body || {}; const f = await db.one("SELECT * FROM aml_referrals WHERE id=? AND company_id=? AND status='open'", req.params.id, req.user.company_id); if (!f) return res.status(404).json({ error: 'Олдсонгүй эсвэл шийдэгдсэн' });
    const decision = String(b.decision || '').trim(); if (decision.length < 10) return res.status(400).json({ error: 'Шийдвэрийн үндэслэлийг бичнэ үү' });
    let report = null;
    if (b.action === 'str') report = await S.saveReport(db, req, null, { type: 'STR', profile_id: f.profile_id, referral_id: f.id, detected_at: f.created_at, grounds: f.text, indicators: f.indicators }); // 24 цаг нь сэжиг илэрсэн мөчөөс
    await db.run("UPDATE aml_referrals SET status=?, decision=?, closed_by=?, closed_at=NOW() WHERE id=?", b.action === 'str' ? 'reported' : 'no_action', decision.slice(0, 2000), req.user.id, f.id);
    await S.audit(db, req, 'referral.decide', 'referral', f.id, { action: b.action === 'str' ? 'str' : 'no_action', report: report && report.id }); res.json({ ok: true, report });
  }));

  // ---- Ажилтан, гэрчилгээ (СЗХ №648, 2.1.4–2.1.7, 4.1) ----
  const POS = ['executive', 'broker', 'agent', 'sales', 'aml_officer', 'other'];
  app.get('/api/aml/staff', officer, wrap(async (req, res) => res.json(await db.all("SELECT u.id user_id, u.name, u.role, s.position, s.cert_no, s.cert_issued::text cert_issued, s.cert_expires::text cert_expires, s.fit_checked::text fit_checked, s.note FROM users u LEFT JOIN aml_staff s ON s.user_id=u.id AND s.company_id=u.company_id WHERE u.company_id=? ORDER BY u.name", req.user.company_id))));
  app.put('/api/aml/staff/:uid', officer, wrap(async (req, res) => {
    const b = req.body || {}; if (!(await db.one('SELECT 1 FROM users WHERE id=? AND company_id=?', req.params.uid, req.user.company_id))) return res.status(404).json({ error: 'Олдсонгүй' });
    const d = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);
    await db.run(`INSERT INTO aml_staff (company_id, user_id, position, cert_no, cert_issued, cert_expires, fit_checked, note, updated_at) VALUES (?,?,?,?,?,?,?,?,NOW())
      ON CONFLICT (company_id, user_id) DO UPDATE SET position=EXCLUDED.position, cert_no=EXCLUDED.cert_no, cert_issued=EXCLUDED.cert_issued, cert_expires=EXCLUDED.cert_expires, fit_checked=EXCLUDED.fit_checked, note=EXCLUDED.note, updated_at=NOW()`,
    req.user.company_id, req.params.uid, POS.includes(b.position) ? b.position : 'other', String(b.cert_no || '').slice(0, 60), d(b.cert_issued), d(b.cert_expires), d(b.fit_checked), String(b.note || '').slice(0, 300));
    await S.audit(db, req, 'staff.update', 'user', req.params.uid, { position: b.position }); res.json({ ok: true });
  }));

  // ---- Сургалт, СЗХ-д мэдэгдэх өөрчлөлт, тайлан илгээсэн тэмдэглэл ----
  app.get('/api/aml/training', officer, wrap(async (req, res) => res.json(await db.all('SELECT *, date::text date FROM aml_training WHERE company_id=? ORDER BY date DESC', req.user.company_id))));
  app.post('/api/aml/training', officer, wrap(async (req, res) => {
    const b = req.body || {}; if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '') || !String(b.topic || '').trim()) return res.status(400).json({ error: 'Огноо, сэдэв шаардлагатай' });
    const r = await db.one('INSERT INTO aml_training (company_id, date, topic, hours, trainer, kind, attendees, created_by) VALUES (?,?,?,?,?,?,?::jsonb,?) RETURNING id', req.user.company_id, b.date, String(b.topic).slice(0, 300), Math.max(0, Math.min(200, Number(b.hours) || 0)), String(b.trainer || '').slice(0, 160), ['internal', 'certificate', 'sanctions'].includes(b.kind) ? b.kind : 'internal', JSON.stringify((Array.isArray(b.attendees) ? b.attendees : []).map(Number).filter(Boolean)), req.user.id);
    await S.audit(db, req, 'training.create', 'training', r.id); res.json(r);
  }));
  app.get('/api/aml/changes', officer, wrap(async (req, res) => res.json(await db.all('SELECT *, decision_date::text decision_date, due::text due, submitted_at::text submitted_at FROM aml_changes WHERE company_id=? ORDER BY id DESC', req.user.company_id))));
  app.post('/api/aml/changes', officer, wrap(async (req, res) => {
    const b = req.body || {}; if (!R.CHANGE_TYPES[b.type] || !/^\d{4}-\d{2}-\d{2}$/.test(b.decision_date || '')) return res.status(400).json({ error: 'Төрөл, шийдвэрийн огноо шаардлагатай' });
    const due = R.changeDue(b.decision_date); const r = await db.one('INSERT INTO aml_changes (company_id, type, description, decision_date, due, created_by) VALUES (?,?,?,?,?,?) RETURNING id', req.user.company_id, b.type, String(b.description || '').slice(0, 1000), b.decision_date, due, req.user.id);
    await S.audit(db, req, 'change.create', 'change', r.id, { type: b.type, due }); res.json({ id: r.id, due });
  }));
  app.put('/api/aml/changes/:id', officer, wrap(async (req, res) => { const b = req.body || {}; const d = /^\d{4}-\d{2}-\d{2}$/.test(b.submitted_at || '') ? b.submitted_at : R.ubDate(Date.now()); await db.run('UPDATE aml_changes SET submitted_at=?, frc_ref=? WHERE id=? AND company_id=?', d, String(b.frc_ref || '').slice(0, 120), req.params.id, req.user.company_id); await S.audit(db, req, 'change.submit', 'change', req.params.id, { frc_ref: b.frc_ref }); res.json({ ok: true }); }));
  app.post('/api/aml/filings', officer, wrap(async (req, res) => {
    const b = req.body || {}; if (!R.CAL_KINDS[b.key] || !/^\d{4}(-(Q[1-4]|H[12]))?$/.test(b.period || '')) return res.status(400).json({ error: 'Буруу тайлан' });
    const item = R.calendar('2000-01-01', '2100-01-01').find((c) => c.key === b.key && c.period === b.period); if (!item) return res.status(400).json({ error: 'Хугацаа олдсонгүй' });
    await db.run('INSERT INTO aml_filings (company_id, key, period, due, submitted_at, ref, by_user) VALUES (?,?,?,?,?,?,?) ON CONFLICT (company_id, key, period) DO UPDATE SET submitted_at=EXCLUDED.submitted_at, ref=EXCLUDED.ref, by_user=EXCLUDED.by_user', req.user.company_id, b.key, b.period, item.due, /^\d{4}-\d{2}-\d{2}$/.test(b.submitted_at || '') ? b.submitted_at : R.ubDate(Date.now()), String(b.ref || '').slice(0, 120), req.user.id);
    await S.audit(db, req, 'filing.submit', 'filing', null, { key: b.key, period: b.period }); res.json({ ok: true });
  }));
  app.get('/api/aml/quarter', officer, wrap(async (req, res) => { try { res.json(await S.quarter(db, req.user.company_id, req.query.period)); } catch (e) { err(res, e); } }));
  app.get('/api/aml/audit', officer, wrap(async (req, res) => res.json(await db.all('SELECT * FROM aml_audit WHERE company_id=? ORDER BY id DESC LIMIT 1000', req.user.company_id))));
  app.get('/api/aml/export', officer, wrap(async (req, res) => { const pack = await S.exportPack(db, req); res.set('Content-Disposition', `attachment; filename="zuuch-komplaens-${R.ubDate(Date.now())}.json"`).json(pack); }));

  // ---- Хориг жагсаалт ----
  app.get('/api/aml/sanctions', officer, wrap(async (req, res) => res.json({ status: sanctions.status(), national: await db.all("SELECT ref, kind, names, dob, info, updated_at FROM aml_sanctions WHERE source='MN' ORDER BY updated_at DESC") })));
  app.post('/api/aml/sanctions/test', officer, wrap(async (req, res) => res.json({ hits: R.screen({ names: [String((req.body || {}).name || '')], dob: (req.body || {}).dob || null }, await sanctions.entries()) })));
  app.post('/api/owner/aml/sanctions/refresh', ownerOnly, wrap(async (req, res) => { try { const r = await sanctions.refreshUN(); const s = await S.rescreenAll(db); res.json({ ...r, ...s }); } catch (e) { err(res, e); } }));
  app.post('/api/owner/aml/sanctions/national', ownerOnly, wrap(async (req, res) => { try { const r = await sanctions.addNational(req.body || {}); const s = await S.rescreenAll(db); res.json({ ...r, ...s }); } catch (e) { err(res, e); } }));
  app.delete('/api/owner/aml/sanctions/national/:ref', ownerOnly, wrap(async (req, res) => { await sanctions.removeNational(req.params.ref); res.json({ ok: true }); }));

  sanctions.schedule(db, () => S.rescreenAll(db).then((r) => r.newHits && console.log(`[МУТСТ] шинэ боломжит тохирол: ${r.newHits} профайл`)));
  return { syncDeal: (req, id) => S.syncDeal(db, req, id).catch((e) => console.error('[МУТСТ] хэлцэл', e.message)), retentionBlock: (cid) => S.retentionBlock(db, cid) };
};
