// «Зууч» — дүүргийн үнийн индекс (сая ₮/м²) БОДИТ зараас: цуглуулагчийн зарууд (unegui, omch, my-zar), сүүлийн 120 хоног, орон сууц худалдаа.
// source: 'market' (тухайн бүлгийн бодит түүвэр), 'market-all' (шинэ байрны түүвэр хүрэлцэхгүй → бүх зарын медиан, «ялгаагүй»), 'demo' (бодит түүвэр алга — жишиг).
// Шинэ байр: гарчгийн тодорхой хэллэг («шинэ байр», «ашиглалтад орсон 2024» …) — «Шинэ яармаг/амгалан» г.м. газрын нэрийг тооцохгүй.
const MIN_ALL = 12, MIN_NEW = 10, DAYS = 120;
const NEW_RE = "(шинэ\\s+(байр|орон\\s*сууц|барилга))|(ашиглалт(ад|анд)\\s+(орсон|орох|ороогүй|орж))|(20(1[89]|2[0-9])\\s*(он|онд)\\s*(ашиглалт|баригдсан|орсон))|(шинээр\\s+баригдсан)";

async function compute(db, log = () => {}) {
  const month = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7); // УБ сар
  const base = `FROM market_listings WHERE collected_at IS NOT NULL AND source <> 'demo' AND deal_type='sale' AND COALESCE(category,'apartment')='apartment'
    AND area BETWEEN 15 AND 400 AND price > 0 AND price/area BETWEEN 0.8 AND 25 AND COALESCE(city,'Улаанбаатар')='Улаанбаатар'
    AND COALESCE(last_seen, NULLIF(collected_at,'')::timestamptz) >= NOW() - INTERVAL '${DAYS} days'`;
  const agg = `COUNT(*)::int AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY price/area) AS med, percentile_cont(0.25) WITHIN GROUP (ORDER BY price/area) AS p25, percentile_cont(0.75) WITHIN GROUP (ORDER BY price/area) AS p75`;
  const rows = await db.all(`SELECT district, (COALESCE(title,'') ~* '${NEW_RE}' OR is_new=1) AS nw, ${agg} ${base} GROUP BY 1, 2`);
  const all = await db.all(`SELECT district, ${agg} ${base} GROUP BY 1`);
  const r2 = (v) => Math.round(v * 100) / 100; const out = [];
  for (const a of all) {
    if (!a.district || a.n < MIN_ALL) continue;
    const nw = rows.find((r) => r.district === a.district && r.nw), od = rows.find((r) => r.district === a.district && !r.nw);
    const put = async (isNew, s, src) => {
      await db.run(`INSERT INTO price_index (district,is_new,median_m2,p25_m2,p75_m2,sample,month,source,updated_at) VALUES (?,?,?,?,?,?,?,?,NOW())
        ON CONFLICT (district,is_new,month) DO UPDATE SET median_m2=EXCLUDED.median_m2, p25_m2=EXCLUDED.p25_m2, p75_m2=EXCLUDED.p75_m2, sample=EXCLUDED.sample, source=EXCLUDED.source, updated_at=NOW()`,
      a.district, isNew, r2(s.med), r2(s.p25), r2(s.p75), s.n, month, src);
      out.push({ district: a.district, isNew, med: r2(s.med), n: s.n, src });
    };
    await put(1, nw && nw.n >= MIN_NEW ? nw : a, nw && nw.n >= MIN_NEW ? 'market' : 'market-all');
    await put(0, od && od.n >= MIN_ALL && nw && nw.n >= MIN_NEW ? od : a, od && od.n >= MIN_ALL && nw && nw.n >= MIN_NEW ? 'market' : 'market-all');
    await db.run("DELETE FROM price_index WHERE district=? AND COALESCE(source,'demo')='demo'", a.district); // бодит тоо гарсан дүүргийн жишиг мөрийг арилгана
  }
  log(`[индекс] ${month}: ${out.length} мөр (${out.filter((o) => o.src === 'market').length} тусгай түүвэртэй) — ${out.map((o) => `${o.district}${o.isNew ? '·шинэ' : ''} ${o.med} (${o.n})`).join(', ')}`);
  return { month, rows: out };
}

function schedule(db, log = console.log) {
  const tick = () => compute(db, log).catch((e) => log('[индекс] алдаа: ' + e.message));
  setTimeout(tick, 60e3).unref(); setInterval(tick, 6 * 3600e3).unref();
}

module.exports = { compute, schedule };
