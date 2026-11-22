package fr.wingtrack.watch

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** Sessions : un résumé <id>.json + la trace <id>.gpx dans le stockage de l'appli. */
object SessionStore {
    private fun dir(ctx: Context) = File(ctx.filesDir, "sessions").apply { mkdirs() }
    fun draftFile(ctx: Context) = File(ctx.filesDir, "current.csv")

    fun save(ctx: Context, pts: List<Pt>, s: Summary): String {
        val id = s.start.toString()
        val j = JSONObject()
            .put("start", s.start).put("distance", s.distance).put("duration", s.duration)
            .put("foilTime", s.foilTime).put("vmax2", s.vmax2).put("best10", s.best10)
            .put("best100m", s.best100m).put("best500m", s.best500m).put("avgMoving", s.avgMoving)
            .put("turns", s.turns).put("foilTurns", s.foilTurns)
            .put("takeoffs", s.takeoffs).put("jibes", s.jibes).put("foilJibes", s.foilJibes)
            .put("tacks", s.tacks).put("foilTacks", s.foilTacks).put("accels", s.accels)
            .put("bestAccelGain", s.bestAccelGain).put("bestAccelDt", s.bestAccelDt).put("wind", s.wind)
            .put("hrAvg", s.hrAvg).put("hrMax", s.hrMax).put("kcal", s.kcal).put("jumpCount", s.jumpCount)
            .put("maxJump", s.maxJump).put("maxAirtime", s.maxAirtime).put("pumps", s.pumps).put("pumpsPerTakeoff", s.pumpsPerTakeoff)
        File(dir(ctx), "$id.json").writeText(j.toString())
        File(dir(ctx), "$id.gpx").writeText(gpx(pts))
        return id
    }

    fun list(ctx: Context): List<Summary> =
        dir(ctx).listFiles { f -> f.name.endsWith(".json") }.orEmpty()
            .mapNotNull { runCatching { parse(JSONObject(it.readText())) }.getOrNull() }
            .sortedByDescending { it.start }

    fun get(ctx: Context, id: String): Summary? =
        File(dir(ctx), "$id.json").takeIf { it.exists() }?.let { runCatching { parse(JSONObject(it.readText())) }.getOrNull() }

    fun delete(ctx: Context, id: String) {
        File(dir(ctx), "$id.json").delete()
        File(dir(ctx), "$id.gpx").delete()
    }

    fun records(ctx: Context): Summary {
        val all = list(ctx)
        return Summary(
            vmax2 = all.maxOfOrNull { it.vmax2 } ?: 0.0,
            best10 = all.maxOfOrNull { it.best10 } ?: 0.0,
            best500m = all.maxOfOrNull { it.best500m } ?: 0.0,
            distance = all.maxOfOrNull { it.distance } ?: 0.0,
            foilTime = all.sumOf { it.foilTime },
            turns = all.size,
            foilJibes = all.sumOf { it.foilJibes },
            foilTacks = all.sumOf { it.foilTacks },
        )
    }

    private fun parse(j: JSONObject) = Summary(
        start = j.getLong("start"), distance = j.getDouble("distance"), duration = j.getDouble("duration"),
        foilTime = j.getDouble("foilTime"), vmax2 = j.getDouble("vmax2"), best10 = j.getDouble("best10"),
        best100m = j.getDouble("best100m"), best500m = j.getDouble("best500m"),
        avgMoving = j.getDouble("avgMoving"), turns = j.getInt("turns"), foilTurns = j.optInt("foilTurns"),
        takeoffs = j.optInt("takeoffs"), jibes = j.optInt("jibes"), foilJibes = j.optInt("foilJibes"),
        tacks = j.optInt("tacks"), foilTacks = j.optInt("foilTacks"), accels = j.optInt("accels"),
        bestAccelGain = j.optDouble("bestAccelGain", 0.0), bestAccelDt = j.optDouble("bestAccelDt", 0.0),
        wind = j.optDouble("wind", -1.0),
        hrAvg = j.optDouble("hrAvg", 0.0), hrMax = j.optInt("hrMax"), kcal = j.optDouble("kcal", 0.0),
        jumpCount = j.optInt("jumpCount"), maxJump = j.optDouble("maxJump", 0.0), maxAirtime = j.optDouble("maxAirtime", 0.0),
        pumps = j.optInt("pumps"), pumpsPerTakeoff = j.optDouble("pumpsPerTakeoff", 0.0),
    )

    private fun gpx(pts: List<Pt>): String {
        val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
        val sb = StringBuilder()
        sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
        sb.append("<gpx version=\"1.1\" creator=\"WingTrack Watch\" xmlns=\"http://www.topografix.com/GPX/1/1\">\n<trk><name>Wingfoil</name><trkseg>\n")
        for (p in pts) sb.append("<trkpt lat=\"${p.lat}\" lon=\"${p.lon}\"><time>${iso.format(Date(p.t))}</time></trkpt>\n")
        sb.append("</trkseg></trk>\n</gpx>\n")
        return sb.toString()
    }
}

object Prefs {
    private fun sp(ctx: Context) = ctx.getSharedPreferences("wingtrack", Context.MODE_PRIVATE)
    /** Unité de vitesse : "kmh", "kn", "ms" ou "mph" (reprend l'ancien réglage nœuds). */
    fun unit(ctx: Context): String = sp(ctx).getString("unit", null) ?: if (sp(ctx).getBoolean("knots", false)) "kn" else "kmh"
    fun setUnit(ctx: Context, v: String) = sp(ctx).edit().putString("unit", v).apply()
    fun foilKmh(ctx: Context) = sp(ctx).getInt("foil", 12)
    fun setFoilKmh(ctx: Context, v: Int) = sp(ctx).edit().putInt("foil", v).apply()
    fun jumps(ctx: Context) = sp(ctx).getBoolean("jumps", true)
    fun setJumps(ctx: Context, v: Boolean) = sp(ctx).edit().putBoolean("jumps", v).apply()
    fun weight(ctx: Context) = sp(ctx).getInt("weight", 75)
    fun setWeight(ctx: Context, v: Int) = sp(ctx).edit().putInt("weight", v).apply()
    fun screenOn(ctx: Context) = sp(ctx).getBoolean("screenOn", true)
    fun setScreenOn(ctx: Context, v: Boolean) = sp(ctx).edit().putBoolean("screenOn", v).apply()
}
