package ru.zhivaya_skazka.operator
import android.content.Context
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
class FCMService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        getSharedPreferences("fcm_prefs", Context.MODE_PRIVATE).edit().putString("fcm_token", token).apply()
    }
    override fun onMessageReceived(message: RemoteMessage) {
        // External push is only a wake-up hint. Fetch content from our authenticated API.
        val delivery = message.data["delivery_id"] ?: return
        NotificationWork.receive(this, delivery)
    }
}
