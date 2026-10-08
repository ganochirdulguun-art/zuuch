// «Зууч» — сарын багц ба AI студийн кредит: компанийн сан (нөөц) → агент бүрт сарын хуваарилалт, шилжүүлэг, урамшуулал, шинэ агент, буцаалт.
// Бүртгэл (ledger): credit_ledger мөр бүр = өөрчлөлт (+/−). Үлдэгдэл = нийлбэр. user_id NULL = компанийн нөөц.
// 1 кредит = 1 зургийн виртуал цэгцлэлт (Gemini). Зургийн автомат засвар (өнцөг/гэрэл) кредит шаардахгүй.

// Багцууд (НӨАТ орсон сарын төлбөр, агентын тоо хязгааргүй) — 2026-10-07 эзэн баталсан
const PLANS = {
  standard: { name: 'Стандарт', price: 1800000, credits: 600, studio: 60, tours: 40, storageGB: 50, special: 1, logo: false, support: 'Онлайн' },
  pro: { name: 'Мэргэжлийн', price: 2600000, credits: 1000, studio: 120, tours: 80, storageGB: 100, special: 3, logo: true, support: 'Газар дээр 1 өдөр' },
  premium: { name: 'Тэргүүлэх', price: 3400000, credits: 1500, studio: 200, tours: 120, storageGB: 200, special: 6, logo: true, support: 'Тусгай менежер' },
};
const PACKS = { S: { credits: 100, price: 69000 }, M: { credits: 500, price: 290000 }, L: { credits: 2000, price: 990000 } };
const SPECIAL = { price: 149000, credits: 40 }; // «Онцгой лист» нэг удаагийн багц
const PER_AGENT = 25; // зөвлөмж: нэг листингийн стандарт зураг (22–27) — агент бүрт сард 1 листинг
const RESERVE_HINT = 0.2; // нөөцөд үлдээхийг зөвлөх хувь

const ubMonth = (d = new Date()) => new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 7);

async function balances(db, cid) {
  const rows = await db.all('SELECT user_id, COALESCE(SUM(delta),0)::int AS bal FROM credit_ledger WHERE company_id=? GROUP BY user_id', cid);
  const m = new Map(rows.map((r) => [r.user_id, r.bal])); return { reserve: m.get(null) || 0, users: m };
}
async function balance(db, cid, uid) { const r = await db.one('SELECT COALESCE(SUM(delta),0)::int AS bal FROM credit_ledger WHERE company_id=? AND user_id IS NOT DISTINCT FROM ?', cid, uid ?? null); return r.bal; }
async function add(t, { cid, uid = null, delta, kind, note = '', ref = null, by = null }) {
  await t.run('INSERT INTO credit_ledger (company_id, user_id, delta, kind, note, ref, by_user) VALUES (?,?,?,?,?,?,?)', cid, uid, delta, kind, String(note).slice(0, 200), ref, by);
}
// Нөөцөөс агент руу (n > 0) эсвэл агентаас нөөц рүү (n < 0)
async function transfer(db, { cid, uid, n, note, by, kind = 'transfer' }) {
  n = Math.trunc(Number(n)); if (!n) throw new Error('Кредитийн тоо буруу');
  return db.tx(async (t) => {
    const u = await t.one('SELECT id, name FROM users WHERE id=? AND company_id=?', uid, cid); if (!u) throw new Error('Ажилтан олдсонгүй');
    if (n > 0) { const r = await t.one('SELECT COALESCE(SUM(delta),0)::int AS bal FROM credit_ledger WHERE company_id=? AND user_id IS NULL', cid); if (r.bal < n) throw new Error(`Компанийн нөөцөд ${r.bal} кредит байна`); }
    else { const r = await t.one('SELECT COALESCE(SUM(delta),0)::int AS bal FROM credit_ledger WHERE company_id=? AND user_id=?', cid, uid); if (r.bal < -n) throw new Error(`${u.name}-д ${r.bal} кредит байна`); }
    await add(t, { cid, uid: null, delta: -n, kind, note: (n > 0 ? '→ ' : '← ') + u.name + (note ? ' · ' + note : ''), by });
    await add(t, { cid, uid, delta: n, kind, note: note || (n > 0 ? 'Нөөцөөс' : 'Нөөц рүү буцаав'), by });
    return { ok: true };
  });
}
// Кредит зарцуулах (виртуал цэгцлэлт г.м.): эхлээд агентынх, тохиргоогоор нөөцөөс нөхнө
// allowReserve: захирал/эзэн өөрийн кредит дуусвал компанийн нөөцөөс шууд (тохиргооноос үл хамааран)
async function spend(db, { cid, uid, n, note, ref, allowReserve = false }) {
  n = Math.trunc(Number(n)); if (!(n > 0)) return { ok: true, used: 0 };
  return db.tx(async (t) => {
    const s = await settings(t, cid);
    const own = (await t.one('SELECT COALESCE(SUM(delta),0)::int AS bal FROM credit_ledger WHERE company_id=? AND user_id=?', cid, uid)).bal;
    const res = (await t.one('SELECT COALESCE(SUM(delta),0)::int AS bal FROM credit_ledger WHERE company_id=? AND user_id IS NULL', cid)).bal;
    const fromOwn = Math.min(own, n), fromRes = n - fromOwn;
    const canRes = s.fallback || allowReserve;
    if (fromRes > 0 && (!canRes || res < fromRes)) throw Object.assign(new Error(allowReserve ? `Кредит хүрэлцэхгүй: танд ${own}, компанийн нөөцөд ${res}, хэрэгтэй ${n}. «Багц ба кредит» эсвэл эзний самбараас кредит нэмнэ үү.` : `Кредит хүрэлцэхгүй: танд ${own}${s.fallback ? `, нөөцөд ${res}` : ''}, хэрэгтэй ${n}. Захиралаас хүсэх эсвэл нэмэлт кредит авна уу.`), { status: 402 });
    if (fromOwn) await add(t, { cid, uid, delta: -fromOwn, kind: 'spend', note, ref });
    if (fromRes) await add(t, { cid, uid: null, delta: -fromRes, kind: 'spend', note: (note || '') + ' (нөөцөөс)', ref, by: uid });
    return { ok: true, used: n, fromOwn, fromReserve: fromRes };
  });
}
async function settings(db, cid) {
  const r = await db.one('SELECT plan, meta FROM companies WHERE id=?', cid); const m = (r && r.meta && r.meta.credits) || {};
  return { plan: r && PLANS[r.plan] ? r.plan : null, perAgent: Number.isFinite(m.perAgent) ? m.perAgent : PER_AGENT, auto: m.auto !== false, fallback: m.fallback === true };
}
async function saveSettings(db, cid, s) {
  const cur = await settings(db, cid); const v = { perAgent: Math.max(0, Math.min(500, Math.trunc(Number(s.perAgent ?? cur.perAgent)))), auto: s.auto !== undefined ? !!s.auto : cur.auto, fallback: s.fallback !== undefined ? !!s.fallback : cur.fallback };
  await db.run("UPDATE companies SET meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{credits}', ?::jsonb) WHERE id=?", JSON.stringify(v), cid); return v;
}
// Сарын олголт: багцын кредит → нөөц, дараа нь (auto бол) агент бүрт perAgent. Сар бүр нэг л удаа (ref = grant:YYYY-MM).
async function monthly(db, cid, { force = false } = {}) {
  const s = await settings(db, cid); const P = PLANS[s.plan]; if (!P) return { skipped: 'багцгүй' };
  const ref = 'grant:' + ubMonth();
  if (!force && (await db.one("SELECT 1 FROM credit_ledger WHERE company_id=? AND ref=? AND kind='grant'", cid, ref))) return { skipped: 'энэ сард олгосон' };
  return db.tx(async (t) => {
    await add(t, { cid, delta: P.credits, kind: 'grant', note: `${P.name} багц · ${ubMonth()} сарын кредит`, ref });
    let given = 0, agents = 0;
    if (s.auto && s.perAgent > 0) {
      const users = await t.all('SELECT id, name FROM users WHERE company_id=? ORDER BY id', cid);
      for (const u of users) { if (given + s.perAgent > P.credits) break; await add(t, { cid, delta: -s.perAgent, kind: 'allocate', note: '→ ' + u.name, ref }); await add(t, { cid, uid: u.id, delta: s.perAgent, kind: 'allocate', note: `${ubMonth()} сарын хуваарилалт`, ref }); given += s.perAgent; agents++; }
    }
    return { granted: P.credits, allocated: given, agents, reserve: P.credits - given };
  });
}
async function monthlyAll(db) { const out = []; for (const c of await db.all("SELECT id FROM companies WHERE status='active' AND plan = ANY(?)", Object.keys(PLANS))) { try { out.push({ cid: c.id, ...(await monthly(db, c.id)) }); } catch (e) { out.push({ cid: c.id, error: e.message }); } } return out; }
function schedule(db) { const tick = () => monthlyAll(db).then((r) => { const g = r.filter((x) => x.granted); if (g.length) console.log(`[кредит] сарын олголт: ${g.length} компани`); }).catch((e) => console.error('[кредит]', e.message)); setTimeout(tick, 90e3).unref(); setInterval(tick, 3 * 3600e3).unref(); }
// Ажилтан устгагдахад үлдэгдлийг нөөц рүү
async function reclaim(t, cid, uid, name) { const r = await t.one('SELECT COALESCE(SUM(delta),0)::int AS bal FROM credit_ledger WHERE company_id=? AND user_id=?', cid, uid); if (r.bal > 0) { await add(t, { cid, uid, delta: -r.bal, kind: 'reclaim', note: 'Ажлаас гарсан' }); await add(t, { cid, delta: r.bal, kind: 'reclaim', note: '← ' + (name || '#' + uid) + ' (ажлаас гарсан)' }); } return r.bal; }
// Сарын хэрэглээ (багцын хязгаартай харьцуулах)
async function usage(db, cid) {
  const m = ubMonth(); const from = m + '-01';
  const [studio, tours, stor, spent] = await Promise.all([
    db.one("SELECT COUNT(*)::int n FROM listing_drafts WHERE company_id=? AND created_at >= (?::date - INTERVAL '8 hours')", cid, from).catch(() => ({ n: 0 })),
    db.one("SELECT COUNT(*)::int n FROM tours WHERE company_id=? AND (exterior->>'generated_at')::timestamptz >= (?::date - INTERVAL '8 hours')", cid, from).catch(() => ({ n: 0 })),
    db.one("SELECT COALESCE(SUM(size),0)::bigint b FROM tour_media WHERE company_id=? AND status='ready'", cid).catch(() => ({ b: 0 })),
    db.one("SELECT COALESCE(-SUM(delta),0)::int n FROM credit_ledger WHERE company_id=? AND kind='spend' AND created_at >= (?::date - INTERVAL '8 hours')", cid, from),
  ]);
  return { month: m, studio: studio.n, tours: tours.n, storageBytes: Number(stor.b), creditsSpent: spent.n };
}

module.exports = { PLANS, PACKS, SPECIAL, PER_AGENT, RESERVE_HINT, balances, balance, transfer, spend, settings, saveSettings, monthly, monthlyAll, schedule, reclaim, usage, add, ubMonth };
