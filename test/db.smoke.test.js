// Өгөгдлийн сангийн smoke тест (CI дээр Postgres service-тэй): схем үүсэх → нөөцлөх → өөр санд сэргээх → тоо таарах.
// DATABASE_URL ба RESTORE_DATABASE_URL байхгүй бол алгасна (локал `npm test`-д саад болохгүй).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path'); const os = require('node:os'); const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const URL1 = process.env.DATABASE_URL, URL2 = process.env.RESTORE_DATABASE_URL;
test('схем → нөөц → сэргээлт', { skip: !URL1 || !URL2 ? 'DATABASE_URL / RESTORE_DATABASE_URL алга' : false, timeout: 120000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zuuch-bk-')); process.env.ZUUCH_BACKUPS = dir;
  const { db, ready } = require('../db');
  await ready;
  const backup = require('../backup');
  const r = await backup.run(db, { reason: 'ci' });
  assert.ok(r.size > 0 && r.counts.users > 0, 'нөөцөд хэрэглэгч байх ёстой');
  const file = path.join(dir, r.name);
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'tools', 'restore_backup.js'), file, '--replace'], { env: { ...process.env, DATABASE_URL: URL2 }, encoding: 'utf8' });
  assert.match(out, /сэргээсэн/);
  const { Pool } = require('pg'); const p2 = new Pool({ connectionString: URL2 });
  for (const [t, n] of Object.entries(r.counts)) {
    const c = (await p2.query(`SELECT COUNT(*)::int n FROM "${t}"`)).rows[0].n;
    assert.equal(c, n, `${t}: ${c} ≠ ${n}`);
  }
  await p2.end();
  const pi = require('../priceindex'); const res = await pi.compute(db); assert.ok(Array.isArray(res.rows));
  const dd = require('../dedup'); const g = await dd.regroup(db); assert.ok(g.groups >= 0);
  setTimeout(() => process.exit(0), 100).unref(); // pg pool-ыг хаахгүй үлдээхгүй
});
