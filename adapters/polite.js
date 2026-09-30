// «Зууч» — адаптеруудын нийтлэг эелдэг татагч (omch, my-zar, …)
// Зарчим (unegui.js-тэй адил): robots.txt-ийн зөвшөөрсөн зам л, шударга UA, нэг эгнээ + хүсэлт хоорондын доод зай,
// 429/5xx-д 10 мин хөргөлт, gzip, зөвхөн тухайн сайтын дотор 1 redirect.
const https = require('node:https');
const zlib = require('node:zlib');

const CONTACT = process.env.ZUUCH_BOT_CONTACT || 'smartzuuch.mn@gmail.com';
// HTTP толгой = зөвхөн ASCII (кирилл бичвэл ByteString алдаа өгнө)
const UA = process.env.ZUUCH_BOT_UA || `ZuuchBot/1.0 (+https://zuuch-production.up.railway.app/bot; ${CONTACT}; read-only monitoring)`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeFetcher({ base, allowed, gapMs = 5000, timeoutMs = 25000, accept = 'text/html' }) {
  const origin = new URL(base).origin;
  const net = { lastAt: 0, cooldownUntil: 0, chain: Promise.resolve(), requests: 0, bytes: 0, lastStatus: null };
  function get(url, hops = 0) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, { headers: { 'User-Agent': UA, 'Accept': accept, 'Accept-Language': 'mn,en;q=0.5', 'Accept-Encoding': 'gzip, deflate' }, timeout: timeoutMs }, (res) => {
        const status = res.statusCode || 0;
        if ([301, 302, 307, 308].includes(status) && res.headers.location && hops < 1) {
          res.resume();
          const next = new URL(res.headers.location, origin);
          if (next.origin !== origin || !allowed(next.pathname + next.search)) return resolve({ status, html: '' });
          return resolve(get(next.href, hops + 1));
        }
        const enc = String(res.headers['content-encoding'] || '');
        const stream = enc.includes('gzip') ? res.pipe(zlib.createGunzip()) : enc.includes('deflate') ? res.pipe(zlib.createInflate()) : res;
        const chunks = [];
        stream.on('data', (c) => chunks.push(c));
        stream.on('end', () => resolve({ status, html: status === 200 ? Buffer.concat(chunks).toString('utf8') : '' }));
        stream.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new Error('timeout ' + timeoutMs + 'ms')));
      req.on('error', reject);
    });
  }
  function fetchPath(path) {
    if (!allowed(path)) return Promise.reject(new Error('robots.txt хориотой зам: ' + path));
    const run = async () => {
      if (Date.now() < net.cooldownUntil) throw new Error('хөргөлтийн хугацаа (429/5xx дараах)');
      const wait = net.lastAt + gapMs - Date.now();
      if (wait > 0) await sleep(wait);
      net.lastAt = Date.now();
      const res = await get(origin + path);
      net.requests++; net.lastStatus = res.status;
      if (res.status === 429 || res.status >= 500) { net.cooldownUntil = Date.now() + 10 * 60000; throw new Error('HTTP ' + res.status + ' — 10 мин хөргөлт'); }
      net.bytes += res.html.length;
      return res;
    };
    const p = net.chain.then(run, run);
    net.chain = p.catch(() => {});
    return p;
  }
  const stats = () => ({ requests: net.requests, bytes: net.bytes, lastStatus: net.lastStatus, cooldownUntil: net.cooldownUntil || null, gapMs });
  return { fetch: fetchPath, stats };
}

// Шошго/HTML entity-г цэвэрлэнэ
const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
const stripTags = (s) => decode(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

module.exports = { makeFetcher, UA, CONTACT, decode, stripTags };
