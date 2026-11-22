'use strict';
/* =========================================================================
   WingTrack — Base de spots kite / windsurf / wing (OpenStreetMap, Europe)
   + recherche unifiée : mes spots, spots de glisse, villes
   ========================================================================= */
const SDB = { list: null, loading: null, at: 0 };
const KIND = { kite: { i: '🪁', l: 'Kite' }, windsurf: { i: '🏄', l: 'Windsurf' }, wing: { i: '🪽', l: 'Wing' }, surf: { i: '🌊', l: 'Surf' }, beach: { i: '🏖️', l: 'Plage' } };
try { localStorage.removeItem('wt_spotdb'); localStorage.removeItem('wt_spotdb3'); localStorage.removeItem('wt_spotdb4'); } catch (e) {} // anciennes listes

/* ---------- plages (spots possibles), chargées par zone quand on zoome ---------- */
const BEACH = { cells: new Map(), loading: new Set() };
try { const c = JSON.parse(localStorage.getItem('wt_beach') || '{}'); Object.entries(c).forEach(([k, v]) => { if (Date.now() - v.at < 60 * 86400e3) BEACH.cells.set(k, v); }); } catch (e) {}
const BCELL = 0.25;
function saveBeaches() { try { const o = {}; BEACH.cells.forEach((v, k) => o[k] = v); localStorage.setItem('wt_beach', JSON.stringify(o)); } catch (e) { /* plein : tant pis */ } }
async function loadBeaches(map, box) {
  if (!navigator.onLine) return false;
  if (!box) { if (!map || map.getZoom() < 10) return false; const b = map.getBounds(); box = [b.getSouth(), b.getNorth(), b.getWest(), b.getEast()]; }
  const cells = [];
  for (let r = Math.floor(box[0] / BCELL); r <= Math.floor(box[1] / BCELL); r++)
    for (let c = Math.floor(box[2] / BCELL); c <= Math.floor(box[3] / BCELL); c++) {
      const k = r + ',' + c; if (!BEACH.cells.has(k) && !BEACH.loading.has(k)) cells.push([r, c, k]);
    }
  if (!cells.length) return false;
  cells.forEach(x => BEACH.loading.add(x[2]));
  const S = Math.min(...cells.map(x => x[0])) * BCELL, N = (Math.max(...cells.map(x => x[0])) + 1) * BCELL, W = Math.min(...cells.map(x => x[1])) * BCELL, E = (Math.max(...cells.map(x => x[1])) + 1) * BCELL;
  try {
    const beaches = await osmJob({ type: 'beaches', q: `[out:json][timeout:40];(nwr["natural"="beach"](${S},${W},${N},${E});nwr["leisure"="beach_resort"](${S},${W},${N},${E}););out center tags;` });
    const per = new Map(cells.map(x => [x[2], []]));
    beaches.forEach(b => { const k = Math.floor(b.lat / BCELL) + ',' + Math.floor(b.lon / BCELL); if (per.has(k)) per.get(k).push(b); });
    per.forEach((list, k) => BEACH.cells.set(k, { at: Date.now(), list }));
    saveBeaches(); return true;
  } catch (e) { return false; } finally { cells.forEach(x => BEACH.loading.delete(x[2])); }
}
function beachesIn(S, N, W, E) {
  const out = [];
  for (let r = Math.floor(S / BCELL); r <= Math.floor(N / BCELL); r++)
    for (let c = Math.floor(W / BCELL); c <= Math.floor(E / BCELL); c++) { const v = BEACH.cells.get(r + ',' + c); if (v) out.push(...v.list); }
  return out;
}
const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const kmBetween = (a, b) => WTStats.dist([0, a.lat, a.lon], [0, b.lat, b.lon]) / 1000;

// Overpass (OpenStreetMap) : tous les lieux tagués kitesurf / windsurf / wing en Europe
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const BB = '(34,-12,71,35)';
const OV_QUERIES = [
  `[out:json][timeout:90];(nwr["sport"~"kite|windsurf|wing",i]${BB};nwr["kitesurfing"~"yes|designated"]${BB};nwr["windsurfing"~"yes|designated"]${BB};nwr["kiteboarding"~"yes|designated"]${BB};);out center tags;`,
];
// processus en arrière-plan (évite les gels de l'écran)
const OSMW = { w: null, n: 0, cb: new Map() };
function osmJob(msg) {
  if (!OSMW.w) {
    try {
      OSMW.w = new Worker('osmworker.js');
      OSMW.w.onmessage = ev => { const f = OSMW.cb.get(ev.data.id); if (f) { OSMW.cb.delete(ev.data.id); f(ev.data); } };
    } catch (e) { return Promise.reject(e); }
  }
  const id = ++OSMW.n;
  return new Promise((res, rej) => { OSMW.cb.set(id, d => d.ok ? res(d.data) : rej(new Error(d.err))); OSMW.w.postMessage({ ...msg, id }); });
}
async function loadSpotDB(force) {
  if (SDB.list && !force) return SDB.list;
  if (SDB.loading) return SDB.loading;
  if (!force) {
    try {
      const c = JSON.parse(localStorage.getItem('wt_spotdb5') || 'null');
      if (c && c.list && Date.now() - c.at < 30 * 86400e3) { SDB.list = c.list; SDB.at = c.at; return SDB.list; }
    } catch (e) {}
  }
  SDB.loading = (async () => {
    const list = await osmJob({ type: 'spotdb', qs: OV_QUERIES });
    SDB.list = list; SDB.at = Date.now();
    setTimeout(() => { try { localStorage.setItem('wt_spotdb5', JSON.stringify({ at: SDB.at, list })); } catch (e) {} }, 500);
    return list;
  })();
  try { return await SDB.loading; } finally { SDB.loading = null; }
}
const spotLabel = s => s.n || (s.k[0] === 'beach' ? 'Plage' : `Spot ${s.k.map(k => KIND[k].l.toLowerCase()).join(' / ')}`);
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
function condHtml(r, s, side) {
  const w = side === 'off' ? ' off' : side === 'sideoff' ? ' soff' : '';
  if (r === 'ok') return `<div class="cmk ok${w}">${SAIL}${side === 'off' ? '<b>⚠</b>' : ''}</div>`;
  if (r === 'mid') return `<div class="cmk mid${w}">${side === 'off' ? '<b>⚠</b>' : ''}</div>`;
  if (r === 'no') return `<div class="cmk no"></div>`;
  return `<div class="cmk un">${s.icon || ''}</div>`;
}

/* ---------- tous les spots sur les cartes ---------- */
function visibleSpots(map, minZoom = 8, cap = 150) {
  const b = map.getBounds(), S = b.getSouth(), N = b.getNorth(), W = b.getWest(), E = b.getEast();
  const inB = s => s.lat >= S && s.lat <= N && s.lon >= W && s.lon <= E;
  const out = [];
  favs().forEach(s => inB(s) && out.push({ name: s.name, lat: s.lat, lon: s.lon, fav: true, icon: '★' }));
  (M.sessionSpots || []).forEach(s => { if (inB(s) && !out.some(o => sameSpot(o, s))) out.push({ name: s.name, lat: s.lat, lon: s.lon, icon: '🏄' }); });
  if (map.getZoom() >= minZoom && SDB.list) {
    // les plus proches du centre de la carte d'abord
    const c = map.getCenter ? map.getCenter() : { lat: (S + N) / 2, lng: (W + E) / 2 };
    const pool = SDB.list.filter(inB);
    if (map.getZoom() >= 10) beachesIn(S, N, W, E).filter(inB).forEach(bch => { if (!pool.some(p => Math.abs(p.lat - bch.lat) < 0.004 && Math.abs(p.lon - bch.lon) < 0.004)) pool.push({ ...bch, beach: true }); });
    const cand = pool.map(s => ({ s, d: (s.lat - c.lat) ** 2 + ((s.lon - c.lng) * Math.cos(c.lat * Math.PI / 180)) ** 2 })).sort((a, b) => (a.s.beach ? 1 : 0) - (b.s.beach ? 1 : 0) || a.d - b.d);
    for (const { s } of cand) {
      if (out.length >= cap) break;
      if (out.some(o => Math.abs(o.lat - s.lat) < 0.003 && Math.abs(o.lon - s.lon) < 0.003)) continue;
      out.push({ name: s.beach ? (s.n || 'Plage') : spotLabel(s), lat: s.lat, lon: s.lon, icon: spotIcon(s), beach: !!s.beach });
    }
  }
  return out;
}
function watchMoves(map) {
  if (map._wtWatch) return; map._wtWatch = true;
  map.on('movestart', () => { map._wtMoving = true; });
  map.on('moveend', () => { map._wtMoving = false; });
}
function scheduleRedraw(map, layer, onTap, tStr, opts) {
  clearTimeout(layer._wtRT);
  layer._wtRT = setTimeout(() => drawDbSpots(map, layer, onTap, opts.timeFn ? opts.timeFn() : tStr, opts), 350);
}
function drawDbSpots(map, layer, onTap, tStr, opts = {}) {
  if (!map || !layer) return;
  if (!map.getContainer().offsetParent) return; // carte cachée (autre onglet) : rien à dessiner
  watchMoves(map);
  if (map._wtMoving) return; // on redessinera à la fin du déplacement
  const cache = layer._wt || (layer._wt = new Map()), seen = new Set();
  const list = visibleSpots(map, opts.minZoom ?? 8, opts.cap ?? 150);
  let shown = { ok: 0, mid: 0, no: 0, off: 0 };
  list.forEach(s => {
    const c = condAt(s, tStr), r = rateCond(c), side = c ? sideOf(c.d, shoreOf(s)) : null;
    if (r) shown[r]++; if (r === 'ok' && side === 'off') shown.off++;
    if (opts.onlyOk && r !== 'ok' && !s.fav) return;
    const key = s.lat.toFixed(4) + ',' + s.lon.toFixed(4); seen.add(key);
    const html = condHtml(r, s, side), sz = r === 'ok' ? 30 : 18;
    const tip = `${esc(s.name)}${c && c.w != null ? ` · ${wf(c.w)} (raf. ${wf(c.g)}) ${wUnit()} ${dirName(c.d)}` : ''}${side ? ` · ${SIDES[side].l}${side === 'off' ? ' ⚠ ' + SIDES[side].d : ''}` : ''}`;
    let v = cache.get(key);
    if (!v) {
      v = { s, html, tip, r };
      v.m = L.marker([s.lat, s.lon], { icon: L.divIcon({ className: '', html, iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2] }), zIndexOffset: s.fav ? 900 : r === 'ok' ? 700 : 300 }).addTo(layer)
        .bindTooltip(tip, s.fav ? { permanent: true, direction: 'right', offset: [10, 0], className: 'stip' } : { direction: 'top', offset: [0, -10] })
        .on('click', ev => { L.DomEvent.stopPropagation(ev); onTap(v.s); });
      cache.set(key, v);
    } else {
      v.s = s;
      if (v.html !== html) { v.m.setIcon(L.divIcon({ className: '', html, iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2] })); v.html = html; }
      if (v.tip !== tip && v.m.setTooltipContent) { v.m.setTooltipContent(tip); v.tip = tip; }
    }
  });
  cache.forEach((v, k) => { if (!seen.has(k)) { layer.removeLayer(v.m); cache.delete(k); } });
  if (opts.onCount) opts.onCount(shown, list.length, list.filter(x => x.beach).length);
  // données manquantes : chargées en arrière-plan, puis UN seul redessin regroupé
  const again = changed => { if (changed) scheduleRedraw(map, layer, onTap, tStr, opts); };
  loadBeaches(map).then(again);
  fetchCond(list).then(again);
  if (typeof ensureShoreArea === 'function') ensureShoreArea(map, list).then(again);
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
