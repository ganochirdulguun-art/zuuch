// «Зууч» — вэб аппын логик
let TOKEN = localStorage.getItem('zuuch_token') || '';
let ME = null;
let META = { districts: [], agents: [] };

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n ?? 0).toLocaleString('mn-MN', { maximumFractionDigits: 1 });

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN, ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 && path !== '/login') { logout(); throw new Error('unauthorized'); }
  return res.json();
}

// ---------- Нэвтрэлт ----------
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await api('/login', { method: 'POST', body: { username: $('#login-user').value.trim(), password: $('#login-pass').value } });
  if (r.error) { $('#login-err').textContent = r.error; return; }
  TOKEN = r.token; localStorage.setItem('zuuch_token', TOKEN);
  ME = r.user; enterApp();
});

// Нэвтрэх ↔ Бүртгүүлэх хооронд шилжих
$('#to-register').addEventListener('click', (e) => { e.preventDefault(); $('#login-form').hidden = true; $('#register-form').hidden = false; });
$('#to-login').addEventListener('click', (e) => { e.preventDefault(); $('#register-form').hidden = true; $('#login-form').hidden = false; });

// Компани бүртгүүлэх
$('#register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    company: $('#reg-company').value.trim(), name: $('#reg-name').value.trim(),
    username: $('#reg-user').value.trim(), password: $('#reg-pass').value, phone: $('#reg-phone').value.trim(),
  };
  const r = await api('/register', { method: 'POST', body });
  if (r.error) { $('#reg-err').textContent = r.error; return; }
  TOKEN = r.token; localStorage.setItem('zuuch_token', TOKEN);
  ME = r.user; enterApp();
});

async function logout() {
  try { await api('/logout', { method: 'POST' }); } catch {}
  TOKEN = ''; localStorage.removeItem('zuuch_token');
  if (POLL) { clearInterval(POLL); POLL = null; }
  $('#app-view').hidden = true; $('#login-view').hidden = false;
}

async function enterApp() {
  META = await api('/meta');
  $('#login-view').hidden = true; $('#app-view').hidden = false;
  $('#user-company').textContent = ME.company || '';
  $('#user-name').textContent = ME.name;
  $('#user-role').textContent = ME.role === 'zahiral' ? 'Захирал' : 'Агент';
  $('#menu-team').hidden = ME.role !== 'zahiral';
  $('#menu-owner').hidden = !ME.is_owner;
  show('dashboard');
}

document.getElementById('menu').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (!b) return;
  document.querySelectorAll('#menu button').forEach((x) => x.classList.remove('active'));
  b.classList.add('active');
  show(b.dataset.view);
});

const DIST_OPTS = () => META.districts.map((d) => `<option>${d}</option>`).join('');
const AGENT_OPTS = (sel) => META.agents.map((a) => `<option value="${a.id}" ${a.id == sel ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
const agentName = (id) => (META.agents.find((a) => a.id == id) || {}).name || '—';
const DEAL_T = { sale: 'Худалдах', rent: 'Түрээс' };
const CLIENT_T = { buyer: 'Худалдан авагч', seller: 'Зарагч', renter: 'Түрээслэгч', landlord: 'Түрээслүүлэгч' };
const STATUS_T = { active: ['Идэвхтэй', 'ok'], contracted: ['Гэрээтэй', 'warn'], closed: ['Хаагдсан', 'mut'], open: ['Нээлттэй', 'ok'], matched: ['Тохирсон', 'warn'] };
const badge = (s) => { const [t, c] = STATUS_T[s] || [s, 'mut']; return `<span class="badge ${c}">${t}</span>`; };

let POLL = null;
function show(view) {
  if (POLL) { clearInterval(POLL); POLL = null; }
  ({ dashboard, properties, clients, requests, deals, market, collector, team, owner }[view] || dashboard)();
}

// ---------- Хянах самбар ----------
async function dashboard() {
  const d = await api('/dashboard');
  $('#main').innerHTML = `
  <div class="page-head"><h2>Хянах самбар</h2><span class="demo-note">Зах зээлийн өгөгдөл = жишиг (цуглуулагч Шат 2-т холбогдоно)</span></div>
  <div class="tiles">
    <div class="tile"><div class="v">${d.activeProperties}</div><div class="k">Идэвхтэй объект</div></div>
    <div class="tile"><div class="v">${d.openRequests}</div><div class="k">Нээлттэй хүсэлт</div></div>
    <div class="tile"><div class="v">${d.monthDeals}</div><div class="k">Энэ сарын хэлцэл</div></div>
    <div class="tile"><div class="v">${fmt(d.monthCommission)}<small style="font-size:13px"> сая ₮</small></div><div class="k">Энэ сарын шимтгэл</div></div>
    <div class="tile"><div class="v">${d.marketListings}</div><div class="k">Ажиглаж буй зах зээлийн зар</div></div>
  </div>
  <div class="card"><h3>⏰ Сануулга (А6)</h3>
    ${d.expiring.map((x) => `<div>📄 Гэрээ <b>${esc(x.district)} ${esc(x.khoroolol || '')}</b> — <b>${x.contract_end}</b>-нд дуусна (сунгах/чөлөөлөх шийдвэр)</div>`).join('') || ''}
    ${d.staleReqs.map((x) => `<div>📵 <b>${esc(x.client_name)}</b>-тэй ${Math.floor((Date.now() - new Date(x.last_contact)) / 864e5)} хоног холбогдоогүй — follow-up хийх (хариуцагч: ${esc(agentName(x.agent_id))})</div>`).join('') || ''}
    ${!d.expiring.length && !d.staleReqs.length ? '<span style="color:var(--muted)">Одоогоор сануулга алга 🎉</span>' : ''}
  </div>
  <div class="card"><h3>💡 Өнөөдрийн боломжууд (А5) — зах зээлээс</h3>
    <div class="tablebox"><table>
      <thead><tr><th>Дүүрэг</th><th class="num">Өрөө</th><th class="num">м²</th><th class="num">Үнэ</th><th class="num">₮/м²</th><th>Пайз</th></tr></thead>
      <tbody>${d.opportunities.map((o) => `<tr><td>${esc(o.district)}</td><td class="num">${o.rooms}</td><td class="num">${o.area}</td>
        <td class="num">${fmt(o.price)} сая</td><td class="num">${fmt(o.m2)}</td>
        <td>${o.tags.map((t) => `<span class="badge ${t.t === 'under' ? 'ok' : 'warn'}">${t.label}</span>`).join(' ')}</td></tr>`).join('')}</tbody>
    </table></div>
  </div>`;
}

// ---------- Объект ----------
async function properties() {
  const rows = await api('/properties');
  $('#main').innerHTML = `
  <div class="page-head"><h2>Объект</h2><button class="primary" onclick="propForm()">+ Объект нэмэх</button></div>
  <div class="tablebox"><table>
    <thead><tr><th>#</th><th>Төрөл</th><th>Дүүрэг / хороолол</th><th class="num">Өрөө</th><th class="num">м²</th>
    <th class="num">Үнэ (сая ₮)</th><th>Байршил (А8)</th><th>Төлөв</th><th>Агент</th><th></th></tr></thead>
    <tbody>${rows.map((p) => `<tr>
      <td>${p.id}</td><td>${DEAL_T[p.deal_type]}${p.is_new ? ' · шинэ' : ''}</td>
      <td><b>${esc(p.district)}</b> ${esc(p.khoroolol || '')}</td>
      <td class="num">${p.rooms}</td><td class="num">${p.area}</td><td class="num">${fmt(p.price)}</td>
      <td><span class="score loc-score" data-d="${esc(p.district)}">…</span></td>
      <td>${badge(p.status)}</td><td>${esc(agentName(p.agent_id))}</td>
      <td><button class="small" onclick='propForm(${JSON.stringify(p)})'>Засах</button></td></tr>`).join('')}</tbody>
  </table></div>`;
  // Байршлын оноог асинхроноор
  const cache = {};
  for (const el of document.querySelectorAll('.loc-score')) {
    const d = el.dataset.d;
    cache[d] = cache[d] || api('/location-score?district=' + encodeURIComponent(d));
    cache[d].then((s) => { el.textContent = s.total ? s.total + '/100' : '—'; });
  }
}

window.propForm = function (p = {}) {
  modal(`
  <h3>${p.id ? 'Объект засах' : 'Шинэ объект'}</h3>
  <form id="f" class="form-grid">
    <div class="hint-card" id="val-hint">💡 Дүүрэг, өрөө, талбайг сонгоход <b>А3 үнэлгээ</b> болон <b>А8 байршлын оноо</b> энд гарна.</div>
    <div class="field"><label>Төрөл</label><select name="deal_type">
      <option value="sale" ${p.deal_type !== 'rent' ? 'selected' : ''}>Худалдах</option>
      <option value="rent" ${p.deal_type === 'rent' ? 'selected' : ''}>Түрээс (сарын үнэ)</option></select></div>
    <div class="field"><label>Дүүрэг</label><select name="district">${DIST_OPTS()}</select></div>
    <div class="field"><label>Хороолол / байршил</label><input name="khoroolol" value="${esc(p.khoroolol || '')}"></div>
    <div class="field"><label>Өрөө</label><input name="rooms" type="number" min="1" max="6" value="${p.rooms || 2}"></div>
    <div class="field"><label>Талбай (м²)</label><input name="area" type="number" step="0.1" value="${p.area || 50}"></div>
    <div class="field"><label>Давхар / нийт</label><div style="display:flex;gap:6px">
      <input name="floor" type="number" value="${p.floor || ''}" placeholder="давхар">
      <input name="total_floors" type="number" value="${p.total_floors || ''}" placeholder="нийт"></div></div>
    <div class="field"><label>Шинэ барилга уу?</label><select name="is_new">
      <option value="0" ${!p.is_new ? 'selected' : ''}>Хуучин</option><option value="1" ${p.is_new ? 'selected' : ''}>Шинэ</option></select></div>
    <div class="field"><label>Үнэ (сая ₮)</label><input name="price" type="number" step="0.1" value="${p.price || ''}" required></div>
    <div class="field"><label>Төлөв</label><select name="status">
      ${['active', 'contracted', 'closed'].map((s) => `<option value="${s}" ${p.status === s ? 'selected' : ''}>${STATUS_T[s][0]}</option>`).join('')}</select></div>
    <div class="field"><label>Хариуцах агент</label><select name="agent_id">${AGENT_OPTS(p.agent_id)}</select></div>
    <div class="field"><label>Эзэмшигчийн нэр</label><input name="owner_name" value="${esc(p.owner_name || '')}"></div>
    <div class="field"><label>Эзэмшигчийн утас</label><input name="owner_phone" value="${esc(p.owner_phone || '')}"></div>
    <div class="field wide"><label>Тэмдэглэл</label><input name="notes" value="${esc(p.notes || '')}"></div>
    <div class="modal-actions wide">
      ${p.id ? `<button type="button" onclick="delRow('properties',${p.id})">Устгах</button>` : ''}
      <button type="button" onclick="closeModal()">Болих</button>
      <button class="primary">Хадгалах</button></div>
  </form>`);
  const f = $('#f');
  if (p.district) f.district.value = p.district;
  async function updateHints() {
    const q = new URLSearchParams({
      district: f.district.value, rooms: f.rooms.value, area: f.area.value,
      is_new: f.is_new.value, floor: f.floor.value, total_floors: f.total_floors.value,
    });
    if (f.deal_type.value !== 'sale') { $('#val-hint').innerHTML = '💡 Үнэлгээ одоогоор худалдах объектод л ажиллана (түрээсийн индекс Шат 2-т).'; return; }
    const [v, loc] = await Promise.all([api('/valuation?' + q), api('/location-score?district=' + encodeURIComponent(f.district.value))]);
    $('#val-hint').innerHTML = v.estimate ? `
      💡 <b>А3 үнэлгээ:</b> ~<b>${fmt(v.estimate)} сая ₮</b> (интервал ${fmt(v.low)}–${fmt(v.high)}, ${fmt(v.m2)} сая ₮/м²)
      · итгэлцэл <b>${v.confidence}%</b> · эх: ${v.source}${v.notes.length ? ' · ' + v.notes.join(', ') : ''}<br>
      📍 <b>А8 байршил:</b> <b>${loc.total || '—'}/100</b> ${loc.growth === 'high' ? '· 📈 эрчимтэй өсөх бүс' : loc.growth === 'growing' ? '· ↗ өсөх төлөвтэй' : ''}
      ${loc.growth_note ? `<span style="color:var(--muted)"> — ${esc(loc.growth_note)}</span>` : ''}
      <div class="subscores">
        <span>🎓 Боловсрол ${loc.education}</span><span>🚌 Тээвэр ${loc.transport}</span><span>🛒 Худалдаа ${loc.commerce}</span>
        <span>🌫 Орчин ${loc.environment}</span><span>🏥 Эрүүл мэнд ${loc.health}</span><span>🅿️ Зогсоол ${loc.parking}</span></div>`
      : '💡 Үнэлгээ гаргах өгөгдөл хүрэлцэхгүй байна.';
  }
  ['district', 'rooms', 'area', 'is_new', 'floor', 'total_floors', 'deal_type'].forEach((n) => f[n].addEventListener('change', updateHints));
  updateHints();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(f));
    if (p.id) await api('/properties/' + p.id, { method: 'PUT', body });
    else await api('/properties', { method: 'POST', body });
    closeModal(); properties();
  });
};

// ---------- Харилцагч ----------
async function clients() {
  const rows = await api('/clients');
  $('#main').innerHTML = `
  <div class="page-head"><h2>Харилцагч</h2><button class="primary" onclick="clientForm()">+ Харилцагч нэмэх</button></div>
  <div class="tablebox"><table>
    <thead><tr><th>#</th><th>Нэр</th><th>Утас</th><th>Төрөл</th><th>Тэмдэглэл</th><th></th></tr></thead>
    <tbody>${rows.map((c) => `<tr><td>${c.id}</td><td><b>${esc(c.name)}</b></td><td>${esc(c.phone)}</td>
      <td>${CLIENT_T[c.type] || c.type}</td><td>${esc(c.notes)}</td>
      <td><button class="small" onclick='clientForm(${JSON.stringify(c)})'>Засах</button></td></tr>`).join('')}</tbody>
  </table></div>`;
}
window.clientForm = function (c = {}) {
  modal(`
  <h3>${c.id ? 'Харилцагч засах' : 'Шинэ харилцагч'}</h3>
  <form id="f" class="form-grid">
    <div class="field"><label>Нэр</label><input name="name" value="${esc(c.name || '')}" required></div>
    <div class="field"><label>Утас</label><input name="phone" value="${esc(c.phone || '')}"></div>
    <div class="field"><label>Төрөл</label><select name="type">
      ${Object.entries(CLIENT_T).map(([k, v]) => `<option value="${k}" ${c.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div class="field"><label>Тэмдэглэл</label><input name="notes" value="${esc(c.notes || '')}"></div>
    <div class="modal-actions wide">
      ${c.id ? `<button type="button" onclick="delRow('clients',${c.id})">Устгах</button>` : ''}
      <button type="button" onclick="closeModal()">Болих</button><button class="primary">Хадгалах</button></div>
  </form>`);
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData($('#f')));
    if (c.id) await api('/clients/' + c.id, { method: 'PUT', body });
    else await api('/clients', { method: 'POST', body });
    closeModal(); clients();
  });
};

// ---------- Хүсэлт ----------
async function requests() {
  const rows = await api('/requests-full');
  $('#main').innerHTML = `
  <div class="page-head"><h2>Хүсэлт</h2><button class="primary" onclick="reqForm()">+ Хүсэлт нэмэх</button></div>
  <div class="tablebox"><table>
    <thead><tr><th>#</th><th>Харилцагч</th><th>Төрөл</th><th class="num">Төсөв (сая ₮)</th><th>Дүүрэг</th>
    <th class="num">Өрөө</th><th>Төлөв</th><th>Агент</th><th></th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${r.id}</td><td><b>${esc(r.client_name)}</b></td><td>${DEAL_T[r.deal_type]}</td>
      <td class="num">${fmt(r.budget)}</td><td>${esc(r.districts)}</td><td class="num">${r.rooms}</td>
      <td>${badge(r.status)}</td><td>${esc(r.agent_name || '—')}</td>
      <td style="white-space:nowrap"><button class="small primary" onclick="showMatches(${r.id})">Тохирол (А4)</button>
      <button class="small" onclick='reqForm(${JSON.stringify(r)})'>Засах</button></td></tr>`).join('')}</tbody>
  </table></div>
  <div id="match-area"></div>`;
}
window.showMatches = async function (id) {
  const m = await api('/matches/' + id);
  $('#match-area').innerHTML = `
  <div class="card" style="margin-top:16px"><h3>🎯 Хүсэлт №${id} — тохирсон объектууд (оноо ≥50 дотоод, ≥60 зах зээл)</h3>
    <b style="font-size:13px">Дотоод бүртгэлээс:</b>
    <div class="tablebox" style="margin:8px 0 14px"><table>
      <thead><tr><th class="num">Оноо</th><th>Дүүрэг / хороолол</th><th class="num">Өрөө</th><th class="num">м²</th><th class="num">Үнэ</th><th>Агент</th></tr></thead>
      <tbody>${m.internal.map((p) => `<tr><td class="num"><span class="score">${p.score}</span></td>
        <td>${esc(p.district)} ${esc(p.khoroolol || '')}</td><td class="num">${p.rooms}</td><td class="num">${p.area}</td>
        <td class="num">${fmt(p.price)} сая</td><td>${esc(agentName(p.agent_id))}</td></tr>`).join('') || '<tr><td colspan="6" style="color:var(--muted)">Тохирол олдсонгүй</td></tr>'}</tbody>
    </table></div>
    <b style="font-size:13px">Зах зээлийн ажиглалтаас (жишиг өгөгдөл):</b>
    <div class="tablebox" style="margin-top:8px"><table>
      <thead><tr><th class="num">Оноо</th><th>Дүүрэг</th><th class="num">Өрөө</th><th class="num">м²</th><th class="num">Үнэ</th><th>Нийтэлсэн</th></tr></thead>
      <tbody>${m.market.map((p) => `<tr><td class="num"><span class="score">${p.score}</span></td>
        <td>${esc(p.district)}</td><td class="num">${p.rooms}</td><td class="num">${p.area}</td>
        <td class="num">${fmt(p.price)} сая</td><td>${p.listed_at}</td></tr>`).join('') || '<tr><td colspan="6" style="color:var(--muted)">Тохирол олдсонгүй</td></tr>'}</tbody>
    </table></div>
  </div>`;
  $('#match-area').scrollIntoView({ behavior: 'smooth' });
};
window.reqForm = function (r = {}) {
  modal(`
  <h3>${r.id ? 'Хүсэлт засах' : 'Шинэ хүсэлт'}</h3>
  <form id="f" class="form-grid">
    <div class="field"><label>Харилцагчийн ID</label><input name="client_id" type="number" value="${r.client_id || ''}" required></div>
    <div class="field"><label>Төрөл</label><select name="deal_type">
      <option value="sale" ${r.deal_type !== 'rent' ? 'selected' : ''}>Худалдан авах</option>
      <option value="rent" ${r.deal_type === 'rent' ? 'selected' : ''}>Түрээслэх</option></select></div>
    <div class="field"><label>Төсөв (сая ₮)</label><input name="budget" type="number" step="0.1" value="${r.budget || ''}" required></div>
    <div class="field"><label>Өрөө</label><input name="rooms" type="number" min="1" max="6" value="${r.rooms || 2}"></div>
    <div class="field wide"><label>Дүүргүүд (таслалаар)</label><input name="districts" value="${esc(r.districts || '')}" placeholder="Хан-Уул,Баянгол"></div>
    <div class="field"><label>Талбай min</label><input name="area_min" type="number" value="${r.area_min || ''}"></div>
    <div class="field"><label>Талбай max</label><input name="area_max" type="number" value="${r.area_max || ''}"></div>
    <div class="field"><label>Төлөв</label><select name="status">
      ${['open', 'matched', 'closed'].map((s) => `<option value="${s}" ${r.status === s ? 'selected' : ''}>${STATUS_T[s][0]}</option>`).join('')}</select></div>
    <div class="field"><label>Хариуцах агент</label><select name="agent_id">${AGENT_OPTS(r.agent_id)}</select></div>
    <div class="modal-actions wide">
      ${r.id ? `<button type="button" onclick="delRow('requests',${r.id})">Устгах</button>` : ''}
      <button type="button" onclick="closeModal()">Болих</button><button class="primary">Хадгалах</button></div>
  </form>`);
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData($('#f')));
    body.last_contact = new Date().toISOString();
    if (r.id) await api('/requests/' + r.id, { method: 'PUT', body });
    else await api('/requests', { method: 'POST', body });
    closeModal(); requests();
  });
};

// ---------- Хэлцэл ----------
async function deals() {
  const rows = await api('/deals-full');
  $('#main').innerHTML = `
  <div class="page-head"><h2>Хэлцэл</h2><button class="primary" onclick="dealForm()">+ Хэлцэл бүртгэх</button></div>
  <div class="tablebox"><table>
    <thead><tr><th>#</th><th>Огноо</th><th>Төрөл</th><th>Объект</th><th>Харилцагч</th>
    <th class="num">Дүн (сая ₮)</th><th class="num">Шимтгэл</th><th>Гэрээ дуусах</th><th></th></tr></thead>
    <tbody>${rows.map((d) => `<tr><td>${d.id}</td><td>${d.deal_date}</td><td>${DEAL_T[d.deal_type]}</td>
      <td>${esc(d.district || '—')} ${esc(d.khoroolol || '')} ${d.rooms ? d.rooms + 'ө' : ''}</td>
      <td>${esc(d.client_name || '—')}</td><td class="num">${fmt(d.amount)}</td><td class="num">${fmt(d.commission)}</td>
      <td>${d.contract_end || '—'}</td>
      <td><button class="small" onclick='dealForm(${JSON.stringify(d)})'>Засах</button></td></tr>`).join('')}</tbody>
  </table></div>
  <p style="color:var(--muted);font-size:12.5px">Хэлцэл бүр СЗХ-ны улирлын тайлангийн нэгтгэлд (А7, Шат 3) автоматаар орно.</p>`;
}
window.dealForm = function (d = {}) {
  modal(`
  <h3>${d.id ? 'Хэлцэл засах' : 'Шинэ хэлцэл'}</h3>
  <form id="f" class="form-grid">
    <div class="field"><label>Объектын ID</label><input name="property_id" type="number" value="${d.property_id || ''}"></div>
    <div class="field"><label>Харилцагчийн ID</label><input name="client_id" type="number" value="${d.client_id || ''}"></div>
    <div class="field"><label>Төрөл</label><select name="deal_type">
      <option value="sale" ${d.deal_type !== 'rent' ? 'selected' : ''}>Худалдах</option>
      <option value="rent" ${d.deal_type === 'rent' ? 'selected' : ''}>Түрээс</option></select></div>
    <div class="field"><label>Огноо</label><input name="deal_date" type="date" value="${d.deal_date || new Date().toISOString().slice(0, 10)}"></div>
    <div class="field"><label>Дүн (сая ₮)</label><input name="amount" type="number" step="0.1" value="${d.amount || ''}" required></div>
    <div class="field"><label>Шимтгэл (сая ₮)</label><input name="commission" type="number" step="0.1" value="${d.commission || ''}"></div>
    <div class="field"><label>Төлбөрийн хэлбэр</label><select name="payment_form">
      <option value="transfer" ${d.payment_form === 'transfer' ? 'selected' : ''}>Шилжүүлэг</option>
      <option value="mortgage" ${d.payment_form === 'mortgage' ? 'selected' : ''}>Ипотек</option>
      <option value="cash" ${d.payment_form === 'cash' ? 'selected' : ''}>Бэлэн мөнгө</option></select></div>
    <div class="field"><label>Гэрээ дуусах (түрээс)</label><input name="contract_end" type="date" value="${d.contract_end || ''}"></div>
    <div class="modal-actions wide">
      ${d.id ? `<button type="button" onclick="delRow('deals',${d.id})">Устгах</button>` : ''}
      <button type="button" onclick="closeModal()">Болих</button><button class="primary">Хадгалах</button></div>
  </form>`);
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData($('#f')));
    if (d.id) await api('/deals/' + d.id, { method: 'PUT', body });
    else await api('/deals', { method: 'POST', body });
    closeModal(); deals();
  });
};

// ---------- Зах зээл ----------
async function market() {
  const [idx, opp] = await Promise.all([api('/market/index'), api('/market/opportunities')]);
  const newIdx = idx.filter((i) => i.is_new), oldIdx = idx.filter((i) => !i.is_new);
  const maxM2 = Math.max(...idx.map((i) => i.median_m2));
  const row = (i) => `<tr><td>${esc(i.district)}</td>
    <td style="min-width:160px"><div style="background:var(--surface-2);border-radius:3px;height:16px"><div style="height:100%;border-radius:3px;background:var(--accent);width:${(i.median_m2 / maxM2) * 100}%"></div></div></td>
    <td class="num"><b>${fmt(i.median_m2)}</b></td><td class="num">${fmt(i.p25_m2)}–${fmt(i.p75_m2)}</td><td class="num">${i.sample}</td></tr>`;
  $('#main').innerHTML = `
  <div class="page-head"><h2>Зах зээл</h2><span class="demo-note">А2 индекс — жишиг өгөгдөл (2026-02); Шат 2-т цуглуулагчаас сар бүр шинэчлэгдэнэ</span></div>
  <div class="card"><h3>🏗 Шинэ орон сууц — дүүргийн индекс (сая ₮/м², медиан)</h3>
    <div class="tablebox"><table><thead><tr><th>Дүүрэг</th><th></th><th class="num">Медиан</th><th class="num">P25–P75</th><th class="num">Түүвэр</th></tr></thead>
    <tbody>${newIdx.map(row).join('')}</tbody></table></div></div>
  <div class="card"><h3>🏘 Хуучин орон сууц — дүүргийн индекс (сая ₮/м², медиан)</h3>
    <div class="tablebox"><table><thead><tr><th>Дүүрэг</th><th></th><th class="num">Медиан</th><th class="num">P25–P75</th><th class="num">Түүвэр</th></tr></thead>
    <tbody>${oldIdx.map(row).join('')}</tbody></table></div></div>
  <div class="card"><h3>💡 Боломжийн самбар (А5) — бүх пайзтай зар</h3>
    <div class="tablebox"><table>
      <thead><tr><th>Дүүрэг</th><th class="num">Өрөө</th><th class="num">м²</th><th class="num">Үнэ (сая)</th><th class="num">₮/м²</th><th class="num">Индекс ₮/м²</th><th>Пайз</th></tr></thead>
      <tbody>${opp.map((o) => `<tr><td>${esc(o.district)}</td><td class="num">${o.rooms}</td><td class="num">${o.area}</td>
        <td class="num">${fmt(o.price)}</td><td class="num">${fmt(o.m2)}</td><td class="num">${fmt(o.baseline)}</td>
        <td>${o.tags.map((t) => `<span class="badge ${t.t === 'under' ? 'ok' : 'warn'}">${t.label}</span>`).join(' ')}</td></tr>`).join('')}</tbody>
    </table></div></div>`;
}

// ---------- Эзэн самбар (зөвхөн платформын эзэн) ----------
const PLAN_T = { demo: 'Демо', trial: 'Туршилт', basic: 'Суурь', pro: 'Про' };
async function owner() {
  const d = await api('/owner/overview');
  if (d.error) { $('#main').innerHTML = `<div class="page-head"><h2>👑 Эзэн самбар</h2></div><p style="color:var(--accent-2)">${esc(d.error)}</p>`; return; }
  $('#main').innerHTML = `
  <div class="page-head"><h2>👑 Эзэн самбар</h2><span class="demo-note">Платформын нийт тойм — бүх компани</span></div>
  <div class="tiles">
    <div class="tile"><div class="v">${d.totals.companies}</div><div class="k">Бүртгэлтэй компани</div></div>
    <div class="tile"><div class="v">${d.totals.users}</div><div class="k">Нийт хэрэглэгч</div></div>
    <div class="tile"><div class="v">${d.totals.properties}</div><div class="k">Нийт объект</div></div>
    <div class="tile"><div class="v">${d.totals.deals}</div><div class="k">Нийт хэлцэл</div></div>
    <div class="tile"><div class="v">${fmt(d.totals.commission)}<small style="font-size:12px"> сая ₮</small></div><div class="k">Нийт шимтгэл</div></div>
    <div class="tile"><div class="v">${d.totals.marketListings}</div><div class="k">Зах зээлийн зар (нийтлэг)</div></div>
  </div>
  <div class="card"><h3>Компаниуд</h3>
    <div class="tablebox"><table>
      <thead><tr><th>#</th><th>Компани</th><th>Багц</th><th>Төлөв</th><th class="num">Хэрэглэгч</th><th class="num">Объект</th><th class="num">Хэлцэл</th><th class="num">Шимтгэл</th><th>Бүртгэсэн</th><th>Удирдлага</th></tr></thead>
      <tbody>${d.companies.map((c) => `<tr>
        <td>${c.id}</td><td><b>${esc(c.name)}</b></td>
        <td><select onchange="setCompany(${c.id},{plan:this.value})" style="width:auto;padding:3px 6px;font-size:12.5px">
          ${['demo', 'trial', 'basic', 'pro'].map((p) => `<option value="${p}" ${c.plan === p ? 'selected' : ''}>${PLAN_T[p]}</option>`).join('')}</select></td>
        <td>${c.status === 'active' ? '<span class="badge ok">Идэвхтэй</span>' : '<span class="badge warn">Хаагдсан</span>'}</td>
        <td class="num">${c.users}</td><td class="num">${c.properties}</td>
        <td class="num">${c.deals}</td><td class="num">${fmt(c.commission)}</td>
        <td>${(c.created_at || '').slice(0, 10)}</td>
        <td style="white-space:nowrap">${c.status === 'active'
        ? `<button class="small" onclick="setCompany(${c.id},{status:'suspended'})">Түр хаах</button>`
        : `<button class="small primary" onclick="setCompany(${c.id},{status:'active'})">Идэвхжүүлэх</button>`}
        ${c.id !== ME.company_id ? `<button class="small" onclick="delCompany(${c.id},'${esc(c.name).replace(/'/g, '')}')">Устгах</button>` : ''}</td></tr>`).join('')}</tbody>
    </table></div></div>
  <p style="color:var(--muted);font-size:12.5px">Та платформын эзэн тул бүх компанийн тоймыг харж, багц/төлөвийг удирдана. «Түр хаах» үед тухайн компанийн хэрэглэгчид нэвтэрч чадахгүй. Компани бүрийн дотоод өгөгдөл тус тусдаа тусгаарлагдсан хэвээр.</p>`;
}

window.setCompany = async function (id, body) {
  const r = await api('/owner/company/' + id, { method: 'POST', body });
  if (r.error) { alert(r.error); return; }
  owner();
};
window.delCompany = async function (id, name) {
  if (!confirm(`«${name}» компанийг бүх өгөгдөлтэй нь бүрмөсөн устгах уу? Энэ үйлдлийг буцаах боломжгүй.`)) return;
  const r = await api('/owner/company/' + id, { method: 'DELETE' });
  if (r.error) { alert(r.error); return; }
  owner();
};

// ---------- Нууц үг солих ----------
window.pwForm = function () {
  modal(`
  <h3>Нууц үг солих</h3>
  <form id="f" class="form-grid">
    <div class="field wide"><label>Одоогийн нууц үг</label><input name="current" type="password" autocomplete="current-password" required></div>
    <div class="field wide"><label>Шинэ нууц үг (6+ тэмдэгт)</label><input name="next" type="password" autocomplete="new-password" required></div>
    <div class="err wide" id="pw-err"></div>
    <div class="modal-actions wide"><button type="button" onclick="closeModal()">Болих</button><button class="primary">Солих</button></div>
  </form>`);
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await api('/me/password', { method: 'POST', body: Object.fromEntries(new FormData($('#f'))) });
    if (r.error) { $('#pw-err').textContent = r.error; return; }
    closeModal(); alert('Нууц үг амжилттай солигдлоо');
  });
};

// ---------- Баг (зөвхөн захирал) ----------
const ROLE_T = { zahiral: 'Захирал', agent: 'Агент' };
async function team() {
  const rows = await api('/users');
  $('#main').innerHTML = `
  <div class="page-head"><h2>⚙️ Баг · ${esc(ME.company || '')}</h2><button class="primary" onclick="userForm()">+ Ажилтан нэмэх</button></div>
  <div class="tablebox"><table>
    <thead><tr><th>#</th><th>Нэр</th><th>Нэвтрэх нэр</th><th>Утас</th><th>Роль</th><th></th></tr></thead>
    <tbody>${rows.map((u) => `<tr><td>${u.id}</td><td><b>${esc(u.name)}</b></td><td>${esc(u.username)}</td>
      <td>${esc(u.phone || '')}</td><td>${ROLE_T[u.role] || u.role}</td>
      <td>${u.id != ME.id ? `<button class="small" onclick="delUser(${u.id})">Устгах</button>` : '<span style="color:var(--muted);font-size:12px">та</span>'}</td></tr>`).join('')}</tbody>
  </table></div>
  <p style="color:var(--muted);font-size:12.5px">Ажилтан бүр өөрийн нэвтрэх нэр, нууц үгээр орж, зөвхөн энэ компанийн өгөгдлийг харна. Захирал бүх зүйлийг, агент өөрт хамаарахыг удирдана.</p>`;
}
window.userForm = function () {
  modal(`
  <h3>Шинэ ажилтан</h3>
  <form id="f" class="form-grid">
    <div class="field"><label>Нэр</label><input name="name" required></div>
    <div class="field"><label>Роль</label><select name="role"><option value="agent">Агент</option><option value="zahiral">Захирал</option></select></div>
    <div class="field"><label>Нэвтрэх нэр (3+)</label><input name="username" autocomplete="off" required></div>
    <div class="field"><label>Нууц үг (6+)</label><input name="password" type="text" autocomplete="off" required></div>
    <div class="field wide"><label>Утас</label><input name="phone"></div>
    <div class="err wide" id="uf-err"></div>
    <div class="modal-actions wide"><button type="button" onclick="closeModal()">Болих</button><button class="primary">Нэмэх</button></div>
  </form>`);
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await api('/users', { method: 'POST', body: Object.fromEntries(new FormData($('#f'))) });
    if (r.error) { $('#uf-err').textContent = r.error; return; }
    closeModal(); team();
  });
};
window.delUser = async (id) => { if (!confirm('Ажилтныг устгах уу?')) return; await api('/users/' + id, { method: 'DELETE' }); team(); };

// ---------- Цуглуулагч (Шат 2 демо) ----------
const KIND_T = { listing_site: 'Зарын сайт', broker: 'Брокер вэб', rss: 'Мэдээ', fb: 'FB групп' };
const TIER_BADGE = (t) => ({ green: '🟢 ногоон', yellow: '🟡 шар', red: '🔴 улаан' }[t] || t || '—');
async function collector() {
  $('#main').innerHTML = `
  <div class="page-head"><h2>🤖 Цуглуулах хөдөлгүүр</h2>
    <span class="demo-note">Шат 2 демо — симуляц эх сурвалж (жинхэнэ сайт руу хандахгүй)</span></div>
  <div id="col-body">Ачааллаж байна…</div>`;
  async function render() {
    const s = await api('/collector/status');
    const wcard = s.workers.map((w) => {
      const busy = w.status !== 'сул';
      return `<div style="border:1px solid var(--line);border-radius:6px;padding:7px 9px;background:${busy ? 'color-mix(in srgb,var(--accent) 12%,var(--surface))' : 'var(--surface)'}">
        <div style="font-size:11px;color:var(--muted)">Бот ${w.id}</div>
        <div style="font-weight:600;font-size:12.5px">${busy ? '⚙️ ' + w.status : '💤 сул'}</div>
        <div style="font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(w.source || '—')}</div></div>`;
    }).join('');
    const rej = Object.entries(s.rejectReasons).sort((a, b) => b[1] - a[1]);
    const ev = s.events.map((e) => {
      const ago = Math.max(0, Math.round((Date.now() - e.t) / 1000));
      if (e.kind === 'collected') return `<div style="padding:5px 0;border-bottom:1px solid var(--line);font-size:13px">
        <span class="badge ok">✓ ${e.score}</span> <b>${esc(e.title)}</b> — ${fmt(e.price)} сая ₮
        <span style="color:var(--muted)">· ${esc(e.source)} · ${ago}с</span>
        ${(e.flags || []).map((f) => `<span class="badge warn">${esc(f)}</span>`).join('')}</div>`;
      if (e.kind === 'retired') return `<div style="padding:5px 0;border-bottom:1px solid var(--line);font-size:13px;color:var(--muted)">
        🗄 <b>${e.count}</b> зар хугацаагаар устгагдав <span>— ${esc(e.reason)} · ${ago}с</span></div>`;
      if (e.kind === 'takedown') return `<div style="padding:5px 0;border-bottom:1px solid var(--line);font-size:13px">
        <span class="badge warn">🗑 хасалт</span> ${esc(e.title || '')} <span style="color:var(--muted)">— ${esc(e.reason)} · ${ago}с</span></div>`;
      return `<div style="padding:5px 0;border-bottom:1px solid var(--line);font-size:13px;opacity:.75">
        <span class="badge mut">✕ ${e.score}</span> ${esc(e.title)}
        <span style="color:var(--accent-2)">— ${esc(e.reason)}</span>
        <span style="color:var(--muted)">· ${esc(e.source)} · ${ago}с</span></div>`;
    }).join('') || '<span style="color:var(--muted)">Хоосон — «Эхлүүлэх» дарна уу</span>';

    $('#col-body').innerHTML = `
    <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
      ${s.running
        ? `<button onclick="colAct('stop')">⏸ Зогсоох</button>`
        : `<button class="primary" onclick="colAct('start')">▶ Эхлүүлэх</button>`}
      <button onclick="colAct('reset')">↺ Reset</button>
      <button onclick="colAct('takedown')" title="Сүүлийн цуглуулсан бүлгийг устгаж, дахин цуглуулахыг блоклоно">🗑 Жишиг хасалт</button>
      <span class="badge ${s.running ? 'ok' : 'mut'}">${s.running ? '● Ажиллаж байна' : '○ Зогссон'}</span>
      <span style="color:var(--muted);font-size:12.5px">Босго: <b>${s.threshold}</b> · дараалалд: <b>${s.queued}</b> · хасалт: <b>${s.takedownCount || 0}</b></span>
      ${s.note ? `<span class="badge warn">${esc(s.note)}</span>` : ''}
    </div>
    <div style="background:var(--surface-2);border-radius:6px;padding:8px 12px;margin-bottom:16px;font-size:12.5px;color:var(--muted)">
      🛡️ <b>Ажиглах горим</b> — зөвхөн баримт хадгална (зураг/тайлбар/жинхэнэ утас БИШ) · утас = давсласан хэш ·
      хадгалалт ${s.retentionDays} хоног · улаан tier автоматаар хөндөгдөхгүй · UA: <code style="font-size:11px">${esc(s.ua || '')}</code>
    </div>
    <div class="tiles">
      <div class="tile"><div class="v">${s.stats.fetched}</div><div class="k">Татсан хуудас</div></div>
      <div class="tile"><div class="v">${s.stats.skipped304 || 0}</div><div class="k">304 өөрчлөлтгүй (татаагүй)</div></div>
      <div class="tile"><div class="v">${s.stats.parsed}</div><div class="k">Задалсан зар</div></div>
      <div class="tile"><div class="v" style="color:var(--accent)">${s.stats.collected}</div><div class="k">Цуглуулсан (шүүлт давсан)</div></div>
      <div class="tile"><div class="v" style="color:var(--accent-2)">${s.stats.rejected}</div><div class="k">Татгалзсан</div></div>
      <div class="tile"><div class="v">${s.stats.retired || 0}</div><div class="k">Хугацаагаар устгасан</div></div>
      <div class="tile"><div class="v">${s.stats.ratePerMin}<small style="font-size:12px">/мин</small></div><div class="k">Цуглуулах хурд</div></div>
    </div>
    <div class="card"><h3>Ботын пул (${s.workers.length} worker — нэг queue-аас ажил татна)</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px">${wcard}</div></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px" class="col-grid">
      <div class="card"><h3>Эх сурвалжууд</h3>
        <div class="tablebox"><table><thead><tr><th>Эх</th><th>Түвшин</th><th>Төрөл</th><th class="num">Итгэл</th><th class="num">Цугл.</th><th class="num">Татг.</th></tr></thead>
        <tbody>${s.sources.map((src) => `<tr><td><b>${esc(src.label)}</b>${!src.auto ? ' <span class="badge warn">гар</span>' : ''}${src.note ? `<br><span style="font-size:11px;color:var(--muted)">${esc(src.note)}</span>` : ''}</td>
          <td>${TIER_BADGE(src.tier)}</td>
          <td>${KIND_T[src.kind] || src.kind}</td><td class="num">${src.trust.toFixed(2)}</td>
          <td class="num" style="color:var(--accent)">${src.collected}</td><td class="num" style="color:var(--accent-2)">${src.rejected}</td></tr>`).join('')}</tbody></table></div>
        <div style="font-size:11.5px;color:var(--muted);margin-top:8px">🟢 ногоон = API/түншлэл · 🟡 шар = ил HTML, эелдэг · 🔴 улаан = автоматаар хөндөхгүй (FB, robots хориотой)</div></div>
      <div class="card"><h3>Татгалзсан шалтгаан</h3>
        ${rej.length ? rej.map(([r, c]) => `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--line);font-size:13.5px"><span>${esc(r)}</span><b>${c}</b></div>`).join('') : '<span style="color:var(--muted)">—</span>'}
      </div>
    </div>
    <div class="card"><h3>Амьд урсгал (сүүлийн үйл явдлууд)</h3>
      <div style="max-height:340px;overflow:auto">${ev}</div></div>`;
  }
  await render();
  POLL = setInterval(() => render().catch(() => {}), 1200);
}
window.colAct = async function (act) {
  await api('/collector/' + act, { method: 'POST' });
};

// ---------- Модал ----------
function modal(html) {
  $('#modal-root').innerHTML = `<div class="modal-back" onclick="if(event.target===this)closeModal()"><div class="modal">${html}</div></div>`;
}
window.closeModal = () => { $('#modal-root').innerHTML = ''; };
window.delRow = async (name, id) => {
  if (!confirm('Устгах уу?')) return;
  await api(`/${name}/${id}`, { method: 'DELETE' });
  closeModal(); show(document.querySelector('#menu button.active').dataset.view);
};

// ---------- Эхлэл ----------
(async () => {
  if (TOKEN) {
    try { ME = await api('/me'); if (ME && !ME.error) return enterApp(); } catch {}
  }
  $('#login-view').hidden = false;
})();
