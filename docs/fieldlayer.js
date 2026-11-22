'use strict';
/* =========================================================================
   WingTrack — Couche « vent animé » réutilisable (fond coloré + traînées)
   Utilisée par l'onglet Carte. Partage le cache de points de la carte vent.
   ========================================================================= */
class WindField {
  constructor(map) {
    this.map = map; this.on = false; this.grid = null; this.tStr = null; this.t = 0; this.parts = []; this.raf = null; this.busy = false;
    const pane = map.getPanes().overlayPane;
    this.heat = document.createElement('canvas'); this.part = document.createElement('canvas');
    this.heat.className = this.part.className = 'wmcv';
    pane.appendChild(this.heat); pane.appendChild(this.part);
    map.on('movestart', () => { this.moving = true; const c = this.part.getContext('2d'); c.clearRect(0, 0, this.part.width, this.part.height); });
    map.on('moveend', () => { this.moving = false; if (!this.on) return; this.place(); this.drawHeat(); this.resetParts(); clearTimeout(this.lt); this.lt = setTimeout(() => this.load(), 600); });
  }
  setOn(b) {
    this.on = b;
    this.heat.style.display = this.part.style.display = b ? '' : 'none';
    if (b) { this.place(); this.load(); this.start(); } else this.stop();
  }
  setTime(tStr) {
    this.tStr = tStr; if (!this.grid) return;
    const i = this.grid.T.indexOf(tStr); this.t = i >= 0 ? i : this.t;
    if (this.hp) return; this.hp = requestAnimationFrame(() => { this.hp = null; this.drawHeat(); });
  }
  place() {
    const sz = this.map.getSize(), tl = this.map.containerPointToLayerPoint([0, 0]);
    [this.heat, this.part].forEach(cv => { if (cv.width !== sz.x || cv.height !== sz.y) { cv.width = sz.x; cv.height = sz.y; } L.DomUtil.setPosition(cv, tl); });
    // projection pré-calculée : longitude linéaire en x, latitude par ligne de pixels (Mercator)
    const a = this.map.containerPointToLatLng([0, 0]), b = this.map.containerPointToLatLng([sz.x, 0]);
    this.lng0 = a.lng; this.dLng = (b.lng - a.lng) / (sz.x || 1);
    const lr = new Float64Array(sz.y + 1);
    for (let y = 0; y <= sz.y; y++) lr[y] = this.map.containerPointToLatLng([0, y]).lat;
    this.latRow = lr;
  }
  ll(x, y) { const lr = this.latRow, yi = Math.max(0, Math.min(lr.length - 1, y | 0)); return [lr[yi], this.lng0 + x * this.dLng]; }
  async load() {
    if (!this.on || this.busy) return;
    this.busy = true;
    try {
      const b = this.map.getBounds(), z = this.map.getZoom();
      const target = 46 / (256 * Math.pow(2, z) / 360);
      const S0 = b.getSouth(), N0 = b.getNorth(), W0 = b.getWest(), E0 = b.getEast();
      let step = LADDER.find(d => d >= Math.max(0.1, target)) || 3;
      const count = d => (Math.floor((N0 - S0) / d) + 3) * (Math.floor((E0 - W0) / d) + 3);
      while (count(step) > 400 && LADDER.indexOf(step) < LADDER.length - 1) step = LADDER[LADDER.indexOf(step) + 1];
      const r0 = Math.floor(S0 / step) - 1, r1 = Math.ceil(N0 / step) + 1, c0 = Math.floor(W0 / step) - 1, c1 = Math.ceil(E0 / step) + 1;
      const pk = (r, c) => `wind|best|${step}|${r}|${c}`;
      const need = [];
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const v = WM_PTS.get(pk(r, c)); if (!v || Date.now() - v.at > 3600e3) need.push([r, c]); }
      for (let i = 0; i < need.length; i += 100) {
        const part = need.slice(i, i + 100);
        let j = await getJSON(`${OM}?latitude=${part.map(([r]) => (r * step).toFixed(3)).join(',')}&longitude=${part.map(([, c]) => (c * step).toFixed(3)).join(',')}&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,pressure_msl&forecast_days=7&timezone=GMT`);
        if (!Array.isArray(j)) j = [j];
        j.forEach((x, k) => WM_PTS.set(pk(part[k][0], part[k][1]), { at: Date.now(), h: x && x.hourly }));
      }
      // assemblage de la grille
      const rows = r1 - r0 + 1, cols = c1 - c0 + 1, n = rows * cols;
      let first = null;
      for (let r = r0; r <= r1 && !first; r++) for (let c = c0; c <= c1; c++) { const v = WM_PTS.get(pk(r, c)); if (v && v.h && v.h.time) { first = v.h; break; } }
      if (!first) return;
      const off = -new Date().getTimezoneOffset() * 60e3;
      const T = first.time.map(t => new Date(Date.parse(t + ':00Z') + off).toISOString().slice(0, 16)), nT = T.length;
      const U = new Float32Array(nT * n).fill(NaN), V = new Float32Array(nT * n).fill(NaN), S = new Float32Array(nT * n).fill(NaN);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const v = WM_PTS.get(pk(r, c)); if (!v || !v.h || !v.h.wind_speed_10m) continue;
        const h = v.h, k = (r - r0) * cols + (c - c0);
        for (let t = 0; t < nT; t++) {
          const w = h.wind_speed_10m[t], d = h.wind_direction_10m[t]; if (w == null || d == null) continue;
          const a = d * Math.PI / 180, i = t * n + k; U[i] = -Math.sin(a) * w / 3.6; V[i] = -Math.cos(a) * w / 3.6; S[i] = w;
        }
      }
      this.grid = { s: r0 * step, n: r1 * step, w: c0 * step, e: c1 * step, rows, cols, n, T, nT, U, V, S };
      const i = this.tStr ? T.indexOf(this.tStr) : -1;
      this.t = i >= 0 ? i : Math.max(0, T.indexOf(new Date(Date.now() + off).toISOString().slice(0, 13) + ':00'));
      this.place(); this.drawHeat(); this.resetParts();
    } catch (e) { /* hors ligne ou limite atteinte : on réessaiera au prochain déplacement */ }
    finally { this.busy = false; }
  }
  sample(lat, lon) {
    const g = this.grid; if (!g) return null;
    const fx = (lon - g.w) / (g.e - g.w) * (g.cols - 1), fy = (lat - g.s) / (g.n - g.s) * (g.rows - 1);
    if (fx < 0 || fy < 0 || fx > g.cols - 1 || fy > g.rows - 1) return null;
    const x0 = Math.min(g.cols - 2, Math.floor(fx)), y0 = Math.min(g.rows - 2, Math.floor(fy)), dx = fx - x0, dy = fy - y0, base = this.t * g.n + y0 * g.cols + x0;
    const I = [base, base + 1, base + g.cols, base + g.cols + 1], K = this._k || (this._k = new Float64Array(4));
    K[0] = (1 - dx) * (1 - dy); K[1] = dx * (1 - dy); K[2] = (1 - dx) * dy; K[3] = dx * dy;
    let u = 0, v = 0, s = 0, w = 0;
    for (let j = 0; j < 4; j++) { const i = I[j], k = K[j]; if (!k || isNaN(g.S[i])) continue; u += g.U[i] * k; v += g.V[i] * k; s += g.S[i] * k; w += k; }
    return w < 0.25 ? null : { u: u / w, v: v / w, s: s / w };
  }
  drawHeat() {
    if (!this.on) return;
    const cv = this.heat, c = cv.getContext('2d'), W = cv.width, H = cv.height;
    if (!W || !H) return;
    c.clearRect(0, 0, W, H);
    if (!this.grid) return;
    if (!this.latRow || this.latRow.length !== H + 1) this.place();
    const st = 8, w = Math.ceil(W / st), h = Math.ceil(H / st);
    const off = this._off || (this._off = document.createElement('canvas')); off.width = w; off.height = h;
    const oc = off.getContext('2d'), img = oc.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const ll = this.ll(x * st + st / 2, y * st + st / 2), s = this.sample(ll[0], ll[1]), i = (y * w + x) * 4;
      if (!s) continue;
      const col = windRGB(s.s); d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
    }
    oc.putImageData(img, 0, 0);
    c.imageSmoothingEnabled = true; c.drawImage(off, 0, 0, W, H);
    const z = this.map.getZoom();
    cv.style.opacity = Math.max(0.3, Math.min(0.7, 0.7 - (z - 6) * 0.06));
    cv.style.mixBlendMode = (cfg.cmBase || 'light') === 'light' || cfg.cmBase === 'street' ? 'multiply' : 'normal';
  }
  resetParts() {
    const W = this.part.width, H = this.part.height;
    this.parts = Array.from({ length: Math.min(220, Math.round(W * H / 3000)) }, () => ({ x: Math.random() * W, y: Math.random() * H, age: Math.random() * 60 }));
  }
  start() {
    this.stop();
    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      if (!this.on || !this.grid || this.moving || document.hidden || (this.fr = !this.fr)) return; // ~30 i/s
      const cv = this.part, c = cv.getContext('2d'), W = cv.width, H = cv.height; if (!W) return;
      c.globalCompositeOperation = 'destination-in'; c.fillStyle = 'rgba(0,0,0,0.9)'; c.fillRect(0, 0, W, H);
      c.globalCompositeOperation = 'source-over'; c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 1.3; c.beginPath();
      const k = 0.36 * Math.max(0.6, Math.min(1.6, (this.map.getZoom() - 4) / 5));
      this.parts.forEach(p => {
        const ll = this.ll(p.x, p.y), s = this.sample(ll[0], ll[1]);
        if (!s || p.age++ > 90) { p.x = Math.random() * W; p.y = Math.random() * H; p.age = 0; return; }
        const nx = p.x + s.u * k, ny = p.y - s.v * k; c.moveTo(p.x, p.y); c.lineTo(nx, ny); p.x = nx; p.y = ny;
        if (nx < 0 || ny < 0 || nx > W || ny > H) { p.x = Math.random() * W; p.y = Math.random() * H; p.age = 0; }
      });
      c.stroke();
    };
    this.raf = requestAnimationFrame(tick);
  }
  stop() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = null; }
}
