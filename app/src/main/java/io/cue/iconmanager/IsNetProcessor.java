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

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.util.Collections;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Runs the IS-Net initial mask entirely on-device and releases its ONNX session after each image. */
final class IsNetProcessor implements AutoCloseable {
    interface Callback {
        void onProgress(String requestId, String message);
        void onMaskReady(String requestId, String encodedPng, String error);
    }

    private static final int MAX_INPUT_BYTES = 12 * 1024 * 1024;
    private static final int MAX_OUTPUT_BYTES = 12 * 1024 * 1024;
    private static final int MAX_SOURCE_SIDE = 2048;
    // 512 is supported by the model's dynamic spatial axes and reduces peak native memory on phones.
    // MobileSAM remains available on demand for detail-sensitive refinement.
    private static final int MODEL_SIDE = 512;
    private static final String MODEL_ASSET = "models/isnet-general-use-q8.onnx";

    private final Context context;
    private final Callback callback;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Set<String> activeRequests = Collections.newSetFromMap(new ConcurrentHashMap<>());
    private final Set<String> cancelledRequests = Collections.newSetFromMap(new ConcurrentHashMap<>());
    private volatile boolean closed;

    IsNetProcessor(Context context, Callback callback) {
        this.context = context.getApplicationContext();
        this.callback = callback;
    }

    void process(String requestId, String encodedImage) {
        if (closed) {
            callback.onMaskReady(requestId, null, "本机自动抠图处理器已关闭，请重新打开应用。");
            return;
        }
        if (requestId == null || !requestId.matches("[A-Za-z0-9_-]{1,80}")
                || encodedImage == null || encodedImage.length() > 20 * 1024 * 1024) {
            callback.onMaskReady(requestId == null ? "" : requestId, null, "图片数据无效或过大，请重新选择。");
            return;
        }
        cancelledRequests.remove(requestId);
        activeRequests.add(requestId);
        try {
            executor.execute(() -> processOnDevice(requestId, encodedImage));
        } catch (RuntimeException error) {
            activeRequests.remove(requestId);
            cancelledRequests.remove(requestId);
            callback.onMaskReady(requestId, null, "本机自动抠图已关闭，请重新打开应用后重试。");
        }
    }

    private void processOnDevice(String requestId, String encodedImage) {
        Bitmap source = null;
        Bitmap modelBitmap = null;
        Bitmap resultBitmap = null;
        OrtSession session = null;
        try {
            if (isCancelled(requestId)) return;
            byte[] bytes = Base64.decode(encodedImage, Base64.DEFAULT);
            if (bytes.length == 0 || bytes.length > MAX_INPUT_BYTES) {
                throw new IllegalArgumentException("图片需小于 12 MB。");
            }
            callback.onProgress(requestId, "正在本机自动生成初始掩码（512 × 512）… 图片不会上传。");
            source = decodeBitmap(bytes);
            modelBitmap = Bitmap.createScaledBitmap(source, MODEL_SIDE, MODEL_SIDE, true);
            FloatBuffer pixels = createInputTensor(modelBitmap);
            if (modelBitmap != source && !modelBitmap.isRecycled()) modelBitmap.recycle();
            modelBitmap = null;
            if (isCancelled(requestId)) return;

            OrtEnvironment environment = OrtEnvironment.getEnvironment();
            File modelFile = copyModelToFiles();
            try (OrtSession.SessionOptions options = new OrtSession.SessionOptions()) {
                options.setIntraOpNumThreads(2);
                options.setInterOpNumThreads(1);
                options.setExecutionMode(OrtSession.SessionOptions.ExecutionMode.SEQUENTIAL);
                options.setMemoryPatternOptimization(false);
                options.setCPUArenaAllocator(false);
                session = environment.createSession(modelFile.getAbsolutePath(), options);
            }

            try (OnnxTensor input = OnnxTensor.createTensor(environment, pixels,
                    new long[]{1, 3, MODEL_SIDE, MODEL_SIDE});
                 OrtSession.Result outputs = session.run(Collections.singletonMap("input", input),
                         Collections.singleton("output"))) {
                Object output = outputs.get(0);
                if (!(output instanceof OnnxTensor)) {
                    throw new IllegalStateException("IS-Net output 类型不是浮点张量。");
                }
                FloatBuffer mask = ((OnnxTensor) output).getFloatBuffer();
                if (mask.remaining() < MODEL_SIDE * MODEL_SIDE) {
                    throw new IllegalStateException("IS-Net 返回的掩码尺寸无效。");
                }
                resultBitmap = createTransparentResult(source, mask);
            }
            byte[] png = encodePngWithinLimit(resultBitmap);
            if (!resultBitmap.isRecycled()) resultBitmap.recycle();
            resultBitmap = null;
            if (!isCancelled(requestId)) {
                callback.onMaskReady(requestId, Base64.encodeToString(png, Base64.NO_WRAP), null);
            }
        } catch (OutOfMemoryError error) {
            callback.onMaskReady(requestId, null,
                    "设备可用内存不足，自动抠图未完成。请关闭其他应用后重试，或使用点选精修/原图。");
        } catch (Exception error) {
            callback.onMaskReady(requestId, null, readableError(error));
        } finally {
            if (source != null && !source.isRecycled()) source.recycle();
            if (modelBitmap != null && modelBitmap != source && !modelBitmap.isRecycled()) modelBitmap.recycle();
            if (resultBitmap != null && !resultBitmap.isRecycled()) resultBitmap.recycle();
            if (session != null) {
                try { session.close(); } catch (Exception ignored) { }
            }
            cancelledRequests.remove(requestId);
            activeRequests.remove(requestId);
        }
    }

    void cancel(String requestId) {
        if (requestId != null && activeRequests.contains(requestId)) cancelledRequests.add(requestId);
    }

    private boolean isCancelled(String requestId) {
        return closed || cancelledRequests.contains(requestId);
    }

    private FloatBuffer createInputTensor(Bitmap bitmap) {
        int[] colors = new int[MODEL_SIDE * MODEL_SIDE];
        bitmap.getPixels(colors, 0, MODEL_SIDE, 0, 0, MODEL_SIDE, MODEL_SIDE);
        FloatBuffer input = directFloatBuffer(3 * MODEL_SIDE * MODEL_SIDE);
        int planeSize = MODEL_SIDE * MODEL_SIDE;
        for (int i = 0; i < planeSize; i++) input.put(i, (Color.red(colors[i]) - 128f) / 256f);
        for (int i = 0; i < planeSize; i++) input.put(planeSize + i, (Color.green(colors[i]) - 128f) / 256f);
        for (int i = 0; i < planeSize; i++) input.put(2 * planeSize + i, (Color.blue(colors[i]) - 128f) / 256f);
        input.rewind();
        return input;
    }

    private File copyModelToFiles() throws Exception {
        File modelDirectory = new File(context.getFilesDir(), "models");
        if (!modelDirectory.exists() && !modelDirectory.mkdirs()) {
            throw new IllegalStateException("无法准备本机模型目录。");
        }
        File target = new File(modelDirectory, "isnet-general-use-q8.onnx");
        if (target.isFile() && target.length() == 44_436_071L) return target;
        File temporary = new File(modelDirectory, "isnet-general-use-q8.onnx.tmp");
        try (InputStream input = context.getAssets().open(MODEL_ASSET);
             FileOutputStream output = new FileOutputStream(temporary)) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            output.flush();
        }
        if (temporary.length() != 44_436_071L) {
            temporary.delete();
            throw new IllegalStateException("IS-Net 模型文件不完整，请重新安装应用。");
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

    private Bitmap createTransparentResult(Bitmap source, FloatBuffer mask) {
        int width = source.getWidth();
        int height = source.getHeight();
        float[] values = new float[MODEL_SIDE * MODEL_SIDE];
        mask.rewind();
        mask.get(values);
        int[] pixels = new int[width * height];
        source.getPixels(pixels, 0, width, 0, 0, width, height);
        int retained = 0;
        for (int y = 0, index = 0; y < height; y++) {
            float my = ((y + 0.5f) * MODEL_SIDE / height) - 0.5f;
            for (int x = 0; x < width; x++, index++) {
                float mx = ((x + 0.5f) * MODEL_SIDE / width) - 0.5f;
                float alphaValue = bilinear(values, mx, my);
                int sourcePixel = pixels[index];
                int sourceAlpha = (sourcePixel >>> 24) & 0xff;
                int alpha = Math.round(sourceAlpha * Math.max(0f, Math.min(1f, alphaValue)));
                if (alpha > 8) retained++;
                pixels[index] = (sourcePixel & 0x00ffffff) | (alpha << 24);
            }
        }
        if (retained < 16) throw new IllegalArgumentException("未能生成有效的主体掩码；请重试或改用点选精修。");
        Bitmap result = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        result.setPixels(pixels, 0, width, 0, 0, width, height);
        return result;
    }

    private static float bilinear(float[] values, float x, float y) {
        x = Math.max(0f, Math.min(MODEL_SIDE - 1f, x));
        y = Math.max(0f, Math.min(MODEL_SIDE - 1f, y));
        int x0 = (int) x;
        int y0 = (int) y;
        int x1 = Math.min(MODEL_SIDE - 1, x0 + 1);
        int y1 = Math.min(MODEL_SIDE - 1, y0 + 1);
        float dx = x - x0;
        float dy = y - y0;
        float top = values[y0 * MODEL_SIDE + x0] * (1f - dx) + values[y0 * MODEL_SIDE + x1] * dx;
        float bottom = values[y1 * MODEL_SIDE + x0] * (1f - dx) + values[y1 * MODEL_SIDE + x1] * dx;
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

    private static FloatBuffer directFloatBuffer(int size) {
        return ByteBuffer.allocateDirect(size * 4).order(ByteOrder.nativeOrder()).asFloatBuffer();
    }

    private static String readableError(Exception error) {
        String message = error.getMessage();
        return message == null || message.trim().isEmpty() ? "请换一张图片后重试。" : message.trim();
    }

    @Override
    public void close() {
        closed = true;
        executor.shutdown();
    }
}
