package com.vipgece.admin;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(VipGeceAppInfoPlugin.class);
        registerPlugin(VipGeceUpdaterPlugin.class);
        super.onCreate(savedInstanceState);

        VipGeceUpdateEngine.schedulePeriodicCheck(this);
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (getBridge() == null || getBridge().getWebView() == null) return;

            getBridge().getWebView().evaluateJavascript(
                    "(function(){try{return Boolean((document.readyState==='complete'||document.readyState==='interactive')&&document.body&&document.body.children.length>0&&location.hostname.endsWith('vip-gece.site'));}catch(e){return false;}})()",
                    value -> {
                        if ("true".equalsIgnoreCase(String.valueOf(value))) {
                            VipGeceUpdateEngine.markUiHealthy(this);
                        }
                    }
            );
        }, 9000L);
    }
}
