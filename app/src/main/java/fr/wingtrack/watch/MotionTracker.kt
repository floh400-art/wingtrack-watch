package fr.wingtrack.watch

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import androidx.core.content.ContextCompat
import kotlin.math.sqrt

/**
 * Capteurs de la montre pendant une session :
 *  - fréquence cardiaque (moyenne, max)
 *  - sauts : décollage (pic > 1,8 g) → phase en l'air calme → impact à l'atterrissage (> 2,5 g) ;
 *    hauteur estimée = g·t²/8 à partir du temps en l'air (estimation, comme les applis "jump" au poignet)
 *  - pumping : pics d'accélération (0,35 g au-dessus de la moyenne) quand on n'est pas encore sur le foil ;
 *    on compte les pumps des 20 s avant chaque décollage
 * Toutes les heures sont en millisecondes "elapsedRealtime" (horloge des capteurs).
 */
class MotionTracker(
    private val ctx: Context,
    private val foilOn: Double,          // m/s
    private val jumpsOn: Boolean,
    private val onJump: (Jump) -> Unit,
) : SensorEventListener {

    data class Jump(val t: Long, val airtime: Double, val height: Double)

    private val sm = ctx.getSystemService(SensorManager::class.java)

    @Volatile var speed = 0.0
    @Volatile var paused = false
    @Volatile var hr = 0
    private var hrSum = 0.0
    private var hrN = 0
    var hrMax = 0; private set
    val hrAvg get() = if (hrN > 0) hrSum / hrN else 0.0

    val jumps = ArrayList<Jump>()
    private val pumpTimes = ArrayDeque<Long>()
    val pumpsPerTakeoff = ArrayList<Int>()
    var totalPumps = 0; private set

    private var lp = 1.0
    private var lastPeak = 0L
    private var cand = 0L
    private var airSum = 0.0
    private var airN = 0
    private var airMax = 0.0
    private var foiling = false
    private var foilSince = 0L
    private var belowSince = 0L

    fun start() {
        sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)?.let { sm.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.BODY_SENSORS) == PackageManager.PERMISSION_GRANTED)
            sm.getDefaultSensor(Sensor.TYPE_HEART_RATE)?.let { sm.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL) }
    }

    fun stop() = sm.unregisterListener(this)

    /** Appelé à chaque point GPS : sert à repérer les décollages pour compter les pumps. */
    fun onSpeed(v: Double, now: Long) {
        speed = v
        if (!foiling) {
            if (v >= foilOn) {
                if (foilSince == 0L) foilSince = now
                if (now - foilSince >= 3000) {
                    foiling = true; belowSince = 0L
                    synchronized(pumpTimes) {
                        val n = pumpTimes.count { it in (foilSince - 20000)..foilSince }
                        if (n > 0) pumpsPerTakeoff.add(n)
                    }
                }
            } else foilSince = 0L
        } else {
            if (v < foilOn * 0.8) {
                if (belowSince == 0L) belowSince = now
                if (now - belowSince > 2000) { foiling = false; belowSince = 0L; foilSince = 0L }
            } else belowSince = 0L
        }
    }

    override fun onSensorChanged(e: SensorEvent) {
        when (e.sensor.type) {
            Sensor.TYPE_HEART_RATE -> {
                val v = e.values[0].toInt()
                if (v in 35..230 && e.accuracy != SensorManager.SENSOR_STATUS_UNRELIABLE && e.accuracy != SensorManager.SENSOR_STATUS_NO_CONTACT) {
                    hr = v
                    if (!paused) { hrSum += v; hrN++; if (v > hrMax) hrMax = v }
                }
            }
            Sensor.TYPE_ACCELEROMETER -> if (!paused) accel(e)
        }
    }

    private fun accel(e: SensorEvent) {
        val t = e.timestamp / 1_000_000L
        val x = e.values[0]; val y = e.values[1]; val z = e.values[2]
        val g = sqrt((x * x + y * y + z * z).toDouble()) / 9.80665
        lp += 0.05 * (g - lp)
        val dyn = g - lp

        // pumping : avant d'être sur le foil, en mouvement
        if (!foiling && speed in 1.0..foilOn && dyn > 0.35 && t - lastPeak > 350) {
            lastPeak = t; totalPumps++
            synchronized(pumpTimes) {
                pumpTimes.addLast(t)
                while (pumpTimes.isNotEmpty() && pumpTimes.first() < t - 60000) pumpTimes.removeFirst()
            }
        }

        // sauts
        if (!jumpsOn) return
        if (cand == 0L) {
            if (g > 1.8 && speed >= foilOn * 0.8) { cand = t; airSum = 0.0; airN = 0; airMax = 0.0 }
            return
        }
        val dt = t - cand
        when {
            dt > 3500 -> cand = 0L
            dt >= 700 && g > 2.5 -> {
                val mean = if (airN > 0) airSum / airN else 9.0
                if (mean < 1.3 && airMax < 2.0) {
                    val air = dt / 1000.0
                    val j = Jump(System.currentTimeMillis(), air, 9.81 * air * air / 8)
                    if (j.height >= 0.5) { jumps.add(j); onJump(j) }
                }
                cand = 0L
            }
            dt > 150 -> {
                airSum += g; airN++
                if (g > airMax) airMax = g
                if (airMax >= 2.0) cand = 0L // secousse : ce n'était pas un saut
            }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
}
