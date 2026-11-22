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
  if (CM.field) { CM.field.setTime(cmTime()); CM.field.setOn(cfg.cmField !== false); }
  $('cmFieldBtn').classList.toggle('off', cfg.cmField === false); cmLegend();
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
  const nb = list.filter(x => x.beach).length;
  $('cmCount').innerHTML = z < 7
    ? 'Zoome pour voir tous les spots de glisse (tes spots restent affichés)'
    : `<b style="color:#16a34a">${shown.ok} bons</b>${shown.off ? ` (dont ${shown.off} ⚠ vent de terre)` : ''} · <b style="color:#f59e0b">${shown.mid} moyens</b> · ${shown.no} sans vent · ${list.length - nb} spots${nb ? ` + ${nb} plages` : z < 10 ? ' · zoome pour voir aussi les plages' : ''}`;
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
    changed = (await loadBeaches(CM.map)) || changed;
    if (typeof ensureShoreArea === 'function') changed = (await ensureShoreArea(CM.map, list)) || changed;
  } catch (e) {} finally { CM.loadBusy = false; }
  if (changed) cmDraw();
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
$('cmTime').oninput = () => { CM.h = +$('cmTime').value; cmPaintTime(); CM.field && CM.field.setTime(cmTime()); clearTimeout(CM.t); CM.t = setTimeout(() => { cmDraw(); CM.paintLocal && CM.paintLocal(); }, 80); };
$('cmPlay').onclick = () => {
  if (CM.playing) { clearInterval(CM.playing); CM.playing = null; $('cmPlay').textContent = '▶'; return; }
  $('cmPlay').textContent = '❚❚';
  CM.playing = setInterval(() => { CM.h = (CM.h + 1) % 168; cmPaintTime(); CM.field && CM.field.setTime(cmTime()); cmDraw(); CM.paintLocal && CM.paintLocal(); }, 800);
};
$('cmOnly').onclick = () => { CM.onlyOk = !CM.onlyOk; cfg.cmOnlyOk = CM.onlyOk; saveCfg(); $('cmOnly').classList.toggle('on', CM.onlyOk); cmDraw(); };
$('cmBaseBtn').onclick = () => { const o = ['light', 'street', 'sat', 'dark']; cfg.cmBase = o[(o.indexOf(cfg.cmBase || 'light') + 1) % o.length]; saveCfg(); cmBase(); CM.field && CM.field.drawHeat(); toast('Fond : ' + WM_BASES[cfg.cmBase].l); };
$('cmHere').onclick = () => hereThen((la, lo) => CM.map && CM.map.setView([la, lo], 10));
$('cmSearch').onclick = () => { show('meteo'); setTimeout(() => $('mxQ').focus(), 100); };
function cmStop() { if (CM.playing) { clearInterval(CM.playing); CM.playing = null; $('cmPlay').textContent = '▶'; } if (CM.field) CM.field.stop(); }

/* ---------- Local : spots autour d'un endroit ---------- */
CM.loc = null; CM.radius = cfg.cmRadius || 50;
function localSpots(lat, lon, rkm) {
  const ctr = { lat, lon }, out = [];
  const push = (s, extra) => { const d = kmBetween(ctr, s); if (d <= rkm && !out.some(o => Math.abs(o.lat - s.lat) < 0.003 && Math.abs(o.lon - s.lon) < 0.003)) out.push({ ...extra, lat: s.lat, lon: s.lon, d }); };
  favs().forEach(s => push(s, { name: s.name, fav: true, icon: '★' }));
  (M.sessionSpots || []).forEach(s => push(s, { name: s.name, icon: '🏄' }));
  (SDB.list || []).forEach(s => push(s, { name: spotLabel(s), icon: spotIcon(s) }));
  const dLat = rkm / 110.5, dLon = rkm / (111.3 * Math.cos(lat * Math.PI / 180));
  beachesIn(lat - dLat, lat + dLat, lon - dLon, lon + dLon).forEach(s => push(s, { name: s.n || 'Plage', icon: '🏖️', beach: true }));
  return out.sort((a, b) => a.d - b.d).slice(0, 150);
}
async function openLocal(center) {
  $('cmLocal').classList.add('on');
  if (center) CM.loc = center;
  if (!CM.loc) {
    $('cmLocList').innerHTML = '<div class="empty" style="padding:14px">Localisation…</div>';
    if (!navigator.geolocation) { $('cmLocList').innerHTML = '<div class="empty" style="padding:14px">Localisation indisponible : utilise « Centre de la carte ».</div>'; return; }
    navigator.geolocation.getCurrentPosition(async p => {
      CM.loc = { lat: p.coords.latitude, lon: p.coords.longitude, name: 'ma position' }; renderLocal();
      const nm = await reverseGeocode(p.coords.latitude, p.coords.longitude); if (nm && CM.loc) { CM.loc.name = nm; $('cmLocTitle').textContent = `Autour de ${nm}`; }
    }, err => {
      $('cmLocList').innerHTML = `<div class="empty" style="padding:14px">${err && err.code === 1 ? 'Localisation refusée : autorise la position pour ce site dans Chrome (🔒 à gauche de l\'adresse), ou' : 'Position introuvable pour l\'instant :'} déplace la carte puis touche « ⌖ Centre de la carte ».</div>`;
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 });
    return;
  }
  renderLocal();
}
async function renderLocal() {
  if (!CM.loc) return;
  await ensureSpotDB();
  const { lat, lon, name } = CM.loc, r = CM.radius;
  $('cmLocTitle').textContent = `Autour de ${name}`;
  $('cmRad').innerHTML = [25, 50, 100, 150].map(v => `<button class="${v === r ? 'on' : ''}" data-r="${v}">${v} km</button>`).join('');
  document.querySelectorAll('#cmRad button').forEach(b => b.onclick = () => { CM.radius = +b.dataset.r; cfg.cmRadius = CM.radius; saveCfg(); renderLocal(); });
  if (CM.map) {
    if (CM.circle) CM.circle.remove();
    if (typeof L.circle === 'function') {
      CM.circle = L.circle([lat, lon], { radius: r * 1000, color: '#22d3c5', weight: 2, fillOpacity: 0.05, dashArray: '6 6', interactive: false }).addTo(CM.map);
      CM.map.fitBounds(CM.circle.getBounds(), { padding: [10, 10] });
    }
  }
  // plages de la zone (jusqu'à 60 km de rayon, sinon trop de données)
  if (r <= 60) { const dLa = r / 110.5, dLo = r / (111.3 * Math.cos(lat * Math.PI / 180)); await loadBeaches(null, [lat - dLa, lat + dLa, lon - dLo, lon + dLo]); }
  const list = localSpots(lat, lon, r);
  const paint = () => {
    const t = cmTime();
    const rows = list.map(s => {
      const c = condAt(s, t), rt = rateCond(c), side = c ? sideOf(c.d, shoreOf(s)) : null;
      const score = rt === 'ok' ? (side === 'off' ? 1 : side === 'sideoff' ? 2 : 3) : rt === 'mid' ? 0 : -1;
      return { s, c, rt, side, score };
    }).sort((a, b) => b.score - a.score || (b.c && a.c ? (b.c.w || 0) - (a.c.w || 0) : 0) || a.s.d - b.s.d);
    const nOk = rows.filter(x => x.rt === 'ok').length;
    $('cmLocSum').innerHTML = `${list.length} spots à moins de ${r} km · <b style="color:#16a34a">${nOk} bons</b> · ${t === cmTime() && CM.h === 0 ? 'maintenant' : $('cmClock').textContent}`;
    $('cmLocList').innerHTML = rows.length ? rows.map((x, k) => {
      const dot = x.rt === 'ok' ? `<span class="ldot ok">${SAIL}</span>` : `<span class="ldot ${x.rt || 'un'}"></span>`;
      const wind = x.c && x.c.w != null ? `<span class="pill" style="background:${windColor(x.c.w)};color:${windTxt(x.c.w)}">${wf(x.c.w)}</span> <small>raf. ${wf(x.c.g)} ${dirName(x.c.d)}</small>` : '<small>…</small>';
      const sh = x.side ? shoreIcon(x.c.d, shoreOf(x.s), 20) : '';
      return `<div class="lrow" data-k="${k}">${dot}<span class="grow"><b>${x.s.fav ? '★ ' : ''}${esc(x.s.name)}</b><small>${x.s.d.toFixed(0)} km${x.side ? ' · <span style="color:' + SIDES[x.side].c + '">' + (x.side === 'off' ? '⚠ ' : '') + SIDES[x.side].l + '</span>' : ''}</small></span>${sh}<span class="lwind">${wind}</span></div>`;
    }).join('') : '<div class="empty" style="padding:14px">Aucun spot connu dans ce rayon. Agrandis le rayon ou crée un spot.</div>';
    document.querySelectorAll('#cmLocList .lrow').forEach(el => el.onclick = () => {
      const x = rows[+el.dataset.k];
      if (CM.map) { CM.map.setView([x.s.lat, x.s.lon], 12); setTimeout(() => cmTap(x.s), 300); }
      $('cmLocal').classList.add('mini');
    });
  };
  paint();
  // conditions et orientation des plages de la zone
  if (await fetchCond(list)) paint();
  const miss = list.filter(s => shoreOf(s) == null).slice(0, 8);
  for (const s of miss) { await ensureShore(s); }
  if (miss.length) paint();
  CM.paintLocal = paint;
}
$('cmLocalBtn').onclick = () => openLocal();
$('cmLocClose').onclick = () => { $('cmLocal').classList.remove('on', 'mini'); if (CM.circle) { CM.circle.remove(); CM.circle = null; } CM.paintLocal = null; };
$('cmLocHere').onclick = () => { CM.loc = null; openLocal(); };
$('cmLocCenter').onclick = async () => { if (!CM.map) return; const b = CM.map.getBounds(), c = CM.map.getCenter ? CM.map.getCenter() : { lat: (b.getSouth() + b.getNorth()) / 2, lng: (b.getWest() + b.getEast()) / 2 }; CM.loc = { lat: c.lat, lon: c.lng, name: (await reverseGeocode(c.lat, c.lng)) || 'centre de la carte' }; renderLocal(); };
$('cmLocToggle').onclick = () => $('cmLocal').classList.toggle('mini');

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
