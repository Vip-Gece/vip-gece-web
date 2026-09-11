package com.vipgece.customer.media;

import android.content.ContentResolver;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.net.Uri;

import androidx.exifinterface.media.ExifInterface;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;

public final class ProfileImageSanitizer {
    private static final int MAX_INPUT_BYTES = 24 * 1024 * 1024;
    private static final int MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
    private static final int MAX_EDGE_PX = 2560;
    private static final long MAX_SOURCE_PIXELS = 120_000_000L;
    private static final int[] JPEG_QUALITIES = { 90, 84, 78, 72 };

    private ProfileImageSanitizer() {}

    public static SanitizedImage read(ContentResolver resolver, Uri uri) throws Exception {
        byte[] source = readLimited(resolver, uri);

        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(source, 0, source.length, bounds);
        if (
                bounds.outWidth <= 0 ||
                bounds.outHeight <= 0 ||
                (long) bounds.outWidth * bounds.outHeight > MAX_SOURCE_PIXELS
        ) {
            throw new SecurityException("Bu görsel biçimi desteklenmiyor.");
        }

        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight);
        options.inPreferredConfig = Bitmap.Config.ARGB_8888;
        Bitmap decoded = BitmapFactory.decodeByteArray(source, 0, source.length, options);
        if (decoded == null) throw new SecurityException("Görsel açılamadı.");

        Bitmap oriented = orient(decoded, exifOrientation(source));
        if (oriented != decoded) decoded.recycle();

        Bitmap scaled = scaleDown(oriented);
        if (scaled != oriented) oriented.recycle();

        try {
            return new SanitizedImage("image/jpeg", encodeJpeg(scaled));
        } finally {
            scaled.recycle();
        }
    }

    private static byte[] readLimited(ContentResolver resolver, Uri uri) throws Exception {
        try (
                InputStream input = resolver.openInputStream(uri);
                ByteArrayOutputStream output = new ByteArrayOutputStream()
        ) {
            if (input == null) throw new SecurityException("Seçilen görsel okunamadı.");
            byte[] buffer = new byte[16 * 1024];
            int total = 0;
            int read;
            while ((read = input.read(buffer)) >= 0) {
                total += read;
                if (total > MAX_INPUT_BYTES) {
                    throw new SecurityException("Görsel dosyası çok büyük.");
                }
                output.write(buffer, 0, read);
            }
            if (total == 0) throw new SecurityException("Seçilen görsel boş.");
            return output.toByteArray();
        }
    }

    private static int sampleSize(int width, int height) {
        int sample = 1;
        while (width / sample > MAX_EDGE_PX * 2 || height / sample > MAX_EDGE_PX * 2) {
            sample *= 2;
        }
        return sample;
    }

    private static int exifOrientation(byte[] source) {
        try {
            ExifInterface exif = new ExifInterface(new ByteArrayInputStream(source));
            return exif.getAttributeInt(
                    ExifInterface.TAG_ORIENTATION,
                    ExifInterface.ORIENTATION_NORMAL
            );
        } catch (Exception ignored) {
            return ExifInterface.ORIENTATION_NORMAL;
        }
    }

    private static Bitmap orient(Bitmap source, int orientation) {
        Matrix matrix = new Matrix();
        switch (orientation) {
            case ExifInterface.ORIENTATION_FLIP_HORIZONTAL:
                matrix.setScale(-1f, 1f);
                break;
            case ExifInterface.ORIENTATION_ROTATE_180:
                matrix.setRotate(180f);
                break;
            case ExifInterface.ORIENTATION_FLIP_VERTICAL:
                matrix.setScale(1f, -1f);
                break;
            case ExifInterface.ORIENTATION_TRANSPOSE:
                matrix.setRotate(90f);
                matrix.postScale(-1f, 1f);
                break;
            case ExifInterface.ORIENTATION_ROTATE_90:
                matrix.setRotate(90f);
                break;
            case ExifInterface.ORIENTATION_TRANSVERSE:
                matrix.setRotate(-90f);
                matrix.postScale(-1f, 1f);
                break;
            case ExifInterface.ORIENTATION_ROTATE_270:
                matrix.setRotate(270f);
                break;
            default:
                return source;
        }
        return Bitmap.createBitmap(
                source,
                0,
                0,
                source.getWidth(),
                source.getHeight(),
                matrix,
                true
        );
    }

    private static Bitmap scaleDown(Bitmap source) {
        int width = source.getWidth();
        int height = source.getHeight();
        int longest = Math.max(width, height);
        if (longest <= MAX_EDGE_PX) return source;

        float scale = (float) MAX_EDGE_PX / longest;
        return Bitmap.createScaledBitmap(
                source,
                Math.max(1, Math.round(width * scale)),
                Math.max(1, Math.round(height * scale)),
                true
        );
    }

    private static byte[] encodeJpeg(Bitmap bitmap) {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        for (int quality : JPEG_QUALITIES) {
            output.reset();
            if (!bitmap.compress(Bitmap.CompressFormat.JPEG, quality, output)) {
                throw new SecurityException("Görsel hazırlanamadı.");
            }
            if (output.size() <= MAX_OUTPUT_BYTES) return output.toByteArray();
        }
        throw new SecurityException("Görsel yükleme için çok büyük.");
    }

    public static final class SanitizedImage {
        public final String contentType;
        public final byte[] bytes;

        private SanitizedImage(String contentType, byte[] bytes) {
            this.contentType = contentType;
            this.bytes = bytes;
        }
    }
}
