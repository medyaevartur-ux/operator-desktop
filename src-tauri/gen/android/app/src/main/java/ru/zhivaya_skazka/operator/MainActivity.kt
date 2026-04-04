package ru.zhivaya_skazka.operator

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import com.google.firebase.messaging.FirebaseMessaging

class MainActivity : TauriActivity() {

    private val handler = Handler(Looper.getMainLooper())
    private var webViewRef: WebView? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        // Получаем FCM токен и инжектим в WebView
        fetchFcmTokenAndInject()

        // Если приложение открыто по тапу на push
        handlePushIntent(intent)
    }

    private fun fetchFcmTokenAndInject() {
        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if (task.isSuccessful) {
                val token = task.result
                android.util.Log.d("FCM", "Got token: $token")

                // Сохраняем в prefs
                val prefs = getSharedPreferences("fcm_prefs", Context.MODE_PRIVATE)
                prefs.edit().putString("fcm_token", token).apply()

                // Инжектим токен в WebView с повторными попытками
                injectTokenToWebView(token, 0)
            } else {
                android.util.Log.e("FCM", "Failed to get token", task.exception)
            }
        }
    }

    private fun injectTokenToWebView(token: String, attempt: Int) {
        if (attempt > 20) {
            android.util.Log.e("FCM", "Failed to inject token after 20 attempts")
            return
        }

        handler.postDelayed({
            val webView = findWebView(window.decorView)
            if (webView != null) {
                webViewRef = webView
                val js = """
                    window.__FCM_TOKEN = '$token';
                    window.__FCM_PLATFORM = 'android';
                    console.log('[native] FCM token injected: ${token.take(20)}...');
                """.trimIndent()
                webView.evaluateJavascript(js, null)
                android.util.Log.d("FCM", "Token injected to WebView (attempt $attempt)")

                // Повторяем инъекцию через 5 секунд на случай если страница перезагрузится
                handler.postDelayed({
                    try {
                        webView.evaluateJavascript(
                            "if(!window.__FCM_TOKEN) { window.__FCM_TOKEN = '$token'; window.__FCM_PLATFORM = 'android'; console.log('[native] FCM token re-injected'); }",
                            null
                        )
                    } catch (e: Exception) {
                        android.util.Log.e("FCM", "Re-inject error: ${e.message}")
                    }
                }, 5000)
            } else {
                android.util.Log.d("FCM", "WebView not ready, retry attempt ${attempt + 1}")
                injectTokenToWebView(token, attempt + 1)
            }
        }, 1000)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handlePushIntent(intent)
    }

    private fun handlePushIntent(intent: Intent?) {
        val sessionId = intent?.getStringExtra("session_id")
        if (!sessionId.isNullOrEmpty()) {
            android.util.Log.d("MainActivity", "Push tap -> session_id: $sessionId")

            handler.postDelayed({
                try {
                    val webView = webViewRef ?: findWebView(window.decorView)
                    webView?.evaluateJavascript(
                        "window.__PUSH_SESSION_ID = '$sessionId'; " +
                        "if(window.__openSessionFromPush) window.__openSessionFromPush('$sessionId');",
                        null
                    )
                } catch (e: Exception) {
                    android.util.Log.e("MainActivity", "JS inject error: ${e.message}")
                }
            }, 2000)

            intent?.removeExtra("session_id")
        }
    }

    private fun findWebView(view: android.view.View): WebView? {
        if (view is WebView) return view
        if (view is android.view.ViewGroup) {
            for (i in 0 until view.childCount) {
                val result = findWebView(view.getChildAt(i))
                if (result != null) return result
            }
        }
        return null
    }
}