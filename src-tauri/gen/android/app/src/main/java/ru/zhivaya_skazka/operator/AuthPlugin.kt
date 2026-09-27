package ru.zhivaya_skazka.operator

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject
import java.util.concurrent.Executors

@InvokeArg
class SaveSessionArgs { var data: String = "" }
@InvokeArg
class ReadSessionArgs { var force: Boolean = false }
@InvokeArg
class ChatContextArgs { var sessionId: String? = null }

@InvokeArg
class NotificationArgs { var deliveryId: String = "" }
@InvokeArg
class ReplyAckArgs { var clientId: String = "" }

@InvokeArg
class InstallUpdateArgs { var versionCode: Long = 0 }

@InvokeArg
class SettingsArgs { var kind: String = "notifications" }

@TauriPlugin
class AuthPlugin(private val activity: Activity) : Plugin(activity) {
    companion object {
        private val executor = Executors.newSingleThreadExecutor()
        private val updateExecutor = Executors.newSingleThreadExecutor()
    }
    @Command
    fun saveSession(invoke: Invoke) {
        val args = invoke.parseArgs(SaveSessionArgs::class.java)
        executor.execute {
            try {
                val result = JSObject()
                result.put("session", NativeAuthVault.save(activity.applicationContext, args.data))
                invoke.resolve(result)
            } catch (_: Exception) { invoke.reject("secure_session_unavailable") }
        }
    }
    @Command
    fun getSession(invoke: Invoke) {
        val args = invoke.parseArgs(ReadSessionArgs::class.java)
        executor.execute {
            try {
                val session = NativeAuthVault.get(activity.applicationContext, args.force)
                val result = JSObject()
                result.put("session", if (session == null) JSONObject.NULL else NativeAuthVault.publicSession(session))
                invoke.resolve(result)
            } catch (_: Exception) { invoke.reject("network_unavailable") }
        }
    }
    @Command
    fun clearSession(invoke: Invoke) {
        executor.execute {
            try {
                NativeAuthVault.clear(activity.applicationContext)
                (activity.getSystemService(android.content.Context.NOTIFICATION_SERVICE) as android.app.NotificationManager).cancelAll()
                invoke.resolve(JSObject())
            } catch (_: Exception) { invoke.reject("secure_session_unavailable") }
        }
    }
    @Command
    fun showNotification(invoke: Invoke) {
        val id=invoke.parseArgs(NotificationArgs::class.java).deliveryId
        executor.execute {
            try { val result=JSObject();result.put("shown",ChatNotifications.receive(activity.applicationContext,id));invoke.resolve(result) }
            catch (_: Exception) { invoke.reject("notification_unavailable") }
        }
    }
    @Command
    fun readReplies(invoke: Invoke) {
        executor.execute {
            try { val result=JSObject();result.put("replies",NativeReplies.failed(activity.applicationContext));invoke.resolve(result) }
            catch (_: Exception) { invoke.reject("reply_queue_unavailable") }
        }
    }
    @Command
    fun acknowledgeReply(invoke: Invoke) {
        val id=invoke.parseArgs(ReplyAckArgs::class.java).clientId
        executor.execute {
            try {
                val operator=NativeAuthVault.get(activity.applicationContext)?.getJSONObject("operator")?.getString("id")
                if(operator!=null) NativeReplies.remove(activity.applicationContext,id,operator)
                invoke.resolve(JSObject())
            } catch (_: Exception) { invoke.reject("reply_queue_unavailable") }
        }
    }
    @Command
    fun checkUpdate(invoke: Invoke) {
        updateExecutor.execute { try { val result=JSObject();result.put("update",AndroidUpdates.check()?:JSONObject.NULL);invoke.resolve(result) } catch (_: Exception) { invoke.reject("update_check_failed") } }
    }
    @Command
    fun downloadUpdate(invoke: Invoke) {
        updateExecutor.execute { try { val result=JSObject();result.put("update",AndroidUpdates.download(activity.applicationContext));invoke.resolve(result) } catch (_: Exception) { invoke.reject("update_download_or_verification_failed") } }
    }
    @Command
    fun cancelUpdate(invoke: Invoke) { AndroidUpdates.cancel();invoke.resolve(JSObject()) }
    @Command
    fun installUpdate(invoke: Invoke) {
        val code=invoke.parseArgs(InstallUpdateArgs::class.java).versionCode
        updateExecutor.execute {
            try {
                val action=AndroidUpdates.prepareInstall(activity.applicationContext,code)
                activity.runOnUiThread { try { activity.startActivity(action.first);val result=JSObject();result.put("status",action.second);invoke.resolve(result) } catch (_: Exception) { invoke.reject("update_install_failed") } }
            } catch (_: Exception) { invoke.reject("update_verification_failed") }
        }
    }
    @Command
    fun deviceDiagnostics(invoke: Invoke) {
        try { invoke.resolve(JSObject(ChatNotifications.diagnostics(activity.applicationContext).toString())) }
        catch (_: Exception) { invoke.reject("diagnostics_unavailable") }
    }
    /** Открыть системные настройки уведомлений приложения или список исключений экономии батареи. */
    @Command
    fun openSystemSettings(invoke: Invoke) {
        val kind = invoke.parseArgs(SettingsArgs::class.java).kind
        activity.runOnUiThread {
            try {
                val intent = if (kind == "battery") android.content.Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                    else android.content.Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, activity.packageName)
                activity.startActivity(intent)
                invoke.resolve(JSObject())
            } catch (_: Exception) { invoke.reject("settings_unavailable") }
        }
    }
    @Command
    fun setChatContext(invoke: Invoke) {
        val id = invoke.parseArgs(ChatContextArgs::class.java).sessionId
        NativeAuthVault.activeSessionId = id?.takeIf { it.matches(Regex("[a-fA-F0-9-]{36}")) }
        invoke.resolve(JSObject())
    }
}
