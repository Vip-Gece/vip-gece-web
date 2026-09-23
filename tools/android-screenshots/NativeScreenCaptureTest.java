package com.vipgece.customer;

import android.app.AlertDialog;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.ScrollView;
import android.widget.TextView;
import java.io.File;
import java.io.FileOutputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.Before;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.shadows.ShadowAlertDialog;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34, qualifiers = "tr-rTR-w390dp-h844dp-xhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public final class NativeScreenCaptureTest {
    private final JSONArray captures = new JSONArray();
    private MainActivity activity;
    private File output;
    private final int width = 780, height = 1688;

    @Before public void isolateBackgroundConnections() {
        // These tests render views, not live Firebase or WorkManager integration.
        UpdateEngine.prefs(org.robolectric.RuntimeEnvironment.getApplication())
            .edit().putBoolean("automatic", false).commit();
    }

    @Test public void storedPhotosHaveIndependentBoundedGallerySlots() throws Exception {
        try(ActivityController<MainActivity> controller=Robolectric.buildActivity(MainActivity.class)) {
            activity=controller.setup().visible().get();
            JSONArray images=new JSONArray();
            for(int i=0;i<3;i++)images.put("/api/customer/mobile/profiles/test/images/"+i);
            callJson("editProfile",new JSONObject().put("id","test").put("name","Fixture").put("images",images));
            button("Görseller").performClick();
            List<ImageView> photos=find((View)field("content"),ImageView.class).stream()
                .filter(v->v.getContentDescription()!=null&&v.getContentDescription().toString().startsWith("Kay\u0131tl\u0131 foto\u011fraf"))
                .toList();
            assertEquals(3,photos.size());
            for(ImageView photo:photos)assertTrue(photo.getLayoutParams().height>0);
            assertNull(field("api"));
        }
    }

    @Test public void captureEveryApplicationScreen() throws Exception {
        assertEquals("No customer service connection is allowed", "", BuildConfig.GATEWAY_URL);
        output = new File(System.getProperty("vg.screenshots"));
        assertTrue(output.isDirectory() || output.mkdirs());
        try (ActivityController<MainActivity> controller = Robolectric.buildActivity(MainActivity.class)) {
            activity = controller.setup().visible().get();
            assertNull(field("api"));
            assertTrue((activity.getWindow().getAttributes().flags & WindowManager.LayoutParams.FLAG_SECURE) != 0);
            captureRoot("01-giris", "Musteri girisi; mevcut servis kapali", false);

            set("token", "SCREENSHOT_FIXTURE_NOT_A_REAL_SESSION");
            call("changePassword");
            captureRoot("02-zorunlu-sifre-yenileme", "Zorunlu ilk giris sifre yenileme", true);
            button("\u015eifreyi yenile").performClick();
            captureRoot("03-sifre-dogrulama", "Kisa sifre dogrulama mesaji", true);

            JSONObject empty = bootstrap(new JSONArray());
            callJson("profiles", empty);
            captureRoot("04-bos-profil-listesi", "Henuz profil bulunmayan hesap", true);

            JSONObject profile = new JSONObject().put("id", "screenshot-demo-profile")
                .put("name", "\u00d6rnek Profil").put("city", "\u0130stanbul").put("district", "Kad\u0131k\u00f6y")
                .put("age", "28").put("height", "170").put("weight", "58")
                .put("description", "Bu profil yaln\u0131zca ekran g\u00f6r\u00fcnt\u00fcs\u00fc testi i\u00e7in olu\u015fturulmu\u015f \u00f6rnek veridir.")
                .put("phone", "").put("whatsapp", "").put("telegram", "")
                .put("is_live", false).put("images", new JSONArray());
            callJson("profiles", bootstrap(new JSONArray().put(profile)));
            captureRoot("05-profillerim", "Profillerim; bir ornek taslak profil", true);
            button("Profil ekle").performClick();
            AlertDialog newProfile = ShadowAlertDialog.getLatestAlertDialog();
            assertNotNull(newProfile); assertTrue(newProfile.isShowing());
            newProfile.getButton(AlertDialog.BUTTON_POSITIVE).performClick();
            assertTrue("Empty profile name must not dismiss the form",newProfile.isShowing());
            captureDialog(newProfile, "06-yeni-profil-penceresi", "Yeni profil acilir penceresi");
            newProfile.dismiss();

            callJson("editProfile", profile);
            captureRoot("07-profil-duzenleme-ust", "Profil duzenleme; ust kisim", true);
            ScrollView scroll = find((View)field("root"), ScrollView.class).get(0);
            scroll.scrollTo(0, scroll.getChildAt(0).getHeight());
            captureRoot("08-profil-duzenleme-alt", "Profil duzenleme; aciklama ve iletisim alanlari", true);
            button("İletişim").performClick();
            captureRoot("11-iletisim", "Iletisim sekmesi", true);
            button("Görseller").performClick();
            captureRoot("12-gorseller", "Bos gorsel yonetimi", true);

            File sample = new File(activity.getCacheDir(), "app-icon-fixture.png");
            Bitmap fixture = Bitmap.createBitmap(400, 400, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(fixture); canvas.drawColor(android.graphics.Color.WHITE);
            Drawable logo = activity.getDrawable(R.drawable.ic_app);
            assertNotNull(logo); logo.setBounds(40,40,360,360); logo.draw(canvas);
            try (FileOutputStream stream = new FileOutputStream(sample)) { assertTrue(fixture.compress(Bitmap.CompressFormat.PNG,100,stream)); }
            fixture.recycle();
            set("selectedPhoto", Uri.fromFile(sample)); set("pendingProfileId", profile.getString("id"));
            set("uploadId", "SCREENSHOT_ONLY"); set("uploadType", "image/png");
            callJson("editProfile", profile);
            button("Görseller").performClick();
            for (int i=0;i<30;i++) {
                Shadows.shadowOf(Looper.getMainLooper()).idle();
                List<ImageView> images = find((View)field("content"), ImageView.class);
                boolean ready = images.stream().anyMatch(v -> "Seçilen fotoğraf".contentEquals(v.getContentDescription()) && v.getDrawable()!=null);
                if (ready) break;
                Thread.sleep(100);
            }
            captureRoot("09-fotograf-onizleme", "Bekleyen fotograf; ornek gorsel uygulama simgesidir", true);

            set("selectedPhoto", null); set("pendingProfileId", "");
            callJson("profiles", bootstrap(new JSONArray().put(profile)));
            ImageButton logout = find((View)field("toolbar"), ImageButton.class).stream()
                .filter(v -> "Oturumu kapat".contentEquals(v.getContentDescription())).findFirst().orElseThrow();
            logout.performClick();
            AlertDialog confirm = ShadowAlertDialog.getLatestAlertDialog();
            assertNotNull(confirm); assertTrue(confirm.isShowing());
            captureDialog(confirm, "10-oturumu-kapat", "Oturumu kapatma onayi");
            confirm.dismiss();
            assertNull(field("api"));
            assertTrue((activity.getWindow().getAttributes().flags & WindowManager.LayoutParams.FLAG_SECURE) != 0);
        }
        JSONObject manifest = new JSONObject().put("renderer", "Robolectric 4.16 native Android graphics")
            .put("android_sdk", 34).put("qualifiers", "tr-rTR-w390dp-h844dp-xhdpi")
            .put("device_capture", false).put("backend_connected", false).put("production_code_modified", false)
            .put("secure_window_flag_preserved", true).put("captures", captures)
            .put("not_captured", new JSONArray().put("Android system document picker; outside the application-owned views"));
        Files.write(new File(output,"manifest.json").toPath(),manifest.toString(2).getBytes(StandardCharsets.UTF_8));
        assertEquals(12,captures.length());
    }

    @Test public void tabsPreserveEditsAndBackRequiresConfirmation() throws Exception {
        try(ActivityController<MainActivity> controller=Robolectric.buildActivity(MainActivity.class)) {
            activity=controller.setup().visible().get();
            set("token","UI_TEST_ONLY");
            JSONObject profile=new JSONObject().put("id","test").put("name","Original").put("images",new JSONArray());
            callJson("editProfile",profile);
            EditText name=find((View)field("content"),EditText.class).stream().filter(v->"name".equals(v.getTag())).findFirst().orElseThrow();
            name.setText("Saved across tabs");
            button("İletişim").performClick(); button("Bilgiler").performClick();
            assertEquals("Saved across tabs",find((View)field("content"),EditText.class).stream().filter(v->"name".equals(v.getTag())).findFirst().orElseThrow().getText().toString());
            call("navigateBack"); AlertDialog dialog=ShadowAlertDialog.getLatestAlertDialog(); assertTrue(dialog.isShowing());
            dialog.getButton(AlertDialog.BUTTON_NEGATIVE).performClick(); assertNotNull(field("selectedProfile"));
            assertNull(field("api"));
        }
    }

    @Test @Config(qualifiers="tr-rTR-w320dp-h740dp-xhdpi")
    public void narrowScreensHaveBoundedControls() throws Exception {
        output=new File(System.getProperty("vg.screenshots")); assertTrue(output.isDirectory()||output.mkdirs());
        try(ActivityController<MainActivity> controller=Robolectric.buildActivity(MainActivity.class)) {
            activity=controller.setup().visible().get();
            View root=(View)field("root");
            capture(root,640,1480,"13-dar-ekran-giris","320dp giris",false,"application-view");
            assertTextFits(root);
            callJson("editProfile",new JSONObject().put("id","test").put("name","Uzun isimli örnek müşteri profili").put("images",new JSONArray()));
            capture(root,640,1480,"14-dar-ekran-profil","320dp profil duzenleme",true,"application-view");
            assertTextFits(root);
        }
        Files.write(new File(output,"narrow-manifest.json").toPath(),new JSONObject().put("captures",captures).toString(2).getBytes(StandardCharsets.UTF_8));
    }

    private void assertTextFits(View root) {
        for(TextView view:find(root,TextView.class)) {
            if(view.getVisibility()!=View.VISIBLE||view.getWidth()==0||view.getLayout()==null)continue;
            for(int i=0;i<view.getLayout().getLineCount();i++) {
                if(view instanceof EditText)continue;
                assertTrue("Text overflow: "+view.getText(),view.getLayout().getLineWidth(i)<=view.getWidth()-view.getPaddingLeft()-view.getPaddingRight()+2);
            }
        }
    }

    private JSONObject bootstrap(JSONArray profiles) throws Exception {
        return new JSONObject().put("profiles",profiles).put("quota",new JSONObject().put("used",profiles.length())
            .put("limit",2).put("remaining",2-profiles.length()));
    }
    private Object field(String name) throws Exception { Field f=MainActivity.class.getDeclaredField(name);f.setAccessible(true);return f.get(activity); }
    private void set(String name,Object value) throws Exception { Field f=MainActivity.class.getDeclaredField(name);f.setAccessible(true);f.set(activity,value); }
    private void call(String name) throws Exception { Method m=MainActivity.class.getDeclaredMethod(name);m.setAccessible(true);m.invoke(activity); }
    private void callJson(String name,JSONObject arg) throws Exception { Method m=MainActivity.class.getDeclaredMethod(name,JSONObject.class);m.setAccessible(true);m.invoke(activity,arg); }
    private Button button(String label) throws Exception { return find((View)field("root"),Button.class).stream().filter(v->label.contentEquals(v.getText())).findFirst().orElseThrow(); }
    private <T extends View> List<T> find(View root,Class<T> kind) {
        List<T> found=new ArrayList<>();if(kind.isInstance(root))found.add(kind.cast(root));
        if(root instanceof ViewGroup group)for(int i=0;i<group.getChildCount();i++)found.addAll(find(group.getChildAt(i),kind));
        return found;
    }
    private void captureRoot(String name,String title,boolean fixture) throws Exception {
        View view=(View)field("root");
        if (!name.equals("08-profil-duzenleme-alt")) for (ScrollView scroll : find(view,ScrollView.class)) scroll.scrollTo(0,0);
        capture(view,width,height,name,title,fixture,"application-view");
    }
    private void captureDialog(AlertDialog dialog,String name,String title) throws Exception {
        View decor=dialog.getWindow().getDecorView();
        decor.measure(View.MeasureSpec.makeMeasureSpec(660,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(height,View.MeasureSpec.AT_MOST));
        capture(decor,660,decor.getMeasuredHeight(),name,title,true,"native-dialog-crop");
    }
    private void capture(View view,int w,int h,String name,String title,boolean fixture,String type) throws Exception {
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        assertTrue(h>40);
        view.measure(View.MeasureSpec.makeMeasureSpec(w,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(h,View.MeasureSpec.EXACTLY));
        view.layout(0,0,w,h);
        Bitmap image=Bitmap.createBitmap(w,h,Bitmap.Config.ARGB_8888);
        Canvas canvas=new Canvas(image);canvas.drawColor(android.graphics.Color.rgb(246,247,249));view.draw(canvas);
        HashSet<Integer> colors=new HashSet<>();for(int y=0;y<h;y+=3)for(int x=0;x<w;x+=3)colors.add(image.getPixel(x,y));
        assertTrue("Blank capture: "+name,colors.size()>16);
        File file=new File(output,name+".png");try(FileOutputStream stream=new FileOutputStream(file)){assertTrue(image.compress(Bitmap.CompressFormat.PNG,100,stream));}
        image.recycle();
        String hash=java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(file.toPath())));
        JSONArray labels=new JSONArray();for(TextView text:find(view,TextView.class))if(text.getVisibility()==View.VISIBLE&&text.getText().length()>0)labels.put(text.getText().toString());
        captures.put(new JSONObject().put("file",file.getName()).put("title",title).put("width",w).put("height",h)
            .put("sample_colors",colors.size()).put("sha256",hash).put("sample_data",fixture).put("kind",type).put("labels",labels));
        System.out.println("CAPTURE "+file.getName()+" "+w+"x"+h+" colors="+colors.size());
    }
}
