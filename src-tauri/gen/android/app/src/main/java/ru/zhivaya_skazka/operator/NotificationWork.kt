package ru.zhivaya_skazka.operator

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.RemoteInput
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

class NotificationWork(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
    override fun doWork(): Result {
        val delivery = inputData.getString("delivery_id") ?: return Result.failure()
        val action = inputData.getString("action") ?: "receive"
        if (!validId(delivery)) return Result.failure()
        return try {
            if (action == "receive") {
                ChatNotifications.receive(applicationContext, delivery)
                Result.success()
            } else {
                val expected = inputData.getString("operator_id") ?: return Result.failure()
                val session = NativeAuthVault.get(applicationContext) ?: return Result.failure()
                if (session.getJSONObject("operator").optString("id") != expected) return Result.failure()
                val sessionId = inputData.getString("session_id") ?: return Result.failure()
                if (!validId(sessionId)) return Result.failure()
                val result = if (action == "reply") {
                    val text = NativeReplies.record(applicationContext, inputData.getString("client_id") ?: return Result.failure())?.getString("message") ?: return Result.failure()
                    NativeAuthVault.request(applicationContext, "/api/sessions/$sessionId/messages", "POST", JSONObject()
                        .put("message", text).put("client_message_id", inputData.getString("client_id")), expected)
                } else NativeAuthVault.request(applicationContext, "/api/sessions/$sessionId/read", "PATCH", JSONObject(), expected)
                if (result.first in 200..299) {
                    if (action == "reply") NativeReplies.remove(applicationContext, inputData.getString("client_id") ?: "", expected)
                    ChatNotifications.cancel(applicationContext, sessionId)
                    try { ChatNotifications.ack(applicationContext, delivery, "read") } catch (_: Exception) { /* The reply is already committed. */ }
                    Result.success()
                } else if (result.first >= 500 || result.first == 429) retryOrSave(action, sessionId)
                else {
                    if (action == "reply") preserveReply()
                    ChatNotifications.status(applicationContext, sessionId, "Ответ не отправлен", "Откройте приложение: ответ сохранён в очереди.")
                    Result.failure()
                }
            }
        } catch (_: Exception) {
            retryOrSave(action, inputData.getString("session_id"))
        }
    }
    private fun retryOrSave(action: String, sessionId: String?): Result {
        if (runAttemptCount < 5) return Result.retry()
        if (action == "reply") preserveReply()
        if (sessionId != null) ChatNotifications.status(applicationContext, sessionId, "Ожидает отправки", "Ответ сохранён. Откройте приложение после восстановления связи.")
        return Result.failure()
    }
    private fun preserveReply() {
        inputData.getString("client_id")?.let { NativeReplies.fail(applicationContext, it) }
    }
    companion object {
        fun validId(value: String) = value.matches(Regex("[0-9a-fA-F]{8}-[0-9a-fA-F-]{27}"))
        fun enqueue(context: Context, data: Data, unique: String) {
            val builder = OneTimeWorkRequest.Builder(NotificationWork::class.java).setInputData(data)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS).addTag("chat-v8-notifications")
            if (Build.VERSION.SDK_INT >= 31) builder.setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            WorkManager.getInstance(context).enqueueUniqueWork(unique, ExistingWorkPolicy.KEEP, builder.build())
        }
        fun receive(context: Context, delivery: String) {
            if (validId(delivery)) enqueue(context, Data.Builder().putString("action", "receive").putString("delivery_id", delivery).build(), "notify-$delivery")
        }
    }
}

class NotificationActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val delivery = intent.getStringExtra("delivery_id") ?: return
        val session = intent.getStringExtra("session_id") ?: return
        val operator = intent.getStringExtra("operator_id") ?: return
        val action = intent.getStringExtra("action") ?: return
        if (!NotificationWork.validId(delivery) || !NotificationWork.validId(session) || !NotificationWork.validId(operator) || action !in listOf("read", "reply")) return
        try {
            val data = Data.Builder().putString("delivery_id", delivery).putString("session_id", session).putString("operator_id", operator).putString("action", action)
            val clientId = intent.getStringExtra("client_id") ?: UUID.randomUUID().toString()
            if (action == "reply") {
                val text = RemoteInput.getResultsFromIntent(intent)?.getCharSequence("chat_reply")?.toString()?.trim() ?: return
                if (text.isBlank()) return
                if (text.length > 10000) {
                    ChatNotifications.status(context, session, "Ответ слишком длинный", "Отправьте текст из приложения: максимум 10 000 символов.")
                    return
                }
                NativeReplies.save(context, JSONObject().put("client_id",clientId).put("operator_id",operator).put("session_id",session)
                    .put("message",text).put("created_at",System.currentTimeMillis().toString()).put("failed",false))
                data.putString("client_id",clientId)
            }
            NotificationWork.enqueue(context, data.build(), "$action-$delivery-$clientId")
            ChatNotifications.status(context, session, if (action == "reply") "Отправляем ответ…" else "Отмечаем прочитанным…", "Живая Сказка")
        } catch (_: Exception) {
            ChatNotifications.status(context, session, "Не удалось сохранить действие", "Откройте приложение и повторите попытку.")
        }
    }
}
