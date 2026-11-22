'use strict';
/* =========================================================================
   WingTrack — Base de spots kite / windsurf / wing (OpenStreetMap, Europe)
   + recherche unifiée : mes spots, spots de glisse, villes
   ========================================================================= */
const SDB = { list: null, loading: null, at: 0 };
const KIND = { kite: { i: '🪁', l: 'Kite' }, windsurf: { i: '🏄', l: 'Windsurf' }, wing: { i: '🪽', l: 'Wing' }, surf: { i: '🌊', l: 'Surf' } };
const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const kmBetween = (a, b) => WTStats.dist([0, a.lat, a.lon], [0, b.lat, b.lon]) / 1000;

// Overpass (OpenStreetMap) : tous les lieux tagués kitesurf / windsurf / wing en Europe
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const OV_QUERY = `[out:json][timeout:120];
(
  nwr["sport"~"kitesurfing|kiteboarding|windsurfing|wing_foil|wingfoil|wing_foiling|wingsurfing"](34,-12,71,35);
  nwr["leisure"="beach_resort"]["sport"~"kitesurfing|windsurfing"](34,-12,71,35);
);
out center tags;`;
async function loadSpotDB(force) {
  if (SDB.list && !force) return SDB.list;
  if (SDB.loading) return SDB.loading;
  if (!force) {
    try {
      const c = JSON.parse(localStorage.getItem('wt_spotdb') || 'null');
      if (c && c.list && Date.now() - c.at < 30 * 86400e3) { SDB.list = c.list; SDB.at = c.at; return SDB.list; }
    } catch (e) {}
  }
  SDB.loading = (async () => {
    let j = null;
    for (const url of OVERPASS) {
      try {
        const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(OV_QUERY), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        if (r.ok) { j = await r.json(); break; }
      } catch (e) {}
    }
    if (!j) throw new Error('Overpass indisponible');
    const seen = new Set(), list = [];
    (j.elements || []).forEach(e => {
      const lat = e.lat ?? (e.center && e.center.lat), lon = e.lon ?? (e.center && e.center.lon);
      if (lat == null || lon == null) return;
      const t = e.tags || {}, sp = (t.sport || '').toLowerCase();
      const k = [];
      if (/kite/.test(sp)) k.push('kite');
      if (/windsurf/.test(sp)) k.push('windsurf');
      if (/wing/.test(sp)) k.push('wing');
      if (!k.length) return;
      const key = lat.toFixed(3) + ',' + lon.toFixed(3);
      if (seen.has(key)) return; seen.add(key);
      list.push({ n: t.name || t['name:fr'] || '', lat: +lat.toFixed(5), lon: +lon.toFixed(5), k, c: t['addr:city'] || t['is_in'] || '' });
    });
    SDB.list = list; SDB.at = Date.now();
    try { localStorage.setItem('wt_spotdb', JSON.stringify({ at: SDB.at, list })); } catch (e) {}
    return list;
  })();
  try { return await SDB.loading; } finally { SDB.loading = null; }
}
const spotLabel = s => s.n || `Spot ${s.k.map(k => KIND[k].l.toLowerCase()).join(' / ')}`;
const spotIcon = s => KIND[s.k[0]].i;
function dbStatus(txt) { const el = $('sdbStatus'); if (el) el.textContent = txt; }
async function ensureSpotDB() {
  if (SDB.list) { dbStatus(`${SDB.list.length} spots kite / windsurf / wing (OpenStreetMap)`); return SDB.list; }
  dbStatus('Chargement des spots kite / windsurf…');
  try { const l = await loadSpotDB(); dbStatus(`${l.length} spots kite / windsurf / wing (OpenStreetMap)`); refreshDbMarkers(); return l; }
  catch (e) { dbStatus('Spots de glisse indisponibles hors ligne'); return []; }
}

/* ---------- recherche unifiée ---------- */
let sqT = null, sqSeq = 0;
$('mxQ').oninput = () => {
  clearTimeout(sqT);
  const q = $('mxQ').value.trim();
  $('mxQClear').style.display = q ? '' : 'none';
  if (q.length < 2) { $('mxRes').innerHTML = ''; return; }
  sqT = setTimeout(() => runSearch(q), 250);
};
$('mxQClear').onclick = () => { $('mxQ').value = ''; $('mxRes').innerHTML = ''; $('mxQClear').style.display = 'none'; };
async function runSearch(q) {
  const seq = ++sqSeq, nq = norm(q);
  const ref = M.spot || cfg.meteoSpot || null;
  const match = name => { const n = norm(name); return n.startsWith(nq) || n.includes(' ' + nq) || (nq.length >= 3 && n.includes(nq)); };
  // 1. mes spots
  const mine = favs().map(s => ({ ...s, mine: 'fav' })).concat((M.sessionSpots || []).filter(s => !isFav(s)).map(s => ({ ...s, mine: 'ses' })))
    .filter(s => match(s.name)).slice(0, 5);
  // 2. base de spots de glisse
  const db = SDB.list || [];
  let glisse = db.filter(s => match(s.n) || (s.c && match(s.c)));
  if (ref) glisse.sort((a, b) => kmBetween(ref, a) - kmBetween(ref, b));
  glisse = glisse.slice(0, 8);
  const section = (title, rows) => rows ? `<div class="sres-h">${title}</div>${rows}` : '';
  const items = [];
  const row = (o, icon, title, sub) => { items.push(o); return `<div class="ev sres" data-i="${items.length - 1}"><span class="sico">${icon}</span><span class="grow"><b>${esc(title)}</b><small>${esc(sub)}</small></span><span class="sgo">›</span></div>`; };
  let html = section('Mes spots', mine.map(s => row({ name: s.name, lat: s.lat, lon: s.lon }, s.mine === 'fav' ? '★' : '🏄', s.name, s.mine === 'fav' ? 'spot enregistré' : 'spot de session')).join(''));
  html += section('Spots kite / windsurf / wing', glisse.map(s => row({ name: spotLabel(s), lat: s.lat, lon: s.lon }, spotIcon(s), spotLabel(s), [s.k.map(k => KIND[k].l).join(' · '), s.c, ref ? Math.round(kmBetween(ref, s)) + ' km' : ''].filter(Boolean).join(' · '))).join(''));
  $('mxRes').innerHTML = html || '<div class="empty" style="padding:12px">Recherche…</div>';
  bindRes(items);
  // 3. villes (géocodage) + spots de glisse autour de chaque ville
  try {
    const j = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=fr`);
    if (seq !== sqSeq) return;
    const towns = (j.results || []);
    const near = [];
    towns.slice(0, 2).forEach(t => {
      db.map(s => ({ s, d: kmBetween({ lat: t.latitude, lon: t.longitude }, s) })).filter(x => x.d <= 25).sort((a, b) => a.d - b.d).slice(0, 6)
        .forEach(x => { if (!near.some(y => y.s === x.s) && !glisse.includes(x.s)) near.push({ ...x, town: t.name }); });
    });
    html += section('Villes', towns.map(t => row({ name: t.name, lat: t.latitude, lon: t.longitude }, '🏙️', t.name, [t.admin1, t.country].filter(Boolean).join(', '))).join(''));
    html += section(near.length ? `Spots près de ${near[0].town}` : '', near.map(x => row({ name: spotLabel(x.s), lat: x.s.lat, lon: x.s.lon }, spotIcon(x.s), spotLabel(x.s), `${x.s.k.map(k => KIND[k].l).join(' · ')} · ${x.d.toFixed(1)} km de ${x.town}`)).join(''));
    $('mxRes').innerHTML = html || '<div class="empty" style="padding:12px">Aucun résultat</div>';
    bindRes(items);
  } catch (e) {
    if (seq !== sqSeq) return;
    if (!html) $('mxRes').innerHTML = '<div class="empty" style="padding:12px">Aucun résultat (recherche de villes indisponible hors ligne)</div>';
  }
}
function bindRes(items) {
  document.querySelectorAll('#mxRes [data-i]').forEach(el => el.onclick = () => {
    const o = items[+el.dataset.i];
    $('mxQ').value = ''; $('mxRes').innerHTML = ''; $('mxQClear').style.display = 'none'; $('mxQ').blur();
    setSpot(o);
  });
}

/* ---------- spots de glisse sur les cartes ---------- */
function drawDbSpots(map, layer, onTap) {
  if (!map || !layer || !SDB.list) return;
  layer.clearLayers();
  if (map.getZoom() < 8) return; // trop de points à petite échelle
  const b = map.getBounds(), S = b.getSouth(), N = b.getNorth(), W = b.getWest(), E = b.getEast();
  let n = 0;
  for (const s of SDB.list) {
    if (s.lat < S || s.lat > N || s.lon < W || s.lon > E) continue;
    if (favs().some(f => Math.abs(f.lat - s.lat) < 0.003 && Math.abs(f.lon - s.lon) < 0.003)) continue;
    const icon = L.divIcon({ className: '', html: `<div class="dbmk">${spotIcon(s)}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] });
    L.marker([s.lat, s.lon], { icon, zIndexOffset: 200 }).addTo(layer)
      .bindTooltip(esc(spotLabel(s)), { direction: 'top', offset: [0, -10] })
      .on('click', ev => { L.DomEvent.stopPropagation(ev); onTap(s); });
    if (++n >= 400) break;
  }
}
function refreshDbMarkers() {
  if (M.map) { if (!M.dbLayer) { M.dbLayer = L.layerGroup().addTo(M.map); M.map.on('moveend', () => drawDbSpots(M.map, M.dbLayer, s => onMapTap(s.lat, s.lon, spotLabel(s)))); } drawDbSpots(M.map, M.dbLayer, s => onMapTap(s.lat, s.lon, spotLabel(s))); }
  if (WM.map) { if (!WM.dbLayer) { WM.dbLayer = L.layerGroup().addTo(WM.map); WM.map.on('moveend', () => drawDbSpots(WM.map, WM.dbLayer, s => wmTap(s.lat, s.lon))); } drawDbSpots(WM.map, WM.dbLayer, s => wmTap(s.lat, s.lon)); }
}
$('sdbRefresh').onclick = async e => { e.preventDefault(); dbStatus('Mise à jour des spots…'); try { await loadSpotDB(true); dbStatus(`${SDB.list.length} spots kite / windsurf / wing (OpenStreetMap)`); refreshDbMarkers(); } catch (e) { dbStatus('Mise à jour impossible (hors ligne ?)'); } };
