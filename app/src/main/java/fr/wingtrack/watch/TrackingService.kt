package fr.wingtrack.watch

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File

data class LiveState(
    val running: Boolean = false,
    val paused: Boolean = false,
    val speed: Double = 0.0,      // m/s
    val vmax: Double = 0.0,       // m/s (2 s)
    val best10: Double = 0.0,
    val distance: Double = 0.0,   // m
    val elapsedS: Long = 0,
    val accuracy: Float? = null,
    val foilTime: Double = 0.0,
    val turns: Int = 0,
    val savedId: String? = null,
)

class TrackingService : Service(), LocationListener {

    companion object {
        const val ACTION_START = "start"
        const val ACTION_TOGGLE_PAUSE = "pause"
        const val ACTION_STOP = "stop"
        private const val CHANNEL = "tracking"
        private const val NOTIF_ID = 42
        private val _state = MutableStateFlow(LiveState())
        val state: StateFlow<LiveState> = _state

        fun send(ctx: Context, action: String) {
            val i = Intent(ctx, TrackingService::class.java).setAction(action)
            if (action == ACTION_START) ctx.startForegroundService(i) else ctx.startService(i)
        }
        fun clearSaved() { _state.value = _state.value.copy(savedId = null) }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var ticker: Job? = null
    private val pts = ArrayList<Pt>()
    private var lm: LocationManager? = null
    private var wake: PowerManager.WakeLock? = null
    private var draft: File? = null
    private var lastTick = 0L
    private var elapsedMs = 0L
    private var recordVmax = 0.0
    private var lastBuzz = 0L
    private var foilKmh = 12.0

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> start()
            ACTION_TOGGLE_PAUSE -> {
                val p = !_state.value.paused
                lastTick = System.currentTimeMillis()
                _state.value = _state.value.copy(paused = p)
            }
            ACTION_STOP -> stop()
            null -> start() // relancé par le système après un arrêt : on reprend la session
        }
        return START_STICKY
    }

    @SuppressLint("MissingPermission", "WakelockTimeout")
    private fun start() {
        if (_state.value.running) return
        createChannel()
        ServiceCompat.startForeground(this, NOTIF_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        foilKmh = Prefs.foilKmh(this).toDouble()
        draft = SessionStore.draftFile(this)
        pts.clear()
        // reprise d'une session interrompue
        draft?.takeIf { it.exists() }?.forEachLine { line ->
            val a = line.split(',')
            if (a.size == 3) runCatching { pts.add(Pt(a[0].toLong(), a[1].toDouble(), a[2].toDouble())) }
        }
        elapsedMs = if (pts.size > 1) pts.last().t - pts.first().t else 0L
        recordVmax = SessionStore.records(this).vmax2
        lastTick = System.currentTimeMillis()
        wake = (getSystemService(POWER_SERVICE) as PowerManager)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "wingtrack:gps").apply { acquire() }
        lm = getSystemService(LOCATION_SERVICE) as LocationManager
        lm?.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, this, Looper.getMainLooper())
        _state.value = LiveState(running = true)
        ticker = scope.launch {
            var n = 0
            while (isActive) {
                delay(1000)
                val now = System.currentTimeMillis()
                if (!_state.value.paused) elapsedMs += now - lastTick
                lastTick = now
                var s = _state.value.copy(elapsedS = elapsedMs / 1000)
                if (++n % 3 == 0 && pts.size > 2) {
                    val sum = synchronized(pts) { Stats.compute(ArrayList(pts), foilKmh) }
                    s = s.copy(vmax = sum.vmax2, best10 = sum.best10, distance = sum.distance, foilTime = sum.foilTime, turns = sum.turns)
                    if (sum.vmax2 > recordVmax + 0.15 && sum.vmax2 * 3.6 > 15 && now - lastBuzz > 15000) {
                        lastBuzz = now
                        buzz(longArrayOf(0, 250, 120, 250, 120, 400)) // nouveau record perso
                    }
                    if (sum.vmax2 > recordVmax) recordVmax = sum.vmax2
                }
                if (_state.value.running) _state.value = s
            }
        }
    }

    override fun onLocationChanged(loc: Location) {
        val st = _state.value
        _state.value = st.copy(accuracy = loc.accuracy)
        if (!st.running || st.paused) return
        if (!loc.hasAccuracy() || loc.accuracy > 30f) return
        val p = Pt(loc.time, loc.latitude, loc.longitude)
        val prev = pts.lastOrNull()
        var v = if (loc.hasSpeed()) loc.speed.toDouble() else 0.0
        if (prev != null) {
            val dt = (p.t - prev.t) / 1000.0
            if (dt < 0.5) return
            val calc = Stats.dist(prev, p) / dt
            if (calc > 25 && dt < 30) return // pic GPS aberrant (> 90 km/h)
            if (!loc.hasSpeed()) v = calc
        }
        synchronized(pts) { pts.add(p) }
        runCatching { draft?.appendText("${p.t},${p.lat},${p.lon}\n") }
        _state.value = _state.value.copy(speed = v)
    }

    @Deprecated("Deprecated in Java")
    override fun onStatusChanged(provider: String?, status: Int, extras: android.os.Bundle?) {}
    override fun onProviderEnabled(provider: String) {}
    override fun onProviderDisabled(provider: String) {}

    private fun stop() {
        lm?.removeUpdates(this)
        ticker?.cancel()
        val copy = synchronized(pts) { ArrayList(pts) }
        var id: String? = null
        if (copy.size >= 5) {
            val sum = Stats.compute(copy, Prefs.foilKmh(this).toDouble())
            id = SessionStore.save(this, copy, sum)
        }
        draft?.delete()
        runCatching { wake?.release() }
        buzz(longArrayOf(0, 500))
        _state.value = LiveState(running = false, savedId = id ?: "")
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        scope.cancel()
        lm?.removeUpdates(this)
        runCatching { if (wake?.isHeld == true) wake?.release() }
        super.onDestroy()
    }

    @Suppress("DEPRECATION")
    private fun buzz(pattern: LongArray) {
        runCatching {
            (getSystemService(VIBRATOR_SERVICE) as Vibrator).vibrate(VibrationEffect.createWaveform(pattern, -1))
        }
    }

    private fun createChannel() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Session en cours", NotificationManager.IMPORTANCE_LOW))
    }

    private fun notification(): Notification {
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return NotificationCompat.Builder(this, CHANNEL)
            .setContentTitle("WingTrack")
            .setContentText("Session wingfoil en cours")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .setContentIntent(open)
            .setCategory(NotificationCompat.CATEGORY_WORKOUT)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }
}
