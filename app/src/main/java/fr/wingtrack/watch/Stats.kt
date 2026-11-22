package fr.wingtrack.watch

import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

data class Pt(val t: Long, val lat: Double, val lon: Double)

data class Summary(
    val start: Long = 0,
    val distance: Double = 0.0,      // m
    val duration: Double = 0.0,      // s
    val foilTime: Double = 0.0,      // s
    val vmax2: Double = 0.0,         // m/s, meilleure vitesse sur 2 s
    val best10: Double = 0.0,
    val best100m: Double = 0.0,
    val best500m: Double = 0.0,
    val avgMoving: Double = 0.0,
    val turns: Int = 0,
    val foilTurns: Int = 0,
)

object Stats {
    private const val R = 6371008.8
    private fun rad(d: Double) = d * Math.PI / 180.0

    fun dist(a: Pt, b: Pt): Double {
        val dLat = rad(b.lat - a.lat)
        val dLon = rad(b.lon - a.lon)
        val s = sin(dLat / 2).let { it * it } +
            cos(rad(a.lat)) * cos(rad(b.lat)) * sin(dLon / 2).let { it * it }
        return 2 * R * asin(min(1.0, sqrt(s)))
    }

    private fun bearing(a: Pt, b: Pt): Double {
        val y = sin(rad(b.lon - a.lon)) * cos(rad(b.lat))
        val x = cos(rad(a.lat)) * sin(rad(b.lat)) - sin(rad(a.lat)) * cos(rad(b.lat)) * cos(rad(b.lon - a.lon))
        return (Math.toDegrees(atan2(y, x)) + 360.0) % 360.0
    }

    private fun angDiff(a: Double, b: Double): Double {
        var d = b - a
        while (d > 180) d -= 360
        while (d < -180) d += 360
        return d
    }

    private fun bestOverTime(t: DoubleArray, d: DoubleArray, w: Double): Double {
        var best = 0.0
        var j = 0
        for (i in t.indices) {
            if (j < i) j = i
            while (j < t.size && t[j] - t[i] < w) j++
            if (j >= t.size) break
            val dt = t[j] - t[i]
            if (dt > w * 2.5) continue
            val v = (d[j] - d[i]) / dt
            if (v > best) best = v
        }
        return best
    }

    private fun bestOverDist(t: DoubleArray, d: DoubleArray, l: Double): Double {
        var best = 0.0
        var j = 0
        for (i in t.indices) {
            if (j < i) j = i
            while (j < t.size && d[j] - d[i] < l) j++
            if (j >= t.size) break
            val dt = t[j] - t[i]
            if (dt <= 0) continue
            val v = (d[j] - d[i]) / dt
            if (v > best) best = v
        }
        return best
    }

    fun compute(pts: List<Pt>, foilKmh: Double): Summary {
        val n = pts.size
        if (n < 2) return Summary(start = pts.firstOrNull()?.t ?: 0)
        val foilThr = foilKmh / 3.6
        val moveThr = 4 / 3.6
        val t = DoubleArray(n)
        val d = DoubleArray(n)
        for (i in 1 until n) {
            t[i] = (pts[i].t - pts[0].t) / 1000.0
            d[i] = d[i - 1] + dist(pts[i - 1], pts[i])
        }
        // vitesse lissée sur ~3 s
        val sp = DoubleArray(n)
        for (i in 0 until n) {
            var a = i
            var b = i
            while (a > 0 && t[i] - t[a - 1] <= 1.5) a--
            while (b < n - 1 && t[b + 1] - t[i] <= 1.5) b++
            if (a == b) { if (i > 0) a = i - 1 else b = i + 1 }
            val dt = t[b] - t[a]
            sp[i] = if (dt > 0) (d[b] - d[a]) / dt else 0.0
        }
        var moving = 0.0
        var movingDist = 0.0
        var foil = 0.0
        for (i in 1 until n) {
            val dt = t[i] - t[i - 1]
            if (dt > 30) continue
            val v = (sp[i] + sp[i - 1]) / 2
            if (v >= moveThr) { moving += dt; movingDist += d[i] - d[i - 1] }
            if (v >= foilThr) foil += dt
        }
        // virages : changement de cap cumulé > 140° en 25 s max
        data class S(val t: Double, val h: Double, val v: Double)
        val samples = ArrayList<S>()
        var last = 0
        for (i in 1 until n) {
            if (t[i] - t[last] >= 3) {
                if (d[i] - d[last] > 3) samples.add(S(t[i], bearing(pts[last], pts[i]), (d[i] - d[last]) / (t[i] - t[last])))
                last = i
            }
        }
        var turns = 0
        var foilTurns = 0
        var cooldown = -1.0
        for (k in samples.indices) {
            if (samples[k].t < cooldown) continue
            var cum = 0.0
            var minV = Double.MAX_VALUE
            var sumV = 0.0
            var cnt = 0
            var m = k + 1
            while (m < samples.size && samples[m].t - samples[k].t <= 25) {
                cum += angDiff(samples[m - 1].h, samples[m].h)
                minV = minOf(minV, samples[m].v); sumV += samples[m].v; cnt++
                if (abs(cum) >= 140) {
                    if (sumV / cnt >= 6 / 3.6) {
                        turns++
                        if (minV >= foilThr * 0.9) foilTurns++
                    }
                    cooldown = samples[m].t + 10
                    break
                }
                m++
            }
        }
        return Summary(
            start = pts[0].t,
            distance = d[n - 1],
            duration = t[n - 1],
            foilTime = foil,
            vmax2 = bestOverTime(t, d, 2.0),
            best10 = bestOverTime(t, d, 10.0),
            best100m = bestOverDist(t, d, 100.0),
            best500m = bestOverDist(t, d, 500.0),
            avgMoving = if (moving > 0) movingDist / moving else 0.0,
            turns = turns,
            foilTurns = foilTurns,
        )
    }
}
