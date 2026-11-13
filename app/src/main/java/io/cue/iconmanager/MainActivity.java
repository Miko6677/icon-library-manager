package io.cue.iconmanager;

import android.app.Activity;
import android.app.WallpaperColors;
import android.app.WallpaperManager;
import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ComponentName;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.provider.MediaStore;
import android.os.Handler;
import android.os.Looper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.util.AtomicFile;
import android.view.View;
import android.view.Window;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceResponse;
import android.widget.Toast;

import androidx.annotation.Nullable;
import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;
import org.json.JSONArray;

import java.net.URI;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.security.MessageDigest;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 7412;
    private static final String APP_HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + APP_HOST + "/assets/index.html";
    private static final String DEFAULT_GITHUB_API_BASE = "https://api.github.com";
    private static final String DEFAULT_GITHUB_RAW_BASE = "https://raw.githubusercontent.com";
    private static final int MAX_LIBRARY_SNAPSHOT_BYTES = 4 * 1024 * 1024;

    private static String normalizeHttpsBaseUrl(String value) {
        if (value == null || value.trim().isEmpty() || value.length() > 512) return null;
        try {
            URI uri = new URI(value.trim()).normalize();
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null
                    || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null) return null;
            String normalized = uri.toASCIIString();
            while (normalized.endsWith("/")) normalized = normalized.substring(0, normalized.length() - 1);
            return normalized;
        } catch (Exception ignored) { return null; }
    }

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private WebViewAssetLoader assetLoader;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private PickedImageCache pickedImageCache;
    private PersistentImageCache persistentImageCache;
    private ExecutorService imageCopyExecutor;
    private int pickerGeneration;
    private boolean destroyed;
    private boolean backDispatchPending;
    private OnBackInvokedCallback backInvokedCallback;
    private MobileSamProcessor mobileSamProcessor;
    private IsNetProcessor isNetProcessor;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            backInvokedCallback = this::dispatchBackToWeb;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, backInvokedCallback);
        }
        try {
            pickedImageCache = new PickedImageCache(getApplicationContext());
        } catch (Exception error) {
            pickedImageCache = null;
        }
        try {
            persistentImageCache = new PersistentImageCache(new File(getFilesDir(), "remote-icon-images"));
        } catch (Exception error) {
            persistentImageCache = null;
        }
        imageCopyExecutor = Executors.newSingleThreadExecutor();
        mobileSamProcessor = new MobileSamProcessor(getApplicationContext(), new MobileSamProcessor.Callback() {
            @Override public void onProgress(String requestId, String message) {
                deliverCutoutProgress(requestId, message);
            }
            @Override public void onPrepared(String requestId, int width, int height, String error) {
                deliverCutoutPrepared(requestId, width, height, error);
            }
            @Override public void onMaskReady(String requestId, String encodedPng, String error) {
                deliverCutoutResult(requestId, encodedPng, error);
            }
        });
        isNetProcessor = new IsNetProcessor(getApplicationContext(), new IsNetProcessor.Callback() {
            @Override public void onProgress(String requestId, String message) {
                deliverCutoutProgress(requestId, message);
            }
            @Override public void onMaskReady(String requestId, String encodedPng, String error) {
                deliverCutoutResult(requestId, encodedPng, error);
            }
        });
        applyNativeAppearance(getSharedPreferences("app_preferences", MODE_PRIVATE).getString("appearance", "system"));

        assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView = new WebView(this);
        setContentView(webView);
        applyNativeAppearance(getSharedPreferences("app_preferences", MODE_PRIVATE).getString("appearance", "system"));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setSaveFormData(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        applyNativeAppearance(getSharedPreferences("app_preferences", MODE_PRIVATE).getString("appearance", "system"));
        WebView.setWebContentsDebuggingEnabled(false);
        webView.addJavascriptInterface(new LocalTokenBridge(), "CueTokenStore");
        webView.addJavascriptInterface(new AppSettingsBridge(), "CueAppSettings");
        webView.addJavascriptInterface(new BackgroundRemovalBridge(), "CueBackgroundRemoval");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri resourceUrl = request.getUrl();
                if (persistentImageCache != null && !APP_HOST.equalsIgnoreCase(resourceUrl.getHost())) {
                    PersistentImageCache.ImageResponse image = persistentImageCache.get(
                            resourceUrl.toString(), request.getMethod(), request.getRequestHeaders());
                    if (image != null) {
                        return new WebResourceResponse(image.mimeType, null, 200, "OK",
                                Collections.singletonMap("Cache-Control", "no-store"), image.body);
                    }
                }
                return assetLoader.shouldInterceptRequest(resourceUrl);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("https".equalsIgnoreCase(uri.getScheme()) && APP_HOST.equalsIgnoreCase(uri.getHost())) {
                    return false;
                }
                openExternal(uri);
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePathCallback != null) resolveFileChooser(null);
                pickerGeneration++;
                filePathCallback = callback;
                boolean allowMultiple = params != null
                        && params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE;
                Intent intent = null;
                if (!allowMultiple && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent = new Intent(MediaStore.ACTION_PICK_IMAGES);
                    intent.setType("image/*");
                }
                try {
                    if (intent == null) intent = createDocumentPickerIntent(allowMultiple);
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                    return true;
                } catch (ActivityNotFoundException | SecurityException error) {
                    if (intent != null && MediaStore.ACTION_PICK_IMAGES.equals(intent.getAction())) {
                        try {
                            startActivityForResult(createDocumentPickerIntent(false), FILE_CHOOSER_REQUEST);
                            return true;
                        } catch (ActivityNotFoundException | SecurityException ignored) {
                            // Report the same graceful failure as the normal document-picker path.
                        }
                    }
                    filePathCallback = null;
                    pickerGeneration++;
                    callback.onReceiveValue(null);
                    Toast.makeText(MainActivity.this, "找不到可用的系统照片/文件选择器。", Toast.LENGTH_LONG).show();
                    return false;
                }
            }
        });

        webView.loadUrl(START_URL);
    }

    private Intent createDocumentPickerIntent(boolean allowMultiple) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("image/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, allowMultiple);
        intent.putExtra(Intent.EXTRA_MIME_TYPES,
                new String[]{"image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"});
        return intent;
    }

    private void openExternal(Uri uri) {
        if (uri == null || !"https".equalsIgnoreCase(uri.getScheme())) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException ignored) {
            Toast.makeText(this, "没有可打开此链接的应用。", Toast.LENGTH_SHORT).show();
        }
    }

    private void applyNativeAppearance(String appearance) {
        boolean blackBackground = getSharedPreferences("app_preferences", MODE_PRIVATE)
                .getBoolean("blackBackground", false);
        applyNativeAppearance(appearance, blackBackground);
    }

    private void applyNativeAppearance(String appearance, boolean blackBackground) {
        boolean dark = "dark".equals(appearance)
                || ("system".equals(appearance) && isSystemDark());
        int color = dark
                ? (blackBackground ? Color.BLACK : Color.rgb(25, 26, 39))
                : Color.rgb(246, 247, 251);
        Window window = getWindow();
        window.setStatusBarColor(color);
        window.setNavigationBarColor(color);
        int flags = window.getDecorView().getSystemUiVisibility();
        flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) flags &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        if (!dark) {
            flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        }
        window.getDecorView().setSystemUiVisibility(flags);
        if (webView != null) webView.setBackgroundColor(color);
    }

    @Override
    protected void onResume() {
        super.onResume();
        applyNativeAppearance(getSharedPreferences("app_preferences", MODE_PRIVATE).getString("appearance", "system"));
        if (webView != null) {
            webView.evaluateJavascript("window.onCueSystemThemeChanged && window.onCueSystemThemeChanged(" + isSystemDark() + ");", null);
        }
        notifyWebSystemAccent();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        applyNativeAppearance(getSharedPreferences("app_preferences", MODE_PRIVATE).getString("appearance", "system"));
        if (webView != null) {
            webView.evaluateJavascript("window.onCueSystemThemeChanged && window.onCueSystemThemeChanged(" + isSystemDark() + ");", null);
        }
        notifyWebSystemAccent();
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER_REQUEST) return;
        if (filePathCallback == null) return;
        if (resultCode != RESULT_OK || data == null) {
            resolveFileChooser(null);
            return;
        }
        List<Uri> selected = new ArrayList<>();
        ClipData clipData = data.getClipData();
        if (clipData != null) {
            for (int i = 0; i < clipData.getItemCount(); i++) {
                ClipData.Item item = clipData.getItemAt(i);
                if (item != null && item.getUri() != null) selected.add(item.getUri());
            }
        } else if (data.getData() != null) {
            selected.add(data.getData());
        }
        if (selected.isEmpty()) {
            resolveFileChooser(null);
            return;
        }
        final Uri[] sourceUris = selected.toArray(new Uri[0]);
        final int generation = pickerGeneration;
        try {
            imageCopyExecutor.execute(() -> {
                Uri[] cachedUris = null;
                String copyError = null;
                try {
                    if (pickedImageCache == null) throw new IllegalStateException("无法准备本机图片缓存目录。");
                    cachedUris = pickedImageCache.copyUris(sourceUris);
                } catch (Exception error) {
                    copyError = error.getMessage();
                }
                final Uri[] resultUris = cachedUris;
                final String errorMessage = copyError;
                mainHandler.post(() -> {
                    if (destroyed || generation != pickerGeneration || filePathCallback == null) {
                        if (pickedImageCache != null) pickedImageCache.deleteCachedUris(resultUris);
                        return;
                    }
                    resolveFileChooser(resultUris);
                    if (errorMessage != null) {
                        Toast.makeText(MainActivity.this, errorMessage, Toast.LENGTH_LONG).show();
                    }
                });
            });
        } catch (RejectedExecutionException error) {
            resolveFileChooser(null);
            Toast.makeText(this, "无法准备所选图片，请重新选择。", Toast.LENGTH_LONG).show();
        }
    }

    private void resolveFileChooser(@Nullable Uri[] results) {
        ValueCallback<Uri[]> callback = filePathCallback;
        filePathCallback = null;
        if (callback != null) callback.onReceiveValue(results);
    }

    private void setLauncherIconComponents(String selectedIcon) {
        String[] names = {"cream", "glacier", "cherry", "bluegold"};
        String[] aliases = {"IconCream", "IconGlacier", "IconCherry", "IconBlueGold"};
        PackageManager packageManager = getPackageManager();
        for (int i = 0; i < names.length; i++) {
            ComponentName component = new ComponentName(this, getPackageName() + "." + aliases[i]);
            packageManager.setComponentEnabledSetting(component,
                    PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
        }
        int selectedIndex = Arrays.asList(names).indexOf(selectedIcon);
        if (selectedIndex >= 0) {
            ComponentName selected = new ComponentName(this, getPackageName() + "." + aliases[selectedIndex]);
            packageManager.setComponentEnabledSetting(selected,
                    PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP);
        }
    }

    private final class AppSettingsBridge {
        private final SharedPreferences preferences = getSharedPreferences("app_preferences", MODE_PRIVATE);

        @JavascriptInterface
        public synchronized String getPreferences() {
            JSONObject result = new JSONObject();
            try {
                result.put("language", preferences.getString("language", "zh-CN"));
                result.put("appearance", preferences.getString("appearance", "system"));
                result.put("blackBackground", preferences.getBoolean("blackBackground", false));
                result.put("showNavLabels", preferences.getBoolean("showNavLabels", true));
                result.put("navLayout", preferences.getString("navLayout", "fixed"));
                result.put("navAutoHide", preferences.getBoolean("navAutoHide", false));
                result.put("useSystemAccent", preferences.getBoolean("useSystemAccent", false));
                result.put("accentColor", preferences.getString("accentColor", ""));
                result.put("launcherIcon", preferences.getString("launcherIcon", "cream"));
                result.put("appVersion", BuildConfig.VERSION_NAME);
                result.put("systemAccentAvailable", isSystemAccentAvailable());
                result.put("systemAccentColors", getSystemAccentColors());
                result.put("systemDark", isSystemDark());
                result.put("githubApiBaseUrl", preferences.getString("githubApiBaseUrl", DEFAULT_GITHUB_API_BASE));
                result.put("githubRawBaseUrl", preferences.getString("githubRawBaseUrl", DEFAULT_GITHUB_RAW_BASE));
                try {
                    result.put("githubRawBaseHistory", new JSONArray(preferences.getString("githubRawBaseHistory", "[]")));
                } catch (Exception ignored) {
                    result.put("githubRawBaseHistory", new JSONArray());
                }
            } catch (Exception ignored) { }
            return result.toString();
        }

        private File repositorySnapshotFile(String owner, String name) {
            if (owner == null || name == null || owner.isEmpty() || name.isEmpty()
                    || owner.length() > 39 || name.length() > 100 || owner.contains("/") || name.contains("/")) return null;
            try {
                byte[] digest = MessageDigest.getInstance("SHA-256")
                        .digest((owner.toLowerCase(Locale.US) + "/" + name.toLowerCase(Locale.US)).getBytes(StandardCharsets.UTF_8));
                StringBuilder key = new StringBuilder(digest.length * 2);
                for (byte value : digest) key.append(String.format(Locale.US, "%02x", value & 0xff));
                File directory = new File(getFilesDir(), "library-snapshots");
                if (!directory.isDirectory() && !directory.mkdirs()) return null;
                return new File(directory, key + ".json");
            } catch (Exception ignored) { return null; }
        }

        private String readSnapshotFile(File snapshot) {
            if (snapshot == null || !snapshot.isFile() || snapshot.length() <= 0 || snapshot.length() > MAX_LIBRARY_SNAPSHOT_BYTES) return "";
            try (InputStream input = new AtomicFile(snapshot).openRead();
                 ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int count;
                int total = 0;
                while ((count = input.read(buffer)) != -1) {
                    total += count;
                    if (total > MAX_LIBRARY_SNAPSHOT_BYTES) return "";
                    output.write(buffer, 0, count);
                }
                return new String(output.toByteArray(), StandardCharsets.UTF_8);
            } catch (Exception ignored) { return ""; }
        }

        private boolean snapshotMatchesRepository(String serialized, String owner, String name) {
            if (serialized == null || serialized.isEmpty() || owner == null || name == null) return false;
            try {
                JSONObject snapshot = new JSONObject(serialized);
                return owner.equalsIgnoreCase(snapshot.optString("owner", ""))
                        && name.equalsIgnoreCase(snapshot.optString("name", ""));
            } catch (Exception ignored) { return false; }
        }

        private void addLibrarySnapshotStats(String serialized, List<String> identities, long[] stats) {
            try {
                JSONObject snapshot = new JSONObject(serialized);
                String owner = snapshot.optString("owner", "");
                String name = snapshot.optString("name", "");
                if (owner.isEmpty() || name.isEmpty()) return;
                String identity = owner.toLowerCase(Locale.US) + "/" + name.toLowerCase(Locale.US);
                if (identities.contains(identity)) return;
                identities.add(identity);
                stats[0]++;
                JSONArray indexes = snapshot.optJSONArray("categories");
                if (indexes != null) stats[1] += indexes.length();
            } catch (Exception ignored) { }
        }

        @JavascriptInterface
        public synchronized String getCacheInfo() {
            JSONObject result = new JSONObject();
            long imageBytes = 0L;
            long imageFiles = 0L;
            long remoteImageBytes = 0L;
            long remoteImageFiles = 0L;
            long repositoryBytes = 0L;
            long repositoryCount = 0L;
            long libraryBytes = 0L;
            long libraryCount = 0L;
            long libraryIndexCount = 0L;
            try {
                long[] imageStats = pickedImageCache == null
                        ? new long[]{0L, 0L} : pickedImageCache.getCacheStats();
                imageBytes = imageStats[0];
                imageFiles = imageStats[1];
            } catch (Exception ignored) { }
            try {
                if (persistentImageCache != null) {
                    PersistentImageCache.CacheStats remoteStats = persistentImageCache.getStats();
                    remoteImageBytes = remoteStats.bytes;
                    remoteImageFiles = remoteStats.files;
                }
            } catch (Exception ignored) { }
            try {
                String repositoriesJson = preferences.getString("accessibleRepositories", "[]");
                repositoryBytes = repositoriesJson.getBytes(StandardCharsets.UTF_8).length;
                JSONArray repositories = new JSONArray(repositoriesJson);
                repositoryCount = repositories.length();
                if (repositoryCount == 0) repositoryBytes = 0L;
            } catch (Exception ignored) { }
            try {
                List<String> identities = new ArrayList<>();
                long[] snapshotStats = new long[]{0L, 0L};
                File legacySnapshot = new File(getFilesDir(), "library-snapshot.json");
                if (legacySnapshot.isFile()) {
                    libraryBytes += legacySnapshot.length();
                    addLibrarySnapshotStats(readSnapshotFile(legacySnapshot), identities, snapshotStats);
                }
                File snapshotDirectory = new File(getFilesDir(), "library-snapshots");
                File[] snapshots = snapshotDirectory.listFiles();
                if (snapshots != null) {
                    for (File snapshot : snapshots) {
                        if (!snapshot.isFile()) continue;
                        libraryBytes += snapshot.length();
                        addLibrarySnapshotStats(readSnapshotFile(snapshot), identities, snapshotStats);
                    }
                }
                libraryCount = snapshotStats[0];
                libraryIndexCount = snapshotStats[1];
            } catch (Exception ignored) { }
            try {
                result.put("imageBytes", imageBytes);
                result.put("imageFiles", imageFiles);
                result.put("remoteImageBytes", remoteImageBytes);
                result.put("remoteImageFiles", remoteImageFiles);
                result.put("repositoryBytes", repositoryBytes);
                result.put("repositoryCount", repositoryCount);
                result.put("libraryBytes", libraryBytes);
                result.put("libraryCount", libraryCount);
                result.put("libraryIndexCount", libraryIndexCount);
            } catch (Exception ignored) { }
            return result.toString();
        }

        private void appendWallpaperColor(JSONArray palette, String source, @Nullable Color color) {
            if (color == null) return;
            String hex = String.format(Locale.US, "#%06X", color.toArgb() & 0x00FFFFFF);
            for (int i = 0; i < palette.length(); i++) {
                JSONObject existing = palette.optJSONObject(i);
                if (existing != null && hex.equalsIgnoreCase(existing.optString("color", ""))) return;
            }
            try {
                JSONObject entry = new JSONObject();
                entry.put("source", source);
                entry.put("color", hex);
                palette.put(entry);
            } catch (Exception ignored) { }
        }

        @JavascriptInterface
        public synchronized String getWallpaperAccentColors() {
            JSONObject result = new JSONObject();
            try {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O_MR1) {
                    result.put("supported", false);
                    result.put("available", false);
                    result.put("reason", "unsupported");
                    return result.toString();
                }
                WallpaperColors wallpaperColors = WallpaperManager.getInstance(getApplicationContext())
                        .getWallpaperColors(WallpaperManager.FLAG_SYSTEM);
                if (wallpaperColors == null) {
                    result.put("supported", true);
                    result.put("available", false);
                    result.put("reason", "unavailable");
                    return result.toString();
                }
                JSONArray palette = new JSONArray();
                appendWallpaperColor(palette, "primary", wallpaperColors.getPrimaryColor());
                appendWallpaperColor(palette, "secondary", wallpaperColors.getSecondaryColor());
                appendWallpaperColor(palette, "tertiary", wallpaperColors.getTertiaryColor());
                result.put("supported", true);
                result.put("available", palette.length() > 0);
                if (palette.length() > 0) result.put("colors", palette);
                else result.put("reason", "unavailable");
            } catch (SecurityException error) {
                try {
                    result.put("supported", true);
                    result.put("available", false);
                    result.put("reason", "restricted");
                } catch (Exception ignored) { }
            } catch (Exception error) {
                try {
                    result.put("supported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1);
                    result.put("available", false);
                    result.put("reason", "unavailable");
                } catch (Exception ignored) { }
            }
            return result.toString();
        }

        @JavascriptInterface
        public synchronized String getCachedLibrarySnapshot() {
            File snapshot = new File(getFilesDir(), "library-snapshot.json");
            return readSnapshotFile(snapshot);
        }

        @JavascriptInterface
        public synchronized String getCachedLibrarySnapshotFor(String owner, String name) {
            File snapshot = repositorySnapshotFile(owner, name);
            String cached = readSnapshotFile(snapshot);
            if (snapshotMatchesRepository(cached, owner, name)) return cached;
            String legacy = getCachedLibrarySnapshot();
            return snapshotMatchesRepository(legacy, owner, name) ? legacy : "";
        }

        @SuppressLint("ApplySharedPref")
        @JavascriptInterface
        public synchronized boolean saveCachedLibrarySnapshot(String serializedSnapshot) {
            if (serializedSnapshot == null) return false;
            byte[] bytes = serializedSnapshot.getBytes(StandardCharsets.UTF_8);
            if (bytes.length == 0 || bytes.length > MAX_LIBRARY_SNAPSHOT_BYTES) return false;
            try {
                JSONObject snapshot = new JSONObject(serializedSnapshot);
                String owner = snapshot.optString("owner", "");
                String name = snapshot.optString("name", "");
                JSONArray categories = snapshot.optJSONArray("categories");
                JSONArray treePaths = snapshot.optJSONArray("treePaths");
                if (snapshot.optInt("version", 0) != 1 || owner.isEmpty() || name.isEmpty()
                        || owner.length() > 39 || name.length() > 100 || owner.contains("/") || name.contains("/")
                        || categories == null || categories.length() > 2000 || treePaths == null || treePaths.length() > 100_000) return false;
                AtomicFile atomicFile = new AtomicFile(new File(getFilesDir(), "library-snapshot.json"));
                FileOutputStream output = null;
                try {
                    output = atomicFile.startWrite();
                    output.write(bytes);
                    output.flush();
                    output.getFD().sync();
                    atomicFile.finishWrite(output);
                    return true;
                } catch (Exception error) {
                    if (output != null) atomicFile.failWrite(output);
                    return false;
                }
            } catch (Exception ignored) {
                return false;
            }
        }

        @SuppressLint("ApplySharedPref")
        @JavascriptInterface
        public synchronized boolean saveCachedLibrarySnapshotFor(String owner, String name, String serializedSnapshot) {
            File snapshotFile = repositorySnapshotFile(owner, name);
            if (snapshotFile == null || serializedSnapshot == null) return false;
            byte[] bytes = serializedSnapshot.getBytes(StandardCharsets.UTF_8);
            if (bytes.length == 0 || bytes.length > MAX_LIBRARY_SNAPSHOT_BYTES) return false;
            try {
                JSONObject snapshot = new JSONObject(serializedSnapshot);
                String snapshotOwner = snapshot.optString("owner", "");
                String snapshotName = snapshot.optString("name", "");
                JSONArray categories = snapshot.optJSONArray("categories");
                JSONArray treePaths = snapshot.optJSONArray("treePaths");
                if (snapshot.optInt("version", 0) != 1 || !owner.equalsIgnoreCase(snapshotOwner)
                        || !name.equalsIgnoreCase(snapshotName) || categories == null || categories.length() > 2000
                        || treePaths == null || treePaths.length() > 100_000) return false;
                AtomicFile atomicFile = new AtomicFile(snapshotFile);
                FileOutputStream output = null;
                try {
                    output = atomicFile.startWrite();
                    output.write(bytes);
                    output.flush();
                    output.getFD().sync();
                    atomicFile.finishWrite(output);
                } catch (Exception error) {
                    if (output != null) atomicFile.failWrite(output);
                    return false;
                }
                File legacyFile = new File(getFilesDir(), "library-snapshot.json");
                String legacy = readSnapshotFile(legacyFile);
                if (snapshotMatchesRepository(legacy, owner, name)) new AtomicFile(legacyFile).delete();
                return true;
            } catch (Exception ignored) {
                return false;
            }
        }

        private boolean deleteCacheFilesRecursively(File target) {
            if (target == null || !target.exists()) return true;
            if (target.isDirectory()) {
                File[] children = target.listFiles();
                if (children != null) {
                    for (File child : children) if (!deleteCacheFilesRecursively(child)) return false;
                }
            }
            return target.delete() || !target.exists();
        }

        @SuppressLint("ApplySharedPref")
        @JavascriptInterface
        public synchronized boolean clearManagedCache() {
            try {
                if (pickedImageCache == null) {
                    pickedImageCache = new PickedImageCache(getApplicationContext());
                }
                if (!pickedImageCache.clearCache()) return false;
                if (persistentImageCache == null) {
                    persistentImageCache = new PersistentImageCache(new File(getFilesDir(), "remote-icon-images"));
                }
                if (!persistentImageCache.clear()) return false;
                if (!preferences.edit().remove("accessibleRepositories").commit()) return false;
                new AtomicFile(new File(getFilesDir(), "library-snapshot.json")).delete();
                return deleteCacheFilesRecursively(new File(getFilesDir(), "library-snapshots"));
            } catch (Exception ignored) {
                return false;
            }
        }

        @JavascriptInterface
        public synchronized boolean clearRemoteImageCache() {
            try {
                if (persistentImageCache == null) {
                    persistentImageCache = new PersistentImageCache(new File(getFilesDir(), "remote-icon-images"));
                }
                return persistentImageCache.clear();
            } catch (Exception ignored) {
                return false;
            }
        }

        @SuppressLint("ApplySharedPref")
        @JavascriptInterface
        public synchronized boolean saveGitHubEndpoints(String apiBase, String rawBase, String rawHistoryJson) {
            String normalizedApi = normalizeHttpsBaseUrl(apiBase);
            String normalizedRaw = normalizeHttpsBaseUrl(rawBase);
            if (normalizedApi == null || normalizedRaw == null || rawHistoryJson == null || rawHistoryJson.length() > 12000) return false;
            try {
                JSONArray inputHistory = new JSONArray(rawHistoryJson);
                if (inputHistory.length() > 8) return false;
                List<String> history = new ArrayList<>();
                for (int i = 0; i < inputHistory.length(); i++) {
                    String candidate = normalizeHttpsBaseUrl(inputHistory.getString(i));
                    if (candidate == null) return false;
                    if (!candidate.equals(normalizedRaw) && !history.contains(candidate)) history.add(candidate);
                }
                JSONArray normalizedHistory = new JSONArray();
                for (String candidate : history) normalizedHistory.put(candidate);
                return preferences.edit()
                        .putString("githubApiBaseUrl", normalizedApi)
                        .putString("githubRawBaseUrl", normalizedRaw)
                        .putString("githubRawBaseHistory", normalizedHistory.toString())
                        .commit();
            } catch (Exception ignored) { return false; }
        }

        @JavascriptInterface
        public synchronized boolean isOnboardingCompleted() {
            return preferences.getBoolean("onboardingCompleted", false);
        }

        @SuppressLint("ApplySharedPref")
        @JavascriptInterface
        public synchronized boolean setOnboardingCompleted(boolean completed) {
            return preferences.edit().putBoolean("onboardingCompleted", completed).commit();
        }

        @JavascriptInterface
        public synchronized String getSelectedRepository() {
            JSONObject result = new JSONObject();
            String owner = preferences.getString("selectedRepoOwner", "");
            String name = preferences.getString("selectedRepoName", "");
            if (owner.isEmpty() || name.isEmpty()) return "";
            try {
                result.put("owner", owner);
                result.put("name", name);
            } catch (Exception ignored) { return ""; }
            return result.toString();
        }

        @JavascriptInterface
        public synchronized String getCachedRepositories() {
            String cached = preferences.getString("accessibleRepositories", "[]");
            try {
                JSONArray repositories = new JSONArray(cached);
                return repositories.length() <= 2000 ? repositories.toString() : "[]";
            } catch (Exception ignored) { return "[]"; }
        }

        @SuppressLint("ApplySharedPref")
        @JavascriptInterface
        public synchronized boolean saveCachedRepositories(String serializedRepositories) {
            if (serializedRepositories == null || serializedRepositories.length() > 1_500_000) return false;
            try {
                JSONArray repositories = new JSONArray(serializedRepositories);
                if (repositories.length() > 2000) return false;
                for (int i = 0; i < repositories.length(); i++) {
                    JSONObject repository = repositories.getJSONObject(i);
                    String owner = repository.optString("owner", "");
                    String name = repository.optString("name", "");
                    if (owner.isEmpty() || name.isEmpty() || owner.length() > 39 || name.length() > 100
                            || owner.contains("/") || name.contains("/")) return false;
                }
                return preferences.edit().putString("accessibleRepositories", repositories.toString()).commit();
            } catch (Exception error) { return false; }
        }

        @SuppressLint("ApplySharedPref")
        @JavascriptInterface
        public synchronized boolean saveSelectedRepository(String owner, String name) {
            if (owner == null || name == null || owner.isEmpty() || name.isEmpty()
                    || owner.length() > 39 || name.length() > 100
                    || owner.contains("/") || name.contains("/")) return false;
            return preferences.edit()
                    .putString("selectedRepoOwner", owner)
                    .putString("selectedRepoName", name)
                    .commit();
        }

        @SuppressLint("ApplySharedPref")
        @JavascriptInterface
        public synchronized void clearSelectedRepository() {
            preferences.edit().remove("selectedRepoOwner").remove("selectedRepoName").commit();
        }

        @SuppressLint("ApplySharedPref")
        @JavascriptInterface
        public synchronized boolean setLauncherIcon(String icon) {
            if (!("cream".equals(icon) || "glacier".equals(icon)
                    || "cherry".equals(icon) || "bluegold".equals(icon))) return false;
            String previous = preferences.getString("launcherIcon", "cream");
            try {
                setLauncherIconComponents(icon);
                boolean saved = preferences.edit().putString("launcherIcon", icon).commit();
                if (!saved) setLauncherIconComponents(previous);
                return saved;
            } catch (RuntimeException error) {
                try { setLauncherIconComponents(previous); } catch (RuntimeException ignored) { }
                return false;
            }
        }

        @SuppressLint("ApplySharedPref")
        @JavascriptInterface
        public synchronized boolean savePreferences(String language, String appearance,
                                                    boolean blackBackground, boolean useSystemAccent,
                                                    String navLayout, boolean showNavLabels, boolean navAutoHide,
                                                    String accentColor) {
            if (!("zh-CN".equals(language) || "en".equals(language))) return false;
            if (!("system".equals(appearance) || "light".equals(appearance) || "dark".equals(appearance))) return false;
            if (!("fixed".equals(navLayout) || "floating".equals(navLayout))) return false;
            if (useSystemAccent && !isSystemAccentAvailable()) return false;
            if (accentColor == null || (!accentColor.isEmpty() && !accentColor.matches("(?i)#[0-9a-f]{6}"))) return false;
            boolean saved = preferences.edit()
                    .putString("language", language)
                    .putString("appearance", appearance)
                    .putBoolean("blackBackground", blackBackground)
                    .putBoolean("showNavLabels", showNavLabels)
                    .putBoolean("useSystemAccent", useSystemAccent)
                    .putString("accentColor", accentColor.toLowerCase(Locale.US))
                    .putString("navLayout", navLayout)
                    .putBoolean("navAutoHide", navAutoHide)
                    .commit();
            if (saved) mainHandler.post(() -> applyNativeAppearance(appearance, blackBackground));
            return saved;
        }

        @JavascriptInterface
        public void applyAppearance(String appearance, boolean blackBackground) {
            if (!("system".equals(appearance) || "light".equals(appearance) || "dark".equals(appearance))) return;
            mainHandler.post(() -> applyNativeAppearance(appearance, blackBackground));
        }
    }

    private final class BackgroundRemovalBridge {
        @JavascriptInterface
        public void autoCutout(String requestId, String encodedImage) {
            if (isNetProcessor == null) {
                deliverCutoutResult(requestId, null, "本机自动抠图模型尚未启动，请重试。");
                return;
            }
            isNetProcessor.process(requestId, encodedImage);
        }

        @JavascriptInterface
        public void prepare(String requestId, String encodedImage) {
            if (mobileSamProcessor == null) {
                deliverCutoutPrepared(requestId, 0, 0, "本机抠图模型尚未启动，请重试。");
                return;
            }
            mobileSamProcessor.prepare(requestId, encodedImage);
        }

        @JavascriptInterface
        public void predict(String requestId, String pointsJson) {
            if (mobileSamProcessor == null) {
                deliverCutoutResult(requestId, null, "本机抠图模型尚未启动，请重试。");
                return;
            }
            mobileSamProcessor.predict(requestId, pointsJson);
        }

        @JavascriptInterface
        public void cancel(String requestId) {
            if (mobileSamProcessor != null) mobileSamProcessor.cancel(requestId);
            if (isNetProcessor != null) isNetProcessor.cancel(requestId);
        }
    }

    private void deliverCutoutPrepared(String requestId, int width, int height, @Nullable String error) {
        mainHandler.post(() -> {
            if (webView == null) return;
            String script = "window.onCueCutoutReady && window.onCueCutoutReady("
                    + JSONObject.quote(requestId == null ? "" : requestId) + ","
                    + width + "," + height + ","
                    + JSONObject.quote(error) + ");";
            webView.evaluateJavascript(script, null);
        });
    }

    private void deliverCutoutResult(String requestId, @Nullable String encodedPng, @Nullable String error) {
        mainHandler.post(() -> {
            if (webView == null) return;
            String script = "window.onCueCutoutResult && window.onCueCutoutResult("
                    + JSONObject.quote(requestId == null ? "" : requestId) + ","
                    + JSONObject.quote(encodedPng) + ","
                    + JSONObject.quote(error) + ");";
            webView.evaluateJavascript(script, null);
        });
    }

    private void deliverCutoutProgress(String requestId, String message) {
        mainHandler.post(() -> {
            if (webView == null) return;
            String script = "window.onCueCutoutProgress && window.onCueCutoutProgress("
                    + JSONObject.quote(requestId == null ? "" : requestId) + ","
                    + JSONObject.quote(message) + ");";
            webView.evaluateJavascript(script, null);
        });
    }

    private final class LocalTokenBridge {
        private static final String KEY_ALIAS = "cue-icon-manager-token-key";
        private final SharedPreferences preferences = getSharedPreferences("local_token_vault", MODE_PRIVATE);

        @JavascriptInterface
        public synchronized String getSavedToken() {
            String encoded = preferences.getString("encrypted_token", null);
            if (encoded == null || encoded.isEmpty()) return "";
            try {
                byte[] payload = Base64.decode(encoded, Base64.NO_WRAP);
                if (payload.length <= 12) throw new IllegalStateException("Invalid encrypted token");
                byte[] iv = Arrays.copyOfRange(payload, 0, 12);
                byte[] ciphertext = Arrays.copyOfRange(payload, 12, payload.length);
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(128, iv));
                return new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
            } catch (Exception error) {
                clearSavedToken();
                return "";
            }
        }

        @SuppressLint("ApplySharedPref")
        @JavascriptInterface
        public synchronized boolean saveToken(String token) {
            if (token == null || token.isEmpty()) return false;
            String previousToken = getSavedToken();
            boolean tokenChanged = !token.equals(previousToken);
            try {
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
                byte[] iv = cipher.getIV();
                byte[] ciphertext = cipher.doFinal(token.getBytes(StandardCharsets.UTF_8));
                byte[] payload = new byte[iv.length + ciphertext.length];
                System.arraycopy(iv, 0, payload, 0, iv.length);
                System.arraycopy(ciphertext, 0, payload, iv.length, ciphertext.length);
                boolean saved = preferences.edit()
                        .putString("encrypted_token", Base64.encodeToString(payload, Base64.NO_WRAP))
                        .commit();
                if (saved && tokenChanged) {
                    getSharedPreferences("app_preferences", MODE_PRIVATE).edit()
                            .remove("selectedRepoOwner").remove("selectedRepoName")
                            .remove("accessibleRepositories").commit();
                }
                return saved;
            } catch (Exception error) {
                return false;
            }
        }

        @SuppressLint("ApplySharedPref")
        @JavascriptInterface
        public synchronized void clearSavedToken() {
            preferences.edit().remove("encrypted_token").commit();
            getSharedPreferences("app_preferences", MODE_PRIVATE).edit()
                    .remove("selectedRepoOwner").remove("selectedRepoName")
                    .remove("accessibleRepositories").commit();
            try {
                KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
                keyStore.load(null);
                if (keyStore.containsAlias(KEY_ALIAS)) keyStore.deleteEntry(KEY_ALIAS);
            } catch (Exception ignored) {
                // The encrypted value is removed even if the platform keystore is unavailable.
            }
        }

        private SecretKey getOrCreateKey() throws Exception {
            KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
            keyStore.load(null);
            java.security.Key existing = keyStore.getKey(KEY_ALIAS, null);
            if (existing instanceof SecretKey) return (SecretKey) existing;

            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build();
            generator.init(spec);
            return generator.generateKey();
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        dispatchBackToWeb();
    }

    private void dispatchBackToWeb() {
        if (backDispatchPending) return;
        WebView target = webView;
        if (target == null || destroyed) {
            finish();
            return;
        }
        backDispatchPending = true;
        try {
            target.evaluateJavascript(
                    "window.onCueAndroidBackPressed ? window.onCueAndroidBackPressed() : false;",
                    result -> {
                        backDispatchPending = false;
                        if (destroyed || isFinishing()) return;
                        if (!"true".equals(result)) {
                            if (webView != null && webView.canGoBack()) webView.goBack();
                            else finish();
                        }
                    });
        } catch (RuntimeException error) {
            backDispatchPending = false;
            finish();
        }
    }

    @Override
    protected void onDestroy() {
        destroyed = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && backInvokedCallback != null) {
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backInvokedCallback);
            backInvokedCallback = null;
        }
        pickerGeneration++;
        resolveFileChooser(null);
        if (imageCopyExecutor != null) imageCopyExecutor.shutdownNow();
        if (webView != null) {
            webView.stopLoading();
            webView.loadUrl("about:blank");
            webView.clearHistory();
            webView.removeAllViews();
            webView.destroy();
            webView = null;
        }
        if (mobileSamProcessor != null) {
            mobileSamProcessor.close();
            mobileSamProcessor = null;
        }
        if (isNetProcessor != null) {
            isNetProcessor.close();
            isNetProcessor = null;
        }
        super.onDestroy();
    }

    private boolean isSystemDark() {
        return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
    }

    private boolean isSystemAccentAvailable() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return false;
        try {
            getResources().getColor(android.R.color.system_accent1_600, getTheme());
            getResources().getColor(android.R.color.system_accent1_700, getTheme());
            getResources().getColor(android.R.color.system_accent1_100, getTheme());
            getResources().getColor(android.R.color.system_accent1_200, getTheme());
            return true;
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    private static String colorHex(int color) {
        return String.format("#%06X", color & 0xFFFFFF);
    }

    @SuppressLint("InlinedApi")
    private JSONObject getSystemAccentColors() {
        JSONObject colors = new JSONObject();
        if (!isSystemAccentAvailable()) return colors;
        try {
            colors.put("primary", colorHex(getResources().getColor(android.R.color.system_accent1_600, getTheme())));
            colors.put("primaryDark", colorHex(getResources().getColor(android.R.color.system_accent1_700, getTheme())));
            colors.put("primaryLight", colorHex(getResources().getColor(android.R.color.system_accent1_100, getTheme())));
            colors.put("primaryOnDark", colorHex(getResources().getColor(android.R.color.system_accent1_200, getTheme())));
        } catch (Exception ignored) {
            return new JSONObject();
        }
        return colors;
    }

    private void notifyWebSystemAccent() {
        if (webView == null) return;
        String colors = getSystemAccentColors().toString();
        webView.evaluateJavascript("window.onCueSystemAccentChanged && window.onCueSystemAccentChanged(" + colors + ");", null);
    }
}
