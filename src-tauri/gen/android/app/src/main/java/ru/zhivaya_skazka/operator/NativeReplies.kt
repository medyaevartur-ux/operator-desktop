package ru.zhivaya_skazka.operator
import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
object NativeReplies {
    private fun prefs(context: Context) = context.getSharedPreferences("chat_v8_reply_queue",Context.MODE_PRIVATE)
    @Synchronized fun save(context: Context, record: JSONObject) {
        check(prefs(context).edit().putString(record.getString("client_id"),NativeAuthVault.encrypt(record.toString())).commit())
    }
    @Synchronized fun record(context: Context, id: String): JSONObject? {
        val value=prefs(context).getString(id,null) ?: return null
        return JSONObject(NativeAuthVault.decrypt(value))
    }
    @Synchronized fun fail(context: Context, id: String) { record(context,id)?.let { save(context,it.put("failed",true)) } }
    @Synchronized fun failed(context: Context): JSONArray {
        val operator=NativeAuthVault.get(context)?.getJSONObject("operator")?.getString("id") ?: return JSONArray()
        val result=JSONArray()
        for (entry in prefs(context).all) {
            val record=try { record(context,entry.key) } catch (_: Exception) { null }
            if(record?.optString("operator_id")==operator && record.optBoolean("failed")) result.put(record)
        }
        return result
    }
    @Synchronized fun markAllFailed(context: Context,operator: String) {
        for (entry in prefs(context).all) { val item=record(context,entry.key); if(item?.optString("operator_id")==operator)save(context,item.put("failed",true)) }
    }
    @Synchronized fun remove(context: Context,id: String,operator: String) {
        if(record(context,id)?.optString("operator_id")==operator) check(prefs(context).edit().remove(id).commit())
    }
}
