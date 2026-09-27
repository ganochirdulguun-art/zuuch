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
  ({ dashboard, properties, clients, requests: buyers, deals, market, collector, tours, mylist, studio, buyers, findbuyers, leads, team, owner }[view] || dashboard)();
}

// ---------- Хянах самбар ----------
async function dashboard() {
  const d = await api('/dashboard');
  $('#main').innerHTML = `
  <div class="page-head"><h2>Хянах самбар</h2><span class="demo-note">Зах зээлийн өгөгдөл = жишиг (цуглуулагч Шат 2-т холбогдоно)</span></div>
  <div class="tiles">
    <div class="tile" style="cursor:pointer" onclick="show('properties')" title="Объектууд руу"><div class="v">${d.activeProperties}</div><div class="k">Идэвхтэй объект →</div></div>
    <div class="tile" style="cursor:pointer" onclick="show('buyers')" title="Buyer бүртгэл рүү"><div class="v">${d.openRequests}</div><div class="k">Нээлттэй хүсэлт (Buyer) →</div></div>
    <div class="tile" style="cursor:pointer" onclick="show('deals')" title="Хэлцлүүд рүү"><div class="v">${d.monthDeals}</div><div class="k">Энэ сарын хэлцэл →</div></div>
    <div class="tile" style="cursor:pointer" onclick="show('deals')" title="Хэлцлүүд рүү"><div class="v">${fmt(d.monthCommission)}<small style="font-size:13px"> сая ₮</small></div><div class="k">Энэ сарын шимтгэл →</div></div>
    <div class="tile" style="cursor:pointer" onclick="show('collector')" title="Цуглуулагч руу"><div class="v">${d.marketListings}</div><div class="k">Ажиглаж буй зах зээлийн зар →</div></div>
  </div>
  <div class="card"><h3>⏰ Сануулга (А6)</h3>
    ${d.expiring.map((x) => `<div>📄 Гэрээ <b>${esc(x.district)} ${esc(x.khoroolol || '')}</b> — <b>${x.contract_end}</b>-нд дуусна (сунгах/чөлөөлөх шийдвэр)</div>`).join('') || ''}
    ${d.staleReqs.map((x) => `<div>📵 <b>${esc(x.client_name)}</b>-тэй ${Math.floor((Date.now() - new Date(x.last_contact)) / 864e5)} хоног холбогдоогүй — follow-up хийх (хариуцагч: ${esc(agentName(x.agent_id))})</div>`).join('') || ''}
    ${!d.expiring.length && !d.staleReqs.length ? '<span style="color:var(--muted)">Одоогоор сануулга алга 🎉</span>' : ''}
  </div>
  <div class="card"><h3>💡 Өнөөдрийн боломжууд (А5) — зах зээлээс</h3>
    <div class="tablebox"><table>
      <thead><tr><th>Дүүрэг</th><th class="num">Өрөө</th><th class="num">м²</th><th class="num">Үнэ</th><th class="num">₮/м²</th><th>Пайз</th></tr></thead>
      <tbody>${d.opportunities.map((o) => `<tr style="cursor:pointer" onclick="marketDetail(${o.id})" title="Бүрэн мэдээлэл, судалгаа"><td>${esc(o.district)}${o.khoroolol ? ' · ' + esc(o.khoroolol) : ''}</td><td class="num">${o.rooms}</td><td class="num">${o.area}</td>
        <td class="num">${fmt(o.price)} сая</td><td class="num">${fmt(o.m2)}</td>
        <td>${o.tags.map((t) => `<span class="badge ${t.t === 'under' ? 'ok' : 'warn'}">${t.label}</span>`).join(' ')} <span style="color:var(--accent);font-size:12px">→</span></td></tr>`).join('')}</tbody>
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
      <td style="white-space:nowrap"><button class="small primary" onclick="studioView(${p.id})">🎨 Студи</button> <button class="small" onclick="tourView(${p.id})">🎥 POV Tour</button> <button class="small" onclick='propForm(${JSON.stringify(p)})'>Засах</button></td></tr>`).join('')}</tbody>
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
    closeModal(); buyers();
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

// ---------- Зах зээлийн зарын бүрэн мэдээлэл + судалгаа ----------
window.marketDetail = async function (id) {
  const d = await api('/market/' + id); if (d.error) return alert(d.error);
  const l = d.listing, v = d.valuation;
  const pos = d.vsIndex == null ? '' : `<span class="badge ${d.vsIndex <= -8 ? 'ok' : d.vsIndex >= 8 ? 'warn' : 'mut'}">индексээс ${d.vsIndex > 0 ? '+' : ''}${d.vsIndex}%</span>`;
  modal(`
  <h3>${esc(l.title || (l.district + ' ' + l.rooms + ' өрөө'))}</h3>
  <div style="font-size:13px;color:var(--muted);margin-bottom:10px">${esc(l.district)}${l.khoroolol ? ' · ' + esc(l.khoroolol) : ''} · ${l.deal_type === 'rent' ? 'түрээс' : 'зарна'} · эх: ${esc(l.source)} ${l.source_url ? `· <a href="${esc(l.source_url)}" target="_blank" rel="noopener">эх зар ↗</a>` : ''}${l.ad_type ? ' · ' + esc(l.ad_type) : ''}${l.is_business ? ' · бизнес хэрэглэгч' : ''}</div>
  <div class="tiles" style="margin-bottom:12px">
    <div class="tile"><div class="v">${fmt(l.price)}<small style="font-size:12px"> сая ₮${l.deal_type === 'rent' ? '/сар' : ''}</small></div><div class="k">Үнэ ${l.prev_price ? `<span class="badge ${l.prev_price > l.price ? 'ok' : 'warn'}">${l.prev_price > l.price ? '▼' : '▲'} өмнө ${fmt(l.prev_price)}</span>` : ''}</div></div>
    <div class="tile"><div class="v">${l.rooms}ө · ${l.area} м²</div><div class="k">${l.floor ? l.floor + '/' + (l.total_floors || '—') + ' давхар · ' : ''}${l.is_new ? 'шинэ' : 'хуучин'}</div></div>
    <div class="tile"><div class="v">${d.m2 ? fmt(d.m2) : '—'}</div><div class="k">сая ₮/м² ${pos}</div></div>
    <div class="tile"><div class="v">${d.days ?? '—'}</div><div class="k">хоног зах зээлд${l.delisted_at ? ' · хасагдсан' : l.active ? '' : ' · идэвхгүй'}</div></div>
  </div>
  ${v ? `<div class="card" style="margin-bottom:12px"><h3>📊 Үнэлгээ (А3)</h3><div style="font-size:13.5px">Зах зээлийн бодит үнэ: <b>${fmt(v.low)} – ${fmt(v.high)}</b> сая ₮ (төв <b>${fmt(v.estimate)}</b>) · эх сурвалж: ${esc(v.source || 'индекс')} · итгэлцүүр ${v.confidence || '—'}</div>
    <div style="font-size:12.5px;color:var(--muted);margin-top:4px">Зар ${l.price < v.low ? '<b style="color:var(--accent)">интервалаас доогуур — боломж</b>' : l.price > v.high ? '<b style="color:var(--accent-2)">интервалаас дээгүүр</b>' : 'интервал дотор'}${d.index ? ` · дүүргийн индекс ${fmt(d.index.median_m2)} сая/м² (${d.index.month})` : ''}</div></div>` : ''}
  ${d.location ? `<div class="card" style="margin-bottom:12px"><h3>📍 Байршил (А8)</h3><div style="display:flex;gap:10px;flex-wrap:wrap;font-size:12.5px">${['education', 'transport', 'commerce', 'health', 'parking', 'green'].map((k) => d.location[k] != null ? `<span class="badge ${d.location[k] >= 75 ? 'ok' : 'mut'}">${{ education: 'Сургууль', transport: 'Тээвэр', commerce: 'Худалдаа', health: 'Эмнэлэг', parking: 'Зогсоол', green: 'Ногоон' }[k]} ${d.location[k]}</span>` : '').join('')}${d.location.growth ? ` <span class="badge warn">өсөлт: ${esc(d.location.growth)}</span>` : ''}</div>${d.location.growth_note ? `<div style="font-size:12px;color:var(--muted);margin-top:4px">${esc(d.location.growth_note)}</div>` : ''}</div>` : ''}
  ${d.poster ? `<div class="card" style="margin-bottom:12px"><h3>👤 Нийтлэгч</h3><div style="font-size:13px"><span class="badge ${POSTER_KIND[d.poster.kind][1]}">${POSTER_KIND[d.poster.kind][0]}</span> <b>${esc(d.poster.name || 'нэргүй')}</b>${d.poster.verified ? ' ✔' : ''} · зар ${d.poster.listings} (идэвхтэй ${d.poster.active_listings})${d.poster.company_guess ? ' · компани: <b>' + esc(d.poster.company_guess) + '</b>' : ''} <button class="small" onclick="posterView('${esc(d.poster.key)}')">бүх зар (манай сан)</button>${posterUrl(d.poster.key) ? ` <a href="${posterUrl(d.poster.key)}" target="_blank" rel="noopener"><button class="small">unegui профайл ↗</button></a>` : ''} ${phoneBtn(l.source_url)}</div>
    ${d.posterListings.length ? `<div style="font-size:12px;color:var(--muted);margin-top:4px">Бусад зар: ${d.posterListings.slice(0, 5).map((x) => `<a href="#" onclick="marketDetail(${x.id});return false">${esc((x.title || '').slice(0, 30))}</a>`).join(' · ')}${d.posterListings.length > 5 ? ' …' : ''}</div>` : ''}
    ${d.poster.kind === 'owner' ? `<div style="margin-top:8px">${d.lead ? `<span class="badge ok">Lead: ${LEAD_ST[d.lead.status] || d.lead.status}</span>` : `<button class="small primary" onclick="leadClaim(${l.id});closeModal()">✋ Гэрээний боломж — авч ажиллах</button>`} <span style="font-size:11.5px;color:var(--muted)">утас — эх зарын «Дугаар харах»-аар, зөвшөөрөлтэйгээр</span></div>` : ''}</div>` : ''}
  <div class="card" style="margin-bottom:12px"><h3>🏘 Ижил төстэй зарууд (${d.similar.length})</h3>
    ${d.similar.length ? `<div class="tablebox"><table><thead><tr><th>Зар</th><th class="num">м²</th><th class="num">Үнэ</th><th class="num">₮/м²</th><th>Огноо</th></tr></thead><tbody>
    ${d.similar.map((s) => `<tr style="cursor:pointer" onclick="marketDetail(${s.id})"><td>${esc((s.title || '').slice(0, 50))}${s.khoroolol ? ' <span style="color:var(--muted)">' + esc(s.khoroolol) + '</span>' : ''}</td><td class="num">${s.area}</td><td class="num">${fmt(s.price)}${s.prev_price ? ` <small style="color:var(--muted)">(${fmt(s.prev_price)})</small>` : ''}</td><td class="num">${s.area ? fmt(s.price / s.area) : '—'}</td><td>${s.listed_at || ''}</td></tr>`).join('')}</tbody></table></div>` : '<span style="color:var(--muted)">Ижил төстэй зар алга</span>'}</div>
  <div class="card" style="margin-bottom:12px"><h3>🎯 Тохирох худалдан авагчид (А4, манай хүсэлтүүдээс)</h3>
    ${d.buyers.length ? d.buyers.map((b) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-bottom:1px solid var(--line);font-size:13px"><span><span class="score">${b.score}</span> <b>${esc(b.client_name)}</b> ${esc(b.client_phone || '')} · төсөв ${fmt(b.budget)} сая · ${b.rooms}ө · ${esc(b.districts || '')}</span><button class="small" onclick="closeModal();show('buyers');setTimeout(()=>showMatches(${b.id}),500)">Хүсэлт №${b.id}</button></div>`).join('') : '<span style="color:var(--muted)">Одоогоор тохирох нээлттэй хүсэлт алга</span>'}</div>
  <div style="font-size:11.5px;color:var(--muted)">Ажиглах горим: зөвхөн баримт хадгалсан (тайлбар, зураг, утас байхгүй) — бүрэн зарыг эх сурвалжаас үзнэ. Цуглуулсан: ${l.collected_at ? String(l.collected_at).slice(0, 16).replace('T', ' ') : '—'} · сүүлд харагдсан: ${l.last_seen ? String(l.last_seen).slice(0, 16).replace('T', ' ') : '—'}</div>
  <div class="modal-actions" style="margin-top:10px"><button type="button" onclick="closeModal()">Хаах</button></div>`);
};

// ---------- Агентын хэрэгсэл: Миний лист · AI Студи · Buyer бүртгэл · Худалдан авагч хайх ----------
const PROP_STATUS_T = { active: 'Идэвхтэй', contracted: 'Гэрээтэй', sold: 'Зарагдсан', archived: 'Архив' };
async function mylist() {
  const rows = await api('/properties');
  const mine = rows.filter((p) => ME && p.agent_id === ME.id);
  const list = mine.length ? mine : rows;
  $('#main').innerHTML = `
  <div class="page-head"><h2>📌 Миний лист</h2><div style="display:flex;gap:8px"><span class="demo-note">${mine.length ? 'Танд хариуцуулсан объектууд' : 'Танд хариуцуулсан объект алга — бүх объект'}</span><button class="primary" onclick="propForm()">+ Объект нэмэх</button></div></div>
  <div class="tablebox"><table>
    <thead><tr><th>Объект</th><th class="num">Өрөө · м²</th><th class="num">Үнэ</th><th>Төлөв</th><th>Хэрэгслүүд</th></tr></thead>
    <tbody>${list.map((p) => `<tr><td><b>${esc(p.district)}</b> ${esc(p.khoroolol || '')}<br><span style="font-size:12px;color:var(--muted)">${p.deal_type === 'rent' ? 'түрээс' : 'зарна'} · ${p.floor ? p.floor + '/' + (p.total_floors || '—') + ' давхар · ' : ''}${p.is_new ? 'шинэ' : 'хуучин'}${p.notes ? ' · ' + esc(p.notes) : ''}</span></td>
      <td class="num">${p.rooms}ө · ${p.area}</td><td class="num">${fmt(p.price)} сая</td><td>${badge(p.status)}</td>
      <td style="white-space:nowrap"><button class="small primary" onclick="studioView(${p.id})">🎨 Студи</button> <button class="small" onclick="tourView(${p.id})">🎥 POV</button> <button class="small" onclick="findBuyersFor(${p.id})">🔎 Худалдан авагч</button> <button class="small" onclick='propForm(${JSON.stringify(p)})'>Засах</button></td></tr>`).join('') || '<tr><td colspan="5" style="color:var(--muted)">Объект алга</td></tr>'}</tbody>
  </table></div>`;
}
async function studio() {
  const rows = await api('/properties');
  $('#main').innerHTML = `
  <div class="page-head"><h2>🎨 AI Студи</h2><span class="demo-note">Зураг оруул → AI зураг бүрийг үнэлж эрэмбэлнэ, 3 сувгийн зарын текст, давуу тал, үнийн стратеги, 30 хоногийн төлөвлөгөө</span></div>
  <div class="tablebox"><table>
    <thead><tr><th>Объект</th><th class="num">Өрөө · м²</th><th class="num">Үнэ</th><th>Төлөв</th><th></th></tr></thead>
    <tbody>${rows.map((p) => `<tr style="cursor:pointer" onclick="studioView(${p.id})"><td><b>${esc(p.district)}</b> ${esc(p.khoroolol || '')} <span style="font-size:12px;color:var(--muted)">· ${p.deal_type === 'rent' ? 'түрээс' : 'зарна'}</span></td>
      <td class="num">${p.rooms}ө · ${p.area}</td><td class="num">${fmt(p.price)} сая</td><td>${badge(p.status)}</td>
      <td><button class="small primary" onclick="studioView(${p.id});event.stopPropagation()">🎨 Студи нээх</button></td></tr>`).join('') || '<tr><td colspan="5" style="color:var(--muted)">Объект алга</td></tr>'}</tbody>
  </table></div>`;
}
// Buyer бүртгэл: харилцагч + хүсэлтийг нэг маягтаар (2 алхмыг нэг болгосон)
async function buyers() {
  const rows = await api('/requests-full');
  const open = rows.filter((r) => r.status !== 'closed');
  $('#main').innerHTML = `
  <div class="page-head"><h2>🧑‍💼 Buyer бүртгэл</h2><button class="primary" onclick="buyerForm()">+ Худалдан авагч бүртгэх</button></div>
  <div class="demo-note" style="margin-bottom:12px">Худалдан авагч (харилцагч) + хайж буй зүйлийг (хүсэлт) нэг маягтаар бүртгэнэ. Бүртгэмэгц А4 тохирол автоматаар ажиллаж, тохирох объект/зах зээлийн зарыг харуулна.</div>
  <div class="tablebox"><table>
    <thead><tr><th>Худалдан авагч</th><th>Хайж буй</th><th class="num">Төсөв</th><th>Дүүрэг</th><th>Төлөв</th><th>Агент</th><th></th></tr></thead>
    <tbody>${open.map((r) => `<tr><td><b>${esc(r.client_name)}</b></td><td>${DEAL_T[r.deal_type]} · ${r.rooms}ө${r.area_min || r.area_max ? ` · ${r.area_min || '?'}–${r.area_max || '?'} м²` : ''}</td>
      <td class="num">${fmt(r.budget)} сая</td><td>${esc(r.districts)}</td><td>${badge(r.status)}</td><td>${esc(r.agent_name || '—')}</td>
      <td style="white-space:nowrap"><button class="small primary" onclick="showMatches(${r.id})">🎯 Тохирол (А4)</button> <button class="small" onclick='reqForm(${JSON.stringify(r)})'>Засах</button></td></tr>`).join('') || '<tr><td colspan="7" style="color:var(--muted)">Нээлттэй хүсэлт алга</td></tr>'}</tbody>
  </table></div>
  <div id="match-area"></div>`;
}
window.buyerForm = function () {
  modal(`
  <h3>Худалдан авагч бүртгэх</h3>
  <form id="f" class="form-grid">
    <div class="field"><label>Нэр</label><input name="name" required></div>
    <div class="field"><label>Утас</label><input name="phone" placeholder="9911xxxx"></div>
    <div class="field"><label>Төрөл</label><select name="deal_type"><option value="sale">Худалдан авах</option><option value="rent">Түрээслэх</option></select></div>
    <div class="field"><label>Төсөв (сая ₮)</label><input name="budget" type="number" step="0.1" required></div>
    <div class="field"><label>Өрөө</label><input name="rooms" type="number" min="1" max="6" value="2"></div>
    <div class="field wide"><label>Дүүргүүд (таслалаар)</label><input name="districts" placeholder="Хан-Уул,Баянгол"></div>
    <div class="field"><label>Талбай min</label><input name="area_min" type="number"></div>
    <div class="field"><label>Талбай max</label><input name="area_max" type="number"></div>
    <div class="field wide"><label>Тэмдэглэл</label><input name="notes" placeholder="Ипотек, яаралтай, хүүхдийн сургууль ойр..."></div>
    <div class="field"><label>Хариуцах агент</label><select name="agent_id">${AGENT_OPTS(ME && ME.id)}</select></div>
    <div class="modal-actions wide"><button type="button" onclick="closeModal()">Болих</button><button class="primary">Бүртгэж тохирол хайх</button></div>
  </form>`);
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData($('#f')));
    const c = await api('/clients', { method: 'POST', body: { name: b.name, phone: b.phone, type: 'buyer', notes: b.notes } });
    if (c.error) return alert(c.error);
    const r = await api('/requests', { method: 'POST', body: { client_id: c.id, deal_type: b.deal_type, budget: b.budget, rooms: b.rooms, districts: b.districts, area_min: b.area_min, area_max: b.area_max, status: 'open', agent_id: b.agent_id, last_contact: new Date().toISOString() } });
    if (r.error) return alert(r.error);
    closeModal(); toast('Бүртгэгдлээ — тохирол хайж байна'); await show('requests'); setTimeout(() => showMatches(r.id), 300);
  });
};
// Худалдан авагч хайх: объект сонго → манай нээлттэй хүсэлтүүдээс тохирох худалдан авагчид (А4 урвуу)
async function findbuyers() {
  const rows = await api('/properties');
  $('#main').innerHTML = `
  <div class="page-head"><h2>🔎 Худалдан авагч хайх</h2><span class="demo-note">Объект сонгоход бүртгэлтэй худалдан авагчдын хүсэлтүүдээс тохирохыг оноогоор жагсаана (А4)</span></div>
  <div class="card"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><label>Объект</label><select id="fb-prop" onchange="findBuyersFor(this.value)"><option value="">— сонгох —</option>${rows.map((p) => `<option value="${p.id}">${esc(p.district)} ${esc(p.khoroolol || '')} · ${p.rooms}ө ${p.area}м² · ${fmt(p.price)} сая</option>`).join('')}</select></div></div>
  <div id="fb-out"></div>`;
}
window.findBuyersFor = async function (pid) {
  if (!pid) return;
  if (!$('#fb-out')) { document.querySelectorAll('#menu button').forEach((x) => x.classList.toggle('active', x.dataset.view === 'findbuyers')); await findbuyers(); }
  if ($('#fb-prop')) $('#fb-prop').value = pid;
  const d = await api('/properties/' + pid + '/buyers'); if (d.error) return alert(d.error);
  const p = d.property;
  $('#fb-out').innerHTML = `<div class="card" style="margin-top:12px"><h3>🎯 ${esc(p.district)} ${esc(p.khoroolol || '')} · ${p.rooms}ө ${p.area}м² · ${fmt(p.price)} сая — тохирох худалдан авагчид (${d.buyers.length} / нээлттэй ${d.total})</h3>
    ${d.buyers.length ? `<div class="tablebox"><table><thead><tr><th class="num">Оноо</th><th>Худалдан авагч</th><th>Утас</th><th>Хайж буй</th><th class="num">Төсөв</th><th>Дүүрэг</th><th>Агент</th><th></th></tr></thead><tbody>
    ${d.buyers.map((b) => `<tr><td class="num"><span class="score">${b.score}</span></td><td><b>${esc(b.client_name)}</b></td><td>${esc(b.client_phone || '')}</td><td>${DEAL_T[b.deal_type]} · ${b.rooms}ө</td><td class="num">${fmt(b.budget)} сая</td><td>${esc(b.districts || '')}</td><td>${esc(b.agent_name || '—')}</td>
      <td><button class="small" onclick="navigator.clipboard.writeText('${esc(p.district)} ${esc(p.khoroolol || '')}, ${p.rooms} өрөө, ${p.area} м², ${fmt(p.price)} сая ₮ — танд тохирох объект байна. Үзэх цаг товлох уу?').then(()=>toast('Санал хуулагдлаа'))">📋 Санал</button></td></tr>`).join('')}</tbody></table></div>` : '<span style="color:var(--muted)">Оноо ≥40 худалдан авагч олдсонгүй — Buyer бүртгэлээ нэмээрэй</span>'}</div>`;
};

// ---------- Гэрээний боломж (lead): эзэн өөрөө нийтэлсэн шинэ зарууд ----------
const POSTER_KIND = { owner: ['🏠 Эзэн', 'ok'], agent: ['🧑‍💼 Агент', 'mut'], agency: ['🏢 Агентлаг', 'mut'], developer: ['🏗 Хөгжүүлэгч', 'warn'], unknown: ['? Тодорхойгүй', 'mut'] };
const LEAD_ST = { new: 'Шинэ', working: 'Ажиллаж байна', contacted: 'Холбогдсон', signed: 'Гэрээ хийсэн', rejected: 'Татгалзсан' };
// Нийтлэгчийн эх сайт дээрх профайл (бүх зар) — зөвхөн агентад холбоос; бот энэ замыг уншихгүй (robots: */author)
const posterUrl = (key) => { const m = /^unegui-user-(\d+)$/.exec(key || ''); return m ? `https://www.unegui.mn/items/author/${m[1]}/` : ''; };
const phoneBtn = (url) => url ? `<a href="${esc(url)}" target="_blank" rel="noopener"><button class="small" title="Эх зарын хуудас нээгдэнэ — «Дугаар харах» товчийг дарна">☎ Дугаар харах ↗</button></a>` : '';
async function leads(days = 14) {
  const d = await api('/leads?days=' + days);
  const rows = d.leads || [];
  $('#main').innerHTML = `
  <div class="page-head"><h2>🎯 Гэрээний боломж — эзэн өөрөө нийтэлсэн зарууд</h2>
    <div style="display:flex;gap:6px;align-items:center"><label style="font-size:12.5px">Сүүлийн</label><select onchange="leads(Number(this.value))">${[7, 14, 30, 60].map((n) => `<option value="${n}" ${n === d.days ? 'selected' : ''}>${n} хоног</option>`).join('')}</select></div></div>
  <div class="demo-note" style="margin-bottom:12px">Ботууд нийтлэгч бүрийг бүртгэж (нэр, бизнес эсэх, зарын тоо/ангилал/дүүрэг) <b>эзэн / агент / агентлаг / хөгжүүлэгч</b> гэж ангилна. Эзэн (1–2 зартай, бизнес биш) өөрөө нийтэлсэн шинэ зар = зуучлалын гэрээний боломж. Оноо: зарах + шинэ + зураг цөөн + үнэ индексээс дээгүүр + үнэ буулгасан. <b>Утас хадгалахгүй</b> — «Эх зар ↗»-аас агент өөрөө холбогдож, зөвшөөрөлтэйгээр харилцагчийн бүртгэлд нөхнө.</div>
  <div class="tablebox"><table>
    <thead><tr><th class="num">Оноо</th><th>Зар</th><th>Нийтлэгч</th><th class="num">Үнэ</th><th class="num">Индекс</th><th class="num">Хоног</th><th>Төлөв</th><th></th></tr></thead>
    <tbody>${rows.map((r) => `<tr style="${r.lead_status ? 'opacity:.75' : ''}">
      <td class="num"><span class="score">${r.score}</span></td>
      <td><b style="cursor:pointer" onclick="marketDetail(${r.id})">${esc((r.title || '').slice(0, 60))}</b><br><span style="font-size:12px;color:var(--muted)">${esc(r.district)}${r.khoroolol ? ' · ' + esc(r.khoroolol) : ''} · ${r.category === 'house' ? 'хаус/хашаа' : r.rooms + 'ө'} ${r.area || '?'} м² · ${r.deal_type === 'rent' ? 'түрээс' : 'зарна'} · зураг ${r.images}${r.source_url ? ` · <a href="${esc(r.source_url)}" target="_blank" rel="noopener">эх зар ↗</a>` : ''}</span></td>
      <td><span class="badge ${POSTER_KIND[r.poster_kind][1]}">${POSTER_KIND[r.poster_kind][0]}</span> <a href="#" onclick="posterView('${esc(r.poster_key || '')}');return false" title="Энэ нийтлэгчийн бүх зар (манай санд)"><b>${esc(r.poster_name || 'нэргүй')}</b></a>${r.poster_verified ? ' ✔' : ''}<br><span style="font-size:11.5px;color:var(--muted)">зар ${r.poster_listings} (идэвхтэй ${r.poster_active})${posterUrl(r.poster_key) ? ` · <a href="${posterUrl(r.poster_key)}" target="_blank" rel="noopener">unegui профайл ↗</a>` : ''}</span></td>
      <td class="num">${fmt(r.price)} сая${r.prev_price ? `<br><small style="color:var(--muted)">өмнө ${fmt(r.prev_price)}</small>` : ''}</td>
      <td class="num">${r.vsIndex == null ? '—' : `<span class="badge ${r.vsIndex >= 5 ? 'warn' : r.vsIndex <= -8 ? 'ok' : 'mut'}">${r.vsIndex > 0 ? '+' : ''}${r.vsIndex}%</span>`}</td>
      <td class="num">${r.age}</td>
      <td>${r.lead_status ? `<select onchange="leadStatus(${r.id},this.value)">${Object.entries(LEAD_ST).map(([k, v]) => `<option value="${k}" ${r.lead_status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>` : '<span class="badge ok">шинэ</span>'}</td>
      <td style="white-space:nowrap">${r.lead_status ? (r.lead_client ? `<button class="small" onclick="show('clients')">Харилцагч</button>` : '') : `<button class="small primary" onclick="leadClaim(${r.id})">✋ Авч ажиллах</button>`} ${phoneBtn(r.source_url)} <button class="small" onclick="marketDetail(${r.id})">Дэлгэрэнгүй</button></td></tr>`).join('') || '<tr><td colspan="8" style="color:var(--muted)">Сүүлийн хоногуудад эзний нийтэлсэн зар олдсонгүй — ботууд ажилласаар байна</td></tr>'}</tbody>
  </table></div>`;
}
window.leadClaim = async (id) => { const d = await api('/leads/' + id + '/claim', { method: 'POST' }); if (d.error) return alert(d.error); toast(d.existed ? 'Аль хэдийн ажиллаж байна' : 'Харилцагч (эзэн) үүсгэлээ — утсыг холбогдсоны дараа нөхнө'); leads(); };
window.leadStatus = async (id, status) => { await api('/leads/' + id, { method: 'PUT', body: { status } }); toast('Төлөв: ' + LEAD_ST[status]); };
window.posterView = async (key) => {
  const d = await api('/posters/' + encodeURIComponent(key)); if (d.error) return alert(d.error);
  const p = d.poster;
  modal(`<h3>${POSTER_KIND[p.kind][0]} · ${esc(p.name || 'нэргүй')}${p.verified ? ' ✔ баталгаажсан' : ''}</h3>
  <div style="font-size:12.5px;color:var(--muted);margin-bottom:8px">Эх: ${esc(p.source)} · зар ${p.listings} (идэвхтэй ${p.active_listings}) · ангилал: ${Object.entries(p.categories || {}).map(([k, n]) => k + ' ' + n).join(', ') || '—'} · дүүрэг: ${Object.entries(p.districts || {}).map(([k, n]) => k + ' ' + n).join(', ') || '—'}${p.company_guess ? ' · компани: <b>' + esc(p.company_guess) + '</b>' : ''} · анх ${String(p.first_seen).slice(0, 10)}
    ${posterUrl(p.key) ? ` · <a href="${posterUrl(p.key)}" target="_blank" rel="noopener"><b>unegui дээрх бүх зар ↗</b></a>` : ''}</div>
  <div class="tablebox"><table><thead><tr><th>Зар</th><th>Ангилал</th><th class="num">Үнэ</th><th>Огноо</th><th></th></tr></thead><tbody>
  ${d.listings.map((l) => `<tr style="${l.active ? '' : 'opacity:.6'}"><td>${esc((l.title || '').slice(0, 55))}<br><span style="font-size:11.5px;color:var(--muted)">${esc(l.district)} ${esc(l.khoroolol || '')}</span></td><td>${esc(l.category)} · ${l.deal_type}</td><td class="num">${fmt(l.price)}</td><td>${l.listed_at || ''}</td><td style="white-space:nowrap">${phoneBtn(l.source_url)} <button class="small" onclick="closeModal();marketDetail(${l.id})">→</button></td></tr>`).join('')}</tbody></table></div>
  <div class="modal-actions" style="margin-top:10px"><button type="button" onclick="closeModal()">Хаах</button></div>`);
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
      <tbody>${opp.map((o) => `<tr style="cursor:pointer" onclick="marketDetail(${o.id})" title="Бүрэн мэдээлэл, судалгаа"><td>${esc(o.district)}${o.khoroolol ? ' · ' + esc(o.khoroolol) : ''}</td><td class="num">${o.rooms}</td><td class="num">${o.area}</td>
        <td class="num">${fmt(o.price)}</td><td class="num">${fmt(o.m2)}</td><td class="num">${fmt(o.baseline)}</td>
        <td>${o.tags.map((t) => `<span class="badge ${t.t === 'under' ? 'ok' : 'warn'}">${t.label}</span>`).join(' ')} <span style="color:var(--accent);font-size:12px">→</span></td></tr>`).join('')}</tbody>
    </table></div></div>`;
}

// ---------- Ш3д: Virtual POV Tour — план засварлагч ----------
let TOUR = null; // { pid, plan, types, token, sel, drag }
function toast(msg) {
  let el = $('#toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--accent);color:#fff;padding:9px 16px;border-radius:8px;font-size:13px;z-index:99;box-shadow:0 6px 20px rgba(0,0,0,.25);transition:opacity .3s'; document.body.appendChild(el); }
  el.textContent = msg; el.style.opacity = 1; clearTimeout(el._t); el._t = setTimeout(() => { el.style.opacity = 0; }, 2200);
}
// mode: 'auto' (✨ автомат план) | 'measure' (📐 хэмжээс + AI + 360°) | 'build' (🧱 блок өрж бүтээх)
window.tourView = async function (pid, mode) {
  if (POLL) { clearInterval(POLL); POLL = null; }
  document.querySelectorAll('#menu button').forEach((x) => x.classList.toggle('active', x.dataset.view === 'tours'));
  const d = await api('/tour/' + pid);
  if (d.error) { alert(d.error); return; }
  TOUR = { pid, plan: d.tour.plan, types: d.types, token: d.tour.token, property: d.property, assets: d.assets, sel: null, drag: null, tool: null, snap: 0.1, undo: [], mode: mode || (TOUR && TOUR.pid === pid ? TOUR.mode : null) || 'auto' };
  renderTour();
};
window.tourMode = (m) => { TOUR.mode = m; TOUR.tool = null; renderTour(); };
// 🎥 POV Tour цэс — объект бүрд 3 арга
async function tours() {
  const d = await api('/properties');
  const rows = (d.items || d || []).filter((p) => p.status !== 'archived');
  $('#main').innerHTML = `
  <div class="page-head"><h2>🎥 Virtual POV Tour</h2><span class="demo-note">Объект бүрд 3 арга — аль нэгээр нь эхлээд бусдаар нь нарийвчилж болно</span></div>
  <div class="tiles" style="margin-bottom:14px">
    <div class="tile" style="text-align:left"><div style="font-weight:700">✨ Автомат план</div><div class="k">Өрөөний тоо, талбайгаас систем ердийн зохион байгуулалт зурна — 10 секунд. Танилцуулах түвшин.</div></div>
    <div class="tile" style="text-align:left"><div style="font-weight:700">📐 Хэмжээс + AI</div><div class="k">Өрөө бүрийн хэмжээс, цонх/хаалганы байрлалыг маягтаар; зураг/бичлэгээс AI тааз, шал, ханын өнгийг таамаглана; 360° панорам. Бодит түвшин.</div></div>
    <div class="tile" style="text-align:left"><div style="font-weight:700">🧱 Блок өрж бүтээх</div><div class="k">Нүдэн баримжаа, зургаа харж өрөөнүүдээ блок мэт өрж, чирж хэмжээсээ тааруулаад симуляцийг эхлүүлнэ. Агентын гар бүтээл.</div></div>
  </div>
  <div class="card"><h3>Объектууд (${rows.length})</h3>
    <div class="tablebox"><table><thead><tr><th>Объект</th><th class="num">Өрөө</th><th class="num">м²</th><th>Арга</th></tr></thead><tbody>
    ${rows.map((p) => `<tr><td><b>${esc(p.district)}</b> ${esc(p.khoroolol || '')} · ${p.deal_type === 'rent' ? 'түрээс' : 'зарна'} · ${fmt(p.price)} сая ₮</td><td class="num">${p.rooms}</td><td class="num">${p.area}</td>
      <td style="white-space:nowrap"><button class="small" onclick="tourView(${p.id},'auto')">✨ Автомат</button> <button class="small" onclick="tourView(${p.id},'measure')">📐 Хэмжээс + AI</button> <button class="small primary" onclick="tourView(${p.id},'build')">🧱 Блок өрөх</button></td></tr>`).join('') || '<tr><td colspan="4" style="color:var(--muted)">Объект алга — эхлээд «Объект» цэсээр бүртгэнэ</td></tr>'}
    </tbody></table></div></div>`;
}
function renderTour() {
  const t = TOUR, p = t.property, plan = t.plan; const mode = t.mode || 'auto';
  const shareUrl = location.origin + '/tour/' + t.token;
  const tab = (m, label) => `<button class="${mode === m ? 'primary' : ''}" onclick="tourMode('${m}')">${label}</button>`;
  const roomsTable = `<div class="tablebox"><table><thead><tr><th>Нэр</th><th>Төрөл</th><th class="num">Өргөн</th><th class="num">Урт</th><th></th></tr></thead><tbody>
      ${plan.rooms.map((r, i) => `<tr style="${t.sel === r.id ? 'background:color-mix(in srgb,var(--accent) 12%,var(--surface))' : ''}" onclick="tourSel('${r.id}')">
        <td><input value="${esc(r.name)}" style="width:110px" onchange="tourEdit(${i},'name',this.value)"></td>
        <td><select onchange="tourEdit(${i},'type',this.value)">${Object.entries(t.types).map(([k, v]) => `<option value="${k}" ${r.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
        <td class="num"><input type="number" step="0.1" min="1" max="20" value="${r.w}" style="width:62px" onchange="tourEdit(${i},'w',this.value)"></td>
        <td class="num"><input type="number" step="0.1" min="1" max="20" value="${r.h}" style="width:62px" onchange="tourEdit(${i},'h',this.value)"></td>
        <td><button class="small" onclick="tourDelRoom(${i});event.stopPropagation()">✕</button></td></tr>`).join('')}</tbody></table></div>`;
  const styleBox = plan.style ? `<div style="margin-top:10px;background:var(--surface-2);border-radius:6px;padding:8px 10px;font-size:12.5px">
        <b>🔍 AI шинжилгээ</b> (${plan.style.photos} зураг · ${esc(plan.style.condition || '')}): тааз <b>${plan.style.ceiling_m} м</b> · хаалга ${plan.style.door_h} м · цонх ${plan.style.window_sill}–${plan.style.window_top} м · довжоо ${plan.style.threshold_cm} см · шал ${esc(plan.style.floor)} · хана <span style="display:inline-block;width:12px;height:12px;background:${esc(plan.style.wall_color)};border:1px solid var(--line);vertical-align:middle"></span> ${esc(plan.style.wall_color)} · тааз хонхорхой ${plan.style.ceiling_cove ? 'тийм' : 'үгүй'}${plan.style.beams && plan.style.beams.length ? ' · дам нуруу: ' + plan.style.beams.map((b) => esc(b.room + (b.note ? ' — ' + b.note : ''))).join('; ') : ''}
        ${(plan.style.rooms || []).length ? '<div style="margin-top:4px">' + plan.style.rooms.map((h) => `<div>• <b>${esc(h.room)}</b>: цонх ${h.windows ?? '?'} (${h.window_w ?? '?'} м), хаалга ${h.doors ?? '?'}, хана ${esc(h.wall_color || '?')}, шал ${esc(h.floor || '?')}${h.notes ? ' — ' + esc(h.notes) : ''}</div>`).join('') + '</div>' : ''}
        ${(plan.style.notes || []).length ? '<div style="color:var(--muted);margin-top:4px">' + plan.style.notes.map(esc).join(' · ') + '</div>' : ''}</div>` : '';
  const panoBox = `<h3 style="margin-top:16px">📷 360° панорам (бодит орчин)</h3>
      <div style="font-size:12px;color:var(--muted);margin-bottom:8px">360° камер (Insta360, Ricoh Theta) эсвэл утасны панорам горимоор өрөө бүрийн төвөөс, мөн гадаах цэгүүдээс (орц, хашаа, талбай) авсан <b>equirectangular 2:1</b> JPEG. Панорамтай өрөөнд аялал автоматаар бүтэн эргэж үзүүлнэ; бүх өрөө панорамтай бол 3D загвар хэрэггүй болно.</div>
      <div class="tablebox"><table><thead><tr><th>Цэг</th><th>Панорам</th><th></th></tr></thead><tbody>
      ${plan.rooms.map((r) => { const pn = (t.assets || []).find((a) => a.kind === 'pano' && a.room_id === r.id); return `<tr><td>${esc(r.name)}</td>
        <td>${pn ? `<span class="badge ok">✔ оруулсан</span> <button class="small" onclick="tourPanoDel(${pn.id})">✕</button>` : `<input type="file" accept="image/jpeg,image/png,image/webp" style="width:auto;font-size:12px" onchange="tourPanoUpload('${r.id}',this)">`}</td><td></td></tr>`; }).join('')}
      ${(t.assets || []).filter((a) => a.kind === 'pano' && String(a.room_id || '').startsWith('ext:')).map((a) => `<tr><td>🌍 ${esc(a.room_id.slice(4))}</td><td><span class="badge ok">✔ оруулсан</span> <button class="small" onclick="tourPanoDel(${a.id})">✕</button></td><td></td></tr>`).join('')}
      <tr><td><input id="tour-ext-name" placeholder="Гадаах цэг (ж: Орц, Хашаа)" style="width:150px"></td><td><input type="file" accept="image/jpeg,image/png,image/webp" style="width:auto;font-size:12px" onchange="tourPanoUpload('ext:'+($('#tour-ext-name').value.trim()||'Гадаах орчин'),this)"></td><td></td></tr>
      </tbody></table></div>`;
  const videoBox = `<h3 style="margin-top:16px">🎬 Бичлэг → AI шинжилгээ</h3>
      <div style="font-size:12px;color:var(--muted);margin-bottom:6px">Утсаараа өрөө бүрийг аажуу эргэлдүүлж авсан бичлэг (mp4/mov). Браузер дээр 12 кадр гаргаж, өрөөний шошготой илгээнэ; дараа нь «🔍 AI зургаас шинжлэх» — тааз/цонх/хаалга/шал/ханын өнгийг өрөө тус бүрээр таамаглаж маягтыг урьдчилан бөглөнө.</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <select id="tour-vid-room">${plan.rooms.map((r) => `<option value="${esc(r.name)}">${esc(r.name)}</option>`).join('')}<option value="">(бүх байр)</option></select>
        <input type="file" id="tour-vid" accept="video/*" style="width:auto;font-size:12px" onchange="tourVideo(this)">
        <span id="tour-vid-st" style="font-size:12px;color:var(--muted)">кадр: ${(t.assets || []).filter((a) => a.kind === 'frame').length}</span>
        ${(t.assets || []).some((a) => a.kind === 'frame') ? '<button class="small" onclick="tourFramesClear()">✕ кадрууд устгах</button>' : ''}
        <button class="small" onclick="tourAnalyze()" title="Студийн зураг + бичлэгийн кадруудаас AI таамаглаж 3D-д тусгана">🔍 AI зургаас шинжлэх</button>
      </div>`;
  const shareBox = `<div class="card" style="margin-top:16px"><h3>3D урьдчилан харах · хуваалцах</h3>
      <iframe id="tour-frame" src="/tour/${t.token}?v=${Date.now()}" style="width:100%;aspect-ratio:16/9;border:1px solid var(--line);border-radius:6px;background:#0b1220" allowfullscreen></iframe>
      <div style="margin-top:10px"><b>Хуваалцах холбоос</b> (худалдан авагчид, нэвтрэлт шаардахгүй):
        <input value="${shareUrl}" readonly style="width:100%;margin-top:4px" onclick="this.select()">
        <div style="display:flex;gap:8px;margin-top:6px"><a class="btn" href="${shareUrl}" target="_blank" rel="noopener"><button class="small">↗ Шинэ цонхонд нээх</button></a><button class="small" onclick="navigator.clipboard.writeText('${shareUrl}').then(()=>toast('Холбоос хуулагдлаа'))">📋 Хуулах</button></div></div>
      <div style="margin-top:8px;font-size:12.5px;color:var(--muted)">Орц: <b>${esc((plan.rooms.find((r) => r.id === plan.entry) || {}).name || '—')}</b> · тааз ${plan.ceiling} м · хаалга ${plan.doors.length} · цонх ${plan.windows.length} · нийт ${plan.totalArea} м²</div></div>`;
  const refPhotos = (t.assets || []).filter((a) => a.kind !== 'pano' && a.kind !== 'frame');
  const refBox = refPhotos.length ? `<div style="margin-top:10px"><b style="font-size:12.5px">Лавлах зургууд</b> <span style="font-size:11.5px;color:var(--muted)">(нүдэн баримжаагаа нягтлах)</span>
        <div style="display:flex;gap:6px;overflow:auto;padding:6px 0">${refPhotos.map((a) => `<img src="/api/studio/asset/${a.id}?token=${encodeURIComponent(TOKEN)}" title="${esc(a.room || '')}" style="height:72px;border-radius:4px;flex:none;cursor:zoom-in" onclick="window.open(this.src,'_blank')">`).join('')}</div></div>` : '';

  let body = '';
  if (mode === 'auto') {
    body = `<div class="card"><h3>✨ Автомат план — объектын баримтаас</h3>
      <div style="font-size:12.5px;color:var(--muted);margin-bottom:8px">${p.rooms} өрөө · ${p.area} м² · ${p.floor || '?'}/${p.total_floors || '?'} давхар → УБ-ын орон сууцны ердийн зохион байгуулалт (унтлагын · угаалгын/хувцасны · зочны · коридор · гал тогоо). Хэмжээг доор засаад хадгална; нарийн хэмжээс, цонх/хаалга — «📐 Хэмжээс + AI» эсвэл «🧱 Блок өрөх» горимд.</div>
      ${roomsTable}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="small" onclick="tourAuto()">✨ Автомат план дахин үүсгэх</button>
        <button class="small" onclick="tourAddRoom()">+ Өрөө</button>
        <button class="small primary" onclick="tourSave()">💾 Хадгалах + 3D шинэчлэх</button>
      </div></div>`;
  } else if (mode === 'measure') {
    body = `<div style="display:grid;grid-template-columns:minmax(300px,420px) 1fr;gap:16px" class="col-grid">
      <div class="card"><h3>📐 Өрөөнүүд (${plan.rooms.length}) · нийт ${plan.totalArea} м²</h3>
        <div style="font-size:12px;color:var(--muted);margin-bottom:6px">Лазер хэмжигчээр өрөө бүрийн өргөн/уртыг оруулаад, өрөө сонгож цонх/хаалга/дам нурууны байрлалыг заана. Бичлэг/зургаас AI урьдчилан бөглөж болно.</div>
        ${roomsTable}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button class="small" onclick="tourAddRoom()">+ Өрөө</button><button class="small primary" onclick="tourSave()">💾 Хадгалах + 3D шинэчлэх</button></div>
        ${styleBox}
        ${videoBox}
        ${panoBox}
      </div>
      <div>${tourRoomDetail(t)}
        <div class="card" style="margin-top:12px"><h3>План (лавлагаа)</h3><canvas id="tour-plan" width="1000" height="680" style="width:100%;border:1px solid var(--line);border-radius:6px;background:var(--surface-2);touch-action:none"></canvas>
        <div style="font-size:11.5px;color:var(--muted);margin-top:6px">Өрөө дарж сонгоно · тод = гараар, бүдэг = автомат</div>${refBox}</div>
      </div></div>`;
  } else {
    body = `<div class="card"><h3>🧱 План бүтээх — блок өрөх засварлагч</h3>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px;font-size:12.5px">
        <span style="color:var(--muted)">Өрөө нэмэх:</span>
        ${Object.entries(t.types).map(([k, v]) => `<button class="small" onclick="tourAddRoomOf('${k}')">+ ${v}</button>`).join('')}
        <span style="border-left:1px solid var(--line);height:18px;margin:0 4px"></span>
        <button class="small ${t.tool === 'win' ? 'primary' : ''}" onclick="tourTool('win')" title="Ханан дээр дарж цонх тавина">🪟 Цонх</button>
        <button class="small ${t.tool === 'door' ? 'primary' : ''}" onclick="tourTool('door')" title="Ханан дээр дарж хаалга тавина">🚪 Хаалга</button>
        <button class="small" onclick="tourRotateSel()" title="Сонгосон өрөөний өргөн/уртыг солино">⟲ Эргүүлэх</button>
        <button class="small" onclick="tourDupSel()">⧉ Хуулах</button>
        <button class="small" onclick="tourUndo()">↶ Буцаах</button>
        <button class="small" onclick="if(confirm('Бүх өрөөг устгаж хоосноос эхлэх үү?')){TOUR.undo.push(JSON.stringify(TOUR.plan.rooms));TOUR.plan.rooms=[];TOUR.sel=null;renderTour();}">🗑 Хоосноос</button>
        <label style="margin-left:auto">Алхам <select id="tour-snap" onchange="TOUR.snap=Number(this.value)"><option value="0.1" ${t.snap === 0.1 ? 'selected' : ''}>10 см</option><option value="0.05" ${t.snap === 0.05 ? 'selected' : ''}>5 см</option><option value="0.5" ${t.snap === 0.5 ? 'selected' : ''}>50 см</option></select></label>
      </div>
      <canvas id="tour-plan" width="1000" height="680" style="width:100%;border:1px solid var(--line);border-radius:6px;background:var(--surface-2);cursor:grab;touch-action:none"></canvas>
      <div style="font-size:11.5px;color:var(--muted);margin-top:6px">Чирж зөөнө · булан/ирмэгээс татаж хэмжээ өөрчилнө (хөрш өрөөнд соронзон шиг наалдана) · сумаар 1 алхам · Delete устгана · Ctrl+Z буцаана · 🪟/🚪 горимд ханан дээр дарж нээлхий тавина · давхар дарж нэр солино</div>
      ${refBox}
      <div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="primary" onclick="tourSave()">▶ Симуляци эхлүүлэх (хадгалж 3D бүтээнэ)</button><span style="font-size:12px;color:var(--muted)">Хадгалагдмагц доорх 3D шинэчлэгдэнэ</span></div>
      </div>
      ${tourRoomDetail(t)}`;
  }
  $('#main').innerHTML = `
  <div class="page-head"><h2>🎥 POV Tour · ${esc(p.district)} ${esc(p.khoroolol || '')} · ${p.rooms}ө ${p.area}м²</h2>
    <div style="display:flex;gap:8px"><button onclick="show('tours')">← POV Tour</button><button onclick="studioView(${p.id})">🎨 Студи</button></div></div>
  <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">${tab('auto', '✨ Автомат план')}${tab('measure', '📐 Хэмжээс + AI + 360°')}${tab('build', '🧱 Блок өрж бүтээх')}</div>
  ${body}
  ${shareBox}`;
  drawTourPlan(); bindTourCanvas();
}
// ---- Блок өрөх засварлагч: чирж зөөх, булан/ирмэгээс хэмжээ өөрчлөх, соронзон наалт, ханан дээр цонх/хаалга ----
function tourXform() {
  const plan = TOUR.plan; const minX = Math.min(...plan.rooms.map((r) => r.x), 0), minY = Math.min(...plan.rooms.map((r) => r.y), 0);
  const maxX = Math.max(...plan.rooms.map((r) => r.x + r.w), 4), maxY = Math.max(...plan.rooms.map((r) => r.y + r.h), 4);
  const sc = Math.min(900 / (maxX - minX + 3), 600 / (maxY - minY + 3));
  return { sc, ox: 50 - minX * sc + sc * 1.5, oy: 40 - minY * sc + sc * 1.5 };
}
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
function tourHandlePos(r, h, X, Y, sc) {
  const cx = X(r.x + r.w / 2), cy = Y(r.y + r.h / 2), l = X(r.x), t = Y(r.y), rt = X(r.x + r.w), b = Y(r.y + r.h);
  return { nw: [l, t], n: [cx, t], ne: [rt, t], e: [rt, cy], se: [rt, b], s: [cx, b], sw: [l, b], w: [l, cy] }[h];
}
function tourSnapVal(v, axis, exceptId) {
  const s = TOUR.snap || 0.1; let best = Math.round(v / s) * s, bd = 0.15;
  for (const o of TOUR.plan.rooms) { if (o.id === exceptId) continue; for (const c of axis === 'x' ? [o.x, o.x + o.w] : [o.y, o.y + o.h]) { const d = Math.abs(v - c); if (d < bd) { bd = d; best = c; } } }
  return Math.round(best * 100) / 100;
}
function tourOpeningSeg(r, side, off, w) { // өрөөний хананы (side) off..off+w хэсэг → план координат
  if (side === 'N') return [r.x + off, r.y, r.x + off + w, r.y]; if (side === 'S') return [r.x + off, r.y + r.h, r.x + off + w, r.y + r.h];
  if (side === 'W') return [r.x, r.y + off, r.x, r.y + off + w]; return [r.x + r.w, r.y + off, r.x + r.w, r.y + off + w];
}
function drawTourPlan() {
  const c = $('#tour-plan'); if (!c) return; const g = c.getContext('2d'); const plan = TOUR.plan; const { sc, ox, oy } = tourXform();
  const X = (x) => ox + x * sc, Y = (y) => oy + y * sc;
  g.clearRect(0, 0, c.width, c.height);
  const FILL = { living: '#93c5fd', kitchen: '#fde68a', bedroom: '#c4b5fd', bath: '#a5f3fc', hall: '#e2e8f0', balcony: '#bbf7d0', office: '#fdba74', other: '#e5e7eb' };
  // тор (1 м) + нарийн тор (алхам)
  const step = TOUR.snap || 0.1;
  if (sc * step >= 6) { g.strokeStyle = 'rgba(100,116,139,.07)'; g.lineWidth = 1; for (let m = -3; m < 60; m += step) { g.beginPath(); g.moveTo(X(m), 0); g.lineTo(X(m), c.height); g.stroke(); g.beginPath(); g.moveTo(0, Y(m)); g.lineTo(c.width, Y(m)); g.stroke(); } }
  g.strokeStyle = 'rgba(100,116,139,.18)'; g.lineWidth = 1;
  for (let m = -3; m < 60; m++) { g.beginPath(); g.moveTo(X(m), 0); g.lineTo(X(m), c.height); g.stroke(); g.beginPath(); g.moveTo(0, Y(m)); g.lineTo(c.width, Y(m)); g.stroke(); }
  // өрөөнүүд
  for (const r of plan.rooms) {
    const sel = TOUR.sel === r.id;
    g.fillStyle = FILL[r.type] || '#e5e7eb'; g.fillRect(X(r.x), Y(r.y), r.w * sc, r.h * sc);
    g.strokeStyle = sel ? '#2563eb' : '#1e293b'; g.lineWidth = sel ? 4 : 2.5; g.strokeRect(X(r.x), Y(r.y), r.w * sc, r.h * sc);
    g.fillStyle = '#0f172a'; g.font = '600 14px Inter,sans-serif'; g.textAlign = 'center'; g.fillText(r.name, X(r.x + r.w / 2), Y(r.y + r.h / 2) + 4);
    g.font = '12px Inter,sans-serif'; g.fillStyle = '#334155'; g.fillText(`${r.w} × ${r.h} м · ${(r.w * r.h).toFixed(1)} м²`, X(r.x + r.w / 2), Y(r.y + r.h / 2) + 18);
    // гар нээлхий (цонх цэнхэр, хаалга цагаан/улаан) — өрөөний хананд
    for (const w of r.win || []) { const [x1, y1, x2, y2] = tourOpeningSeg(r, w.side, w.off, w.w); g.strokeStyle = '#1d4ed8'; g.lineWidth = 7; g.beginPath(); g.moveTo(X(x1), Y(y1)); g.lineTo(X(x2), Y(y2)); g.stroke(); }
    for (const d of r.door || []) { const [x1, y1, x2, y2] = tourOpeningSeg(r, d.side, d.off, d.w); g.strokeStyle = d.to === 'out' ? '#dc2626' : '#f8fafc'; g.lineWidth = 7; g.beginPath(); g.moveTo(X(x1), Y(y1)); g.lineTo(X(x2), Y(y2)); g.stroke(); }
  }
  // серверийн тооцоолсон автомат хаалга/цонх (бүдэг)
  for (const d of plan.doors || []) if (!d.manual) { g.strokeStyle = d.b === 'out' ? 'rgba(220,38,38,.55)' : 'rgba(255,255,255,.8)'; g.lineWidth = 5; g.beginPath(); g.moveTo(X(d.x1), Y(d.y1)); g.lineTo(X(d.x2), Y(d.y2)); g.stroke(); }
  for (const w of plan.windows || []) if (!w.manual) { g.strokeStyle = 'rgba(37,99,235,.5)'; g.lineWidth = 5; g.beginPath(); g.moveTo(X(w.x1), Y(w.y1)); g.lineTo(X(w.x2), Y(w.y2)); g.stroke(); }
  // сонгосон өрөө: бариулууд + хэмжээсийн шугам + соронзон заагч
  const r = plan.rooms.find((x) => x.id === TOUR.sel);
  if (r) {
    for (const h of HANDLES) { const [hx, hy] = tourHandlePos(r, h, X, Y, sc); g.fillStyle = '#fff'; g.strokeStyle = '#2563eb'; g.lineWidth = 2; g.beginPath(); g.rect(hx - 5, hy - 5, 10, 10); g.fill(); g.stroke(); }
    g.fillStyle = '#2563eb'; g.font = '700 12px Inter,sans-serif'; g.textAlign = 'center';
    g.fillText(`${r.w} м`, X(r.x + r.w / 2), Y(r.y) - 8); g.save(); g.translate(X(r.x) - 10, Y(r.y + r.h / 2)); g.rotate(-Math.PI / 2); g.fillText(`${r.h} м`, 0, 0); g.restore();
    if (TOUR.guide) { g.strokeStyle = '#f59e0b'; g.lineWidth = 1.5; g.setLineDash([6, 4]); for (const gd of TOUR.guide) { g.beginPath(); if (gd.axis === 'x') { g.moveTo(X(gd.v), 0); g.lineTo(X(gd.v), c.height); } else { g.moveTo(0, Y(gd.v)); g.lineTo(c.width, Y(gd.v)); } g.stroke(); } g.setLineDash([]); }
  }
  g.fillStyle = '#64748b'; g.font = '12px Inter,sans-serif'; g.textAlign = 'left';
  g.fillText((TOUR.tool === 'win' ? '🪟 Ханан дээр дарж цонх тавина (Esc — болих)' : TOUR.tool === 'door' ? '🚪 Ханан дээр дарж хаалга тавина (Esc — болих)' : '🔴 орц · ⬜ хаалга · 🔵 цонх · тод = гараар, бүдэг = автомат · дээд тал = хойд зүг'), 10, c.height - 10);
}
function bindTourCanvas() {
  const c = $('#tour-plan'); if (!c) return;
  const pt = (e) => { const r = c.getBoundingClientRect(); const { sc, ox, oy } = tourXform(); return { x: ((e.clientX - r.left) / r.width * c.width - ox) / sc, y: ((e.clientY - r.top) / r.height * c.height - oy) / sc, px: (e.clientX - r.left) / r.width * c.width, py: (e.clientY - r.top) / r.height * c.height, sc, ox, oy }; };
  const snapshot = () => { TOUR.undo.push(JSON.stringify(TOUR.plan.rooms)); if (TOUR.undo.length > 40) TOUR.undo.shift(); };
  c.addEventListener('pointerdown', (e) => {
    const p = pt(e); const rooms = TOUR.plan.rooms;
    // 1) нээлхий тавих горим: хамгийн ойрын хана (≤0.25 м)
    if (TOUR.tool) {
      let best = null;
      for (const r of rooms) {
        const cands = [['N', Math.abs(p.y - r.y), p.x - r.x, r.w], ['S', Math.abs(p.y - (r.y + r.h)), p.x - r.x, r.w], ['W', Math.abs(p.x - r.x), p.y - r.y, r.h], ['E', Math.abs(p.x - (r.x + r.w)), p.y - r.y, r.h]];
        for (const [side, dist, along, len] of cands) if (dist <= 0.25 && along >= -0.1 && along <= len + 0.1 && (!best || dist < best.dist)) best = { r, side, dist, along, len };
      }
      if (best) {
        snapshot(); const w = TOUR.tool === 'win' ? 1.4 : 0.9; const off = Math.round(Math.max(0.05, Math.min(best.along - w / 2, best.len - w - 0.05)) * 20) / 20;
        best.r[TOUR.tool] = best.r[TOUR.tool] || []; best.r[TOUR.tool].push(TOUR.tool === 'win' ? { side: best.side, off, w, sill: 0.85, top: 2.2 } : { side: best.side, off, w, to: 'auto' });
        TOUR.sel = best.r.id; renderTour();
      }
      return;
    }
    // 2) сонгосон өрөөний бариул (хэмжээ өөрчлөх)
    const sel = rooms.find((x) => x.id === TOUR.sel);
    if (sel) { const X = (x) => p.ox + x * p.sc, Y = (y) => p.oy + y * p.sc; for (const h of HANDLES) { const [hx, hy] = tourHandlePos(sel, h, X, Y, p.sc); if (Math.abs(p.px - hx) <= 9 && Math.abs(p.py - hy) <= 9) { snapshot(); TOUR.drag = { id: sel.id, mode: 'resize', h, start: { ...sel } }; try { c.setPointerCapture(e.pointerId); } catch {} return; } } }
    // 3) өрөө сонгох / зөөх
    const r = [...rooms].reverse().find((r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
    if (r) { snapshot(); TOUR.drag = { id: r.id, mode: 'move', dx: p.x - r.x, dy: p.y - r.y }; }
    if ((r ? r.id : null) !== TOUR.sel) { TOUR.sel = r ? r.id : null; renderTour(); }
    try { c.setPointerCapture(e.pointerId); } catch {}
  });
  c.addEventListener('pointermove', (e) => {
    if (!TOUR.drag) { // курсор
      const p = pt(e); const sel = TOUR.plan.rooms.find((x) => x.id === TOUR.sel); let cur = TOUR.tool ? 'crosshair' : 'grab';
      if (sel && !TOUR.tool) { const X = (x) => p.ox + x * p.sc, Y = (y) => p.oy + y * p.sc; for (const h of HANDLES) { const [hx, hy] = tourHandlePos(sel, h, X, Y, p.sc); if (Math.abs(p.px - hx) <= 9 && Math.abs(p.py - hy) <= 9) cur = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' }[h]; } }
      c.style.cursor = cur; return;
    }
    const p = pt(e); const r = TOUR.plan.rooms.find((x) => x.id === TOUR.drag.id); if (!r) return; TOUR.guide = [];
    const rd = (v) => Math.round(v * 100) / 100;
    if (TOUR.drag.mode === 'move') {
      const nx = tourSnapVal(p.x - TOUR.drag.dx, 'x', r.id), ny = tourSnapVal(p.y - TOUR.drag.dy, 'y', r.id);
      // баруун/доод ирмэг ч наалдана
      const nx2 = tourSnapVal(p.x - TOUR.drag.dx + r.w, 'x', r.id) - r.w, ny2 = tourSnapVal(p.y - TOUR.drag.dy + r.h, 'y', r.id) - r.h;
      r.x = rd(Math.abs(nx2 - (p.x - TOUR.drag.dx)) < Math.abs(nx - (p.x - TOUR.drag.dx)) ? nx2 : nx); r.y = rd(Math.abs(ny2 - (p.y - TOUR.drag.dy)) < Math.abs(ny - (p.y - TOUR.drag.dy)) ? ny2 : ny);
      TOUR.guide = [{ axis: 'x', v: r.x }, { axis: 'y', v: r.y }];
    } else {
      const s = TOUR.drag.start, h = TOUR.drag.h;
      if (h.includes('e')) { const nx = tourSnapVal(p.x, 'x', r.id); r.w = rd(Math.max(1, nx - s.x)); TOUR.guide.push({ axis: 'x', v: s.x + r.w }); }
      if (h.includes('w')) { const nx = tourSnapVal(p.x, 'x', r.id); const w = Math.max(1, s.x + s.w - nx); r.x = rd(s.x + s.w - w); r.w = rd(w); TOUR.guide.push({ axis: 'x', v: r.x }); }
      if (h.includes('s')) { const ny = tourSnapVal(p.y, 'y', r.id); r.h = rd(Math.max(1, ny - s.y)); TOUR.guide.push({ axis: 'y', v: s.y + r.h }); }
      if (h.includes('n')) { const ny = tourSnapVal(p.y, 'y', r.id); const hh = Math.max(1, s.y + s.h - ny); r.y = rd(s.y + s.h - hh); r.h = rd(hh); TOUR.guide.push({ axis: 'y', v: r.y }); }
    }
    drawTourPlan();
  });
  const end = () => { if (!TOUR.drag) return; TOUR.drag = null; TOUR.guide = null; renderTour(); };
  c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
  c.addEventListener('dblclick', (e) => { const p = pt(e); const r = [...TOUR.plan.rooms].reverse().find((r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h); if (!r) return; const n = prompt('Өрөөний нэр', r.name); if (n) { r.name = n.slice(0, 40); renderTour(); } });
}
// Гарын товч: сумаар зөөх, Delete устгах, Ctrl+Z буцаах, Esc — горим болих
window.addEventListener('keydown', (e) => {
  if (!TOUR || !$('#tour-plan') || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
  const r = TOUR.plan.rooms.find((x) => x.id === TOUR.sel);
  if (e.key === 'Escape') { TOUR.tool = null; renderTour(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); tourUndo(); return; }
  if (!r) return;
  const s = TOUR.snap || 0.1; const rd = (v) => Math.round(v * 100) / 100;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); TOUR.undo.push(JSON.stringify(TOUR.plan.rooms)); TOUR.plan.rooms.splice(TOUR.plan.rooms.indexOf(r), 1); TOUR.sel = null; renderTour(); return; }
  if (e.key === 'ArrowLeft') r.x = rd(r.x - s); else if (e.key === 'ArrowRight') r.x = rd(r.x + s); else if (e.key === 'ArrowUp') r.y = rd(r.y - s); else if (e.key === 'ArrowDown') r.y = rd(r.y + s); else return;
  e.preventDefault(); drawTourPlan();
});
window.tourTool = (t) => { TOUR.tool = TOUR.tool === t ? null : t; renderTour(); };
window.tourUndo = () => { const s = TOUR.undo.pop(); if (!s) return toast('Буцаах зүйл алга'); TOUR.plan.rooms = JSON.parse(s); renderTour(); };
window.tourAddRoomOf = (type) => {
  const rooms = TOUR.plan.rooms; TOUR.undo.push(JSON.stringify(rooms));
  const sel = rooms.find((x) => x.id === TOUR.sel); const size = { living: [4.2, 4.5], kitchen: [3, 2.6], bedroom: [3.2, 3.6], bath: [1.8, 2.2], hall: [1.4, 3], balcony: [2.4, 1.2], office: [2.6, 3], other: [1.6, 2] }[type] || [3, 3];
  const x = sel ? sel.x + sel.w : Math.max(0, ...rooms.map((r) => r.x + r.w)), y = sel ? sel.y : 0;
  const id = type + '_' + Date.now().toString(36).slice(-4); const n = rooms.filter((r) => r.type === type).length + 1;
  rooms.push({ id, type, name: TOUR.types[type] + (n > 1 ? ' ' + n : ''), x, y, w: size[0], h: size[1] }); TOUR.sel = id; renderTour();
};
window.tourRotateSel = () => { const r = TOUR.plan.rooms.find((x) => x.id === TOUR.sel); if (!r) return toast('Эхлээд өрөө сонго'); TOUR.undo.push(JSON.stringify(TOUR.plan.rooms)); [r.w, r.h] = [r.h, r.w]; r.win = []; r.door = []; renderTour(); };
window.tourDupSel = () => { const r = TOUR.plan.rooms.find((x) => x.id === TOUR.sel); if (!r) return toast('Эхлээд өрөө сонго'); TOUR.undo.push(JSON.stringify(TOUR.plan.rooms)); const c = JSON.parse(JSON.stringify(r)); c.id = r.type + '_' + Date.now().toString(36).slice(-4); c.x = r.x + r.w; c.name = r.name + ' (хуулбар)'; TOUR.plan.rooms.push(c); TOUR.sel = c.id; renderTour(); };
window.tourSel = (id) => { if (TOUR.sel === id) return; TOUR.sel = id; renderTour(); };
window.tourEdit = (i, k, v) => { const r = TOUR.plan.rooms[i]; if (k === 'w' || k === 'h') r[k] = Math.max(1, Math.min(20, Math.round(Number(v) * 10) / 10)); else r[k] = v; drawTourPlan(); };
window.tourAddRoom = () => { const plan = TOUR.plan; const maxX = Math.max(...plan.rooms.map((r) => r.x + r.w), 0); plan.rooms.push({ id: 'r' + Date.now().toString(36), type: 'bedroom', name: 'Шинэ өрөө', x: maxX, y: 0, w: 3, h: 3 }); renderTour(); };
window.tourDelRoom = (i) => { TOUR.plan.rooms.splice(i, 1); renderTour(); };
window.tourAuto = async () => { const d = await api('/tour/' + TOUR.pid + '/auto', { method: 'POST' }); if (d.error) return alert(d.error); TOUR.plan = d.tour.plan; toast('Автомат план үүслээ'); renderTour(); };
// ---- Ш3д-2: сонгосон өрөөний бодит хэмжээс (цонх/хаалга/дам нуруу/хана/шал) ----
const SIDE_MN = { N: 'Хойд (дээд)', S: 'Урд (доод)', W: 'Баруун (зүүн тал)', E: 'Зүүн (баруун тал)' };
const FLOOR_MN = { '': '(авто)', parquet: 'Паркет', laminate: 'Ламинат', tile: 'Плита', carpet: 'Хивсэнцэр' };
function tourRoomDetail(t) {
  const r = t.plan.rooms.find((x) => x.id === t.sel); if (!r) return '<div style="margin-top:12px;font-size:12px;color:var(--muted)">Планд эсвэл хүснэгтэд өрөө сонгоход бодит хэмжээсийн маягт гарна (цонх, хаалга, дам нуруу, ханын өнгө, шал).</div>';
  const i = t.plan.rooms.indexOf(r);
  const sideSel = (v, on) => `<select onchange="${on}">${Object.entries(SIDE_MN).map(([k, l]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const numIn = (v, on, step = 0.05, w = 58) => `<input type="number" step="${step}" value="${v}" style="width:${w}px" onchange="${on}">`;
  const wins = (r.win || []).map((w, k) => `<tr><td>${sideSel(w.side, `tourOp(${i},'win',${k},'side',this.value)`)}</td><td>${numIn(w.off, `tourOp(${i},'win',${k},'off',this.value)`)}</td><td>${numIn(w.w, `tourOp(${i},'win',${k},'w',this.value)`)}</td><td>${numIn(w.sill, `tourOp(${i},'win',${k},'sill',this.value)`)}</td><td>${numIn(w.top, `tourOp(${i},'win',${k},'top',this.value)`)}</td><td><button class="small" onclick="tourOpDel(${i},'win',${k})">✕</button></td></tr>`).join('');
  const doors = (r.door || []).map((d, k) => `<tr><td>${sideSel(d.side, `tourOp(${i},'door',${k},'side',this.value)`)}</td><td>${numIn(d.off, `tourOp(${i},'door',${k},'off',this.value)`)}</td><td>${numIn(d.w, `tourOp(${i},'door',${k},'w',this.value)`)}</td><td><select onchange="tourOp(${i},'door',${k},'to',this.value)"><option value="auto" ${d.to !== 'out' ? 'selected' : ''}>хөрш өрөө рүү</option><option value="out" ${d.to === 'out' ? 'selected' : ''}>гадагш (орц/тагт)</option></select></td><td><button class="small" onclick="tourOpDel(${i},'door',${k})">✕</button></td></tr>`).join('');
  const beams = (r.beams || []).map((b, k) => `<tr><td><select onchange="tourOp(${i},'beams',${k},'axis',this.value)"><option value="x" ${b.axis === 'x' ? 'selected' : ''}>зүүн→баруун (off = дээд захаас)</option><option value="y" ${b.axis === 'y' ? 'selected' : ''}>дээш→доош (off = зүүн захаас)</option></select></td><td>${numIn(b.off, `tourOp(${i},'beams',${k},'off',this.value)`)}</td><td>${numIn(b.w, `tourOp(${i},'beams',${k},'w',this.value)`)}</td><td>${numIn(b.h, `tourOp(${i},'beams',${k},'h',this.value)`)}</td><td><button class="small" onclick="tourOpDel(${i},'beams',${k})">✕</button></td></tr>`).join('');
  return `<div class="card" style="margin-top:12px;background:color-mix(in srgb,var(--accent) 6%,var(--surface))"><h3>📐 ${esc(r.name)} — бодит хэмжээс (м)</h3>
    <div style="font-size:11.5px;color:var(--muted);margin-bottom:6px">Хана: хойд = планы дээд тал. «Зайд» = тухайн хананы зүүн (эсвэл дээд) захаас нээлхийн эхлэл хүртэл. Хоосон = автомат.</div>
    <b style="font-size:12.5px">Цонх</b> <button class="small" onclick="tourOpAdd(${i},'win')">+ цонх</button>
    ${wins ? `<div class="tablebox"><table><thead><tr><th>Хана</th><th>Зайд</th><th>Өргөн</th><th>Тавцан</th><th>Дээд</th><th></th></tr></thead><tbody>${wins}</tbody></table></div>` : '<div style="font-size:12px;color:var(--muted)">автомат</div>'}
    <b style="font-size:12.5px">Хаалга</b> <button class="small" onclick="tourOpAdd(${i},'door')">+ хаалга</button>
    ${doors ? `<div class="tablebox"><table><thead><tr><th>Хана</th><th>Зайд</th><th>Өргөн</th><th>Хаашаа</th><th></th></tr></thead><tbody>${doors}</tbody></table></div>` : '<div style="font-size:12px;color:var(--muted)">автомат (коридороос)</div>'}
    <b style="font-size:12.5px">Дам нуруу</b> <button class="small" onclick="tourOpAdd(${i},'beams')">+ дам нуруу</button>
    ${beams ? `<div class="tablebox"><table><thead><tr><th>Чиглэл</th><th>Зайд</th><th>Өргөн</th><th>Өндөр</th><th></th></tr></thead><tbody>${beams}</tbody></table></div>` : ''}
    <div style="display:flex;gap:12px;align-items:center;margin-top:8px;font-size:12.5px;flex-wrap:wrap">
      <label>Ханын өнгө <input type="color" value="${r.wallColor || '#e3d9cb'}" onchange="tourEdit(${i},'wallColor',this.value)"> <button class="small" onclick="tourEdit(${i},'wallColor',null)">авто</button></label>
      <label>Шал <select onchange="tourEdit(${i},'floor',this.value||null)">${Object.entries(FLOOR_MN).map(([k, l]) => `<option value="${k}" ${(r.floor || '') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <div style="font-size:11.5px;color:var(--muted);margin-top:6px">Өөрчлөлт «💾 Хадгалах + 3D шинэчлэх» дармагц 3D-д орно.</div></div>`;
}
window.tourOpAdd = (i, kind) => { const r = TOUR.plan.rooms[i]; r[kind] = r[kind] || []; r[kind].push(kind === 'win' ? { side: 'N', off: 0.5, w: 1.4, sill: 0.85, top: 2.2 } : kind === 'door' ? { side: 'S', off: 0.5, w: 0.9, to: 'auto' } : { axis: 'x', off: Math.round(r.h / 2 * 10) / 10, w: 0.3, h: 0.25 }); renderTour(); };
window.tourOp = (i, kind, k, key, v) => { const o = TOUR.plan.rooms[i][kind][k]; o[key] = (key === 'side' || key === 'to' || key === 'axis') ? v : Number(v); drawTourPlan(); };
window.tourOpDel = (i, kind, k) => { TOUR.plan.rooms[i][kind].splice(k, 1); renderTour(); };
// Бичлэг → 12 кадр (браузер дээр) → /api/tour/:pid/frames
window.tourVideo = async (input) => {
  const f = input.files && input.files[0]; if (!f) return;
  const room = $('#tour-vid-room').value; const st = $('#tour-vid-st'); st.textContent = 'кадр гаргаж байна…';
  try {
    const url = URL.createObjectURL(f); const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.src = url;
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('бичлэг нээгдсэнгүй')); });
    const N = 12, dur = v.duration; const c = document.createElement('canvas'); const scale = Math.min(1, 1280 / v.videoWidth); c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
    const fd = new FormData(); fd.append('room', room); fd.append('replace', '1');
    for (let i = 0; i < N; i++) {
      v.currentTime = Math.min(dur - 0.1, (i + 0.5) * dur / N);
      await new Promise((res) => { v.onseeked = res; });
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.82));
      fd.append('frames', blob, `frame_${i + 1}.jpg`); st.textContent = `кадр ${i + 1}/${N}…`;
    }
    URL.revokeObjectURL(url);
    st.textContent = 'илгээж байна…';
    const res = await fetch('/api/tour/' + TOUR.pid + '/frames', { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN }, body: fd });
    const d = await res.json(); if (d.error) throw new Error(d.error);
    toast(`${d.added} кадр орлоо (нийт ${d.frames}) — одоо «🔍 AI зургаас шинжлэх»`); tourView(TOUR.pid);
  } catch (e) { st.textContent = 'алдаа: ' + e.message; }
};
window.tourFramesClear = async () => { await api('/tour/' + TOUR.pid + '/frames', { method: 'DELETE' }); tourView(TOUR.pid); };
window.tourAnalyze = async () => {
  toast('AI зургуудыг шинжилж байна (30–90 сек)…');
  const d = await api('/tour/' + TOUR.pid + '/analyze', { method: 'POST' });
  if (d.error) return alert(d.error);
  TOUR.plan = d.tour.plan; toast('Шинжилгээ дууслаа — 3D шинэчлэгдэв'); renderTour();
};
window.tourPanoUpload = async (roomId, input) => {
  const f = input.files && input.files[0]; if (!f) return;
  const fd = new FormData(); fd.append('room', roomId); fd.append('pano', f);
  toast('Панорам илгээж байна…');
  const res = await fetch('/api/tour/' + TOUR.pid + '/pano', { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN }, body: fd });
  const d = await res.json(); if (d.error) return alert(d.error);
  TOUR.assets = d.assets; toast('360° панорам орлоо'); renderTour();
};
window.tourPanoDel = async (id) => {
  const d = await api('/tour/' + TOUR.pid + '/pano/' + id, { method: 'DELETE' }); if (d.error) return alert(d.error);
  TOUR.assets = d.assets; renderTour();
};
window.tourSave = async () => {
  const d = await api('/tour/' + TOUR.pid, { method: 'PUT', body: { plan: TOUR.plan } });
  if (d.error) return alert(d.error);
  TOUR.plan = d.tour.plan; toast('Хадгалагдлаа — 3D шинэчлэгдэж байна'); renderTour();
};

// ---------- Ш3а: Листингийн AI студи ----------
window.studioView = async function (pid) {
  if (POLL) { clearInterval(POLL); POLL = null; }
  document.querySelectorAll('#menu button').forEach((x) => x.classList.remove('active'));
  const d = await api('/studio/' + pid);
  if (d.error) { alert(d.error); return; }
  renderStudio(d);
};
function renderStudio(d) {
  const p = d.property, dr = d.draft || {};
  const texts = dr.texts || {}, adv = dr.advantages || [], price = dr.price || null, plan = dr.plan || [], notes = dr.photo_notes || [];
  const img = (a) => `/api/studio/asset/${a.id}?token=${encodeURIComponent(TOKEN)}`;
  $('#main').innerHTML = `
  <div class="page-head"><h2>🎨 Студи · ${esc(p.district)} ${esc(p.khoroolol || '')} · ${p.rooms}ө ${p.area}м² · ${fmt(p.price)} сая ₮</h2>
    <div style="display:flex;gap:8px"><button onclick="properties()">← Объектууд</button></div></div>
  ${!d.ai ? '<div class="demo-note" style="margin-bottom:12px">⚠️ ANTHROPIC_API_KEY тохируулаагүй — зургийн шинжилгээ, зарын текст загвар горимоор (AI-гүй) ажиллана. Түлхүүр тавимагц бодит AI.</div>' : ''}
  <div class="card"><h3>1 · Зураг оруулах (${d.assets.length}; зорилт 22–27)</h3>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <input type="file" id="st-files" accept="image/jpeg,image/png,image/webp" multiple style="width:auto">
      <button class="primary" onclick="studioUpload(${p.id})">⬆ Оруулах</button>
      <button class="primary" onclick="studioAnalyze(${p.id})" ${d.assets.length ? '' : 'disabled'}>🤖 AI шинжилгээ хийх</button>
      <span id="st-status" style="color:var(--muted);font-size:13px"></span></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-top:14px">
      ${d.assets.map((a) => `<div style="border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--surface)">
        <div style="position:relative"><img src="${img(a)}" style="width:100%;height:110px;object-fit:cover;display:block" loading="lazy">
          ${a.rank ? `<span class="badge ${a.rank === 1 ? 'ok' : 'mut'}" style="position:absolute;top:6px;left:6px">${a.rank === 1 ? '★ 1' : '#' + a.rank}</span>` : ''}</div>
        <div style="padding:6px 8px;font-size:12px">
          <div><b>${esc(a.room || '—')}</b> ${a.quality != null ? `· чанар ${a.quality} · wow ${a.wow}` : ''}</div>
          ${a.issues ? `<div style="color:var(--accent-2)">${esc(a.issues)}</div>` : ''}
          <button class="small" style="margin-top:4px" onclick="studioDel(${a.id},${p.id})">Устгах</button></div></div>`).join('') || '<span style="color:var(--muted)">Зураг байхгүй — утсаараа авсан зургуудаа оруулна уу</span>'}
    </div></div>
  ${dr.id ? `
  <div class="card"><h3>2 · Зургийн зөвлөмж</h3>${notes.length ? '<ul style="margin:0;padding-left:20px">' + notes.map((n) => `<li>${esc(n)}</li>`).join('') + '</ul>' : '<span style="color:var(--muted)">Зөвлөмжгүй — зургууд сайн байна</span>'}</div>
  <div class="card"><h3>3 · Зарын текст <span class="badge mut">${esc(dr.model || '')}</span></h3>
    <div style="display:flex;gap:6px;margin-bottom:8px">${['unegui', 'facebook', 'site'].map((k, i) => `<button class="small ${i === 0 ? 'primary' : ''}" data-t="${k}" onclick="studioTab(this)">${{ unegui: 'Unegui', facebook: 'Facebook', site: 'Сайт/PDF' }[k]}</button>`).join('')}
      <button class="small" onclick="navigator.clipboard.writeText(document.getElementById('st-text').value);this.textContent='✓ Хуулав'">📋 Хуулах</button></div>
    <textarea id="st-text" rows="9" style="width:100%">${esc(texts.unegui || '')}</textarea>
    <script type="application/json" id="st-texts">${JSON.stringify(texts).replace(/</g, '\\u003c')}</script></div>
  <div class="card"><h3>4 · Давуу тал (орчны шинжилгээ А8 + баримт)</h3><ul style="margin:0;padding-left:20px">${adv.map((a) => `<li>${esc(a)}</li>`).join('') || '<li style="color:var(--muted)">—</li>'}</ul></div>
  ${price ? `<div class="card"><h3>5 · Үнийн стратеги (А3) — одоогийн үнэ ${fmt(price.current)} сая ${price.position != null ? `(үнэлгээнээс ${price.position > 0 ? '+' : ''}${price.position}%)` : ''} · итгэлцэл ${price.confidence}%</h3>
    <div class="tiles">${price.options.map((o) => `<div class="tile"><div class="v">${fmt(o.price)}<small style="font-size:12px"> сая</small></div><div class="k"><b>${o.label}</b> · ${o.days}<br>${esc(o.note)}</div></div>`).join('')}</div></div>` : ''}
  <div class="card"><h3>6 · 30 хоногийн борлуулалтын төлөвлөгөө</h3>
    <div class="tablebox"><table><thead><tr><th class="num">Өдөр</th><th>Ажил</th></tr></thead><tbody>${plan.map((s) => `<tr><td class="num">${s.day}</td><td>${esc(s.task)}</td></tr>`).join('')}</tbody></table></div></div>`
  : '<div class="card" style="color:var(--muted)">Зургуудаа оруулаад «🤖 AI шинжилгээ хийх» дарахад: зургийн эрэмбэ/чанар, зарын текст ×3, давуу тал, үнийн стратеги, 30 хоногийн төлөвлөгөө үүснэ.</div>'}`;
}
window.studioTab = function (btn) {
  document.querySelectorAll('[data-t]').forEach((b) => b.classList.remove('primary')); btn.classList.add('primary');
  const t = JSON.parse(document.getElementById('st-texts').textContent || '{}');
  document.getElementById('st-text').value = t[btn.dataset.t] || '';
};
window.studioUpload = async function (pid) {
  const files = document.getElementById('st-files').files;
  if (!files.length) { alert('Зураг сонгоно уу'); return; }
  const fd = new FormData(); for (const f of files) fd.append('photos', f);
  $('#st-status').textContent = 'Оруулж байна…';
  const r = await fetch('/api/studio/' + pid + '/photos', { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN }, body: fd }).then((x) => x.json());
  if (r.error) { alert(r.error); return; }
  studioView(pid);
};
window.studioDel = async function (id, pid) { await api('/studio/asset/' + id, { method: 'DELETE' }); studioView(pid); };
window.studioAnalyze = async function (pid) {
  $('#st-status').textContent = '🤖 Шинжилж байна (30–60 сек)…';
  const r = await api('/studio/' + pid + '/analyze', { method: 'POST' });
  if (r.error) { alert(r.error); $('#st-status').textContent = ''; return; }
  renderStudio(r);
};

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
    <span class="demo-note" id="col-mode">…</span></div>
  <div id="col-body">Ачааллаж байна…</div>`;
  async function render() {
    const s = await api('/collector/status');
    const li = s.liveInfo || {};
    $('#col-mode').textContent = s.live
      ? `Шат 2 БОДИТ — unegui.mn ажиглах горим · ${Math.round((li.intervalSec || 600) / 60)} мин тутам · хүсэлт ${li.adapter ? li.adapter.requests : 0} / ${li.adapter ? (li.adapter.bytes / 1048576).toFixed(1) : 0} MB`
      : 'Шат 2 демо — симуляц эх сурвалж (жинхэнэ сайт руу хандахгүй)';
    const liveLine = s.live ? `<div style="background:color-mix(in srgb,var(--accent) 10%,var(--surface));border-radius:6px;padding:8px 12px;margin-bottom:10px;font-size:12.5px">
      📡 <b>Бодит мониторинг</b> — мөчлөг: <b>${li.cycles || 0}</b> · сүүлийнх: <b>${li.lastCycleAt ? Math.round((Date.now() - li.lastCycleAt) / 60000) + ' мин өмнө' : '—'}</b> · дараагийн мөчлөг: <b>${li.nextCycleIn != null ? (li.nextCycleIn > 0 ? Math.floor(li.nextCycleIn / 60) + ':' + String(li.nextCycleIn % 60).padStart(2, '0') : 'одоо') : '—'}</b> (ботууд мөчлөг хооронд сул зогсдог — хэвийн) ·
      дахин харагдсан: <b>${li.updated || 0}</b> · үнэ өөрчлөгдсөн: <b>${li.priceChanges || 0}</b> · дэлгэрэнгүй татсан: <b>${li.detailFetched || 0}</b> ·
      сайтаас хасагдсан: <b>${li.delisted || 0}</b> · алдаа: <b>${li.errors || 0}</b>${li.adapter && li.adapter.cooldownUntil && li.adapter.cooldownUntil > Date.now() ? ' · <span class="badge warn">хөргөлт (429/5xx)</span>' : ''}
      ${li.byCat ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">${Object.values(li.byCat).map((c) => `<span class="badge mut" title="${Math.round((Date.now() - c.at) / 60000)} мин өмнө">${esc(c.label)}: ${c.adverts}</span>`).join('')}</div>` : ''}
    </div>` : '';
    const wcard = s.workers.map((w) => {
      const busy = w.status !== 'сул';
      return `<div style="border:1px solid var(--line);border-radius:6px;padding:7px 9px;background:${busy ? 'color-mix(in srgb,var(--accent) 12%,var(--surface))' : 'var(--surface)'}">
        <div style="font-size:11px;color:var(--muted)">Бот ${w.id}</div>
        <div style="font-weight:600;font-size:12.5px">${busy ? '⚙️ ' + w.status : '💤 сул'}</div>
        <div style="font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(w.source || '—')}</div></div>`;
    }).join('');
    const rej = Object.entries(s.rejectReasons).sort((a, b) => b[1] - a[1]);
    // Урсгал: хэрэглэгч уншиж байхад (хулгана дээр нь эсвэл гүйлгэсэн эсвэл ⏸) жагсаалтыг СОЛИХГҮЙ — дээш үсрэхгүй
    const oldBox = $('#col-events'); const reading = oldBox && (COL_PAUSED || oldBox.matches(':hover') || oldBox.scrollTop > 4);
    const keepHtml = reading ? oldBox.innerHTML : null, keepTop = oldBox ? oldBox.scrollTop : 0;
    const ev = s.events.map((e) => {
      const ago = Math.max(0, Math.round((Date.now() - e.t) / 1000));
      const link = e.url ? ` <a href="${esc(e.url)}" target="_blank" rel="noopener" style="font-size:11px" onclick="event.stopPropagation()">↗ эх</a>` : '';
      const open = e.lid ? ` style="padding:5px 0;border-bottom:1px solid var(--line);font-size:13px;cursor:pointer" onclick="marketDetail(${e.lid})" title="Бүрэн мэдээлэл, судалгаа"` : ' style="padding:5px 0;border-bottom:1px solid var(--line);font-size:13px"';
      if (e.kind === 'collected') return `<div${open}>
        <span class="badge ok">✓ ${e.score}</span> <b>${esc(e.title)}</b> — ${fmt(e.price)} сая ₮${e.deal === 'rent' ? '/сар' : ''}${link}
        <span style="color:var(--muted)">· ${esc(e.source)} · ${ago}с</span>
        ${(e.flags || []).map((f) => `<span class="badge warn">${esc(f)}</span>`).join('')}${e.lid ? ' <span style="color:var(--accent);font-size:12px">→</span>' : ''}</div>`;
      if (e.kind === 'price') return `<div${open}>
        <span class="badge ${e.price < e.prev ? 'ok' : 'warn'}">${e.price < e.prev ? '▼' : '▲'} үнэ</span> <b>${esc(e.title)}</b> — ${fmt(e.prev)} → <b>${fmt(e.price)}</b> сая ₮${link}
        <span style="color:var(--muted)">· ${ago}с</span>${e.lid ? ' <span style="color:var(--accent);font-size:12px">→</span>' : ''}</div>`;
      if (e.kind === 'delisted') return `<div style="padding:5px 0;border-bottom:1px solid var(--line);font-size:13px">
        <span class="badge mut">✔ хасагдсан</span> ${esc(e.title || '')} <span style="color:var(--muted)">— ${esc(e.reason)} · ${ago}с</span></div>`;
      if (e.kind === 'error') return `<div style="padding:5px 0;border-bottom:1px solid var(--line);font-size:13px;color:var(--accent-2)">
        ⚠ ${esc(e.reason || '')} <span style="color:var(--muted)">· ${esc(e.source || '')} · ${ago}с</span></div>`;
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
    ${liveLine}
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
    <div class="card"><h3 style="display:flex;align-items:center;gap:10px">Амьд урсгал (сүүлийн үйл явдлууд)
      <button class="small ${COL_PAUSED ? 'primary' : ''}" onclick="colPause()">${COL_PAUSED ? '▶ Үргэлжлүүлэх' : '⏸ Түр зогсоох'}</button>
      <span style="font-size:11.5px;color:var(--muted);font-weight:400">${reading ? 'уншиж байна — шинэчлэлт түр зогссон' : 'мөр дээр дарж бүрэн мэдээлэл'}</span></h3>
      <div id="col-events" style="max-height:420px;overflow:auto">${keepHtml != null ? keepHtml : ev}</div></div>`;
    if (keepTop) $('#col-events').scrollTop = keepTop;
  }
  await render();
  POLL = setInterval(() => render().catch(() => {}), 1200);
}
let COL_PAUSED = false;
window.colPause = () => { COL_PAUSED = !COL_PAUSED; const b = $('#col-events'); if (b && !COL_PAUSED) b.scrollTop = 0; };
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
