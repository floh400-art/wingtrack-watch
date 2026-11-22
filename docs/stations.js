'use strict';
/* =========================================================================
   WingTrack — Balises de vent en direct (réseau ouvert OpenWindMap / Pioupiou)
   Licence Community : usage libre avec attribution
   « Wind data (c) contributors of the OpenWindMap wind network »
   API : https://api.pioupiou.fr/v1/live/all (km/h, rafraîchir ≤ 1 fois par minute)
   ========================================================================= */
const STA = { list: null, at: 0, loading: null };
const STA_ATTR = 'Balises © contributeurs <a href="https://openwindmap.org" target="_blank">OpenWindMap</a>';
async function loadStations() {
  if (STA.list && Date.now() - STA.at < 3 * 60e3) return STA.list;
  if (STA.loading) return STA.loading;
  STA.loading = (async () => {
    const r = await fetch('https://api.pioupiou.fr/v1/live/all');
    if (!r.ok) throw new Error(r.status);
    const j = await r.json(), now = Date.now();
    STA.list = (j.data || []).map(x => {
      const m = x.measurements || {}, l = x.location || {};
      const at = m.date ? Date.parse(m.date) : 0;
      if (l.latitude == null || l.longitude == null || m.wind_speed_avg == null || now - at > 2 * 3600e3) return null;
      return { id: x.id, name: (x.meta && x.meta.name) || 'Balise ' + x.id, lat: l.latitude, lon: l.longitude, w: m.wind_speed_avg, wmax: m.wind_speed_max, wmin: m.wind_speed_min, d: m.wind_heading, at };
    }).filter(Boolean);
    STA.at = now;
    return STA.list;
  })();
  try { return await STA.loading; } finally { STA.loading = null; }
}
const agoTxt = ms => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'à l\'instant' : m < 60 ? `il y a ${m} min` : `il y a ${Math.round(m / 60)} h`; };
function staIcon(s) {
  const col = windColor(s.w), txt = windTxt(s.w);
  return `<div class="stmk"><svg viewBox="0 0 24 24" style="transform:rotate(${(s.d || 0) + 180}deg)"><path d="M12 2l5 9h-3.2v11h-3.6V11H7z"/></svg><span style="background:${col};color:${txt}">${wf(s.w)}</span></div>`;
}
function drawStations(map, layer, onTap) {
  if (!map || !layer) return;
  if (!cfg.showStations && cfg.showStations !== undefined) { layer.clearLayers(); return; }
  if (map.getZoom() < 6) { layer.clearLayers(); return; }
  if (map._wtMoving) return;
  loadStations().then(list => {
    const b = map.getBounds(), S = b.getSouth(), N = b.getNorth(), W = b.getWest(), E = b.getEast();
    const cache = layer._st || (layer._st = new Map()), seen = new Set();
    let n = 0;
    for (const s of list) {
      if (s.lat < S || s.lat > N || s.lon < W || s.lon > E) continue;
      if (++n > 250) break;
      seen.add(s.id);
      const html = staIcon(s), tip = `🌀 ${esc(s.name)} · ${wf(s.w)} (max ${wf(s.wmax)}) ${wUnit()} ${dirName(s.d)} · ${agoTxt(s.at)}`;
      let v = cache.get(s.id);
      if (!v) {
        v = { s, html };
        v.m = L.marker([s.lat, s.lon], { icon: L.divIcon({ className: '', html, iconSize: [38, 34], iconAnchor: [19, 17] }), zIndexOffset: 400 }).addTo(layer)
          .bindTooltip(tip, { direction: 'top', offset: [0, -14] })
          .on('click', ev => { L.DomEvent.stopPropagation(ev); onTap(v.s); });
        cache.set(s.id, v);
      } else { v.s = s; if (v.html !== html) { v.m.setIcon(L.divIcon({ className: '', html, iconSize: [38, 34], iconAnchor: [19, 17] })); v.html = html; } }
    }
    cache.forEach((v, k) => { if (!seen.has(k)) { layer.removeLayer(v.m); cache.delete(k); } });
    if (map.attributionControl && !map._staAttr) { map.attributionControl.addAttribution(STA_ATTR); map._staAttr = true; }
  }).catch(() => {});
}
function stationPopup(map, s, onForecast) {
  const html = `<div class="pop"><b>🌀 ${esc(s.name)}</b><br><small>Balise OpenWindMap · mesure ${agoTxt(s.at)}</small><br>
    Vent <span class="pill" style="background:${windColor(s.w)};color:${windTxt(s.w)}">${wf(s.w)}</span> min ${wf(s.wmin)} · max ${wf(s.wmax)} ${wUnit()} ${arrow(s.d, '#06141f')} ${dirName(s.d)}
    <br><button class="btn small pri" id="stGo">Prévisions ici</button> <a class="btn small" href="https://www.openwindmap.org" target="_blank">OpenWindMap</a></div>`;
  L.popup({ maxWidth: 260 }).setLatLng([s.lat, s.lon]).setContent(html).openOn(map);
  setTimeout(() => { const go = document.getElementById('stGo'); if (go) go.onclick = () => { map.closePopup(); onForecast(s); }; }, 0);
}
