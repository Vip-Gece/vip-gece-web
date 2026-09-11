package com.vipgece.customer;

import android.annotation.SuppressLint;
import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.text.InputType;
import android.text.TextUtils;
import android.text.method.PasswordTransformationMethod;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.vipgece.customer.background.CustomerBootReceiver;
import com.vipgece.customer.config.EndpointResolver;
import com.vipgece.customer.media.ProfileImageSanitizer;
import com.vipgece.customer.net.CustomerApi;
import com.vipgece.customer.notification.CustomerNotifications;
import com.vipgece.customer.security.SecureSessionStore;
import com.vipgece.customer.update.CustomerUpdateEngine;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

public final class MainActivity extends AppCompatActivity {
    private static final String STATE_PENDING_IMAGE_PROFILE_ID = "pending_image_profile_id";
    private static final String STATE_OPEN_UPDATE_REQUESTED = "open_update_requested";
    private static final String STATE_SELECTED_PROFILE_ID = "selected_profile_id";
    private static final String UI_THEME_PREFS = "vip_gece_customer_ui";
    private static final String UI_THEME_KEY = "theme";
    private static final String THEME_NIGHT = "gece";
    private static final String THEME_BURGUNDY = "bordo";
    private static final String THEME_HIGH_CONTRAST = "yuksek-kontrast";
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final ExecutorService thumbnailIo = Executors.newFixedThreadPool(2);
    private final Handler main = new Handler(Looper.getMainLooper());
    private final android.util.LruCache<String, Bitmap> thumbnailCache =
            new android.util.LruCache<>(24);
    private ActivityResultLauncher<Intent> profileImagePicker;
    private ActivityResultLauncher<String> notificationPermissionLauncher;
    private SecureSessionStore sessionStore;
    private SecureSessionStore.Session activeSession;
    private JSONObject bootstrap;
    private String pendingImageProfileId = "";
    private String selectedProfileId = "";
    private Uri pendingNewProfileImageUri;
    private ProfileImageSanitizer.SanitizedImage pendingNewProfileImage;
    private ImageView pendingNewProfileImageView;
    private TextView pendingNewProfileImageLabel;
    private WebView previewWebView;
    private boolean demoMode;
    private boolean initialUpdateGateComplete;
    private boolean updateGateRunning;
    private boolean mandatoryUpdateLock;
    private boolean openUpdateRequested;
    private boolean profileAnalyticsOpen;
    private long profileAnalyticsRequestGeneration;
    private String activeAnalyticsProfileId = "";
    private boolean createProfileOrientationLocked;
    private int createProfilePreviousOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
    private boolean destroyed;
    private String activeUiTheme;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (savedInstanceState != null) {
            pendingImageProfileId = savedInstanceState.getString(
                    STATE_PENDING_IMAGE_PROFILE_ID,
                    ""
            );
            openUpdateRequested = savedInstanceState.getBoolean(
                    STATE_OPEN_UPDATE_REQUESTED,
                    false
            );
            selectedProfileId = savedInstanceState.getString(
                    STATE_SELECTED_PROFILE_ID,
                    ""
            );
        }
        Intent launchIntent = getIntent();
        boolean updateLaunch = isUpdateNotificationAction(launchIntent);
        openUpdateRequested = openUpdateRequested || updateLaunch;
        if (updateLaunch) {
            launchIntent.setAction(null);
            launchIntent.setData(null);
        }
        profileImagePicker = registerForActivityResult(
                new ActivityResultContracts.StartActivityForResult(),
                result -> {
                    Intent data = result.getData();
                    Uri uri = result.getResultCode() == RESULT_OK && data != null
                            ? data.getData()
                            : null;
                    onProfileImageSelected(uri);
                }
        );
        notificationPermissionLauncher = registerForActivityResult(
                new ActivityResultContracts.RequestPermission(),
                granted -> {}
        );
        CustomerNotifications.createChannels(this);
        sessionStore = new SecureSessionStore(this);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (previewWebView != null) {
                    showDashboard();
                    return;
                }
                if (profileAnalyticsOpen) {
                    showDashboard();
                    return;
                }
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
            }
        });
        demoMode = BuildConfig.MULTI_PROFILE_DEMO_AVAILABLE &&
                getIntent().getBooleanExtra("demo_multi_profile", false);
        if (demoMode) {
            activeSession = new SecureSessionStore.Session(
                    "debug-demo",
                    "demo@vip-gece.site",
                    "Çoklu Profil Önizlemesi",
                    "2099-01-01T00:00:00Z"
            );
            bootstrap = demoBootstrap();
            showDashboard();
            return;
        }
        CustomerBootReceiver.schedule(this);
        showLoading("Uygulama hazırlanıyor…");
        evaluateMandatoryUpdate(true);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String action = intent == null ? "" : String.valueOf(intent.getAction());
        if (CustomerNotifications.ACTION_OPEN_UPDATE.equals(action)) {
            intent.setAction(null);
            intent.setData(null);
            openUpdateRequested = true;
            evaluateMandatoryUpdate(true);
        } else if (
                CustomerNotifications.ACTION_OPEN_DAILY_SUMMARY.equals(action) &&
                activeSession != null
        ) {
            showLoading("Güncel profil verileriniz yükleniyor…");
            refreshBootstrap();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        outState.putString(STATE_PENDING_IMAGE_PROFILE_ID, pendingImageProfileId);
        outState.putBoolean(STATE_OPEN_UPDATE_REQUESTED, openUpdateRequested);
        outState.putString(STATE_SELECTED_PROFILE_ID, selectedProfileId);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (demoMode || previewWebView != null) return;
        if (initialUpdateGateComplete && !updateGateRunning) {
            evaluateMandatoryUpdate(false);
        }
    }

    private void evaluateMandatoryUpdate(boolean refreshRemote) {
        if (updateGateRunning) return;
        updateGateRunning = true;
        runIo(
                () -> resolveUpdateCandidate(refreshRemote),
                candidate -> {
                    updateGateRunning = false;
                    boolean wasLocked = mandatoryUpdateLock;
                    boolean notificationRequest = openUpdateRequested;
                    initialUpdateGateComplete = true;
                    if (candidate != null && candidate.mandatory) {
                        openUpdateRequested = false;
                        showMandatoryUpdate(candidate);
                        return;
                    }
                    mandatoryUpdateLock = false;
                    if (notificationRequest) {
                        openUpdateRequested = false;
                        resumeNormalApplication();
                        if (candidate == null) {
                            showVerifiedUpdateUnavailable();
                        } else {
                            showOptionalUpdate(candidate, null);
                        }
                        return;
                    }
                    if (refreshRemote || wasLocked) resumeNormalApplication();
                },
                error -> {
                    updateGateRunning = false;
                    boolean wasLocked = mandatoryUpdateLock;
                    boolean notificationRequest = openUpdateRequested;
                    initialUpdateGateComplete = true;
                    mandatoryUpdateLock = false;
                    if (notificationRequest) {
                        openUpdateRequested = false;
                        resumeNormalApplication();
                        showVerifiedUpdateUnavailable();
                        return;
                    }
                    if (refreshRemote || wasLocked) resumeNormalApplication();
                }
        );
    }

    private static boolean isUpdateNotificationAction(@Nullable Intent intent) {
        return intent != null &&
                CustomerNotifications.ACTION_OPEN_UPDATE.equals(intent.getAction());
    }

    private void showVerifiedUpdateUnavailable() {
        Toast.makeText(
                this,
                "Doğrulanmış güncelleme bulunamadı. Panel içinden tekrar kontrol edin.",
                Toast.LENGTH_LONG
        ).show();
    }

    private CustomerUpdateEngine.Candidate resolveUpdateCandidate(boolean refreshRemote) {
        CustomerUpdateEngine.Candidate cached = CustomerUpdateEngine.pendingCandidate(this);
        if (!refreshRemote) return cached;
        try {
            CustomerUpdateEngine.Candidate latest =
                    CustomerUpdateEngine.checkAndDownload(this);
            return latest == null
                    ? CustomerUpdateEngine.pendingCandidate(this)
                    : latest;
        } catch (Exception ignored) {
            return cached;
        }
    }

    private void resumeNormalApplication() {
        activeSession = sessionStore.load();
        if (activeSession == null) {
            showLogin("");
        } else {
            showLoading("Profilleriniz güvenli biçimde yükleniyor…");
            refreshBootstrap();
        }
    }

    private void showMandatoryUpdate(CustomerUpdateEngine.Candidate candidate) {
        mandatoryUpdateLock = true;
        LinearLayout content = vertical(24);
        content.setGravity(Gravity.CENTER);
        content.setBackgroundColor(color(R.color.vip_background));

        TextView title = text("Zorunlu Güvenlik Güncellemesi", 24, R.color.vip_primary);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setGravity(Gravity.CENTER);
        content.addView(title, matchWrap());
        content.addView(spacer(14));

        String notes = candidate.releaseNotes == null || candidate.releaseNotes.isEmpty()
                ? "Yeni müşteri paneli sürümü doğrulandı."
                : candidate.releaseNotes;
        TextView description = text(
                "Sürüm " + candidate.versionName + "\n\n" + notes +
                        "\n\nEski sürümle devam edilemez. Paket imzası, SHA-256 özeti ve uygulama kimliği doğrulandı.",
                15,
                R.color.vip_text
        );
        description.setGravity(Gravity.CENTER);
        content.addView(description, matchWrap());
        content.addView(spacer(16));

        TextView status = text(
                updateInstallStatusMessage(),
                14,
                R.color.vip_warning
        );
        status.setGravity(Gravity.CENTER);
        content.addView(status, matchWrap());
        content.addView(spacer(12));

        Button install = button("Güvenli Güncellemeyi Kur");
        install.setOnClickListener(view ->
                installCandidate(candidate, install, status));
        content.addView(install, matchWrap());
        setScreen(content);
    }

    private void installCandidate(
            CustomerUpdateEngine.Candidate candidate,
            @Nullable Button button,
            @Nullable TextView status
    ) {
        if (button != null) {
            button.setEnabled(false);
            button.setText("Android paket yöneticisine hazırlanıyor…");
        }
        if (status != null) status.setText("Doğrulanan paket kuruluma aktarılıyor.");
        runIo(
                () -> {
                    CustomerUpdateEngine.requestInstall(this, candidate);
                    return CustomerUpdateEngine.status(this);
                },
                result -> {
                    if (button != null) {
                        button.setEnabled(true);
                        button.setText("Güvenli Güncellemeyi Kur");
                    }
                    if (status != null) status.setText(updateInstallStatusMessage());
                },
                error -> {
                    if (button != null) {
                        button.setEnabled(true);
                        button.setText("Güvenli Güncellemeyi Yeniden Dene");
                    }
                    if (status != null) {
                        status.setText(safeError(error, "Android kurulumu başlatılamadı."));
                    } else {
                        Toast.makeText(
                                this,
                                safeError(error, "Android kurulumu başlatılamadı."),
                                Toast.LENGTH_LONG
                        ).show();
                    }
                }
        );
    }

    private String updateInstallStatusMessage() {
        String state = CustomerUpdateEngine.status(this);
        if ("install_permission_required".equals(state)) {
            return "Android ayarlarında bu uygulama için paket kurma iznini açın ve geri dönün.";
        }
        if ("install_committed".equals(state)) {
            return "Android güncellemeyi kuruyor.";
        }
        if ("user_action_required".equals(state)) {
            return "Android sistem kurulum onayı bekleniyor.";
        }
        if ("install_failed".equals(state)) {
            return "Kurulum tamamlanamadı; doğrulanan paket yeniden denenebilir.";
        }
        return "Kuruluma başlamak için aşağıdaki düğmeye dokunun.";
    }

    @Override
    protected void onDestroy() {
        destroyed = true;
        destroyPreviewWebView();
        io.shutdownNow();
        thumbnailIo.shutdownNow();
        super.onDestroy();
    }

    private void showLogin(String message) {
        if (mandatoryUpdateLock) return;
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(color(R.color.vip_background));
        LinearLayout content = vertical(24);
        content.setGravity(Gravity.CENTER_HORIZONTAL);
        scroll.addView(content, matchWrap());

        content.addView(brandLogo(104));
        content.addView(spacer(10));

        TextView title = text("Müşteri Paneli", 24, R.color.vip_text);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setGravity(Gravity.CENTER);
        ViewCompat.setAccessibilityHeading(title, true);
        content.addView(title, matchWrap());

        TextView subtitle = text(
                "Size verilen e-posta ve şifreyle giriş yapın.",
                15,
                R.color.vip_muted
        );
        subtitle.setGravity(Gravity.CENTER);
        content.addView(subtitle, matchWrap());
        content.addView(spacer(22));

        EditText email = input("E-posta", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        email.setAutofillHints(View.AUTOFILL_HINT_EMAIL_ADDRESS);
        email.setImeOptions(EditorInfo.IME_ACTION_NEXT);
        content.addView(email, matchWrap());
        content.addView(spacer(12));

        EditText password = input(
                "Şifre",
                InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD
        );
        password.setTransformationMethod(PasswordTransformationMethod.getInstance());
        password.setAutofillHints(View.AUTOFILL_HINT_PASSWORD);
        password.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_YES);
        password.setImeOptions(EditorInfo.IME_ACTION_DONE);
        content.addView(password, matchWrap());
        content.addView(spacer(18));

        TextView status = text(message, 14, R.color.vip_warning);
        status.setGravity(Gravity.CENTER);
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        content.addView(status, matchWrap());
        content.addView(spacer(10));

        Button login = button("Giriş Yap");
        content.addView(login, matchWrap());
        password.setOnEditorActionListener((view, actionId, event) -> {
            if (actionId != EditorInfo.IME_ACTION_DONE) return false;
            login.performClick();
            return true;
        });
        login.setOnClickListener(view -> {
            String rawEmail = email.getText().toString().trim();
            String rawPassword = password.getText().toString();
            if (rawEmail.isEmpty()) {
                email.setError("E-posta gerekli.");
                email.requestFocus();
                return;
            }
            if (rawPassword.isEmpty()) {
                password.setError("Şifre gerekli.");
                password.requestFocus();
                return;
            }
            login.setEnabled(false);
            status.setText("Giriş yapılıyor…");
            runIo(
                    () -> CustomerApi.login(this, rawEmail, rawPassword),
                    result -> {
                        try {
                            sessionStore.save(result.session);
                            activeSession = result.session;
                            selectedProfileId = "";
                            password.setText("");
                            showLoading("Profilleriniz yükleniyor…");
                            refreshBootstrap();
                        } catch (Exception error) {
                            login.setEnabled(true);
                            status.setText("Oturum güvenli biçimde saklanamadı.");
                        }
                    },
                    error -> {
                        login.setEnabled(true);
                        status.setText(error instanceof CustomerApi.ApiException
                                ? safeError(error, "Giriş bilgileri geçersiz.")
                                : "Bağlantı kurulamadı. Lütfen tekrar deneyin.");
                    }
            );
        });

        setScreen(scroll);
    }

    private void showLoading(String message) {
        if (mandatoryUpdateLock) return;
        LinearLayout content = vertical(24);
        content.setGravity(Gravity.CENTER);
        content.setBackgroundColor(color(R.color.vip_background));
        ProgressBar progress = new ProgressBar(this);
        content.addView(progress, wrapWrap());
        content.addView(spacer(18));
        TextView label = text(message, 16, R.color.vip_text);
        label.setGravity(Gravity.CENTER);
        content.addView(label, matchWrap());
        setScreen(content);
    }

    private void refreshBootstrap() {
        SecureSessionStore.Session session = activeSession;
        if (session == null) {
            showLogin("");
            return;
        }
        runIo(
                () -> CustomerApi.bootstrap(this, session.token),
                result -> {
                    bootstrap = result;
                    showDashboard();
                },
                error -> {
                    if (error instanceof CustomerApi.ApiException &&
                            ((CustomerApi.ApiException) error).status == 401) {
                        sessionStore.clear();
                        activeSession = null;
                        selectedProfileId = "";
                        showLogin("Oturum süresi doldu. Lütfen yeniden giriş yapın.");
                        return;
                    }
                    showRetry(userError(error, "Profiller alınamadı."));
                }
        );
    }

    private void showRetry(String message) {
        if (mandatoryUpdateLock) return;
        LinearLayout content = vertical(24);
        content.setGravity(Gravity.CENTER);
        content.setBackgroundColor(color(R.color.vip_background));
        TextView label = text(message, 16, R.color.vip_warning);
        label.setGravity(Gravity.CENTER);
        content.addView(label, matchWrap());
        content.addView(spacer(16));
        Button retry = button("Tekrar Dene");
        retry.setOnClickListener(view -> {
            showLoading("Bağlantı yeniden deneniyor…");
            refreshBootstrap();
        });
        content.addView(retry, matchWrap());
        setScreen(content);
    }

    private void showDashboard() {
        invalidateProfileAnalyticsRequest();
        if (mandatoryUpdateLock) return;
        if (bootstrap == null || activeSession == null) {
            showRetry("Başlangıç verisi bulunamadı.");
            return;
        }
        destroyPreviewWebView();

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(color(R.color.vip_background));
        scroll.setClipToPadding(false);
        LinearLayout content = vertical(16);
        scroll.addView(content, matchWrap());

        JSONObject account = bootstrap.optJSONObject("account");
        String accountLabel = account == null ? activeSession.accountLabel : account.optString("label", "");
        content.addView(dashboardHeader(
                accountLabel.isEmpty() ? activeSession.email : accountLabel
        ), matchWrap());
        if (demoMode) {
            content.addView(spacer(10));
            content.addView(infoBanner(
                    "Çoklu profil tasarım önizlemesi",
                    "Bu profiller yalnız debug APK içindedir; canlı müşteri verisi değişmez."
            ), matchWrap());
        }
        content.addView(spacer(14));

        JSONObject quota = bootstrap.optJSONObject("quota");
        int limit = quota == null ? 10 : quota.optInt("limit", 10);
        int used = quota == null ? 0 : quota.optInt("used", 0);
        int remaining = quota == null ? Math.max(0, limit - used) : quota.optInt("remaining", 0);
        int ready = quota == null ? 0 : quota.optInt("ready", 0);
        int live = quota == null ? 0 : quota.optInt("live", 0);

        LinearLayout summary = card(14);
        TextView quotaTitle = text("Profil portföyünüz", 17, R.color.vip_text);
        quotaTitle.setTypeface(Typeface.DEFAULT_BOLD);
        ViewCompat.setAccessibilityHeading(quotaTitle, true);
        summary.addView(quotaTitle, matchWrap());
        summary.addView(spacer(10));
        LinearLayout stats = horizontal();
        stats.addView(statTile("Kullanılan", used + "/" + limit, R.color.vip_primary), weighted(1f, 6));
        stats.addView(statTile("Hazır", String.valueOf(ready), R.color.vip_gold), weighted(1f, 6));
        stats.addView(statTile("Yayında", String.valueOf(live), R.color.vip_success), weighted(1f, 0));
        summary.addView(stats, matchWrap());
        content.addView(summary, matchWrap());
        content.addView(spacer(10));

        LinearLayout actions = horizontal();
        Button add = button("+  Yeni profil");
        add.setEnabled(remaining > 0);
        add.setOnClickListener(view -> showCreateProfileDialog());
        actions.addView(add, weighted(2.2f, 8));
        Button refresh = secondaryButton("Yenile");
        refresh.setOnClickListener(view -> {
            if (demoMode) {
                Toast.makeText(this, "Demo profilleri güncel.", Toast.LENGTH_SHORT).show();
            } else {
                showLoading("Profiller yenileniyor…");
                refreshBootstrap();
            }
        });
        actions.addView(refresh, weighted(1f, 0));
        content.addView(actions, matchWrap());
        content.addView(spacer(20));

        JSONArray profiles = bootstrap.optJSONArray("profiles");
        int profileCount = profiles == null ? 0 : profiles.length();
        LinearLayout sectionHeader = horizontal();
        sectionHeader.setGravity(Gravity.CENTER_VERTICAL);
        TextView profilesTitle = text("Profiller", 21, R.color.vip_text);
        profilesTitle.setTypeface(Typeface.DEFAULT_BOLD);
        ViewCompat.setAccessibilityHeading(profilesTitle, true);
        sectionHeader.addView(profilesTitle, weighted(1f, 8));
        sectionHeader.addView(statusChip(
                String.format(Locale.getDefault(), "%d profil", profileCount),
                R.color.vip_muted
        ), wrapWrap());
        content.addView(sectionHeader, matchWrap());
        content.addView(spacer(10));

        if (profiles == null || profiles.length() == 0) {
            selectedProfileId = "";
            content.addView(infoBanner(
                    "İlk profilinizi oluşturun",
                    "Fotoğrafı önce seçebilir, bilgileri daha sonra tamamlayabilirsiniz."
            ), matchWrap());
        } else {
            JSONObject selectedProfile = resolveSelectedProfile(profiles);
            HorizontalScrollView tabs = new HorizontalScrollView(this);
            tabs.setHorizontalScrollBarEnabled(false);
            tabs.setFillViewport(false);
            tabs.setClipToPadding(false);
            LinearLayout tabRow = horizontal();
            View selectedTab = null;
            for (int index = 0; index < profiles.length(); index++) {
                JSONObject profile = profiles.optJSONObject(index);
                if (profile == null) continue;
                String profileId = profile.optString("id", "").trim();
                boolean selected = profileId.equals(selectedProfileId);
                View tab = profileTabChip(
                        profile,
                        selected
                );
                if (selected) selectedTab = tab;
                tab.setOnClickListener(view -> {
                    selectedProfileId = profileId;
                    showDashboard();
                });
                LinearLayout.LayoutParams tabParams = wrapWrap();
                tabParams.setMarginEnd(dp(8));
                tabRow.addView(tab, tabParams);
            }
            tabs.addView(tabRow, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
            ));
            content.addView(tabs, matchWrap());
            View tabToReveal = selectedTab;
            if (tabToReveal != null) {
                tabs.post(() -> tabs.scrollTo(
                        Math.max(0, tabToReveal.getLeft() - dp(16)),
                        0
                ));
            }
            content.addView(spacer(12));
            if (selectedProfile != null) {
                content.addView(profileCard(selectedProfile), matchWrap());
            }
        }

        if (!demoMode) {
            content.addView(spacer(18));
            TextView accountTitle = text("Hesap ve destek", 18, R.color.vip_text);
            accountTitle.setTypeface(Typeface.DEFAULT_BOLD);
            ViewCompat.setAccessibilityHeading(accountTitle, true);
            content.addView(accountTitle, matchWrap());
            content.addView(spacer(8));

            Button update = secondaryButton("Güncellemeleri kontrol et");
            update.setOnClickListener(view -> checkForUpdate(update));
            content.addView(update, matchWrap());
            content.addView(spacer(8));

            Button notifications = secondaryButton("Bildirim ayarları");
            notifications.setOnClickListener(view -> CustomerNotifications.openSettings(this));
            content.addView(notifications, matchWrap());
            content.addView(spacer(8));

            Button theme = secondaryButton("Tema seç");
            theme.setOnClickListener(view -> showThemePicker());
            content.addView(theme, matchWrap());
            content.addView(spacer(8));

            LinearLayout accountActions = horizontal();
            if (EndpointResolver.supportEnabled(this)) {
                Button support = secondaryButton("Teknik destek");
                support.setOnClickListener(view -> beginSupportSession());
                accountActions.addView(support, weighted(1f, 8));
            }

            Button logout = secondaryButton("Çıkış yap");
            logout.setOnClickListener(view -> {
                sessionStore.clear();
                CustomerNotifications.clearDailySummary(this);
                activeSession = null;
                bootstrap = null;
                selectedProfileId = "";
                showLogin("");
            });
            accountActions.addView(logout, weighted(1f, 0));
            content.addView(accountActions, matchWrap());
        }
        content.addView(spacer(24));
        setScreen(scroll);
        if (!demoMode) requestNotificationPermissionIfNeeded();
    }

    private void showThemePicker() {
        String[] labels = {"Gece", "Bordo", "Yüksek kontrast"};
        String[] values = {THEME_NIGHT, THEME_BURGUNDY, THEME_HIGH_CONTRAST};
        String current = uiTheme();
        int checked = THEME_BURGUNDY.equals(current)
                ? 1
                : THEME_HIGH_CONTRAST.equals(current) ? 2 : 0;

        new AlertDialog.Builder(this)
                .setTitle("Tema seç")
                .setSingleChoiceItems(labels, checked, (dialog, which) -> {
                    if (which < 0 || which >= values.length) return;
                    activeUiTheme = values[which];
                    getSharedPreferences(UI_THEME_PREFS, MODE_PRIVATE)
                            .edit()
                            .putString(UI_THEME_KEY, activeUiTheme)
                            .apply();
                    dialog.dismiss();
                    showDashboard();
                })
                .setNegativeButton("Kapat", null)
                .show();
    }

    private String uiTheme() {
        if (activeUiTheme != null) return activeUiTheme;
        String saved = getSharedPreferences(UI_THEME_PREFS, MODE_PRIVATE)
                .getString(UI_THEME_KEY, THEME_NIGHT);
        activeUiTheme = THEME_BURGUNDY.equals(saved) || THEME_HIGH_CONTRAST.equals(saved)
                ? saved
                : THEME_NIGHT;
        return activeUiTheme;
    }

    @Nullable
    private JSONObject resolveSelectedProfile(JSONArray profiles) {
        JSONObject first = null;
        for (int index = 0; index < profiles.length(); index++) {
            JSONObject profile = profiles.optJSONObject(index);
            if (profile == null) continue;
            if (first == null) first = profile;
            if (selectedProfileId.equals(profile.optString("id", "").trim())) {
                return profile;
            }
        }
        selectedProfileId = first == null
                ? ""
                : first.optString("id", "").trim();
        return first;
    }

    private View profileTabChip(JSONObject profile, boolean selected) {
        String name = profile.optString("name", "İsimsiz profil").trim();
        String state = profile.optString("state", "draft");
        String label = "live".equals(state)
                ? "Yayında"
                : "ready".equals(state)
                ? "Yayına hazır"
                : "Taslak";
        int stateColor = "live".equals(state)
                ? R.color.vip_success
                : "ready".equals(state)
                ? R.color.vip_gold
                : R.color.vip_warning;

        LinearLayout chip = horizontal();
        chip.setGravity(Gravity.CENTER_VERTICAL);
        chip.setPadding(dp(9), dp(8), dp(11), dp(8));
        chip.setMinimumWidth(dp(138));
        chip.setMinimumHeight(dp(58));
        chip.setClickable(true);
        chip.setFocusable(true);
        chip.setSelected(selected);
        chip.setContentDescription(
                name + ", " + label + (selected ? ", seçili profil" : "")
        );
        GradientDrawable background = new GradientDrawable();
        background.setColor(color(
                selected ? R.color.vip_surface_raised : R.color.vip_surface
        ));
        background.setCornerRadius(dp(16));
        background.setStroke(
                dp(selected ? 2 : 1),
                color(selected ? R.color.vip_primary : R.color.vip_outline)
        );
        chip.setBackground(background);

        FrameLayout cover = profileCover(profile, name, 38, 38);
        chip.addView(cover, new LinearLayout.LayoutParams(dp(38), dp(38)));

        LinearLayout labels = vertical(0);
        TextView title = text(name.isEmpty() ? "İsimsiz profil" : name, 14, R.color.vip_text);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setSingleLine(true);
        title.setEllipsize(TextUtils.TruncateAt.END);
        labels.addView(title, matchWrap());
        TextView status = text(label, 11, stateColor);
        status.setTypeface(Typeface.DEFAULT_BOLD);
        labels.addView(status, matchWrap());
        LinearLayout.LayoutParams labelsParams = new LinearLayout.LayoutParams(
                dp(94),
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        labelsParams.setMarginStart(dp(9));
        chip.addView(labels, labelsParams);
        return chip;
    }

    private void requestNotificationPermissionIfNeeded() {
        if (
                Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                CustomerNotifications.notificationsAllowed(this)
        ) {
            return;
        }
        android.content.SharedPreferences preferences = getSharedPreferences(
                "vip_gece_customer_notifications",
                MODE_PRIVATE
        );
        if (preferences.getBoolean("permission_requested", false)) return;
        preferences.edit().putBoolean("permission_requested", true).apply();
        notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS);
    }

    private void checkForUpdate(Button button) {
        button.setEnabled(false);
        button.setText("Güncelleme doğrulanıyor…");
        runIo(
                () -> CustomerUpdateEngine.checkAndDownload(this),
                candidate -> {
                    button.setEnabled(true);
                    button.setText("Güncellemeleri Kontrol Et");
                    if (candidate == null) {
                        CustomerNotifications.clearUpdate(this);
                        String updateStatus = CustomerUpdateEngine.status(this);
                        String message = "not_published".equals(updateStatus)
                                ? "Yayınlanmış yeni sürüm yok."
                                : "Uygulamanız güncel.";
                        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
                        return;
                    }
                    if (candidate.mandatory) {
                        showMandatoryUpdate(candidate);
                        return;
                    }
                    showOptionalUpdate(candidate, button);
                },
                error -> {
                    button.setEnabled(true);
                    button.setText("Güncellemeleri Kontrol Et");
                    Toast.makeText(this, userError(error, "Güncelleme kontrolü tamamlanamadı."), Toast.LENGTH_LONG).show();
                }
        );
    }

    private void showOptionalUpdate(
            CustomerUpdateEngine.Candidate candidate,
            @Nullable Button sourceButton
    ) {
        String notes = candidate.releaseNotes == null || candidate.releaseNotes.isEmpty()
                ? "Yeni sürüm doğrulandı."
                : candidate.releaseNotes;
        new AlertDialog.Builder(this)
                .setTitle("Güncelleme " + candidate.versionName)
                .setMessage(
                        notes +
                        "\n\nGüncelleme doğrulandı ve kuruluma hazır."
                )
                .setNegativeButton("Sonra", null)
                .setPositiveButton("Kur", (dialog, which) ->
                        installCandidate(candidate, sourceButton, null))
                .show();
    }

    private View profileCard(JSONObject profile) {
        LinearLayout card = card(14);
        String name = profile.optString("name", "İsimsiz profil");
        String state = profile.optString("state", "draft");
        String label = "live".equals(state)
                ? "Yayında"
                : "ready".equals(state)
                ? "Yayına hazır"
                : "Taslak";
        int stateColor = "live".equals(state)
                ? R.color.vip_success
                : "ready".equals(state)
                ? R.color.vip_gold
                : R.color.vip_warning;

        JSONArray images = profile.optJSONArray("images");
        int imageCount = images == null ? 0 : images.length();
        LinearLayout top = horizontal();
        top.setGravity(Gravity.TOP);
        FrameLayout cover = profileCover(profile, name, 82, 106);
        LinearLayout.LayoutParams coverParams = new LinearLayout.LayoutParams(dp(82), dp(106));
        coverParams.setMarginEnd(dp(14));
        top.addView(cover, coverParams);

        LinearLayout info = vertical(0);
        info.addView(statusChip(label, stateColor), wrapWrap());
        info.addView(spacer(7));
        TextView title = text(name, 19, R.color.vip_text);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setSingleLine(true);
        title.setEllipsize(TextUtils.TruncateAt.END);
        ViewCompat.setAccessibilityHeading(title, true);
        info.addView(title, matchWrap());

        String area = profileArea(profile);
        if (!area.isEmpty()) {
            TextView areaLabel = text(area, 13, R.color.vip_muted);
            areaLabel.setSingleLine(true);
            areaLabel.setEllipsize(TextUtils.TruncateAt.END);
            info.addView(areaLabel, matchWrap());
        }
        String cardLabel = profile.optString("card_label", "").trim();
        if (!cardLabel.isEmpty()) {
            TextView shortDescription = text(cardLabel, 13, R.color.vip_muted);
            shortDescription.setMaxLines(2);
            shortDescription.setEllipsize(TextUtils.TruncateAt.END);
            info.addView(shortDescription, matchWrap());
        }
        info.addView(spacer(5));
        info.addView(text(
                String.format(Locale.getDefault(), "%d/12 görsel", imageCount),
                12,
                R.color.vip_muted
        ), matchWrap());
        JSONArray missing = profile.optJSONArray("missing_fields");
        if (missing != null && missing.length() > 0) {
            List<String> fields = new ArrayList<>();
            for (int index = 0; index < missing.length(); index++) {
                fields.add(profileFieldLabel(missing.optString(index)));
            }
            TextView missingLabel = text(
                    "Tamamlayın: " + String.join(", ", fields),
                    12,
                    R.color.vip_warning
            );
            missingLabel.setSingleLine(true);
            missingLabel.setEllipsize(TextUtils.TruncateAt.END);
            info.addView(missingLabel, matchWrap());
        }
        top.addView(info, weighted(1f, 0));
        card.addView(top, matchWrap());
        card.addView(spacer(12));

        LinearLayout actions = horizontal();
        Button edit = compactButton("Düzenle", false);
        edit.setOnClickListener(view -> showEditProfileDialog(profile));
        actions.addView(edit, weighted(1f, 6));
        Button addImage = compactButton("Görsel", false);
        addImage.setEnabled(imageCount < 12);
        addImage.setOnClickListener(view ->
                beginProfileImageSelection(profile.optString("id", "")));
        actions.addView(addImage, weighted(1f, 6));
        Button preview = compactButton("Önizle", true);
        preview.setOnClickListener(view -> showProfilePreview(profile));
        actions.addView(preview, weighted(1f, 0));
        card.addView(actions, matchWrap());
        card.addView(spacer(8));

        Button analytics = compactButton("Analiz", false);
        analytics.setContentDescription(name + " profil analizini aç");
        analytics.setOnClickListener(view -> showProfileAnalytics(profile));
        card.addView(analytics, matchWrap());
        card.addView(spacer(8));

        boolean live = "live".equals(state);
        boolean ready = "ready".equals(state);
        Button publication = compactButton(
                live
                        ? "Yayından kaldır"
                        : ready
                        ? "Şimdi yayınla"
                        : "Yayınlamak için eksikleri tamamla",
                ready
        );
        publication.setEnabled(live || ready);
        publication.setOnClickListener(view ->
                changeProfilePublication(profile, !live));
        card.addView(publication, matchWrap());

        if (imageCount > 0) {
            cover.setClickable(true);
            cover.setFocusable(true);
            cover.setContentDescription(name + " görsellerini yönet");
            cover.setOnClickListener(view -> showImageManager(profile));
        }
        LinearLayout.LayoutParams params = (LinearLayout.LayoutParams) card.getLayoutParams();
        if (params == null) params = matchWrap();
        params.bottomMargin = dp(12);
        card.setLayoutParams(params);
        return card;
    }

    private void showProfileAnalytics(JSONObject profile) {
        if (demoMode) {
            Toast.makeText(
                    this,
                    "Analiz verileri yalnız giriş yapılmış müşteri hesabında açılır.",
                    Toast.LENGTH_LONG
            ).show();
            return;
        }
        SecureSessionStore.Session session = activeSession;
        String profileId = profile.optString("id", "").trim();
        if (session == null || profileId.isEmpty()) return;

        long requestGeneration = ++profileAnalyticsRequestGeneration;
        activeAnalyticsProfileId = profileId;
        profileAnalyticsOpen = true;
        showLoading("Profil analizi hazırlanıyor…");
        runIo(
                () -> CustomerApi.profileAnalytics(
                        this,
                        session.token,
                        profileId
                ),
                result -> {
                    if (!isActiveProfileAnalyticsRequest(profileId, requestGeneration)) return;
                    renderProfileAnalytics(profile, result, profileId, requestGeneration);
                },
                error -> {
                    if (!isActiveProfileAnalyticsRequest(profileId, requestGeneration)) return;
                    showDashboard();
                    Toast.makeText(
                            this,
                            profileAnalyticsError(error),
                            Toast.LENGTH_LONG
                    ).show();
                }
        );
    }

    private void renderProfileAnalytics(
            JSONObject fallbackProfile,
            JSONObject analytics,
            String profileId,
            long requestGeneration
    ) {
        if (!isActiveProfileAnalyticsRequest(profileId, requestGeneration)) return;
        JSONObject profile = analytics.optJSONObject("profile");
        JSONObject totals = analytics.optJSONObject("totals");
        JSONObject channels = analytics.optJSONObject("channels");
        JSONObject coverage = analytics.optJSONObject("coverage");
        JSONArray daily = analytics.optJSONArray("daily");
        if (profile == null || totals == null || channels == null || daily == null) {
            showDashboard();
            Toast.makeText(
                    this,
                    "Profil analiz yanıtı doğrulanamadı.",
                    Toast.LENGTH_LONG
            ).show();
            return;
        }

        String name = profile.optString(
                "name",
                fallbackProfile.optString("name", "Profil")
        ).trim();
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(color(R.color.vip_background));
        LinearLayout content = vertical(16);
        scroll.addView(content, matchWrap());

        LinearLayout header = horizontal();
        header.setGravity(Gravity.CENTER_VERTICAL);
        Button back = compactButton("‹  Geri", false);
        back.setOnClickListener(view -> showDashboard());
        header.addView(back, wrapWrap());
        LinearLayout labels = vertical(0);
        TextView title = text("Profil Analizi", 19, R.color.vip_text);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        ViewCompat.setAccessibilityHeading(title, true);
        labels.addView(title, matchWrap());
        TextView subtitle = text(
                name.isEmpty() ? "Profil" : name,
                13,
                R.color.vip_muted
        );
        subtitle.setSingleLine(true);
        subtitle.setEllipsize(TextUtils.TruncateAt.END);
        labels.addView(subtitle, matchWrap());
        LinearLayout.LayoutParams labelParams = weighted(1f, 0);
        labelParams.setMarginStart(dp(10));
        header.addView(labels, labelParams);
        content.addView(header, matchWrap());
        content.addView(spacer(12));
        content.addView(statusChip("Son 7 gün", R.color.vip_gold), wrapWrap());
        content.addView(spacer(12));

        if (coverage != null && !"complete".equals(coverage.optString("status", ""))) {
            content.addView(infoBanner(
                    "Veri birikiyor",
                    "Takip bu dönemin tamamını kapsamıyor; görünen sayılar yalnız kaydedilen site etkileşimleridir."
            ), matchWrap());
            content.addView(spacer(12));
        }

        LinearLayout totalsRow = horizontal();
        totalsRow.addView(statTile(
                "Görüntülenme",
                countLabel(totals.optLong("profile_views", 0)),
                R.color.vip_primary
        ), weighted(1f, 8));
        totalsRow.addView(statTile(
                "İletişim",
                countLabel(totals.optLong("contact_clicks", 0)),
                R.color.vip_success
        ), weighted(1f, 8));
        totalsRow.addView(statTile(
                "Oran",
                String.format(
                        Locale.getDefault(),
                        "%.1f%%",
                        totals.optDouble("action_rate", 0)
                ),
                R.color.vip_gold
        ), weighted(1f, 0));
        content.addView(totalsRow, matchWrap());
        content.addView(spacer(16));

        TextView channelTitle = text("İletişim kanalları", 17, R.color.vip_text);
        channelTitle.setTypeface(Typeface.DEFAULT_BOLD);
        ViewCompat.setAccessibilityHeading(channelTitle, true);
        content.addView(channelTitle, matchWrap());
        content.addView(spacer(8));
        LinearLayout channelRow = horizontal();
        channelRow.addView(statTile(
                "WhatsApp",
                countLabel(channels.optLong("whatsapp", 0)),
                R.color.vip_success
        ), weighted(1f, 8));
        channelRow.addView(statTile(
                "Telefon",
                countLabel(channels.optLong("phone", 0)),
                R.color.vip_primary
        ), weighted(1f, 8));
        channelRow.addView(statTile(
                "Telegram",
                countLabel(channels.optLong("telegram", 0)),
                R.color.vip_gold
        ), weighted(1f, 0));
        content.addView(channelRow, matchWrap());
        content.addView(spacer(16));

        TextView dailyTitle = text("Günlük hareket", 17, R.color.vip_text);
        dailyTitle.setTypeface(Typeface.DEFAULT_BOLD);
        ViewCompat.setAccessibilityHeading(dailyTitle, true);
        content.addView(dailyTitle, matchWrap());
        content.addView(spacer(8));
        LinearLayout dailyCard = card(12);
        dailyCard.addView(analyticsRow("Tarih", "Görüntülenme", "İletişim", true), matchWrap());
        for (int index = daily.length() - 1; index >= 0; index--) {
            JSONObject row = daily.optJSONObject(index);
            if (row == null) continue;
            dailyCard.addView(spacer(5));
            dailyCard.addView(analyticsRow(
                    shortDate(row.optString("date", "")),
                    countLabel(row.optLong("profile_views", 0)),
                    countLabel(row.optLong("contact_clicks", 0)),
                    false
            ), matchWrap());
        }
        content.addView(dailyCard, matchWrap());

        content.addView(spacer(24));
        profileAnalyticsOpen = true;
        setScreen(scroll);
    }

    private boolean isActiveProfileAnalyticsRequest(
            String profileId,
            long requestGeneration
    ) {
        return profileAnalyticsOpen &&
                requestGeneration == profileAnalyticsRequestGeneration &&
                profileId.equals(activeAnalyticsProfileId);
    }

    private void invalidateProfileAnalyticsRequest() {
        profileAnalyticsRequestGeneration++;
        activeAnalyticsProfileId = "";
        profileAnalyticsOpen = false;
    }

    private LinearLayout analyticsRow(
            String first,
            String second,
            String third,
            boolean heading
    ) {
        LinearLayout row = horizontal();
        TextView firstValue = text(first, heading ? 12 : 13, heading
                ? R.color.vip_muted
                : R.color.vip_text);
        TextView secondValue = text(second, heading ? 12 : 13, heading
                ? R.color.vip_muted
                : R.color.vip_text);
        TextView thirdValue = text(third, heading ? 12 : 13, heading
                ? R.color.vip_muted
                : R.color.vip_text);
        if (heading) {
            firstValue.setTypeface(Typeface.DEFAULT_BOLD);
            secondValue.setTypeface(Typeface.DEFAULT_BOLD);
            thirdValue.setTypeface(Typeface.DEFAULT_BOLD);
        }
        secondValue.setGravity(Gravity.END);
        thirdValue.setGravity(Gravity.END);
        row.addView(firstValue, weighted(1.35f, 8));
        row.addView(secondValue, weighted(1f, 8));
        row.addView(thirdValue, weighted(0.8f, 0));
        return row;
    }

    private String countLabel(long value) {
        return String.format(Locale.getDefault(), "%,d", Math.max(0, value));
    }

    private String shortDate(String value) {
        String[] parts = String.valueOf(value).split("-");
        return parts.length == 3 ? parts[2] + "." + parts[1] : value;
    }

    private String profileAnalyticsError(Exception error) {
        if (
                error instanceof CustomerApi.ApiException &&
                ((CustomerApi.ApiException) error).status == 404
        ) {
            return "Bu profile ait analiz bulunamadı.";
        }
        return userError(error, "Profil analizi alınamadı.");
    }

    private void changeProfilePublication(JSONObject profile, boolean publish) {
        String profileId = profile.optString("id", "").trim();
        if (profileId.isEmpty()) return;
        if (publish && !"ready".equals(profile.optString("state", "draft"))) {
            Toast.makeText(
                    this,
                    "Yayınlamadan önce eksik profil alanlarını tamamlayın.",
                    Toast.LENGTH_LONG
            ).show();
            return;
        }

        Runnable submit = () -> {
            if (demoMode) {
                try {
                    profile.put("is_live", publish);
                    profile.put("state", publish ? "live" : "ready");
                    recalculateDemoQuota(bootstrap);
                } catch (Exception ignored) {}
                showDashboard();
                return;
            }

            SecureSessionStore.Session session = activeSession;
            if (session == null) return;
            showLoading(publish ? "Profil yayınlanıyor…" : "Profil yayından kaldırılıyor…");
            runIo(
                    () -> CustomerApi.updateProfile(
                            this,
                            session.token,
                            profileId,
                            new JSONObject().put("is_active", publish)
                    ),
                    result -> refreshBootstrap(),
                    error -> {
                        showDashboard();
                        Toast.makeText(
                                this,
                                userError(
                                        error,
                                        publish
                                                ? "Profil yayınlanamadı."
                                                : "Profil yayından kaldırılamadı."
                                ),
                                Toast.LENGTH_LONG
                        ).show();
                    }
            );
        };

        if (publish) {
            submit.run();
            return;
        }

        new AlertDialog.Builder(this)
                .setTitle("Yayından kaldır")
                .setMessage("Profil siteden kaldırılsın mı? Bilgileriniz silinmez.")
                .setNegativeButton("Vazgeç", null)
                .setPositiveButton("Yayından kaldır", (dialog, which) -> submit.run())
                .show();
    }

    private void showCreateProfileDialog() {
        pendingImageProfileId = "";
        pendingNewProfileImageUri = null;
        EditText name = input("Profil adı", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_WORDS);
        name.setImeOptions(EditorInfo.IME_ACTION_DONE);
        LinearLayout body = vertical(4);

        FrameLayout photo = newProfilePhotoPicker();
        body.addView(photo, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(176)
        ));
        body.addView(spacer(12));
        body.addView(text(
                "Fotoğrafı şimdi seçebilirsiniz. Profil adı dışında kalan bilgileri daha sonra tamamlayın.",
                14,
                R.color.vip_muted
        ), matchWrap());
        body.addView(spacer(10));
        body.addView(name, matchWrap());

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("Yeni profil")
                .setView(body)
                .setNegativeButton("Vazgeç", null)
                .setPositiveButton("Profili oluştur", null)
                .create();
        dialog.setOnShowListener(ignored -> {
            lockCreateProfileOrientation();
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
                    String value = name.getText().toString().trim();
                    if (value.isEmpty()) {
                        name.setError("Profil adı gerekli.");
                        return;
                    }
                    if (
                            pendingNewProfileImageUri != null &&
                            pendingNewProfileImage == null
                    ) {
                        Toast.makeText(
                                this,
                                "Fotoğraf hazırlanıyor. Birkaç saniye sonra tekrar deneyin.",
                                Toast.LENGTH_SHORT
                        ).show();
                        return;
                    }
                    dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
                    Uri selectedImage = pendingNewProfileImageUri;
                    ProfileImageSanitizer.SanitizedImage preparedImage =
                            pendingNewProfileImage;
                    if (demoMode) {
                        addDemoProfile(value, selectedImage);
                        clearPendingNewProfileImage();
                        dialog.dismiss();
                        showDashboard();
                        return;
                    }
                    SecureSessionStore.Session session = activeSession;
                    if (session == null) return;
                    runIo(
                            () -> {
                                JSONObject created = CustomerApi.createProfile(
                                        this,
                                        session.token,
                                        new JSONObject().put("name", value)
                                );
                                if (preparedImage == null) {
                                    return new ProfileCreateResult(created, null);
                                }
                                JSONObject createdProfile = created.optJSONObject("profile");
                                String createdId = createdProfile == null
                                        ? ""
                                        : createdProfile.optString("id", "");
                                if (createdId.isEmpty()) {
                                    throw new SecurityException("Yeni profil kimliği alınamadı.");
                                }
                                try {
                                    CustomerApi.uploadProfileImage(
                                            this,
                                            session.token,
                                            createdId,
                                            preparedImage.contentType,
                                            preparedImage.bytes
                                    );
                                    return new ProfileCreateResult(created, null);
                                } catch (Exception imageError) {
                                    return new ProfileCreateResult(created, imageError);
                                }
                            },
                            result -> {
                                JSONObject createdProfile =
                                        result.response.optJSONObject("profile");
                                if (createdProfile != null) {
                                    selectedProfileId =
                                            createdProfile.optString("id", "").trim();
                                }
                                clearPendingNewProfileImage();
                                dialog.dismiss();
                                showLoading("Yeni profil yükleniyor…");
                                if (result.imageError != null) {
                                    Toast.makeText(
                                            this,
                                            "Profil oluşturuldu; fotoğraf yüklenemedi. Karttaki Görsel düğmesiyle tekrar deneyin.",
                                            Toast.LENGTH_LONG
                                    ).show();
                                }
                                refreshBootstrap();
                            },
                            error -> {
                                dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);
                                Toast.makeText(this, userError(error, "Profil oluşturulamadı."), Toast.LENGTH_LONG).show();
                            }
                    );
                });
        });
        dialog.setOnDismissListener(ignored -> {
            clearPendingNewProfileImage();
            unlockCreateProfileOrientation();
        });
        dialog.show();
    }

    private FrameLayout newProfilePhotoPicker() {
        FrameLayout frame = new FrameLayout(this);
        GradientDrawable background = new GradientDrawable();
        background.setColor(color(R.color.vip_surface_raised));
        background.setCornerRadius(dp(16));
        background.setStroke(dp(1), color(R.color.vip_outline));
        frame.setBackground(background);
        frame.setClickable(true);
        frame.setFocusable(true);
        frame.setContentDescription("Yeni profil fotoğrafı seç");

        ImageView image = new ImageView(this);
        image.setScaleType(ImageView.ScaleType.CENTER_CROP);
        image.setVisibility(View.GONE);
        frame.addView(image, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        TextView label = text("＋  Galeriden fotoğraf seç", 15, R.color.vip_text);
        label.setGravity(Gravity.CENTER);
        label.setTypeface(Typeface.DEFAULT_BOLD);
        label.setBackgroundColor(Color.argb(92, 11, 7, 16));
        frame.addView(label, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        pendingNewProfileImageView = image;
        pendingNewProfileImageLabel = label;
        frame.setOnClickListener(view -> {
            pendingImageProfileId = "";
            launchImagePicker();
        });
        return frame;
    }

    private void prepareNewProfileImage(Uri uri, ImageView target) {
        try {
            ProfileImageSanitizer.SanitizedImage prepared =
                    ProfileImageSanitizer.read(getContentResolver(), uri);
            Bitmap preview = decodePreviewBitmap(prepared.bytes);
            if (preview == null) throw new SecurityException("Görsel önizlemesi hazırlanamadı.");
            main.post(() -> {
                if (
                        destroyed ||
                        !uri.equals(pendingNewProfileImageUri) ||
                        target != pendingNewProfileImageView
                ) {
                    preview.recycle();
                    return;
                }
                pendingNewProfileImage = prepared;
                target.setImageBitmap(preview);
                target.setVisibility(View.VISIBLE);
                if (pendingNewProfileImageLabel != null) {
                    pendingNewProfileImageLabel.setText(
                            "Fotoğraf hazır • değiştirmek için dokunun"
                    );
                }
            });
        } catch (Exception error) {
            main.post(() -> {
                if (
                        !uri.equals(pendingNewProfileImageUri) ||
                        target != pendingNewProfileImageView
                ) {
                    return;
                }
                pendingNewProfileImageUri = null;
                pendingNewProfileImage = null;
                if (pendingNewProfileImageLabel != null) {
                    pendingNewProfileImageLabel.setText("＋  Başka bir fotoğraf seç");
                }
                Toast.makeText(
                        this,
                        userError(error, "Bu fotoğraf hazırlanamadı."),
                        Toast.LENGTH_LONG
                ).show();
            });
        }
    }

    @Nullable
    private Bitmap decodePreviewBitmap(byte[] bytes) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = 1;
        while (
                bounds.outWidth / options.inSampleSize > 960 ||
                bounds.outHeight / options.inSampleSize > 960
        ) {
            options.inSampleSize *= 2;
        }
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
    }

    private void beginProfileImageSelection(String profileId) {
        if (profileId == null || profileId.trim().isEmpty()) return;
        pendingImageProfileId = profileId.trim();
        launchImagePicker();
    }

    private void launchImagePicker() {
        Intent gallery = new Intent(Intent.ACTION_PICK);
        gallery.setDataAndType(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                "image/*"
        );
        gallery.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

        Intent fallback = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        fallback.addCategory(Intent.CATEGORY_OPENABLE);
        fallback.setType("image/*");
        fallback.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

        try {
            profileImagePicker.launch(gallery);
            return;
        } catch (ActivityNotFoundException noGalleryHandler) {
            try {
                profileImagePicker.launch(fallback);
                return;
            } catch (RuntimeException ignored) {
                // Show the common error below.
            }
        } catch (RuntimeException ignored) {
            // Show the common error below.
        }
        pendingImageProfileId = "";
        Toast.makeText(
                this,
                "Galeri açılamadı. Lütfen tekrar deneyin.",
                Toast.LENGTH_LONG
        ).show();
    }

    private void clearPendingNewProfileImage() {
        pendingNewProfileImageUri = null;
        pendingNewProfileImage = null;
        pendingNewProfileImageView = null;
        pendingNewProfileImageLabel = null;
    }

    private void lockCreateProfileOrientation() {
        if (createProfileOrientationLocked) return;
        createProfilePreviousOrientation = getRequestedOrientation();
        createProfileOrientationLocked = true;
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LOCKED);
    }

    private void unlockCreateProfileOrientation() {
        if (!createProfileOrientationLocked) return;
        int previous = createProfilePreviousOrientation;
        createProfileOrientationLocked = false;
        createProfilePreviousOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
        setRequestedOrientation(previous);
    }

    private void showEditProfileDialog(JSONObject profile) {
        ScrollView scroll = new ScrollView(this);
        LinearLayout body = vertical(8);
        scroll.addView(body, matchWrap());

        addFormSection(body, "Görseller");
        FrameLayout cover = profileCover(
                profile,
                profile.optString("name", "Profil"),
                0,
                190
        );
        body.addView(cover, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(190)
        ));
        body.addView(spacer(8));
        LinearLayout imageActions = horizontal();
        Button addImage = button("Görsel ekle");
        JSONArray images = profile.optJSONArray("images");
        int imageCount = images == null ? 0 : images.length();
        addImage.setEnabled(imageCount < 12);
        imageActions.addView(addImage, weighted(1f, imageCount > 0 ? 8 : 0));
        Button manageImages = imageCount > 0
                ? secondaryButton("Görselleri yönet")
                : null;
        if (imageCount > 0) {
            imageActions.addView(manageImages, weighted(1f, 0));
        }
        body.addView(imageActions, matchWrap());

        addFormSection(body, "Temel bilgiler");
        EditText name = field(body, "İsim", profile.optString("name", ""), false);
        EditText cardLabel = field(body, "Kısa başlık", profile.optString("card_label", ""), false);
        EditText age = field(
                body,
                "Yaş",
                profile.optString("age", ""),
                InputType.TYPE_CLASS_NUMBER
        );
        EditText height = field(
                body,
                "Boy",
                profile.optString("height", ""),
                InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL
        );
        EditText weight = field(
                body,
                "Kilo",
                profile.optString("weight", ""),
                InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL
        );

        addFormSection(body, "Konum");
        EditText city = field(body, "Şehir", profile.optString("city", ""), false);
        EditText district = field(body, "İlçe", profile.optString("district", ""), false);

        addFormSection(body, "İlan açıklaması");
        EditText description = field(body, "Açıklama", profile.optString("description", ""), true);

        addFormSection(body, "İletişim");
        body.addView(text(
                "Yalnız kullanmak istediğiniz iletişim alanlarını doldurun.",
                13,
                R.color.vip_muted
        ), matchWrap());
        EditText whatsapp = field(
                body,
                "WhatsApp",
                profile.optString("whatsapp", ""),
                InputType.TYPE_CLASS_PHONE
        );
        EditText phone = field(
                body,
                "Telefon",
                profile.optString("phone", ""),
                InputType.TYPE_CLASS_PHONE
        );
        EditText telegram = field(body, "Telegram", profile.optString("telegram", ""), false);
        telegram.setImeOptions(EditorInfo.IME_ACTION_DONE);

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("Profili düzenle")
                .setView(scroll)
                .setNegativeButton("Vazgeç", null)
                .setPositiveButton("Kaydet", null)
                .create();
        addImage.setOnClickListener(view -> {
            dialog.dismiss();
            beginProfileImageSelection(profile.optString("id", ""));
        });
        if (manageImages != null) {
            manageImages.setOnClickListener(view -> {
                dialog.dismiss();
                showImageManager(profile);
            });
        }
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE)
                .setOnClickListener(view -> {
                    try {
                        JSONObject payload = new JSONObject()
                                .put("name", name.getText().toString())
                                .put("card_label", cardLabel.getText().toString())
                                .put("age", age.getText().toString())
                                .put("height", height.getText().toString())
                                .put("weight", weight.getText().toString())
                                .put("city", city.getText().toString())
                                .put("district", district.getText().toString())
                                .put("description", description.getText().toString())
                                .put("whatsapp", whatsapp.getText().toString())
                                .put("phone", phone.getText().toString())
                                .put("telegram", telegram.getText().toString());
                        if (demoMode) {
                            updateDemoProfile(profile, payload);
                            dialog.dismiss();
                            showDashboard();
                            return;
                        }
                        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
                        runIo(
                                () -> CustomerApi.updateProfile(
                                        this,
                                        activeSession.token,
                                        profile.getString("id"),
                                        payload
                                ),
                                result -> {
                                    dialog.dismiss();
                                    showLoading("Profil yenileniyor…");
                                    refreshBootstrap();
                                },
                                error -> {
                                    dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);
                                    Toast.makeText(this, userError(error, "Profil kaydedilemedi."), Toast.LENGTH_LONG).show();
                                }
                        );
                    } catch (Exception error) {
                        Toast.makeText(this, "Profil verisi hazırlanamadı.", Toast.LENGTH_LONG).show();
                    }
                }));
        dialog.show();
    }

    private void onProfileImageSelected(Uri uri) {
        String profileId = pendingImageProfileId;
        pendingImageProfileId = "";
        if (uri == null) return;
        if (profileId.isEmpty() && pendingNewProfileImageView != null) {
            pendingNewProfileImageUri = uri;
            pendingNewProfileImage = null;
            ImageView target = pendingNewProfileImageView;
            if (pendingNewProfileImageLabel != null) {
                pendingNewProfileImageLabel.setText("Fotoğraf güvenli biçimde hazırlanıyor…");
            }
            thumbnailIo.execute(() -> prepareNewProfileImage(uri, target));
            return;
        }
        if (profileId.isEmpty()) {
            Toast.makeText(
                    this,
                    "Yeni profil ekranı yenilendi. Fotoğrafı tekrar seçin.",
                    Toast.LENGTH_LONG
            ).show();
            return;
        }
        if (demoMode) {
            updateDemoProfileImage(profileId, uri);
            showDashboard();
            return;
        }
        SecureSessionStore.Session session = activeSession;
        if (profileId.isEmpty() || session == null) return;

        ContentResolver resolver = getContentResolver();
        showLoading("Görsel yükleniyor…");
        runIo(
                () -> {
                    ProfileImageSanitizer.SanitizedImage image =
                            ProfileImageSanitizer.read(resolver, uri);
                    return CustomerApi.uploadProfileImage(
                            this,
                            session.token,
                            profileId,
                            image.contentType,
                            image.bytes
                    );
                },
                result -> refreshBootstrap(),
                error -> {
                    showDashboard();
                    Toast.makeText(
                            this,
                            userError(error, "Görsel yüklenemedi."),
                            Toast.LENGTH_LONG
                    ).show();
                }
        );
    }

    private void showImageManager(JSONObject profile) {
        JSONArray images = profile.optJSONArray("images");
        if (images == null || images.length() == 0) return;

        List<String> labels = new ArrayList<>();
        List<String> urls = new ArrayList<>();
        for (int index = 0; index < images.length(); index++) {
            String imageUrl = images.optString(index, "").trim();
            if (imageUrl.isEmpty()) continue;
            labels.add("Görsel " + (index + 1) + " kaldır");
            urls.add(imageUrl);
        }
        if (urls.isEmpty()) return;

        new AlertDialog.Builder(this)
                .setTitle("Görselleri Yönet")
                .setItems(labels.toArray(new String[0]), (dialog, which) ->
                        confirmRemoveProfileImage(
                                profile.optString("id", ""),
                                urls.get(which),
                                which + 1
                        ))
                .setNegativeButton("Kapat", null)
                .show();
    }

    private void confirmRemoveProfileImage(String profileId, String imageUrl, int imageNumber) {
        if (profileId.isEmpty() || imageUrl.isEmpty() || activeSession == null) return;
        new AlertDialog.Builder(this)
                .setTitle("Görseli Kaldır")
                .setMessage("Görsel " + imageNumber + " profilden kaldırılsın mı?")
                .setNegativeButton("Vazgeç", null)
                .setPositiveButton("Kaldır", (dialog, which) -> {
                    if (demoMode) {
                        removeDemoProfileImage(profileId, imageUrl);
                        showDashboard();
                        return;
                    }
                    SecureSessionStore.Session session = activeSession;
                    if (session == null) return;
                    showLoading("Görsel kaldırılıyor…");
                    runIo(
                            () -> CustomerApi.removeProfileImage(
                                    this,
                                    session.token,
                                    profileId,
                                    imageUrl
                            ),
                            result -> refreshBootstrap(),
                            error -> {
                                showDashboard();
                                Toast.makeText(
                                        this,
                                        userError(error, "Görsel kaldırılamadı."),
                                        Toast.LENGTH_LONG
                                ).show();
                            }
                    );
                })
                .show();
    }

    private void showProfilePreview(JSONObject profile) {
        if (demoMode) {
            Toast.makeText(
                    this,
                    "Gerçek site önizlemesi giriş yapılmış test hesabında açılır.",
                    Toast.LENGTH_LONG
            ).show();
            return;
        }
        SecureSessionStore.Session session = activeSession;
        String profileId = profile.optString("id", "").trim();
        if (session == null || profileId.isEmpty()) return;
        String name = profile.optString("name", "Profil önizlemesi");
        showLoading("Gerçek site önizlemesi hazırlanıyor…");
        runIo(
                () -> CustomerApi.profilePreviewUrl(this, profileId),
                url -> openProfilePreview(url, session.token, name),
                error -> {
                    showDashboard();
                    Toast.makeText(
                            this,
                            userError(error, "Önizleme açılamadı."),
                            Toast.LENGTH_LONG
                    ).show();
                }
        );
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void openProfilePreview(String url, String token, String profileName) {
        destroyPreviewWebView();

        LinearLayout screen = vertical(0);
        screen.setBackgroundColor(color(R.color.vip_background));
        LinearLayout toolbar = horizontal();
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(10), dp(8), dp(12), dp(8));
        toolbar.setBackgroundColor(color(R.color.vip_surface));

        Button back = compactButton("‹  Geri", false);
        back.setOnClickListener(view -> showDashboard());
        toolbar.addView(back, wrapWrap());

        TextView title = text(profileName, 16, R.color.vip_text);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setSingleLine(true);
        title.setEllipsize(TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams titleParams = weighted(1f, 0);
        titleParams.setMarginStart(dp(10));
        toolbar.addView(title, titleParams);
        screen.addView(toolbar, matchWrap());

        WebView webView = new WebView(this);
        previewWebView = webView;
        webView.setBackgroundColor(color(R.color.vip_background));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSaveFormData(false);
        settings.setUserAgentString(
                settings.getUserAgentString() + " VIP-Gece-Customer-Preview/1"
        );
        settings.setSafeBrowsingEnabled(true);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(
                    WebView view,
                    WebResourceRequest request
            ) {
                Uri target = request.getUrl();
                if (!"https".equalsIgnoreCase(target.getScheme())) {
                    Toast.makeText(
                            MainActivity.this,
                            "Önizleme içindeki bu bağlantı açılmadı.",
                            Toast.LENGTH_SHORT
                    ).show();
                    return true;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, target));
                } catch (RuntimeException ignored) {
                    Toast.makeText(
                            MainActivity.this,
                            "Bağlantıyı açan bir uygulama bulunamadı.",
                            Toast.LENGTH_SHORT
                    ).show();
                }
                return true;
            }

            @Override
            public void onReceivedSslError(
                    WebView view,
                    SslErrorHandler handler,
                    SslError error
            ) {
                handler.cancel();
            }
        });
        screen.addView(webView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f
        ));

        Map<String, String> headers = new HashMap<>();
        headers.put("Authorization", "Bearer " + token);
        setScreen(screen);
        webView.loadUrl(url, headers);
    }

    private void destroyPreviewWebView() {
        WebView webView = previewWebView;
        previewWebView = null;
        if (webView == null) return;
        webView.stopLoading();
        webView.setWebViewClient(new WebViewClient());
        webView.removeAllViews();
        webView.destroy();
    }

    private FrameLayout profileCover(
            JSONObject profile,
            String name,
            int widthDp,
            int heightDp
    ) {
        FrameLayout cover = new FrameLayout(this);
        GradientDrawable background = new GradientDrawable();
        background.setColor(color(R.color.vip_surface_raised));
        background.setCornerRadius(dp(13));
        background.setStroke(dp(1), color(R.color.vip_outline));
        cover.setBackground(background);
        cover.setClipToOutline(true);

        TextView placeholder = text(profileInitial(name), 28, R.color.vip_gold);
        placeholder.setTypeface(Typeface.DEFAULT_BOLD);
        placeholder.setGravity(Gravity.CENTER);
        cover.addView(placeholder, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        ImageView image = new ImageView(this);
        image.setScaleType(ImageView.ScaleType.CENTER_CROP);
        image.setContentDescription(name + " kapak görseli");
        image.setVisibility(View.GONE);
        cover.addView(image, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        String demoImage = profile.optString("demo_image_uri", "").trim();
        if (!demoImage.isEmpty()) {
            image.setImageURI(Uri.parse(demoImage));
            image.setVisibility(View.VISIBLE);
        } else {
            String thumbnail = profile.optString("cover_thumbnail_url", "").trim();
            if (!thumbnail.isEmpty()) loadThumbnail(image, thumbnail);
        }
        if (widthDp > 0 || heightDp > 0) {
            cover.setLayoutParams(new LinearLayout.LayoutParams(
                    widthDp > 0 ? dp(widthDp) : ViewGroup.LayoutParams.MATCH_PARENT,
                    heightDp > 0 ? dp(heightDp) : ViewGroup.LayoutParams.WRAP_CONTENT
            ));
        }
        return cover;
    }

    private void loadThumbnail(ImageView target, String url) {
        Bitmap cached = thumbnailCache.get(url);
        target.setTag(url);
        if (cached != null && !cached.isRecycled()) {
            target.setImageBitmap(cached);
            target.setVisibility(View.VISIBLE);
            return;
        }
        thumbnailIo.execute(() -> {
            try {
                byte[] bytes = CustomerApi.downloadThumbnail(this, url);
                Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                if (bitmap == null) return;
                thumbnailCache.put(url, bitmap);
                main.post(() -> {
                    if (
                            destroyed ||
                            !url.equals(target.getTag()) ||
                            bitmap.isRecycled()
                    ) {
                        return;
                    }
                    target.setImageBitmap(bitmap);
                    target.setVisibility(View.VISIBLE);
                });
            } catch (Exception ignored) {
                // The branded placeholder remains visible on a transient media failure.
            }
        });
    }

    private JSONObject demoBootstrap() {
        try {
            JSONArray profiles = new JSONArray()
                    .put(demoProfile(
                            "demo-1",
                            "Lara",
                            "live",
                            "İstanbul",
                            "Şişli",
                            "VIP buluşmalar",
                            4,
                            new JSONArray()
                    ))
                    .put(demoProfile(
                            "demo-2",
                            "Mira",
                            "ready",
                            "İstanbul",
                            "Beşiktaş",
                            "Özel davetler",
                            2,
                            new JSONArray()
                    ))
                    .put(demoProfile(
                            "demo-3",
                            "Arya",
                            "draft",
                            "İzmir",
                            "Konak",
                            "",
                            0,
                            new JSONArray().put("description").put("images")
                    ))
                    .put(demoProfile(
                            "demo-4",
                            "Selin",
                            "draft",
                            "Ankara",
                            "Çankaya",
                            "Yeni profil",
                            1,
                            new JSONArray().put("description")
                    ));
            JSONObject result = new JSONObject()
                    .put("account", new JSONObject().put("label", "Çoklu Profil Önizlemesi"))
                    .put("profiles", profiles);
            recalculateDemoQuota(result);
            return result;
        } catch (Exception ignored) {
            return new JSONObject();
        }
    }

    private JSONObject demoProfile(
            String id,
            String name,
            String state,
            String city,
            String district,
            String cardLabel,
            int imageCount,
            JSONArray missing
    ) throws Exception {
        JSONArray images = new JSONArray();
        for (int index = 0; index < imageCount; index++) {
            images.put("demo://" + id + "/" + index);
        }
        return new JSONObject()
                .put("id", id)
                .put("name", name)
                .put("state", state)
                .put("city", city)
                .put("district", district)
                .put("card_label", cardLabel)
                .put("images", images)
                .put("missing_fields", missing);
    }

    private void addDemoProfile(String name, @Nullable Uri imageUri) {
        try {
            JSONArray profiles = bootstrap.optJSONArray("profiles");
            if (profiles == null) {
                profiles = new JSONArray();
                bootstrap.put("profiles", profiles);
            }
            String id = "demo-" + (profiles.length() + 1);
            JSONObject profile = demoProfile(
                    id,
                    name,
                    "draft",
                    "",
                    "",
                    "",
                    imageUri == null ? 0 : 1,
                    new JSONArray().put("description")
            );
            if (imageUri != null) {
                profile.put("demo_image_uri", imageUri.toString());
                profile.put("images", new JSONArray().put(imageUri.toString()));
            }
            profiles.put(profile);
            selectedProfileId = id;
            recalculateDemoQuota(bootstrap);
        } catch (Exception ignored) {
            Toast.makeText(this, "Demo profil eklenemedi.", Toast.LENGTH_SHORT).show();
        }
    }

    private void updateDemoProfile(JSONObject profile, JSONObject payload) {
        try {
            java.util.Iterator<String> keys = payload.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                profile.put(key, payload.optString(key, ""));
            }
        } catch (Exception ignored) {
            Toast.makeText(this, "Demo profil güncellenemedi.", Toast.LENGTH_SHORT).show();
        }
    }

    private void updateDemoProfileImage(String profileId, Uri uri) {
        JSONObject profile = findDemoProfile(profileId);
        if (profile == null) return;
        try {
            JSONArray images = profile.optJSONArray("images");
            if (images == null) {
                images = new JSONArray();
                profile.put("images", images);
            }
            if (images.length() < 12) images.put(uri.toString());
            profile.put("demo_image_uri", uri.toString());
        } catch (Exception ignored) {
            Toast.makeText(this, "Demo görseli eklenemedi.", Toast.LENGTH_SHORT).show();
        }
    }

    private void removeDemoProfileImage(String profileId, String imageUrl) {
        JSONObject profile = findDemoProfile(profileId);
        if (profile == null) return;
        JSONArray source = profile.optJSONArray("images");
        if (source == null) return;
        JSONArray remaining = new JSONArray();
        for (int index = 0; index < source.length(); index++) {
            String candidate = source.optString(index, "");
            if (!imageUrl.equals(candidate)) remaining.put(candidate);
        }
        try {
            profile.put("images", remaining);
            if (imageUrl.equals(profile.optString("demo_image_uri", ""))) {
                profile.remove("demo_image_uri");
            }
        } catch (Exception ignored) {}
    }

    @Nullable
    private JSONObject findDemoProfile(String profileId) {
        JSONArray profiles = bootstrap == null ? null : bootstrap.optJSONArray("profiles");
        if (profiles == null) return null;
        for (int index = 0; index < profiles.length(); index++) {
            JSONObject profile = profiles.optJSONObject(index);
            if (profile != null && profileId.equals(profile.optString("id", ""))) {
                return profile;
            }
        }
        return null;
    }

    private void recalculateDemoQuota(JSONObject target) throws Exception {
        JSONArray profiles = target.optJSONArray("profiles");
        int used = profiles == null ? 0 : profiles.length();
        int ready = 0;
        int live = 0;
        for (int index = 0; profiles != null && index < profiles.length(); index++) {
            JSONObject profile = profiles.optJSONObject(index);
            String state = profile == null ? "" : profile.optString("state", "");
            if ("ready".equals(state)) ready++;
            if ("live".equals(state)) live++;
        }
        target.put("quota", new JSONObject()
                .put("limit", 10)
                .put("used", used)
                .put("remaining", Math.max(0, 10 - used))
                .put("ready", ready)
                .put("live", live));
    }

    private void beginSupportSession() {
        if (activeSession == null) return;
        showLoading("İki taraf onaylı destek oturumu hazırlanıyor…");
        JSONObject device = new JSONObject();
        try {
            device.put("app_version", BuildConfig.VERSION_NAME);
            device.put("android_version", Build.VERSION.RELEASE);
            device.put("device_model", Build.MANUFACTURER + " " + Build.MODEL);
        } catch (Exception ignored) {}

        runIo(
                () -> CustomerApi.createSupportSession(this, activeSession.token, device),
                result -> {
                    JSONObject session = result.optJSONObject("session");
                    if (session == null) {
                        showDashboard();
                        Toast.makeText(this, "Destek oturumu oluşturulamadı.", Toast.LENGTH_LONG).show();
                        return;
                    }
                    showDashboard();
                    showSupportDialog(session);
                },
                error -> {
                    showDashboard();
                    Toast.makeText(this, userError(error, "Destek oturumu açılamadı."), Toast.LENGTH_LONG).show();
                }
        );
    }

    private void showSupportDialog(JSONObject initial) {
        String sessionId = initial.optString("id", "");
        LinearLayout body = vertical(8);
        TextView state = text("", 15, R.color.vip_text);
        TextView code = text("Destek kodu: " + initial.optString("code", ""), 24, R.color.vip_primary);
        code.setTypeface(Typeface.DEFAULT_BOLD);
        body.addView(text(
                "Destek oturumu yalnız sizin onayınızla başlar. Ekranınıza, kameranıza, mikrofonunuza veya kişisel dosyalarınıza erişilmez.",
                14,
                R.color.vip_muted
        ), matchWrap());
        body.addView(code, matchWrap());
        body.addView(state, matchWrap());

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle(R.string.support_title)
                .setView(body)
                .setNegativeButton("Oturumu Kapat", null)
                .create();
        dialog.setCancelable(false);
        dialog.setCanceledOnTouchOutside(false);
        final boolean[] uploaded = { false };
        final Runnable[] poll = new Runnable[1];
        poll[0] = () -> {
            if (!dialog.isShowing() || activeSession == null) return;
            runIo(
                    () -> CustomerApi.getSupportSession(this, activeSession.token, sessionId),
                    result -> {
                        JSONObject session = result.optJSONObject("session");
                        String value = session == null ? "unknown" : session.optString("state", "unknown");
                        state.setText(supportStateLabel(value));
                        if ("active".equals(value) && !uploaded[0]) {
                            uploaded[0] = true;
                            uploadDiagnostics(sessionId);
                        }
                        if (!"closed".equals(value) && !"expired".equals(value)) {
                            main.postDelayed(poll[0], 5_000);
                        }
                    },
                    error -> {
                        state.setText("Durum geçici olarak alınamadı; yeniden deneniyor.");
                        main.postDelayed(poll[0], 8_000);
                    }
            );
        };
        dialog.setOnShowListener(ignored -> {
            dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setOnClickListener(view -> {
                main.removeCallbacks(poll[0]);
                SecureSessionStore.Session session = activeSession;
                if (session != null) {
                    runIo(
                            () -> CustomerApi.closeSupportSession(this, session.token, sessionId),
                            result -> dialog.dismiss(),
                            error -> dialog.dismiss()
                    );
                } else {
                    dialog.dismiss();
                }
            });
            poll[0].run();
        });
        dialog.setOnDismissListener(ignored -> main.removeCallbacks(poll[0]));
        dialog.show();
    }

    private void uploadDiagnostics(String sessionId) {
        SecureSessionStore.Session session = activeSession;
        if (session == null) return;
        JSONObject snapshot = new JSONObject();
        try {
            snapshot.put("app_version", BuildConfig.VERSION_NAME);
            snapshot.put("android_version", Build.VERSION.RELEASE);
            snapshot.put("device_model", Build.MANUFACTURER + " " + Build.MODEL);
            snapshot.put("active_origin", EndpointResolver.activeOrigin(this));
            snapshot.put("api_status", "authenticated");
            snapshot.put("update_status", "native-signed-update-engine");
            snapshot.put("config_revision", "signed");
            snapshot.put("errors", new JSONArray());
        } catch (Exception ignored) {}
        runIo(
                () -> CustomerApi.uploadSupportSnapshot(this, session.token, sessionId, snapshot),
                result -> {},
                error -> {}
        );
    }

    private String supportStateLabel(String state) {
        if ("waiting_support_approval".equals(state)) return "Destek görevlisinin onayı bekleniyor.";
        if ("active".equals(state)) return "Oturum aktif: izinli uygulama tanılaması paylaşılıyor.";
        if ("expired".equals(state)) return "Oturumun süresi doldu.";
        if ("closed".equals(state)) return "Oturum kapatıldı.";
        return "Destek oturumu hazırlanıyor.";
    }

    private EditText field(LinearLayout parent, String label, String value, boolean multiline) {
        TextView fieldLabel = text(label, 13, R.color.vip_muted);
        EditText input = input(
                label,
                multiline
                        ? InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE
                        : InputType.TYPE_CLASS_TEXT
        );
        input.setId(View.generateViewId());
        fieldLabel.setLabelFor(input.getId());
        parent.addView(fieldLabel, matchWrap());
        input.setText(value);
        if (multiline) {
            input.setMinLines(3);
            input.setGravity(Gravity.TOP);
        } else {
            input.setImeOptions(EditorInfo.IME_ACTION_NEXT);
        }
        parent.addView(input, matchWrap());
        return input;
    }

    private EditText field(LinearLayout parent, String label, String value, int inputType) {
        TextView fieldLabel = text(label, 13, R.color.vip_muted);
        EditText input = input(label, inputType);
        input.setId(View.generateViewId());
        input.setImeOptions(EditorInfo.IME_ACTION_NEXT);
        fieldLabel.setLabelFor(input.getId());
        parent.addView(fieldLabel, matchWrap());
        input.setText(value);
        parent.addView(input, matchWrap());
        return input;
    }

    private void addFormSection(LinearLayout parent, String label) {
        parent.addView(spacer(8));
        TextView title = text(label, 17, R.color.vip_text);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        ViewCompat.setAccessibilityHeading(title, true);
        parent.addView(title, matchWrap());
        parent.addView(spacer(4));
    }

    private void setScreen(View screen) {
        int left = screen.getPaddingLeft();
        int top = screen.getPaddingTop();
        int right = screen.getPaddingRight();
        int bottom = screen.getPaddingBottom();
        ViewCompat.setOnApplyWindowInsetsListener(screen, (view, windowInsets) -> {
            Insets bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(
                    left + bars.left,
                    top + bars.top,
                    right + bars.right,
                    bottom + bars.bottom
            );
            return windowInsets;
        });
        getWindow().setStatusBarColor(color(R.color.vip_background));
        getWindow().setNavigationBarColor(color(R.color.vip_background));
        setContentView(screen);
        ViewCompat.requestApplyInsets(screen);
    }

    private LinearLayout dashboardHeader(String accountLabel) {
        LinearLayout header = horizontal();
        header.setGravity(Gravity.CENTER_VERTICAL);

        ImageView logo = brandLogo(52);
        header.addView(logo, new LinearLayout.LayoutParams(dp(52), dp(52)));

        LinearLayout labels = vertical(0);
        TextView brand = text("VIP GECE", 18, R.color.vip_primary);
        brand.setTypeface(Typeface.DEFAULT_BOLD);
        labels.addView(brand, matchWrap());
        TextView account = text(accountLabel, 14, R.color.vip_text);
        account.setSingleLine(true);
        account.setEllipsize(TextUtils.TruncateAt.END);
        labels.addView(account, matchWrap());
        labels.addView(text("Bağlantınız korunuyor", 11, R.color.vip_success), matchWrap());
        LinearLayout.LayoutParams labelParams = weighted(1f, 0);
        labelParams.setMarginStart(dp(12));
        header.addView(labels, labelParams);
        return header;
    }

    private LinearLayout infoBanner(String titleValue, String detailValue) {
        LinearLayout banner = card(12);
        TextView title = text(titleValue, 16, R.color.vip_text);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        banner.addView(title, matchWrap());
        banner.addView(spacer(4));
        banner.addView(text(detailValue, 13, R.color.vip_muted), matchWrap());
        return banner;
    }

    private LinearLayout statTile(String label, String value, int accentColor) {
        LinearLayout tile = vertical(8);
        tile.setGravity(Gravity.CENTER);
        GradientDrawable background = new GradientDrawable();
        background.setColor(color(R.color.vip_surface_raised));
        background.setCornerRadius(dp(11));
        background.setStroke(dp(1), color(R.color.vip_outline));
        tile.setBackground(background);

        TextView number = text(value, 18, accentColor);
        number.setTypeface(Typeface.DEFAULT_BOLD);
        number.setGravity(Gravity.CENTER);
        tile.addView(number, matchWrap());
        TextView caption = text(label, 11, R.color.vip_muted);
        caption.setGravity(Gravity.CENTER);
        tile.addView(caption, matchWrap());
        return tile;
    }

    private TextView statusChip(String label, int accentColor) {
        TextView chip = text(label, 11, accentColor);
        chip.setTypeface(Typeface.DEFAULT_BOLD);
        chip.setPadding(dp(8), dp(4), dp(8), dp(4));
        GradientDrawable background = new GradientDrawable();
        int accent = color(accentColor);
        background.setColor(Color.argb(
                34,
                Color.red(accent),
                Color.green(accent),
                Color.blue(accent)
        ));
        background.setCornerRadius(dp(99));
        background.setStroke(dp(1), Color.argb(
                100,
                Color.red(accent),
                Color.green(accent),
                Color.blue(accent)
        ));
        chip.setBackground(background);
        return chip;
    }

    private String profileArea(JSONObject profile) {
        String city = profile.optString("city", "").trim();
        String district = profile.optString("district", "").trim();
        if (city.isEmpty()) return district;
        if (district.isEmpty() || city.equalsIgnoreCase(district)) return city;
        return district + ", " + city;
    }

    private String profileInitial(String name) {
        String normalized = String.valueOf(name == null ? "" : name).trim();
        return normalized.isEmpty()
                ? "VIP"
                : normalized.substring(0, 1).toUpperCase(Locale.forLanguageTag("tr-TR"));
    }

    private LinearLayout vertical(int paddingDp) {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(dp(paddingDp), dp(paddingDp), dp(paddingDp), dp(paddingDp));
        return layout;
    }

    private LinearLayout horizontal() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.HORIZONTAL);
        layout.setGravity(Gravity.CENTER);
        return layout;
    }

    private LinearLayout card(int paddingDp) {
        LinearLayout card = vertical(paddingDp);
        GradientDrawable background = new GradientDrawable();
        background.setColor(color(R.color.vip_surface));
        background.setCornerRadius(dp(14));
        background.setStroke(dp(1), color(R.color.vip_outline));
        card.setBackground(background);
        return card;
    }

    private TextView text(String value, int sizeSp, int colorResource) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sizeSp);
        view.setTextColor(color(colorResource));
        view.setLineSpacing(0, 1.15f);
        return view;
    }

    private EditText input(String hint, int inputType) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setHintTextColor(color(R.color.vip_muted));
        input.setTextColor(color(R.color.vip_text));
        input.setInputType(inputType);
        input.setSingleLine((inputType & InputType.TYPE_TEXT_FLAG_MULTI_LINE) == 0);
        input.setPadding(dp(12), dp(10), dp(12), dp(10));
        GradientDrawable background = new GradientDrawable();
        background.setColor(color(R.color.vip_surface_raised));
        background.setCornerRadius(dp(10));
        background.setStroke(dp(1), color(R.color.vip_outline));
        input.setBackground(background);
        return input;
    }

    private Button button(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(color(R.color.vip_on_primary));
        button.setAllCaps(false);
        GradientDrawable background = new GradientDrawable();
        background.setColor(color(R.color.vip_primary));
        background.setCornerRadius(dp(10));
        button.setBackground(background);
        return button;
    }

    private Button secondaryButton(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(color(R.color.vip_primary));
        button.setAllCaps(false);
        GradientDrawable background = new GradientDrawable();
        background.setColor(color(R.color.vip_surface));
        background.setCornerRadius(dp(10));
        background.setStroke(dp(1), color(R.color.vip_outline));
        button.setBackground(background);
        return button;
    }

    private Button compactButton(String label, boolean primary) {
        Button button = primary ? button(label) : secondaryButton(label);
        button.setTextSize(12);
        button.setMinWidth(0);
        button.setMinimumWidth(0);
        button.setMinHeight(dp(44));
        button.setMinimumHeight(dp(44));
        button.setPadding(dp(5), 0, dp(5), 0);
        return button;
    }

    private ImageView brandLogo(int heightDp) {
        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.vip_gece_logo);
        logo.setContentDescription(getString(R.string.brand_logo_description));
        logo.setAdjustViewBounds(true);
        logo.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        logo.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(heightDp)
        ));
        return logo;
    }

    private String profileFieldLabel(String field) {
        if ("name".equals(field)) return "İsim";
        if ("slug".equals(field)) return "Profil bağlantısı";
        if ("description".equals(field)) return "Açıklama";
        if ("images".equals(field)) return "Görsel";
        return "Profil bilgisi";
    }

    private View spacer(int heightDp) {
        View spacer = new View(this);
        spacer.setLayoutParams(new LinearLayout.LayoutParams(1, dp(heightDp)));
        return spacer;
    }

    private int color(int resource) {
        String theme = uiTheme();
        if (THEME_BURGUNDY.equals(theme)) {
            if (resource == R.color.vip_background) return Color.parseColor("#18070B");
            if (resource == R.color.vip_surface) return Color.parseColor("#300911");
            if (resource == R.color.vip_surface_raised) return Color.parseColor("#48101E");
            if (resource == R.color.vip_primary) return Color.parseColor("#FF315F");
            if (resource == R.color.vip_on_primary) return Color.WHITE;
            if (resource == R.color.vip_text) return Color.parseColor("#FFF7F8");
            if (resource == R.color.vip_muted) return Color.parseColor("#DDB9C1");
            if (resource == R.color.vip_success) return Color.parseColor("#67E2A3");
            if (resource == R.color.vip_warning) return Color.parseColor("#FFC766");
            if (resource == R.color.vip_gold) return Color.parseColor("#E6C477");
            if (resource == R.color.vip_outline) return Color.parseColor("#8F3348");
        }
        if (THEME_HIGH_CONTRAST.equals(theme)) {
            if (resource == R.color.vip_background) return Color.BLACK;
            if (resource == R.color.vip_surface) return Color.parseColor("#080808");
            if (resource == R.color.vip_surface_raised) return Color.parseColor("#141414");
            if (resource == R.color.vip_primary) return Color.parseColor("#FFE600");
            if (resource == R.color.vip_on_primary) return Color.BLACK;
            if (resource == R.color.vip_text || resource == R.color.vip_muted) return Color.WHITE;
            if (resource == R.color.vip_success) return Color.parseColor("#66FF99");
            if (resource == R.color.vip_warning) return Color.parseColor("#FFD400");
            if (resource == R.color.vip_gold) return Color.parseColor("#FFE600");
            if (resource == R.color.vip_outline) return Color.WHITE;
        }
        return getResources().getColor(resource, getTheme());
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
    }

    private LinearLayout.LayoutParams wrapWrap() {
        return new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
    }

    private LinearLayout.LayoutParams weighted(float weight, int marginEndDp) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                0,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                weight
        );
        params.setMarginEnd(dp(marginEndDp));
        return params;
    }

    private <T> void runIo(Callable<T> work, Consumer<T> success, Consumer<Exception> failure) {
        io.execute(() -> {
            try {
                T result = work.call();
                main.post(() -> {
                    if (!destroyed) success.accept(result);
                });
            } catch (Exception error) {
                main.post(() -> {
                    if (!destroyed) failure.accept(error);
                });
            }
        });
    }

    private String safeError(Exception error, String fallback) {
        String message = error == null ? "" : String.valueOf(error.getMessage()).trim();
        return message.isEmpty() ? fallback : message;
    }

    private String userError(Exception error, String fallback) {
        if (
                error instanceof CustomerApi.ApiException ||
                error instanceof SecurityException
        ) {
            return safeError(error, fallback);
        }
        return fallback;
    }

    private static final class ProfileCreateResult {
        final JSONObject response;
        final Exception imageError;

        ProfileCreateResult(JSONObject response, @Nullable Exception imageError) {
            this.response = response;
            this.imageError = imageError;
        }
    }
}
