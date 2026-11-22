'use strict';
/* =========================================================================
   WingTrack — Orientation des plages et vent on-shore / off-shore
   Orientation auto : trait de côte OpenStreetMap (natural=coastline : la terre
   est à gauche du sens de tracé, la mer à droite) ; plans d'eau en secours.
   Réglage manuel possible pour chaque spot enregistré.
   ========================================================================= */
const SHORE = (() => { try { return JSON.parse(localStorage.getItem('wt_shore') || '{}'); } catch (e) { return {}; } })();
const shKey = s => s.lat.toFixed(3) + ',' + s.lon.toFixed(3);
const saveShore = () => { try { localStorage.setItem('wt_shore', JSON.stringify(SHORE)); } catch (e) {} };
const SH_PENDING = new Map(), SH_RETRY = new Set();

// direction de la mer vue depuis la plage (°), null si inconnue
function shoreOf(s) {
  if (!s) return null;
  const f = favs().find(x => sameSpot(x, s));
  if (f && f.shore != null && f.shore !== '') return +f.shore;
  const v = SHORE[shKey(s)];
  return v == null || v < 0 ? null : v;
}
// classement du vent (d'où il vient) par rapport à la mer
const SIDES = {
  on: { l: 'On-shore', s: 'on', c: '#22c55e', d: 'vent de mer' },
  sideon: { l: 'Side-on', s: 's-on', c: '#22c55e', d: 'de travers, vers la plage' },
  side: { l: 'Side-shore', s: 'side', c: '#a3e635', d: 'parallèle à la plage' },
  sideoff: { l: 'Side-off', s: 's-off', c: '#f59e0b', d: 'prudence : tend à t\'éloigner' },
  off: { l: 'Off-shore', s: 'OFF', c: '#ef4444', d: 'vent de terre : dangereux en cas de casse' },
};
function sideOf(windFrom, shore) {
  if (windFrom == null || shore == null) return null;
  let a = Math.abs(((windFrom - shore) % 360 + 540) % 360 - 180);
  return a <= 30 ? 'on' : a <= 70 ? 'sideon' : a <= 110 ? 'side' : a <= 150 ? 'sideoff' : 'off';
}

/* ---------- calcul depuis OpenStreetMap ---------- */
function shoreFromElements(s, els) {
  const lat0 = s.lat * Math.PI / 180, mx = lon => (lon - s.lon) * 111320 * Math.cos(lat0), my = lat => (lat - s.lat) * 110540;
  let best = null;
  els.forEach(e => {
    if (!e.tags || e.tags.natural !== 'coastline' || !e.geometry) return;
    const g = e.geometry;
    for (let i = 0; i + 1 < g.length; i++) {
      const ax = mx(g[i].lon), ay = my(g[i].lat), bx = mx(g[i + 1].lon), by = my(g[i + 1].lat);
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2));
      const px = ax + t * dx, py = ay + t * dy, d = Math.hypot(px, py);
      if (!best || d < best.d) best = { d, br: (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360 };
    }
  });
  if (best && best.d < 4000) return (best.br + 90) % 360; // mer à droite du tracé
  // plan d'eau (lac) : direction du centre du plan d'eau le plus proche
  let lake = null;
  els.forEach(e => {
    if (!e.tags || e.tags.natural !== 'water') return;
    const pts = e.geometry || (e.members || []).flatMap(m => m.geometry || []);
    if (!pts.length) return;
    const cx = pts.reduce((a, p) => a + p.lon, 0) / pts.length, cy = pts.reduce((a, p) => a + p.lat, 0) / pts.length;
    const d = Math.min(...pts.map(p => Math.hypot(mx(p.lon), my(p.lat))));
    if (!lake || d < lake.d) lake = { d, br: (Math.atan2(mx(cx), my(cy)) * 180 / Math.PI + 360) % 360 };
  });
  return lake && lake.d < 2500 ? lake.br : -1;
}
async function overpass(q) {
  for (const url of OVERPASS) {
    try {
      const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (r.ok) return await r.json();
    } catch (e) {}
  }
  throw new Error('Overpass indisponible');
}
// Méthode 2 (secours) : où est la mer autour du spot ? On interroge le modèle de vagues sur
// 2 cercles de 16 points (3 et 7 km) : là où il y a des vagues, c'est la mer.
async function shoreFromMarine(s) {
  const pts = [];
  [3, 7].forEach(km => { for (let k = 0; k < 16; k++) { const a = k * 22.5 * Math.PI / 180;
    pts.push({ b: k * 22.5, w: km === 3 ? 2 : 1, lat: s.lat + Math.cos(a) * km / 110.54, lon: s.lon + Math.sin(a) * km / (111.32 * Math.cos(s.lat * Math.PI / 180)) }); } });
  let j = await getJSON(`${MAR}?latitude=${pts.map(p => p.lat.toFixed(4)).join(',')}&longitude=${pts.map(p => p.lon.toFixed(4)).join(',')}&hourly=wave_height&forecast_days=1`);
  if (!Array.isArray(j)) j = [j];
  let x = 0, y = 0, sea = 0;
  j.forEach((r, k) => {
    const h = r && r.hourly && r.hourly.wave_height;
    if (h && h.some(v => v != null)) { const a = pts[k].b * Math.PI / 180; x += Math.sin(a) * pts[k].w; y += Math.cos(a) * pts[k].w; sea++; }
  });
  if (!sea || sea === pts.length || Math.hypot(x, y) < 1) return -1; // tout terre, tout mer ou indécis
  return (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
}
async function ensureShore(s) {
  const k = shKey(s);
  // une orientation « inconnue » (-1) est retentée une fois par ouverture de l'appli
  if ((SHORE[k] != null && !(SHORE[k] < 0 && !SH_RETRY.has(k))) || !navigator.onLine) return shoreOf(s);
  SH_RETRY.add(k);
  if (SH_PENDING.has(k)) return SH_PENDING.get(k);
  const p = (async () => {
    let v = null;
    try {
      const j = await overpass(`[out:json][timeout:25];(way["natural"="coastline"](around:4000,${s.lat},${s.lon});way["natural"="water"](around:2500,${s.lat},${s.lon});relation["natural"="water"](around:2500,${s.lat},${s.lon}););out geom;`);
      v = Math.round(shoreFromElements(s, j.elements || []));
    } catch (e) { /* OpenStreetMap indisponible : on passe au secours */ }
    if (v == null || v < 0) { try { const m = await shoreFromMarine(s); if (m >= 0) v = Math.round(m); else if (v == null) v = m; } catch (e) {} }
    if (v != null) { SHORE[k] = v; saveShore(); }
    SH_PENDING.delete(k);
    return shoreOf(s);
  })();
  SH_PENDING.set(k, p);
  return p;
}
// tous les spots visibles d'une carte, en une requête (trait de côte de la zone)
const SH_AREAS = new Set();
async function ensureShoreArea(map, spots) {
  if (!map || map.getZoom() < 9 || !navigator.onLine) return false;
  const todo = spots.filter(s => SHORE[shKey(s)] == null);
  if (!todo.length) return false;
  const b = map.getBounds(), key = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map(x => x.toFixed(2)).join(',');
  if (SH_AREAS.has(key)) return false;
  SH_AREAS.add(key);
  const S = Math.min(...todo.map(s => s.lat)) - 0.04, N = Math.max(...todo.map(s => s.lat)) + 0.04, W = Math.min(...todo.map(s => s.lon)) - 0.06, E = Math.max(...todo.map(s => s.lon)) + 0.06;
  try {
    const j = await overpass(`[out:json][timeout:40];(way["natural"="coastline"](${S},${W},${N},${E});way["natural"="water"](${S},${W},${N},${E}););out geom;`);
    todo.forEach(s => { SHORE[shKey(s)] = Math.round(shoreFromElements(s, j.elements || [])); });
    saveShore(); return true;
  } catch (e) {
    // OpenStreetMap indisponible : méthode des vagues pour quelques spots (requêtes limitées)
    let any = false;
    for (const s of todo.slice(0, 6)) { try { const m = await shoreFromMarine(s); SHORE[shKey(s)] = Math.round(m); any = true; } catch (x) { break; } }
    if (any) saveShore();
    SH_AREAS.delete(key); return any;
  }
}
const sideTag = side => side ? `<span class="sidetag" style="color:${SIDES[side].c}">${side === 'off' ? '⚠ ' : ''}${SIDES[side].l}</span>` : '';

// Icône « plage » : mer en haut, sable en bas, flèche = sens du vent par rapport à la plage
function shoreIcon(windFrom, shore, size = 26) {
  const side = sideOf(windFrom, shore); if (!side) return '';
  const rel = windFrom - shore, col = SIDES[side].c;
  return `<svg class="shico" width="${size}" height="${size}" viewBox="0 0 26 26" aria-label="${SIDES[side].l}">
    <rect x="0" y="0" width="26" height="13" rx="4" fill="#1e5f8c"/><path d="M0 9 Q4 7 8 9 T16 9 T26 9 V13 H0Z" fill="#2b7bb0"/>
    <rect x="0" y="13" width="26" height="13" rx="4" fill="#d9b56b"/><path d="M0 13 Q6 15 13 13 T26 13" stroke="#f2e3b3" stroke-width="1.4" fill="none"/>
    <g transform="rotate(${rel + 180} 13 13)"><path d="M13 3 L18 11 H14.6 V23 H11.4 V11 H8 Z" fill="${col}" stroke="#06141f" stroke-width="1.2" stroke-linejoin="round"/></g>
    ${side === 'off' ? '<circle cx="21" cy="21" r="4.5" fill="#ef4444" stroke="#fff" stroke-width="1"/><text x="21" y="23.6" font-size="7" font-weight="900" text-anchor="middle" fill="#fff">!</text>' : ''}
  </svg>`;
}
const sideBadge = (windFrom, shore) => { const sd = sideOf(windFrom, shore); return sd ? `<span class="sidebadge">${shoreIcon(windFrom, shore, 22)}<span style="color:${SIDES[sd].c}">${sd === 'off' ? '⚠ ' : ''}${SIDES[sd].l}</span></span>` : ''; };
