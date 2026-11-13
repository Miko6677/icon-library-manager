package io.cue.iconmanager;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Matrix;
import android.util.Base64;

import androidx.exifinterface.media.ExifInterface;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;

/** Runs MobileSAM entirely on the Android device; source images are never sent to a service. */
final class MobileSamProcessor implements AutoCloseable {
    interface Callback {
        void onProgress(String requestId, String message);
        void onPrepared(String requestId, int width, int height, String error);
        void onMaskReady(String requestId, String encodedPng, String error);
    }

    private static final int MAX_INPUT_BYTES = 12 * 1024 * 1024;
    private static final int MAX_OUTPUT_BYTES = 12 * 1024 * 1024;
    private static final int MAX_SOURCE_SIDE = 2048;
    private static final int ENCODER_LONG_SIDE = 1024;
    private static final int MASK_SIDE = 256;
    private static final String ENCODER_ASSET = "models/mobile_sam.encoder.quant.onnx";
    private static final String DECODER_ASSET = "models/sam_vit_h_4b8939.decoder.quant.onnx";

    private final Context context;
    private final Callback callback;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private OrtEnvironment environment;
    private OrtSession encoder;
    private OrtSession decoder;
    private CutoutState activeState;
    private volatile boolean closed;

    MobileSamProcessor(Context context, Callback callback) {
        this.context = context.getApplicationContext();
        this.callback = callback;
    }

    void prepare(String requestId, String encodedImage) {
        if (closed) {
            callback.onPrepared(requestId, 0, 0, "本机抠图处理器已关闭，请重新打开应用。");
            return;
        }
        if (requestId == null || !requestId.matches("[A-Za-z0-9_-]{1,80}") || encodedImage == null
                || encodedImage.length() > 20 * 1024 * 1024) {
            callback.onPrepared(requestId == null ? "" : requestId, 0, 0, "图片数据无效或过大，请重新选择。");
            return;
        }
        try {
            executor.execute(() -> prepareOnDevice(requestId, encodedImage));
        } catch (RejectedExecutionException error) {
            callback.onPrepared(requestId, 0, 0, "本机抠图处理器正在关闭，请重新打开应用后再试。");
        }
    }

    private void prepareOnDevice(String requestId, String encodedImage) {
        if (closed) {
            callback.onPrepared(requestId, 0, 0, "本机抠图处理器已关闭，请重新打开应用。");
            return;
        }
        Bitmap source = null;
        try {
            byte[] bytes = Base64.decode(encodedImage, Base64.DEFAULT);
            if (bytes.length == 0 || bytes.length > MAX_INPUT_BYTES) {
                throw new IllegalArgumentException("图片需小于 12 MB。");
            }
            callback.onProgress(requestId, "正在本机准备 MobileSAM 模型与图像…");
            ensureSessions();
            source = decodeBitmap(bytes);
            int sourceWidth = source.getWidth();
            int sourceHeight = source.getHeight();
            float scale = ENCODER_LONG_SIDE / (float) Math.max(sourceWidth, sourceHeight);
            int resizedWidth = Math.max(1, Math.round(sourceWidth * scale));
            int resizedHeight = Math.max(1, Math.round(sourceHeight * scale));
            Bitmap encoderBitmap = Bitmap.createScaledBitmap(source, resizedWidth, resizedHeight, true);

            FloatBuffer imagePixels = directFloatBuffer(resizedWidth * resizedHeight * 3);
            int[] pixels = new int[resizedWidth * resizedHeight];
            encoderBitmap.getPixels(pixels, 0, resizedWidth, 0, 0, resizedWidth, resizedHeight);
            for (int pixel : pixels) {
                imagePixels.put((float) Color.red(pixel));
                imagePixels.put((float) Color.green(pixel));
                imagePixels.put((float) Color.blue(pixel));
            }
            imagePixels.rewind();
            if (encoderBitmap != source && !encoderBitmap.isRecycled()) encoderBitmap.recycle();

            FloatBuffer embedding;
            try (OnnxTensor input = OnnxTensor.createTensor(environment, imagePixels,
                    new long[]{resizedHeight, resizedWidth, 3});
                 OrtSession.Result outputs = encoder.run(Collections.singletonMap("input_image", input))) {
                FloatBuffer encoded = ((OnnxTensor) outputs.get(0)).getFloatBuffer();
                encoded.rewind();
                embedding = directFloatBuffer(encoded.remaining());
                embedding.put(encoded);
                embedding.rewind();
            }

            releaseEncoderSession();
            releaseActiveState();
            activeState = new CutoutState(requestId, source, embedding, sourceWidth, sourceHeight, resizedWidth, resizedHeight);
            source = null;
            callback.onPrepared(requestId, sourceWidth, sourceHeight, null);
        } catch (OutOfMemoryError error) {
            if (source != null && !source.isRecycled()) source.recycle();
            releaseActiveState();
            releaseSessions();
            callback.onPrepared(requestId, 0, 0, "设备内存不足，无法准备精修；请尝试较小的原图后重试。");
        } catch (Exception error) {
            if (source != null && !source.isRecycled()) source.recycle();
            releaseActiveState();
            releaseSessions();
            callback.onPrepared(requestId, 0, 0, readableError(error));
        }
    }

    void predict(String requestId, String pointsJson) {
        if (closed) {
            callback.onMaskReady(requestId, null, "本机抠图处理器已关闭，请重新打开应用。");
            return;
        }
        try {
            executor.execute(() -> predictOnDevice(requestId, pointsJson));
        } catch (RejectedExecutionException error) {
            callback.onMaskReady(requestId, null, "本机抠图处理器正在关闭，请重新打开应用后再试。");
        }
    }

    private void predictOnDevice(String requestId, String pointsJson) {
        if (closed) {
            callback.onMaskReady(requestId, null, "本机抠图处理器已关闭，请重新打开应用。");
            return;
        }
        CutoutState state = activeState;
        if (state == null || !state.requestId.equals(requestId)) {
            callback.onMaskReady(requestId, null, "当前图片已取消，请重新开始抠图。");
            return;
        }
        Bitmap resultBitmap = null;
        try {
            JSONArray points = new JSONArray(pointsJson == null ? "[]" : pointsJson);
            if (points.length() < 1 || points.length() > 16) {
                throw new IllegalArgumentException("请添加 1 到 16 个前景或背景点。");
            }
            boolean hasForeground = false;
            int tensorPoints = points.length() + 1;
            FloatBuffer coordinates = directFloatBuffer(tensorPoints * 2);
            FloatBuffer labels = directFloatBuffer(tensorPoints);
            for (int i = 0; i < points.length(); i++) {
                JSONObject point = points.getJSONObject(i);
                float nx = (float) point.getDouble("x");
                float ny = (float) point.getDouble("y");
                int label = point.getInt("label");
                if (label != 0 && label != 1) throw new IllegalArgumentException("点选标记无效。");
                if (label == 1) hasForeground = true;
                float sourceX = Math.max(0f, Math.min(1f, nx)) * state.sourceWidth;
                float sourceY = Math.max(0f, Math.min(1f, ny)) * state.sourceHeight;
                coordinates.put(sourceX * state.resizedWidth / state.sourceWidth);
                coordinates.put(sourceY * state.resizedHeight / state.sourceHeight);
                labels.put((float) label);
            }
            if (!hasForeground) throw new IllegalArgumentException("请至少添加一个绿色前景点，指定要保留的主体。");
            coordinates.put(0f).put(0f);
            labels.put(-1f);
            coordinates.rewind();
            labels.rewind();

            FloatBuffer emptyMask = directFloatBuffer(MASK_SIDE * MASK_SIDE);
            FloatBuffer hasMask = directFloatBuffer(1);
            hasMask.put(0f).rewind();
            FloatBuffer originalSize = directFloatBuffer(2);
            originalSize.put((float) state.sourceHeight).put((float) state.sourceWidth).rewind();

            callback.onProgress(requestId, "正在本机生成透明掩码…");
            try (OnnxTensor embeddingTensor = OnnxTensor.createTensor(environment, duplicate(state.embedding),
                         new long[]{1, 256, 64, 64});
                 OnnxTensor coordinatesTensor = OnnxTensor.createTensor(environment, coordinates,
                         new long[]{1, tensorPoints, 2});
                 OnnxTensor labelsTensor = OnnxTensor.createTensor(environment, labels,
                         new long[]{1, tensorPoints});
                 OnnxTensor maskTensor = OnnxTensor.createTensor(environment, emptyMask,
                         new long[]{1, 1, MASK_SIDE, MASK_SIDE});
                 OnnxTensor hasMaskTensor = OnnxTensor.createTensor(environment, hasMask, new long[]{1});
                 OnnxTensor sizeTensor = OnnxTensor.createTensor(environment, originalSize, new long[]{2})) {
                Map<String, OnnxTensor> inputs = new HashMap<>();
                inputs.put("image_embeddings", embeddingTensor);
                inputs.put("point_coords", coordinatesTensor);
                inputs.put("point_labels", labelsTensor);
                inputs.put("mask_input", maskTensor);
                inputs.put("has_mask_input", hasMaskTensor);
                inputs.put("orig_im_size", sizeTensor);
                try (OrtSession.Result outputs = decoder.run(inputs)) {
                    FloatBuffer lowResolutionMask = ((OnnxTensor) outputs.get(2)).getFloatBuffer();
                    lowResolutionMask.rewind();
                    resultBitmap = createTransparentResult(state, lowResolutionMask);
                }
            }
            byte[] png = encodePngWithinLimit(resultBitmap);
            resultBitmap.recycle();
            resultBitmap = null;
            callback.onMaskReady(requestId, Base64.encodeToString(png, Base64.NO_WRAP), null);
        } catch (OutOfMemoryError error) {
            if (resultBitmap != null && !resultBitmap.isRecycled()) resultBitmap.recycle();
            callback.onMaskReady(requestId, null, "设备内存不足，无法完成精修；请尝试较小的原图后重试。");
        } catch (Exception error) {
            if (resultBitmap != null && !resultBitmap.isRecycled()) resultBitmap.recycle();
            callback.onMaskReady(requestId, null, readableError(error));
        }
    }

    void cancel(String requestId) {
        if (closed) return;
        try {
            executor.execute(() -> {
                if (activeState != null && activeState.requestId.equals(requestId)) releaseActiveState();
                releaseSessions();
            });
        } catch (RejectedExecutionException ignored) { }
    }

    private void ensureSessions() throws Exception {
        if (encoder != null && decoder != null) return;
        releaseSessions();
        File encoderFile = copyAssetToFiles(ENCODER_ASSET);
        File decoderFile = copyAssetToFiles(DECODER_ASSET);
        environment = OrtEnvironment.getEnvironment();
        try (OrtSession.SessionOptions options = new OrtSession.SessionOptions()) {
            options.setIntraOpNumThreads(Math.max(1, Math.min(2, Runtime.getRuntime().availableProcessors())));
            options.setInterOpNumThreads(1);
            options.setExecutionMode(OrtSession.SessionOptions.ExecutionMode.SEQUENTIAL);
            encoder = environment.createSession(encoderFile.getAbsolutePath(), options);
            decoder = environment.createSession(decoderFile.getAbsolutePath(), options);
        }
    }

    private File copyAssetToFiles(String assetPath) throws Exception {
        File modelDirectory = new File(context.getFilesDir(), "models");
        if (!modelDirectory.exists() && !modelDirectory.mkdirs()) {
            throw new IllegalStateException("无法准备本机模型目录。");
        }
        String filename = assetPath.substring(assetPath.lastIndexOf('/') + 1);
        File target = new File(modelDirectory, filename);
        if (target.exists() && target.length() > 0) return target;
        File temporary = new File(modelDirectory, filename + ".tmp");
        try (InputStream input = context.getAssets().open(assetPath);
             FileOutputStream output = new FileOutputStream(temporary)) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            output.flush();
        }
        if (target.exists() && !target.delete()) throw new IllegalStateException("无法更新本机模型文件。");
        if (!temporary.renameTo(target)) throw new IllegalStateException("无法保存本机模型文件。");
        return target;
    }

    private Bitmap decodeBitmap(byte[] bytes) throws Exception {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0
                || (long) bounds.outWidth * (long) bounds.outHeight > 500_000_000L) {
            throw new IllegalArgumentException("无法读取这张图片，或图片尺寸过大。");
        }
        if (bounds.outWidth < 256 || bounds.outHeight < 256) {
            throw new IllegalArgumentException("图片至少需要 256 × 256 像素才能处理。");
        }
        int sample = 1;
        while (Math.max(bounds.outWidth, bounds.outHeight) / sample > MAX_SOURCE_SIDE) sample *= 2;
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sample;
        options.inPreferredConfig = Bitmap.Config.ARGB_8888;
        options.inMutable = true;
        Bitmap decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
        if (decoded == null) throw new IllegalArgumentException("无法解码此图片格式；请尝试 PNG、JPG 或 WebP。");

        ExifInterface exif = new ExifInterface(new ByteArrayInputStream(bytes));
        int orientation = exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
        Matrix transform = new Matrix();
        switch (orientation) {
            case ExifInterface.ORIENTATION_FLIP_HORIZONTAL: transform.setScale(-1f, 1f); break;
            case ExifInterface.ORIENTATION_ROTATE_180: transform.setRotate(180f); break;
            case ExifInterface.ORIENTATION_FLIP_VERTICAL: transform.setScale(1f, -1f); break;
            case ExifInterface.ORIENTATION_TRANSPOSE: transform.setRotate(90f); transform.postScale(-1f, 1f); break;
            case ExifInterface.ORIENTATION_ROTATE_90: transform.setRotate(90f); break;
            case ExifInterface.ORIENTATION_TRANSVERSE: transform.setRotate(-90f); transform.postScale(-1f, 1f); break;
            case ExifInterface.ORIENTATION_ROTATE_270: transform.setRotate(-90f); break;
            default: return decoded;
        }
        Bitmap oriented = Bitmap.createBitmap(decoded, 0, 0, decoded.getWidth(), decoded.getHeight(), transform, true);
        if (oriented != decoded) decoded.recycle();
        return oriented;
    }

    private Bitmap createTransparentResult(CutoutState state, FloatBuffer mask) {
        int width = state.sourceWidth;
        int height = state.sourceHeight;
        if (mask.remaining() < MASK_SIDE * MASK_SIDE) throw new IllegalArgumentException("模型返回的掩码尺寸无效，请重试。");
        float[] logits = new float[MASK_SIDE * MASK_SIDE];
        mask.get(logits);
        int[] pixels = new int[width * height];
        state.source.getPixels(pixels, 0, width, 0, 0, width, height);
        int retained = 0;
        for (int y = 0, index = 0; y < height; y++) {
            float maskY = ((y + 0.5f) * state.resizedHeight / height) * MASK_SIDE / ENCODER_LONG_SIDE - 0.5f;
            for (int x = 0; x < width; x++, index++) {
                float maskX = ((x + 0.5f) * state.resizedWidth / width) * MASK_SIDE / ENCODER_LONG_SIDE - 0.5f;
                float logit = bilinear(logits, maskX, maskY);
                float alphaValue = Math.max(0f, Math.min(1f, (logit + 1.5f) / 3f));
                alphaValue = alphaValue * alphaValue * (3f - 2f * alphaValue);
                int sourcePixel = pixels[index];
                int sourceAlpha = (sourcePixel >>> 24) & 0xff;
                int alpha = Math.round(sourceAlpha * alphaValue);
                if (alpha > 8) retained++;
                pixels[index] = (sourcePixel & 0x00ffffff) | (alpha << 24);
            }
        }
        if (retained < 16) throw new IllegalArgumentException("没有得到有效掩码；请在主体上添加绿色前景点，或再加红色背景点修正。");
        Bitmap result = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        result.setPixels(pixels, 0, width, 0, 0, width, height);
        return result;
    }

    private static float bilinear(float[] values, float x, float y) {
        x = Math.max(0f, Math.min(MASK_SIDE - 1f, x));
        y = Math.max(0f, Math.min(MASK_SIDE - 1f, y));
        int x0 = (int) x;
        int y0 = (int) y;
        int x1 = Math.min(MASK_SIDE - 1, x0 + 1);
        int y1 = Math.min(MASK_SIDE - 1, y0 + 1);
        float dx = x - x0;
        float dy = y - y0;
        float top = values[y0 * MASK_SIDE + x0] * (1f - dx) + values[y0 * MASK_SIDE + x1] * dx;
        float bottom = values[y1 * MASK_SIDE + x0] * (1f - dx) + values[y1 * MASK_SIDE + x1] * dx;
        return top * (1f - dy) + bottom * dy;
    }

    private byte[] encodePngWithinLimit(Bitmap bitmap) throws Exception {
        Bitmap working = bitmap;
        for (int attempt = 0; attempt < 7; attempt++) {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            working.compress(Bitmap.CompressFormat.PNG, 100, output);
            byte[] png = output.toByteArray();
            if (png.length <= MAX_OUTPUT_BYTES) {
                if (working != bitmap) working.recycle();
                return png;
            }
            if (Math.min(working.getWidth(), working.getHeight()) <= 512) break;
            Bitmap smaller = Bitmap.createScaledBitmap(working,
                    Math.max(1, Math.round(working.getWidth() * 0.82f)),
                    Math.max(1, Math.round(working.getHeight() * 0.82f)), true);
            if (working != bitmap) working.recycle();
            working = smaller;
        }
        if (working != bitmap && !working.isRecycled()) working.recycle();
        throw new IllegalArgumentException("透明 PNG 超过 12 MB 限制；请尝试较小的原图。");
    }

    private void releaseActiveState() {
        if (activeState != null) {
            activeState.source.recycle();
            activeState = null;
        }
    }

    private void releaseEncoderSession() {
        try { if (encoder != null) encoder.close(); } catch (Exception ignored) { }
        encoder = null;
    }

    private void releaseSessions() {
        releaseEncoderSession();
        try { if (decoder != null) decoder.close(); } catch (Exception ignored) { }
        decoder = null;
    }

    private static FloatBuffer directFloatBuffer(int size) {
        return ByteBuffer.allocateDirect(size * 4).order(ByteOrder.nativeOrder()).asFloatBuffer();
    }

    private static FloatBuffer duplicate(FloatBuffer source) {
        FloatBuffer duplicate = source.duplicate();
        duplicate.rewind();
        return duplicate;
    }

    private static String readableError(Exception error) {
        String message = error.getMessage();
        return message == null || message.trim().isEmpty() ? "请换一张图片后重试。" : message.trim();
    }

    @Override
    public void close() {
        if (closed) return;
        closed = true;
        try {
            executor.execute(() -> {
                releaseActiveState();
                releaseSessions();
            });
        } catch (RejectedExecutionException ignored) {
            releaseActiveState();
            releaseSessions();
        }
        executor.shutdown();
    }

    private static final class CutoutState {
        final String requestId;
        final Bitmap source;
        final FloatBuffer embedding;
        final int sourceWidth;
        final int sourceHeight;
        final int resizedWidth;
        final int resizedHeight;

        CutoutState(String requestId, Bitmap source, FloatBuffer embedding,
                    int sourceWidth, int sourceHeight, int resizedWidth, int resizedHeight) {
            this.requestId = requestId;
            this.source = source;
            this.embedding = embedding;
            this.sourceWidth = sourceWidth;
            this.sourceHeight = sourceHeight;
            this.resizedWidth = resizedWidth;
            this.resizedHeight = resizedHeight;
        }
    }
}
