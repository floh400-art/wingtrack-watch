// WingTrack — calculs de stats (utilisable dans le navigateur et dans Node pour les tests)
(function (root) {
  const R = 6371008.8;
  const toRad = d => d * Math.PI / 180;

  function dist(a, b) { // a,b = [t, lat, lon]
    const dLat = toRad(b[1] - a[1]), dLon = toRad(b[2] - a[2]);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  function bearing(a, b) {
    const y = Math.sin(toRad(b[2] - a[2])) * Math.cos(toRad(b[1]));
    const x = Math.cos(toRad(a[1])) * Math.sin(toRad(b[1])) - Math.sin(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.cos(toRad(b[2] - a[2]));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  const angDiff = (a, b) => { let d = b - a; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };

  // Nettoie la trace : tri, doublons, précision GPS médiocre, pics de vitesse impossibles
  function clean(pts, maxAcc = 30, maxSpeed = 25 /* m/s ≈ 90 km/h */) {
    const s = pts.filter(p => p && isFinite(p[1]) && isFinite(p[2]) && (p[3] == null || p[3] <= maxAcc))
      .slice().sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const p of s) {
      const prev = out[out.length - 1];
      if (prev) {
        const dt = (p[0] - prev[0]) / 1000;
        if (dt <= 0) continue;
        if (dist(prev, p) / dt > maxSpeed && dt < 30) continue;
      }
      out.push(p);
    }
    return out;
  }

  // Meilleure vitesse moyenne sur une durée >= W secondes
  function bestOverTime(T, D, W) {
    let best = 0, j = 0, bi = -1, bj = -1;
    for (let i = 0; i < T.length; i++) {
      if (j < i) j = i;
      while (j < T.length && T[j] - T[i] < W) j++;
      if (j >= T.length) break;
      const dt = T[j] - T[i];
      if (dt > W * 2.5) continue; // trou dans la trace
      const v = (D[j] - D[i]) / dt;
      if (v > best) { best = v; bi = i; bj = j; }
    }
    return { v: best, i: bi, j: bj };
  }
  // Meilleure vitesse moyenne sur une distance >= L mètres
  function bestOverDist(T, D, L) {
    let best = 0, j = 0, bi = -1, bj = -1;
    for (let i = 0; i < T.length; i++) {
      if (j < i) j = i;
      while (j < T.length && D[j] - D[i] < L) j++;
      if (j >= T.length) break;
      const dt = T[j] - T[i];
      if (dt <= 0) continue;
      const v = (D[j] - D[i]) / dt;
      if (v > best) { best = v; bi = i; bj = j; }
    }
    return { v: best, i: bi, j: bj };
  }

  function compute(rawPts, opts = {}) {
    const foilThr = (opts.foilKmh ?? 12) / 3.6;  // m/s
    const moveThr = 4 / 3.6;
    const pts = clean(rawPts);
    const n = pts.length;
    const res = {
      n, distance: 0, duration: 0, movingTime: 0, foilTime: 0, foilDist: 0,
      vmax2: 0, best10: 0, best100m: 0, best500m: 0, best1min: 0, avgMoving: 0,
      runs: 0, longestRunS: 0, longestRunM: 0, turns: 0, foilTurns: 0, maxFromStart: 0,
      segSpeed: [], pts, best10Range: null
    };
    if (n < 2) return res;
    const T = new Float64Array(n), D = new Float64Array(n);
    T[0] = 0;
    for (let i = 1; i < n; i++) {
      T[i] = (pts[i][0] - pts[0][0]) / 1000;
      D[i] = D[i - 1] + dist(pts[i - 1], pts[i]);
    }
    res.distance = D[n - 1];
    res.duration = T[n - 1];

    // vitesse "instantanée" lissée (fenêtre ~ 3 s centrée)
    const sp = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let a = i, b = i;
      while (a > 0 && T[i] - T[a - 1] <= 1.5) a--;
      while (b < n - 1 && T[b + 1] - T[i] <= 1.5) b++;
      if (b === a) { if (i > 0) a = i - 1; else b = i + 1; }
      const dt = T[b] - T[a];
      sp[i] = dt > 0 ? (D[b] - D[a]) / dt : 0;
    }
    res.segSpeed = Array.from(sp);

    // temps en mouvement / sur le foil + runs
    let runStart = -1, runDist = 0;
    const closeRun = (endIdx) => {
      if (runStart < 0) return;
      const dur = T[endIdx] - T[runStart];
      if (dur >= 10) {
        res.runs++;
        if (dur > res.longestRunS) res.longestRunS = dur;
        if (runDist > res.longestRunM) res.longestRunM = runDist;
      }
      runStart = -1; runDist = 0;
    };
    for (let i = 1; i < n; i++) {
      const dt = T[i] - T[i - 1];
      const dd = D[i] - D[i - 1];
      if (dt > 30) { closeRun(i - 1); continue; } // pause / perte GPS
      const v = (sp[i] + sp[i - 1]) / 2;
      if (v >= moveThr) res.movingTime += dt;
      if (v >= foilThr) {
        res.foilTime += dt; res.foilDist += dd;
        if (runStart < 0) runStart = i - 1;
        runDist += dd;
      } else closeRun(i - 1);
    }
    closeRun(n - 1);

    const movingDist = (() => { let s = 0; for (let i = 1; i < n; i++) if (T[i] - T[i - 1] <= 30 && (sp[i] + sp[i - 1]) / 2 >= moveThr) s += D[i] - D[i - 1]; return s; })();
    res.avgMoving = res.movingTime > 0 ? movingDist / res.movingTime : 0;
    res.vmax2 = bestOverTime(T, D, 2).v;
    const b10 = bestOverTime(T, D, 10);
    res.best10 = b10.v; res.best10Range = b10.i >= 0 ? [b10.i, b10.j] : null;
    res.best1min = bestOverTime(T, D, 60).v;
    res.best100m = bestOverDist(T, D, 100).v;
    res.best500m = bestOverDist(T, D, 500).v;

    // distance max depuis le départ
    for (let i = 0; i < n; i++) { const d = dist(pts[0], pts[i]); if (d > res.maxFromStart) res.maxFromStart = d; }

    // virages (jibes / virements) : cap échantillonné toutes ~3 s, changement cumulé > 140° en <= 25 s
    const samples = [];
    let last = 0;
    for (let i = 1; i < n; i++) {
      if (T[i] - T[last] >= 3) {
        if (D[i] - D[last] > 3) samples.push({ t: T[i], h: bearing(pts[last], pts[i]), v: (D[i] - D[last]) / (T[i] - T[last]), i });
        last = i;
      }
    }
    let cooldownUntil = -1;
    for (let k = 0; k < samples.length; k++) {
      if (samples[k].t < cooldownUntil) continue;
      let cum = 0, minV = Infinity, avgV = 0, cnt = 0;
      for (let m = k + 1; m < samples.length && samples[m].t - samples[k].t <= 25; m++) {
        cum += angDiff(samples[m - 1].h, samples[m].h);
        minV = Math.min(minV, samples[m].v); avgV += samples[m].v; cnt++;
        if (Math.abs(cum) >= 140) {
          avgV /= cnt;
          if (avgV >= 6 / 3.6) {
            res.turns++;
            if (minV >= foilThr * 0.9) res.foilTurns++;
          }
          cooldownUntil = samples[m].t + 10;
          break;
        }
      }
    }
    res.T = Array.from(T); res.D = Array.from(D);
    return res;
  }

  const api = { compute, dist, bearing, clean };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.WTStats = api;
})(this);
