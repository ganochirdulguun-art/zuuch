#!/usr/bin/env node
// Платформын эзний бүртгэл үүсгэх / нууц үг шинэчлэх (сервер дээр гараар ажиллуулна).
// Нууц үгийг командын мөрөнд биш, далд оролтоор асууна — shell-ийн түүх, логт үлдэхгүй.
//
//   node tools/owner-reset.js <нэвтрэх нэр> [--env /зам/.env]
//
// Бүртгэл байгаа бол нууц үгийг шинэчилж эзний эрх олгоно; байхгүй бол демо компанид (id=1) эзэн болгож үүсгэнэ.
// Хуучин сессүүдийг цуцална (бусад төхөөрөмж дээрх нэвтрэлт гарна).
'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const envIdx = args.indexOf('--env');
if (envIdx >= 0) { // .env файлаас DATABASE_URL г.м. уншина (systemd EnvironmentFile-тай ижил хэлбэр)
  const file = args[envIdx + 1]; args.splice(envIdx, 2);
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line); if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
const username = String(args[0] || '').trim().toLowerCase();
if (username.length < 3) { console.error('Хэрэглээ: node tools/owner-reset.js <нэвтрэх нэр> [--env /зам/.env]'); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL алга — Зуучийн .env файлыг --env-ээр өгнө үү'); process.exit(1); }

// Терминалгүй (pipe) үед мөр бүрийг дараалан уншина
let LINES = null; const waiters = [];
function lineQueue() {
  if (!LINES) {
    LINES = []; let rest = ''; process.stdin.setEncoding('utf8');
    const put = (l) => (waiters.length ? waiters.shift()(l) : LINES.push(l));
    process.stdin.on('data', (d) => { rest += d; const parts = rest.split(/\r?\n/); rest = parts.pop(); parts.forEach(put); });
    process.stdin.on('end', () => { if (rest) put(rest); while (waiters.length) waiters.shift()(''); });
  }
  return LINES.length ? Promise.resolve(LINES.shift()) : new Promise((r) => waiters.push(r));
}
// Далд оролт: бичсэн тэмдэгт дэлгэцэнд харагдахгүй
function ask(prompt) {
  return new Promise((resolve) => {
    const stdin = process.stdin; process.stdout.write(prompt); let buf = '';
    if (!stdin.isTTY) { lineQueue().then(resolve); return; }
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    const on = (ch) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', on); process.stdout.write('\n'); return resolve(buf); }
        if (c === '\u0003') { process.stdout.write('\n'); process.exit(130); }
        if (c === '\u007f' || c === '\b') buf = buf.slice(0, -1); else buf += c;
      }
    };
    stdin.on('data', on);
  });
}

(async () => {
  const p1 = await ask('Шинэ нууц үг (8+ тэмдэгт): ');
  if (p1.length < 8) { console.error('Нууц үг хэт богино (8+ тэмдэгт)'); process.exit(1); }
  const p2 = await ask('Дахин бичнэ үү: ');
  if (p1 !== p2) { console.error('Нууц үг таарахгүй байна'); process.exit(1); }
  const { db, hash, ready } = require(path.join(__dirname, '..', 'db'));
  await ready;
  const u = await db.one('SELECT id FROM users WHERE username=?', username);
  if (u) {
    await db.run('UPDATE users SET pass_hash=?, is_owner=1 WHERE id=?', hash(p1), u.id);
    await db.run('DELETE FROM sessions WHERE user_id=?', u.id).catch(() => {});
    console.log(`✓ «${username}» бүртгэлийн нууц үг шинэчлэгдэж, платформын эзний эрх олгогдлоо. Хуучин сессүүд цуцлагдсан.`);
  } else {
    await db.run("INSERT INTO users (company_id, username, pass_hash, name, role, is_owner) VALUES (1, ?, ?, ?, 'zahiral', 1)", username, hash(p1), 'Платформ эзэн');
    console.log(`✓ «${username}» нэртэй платформын эзний шинэ бүртгэл үүслээ.`);
  }
  process.exit(0);
})().catch((e) => { console.error('Алдаа:', e.message); process.exit(1); });
