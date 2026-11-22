// WingTrack — moteur de stats v2 (navigateur + Node pour les tests)
// Points : [t(ms), lat, lon, précision(m)?, vitesseDoppler(m/s)?]
(function (root) {
  const VERSION = 2;
  const R = 6371008.8;
  const toRad = d => d * Math.PI / 180;
  const MAX_ACC = 3.0;   // m/s² : accélération max plausible (0 → 30 km/h en ~3 s)
  const SPIKE = 2.5;     // m/s : écart max toléré à la médiane locale

  function dist(a, b) {
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
  const norm = a => ((a % 360) + 360) % 360;

  function clean(pts, maxAcc = 30, maxSpeed = 25) {
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

  // meilleure moyenne de vitesse sur >= W secondes, à partir de l'intégrale C (= distance parcourue)
  function bestOver(T, C, W, byDist) {
    let best = 0, j = 0, bi = -1, bj = -1;
    for (let i = 0; i < T.length; i++) {
      if (j < i) j = i;
      while (j < T.length && (byDist ? C[j] - C[i] : T[j] - T[i]) < W) j++;
      if (j >= T.length) break;
      const dt = T[j] - T[i];
      if (dt <= 0 || (!byDist && dt > W * 2.5)) continue;
      const v = (C[j] - C[i]) / dt;
      if (v > best) { best = v; bi = i; bj = j; }
    }
    return { v: best, i: bi, j: bj };
  }

  // Série de vitesse propre : Doppler si dispo, sinon dérivée des positions ; puis anti-pics
  function speedSeries(P, T, D) {
    const n = P.length;
    const hasDop = P.filter(p => p[4] != null && p[4] >= 0).length > n * 0.5;
    const v = new Float64Array(n);
    // sans Doppler : positions lissées (moyenne glissante ±2 s) avant de dériver la vitesse
    let Ds = D;
    if (!hasDop) {
      const sm = P.map((p, i) => {
        let la = 0, lo = 0, c = 0;
        for (let k = i; k >= 0 && T[i] - T[k] <= 2; k--) { la += P[k][1]; lo += P[k][2]; c++; }
        for (let k = i + 1; k < n && T[k] - T[i] <= 2; k++) { la += P[k][1]; lo += P[k][2]; c++; }
        return [p[0], la / c, lo / c];
      });
      Ds = new Float64Array(n);
      for (let i = 1; i < n; i++) Ds[i] = Ds[i - 1] + dist(sm[i - 1], sm[i]);
    }
    for (let i = 0; i < n; i++) {
      if (hasDop && P[i][4] != null && P[i][4] >= 0) { v[i] = P[i][4]; continue; }
      // vitesse sur une corde de ~4 s centrée : beaucoup moins sensible au bruit et aux virages serrés
      let a = i, b = i;
      while (a > 0 && T[i] - T[a - 1] <= 2 && T[a] - T[a - 1] <= 10) a--;
      while (b < n - 1 && T[b + 1] - T[i] <= 2 && T[b + 1] - T[b] <= 10) b++;
      if (a === b) { if (i > 0) a = i - 1; else b = i + 1; }
      const dt = T[b] - T[a];
      v[i] = dt > 0 ? (Ds[b] - Ds[a]) / dt : 0;
    }
    // 1) médiane glissante sur 5 points : supprime les pics isolés
    const med = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const w = [];
      for (let k = Math.max(0, i - 2); k <= Math.min(n - 1, i + 2); k++) w.push(v[k]);
      w.sort((x, y) => x - y); med[i] = w[w.length >> 1];
    }
    for (let i = 0; i < n; i++) if (Math.abs(v[i] - med[i]) > SPIKE) v[i] = med[i];
    // 2) accélération physiquement plausible, dans les deux sens (aplatit les sauts en virage)
    for (let i = 1; i < n; i++) { const dt = T[i] - T[i - 1]; if (dt <= 10) v[i] = Math.min(v[i], v[i - 1] + MAX_ACC * dt); }
    for (let i = n - 2; i >= 0; i--) { const dt = T[i + 1] - T[i]; if (dt <= 10) v[i] = Math.min(v[i], v[i + 1] + MAX_ACC * dt); }
    return { v, doppler: hasDop };
  }

  function compute(rawPts, opts = {}) {
    const foilKmh = opts.foilKmh ?? 12;
    const foilOn = foilKmh / 3.6, foilOff = Math.max(3, foilKmh - 2) / 3.6, moveThr = 4 / 3.6;
    const P = clean(rawPts), n = P.length;
    const res = {
      v: VERSION, n, distance: 0, duration: 0, movingTime: 0, foilTime: 0, foilDist: 0,
      vmax2: 0, best10: 0, best1min: 0, best100m: 0, best500m: 0, avgMoving: 0,
      runs: 0, longestRunS: 0, longestRunM: 0, takeoffs: 0,
      turns: 0, jibes: 0, tacks: 0, foilJibes: 0, foilTacks: 0, foilTurns: 0,
      accels: 0, bestAccel: null, maxFromStart: 0, wind: null, windAuto: null, doppler: false,
      events: [], runList: [], hist: [], polar: [], pts: P
    };
    if (n < 3) return res;
    const T = new Float64Array(n), D = new Float64Array(n);
    for (let i = 1; i < n; i++) { T[i] = (P[i][0] - P[0][0]) / 1000; D[i] = D[i - 1] + dist(P[i - 1], P[i]); }
    const { v, doppler } = speedSeries(P, T, D);
    res.doppler = doppler;
    // distance = intégrale de la vitesse filtrée (pas de zigzag du bruit GPS)
    const C = new Float64Array(n);
    for (let i = 1; i < n; i++) { const dt = T[i] - T[i - 1]; C[i] = C[i - 1] + (dt <= 30 ? (v[i] + v[i - 1]) / 2 * dt : 0); }
    res.distance = C[n - 1]; res.duration = T[n - 1];

    // --- états : en mouvement / sur le foil (avec hystérésis) ---
    let foiling = false, candStart = -1, runStart = -1, runVmax = 0, movingDist = 0;
    const closeRun = (end) => {
      if (runStart < 0) return;
      const dur = T[end] - T[runStart], dd = C[end] - C[runStart];
      if (dur >= 10) {
        res.runs++;
        res.runList.push({ i: runStart, j: end, t0: T[runStart], dur, dist: dd, vmax: runVmax, avg: dd / dur });
        res.longestRunS = Math.max(res.longestRunS, dur); res.longestRunM = Math.max(res.longestRunM, dd);
      }
      runStart = -1; runVmax = 0;
    };
    let below = 0;
    for (let i = 1; i < n; i++) {
      const dt = T[i] - T[i - 1];
      if (dt > 30) { if (foiling) closeRun(i - 1); foiling = false; candStart = -1; continue; }
      const vm = (v[i] + v[i - 1]) / 2;
      if (vm >= moveThr) { res.movingTime += dt; movingDist += C[i] - C[i - 1]; }
      if (!foiling) {
        if (v[i] >= foilOn) {
          if (candStart < 0) candStart = i;
          if (T[i] - T[candStart] >= 3) { // décollage confirmé (3 s au-dessus du seuil)
            foiling = true; runStart = candStart; below = 0;
            res.takeoffs++;
            res.events.push({ type: 'takeoff', i: candStart, t: T[candStart] });
            for (let k = candStart; k <= i; k++) { res.foilTime += k > candStart ? T[k] - T[k - 1] : 0; runVmax = Math.max(runVmax, v[k]); }
            res.foilDist += C[i] - C[candStart];
          }
        } else candStart = -1;
      } else {
        res.foilTime += dt; res.foilDist += C[i] - C[i - 1]; runVmax = Math.max(runVmax, v[i]);
        if (v[i] < foilOff) { below += dt; if (below >= 2) { foiling = false; candStart = -1; closeRun(i); res.events.push({ type: 'touchdown', i, t: T[i] }); } }
        else below = 0;
      }
    }
    if (foiling) closeRun(n - 1);
    res.avgMoving = res.movingTime > 0 ? movingDist / res.movingTime : 0;

    // --- vitesses de référence ---
    const b2 = bestOver(T, C, 2), b10 = bestOver(T, C, 10);
    res.vmax2 = b2.v; res.best10 = b10.v; res.best10Range = b10.i >= 0 ? [b10.i, b10.j] : null;
    res.vmaxIdx = b2.i >= 0 ? (b2.i + b2.j) >> 1 : -1;
    res.best1min = bestOver(T, C, 60).v;
    res.best100m = bestOver(T, C, 100, true).v;
    res.best500m = bestOver(T, C, 500, true).v;

    for (let i = 0; i < n; i++) res.maxFromStart = Math.max(res.maxFromStart, dist(P[0], P[i]));

    // --- accélérations : gain >= 8 km/h en <= 5 s ---
    for (let i = 0; i < n - 1; i++) {
      let bestJ = -1, gain = 0;
      for (let j = i + 1; j < n && T[j] - T[i] <= 5; j++) if (v[j] - v[i] > gain) { gain = v[j] - v[i]; bestJ = j; }
      if (bestJ > 0 && gain >= 8 / 3.6) {
        const dt = T[bestJ] - T[i];
        const ev = { type: 'accel', i, j: bestJ, t: T[i], gain, dt, from: v[i], to: v[bestJ] };
        res.events.push(ev); res.accels++;
        if (!res.bestAccel || gain / dt > res.bestAccel.gain / res.bestAccel.dt) res.bestAccel = ev;
        i = bestJ;
      }
    }

    // --- caps échantillonnés (toutes ~2 s, en mouvement) ---
    const S = [];
    let last = 0;
    for (let i = 1; i < n; i++) {
      if (T[i] - T[last] >= 2) {
        if (T[i] - T[last] <= 10 && D[i] - D[last] > 5 && v[i] > 6 / 3.6) S.push({ t: T[i], h: bearing(P[last], P[i]), v: v[i], i, dt: T[i] - T[last] });
        last = i;
      }
    }

    // --- direction du vent estimée : secteur de 90° le moins navigué (zone face au vent),
    //     départagé avec le côté opposé grâce à la vitesse (on va moins vite au près) ---
    if (S.length > 20) {
      const bins = new Float64Array(36);
      S.forEach(s => bins[Math.floor(s.h / 10) % 36] += s.dt);
      let minSum = Infinity, minC = 0;
      for (let b = 0; b < 36; b++) {
        let sum = 0; for (let k = -4; k <= 4; k++) sum += bins[(b + k + 36) % 36];
        if (sum < minSum) { minSum = sum; minC = b * 10 + 5; }
      }
      const avgNear = c => { let s = 0, w = 0; S.forEach(x => { if (Math.abs(angDiff(c, x.h)) < 90) { s += x.v * x.dt; w += x.dt; } }); return w ? s / w : 0; };
      let up = minC;
      if (avgNear(minC) > avgNear(norm(minC + 180)) * 1.05) up = norm(minC + 180);
      res.windAuto = up;
    }
    let W = opts.wind != null ? opts.wind : res.windAuto;
    if (W != null && opts.windFlip) W = norm(W + 180);
    res.wind = W;

    // --- virages (>= 90° en <= 25 s si le vent est connu, sinon >= 130°), classés jibe / tack ---
    const TURN = W != null ? 90 : 130;
    let cooldown = -1;
    for (let k = 0; k < S.length; k++) {
      if (S[k].t < cooldown) continue;
      let cum = 0, minV = Infinity;
      for (let m = k + 1; m < S.length && S[m].t - S[k].t <= 25; m++) {
        if (S[m].t - S[m - 1].t > 8) break;
        cum += angDiff(S[m - 1].h, S[m].h);
        minV = Math.min(minV, S[m].v);
        if (Math.abs(cum) >= TURN) {
          // prolonge tant que ça tourne dans le même sens
          let e = m;
          while (e + 1 < S.length && S[e + 1].t - S[k].t <= 30) {
            const d = angDiff(S[e].h, S[e + 1].h);
            if (Math.sign(d) !== Math.sign(cum) || Math.abs(d) < 8) break;
            cum += d; minV = Math.min(minV, S[e + 1].v); e++;
          }
          let type = 'turn';
          if (W != null) {
            const h0 = S[k].h, sweep = Math.abs(cum);
            const reach = target => (cum > 0 ? norm(target - h0) : norm(h0 - target)) <= sweep;
            if (reach(W)) type = 'tack'; else if (reach(norm(W + 180))) type = 'jibe';
            else { cooldown = S[e].t; break; } // simple abattée / lofée : pas un virement
          }
          const foiled = minV >= foilOn * 0.9;
          const mid = S[Math.round((k + e) / 2)];
          res.events.push({ type, foiled, i: mid.i, t: mid.t, angle: Math.round(Math.abs(cum)), minV });
          res.turns++; if (foiled) res.foilTurns++;
          if (type === 'jibe') { res.jibes++; if (foiled) res.foilJibes++; }
          if (type === 'tack') { res.tacks++; if (foiled) res.foilTacks++; }
          cooldown = S[e].t + 8;
          break;
        }
      }
    }

    // --- histogramme du temps par tranche de 5 km/h ---
    const H = [];
    for (let i = 1; i < n; i++) {
      const dt = T[i] - T[i - 1]; if (dt > 30) continue;
      const b = Math.min(12, Math.floor((v[i] * 3.6) / 5)); H[b] = (H[b] || 0) + dt;
    }
    res.hist = Array.from({ length: H.length }, (_, b) => H[b] || 0);

    // --- polaire : vitesse max (moyenne 3 s) par angle au vent, tranches de 10°, bâbord/tribord confondus ---
    if (W != null) {
      const pol = new Array(18).fill(0);
      S.forEach(s => { const a = Math.abs(angDiff(W, s.h)); const b = Math.min(17, Math.floor(a / 10)); pol[b] = Math.max(pol[b], s.v); });
      res.polar = pol;
    }

    res.events.sort((a, b) => a.t - b.t);
    res.T = Array.from(T); res.V = Array.from(v); res.C = Array.from(C);
    return res;
  }

  const api = { compute, dist, bearing, clean, VERSION };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.WTStats = api;
})(this);
