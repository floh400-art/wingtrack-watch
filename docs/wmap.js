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
const WM_BASES = {
  dark: { l: 'Sombre', d: 'comme PredictWind', base: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', labels: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', att: '© Esri', nz: 16 },
  light: { l: 'Clair', d: 'plan gris clair', base: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', labels: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', att: '© Esri', nz: 16 },
  street: { l: 'Plan', d: 'rues et lieux', base: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', labels: null, att: '© Esri' },
  sat: { l: 'Satellite', d: 'photo', base: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', labels: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', att: '© Esri' },
};
// fond + noms par-dessus les couleurs (si le fond a une couche de noms séparée)
function baseLayers(b, pane, map) {
  const o = { maxZoom: 19, maxNativeZoom: b.nz || 19 };
  const ls = [L.tileLayer(b.base, { ...o, attribution: b.att }).addTo(map)];
  if (b.labels) ls.push(L.tileLayer(b.labels, { ...o, pane }).addTo(map));
  return ls;
}
function setWmBase() {
  if (!WM.map) return;
  (WM.baseLayers || []).forEach(l => l.remove());
  const b = WM_BASES[cfg.wmBase || 'dark'] || WM_BASES.dark;
  WM.baseLayers = baseLayers(b, 'wmLabels', WM.map);
}

/* ---------- palettes ---------- */
// vent : palette PredictWind définie dans meteo.js (WIND_STOPS / WIND_LUT / lut)
// vagues : palette PredictWind définie dans meteo.js (WAVE_STOPS / WAVE_LUT)
const isWave = () => WM.layer === 'wave' || WM.layer === 'swell';

/* ---------- ouverture ---------- */
function openWindMap() {
  show('wmap');
  if (!window.L) { $('wmMap').innerHTML = '<div class="empty" style="margin:40px 16px">Carte indisponible hors connexion</div>'; return; }
  if (!WM.map) {
    WM.map = L.map('wmMap', { zoomControl: false, zoomAnimation: false, attributionControl: true, maxZoom: 15 });
    const lp = WM.map.createPane ? WM.map.createPane('wmLabels') : null;
    if (lp) { lp.style.zIndex = 450; lp.style.pointerEvents = 'none'; }
    setWmBase();
    const pane = WM.map.getPanes().overlayPane;
    WM.heat = document.createElement('canvas'); WM.heat.className = 'wmcv';
    WM.part = document.createElement('canvas'); WM.part.className = 'wmcv';
    pane.appendChild(WM.heat); pane.appendChild(WM.part);
    WM.spotsLayer = L.layerGroup().addTo(WM.map);
    WM.map.on('moveend', () => { placeCanvases(); drawHeat(); resetParticles(); clearTimeout(WM.pending); WM.pending = setTimeout(loadGrid, 700); });
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
    <h3>Fond de carte</h3>
    <div class="wmp-grid four">${Object.entries(WM_BASES).map(([k, b]) => btn((cfg.wmBase || 'dark') === k, `data-b="${k}"`, `${b.l}<small>${b.d}</small>`)).join('')}</div>
    <h3>Transparence des couleurs</h3>
    <div class="wmp-op"><button class="${cfg.wmOpacity == null || cfg.wmOpacity === 'auto' ? 'on' : ''}" id="wmOpAuto">Auto (selon le zoom)</button>
      <input type="range" id="wmOp" min="20" max="90" step="5" value="${Math.round(heatOpacity() * 100)}"><span id="wmOpV">${Math.round(heatOpacity() * 100)} %</span></div>
    <h3>Affichage</h3>
    ${tog('wmIso', WM.iso, 'Isobares + centres H / L' + (isWave() ? ' <small>(couches vent)</small>' : ''))}
    ${tog('wmAnimT', WM.anim2, 'Traînées animées')}
    <h3>Unité</h3>
    <div class="wmp-grid four">${Object.keys(UNITS).map(u => btn(cfg.unit === u, `data-u="${u}"`, UNITS[u].l)).join('')}</div>`;
  const re = () => { WM.grid = null; renderWmBars(); loadGrid(); };
  document.querySelectorAll('#wmPanelBody [data-l]').forEach(b => b.onclick = () => { WM.layer = b.dataset.l; cfg.wmLayer = WM.layer; saveCfg(); re(); });
  document.querySelectorAll('#wmPanelBody [data-m]').forEach(b => b.onclick = () => { WM.model = b.dataset.m; cfg.wmModel = WM.model; saveCfg(); re(); });
  document.querySelectorAll('#wmPanelBody [data-r]').forEach(b => b.onclick = () => { WM.res = b.dataset.r; cfg.wmRes = WM.res; saveCfg(); re(); });
  document.querySelectorAll('#wmPanelBody [data-b]').forEach(b => b.onclick = () => { cfg.wmBase = b.dataset.b; saveCfg(); setWmBase(); renderWmPanel(); applyHeatOpacity(); });
  document.querySelectorAll('#wmPanelBody [data-u]').forEach(b => b.onclick = () => { cfg.unit = b.dataset.u; saveCfg(); renderWmBars(); paintTime(); });
  $('wmOp').oninput = () => { cfg.wmOpacity = +$('wmOp').value / 100; saveCfg(); $('wmOpV').textContent = $('wmOp').value + ' %'; $('wmOpAuto').classList.remove('on'); applyHeatOpacity(); };
  $('wmOpAuto').onclick = () => { cfg.wmOpacity = 'auto'; saveCfg(); renderWmPanel(); applyHeatOpacity(); };
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
// Grille fixe (« treillis ») : les points sont alignés sur des pas de latitude/longitude fixes et
// mémorisés, donc déplacer la carte ne recharge que les nouvelles cases.
const WM_PTS = new Map(); // clé → { at, h }
const LADDER = [0.01, 0.02, 0.03, 0.05, 0.08, 0.1, 0.15, 0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 3];
let gridBusy = false, gridAgain = false;
async function loadGrid() {
  if (!WM.map) return;
  if (gridBusy) { gridAgain = true; return; }
  gridBusy = true;
  try { await loadGridInner(); } finally { gridBusy = false; if (gridAgain) { gridAgain = false; loadGrid(); } }
}
async function loadGridInner() {
  const b = WM.map.getBounds(), z = WM.map.getZoom();
  const px = (WM_RES[WM.res] || WM_RES.normal).px;
  const target = px / (256 * Math.pow(2, z) / 360);        // degrés par point visés
  const S0 = b.getSouth(), N0 = b.getNorth(), W0 = b.getWest(), E0 = b.getEast();
  let step = LADDER.find(d => d >= target) || 3;
  const count = d => (Math.floor((N0 - S0) / d) + 3) * (Math.floor((E0 - W0) / d) + 3);
  while (count(step) > 420 && LADDER.indexOf(step) < LADDER.length - 1) step = LADDER[LADDER.indexOf(step) + 1];
  const r0 = Math.floor(S0 / step) - 1, r1 = Math.ceil(N0 / step) + 1, c0 = Math.floor(W0 / step) - 1, c1 = Math.ceil(E0 / step) + 1;
  const rows = r1 - r0 + 1, cols = c1 - c0 + 1;
  const kind = isWave() ? 'marine' : 'wind|' + WM.model;
  const pk = (r, c) => `${kind}|${step}|${r}|${c}`;
  const g = { s: r0 * step, N: r1 * step, w: c0 * step, e: c1 * step, cols, rows, layer: WM.layer, model: WM.model, step };
  const key = [WM.layer, kind, step, r0, r1, c0, c1].join('|');
  // points manquants (ou de plus d'une heure)
  const need = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const v = WM_PTS.get(pk(r, c)); if (!v || Date.now() - v.at > 3600e3) need.push([r, c]); }
  if (!need.length && WM.grid && WM.grid.key === key) return;
  if (need.length) {
    $('wmStatus').textContent = `Chargement… (${need.length} points)`;
    try {
      for (let i = 0; i < need.length; i += 100) {
        const part = need.slice(i, i + 100);
        const ll = `latitude=${part.map(([r]) => (r * step).toFixed(3)).join(',')}&longitude=${part.map(([, c]) => (c * step).toFixed(3)).join(',')}&forecast_days=7&timezone=GMT`;
        let j = isWave() ? await getJSON(`${MAR}?${ll}&hourly=wave_height,wave_direction,swell_wave_height,swell_wave_direction,wave_period,swell_wave_period`)
          : await getJSON(`${OM}?${ll}&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,pressure_msl${WM.model !== 'best' ? '&models=' + WM.model : ''}`);
        if (!Array.isArray(j)) j = [j];
        j.forEach((x, k) => WM_PTS.set(pk(part[k][0], part[k][1]), { at: Date.now(), h: x && x.hourly }));
        if (i + 100 < need.length) { assemble(); }
      }
      $('wmStatus').textContent = '';
    } catch (e) {
      $('wmStatus').textContent = e.message === '429' ? 'Trop de demandes : pause d\'une minute (limite gratuite Open-Meteo)' : 'Données indisponibles (hors ligne ?)';
      if (e.message === '429') setTimeout(loadGrid, 66e3);
    }
  }
  assemble();
  function assemble() {
    let first = null;
    for (let r = r0; r <= r1 && !first; r++) for (let c = c0; c <= c1; c++) { const v = WM_PTS.get(pk(r, c)); if (v && v.h && v.h.time) { first = v.h; break; } }
    if (!first) return;
    // heures en UTC → heure locale du téléphone pour l'affichage
    const off = -new Date().getTimezoneOffset() * 60;
    const T = first.time.map(t => new Date(Date.parse(t + ':00Z') + off * 1000).toISOString().slice(0, 16)), nT = T.length, n = rows * cols;
    const U = new Float32Array(nT * n).fill(NaN), V = new Float32Array(nT * n).fill(NaN), S2 = new Float32Array(nT * n).fill(NaN), P = new Float32Array(nT * n).fill(NaN), PR = new Float32Array(nT * n).fill(NaN);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const v = WM_PTS.get(pk(r, c)); if (!v || !v.h) continue;
      const h = v.h, k = (r - r0) * cols + (c - c0);
      const sp = isWave() ? (WM.layer === 'wave' ? h.wave_height : h.swell_wave_height) : (WM.layer === 'gust' ? h.wind_gusts_10m : h.wind_speed_10m);
      const dir = isWave() ? (WM.layer === 'wave' ? h.wave_direction : h.swell_wave_direction) : h.wind_direction_10m;
      const flow = isWave() ? h.wave_height : h.wind_speed_10m;
      const per = isWave() ? (WM.layer === 'wave' ? h.wave_period : h.swell_wave_period) : null;
      if (h.pressure_msl) for (let t = 0; t < nT; t++) if (h.pressure_msl[t] != null) PR[t * n + k] = h.pressure_msl[t];
      if (!sp || !dir) continue;
      for (let t = 0; t < nT; t++) {
        const val = sp[t], d = dir[t];
        if (val == null || d == null) continue;
        const i = t * n + k, f = isWave() ? 6 + val * 4 : (flow[t] || 0) / 3.6, a = d * Math.PI / 180;
        U[i] = -Math.sin(a) * f; V[i] = -Math.cos(a) * f; S2[i] = val;
        if (per && per[t] != null) P[i] = per[t];
      }
    }
    const nowL = new Date(Date.now() + off * 1000).toISOString().slice(0, 13) + ':00';
    const prevT = WM.grid && WM.grid.T[WM.t];
    WM.grid = { ...g, key, T, nT, n, U, V, S: S2, P, PR, hasP: !isWave() && PR.some(x => !isNaN(x)) };
    const keep = prevT ? T.indexOf(prevT) : -1;
    WM.t = keep >= 0 ? keep : Math.max(0, T.indexOf(nowL));
    $('wmTime').max = nT - 1; $('wmTime').value = WM.t;
    paintTime(); drawHeat(); resetParticles(); refreshCondSoon();
  }
}

/* ---------- interpolation ---------- */
function sample(lat, lon, t) {
  const g = WM.grid; if (!g) return null;
  const fx = (lon - g.w) / (g.e - g.w) * (g.cols - 1), fy = (lat - g.s) / (g.N - g.s) * (g.rows - 1);
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
  const step = 4, w = Math.ceil(W / step), h = Math.ceil(H / step);
  const off = document.createElement('canvas'); off.width = w; off.height = h;
  const oc = off.getContext('2d'), img = oc.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) {
    const ll0 = WM.map.containerPointToLatLng([0, y * step + step / 2]);
    for (let x = 0; x < w; x++) {
      const ll = x === 0 ? ll0 : WM.map.containerPointToLatLng([x * step + step / 2, y * step + step / 2]);
      const s = sample(ll.lat, ll.lng, WM.t), i = (y * w + x) * 4;
      if (!s) { d[i + 3] = 0; continue; }
      const col = colorOf(s.s); d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
    }
  }
  oc.putImageData(img, 0, 0);
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  c.drawImage(off, 0, 0, W, H);
  applyHeatOpacity();
  if (WM.iso && WM.grid.hasP) drawIsobars(c, W, H);
}

// Transparence : automatique selon le zoom (plus on zoome, plus on voit les côtes et les villes) ou réglée à la main
function heatOpacity() {
  if (cfg.wmOpacity != null && cfg.wmOpacity !== 'auto') return +cfg.wmOpacity;
  const z = WM.map ? WM.map.getZoom() : 6;
  return Math.max(0.35, Math.min(0.8, 0.8 - (z - 6) * 0.075));
}
function applyHeatOpacity() {
  if (!WM.heat) return;
  WM.heat.style.opacity = heatOpacity();
  // fonds clairs : les couleurs se mélangent au plan (routes, côtes, noms restent lisibles)
  WM.heat.style.mixBlendMode = (cfg.wmBase === 'light' || cfg.wmBase === 'street') ? 'multiply' : 'normal';
}

/* ---------- isobares + centres H / L ---------- */
function sampleP(lat, lon, t) {
  const g = WM.grid;
  const fx = (lon - g.w) / (g.e - g.w) * (g.cols - 1), fy = (lat - g.s) / (g.N - g.s) * (g.rows - 1);
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
    const lat = g.s + r * (g.N - g.s) / (g.rows - 1), lon = g.w + q * (g.e - g.w) / (g.cols - 1);
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
