package com.vipgece.admin;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.Base64;

import com.getcapacitor.JSObject;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.SignatureException;
import java.security.cert.X509Certificate;
import java.security.spec.X509EncodedKeySpec;
import java.util.Locale;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

public final class VipGeceUpdateEngine {
    public static final String DEFAULT_MANIFEST_URL = "https://vip-gece.site/api/mobile/admin/update";
    public static final String PREFS_NAME = "vip_gece_update_state";

    private static final String EXPECTED_PACKAGE = "com.vipgece.admin";
    private static final long MAX_APK_BYTES = 100L * 1024L * 1024L;
    private static final long PERIODIC_INTERVAL_MS = 6L * 60L * 60L * 1000L;
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();

    private VipGeceUpdateEngine() {}

    public interface Listener {
        void onResult(JSObject result);
        void onError(String message);
    }

    public static void checkAndInstall(Context source, String manifestUrl, boolean foreground, Listener listener) {
        Context context = source.getApplicationContext();
        EXECUTOR.execute(() -> {
            try {
                SharedPreferences prefs = prefs(context);
                String activeState = prefs.getString("state", "idle");
                if ("installed_pending_health".equals(activeState) || "rollback_installing".equals(activeState)) {
                    resolve(listener, statusResult(context, false));
                    return;
                }

                writeStatus(context, "checking", "Guvenli guncelleme manifesti kontrol ediliyor.");
                JSONObject manifest = fetchJson(requireTrustedUrl(manifestUrl));
                verifyManifestSignature(context, manifest);

                long currentCode = installedVersionCode(context);
                long candidateCode = manifest.getLong("version_code");
                if (candidateCode <= currentCode) {
                    writeStatus(context, "up_to_date", "Uygulama guncel.");
                    JSObject result = statusResult(context, false);
                    result.put("current_version_code", currentCode);
                    result.put("available_version_code", candidateCode);
                    resolve(listener, result);
                    return;
                }

                JSONObject rollback = manifest.getJSONObject("rollback");
                long rollbackCode = rollback.getLong("version_code");
                if (rollbackCode <= candidateCode) {
                    throw new SecurityException("Rollback paketi aday surumden yuksek bir surum kodu tasimiyor.");
                }

                String expectedCertificate = normalizeDigest(manifest.getString("release_certificate_sha256"));
                String currentCertificate = signingDigest(context, null);
                if (!expectedCertificate.equals(currentCertificate)) {
                    throw new SecurityException("Kurulu uygulamanin release sertifikasi manifest ile eslesmiyor.");
                }

                File updateDir = new File(context.getFilesDir(), "verified-updates");
                if (!updateDir.exists() && !updateDir.mkdirs()) {
                    throw new IllegalStateException("Guncelleme staging klasoru olusturulamadi.");
                }

                writeStatus(context, "downloading_rollback", "Geri donus paketi indiriliyor.");
                File rollbackApk = download(
                        resolveTrustedUrl(manifestUrl, rollback.getString("apk_url")),
                        new File(updateDir, "rollback-" + rollbackCode + ".apk"),
                        rollback.getString("sha256"),
                        rollback.optLong("size_bytes", 0L)
                );
                verifyApk(context, rollbackApk, rollbackCode, expectedCertificate);

                writeStatus(context, "downloading_candidate", "Yeni surum indiriliyor.");
                File candidateApk = download(
                        resolveTrustedUrl(manifestUrl, manifest.getString("apk_url")),
                        new File(updateDir, "candidate-" + candidateCode + ".apk"),
                        manifest.getString("sha256"),
                        manifest.optLong("size_bytes", 0L)
                );
                verifyApk(context, candidateApk, candidateCode, expectedCertificate);

                prefs.edit()
                        .putLong("candidate_version", candidateCode)
                        .putString("candidate_path", candidateApk.getAbsolutePath())
                        .putLong("rollback_version", rollbackCode)
                        .putString("rollback_path", rollbackApk.getAbsolutePath())
                        .putString("health_url", resolveTrustedUrl(manifestUrl, manifest.optString("health_url", "/api/health")).toString())
                        .putString("manifest_url", requireTrustedUrl(manifestUrl).toString())
                        .putBoolean("ui_healthy", false)
                        .apply();

                if (!canInstallPackages(context)) {
                    writeStatus(context, "install_permission_required", "Android bilinmeyen uygulama kurulum izni bekleniyor.");
                    if (foreground) openInstallPermission(context);
                    JSObject result = statusResult(context, true);
                    result.put("permission_required", true);
                    resolve(listener, result);
                    return;
                }

                writeStatus(context, "installing_candidate", "Dogrulanan yeni surum kuruluyor.");
                installApk(context, candidateApk, "candidate", foreground);
                JSObject result = statusResult(context, true);
                result.put("install_started", true);
                result.put("available_version_code", candidateCode);
                resolve(listener, result);
            } catch (Exception error) {
                writeStatus(context, "update_failed_old_version_retained", safeMessage(error));
                reject(listener, safeMessage(error));
            }
        });
    }

    public static void markUiHealthy(Context source) {
        Context context = source.getApplicationContext();
        SharedPreferences prefs = prefs(context);
        long current = installedVersionCode(context);
        long candidate = prefs.getLong("candidate_version", -1L);
        if (candidate != current) return;

        EXECUTOR.execute(() -> {
            try {
                URL healthUrl = requireTrustedUrl(prefs.getString("health_url", "https://vip-gece.site/api/health"));
                JSONObject health = fetchJson(healthUrl);
                if (!"ok".equalsIgnoreCase(health.optString("status"))) {
                    throw new IllegalStateException("Sunucu saglik yaniti gecersiz.");
                }
                prefs.edit().putBoolean("ui_healthy", true).putLong("healthy_version", current).apply();
                writeStatus(context, "healthy", "Yeni surum uygulama ve API saglik testini gecti.");
                cancelHealthTimeout(context);
                cleanupCandidate(context);
            } catch (Exception error) {
                writeStatus(context, "health_waiting_network", safeMessage(error));
                scheduleHealthTimeout(context, 10L * 60L * 1000L);
            }
        });
    }

    public static void handleHealthTimeout(Context source) {
        Context context = source.getApplicationContext();
        EXECUTOR.execute(() -> {
            SharedPreferences prefs = prefs(context);
            long current = installedVersionCode(context);
            long candidate = prefs.getLong("candidate_version", -1L);
            if (current != candidate || prefs.getBoolean("ui_healthy", false)) return;

            try {
                JSONObject health = fetchJson(requireTrustedUrl(prefs.getString("health_url", "https://vip-gece.site/api/health")));
                if (!"ok".equalsIgnoreCase(health.optString("status"))) {
                    throw new IllegalStateException("Sunucu saglik kontrolu gecersiz.");
                }

                File rollback = new File(prefs.getString("rollback_path", ""));
                if (!rollback.isFile()) throw new IllegalStateException("Dogrulanmis rollback paketi bulunamadi.");
                if (!canInstallPackages(context)) {
                    writeStatus(context, "rollback_permission_required", "Saglik testi basarisiz; rollback kurulum izni bekleniyor.");
                    return;
                }

                writeStatus(context, "rollback_installing", "Yeni surum saglik testini gecemedi; onceki surume donuluyor.");
                installApk(context, rollback, "rollback", false);
            } catch (Exception error) {
                writeStatus(context, "health_waiting_network", safeMessage(error));
                scheduleHealthTimeout(context, 10L * 60L * 1000L);
            }
        });
    }

    public static void schedulePeriodicCheck(Context context) {
        Constraints network = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
                VipGeceUpdateWorker.class,
                PERIODIC_INTERVAL_MS,
                TimeUnit.MILLISECONDS
        ).setConstraints(network).build();
        WorkManager.getInstance(context.getApplicationContext()).enqueueUniquePeriodicWork(
                "vip-gece-admin-periodic-update",
                ExistingPeriodicWorkPolicy.UPDATE,
                request
        );
    }

    public static void enqueueBackgroundCheck(Context context, String manifestUrl) {
        Constraints network = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();
        Data input = new Data.Builder()
                .putString(VipGeceUpdateWorker.INPUT_MANIFEST_URL, manifestUrl)
                .build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(VipGeceUpdateWorker.class)
                .setConstraints(network)
                .setInputData(input)
                .build();
        WorkManager.getInstance(context.getApplicationContext()).enqueueUniqueWork(
                "vip-gece-admin-immediate-update",
                ExistingWorkPolicy.REPLACE,
                request
        );
    }

    public static void scheduleHealthTimeout(Context context, long delayMs) {
        AlarmManager alarm = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarm == null) return;
        alarm.setAndAllowWhileIdle(
                AlarmManager.ELAPSED_REALTIME_WAKEUP,
                SystemClock.elapsedRealtime() + Math.max(30_000L, delayMs),
                receiverPendingIntent(context, VipGeceUpdateReceiver.ACTION_HEALTH_TIMEOUT, 7102)
        );
    }

    public static JSObject readStatus(Context context) {
        return statusResult(context, false);
    }

    public static void writeStatus(Context context, String state, String message) {
        prefs(context).edit()
                .putString("state", state)
                .putString("message", message == null ? "" : message)
                .putLong("updated_at_ms", System.currentTimeMillis())
                .apply();
    }

    private static void installApk(Context context, File apk, String role, boolean foreground) throws Exception {
        PackageInstaller installer = context.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(EXPECTED_PACKAGE);
        params.setSize(apk.length());
        params.setInstallLocation(PackageInfo.INSTALL_LOCATION_INTERNAL_ONLY);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
        }

        int sessionId = installer.createSession(params);
        try (PackageInstaller.Session session = installer.openSession(sessionId);
             FileInputStream input = new FileInputStream(apk);
             java.io.OutputStream output = session.openWrite("base.apk", 0, apk.length())) {
            byte[] buffer = new byte[128 * 1024];
            int read;
            while ((read = input.read(buffer)) >= 0) output.write(buffer, 0, read);
            session.fsync(output);

            Intent statusIntent = new Intent(context, VipGeceUpdateReceiver.class)
                    .setAction(VipGeceUpdateReceiver.ACTION_INSTALL_STATUS)
                    .putExtra("update_role", role)
                    .putExtra("update_foreground", foreground);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags |= PendingIntent.FLAG_MUTABLE;
            PendingIntent pending = PendingIntent.getBroadcast(
                    context,
                    "rollback".equals(role) ? 7202 : 7201,
                    statusIntent,
                    flags
            );
            session.commit(pending.getIntentSender());
        } catch (Exception error) {
            installer.abandonSession(sessionId);
            throw error;
        }
    }

    private static File download(URL url, File destination, String expectedHash, long expectedSize) throws Exception {
        File temp = new File(destination.getParentFile(), destination.getName() + ".part");
        HttpURLConnection connection = open(url);
        long contentLength = connection.getContentLengthLong();
        if (contentLength > MAX_APK_BYTES) throw new SecurityException("APK boyutu izin verilen siniri asiyor.");

        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long total = 0L;
        try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(temp, false)) {
            byte[] buffer = new byte[128 * 1024];
            int read;
            while ((read = input.read(buffer)) >= 0) {
                total += read;
                if (total > MAX_APK_BYTES) throw new SecurityException("APK boyutu izin verilen siniri asiyor.");
                digest.update(buffer, 0, read);
                output.write(buffer, 0, read);
            }
            output.getFD().sync();
        } finally {
            connection.disconnect();
        }

        if (expectedSize > 0 && total != expectedSize) {
            temp.delete();
            throw new SecurityException("APK boyutu manifest ile eslesmiyor.");
        }
        String actualHash = hex(digest.digest());
        if (!normalizeDigest(expectedHash).equals(actualHash)) {
            temp.delete();
            throw new SecurityException("APK SHA-256 dogrulamasi basarisiz.");
        }
        if (destination.exists() && !destination.delete()) throw new IllegalStateException("Eski staging paketi silinemedi.");
        if (!temp.renameTo(destination)) throw new IllegalStateException("APK atomik staging alanina tasinamadi.");
        return destination;
    }

    private static void verifyApk(Context context, File apk, long expectedVersion, String expectedCertificate) throws Exception {
        PackageManager manager = context.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? PackageManager.GET_SIGNING_CERTIFICATES
                : PackageManager.GET_SIGNATURES;
        PackageInfo info = manager.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
        if (info == null || !EXPECTED_PACKAGE.equals(info.packageName)) {
            throw new SecurityException("APK paket kimligi gecersiz.");
        }
        long version = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
        if (version != expectedVersion) throw new SecurityException("APK surum kodu manifest ile eslesmiyor.");
        String certificate = signingDigest(context, info);
        if (!expectedCertificate.equals(certificate)) throw new SecurityException("APK release sertifikasi gecersiz.");
    }

    private static String signingDigest(Context context, PackageInfo supplied) throws Exception {
        PackageInfo info = supplied;
        if (info == null) {
            int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? PackageManager.GET_SIGNING_CERTIFICATES
                    : PackageManager.GET_SIGNATURES;
            info = context.getPackageManager().getPackageInfo(context.getPackageName(), flags);
        }
        Signature[] signatures;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            signatures = info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners();
        } else {
            signatures = info.signatures;
        }
        if (signatures == null || signatures.length != 1) throw new SecurityException("Tekil release sertifikasi okunamadi.");
        return hex(MessageDigest.getInstance("SHA-256").digest(signatures[0].toByteArray()));
    }

    private static void verifyManifestSignature(Context context, JSONObject manifest) throws Exception {
        if (manifest.optInt("manifest_version", 0) != 1) throw new SecurityException("Manifest surumu desteklenmiyor.");
        if (!"vip-gece-admin".equals(manifest.optString("app"))) throw new SecurityException("Manifest uygulama kimligi gecersiz.");
        if (!EXPECTED_PACKAGE.equals(manifest.optString("package_name"))) throw new SecurityException("Manifest paket kimligi gecersiz.");

        String signatureText = manifest.optString("signature");
        if (signatureText.isEmpty()) throw new SignatureException("Manifest imzasi eksik.");
        java.security.Signature verifier = java.security.Signature.getInstance("SHA256withRSA");
        verifier.initVerify(loadPublicKey(context));
        verifier.update(canonicalManifest(manifest).getBytes(StandardCharsets.UTF_8));
        if (!verifier.verify(Base64.decode(signatureText, Base64.DEFAULT))) {
            throw new SignatureException("Manifest imzasi gecersiz.");
        }
    }

    private static String canonicalManifest(JSONObject manifest) throws Exception {
        JSONObject rollback = manifest.getJSONObject("rollback");
        return String.join("\n",
                String.valueOf(manifest.getInt("manifest_version")),
                manifest.getString("app"),
                manifest.getString("package_name"),
                String.valueOf(manifest.getLong("version_code")),
                manifest.getString("version_name"),
                manifest.getString("apk_url"),
                normalizeDigest(manifest.getString("sha256")),
                String.valueOf(manifest.getLong("size_bytes")),
                String.valueOf(manifest.optBoolean("mandatory", false)),
                normalizeDigest(manifest.getString("release_certificate_sha256")),
                manifest.optString("health_url", "/api/health"),
                String.valueOf(rollback.getLong("version_code")),
                rollback.getString("apk_url"),
                normalizeDigest(rollback.getString("sha256")),
                String.valueOf(rollback.getLong("size_bytes"))
        );
    }

    private static PublicKey loadPublicKey(Context context) throws Exception {
        String pem;
        try (InputStream input = context.getResources().openRawResource(R.raw.vip_gece_update_public_key)) {
            pem = new String(readAll(input, 16 * 1024), StandardCharsets.US_ASCII);
        }
        String body = pem.replace("-----BEGIN PUBLIC KEY-----", "")
                .replace("-----END PUBLIC KEY-----", "")
                .replaceAll("\\s", "");
        return KeyFactory.getInstance("RSA").generatePublic(
                new X509EncodedKeySpec(Base64.decode(body, Base64.DEFAULT))
        );
    }

    private static JSONObject fetchJson(URL url) throws Exception {
        HttpURLConnection connection = open(url);
        try (InputStream input = connection.getInputStream()) {
            return new JSONObject(new String(readAll(input, 256 * 1024), StandardCharsets.UTF_8));
        } finally {
            connection.disconnect();
        }
    }

    private static HttpURLConnection open(URL url) throws Exception {
        requireTrustedUrl(url.toString());
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(30_000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Accept", "application/json, application/vnd.android.package-archive, */*");
        connection.setRequestProperty("User-Agent", "VIP-Gece-Admin-Updater/1.2");
        int status = connection.getResponseCode();
        if (status < 200 || status >= 300) {
            connection.disconnect();
            throw new IllegalStateException("Guncelleme sunucusu HTTP " + status + " dondurdu.");
        }
        return connection;
    }

    private static URL requireTrustedUrl(String raw) throws Exception {
        URL url = new URL(raw);
        String host = url.getHost().toLowerCase(Locale.ROOT);
        if (!"https".equalsIgnoreCase(url.getProtocol()) || !("vip-gece.site".equals(host) || "www.vip-gece.site".equals(host))) {
            throw new SecurityException("Guncelleme URL adresi guvenilir VIP GECE origininde degil.");
        }
        return url;
    }

    private static URL resolveTrustedUrl(String manifestUrl, String raw) throws Exception {
        URL resolved = new URL(requireTrustedUrl(manifestUrl), raw);
        return requireTrustedUrl(resolved.toString());
    }

    private static byte[] readAll(InputStream input, int maxBytes) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int read;
        int total = 0;
        while ((read = input.read(buffer)) >= 0) {
            total += read;
            if (total > maxBytes) throw new SecurityException("Yaniti izin verilen boyutu asiyor.");
            output.write(buffer, 0, read);
        }
        return output.toByteArray();
    }

    private static long installedVersionCode(Context context) {
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
        } catch (Exception ignored) {
            return -1L;
        }
    }

    private static boolean canInstallPackages(Context context) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.getPackageManager().canRequestPackageInstalls();
    }

    private static void openInstallPermission(Context context) {
        Intent intent = new Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + context.getPackageName())
        );
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
    }

    private static PendingIntent receiverPendingIntent(Context context, String action, int requestCode) {
        Intent intent = new Intent(context, VipGeceUpdateReceiver.class).setAction(action);
        return PendingIntent.getBroadcast(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private static void cancelHealthTimeout(Context context) {
        AlarmManager alarm = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarm != null) alarm.cancel(receiverPendingIntent(context, VipGeceUpdateReceiver.ACTION_HEALTH_TIMEOUT, 7102));
    }

    private static void cleanupCandidate(Context context) {
        SharedPreferences prefs = prefs(context);
        String candidatePath = prefs.getString("candidate_path", "");
        if (!candidatePath.isEmpty()) new File(candidatePath).delete();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private static JSObject statusResult(Context context, boolean started) {
        SharedPreferences prefs = prefs(context);
        JSObject result = new JSObject();
        result.put("ok", true);
        result.put("state", prefs.getString("state", "idle"));
        result.put("message", prefs.getString("message", ""));
        result.put("updated_at_ms", prefs.getLong("updated_at_ms", 0L));
        result.put("current_version_code", installedVersionCode(context));
        result.put("started", started);
        return result;
    }

    private static void resolve(Listener listener, JSObject result) {
        if (listener != null) listener.onResult(result);
    }

    private static void reject(Listener listener, String message) {
        if (listener != null) listener.onError(message);
    }

    private static String normalizeDigest(String value) {
        return String.valueOf(value == null ? "" : value).replace(":", "").trim().toLowerCase(Locale.ROOT);
    }

    private static String hex(byte[] bytes) {
        StringBuilder builder = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) builder.append(String.format(Locale.ROOT, "%02x", value & 0xff));
        return builder.toString();
    }

    private static String safeMessage(Exception error) {
        String message = error.getMessage();
        return message == null || message.trim().isEmpty() ? error.getClass().getSimpleName() : message;
    }
}
