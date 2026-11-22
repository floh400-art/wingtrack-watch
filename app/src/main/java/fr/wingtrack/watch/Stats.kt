package fr.wingtrack.watch

import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.min
import kotlin.math.sign
import kotlin.math.sin
import kotlin.math.sqrt

/** Point GPS. speed = vitesse Doppler du GPS (m/s), -1 si absente. */
data class Pt(val t: Long, val lat: Double, val lon: Double, val speed: Double = -1.0)

data class Summary(
    val start: Long = 0,
    val distance: Double = 0.0,      // m
    val duration: Double = 0.0,      // s
    val foilTime: Double = 0.0,      // s
    val vmax2: Double = 0.0,         // m/s, meilleure moyenne sur 2 s
    val best10: Double = 0.0,
    val best100m: Double = 0.0,
    val best500m: Double = 0.0,
    val avgMoving: Double = 0.0,
    val turns: Int = 0,
    val foilTurns: Int = 0,
    val takeoffs: Int = 0,
    val jibes: Int = 0,
    val foilJibes: Int = 0,
    val tacks: Int = 0,
    val foilTacks: Int = 0,
    val accels: Int = 0,
    val bestAccelGain: Double = 0.0, // m/s
    val bestAccelDt: Double = 0.0,   // s
    val wind: Double = -1.0,         // direction d'où vient le vent (°), -1 si inconnue
    val hrAvg: Double = 0.0,
    val hrMax: Int = 0,
    val kcal: Double = 0.0,
    val jumpCount: Int = 0,
    val maxJump: Double = 0.0,       // m
    val maxAirtime: Double = 0.0,    // s
    val pumps: Int = 0,
    val pumpsPerTakeoff: Double = 0.0,
)

/** Même moteur que l'appli téléphone (docs/stats.js v2). */
object Stats {
    private const val R = 6371008.8
    private const val MAX_ACC = 3.0   // m/s²
    private const val SPIKE = 2.5     // m/s
    private fun rad(d: Double) = d * Math.PI / 180.0
    private fun norm(a: Double) = ((a % 360.0) + 360.0) % 360.0

    fun dist(a: Pt, b: Pt): Double = distLL(a.lat, a.lon, b.lat, b.lon)

    private fun distLL(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val dLat = rad(lat2 - lat1)
        val dLon = rad(lon2 - lon1)
        val s = sin(dLat / 2).let { it * it } + cos(rad(lat1)) * cos(rad(lat2)) * sin(dLon / 2).let { it * it }
        return 2 * R * asin(min(1.0, sqrt(s)))
    }

    fun bearingTo(a: Pt, b: Pt): Double = bearing(a, b)

    private fun bearing(a: Pt, b: Pt): Double {
        val y = sin(rad(b.lon - a.lon)) * cos(rad(b.lat))
        val x = cos(rad(a.lat)) * sin(rad(b.lat)) - sin(rad(a.lat)) * cos(rad(b.lat)) * cos(rad(b.lon - a.lon))
        return norm(Math.toDegrees(atan2(y, x)))
    }

    private fun angDiff(a: Double, b: Double): Double {
        var d = b - a
        while (d > 180) d -= 360
        while (d < -180) d += 360
        return d
    }

    private fun bestOver(t: DoubleArray, c: DoubleArray, w: Double, byDist: Boolean): Pair<Double, Int> {
        var best = 0.0
        var idx = -1
        var j = 0
        for (i in t.indices) {
            if (j < i) j = i
            while (j < t.size && (if (byDist) c[j] - c[i] else t[j] - t[i]) < w) j++
            if (j >= t.size) break
            val dt = t[j] - t[i]
            if (dt <= 0 || (!byDist && dt > w * 2.5)) continue
            val v = (c[j] - c[i]) / dt
            if (v > best) { best = v; idx = (i + j) / 2 }
        }
        return best to idx
    }

    private class Sample(val t: Double, val h: Double, val v: Double, val dt: Double)

    fun compute(pts: List<Pt>, foilKmh: Double, windFlip: Boolean = false): Summary {
        val n = pts.size
        if (n < 3) return Summary(start = pts.firstOrNull()?.t ?: 0)
        val foilOn = foilKmh / 3.6
        val foilOff = maxOf(3.0, foilKmh - 2) / 3.6
        val moveThr = 4 / 3.6
        val t = DoubleArray(n)
        val d = DoubleArray(n)
        for (i in 1 until n) {
            t[i] = (pts[i].t - pts[0].t) / 1000.0
            d[i] = d[i - 1] + dist(pts[i - 1], pts[i])
        }

        // ---- série de vitesse : Doppler si dispo, sinon positions lissées ----
        val hasDop = pts.count { it.speed >= 0 } > n * 0.5
        var ds = d
        if (!hasDop) {
            val sLat = DoubleArray(n); val sLon = DoubleArray(n)
            for (i in 0 until n) {
                var la = 0.0; var lo = 0.0; var c = 0
                var k = i
                while (k >= 0 && t[i] - t[k] <= 2) { la += pts[k].lat; lo += pts[k].lon; c++; k-- }
                k = i + 1
                while (k < n && t[k] - t[i] <= 2) { la += pts[k].lat; lo += pts[k].lon; c++; k++ }
                sLat[i] = la / c; sLon[i] = lo / c
            }
            ds = DoubleArray(n)
            for (i in 1 until n) ds[i] = ds[i - 1] + distLL(sLat[i - 1], sLon[i - 1], sLat[i], sLon[i])
        }
        val v = DoubleArray(n)
        for (i in 0 until n) {
            if (hasDop && pts[i].speed >= 0) { v[i] = pts[i].speed; continue }
            var a = i; var b = i
            while (a > 0 && t[i] - t[a - 1] <= 2 && t[a] - t[a - 1] <= 10) a--
            while (b < n - 1 && t[b + 1] - t[i] <= 2 && t[b + 1] - t[b] <= 10) b++
            if (a == b) { if (i > 0) a = i - 1 else b = i + 1 }
            val dt = t[b] - t[a]
            v[i] = if (dt > 0) (ds[b] - ds[a]) / dt else 0.0
        }
        // anti-pics : médiane sur 5 points puis accélération plausible dans les deux sens
        val med = DoubleArray(n)
        for (i in 0 until n) {
            val w = ArrayList<Double>(5)
            for (k in maxOf(0, i - 2)..minOf(n - 1, i + 2)) w.add(v[k])
            w.sort(); med[i] = w[w.size / 2]
        }
        for (i in 0 until n) if (abs(v[i] - med[i]) > SPIKE) v[i] = med[i]
        for (i in 1 until n) { val dt = t[i] - t[i - 1]; if (dt <= 10) v[i] = minOf(v[i], v[i - 1] + MAX_ACC * dt) }
        for (i in n - 2 downTo 0) { val dt = t[i + 1] - t[i]; if (dt <= 10) v[i] = minOf(v[i], v[i + 1] + MAX_ACC * dt) }

        val c = DoubleArray(n)
        for (i in 1 until n) { val dt = t[i] - t[i - 1]; c[i] = c[i - 1] + if (dt <= 30) (v[i] + v[i - 1]) / 2 * dt else 0.0 }

        // ---- mouvement / foil avec hystérésis ----
        var moving = 0.0; var movingDist = 0.0; var foil = 0.0
        var foiling = false; var cand = -1; var below = 0.0; var takeoffs = 0
        for (i in 1 until n) {
            val dt = t[i] - t[i - 1]
            if (dt > 30) { foiling = false; cand = -1; continue }
            if ((v[i] + v[i - 1]) / 2 >= moveThr) { moving += dt; movingDist += c[i] - c[i - 1] }
            if (!foiling) {
                if (v[i] >= foilOn) {
                    if (cand < 0) cand = i
                    if (t[i] - t[cand] >= 3) { foiling = true; below = 0.0; takeoffs++; foil += t[i] - t[cand] }
                } else cand = -1
            } else {
                foil += dt
                if (v[i] < foilOff) { below += dt; if (below >= 2) { foiling = false; cand = -1 } } else below = 0.0
            }
        }

        // ---- accélérations : +8 km/h en 5 s max ----
        var accels = 0; var bestGain = 0.0; var bestDt = 0.0
        var i0 = 0
        while (i0 < n - 1) {
            var bj = -1; var gain = 0.0
            var j = i0 + 1
            while (j < n && t[j] - t[i0] <= 5) { if (v[j] - v[i0] > gain) { gain = v[j] - v[i0]; bj = j }; j++ }
            if (bj > 0 && gain >= 8 / 3.6) {
                accels++
                val dt = t[bj] - t[i0]
                if (bestDt == 0.0 || gain / dt > bestGain / bestDt) { bestGain = gain; bestDt = dt }
                i0 = bj
            } else i0++
        }

        // ---- caps échantillonnés ----
        val s = ArrayList<Sample>()
        var last = 0
        for (i in 1 until n) {
            if (t[i] - t[last] >= 2) {
                if (t[i] - t[last] <= 10 && d[i] - d[last] > 5 && v[i] > 6 / 3.6)
                    s.add(Sample(t[i], bearing(pts[last], pts[i]), v[i], t[i] - t[last]))
                last = i
            }
        }

        // ---- vent estimé : secteur de 90° le moins navigué, départagé par la vitesse ----
        var wind = -1.0
        if (s.size > 20) {
            val bins = DoubleArray(36)
            s.forEach { bins[(floor(it.h / 10).toInt()) % 36] += it.dt }
            var minSum = Double.MAX_VALUE; var minC = 0.0
            for (b in 0 until 36) {
                var sum = 0.0
                for (k in -4..4) sum += bins[(b + k + 36) % 36]
                if (sum < minSum) { minSum = sum; minC = b * 10 + 5.0 }
            }
            fun avgNear(cn: Double): Double {
                var sv = 0.0; var w = 0.0
                s.forEach { if (abs(angDiff(cn, it.h)) < 90) { sv += it.v * it.dt; w += it.dt } }
                return if (w > 0) sv / w else 0.0
            }
            wind = if (avgNear(minC) > avgNear(norm(minC + 180)) * 1.05) norm(minC + 180) else minC
            if (windFlip) wind = norm(wind + 180)
        }

        // ---- virages, classés jibe / tack ----
        val turnThr = if (wind >= 0) 90.0 else 130.0
        var turns = 0; var foilTurns = 0; var jibes = 0; var tacks = 0; var fJ = 0; var fT = 0
        var cooldown = -1.0
        for (k in s.indices) {
            if (s[k].t < cooldown) continue
            var cum = 0.0; var minV = Double.MAX_VALUE
            var m = k + 1
            while (m < s.size && s[m].t - s[k].t <= 25) {
                if (s[m].t - s[m - 1].t > 8) break
                cum += angDiff(s[m - 1].h, s[m].h)
                minV = minOf(minV, s[m].v)
                if (abs(cum) >= turnThr) {
                    var e = m
                    while (e + 1 < s.size && s[e + 1].t - s[k].t <= 30) {
                        val dd = angDiff(s[e].h, s[e + 1].h)
                        if (sign(dd) != sign(cum) || abs(dd) < 8) break
                        cum += dd; minV = minOf(minV, s[e + 1].v); e++
                    }
                    var type = 0 // 0 virage, 1 jibe, 2 tack
                    if (wind >= 0) {
                        val h0 = s[k].h; val sweep = abs(cum)
                        fun reach(target: Double) = (if (cum > 0) norm(target - h0) else norm(h0 - target)) <= sweep
                        type = when { reach(wind) -> 2; reach(norm(wind + 180)) -> 1; else -> -1 }
                    }
                    if (type < 0) { cooldown = s[e].t; break } // simple abattée / lofée
                    val foiled = minV >= foilOn * 0.9
                    turns++; if (foiled) foilTurns++
                    if (type == 1) { jibes++; if (foiled) fJ++ }
                    if (type == 2) { tacks++; if (foiled) fT++ }
                    cooldown = s[e].t + 8
                    break
                }
                m++
            }
        }

        return Summary(
            start = pts[0].t,
            distance = c[n - 1],
            duration = t[n - 1],
            foilTime = foil,
            vmax2 = bestOver(t, c, 2.0, false).first,
            best10 = bestOver(t, c, 10.0, false).first,
            best100m = bestOver(t, c, 100.0, true).first,
            best500m = bestOver(t, c, 500.0, true).first,
            avgMoving = if (moving > 0) movingDist / moving else 0.0,
            turns = turns, foilTurns = foilTurns, takeoffs = takeoffs,
            jibes = jibes, foilJibes = fJ, tacks = tacks, foilTacks = fT,
            accels = accels, bestAccelGain = bestGain, bestAccelDt = bestDt, wind = wind,
        )
    }
}
