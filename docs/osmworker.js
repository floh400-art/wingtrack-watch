'use strict';
/* =========================================================================
   WingTrack — Processus en arrière-plan pour OpenStreetMap (Overpass)
   Téléchargement + lecture des grosses réponses + calculs de côte,
   sans bloquer l'écran. Messages : { id, type, q, spots } → { id, ok, data | err }
   ========================================================================= */
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
async function overpass(q) {
  let last = null;
  for (const url of OVERPASS) {
    try {
      const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (r.ok) return await r.json();
      last = new Error('HTTP ' + r.status);
    } catch (e) { last = e; }
  }
  throw last || new Error('Overpass indisponible');
}
function parseSpots(els) {
  const seen = new Set(), list = [];
  (els || []).forEach(e => {
    const lat = e.lat ?? (e.center && e.center.lat), lon = e.lon ?? (e.center && e.center.lon);
    if (lat == null || lon == null) return;
    const t = e.tags || {}, sp = (t.sport || '').toLowerCase(), nm = (t.name || '').toLowerCase();
    if (t.highway || t.route || t.railway || t.shop || t.office || t.craft) return; // pas de magasins / bureaux : seulement les spots
    const k = [];
    if (/kite/.test(sp) || /yes|designated/.test(t.kitesurfing || t.kiteboarding || '') || /kite/.test(nm)) k.push('kite');
    if (/windsurf/.test(sp) || /yes|designated/.test(t.windsurfing || '') || /windsurf/.test(nm)) k.push('windsurf');
    if (/wing/.test(sp) || /wing ?foil|wingsurf/.test(nm)) k.push('wing');
    if (!k.length) return;
    const key = lat.toFixed(3) + ',' + lon.toFixed(3);
    if (seen.has(key)) return; seen.add(key);
    list.push({ n: t.name || t['name:fr'] || '', lat: +lat.toFixed(5), lon: +lon.toFixed(5), k, c: t['addr:city'] || t['is_in'] || '' });
  });
  return list;
}
// --- orientation des plages (mêmes règles que shore.js) ---
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
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (!best || d < best.d) best = { d, br: (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360 };
    }
  });
  if (best && best.d < 4000) return (best.br + 90) % 360;
  let lake = null;
  els.forEach(e => {
    if (!e.tags || e.tags.natural !== 'water') return;
    const pts = e.geometry || (e.members || []).flatMap(m => m.geometry || []);
    if (!pts.length) return;
    const cx = pts.reduce((a, p) => a + p.lon, 0) / pts.length, cy = pts.reduce((a, p) => a + p.lat, 0) / pts.length;
    let d = Infinity; for (const p of pts) d = Math.min(d, Math.hypot(mx(p.lon), my(p.lat)));
    if (!lake || d < lake.d) lake = { d, br: (Math.atan2(mx(cx), my(cy)) * 180 / Math.PI + 360) % 360 };
  });
  return lake && lake.d < 2500 ? lake.br : -1;
}
const CELL = 0.05;
function shoreForSpots(els, spots) {
  const cells = new Map(), waters = [];
  const add = (k, seg) => { let a = cells.get(k); if (!a) cells.set(k, a = []); a.push(seg); };
  els.forEach(e => {
    if (!e.tags || !e.geometry) return;
    if (e.tags.natural === 'coastline') {
      const g = e.geometry;
      for (let i = 0; i + 1 < g.length; i++) {
        const k1 = Math.floor(g[i].lat / CELL) + ',' + Math.floor(g[i].lon / CELL), k2 = Math.floor(g[i + 1].lat / CELL) + ',' + Math.floor(g[i + 1].lon / CELL);
        const seg = [g[i], g[i + 1]]; add(k1, seg); if (k2 !== k1) add(k2, seg);
      }
    } else if (e.tags.natural === 'water') waters.push(e);
  });
  return spots.map(s => {
    const r0 = Math.floor(s.lat / CELL), c0 = Math.floor(s.lon / CELL), near = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const a = cells.get((r0 + dr) + ',' + (c0 + dc)); if (a) for (const g of a) near.push({ tags: { natural: 'coastline' }, geometry: g }); }
    waters.forEach(w => { const p = w.geometry[0]; if (p && Math.abs(p.lat - s.lat) < 0.1 && Math.abs(p.lon - s.lon) < 0.15) near.push(w); });
    return Math.round(shoreFromElements(s, near));
  });
}
self.onmessage = async ev => {
  const { id, type, q, qs, spots } = ev.data;
  try {
    let data;
    if (type === 'spotdb') {
      // plusieurs requêtes : si la plus lourde échoue, on garde les autres
      let list = [], okAny = false;
      for (const qq of qs) { try { const j = await overpass(qq); list = list.concat(parseSpots(j.elements)); okAny = true; } catch (e) {} }
      if (!okAny) throw new Error('Overpass indisponible');
      const seen = new Set(); data = list.filter(s => { const k = s.lat.toFixed(3) + ',' + s.lon.toFixed(3); if (seen.has(k)) return false; seen.add(k); return true; });
    } else if (type === 'beaches') {
      const j = await overpass(q);
      data = (j.elements || []).map(e => { const lat = e.lat ?? (e.center && e.center.lat), lon = e.lon ?? (e.center && e.center.lon); return lat == null ? null : { n: (e.tags && (e.tags.name || e.tags['name:fr'])) || '', lat: +lat.toFixed(5), lon: +lon.toFixed(5), k: ['beach'] }; }).filter(Boolean);
    } else if (type === 'shore') {
      const j = await overpass(q);
      data = shoreForSpots(j.elements || [], spots);
    }
    self.postMessage({ id, ok: true, data });
  } catch (e) { self.postMessage({ id, ok: false, err: String(e && e.message || e) }); }
};
