package com.vipgece.customer;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.*;
import java.lang.ref.WeakReference;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class UpdateActivity extends Activity implements SharedPreferences.OnSharedPreferenceChangeListener {
    static WeakReference<UpdateActivity> visible=new WeakReference<>(null);
    static Intent confirmation;
    private final ExecutorService io=Executors.newSingleThreadExecutor();
    private PanelUi ui;
    private LinearLayout content;
    private TextView status;
    private Button install,check;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);ui=new PanelUi(this);
        LinearLayout root=ui.column();root.setBackgroundColor(PanelUi.BG);
        root.setOnApplyWindowInsetsListener((v,i)->{v.setPadding(i.getSystemWindowInsetLeft(),i.getSystemWindowInsetTop(),i.getSystemWindowInsetRight(),i.getSystemWindowInsetBottom());return i;});
        LinearLayout toolbar=ui.row();toolbar.setPadding(ui.dp(12),ui.dp(8),ui.dp(20),ui.dp(8));
        toolbar.addView(ui.icon(R.drawable.ic_arrow_back,"Geri",this::finish));toolbar.addView(ui.title("Güncellemeler",20));root.addView(toolbar);
        ScrollView scroll=new ScrollView(this);content=ui.column();content.setPadding(ui.dp(24),ui.dp(20),ui.dp(24),ui.dp(24));scroll.addView(content);root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
        content.addView(ui.title("VIP GECE",26));content.addView(ui.space(8));content.addView(ui.text("Sürüm "+BuildConfig.VERSION_NAME,14,PanelUi.MUTED));ui.divider(content);
        Switch automatic=new Switch(this);automatic.setText(R.string.automatic_updates);automatic.setTextColor(PanelUi.TEXT);automatic.setTextSize(16);automatic.setMinHeight(ui.dp(56));automatic.setChecked(UpdateEngine.automatic(this));
        automatic.setOnCheckedChangeListener((b,value)->UpdateEngine.configure(this,value));content.addView(automatic,new LinearLayout.LayoutParams(-1,-2));
        content.addView(ui.text("Arka planda Wi-Fi ile",13,PanelUi.MUTED));ui.divider(content);
        status=ui.text("",16,PanelUi.GOLD);status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);content.addView(status);content.addView(ui.space(24));
        check=ui.button("Kontrol et ve indir",true,()->UpdateEngine.enqueue(this,true));content.addView(check,new LinearLayout.LayoutParams(-1,-2));content.addView(ui.space(12));
        install=ui.button("Güncellemeyi kur",false,this::install);content.addView(install,new LinearLayout.LayoutParams(-1,-2));
        if(android.os.Build.VERSION.SDK_INT>=33&&checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED) {
            content.addView(ui.space(12));Button permission=ui.button("Bildirim izni",false,()->requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS},88));content.addView(permission,new LinearLayout.LayoutParams(-1,-2));
        }
        setContentView(root);root.requestApplyInsets();render();
    }
    private void render() {
        String state=UpdateEngine.state(this);
        String label=switch(state){
            case "checking"->"Yeni sürüm kontrol ediliyor...";
            case "downloading"->"Güncelleme indiriliyor...";
            case "ready"->"Güncelleme doğrulandı. Kuruluma hazır.";
            case "current"->"Uygulama güncel.";
            case "unpublished"->"Henüz yayımlanmış güncelleme yok.";
            case "rejected"->"Güncelleme doğrulanamadı; kurulumu engellendi.";
            case "permission"->"Android kurulum izni bekleniyor.";
            case "confirmation"->"Android kurulum onayı bekleniyor.";
            case "installing"->"Android kurulumu sürüyor...";
            case "error"->"Bağlantı kurulamadı. Yeniden deneyebilirsiniz.";
            case "install_error"->"Kurulum tamamlanamadı. Yeniden deneyebilirsiniz.";
            default->"Güncelleme henüz kontrol edilmedi.";
        };
        status.setText(label);
        boolean running=state.equals("checking")||state.equals("downloading")||state.equals("installing");
        check.setEnabled(!running);
        install.setVisibility(UpdateEngine.prefs(this).contains("manifest")?View.VISIBLE:View.GONE);install.setEnabled(!running);
    }
    private void install() {
        if(confirmation!=null){openConfirmation();return;}
        if(!getPackageManager().canRequestPackageInstalls()) {
            UpdateEngine.state(this,"permission");
            startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+getPackageName())));return;
        }
        install.setEnabled(false);io.execute(()->{try{UpdateEngine.install(this,true);}catch(Exception e){UpdateEngine.state(this,"install_error");}runOnUiThread(()->{if(!isDestroyed())render();});});
    }
    void openConfirmation() {
        Intent action=confirmation;confirmation=null;
        if(action!=null)try{startActivity(action);}catch(RuntimeException e){UpdateEngine.state(this,"install_error");}
    }
    @Override protected void onResume(){super.onResume();visible=new WeakReference<>(this);UpdateEngine.prefs(this).registerOnSharedPreferenceChangeListener(this);render();}
    @Override protected void onPause(){UpdateEngine.prefs(this).unregisterOnSharedPreferenceChangeListener(this);if(visible.get()==this)visible.clear();super.onPause();}
    @Override protected void onDestroy(){io.shutdownNow();super.onDestroy();}
    @Override public void onSharedPreferenceChanged(SharedPreferences prefs,String key){runOnUiThread(()->{if(!isDestroyed())render();});}
}
