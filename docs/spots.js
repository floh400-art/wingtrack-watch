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

/* ---------- conditions de vent par spot (vert / orange / noir) ---------- */
const COND = new Map(); // clé lat,lon → { at, off, time, ws, wg, wd }
const ckey = s => s.lat.toFixed(3) + ',' + s.lon.toFixed(3);
let condBusy = false;
async function fetchCond(spots) {
  const need = spots.filter(s => { const c = COND.get(ckey(s)); return !c || Date.now() - c.at > 45 * 60e3; });
  if (!need.length || condBusy || !navigator.onLine) return false;
  condBusy = true;
  try {
    for (let i = 0; i < need.length; i += 50) {
      const part = need.slice(i, i + 50);
      let j = await getJSON(`${OM}?latitude=${part.map(s => s.lat.toFixed(3)).join(',')}&longitude=${part.map(s => s.lon.toFixed(3)).join(',')}&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m&forecast_days=7&timezone=auto`);
      if (!Array.isArray(j)) j = [j];
      j.forEach((x, k) => { if (x && x.hourly) COND.set(ckey(part[k]), { at: Date.now(), off: x.utc_offset_seconds || 0, time: x.hourly.time, ws: x.hourly.wind_speed_10m, wg: x.hourly.wind_gusts_10m, wd: x.hourly.wind_direction_10m }); });
    }
    return true;
  } catch (e) { return false; } finally { condBusy = false; }
}
// heure affichée : celle du curseur de la carte, sinon maintenant (heure locale du spot)
function condAt(s, tStr) {
  const c = COND.get(ckey(s)); if (!c) return null;
  const t = tStr || new Date(Date.now() + c.off * 1000).toISOString().slice(0, 13) + ':00';
  const i = c.time.indexOf(t); if (i < 0) return null;
  return { w: c.ws[i], g: c.wg[i], d: c.wd[i] };
}
function rateCond(c) {
  if (!c || c.w == null) return null;
  const w = kn(c.w), g = c.g == null ? w : kn(c.g);
  if (w >= cfg.wmin && w <= cfg.wmax && g <= cfg.wmax + 10) return 'ok';
  if ((w >= cfg.wmin - 4 && w < cfg.wmin) || (w > cfg.wmax && w <= cfg.wmax + 5) || (w >= cfg.wmin && w <= cfg.wmax)) return 'mid';
  return 'no';
}
const SAIL = '<svg viewBox="0 0 24 24"><path d="M3.5 17.5C5 9 11 4 20.5 3c-3 4.5-3.6 9.6-2 15.5-4.8-2.6-10-2.9-15-1z"/><path d="M5 19.5l13-2" stroke-width="1.6" fill="none"/></svg>';
function condHtml(r, s) {
  if (r === 'ok') return `<div class="cmk ok">${SAIL}</div>`;
  if (r === 'mid') return `<div class="cmk mid"></div>`;
  if (r === 'no') return `<div class="cmk no"></div>`;
  return `<div class="cmk un">${s.icon || ''}</div>`;
}

/* ---------- tous les spots sur les cartes ---------- */
function visibleSpots(map) {
  const b = map.getBounds(), S = b.getSouth(), N = b.getNorth(), W = b.getWest(), E = b.getEast();
  const inB = s => s.lat >= S && s.lat <= N && s.lon >= W && s.lon <= E;
  const out = [];
  favs().forEach(s => inB(s) && out.push({ name: s.name, lat: s.lat, lon: s.lon, fav: true, icon: '★' }));
  (M.sessionSpots || []).forEach(s => { if (inB(s) && !out.some(o => sameSpot(o, s))) out.push({ name: s.name, lat: s.lat, lon: s.lon, icon: '🏄' }); });
  if (map.getZoom() >= 8 && SDB.list) {
    for (const s of SDB.list) {
      if (!inB(s) || out.some(o => Math.abs(o.lat - s.lat) < 0.003 && Math.abs(o.lon - s.lon) < 0.003)) continue;
      out.push({ name: spotLabel(s), lat: s.lat, lon: s.lon, icon: spotIcon(s) });
      if (out.length >= 150) break;
    }
  }
  return out;
}
function drawDbSpots(map, layer, onTap, tStr) {
  if (!map || !layer) return;
  layer.clearLayers();
  const list = visibleSpots(map);
  list.forEach(s => {
    const c = condAt(s, tStr), r = rateCond(c);
    const sz = r === 'ok' ? 30 : 18;
    const icon = L.divIcon({ className: '', html: condHtml(r, s), iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2] });
    const tip = `${esc(s.name)}${c && c.w != null ? ` · ${wf(c.w)} (raf. ${wf(c.g)}) ${wUnit()} ${dirName(c.d)}` : ''}`;
    L.marker([s.lat, s.lon], { icon, zIndexOffset: s.fav ? 900 : r === 'ok' ? 700 : 300 }).addTo(layer)
      .bindTooltip(tip, s.fav ? { permanent: true, direction: 'right', offset: [10, 0], className: 'stip' } : { direction: 'top', offset: [0, -10] })
      .on('click', ev => { L.DomEvent.stopPropagation(ev); onTap(s); });
  });
  // charge les conditions manquantes puis redessine
  fetchCond(list).then(changed => { if (changed) drawDbSpots(map, layer, onTap, tStr); });
}
const mxTimeStr = () => (M.field !== 'off' && typeof fieldTime === 'function' && fieldTime()) || null;
const wmTimeStr = () => (WM.grid ? WM.grid.T[WM.t] : null);
function refreshDbMarkers() {
  if (M.map) {
    if (!M.dbLayer) { M.dbLayer = L.layerGroup().addTo(M.map); M.map.on('moveend', () => drawDbSpots(M.map, M.dbLayer, s => onMapTap(s.lat, s.lon, s.name), mxTimeStr())); }
    drawDbSpots(M.map, M.dbLayer, s => onMapTap(s.lat, s.lon, s.name), mxTimeStr());
  }
  if (WM.map) {
    if (!WM.dbLayer) { WM.dbLayer = L.layerGroup().addTo(WM.map); WM.map.on('moveend', () => drawDbSpots(WM.map, WM.dbLayer, s => wmTap(s.lat, s.lon), wmTimeStr())); }
    drawDbSpots(WM.map, WM.dbLayer, s => wmTap(s.lat, s.lon), wmTimeStr());
  }
}
let condT = null;
const refreshCondSoon = () => { clearTimeout(condT); condT = setTimeout(refreshDbMarkers, 120); };
$('sdbRefresh').onclick = async e => { e.preventDefault(); dbStatus('Mise à jour des spots…'); try { await loadSpotDB(true); dbStatus(`${SDB.list.length} spots kite / windsurf / wing (OpenStreetMap)`); refreshDbMarkers(); } catch (e) { dbStatus('Mise à jour impossible (hors ligne ?)'); } };
