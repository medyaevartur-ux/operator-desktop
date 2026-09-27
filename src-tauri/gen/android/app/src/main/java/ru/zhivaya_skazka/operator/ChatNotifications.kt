package ru.zhivaya_skazka.operator

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.util.UUID

object ChatNotifications {
    private const val CHANNEL = "chat_messages"
    private fun manager(context: Context) = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    private fun channel(context: Context) {
        if (Build.VERSION.SDK_INT >= 26) manager(context).createNotificationChannel(NotificationChannel(CHANNEL, "Сообщения чата", NotificationManager.IMPORTANCE_HIGH).apply { description = "Сообщения клиентов Живой Сказки" })
    }
    /** Что мешает уведомлениям на этом телефоне: разрешение, канал, экономия батареи, режим «Не беспокоить». */
    fun diagnostics(context: Context): JSONObject {
        channel(context)
        val permitted = NotificationManagerCompat.from(context).areNotificationsEnabled() &&
            (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
        val channelOn = Build.VERSION.SDK_INT < 26 || manager(context).getNotificationChannel(CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE
        val power = context.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
        val activities = context.getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager
        val quiet = when (manager(context).currentInterruptionFilter) {
            NotificationManager.INTERRUPTION_FILTER_ALL -> "off"
            NotificationManager.INTERRUPTION_FILTER_PRIORITY -> "priority_only"
            NotificationManager.INTERRUPTION_FILTER_ALARMS -> "alarms_only"
            NotificationManager.INTERRUPTION_FILTER_NONE -> "silent"
            else -> "unknown"
        }
        return JSONObject()
            .put("permission", if (permitted) "granted" else "denied")
            .put("channel_enabled", channelOn)
            .put("battery_optimized", !power.isIgnoringBatteryOptimizations(context.packageName))
            .put("background_restricted", Build.VERSION.SDK_INT >= 28 && activities.isBackgroundRestricted)
            .put("quiet_mode", quiet)
    }
    private fun allowed(context: Context) = NotificationManagerCompat.from(context).areNotificationsEnabled() &&
        (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
        (Build.VERSION.SDK_INT < 26 || manager(context).getNotificationChannel(CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE)
    private fun open(context: Context, session: String, delivery: String? = null): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            data = Uri.Builder().scheme("zhivaya-operator").authority("chat").appendPath(session).build()
            putExtra("session_id", session)
            if (delivery != null) putExtra("delivery_id", delivery)
        }
        return PendingIntent.getActivity(context, session.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
    private fun action(context: Context, notification: JSONObject, operator: String, kind: String): PendingIntent {
        val delivery = notification.getString("delivery_id")
        val intent = Intent(context, NotificationActionReceiver::class.java).apply {
            data = Uri.Builder().scheme("zhivaya-operator").authority(kind).appendPath(delivery).build()
            putExtra("session_id", notification.getString("session_id")); putExtra("delivery_id", delivery)
            putExtra("operator_id", operator); putExtra("action", kind); putExtra("client_id", UUID.randomUUID().toString())
        }
        val mutation = if (kind == "reply") PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE
        return PendingIntent.getBroadcast(context, (delivery + kind).hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or mutation)
    }
    @Synchronized
    fun receive(context: Context, delivery: String): Boolean {
        require(NotificationWork.validId(delivery))
        val session = NativeAuthVault.get(context) ?: return false
        val operator = session.getJSONObject("operator").getString("id")
        val response = NativeAuthVault.request(context, "/api/chat-v8/notifications/$delivery", "GET", null, operator)
        if (response.first in listOf(401, 403, 404)) return false
        check(response.first == 200) { "network_unavailable" }
        val notification = response.second
        val sessionId = notification.getString("session_id")
        if (NativeAuthVault.foreground && NativeAuthVault.activeSessionId == sessionId) {
            NativeAuthVault.request(context, "/api/sessions/$sessionId/read", "PATCH", JSONObject(), operator)
            ack(context, delivery, "read"); return true
        }
        val seen = context.getSharedPreferences("chat_v8_seen", Context.MODE_PRIVATE)
        if (seen.contains(delivery)) { ack(context, delivery, "displayed"); return true }
        channel(context)
        if (!allowed(context)) { ack(context, delivery, "blocked"); return false }
        val title = notification.optString("title", "Живая Сказка")
        val body = notification.optString("body", "Новое сообщение")
        val builder = NotificationCompat.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_brand_notification)
            .setContentTitle(title).setContentText(body).setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(open(context, sessionId, delivery)).setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true).setOnlyAlertOnce(false).setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setPriority(NotificationCompat.PRIORITY_HIGH)
            .addAction(NotificationCompat.Action.Builder(android.R.drawable.ic_menu_send, "Ответить", action(context, notification, operator, "reply"))
                .addRemoteInput(RemoteInput.Builder("chat_reply").setLabel("Ответ клиенту").build())
                .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY).setAllowGeneratedReplies(false).setAuthenticationRequired(true).build())
            .addAction(NotificationCompat.Action.Builder(android.R.drawable.checkbox_on_background, "Прочитано", action(context, notification, operator, "read"))
                .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ).setAuthenticationRequired(true).build())
        manager(context).notify(sessionId, 1, builder.build())
        val edit = seen.edit().putLong(delivery, System.currentTimeMillis())
        seen.all.entries.sortedByDescending { it.value as? Long ?: 0 }.drop(500).forEach { edit.remove(it.key) }
        edit.commit()
        ack(context, delivery, "displayed")
        return true
    }
    fun ack(context: Context, delivery: String, outcome: String) {
        NativeAuthVault.request(context, "/api/chat-v8/notifications/$delivery/ack", "POST", JSONObject().put("outcome", outcome))
    }
    fun cancel(context: Context, session: String) { manager(context).cancel(session, 1) }
    fun status(context: Context, session: String, title: String, body: String) {
        channel(context)
        if (!allowed(context)) return
        manager(context).notify(session, 1, NotificationCompat.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_brand_notification)
            .setContentTitle(title).setContentText(body).setOnlyAlertOnce(true).setSilent(true).setAutoCancel(true)
            .setContentIntent(open(context, session)).build())
    }
}
