package ru.zhivaya_skazka.operator

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject

class MainActivity : TauriActivity() {
    private val handler = Handler(Looper.getMainLooper())
    private var pendingSessionId: String? = null
    private var destroyed = false
    private lateinit var prefs: SharedPreferences
    private val tokenListener = SharedPreferences.OnSharedPreferenceChangeListener { preferences, key ->
        if (key == "fcm_token") preferences.getString(key, null)?.let { injectToken(it) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        prefs = getSharedPreferences("fcm_prefs", Context.MODE_PRIVATE)
        prefs.registerOnSharedPreferenceChangeListener(tokenListener)
        pendingSessionId = savedInstanceState?.getString("pending_session_id")
        requestNotificationsOnce()
        fetchFcmToken()
        handlePushIntent(intent)
    }

    private fun requestNotificationsOnce() {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED &&
            !prefs.getBoolean("notification_permission_requested", false)) {
            prefs.edit().putBoolean("notification_permission_requested", true).apply()
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1001)
        }
    }

    private fun fetchFcmToken() {
        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if (task.isSuccessful && !destroyed) {
                prefs.edit().putString("fcm_token", task.result).apply()
                injectToken(task.result)
            }
        }
    }

    private fun injectToken(token: String, attempt: Int = 0) {
        if (destroyed || attempt >= 30) return
        handler.postDelayed({
            if (!destroyed) {
                val webView = findWebView(window.decorView)
                if (webView == null) {
                    injectToken(token, attempt + 1)
                } else {
                    val value = JSONObject.quote(token)
                    webView.evaluateJavascript(
                        "window.__FCM_TOKEN = $value; window.__FCM_PLATFORM = 'android'; " +
                        "window.dispatchEvent(new Event('fcm-token'));", null
                    )
                }
            }
        }, 500)
    }

    override fun onResume() {
        super.onResume()
        NativeAuthVault.foreground = true
        if (::prefs.isInitialized) prefs.getString("fcm_token", null)?.let { injectToken(it) }
        deliverPendingSession()
    }

    override fun onPause() {
        NativeAuthVault.foreground = false
        super.onPause()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handlePushIntent(intent)
    }

    private fun handlePushIntent(intent: Intent?) {
        val sessionId = intent?.getStringExtra("session_id")
        if (sessionId != null && NotificationWork.validId(sessionId)) {
            pendingSessionId = sessionId
            intent.getStringExtra("delivery_id")?.let { delivery ->
                if (NotificationWork.validId(delivery)) java.util.concurrent.Executors.newSingleThreadExecutor().apply {
                    execute { try { ChatNotifications.ack(applicationContext,delivery,"opened") } catch (_: Exception) {} finally { shutdown() } }
                }
            }
            intent.removeExtra("delivery_id")
            intent.removeExtra("session_id")
            deliverPendingSession()
        }
    }

    private fun deliverPendingSession(attempt: Int = 0) {
        val sessionId = pendingSessionId ?: return
        if (destroyed || attempt >= 30) return
        handler.postDelayed({
            if (!destroyed && pendingSessionId == sessionId) {
                val webView = findWebView(window.decorView)
                if (webView == null) {
                    deliverPendingSession(attempt + 1)
                } else {
                    val value = JSONObject.quote(sessionId)
                    webView.evaluateJavascript(
                        "(function(){window.__PUSH_SESSION_ID=$value;" +
                        "if(typeof window.__openSessionFromPush==='function'){" +
                        "window.__openSessionFromPush($value);window.__PUSH_SESSION_ID=null;return true;}" +
                        "return false;})()"
                    ) { handled ->
                        if (handled == "true" && pendingSessionId == sessionId) pendingSessionId = null
                        else deliverPendingSession(attempt + 1)
                    }
                }
            }
        }, 500)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putString("pending_session_id", pendingSessionId)
        super.onSaveInstanceState(outState)
    }

    override fun onDestroy() {
        destroyed = true
        handler.removeCallbacksAndMessages(null)
        if (::prefs.isInitialized) prefs.unregisterOnSharedPreferenceChangeListener(tokenListener)
        super.onDestroy()
    }

    private fun findWebView(view: android.view.View): WebView? {
        if (view is WebView) return view
        if (view is android.view.ViewGroup) {
            for (i in 0 until view.childCount) findWebView(view.getChildAt(i))?.let { return it }
        }
        return null
    }
}
