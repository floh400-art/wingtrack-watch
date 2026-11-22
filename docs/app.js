'use strict';
const $ = id => document.getElementById(id);

/* ---------- réglages ---------- */
const DEF = { unit: 'kmh', foil: 12, map: 'sat', voice: '1' };
let cfg = Object.assign({}, DEF);
try { Object.assign(cfg, JSON.parse(localStorage.getItem('wt_cfg') || '{}')); } catch (e) {}
const saveCfg = () => { try { localStorage.setItem('wt_cfg', JSON.stringify(cfg)); } catch (e) {} };
const uLabel = () => cfg.unit === 'kn' ? 'nds' : 'km/h';
const spd = ms => (cfg.unit === 'kn' ? ms * 1.943844 : ms * 3.6);
const fs = (ms, d = 1) => spd(ms).toFixed(d);
const fd = m => m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m';
const fdN = m => m >= 1000 ? [(m / 1000).toFixed(1), 'km'] : [Math.round(m), 'm'];
const ft = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
const fdate = ms => new Date(ms).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) + ' · ' + new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), 2600); }
function ask(msg, { ok = 'OK', no = 'Annuler', extra = '', danger = false } = {}) {
  return new Promise(res => {
    $('mTxt').textContent = msg; $('mExtra').innerHTML = extra;
    $('mYes').textContent = ok; $('mNo').textContent = no;
    $('mYes').className = 'btn grow ' + (danger ? 'red' : 'pri');
    $('mNo').style.display = no ? '' : 'none';
    $('modal').classList.add('on');
    const done = v => { $('modal').classList.remove('on'); $('mYes').onclick = $('mNo').onclick = null; res(v); };
    $('mYes').onclick = () => done(true); $('mNo').onclick = () => done(false);
  });
}

/* ---------- stockage (IndexedDB) ---------- */
const DB = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('wingtrack', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('sessions', { keyPath: 'id' });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction('sessions', mode); const st = t.objectStore('sessions'); const r = fn(st); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }); };
  return {
    all: () => tx('readonly', s => s.getAll()),
    get: id => tx('readonly', s => s.get(id)),
    put: o => tx('readwrite', s => s.put(o)),
    del: id => tx('readwrite', s => s.delete(id)),
  };
})();

const SUM_KEYS = ['v', 'distance', 'duration', 'movingTime', 'foilTime', 'foilDist', 'vmax2', 'best10', 'best1min', 'best100m', 'best500m', 'avgMoving', 'runs', 'longestRunS', 'longestRunM', 'takeoffs', 'turns', 'jibes', 'tacks', 'foilJibes', 'foilTacks', 'foilTurns', 'accels', 'maxFromStart', 'wind', 'windAuto', 'doppler'];
function statsFor(s) { return WTStats.compute(s.pts, { foilKmh: cfg.foil, windFlip: !!s.windFlip }); }
function summarize(pts, windFlip) {
  const r = WTStats.compute(pts, { foilKmh: cfg.foil, windFlip: !!windFlip }), o = {};
  SUM_KEYS.forEach(k => o[k] = r[k]);
  o.bestAccel = r.bestAccel ? { gain: r.bestAccel.gain, dt: r.bestAccel.dt } : null;
  return o;
}
async function saveSession(pts, name, source) {
  const start = pts[0][0];
  const o = { id: start + '-' + Math.random().toString(36).slice(2, 7), start, name: name || defaultName(start), source, pts, sum: summarize(pts), foilCfg: cfg.foil };
  await DB.put(o); return o;
}
function defaultName(ms) { const h = new Date(ms).getHours(); return 'Session du ' + (h < 12 ? 'matin' : h < 18 ? 'après-midi' : 'soir'); }

/* ---------- navigation ---------- */
let current = 'home';
function show(v) {
  current = v;
  document.querySelectorAll('.view').forEach(e => e.classList.toggle('on', e.id === v));
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.v === v || (v === 'detail' && b.dataset.v === 'home')));
  $('nav').style.display = v === 'live' ? 'none' : '';
  window.scrollTo(0, 0);
  if (v === 'home') renderHome();
}
document.querySelectorAll('#nav button').forEach(b => b.onclick = () => show(b.dataset.v));

/* ---------- carte ---------- */
function tiles() {
  if (!window.L) return null;
  return cfg.map === 'osm'
    ? L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' })
    : L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: '© Esri' });
}
function makeMap(el) {
  if (!window.L) { $(el).innerHTML = '<div class="empty" style="border:0">Carte indisponible hors connexion</div>'; return null; }
  const m = L.map(el, { zoomControl: false, attributionControl: true });
  tiles().addTo(m); m.setView([46.5, 2.5], 5); return m;
}
const COLORS = ['#3b82f6', '#22d3c5', '#a3e635', '#ffb84d', '#ff5d6c'];
function speedColor(v, max) { const k = Math.min(COLORS.length - 1, Math.max(0, Math.floor(v / max * COLORS.length))); return COLORS[k]; }

/* ---------- accueil ---------- */
async function renderHome() {
  let list = [];
  try { list = await DB.all(); } catch (e) { toast('Stockage indisponible'); }
  list.sort((a, b) => b.start - a.start);
  // recalcule les sessions avec l'ancien moteur de stats ou un autre seuil foil
  for (const s of list) if (!s.sum || s.sum.v !== WTStats.VERSION || s.foilCfg !== cfg.foil) {
    s.sum = summarize(s.pts, s.windFlip); s.foilCfg = cfg.foil; try { await DB.put(s); } catch (e) {}
  }
  const rec = { vmax: 0, b10: 0, b500: 0, dist: 0, foil: 0, n: list.length, fj: 0, ft: 0 };
  list.forEach(s => { const u = s.sum; rec.vmax = Math.max(rec.vmax, u.vmax2); rec.b10 = Math.max(rec.b10, u.best10); rec.b500 = Math.max(rec.b500, u.best500m); rec.dist = Math.max(rec.dist, u.distance); rec.foil += u.foilTime; rec.fj += u.foilJibes || 0; rec.ft += u.foilTacks || 0; });
  const [dv, du] = fdN(rec.dist);
  $('records').innerHTML = `
    <div class="tile hl"><div class="l">Vmax (2 s)</div><div class="v">${fs(rec.vmax)}<small>${uLabel()}</small></div></div>
    <div class="tile"><div class="l">Meilleur 10 s</div><div class="v">${fs(rec.b10)}<small>${uLabel()}</small></div></div>
    <div class="tile"><div class="l">Meilleur 500 m</div><div class="v">${fs(rec.b500)}<small>${uLabel()}</small></div></div>
    <div class="tile"><div class="l">Plus longue session</div><div class="v">${dv}<small>${du}</small></div></div>
    <div class="tile"><div class="l">Sessions</div><div class="v">${rec.n}</div></div>
    <div class="tile"><div class="l">Total sur le foil</div><div class="v">${(rec.foil / 3600).toFixed(1)}<small>h</small></div></div>
    <div class="tile"><div class="l">Jibes foilés (total)</div><div class="v">${rec.fj}</div></div>
    <div class="tile"><div class="l">Tacks foilés (total)</div><div class="v">${rec.ft}</div></div>`;
  $('sessions').innerHTML = list.length ? list.map(s => `
    <div class="item" data-id="${s.id}">
      <div><div class="t">${esc(s.name)}</div><div class="m">${fdate(s.start)}<br>${fd(s.sum.distance)} · ${ft(s.sum.duration)} · ${s.sum.jibes || 0} J · ${s.sum.tacks || 0} T${s.source === 'import' ? ' · importée' : ''}</div></div>
      <div class="s">${fs(s.sum.vmax2)}<small>${uLabel()} max</small></div>
    </div>`).join('') : '<div class="empty">Aucune session pour l\'instant.<br>Lance ta première session ou importe un GPX.</div>';
  document.querySelectorAll('#sessions .item').forEach(e => e.onclick = () => openDetail(e.dataset.id));
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- session en direct ---------- */
const live = { pts: [], watch: null, paused: false, active: 0, lastTick: 0, timer: null, map: null, line: null, mk: null, wake: null, lastStats: null, lastVoiceRec: 0, lastVoiceSum: 0, recVmax: 0, fixes: 0 };

async function requestWake() {
  try { if ('wakeLock' in navigator) { live.wake = await navigator.wakeLock.request('screen'); } } catch (e) {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && live.watch !== null) requestWake(); });

function say(txt) { try { if (cfg.voice === '0' || !('speechSynthesis' in window)) return; const u = new SpeechSynthesisUtterance(txt); u.lang = 'fr-FR'; speechSynthesis.speak(u); } catch (e) {} }
const sayUnit = () => cfg.unit === 'kn' ? 'nœuds' : 'kilomètres heure';

async function startLive(resumePts) {
  if (!('geolocation' in navigator)) { ask('Le GPS n\'est pas disponible dans ce navigateur.', { no: '' }); return; }
  Object.assign(live, { pts: resumePts || [], paused: false, active: 0, lastTick: Date.now(), lastStats: null, lastVoiceSum: Date.now(), recVmax: 0, fixes: 0 });
  if (resumePts && resumePts.length > 1) live.active = (resumePts[resumePts.length - 1][0] - resumePts[0][0]) / 1000;
  show('live');
  $('lUnit').textContent = uLabel();
  $('bPause').textContent = 'Pause';
  await requestWake();
  if (!live.map) { live.map = makeMap('map'); }
  if (live.map) {
    setTimeout(() => live.map.invalidateSize(), 100);
    if (live.line) live.line.remove(); if (live.mk) live.mk.remove();
    live.line = L.polyline(live.pts.map(p => [p[1], p[2]]), { color: '#22d3c5', weight: 4 }).addTo(live.map);
    live.mk = L.circleMarker([0, 0], { radius: 7, color: '#fff', weight: 2, fillColor: '#22d3c5', fillOpacity: 1 });
  }
  live.watch = navigator.geolocation.watchPosition(onFix, onGeoErr, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  clearInterval(live.timer);
  live.timer = setInterval(tick, 1000);
  say('Session démarrée');
}
function onGeoErr(e) {
  $('gDot').className = 'dot'; $('gTxt').textContent = e.code === 1 ? 'GPS refusé — autorise la localisation' : 'Signal GPS perdu…';
}
function onFix(pos) {
  const c = pos.coords, acc = c.accuracy;
  $('gDot').className = 'dot ' + (acc <= 10 ? 'ok' : acc <= 25 ? 'mid' : '');
  $('gTxt').textContent = acc <= 10 ? 'GPS précis (±' + Math.round(acc) + ' m)' : 'GPS ±' + Math.round(acc) + ' m';
  live.fixes++;
  if (live.paused) return;
  const dop = (c.speed != null && isFinite(c.speed) && c.speed >= 0) ? +c.speed.toFixed(2) : null;
  const p = [pos.timestamp || Date.now(), +c.latitude.toFixed(7), +c.longitude.toFixed(7), Math.round(acc), dop];
  if (acc > 30) return;
  const prev = live.pts[live.pts.length - 1];
  if (prev && p[0] - prev[0] < 500) return;
  live.pts.push(p);
  let v = (c.speed != null && c.speed >= 0) ? c.speed : null;
  if (v == null && prev) { const dt = (p[0] - prev[0]) / 1000; v = dt > 0 ? WTStats.dist(prev, p) / dt : 0; }
  v = v || 0;
  if (v > 25) return; // pic GPS aberrant (> 90 km/h)
  $('lSpeed').textContent = fs(v);
  $('lSpeedBox').classList.toggle('foil', v * 3.6 >= cfg.foil);
  if (live.map) {
    live.line.addLatLng([p[1], p[2]]);
    live.mk.setLatLng([p[1], p[2]]); if (!live.map.hasLayer(live.mk)) live.mk.addTo(live.map);
    if (live.pts.length === 1) live.map.setView([p[1], p[2]], 16); else live.map.panTo([p[1], p[2]], { animate: false });
  }
}
function tick() {
  const now = Date.now();
  if (!live.paused) live.active += (now - live.lastTick) / 1000;
  live.lastTick = now;
  $('lClock').textContent = ft(live.active);
  if (live.pts.length > 2 && now % 5000 < 1000) {
    const s = WTStats.compute(live.pts, { foilKmh: cfg.foil });
    live.lastStats = s;
    $('lMax').textContent = fs(s.vmax2); $('l10').textContent = fs(s.best10);
    $('lDist').textContent = fd(s.distance); $('lFoil').textContent = ft(s.foilTime);
    $('lTurns').textContent = s.jibes + ' J · ' + s.tacks + ' T'; $('lAvg').textContent = fs(s.avgMoving);
    if (s.vmax2 > live.recVmax + 0.3 && s.vmax2 * 3.6 > 15 && now - live.lastVoiceRec > 20000) {
      live.lastVoiceRec = now; say('Nouvelle vitesse max, ' + fs(s.vmax2) .replace('.', ',') + ' ' + sayUnit());
    }
    live.recVmax = Math.max(live.recVmax, s.vmax2);
    if (cfg.voice === '2' && now - live.lastVoiceSum > 300000) {
      live.lastVoiceSum = now;
      say(`${Math.round(live.active / 60)} minutes. ${(s.distance / 1000).toFixed(1).replace('.', ',')} kilomètres. Max ${fs(s.vmax2).replace('.', ',')}.`);
    }
  }
  if (now % 15000 < 1000 && live.pts.length) { try { localStorage.setItem('wt_draft', JSON.stringify(live.pts)); } catch (e) {} }
}
$('bStart').onclick = () => startLive();
$('bPause').onclick = () => {
  live.paused = !live.paused;
  $('bPause').textContent = live.paused ? 'Reprendre' : 'Pause';
  $('bPause').classList.toggle('pri', live.paused);
  if (!live.paused) live.lastTick = Date.now();
};
$('bStop').onclick = async () => {
  if (!(await ask('Terminer la session ?', { ok: 'Terminer', danger: true }))) return;
  stopLive();
  if (live.pts.length < 5) { toast('Session trop courte, non enregistrée'); clearDraft(); show('home'); return; }
  const o = await saveSession(live.pts, null, 'live');
  clearDraft();
  say('Session enregistrée');
  openDetail(o.id);
};
function stopLive() {
  if (live.watch !== null) navigator.geolocation.clearWatch(live.watch);
  live.watch = null; clearInterval(live.timer);
  try { live.wake && live.wake.release(); } catch (e) {} live.wake = null;
}
const clearDraft = () => { try { localStorage.removeItem('wt_draft'); } catch (e) {} };

/* ---------- détail ---------- */
let det = { map: null, layers: [], id: null, st: null, s: null, cursor: null, ev: [] };
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
const compass = d => COMPASS[Math.round(d / 22.5) % 16];
const EV = {
  takeoff: { c: '#a3e635', l: 'Décollage', s: '▲' },
  touchdown: { c: '#86a6b8', l: 'Retour à l\'eau', s: '▼' },
  jibe: { c: '#ffb84d', l: 'Jibe', s: 'J' },
  tack: { c: '#60a5fa', l: 'Tack', s: 'T' },
  turn: { c: '#c084fc', l: 'Virage', s: 'V' },
  accel: { c: '#ff5d6c', l: 'Accélération', s: '⚡' },
};
async function openDetail(id) {
  const s = await DB.get(id); if (!s) return;
  det.id = id; det.s = s;
  if (!s.sum || s.sum.v !== WTStats.VERSION || s.foilCfg !== cfg.foil) { s.sum = summarize(s.pts, s.windFlip); s.foilCfg = cfg.foil; DB.put(s); }
  show('detail');
  $('dName').textContent = s.name; $('dDate').textContent = fdate(s.start) + (s.source === 'import' ? ' · importée' : '');
  det.st = statsFor(s);
  renderDetail();
}
function renderDetail() {
  const s = det.s, st = det.st, U = uLabel();
  const tile = (l, v, unit = '', hl) => `<div class="tile${hl ? ' hl' : ''}"><div class="l">${l}</div><div class="v">${v}${unit ? '<small>' + unit + '</small>' : ''}</div></div>`;
  $('dSpeed').innerHTML = tile('Vmax (2 s)', fs(st.vmax2), U, 1) + tile('Meilleur 10 s', fs(st.best10), U) + tile('Meilleur 1 min', fs(st.best1min), U)
    + tile('Meilleur 100 m', fs(st.best100m), U) + tile('Meilleur 500 m', fs(st.best500m), U) + tile('Moy. en mvt', fs(st.avgMoving), U);
  const ba = st.bestAccel;
  $('dMan').innerHTML = tile('Décollages', st.takeoffs, '', 1)
    + tile('Jibes', st.jibes, st.jibes ? st.foilJibes + ' foilés' : '')
    + tile('Tacks', st.tacks, st.tacks ? st.foilTacks + ' foilés' : '')
    + tile('Accélérations', st.accels)
    + tile('Meilleure accél.', ba ? '+' + fs(ba.gain, 0) : '–', ba ? U + ' en ' + Math.round(ba.dt) + ' s' : '')
    + tile('Vols', st.runs);
  $('dWind').innerHTML = st.wind == null ? 'Vent : pas assez de données pour l\'estimer'
    : `<span class="warrow" style="transform:rotate(${st.wind + 180}deg)">↑</span> Vent du <b>${compass(st.wind)}</b> (${Math.round(st.wind)}°, estimé d'après ta trace)`;
  const [dv, du] = fdN(st.distance), [rv, ru] = fdN(st.longestRunM), [xv, xu] = fdN(st.maxFromStart);
  $('dSess').innerHTML = tile('Distance', dv, du, 1) + tile('Durée', ft(st.duration)) + tile('Sur le foil', ft(st.foilTime))
    + tile('% sur le foil', st.duration ? Math.round(st.foilTime / st.duration * 100) : 0, '%') + tile('Plus long vol', ft(st.longestRunS)) + tile('Vol le + long', rv, ru)
    + tile('Éloignement max', xv, xu) + tile('Source vitesse', st.doppler ? 'Doppler' : 'Positions') + tile('Points GPS', st.n);
  det.ev = st.events.filter(e => e.type !== 'touchdown');
  $('dEvents').innerHTML = det.ev.length ? det.ev.map((e, k) => {
    const d = EV[e.type];
    const extra = e.type === 'accel' ? `+${fs(e.gain, 0)} ${U} en ${Math.round(e.dt)} s (${fs(e.from, 0)} → ${fs(e.to, 0)})`
      : e.type === 'takeoff' ? 'sur le foil'
      : `${e.angle}° · ${e.foiled ? 'foilé ✓' : 'touché l\'eau'}`;
    return `<div class="ev" data-k="${k}"><span class="evs" style="background:${d.c}">${d.s}</span><span class="evt">${ft(e.t)}</span><span class="grow"><b>${d.l}</b> ${extra}</span></div>`;
  }).join('') : '<div class="empty">Aucun événement détecté</div>';
  document.querySelectorAll('#dEvents .ev').forEach(el => el.onclick = () => focusEvent(det.ev[+el.dataset.k]));
  document.querySelectorAll('.uL').forEach(e => e.textContent = uLabel());
  drawMap(); drawChart(-1); drawHist(); drawRuns(); drawPolar();
}
function drawMap() {
  if (!det.map) det.map = makeMap('dmap');
  const m = det.map, st = det.st; if (!m) return;
  setTimeout(() => m.invalidateSize(), 50);
  det.layers.forEach(l => l.remove()); det.layers = []; det.cursor = null;
  const P = st.pts, V = st.V; if (!P || P.length < 3) return;
  const max = Math.max(st.vmax2, 20 / 3.6);
  $('lgMin').textContent = '0'; $('lgMax').textContent = fs(max, 0) + ' ' + uLabel();
  let seg = [[P[0][1], P[0][2]]], col = speedColor(V[0], max);
  for (let i = 1; i < P.length; i++) {
    const c = speedColor(V[i], max); seg.push([P[i][1], P[i][2]]);
    if (c !== col || i === P.length - 1) { det.layers.push(L.polyline(seg, { color: col, weight: 4, opacity: .95 }).addTo(m)); seg = [[P[i][1], P[i][2]]]; col = c; }
  }
  if (st.best10Range) {
    const [a, b] = st.best10Range;
    det.layers.push(L.polyline(P.slice(a, b + 1).map(p => [p[1], p[2]]), { color: '#fff', weight: 9, opacity: .45 }).addTo(m).bindTooltip('Meilleur 10 s'));
  }
  det.layers.push(L.circleMarker([P[0][1], P[0][2]], { radius: 6, color: '#fff', weight: 2, fillColor: '#22d3c5', fillOpacity: 1 }).addTo(m).bindTooltip('Départ'));
  det.ev.forEach(e => {
    const d = EV[e.type], p = P[e.i];
    const icon = L.divIcon({ className: '', html: `<div class="mk" style="background:${d.c};${e.foiled === false ? 'opacity:.55' : ''}">${d.s}</div>`, iconSize: [20, 20], iconAnchor: [10, 10] });
    det.layers.push(L.marker([p[1], p[2]], { icon }).addTo(m).bindTooltip(`${d.l} · ${ft(e.t)}`));
  });
  if (st.vmaxIdx >= 0) {
    const p = P[st.vmaxIdx];
    const icon = L.divIcon({ className: '', html: `<div class="mk" style="background:#fff;color:#06141f;width:auto;padding:0 5px">${fs(st.vmax2)}</div>`, iconSize: [40, 20], iconAnchor: [20, 10] });
    det.layers.push(L.marker([p[1], p[2]], { icon }).addTo(m).bindTooltip('Vmax'));
  }
  m.fitBounds(L.latLngBounds(P.map(p => [p[1], p[2]])), { padding: [20, 20] });
}
function focusEvent(e) {
  if (!e) return;
  drawChart(e.i);
  if (det.map) { const p = det.st.pts[e.i]; det.map.setView([p[1], p[2]], Math.max(det.map.getZoom(), 17)); }
  $('dmap').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function prep(id) {
  const cv = $(id), dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const c = cv.getContext('2d'); c.scale(dpr, dpr); c.clearRect(0, 0, W, H);
  c.font = '10px system-ui'; c.lineWidth = 1; return { c, W, H };
}
let chartGeom = null;
function drawChart(cursorIdx) {
  const st = det.st; const { c, W, H } = prep('chart');
  const T = st.T, V = st.V; if (!T || T.length < 3) return;
  const pad = { l: 30, r: 8, t: 22, b: 20 }, w = W - pad.l - pad.r, h = H - pad.t - pad.b;
  const vmax = spd(Math.max(st.vmax2, 20 / 3.6)) * 1.12, tmax = T[T.length - 1];
  const X = t => pad.l + t / tmax * w, Y = v => pad.t + h - spd(v) / vmax * h;
  chartGeom = { pad, w, tmax };
  // bandes : accélérations + meilleur 10 s
  st.events.filter(e => e.type === 'accel').forEach(e => { c.fillStyle = 'rgba(255,93,108,.18)'; c.fillRect(X(e.t), pad.t, Math.max(2, X(e.t + e.dt) - X(e.t)), h); });
  if (st.best10Range) { const [a, b] = st.best10Range; c.fillStyle = 'rgba(255,255,255,.12)'; c.fillRect(X(T[a]), pad.t, Math.max(2, X(T[b]) - X(T[a])), h); }
  c.fillStyle = '#86a6b8'; c.strokeStyle = '#183a50';
  const step = vmax > 40 ? 10 : 5;
  for (let v = 0; v <= vmax; v += step) { const y = pad.t + h - v / vmax * h; c.beginPath(); c.moveTo(pad.l, y); c.lineTo(W - pad.r, y); c.stroke(); c.fillText(v, 4, y + 3); }
  const tStep = tmax > 5400 ? 1800 : tmax > 1800 ? 600 : tmax > 600 ? 300 : 60;
  for (let t = 0; t <= tmax; t += tStep) c.fillText(Math.round(t / 60) + ' min', X(t) - 10, H - 5);
  const fy = Y(cfg.foil / 3.6); c.setLineDash([4, 4]); c.strokeStyle = '#ffb84d'; c.beginPath(); c.moveTo(pad.l, fy); c.lineTo(W - pad.r, fy); c.stroke(); c.setLineDash([]);
  // courbe
  const stepI = Math.max(1, Math.floor(T.length / (w * 2)));
  c.beginPath(); c.moveTo(X(T[0]), Y(V[0]));
  for (let i = stepI; i < T.length; i += stepI) { if (T[i] - T[i - stepI] > 30) c.moveTo(X(T[i]), Y(V[i])); else c.lineTo(X(T[i]), Y(V[i])); }
  c.strokeStyle = '#22d3c5'; c.lineWidth = 1.5; c.stroke(); c.lineWidth = 1;
  // marqueurs d'événements en haut
  c.font = 'bold 9px system-ui'; c.textAlign = 'center';
  det.ev.filter(e => e.type !== 'accel').forEach(e => {
    const d = EV[e.type], x = X(e.t);
    c.fillStyle = d.c; c.globalAlpha = e.foiled === false ? .5 : 1;
    c.beginPath(); c.arc(x, 9, 7, 0, 7); c.fill();
    c.fillStyle = '#06141f'; c.fillText(d.s === '▲' ? '▲' : d.s, x, 12); c.globalAlpha = 1;
    c.strokeStyle = d.c + '55'; c.beginPath(); c.moveTo(x, 16); c.lineTo(x, pad.t + h); c.stroke();
  });
  // Vmax
  if (st.vmaxIdx >= 0) { const x = X(T[st.vmaxIdx]), y = Y(st.vmax2); c.fillStyle = '#fff'; c.beginPath(); c.arc(x, y, 3.5, 0, 7); c.fill(); c.textAlign = x > W - 50 ? 'right' : 'left'; c.fillText(fs(st.vmax2), x + (x > W - 50 ? -6 : 6), y - 4); }
  c.textAlign = 'left'; c.font = '10px system-ui';
  // curseur
  if (cursorIdx >= 0) {
    const x = X(T[cursorIdx]);
    c.strokeStyle = '#fff'; c.beginPath(); c.moveTo(x, pad.t); c.lineTo(x, pad.t + h); c.stroke();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(x, Y(V[cursorIdx]), 4, 0, 7); c.fill();
    $('scrub').textContent = `${ft(T[cursorIdx])} · ${fs(V[cursorIdx])} ${uLabel()}`;
    if (det.map) {
      const p = det.st.pts[cursorIdx];
      if (!det.cursor) { det.cursor = L.circleMarker([p[1], p[2]], { radius: 8, color: '#fff', weight: 3, fillColor: '#06141f', fillOpacity: 1 }).addTo(det.map); det.layers.push(det.cursor); }
      else det.cursor.setLatLng([p[1], p[2]]);
    }
  } else $('scrub').textContent = 'Glisse le doigt sur la courbe pour voir ta position sur la carte';
}
function chartScrub(ev) {
  if (!chartGeom || !det.st) return;
  const r = $('chart').getBoundingClientRect(), x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
  const t = Math.max(0, Math.min(1, (x - chartGeom.pad.l) / chartGeom.w)) * chartGeom.tmax;
  const T = det.st.T; let lo = 0, hi = T.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (T[mid] < t) lo = mid + 1; else hi = mid; }
  drawChart(lo);
}
$('chart').addEventListener('pointerdown', e => { $('chart').setPointerCapture(e.pointerId); chartScrub(e); });
$('chart').addEventListener('pointermove', e => { if (e.buttons || e.pointerType === 'touch') chartScrub(e); });
function drawHist() {
  const st = det.st; const { c, W, H } = prep('hist');
  const T = st.T, V = st.V; if (!T || T.length < 3) return;
  const bins = [];
  for (let i = 1; i < T.length; i++) { const dt = T[i] - T[i - 1]; if (dt > 30) continue; const b = Math.floor(spd(V[i]) / 5); bins[b] = (bins[b] || 0) + dt; }
  const nb = bins.length, total = bins.reduce((a, b) => a + (b || 0), 0) || 1, mx = Math.max(...bins.map(b => b || 0));
  const pad = { l: 8, r: 8, t: 16, b: 20 }, w = W - pad.l - pad.r, h = H - pad.t - pad.b, bw = w / nb;
  for (let b = 0; b < nb; b++) {
    const val = bins[b] || 0, bh = val / mx * h, x = pad.l + b * bw;
    c.fillStyle = (b * 5) >= spd(cfg.foil / 3.6) ? '#22d3c5' : '#3b5a6e';
    c.fillRect(x + 2, pad.t + h - bh, bw - 4, bh);
    c.fillStyle = '#86a6b8'; c.textAlign = 'center';
    c.fillText(b * 5, x + bw / 2, H - 6);
    if (val / total >= 0.03) { c.fillStyle = '#e8f3f8'; c.fillText(Math.round(val / total * 100) + '%', x + bw / 2, pad.t + h - bh - 4); }
  }
  c.textAlign = 'left';
}
function drawRuns() {
  const st = det.st; const { c, W, H } = prep('runs');
  const R = st.runList;
  if (!R.length) { c.fillStyle = '#86a6b8'; c.fillText('Aucun vol de plus de 10 s', 10, H / 2); return; }
  const pad = { l: 30, r: 8, t: 18, b: 18 }, w = W - pad.l - pad.r, h = H - pad.t - pad.b;
  const mx = Math.max(...R.map(r => r.dur)), bw = w / R.length, vtop = Math.max(...R.map(r => r.vmax));
  c.fillStyle = '#86a6b8';
  [0, mx / 2, mx].forEach(v => { const y = pad.t + h - v / mx * h; c.fillText(ft(v), 2, y + 3); c.strokeStyle = '#183a50'; c.beginPath(); c.moveTo(pad.l, y); c.lineTo(W - pad.r, y); c.stroke(); });
  R.forEach((r, k) => {
    const x = pad.l + k * bw, bh = r.dur / mx * h;
    c.fillStyle = speedColor(r.avg, Math.max(vtop, 20 / 3.6));
    c.fillRect(x + Math.min(3, bw * .15), pad.t + h - bh, Math.max(2, bw - Math.min(6, bw * .3)), bh);
    if (bw > 22) { c.fillStyle = '#e8f3f8'; c.textAlign = 'center'; c.fillText(fs(r.vmax, 0), x + bw / 2, pad.t + h - bh - 4); }
    if (bw > 14) { c.fillStyle = '#86a6b8'; c.textAlign = 'center'; c.fillText(k + 1, x + bw / 2, H - 5); }
  });
  c.textAlign = 'left';
}
function drawPolar() {
  const st = det.st; const { c, W, H } = prep('polar');
  if (!st.polar || !st.polar.some(v => v > 0)) { c.fillStyle = '#86a6b8'; c.fillText('Pas assez de données pour la polaire', 10, H / 2); return; }
  // vent en haut ; angle au vent a : 0° = face au vent, 180° = vent arrière ; bâbord à gauche, tribord à droite (symétrique)
  const cx = W / 2, cy = H / 2 + 6, R = Math.min(W / 2, H / 2) - 18;
  const mx = spd(Math.max(...st.polar, 20 / 3.6)), step = mx > 40 ? 10 : 5, top = Math.ceil(mx / step) * step;
  const P = (a, r, sg) => [cx + sg * Math.sin(a * Math.PI / 180) * r, cy - Math.cos(a * Math.PI / 180) * r];
  // zone face au vent
  c.fillStyle = 'rgba(255,93,108,.12)'; c.beginPath(); c.moveTo(cx, cy);
  c.arc(cx, cy, R, -Math.PI / 2 - Math.PI / 4, -Math.PI / 2 + Math.PI / 4); c.closePath(); c.fill();
  c.strokeStyle = '#183a50'; c.fillStyle = '#86a6b8';
  for (let v = step; v <= top; v += step) { const r = v / top * R; c.beginPath(); c.arc(cx, cy, r, 0, 7); c.stroke(); c.fillText(v, cx + 3, cy - r + 11); }
  for (let a = 0; a < 360; a += 45) { const [x, y] = P(a, R, 1); c.beginPath(); c.moveTo(cx, cy); c.lineTo(x, y); c.stroke(); }
  c.beginPath(); let first = true;
  const pts = [];
  st.polar.forEach((v, b) => { if (v > 0) pts.push([b * 10 + 5, spd(v) / top * R]); });
  pts.forEach(([a, r]) => { const [x, y] = P(a, r, 1); if (first) { c.moveTo(x, y); first = false; } else c.lineTo(x, y); });
  pts.slice().reverse().forEach(([a, r]) => { const [x, y] = P(a, r, -1); c.lineTo(x, y); });
  c.closePath(); c.fillStyle = 'rgba(34,211,197,.22)'; c.fill(); c.strokeStyle = '#22d3c5'; c.lineWidth = 2; c.stroke(); c.lineWidth = 1;
  c.fillStyle = '#e8f3f8'; c.textAlign = 'center';
  c.fillText('▼ vent', cx, 10); c.fillText('vent arrière', cx, H - 2);
  c.textAlign = 'left'; c.fillText('travers', 2, cy - 3); c.textAlign = 'right'; c.fillText('travers', W - 2, cy - 3); c.textAlign = 'left';
}
$('bWind').onclick = async () => {
  const s = det.s; s.windFlip = !s.windFlip; s.sum = summarize(s.pts, s.windFlip); await DB.put(s);
  det.st = statsFor(s); renderDetail(); toast('Jibes et tacks recalculés');
};
$('bBack').onclick = () => show('home');
$('bDel').onclick = async () => { if (await ask('Supprimer définitivement cette session ?', { ok: 'Supprimer', danger: true })) { await DB.del(det.id); toast('Session supprimée'); show('home'); } };
$('bRename').onclick = async () => {
  const s = await DB.get(det.id);
  const ok = await ask('Nom de la session', { extra: `<input type="text" id="rnIn" value="${esc(s.name)}" style="margin-bottom:14px">` });
  if (ok) { s.name = $('rnIn').value.trim() || s.name; await DB.put(s); $('dName').textContent = s.name; }
};
function gpx(s) {
  const pts = s.pts.map(p => `<trkpt lat="${p[1]}" lon="${p[2]}"><time>${new Date(p[0]).toISOString()}</time></trkpt>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="WingTrack" xmlns="http://www.topografix.com/GPX/1/1">\n<trk><name>${esc(s.name)}</name><type>windsurfing</type><trkseg>\n${pts}\n</trkseg></trk>\n</gpx>`;
}
const fileName = s => 'wingfoil-' + new Date(s.start).toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.gpx';
function download(name, text, type) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
$('bGpx').onclick = async () => { const s = await DB.get(det.id); download(fileName(s), gpx(s), 'application/gpx+xml'); };
$('bShare').onclick = async () => {
  const s = await DB.get(det.id), u = s.sum;
  const text = `🪁 ${s.name} — ${fd(u.distance)} en ${ft(u.duration)}, Vmax ${fs(u.vmax2)} ${uLabel()}, meilleur 10 s ${fs(u.best10)} ${uLabel()}, ${u.turns} virages (WingTrack)`;
  try {
    const f = new File([gpx(s)], fileName(s), { type: 'application/gpx+xml' });
    if (navigator.canShare && navigator.canShare({ files: [f] })) await navigator.share({ files: [f], text, title: s.name });
    else if (navigator.share) await navigator.share({ text, title: s.name });
    else { await navigator.clipboard.writeText(text); toast('Résumé copié'); }
  } catch (e) { if (e.name !== 'AbortError') toast('Partage impossible'); }
};

/* ---------- import GPX / TCX ---------- */
$('bPick').onclick = () => $('file').click();
$('file').onchange = async e => {
  let ok = 0, last = null;
  for (const f of e.target.files) {
    try {
      const pts = parseTrack(await f.text());
      if (pts.length < 5) throw new Error('trace vide');
      const name = (f.name.replace(/\.(gpx|tcx)$/i, '') || '').slice(0, 60);
      last = await saveSession(pts, name, 'import'); ok++;
    } catch (err) { toast('Fichier ignoré : ' + f.name); }
  }
  e.target.value = '';
  if (ok === 1) openDetail(last.id); else if (ok > 1) { toast(ok + ' sessions importées'); show('home'); }
};
function parseTrack(txt) {
  const doc = new DOMParser().parseFromString(txt, 'application/xml');
  const out = [];
  doc.querySelectorAll('trkpt, rtept').forEach(n => {
    const t = n.getElementsByTagName('time')[0];
    if (!t) return;
    out.push([Date.parse(t.textContent), +n.getAttribute('lat'), +n.getAttribute('lon')]);
  });
  if (!out.length) doc.querySelectorAll('Trackpoint').forEach(n => {
    const t = n.getElementsByTagName('Time')[0], la = n.getElementsByTagName('LatitudeDegrees')[0], lo = n.getElementsByTagName('LongitudeDegrees')[0];
    if (t && la && lo) out.push([Date.parse(t.textContent), +la.textContent, +lo.textContent]);
  });
  return out.filter(p => isFinite(p[0]) && isFinite(p[1]) && isFinite(p[2]));
}

/* ---------- réglages ---------- */
function renderSettings() {
  document.querySelectorAll('#sUnit button').forEach(b => b.classList.toggle('on', b.dataset.u === cfg.unit));
  document.querySelectorAll('#sMap button').forEach(b => b.classList.toggle('on', b.dataset.m === cfg.map));
  document.querySelectorAll('#sVoice button').forEach(b => b.classList.toggle('on', b.dataset.v === cfg.voice));
  $('sFoil').value = cfg.foil;
}
document.querySelectorAll('#sUnit button').forEach(b => b.onclick = () => { cfg.unit = b.dataset.u; saveCfg(); renderSettings(); });
document.querySelectorAll('#sVoice button').forEach(b => b.onclick = () => { cfg.voice = b.dataset.v; saveCfg(); renderSettings(); if (cfg.voice !== '0') say('Annonces vocales activées'); });
document.querySelectorAll('#sMap button').forEach(b => b.onclick = () => {
  cfg.map = b.dataset.m; saveCfg(); renderSettings();
  [live.map, det.map].forEach(m => { if (!m) return; m.eachLayer(l => { if (l instanceof L.TileLayer) l.remove(); }); tiles().addTo(m); });
});
$('sFoil').onchange = () => { const v = Math.min(30, Math.max(5, +$('sFoil').value || 12)); cfg.foil = v; saveCfg(); renderSettings(); };
$('bBackup').onclick = async () => { const all = await DB.all(); download('wingtrack-sauvegarde-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify({ v: 1, sessions: all }), 'application/json'); };
$('bRestore').onclick = () => $('fileRestore').click();
$('fileRestore').onchange = async e => {
  try {
    const d = JSON.parse(await e.target.files[0].text()); let n = 0;
    for (const s of d.sessions || []) if (s.id && Array.isArray(s.pts)) { await DB.put(s); n++; }
    toast(n + ' sessions restaurées');
  } catch (err) { toast('Fichier de sauvegarde invalide'); }
  e.target.value = '';
};
renderSettings();

/* ---------- démarrage ---------- */
(async () => {
  renderHome();
  let draft = null; try { draft = JSON.parse(localStorage.getItem('wt_draft') || 'null'); } catch (e) {}
  if (draft && draft.length > 4) {
    const r = await ask(`Une session n'a pas été terminée (${ft((draft[draft.length - 1][0] - draft[0][0]) / 1000)}). Que veux-tu faire ?`, { ok: 'Reprendre', no: 'Enregistrer' });
    if (r) startLive(draft); else { const o = await saveSession(draft, null, 'live'); clearDraft(); openDetail(o.id); }
  }
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
