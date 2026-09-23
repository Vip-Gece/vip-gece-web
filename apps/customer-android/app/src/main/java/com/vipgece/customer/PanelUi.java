package com.vipgece.customer;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.graphics.drawable.StateListDrawable;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.widget.*;

/** Presentation primitives shared by the native customer screens. */
final class PanelUi {
    static final int BG=0xff101013, SURFACE=0xff1c1c22, RAISED=0xff24242c, LINE=0xff44444f;
    static final int TEXT=0xfff7f5f7, MUTED=0xffb9b6c2, PINK=0xffff78ae, GOLD=0xffe3c58a, GREEN=0xff77d6b0;
    private final Context context;
    PanelUi(Context context) { this.context=context; }
    int dp(int value) { return Math.round(value*context.getResources().getDisplayMetrics().density); }
    LinearLayout column() { LinearLayout v=new LinearLayout(context); v.setOrientation(LinearLayout.VERTICAL); return v; }
    LinearLayout row() { LinearLayout v=new LinearLayout(context); v.setGravity(Gravity.CENTER_VERTICAL); return v; }
    TextView text(String value,int size,int color) {
        TextView v=new TextView(context); v.setText(value); v.setTextSize(size); v.setTextColor(color);
        v.setLetterSpacing(0); v.setLineSpacing(dp(2),1); return v;
    }
    TextView title(String value,int size) {
        TextView v=text(value,size,TEXT); v.setTypeface(Typeface.create("sans-serif-medium",Typeface.NORMAL));
        if (android.os.Build.VERSION.SDK_INT>=28) v.setAccessibilityHeading(true); return v;
    }
    GradientDrawable surface(int color,int border) {
        GradientDrawable d=new GradientDrawable(); d.setColor(color); d.setCornerRadius(dp(8));
        if (border!=0) d.setStroke(dp(1),border); return d;
    }
    View space(int height) { View v=new View(context); v.setLayoutParams(new LinearLayout.LayoutParams(1,dp(height))); return v; }
    void divider(LinearLayout parent) {
        View v=new View(context); v.setBackgroundColor(LINE);
        LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,dp(1)); p.topMargin=dp(20); p.bottomMargin=dp(20); parent.addView(v,p);
    }
    ImageButton icon(int resource,String label,Runnable action) {
        ImageButton v=new ImageButton(context); v.setImageResource(resource); v.setImageTintList(ColorStateList.valueOf(TEXT));
        v.setContentDescription(label); v.setTooltipText(label); v.setPadding(dp(12),dp(12),dp(12),dp(12));
        v.setBackground(new RippleDrawable(ColorStateList.valueOf(0x33ffffff),surface(Color.TRANSPARENT,0),null));
        v.setOnClickListener(w->action.run()); v.setLayoutParams(new LinearLayout.LayoutParams(dp(48),dp(48))); return v;
    }
    Button button(String label,boolean primary,Runnable action) {
        Button v=new Button(context); v.setText(label); v.setAllCaps(false); v.setTextSize(15); v.setLetterSpacing(0);
        v.setTypeface(Typeface.create("sans-serif-medium",Typeface.NORMAL)); v.setMinWidth(0); v.setMinimumWidth(0);
        v.setMinHeight(dp(52)); v.setPadding(dp(16),dp(10),dp(16),dp(10));
        v.setTextColor(new ColorStateList(new int[][]{new int[]{-android.R.attr.state_enabled},new int[]{}},new int[]{MUTED,primary?BG:TEXT}));
        StateListDrawable states=new StateListDrawable(); states.addState(new int[]{-android.R.attr.state_enabled},surface(RAISED,LINE));
        states.addState(new int[]{},new RippleDrawable(ColorStateList.valueOf(0x33ffffff),surface(primary?PINK:SURFACE,primary?0:LINE),null));
        v.setBackground(states); v.setStateListAnimator(null); v.setOnClickListener(w->action.run()); return v;
    }
    void buttonIcon(Button button,int resource,boolean primary) {
        android.graphics.drawable.Drawable icon=context.getDrawable(resource);
        if(icon==null)return;
        icon.setTint(primary?BG:TEXT); icon.setBounds(0,0,dp(20),dp(20));
        button.setCompoundDrawables(icon,null,null,null); button.setCompoundDrawablePadding(dp(8));
    }
    EditText input(String label,String value,int type) {
        EditText v=new EditText(context); v.setId(View.generateViewId()); v.setHint(label); v.setText(value);
        v.setInputType(type); v.setTextSize(16); v.setLetterSpacing(0); v.setTextColor(TEXT); v.setHintTextColor(MUTED);
        v.setTypeface(Typeface.create("sans-serif",Typeface.NORMAL)); v.setMinHeight(dp(54)); v.setPadding(dp(14),dp(12),dp(14),dp(12));
        v.setSingleLine((type&InputType.TYPE_TEXT_FLAG_MULTI_LINE)==0); v.setImeOptions(EditorInfo.IME_ACTION_NEXT);
        v.setSaveEnabled(false); v.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
        StateListDrawable bg=new StateListDrawable(); bg.addState(new int[]{android.R.attr.state_focused},surface(SURFACE,PINK)); bg.addState(new int[]{},surface(SURFACE,LINE)); v.setBackground(bg); return v;
    }
    EditText field(LinearLayout parent,String label,String value,int type) {
        TextView caption=text(label,13,MUTED); LinearLayout.LayoutParams cp=new LinearLayout.LayoutParams(-1,-2); cp.topMargin=dp(16); cp.bottomMargin=dp(7); parent.addView(caption,cp);
        EditText input=input(label,value,type); caption.setLabelFor(input.getId());
        if ((type&InputType.TYPE_TEXT_VARIATION_PASSWORD)==InputType.TYPE_TEXT_VARIATION_PASSWORD && (type&InputType.TYPE_MASK_CLASS)==InputType.TYPE_CLASS_TEXT) {
            LinearLayout row=row(); row.addView(input,new LinearLayout.LayoutParams(0,-2,1));
            ImageButton reveal=icon(R.drawable.ic_visibility,"Şifreyi göster",()->{});
            reveal.setOnClickListener(v->{
                boolean hidden=input.getTransformationMethod()!=null;
                int selection=input.getSelectionEnd(); input.setTransformationMethod(hidden?null:android.text.method.PasswordTransformationMethod.getInstance());
                if(selection>=0) input.setSelection(selection);
                reveal.setImageResource(hidden?R.drawable.ic_visibility_off:R.drawable.ic_visibility);
                reveal.setContentDescription(hidden?"Şifreyi gizle":"Şifreyi göster"); reveal.setTooltipText(reveal.getContentDescription());
            }); row.addView(reveal); parent.addView(row,new LinearLayout.LayoutParams(-1,-2));
        } else parent.addView(input,new LinearLayout.LayoutParams(-1,-2));
        return input;
    }
    TextView badge(String label,int color) {
        TextView v=text(label,12,color); v.setPadding(dp(8),dp(4),dp(8),dp(4));
        v.setBackground(surface((color&0x00ffffff)|0x18000000,0)); return v;
    }
    ImageView symbol(int resource,int color,int size) {
        ImageView v=new ImageView(context); v.setImageResource(resource); v.setImageTintList(ColorStateList.valueOf(color));
        v.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO); v.setLayoutParams(new LinearLayout.LayoutParams(dp(size),dp(size))); return v;
    }
}
