'use strict';
/* =========================================================================
   WingTrack — Météo : modèles de vent, rafales, houle, marée, créneaux wing
   Données : Open-Meteo (gratuit, sans clé) — forecast, marine, geocoding
   ========================================================================= */
const MODELS = [
  { id: 'avg', name: 'Moyenne', desc: 'moyenne des modèles disponibles (direction moyennée en vecteur)' },
  { id: 'meteofrance_seamless', name: 'AROME', desc: 'Météo-France · 1,3 km (puis ARPEGE)' },
  { id: 'icon_seamless', name: 'ICON', desc: 'DWD Allemagne · 2 à 7 km' },
  { id: 'ecmwf_ifs025', name: 'ECMWF', desc: 'Centre européen · 25 km' },
  { id: 'gfs_seamless', name: 'GFS', desc: 'NOAA États-Unis · 13 à 25 km' },
  { id: 'ukmo_seamless', name: 'UKMO', desc: 'Met Office · 2 à 10 km' },
];
const MCOL = { avg: '#ffffff', meteofrance_seamless: '#22d3c5', icon_seamless: '#ffb84d', ecmwf_ifs025: '#60a5fa', gfs_seamless: '#c084fc', ukmo_seamless: '#a3e635' };
const M = { spot: null, model: cfg.meteoModel || 'avg', day: 0, data: null, loading: false, map: null, mk: null, chartGeom: null, tideGeom: null };
if (cfg.wmin == null) cfg.wmin = 12;
if (cfg.wmax == null) cfg.wmax = 30;

/* ---------- unités ---------- */
const KN = 1.852;
const wUnit = () => uLabel();
const wv = kmh => kmh == null ? null : kmh / 3.6 * curU().f;
const wf = kmh => kmh == null ? '–' : Math.round(wv(kmh));
const kn = kmh => kmh == null ? null : kmh / KN;
// palette PredictWind (relevée sur leur échelle) : nœuds → couleur
const WIND_STOPS = [[0, [100, 25, 229]], [2.7, [100, 25, 229]], [4.3, [66, 43, 247]], [5.1, [49, 52, 251]], [5.9, [47, 74, 215]], [6.7, [48, 99, 182]], [7.4, [49, 121, 146]], [8.2, [50, 145, 113]], [9.0, [49, 168, 78]], [9.8, [49, 192, 42]], [11.4, [99, 204, 26]], [13.0, [152, 210, 14]], [14.6, [206, 217, 3]], [16.2, [229, 197, 0]], [17.8, [239, 168, 0]], [19.4, [250, 138, 0]], [21.0, [255, 104, 1]], [22.5, [255, 63, 0]], [24.1, [255, 23, 0]], [25.7, [246, 1, 0]], [27.3, [230, 0, 0]], [28.9, [213, 1, 0]], [30.5, [195, 0, 0]], [32.1, [180, 2, 2]], [33.7, [164, 0, 0]], [35.2, [148, 0, 0]], [36.8, [130, 0, 0]], [38.4, [116, 0, 0]], [40.0, [102, 0, 0]], [41.6, [85, 0, 0]], [43.2, [78, 0, 0]], [45, [70, 0, 0]], [47.5, [125, 101, 100]], [50, [179, 168, 167]], [55, [214, 208, 207]]];
function lut(stops, max, steps) {
  const out = new Uint8ClampedArray(steps * 3);
  for (let k = 0; k < steps; k++) {
    const v = k / (steps - 1) * max;
    let i = 0; while (i < stops.length - 2 && v > stops[i + 1][0]) i++;
    const [a, ca] = stops[i], [b, cb] = stops[i + 1], f = Math.max(0, Math.min(1, (v - a) / (b - a)));
    for (let c = 0; c < 3; c++) out[k * 3 + c] = ca[c] + (cb[c] - ca[c]) * f;
  }
  return out;
}
const WIND_LUT = lut(WIND_STOPS, 55, 551); // pas de 0,1 nœud
// palette vagues PredictWind (relevée sur leur échelle 1 à 10 m)
const WAVE_STOPS = [[0, [152, 0, 205]], [0.27, [145, 1, 212]], [0.4, [138, 0, 217]], [0.54, [130, 0, 220]], [0.67, [108, 13, 229]], [0.8, [83, 27, 236]], [0.93, [60, 43, 245]], [1.07, [35, 57, 254]], [1.2, [22, 79, 254]], [1.33, [16, 104, 254]], [1.46, [9, 128, 254]], [1.6, [1, 152, 255]], [1.73, [0, 167, 246]], [1.86, [0, 176, 233]], [1.99, [0, 187, 220]], [2.13, [0, 197, 206]], [2.26, [0, 201, 191]], [2.39, [0, 204, 177]], [2.52, [0, 207, 163]], [2.66, [0, 210, 149]], [2.79, [17, 213, 131]], [2.92, [57, 219, 110]], [3.05, [95, 223, 87]], [3.19, [133, 228, 66]], [3.32, [166, 230, 48]], [3.45, [181, 229, 49]], [3.58, [200, 224, 48]], [3.72, [216, 223, 49]], [3.85, [231, 219, 49]], [3.98, [231, 207, 47]], [4.11, [231, 195, 47]], [4.25, [230, 184, 46]], [4.38, [231, 174, 45]], [4.51, [233, 162, 44]], [4.64, [236, 151, 42]], [4.77, [237, 141, 39]], [4.91, [241, 130, 41]], [5.04, [242, 113, 45]], [5.17, [247, 99, 53]], [5.3, [248, 80, 54]], [5.44, [251, 63, 61]], [5.57, [249, 49, 75]], [5.7, [247, 34, 90]], [5.83, [245, 21, 109]], [5.97, [242, 4, 124]], [6.1, [242, 0, 112]], [6.23, [248, 0, 88]], [6.36, [248, 0, 60]], [6.5, [251, 0, 36]], [6.63, [254, 0, 10]], [6.76, [248, 0, 0]], [6.89, [238, 0, 0]], [7.03, [228, 0, 1]], [7.16, [215, 0, 0]], [7.29, [204, 0, 1]], [7.42, [193, 1, 0]], [7.56, [184, 0, 0]], [7.69, [174, 0, 1]], [7.82, [164, 0, 0]], [7.95, [154, 0, 0]], [8.09, [145, 0, 0]], [8.22, [135, 0, 0]], [8.35, [124, 0, 0]], [8.48, [114, 0, 0]], [8.62, [104, 0, 0]], [8.75, [95, 0, 0]], [8.88, [84, 0, 0]], [9.01, [74, 0, 1]], [9.15, [64, 0, 0]], [9.54, [64, 28, 30]], [9.81, [84, 68, 68]], [10.07, [100, 100, 100]], [12, [100, 100, 100]]];
const WAVE_LUT = lut(WAVE_STOPS, 12, 1201); // pas de 1 cm
function waveRGB(m) { const k = Math.max(0, Math.min(1200, Math.round(m * 100))); return [WAVE_LUT[k * 3], WAVE_LUT[k * 3 + 1], WAVE_LUT[k * 3 + 2]]; }
function windRGB(kmh) { const k = Math.max(0, Math.min(550, Math.round(kmh / KN * 10))); return [WIND_LUT[k * 3], WIND_LUT[k * 3 + 1], WIND_LUT[k * 3 + 2]]; }
function windColor(kmh) {
  if (kmh == null) return 'transparent';
  return 'rgb(' + windRGB(kmh).join(',') + ')';
}
const windTxt = kmh => kmh != null && kn(kmh) >= 9.5 && kn(kmh) < 21 ? '#06141f' : '#fff';
const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
const dirName = d => d == null ? '' : DIRS[Math.round(d / 22.5) % 16];
const arrow = (d, col = 'currentColor') => d == null ? '' : `<span class="arr" style="transform:rotate(${d + 180}deg);color:${col}">↑</span>`;
function wxIcon(code, night) {
  if (code == null) return '';
  if (code <= 1) return night ? '🌙' : '☀️';
  if (code === 2) return night ? '☁️' : '🌤️';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if (code >= 51 && code <= 57) return '🌦️';
  if (code >= 61 && code <= 67) return '🌧️';
  if (code >= 71 && code <= 77) return '🌨️';
  if (code >= 80 && code <= 82) return '🌦️';
  if (code >= 85 && code <= 86) return '🌨️';
  if (code >= 95) return '⛈️';
  return '☁️';
}
// heures "locales du spot" traitées comme UTC naïves : tout reste cohérent sans fuseau
const tms = t => Date.parse(t + ':00Z');
const hh = t => t.slice(11, 13) + 'h';
const DAYS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
const dayLabel = d => { const x = new Date(d + 'T12:00:00Z'); return DAYS[x.getUTCDay()] + ' ' + x.getUTCDate(); };
const hm = ms => new Date(ms).toISOString().slice(11, 16).replace(':', 'h');

/* ---------- récupération des données ---------- */
const OM = 'https://api.open-meteo.com/v1/forecast';
const MAR = 'https://marine-api.open-meteo.com/v1/marine';
async function getJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(r.status); return r.json(); }
async function fetchAll(spot) {
  const ll = `latitude=${spot.lat.toFixed(4)}&longitude=${spot.lon.toFixed(4)}&timezone=auto&forecast_days=7`;
  const hv = 'wind_speed_10m,wind_gusts_10m,wind_direction_10m,temperature_2m,weather_code,precipitation';
  const SRC = MODELS.filter(m => m.id !== 'avg');
  const reqs = SRC.map(m => getJSON(`${OM}?${ll}&hourly=${hv}&daily=sunrise,sunset&models=${m.id}`).then(j => [m.id, j]).catch(() => [m.id, null]));
  const waves = getJSON(`${MAR}?${ll}&hourly=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_period,swell_wave_direction`).catch(() => null);
  const tide = getJSON(`${MAR}?${ll}&hourly=sea_level_height_msl,sea_surface_temperature`).catch(() => null);
  const res = await Promise.all([...reqs, waves, tide]);
  const models = {};
  let daily = null, offset = 0, time = null;
  res.slice(0, SRC.length).forEach(([id, j]) => {
    if (!j || !j.hourly || !j.hourly.time) return;
    const h = j.hourly;
    if (!h.wind_speed_10m || h.wind_speed_10m.every(v => v == null)) return;
    models[id] = { time: h.time, ws: h.wind_speed_10m, wg: h.wind_gusts_10m || [], wd: h.wind_direction_10m || [], temp: h.temperature_2m || [], code: h.weather_code || [], rain: h.precipitation || [] };
    if (!time || h.time.length > time.length) time = h.time;
    if (!daily && j.daily) daily = j.daily;
    offset = j.utc_offset_seconds || offset;
  });
  if (!time) throw new Error('Aucun modèle disponible');
  const wj = res[SRC.length], tj = res[SRC.length + 1];
  const marine = {};
  if (wj && wj.hourly) { const h = wj.hourly; Object.assign(marine, { time: h.time, wh: h.wave_height, wp: h.wave_period, wdir: h.wave_direction, sh: h.swell_wave_height, sp: h.swell_wave_period, sd: h.swell_wave_direction }); }
  if (tj && tj.hourly) { const h = tj.hourly; marine.ttime = h.time; marine.tide = h.sea_level_height_msl; marine.sst = h.sea_surface_temperature; }
  const hasWaves = marine.wh && marine.wh.some(v => v != null);
  const hasTide = marine.tide && marine.tide.some(v => v != null);
  return { models, time, daily, offset, marine, hasWaves, hasTide, fetched: Date.now() };
}
// modèle "Moyenne" : moyenne des modèles dispo à chaque heure ; direction en moyenne vectorielle
function ensureAvg(d) {
  const ids = Object.keys(d.models).filter(id => id !== 'avg');
  if (!ids.length) return;
  const maps = ids.map(id => idxMap(d.models[id].time));
  const ws = [], wg = [], wd = [], temp = [], code = [], rain = [], spread = [];
  d.time.forEach(t => {
    let sw = 0, sg = 0, ng = 0, n = 0, x = 0, y = 0, st = 0, nt = 0, sr = 0, nr = 0, lo = Infinity, hi = -Infinity, cd = null;
    ids.forEach((id, k) => {
      const m = d.models[id], i = maps[k].get(t); if (i == null) return;
      const w = m.ws[i]; if (w == null) return;
      sw += w; n++; lo = Math.min(lo, w); hi = Math.max(hi, w);
      if (m.wg[i] != null) { sg += m.wg[i]; ng++; }
      if (m.wd[i] != null) { const a = m.wd[i] * Math.PI / 180; x += Math.sin(a) * w; y += Math.cos(a) * w; }
      if (m.temp[i] != null) { st += m.temp[i]; nt++; }
      if (m.rain[i] != null) { sr += m.rain[i]; nr++; }
      if (cd == null && m.code[i] != null) cd = m.code[i];
    });
    ws.push(n ? sw / n : null); wg.push(ng ? sg / ng : null);
    wd.push(n ? (Math.atan2(x, y) * 180 / Math.PI + 360) % 360 : null);
    temp.push(nt ? st / nt : null); rain.push(nr ? sr / nr : null); code.push(cd);
    spread.push(n > 1 ? hi - lo : null);
  });
  d.models.avg = { time: d.time, ws, wg, wd, temp, code, rain, spread, n: ids.length };
}
const modelIds = d => ['avg', ...Object.keys(d.models).filter(id => id !== 'avg')].filter(id => d.models[id]);
const mName = id => (MODELS.find(m => m.id === id) || { name: id }).name;
// valeur d'une série à l'heure t (les modèles n'ont pas tous la même grille)
function at(series, times, t) { if (!series || !times) return null; const i = times.indexOf(t); return i < 0 ? null : series[i]; }
function idxMap(times) { const m = new Map(); (times || []).forEach((t, i) => m.set(t, i)); return m; }

/* ---------- marée : pleines et basses mers ---------- */
function tideExtrema(times, h) {
  const out = [];
  if (!times || !h) return out;
  for (let i = 1; i < h.length - 1; i++) {
    const a = h[i - 1], b = h[i], c = h[i + 1];
    if (a == null || b == null || c == null) continue;
    const high = b > a && b >= c, low = b < a && b <= c;
    if (!high && !low) continue;
    const den = a - 2 * b + c;
    const off = den !== 0 ? 0.5 * (a - c) / den : 0;           // interpolation parabolique (en heures)
    const val = b - 0.25 * (a - c) * off;
    out.push({ type: high ? 'PM' : 'BM', ms: tms(times[i]) + off * 3600e3, h: val });
  }
  return out;
}

/* ---------- créneaux navigables ---------- */
function slots(d, model) {
  const m = d.models[model] || d.models[Object.keys(d.models)[0]]; if (!m) return [];
  const sun = {};
  if (d.daily) d.daily.time.forEach((day, k) => sun[day] = [tms(d.daily.sunrise[k]), tms(d.daily.sunset[k])]);
  const nowL = Date.now() + d.offset * 1000;
  const ok = [];
  m.time.forEach((t, i) => {
    const ms = tms(t), s = sun[t.slice(0, 10)];
    const day = s ? ms >= s[0] && ms + 3600e3 <= s[1] + 1800e3 : (+t.slice(11, 13) >= 8 && +t.slice(11, 13) <= 18);
    const w = kn(m.ws[i]), g = kn(m.wg[i]);
    ok.push(ms + 3600e3 > nowL && day && w != null && w >= cfg.wmin && w <= cfg.wmax && (g == null || g <= cfg.wmax + 10));
  });
  const res = [];
  let s0 = -1;
  for (let i = 0; i <= ok.length; i++) {
    if (i < ok.length && ok[i]) { if (s0 < 0) s0 = i; continue; }
    if (s0 >= 0 && i - s0 >= 2) {
      const ws = m.ws.slice(s0, i).map(kn), gs = m.wg.slice(s0, i).map(kn), dirs = m.wd.slice(s0, i);
      const mid = dirs[Math.floor(dirs.length / 2)];
      res.push({ day: m.time[s0].slice(0, 10), from: m.time[s0], to: m.time[i - 1], hours: i - s0, wmin: Math.min(...ws), wmax: Math.max(...ws), gmax: Math.max(...gs.filter(x => x != null), 0), dir: mid });
    }
    s0 = -1;
  }
  return res;
}

/* ---------- rendu ---------- */
async function renderMeteo(force) {
  paintUnitBtn();
  if (!M.spot) M.spot = cfg.meteoSpot || null;
  await renderSpotChips();
  renderModelBar();
  if (!M.spot) { $('mxBody').innerHTML = '<div class="empty">Choisis un spot : une de tes sessions, ta position, une recherche ou la carte.</div>'; showSpotMap(); return; }
  $('mxSpot').innerHTML = `${esc(M.spot.name)} <button class="star ${isFav(M.spot) ? 'on' : ''}" id="mxFav">${isFav(M.spot) ? '★' : '☆'}</button>`;
  $('mxFav').onclick = toggleFav;
  const key = 'wt_fc_' + M.spot.lat.toFixed(3) + ',' + M.spot.lon.toFixed(3);
  if (!M.data || M.data.key !== key || force || Date.now() - M.data.fetched > 30 * 60e3) {
    // prévision en cache (utile au spot sans réseau)
    try { const c = JSON.parse(localStorage.getItem(key) || 'null'); if (c && (!M.data || M.data.key !== key)) { M.data = c; drawMeteo(); } } catch (e) {}
    M.loading = true; $('mxStatus').textContent = 'Mise à jour des prévisions…';
    try {
      const d = await fetchAll(M.spot); d.key = key; M.data = d;
      try { localStorage.setItem(key, JSON.stringify(d)); } catch (e) {}
    } catch (e) {
      if (!M.data || M.data.key !== key) { $('mxBody').innerHTML = '<div class="empty">Prévisions indisponibles (pas de réseau ?). Réessaie plus tard.</div>'; $('mxStatus').textContent = ''; M.loading = false; showSpotMap(); return; }
      toast('Hors ligne : dernières prévisions enregistrées');
    }
    M.loading = false;
  }
  drawMeteo();
  showSpotMap();
}
function drawMeteo() {
  const d = M.data; if (!d) return;
  ensureAvg(d);
  const ageMin = Math.round((Date.now() - d.fetched) / 60000);
  $('mxStatus').textContent = `Mis à jour ${ageMin < 1 ? 'à l\'instant' : 'il y a ' + (ageMin < 60 ? ageMin + ' min' : Math.round(ageMin / 60) + ' h')} · ${Object.keys(d.models).filter(id => id !== 'avg').length} modèles · Open-Meteo`;
  if (M.model !== 'compare' && !d.models[M.model]) M.model = Object.keys(d.models)[0];
  renderModelBar();
  const days = [...new Set(d.time.map(t => t.slice(0, 10)))].slice(0, 7);
  if (M.day >= days.length) M.day = 0;
  // créneaux
  const sl = slots(d, M.model === 'compare' ? 'avg' : M.model);
  const slHtml = sl.length ? sl.slice(0, 5).map(s => `<div class="slot" data-day="${days.indexOf(s.day)}"><b>${dayLabel(s.day)}</b> ${hh(s.from)}–${+s.to.slice(11, 13) + 1}h <span class="grow"></span><span class="pill" style="background:${windColor(s.wmax * KN)};color:${windTxt(s.wmax * KN)}">${Math.round(wv(s.wmin * KN))}–${Math.round(wv(s.wmax * KN))} ${wUnit()}</span> ${arrow(s.dir)} ${dirName(s.dir)}</div>`).join('')
    : `<div class="cap" style="margin:0">Aucun créneau entre ${Math.round(wv(cfg.wmin * KN))} et ${Math.round(wv(cfg.wmax * KN))} ${wUnit()} en journée sur 7 jours.</div>`;
  const tex = d.hasTide ? tideExtrema(d.marine.ttime, d.marine.tide) : [];
  const day = days[M.day];
  const dayTides = tex.filter(x => new Date(x.ms).toISOString().slice(0, 10) === day);
  $('mxBody').innerHTML = `
    <h2>Créneaux navigables</h2>
    <div class="slots">${slHtml}</div>
    <p class="cap">Vent moyen entre <b class="wr" id="wrMin">${Math.round(wv(cfg.wmin * KN))}</b> et <b class="wr" id="wrMax">${Math.round(wv(cfg.wmax * KN))}</b> ${wUnit()}, de jour · touche les chiffres pour régler</p>
    <div class="days">${days.map((x, k) => `<button class="${k === M.day ? 'on' : ''}" data-k="${k}">${dayLabel(x)}${dayHasSlot(sl, x) ? '<i></i>' : ''}</button>`).join('')}</div>
    ${tableHtml(d, day)}
    ${dayTides.length ? `<div class="tides">${dayTides.map(x => `<span><b>${x.type === 'PM' ? 'Pleine mer' : 'Basse mer'}</b> ${hm(x.ms)} · ${x.h.toFixed(1)} m</span>`).join('')}</div>` : ''}
    <h2>Vent sur 7 jours</h2>
    <canvas id="mxChart" class="cv" style="height:210px"></canvas>
    <p class="cap tip" id="mxChartInfo"></p>
    <div class="mlegend">${(M.model === 'compare' ? modelIds(d) : [M.model]).map(id => `<span><i style="background:${MCOL[id]}"></i>${mName(id)}</span>`).join('')}${M.model !== 'compare' ? '<span><i style="background:rgba(255,255,255,.25)"></i>Rafales</span>' : ''}</div>
    ${d.hasTide ? `<h2>Marée</h2><canvas id="mxTide" class="cv" style="height:150px"></canvas><p class="cap tip" id="mxTideInfo"></p><p class="cap">Hauteur d'eau calculée par modèle (indicative) : vérifie l'annuaire officiel (SHOM) pour les spots à fort marnage.</p>` : ''}
    ${d.hasWaves ? `<h2>Vagues sur 7 jours</h2><canvas id="mxWave" class="cv" style="height:150px"></canvas><p class="cap tip" id="mxWaveInfo"></p>` : ''}
    <h2>Modèles</h2>
    <div class="note">${MODELS.map(m => `<b style="color:${MCOL[m.id]}">${m.name}</b> ${m.desc}${d.models[m.id] ? '' : ' · <i>indisponible ici</i>'}`).join('<br>')}<br><br>La ligne « Écart » donne la différence entre le modèle le plus faible et le plus fort : petit écart = prévision fiable. AROME est le plus précis sur les côtes françaises à 2 jours.</div>`;
  document.querySelectorAll('.days button').forEach(b => b.onclick = () => { M.day = +b.dataset.k; drawMeteo(); });
  document.querySelectorAll('.slot').forEach(b => b.onclick = () => { if (+b.dataset.day >= 0) { M.day = +b.dataset.day; drawMeteo(); } });
  $('wrMin').onclick = () => setRange('wmin'); $('wrMax').onclick = () => setRange('wmax');
  drawWindChart(-1); if (d.hasTide) drawTideChart(-1); if (d.hasWaves) drawWaveChart(-1);
  const tw = document.querySelector('.tblwrap');
  const now = tw && tw.querySelector('.now');
  if (now) { const th = tw.querySelector('th'); tw.scrollLeft = now.offsetLeft - (th ? th.offsetWidth : 70) - 6; }
}
const dayHasSlot = (sl, day) => sl.some(s => s.day === day);
async function setRange(k) {
  const cur = Math.round(wv(cfg[k] * KN));
  const ok = await ask(k === 'wmin' ? `Vent minimum pour naviguer (${wUnit()})` : `Vent maximum (${wUnit()})`, { extra: `<input type="number" id="wrIn" value="${cur}" style="margin-bottom:14px">` });
  if (!ok) return;
  const v = +$('wrIn').value; if (!isFinite(v) || v <= 0) return;
  cfg[k] = v / curU().f * 1.943844; saveCfg(); drawMeteo(); // stocké en nœuds
}
function tableHtml(d, day) {
  const base = d.time.filter(t => t.startsWith(day));
  if (!base.length) return '';
  const nowL = new Date(Date.now() + d.offset * 1000).toISOString().slice(0, 13) + ':00';
  const sun = d.daily ? d.daily.time.indexOf(day) : -1;
  const sr = sun >= 0 ? tms(d.daily.sunrise[sun]) : null, ss = sun >= 0 ? tms(d.daily.sunset[sun]) : null;
  const night = t => sr != null ? (tms(t) + 1800e3 < sr || tms(t) > ss) : (+t.slice(11, 13) < 7 || +t.slice(11, 13) > 19);
  const cols = base.filter(t => +t.slice(11, 13) >= 5 && +t.slice(11, 13) <= 22);
  const cls = t => (t === nowL ? ' now' : '') + (night(t) ? ' night' : '');
  const row = (label, cell, extraCls = '') => `<tr class="${extraCls}"><th>${label}</th>${cols.map(t => cell(t)).join('')}</tr>`;
  const mk = M.model === 'compare' ? null : d.models[M.model];
  let rows = row('', t => `<td class="hd${cls(t)}">${hh(t)}</td>`, 'hrow');
  const ref = mk || d.models.avg || d.models[Object.keys(d.models)[0]];
  rows += row('', t => { const c = at(ref.code, ref.time, t), tp = at(ref.temp, ref.time, t); return `<td class="${cls(t)}">${wxIcon(c, night(t))}<small>${tp == null ? '' : Math.round(tp) + '°'}</small></td>`; });
  const windCell = (m, t) => { const w = at(m.ws, m.time, t); return `<td class="w${cls(t)}" style="background:${windColor(w)};color:${windTxt(w)}">${wf(w)}</td>`; };
  if (mk) {
    rows += row(`Vent<small>${wUnit()}</small>`, t => windCell(mk, t));
    rows += row('Rafales', t => windCell({ ws: mk.wg, time: mk.time }, t));
    rows += row('Dir.', t => { const dd = at(mk.wd, mk.time, t); return `<td class="${cls(t)}">${arrow(dd)}<small>${dirName(dd)}</small></td>`; });
    if (M.model === 'avg') rows += row(`Écart<small>${wUnit()}</small>`, t => { const v = at(mk.spread, mk.time, t); const k = v == null ? null : kn(v); return `<td class="${cls(t)}" style="color:${k == null ? '' : k < 4 ? '#7ccf3c' : k < 8 ? '#e6d23a' : '#ec4b4b'}">${v == null ? '–' : '±' + Math.round(wv(v) / 2)}</td>`; });
  } else {
    modelIds(d).forEach(id => {
      const m = d.models[id];
      rows += row(`<span style="color:${MCOL[id]}">${mName(id)}</span>`, t => {
        const w = at(m.ws, m.time, t), g = at(m.wg, m.time, t), dd = at(m.wd, m.time, t);
        return `<td class="w cmp${cls(t)}" style="background:${windColor(w)};color:${windTxt(w)}">${wf(w)}<small>${g == null ? '' : wf(g)}</small>${dd == null ? '' : `<span class="arr mini" style="transform:rotate(${dd + 180}deg)">↑</span>`}</td>`;
      });
    });
  }
  if (d.hasWaves) {
    const mr = d.marine;
    rows += row('Vagues<small>m</small>', t => { const v = at(mr.wh, mr.time, t); return `<td class="${cls(t)}">${v == null ? '–' : v.toFixed(1)}</td>`; }, 'sep');
    rows += row('Période<small>s</small>', t => { const v = at(mr.wp, mr.time, t); return `<td class="${cls(t)}">${v == null ? '–' : Math.round(v)}</td>`; });
    rows += row('Dir. vagues', t => `<td class="${cls(t)}">${arrow(at(mr.wdir, mr.time, t), '#60a5fa')}</td>`);
    rows += row('Houle<small>m · s</small>', t => { const v = at(mr.sh, mr.time, t), p = at(mr.sp, mr.time, t); return `<td class="${cls(t)}">${v == null ? '–' : v.toFixed(1)}<small>${p == null ? '' : Math.round(p) + 's'}</small></td>`; });
  }
  if (d.hasTide) {
    const mr = d.marine;
    rows += row('Marée<small>m</small>', t => { const v = at(mr.tide, mr.ttime, t); return `<td class="${cls(t)}">${v == null ? '–' : v.toFixed(1)}</td>`; }, 'sep');
    const sst = mr.sst && mr.sst.find(v => v != null);
    if (sst != null) rows += row('Eau<small>°C</small>', t => { const v = at(mr.sst, mr.ttime, t); return `<td class="${cls(t)}">${v == null ? '–' : Math.round(v)}</td>`; });
  }
  if (mk) rows += row('Pluie<small>mm</small>', t => { const v = at(mk.rain, mk.time, t); return `<td class="${cls(t)}">${v ? v.toFixed(1) : ''}</td>`; });
  return `<div class="tblwrap"><table class="fc">${rows}</table></div>`;
}

/* ---------- graphiques ---------- */
function drawWindChart(cur) {
  const d = M.data; if (!d || !$('mxChart')) return;
  const { c, W, H } = prep('mxChart');
  const T = d.time, n = T.length, ids = M.model === 'compare' ? modelIds(d) : [M.model];
  const pad = { l: 26, r: 8, t: 12, b: 20 }, w = W - pad.l - pad.r, h = H - pad.t - pad.b;
  let vmax = 10;
  ids.forEach(id => { const m = d.models[id]; m.ws.concat(M.model === 'compare' ? [] : m.wg).forEach(v => { if (v != null) vmax = Math.max(vmax, wv(v)); }); });
  vmax = Math.ceil(vmax / 5) * 5;
  const X = i => pad.l + i / (n - 1) * w, Y = v => pad.t + h - wv(v) / vmax * h;
  M.chartGeom = { pad, w, n };
  // nuits (grisées)
  if (d.daily) d.daily.time.forEach((day, k) => {
    const d0 = T.indexOf(day + 'T00:00'); if (d0 < 0) return;
    const base = tms(day + 'T00:00'), sr = d0 + (tms(d.daily.sunrise[k]) - base) / 3600e3, ss = d0 + (tms(d.daily.sunset[k]) - base) / 3600e3;
    c.fillStyle = 'rgba(0,0,0,.28)';
    c.fillRect(X(d0), pad.t, X(Math.min(n - 1, sr)) - X(d0), h);
    if (ss < n - 1) c.fillRect(X(ss), pad.t, X(Math.min(n - 1, d0 + 24)) - X(ss), h);
  });
  // plage navigable
  c.fillStyle = 'rgba(34,211,197,.07)';
  const yA = pad.t + h - wv(cfg.wmax * KN) / vmax * h, yB = pad.t + h - wv(cfg.wmin * KN) / vmax * h;
  c.fillRect(pad.l, Math.max(pad.t, yA), w, yB - Math.max(pad.t, yA));
  c.strokeStyle = '#183a50'; c.fillStyle = '#86a6b8';
  const step = vmax > 40 ? 10 : 5;
  for (let v = 0; v <= vmax; v += step) { const y = pad.t + h - v / vmax * h; c.beginPath(); c.moveTo(pad.l, y); c.lineTo(W - pad.r, y); c.stroke(); c.fillText(v, 3, y + 3); }
  T.forEach((t, i) => { if (t.endsWith('T00:00')) { c.strokeStyle = '#2a516a'; c.beginPath(); c.moveTo(X(i), pad.t); c.lineTo(X(i), pad.t + h); c.stroke(); c.fillStyle = '#86a6b8'; c.fillText(dayLabel(t.slice(0, 10)), X(i) + 3, H - 6); } });
  const line = (arr, col, lw, dash) => {
    c.beginPath(); let on = false;
    T.forEach((t, i) => { const v = at(arr.s, arr.t, t); if (v == null) { on = false; return; } if (!on) { c.moveTo(X(i), Y(v)); on = true; } else c.lineTo(X(i), Y(v)); });
    c.strokeStyle = col; c.lineWidth = lw; c.setLineDash(dash || []); c.stroke(); c.setLineDash([]); c.lineWidth = 1;
  };
  ids.forEach(id => {
    const m = d.models[id]; if (!m) return;
    if (M.model !== 'compare') {
      // zone rafales
      c.beginPath(); let started = false; const pts = [];
      T.forEach((t, i) => { const a = at(m.ws, m.time, t), g = at(m.wg, m.time, t); if (a != null && g != null) pts.push([i, a, g]); });
      pts.forEach(([i, a, g], k) => { if (!k) c.moveTo(X(i), Y(g)); else c.lineTo(X(i), Y(g)); });
      pts.slice().reverse().forEach(([i, a]) => c.lineTo(X(i), Y(a)));
      c.closePath(); c.fillStyle = 'rgba(255,255,255,.13)'; c.fill(); void started;
    }
    line({ s: m.ws, t: m.time }, MCOL[id], M.model === 'compare' ? (id === 'avg' ? 3 : 1.4) : 2.2);
  });
  // maintenant
  const nowL = new Date(Date.now() + d.offset * 1000).toISOString().slice(0, 13) + ':00', ni = T.indexOf(nowL);
  if (ni >= 0) { c.strokeStyle = '#fff'; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(X(ni), pad.t); c.lineTo(X(ni), pad.t + h); c.stroke(); c.setLineDash([]); }
  if (cur >= 0) {
    const t = T[cur], x = X(cur);
    c.strokeStyle = '#fff'; c.beginPath(); c.moveTo(x, pad.t); c.lineTo(x, pad.t + h); c.stroke();
    const lines = [`${dayLabel(t.slice(0, 10))} · ${hh(t)}`];
    ids.forEach(id => {
      const m = d.models[id], a = at(m.ws, m.time, t), g = at(m.wg, m.time, t), dd = at(m.wd, m.time, t);
      if (a == null) return;
      c.fillStyle = MCOL[id]; c.beginPath(); c.arc(x, Y(a), 3.5, 0, 7); c.fill();
      lines.push(`${mName(id)} ${wf(a)}${g != null ? ' (raf. ' + wf(g) + ')' : ''} ${wUnit()} ${dirName(dd)}`);
    });
    bubble(c, x, pad.t + 30, lines, W, H);
    $('mxChartInfo').textContent = lines.join(' · ');
  } else $('mxChartInfo').textContent = 'Glisse le doigt sur le graphique pour lire les valeurs';
}
function drawTideChart(cur) {
  const d = M.data; if (!d || !$('mxTide')) return;
  const { c, W, H } = prep('mxTide');
  const T = d.marine.ttime, V = d.marine.tide, n = T.length;
  const vals = V.filter(v => v != null); if (!vals.length) return;
  const lo = Math.min(...vals), hi = Math.max(...vals), span = Math.max(0.5, hi - lo);
  const pad = { l: 30, r: 8, t: 16, b: 20 }, w = W - pad.l - pad.r, h = H - pad.t - pad.b;
  const X = i => pad.l + i / (n - 1) * w, Y = v => pad.t + h - (v - lo) / span * h;
  M.tideGeom = { pad, w, n };
  c.fillStyle = '#86a6b8'; c.strokeStyle = '#183a50';
  [lo, (lo + hi) / 2, hi].forEach(v => { const y = Y(v); c.beginPath(); c.moveTo(pad.l, y); c.lineTo(W - pad.r, y); c.stroke(); c.fillText((Math.abs(v) < 0.05 ? 0 : v).toFixed(1), 2, y + 3); });
  T.forEach((t, i) => { if (t.endsWith('T00:00')) { c.strokeStyle = '#2a516a'; c.beginPath(); c.moveTo(X(i), pad.t); c.lineTo(X(i), pad.t + h); c.stroke(); c.fillText(dayLabel(t.slice(0, 10)), X(i) + 3, H - 6); } });
  c.beginPath(); let on = false;
  V.forEach((v, i) => { if (v == null) { on = false; return; } if (!on) { c.moveTo(X(i), Y(v)); on = true; } else c.lineTo(X(i), Y(v)); });
  c.strokeStyle = '#60a5fa'; c.lineWidth = 2; c.stroke(); c.lineWidth = 1;
  const t0 = tms(T[0]);
  tideExtrema(T, V).forEach(x => {
    const i = (x.ms - t0) / 3600e3; if (i < 0 || i > n - 1) return;
    c.fillStyle = x.type === 'PM' ? '#60a5fa' : '#86a6b8'; c.beginPath(); c.arc(X(i), Y(x.h), 2.5, 0, 7); c.fill();
  });
  const nowL = new Date(Date.now() + d.offset * 1000).toISOString().slice(0, 13) + ':00', ni = T.indexOf(nowL);
  if (ni >= 0) { c.strokeStyle = '#fff'; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(X(ni), pad.t); c.lineTo(X(ni), pad.t + h); c.stroke(); c.setLineDash([]); }
  if (cur >= 0 && V[cur] != null) {
    const x = X(cur), t = T[cur];
    const rising = cur < n - 1 && V[cur + 1] != null ? V[cur + 1] > V[cur] : null;
    const next = tideExtrema(T, V).find(e => e.ms > tms(t));
    const lines = [`${dayLabel(t.slice(0, 10))} · ${hh(t)} · ${V[cur].toFixed(2)} m`, rising == null ? '' : rising ? 'Marée montante' : 'Marée descendante'];
    if (next) lines.push(`${next.type === 'PM' ? 'Pleine mer' : 'Basse mer'} à ${hm(next.ms)}`);
    c.fillStyle = '#fff'; c.beginPath(); c.arc(x, Y(V[cur]), 4, 0, 7); c.fill();
    bubble(c, x, Y(V[cur]), lines.filter(Boolean), W, H);
    $('mxTideInfo').textContent = lines.filter(Boolean).join(' · ');
  } else $('mxTideInfo').textContent = 'Touche la courbe pour l\'heure et le sens de la marée';
}
function drawWaveChart(cur) {
  const d = M.data; if (!d || !$('mxWave')) return;
  const { c, W, H } = prep('mxWave');
  const mr = d.marine, T = mr.time, n = T.length;
  const vals = mr.wh.concat(mr.sh || []).filter(v => v != null); if (!vals.length) return;
  const hi = Math.max(0.5, Math.ceil(Math.max(...vals) * 2) / 2);
  const pad = { l: 30, r: 8, t: 12, b: 20 }, w = W - pad.l - pad.r, h = H - pad.t - pad.b;
  const X = i => pad.l + i / (n - 1) * w, Y = v => pad.t + h - v / hi * h;
  M.waveGeom = { pad, w, n };
  c.fillStyle = '#86a6b8'; c.strokeStyle = '#183a50';
  [0, hi / 2, hi].forEach(v => { const y = Y(v); c.beginPath(); c.moveTo(pad.l, y); c.lineTo(W - pad.r, y); c.stroke(); c.fillText(v.toFixed(1) + 'm', 2, y + 3); });
  T.forEach((t, i) => { if (t.endsWith('T00:00')) { c.strokeStyle = '#2a516a'; c.beginPath(); c.moveTo(X(i), pad.t); c.lineTo(X(i), pad.t + h); c.stroke(); c.fillText(dayLabel(t.slice(0, 10)), X(i) + 3, H - 6); } });
  const ln = (arr, col, fill) => {
    c.beginPath(); let first = -1, last = -1;
    arr.forEach((v, i) => { if (v == null) return; if (first < 0) { c.moveTo(X(i), Y(v)); first = i; } else c.lineTo(X(i), Y(v)); last = i; });
    if (fill && first >= 0) { c.lineTo(X(last), Y(0)); c.lineTo(X(first), Y(0)); c.closePath(); c.fillStyle = fill; c.fill(); }
    else { c.strokeStyle = col; c.lineWidth = 2; c.stroke(); c.lineWidth = 1; }
  };
  ln(mr.wh, null, 'rgba(96,165,250,.35)');
  if (mr.sh) ln(mr.sh, '#ffb84d');
  if (cur >= 0) {
    const t = T[cur], x = X(cur);
    c.strokeStyle = '#fff'; c.beginPath(); c.moveTo(x, pad.t); c.lineTo(x, pad.t + h); c.stroke();
    const lines = [`${dayLabel(t.slice(0, 10))} · ${hh(t)}`,
      `Vagues ${mr.wh[cur] == null ? '–' : mr.wh[cur].toFixed(1) + ' m'} · ${mr.wp[cur] == null ? '' : Math.round(mr.wp[cur]) + ' s'} ${dirName(mr.wdir[cur])}`,
      mr.sh ? `Houle ${mr.sh[cur] == null ? '–' : mr.sh[cur].toFixed(1) + ' m'} · ${mr.sp[cur] == null ? '' : Math.round(mr.sp[cur]) + ' s'} ${dirName(mr.sd[cur])}` : ''];
    bubble(c, x, pad.t + 20, lines.filter(Boolean), W, H);
    $('mxWaveInfo').textContent = lines.filter(Boolean).join(' · ');
  } else $('mxWaveInfo').textContent = 'Bleu : hauteur des vagues · orange : houle';
}
function bindCharts() {
  const idx = (geom, x) => Math.max(0, Math.min(geom.n - 1, Math.round((x - geom.pad.l) / geom.w * (geom.n - 1))));
  document.addEventListener('pointerdown', ev => handle(ev), true);
  document.addEventListener('pointermove', ev => { if (ev.buttons || ev.pointerType === 'touch') handle(ev); }, true);
  function handle(ev) {
    const id = ev.target && ev.target.id; if (!M.data) return;
    const r = ev.target.getBoundingClientRect && ev.target.getBoundingClientRect(), x = r ? ev.clientX - r.left : 0;
    if (id === 'mxChart' && M.chartGeom) drawWindChart(idx(M.chartGeom, x));
    if (id === 'mxTide' && M.tideGeom) drawTideChart(idx(M.tideGeom, x));
    if (id === 'mxWave' && M.waveGeom) drawWaveChart(idx(M.waveGeom, x));
  }
}
bindCharts();

/* ---------- mes spots ---------- */
const favs = () => cfg.favSpots || [];
const sameSpot = (a, b) => a && b && Math.abs(a.lat - b.lat) < 0.005 && Math.abs(a.lon - b.lon) < 0.005;
const isFav = s => favs().some(f => sameSpot(f, s));
const saveSpots = list => { cfg.favSpots = list; saveCfg(); M.quick = null; };
function toggleFav() {
  if (isFav(M.spot)) saveSpots(favs().filter(x => !sameSpot(x, M.spot)));
  else saveSpots(favs().concat([{ name: M.spot.name, lat: M.spot.lat, lon: M.spot.lon }]));
  renderMeteo();
}
function setSpot(s) {
  M.spot = { name: s.name, lat: +s.lat, lon: +s.lon }; M.day = 0;
  cfg.meteoSpot = M.spot; saveCfg(); renderMeteo();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
async function createSpot(lat, lon, suggested) {
  if (lat == null) { // pas de point choisi : on demande où
    const ok = await ask('Où se trouve le nouveau spot ?', { ok: '📍 Ma position', no: '🗺️ Sur la carte' });
    if (ok) return hereThen((la, lo) => createSpot(la, lo));
    M.pickMode = true; toast('Touche la carte à l\'endroit du spot');
    $('mxMap').scrollIntoView({ behavior: 'smooth', block: 'center' }); return;
  }
  const name0 = suggested || (await reverseGeocode(lat, lon)) || '';
  const ok = await ask('Nom du nouveau spot', { ok: 'Créer', extra: `<input type="text" id="nsName" value="${esc(name0)}" placeholder="ex. Plage du Prévost" style="margin-bottom:14px">` });
  if (!ok) return;
  const name = $('nsName').value.trim() || name0 || 'Mon spot';
  saveSpots(favs().filter(f => !sameSpot(f, { lat, lon })).concat([{ name, lat, lon }]));
  toast('Spot créé'); setSpot({ name, lat, lon });
}
async function editSpot(k) {
  const f = favs()[k]; if (!f) return;
  let del = false;
  const p = ask(`Spot « ${f.name} »`, { ok: 'Renommer', extra: `<input type="text" id="esName" value="${esc(f.name)}" style="margin-bottom:10px"><button class="btn red" id="esDel" style="width:100%;margin-bottom:14px">Supprimer ce spot</button>` });
  $('esDel').onclick = () => { del = true; $('mNo').click(); };
  const ok = await p;
  const list = favs().slice();
  if (del) { list.splice(k, 1); saveSpots(list); toast('Spot supprimé'); }
  else if (ok) { list[k] = { ...f, name: $('esName').value.trim() || f.name }; saveSpots(list); if (sameSpot(M.spot, f)) { M.spot.name = list[k].name; cfg.meteoSpot = M.spot; saveCfg(); } }
  renderMeteo();
}
function hereThen(fn) {
  if (!navigator.geolocation) return toast('Localisation indisponible');
  toast('Localisation…');
  navigator.geolocation.getCurrentPosition(p => fn(p.coords.latitude, p.coords.longitude), () => toast('Localisation refusée'), { enableHighAccuracy: false, timeout: 15000 });
}
// aperçu rapide de tous les spots (une seule requête multi-points, meilleur modèle dispo)
async function quickFetch(list) {
  if (!list.length) return [];
  const key = list.map(s => s.lat.toFixed(3) + ',' + s.lon.toFixed(3)).join('|');
  if (M.quick && M.quick.key === key && Date.now() - M.quick.at < 30 * 60e3) return M.quick.res;
  const url = `${OM}?latitude=${list.map(s => s.lat.toFixed(4)).join(',')}&longitude=${list.map(s => s.lon.toFixed(4)).join(',')}&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m&daily=sunrise,sunset&timezone=auto&forecast_days=3`;
  let j = await getJSON(url); if (!Array.isArray(j)) j = [j];
  M.quick = { key, at: Date.now(), res: j };
  try { localStorage.setItem('wt_quick', JSON.stringify(M.quick)); } catch (e) {}
  return j;
}
function quickSummary(j) {
  const h = j.hourly, off = j.utc_offset_seconds || 0;
  const nowL = new Date(Date.now() + off * 1000).toISOString().slice(0, 13) + ':00';
  const i = Math.max(0, h.time.indexOf(nowL));
  const sun = {}; if (j.daily) j.daily.time.forEach((d, k) => sun[d] = [tms(j.daily.sunrise[k]), tms(j.daily.sunset[k])]);
  let next = null;
  for (let k = i; k < h.time.length - 1; k++) {
    const t = h.time[k], s = sun[t.slice(0, 10)], ms = tms(t);
    const day = s ? ms >= s[0] && ms + 3600e3 <= s[1] + 1800e3 : true;
    const ok = w => w != null && kn(w) >= cfg.wmin && kn(w) <= cfg.wmax;
    if (day && ok(h.wind_speed_10m[k]) && ok(h.wind_speed_10m[k + 1])) { next = t; break; }
  }
  return { w: h.wind_speed_10m[i], g: h.wind_gusts_10m[i], d: h.wind_direction_10m[i], next };
}
async function renderSpotList() {
  const list = favs();
  if (!list.length) { $('mxSpotList').innerHTML = '<div class="empty" style="padding:16px">Crée tes spots pour les consulter d\'un coup d\'œil : bouton « + Créer un spot », l\'étoile ☆ d\'un spot, ou touche la carte.</div>'; return; }
  const card = (s, k, q) => {
    const sm = q ? quickSummary(q) : null;
    const nowTxt = sm && sm.w != null ? `<span class="pill" style="background:${windColor(sm.w)};color:${windTxt(sm.w)}">${wf(sm.w)}</span><small> raf. ${wf(sm.g)} ${wUnit()}</small> ${arrow(sm.d)}<small>${dirName(sm.d)}</small>` : '<small>…</small>';
    const nx = sm ? (sm.next ? `✅ ${sm.next === quickNowKey(q) ? 'Navigable maintenant' : 'Navigable ' + dayLabel(sm.next.slice(0, 10)) + ' ' + hh(sm.next)}` : '— pas de créneau sur 3 j') : '';
    return `<div class="scard ${M.spot && sameSpot(s, M.spot) ? 'on' : ''}" data-k="${k}"><div class="row"><b class="grow">${esc(s.name)}</b><button class="dots" data-e="${k}">⋯</button></div><div class="snow">${nowTxt}</div><div class="snext">${nx}</div></div>`;
  };
  let cached = null;
  try { const c = JSON.parse(localStorage.getItem('wt_quick') || 'null'); if (c && c.res && c.res.length === list.length) cached = c.res; } catch (e) {}
  const paint = res => {
    $('mxSpotList').innerHTML = list.map((s, k) => card(s, k, res && res[k])).join('');
    document.querySelectorAll('#mxSpotList .scard').forEach(el => el.onclick = e => { if (e.target.dataset.e != null) return; setSpot(list[+el.dataset.k]); });
    document.querySelectorAll('#mxSpotList [data-e]').forEach(b => b.onclick = e => { e.stopPropagation(); editSpot(+b.dataset.e); });
  };
  paint(cached);
  try { paint(await quickFetch(list)); } catch (e) {}
}
const quickNowKey = j => new Date(Date.now() + (j.utc_offset_seconds || 0) * 1000).toISOString().slice(0, 13) + ':00';
async function renderSpotChips() {
  renderSpotList();
  let mine = [];
  try { mine = groupSpots(await DB.all()).sort((a, b) => b.last - a.last).map(sp => ({ name: sp.name, lat: sp.c[0], lon: sp.c[1] })); } catch (e) {}
  M.sessionSpots = mine;
  const list = mine.filter(s => !isFav(s));
  $('mxChips').innerHTML = `<button class="chip2 add" id="mxNew">＋ Créer un spot</button><button class="chip2" id="mxHere">📍 Ma position</button><button class="chip2" id="mxFind">🔍 Chercher</button>`
    + list.map((s, k) => `<button class="chip2 ${M.spot && sameSpot(s, M.spot) ? 'on' : ''}" data-k="${k}">🏄 ${esc(s.name)}</button>`).join('');
  document.querySelectorAll('#mxChips [data-k]').forEach(b => b.onclick = () => setSpot(list[+b.dataset.k]));
  $('mxNew').onclick = () => createSpot();
  $('mxHere').onclick = () => hereThen(async (la, lo) => setSpot({ name: (await reverseGeocode(la, lo)) || 'Ma position', lat: la, lon: lo }));
  $('mxFind').onclick = () => { $('mxSearch').style.display = $('mxSearch').style.display === 'none' ? '' : 'none'; $('mxQ').focus(); };
}
let searchT = null;
$('mxQ').oninput = () => {
  clearTimeout(searchT);
  const q = $('mxQ').value.trim();
  if (q.length < 2) { $('mxRes').innerHTML = ''; return; }
  searchT = setTimeout(async () => {
    try {
      const j = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=fr`);
      const r = j.results || [];
      $('mxRes').innerHTML = r.length ? r.map((x, k) => `<div class="ev" data-k="${k}"><span class="grow"><b>${esc(x.name)}</b> <small>${esc([x.admin1, x.country].filter(Boolean).join(', '))}</small></span></div>`).join('') : '<div class="empty">Aucun résultat</div>';
      document.querySelectorAll('#mxRes [data-k]').forEach(el => el.onclick = () => { const x = r[+el.dataset.k]; $('mxSearch').style.display = 'none'; $('mxQ').value = ''; $('mxRes').innerHTML = ''; setSpot({ name: x.name, lat: x.latitude, lon: x.longitude }); });
    } catch (e) { $('mxRes').innerHTML = '<div class="empty">Recherche indisponible hors ligne</div>'; }
  }, 350);
};
function renderModelBar() {
  const avail = M.data ? Object.keys(M.data.models) : MODELS.map(m => m.id);
  $('mxModels').innerHTML = MODELS.filter(m => avail.includes(m.id)).map(m => `<button class="${M.model === m.id ? 'on' : ''}" data-m="${m.id}">${m.name}</button>`).join('') + `<button class="${M.model === 'compare' ? 'on' : ''}" data-m="compare">Comparer</button>`;
  document.querySelectorAll('#mxModels button').forEach(b => b.onclick = () => { M.model = b.dataset.m; cfg.meteoModel = M.model; saveCfg(); drawMeteo(); });
}
/* ---------- carte : spots, point touché, flèches façon Windy ---------- */
const FIELD = { off: 'Off', wind: 'Vent', gust: 'Rafales', wave: 'Vagues', swell: 'Houle' };
M.field = cfg.meteoField || 'wind';
function waveColor(m) { return m == null ? 'transparent' : 'rgb(' + waveRGB(m).join(',') + ')'; }
function showSpotMap() {
  if (!window.L) return;
  if (!M.map) {
    M.map = makeMap('mxMap'); if (!M.map) return;
    M.spotLayer = L.layerGroup().addTo(M.map);
    M.fieldLayer = L.layerGroup().addTo(M.map);
    M.map.on('click', e => onMapTap(e.latlng.lat, e.latlng.lng));
    M.map.on('moveend', () => { clearTimeout(M.gridT); M.gridT = setTimeout(loadField, 500); });
    renderFieldBar();
  }
  setTimeout(() => M.map.invalidateSize(), 60);
  drawSpotMarkers();
  if (M.spot && !M.centered) { M.map.setView([M.spot.lat, M.spot.lon], 10); M.centered = true; }
  else loadField();
}
function drawSpotMarkers() {
  if (!M.spotLayer) return;
  M.spotLayer.clearLayers();
  const add = (s, cls, label) => {
    const icon = L.divIcon({ className: '', html: `<div class="smk ${cls}">${label}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] });
    L.marker([s.lat, s.lon], { icon, zIndexOffset: cls === 'cur' ? 1000 : 500 }).addTo(M.spotLayer)
      .bindTooltip(esc(s.name), { permanent: cls !== 'ses', direction: 'right', offset: [12, 0], className: 'stip' })
      .on('click', ev => { L.DomEvent.stopPropagation(ev); onMapTap(s.lat, s.lon, s.name); });
  };
  (M.sessionSpots || []).filter(s => !isFav(s)).forEach(s => add(s, 'ses', '🏄'));
  favs().forEach(s => add(s, M.spot && sameSpot(s, M.spot) ? 'cur' : 'fav', '★'));
  if (M.spot && !isFav(M.spot)) add(M.spot, 'cur', '●');
}
async function onMapTap(lat, lon, knownName) {
  if (M.pickMode) { M.pickMode = false; return createSpot(lat, lon); }
  const pop = L.popup({ maxWidth: 260 }).setLatLng([lat, lon]).setContent('<div class="pop">Chargement…</div>').openOn(M.map);
  let html = '';
  try {
    const ll = `latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&timezone=auto&forecast_days=7`;
    const [f, m, name] = await Promise.all([
      getJSON(`${OM}?${ll}&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,temperature_2m`),
      getJSON(`${MAR}?${ll}&hourly=wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction`).catch(() => null),
      knownName ? Promise.resolve(knownName) : reverseGeocode(lat, lon),
    ]);
    const t = fieldTime() || new Date(Date.now() + (f.utc_offset_seconds || 0) * 1000).toISOString().slice(0, 13) + ':00';
    const i = Math.max(0, f.hourly.time.indexOf(t)), h = f.hourly;
    const w = h.wind_speed_10m[i], g = h.wind_gusts_10m[i], d = h.wind_direction_10m[i];
    html = `<b>${esc(name || `Point ${lat.toFixed(2)}, ${lon.toFixed(2)}`)}</b><br><small>${dayLabel(t.slice(0, 10))} · ${hh(t)}</small><br>`
      + `Vent <span class="pill" style="background:${windColor(w)};color:${windTxt(w)}">${wf(w)}</span> raf. ${wf(g)} ${wUnit()} ${arrow(d, '#06141f')} ${dirName(d)}`;
    if (m && m.hourly) {
      const mh = m.hourly, k = mh.time.indexOf(t);
      if (k >= 0 && mh.wave_height[k] != null) html += `<br>Vagues ${mh.wave_height[k].toFixed(1)} m · ${Math.round(mh.wave_period[k])} s ${dirName(mh.wave_direction[k])}<br>Houle ${mh.swell_wave_height[k] == null ? '–' : mh.swell_wave_height[k].toFixed(1) + ' m · ' + Math.round(mh.swell_wave_period[k]) + ' s ' + dirName(mh.swell_wave_direction[k])}`;
    }
    M.tapName = name;
  } catch (e) { html = `<b>Point ${lat.toFixed(2)}, ${lon.toFixed(2)}</b><br><small>Prévisions indisponibles hors ligne</small>`; }
  html += `<br><button class="btn small pri" id="tpGo">Prévisions ici</button> ${isFav({ lat, lon }) ? '' : '<button class="btn small" id="tpNew">＋ Spot</button>'}`;
  pop.setContent(`<div class="pop">${html}</div>`);
  const go = document.getElementById('tpGo'), nw = document.getElementById('tpNew');
  if (go) go.onclick = () => { M.map.closePopup(); setSpot({ name: knownName || M.tapName || `Point ${lat.toFixed(2)}, ${lon.toFixed(2)}`, lat, lon }); };
  if (nw) nw.onclick = () => { M.map.closePopup(); createSpot(lat, lon, knownName || M.tapName); };
}
function renderFieldBar() {
  $('mxLayer').innerHTML = Object.entries(FIELD).map(([k, v]) => `<button class="${M.field === k ? 'on' : ''}" data-f="${k}">${v}</button>`).join('');
  document.querySelectorAll('#mxLayer button').forEach(b => b.onclick = () => { M.field = b.dataset.f; cfg.meteoField = M.field; saveCfg(); renderFieldBar(); loadField(); });
  $('mxTimeBox').style.display = M.field === 'off' ? 'none' : '';
}
const fieldTime = () => M.grid && M.grid.time ? M.grid.time[+$('mxTime').value] : null;
async function loadField() {
  if (!M.map || M.field === 'off') { if (M.fieldLayer) M.fieldLayer.clearLayers(); return; }
  const b = M.map.getBounds(), sz = M.map.getSize();
  const cols = Math.max(4, Math.round(sz.x / 62)), rows = Math.max(4, Math.round(sz.y / 62));
  const S = b.getSouth(), N = b.getNorth(), Wst = b.getWest(), E = b.getEast();
  const lats = [], lons = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { lats.push(S + (r + 0.5) * (N - S) / rows); lons.push(Wst + (c + 0.5) * (E - Wst) / cols); }
  const marine = M.field === 'wave' || M.field === 'swell';
  const key = [marine, lats[0].toFixed(3), lons[0].toFixed(3), lats[lats.length - 1].toFixed(3), lons[lons.length - 1].toFixed(3), lats.length].join('|');
  if (M.grid && M.grid.key === key) return drawField();
  $('mxTimeLbl').textContent = 'Chargement…';
  const ll = `latitude=${lats.map(x => x.toFixed(3)).join(',')}&longitude=${lons.map(x => x.toFixed(3)).join(',')}&forecast_days=7&timezone=auto`;
  const model = M.model !== 'avg' && M.model !== 'compare' ? `&models=${M.model}` : '';
  try {
    let j = marine ? await getJSON(`${MAR}?${ll}&hourly=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period`)
      : await getJSON(`${OM}?${ll}&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m${model}`);
    if (!Array.isArray(j)) j = [j];
    const first = j.find(x => x && x.hourly);
    const prevT = fieldTime();
    M.grid = { key, marine, pts: j.map((x, k) => ({ lat: lats[k], lon: lons[k], h: x && x.hourly })), time: first.hourly.time, off: first.utc_offset_seconds || 0 };
    const sl = $('mxTime'); sl.max = M.grid.time.length - 1;
    const nowL = new Date(Date.now() + M.grid.off * 1000).toISOString().slice(0, 13) + ':00';
    const keep = prevT ? M.grid.time.indexOf(prevT) : -1;
    sl.value = keep >= 0 ? keep : Math.max(0, M.grid.time.indexOf(nowL));
    drawField();
  } catch (e) { $('mxTimeLbl').textContent = 'Flèches indisponibles (hors ligne ?)'; }
}
function drawField() {
  if (!M.grid || !M.fieldLayer) return;
  M.fieldLayer.clearLayers();
  const i = +$('mxTime').value, t = M.grid.time[i];
  $('mxTimeLbl').textContent = `${dayLabel(t.slice(0, 10))} · ${hh(t)} · ${FIELD[M.field]}${M.grid.marine ? '' : ' (' + (M.model !== 'avg' && M.model !== 'compare' ? mName(M.model) : 'meilleur modèle') + ')'}`;
  M.grid.pts.forEach(p => {
    if (!p.h) return;
    let v, d, col, txt, sub = '';
    if (M.field === 'wind' || M.field === 'gust') {
      v = M.field === 'wind' ? p.h.wind_speed_10m[i] : p.h.wind_gusts_10m[i]; d = p.h.wind_direction_10m[i];
      if (v == null) return; col = windColor(v); txt = wf(v);
    } else if (M.field === 'wave') {
      v = p.h.wave_height[i]; d = p.h.wave_direction[i]; if (v == null) return;
      col = waveColor(v); txt = v.toFixed(1); sub = p.h.wave_period[i] == null ? '' : Math.round(p.h.wave_period[i]) + 's';
    } else {
      v = p.h.swell_wave_height[i]; d = p.h.swell_wave_direction[i]; if (v == null) return;
      col = waveColor(v); txt = v.toFixed(1); sub = p.h.swell_wave_period[i] == null ? '' : Math.round(p.h.swell_wave_period[i]) + 's';
    }
    const tc = (M.field === 'wind' || M.field === 'gust') ? windTxt(v) : (v >= 0.9 && v < 4.6 ? '#06141f' : '#fff');
    const icon = L.divIcon({ className: '', html: `<div class="fa" style="--c:${col};--t:${tc}">${d == null ? '<b>•</b>' : `<svg viewBox="0 0 24 24" style="transform:rotate(${d + 180}deg)"><path d="M12 2l7 10h-4.5v10h-5V12H5z"/></svg>`}<i>${txt}${sub ? '<small>' + sub + '</small>' : ''}</i></div>`, iconSize: [40, 44], iconAnchor: [20, 22] });
    L.marker([p.lat, p.lon], { icon, interactive: false, zIndexOffset: -100 }).addTo(M.fieldLayer);
  });
}
$('mxTime').oninput = drawField;
$('mxRefresh').onclick = () => renderMeteo(true);
$('mxBig').onclick = $('mxBig2').onclick = () => openWindMap();
// changement d'unité rapide : km/h → nœuds → m/s → mph
const UORDER = ['kmh', 'kn', 'ms', 'mph'];
function paintUnitBtn() { $('mxUnit').textContent = curU().l; }
$('mxUnit').onclick = () => {
  cfg.unit = UORDER[(UORDER.indexOf(cfg.unit) + 1) % UORDER.length] || 'kmh'; saveCfg();
  paintUnitBtn(); toast('Unité : ' + curU().name);
  if (M.data) drawMeteo(); renderSpotList(); drawField();
};
paintUnitBtn();
