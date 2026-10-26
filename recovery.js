// «Зууч» — нэвтрэх эрх сэргээх: (1) захирал/эзэн түр нууц үг гаргах (дараагийн нэвтрэлтэд заавал солино),
// (2) сэргээх кодоор өөрөө шинэ нууц үг тохируулах (имэйл/SMS шаардлагагүй; код нэг удаагийн, хэш хэлбэрээр хадгалагдана).
'use strict';
const crypto = require('crypto');

const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // андуурагдах 0/O, 1/I/L-гүй
const rand = (n) => { const b = crypto.randomBytes(n); let s = ''; for (let i = 0; i < n; i++) s += ALPHA[b[i] % ALPHA.length]; return s; };
const norm = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const codeHash = (c) => crypto.createHash('sha256').update('zuuch-recovery:' + (process.env.ZUUCH_SALT || '') + ':' + norm(c)).digest('hex');
const CODES = 8;

// Түр нууц үг: уншихад амар, 10 тэмдэгт (үсэг + тоо заавал)
function tempPassword() { for (;;) { const p = rand(10); if (/[A-Z]/.test(p) && /[0-9]/.test(p)) return p.slice(0, 5) + '-' + p.slice(5); } }

async function setPassword(db, hash, userId, password, mustChange) {
  await db.run('UPDATE users SET pass_hash=?, must_change=? WHERE id=?', hash(password), !!mustChange, userId);
  await db.run('DELETE FROM sessions WHERE user_id=?', userId).catch(() => {}); // бүх төхөөрөмжөөс гаргана
}

// Шинэ сэргээх кодууд (хуучин ашиглаагүйг хүчингүй болгоно). Энгийн текстийг зөвхөн нэг удаа буцаана.
async function newCodes(db, userId) {
  const codes = Array.from({ length: CODES }, () => { const c = rand(10); return c.slice(0, 5) + '-' + c.slice(5); });
  await db.tx(async (t) => {
    await t.run('DELETE FROM recovery_codes WHERE user_id=? AND used_at IS NULL', userId);
    for (const c of codes) await t.run('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?,?)', userId, codeHash(c));
  });
  return codes;
}
async function codeStatus(db, userId) {
  const r = await db.one('SELECT COUNT(*) FILTER (WHERE used_at IS NULL)::int left, MAX(created_at) created FROM recovery_codes WHERE user_id=?', userId);
  return { left: r.left || 0, created_at: r.created };
}
// Код ашиглан нууц үг солих → { username, left } эсвэл null
async function redeem(db, hash, code, password) {
  if (norm(code).length !== 10) return null;
  const row = await db.one('SELECT rc.id, rc.user_id, u.username FROM recovery_codes rc JOIN users u ON u.id=rc.user_id WHERE rc.code_hash=? AND rc.used_at IS NULL', codeHash(code));
  if (!row) return null;
  const upd = await db.run('UPDATE recovery_codes SET used_at=NOW() WHERE id=? AND used_at IS NULL', row.id); if (!upd.changes) return null; // зэрэг ашиглалтаас хамгаална
  await setPassword(db, hash, row.user_id, password, false);
  return { username: row.username, ...(await codeStatus(db, row.user_id)) };
}

module.exports = { tempPassword, setPassword, newCodes, codeStatus, redeem, codeHash, norm, CODES };
