'use strict';
/* =========================================================================
   WingTrack — Carte vent plein écran (style PredictWind / Windy)
   Champ coloré interpolé + traînées animées + lecture heure par heure
   Données : Open-Meteo (grille multi-points)
   ========================================================================= */
const WM = {
  map: null, heat: null, part: null, grid: null, t: 0, layer: cfg.wmLayer || 'wind', model: cfg.wmModel || 'best',
  playing: null, anim: null, particles: [], loading: false, spotsLayer: null, pending: null,
};
const WM_MODELS = [
  { id: 'best', name: 'Auto', desc: 'meilleur modèle pour la zone' },
  { id: 'meteofrance_seamless', name: 'AROME', desc: '1,3 km' },
  { id: 'icon_seamless', name: 'ICON', desc: '2-7 km' },
  { id: 'ecmwf_ifs025', name: 'ECMWF', desc: '25 km' },
  { id: 'gfs_seamless', name: 'GFS', desc: '13-25 km' },
  { id: 'ukmo_seamless', name: 'UKMO', desc: '2-10 km' },
];
const WM_LAYERS = { wind: 'Vent', gust: 'Rafales', wave: 'Vagues', swell: 'Houle' };

/* ---------- palettes ---------- */
// vent : palette PredictWind définie dans meteo.js (WIND_STOPS / WIND_LUT / lut)
const WAVE_STOPS = [[0, [70, 70, 210]], [0.5, [40, 120, 225]], [1, [30, 175, 200]], [1.5, [40, 190, 90]], [2, [235, 220, 40]], [3, [245, 140, 40]], [4, [215, 25, 40]], [6, [110, 10, 60]]];
const WAVE_LUT = lut(WAVE_STOPS, 6, 241);
const isWave = () => WM.layer === 'wave' || WM.layer === 'swell';

/* ---------- ouverture ---------- */
function openWindMap() {
  show('wmap');
  if (!window.L) { $('wmMap').innerHTML = '<div class="empty" style="margin:40px 16px">Carte indisponible hors connexion</div>'; return; }
  if (!WM.map) {
    WM.map = L.map('wmMap', { zoomControl: false, zoomAnimation: false, attributionControl: true });
    tiles().addTo(WM.map);
    const pane = WM.map.getPanes().overlayPane;
    WM.heat = document.createElement('canvas'); WM.heat.className = 'wmcv';
    WM.part = document.createElement('canvas'); WM.part.className = 'wmcv';
    pane.appendChild(WM.heat); pane.appendChild(WM.part);
    WM.spotsLayer = L.layerGroup().addTo(WM.map);
    WM.map.on('moveend', () => { placeCanvases(); drawHeat(); resetParticles(); clearTimeout(WM.pending); WM.pending = setTimeout(loadGrid, 400); });
    WM.map.on('movestart', () => { WM.part.getContext('2d').clearRect(0, 0, WM.part.width, WM.part.height); });
    WM.map.on('click', e => wmTap(e.latlng.lat, e.latlng.lng));
    const sp = M.spot || cfg.meteoSpot;
    WM.map.setView(sp ? [sp.lat, sp.lon] : [46.5, 2.5], sp ? 10 : 6);
    renderWmBars();
  } else setTimeout(() => { WM.map.invalidateSize(); placeCanvases(); drawHeat(); resetParticles(); }, 50);
  drawWmSpots();
  startAnim();
}
$('wmClose').onclick = () => { stopPlay(); stopAnim(); show('meteo'); };
function placeCanvases() {
  const sz = WM.map.getSize(), tl = WM.map.containerPointToLayerPoint([0, 0]);
  [WM.heat, WM.part].forEach(cv => {
    if (cv.width !== sz.x || cv.height !== sz.y) { cv.width = sz.x; cv.height = sz.y; }
    L.DomUtil.setPosition(cv, tl);
  });
}

/* ---------- barres de commande ---------- */
function renderWmBars() {
  $('wmLayers').innerHTML = Object.entries(WM_LAYERS).map(([k, v]) => `<button class="${WM.layer === k ? 'on' : ''}" data-l="${k}">${v}</button>`).join('');
  $('wmModels').innerHTML = WM_MODELS.map(m => `<button class="${WM.model === m.id ? 'on' : ''}" data-m="${m.id}">${m.name}</button>`).join('');
  $('wmModels').style.display = isWave() ? 'none' : '';
  document.querySelectorAll('#wmLayers button').forEach(b => b.onclick = () => { WM.layer = b.dataset.l; cfg.wmLayer = WM.layer; saveCfg(); WM.grid = null; renderWmBars(); loadGrid(); });
  document.querySelectorAll('#wmModels button').forEach(b => b.onclick = () => { WM.model = b.dataset.m; cfg.wmModel = WM.model; saveCfg(); WM.grid = null; renderWmBars(); loadGrid(); });
  renderLegend();
  const opts = favs().concat((M.sessionSpots || []).filter(s => !isFav(s)));
  $('wmSpot').innerHTML = `<option value="">📍 Aller à un spot…</option>` + opts.map((s, k) => `<option value="${k}">${esc(s.name)}</option>`).join('');
  $('wmSpot').onchange = () => { const s = opts[+$('wmSpot').value]; if (s) WM.map.setView([s.lat, s.lon], 11); $('wmSpot').value = ''; };
}
function renderLegend() {
  if (isWave()) {
    $('wmLegend').innerHTML = [0, 0.5, 1, 1.5, 2, 3, 4, 5].map(v => `<span style="color:rgb(${[...WAVE_LUT.slice(Math.round(v / 6 * 240) * 3, Math.round(v / 6 * 240) * 3 + 3)]})">${v}</span>`).join('') + '<b>m</b>';
    return;
  }
  const marks = { kn: [5, 10, 15, 20, 25, 30, 35, 40, 45, 50], kmh: [10, 20, 30, 40, 50, 60, 70, 80], ms: [3, 5, 8, 10, 13, 15, 20, 25], mph: [5, 10, 15, 20, 30, 40, 50, 60] }[cfg.unit] || [10, 20, 30, 40, 50, 60, 70, 80];
  $('wmLegend').innerHTML = marks.map(v => { const k = Math.min(550, Math.round(v / curU().f * 1.943844 * 10)); return `<span style="color:rgb(${[...WIND_LUT.slice(k * 3, k * 3 + 3)]})">${v}</span>`; }).join('') + `<b>${uLabel()}</b>`;
}
function drawWmSpots() {
  if (!WM.spotsLayer) return;
  WM.spotsLayer.clearLayers();
  favs().forEach(s => L.circleMarker([s.lat, s.lon], { radius: 7, color: '#fff', weight: 2, fillColor: '#3b82f6', fillOpacity: 1 }).addTo(WM.spotsLayer).bindTooltip(esc(s.name)));
  if (M.spot && !isFav(M.spot)) L.circleMarker([M.spot.lat, M.spot.lon], { radius: 7, color: '#fff', weight: 2, fillColor: '#22c55e', fillOpacity: 1 }).addTo(WM.spotsLayer).bindTooltip(esc(M.spot.name));
}

/* ---------- données ---------- */
async function loadGrid() {
  if (!WM.map) return;
  const sz = WM.map.getSize(), b = WM.map.getBounds();
  const cols = Math.max(5, Math.min(12, Math.round(sz.x / 42))), rows = Math.max(6, Math.min(20, Math.round(sz.y / 42)));
  // marge de 15 % pour couvrir les bords pendant les déplacements
  const S = b.getSouth(), N = b.getNorth(), Wd = b.getWest(), E = b.getEast();
  const dLa = (N - S) * 0.15, dLo = (E - Wd) * 0.15;
  const g = { s: S - dLa, n: N + dLa, w: Wd - dLo, e: E + dLo, cols, rows, layer: WM.layer, model: WM.model };
  const key = [g.layer, g.model, g.s.toFixed(3), g.w.toFixed(3), g.n.toFixed(3), g.e.toFixed(3), cols, rows].join('|');
  if (WM.grid && WM.grid.key === key) return;
  const lats = [], lons = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { lats.push(g.s + r * (g.n - g.s) / (rows - 1)); lons.push(g.w + c * (g.e - g.w) / (cols - 1)); }
  const ll = `latitude=${lats.map(x => x.toFixed(3)).join(',')}&longitude=${lons.map(x => x.toFixed(3)).join(',')}&forecast_days=7&timezone=auto`;
  $('wmStatus').textContent = 'Chargement…';
  try {
    let j;
    if (isWave()) j = await getJSON(`${MAR}?${ll}&hourly=wave_height,wave_direction,swell_wave_height,swell_wave_direction,wave_period,swell_wave_period`);
    else j = await getJSON(`${OM}?${ll}&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m${WM.model !== 'best' ? '&models=' + WM.model : ''}`);
    if (!Array.isArray(j)) j = [j];
    const first = j.find(x => x && x.hourly && x.hourly.time);
    if (!first) throw new Error('vide');
    const T = first.hourly.time, nT = T.length, n = rows * cols;
    // champs u/v (vers où ça va) + valeur affichée, par heure
    const U = new Float32Array(nT * n).fill(NaN), V = new Float32Array(nT * n).fill(NaN), S2 = new Float32Array(nT * n).fill(NaN), P = new Float32Array(nT * n).fill(NaN);
    j.forEach((x, k) => {
      if (!x || !x.hourly) return;
      const h = x.hourly;
      const sp = isWave() ? (WM.layer === 'wave' ? h.wave_height : h.swell_wave_height) : (WM.layer === 'gust' ? h.wind_gusts_10m : h.wind_speed_10m);
      const dir = isWave() ? (WM.layer === 'wave' ? h.wave_direction : h.swell_wave_direction) : h.wind_direction_10m;
      const flow = isWave() ? h.wave_height : h.wind_speed_10m; // vitesse des traînées
      const per = isWave() ? (WM.layer === 'wave' ? h.wave_period : h.swell_wave_period) : null;
      for (let t = 0; t < nT; t++) {
        const v = sp && sp[t], d = dir && dir[t];
        if (v == null || d == null) continue;
        const i = t * n + k, f = isWave() ? 6 + (v || 0) * 4 : (flow[t] || 0) / 3.6;
        const a = d * Math.PI / 180;
        U[i] = -Math.sin(a) * f; V[i] = -Math.cos(a) * f; S2[i] = v;
        if (per && per[t] != null) P[i] = per[t];
      }
    });
    const nowL = new Date(Date.now() + (first.utc_offset_seconds || 0) * 1000).toISOString().slice(0, 13) + ':00';
    const prevT = WM.grid && WM.grid.T[WM.t];
    WM.grid = { ...g, key, T, nT, n, U, V, S: S2, P };
    const keep = prevT ? T.indexOf(prevT) : -1;
    WM.t = keep >= 0 ? keep : Math.max(0, T.indexOf(nowL));
    $('wmTime').max = nT - 1; $('wmTime').value = WM.t;
    $('wmStatus').textContent = '';
  } catch (e) { $('wmStatus').textContent = 'Données indisponibles (hors ligne ?)'; return; }
  paintTime(); drawHeat(); resetParticles();
}

/* ---------- interpolation ---------- */
function sample(lat, lon, t) {
  const g = WM.grid; if (!g) return null;
  const fx = (lon - g.w) / (g.e - g.w) * (g.cols - 1), fy = (lat - g.s) / (g.n - g.s) * (g.rows - 1);
  if (fx < 0 || fy < 0 || fx > g.cols - 1 || fy > g.rows - 1) return null;
  const x0 = Math.min(g.cols - 2, Math.floor(fx)), y0 = Math.min(g.rows - 2, Math.floor(fy)), dx = fx - x0, dy = fy - y0;
  const base = t * g.n;
  let u = 0, v = 0, s = 0, p = 0, w = 0, wp = 0;
  [[x0, y0, (1 - dx) * (1 - dy)], [x0 + 1, y0, dx * (1 - dy)], [x0, y0 + 1, (1 - dx) * dy], [x0 + 1, y0 + 1, dx * dy]].forEach(([x, y, k]) => {
    const i = base + y * g.cols + x;
    if (isNaN(g.S[i]) || k === 0) return;
    u += g.U[i] * k; v += g.V[i] * k; s += g.S[i] * k; w += k;
    if (!isNaN(g.P[i])) { p += g.P[i] * k; wp += k; }
  });
  if (w < 0.25) return null;
  return { u: u / w, v: v / w, s: s / w, p: wp ? p / wp : null };
}
function colorOf(val) {
  if (isWave()) { const k = Math.max(0, Math.min(240, Math.round(val / 6 * 240))); return [WAVE_LUT[k * 3], WAVE_LUT[k * 3 + 1], WAVE_LUT[k * 3 + 2]]; }
  const k = Math.max(0, Math.min(550, Math.round(val / KN * 10))); // km/h → dixièmes de nœud
  return [WIND_LUT[k * 3], WIND_LUT[k * 3 + 1], WIND_LUT[k * 3 + 2]];
}

/* ---------- champ coloré ---------- */
function drawHeat() {
  if (!WM.map || !WM.heat) return;
  placeCanvases();
  const cv = WM.heat, c = cv.getContext('2d'), W = cv.width, H = cv.height;
  if (!W || !H) return;
  c.clearRect(0, 0, W, H);
  if (!WM.grid) return;
  const step = 6, w = Math.ceil(W / step), h = Math.ceil(H / step);
  const off = document.createElement('canvas'); off.width = w; off.height = h;
  const oc = off.getContext('2d'), img = oc.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) {
    const ll0 = WM.map.containerPointToLatLng([0, y * step + step / 2]);
    for (let x = 0; x < w; x++) {
      const ll = x === 0 ? ll0 : WM.map.containerPointToLatLng([x * step + step / 2, y * step + step / 2]);
      const s = sample(ll.lat, ll.lng, WM.t), i = (y * w + x) * 4;
      if (!s) { d[i + 3] = 0; continue; }
      const col = colorOf(s.s); d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 205;
    }
  }
  oc.putImageData(img, 0, 0);
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  c.drawImage(off, 0, 0, W, H);
}

/* ---------- traînées animées ---------- */
function resetParticles() {
  if (!WM.part) return;
  const W = WM.part.width, H = WM.part.height, n = Math.round(W * H / 1800);
  WM.particles = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, age: Math.random() * 60 }));
  WM.part.getContext('2d').clearRect(0, 0, W, H);
}
function startAnim() {
  stopAnim();
  const tick = () => {
    WM.anim = requestAnimationFrame(tick);
    if (!WM.grid || !WM.part || document.hidden) return;
    const cv = WM.part, c = cv.getContext('2d'), W = cv.width, H = cv.height;
    if (!W || !H) { placeCanvases(); resetParticles(); return; }
    c.globalCompositeOperation = 'destination-in'; c.fillStyle = 'rgba(0,0,0,0.90)'; c.fillRect(0, 0, W, H);
    c.globalCompositeOperation = 'source-over';
    c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = 1.3; c.beginPath();
    const z = WM.map.getZoom(), k = 0.18 * Math.max(0.6, Math.min(1.6, (z - 4) / 5)); // pixels par image et par m/s
    WM.particles.forEach(p => {
      const ll = WM.map.containerPointToLatLng([p.x, p.y]), s = sample(ll.lat, ll.lng, WM.t);
      if (!s || p.age++ > 90) { p.x = Math.random() * W; p.y = Math.random() * H; p.age = 0; return; }
      const nx = p.x + s.u * k, ny = p.y - s.v * k;
      c.moveTo(p.x, p.y); c.lineTo(nx, ny);
      p.x = nx; p.y = ny;
      if (nx < 0 || ny < 0 || nx > W || ny > H) { p.x = Math.random() * W; p.y = Math.random() * H; p.age = 0; }
    });
    c.stroke();
  };
  WM.anim = requestAnimationFrame(tick);
}
function stopAnim() { if (WM.anim) cancelAnimationFrame(WM.anim); WM.anim = null; }

/* ---------- temps / lecture ---------- */
function paintTime() {
  const g = WM.grid; if (!g) return;
  const t = g.T[WM.t];
  $('wmClock').textContent = t.slice(11, 16);
  $('wmDay').textContent = dayLabel(t.slice(0, 10)).replace(/^./, c => c.toUpperCase());
  $('wmInfo').textContent = `${WM_LAYERS[WM.layer]} · ${isWave() ? 'modèle marin' : WM_MODELS.find(m => m.id === WM.model).name}`;
}
$('wmTime').oninput = () => { WM.t = +$('wmTime').value; paintTime(); drawHeat(); };
$('wmPlay').onclick = () => { if (WM.playing) stopPlay(); else startPlay(); };
function startPlay() {
  $('wmPlay').textContent = '❚❚';
  WM.playing = setInterval(() => {
    if (!WM.grid) return;
    WM.t = (WM.t + 1) % WM.grid.nT; $('wmTime').value = WM.t; paintTime(); drawHeat();
  }, 700);
}
function stopPlay() { clearInterval(WM.playing); WM.playing = null; $('wmPlay').textContent = '▶'; }

/* ---------- toucher la carte ---------- */
function wmTap(lat, lon) {
  const s = sample(lat, lon, WM.t); if (!s || !WM.grid) return;
  const dir = (Math.atan2(-s.u, -s.v) * 180 / Math.PI + 360) % 360;
  const val = isWave() ? `${s.s.toFixed(1)} m${s.p ? ' · ' + Math.round(s.p) + ' s' : ''}` : `${wf(s.s)} ${wUnit()}`;
  const pop = L.popup({ maxWidth: 240 }).setLatLng([lat, lon]).setContent(`<div class="pop"><b>${WM_LAYERS[WM.layer]} ${val}</b> ${arrow(dir, '#06141f')} ${dirName(dir)}<br><small>${dayLabel(WM.grid.T[WM.t].slice(0, 10))} · ${WM.grid.T[WM.t].slice(11, 16)}</small><br><button class="btn small pri" id="wmGo">Prévisions ici</button> <button class="btn small" id="wmNew">＋ Spot</button></div>`).openOn(WM.map);
  setTimeout(() => {
    const go = document.getElementById('wmGo'), nw = document.getElementById('wmNew');
    if (go) go.onclick = async () => { WM.map.closePopup(); stopPlay(); stopAnim(); show('meteo'); setSpot({ name: (await reverseGeocode(lat, lon)) || `Point ${lat.toFixed(2)}, ${lon.toFixed(2)}`, lat, lon }); };
    if (nw) nw.onclick = () => { WM.map.closePopup(); createSpot(lat, lon); };
  }, 0);
}
document.addEventListener('visibilitychange', () => { if (document.hidden) stopPlay(); });
