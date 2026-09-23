package com.vipgece.customer;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.*;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.InputStream;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final int PICK_PHOTO = 41;
    private PanelUi ui;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final ExecutorService photoIo = Executors.newFixedThreadPool(2);
    private volatile int screenVersion;
    private SessionVault vault;
    private ApiClient api;
    private String token = "";
    private String accountId = "";
    private boolean customerReady, resumed, uploadsAuthenticatedAgain;
    private int queueGeneration;
    private final android.os.Handler queueHandler=new android.os.Handler(android.os.Looper.getMainLooper());
    private java.util.List<PendingPhotoStore.Entry> pendingUploads=java.util.Collections.emptyList();
    private final java.util.Set<String> observedUploads=new java.util.HashSet<>();
    private String queueSignature="";
    private LinearLayout root, content, toolbar, footer, tabs;
    private ScrollView scroll;
    private TextView status;
    private ProgressBar progress;
    private boolean busy;
    private JSONObject selectedProfile;
    private Uri selectedPhoto;
    private String uploadId = "";
    private String pendingProfileId = "";
    private String pickingProfileId = "";
    private String uploadType = "";
    private JSONObject lastBootstrap;
    private final Map<String,String> draft = new LinkedHashMap<>();
    private final Map<String,EditText> activeFields = new LinkedHashMap<>();
    private int editorTab;
    private int profileFilter;
    private boolean dirty;
    private TextView draftStatus;
    private static final String[][] PROFILE_FIELDS = {{"name","Profil adı"},{"city","İl"},{"district","İlçe"},{"age","Yaş"},{"height","Boy (cm)"},{"weight","Kilo (kg)"},{"description","Açıklama"},{"phone","Telefon"},{"whatsapp","WhatsApp"},{"telegram","Telegram"}};

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        ui = new PanelUi(this);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        vault = new SessionVault(this);
        try { api = new ApiClient(BuildConfig.GATEWAY_URL); } catch (IllegalArgumentException ignored) { api = null; }
        SessionVault.Session savedSession=vault.read();token=savedSession.token;accountId=savedSession.accountId;
        if (state != null) {
            String uri = state.getString("photo", "");
            if (!uri.isEmpty()) selectedPhoto = Uri.parse(uri);
            uploadId = state.getString("upload", "");
            pendingProfileId = state.getString("profile", "");
            pickingProfileId = state.getString("picking", "");
            uploadType = state.getString("mime", "");
        }
        frame();
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::navigateBack);
        }
        if (api == null || token.isEmpty()) login(); else loadProfiles();
        UpdateEngine.schedule(this);
        FirebaseUpdates.start(this);
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private LinearLayout vertical() { LinearLayout view = new LinearLayout(this); view.setOrientation(LinearLayout.VERTICAL); return view; }
    private TextView text(String value, int size) {
        TextView view = new TextView(this);
        view.setText(value); view.setTextSize(size); view.setTextColor(PanelUi.TEXT); view.setPadding(0, dp(8), 0, dp(8));
        return view;
    }
    private void frame() {
        root = vertical(); root.setBackgroundColor(PanelUi.BG);
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        toolbar = new LinearLayout(this); toolbar.setGravity(Gravity.CENTER_VERTICAL); toolbar.setPadding(dp(20), dp(8), dp(12), dp(8));
        root.addView(toolbar);
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setIndeterminate(true); progress.setVisibility(View.INVISIBLE);
        root.addView(progress, new LinearLayout.LayoutParams(-1, dp(3)));
        tabs=ui.row(); tabs.setPadding(dp(20),0,dp(20),0); tabs.setVisibility(View.GONE); root.addView(tabs);
        scroll = new ScrollView(this); scroll.setFillViewport(true);
        content = vertical(); content.setPadding(dp(24), dp(20), dp(24), dp(32)); scroll.addView(content);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        status = text("", 14); status.setPadding(dp(24), dp(8), dp(24), dp(12)); status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        status.setTextColor(PanelUi.GOLD);
        root.addView(status);
        footer=ui.row(); footer.setPadding(dp(24),dp(12),dp(24),dp(12)); footer.setBackgroundColor(PanelUi.SURFACE); footer.setVisibility(View.GONE); root.addView(footer);
        setContentView(root);
        root.requestApplyInsets();
    }
    private void heading(String title, boolean back) {
        toolbar.removeAllViews();
        if (back) icon(toolbar, R.drawable.ic_arrow_back, "Geri", this::navigateBack);
        LinearLayout labels=vertical();
        TextView brand=ui.text("VIP GECE",12,PanelUi.PINK); brand.setTypeface(null,android.graphics.Typeface.BOLD); labels.addView(brand);
        TextView name=ui.title(title,18); labels.addView(name); toolbar.addView(labels,new LinearLayout.LayoutParams(0,-2,1));
        icon(toolbar,android.R.drawable.stat_sys_download_done,"Güncellemeler",()->startActivity(new Intent(this,UpdateActivity.class)));
        if (!token.isEmpty()) icon(toolbar, R.drawable.ic_logout, "Oturumu kapat", () -> {
            new AlertDialog.Builder(this).setMessage("Oturum kapat\u0131ls\u0131n m\u0131?")
                .setNegativeButton("Vazge\u00e7", null).setPositiveButton("Kapat", (d, w) -> {
                    vault.clear(); token = ""; accountId=""; clearPhoto(); login();
                }).show();
        });
    }
    private void icon(LinearLayout parent, int drawable, String label, Runnable action) {
        parent.addView(ui.icon(drawable,label,()->{if(!busy) action.run();}));
    }
    private EditText field(String label, String value, int type) {
        return ui.field(content,label,value,type);
    }
    private Button command(String title, Runnable action) {
        Button button=ui.button(title,true,()->{if(!busy)action.run();});
        LinearLayout.LayoutParams layout = new LinearLayout.LayoutParams(-1, -2); layout.topMargin = dp(20);
        content.addView(button, layout); button.setOnClickListener(v -> { if (!busy) action.run(); }); return button;
    }
    private void resetScreen() {
        screenVersion++;
        content.removeAllViews(); tabs.removeAllViews(); tabs.setVisibility(View.GONE); footer.removeAllViews(); footer.setVisibility(View.GONE);
        activeFields.clear(); scroll.scrollTo(0,0); message("");
    }
    private void section(String title,String subtitle) {
        content.addView(ui.title(title,24));
        if (!subtitle.isEmpty()) { content.addView(ui.space(8)); content.addView(ui.text(subtitle,14,PanelUi.MUTED)); }
        content.addView(ui.space(8));
    }
    private void login() {
        customerReady=false;stopQueueWatch();pendingUploads=java.util.Collections.emptyList();observedUploads.clear();queueSignature="";
        selectedProfile = null; lastBootstrap=null; profileFilter=0; draft.clear(); dirty=false; resetScreen(); heading("Müşteri paneli", false);
        content.addView(ui.space(20));
        TextView wordmark=ui.title("VIP GECE",40); wordmark.setTypeface(android.graphics.Typeface.create("serif",android.graphics.Typeface.BOLD));
        android.text.SpannableString brand=new android.text.SpannableString("VIP GECE"); brand.setSpan(new android.text.style.ForegroundColorSpan(PanelUi.PINK),4,8,0); wordmark.setText(brand);
        wordmark.setMaxLines(1); wordmark.setAutoSizeTextTypeUniformWithConfiguration(24,40,1,android.util.TypedValue.COMPLEX_UNIT_SP);
        content.addView(wordmark); ui.divider(content);
        section("Müşteri girişi","");
        EditText email = field("Giriş bağlantısı veya e-posta", "", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        email.setSaveEnabled(false);
        EditText password = field("\u015eifre", "", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        Button submit = command("Giri\u015f yap", () -> {
            String identifier = email.getText().toString().trim(); String secret = password.getText().toString();
            if (identifier.isEmpty() || secret.isEmpty()) { message("Giriş bağlantısı veya e-posta ve şifre gerekli."); return; }
            String accessToken = "";
            if (identifier.contains(":") || identifier.contains("/") || identifier.contains("#")) {
                try { accessToken = CustomerAccessLink.token(BuildConfig.GATEWAY_URL, identifier); }
                catch (IllegalArgumentException invalid) { message("Giriş bağlantısı geçersiz."); return; }
            }
            final String linkToken = accessToken;
            password.setText("");
            execute(() -> {
                JSONObject body = new JSONObject().put("identifier", linkToken.isEmpty() ? identifier : "").put("password", secret);
                if (!linkToken.isEmpty()) body.put("access_token", linkToken);
                return api.json("POST", "/api/customer/mobile/login", "", body);
            }, this::acceptSession);
        });
        submit.setEnabled(api != null);
        password.setImeOptions(android.view.inputmethod.EditorInfo.IME_ACTION_DONE);
        password.setOnEditorActionListener((v,id,event)->{if(id!=android.view.inputmethod.EditorInfo.IME_ACTION_DONE)return false;submit.performClick();return true;});
        message(api == null ? "Hizmet hen\u00fcz kullan\u0131ma a\u00e7\u0131lmad\u0131." : "");
    }
    private void acceptSession(JSONObject response) {
        try {
            String next = response.getJSONObject("session").getString("token");
            String nextAccount=response.getJSONObject("account").getString("id");
            vault.save(next,nextAccount); token = next;accountId=nextAccount;
            if (!response.getJSONObject("account").has("must_change_password") || response.getJSONObject("account").optBoolean("must_change_password", true)) changePassword();
            else loadProfiles();
        } catch (Exception error) { vault.clear(); token = ""; login(); message("Oturum g\u00fcvenli olarak kaydedilemedi."); }
    }
    private void changePassword() {
        customerReady=false;stopQueueWatch();
        selectedProfile = null; resetScreen(); heading("Hesap güvenliği", false);
        content.addView(ui.symbol(R.drawable.ic_lock,PanelUi.GOLD,36)); content.addView(ui.space(20));
        section("Yeni şifreniz","İlk giriş · Şifre yenileme gerekli");
        EditText previous = field("Ge\u00e7ici / mevcut \u015fifre", "", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        EditText next = field("Yeni \u015fifre", "", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        EditText repeat = field("Yeni \u015fifre tekrar", "", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        content.addView(ui.space(10)); content.addView(ui.text("En az 12 karakter",13,PanelUi.MUTED));
        command("\u015eifreyi yenile", () -> {
            String oldValue = previous.getText().toString(), newValue = next.getText().toString();
            if (newValue.length() < 12 || newValue.length() > 1024) { message("Yeni \u015fifre en az 12 karakter olmal\u0131."); return; }
            if (!newValue.equals(repeat.getText().toString()) || oldValue.equals(newValue)) { message("\u015eifreler e\u015fle\u015fmeli ve eski \u015fifreden farkl\u0131 olmal\u0131."); return; }
            previous.setText(""); next.setText(""); repeat.setText("");
            execute(() -> api.json("POST", "/api/customer/mobile/password", token, new JSONObject().put("current_password", oldValue).put("new_password", newValue)), this::acceptSession);
        });
        message("\u0130lk giri\u015fte \u015fifre yenilemeniz gerekiyor.");
    }
    private void loadProfiles() {
        if (api == null || token.isEmpty()) { login(); return; }
        execute(() -> api.json("GET", "/api/customer/mobile/bootstrap", token, null), this::profiles);
    }
    private void profiles(JSONObject response) {
        if(api!=null) {
            try {
                String owner=response.getJSONObject("account").getString("id");
                vault.save(token,owner);accountId=owner;customerReady=true;uploadsAuthenticatedAgain=true;startQueueWatch();
            }catch(Exception invalid){vault.clear();token="";accountId="";login();return;}
        }
        lastBootstrap=response; selectedProfile=null; draft.clear(); dirty=false; resetScreen(); heading("Müşteri paneli",false);
        icon(toolbar,R.drawable.ic_refresh,"Yenile",this::loadProfiles);
        JSONArray list = response.optJSONArray("profiles");
        JSONObject quota = response.optJSONObject("quota");
        section("Profillerim", "");
        int live=0,total=list==null?0:list.length();
        if(list!=null) for(int i=0;i<list.length();i++)if(list.optJSONObject(i)!=null&&list.optJSONObject(i).optBoolean("is_live")) live++;
        LinearLayout stats=ui.row();
        stat(stats,"Kullanılan",quota==null?String.valueOf(total):quota.optInt("used")+" / "+(quota.optBoolean("unlimited")?"Sınırsız":String.valueOf(quota.optInt("limit"))),PanelUi.PINK);
        stat(stats,"Yayında",String.valueOf(live),PanelUi.GREEN); stat(stats,"Taslak",String.valueOf(total-live),PanelUi.GOLD);
        content.addView(ui.space(12)); content.addView(stats); ui.divider(content);
        LinearLayout filters=ui.row();
        String[] filterNames={"Tümü","Yayında","Taslak"};
        for(int i=0;i<filterNames.length;i++) {
            int index=i; Button filter=ui.button(filterNames[i],profileFilter==i,()->{profileFilter=index;profiles(response);});
            filter.setTextSize(13); filter.setPadding(dp(6),dp(8),dp(6),dp(8)); filter.setSelected(profileFilter==i);
            LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(0,-2,1); if(i<2)p.setMarginEnd(dp(8)); filters.addView(filter,p);
        }
        content.addView(filters); content.addView(ui.space(20));
        int shown=0;
        if (list != null) for (int i = 0; i < list.length(); i++) {
            JSONObject profile = list.optJSONObject(i); if (profile == null) continue;
            boolean isLive=profile.optBoolean("is_live");
            if(profileFilter==1&&!isLive||profileFilter==2&&isLive)continue;
            shown++;
            LinearLayout row=ui.row(); row.setPadding(dp(14),dp(16),dp(8),dp(16)); row.setBackground(ui.surface(PanelUi.SURFACE,PanelUi.LINE));
            TextView initial=ui.title(profile.optString("name","?").isEmpty()?"?":profile.optString("name").substring(0,1).toUpperCase(java.util.Locale.forLanguageTag("tr")),26);
            initial.setTextColor(PanelUi.PINK); initial.setGravity(Gravity.CENTER); initial.setBackground(ui.surface(PanelUi.RAISED,0));
            LinearLayout.LayoutParams avatar=new LinearLayout.LayoutParams(dp(52),dp(72)); avatar.setMarginEnd(dp(14)); row.addView(initial,avatar);
            LinearLayout details=vertical(); details.addView(ui.badge(isLive?"Yayında":"Taslak",isLive?PanelUi.GREEN:PanelUi.GOLD),new LinearLayout.LayoutParams(-2,-2));
            details.addView(ui.space(8)); details.addView(ui.title(profile.optString("name"),18));
            details.addView(ui.space(4)); details.addView(ui.text(area(profile),13,PanelUi.MUTED));
            int images = profile.optJSONArray("images") == null ? 0 : profile.optJSONArray("images").length();
            details.addView(ui.space(8)); details.addView(ui.text(images+" / 12 görsel",12,PanelUi.MUTED)); row.addView(details,new LinearLayout.LayoutParams(0,-2,1));
            row.addView(ui.symbol(R.drawable.ic_chevron_right,PanelUi.MUTED,24));
            row.setContentDescription(profile.optString("name") + ", profili a\u00e7"); row.setFocusable(true);
            row.setOnClickListener(v -> { if (!busy) editProfile(profile); });
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.bottomMargin = dp(12); content.addView(row, params);
            if (profile.optString("id").equals(pendingProfileId) && selectedPhoto != null) details.addView(ui.text("Bekleyen fotoğraf",12,PanelUi.GOLD));
        }
        if(shown==0) {
            LinearLayout empty=vertical(); empty.setGravity(Gravity.CENTER); empty.setPadding(0,dp(28),0,dp(28));
            empty.addView(ui.symbol(R.drawable.ic_person_outline,PanelUi.MUTED,48)); empty.addView(ui.space(16));
            empty.addView(ui.title(total==0?"Henüz profil yok":"Bu görünümde profil yok",18)); content.addView(empty);
        }
        if(quota!=null&&(quota.optBoolean("unlimited")||quota.optInt("remaining")>0)) {
            footer.setVisibility(View.VISIBLE); Button add=ui.button("Profil ekle",true,()->{if(!busy)newProfile();});
            ui.buttonIcon(add,R.drawable.ic_add,true);
            footer.addView(add,new LinearLayout.LayoutParams(-1,-2));
        }
        message("");
    }
    private String area(JSONObject p) { String city=p.optString("city"),district=p.optString("district"); return district.isEmpty()?city:city.isEmpty()?district:district+", "+city; }
    private void stat(LinearLayout row,String label,String value,int color) {
        LinearLayout col=vertical(); col.addView(ui.text(value,26,color)); col.addView(ui.space(5)); col.addView(ui.text(label,12,PanelUi.MUTED)); row.addView(col,new LinearLayout.LayoutParams(0,-2,1));
    }
    private void newProfile() {
        LinearLayout box=vertical(); box.setPadding(dp(24),0,dp(24),dp(20));
        EditText name=ui.field(box,"Profil adı","",InputType.TYPE_CLASS_TEXT);
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle("Yeni profil").setView(box).setNegativeButton("Vazgeç",null).setPositiveButton("Oluştur",null).create();
        dialog.setOnShowListener(d->dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{
            if(busy)return; String value=name.getText().toString().trim();
            if(value.isEmpty()){name.setError("Profil adı gerekli.");return;}
            dialog.dismiss(); execute(()->api.json("POST","/api/customer/mobile/profiles",token,new JSONObject().put("name",value)),r->{lastBootstrap=null;JSONObject p=r.optJSONObject("profile");if(p!=null)editProfile(p);else loadProfiles();});
        })); dialog.show();
    }
    private void editProfile(JSONObject profile) {
        selectedProfile=profile; activeFields.clear(); draft.clear(); dirty=false; editorTab=0;
        for(String[] entry:PROFILE_FIELDS)draft.put(entry[0],profile.optString(entry[0]));
        renderEditor();
    }
    private void collectDraft() { for(Map.Entry<String,EditText> entry:activeFields.entrySet()) draft.put(entry.getKey(),entry.getValue().getText().toString()); }
    private void renderEditor() {
        collectDraft(); resetScreen(); JSONObject profile=selectedProfile; if(profile==null)return;
        heading(profile.optString("name","Profil"),true); tabs.setVisibility(View.VISIBLE);
        String[] labels={"Bilgiler","Görseller","İletişim"};
        for(int i=0;i<labels.length;i++) {
            int index=i; LinearLayout cell=vertical();
            Button tab=ui.button(labels[i],false,()->{if(!busy){editorTab=index;renderEditor();}});
            tab.setTextSize(13); tab.setPadding(0,dp(8),0,dp(8)); tab.setSelected(editorTab==i);
            tab.setTextColor(editorTab==i?PanelUi.PINK:PanelUi.MUTED); tab.setBackgroundColor(Color.TRANSPARENT);
            cell.addView(tab,new LinearLayout.LayoutParams(-1,-2)); View line=new View(this); line.setBackgroundColor(editorTab==i?PanelUi.PINK:PanelUi.LINE); cell.addView(line,new LinearLayout.LayoutParams(-1,dp(2)));
            tabs.addView(cell,new LinearLayout.LayoutParams(0,-2,1));
        }
        if(editorTab==1) mediaPane(profile); else {
            section(editorTab==0?"Profil bilgileri":"İletişim bilgileri", "");
            for(int i=0;i<PROFILE_FIELDS.length;i++) {
                if(editorTab==0&&i>=7||editorTab==2&&i<7)continue;
                String[] entry=PROFILE_FIELDS[i];
                int type=entry[0].equals("description")?InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_MULTI_LINE
                    :i>=3&&i<=5?InputType.TYPE_CLASS_NUMBER:i==7||i==8?InputType.TYPE_CLASS_PHONE:InputType.TYPE_CLASS_TEXT;
                EditText edit=field(entry[1],draft.get(entry[0]),type); if(i==6){edit.setMinLines(4);edit.setGravity(Gravity.TOP);}
                edit.setTag(entry[0]); activeFields.put(entry[0],edit);
                edit.addTextChangedListener(new android.text.TextWatcher(){
                    public void beforeTextChanged(CharSequence s,int start,int count,int after){}
                    public void onTextChanged(CharSequence s,int start,int before,int count){dirty=true;if(draftStatus!=null){draftStatus.setText(R.string.unsaved_changes);draftStatus.setTextColor(PanelUi.GOLD);}}
                    public void afterTextChanged(android.text.Editable value){}
                });
            }
        }
        footer.setVisibility(View.VISIBLE);
        TextView state=ui.text(dirty?"Kaydedilmedi":profile.optBoolean("is_live")?"Yayında":"Taslak",13,dirty?PanelUi.GOLD:PanelUi.MUTED);
        draftStatus=state;
        footer.addView(state,new LinearLayout.LayoutParams(0,-2,1));
        Button save=ui.button("Kaydet",true,()->{if(!busy)saveProfile();});
        ui.buttonIcon(save,R.drawable.ic_save,true);
        footer.addView(save,new LinearLayout.LayoutParams(-2,-2));
        if(editorTab==1&&selectedPhoto!=null)message("Fotoğraf henüz yüklenmedi.");
    }
    private void saveProfile() {
        collectDraft(); JSONObject body=new JSONObject(draft);
        execute(()->api.json("PUT","/api/customer/mobile/profiles/"+selectedProfile.optString("id"),token,body),r->{
            JSONObject updated=r.optJSONObject("profile");
            if(updated!=null){updateCachedProfile(updated);int tab=editorTab;editProfile(updated);editorTab=tab;renderEditor();}
            else {dirty=false;renderEditor();}
            message("Profil kaydedildi.");
        });
    }
    private void updateCachedProfile(JSONObject profile) {
        JSONArray list=lastBootstrap==null?null:lastBootstrap.optJSONArray("profiles"); if(list==null)return;
        for(int i=0;i<list.length();i++)if(list.optJSONObject(i)!=null&&list.optJSONObject(i).optString("id").equals(profile.optString("id"))) {
            try{list.put(i,profile);}catch(org.json.JSONException ignored){} return;
        }
    }
    private void mediaPane(JSONObject profile) {
        int count = profile.optJSONArray("images") == null ? 0 : profile.optJSONArray("images").length();
        section("Görseller",count+" / 12 görsel");
        LinearLayout actions=ui.row(); icon(actions,R.drawable.ic_add_photo_alternate,"Fotoğraf seç",this::pickPhoto);
        actions.addView(ui.text("JPEG, PNG, WebP · En fazla 8 MB",12,PanelUi.MUTED),new LinearLayout.LayoutParams(0,-2,1)); content.addView(actions);
        if(count>=12) actions.getChildAt(0).setEnabled(false);
        pendingPhotos(profile.optString("id"));
        if(count>0) remotePhotos(profile.optJSONArray("images"));
        if(selectedPhoto==null||!profile.optString("id").equals(pendingProfileId)) {
            if(count==0) {
            LinearLayout empty=vertical(); empty.setGravity(Gravity.CENTER); empty.setPadding(dp(16),dp(32),dp(16),dp(32));
            empty.addView(ui.symbol(R.drawable.ic_photo_library,PanelUi.MUTED,56)); empty.addView(ui.space(18));
            TextView label=ui.title(count==0?"Henüz görsel yok":count+" kayıtlı görsel",18); label.setGravity(Gravity.CENTER); empty.addView(label);
            content.addView(empty);
            }
            if(count<12) command("Fotoğraf seç",this::pickPhoto);
        }
        if (selectedPhoto != null && profile.optString("id").equals(pendingProfileId)) {
            content.addView(ui.space(12)); content.addView(ui.badge("Yüklenmeyi bekliyor",PanelUi.GOLD),new LinearLayout.LayoutParams(-2,-2)); content.addView(ui.space(16));
            ImageView preview = new ImageView(this); preview.setScaleType(ImageView.ScaleType.FIT_CENTER); preview.setContentDescription("Se\u00e7ilen foto\u011fraf");
            preview.setBackground(ui.surface(PanelUi.SURFACE,PanelUi.LINE));
            content.addView(preview, new LinearLayout.LayoutParams(-1, dp(240)));
            Uri photo = selectedPhoto;
            io.execute(() -> {
                try (InputStream stream = getContentResolver().openInputStream(photo)) {
                    byte[] data = ApiClient.readBounded(stream, 8 * 1024 * 1024);
                    BitmapFactory.Options options = new BitmapFactory.Options(); options.inJustDecodeBounds = true;
                    BitmapFactory.decodeByteArray(data, 0, data.length, options);
                    int sample = 1; while (Math.max(options.outWidth, options.outHeight) / sample > 800) sample *= 2;
                    options.inJustDecodeBounds = false; options.inSampleSize = sample;
                    android.graphics.Bitmap bitmap = BitmapFactory.decodeByteArray(data, 0, data.length, options);
                    runOnUiThread(() -> { if (!isDestroyed()) preview.setImageBitmap(bitmap); });
                } catch (Exception ignored) { /* Upload validation supplies an actionable error. */ }
            });
            command("Foto\u011fraf\u0131 y\u00fckle", this::uploadPhoto);
            Button remove=ui.button("Seçimi kaldır",false,()->{if(!busy){clearPhoto();renderEditor();}});
            ui.buttonIcon(remove,R.drawable.ic_close,false);
            LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.topMargin=dp(12);content.addView(remove,p);
        }
    }
    private void remotePhotos(JSONArray images) {
        content.addView(ui.space(16));
        LinearLayout row=null;
        final int version=screenVersion;
        final String session=token;
        for(int index=0; index<Math.min(images.length(),12); index++) {
            if(index%2==0) {
                row=ui.row();
                LinearLayout.LayoutParams params=new LinearLayout.LayoutParams(-1,-2);
                params.bottomMargin=dp(12); content.addView(row,params);
            }
            LinearLayout slot=vertical();
            ImageView photo=new ImageView(this); photo.setScaleType(ImageView.ScaleType.CENTER_CROP);
            photo.setBackground(ui.surface(PanelUi.SURFACE,PanelUi.LINE));
            photo.setContentDescription("Kay\u0131tl\u0131 foto\u011fraf " + (index+1));
            slot.addView(photo,new LinearLayout.LayoutParams(-1,dp(190)));
            TextView state=ui.text("Y\u00fckleniyor",12,PanelUi.MUTED); slot.addView(state);
            LinearLayout.LayoutParams params=new LinearLayout.LayoutParams(0,-2,1);
            if(index%2==0)params.setMarginEnd(dp(10)); row.addView(slot,params);
            final String route=images.optString(index);
            if(api==null) {state.setText(R.string.photo_connection_missing);continue;}
            photoIo.execute(()->{
                if(version!=screenVersion)return;
                try {
                    byte[] bytes=api.photo(route,session);
                    BitmapFactory.Options options=new BitmapFactory.Options(); options.inJustDecodeBounds=true;
                    BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);
                    if(options.outWidth<=0||options.outHeight<=0)throw new java.io.IOException("Invalid image");
                    int sample=1;while(Math.max(options.outWidth,options.outHeight)/sample>800)sample*=2;
                    options.inJustDecodeBounds=false;options.inSampleSize=sample;
                    android.graphics.Bitmap bitmap=BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);
                    if(bitmap==null)throw new java.io.IOException("Invalid image");
                    runOnUiThread(()->{
                        if(isDestroyed()||version!=screenVersion){bitmap.recycle();return;}
                        photo.setImageBitmap(bitmap);state.setText("");
                    });
                } catch(Exception error) {
                    runOnUiThread(()->{
                        if(isDestroyed()||version!=screenVersion)return;
                        state.setText(R.string.photo_load_failed);
                        photo.setImageResource(R.drawable.ic_refresh);
                        photo.setContentDescription("Foto\u011fraf\u0131 yeniden y\u00fckle");
                        photo.setOnClickListener(v->{if(!busy)renderEditor();});
                    });
                }
            });
        }
        if(images.length()%2!=0&&row!=null)row.addView(new View(this),new LinearLayout.LayoutParams(0,dp(190),1));
    }
    private void pickPhoto() {
        if (selectedProfile == null) return;
        JSONArray images=selectedProfile.optJSONArray("images"); if(images!=null&&images.length()>=12){message("En fazla 12 görsel eklenebilir.");return;}
        collectDraft();
        pickingProfileId = selectedProfile.optString("id");
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE);
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/jpeg", "image/png", "image/webp"});
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(intent, PICK_PHOTO);
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != PICK_PHOTO || result != RESULT_OK || data == null || data.getData() == null) return;
        pendingProfileId = pickingProfileId;
        releasePhotoPermission(); selectedPhoto = data.getData(); uploadId = UUID.randomUUID().toString();
        uploadType = getContentResolver().getType(selectedPhoto);
        try { getContentResolver().takePersistableUriPermission(selectedPhoto, Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (SecurityException ignored) { }
        if (selectedProfile != null) {editorTab=1;renderEditor();}
    }
    private void uploadPhoto() {
        if (selectedPhoto == null || selectedProfile == null || !customerReady) return;
        final Uri uri = selectedPhoto; final String id = pendingProfileId, requestId = uploadId, type = uploadType, owner=accountId;
        execute(() -> {
            try (InputStream input = getContentResolver().openInputStream(uri)) {
                byte[] original = ApiClient.readBounded(input, 8 * 1024 * 1024);
                PendingPhotoStore.Entry entry=PhotoUploadWorker.store(this).stage(requestId,owner,id,type,original);
                PhotoUploadWorker.enqueue(this,entry);
                return new JSONObject().put("queued",true);
            }
        }, r -> {
            collectDraft();clearPhoto();renderEditor();startQueueWatch();
            message(getString(R.string.photo_queued));
        });
    }
    private void pendingPhotos(String profileId) {
        for(PendingPhotoStore.Entry entry:pendingUploads) {
            if(entry.terminal()||!entry.profileId.equals(profileId))continue;
            LinearLayout row=ui.row();row.setPadding(0,dp(8),0,dp(8));
            int label=switch(entry.state){
                case UPLOADING->R.string.upload_sending;
                case RETRYING->R.string.upload_retrying;
                case AUTH_REQUIRED->R.string.upload_login_required;
                case FAILED->R.string.upload_failed;
                default->R.string.upload_waiting;
            };
            row.addView(ui.text(getString(label),13,PanelUi.GOLD),new LinearLayout.LayoutParams(0,-2,1));
            if(entry.state==PendingPhotoStore.State.FAILED||entry.state==PendingPhotoStore.State.AUTH_REQUIRED)
                icon(row,R.drawable.ic_refresh,getString(R.string.retry_upload),()->execute(()->{
                    PhotoUploadWorker.retry(this,entry.id,accountId);return new JSONObject();
                },r->startQueueWatch()));
            icon(row,R.drawable.ic_close,getString(R.string.cancel_upload),()->new AlertDialog.Builder(this)
                .setMessage(R.string.cancel_upload_confirmation).setNegativeButton(R.string.keep_upload,null)
                .setPositiveButton(R.string.cancel_upload,(dialog,which)->execute(()->{
                    PhotoUploadWorker.cancel(this,entry.id,accountId);return new JSONObject();
                },r->startQueueWatch())).show());
            content.addView(row);
        }
    }
    private void stopQueueWatch(){queueGeneration++;queueHandler.removeCallbacksAndMessages(null);}
    private void startQueueWatch(){stopQueueWatch();if(resumed&&customerReady&&!accountId.isEmpty())pollQueue(queueGeneration);}
    private void pollQueue(int generation) {
        if(!resumed||!customerReady||generation!=queueGeneration||io.isShutdown())return;
        final String owner=accountId;
        final boolean authenticatedAgain=uploadsAuthenticatedAgain;uploadsAuthenticatedAgain=false;
        io.execute(()->{
            try {
                PhotoUploadWorker.resume(this,owner,authenticatedAgain);
                java.util.List<PendingPhotoStore.Entry> entries=PhotoUploadWorker.store(this).list(owner);
                runOnUiThread(()->{
                    if(isDestroyed()||!resumed||generation!=queueGeneration||!owner.equals(accountId))return;
                    StringBuilder signature=new StringBuilder();boolean completed=false;
                    for(PendingPhotoStore.Entry entry:entries){
                        signature.append(entry.id).append(entry.state).append(entry.updated);
                        if(!busy&&entry.state==PendingPhotoStore.State.DONE&&observedUploads.add(entry.id))completed=true;
                    }
                    boolean changed=!queueSignature.contentEquals(signature);queueSignature=signature.toString();pendingUploads=entries;
                    if(changed&&!busy&&selectedProfile!=null&&editorTab==1)renderEditor();
                    if(completed&&!busy)refreshAfterUpload();
                    queueHandler.postDelayed(()->pollQueue(generation),3000);
                });
            }catch(Exception unavailable){runOnUiThread(()->{
                if(isDestroyed()||!resumed||generation!=queueGeneration)return;
                message(getString(R.string.upload_storage_unavailable));queueHandler.postDelayed(()->pollQueue(generation),10000);
            });}
        });
    }
    private void refreshAfterUpload() {
        if(selectedProfile==null){loadProfiles();return;}
        final String id=selectedProfile.optString("id");
        execute(()->api.json("GET","/api/customer/mobile/profiles/"+id,token,null),response->{
            JSONObject updated=response.optJSONObject("profile");
            if(updated!=null&&selectedProfile!=null&&id.equals(selectedProfile.optString("id"))){
                collectDraft();selectedProfile=updated;updateCachedProfile(updated);renderEditor();message(getString(R.string.original_confirmed));
            }
        });
    }
    private void releasePhotoPermission() {
        if (selectedPhoto != null) try { getContentResolver().releasePersistableUriPermission(selectedPhoto, Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (SecurityException ignored) { }
    }
    private void clearPhoto() { releasePhotoPermission(); selectedPhoto = null; uploadId = ""; pendingProfileId = ""; uploadType = ""; }
    private interface Task { JSONObject run() throws Exception; }
    private interface Success { void run(JSONObject response); }
    private void execute(Task task, Success success) {
        if (busy || api == null) return;
        busy = true; progress.setVisibility(View.VISIBLE); message("\u0130\u015flem s\u00fcr\u00fcyor...");
        io.execute(() -> {
            try { JSONObject response = task.run(); runOnUiThread(() -> { if (isDestroyed()) return; idle(); success.run(response); }); }
            catch (Exception error) { runOnUiThread(() -> {
                if (isDestroyed()) return; idle();
                if (error instanceof ApiClient.Failure failure && failure.code.equals("PASSWORD_CHANGE_REQUIRED")) { changePassword(); return; }
                if (error instanceof ApiClient.Failure failure && failure.status == 401) { vault.clear(); token = ""; login(); message("Giri\u015f bilgilerini kontrol edin veya yeniden giri\u015f yap\u0131n."); return; }
                if (error instanceof ApiClient.Failure failure && failure.code.equals("ORIGINAL_NOT_CONFIRMED")) { message("Orijinal kayd\u0131 do\u011frulanmad\u0131. Tekrar deneyin."); return; }
                if (error instanceof ApiClient.Failure failure && failure.status == 429) { message("\u0130\u015flem s\u0131n\u0131r\u0131na ula\u015f\u0131ld\u0131. Biraz sonra deneyin."); return; }
                message("\u0130\u015flem tamamlanamad\u0131. Ba\u011flant\u0131y\u0131 ve alanlar\u0131 kontrol edip tekrar deneyin. Foto\u011fraf s\u0131n\u0131r\u0131: 8 MB.");
            }); }
        });
    }
    private void idle() { busy = false; progress.setVisibility(View.INVISIBLE); message(""); }
    private void message(String value) { status.setText(value); status.setVisibility(value.isEmpty() ? View.GONE : View.VISIBLE); }
    @Override protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        out.putString("photo", selectedPhoto == null ? "" : selectedPhoto.toString()); out.putString("upload", uploadId);
        out.putString("profile", pendingProfileId); out.putString("mime", uploadType);
        out.putString("picking", pickingProfileId);
    }
    // API 33+ uses the registered platform dispatcher; this is for API 26-32.
    @android.annotation.SuppressLint("GestureBackNavigation")
    @Override public void onBackPressed() { navigateBack(); }
    private void navigateBack() {
        if (busy) return;
        if(selectedProfile!=null) {
            if(dirty) new AlertDialog.Builder(this).setTitle("Kaydedilmemiş değişiklikler")
                .setMessage("Değişiklikler kaydedilmeden çıkılsın mı?").setNegativeButton("Düzenlemeye dön",null)
                .setPositiveButton("Vazgeç",(d,w)->leaveEditor()).show();
            else leaveEditor();
        } else finish();
    }
    private void leaveEditor() { selectedProfile=null;draft.clear();activeFields.clear();dirty=false;if(lastBootstrap!=null)profiles(lastBootstrap);else loadProfiles(); }
    @Override protected void onResume(){super.onResume();resumed=true;startQueueWatch();}
    @Override protected void onPause(){resumed=false;stopQueueWatch();super.onPause();}
    @Override protected void onDestroy() { stopQueueWatch();screenVersion++; super.onDestroy(); io.shutdownNow(); photoIo.shutdownNow(); }
}
