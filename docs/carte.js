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
    CM.field = new WindField(CM.map);
    CM.sc = new SpotCanvas(CM.map); CM.layer = true;
    watchMoves(CM.map);
    // toucher un spot / une balise, sinon : créer un spot ici / prévisions
    CM.map.on('click', e => {
      const h = CM.sc.hit(e.containerPoint);
      if (!h) return cmEmptyTap(e.latlng.lat, e.latlng.lng);
      if (h.type === 'sta') stationPopup(CM.map, h.st, x => { show('meteo'); setSpot({ name: x.name, lat: x.lat, lon: x.lon }); });
      else cmTap(h);
    });
    CM.map.on('moveend', () => { clearTimeout(CM.t); CM.t = setTimeout(cmDraw, 300); });
    const sp = M.spot || cfg.meteoSpot || favs()[0];
    CM.map.setView(sp ? [sp.lat, sp.lon] : [46.6, 2.4], sp ? 9 : 6);
  } else setTimeout(() => { CM.map.invalidateSize(); cmDraw(); }, 60);
  // les spots de session pour la carte
  DB.all().then(all => { M.sessionSpots = groupSpots(all).map(sp => ({ name: sp.name, lat: sp.c[0], lon: sp.c[1] })); cmDraw(); }).catch(() => {});
  cmPaintTime(); $('cmOnly').classList.toggle('on', CM.onlyOk);
  cmModels();
  if (CM.field) { CM.field.model = cfg.cmModel || 'meteofrance_seamless'; CM.field.setTime(cmTime()); CM.field.setOn(cfg.cmField !== false); }
  $('cmFieldBtn').classList.toggle('off', cfg.cmField === false); cmLegend();
}
/* ---------- un seul modèle à la fois (vignettes en haut) ---------- */
function cmModels() {
  const cur = cfg.cmModel || 'meteofrance_seamless';
  $('cmModels').innerHTML = MODELS.filter(m => m.id !== 'avg').map(m => `<button class="${m.id === cur ? 'on' : ''}" data-m="${m.id}" style="--mc:${MCOL[m.id]}">${m.name}</button>`).join('');
  document.querySelectorAll('#cmModels button').forEach(b => b.onclick = () => {
    if (b.dataset.m === (cfg.cmModel || 'meteofrance_seamless')) return;
    cfg.cmModel = b.dataset.m; saveCfg(); cmModels();
    if (CM.field) CM.field.setModel(cfg.cmModel);
    cmDraw(); toast('Modèle : ' + b.textContent);
  });
}
function cmLegend() {
  const on = cfg.cmField !== false;
  $('cmLeg').style.display = on ? '' : 'none';
  if (!on) return;
  const marks = { kn: [5, 10, 15, 20, 25, 30, 40], kmh: [10, 20, 30, 40, 50, 60, 70], ms: [3, 5, 8, 10, 13, 15, 20], mph: [5, 10, 15, 20, 30, 40, 50] }[cfg.unit] || [10, 20, 30, 40, 50, 60, 70];
  $('cmLeg').innerHTML = marks.map(v => `<span style="color:rgb(${windRGB(v / curU().f * 3.6).join(',')})">${v}</span>`).join('') + `<b>${uLabel()}</b>`;
}
$('cmFieldBtn').onclick = () => { cfg.cmField = cfg.cmField === false ? true : false; saveCfg(); $('cmFieldBtn').classList.toggle('off', cfg.cmField === false); if (CM.field) CM.field.setOn(cfg.cmField !== false); cmLegend(); toast(cfg.cmField === false ? 'Vent animé masqué' : 'Vent animé affiché'); };
function cmBase() {
  (CM.base || []).forEach(l => l.remove());
  const b = WM_BASES[cfg.cmBase || 'light'] || WM_BASES.light;
  CM.base = baseLayers(b, 'cmLabels', CM.map);
  $('cmBaseBtn').textContent = { dark: '🌑', light: '🗺️', street: '🏘️', sat: '🛰️' }[cfg.cmBase || 'light'];
}
function cmDraw() {
  if (!CM.map || !CM.sc) return;
  if (CM.map._wtMoving) return; // redessiné à la fin du déplacement
  const map = CM.map, t = cmTime(), z = map.getZoom(), items = [];
  const list = visibleSpots(map, 7, 160), shown = { ok: 0, mid: 0, no: 0, off: 0 };
  list.forEach(s => {
    const c = condAt(s, t), r = rateCond(c), side = c ? sideOf(c.d, shoreOf(s)) : null;
    if (r) shown[r]++; if (r === 'ok' && side === 'off') shown.off++;
    if (CM.onlyOk && r !== 'ok' && !s.fav) return;
    items.push({ ...s, type: 'spot', r, side, layer: s.fav ? 'fav' : r || 'un' });
  });
  const sta = cfg.showStations !== false && z >= 6 && STA.list ? STA.list : [];
  if (sta.length) {
    const b = map.getBounds(), S = b.getSouth(), N = b.getNorth(), W = b.getWest(), E = b.getEast();
    let n = 0;
    for (const x of sta) { if (x.lat < S || x.lat > N || x.lon < W || x.lon > E) continue; if (++n > 250) break; items.push({ type: 'sta', layer: 'sta', lat: x.lat, lon: x.lon, w: x.w, d: x.d, name: x.name, st: x }); }
    if (map.attributionControl && !map._staAttr) { map.attributionControl.addAttribution(STA_ATTR); map._staAttr = true; }
  }
  CM.sc.set(items);
  $('cmCount').innerHTML = z < 7
    ? 'Zoome pour voir tous les spots de glisse (tes spots restent affichés)'
    : `<b style="color:#16a34a">${shown.ok} bons</b>${shown.off ? ` (dont ${shown.off} ⚠ vent de terre)` : ''} · <b style="color:#f59e0b">${shown.mid} moyens</b> · ${shown.no} sans vent · ${list.length} spots`;
  // données manquantes : chargées en arrière-plan (une à la fois), puis un seul redessin
  clearTimeout(CM.lt); CM.lt = setTimeout(() => cmLoad(list), 400);
}
async function cmLoad(list) {
  if (CM.loadBusy) { CM.loadAgain = true; return; }
  CM.loadBusy = true;
  let changed = false;
  try {
    if (cfg.showStations !== false && CM.map.getZoom() >= 6 && (!STA.list || Date.now() - STA.at > 3 * 60e3)) changed = !!(await loadStations().catch(() => null)) || changed;
    changed = (await fetchCond(list)) || changed;
    if (typeof ensureShoreArea === 'function') changed = (await ensureShoreArea(CM.map, list)) || changed;
  } catch (e) {} finally { CM.loadBusy = false; }
  if (changed) cmDraw();
  // limite gratuite atteinte : on recharge tout seul après la pause
  if (Date.now() < OM_COOL) { clearTimeout(CM.rt); CM.rt = setTimeout(cmDraw, OM_COOL - Date.now() + 1500); }
  if (CM.loadAgain) { CM.loadAgain = false; cmLoad(visibleSpots(CM.map, 7, 160)); }
}
function cmTap(s) {
  const c = condAt(s, cmTime()), sh = shoreOf(s), side = c ? sideOf(c.d, sh) : null, r = rateCond(c);
  const verdict = { ok: '✅ Bon', mid: '🟠 Moyen', no: '⚫ Pas de vent' }[r] || '';
  const html = `<div class="pop"><b>${esc(s.name)}</b><br>
    ${c && c.w != null ? `<span class="pill" style="background:${windColor(c.w)};color:${windTxt(c.w)}">${wf(c.w)}</span> raf. ${wf(c.g)} ${wUnit()} ${arrow(c.d, '#06141f')} ${dirName(c.d)}` : '<small>Conditions en cours de chargement…</small>'}
    ${verdict ? `<br>${verdict}` : ''}${side ? `<br>${sideBadge(c.d, sh)}${side === 'off' ? '<br><small style="color:#ef4444">Vent de terre : dangereux en cas de casse</small>' : ''}` : ''}
    <br><small>${dayLabel(cmTime().slice(0, 10))} · ${cmTime().slice(11, 16)}</small>
    <br><button class="btn small pri" id="cmGo">Prévisions</button> ${isFav(s) ? '' : '<button class="btn small" id="cmAdd">☆ Ajouter</button>'}</div>`;
  L.popup({ maxWidth: 260, autoPanPadding: [20, 140] }).setLatLng([s.lat, s.lon]).setContent(html).openOn(CM.map);
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
$('cmTime').oninput = () => { CM.h = +$('cmTime').value; cmPaintTime(); CM.field && CM.field.setTime(cmTime()); clearTimeout(CM.t); CM.t = setTimeout(() => { cmDraw(); }, 80); };
$('cmPlay').onclick = () => {
  if (CM.playing) { clearInterval(CM.playing); CM.playing = null; $('cmPlay').textContent = '▶'; return; }
  $('cmPlay').textContent = '❚❚';
  CM.playing = setInterval(() => { CM.h = (CM.h + 1) % 168; cmPaintTime(); CM.field && CM.field.setTime(cmTime()); cmDraw(); }, 800);
};
$('cmOnly').onclick = () => { CM.onlyOk = !CM.onlyOk; cfg.cmOnlyOk = CM.onlyOk; saveCfg(); $('cmOnly').classList.toggle('on', CM.onlyOk); cmDraw(); };
$('cmBaseBtn').onclick = () => { const o = ['light', 'street', 'sat', 'dark']; cfg.cmBase = o[(o.indexOf(cfg.cmBase || 'light') + 1) % o.length]; saveCfg(); cmBase(); CM.field && CM.field.drawHeat(); toast('Fond : ' + WM_BASES[cfg.cmBase].l); };
$('cmHere').onclick = () => hereThen((la, lo) => CM.map && CM.map.setView([la, lo], 10));
$('cmSearch').onclick = () => { show('meteo'); setTimeout(() => $('mxQ').focus(), 100); };
function cmStop() { if (CM.playing) { clearInterval(CM.playing); CM.playing = null; $('cmPlay').textContent = '▶'; } if (CM.field) CM.field.stop(); }

/* ---------- toucher une zone vide : créer un spot ---------- */
async function cmEmptyTap(lat, lon) {
  const pop = L.popup({ maxWidth: 240 }).setLatLng([lat, lon]).setContent('<div class="pop">…</div>').openOn(CM.map);
  const name = (await reverseGeocode(lat, lon)) || `Point ${lat.toFixed(3)}, ${lon.toFixed(3)}`;
  pop.setContent(`<div class="pop"><b>${esc(name)}</b><br><small>${lat.toFixed(4)}, ${lon.toFixed(4)}</small><br><button class="btn small pri" id="ceNew">＋ Créer un spot ici</button> <button class="btn small" id="ceGo">Prévisions</button></div>`);
  setTimeout(() => {
    const a = document.getElementById('ceNew'), b = document.getElementById('ceGo');
    if (a) a.onclick = async () => { CM.map.closePopup(); await createSpot(lat, lon, name); show('carte'); cmDraw(); };
    if (b) b.onclick = () => { CM.map.closePopup(); show('meteo'); setSpot({ name, lat, lon }); };
  }, 0);
}
$('cmStaBtn').onclick = () => { cfg.showStations = cfg.showStations === false ? true : false; saveCfg(); $('cmStaBtn').classList.toggle('off', cfg.showStations === false); toast(cfg.showStations === false ? 'Balises masquées' : 'Balises de vent en direct affichées'); cmDraw(); };
