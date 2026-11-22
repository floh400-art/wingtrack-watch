'use strict';
/* =========================================================================
   WingTrack — Carte vent plein écran (style PredictWind / Windy)
   Champ coloré interpolé + traînées animées + lecture heure par heure
   Données : Open-Meteo (grille multi-points)
   ========================================================================= */
const WM = {
  map: null, heat: null, part: null, grid: null, t: 0, layer: cfg.wmLayer || 'wind', model: cfg.wmModel || 'best',
  playing: null, anim: null, particles: [], loading: false, spotsLayer: null, pending: null,
  res: cfg.wmRes || 'normal', iso: cfg.wmIso !== false, anim2: cfg.wmAnim !== false,
};
const WM_RES = { fine: { l: 'Fine', px: 30, d: 'plus de détail, plus lent' }, normal: { l: 'Normale', px: 42, d: 'équilibrée' }, fast: { l: 'Rapide', px: 62, d: 'chargement rapide' } };
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
// vagues : palette PredictWind définie dans meteo.js (WAVE_STOPS / WAVE_LUT)
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
  if (typeof refreshDbMarkers === 'function') refreshDbMarkers();
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
  const mdl = isWave() ? 'Marin' : WM_MODELS.find(m => m.id === WM.model).name;
  $('wmOpt').innerHTML = `<span class="wmo-ico">◧</span><b>${mdl}</b><small>${(WM_RES[WM.res] || WM_RES.normal).l}</small><span class="wmo-ico">${{ wind: '≋', gust: '⩰', wave: '〰', swell: '∿' }[WM.layer]}</span>`;
  renderLegend();
  const opts = favs().concat((M.sessionSpots || []).filter(s => !isFav(s)));
  $('wmSpot').innerHTML = `<option value="">📍 Aller à un spot…</option>` + opts.map((s, k) => `<option value="${k}">${esc(s.name)}</option>`).join('');
  $('wmSpot').onchange = () => { const s = opts[+$('wmSpot').value]; if (s) WM.map.setView([s.lat, s.lon], 11); $('wmSpot').value = ''; };
  renderWmPanel();
}
function renderWmPanel() {
  const btn = (on, attrs, label, dis) => `<button class="${on ? 'on' : ''}" ${attrs} ${dis ? 'disabled' : ''}>${label}</button>`;
  const tog = (id, on, label) => `<div class="wmp-tog"><span>${label}</span><button class="sw ${on ? 'on' : ''}" id="${id}"><i></i></button></div>`;
  $('wmPanelBody').innerHTML = `
    <h3>Couche de carte</h3>
    <div class="wmp-grid">${Object.entries(WM_LAYERS).map(([k, v]) => btn(WM.layer === k, `data-l="${k}"`, `${{ wind: '≋', gust: '⩰', wave: '〰', swell: '∿' }[k]} ${v}`)).join('')}</div>
    <h3>Modèle de prévision</h3>
    <div class="wmp-grid">${WM_MODELS.map(m => btn(WM.model === m.id, `data-m="${m.id}"`, `${m.name}<small>${m.desc}</small>`, isWave())).join('')}</div>
    ${isWave() ? '<p class="cap">Vagues et houle : modèle marin unique (Open-Meteo Marine).</p>' : ''}
    <h3>Finesse de la grille</h3>
    <div class="wmp-grid three">${Object.entries(WM_RES).map(([k, r]) => btn(WM.res === k, `data-r="${k}"`, `${r.l}<small>${r.d}</small>`)).join('')}</div>
    <h3>Affichage</h3>
    ${tog('wmIso', WM.iso, 'Isobares + centres H / L' + (isWave() ? ' <small>(couches vent)</small>' : ''))}
    ${tog('wmAnimT', WM.anim2, 'Traînées animées')}
    <h3>Unité</h3>
    <div class="wmp-grid four">${Object.keys(UNITS).map(u => btn(cfg.unit === u, `data-u="${u}"`, UNITS[u].l)).join('')}</div>`;
  const re = () => { WM.grid = null; renderWmBars(); loadGrid(); };
  document.querySelectorAll('#wmPanelBody [data-l]').forEach(b => b.onclick = () => { WM.layer = b.dataset.l; cfg.wmLayer = WM.layer; saveCfg(); re(); });
  document.querySelectorAll('#wmPanelBody [data-m]').forEach(b => b.onclick = () => { WM.model = b.dataset.m; cfg.wmModel = WM.model; saveCfg(); re(); });
  document.querySelectorAll('#wmPanelBody [data-r]').forEach(b => b.onclick = () => { WM.res = b.dataset.r; cfg.wmRes = WM.res; saveCfg(); re(); });
  document.querySelectorAll('#wmPanelBody [data-u]').forEach(b => b.onclick = () => { cfg.unit = b.dataset.u; saveCfg(); renderWmBars(); paintTime(); });
  $('wmIso').onclick = () => { WM.iso = !WM.iso; cfg.wmIso = WM.iso; saveCfg(); renderWmPanel(); drawHeat(); };
  $('wmAnimT').onclick = () => { WM.anim2 = !WM.anim2; cfg.wmAnim = WM.anim2; saveCfg(); renderWmPanel(); };
}
$('wmOpt').onclick = () => { renderWmPanel(); $('wmPanel').classList.add('on'); };
$('wmPanelClose').onclick = () => $('wmPanel').classList.remove('on');
function renderLegend() {
  if (isWave()) {
    $('wmLegend').innerHTML = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(v => `<span style="color:rgb(${waveRGB(v).join(',')})">${v}</span>`).join('') + '<b>mètres</b>';
    return;
  }
  const marks = { kn: [5, 10, 15, 20, 25, 30, 35, 40, 45, 50], kmh: [10, 20, 30, 40, 50, 60, 70, 80], ms: [3, 5, 8, 10, 13, 15, 20, 25], mph: [5, 10, 15, 20, 30, 40, 50, 60] }[cfg.unit] || [10, 20, 30, 40, 50, 60, 70, 80];
  $('wmLegend').innerHTML = marks.map(v => { const k = Math.min(550, Math.round(v / curU().f * 1.943844 * 10)); return `<span style="color:rgb(${[...WIND_LUT.slice(k * 3, k * 3 + 3)]})">${v}</span>`; }).join('') + `<b>${uLabel()}</b>`;
}
function drawWmSpots() {
  if (!WM.spotsLayer) return;
  WM.spotsLayer.clearLayers();
  if (M.spot && !isFav(M.spot)) L.circleMarker([M.spot.lat, M.spot.lon], { radius: 7, color: '#fff', weight: 2, fillColor: '#22c55e', fillOpacity: 1 }).addTo(WM.spotsLayer).bindTooltip(esc(M.spot.name));
}

/* ---------- données ---------- */
async function loadGrid() {
  if (!WM.map) return;
  const sz = WM.map.getSize(), b = WM.map.getBounds();
  const px = (WM_RES[WM.res] || WM_RES.normal).px;
  const cols = Math.max(5, Math.min(16, Math.round(sz.x / px))), rows = Math.max(6, Math.min(26, Math.round(sz.y / px)));
  // marge de 15 % pour couvrir les bords pendant les déplacements
  const S = b.getSouth(), N = b.getNorth(), Wd = b.getWest(), E = b.getEast();
  const dLa = (N - S) * 0.15, dLo = (E - Wd) * 0.15;
  const g = { s: S - dLa, n: N + dLa, w: Wd - dLo, e: E + dLo, cols, rows, layer: WM.layer, model: WM.model };
  const key = [g.layer, g.model, WM.res, g.s.toFixed(3), g.w.toFixed(3), g.n.toFixed(3), g.e.toFixed(3), cols, rows].join('|');
  if (WM.grid && WM.grid.key === key) return;
  const lats = [], lons = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { lats.push(g.s + r * (g.n - g.s) / (rows - 1)); lons.push(g.w + c * (g.e - g.w) / (cols - 1)); }
  const ll = `latitude=${lats.map(x => x.toFixed(3)).join(',')}&longitude=${lons.map(x => x.toFixed(3)).join(',')}&forecast_days=7&timezone=auto`;
  $('wmStatus').textContent = 'Chargement…';
  try {
    let j;
    if (isWave()) j = await getJSON(`${MAR}?${ll}&hourly=wave_height,wave_direction,swell_wave_height,swell_wave_direction,wave_period,swell_wave_period`);
    else j = await getJSON(`${OM}?${ll}&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,pressure_msl${WM.model !== 'best' ? '&models=' + WM.model : ''}`);
    if (!Array.isArray(j)) j = [j];
    const first = j.find(x => x && x.hourly && x.hourly.time);
    if (!first) throw new Error('vide');
    const T = first.hourly.time, nT = T.length, n = rows * cols;
    // champs u/v (vers où ça va) + valeur affichée, par heure
    const U = new Float32Array(nT * n).fill(NaN), V = new Float32Array(nT * n).fill(NaN), S2 = new Float32Array(nT * n).fill(NaN), P = new Float32Array(nT * n).fill(NaN), PR = new Float32Array(nT * n).fill(NaN);
    j.forEach((x, k) => {
      if (!x || !x.hourly) return;
      const h = x.hourly;
      const sp = isWave() ? (WM.layer === 'wave' ? h.wave_height : h.swell_wave_height) : (WM.layer === 'gust' ? h.wind_gusts_10m : h.wind_speed_10m);
      const dir = isWave() ? (WM.layer === 'wave' ? h.wave_direction : h.swell_wave_direction) : h.wind_direction_10m;
      const flow = isWave() ? h.wave_height : h.wind_speed_10m; // vitesse des traînées
      const per = isWave() ? (WM.layer === 'wave' ? h.wave_period : h.swell_wave_period) : null;
      if (h.pressure_msl) for (let t = 0; t < nT; t++) if (h.pressure_msl[t] != null) PR[t * n + k] = h.pressure_msl[t];
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
    WM.grid = { ...g, key, T, nT, n, U, V, S: S2, P, PR, hasP: !isWave() && PR.some(x => !isNaN(x)) };
    const keep = prevT ? T.indexOf(prevT) : -1;
    WM.t = keep >= 0 ? keep : Math.max(0, T.indexOf(nowL));
    $('wmTime').max = nT - 1; $('wmTime').value = WM.t;
    $('wmStatus').textContent = '';
  } catch (e) { $('wmStatus').textContent = 'Données indisponibles (hors ligne ?)'; return; }
  paintTime(); drawHeat(); resetParticles(); refreshCondSoon();
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
  if (isWave()) return waveRGB(val);
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
  if (WM.iso && WM.grid.hasP) drawIsobars(c, W, H);
}

/* ---------- isobares + centres H / L ---------- */
function sampleP(lat, lon, t) {
  const g = WM.grid;
  const fx = (lon - g.w) / (g.e - g.w) * (g.cols - 1), fy = (lat - g.s) / (g.n - g.s) * (g.rows - 1);
  if (fx < 0 || fy < 0 || fx > g.cols - 1 || fy > g.rows - 1) return NaN;
  const x0 = Math.min(g.cols - 2, Math.floor(fx)), y0 = Math.min(g.rows - 2, Math.floor(fy)), dx = fx - x0, dy = fy - y0, b = t * g.n;
  const v = (x, y) => g.PR[b + y * g.cols + x];
  return v(x0, y0) * (1 - dx) * (1 - dy) + v(x0 + 1, y0) * dx * (1 - dy) + v(x0, y0 + 1) * (1 - dx) * dy + v(x0 + 1, y0 + 1) * dx * dy;
}
function drawIsobars(c, W, H) {
  const st = 14, nx = Math.ceil(W / st) + 1, ny = Math.ceil(H / st) + 1, F = new Float32Array(nx * ny);
  let lo = Infinity, hi = -Infinity;
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const ll = WM.map.containerPointToLatLng([x * st, y * st]), v = sampleP(ll.lat, ll.lng, WM.t);
    F[y * nx + x] = v; if (!isNaN(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  }
  if (!isFinite(lo)) return;
  const span = hi - lo, stepP = span > 24 ? 4 : span > 6 ? 2 : 1;
  c.save(); c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 1.2; c.font = 'bold 10px system-ui'; c.textAlign = 'center';
  const labels = [];
  for (let L0 = Math.ceil(lo / stepP) * stepP; L0 <= hi; L0 += stepP) {
    c.beginPath(); let seg = 0;
    for (let y = 0; y < ny - 1; y++) for (let x = 0; x < nx - 1; x++) {
      const a = F[y * nx + x], b = F[y * nx + x + 1], cc = F[(y + 1) * nx + x + 1], d = F[(y + 1) * nx + x];
      if (isNaN(a) || isNaN(b) || isNaN(cc) || isNaN(d)) continue;
      const pts = [];
      const edge = (v1, v2, x1, y1, x2, y2) => { if ((v1 < L0) !== (v2 < L0)) { const f = (L0 - v1) / (v2 - v1); pts.push([(x1 + (x2 - x1) * f) * st, (y1 + (y2 - y1) * f) * st]); } };
      edge(a, b, x, y, x + 1, y); edge(b, cc, x + 1, y, x + 1, y + 1); edge(cc, d, x + 1, y + 1, x, y + 1); edge(d, a, x, y + 1, x, y);
      for (let k = 0; k + 1 < pts.length; k += 2) {
        c.moveTo(pts[k][0], pts[k][1]); c.lineTo(pts[k + 1][0], pts[k + 1][1]); seg++;
        if (seg % 40 === 20) labels.push([pts[k][0], pts[k][1], L0]);
      }
    }
    c.stroke();
  }
  labels.forEach(([x, y, v]) => { c.fillStyle = 'rgba(6,20,31,.75)'; c.fillRect(x - 15, y - 7, 30, 13); c.fillStyle = '#fff'; c.fillText(Math.round(v), x, y + 3); });
  // centres de haute / basse pression sur la grille du modèle
  const g = WM.grid, b0 = WM.t * g.n;
  for (let r = 1; r < g.rows - 1; r++) for (let q = 1; q < g.cols - 1; q++) {
    const v = g.PR[b0 + r * g.cols + q]; if (isNaN(v)) continue;
    let isMax = true, isMin = true;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const w = g.PR[b0 + (r + dy) * g.cols + q + dx]; if (isNaN(w)) continue;
      if (w >= v) isMax = false; if (w <= v) isMin = false;
    }
    if (!isMax && !isMin) continue;
    const lat = g.s + r * (g.n - g.s) / (g.rows - 1), lon = g.w + q * (g.e - g.w) / (g.cols - 1);
    const p = WM.map.latLngToContainerPoint([lat, lon]);
    if (p.x < 0 || p.y < 0 || p.x > W || p.y > H) continue;
    c.fillStyle = isMin ? '#ff5d6c' : '#3b82f6'; c.beginPath(); c.arc(p.x, p.y, 13, 0, 7); c.fill();
    c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke();
    c.fillStyle = '#fff'; c.font = 'bold 14px system-ui'; c.fillText(isMin ? 'L' : 'H', p.x, p.y + 5);
    c.font = 'bold 10px system-ui'; c.fillText(Math.round(v), p.x, p.y + 25);
  }
  c.restore();
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
    if (!WM.anim2) { WM.part.getContext('2d').clearRect(0, 0, WM.part.width, WM.part.height); return; }
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
$('wmTime').oninput = () => { WM.t = +$('wmTime').value; paintTime(); drawHeat(); refreshCondSoon(); };
$('wmPlay').onclick = () => { if (WM.playing) stopPlay(); else startPlay(); };
function startPlay() {
  $('wmPlay').textContent = '❚❚';
  WM.playing = setInterval(() => {
    if (!WM.grid) return;
    WM.t = (WM.t + 1) % WM.grid.nT; $('wmTime').value = WM.t; paintTime(); drawHeat(); refreshCondSoon();
  }, 700);
}
function stopPlay() { clearInterval(WM.playing); WM.playing = null; $('wmPlay').textContent = '▶'; }

/* ---------- toucher la carte ---------- */
function wmTap(lat, lon) {
  const s = sample(lat, lon, WM.t); if (!s || !WM.grid) return;
  const dir = (Math.atan2(-s.u, -s.v) * 180 / Math.PI + 360) % 360;
  const val = isWave() ? `${s.s.toFixed(1)} m${s.p ? ' · ' + s.p.toFixed(1) + ' s' : ''}` : `${wf(s.s)} ${wUnit()}`;
  const dm = v => { const a = Math.abs(v), d = Math.floor(a); return `${d}° ${((a - d) * 60).toFixed(3)}`; };
  const coords = `${dm(lat)} ${lat >= 0 ? 'N' : 'S'} · ${dm(lon)} ${lon >= 0 ? 'E' : 'O'}`;
  const pop = L.popup({ maxWidth: 240 }).setLatLng([lat, lon]).setContent(`<div class="pop"><b>${WM_LAYERS[WM.layer]} ${val}</b> ${arrow(dir, '#06141f')} ${dirName(dir)} (${Math.round(dir)}°)<br><small>${dayLabel(WM.grid.T[WM.t].slice(0, 10))} · ${WM.grid.T[WM.t].slice(11, 16)}<br>${coords}</small><br><button class="btn small pri" id="wmGo">Prévisions ici</button> <button class="btn small" id="wmNew">＋ Spot</button></div>`).openOn(WM.map);
  setTimeout(() => {
    const go = document.getElementById('wmGo'), nw = document.getElementById('wmNew');
    if (go) go.onclick = async () => { WM.map.closePopup(); stopPlay(); stopAnim(); show('meteo'); setSpot({ name: (await reverseGeocode(lat, lon)) || `Point ${lat.toFixed(2)}, ${lon.toFixed(2)}`, lat, lon }); };
    if (nw) nw.onclick = () => { WM.map.closePopup(); createSpot(lat, lon); };
  }, 0);
}
document.addEventListener('visibilitychange', () => { if (document.hidden) stopPlay(); });
