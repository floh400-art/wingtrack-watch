'use strict';
/* =========================================================================
   WingTrack — Carnet de bord (matériel, notes, météo auto) + Progression
   ========================================================================= */

/* ---------- météo de la session (Open-Meteo, données passées) ---------- */
async function sessionWeather(s) {
  const c = sessCenter(s), start = s.pts[0][0], end = s.pts[s.pts.length - 1][0];
  const d0 = new Date(start - 86400e3).toISOString().slice(0, 10), d1 = new Date(end + 86400e3).toISOString().slice(0, 10);
  const ageDays = (Date.now() - start) / 86400e3;
  const ll = `latitude=${c[0].toFixed(4)}&longitude=${c[1].toFixed(4)}&start_date=${d0}&end_date=${d1}&timezone=auto`;
  const hv = 'wind_speed_10m,wind_gusts_10m,wind_direction_10m,temperature_2m,weather_code';
  const base = ageDays > 80 ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
  const f = await getJSON(`${base}?${ll}&hourly=${hv}`);
  const m = await getJSON(`https://marine-api.open-meteo.com/v1/marine?${ll}&hourly=wave_height,wave_period`).catch(() => null);
  const off = (f.utc_offset_seconds || 0) * 1000;
  const loc = ms => new Date(ms + off).toISOString().slice(0, 13) + ':00';
  const hours = [];
  for (let t = start - (start % 3600e3); t <= end; t += 3600e3) hours.push(loc(t));
  const pick = (h, key) => hours.map(t => { const i = h.time.indexOf(t); return i < 0 ? null : h[key][i]; }).filter(v => v != null);
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const H = f.hourly, ws = pick(H, 'wind_speed_10m'), gs = pick(H, 'wind_gusts_10m'), ds = pick(H, 'wind_direction_10m');
  let x = 0, y = 0; ds.forEach(d => { x += Math.sin(d * Math.PI / 180); y += Math.cos(d * Math.PI / 180); });
  const wx = {
    w: avg(ws), g: gs.length ? Math.max(...gs) : null, d: ds.length ? (Math.atan2(x, y) * 180 / Math.PI + 360) % 360 : null,
    temp: avg(pick(H, 'temperature_2m')), code: pick(H, 'weather_code')[0] ?? null, at: Date.now(),
  };
  if (m && m.hourly) { wx.wh = avg(pick(m.hourly, 'wave_height')); wx.wp = avg(pick(m.hourly, 'wave_period')); }
  if (wx.w == null) throw new Error('pas de données');
  return wx;
}
function wxLine(wx) {
  if (!wx) return '';
  return `${wxIcon(wx.code, false)} <span class="pill" style="background:${windColor(wx.w)};color:${windTxt(wx.w)}">${wf(wx.w)}</span> raf. ${wf(wx.g)} ${wUnit()} ${arrow(wx.d)} ${dirName(wx.d)}`
    + (wx.temp != null ? ` · ${Math.round(wx.temp)}°` : '') + (wx.wh != null ? ` · vagues ${wx.wh.toFixed(1)} m${wx.wp ? ' / ' + Math.round(wx.wp) + ' s' : ''}` : '');
}

/* ---------- carnet dans le détail d'une session ---------- */
const KIT = [
  { k: 'wing', l: 'Aile', u: 'm²', ph: '5' },
  { k: 'foil', l: 'Foil (front)', u: 'cm²', ph: '1200' },
  { k: 'board', l: 'Planche', u: 'L', ph: '85' },
];
function kitText(log) { return log ? KIT.filter(x => log[x.k]).map(x => `${x.l.split(' ')[0]} ${log[x.k]}${x.u === 'm²' ? ' m²' : x.u === 'L' ? ' L' : ''}`).join(' · ') : ''; }
async function renderCarnet() {
  const s = det.s; if (!s) return;
  const log = s.log || {};
  const hist = (await DB.all()).filter(x => x.log);
  const options = k => [...new Set(hist.map(x => x.log[k]).filter(Boolean))].slice(0, 6);
  $('dCarnet').innerHTML = `
    <div class="wxbox" id="dWx">${s.wx ? wxLine(s.wx) : '<small>Météo de la session : chargement…</small>'}</div>
    ${KIT.map(x => `<div class="field"><label>${x.l} (${x.u})</label>
      <div class="row"><input type="text" inputmode="decimal" data-k="${x.k}" value="${esc(log[x.k] || '')}" placeholder="${esc((cfg.lastKit || {})[x.k] || x.ph)}">
      ${options(x.k).map(o => `<button class="chip2 kq" data-k="${x.k}" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div></div>`).join('')}
    <div class="field"><label>Ressenti (1 à 5)</label><div class="stars" id="dFeel">${[1, 2, 3, 4, 5].map(n => `<button data-n="${n}" class="${(log.feel || 0) >= n ? 'on' : ''}">★</button>`).join('')}</div></div>
    <div class="field"><label>Notes</label><textarea id="dNotes" rows="3" placeholder="Réglages, sensations, ce que j'ai travaillé…">${esc(log.notes || '')}</textarea></div>`;
  const save = async () => {
    const o = { ...(s.log || {}) };
    document.querySelectorAll('#dCarnet input[data-k]').forEach(i => o[i.dataset.k] = i.value.trim());
    o.notes = $('dNotes').value;
    s.log = o; cfg.lastKit = { wing: o.wing, foil: o.foil, board: o.board }; saveCfg();
    await DB.put(s);
  };
  document.querySelectorAll('#dCarnet input[data-k]').forEach(i => i.onchange = save);
  $('dNotes').onchange = save;
  document.querySelectorAll('#dCarnet .kq').forEach(b => b.onclick = () => { document.querySelector(`#dCarnet input[data-k="${b.dataset.k}"]`).value = b.dataset.v; save(); });
  document.querySelectorAll('#dFeel button').forEach(b => b.onclick = async () => {
    s.log = { ...(s.log || {}), feel: +b.dataset.n }; await DB.put(s);
    document.querySelectorAll('#dFeel button').forEach(x => x.classList.toggle('on', +x.dataset.n <= s.log.feel));
  });
  if (!s.wx && navigator.onLine) {
    try { s.wx = await sessionWeather(s); await DB.put(s); if (det.s === s) $('dWx').innerHTML = wxLine(s.wx); }
    catch (e) { if (det.s === s) $('dWx').innerHTML = '<small>Météo indisponible pour cette session (hors ligne ou trop ancienne)</small>'; }
  } else if (!s.wx) $('dWx').innerHTML = '<small>Météo : connecte-toi pour la récupérer</small>';
}

/* ---------- progression ---------- */
$('bProgress').onclick = () => { show('progress'); renderProgress(); };
$('bProgBack').onclick = () => show('home');
let progData = null;
async function renderProgress() {
  const list = (await DB.all()).filter(s => s.sum).sort((a, b) => a.start - b.start);
  if (!list.length) { $('progBody').innerHTML = '<div class="empty">Pas encore de sessions.</div>'; return; }
  // par mois
  const months = {};
  list.forEach(s => {
    const k = new Date(s.start).toISOString().slice(0, 7);
    const m = months[k] = months[k] || { k, n: 0, foil: 0, dist: 0, vmax: 0, fj: 0, j: 0 };
    m.n++; m.foil += s.sum.foilTime; m.dist += s.sum.distance; m.vmax = Math.max(m.vmax, s.sum.vmax2);
    m.fj += (s.sum.foilJibes || 0) + (s.sum.foilTacks || 0); m.j += (s.sum.jibes || 0) + (s.sum.tacks || 0);
  });
  const ms = Object.values(months);
  // par aile
  const wings = {};
  list.forEach(s => {
    const w = (s.log && s.log.wing) || '?';
    const o = wings[w] = wings[w] || { w, n: 0, vmax: 0, wind: [], foil: 0 };
    o.n++; o.vmax = Math.max(o.vmax, s.sum.vmax2); o.foil += s.sum.foilTime; if (s.wx && s.wx.w != null) o.wind.push(s.wx.w);
  });
  const tot = list.reduce((a, s) => ({ foil: a.foil + s.sum.foilTime, dist: a.dist + s.sum.distance, t: a.t + s.sum.duration }), { foil: 0, dist: 0, t: 0 });
  progData = { list, ms };
  $('progBody').innerHTML = `
    <div class="grid g3">
      <div class="tile hl"><div class="l">Sessions</div><div class="v">${list.length}</div></div>
      <div class="tile"><div class="l">Sur le foil</div><div class="v">${(tot.foil / 3600).toFixed(1)}<small>h</small></div></div>
      <div class="tile"><div class="l">Distance</div><div class="v">${(tot.dist / 1000).toFixed(0)}<small>km</small></div></div>
    </div>
    <h2>Heures sur le foil par mois</h2><canvas id="pgFoil" class="cv" style="height:170px"></canvas><p class="cap tip" id="pgFoilInfo"></p>
    <h2>Vitesse max par session</h2><canvas id="pgVmax" class="cv" style="height:170px"></canvas><p class="cap tip" id="pgVmaxInfo"></p>
    <h2>Réussite des virements</h2><canvas id="pgRate" class="cv" style="height:170px"></canvas><p class="cap tip" id="pgRateInfo"></p>
    <h2>Par taille d'aile</h2>
    <div class="tblwrap"><table class="legs"><tr><th>Aile</th><th>Sessions</th><th>Vent moyen</th><th>Vmax</th><th>Foil</th></tr>
    ${Object.values(wings).sort((a, b) => parseFloat(a.w) - parseFloat(b.w)).map(o => `<tr><td>${o.w === '?' ? 'non renseignée' : esc(o.w) + ' m²'}</td><td>${o.n}</td><td>${o.wind.length ? wf(o.wind.reduce((a, b) => a + b, 0) / o.wind.length) + ' ' + wUnit() : '–'}</td><td>${fs(o.vmax)}</td><td>${ft(o.foil)}</td></tr>`).join('')}
    </table></div>
    <p class="cap">Renseigne ta taille d'aile dans le carnet de chaque session pour comparer.</p>`;
  drawBars(-1); drawSeries('pgVmax', -1); drawSeries('pgRate', -1);
  onTouchChart('pgFoil', x => { const g = progData && progData.barGeom; if (g) drawBars(Math.max(0, Math.min(g.n - 1, Math.floor((x - g.pad.l) / g.bw)))); });
  ['pgVmax', 'pgRate'].forEach(id => onTouchChart(id, x => { const g = progData && progData[id]; if (g) drawSeries(id, Math.max(0, Math.min(g.n - 1, Math.round((x - g.pad.l) / g.w * (g.n - 1))))); }));
}
function drawBars(sel) {
  const { c, W, H } = prep('pgFoil'), ms = progData.ms;
  const pad = { l: 30, r: 8, t: 14, b: 20 }, w = W - pad.l - pad.r, h = H - pad.t - pad.b;
  const mx = Math.max(1, ...ms.map(m => m.foil / 3600)), bw = w / ms.length;
  c.fillStyle = '#86a6b8'; c.strokeStyle = '#183a50';
  [0, mx / 2, mx].forEach(v => { const y = pad.t + h - v / mx * h; c.beginPath(); c.moveTo(pad.l, y); c.lineTo(W - pad.r, y); c.stroke(); c.fillText(v.toFixed(1) + 'h', 2, y + 3); });
  ms.forEach((m, k) => {
    const x = pad.l + k * bw, bh = m.foil / 3600 / mx * h;
    c.fillStyle = sel >= 0 && sel !== k ? 'rgba(34,211,197,.4)' : '#22d3c5';
    c.fillRect(x + Math.min(4, bw * .15), pad.t + h - bh, Math.max(3, bw - Math.min(8, bw * .3)), bh);
    c.fillStyle = '#86a6b8'; c.textAlign = 'center';
    if (bw > 26 || k % Math.ceil(26 / bw) === 0) c.fillText(new Date(m.k + '-15').toLocaleDateString('fr-FR', { month: 'short' }), x + bw / 2, H - 6);
  });
  c.textAlign = 'left';
  if (sel >= 0) {
    const m = ms[sel], x = pad.l + sel * bw + bw / 2;
    const lines = [new Date(m.k + '-15').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }), `${m.n} session${m.n > 1 ? 's' : ''} · ${ft(m.foil)} foil`, `${fd(m.dist)} · Vmax ${fs(m.vmax)} ${uLabel()}`];
    bubble(c, x, pad.t + h - m.foil / 3600 / mx * h, lines, W, H); $('pgFoilInfo').textContent = lines.join(' · ');
  } else $('pgFoilInfo').textContent = 'Touche un mois pour le détail';
  progData.barGeom = { pad, bw, n: ms.length };
}
function drawSeries(id, sel) {
  const { c, W, H } = prep(id), L0 = progData.list;
  const val = s => id === 'pgVmax' ? spd(s.sum.vmax2) : (s.sum.turnRate == null ? null : s.sum.turnRate * 100);
  const pts = L0.map((s, k) => ({ k, s, v: val(s) })).filter(p => p.v != null);
  const pad = { l: 30, r: 10, t: 14, b: 20 }, w = W - pad.l - pad.r, h = H - pad.t - pad.b;
  if (!pts.length) { c.fillStyle = '#86a6b8'; c.fillText('Pas encore de données', 10, H / 2); return; }
  const hi = id === 'pgRate' ? 100 : Math.ceil(Math.max(...pts.map(p => p.v)) / 5) * 5 + 5, lo = id === 'pgRate' ? 0 : Math.max(0, Math.floor(Math.min(...pts.map(p => p.v)) / 5) * 5 - 5);
  const X = i => pad.l + (pts.length === 1 ? w / 2 : i / (pts.length - 1) * w), Y = v => pad.t + h - (v - lo) / (hi - lo) * h;
  c.fillStyle = '#86a6b8'; c.strokeStyle = '#183a50';
  [lo, (lo + hi) / 2, hi].forEach(v => { const y = Y(v); c.beginPath(); c.moveTo(pad.l, y); c.lineTo(W - pad.r, y); c.stroke(); c.fillText(Math.round(v) + (id === 'pgRate' ? '%' : ''), 2, y + 3); });
  // tendance (moyenne glissante sur 5 sessions)
  c.beginPath(); pts.forEach((p, i) => { const win = pts.slice(Math.max(0, i - 4), i + 1); const m = win.reduce((a, b) => a + b.v, 0) / win.length; if (!i) c.moveTo(X(i), Y(m)); else c.lineTo(X(i), Y(m)); });
  c.strokeStyle = '#ffb84d'; c.lineWidth = 2; c.stroke(); c.lineWidth = 1;
  pts.forEach((p, i) => { c.fillStyle = i === sel ? '#fff' : '#22d3c5'; c.beginPath(); c.arc(X(i), Y(p.v), i === sel ? 5 : 3, 0, 7); c.fill(); });
  const info = $(id + 'Info');
  if (sel >= 0 && pts[sel]) {
    const p = pts[sel];
    const lines = [`${new Date(p.s.start).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })} · ${p.s.spot || p.s.name}`,
      id === 'pgVmax' ? `Vmax ${p.v.toFixed(1)} ${uLabel()}` : `${Math.round(p.v)} % (${(p.s.sum.foilJibes || 0) + (p.s.sum.foilTacks || 0)}/${(p.s.sum.jibes || 0) + (p.s.sum.tacks || 0)} foilés)`];
    if (p.s.log && p.s.log.wing) lines.push('Aile ' + p.s.log.wing + ' m²');
    bubble(c, X(sel), Y(p.v), lines, W, H); info.textContent = lines.join(' · ');
  } else info.textContent = 'Points = sessions · orange = tendance · touche un point pour le détail';
  progData[id] = { pad, w, n: pts.length };
}
