/* Зууч — аяллын брэнд давхарга: хөдөлгөөнт усан тэмдэг + системийн танилцуулгын QR.
   Аяллыг дэлгэцийн зураг/бичлэгээр хуулбал «Смарт Зууч» брэнд, агентлагийн нэр, огноо, QR дагаж явна —
   өөр газар тавьсан бичлэг манай системийн сурталчилгаа болно. Вэбээр бүрэн хаах боломжгүй тул гол зорилго нь эх сурвалжийг ил гаргах. */
(function () {
  var BRAND = 'Смарт Зууч', TECH = 'Virtual POV Tour';
  var INTRO = location.origin + '/?ref=tour';
  var company = '';
  var d = new Date(); var DATE = d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0');

  // Хуудсыг бүхэлд нь хамарсан бүдэг давтагдах бичвэр (хайчилж авсан хэсэгт ч үлдэнэ)
  function tileUrl() {
    var t = BRAND + ' · ' + TECH + ' технологи';
    t = t.replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="460" height="240"><g transform="rotate(-22 230 120)" font-family="Inter,Segoe UI,sans-serif" font-size="17" font-weight="700" text-anchor="middle">' +
      '<text x="231" y="131" fill="#000" fill-opacity=".08">' + t + '</text><text x="230" y="130" fill="#fff" fill-opacity=".13">' + t + '</text></g></svg>';
    return 'url("data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) + '")';
  }
  var CSS = '#zwTile{position:fixed;inset:0;pointer-events:none;z-index:40;background-repeat:repeat}' +
    '#zwMove{position:fixed;left:0;top:0;pointer-events:none;z-index:41;display:flex;align-items:center;gap:8px;padding:7px 12px 7px 9px;border-radius:12px;background:rgba(11,18,32,.42);border:1px solid rgba(255,255,255,.22);color:#fff;font:600 14px Inter,system-ui,sans-serif;opacity:.82;white-space:nowrap;will-change:transform;text-shadow:0 1px 2px rgba(0,0,0,.4)}' +
    '#zwMove img{width:28px;height:28px}#zwMove small{display:block;font-weight:500;font-size:11px;opacity:.85}' +
    '#zwQr{position:fixed;left:14px;top:58px;z-index:41;display:flex;align-items:center;gap:9px;padding:7px;border-radius:12px;background:rgba(11,18,32,.72);border:1px solid rgba(255,255,255,.2);color:#fff;text-decoration:none;font:600 12.5px Inter,system-ui,sans-serif;backdrop-filter:blur(6px)}' +
    '#zwQr canvas{display:block;width:76px;height:76px;border-radius:6px;background:#fff}#zwQr b{display:block;font-size:13.5px}#zwQr span{display:block;font-weight:500;opacity:.8;font-size:11.5px;margin-top:2px}' +
    '@media (max-width:700px){#zwQr{top:auto;bottom:200px;left:10px;padding:5px}#zwQr canvas{width:54px;height:54px}#zwQr .t{display:none}#zwMove{font-size:12px}}';

  var style, tile, mover, qr;
  function el(tag, id) { var e = document.createElement(tag); e.id = id; return e; }
  function build() {
    style = el('style', 'zwCss'); style.textContent = CSS;
    tile = el('div', 'zwTile'); tile.style.backgroundImage = tileUrl();
    mover = el('div', 'zwMove'); renderMover();
    qr = el('a', 'zwQr'); qr.href = INTRO; qr.target = '_blank'; qr.rel = 'noopener'; qr.title = BRAND + ' — ' + TECH + ' технологи. Системтэй танилцах';
    var c = document.createElement('canvas'); drawQr(c); qr.appendChild(c);
    var t = document.createElement('div'); t.className = 't'; t.innerHTML = '<b>' + BRAND + '</b><span>' + TECH + ' технологи<br>Зөвхөн ' + BRAND + ' системд</span>'; qr.appendChild(t);
  }
  function renderMover() {
    mover.innerHTML = '<img src="/brand/zuuch-mark.svg?v=2" alt=""><div>' + BRAND + ' · ' + TECH + '<small>' + (company ? escapeHtml(company) + ' · ' : '') + DATE + '</small></div>';
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function drawQr(c) {
    if (typeof qrcode !== 'function') return;
    var q = qrcode(0, 'M'); q.addData(INTRO); q.make();
    var n = q.getModuleCount(), m = 2, s = 4, W = (n + m * 2) * s; c.width = c.height = W;
    var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, W); g.fillStyle = '#0B1220';
    for (var r = 0; r < n; r++) for (var k = 0; k < n; k++) if (q.isDark(r, k)) g.fillRect((k + m) * s, (r + m) * s, s, s);
  }
  function attach() { [style, tile, mover, qr].forEach(function (e) { if (!e.isConnected) (e === style ? document.head : document.body).appendChild(e); }); }

  // Удаан, урьдчилан тааж болохгүй замаар дэлгэц дээгүүр хөвнө
  var t0 = performance.now();
  function frame(now) {
    var t = (now - t0) / 1000, W = innerWidth, H = innerHeight, w = mover.offsetWidth || 160, h = mover.offsetHeight || 40;
    var x = (Math.sin(t * 0.083) * 0.5 + 0.5) * 0.7 + (Math.sin(t * 0.211 + 1.3) * 0.5 + 0.5) * 0.3;
    var y = (Math.sin(t * 0.061 + 0.7) * 0.5 + 0.5) * 0.7 + (Math.sin(t * 0.173 + 2.1) * 0.5 + 0.5) * 0.3;
    mover.style.transform = 'translate(' + Math.round(12 + x * Math.max(0, W - w - 24)) + 'px,' + Math.round(70 + y * Math.max(0, H - h - 150)) + 'px)';
    requestAnimationFrame(frame);
  }

  function start() {
    build(); attach(); requestAnimationFrame(frame);
    // Устгах, нуух оролдлогыг сэргээнэ
    new MutationObserver(attach).observe(document.body, { childList: true });
    setInterval(function () { attach(); [tile, mover, qr].forEach(function (e) { e.hidden = false; e.style.removeProperty('display'); e.style.removeProperty('visibility'); e.style.removeProperty('opacity'); }); }, 1500);
    // Видео, 3D дэлгэцийг баруун товчоор хадгалахыг хаах
    document.addEventListener('contextmenu', function (e) { if (e.target && /^(VIDEO|CANVAS|IMG)$/.test(e.target.tagName)) e.preventDefault(); });
  }
  window.addEventListener('tour:data', function (e) {
    company = (e.detail && e.detail.company) || '';
    if (tile) { tile.style.backgroundImage = tileUrl(); renderMover(); }
  });
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
