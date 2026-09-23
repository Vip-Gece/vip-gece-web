package com.vipgece.customer.notification;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.vipgece.customer.MainActivity;
import com.vipgece.customer.R;
import com.vipgece.customer.update.CustomerUpdateEngine;

import org.json.JSONObject;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.Locale;

public final class CustomerNotifications {
    public static final String ACTION_OPEN_UPDATE =
            "com.vipgece.customer.action.OPEN_UPDATE";
    public static final String ACTION_OPEN_DAILY_SUMMARY =
            "com.vipgece.customer.action.OPEN_DAILY_SUMMARY";

    private static final String UPDATE_CHANNEL = "vip_gece_updates_v1";
    private static final String INSIGHTS_CHANNEL = "vip_gece_daily_summary_v1";
    private static final String PREFS = "vip_gece_customer_notifications";
    private static final String LAST_UPDATE = "last_notified_update_version_code";
    private static final String LAST_SUMMARY = "last_notified_daily_summary_id";
    private static final int UPDATE_NOTIFICATION_ID = 2101;
    private static final int SUMMARY_NOTIFICATION_ID = 2102;

    private CustomerNotifications() {}

    public static void createChannels(Context source) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = source.getSystemService(NotificationManager.class);
        if (manager == null) return;

        NotificationChannel updates = new NotificationChannel(
                UPDATE_CHANNEL,
                source.getString(R.string.nt_155),
                NotificationManager.IMPORTANCE_DEFAULT
        );
        updates.setDescription(source.getString(R.string.nt_156));
        updates.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);

        NotificationChannel insights = new NotificationChannel(
                INSIGHTS_CHANNEL,
                source.getString(R.string.nt_157),
                NotificationManager.IMPORTANCE_LOW
        );
        insights.setDescription(source.getString(R.string.nt_158));
        insights.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);

        manager.createNotificationChannel(updates);
        manager.createNotificationChannel(insights);
    }

    public static boolean notificationsAllowed(Context context) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                ContextCompat.checkSelfPermission(
                        context,
                        Manifest.permission.POST_NOTIFICATIONS
                ) == PackageManager.PERMISSION_GRANTED;
    }

    private static boolean channelAllowed(Context context, String channelId) {
        NotificationManagerCompat manager = NotificationManagerCompat.from(context);
        if (!notificationsAllowed(context) || !manager.areNotificationsEnabled()) {
            return false;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        NotificationManager platformManager =
                context.getSystemService(NotificationManager.class);
        NotificationChannel channel = platformManager == null
                ? null
                : platformManager.getNotificationChannel(channelId);
        return channel != null &&
                channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }

    @SuppressLint("MissingPermission")
    public static boolean showUpdate(
            Context source,
            CustomerUpdateEngine.Candidate candidate
    ) {
        Context context = source.getApplicationContext();
        createChannels(context);
        if (candidate == null || !channelAllowed(context, UPDATE_CHANNEL)) return false;

        SharedPreferences preferences = preferences(context);
        if (preferences.getLong(LAST_UPDATE, 0) == candidate.versionCode) return false;

        Intent open = new Intent(context, MainActivity.class)
                .setAction(ACTION_OPEN_UPDATE)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
                context,
                2101,
                open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String version = candidate.versionName == null || candidate.versionName.isEmpty()
                ? String.valueOf(candidate.versionCode)
                : candidate.versionName;
        NotificationCompat.Builder builder = new NotificationCompat.Builder(
                context,
                UPDATE_CHANNEL
        )
                .setSmallIcon(R.drawable.ic_stat_vip_gece)
                .setContentTitle(context.getString(R.string.nt_159))
                .setContentText(context.getString(R.string.nt_160, version))
                .setContentIntent(contentIntent)
                .setAutoCancel(true)
                .setOngoing(false)
                .setOnlyAlertOnce(true)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setCategory(NotificationCompat.CATEGORY_SYSTEM)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT);

        try {
            NotificationManagerCompat.from(context).notify(
                    UPDATE_NOTIFICATION_ID,
                    builder.build()
            );
        } catch (SecurityException denied) {
            return false;
        }
        if (!channelAllowed(context, UPDATE_CHANNEL)) return false;
        preferences.edit().putLong(LAST_UPDATE, candidate.versionCode).apply();
        return true;
    }

    @SuppressLint("MissingPermission")
    public static boolean showDailySummary(Context source, JSONObject summary) {
        Context context = source.getApplicationContext();
        createChannels(context);
        if (summary == null || !channelAllowed(context, INSIGHTS_CHANNEL)) return false;
        if (
                !summary.optBoolean("complete", false) ||
                !"ready".equals(summary.optString("status", ""))
        ) {
            return false;
        }

        String summaryId = summary.optString("summary_id", "").trim();
        String reportDate = summary.optString("report_date", "").trim();
        JSONObject totals = summary.optJSONObject("totals");
        JSONObject channels = summary.optJSONObject("channels");
        long views = totals == null ? -1 : totals.optLong("profile_views", -1);
        long contacts = totals == null ? -1 : totals.optLong("contact_clicks", -1);
        if (
                summaryId.isEmpty() ||
                !reportDate.matches("\\d{4}-\\d{2}-\\d{2}") ||
                views < 0 ||
                contacts < 0
        ) {
            return false;
        }

        SharedPreferences preferences = preferences(context);
        if (summaryId.equals(preferences.getString(LAST_SUMMARY, ""))) return false;

        Intent open = new Intent(context, MainActivity.class)
                .setAction(ACTION_OPEN_DAILY_SUMMARY)
                .setData(Uri.parse("vipgece://notification/summary/" + reportDate))
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
                context,
                2102,
                open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String text = context.getString(R.string.nt_162, views, contacts);
        String channelText = channelSummary(channels);
        String detail = channelText.isEmpty() ? text : text + "\n" + channelText;
        NotificationCompat.Builder builder = new NotificationCompat.Builder(
                context,
                INSIGHTS_CHANNEL
        )
                .setSmallIcon(R.drawable.ic_stat_vip_gece)
                .setContentTitle(context.getString(R.string.nt_164, formatReportDate(reportDate)))
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(detail))
                .setContentIntent(contentIntent)
                .setAutoCancel(true)
                .setOngoing(false)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setCategory(NotificationCompat.CATEGORY_STATUS)
                .setPriority(NotificationCompat.PRIORITY_LOW);

        try {
            NotificationManagerCompat.from(context).notify(
                    SUMMARY_NOTIFICATION_ID,
                    builder.build()
            );
        } catch (SecurityException denied) {
            return false;
        }
        if (!channelAllowed(context, INSIGHTS_CHANNEL)) return false;
        preferences.edit().putString(LAST_SUMMARY, summaryId).apply();
        return true;
    }

    public static void clearUpdate(Context source) {
        NotificationManagerCompat.from(source).cancel(UPDATE_NOTIFICATION_ID);
    }

    public static void clearDailySummary(Context source) {
        NotificationManagerCompat.from(source).cancel(SUMMARY_NOTIFICATION_ID);
    }

    public static void openSettings(Context source) {
        Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, source.getPackageName());
        source.startActivity(intent);
    }

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static String channelSummary(JSONObject channels) {
        if (channels == null) return "";
        long whatsapp = Math.max(0, channels.optLong("whatsapp", 0));
        long phone = Math.max(0, channels.optLong("phone", 0));
        long telegram = Math.max(0, channels.optLong("telegram", 0));
        StringBuilder result = new StringBuilder();
        appendChannel(result, "WhatsApp", whatsapp);
        appendChannel(result, "Telefon", phone);
        appendChannel(result, "Telegram", telegram);
        return result.toString();
    }

    private static void appendChannel(StringBuilder target, String label, long count) {
        if (count <= 0) return;
        if (target.length() > 0) target.append(" • ");
        target.append(label).append(' ').append(count);
    }

    private static String formatReportDate(String value) {
        try {
            return LocalDate.parse(value).format(
                    DateTimeFormatter.ofPattern("d MMMM", new Locale("tr", "TR"))
            );
        } catch (Exception ignored) {
            return value;
        }
    }
}
