package ru.zhivaya_skazka.operator

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

object NativeAuthVault {
    private val lock = Any()
    private val alias = if (BuildConfig.DEBUG) "zs-chat-session-v8-debug" else "zs-chat-session-v8"
    @Volatile var foreground = false
    @Volatile var activeSessionId: String? = null

    private fun preferences(context: Context) = context.getSharedPreferences(alias, Context.MODE_PRIVATE)
    @Synchronized
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).build())
        }.generateKey()
    }
    fun encrypt(text: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        return Base64.encodeToString(cipher.iv + cipher.doFinal(text.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
    }
    fun decrypt(text: String): String {
        val raw = Base64.decode(text, Base64.NO_WRAP)
        require(raw.size > 28)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw.copyOfRange(0, 12)))
        return String(cipher.doFinal(raw.copyOfRange(12, raw.size)), Charsets.UTF_8)
    }
    private fun validBase(value: String): Boolean {
        val uri = try { URI(value) } catch (_: Exception) { return false }
        if (uri.userInfo != null || uri.query != null || uri.fragment != null || uri.path !in listOf("", "/")) return false
        return (uri.scheme == "https" && uri.host == "zhivaya-skazka.ru" && uri.port in listOf(-1,443)) ||
            (BuildConfig.DEBUG && uri.scheme == "http" && uri.host in listOf("127.0.0.1","localhost"))
    }
    private fun read(context: Context): JSONObject? {
        val encrypted = preferences(context).getString("session", null) ?: return null
        return JSONObject(decrypt(encrypted))
    }
    private fun persist(context: Context, session: JSONObject) {
        require(validBase(session.getString("api_base")))
        require(session.getString("refresh_token").length in 32..512)
        require(session.getString("installation_id").length == 36)
        require(session.toString().length <= 16000)
        check(preferences(context).edit().putString("session", encrypt(session.toString())).commit())
    }
    fun publicSession(session: JSONObject): JSONObject = JSONObject().apply {
        for (field in listOf("api_base","token","installation_id","operator","expires_at")) put(field, session.get(field))
    }
    fun save(context: Context, data: String): JSONObject = synchronized(lock) {
        val session = JSONObject(data)
        persist(context, session)
        publicSession(session)
    }
    private fun http(base: String, path: String, method: String, body: JSONObject?, token: String? = null): Pair<Int, JSONObject> {
        require(validBase(base) && path.startsWith("/api/") && !path.contains(".."))
        val connection = URL(base.trimEnd('/') + path).openConnection() as HttpURLConnection
        connection.instanceFollowRedirects = false
        connection.connectTimeout = 8000
        connection.readTimeout = 8000
        connection.requestMethod = method
        connection.setRequestProperty("Accept", "application/json")
        if (token != null) connection.setRequestProperty("Authorization", "Bearer $token")
        try {
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: "{}"
            return code to try { JSONObject(text) } catch (_: Exception) { JSONObject() }
        } finally { connection.disconnect() }
    }
    fun get(context: Context, force: Boolean = false): JSONObject? = synchronized(lock) {
        val session = read(context) ?: return@synchronized null
        if (!force && session.optLong("expires_at") > System.currentTimeMillis() + 60000) return@synchronized session
        val response = try {
            http(session.getString("api_base"), "/api/chat-v8/auth/refresh", "POST", JSONObject()
                .put("refresh_token", session.getString("refresh_token")).put("installation_id", session.getString("installation_id")))
        } catch (error: Exception) { if (!force) return@synchronized session else throw error }
        if (response.first == 401) {
            preferences(context).edit().remove("session").commit()
            return@synchronized null
        }
        check(response.first in 200..299) { "network_unavailable" }
        val pair = response.second
        session.put("token", pair.getString("token")).put("refresh_token", pair.getString("refresh_token"))
            .put("operator", pair.getJSONObject("operator"))
            .put("expires_at", System.currentTimeMillis() + pair.optLong("expires_in", 1200).coerceAtMost(3600) * 1000)
        persist(context, session)
        session
    }
    fun clear(context: Context) {
        val old = synchronized(lock) { val old = read(context); check(preferences(context).edit().remove("session").commit()); activeSessionId = null; old }
        old?.getJSONObject("operator")?.optString("id")?.let { NativeReplies.markAllFailed(context,it) }
        androidx.work.WorkManager.getInstance(context).cancelAllWorkByTag("chat-v8-notifications")
        if (old != null) try {
            http(old.getString("api_base"), "/api/chat-v8/auth/logout", "POST", JSONObject().put("refresh_token", old.getString("refresh_token")))
        } catch (_: Exception) { /* Local credentials are already removed. */ }
    }
    fun request(context: Context, path: String, method: String, body: JSONObject? = null, expectedOperator: String? = null): Pair<Int, JSONObject> {
        var session = get(context) ?: return 401 to JSONObject()
        if (expectedOperator != null && session.getJSONObject("operator").optString("id") != expectedOperator) return 401 to JSONObject()
        var result = http(session.getString("api_base"), path, method, body, session.getString("token"))
        if (result.first == 401) {
            session = get(context, true) ?: return 401 to JSONObject()
            if (expectedOperator != null && session.getJSONObject("operator").optString("id") != expectedOperator) return 401 to JSONObject()
            result = http(session.getString("api_base"), path, method, body, session.getString("token"))
        }
        return result
    }
}
