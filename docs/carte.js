'use strict';
/* =========================================================================
   WingTrack — Onglet Carte : tous les spots avec les conditions
   (vert + voile = bon, orange = moyen, noir = rien, ⚠ vent de terre)
   ========================================================================= */
const CM = { map: null, layer: null, h: 0, playing: null, onlyOk: !!cfg.cmOnlyOk, base: null };
function cmTime() {
  const t = new Date(Date.now() + CM.h * 3600e3 - new Date().getTimezoneOffset() * 60e3);
  return t.toISOString().slice(0, 13) + ':00';
}
function openCarte() {
  if (typeof ensureSpotDB === 'function') ensureSpotDB().then(() => cmDraw());
  if (!window.L) { $('cmMap').innerHTML = '<div class="empty" style="margin:40px 16px">Carte indisponible hors connexion</div>'; return; }
  if (!CM.map) {
    CM.map = L.map('cmMap', { zoomControl: false, maxZoom: 16 });
    const lp = CM.map.createPane ? CM.map.createPane('cmLabels') : null;
    if (lp) { lp.style.zIndex = 450; lp.style.pointerEvents = 'none'; }
    cmBase();
    CM.layer = L.layerGroup().addTo(CM.map);
    CM.map.on('moveend', () => { clearTimeout(CM.t); CM.t = setTimeout(cmDraw, 250); });
    const sp = M.spot || cfg.meteoSpot || favs()[0];
    CM.map.setView(sp ? [sp.lat, sp.lon] : [46.6, 2.4], sp ? 9 : 6);
  } else setTimeout(() => { CM.map.invalidateSize(); cmDraw(); }, 60);
  // les spots de session pour la carte
  DB.all().then(all => { M.sessionSpots = groupSpots(all).map(sp => ({ name: sp.name, lat: sp.c[0], lon: sp.c[1] })); cmDraw(); }).catch(() => {});
  cmPaintTime(); $('cmOnly').classList.toggle('on', CM.onlyOk);
}
function cmBase() {
  (CM.base || []).forEach(l => l.remove());
  const b = WM_BASES[cfg.cmBase || 'light'] || WM_BASES.light;
  CM.base = [L.tileLayer(b.base, { subdomains: 'abcd', maxZoom: 19, attribution: b.att }).addTo(CM.map), L.tileLayer(b.labels, { subdomains: 'abcd', maxZoom: 19, pane: 'cmLabels' }).addTo(CM.map)];
  $('cmBaseBtn').textContent = { dark: '🌑', light: '🗺️', sat: '🛰️' }[cfg.cmBase || 'light'];
}
function cmDraw() {
  if (!CM.map || !CM.layer) return;
  drawDbSpots(CM.map, CM.layer, cmTap, cmTime(), {
    minZoom: 7, cap: 160, onlyOk: CM.onlyOk,
    onCount: (n, tot) => {
      $('cmCount').innerHTML = CM.map.getZoom() < 7
        ? 'Zoome pour voir tous les spots de glisse (tes spots restent affichés)'
        : `<b style="color:#16a34a">${n.ok} bons</b>${n.off ? ` (dont ${n.off} ⚠ vent de terre)` : ''} · <b style="color:#f59e0b">${n.mid} moyens</b> · ${n.no} sans vent · ${tot} spots`;
    },
  });
}
function cmTap(s) {
  const c = condAt(s, cmTime()), sh = shoreOf(s), side = c ? sideOf(c.d, sh) : null, r = rateCond(c);
  const verdict = { ok: '✅ Bon', mid: '🟠 Moyen', no: '⚫ Pas de vent' }[r] || '';
  const html = `<div class="pop"><b>${esc(s.name)}</b><br>
    ${c && c.w != null ? `<span class="pill" style="background:${windColor(c.w)};color:${windTxt(c.w)}">${wf(c.w)}</span> raf. ${wf(c.g)} ${wUnit()} ${arrow(c.d, '#06141f')} ${dirName(c.d)}` : '<small>Conditions en cours de chargement…</small>'}
    ${verdict ? `<br>${verdict}` : ''}${side ? `<br>${sideBadge(c.d, sh)}${side === 'off' ? '<br><small style="color:#ef4444">Vent de terre : dangereux en cas de casse</small>' : ''}` : ''}
    <br><small>${dayLabel(cmTime().slice(0, 10))} · ${cmTime().slice(11, 16)}</small>
    <br><button class="btn small pri" id="cmGo">Prévisions</button> ${isFav(s) ? '' : '<button class="btn small" id="cmAdd">☆ Ajouter</button>'}</div>`;
  L.popup({ maxWidth: 260 }).setLatLng([s.lat, s.lon]).setContent(html).openOn(CM.map);
  setTimeout(() => {
    const go = document.getElementById('cmGo'), add = document.getElementById('cmAdd');
    if (go) go.onclick = () => { CM.map.closePopup(); show('meteo'); setSpot({ name: s.name, lat: s.lat, lon: s.lon }); };
    if (add) add.onclick = () => { saveSpots(favs().concat([{ name: s.name, lat: s.lat, lon: s.lon }])); CM.map.closePopup(); toast('Spot ajouté à tes spots'); cmDraw(); };
  }, 0);
}
function cmPaintTime() {
  const t = cmTime();
  $('cmClock').textContent = CM.h === 0 ? 'Maintenant' : `${dayLabel(t.slice(0, 10))} ${t.slice(11, 13)}h`;
  $('cmTime').value = CM.h;
}
$('cmTime').oninput = () => { CM.h = +$('cmTime').value; cmPaintTime(); clearTimeout(CM.t); CM.t = setTimeout(cmDraw, 80); };
$('cmPlay').onclick = () => {
  if (CM.playing) { clearInterval(CM.playing); CM.playing = null; $('cmPlay').textContent = '▶'; return; }
  $('cmPlay').textContent = '❚❚';
  CM.playing = setInterval(() => { CM.h = (CM.h + 1) % 168; cmPaintTime(); cmDraw(); }, 800);
};
$('cmOnly').onclick = () => { CM.onlyOk = !CM.onlyOk; cfg.cmOnlyOk = CM.onlyOk; saveCfg(); $('cmOnly').classList.toggle('on', CM.onlyOk); cmDraw(); };
$('cmBaseBtn').onclick = () => { const o = ['light', 'dark', 'sat']; cfg.cmBase = o[(o.indexOf(cfg.cmBase || 'light') + 1) % 3]; saveCfg(); cmBase(); };
$('cmHere').onclick = () => hereThen((la, lo) => CM.map && CM.map.setView([la, lo], 10));
$('cmSearch').onclick = () => { show('meteo'); setTimeout(() => $('mxQ').focus(), 100); };
function cmStop() { if (CM.playing) { clearInterval(CM.playing); CM.playing = null; $('cmPlay').textContent = '▶'; } }
