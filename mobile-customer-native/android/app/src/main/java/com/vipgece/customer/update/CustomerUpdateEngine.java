package com.vipgece.customer.update;

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
import android.provider.Settings;
import android.util.Base64;

import com.vipgece.customer.R;
import com.vipgece.customer.config.EndpointResolver;
import com.vipgece.customer.net.HttpJson;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.spec.X509EncodedKeySpec;
import java.util.Locale;

public final class CustomerUpdateEngine {
    private static final String EXPECTED_APP = "vip-gece-customer";
    private static final String EXPECTED_PACKAGE = "com.vipgece.customer";
    private static final long MAX_APK_BYTES = 100L * 1024L * 1024L;
    private static final String PREFS = "vip_gece_customer_update";
    public static final String ACTION_INSTALL_RESULT =
            "com.vipgece.customer.action.UPDATE_INSTALL_RESULT";
    private static final String EXTRA_FOREGROUND_REQUEST = "foreground_request";
    private static final String EXTRA_VERSION_CODE = "version_code";

    private CustomerUpdateEngine() {}

    public static synchronized Candidate checkAndDownload(Context source) throws Exception {
        Context context = source.getApplicationContext();
        EndpointResolver.Resolution resolution = EndpointResolver.refreshAndResolve(context, true);
        HttpJson.Response response;
        try {
            response = HttpJson.request(
                    new URL(resolution.origin + resolution.updateManifestPath),
                    "GET",
                    "",
                    null
            );
            if (response.status >= 500) {
                resolution = EndpointResolver.refreshAndResolve(context, true, resolution.origin);
                response = HttpJson.request(
                        new URL(resolution.origin + resolution.updateManifestPath),
                        "GET",
                        "",
                        null
                );
            }
        } catch (Exception firstError) {
            resolution = EndpointResolver.refreshAndResolve(context, true, resolution.origin);
            response = HttpJson.request(
                    new URL(resolution.origin + resolution.updateManifestPath),
                    "GET",
                    "",
                    null
            );
        }
        if (response.status == 404) {
            writeStatus(context, "not_published", "Henüz yayınlanmış native APK güncellemesi yok.");
            return null;
        }
        if (!response.successful()) {
            throw new IllegalStateException("Güncelleme servisi HTTP " + response.status + " döndürdü.");
        }

        JSONObject manifest = response.json;
        verifyManifest(context, manifest);
        long candidateCode = manifest.getLong("version_code");
        long currentCode = installedVersionCode(context);
        if (candidateCode <= currentCode) {
            clearPendingCandidate(context, candidateCode);
            writeStatus(context, "up_to_date", "Uygulama güncel.");
            return null;
        }

        String expectedHash = normalizeDigest(manifest.getString("sha256"));
        long expectedSize = manifest.getLong("size_bytes");
        String expectedCertificate = normalizeDigest(
                manifest.getString("release_certificate_sha256")
        );
        if (
                expectedHash.length() != 64 ||
                expectedCertificate.length() != 64 ||
                expectedSize < 1 ||
                expectedSize > MAX_APK_BYTES
        ) {
            throw new SecurityException("Güncelleme manifest bütünlük alanları geçersiz.");
        }
        Candidate existing = pendingCandidate(context);
        if (
                existing != null &&
                existing.versionCode == candidateCode &&
                expectedHash.equals(existing.sha256) &&
                expectedSize == existing.sizeBytes &&
                expectedCertificate.equals(existing.releaseCertificate)
        ) {
            writeStatus(context, "ready_to_install", "Güncelleme doğrulandı ve kuruluma hazır.");
            return existing;
        }

        URL apkUrl = trustedPackageUrl(resolution.origin, manifest.getString("apk_url"));
        File directory = new File(context.getFilesDir(), "verified-updates");
        if (!directory.exists() && !directory.mkdirs()) {
            throw new IllegalStateException("Güvenli güncelleme alanı oluşturulamadı.");
        }
        File apk = new File(directory, "customer-" + candidateCode + ".apk");
        writeStatus(context, "downloading", "İmzalı APK indiriliyor.");
        download(
                apkUrl,
                apk,
                expectedHash,
                expectedSize
        );
        verifyApk(
                context,
                apk,
                candidateCode,
                expectedCertificate
        );

        Candidate candidate = new Candidate(
                candidateCode,
                manifest.optString("version_name", ""),
                manifest.optString("release_notes", ""),
                manifest.optBoolean("mandatory", false),
                apk,
                expectedHash,
                expectedSize,
                expectedCertificate
        );
        savePendingCandidate(context, candidate);
        writeStatus(context, "ready_to_install", "Güncelleme doğrulandı ve kuruluma hazır.");
        return candidate;
    }

    public static synchronized void requestInstall(Context source, Candidate candidate)
            throws Exception {
        Context context = source.getApplicationContext();
        Candidate verified = verifyCandidate(context, candidate);
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (
                prefs.getLong("state_version_code", 0) == verified.versionCode &&
                "install_committed".equals(prefs.getString("state", ""))
        ) {
            return;
        }
        if (!context.getPackageManager().canRequestPackageInstalls()) {
            Intent permission = new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + context.getPackageName())
            );
            permission.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(permission);
            writeStatus(context, "install_permission_required", "Android kurulum onayı bekleniyor.");
            return;
        }

        commitPackageInstallerSession(context, verified, true);
    }

    public static synchronized void requestBackgroundInstall(
            Context source,
            Candidate candidate
    ) throws Exception {
        Context context = source.getApplicationContext();
        Candidate verified = verifyCandidate(context, candidate);
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String state = prefs.getString("state", "");
        long stateVersion = prefs.getLong("state_version_code", 0);
        if (
                stateVersion == verified.versionCode &&
                (
                        "install_committed".equals(state) ||
                        "user_action_required".equals(state)
                )
        ) {
            return;
        }
        if (!context.getPackageManager().canRequestPackageInstalls()) {
            writeStatus(
                    context,
                    "install_permission_required",
                    "Güncelleme indirildi; Android kurulum izni bekleniyor.",
                    verified.versionCode
            );
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            writeStatus(
                    context,
                    "user_action_required",
                    "Güncelleme indirildi; uygulama açıldığında sistem kurulumu tamamlanacak.",
                    verified.versionCode
            );
            return;
        }
        commitPackageInstallerSession(context, verified, false);
    }

    public static synchronized Candidate pendingCandidate(Context source) {
        Context context = source.getApplicationContext();
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        long versionCode = prefs.getLong("pending_version_code", 0);
        if (versionCode < 1) return null;
        try {
            if (installedVersionCode(context) >= versionCode) {
                clearPendingCandidate(context, versionCode);
                return null;
            }
            String fileName = prefs.getString("pending_file_name", "");
            if (!("customer-" + versionCode + ".apk").equals(fileName)) {
                throw new SecurityException("Bekleyen güncelleme yolu geçersiz.");
            }
            File apk = new File(new File(context.getFilesDir(), "verified-updates"), fileName);
            Candidate candidate = new Candidate(
                    versionCode,
                    prefs.getString("pending_version_name", ""),
                    prefs.getString("pending_release_notes", ""),
                    prefs.getBoolean("pending_mandatory", false),
                    apk,
                    prefs.getString("pending_sha256", ""),
                    prefs.getLong("pending_size_bytes", 0),
                    prefs.getString("pending_release_certificate", "")
            );
            return verifyCandidate(context, candidate);
        } catch (Exception error) {
            clearPendingCandidate(context, versionCode);
            writeStatus(context, "pending_update_invalid", "Bekleyen güncelleme güvenlik doğrulamasını geçemedi.");
            return null;
        }
    }

    public static synchronized void handleInstallResult(Context source, Intent intent) {
        Context context = source.getApplicationContext();
        if (intent == null || !ACTION_INSTALL_RESULT.equals(intent.getAction())) return;
        int status = intent.getIntExtra(
                PackageInstaller.EXTRA_STATUS,
                PackageInstaller.STATUS_FAILURE
        );
        long versionCode = intent.getLongExtra(EXTRA_VERSION_CODE, 0);
        boolean foregroundRequest = intent.getBooleanExtra(EXTRA_FOREGROUND_REQUEST, false);

        if (status == PackageInstaller.STATUS_SUCCESS) {
            clearPendingCandidate(context, versionCode);
            writeStatus(context, "installed", "Güncelleme başarıyla kuruldu.", versionCode);
            return;
        }
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            writeStatus(
                    context,
                    "user_action_required",
                    "Android sistem kurulum onayı bekleniyor.",
                    versionCode
            );
            if (!foregroundRequest) return;
            Intent confirmation = pendingUserAction(intent);
            if (confirmation == null) return;
            confirmation.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                context.startActivity(confirmation);
            } catch (Exception ignored) {
                writeStatus(
                        context,
                        "user_action_required",
                        "Güncellemeyi tamamlamak için uygulamayı yeniden açın.",
                        versionCode
                );
            }
            return;
        }
        writeStatus(
                context,
                "install_failed",
                "Android güncellemeyi kuramadı; güvenli paket yeniden denenecek.",
                versionCode
        );
    }

    public static String status(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString("state", "idle");
    }

    private static void commitPackageInstallerSession(
            Context context,
            Candidate candidate,
            boolean foregroundRequest
    ) throws Exception {
        PackageInstaller installer = context.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(
                PackageInstaller.SessionParams.MODE_FULL_INSTALL
        );
        params.setAppPackageName(EXPECTED_PACKAGE);
        params.setSize(candidate.sizeBytes);
        params.setInstallReason(PackageManager.INSTALL_REASON_USER);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            params.setRequireUserAction(
                    PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED
            );
        }

        int sessionId = installer.createSession(params);
        boolean commitRequested = false;
        try (PackageInstaller.Session session = installer.openSession(sessionId)) {
            try (InputStream input = new FileInputStream(candidate.apk);
                 OutputStream output = session.openWrite("base.apk", 0, candidate.sizeBytes)) {
                byte[] buffer = new byte[128 * 1024];
                int read;
                while ((read = input.read(buffer)) >= 0) {
                    output.write(buffer, 0, read);
                }
                session.fsync(output);
            }

            Intent result = new Intent(context, UpdateInstallReceiver.class)
                    .setAction(ACTION_INSTALL_RESULT)
                    .putExtra(EXTRA_FOREGROUND_REQUEST, foregroundRequest)
                    .putExtra(EXTRA_VERSION_CODE, candidate.versionCode);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                flags |= PendingIntent.FLAG_MUTABLE;
            }
            PendingIntent callback = PendingIntent.getBroadcast(
                    context,
                    sessionId,
                    result,
                    flags
            );
            writeStatus(
                    context,
                    "install_committed",
                    "Doğrulanan güncelleme Android paket yöneticisine teslim edildi.",
                    candidate.versionCode
            );
            session.commit(callback.getIntentSender());
            commitRequested = true;
        } catch (Exception error) {
            if (!commitRequested) {
                try {
                    installer.abandonSession(sessionId);
                } catch (Exception ignored) {}
            }
            writeStatus(
                    context,
                    "install_failed",
                    "Android paket yöneticisi güncellemeyi kabul etmedi.",
                    candidate.versionCode
            );
            throw error;
        }
    }

    @SuppressWarnings("deprecation")
    private static Intent pendingUserAction(Intent source) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return source.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class);
        }
        return source.getParcelableExtra(Intent.EXTRA_INTENT);
    }

    private static Candidate verifyCandidate(Context context, Candidate candidate) throws Exception {
        if (candidate == null || candidate.versionCode < 1) {
            throw new SecurityException("Güncelleme adayı geçersiz.");
        }
        if (installedVersionCode(context) >= candidate.versionCode) {
            clearPendingCandidate(context, candidate.versionCode);
            throw new IllegalStateException("Güncelleme zaten kurulu.");
        }
        String expectedName = "customer-" + candidate.versionCode + ".apk";
        File directory = new File(context.getFilesDir(), "verified-updates").getCanonicalFile();
        File expectedApk = new File(directory, expectedName).getCanonicalFile();
        if (!expectedApk.equals(candidate.apk.getCanonicalFile())) {
            throw new SecurityException("Güncelleme dosya yolu geçersiz.");
        }
        String expectedHash = normalizeDigest(candidate.sha256);
        String expectedCertificate = normalizeDigest(candidate.releaseCertificate);
        if (
                !expectedApk.isFile() ||
                candidate.sizeBytes < 1 ||
                candidate.sizeBytes > MAX_APK_BYTES ||
                expectedApk.length() != candidate.sizeBytes ||
                expectedHash.length() != 64 ||
                expectedCertificate.length() != 64 ||
                !expectedHash.equals(fileSha256(expectedApk))
        ) {
            throw new SecurityException("Bekleyen APK bütünlük doğrulamasını geçemedi.");
        }
        verifyApk(
                context,
                expectedApk,
                candidate.versionCode,
                expectedCertificate
        );
        return new Candidate(
                candidate.versionCode,
                candidate.versionName,
                candidate.releaseNotes,
                candidate.mandatory,
                expectedApk,
                expectedHash,
                candidate.sizeBytes,
                expectedCertificate
        );
    }

    private static String fileSha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[128 * 1024];
            int read;
            while ((read = input.read(buffer)) >= 0) {
                digest.update(buffer, 0, read);
            }
        }
        return hex(digest.digest());
    }

    private static void savePendingCandidate(Context context, Candidate candidate) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putLong("pending_version_code", candidate.versionCode)
                .putString("pending_version_name", candidate.versionName)
                .putString("pending_release_notes", candidate.releaseNotes)
                .putBoolean("pending_mandatory", candidate.mandatory)
                .putString("pending_file_name", candidate.apk.getName())
                .putString("pending_sha256", candidate.sha256)
                .putLong("pending_size_bytes", candidate.sizeBytes)
                .putString("pending_release_certificate", candidate.releaseCertificate)
                .apply();
    }

    private static void clearPendingCandidate(Context context, long installedOrRejectedVersion) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        long pendingVersion = prefs.getLong("pending_version_code", 0);
        if (pendingVersion > installedOrRejectedVersion) return;
        prefs.edit()
                .remove("pending_version_code")
                .remove("pending_version_name")
                .remove("pending_release_notes")
                .remove("pending_mandatory")
                .remove("pending_file_name")
                .remove("pending_sha256")
                .remove("pending_size_bytes")
                .remove("pending_release_certificate")
                .apply();
    }

    private static void verifyManifest(Context context, JSONObject manifest) throws Exception {
        if (manifest.optInt("manifest_version", 0) != 1) {
            throw new SecurityException("Güncelleme manifest sürümü geçersiz.");
        }
        if (!EXPECTED_APP.equals(manifest.optString("app"))) {
            throw new SecurityException("Güncelleme uygulama kimliği geçersiz.");
        }
        if (!EXPECTED_PACKAGE.equals(manifest.optString("package_name"))) {
            throw new SecurityException("Güncelleme paket kimliği geçersiz.");
        }
        String signature = manifest.optString("signature", "");
        if (signature.isEmpty()) throw new SecurityException("Güncelleme manifest imzası eksik.");

        java.security.Signature verifier = java.security.Signature.getInstance("SHA256withRSA");
        verifier.initVerify(loadPublicKey(context));
        verifier.update(canonicalManifest(manifest).getBytes(StandardCharsets.UTF_8));
        if (!verifier.verify(Base64.decode(signature, Base64.DEFAULT))) {
            throw new SecurityException("Güncelleme manifest imzası geçersiz.");
        }
    }

    private static String canonicalManifest(JSONObject manifest) throws Exception {
        return String.join("\n",
                String.valueOf(manifest.getInt("manifest_version")),
                manifest.getString("app"),
                manifest.getString("package_name"),
                String.valueOf(manifest.getLong("version_code")),
                manifest.getString("version_name"),
                manifest.getString("apk_url"),
                normalizeDigest(manifest.getString("sha256")),
                String.valueOf(manifest.getLong("size_bytes")),
                normalizeDigest(manifest.getString("release_certificate_sha256")),
                String.valueOf(manifest.optBoolean("mandatory", false)),
                manifest.optString("release_notes", "")
        );
    }

    private static URL trustedPackageUrl(String origin, String raw) throws Exception {
        if (!raw.startsWith("/public/downloads/") || raw.contains("..") || raw.contains("\\")) {
            throw new SecurityException("APK yolu güvenilir değil.");
        }
        URL base = new URL(origin);
        URL resolved = new URL(base, raw);
        if (
                !"https".equalsIgnoreCase(resolved.getProtocol()) ||
                !base.getHost().equalsIgnoreCase(resolved.getHost()) ||
                resolved.getPort() != -1
        ) {
            throw new SecurityException("APK origin'i güvenilir değil.");
        }
        return resolved;
    }

    private static void download(URL url, File destination, String expectedHash, long expectedSize)
            throws Exception {
        File temporary = new File(destination.getParentFile(), destination.getName() + ".part");
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(60_000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Accept", "application/vnd.android.package-archive");
        connection.setRequestProperty("User-Agent", "VIP-Gece-Customer-Native/1");
        int status = connection.getResponseCode();
        if (status < 200 || status >= 300) {
            connection.disconnect();
            throw new IllegalStateException("APK sunucusu HTTP " + status + " döndürdü.");
        }

        long contentLength = connection.getContentLengthLong();
        if (contentLength > MAX_APK_BYTES) throw new SecurityException("APK boyutu sınırı aşıyor.");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long total = 0;
        try (InputStream input = connection.getInputStream();
             FileOutputStream output = new FileOutputStream(temporary, false)) {
            byte[] buffer = new byte[128 * 1024];
            int read;
            while ((read = input.read(buffer)) >= 0) {
                total += read;
                if (total > MAX_APK_BYTES) throw new SecurityException("APK boyutu sınırı aşıyor.");
                digest.update(buffer, 0, read);
                output.write(buffer, 0, read);
            }
            output.getFD().sync();
        } finally {
            connection.disconnect();
        }

        if (expectedSize > 0 && total != expectedSize) {
            temporary.delete();
            throw new SecurityException("APK boyutu manifest ile eşleşmiyor.");
        }
        if (!normalizeDigest(expectedHash).equals(hex(digest.digest()))) {
            temporary.delete();
            throw new SecurityException("APK SHA-256 doğrulaması başarısız.");
        }
        if (destination.exists() && !destination.delete()) {
            throw new IllegalStateException("Eski güncelleme paketi kaldırılamadı.");
        }
        if (!temporary.renameTo(destination)) {
            throw new IllegalStateException("Doğrulanan APK atomik alana taşınamadı.");
        }
    }

    private static void verifyApk(
            Context context,
            File apk,
            long expectedVersion,
            String expectedCertificate
    ) throws Exception {
        PackageManager manager = context.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? PackageManager.GET_SIGNING_CERTIFICATES
                : PackageManager.GET_SIGNATURES;
        PackageInfo info = manager.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
        if (info == null || !EXPECTED_PACKAGE.equals(info.packageName)) {
            throw new SecurityException("APK paket kimliği geçersiz.");
        }
        long version = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? info.getLongVersionCode()
                : info.versionCode;
        if (version != expectedVersion) {
            throw new SecurityException("APK sürüm kodu manifest ile eşleşmiyor.");
        }
        if (!expectedCertificate.equals(signingDigest(info))) {
            throw new SecurityException("APK release sertifikası geçersiz.");
        }

        String currentCertificate = signingDigest(
                manager.getPackageInfo(context.getPackageName(), flags)
        );
        if (!expectedCertificate.equals(currentCertificate)) {
            throw new SecurityException("Kurulu uygulama ve güncelleme imzaları eşleşmiyor.");
        }
    }

    private static String signingDigest(PackageInfo info) throws Exception {
        Signature[] signatures;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            signatures = info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners();
        } else {
            signatures = info.signatures;
        }
        if (signatures == null || signatures.length != 1) {
            throw new SecurityException("Tekil APK sertifikası okunamadı.");
        }
        return hex(MessageDigest.getInstance("SHA-256").digest(signatures[0].toByteArray()));
    }

    private static PublicKey loadPublicKey(Context context) throws Exception {
        String pem;
        try (InputStream input = context.getResources().openRawResource(
                R.raw.vip_gece_customer_config_public_key
        )) {
            pem = new String(readAll(input, 16 * 1024), StandardCharsets.US_ASCII);
        }
        String body = pem
                .replace("-----BEGIN PUBLIC KEY-----", "")
                .replace("-----END PUBLIC KEY-----", "")
                .replaceAll("\\s", "");
        return KeyFactory.getInstance("RSA").generatePublic(
                new X509EncodedKeySpec(Base64.decode(body, Base64.DEFAULT))
        );
    }

    private static byte[] readAll(InputStream input, int maxBytes) throws Exception {
        try (InputStream source = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int total = 0;
            int read;
            while ((read = source.read(buffer)) >= 0) {
                total += read;
                if (total > maxBytes) throw new SecurityException("Anahtar dosyası çok büyük.");
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        }
    }

    private static long installedVersionCode(Context context) throws Exception {
        PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? info.getLongVersionCode()
                : info.versionCode;
    }

    private static String normalizeDigest(String value) {
        return String.valueOf(value == null ? "" : value)
                .replace(":", "")
                .trim()
                .toLowerCase(Locale.ROOT);
    }

    private static String hex(byte[] bytes) {
        StringBuilder builder = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) {
            builder.append(String.format(Locale.ROOT, "%02x", value & 0xff));
        }
        return builder.toString();
    }

    private static void writeStatus(Context context, String state, String message) {
        writeStatus(context, state, message, 0);
    }

    private static void writeStatus(
            Context context,
            String state,
            String message,
            long versionCode
    ) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        prefs.edit()
                .putString("state", state)
                .putString("message", message)
                .putLong("state_version_code", versionCode)
                .putLong("updated_at", System.currentTimeMillis())
                .apply();
    }

    public static final class Candidate {
        public final long versionCode;
        public final String versionName;
        public final String releaseNotes;
        public final boolean mandatory;
        public final File apk;
        public final String sha256;
        public final long sizeBytes;
        public final String releaseCertificate;

        Candidate(
                long versionCode,
                String versionName,
                String releaseNotes,
                boolean mandatory,
                File apk,
                String sha256,
                long sizeBytes,
                String releaseCertificate
        ) {
            this.versionCode = versionCode;
            this.versionName = versionName;
            this.releaseNotes = releaseNotes;
            this.mandatory = mandatory;
            this.apk = apk;
            this.sha256 = sha256;
            this.sizeBytes = sizeBytes;
            this.releaseCertificate = releaseCertificate;
        }
    }
}
