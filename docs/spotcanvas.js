'use strict';
/* =========================================================================
   WingTrack — Spots et balises dessinés sur UN seul canvas (onglet Carte)
   Beaucoup plus fluide que des centaines de marqueurs HTML : rien à recalculer
   pendant le glissement, un seul dessin à la fin du déplacement.
   ========================================================================= */
const SAIL_P = typeof Path2D === 'function' ? new Path2D('M3.5 17.5C5 9 11 4 20.5 3c-3 4.5-3.6 9.6-2 15.5-4.8-2.6-10-2.9-15-1z') : null;
const ARROW_P = typeof Path2D === 'function' ? new Path2D('M12 2l5 9h-3.2v11h-3.6V11H7z') : null;
class SpotCanvas {
  constructor(map) {
    this.map = map; this.items = []; this.hits = [];
    const pane = map.createPane('cmSpots'); pane.style.zIndex = 620; pane.style.pointerEvents = 'none';
    this.cv = document.createElement('canvas'); this.cv.style.position = 'absolute'; this.cv.style.left = this.cv.style.top = '0';
    pane.appendChild(this.cv);
    map.on('zoomstart', () => { this.cv.style.visibility = 'hidden'; });
    map.on('moveend zoomend resize', () => this.render());
  }
  set(items) { this.items = items; this.render(); }
  render() {
    const m = this.map, sz = m.getSize(), dpr = Math.min(2, window.devicePixelRatio || 1), cv = this.cv;
    const W = Math.round(sz.x * dpr), H = Math.round(sz.y * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; cv.style.width = sz.x + 'px'; cv.style.height = sz.y + 'px'; }
    L.DomUtil.setPosition(cv, m.containerPointToLayerPoint([0, 0]));
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, sz.x, sz.y);
    this.hits = [];
    const order = { no: 0, un: 0, mid: 1, sta: 2, ok: 3, fav: 4 };
    const list = this.items.map(it => ({ it, p: m.latLngToContainerPoint([it.lat, it.lon]) }))
      .filter(o => o.p.x > -40 && o.p.y > -40 && o.p.x < sz.x + 40 && o.p.y < sz.y + 40)
      .sort((a, b) => order[a.it.layer] - order[b.it.layer]);
    for (const { it, p } of list) {
      if (it.type === 'sta') this.drawSta(c, p, it); else this.drawSpot(c, p, it);
      this.hits.push({ x: p.x, y: p.y, r: it.type === 'sta' ? 18 : it.r === 'ok' ? 17 : 13, it });
    }
    cv.style.visibility = '';
  }
  drawSpot(c, p, s) {
    const r = s.r, R = r === 'ok' ? 15 : 9;
    c.beginPath(); c.arc(p.x, p.y, R + 1.5, 0, 7); c.fillStyle = 'rgba(0,0,0,.35)'; c.fill(); // ombre légère
    if (s.side === 'off' || s.side === 'sideoff') { c.beginPath(); c.arc(p.x, p.y, R + 3, 0, 7); c.fillStyle = s.side === 'off' ? '#ef4444' : '#f59e0b'; c.fill(); }
    c.beginPath(); c.arc(p.x, p.y, R, 0, 7);
    c.fillStyle = r === 'ok' ? '#16a34a' : r === 'mid' ? '#f59e0b' : r === 'no' ? '#111' : 'rgba(255,255,255,.92)'; c.fill();
    c.lineWidth = 2; c.strokeStyle = r ? '#fff' : 'rgba(0,0,0,.25)'; c.stroke();
    if (r === 'ok' && SAIL_P) { c.save(); c.translate(p.x - 10, p.y - 10); c.scale(20 / 24, 20 / 24); c.fillStyle = '#fff'; c.fill(SAIL_P); c.restore(); }
    if (!r && s.icon) { c.font = '10px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#000'; c.fillText(s.icon, p.x, p.y + 0.5); }
    if (s.side === 'off' && (r === 'ok' || r === 'mid')) {
      const bx = p.x + R * 0.8, by = p.y - R * 0.8;
      c.beginPath(); c.arc(bx, by, 8, 0, 7); c.fillStyle = '#ef4444'; c.fill(); c.lineWidth = 1.5; c.strokeStyle = '#fff'; c.stroke();
      c.font = 'bold 11px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#fff'; c.fillText('!', bx, by + 0.5);
    }
    if (s.fav) {
      c.font = 'bold 11px sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
      const t = '★ ' + s.name, w = c.measureText(t).width;
      c.fillStyle = 'rgba(6,20,31,.85)'; c.fillRect(p.x + R + 4, p.y - 8, w + 10, 16);
      c.fillStyle = '#fff'; c.fillText(t, p.x + R + 9, p.y);
    }
  }
  drawSta(c, p, s) {
    if (ARROW_P) {
      c.save(); c.translate(p.x, p.y - 7); c.rotate(((s.d || 0) + 180) * Math.PI / 180); c.translate(-9, -9); c.scale(18 / 24, 18 / 24);
      c.lineWidth = 2; c.strokeStyle = '#06141f'; c.stroke(ARROW_P); c.fillStyle = '#fff'; c.fill(ARROW_P); c.restore();
    }
    const t = wf(s.w); c.font = 'bold 11px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    const w = c.measureText(t).width + 10, x = p.x - w / 2, y = p.y + 4;
    c.beginPath(); if (c.roundRect) c.roundRect(x, y, w, 15, 7); else c.rect(x, y, w, 15);
    c.fillStyle = windColor(s.w); c.fill(); c.lineWidth = 1.5; c.strokeStyle = '#fff'; c.stroke();
    c.fillStyle = windTxt(s.w); c.fillText(t, p.x, y + 8);
  }
  // le point touché (le plus proche, dessus en priorité)
  hit(pt) {
    let best = null, bd = 1e9;
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i], d = Math.hypot(h.x - pt.x, h.y - pt.y);
      if (d <= h.r && d < bd) { best = h.it; bd = d; }
    }
    return best;
  }
}
