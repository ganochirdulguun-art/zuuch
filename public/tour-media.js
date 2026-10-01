// «Зууч» — POV аяллын бодит медиа үзэгч: (1) алхалтын бичлэг (360° бол бөмбөрцөг дотор чиглэлээ эргүүлж харна, энгийн бол дэлгэц дүүрэн) + минимап дээр байрлал,
// (2) өрөөний бодит 3D (Gaussian splat, GaussianSplats3D — хэрэгтэй үед л ачаална). Дэлгэцийн удирдлага (UI) энэ модуль өөрөө үүсгэнэ.
import * as THREE from 'three';

export function createMedia({ data, renderer, onWalkEnd }) {
  const media = data.media || []; const ext = data.exterior || null;
  const bySeq = (a, b) => (a.seq || 0) - (b.seq || 0) || a.id - b.id;
  const walks = [...media.filter((m) => m.kind === 'walk_ext').sort(bySeq), ...media.filter((m) => m.kind === 'walk_in').sort(bySeq)];
  const splatByRoom = {}; for (const m of media) if (m.kind === 'splat' && m.room_id) splatByRoom[m.room_id] = m;
  const panos = media.filter((m) => m.kind === 'pano');
  let mode = null; // 'walk' | 'splat' | null

  // ---- Дэлгэцийн элементүүд ----
  const css = document.createElement('style');
  css.textContent = `#mVideo{position:fixed;inset:0;width:100%;height:100%;object-fit:contain;background:#000;z-index:1;display:none}
  #mUi{position:fixed;left:50%;transform:translateX(-50%);bottom:max(14px,env(safe-area-inset-bottom));z-index:30;display:none;min-width:min(560px,calc(100vw - 32px));max-width:calc(100vw - 32px);background:rgba(12,18,32,.82);backdrop-filter:blur(8px);color:#F1F5FC;border-radius:14px;padding:10px 12px;font:13px Inter,system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35)}
  #mUi .r{display:flex;gap:8px;align-items:center}#mUi b{font-weight:600}#mUi .sp{flex:1}
  #mUi button{background:#243051;color:#F1F5FC;border:1px solid #3A4A70;border-radius:9px;padding:6px 10px;font:inherit;cursor:pointer}
  #mUi .pb{height:6px;background:#2C3A5E;border-radius:3px;margin-top:8px;cursor:pointer;position:relative}#mUi .pb>div{height:100%;width:0;background:#5AB0FF;border-radius:3px}
  #mUi .sub{color:#AEBAD3;font-size:12px;margin-top:2px}`;
  document.head.appendChild(css);
  const vEl = document.createElement('video'); vEl.id = 'mVideo'; vEl.playsInline = true; vEl.muted = true; vEl.preload = 'auto'; vEl.setAttribute('playsinline', ''); vEl.crossOrigin = 'anonymous'; document.body.appendChild(vEl);
  const ui = document.createElement('div'); ui.id = 'mUi';
  ui.innerHTML = `<div class="r"><div><b id="mTitle"></b><div class="sub" id="mSub"></div></div><span class="sp"></span><button id="mPlay" title="Зогсоох/үргэлжлүүлэх">⏸</button><button id="mNext" title="Дараагийн хэсэг">⏭</button><button id="mExit" title="Гарах">✕</button></div><div class="pb" id="mPb"><div id="mBar"></div></div>`;
  document.body.appendChild(ui);
  const $ = (s) => ui.querySelector(s);
  const label = (t, sub = '') => { $('#mTitle').textContent = t; $('#mSub').textContent = sub; };

  // ---- 360° бөмбөрцөг (бичлэг) ----
  const wScene = new THREE.Scene(); const wCam = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
  const sphGeo = new THREE.SphereGeometry(30, 64, 32); sphGeo.scale(-1, 1, 1); // дотроос зөв (толин тусгалгүй) харагдана
  const sph = new THREE.Mesh(sphGeo, new THREE.MeshBasicMaterial({ color: 0xffffff })); sph.rotation.y = -Math.PI / 2; wScene.add(sph); // зургийн төв = урд (−Z)
  const look = { yaw: 0, pitch: 0, idle: 0 };
  let vTex = null, W = { i: 0, onDone: null, m: null, eq: false };

  function playSeg(i) {
    const m = walks[i]; if (!m) return finishWalk();
    W.i = i; W.m = m; W.eq = m.projection === 'equirect';
    vEl.src = m.url; vEl.currentTime = 0; look.yaw = 0; look.pitch = 0;
    if (W.eq) { if (!vTex) { vTex = new THREE.VideoTexture(vEl); vTex.colorSpace = THREE.SRGBColorSpace; vTex.minFilter = THREE.LinearFilter; vTex.generateMipmaps = false; } sph.material.map = vTex; sph.material.needsUpdate = true; vEl.style.display = 'none'; }
    else vEl.style.display = 'block';
    label(m.label || (m.kind === 'walk_ext' ? 'Төв замаас орц хүртэл' : 'Орц, шат'), `${W.eq ? '360° — чирж эргэн тойрноо харна' : 'Бичлэг'} · ${i + 1}/${walks.length}`);
    $('#mNext').textContent = i < walks.length - 1 ? '⏭' : '⏭ Дотогш'; $('#mPlay').textContent = '⏸';
    vEl.play().catch(() => { $('#mPlay').textContent = '▶'; });
  }
  vEl.addEventListener('ended', () => { if (mode === 'walk') playSeg(W.i + 1); });
  function startWalk(onDone) { if (!walks.length) return false; mode = 'walk'; W.onDone = onDone || onWalkEnd; ui.style.display = 'block'; playSeg(0); return true; }
  function finishWalk() { const cb = W.onDone; stopWalk(); if (cb) cb(); }
  function stopWalk() { if (mode !== 'walk') return; mode = null; vEl.pause(); vEl.removeAttribute('src'); vEl.load(); vEl.style.display = 'none'; ui.style.display = 'none'; }

  // ---- Бодит 3D (splat) ----
  let GS = null; const S = { scene: null, viewer: null, id: null, cam: new THREE.PerspectiveCamera(70, 1, 0.02, 200), yaw: 0, pitch: 0, pos: new THREE.Vector3(), t: 0, auto: false, onExit: null, ready: false };
  async function enterSplat(roomId, { auto = false, onExit = null, name = '' } = {}) {
    const m = splatByRoom[roomId]; if (!m) return false;
    mode = 'splat'; S.auto = auto; S.onExit = onExit; S.t = 0; S.yaw = 0; S.pitch = 0; S.pos.set(0, 0, 0); S.ready = false;
    ui.style.display = 'block'; $('#mPlay').style.display = 'none'; $('#mNext').style.display = 'none'; $('#mBar').style.width = '0';
    label(name || 'Бодит 3D', 'Ачаалж байна…');
    try {
      if (!GS) GS = await import('gaussian-splats-3d');
      if (S.id !== m.id) {
        if (S.viewer) { try { await S.viewer.dispose(); } catch { /* */ } }
        S.scene = new THREE.Scene(); S.scene.background = new THREE.Color('#1d2027');
        S.viewer = new GS.DropInViewer({ sharedMemoryForWorkers: false, dynamicScene: false, sphericalHarmonicsDegree: 0, gpuAcceleratedSort: false, integerBasedSort: true, sceneRevealMode: GS.SceneRevealMode.Instant, logLevel: GS.LogLevel.None }); // шууд харуулна (аажмаар тодруулах анимацигүй)
        const rot = (m.meta && m.meta.rot) || [0, 0, 0]; const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot.map((d) => (d * Math.PI) / 180), 'XYZ'));
        const c = new THREE.Vector3(...((m.meta && m.meta.center) || [0, 0, 0])).applyQuaternion(q).multiplyScalar(-1);
        const fmt = { splat: GS.SceneFormat.Splat, spz: GS.SceneFormat.Spz, ksplat: GS.SceneFormat.KSplat, ply: GS.SceneFormat.Ply }[(m.meta && m.meta.format) || 'splat'];
        await S.viewer.addSplatScene(m.url, { format: fmt ?? GS.SceneFormat.Splat, position: c.toArray(), rotation: q.toArray(), showLoadingUI: false, progressiveLoad: false, splatAlphaRemovalThreshold: 5,
          onProgress: (p) => { if (mode === 'splat') { $('#mSub').textContent = `Ачаалж байна… ${Math.round(p)}%`; $('#mBar').style.width = Math.round(p) + '%'; } } });
        S.scene.add(S.viewer); S.id = m.id;
      }
      S.ready = true; S.needSort = 3; $('#mBar').style.width = '100%'; // анхны эрэмбэлэлтийг хүчээр (камер анхны чиглэлтэй бол сан өөрөө эхлүүлдэггүй)
      label(name || 'Бодит 3D', `${m.meta && m.meta.count ? Math.round(m.meta.count / 1000) + 'k цэг · ' : ''}чирж харна · гүйлгэж/чимхэж ойртоно`);
    } catch (e) { console.error('splat', e); label('Бодит 3D нээгдсэнгүй', String(e.message || e).slice(0, 80)); setTimeout(() => { if (mode === 'splat') exitSplat(); }, 2500); }
    return true;
  }
  function exitSplat() { if (mode !== 'splat') return; mode = null; ui.style.display = 'none'; $('#mPlay').style.display = ''; $('#mNext').style.display = ''; const cb = S.onExit; S.onExit = null; if (cb) cb(); }

  // ---- Удирдлага ----
  $('#mPlay').onclick = () => { if (mode !== 'walk') return; if (vEl.paused) { vEl.play(); $('#mPlay').textContent = '⏸'; } else { vEl.pause(); $('#mPlay').textContent = '▶'; } };
  $('#mNext').onclick = () => { if (mode === 'walk') { if (W.i < walks.length - 1) playSeg(W.i + 1); else finishWalk(); } };
  $('#mExit').onclick = () => { if (mode === 'walk') finishWalk(); else if (mode === 'splat') exitSplat(); };
  $('#mPb').onclick = (e) => { if (mode !== 'walk' || !vEl.duration) return; const r = e.currentTarget.getBoundingClientRect(); vEl.currentTime = ((e.clientX - r.left) / r.width) * vEl.duration; };
  renderer.domElement.addEventListener('wheel', (e) => { if (mode !== 'splat') return; e.preventDefault(); move(-Math.sign(e.deltaY) * 0.25); }, { passive: false });
  let pinch = null; const tp = new Map();
  renderer.domElement.addEventListener('pointerdown', (e) => { tp.set(e.pointerId, [e.clientX, e.clientY]); if (tp.size === 2) { const [a, b] = [...tp.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); } });
  renderer.domElement.addEventListener('pointermove', (e) => { if (!tp.has(e.pointerId)) return; tp.set(e.pointerId, [e.clientX, e.clientY]); if (mode === 'splat' && tp.size === 2 && pinch) { const [a, b] = [...tp.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); move((d - pinch) * 0.01); pinch = d; } });
  const up = (e) => { tp.delete(e.pointerId); if (tp.size < 2) pinch = null; }; renderer.domElement.addEventListener('pointerup', up); renderer.domElement.addEventListener('pointercancel', up);
  function move(d) { const f = new THREE.Vector3(-Math.sin(S.yaw) * Math.cos(S.pitch), Math.sin(S.pitch), -Math.cos(S.yaw) * Math.cos(S.pitch)); S.pos.addScaledVector(f, d); S.pos.clampLength(0, 6); S.auto = false; }
  function drag(dx, dy) {
    if (mode === 'walk') { look.yaw += dx * 0.005; look.pitch = Math.max(-1.3, Math.min(1.3, look.pitch + dy * 0.005)); look.idle = 0; }
    else if (mode === 'splat') { S.yaw += dx * 0.005; S.pitch = Math.max(-1.2, Math.min(1.2, S.pitch + dy * 0.005)); S.auto = false; }
  }

  // ---- Минимап: GPS зам (эсвэл системийн маршрут) + одоогийн байрлал ----
  function walkPath() {
    const m = W.m; if (!m) return null;
    const o = ext && ext.origin ? ext.origin : m.track && m.track.length ? { lat: m.track[0][1], lng: m.track[0][2] } : null; if (!o) return null;
    const kx = Math.cos((o.lat * Math.PI) / 180) * 111320, kz = 110540;
    if (m.track && m.track.length >= 2) return { pts: m.track.map((p) => [(p[2] - o.lng) * kx, (o.lat - p[1]) * kz, p[0]]), timed: true };
    if (m.kind === 'walk_ext' && ext && ext.mainRoad && ext.mainRoad.route && ext.mainRoad.route.length >= 4) { const r = ext.mainRoad.route; const pts = []; for (let i = r.length - 2; i >= 0; i -= 2) pts.push([r[i], r[i + 1]]); return { pts, timed: false }; }
    return null;
  }
  function drawMap(g, Wd, Hd) {
    g.clearRect(0, 0, Wd, Hd); g.fillStyle = 'rgba(12,18,32,.78)'; g.fillRect(0, 0, Wd, Hd);
    const P = mode === 'walk' ? walkPath() : null;
    if (!P) { g.fillStyle = '#AEBAD3'; g.font = '600 14px Inter,sans-serif'; g.textAlign = 'center'; g.fillText(mode === 'splat' ? 'Бодит 3D өрөө' : 'Орц, шат', Wd / 2, Hd / 2); g.textAlign = 'left'; return; }
    const xs = P.pts.map((p) => p[0]), zs = P.pts.map((p) => p[1]); const x0 = Math.min(...xs) - 30, x1 = Math.max(...xs) + 30, z0 = Math.min(...zs) - 30, z1 = Math.max(...zs) + 30;
    const sc = Math.min(Wd / (x1 - x0), Hd / (z1 - z0)); const X = (x) => (x - (x0 + x1) / 2) * sc + Wd / 2, Y = (z) => (z - (z0 + z1) / 2) * sc + Hd / 2;
    if (ext && ext.buildings) { g.fillStyle = 'rgba(174,186,211,.28)'; for (const b of ext.buildings) { const p = b.p; if (!p || p.length < 6) continue; if (p[0] < x0 - 60 || p[0] > x1 + 60 || p[1] < z0 - 60 || p[1] > z1 + 60) continue; g.beginPath(); for (let i = 0; i < p.length; i += 2) (i ? g.lineTo : g.moveTo).call(g, X(p[i]), Y(p[i + 1])); g.closePath(); g.fill(); } }
    g.strokeStyle = '#5AB0FF'; g.lineWidth = 3; g.beginPath(); P.pts.forEach((p, i) => (i ? g.lineTo : g.moveTo).call(g, X(p[0]), Y(p[1]))); g.stroke();
    // одоогийн байрлал: GPS хугацаагаар, эсвэл бичлэгийн хувиар маршрутын уртын дагуу
    const t = vEl.currentTime || 0, dur = vEl.duration || (W.m && W.m.duration) || 1; let cx, cz;
    if (P.timed) { const a = P.pts; let k = a.findIndex((p) => p[2] > t); if (k <= 0) k = k === 0 ? 1 : a.length - 1; const p0 = a[k - 1], p1 = a[k]; const f = Math.max(0, Math.min(1, (t - p0[2]) / ((p1[2] - p0[2]) || 1))); cx = p0[0] + (p1[0] - p0[0]) * f; cz = p0[1] + (p1[1] - p0[1]) * f; }
    else { const a = P.pts; const L = [0]; for (let i = 1; i < a.length; i++) L.push(L[i - 1] + Math.hypot(a[i][0] - a[i - 1][0], a[i][1] - a[i - 1][1])); const tgt = (t / dur) * L[L.length - 1]; let k = L.findIndex((l) => l >= tgt); if (k <= 0) k = 1; const f = (tgt - L[k - 1]) / ((L[k] - L[k - 1]) || 1); cx = a[k - 1][0] + (a[k][0] - a[k - 1][0]) * f; cz = a[k - 1][1] + (a[k][1] - a[k - 1][1]) * f; }
    g.fillStyle = '#ef4444'; g.beginPath(); g.arc(X(0), Y(0), 5, 0, 7); g.fill(); // байр (гадаах орчны эх цэг)
    g.fillStyle = '#5AB0FF'; g.beginPath(); g.arc(X(cx), Y(cz), 7, 0, 7); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke();
    g.fillStyle = '#AEBAD3'; g.font = '12px Inter,sans-serif'; g.fillText(P.timed ? 'GPS зам' : 'Маршрут (ойролцоо)', 8, Hd - 8);
  }

  // ---- Рендер ----
  function render(dt) {
    const tm = renderer.toneMapping, sh = renderer.shadowMap.enabled; renderer.toneMapping = THREE.NoToneMapping; renderer.shadowMap.enabled = false;
    const asp = renderer.domElement.width / renderer.domElement.height;
    if (mode === 'walk') {
      if (vEl.duration) $('#mBar').style.width = ((vEl.currentTime / vEl.duration) * 100).toFixed(1) + '%';
      if (W.eq) {
        look.idle += dt; if (look.idle > 4 && !vEl.paused) { look.yaw += (0 - Math.atan2(Math.sin(look.yaw), Math.cos(look.yaw))) * Math.min(1, dt * 0.6); look.pitch += (0 - look.pitch) * Math.min(1, dt * 0.6); } // гараар эргүүлээгүй бол урагш эргэж буцна
        wCam.aspect = asp; wCam.fov = asp < 1 ? 90 : 75; wCam.updateProjectionMatrix(); wCam.rotation.set(look.pitch, look.yaw, 0, 'YXZ'); renderer.render(wScene, wCam);
      } else { renderer.setClearColor(0x000000, 1); renderer.clear(); }
    } else if (mode === 'splat' && S.scene) {
      if (S.auto && S.ready) { S.t += dt; S.yaw += dt * (2 * Math.PI / 20); if (S.t > 20) exitSplat(); } // автомат: 20 с-д бүтэн эргэнэ
      S.cam.aspect = asp; S.cam.fov = asp < 1 ? 85 : 70; S.cam.updateProjectionMatrix(); S.cam.position.copy(S.pos); S.cam.rotation.set(S.pitch, S.yaw, 0, 'YXZ');
      renderer.render(S.scene, S.cam);
      if (S.needSort && S.viewer && S.viewer.viewer && S.viewer.viewer.camera) { S.needSort--; S.viewer.viewer.runSplatSort(true, true).catch(() => {}); }
    }
    renderer.toneMapping = tm; renderer.shadowMap.enabled = sh;
  }

  function stopAll() { stopWalk(); if (mode === 'splat') { mode = null; ui.style.display = 'none'; $('#mPlay').style.display = ''; $('#mNext').style.display = ''; S.onExit = null; } } // гадаа/дотор руу шилжихэд (callback-гүй)
  return { _dbg: () => S, walks, hasWalk: walks.length > 0, splatByRoom, panos, startWalk, stopWalk, enterSplat, exitSplat, stopAll, render, drag, drawMap, active: () => mode, video: vEl };
}
