'use strict';
/* =========================================================================
   WingTrack — Replay de session : marqueur orienté le long de la trace,
   vitesse en direct, événements (décollages, jibes, tacks), vitesse de lecture
   ========================================================================= */
const RP = { t: 0, i: 0, playing: false, mult: 10, raf: null, last: 0, mk: null, trail: null, follow: true, evIdx: 0, lastChart: 0, lastTrail: 0 };
const RP_MULTS = [1, 5, 10, 30, 60];

function rpInit() {
  rpStop();
  const st = det.st; if (!st || !st.T || st.T.length < 3) { $('rpBox').style.display = 'none'; return; }
  $('rpBox').style.display = '';
  RP.t = 0; RP.i = 0; RP.evIdx = 0;
  $('rpSlider').max = Math.round(st.T[st.T.length - 1]); $('rpSlider').value = 0;
  $('rpMult').textContent = '×' + RP.mult;
  $('rpFollow').classList.toggle('on', RP.follow);
  if (RP.mk) { RP.mk.remove(); RP.mk = null; }
  if (RP.trail) { RP.trail.remove(); RP.trail = null; }
  $('rpHud').style.display = 'none';
  rpPaint();
}
function idxAt(t) { const T = det.st.T; let lo = 0, hi = T.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (T[m] <= t) lo = m; else hi = m - 1; } return lo; }
function headingAt(i) {
  const P = det.st.pts, a = Math.max(0, i - 2), b = Math.min(P.length - 1, i + 2);
  return a === b ? 0 : WTStats.bearing(P[a], P[b]);
}
function rpPaint(seek) {
  const st = det.st, P = st.pts, i = RP.i = idxAt(RP.t), U = uLabel();
  $('rpTime').textContent = `${ft(RP.t)} / ${ft(st.T[st.T.length - 1])}`;
  $('rpSlider').value = Math.round(RP.t);
  if (!det.map || !window.L) return;
  const p = P[i], hd = headingAt(i), v = st.V[i];
  const html = `<div class="rpmk" style="transform:rotate(${hd}deg)"><svg viewBox="0 0 24 24"><path d="M12 2l7 18-7-4-7 4z"/></svg></div>`;
  const icon = L.divIcon({ className: '', html, iconSize: [30, 30], iconAnchor: [15, 15] });
  if (!RP.mk) { RP.mk = L.marker([p[1], p[2]], { icon, zIndexOffset: 2000, interactive: false }).addTo(det.map); det.layers.push(RP.mk); }
  else { RP.mk.setLatLng([p[1], p[2]]); RP.mk.setIcon && RP.mk.setIcon(icon); }
  // trace parcourue (mise à jour ~4 fois par seconde)
  const now = performance.now();
  if (seek || !RP.trail || now - RP.lastTrail > 250) {
    RP.lastTrail = now;
    const pts = P.slice(0, i + 1).map(q => [q[1], q[2]]);
    if (!RP.trail) { RP.trail = L.polyline(pts, { color: '#fff', weight: 5, opacity: .9 }).addTo(det.map); det.layers.push(RP.trail); }
    else RP.trail.setLatLngs(pts);
  }
  if (RP.follow && RP.playing) det.map.panTo([p[1], p[2]], { animate: false });
  // HUD
  const foil = st.runList.some(r => RP.t >= r.t0 && RP.t <= r.t0 + r.dur);
  const done = det.ev.filter(e => e.t <= RP.t);
  const nJ = done.filter(e => e.type === 'jibe').length, nT = done.filter(e => e.type === 'tack').length;
  $('rpHud').style.display = '';
  $('rpSpeed').textContent = fs(v); $('rpSpeed').style.color = speedColor(v, Math.max(st.vmax2, 20 / 3.6));
  $('rpUnit').textContent = U;
  $('rpInfo').innerHTML = `${foil ? '<b class="ok">SUR LE FOIL</b>' : '<b>dans l\'eau</b>'}<br>${fd(st.C[i])} · ${Math.round(hd)}°<br>${nJ} J · ${nT} T`;
  // graphique synchronisé (~6 fois par seconde)
  if (seek || now - RP.lastChart > 160) { RP.lastChart = now; drawChart(i); }
  // annonces d'événements
  while (RP.evIdx < det.ev.length && det.ev[RP.evIdx].t <= RP.t) {
    const e = det.ev[RP.evIdx++];
    if (!seek && RP.playing) rpToast(e);
  }
}
function rpToast(e) {
  const d = EV[e.type];
  const txt = e.type === 'accel' ? `⚡ +${fs(e.gain, 0)} ${uLabel()} en ${Math.round(e.dt)} s`
    : e.type === 'takeoff' ? '▲ Décollage !' : `${d.l} ${e.foiled ? 'foilé ✓' : '(touché l\'eau)'}`;
  const el = $('rpToast'); el.textContent = txt; el.style.background = d.c; el.classList.add('on');
  clearTimeout(rpToast.t); rpToast.t = setTimeout(() => el.classList.remove('on'), 1600);
}
function rpLoop(ts) {
  if (!RP.playing) return;
  const dt = RP.last ? (ts - RP.last) / 1000 : 0; RP.last = ts;
  const end = det.st.T[det.st.T.length - 1];
  RP.t = Math.min(end, RP.t + dt * RP.mult);
  rpPaint();
  if (RP.t >= end) { rpStop(); return; }
  RP.raf = requestAnimationFrame(rpLoop);
}
function rpPlay() {
  const end = det.st.T[det.st.T.length - 1];
  if (RP.t >= end) { RP.t = 0; RP.evIdx = 0; if (RP.trail) RP.trail.setLatLngs([]); }
  RP.playing = true; RP.last = 0; $('rpPlay').textContent = '❚❚';
  if (RP.follow && det.map) { const p = det.st.pts[idxAt(RP.t)]; det.map.setView([p[1], p[2]], Math.max(det.map.getZoom(), 16)); }
  RP.raf = requestAnimationFrame(rpLoop);
}
function rpStop() { RP.playing = false; if (RP.raf) cancelAnimationFrame(RP.raf); RP.raf = null; if ($('rpPlay')) $('rpPlay').textContent = '▶'; }
$('rpPlay').onclick = () => { if (!det.st) return; if (RP.playing) rpStop(); else rpPlay(); };
$('rpSlider').oninput = () => {
  RP.t = +$('rpSlider').value;
  RP.evIdx = det.ev.findIndex(e => e.t > RP.t); if (RP.evIdx < 0) RP.evIdx = det.ev.length;
  rpPaint(true);
  if (det.map) { const p = det.st.pts[RP.i]; det.map.panTo([p[1], p[2]], { animate: false }); }
};
$('rpMult').onclick = () => { RP.mult = RP_MULTS[(RP_MULTS.indexOf(RP.mult) + 1) % RP_MULTS.length]; $('rpMult').textContent = '×' + RP.mult; };
$('rpFollow').onclick = () => { RP.follow = !RP.follow; $('rpFollow').classList.toggle('on', RP.follow); };
$('rpBack').onclick = () => { $('rpSlider').value = Math.max(0, RP.t - 30); $('rpSlider').oninput(); };
$('rpFwd').onclick = () => { $('rpSlider').value = Math.min(det.st.T[det.st.T.length - 1], RP.t + 30); $('rpSlider').oninput(); };
