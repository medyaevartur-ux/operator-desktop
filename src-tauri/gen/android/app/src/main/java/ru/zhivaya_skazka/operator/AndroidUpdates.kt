package ru.zhivaya_skazka.operator

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.security.MessageDigest

object AndroidUpdates {
    private val cancelled=java.util.concurrent.atomic.AtomicBoolean(false)
    fun cancel() { cancelled.set(true) }
    private const val BASE = "https://zhivaya-skazka.ru"
    private fun connection(url: String): HttpURLConnection {
        val uri=URI(url)
        require(uri.scheme=="https"&&uri.host=="zhivaya-skazka.ru"&&uri.port in listOf(-1,443)&&uri.userInfo==null)
        return (URL(url).openConnection() as HttpURLConnection).apply { instanceFollowRedirects=false;connectTimeout=15000;readTimeout=20000 }
    }
    fun check(): JSONObject? {
        val request=connection("$BASE/api/updater/android?current_code=${BuildConfig.VERSION_CODE}")
        try {
            if(request.responseCode==204)return null
            check(request.responseCode==200){"update_server_unavailable"}
            val text=request.inputStream.bufferedReader().use { it.readText() }
            require(text.length<=20000)
            val manifest=JSONObject(text)
            require(manifest.getLong("version_code")>BuildConfig.VERSION_CODE)
            require(manifest.getLong("size") in 1..250L*1024*1024)
            require(manifest.getString("sha256").matches(Regex("[a-fA-F0-9]{64}")))
            val uri=URI(manifest.getString("url"))
            require(uri.host=="zhivaya-skazka.ru"&&(uri.path.startsWith("/api/updater/download/")||uri.path.startsWith("/updates/operator-desktop/"))&&uri.path.endsWith(".apk"))
            return manifest
        } finally { request.disconnect() }
    }
    private fun apk(context: Context, code: Long): File {
        require(code in 1..2100000000)
        val directory=File(context.cacheDir,"operator-updates").apply { mkdirs() }
        return File(directory,"operator-$code.apk")
    }
    @Suppress("DEPRECATION")
    private fun verifySignature(context: Context, file: File, code: Long) {
        val flags=if(Build.VERSION.SDK_INT>=28)PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        val candidate=context.packageManager.getPackageArchiveInfo(file.absolutePath,flags) ?: error("invalid_apk")
        val installed=context.packageManager.getPackageInfo(context.packageName,flags)
        require(candidate.packageName==context.packageName){"wrong_package"}
        val version=if(Build.VERSION.SDK_INT>=28)candidate.longVersionCode else candidate.versionCode.toLong()
        require(version==code&&version>BuildConfig.VERSION_CODE){"wrong_version"}
        val a=if(Build.VERSION.SDK_INT>=28)candidate.signingInfo?.apkContentsSigners else candidate.signatures
        val b=if(Build.VERSION.SDK_INT>=28)installed.signingInfo?.apkContentsSigners else installed.signatures
        require(!a.isNullOrEmpty()&&!b.isNullOrEmpty()){"missing_signature"}
        val fingerprints: (Array<out android.content.pm.Signature>) -> Set<String> = {values->values.map { signer->MessageDigest.getInstance("SHA-256").digest(signer.toByteArray()).joinToString(""){"%02x".format(it)} }.toSet()}
        require(fingerprints(a)==fingerprints(b)){"signature_mismatch"}
    }
    @Synchronized
    fun download(context: Context): JSONObject {
        // Fetch metadata again here; JS cannot supply an arbitrary package URL or hash.
        val manifest=check() ?: error("no_update")
        val file=apk(context,manifest.getLong("version_code"))
        val temporary=File(file.parentFile,"operator-${manifest.getLong("version_code")}.partial.apk")
        cancelled.set(false)
        val started=android.os.SystemClock.elapsedRealtime()
        val request=connection(manifest.getString("url"))
        try {
            check(request.responseCode==200){"update_download_failed"}
            val hash=MessageDigest.getInstance("SHA-256");var size=0L
            request.inputStream.use { input->temporary.outputStream().use { output->
                val buffer=ByteArray(65536);while(true){check(!cancelled.get()){"update_cancelled"};check(android.os.SystemClock.elapsedRealtime()-started<300000){"update_timeout"};val count=input.read(buffer);if(count<0)break;size+=count;require(size<=250L*1024*1024);hash.update(buffer,0,count);output.write(buffer,0,count)}
            } }
            require(size==manifest.getLong("size")){"update_size_mismatch"}
            require(hash.digest().joinToString(""){"%02x".format(it)}.equals(manifest.getString("sha256"),true)){"update_hash_mismatch"}
            verifySignature(context,temporary,manifest.getLong("version_code"))
            if(file.exists())check(file.delete())
            check(temporary.renameTo(file)){"update_storage_failed"}
            return manifest
        } finally { request.disconnect();if(temporary.exists())temporary.delete() }
    }
    fun prepareInstall(context: Context, code: Long): Pair<Intent,String> {
        val file=apk(context,code)
        require(file.isFile){"update_not_downloaded"}
        verifySignature(context,file,code)
        if(Build.VERSION.SDK_INT>=26&&!context.packageManager.canRequestPackageInstalls()) {
            return Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:${context.packageName}")) to "permission_required"
        }
        val uri=FileProvider.getUriForFile(context,"${context.packageName}.fileprovider",file)
        return Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION) to "installer_opened"
    }
}
