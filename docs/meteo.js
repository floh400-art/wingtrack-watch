'use strict';
/* =========================================================================
   WingTrack — Météo : modèles de vent, rafales, houle, marée, créneaux wing
   Données : Open-Meteo (gratuit, sans clé) — forecast, marine, geocoding
   ========================================================================= */
const MODELS = [
  { id: 'meteofrance_seamless', name: 'AROME', desc: 'Météo-France · 1,3 km (puis ARPEGE)' },
  { id: 'icon_seamless', name: 'ICON', desc: 'DWD Allemagne · 2 à 7 km' },
  { id: 'ecmwf_ifs025', name: 'ECMWF', desc: 'Centre européen · 25 km' },
  { id: 'gfs_seamless', name: 'GFS', desc: 'NOAA États-Unis · 13 à 25 km' },
  { id: 'ukmo_seamless', name: 'UKMO', desc: 'Met Office · 2 à 10 km' },
];
const MCOL = { meteofrance_seamless: '#22d3c5', icon_seamless: '#ffb84d', ecmwf_ifs025: '#60a5fa', gfs_seamless: '#c084fc', ukmo_seamless: '#a3e635' };
const M = { spot: null, model: cfg.meteoModel || 'meteofrance_seamless', day: 0, data: null, loading: false, map: null, mk: null, chartGeom: null, tideGeom: null };
if (cfg.wmin == null) cfg.wmin = 12;
if (cfg.wmax == null) cfg.wmax = 30;

/* ---------- unités ---------- */
const KN = 1.852;
const wUnit = () => cfg.unit === 'kn' ? 'nds' : 'km/h';
const wv = kmh => kmh == null ? null : cfg.unit === 'kn' ? kmh / KN : kmh;
const wf = kmh => kmh == null ? '–' : Math.round(wv(kmh));
const kn = kmh => kmh == null ? null : kmh / KN;
function windColor(kmh) {
  if (kmh == null) return 'transparent';
  const k = kn(kmh);
  return k < 6 ? '#1d3b52' : k < 10 ? '#2f6f8f' : k < 14 ? '#2bb39a' : k < 18 ? '#7ccf3c' : k < 22 ? '#e6d23a' : k < 27 ? '#f39c34' : k < 33 ? '#ec4b4b' : '#b23bd1';
}
const windTxt = kmh => kmh != null && kn(kmh) >= 10 && kn(kmh) < 27 ? '#06141f' : '#fff';
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
  const reqs = MODELS.map(m => getJSON(`${OM}?${ll}&hourly=${hv}&daily=sunrise,sunset&models=${m.id}`).then(j => [m.id, j]).catch(() => [m.id, null]));
  const waves = getJSON(`${MAR}?${ll}&hourly=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_period,swell_wave_direction`).catch(() => null);
  const tide = getJSON(`${MAR}?${ll}&hourly=sea_level_height_msl,sea_surface_temperature`).catch(() => null);
  const res = await Promise.all([...reqs, waves, tide]);
  const models = {};
  let daily = null, offset = 0, time = null;
  res.slice(0, MODELS.length).forEach(([id, j]) => {
    if (!j || !j.hourly || !j.hourly.time) return;
    const h = j.hourly;
    if (!h.wind_speed_10m || h.wind_speed_10m.every(v => v == null)) return;
    models[id] = { time: h.time, ws: h.wind_speed_10m, wg: h.wind_gusts_10m || [], wd: h.wind_direction_10m || [], temp: h.temperature_2m || [], code: h.weather_code || [], rain: h.precipitation || [] };
    if (!time || h.time.length > time.length) time = h.time;
    if (!daily && j.daily) daily = j.daily;
    offset = j.utc_offset_seconds || offset;
  });
  if (!time) throw new Error('Aucun modèle disponible');
  const wj = res[MODELS.length], tj = res[MODELS.length + 1];
  const marine = {};
  if (wj && wj.hourly) { const h = wj.hourly; Object.assign(marine, { time: h.time, wh: h.wave_height, wp: h.wave_period, wdir: h.wave_direction, sh: h.swell_wave_height, sp: h.swell_wave_period, sd: h.swell_wave_direction }); }
  if (tj && tj.hourly) { const h = tj.hourly; marine.ttime = h.time; marine.tide = h.sea_level_height_msl; marine.sst = h.sea_surface_temperature; }
  const hasWaves = marine.wh && marine.wh.some(v => v != null);
  const hasTide = marine.tide && marine.tide.some(v => v != null);
  return { models, time, daily, offset, marine, hasWaves, hasTide, fetched: Date.now() };
}
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
  const ageMin = Math.round((Date.now() - d.fetched) / 60000);
  $('mxStatus').textContent = `Mis à jour ${ageMin < 1 ? 'à l\'instant' : 'il y a ' + (ageMin < 60 ? ageMin + ' min' : Math.round(ageMin / 60) + ' h')} · ${Object.keys(d.models).length} modèles · Open-Meteo`;
  if (M.model !== 'compare' && !d.models[M.model]) M.model = Object.keys(d.models)[0];
  renderModelBar();
  const days = [...new Set(d.time.map(t => t.slice(0, 10)))].slice(0, 7);
  if (M.day >= days.length) M.day = 0;
  // créneaux
  const sl = slots(d, M.model === 'compare' ? Object.keys(d.models)[0] : M.model);
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
    <div class="mlegend">${(M.model === 'compare' ? Object.keys(d.models) : [M.model]).map(id => `<span><i style="background:${MCOL[id]}"></i>${MODELS.find(m => m.id === id).name}</span>`).join('')}${M.model !== 'compare' ? '<span><i style="background:rgba(255,255,255,.25)"></i>Rafales</span>' : ''}</div>
    ${d.hasTide ? `<h2>Marée</h2><canvas id="mxTide" class="cv" style="height:150px"></canvas><p class="cap tip" id="mxTideInfo"></p><p class="cap">Hauteur d'eau calculée par modèle (indicative) : vérifie l'annuaire officiel (SHOM) pour les spots à fort marnage.</p>` : ''}
    ${d.hasWaves ? `<h2>Vagues sur 7 jours</h2><canvas id="mxWave" class="cv" style="height:150px"></canvas><p class="cap tip" id="mxWaveInfo"></p>` : ''}
    <h2>Modèles</h2>
    <div class="note">${MODELS.map(m => `<b style="color:${MCOL[m.id]}">${m.name}</b> ${m.desc}${d.models[m.id] ? '' : ' · <i>indisponible ici</i>'}`).join('<br>')}<br><br>Compare les modèles : quand ils sont d'accord, la prévision est fiable. AROME est le plus précis sur les côtes françaises à 2 jours.</div>`;
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
  cfg[k] = cfg.unit === 'kn' ? v : v / KN; saveCfg(); drawMeteo();
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
  const ref = mk || d.models[Object.keys(d.models)[0]];
  rows += row('', t => { const c = at(ref.code, ref.time, t), tp = at(ref.temp, ref.time, t); return `<td class="${cls(t)}">${wxIcon(c, night(t))}<small>${tp == null ? '' : Math.round(tp) + '°'}</small></td>`; });
  const windCell = (m, t) => { const w = at(m.ws, m.time, t); return `<td class="w${cls(t)}" style="background:${windColor(w)};color:${windTxt(w)}">${wf(w)}</td>`; };
  if (mk) {
    rows += row(`Vent<small>${wUnit()}</small>`, t => windCell(mk, t));
    rows += row('Rafales', t => windCell({ ws: mk.wg, time: mk.time }, t));
    rows += row('Dir.', t => { const dd = at(mk.wd, mk.time, t); return `<td class="${cls(t)}">${arrow(dd)}<small>${dirName(dd)}</small></td>`; });
  } else {
    Object.keys(d.models).forEach(id => {
      const m = d.models[id];
      rows += row(`<span style="color:${MCOL[id]}">${MODELS.find(x => x.id === id).name}</span>`, t => {
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
  const T = d.time, n = T.length, ids = M.model === 'compare' ? Object.keys(d.models) : [M.model];
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
    line({ s: m.ws, t: m.time }, MCOL[id], M.model === 'compare' ? 1.6 : 2.2);
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
      lines.push(`${MODELS.find(x => x.id === id).name} ${wf(a)}${g != null ? ' (raf. ' + wf(g) + ')' : ''} ${wUnit()} ${dirName(dd)}`);
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

/* ---------- choix du spot ---------- */
const favs = () => cfg.favSpots || [];
const sameSpot = (a, b) => a && b && Math.abs(a.lat - b.lat) < 0.005 && Math.abs(a.lon - b.lon) < 0.005;
const isFav = s => favs().some(f => sameSpot(f, s));
function toggleFav() {
  const f = favs();
  cfg.favSpots = isFav(M.spot) ? f.filter(x => !sameSpot(x, M.spot)) : f.concat([{ name: M.spot.name, lat: M.spot.lat, lon: M.spot.lon }]);
  saveCfg(); renderMeteo();
}
function setSpot(s) {
  M.spot = { name: s.name, lat: +s.lat, lon: +s.lon }; M.day = 0;
  cfg.meteoSpot = M.spot; saveCfg(); renderMeteo();
}
async function renderSpotChips() {
  let mine = [];
  try { mine = groupSpots(await DB.all()).sort((a, b) => b.last - a.last).map(sp => ({ name: sp.name, lat: sp.c[0], lon: sp.c[1] })); } catch (e) {}
  const list = [];
  favs().forEach(f => list.push({ ...f, fav: true }));
  mine.forEach(s => { if (!list.some(x => sameSpot(x, s))) list.push(s); });
  $('mxChips').innerHTML = list.map((s, k) => `<button class="chip2 ${M.spot && sameSpot(s, M.spot) ? 'on' : ''}" data-k="${k}">${s.fav ? '★ ' : ''}${esc(s.name)}</button>`).join('')
    + `<button class="chip2" id="mxHere">📍 Ma position</button><button class="chip2" id="mxFind">🔍 Chercher</button>`;
  document.querySelectorAll('#mxChips [data-k]').forEach(b => b.onclick = () => setSpot(list[+b.dataset.k]));
  $('mxHere').onclick = () => {
    if (!navigator.geolocation) return toast('Localisation indisponible');
    toast('Localisation…');
    navigator.geolocation.getCurrentPosition(async p => {
      const name = (await reverseGeocode(p.coords.latitude, p.coords.longitude)) || 'Ma position';
      setSpot({ name, lat: p.coords.latitude, lon: p.coords.longitude });
    }, () => toast('Localisation refusée'), { enableHighAccuracy: false, timeout: 15000 });
  };
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
function showSpotMap() {
  if (!window.L) return;
  if (!M.map) {
    M.map = makeMap('mxMap'); if (!M.map) return;
    M.map.on('click', async e => {
      const { lat, lng } = e.latlng;
      const name = (await reverseGeocode(lat, lng)) || `Point ${lat.toFixed(2)}, ${lng.toFixed(2)}`;
      setSpot({ name, lat, lon: lng });
    });
  }
  setTimeout(() => M.map.invalidateSize(), 60);
  if (M.spot) {
    if (!M.mk) M.mk = L.circleMarker([M.spot.lat, M.spot.lon], { radius: 9, color: '#fff', weight: 3, fillColor: '#22d3c5', fillOpacity: 1 }).addTo(M.map);
    M.mk.setLatLng([M.spot.lat, M.spot.lon]);
    M.map.setView([M.spot.lat, M.spot.lon], Math.max(M.map.getZoom(), 10));
  }
}
$('mxRefresh').onclick = () => renderMeteo(true);
