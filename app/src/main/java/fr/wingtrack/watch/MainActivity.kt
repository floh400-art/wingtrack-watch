package fr.wingtrack.watch

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ButtonDefaults
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val Teal = Color(0xFF22D3C5)
private val Orange = Color(0xFFFFB84D)
private val Red = Color(0xFFFF5D6C)
private val Muted = Color(0xFF86A6B8)
private val Card = Color(0xFF0D2231)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { MaterialTheme { App(this) } }
    }

    fun keepScreenOn(on: Boolean) {
        if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
}

/* ---------- formatage ---------- */
private fun fmtSpeed(ctx: Context, ms: Double) =
    String.format(Locale.FRANCE, "%.1f", if (Prefs.knots(ctx)) ms * 1.943844 else ms * 3.6)
private fun unit(ctx: Context) = if (Prefs.knots(ctx)) "nds" else "km/h"
private fun fmtDist(m: Double) =
    if (m >= 1000) String.format(Locale.FRANCE, "%.2f km", m / 1000) else "${m.toInt()} m"
private fun fmtTime(s: Double): String {
    val t = s.toLong(); val h = t / 3600; val m = (t % 3600) / 60; val x = t % 60
    return if (h > 0) String.format(Locale.FRANCE, "%d:%02d:%02d", h, m, x) else String.format(Locale.FRANCE, "%d:%02d", m, x)
}
private fun fmtDate(ms: Long) = SimpleDateFormat("EEE d MMM · HH:mm", Locale.FRANCE).format(Date(ms))

private fun hasLocation(ctx: Context) =
    ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

/* ---------- navigation ---------- */
@Composable
fun App(activity: MainActivity) {
    val ctx = LocalContext.current
    val live by TrackingService.state.collectAsState()
    var route by remember { mutableStateOf(if (live.running) "live" else "home") }
    var refresh by remember { mutableIntStateOf(0) }

    val permLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { res ->
        if (res[Manifest.permission.ACCESS_FINE_LOCATION] == true) {
            TrackingService.send(ctx, TrackingService.ACTION_START); route = "live"
        }
    }
    fun startSession() {
        if (hasLocation(ctx)) { TrackingService.send(ctx, TrackingService.ACTION_START); route = "live" }
        else {
            val perms = mutableListOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
            if (Build.VERSION.SDK_INT >= 33) perms.add(Manifest.permission.POST_NOTIFICATIONS)
            permLauncher.launch(perms.toTypedArray())
        }
    }

    // fin de session -> on affiche le résumé
    LaunchedEffect(live.savedId) {
        val id = live.savedId ?: return@LaunchedEffect
        TrackingService.clearSaved()
        refresh++
        route = if (id.isEmpty()) "home" else "detail:$id"
    }
    LaunchedEffect(live.running) { if (live.running) route = "live" }

    BackHandler(enabled = route != "home" && route != "live") {
        route = if (route.startsWith("detail")) "history" else "home"
    }

    Scaffold(timeText = { if (route != "live") TimeText() }, modifier = Modifier.background(Color.Black)) {
        when {
            route == "live" -> LiveScreen(activity, live)
            route == "history" -> HistoryScreen(refresh) { route = "detail:$it" }
            route == "settings" -> SettingsScreen()
            route.startsWith("detail:") -> DetailScreen(route.removePrefix("detail:")) { refresh++; route = "history" }
            else -> HomeScreen(refresh, onStart = ::startSession, onHistory = { route = "history" }, onSettings = { route = "settings" })
        }
    }
}

/* ---------- accueil ---------- */
@Composable
fun HomeScreen(refresh: Int, onStart: () -> Unit, onHistory: () -> Unit, onSettings: () -> Unit) {
    val ctx = LocalContext.current
    val rec = remember(refresh) { SessionStore.records(ctx) }
    val st = rememberScalingLazyListState()
    ScalingLazyColumn(state = st, modifier = Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
        item { Text("WingTrack", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Teal) }
        item {
            Chip(
                onClick = onStart,
                label = { Text("Démarrer", fontWeight = FontWeight.Bold) },
                secondaryLabel = { Text("Session wingfoil") },
                colors = ChipDefaults.primaryChipColors(backgroundColor = Teal, contentColor = Color.Black, secondaryContentColor = Color(0xFF04211E)),
                modifier = Modifier.fillMaxWidth(),
            )
        }
        item {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(vertical = 4.dp)) {
                Text("Records", fontSize = 11.sp, color = Muted)
                Text("Max ${fmtSpeed(ctx, rec.vmax2)} · 10 s ${fmtSpeed(ctx, rec.best10)} ${unit(ctx)}", fontSize = 13.sp, textAlign = TextAlign.Center)
                Text("${rec.turns} sessions · ${fmtTime(rec.foilTime)} foil", fontSize = 11.sp, color = Muted)
            }
        }
        item { Chip(onClick = onHistory, label = { Text("Historique") }, colors = ChipDefaults.secondaryChipColors(), modifier = Modifier.fillMaxWidth()) }
        item { Chip(onClick = onSettings, label = { Text("Réglages") }, colors = ChipDefaults.secondaryChipColors(), modifier = Modifier.fillMaxWidth()) }
    }
}

/* ---------- session en direct ---------- */
@Composable
fun LiveScreen(activity: MainActivity, s: LiveState) {
    val ctx = LocalContext.current
    val screenOn = remember { Prefs.screenOn(ctx) }
    DisposableEffect(screenOn) {
        activity.keepScreenOn(screenOn)
        onDispose { activity.keepScreenOn(false) }
    }
    var confirm by remember { mutableStateOf(false) }
    LaunchedEffect(confirm) { if (confirm) { delay(3000); confirm = false } }
    val foil = s.speed * 3.6 >= Prefs.foilKmh(ctx)
    val acc = s.accuracy
    val gpsColor = when { acc == null -> Red; acc <= 10f -> Teal; acc <= 25f -> Orange; else -> Red }

    Column(
        modifier = Modifier.fillMaxSize().background(Color.Black).padding(horizontal = 14.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(7.dp).background(gpsColor, shape = androidx.compose.foundation.shape.CircleShape))
            Spacer(Modifier.width(4.dp))
            Text(
                when { acc == null -> "GPS…"; s.paused -> "PAUSE"; else -> fmtTime(s.elapsedS.toDouble()) },
                fontSize = 13.sp, color = if (s.paused) Orange else Muted,
            )
        }
        Text(
            fmtSpeed(ctx, s.speed), fontSize = 58.sp, fontWeight = FontWeight.ExtraBold,
            color = if (foil) Teal else Color.White, maxLines = 1,
        )
        Text(unit(ctx), fontSize = 11.sp, color = Muted)
        Spacer(Modifier.height(4.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Max ${fmtSpeed(ctx, s.vmax)}", fontSize = 13.sp, color = Teal, fontWeight = FontWeight.Bold)
            Text(fmtDist(s.distance), fontSize = 13.sp)
        }
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Button(
                onClick = { TrackingService.send(ctx, TrackingService.ACTION_TOGGLE_PAUSE) },
                colors = ButtonDefaults.buttonColors(backgroundColor = if (s.paused) Teal else Card, contentColor = if (s.paused) Color.Black else Color.White),
                modifier = Modifier.size(ButtonDefaults.SmallButtonSize),
            ) { Text(if (s.paused) "▶" else "II", fontWeight = FontWeight.Bold) }
            Button(
                onClick = { if (confirm) TrackingService.send(ctx, TrackingService.ACTION_STOP) else confirm = true },
                colors = ButtonDefaults.buttonColors(backgroundColor = Red, contentColor = Color.White),
                modifier = Modifier.size(width = if (confirm) 64.dp else ButtonDefaults.SmallButtonSize, height = ButtonDefaults.SmallButtonSize),
            ) { Text(if (confirm) "OK ?" else "■", fontWeight = FontWeight.Bold, fontSize = 13.sp) }
        }
    }
}

/* ---------- historique ---------- */
@Composable
fun HistoryScreen(refresh: Int, onOpen: (String) -> Unit) {
    val ctx = LocalContext.current
    val list = remember(refresh) { SessionStore.list(ctx) }
    val st = rememberScalingLazyListState()
    ScalingLazyColumn(state = st, modifier = Modifier.fillMaxSize()) {
        item { Text("Historique", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Teal, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center) }
        if (list.isEmpty()) item { Text("Aucune session", color = Muted, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center) }
        items(list) { s ->
            Chip(
                onClick = { onOpen(s.start.toString()) },
                label = { Text(fmtDate(s.start), maxLines = 1) },
                secondaryLabel = { Text("${fmtDist(s.distance)} · max ${fmtSpeed(ctx, s.vmax2)}", maxLines = 1) },
                colors = ChipDefaults.secondaryChipColors(),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/* ---------- détail ---------- */
@Composable
fun DetailScreen(id: String, onDeleted: () -> Unit) {
    val ctx = LocalContext.current
    val s = remember(id) { SessionStore.get(ctx, id) }
    var confirmDel by remember { mutableStateOf(false) }
    val st = rememberScalingLazyListState()
    if (s == null) { Text("Session introuvable", modifier = Modifier.fillMaxSize(), textAlign = TextAlign.Center); return }
    val u = unit(ctx)
    val rows = listOf(
        "Vmax (2 s)" to "${fmtSpeed(ctx, s.vmax2)} $u",
        "Meilleur 10 s" to "${fmtSpeed(ctx, s.best10)} $u",
        "Meilleur 100 m" to "${fmtSpeed(ctx, s.best100m)} $u",
        "Meilleur 500 m" to "${fmtSpeed(ctx, s.best500m)} $u",
        "Moy. en mvt" to "${fmtSpeed(ctx, s.avgMoving)} $u",
        "Distance" to fmtDist(s.distance),
        "Durée" to fmtTime(s.duration),
        "Sur le foil" to fmtTime(s.foilTime),
        "Virages" to "${s.turns} (${s.foilTurns} foilés)",
    )
    ScalingLazyColumn(state = st, modifier = Modifier.fillMaxSize()) {
        item { Text(fmtDate(s.start), fontSize = 13.sp, color = Muted, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center) }
        items(rows) { (k, v) ->
            Row(
                Modifier.fillMaxWidth().background(Card, shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(k, fontSize = 12.sp, color = Muted)
                Text(v, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = if (k.startsWith("Vmax")) Teal else Color.White)
            }
        }
        item {
            Chip(
                onClick = { if (confirmDel) { SessionStore.delete(ctx, id); onDeleted() } else confirmDel = true },
                label = { Text(if (confirmDel) "Confirmer ?" else "Supprimer") },
                colors = ChipDefaults.secondaryChipColors(contentColor = Red),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/* ---------- réglages ---------- */
@Composable
fun SettingsScreen() {
    val ctx = LocalContext.current
    var knots by remember { mutableStateOf(Prefs.knots(ctx)) }
    var foil by remember { mutableIntStateOf(Prefs.foilKmh(ctx)) }
    var screenOn by remember { mutableStateOf(Prefs.screenOn(ctx)) }
    val st = rememberScalingLazyListState()
    ScalingLazyColumn(state = st, modifier = Modifier.fillMaxSize()) {
        item { Text("Réglages", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Teal, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center) }
        item {
            Chip(onClick = { knots = !knots; Prefs.setKnots(ctx, knots) },
                label = { Text("Unité") }, secondaryLabel = { Text(if (knots) "nœuds" else "km/h") },
                colors = ChipDefaults.secondaryChipColors(), modifier = Modifier.fillMaxWidth())
        }
        item {
            Chip(onClick = { foil = if (foil >= 20) 8 else foil + 2; Prefs.setFoilKmh(ctx, foil) },
                label = { Text("Seuil foil") }, secondaryLabel = { Text("$foil km/h (toucher pour changer)") },
                colors = ChipDefaults.secondaryChipColors(), modifier = Modifier.fillMaxWidth())
        }
        item {
            Chip(onClick = { screenOn = !screenOn; Prefs.setScreenOn(ctx, screenOn) },
                label = { Text("Écran allumé") }, secondaryLabel = { Text(if (screenOn) "Oui (plus de batterie)" else "Non") },
                colors = ChipDefaults.secondaryChipColors(), modifier = Modifier.fillMaxWidth())
        }
    }
}
