package io.cue.iconmanager;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Pattern;

/** Private, durable cache for public icon image URLs requested by the WebView. */
final class PersistentImageCache {
    static final long DEFAULT_FRESH_TTL_MS = 7L * 24L * 60L * 60L * 1000L;
    static final long DEFAULT_STALE_GRACE_MS = 30L * 24L * 60L * 60L * 1000L;
    static final long DEFAULT_MAX_CACHE_BYTES = 128L * 1024L * 1024L;
    static final int MAX_IMAGE_BYTES = 24 * 1024 * 1024;
    private static final int CONNECT_TIMEOUT_MS = 9000;
    private static final int READ_TIMEOUT_MS = 18000;
    private static final Pattern MIME_PATTERN = Pattern.compile("image/[a-z0-9.+-]{1,96}");
    private static final Set<String> IMAGE_EXTENSIONS = new HashSet<>();

    static {
        Collections.addAll(IMAGE_EXTENSIONS, "png", "jpg", "jpeg", "gif", "webp", "avif");
    }

    interface Fetcher {
        FetchResult fetch(String url) throws IOException;
    }

    static final class FetchResult {
        final int statusCode;
        final String mimeType;
        final byte[] body;
        final boolean cacheable;

        FetchResult(int statusCode, String mimeType, byte[] body, boolean cacheable) {
            this.statusCode = statusCode;
            this.mimeType = mimeType;
            this.body = body == null ? new byte[0] : body;
            this.cacheable = cacheable;
        }
    }

    static final class ImageResponse {
        final String mimeType;
        final InputStream body;

        ImageResponse(String mimeType, InputStream body) {
            this.mimeType = mimeType;
            this.body = body;
        }
    }

    static final class CacheStats {
        final long bytes;
        final long files;

        CacheStats(long bytes, long files) {
            this.bytes = bytes;
            this.files = files;
        }
    }

    private static final class CacheEntry {
        final File image;
        final String mimeType;
        final long freshUntil;
        final long staleUntil;

        CacheEntry(File image, String mimeType, long freshUntil, long staleUntil) {
            this.image = image;
            this.mimeType = mimeType;
            this.freshUntil = freshUntil;
            this.staleUntil = staleUntil;
        }
    }

    private final File directory;
    private final Fetcher fetcher;
    private final long freshTtlMs;
    private final long staleGraceMs;
    private final long maxCacheBytes;
    private final ConcurrentHashMap<String, Object> requestLocks = new ConcurrentHashMap<>();
    private final Object fileLock = new Object();
    private final AtomicLong generation = new AtomicLong();

    PersistentImageCache(File directory) throws IOException {
        this(directory, PersistentImageCache::fetchHttpsImage, DEFAULT_FRESH_TTL_MS,
                DEFAULT_STALE_GRACE_MS, DEFAULT_MAX_CACHE_BYTES);
    }

    PersistentImageCache(File directory, Fetcher fetcher, long freshTtlMs,
                         long staleGraceMs, long maxCacheBytes) throws IOException {
        if (directory == null || fetcher == null) throw new IOException("Image cache configuration is missing.");
        this.directory = directory;
        this.fetcher = fetcher;
        this.freshTtlMs = Math.max(1L, freshTtlMs);
        this.staleGraceMs = Math.max(0L, staleGraceMs);
        this.maxCacheBytes = Math.max(0L, maxCacheBytes);
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Could not create image cache directory.");
        pruneExpired(System.currentTimeMillis());
    }

    ImageResponse get(String url, String method, Map<String, String> requestHeaders) {
        if (!isEligible(url, method, requestHeaders)) return null;
        final String key;
        try {
            key = sha256(url);
        } catch (Exception ignored) {
            return null;
        }
        final long requestGeneration = generation.get();
        Object lock = requestLocks.computeIfAbsent(key, unused -> new Object());
        synchronized (lock) {
            CacheEntry cached = readEntry(key, System.currentTimeMillis());
            long now = System.currentTimeMillis();
            if (cached != null && now <= cached.freshUntil) return open(cached);
            FetchResult fetched;
            try {
                fetched = fetcher.fetch(url);
            } catch (IOException | RuntimeException ignored) {
                return cached != null && now <= cached.staleUntil ? open(cached) : null;
            }
            if (fetched == null) return cached != null && now <= cached.staleUntil ? open(cached) : null;
            if (fetched.statusCode == 404) {
                deleteEntry(key);
                return null;
            }
            if (fetched.statusCode < 200 || fetched.statusCode >= 300) {
                return fetched.statusCode >= 500 && cached != null && now <= cached.staleUntil
                        ? open(cached) : null;
            }
            String mimeType = normalizeMimeType(fetched.mimeType);
            if (mimeType == null || fetched.body.length == 0 || fetched.body.length > MAX_IMAGE_BYTES) return null;
            ImageResponse response = new ImageResponse(mimeType, new ByteArrayInputStream(fetched.body));
            if (fetched.cacheable) {
                synchronized (fileLock) {
                    if (requestGeneration == generation.get()) writeEntry(key, mimeType, fetched.body, now);
                }
            } else {
                deleteEntry(key);
            }
            return response;
        }
    }

    CacheStats getStats() {
        synchronized (fileLock) {
            pruneExpired(System.currentTimeMillis());
            File[] files = directory.listFiles((dir, name) -> name.endsWith(".image"));
            long bytes = 0L;
            long count = 0L;
            if (files != null) {
                for (File file : files) {
                    if (!file.isFile()) continue;
                    bytes += file.length();
                    count++;
                }
            }
            return new CacheStats(bytes, count);
        }
    }

    boolean clear() {
        synchronized (fileLock) {
            generation.incrementAndGet();
            File[] files = directory.listFiles();
            if (files != null) {
                for (File file : files) if (!deleteRecursively(file)) return false;
            }
            return !directory.exists() || directory.isDirectory();
        }
    }

    private boolean isEligible(String value, String method, Map<String, String> headers) {
        if (value == null || method == null || !"GET".equalsIgnoreCase(method)) return false;
        try {
            URL url = new URL(value);
            if (!"https".equalsIgnoreCase(url.getProtocol()) || url.getHost() == null
                    || url.getHost().isEmpty() || url.getUserInfo() != null) return false;
            String path = url.getPath();
            int dot = path == null ? -1 : path.lastIndexOf('.');
            if (dot < 0 || dot == path.length() - 1) return false;
            return IMAGE_EXTENSIONS.contains(path.substring(dot + 1).toLowerCase(Locale.ROOT));
        } catch (Exception ignored) {
            return false;
        }
    }

    private CacheEntry readEntry(String key, long now) {
        File image = imageFile(key);
        File metadata = metadataFile(key);
        if (!image.isFile() || !metadata.isFile()) {
            if (image.exists() || metadata.exists()) deleteEntry(key);
            return null;
        }
        try (FileInputStream input = new FileInputStream(metadata)) {
            Properties properties = new Properties();
            properties.load(input);
            String mime = normalizeMimeType(properties.getProperty("mime", ""));
            long freshUntil = Long.parseLong(properties.getProperty("freshUntil", "0"));
            long staleUntil = Long.parseLong(properties.getProperty("staleUntil", "0"));
            if (mime == null || image.length() <= 0 || image.length() > MAX_IMAGE_BYTES || now > staleUntil) {
                deleteEntry(key);
                return null;
            }
            return new CacheEntry(image, mime, freshUntil, staleUntil);
        } catch (Exception ignored) {
            deleteEntry(key);
            return null;
        }
    }

    private ImageResponse open(CacheEntry entry) {
        try {
            entry.image.setLastModified(System.currentTimeMillis());
            return new ImageResponse(entry.mimeType, new FileInputStream(entry.image));
        } catch (IOException ignored) {
            return null;
        }
    }

    private void writeEntry(String key, String mimeType, byte[] body, long now) {
        File image = imageFile(key);
        File imageTemp = new File(directory, key + ".image.tmp");
        File metadata = metadataFile(key);
        File metadataTemp = new File(directory, key + ".meta.tmp");
        try {
            try (FileOutputStream output = new FileOutputStream(imageTemp)) {
                output.write(body);
                output.getFD().sync();
            }
            if (!imageTemp.renameTo(image)) {
                copyFile(imageTemp, image);
                imageTemp.delete();
            }
            Properties properties = new Properties();
            properties.setProperty("mime", mimeType);
            properties.setProperty("freshUntil", Long.toString(now + freshTtlMs));
            properties.setProperty("staleUntil", Long.toString(now + freshTtlMs + staleGraceMs));
            try (FileOutputStream output = new FileOutputStream(metadataTemp)) {
                properties.store(output, "Cue local image cache");
                output.getFD().sync();
            }
            if (!metadataTemp.renameTo(metadata)) {
                copyFile(metadataTemp, metadata);
                metadataTemp.delete();
            }
            image.setLastModified(now);
            trimToLimit();
        } catch (IOException ignored) {
            imageTemp.delete();
            metadataTemp.delete();
            if (!metadata.isFile()) image.delete();
        }
    }

    private void pruneExpired(long now) {
        File[] files = directory.listFiles((dir, name) -> name.endsWith(".meta"));
        if (files == null) return;
        for (File metadata : files) {
            String key = metadata.getName().substring(0, metadata.getName().length() - ".meta".length());
            readEntry(key, now);
        }
        File[] temporary = directory.listFiles((dir, name) -> name.endsWith(".tmp"));
        if (temporary != null) for (File file : temporary) file.delete();
    }

    private void trimToLimit() {
        File[] files = directory.listFiles((dir, name) -> name.endsWith(".image"));
        if (files == null) return;
        List<File> ordered = new ArrayList<>();
        long total = 0L;
        for (File file : files) {
            if (!file.isFile()) continue;
            total += file.length();
            ordered.add(file);
        }
        ordered.sort(Comparator.comparingLong(File::lastModified));
        for (File image : ordered) {
            if (total <= maxCacheBytes) break;
            total -= image.length();
            String key = image.getName().substring(0, image.getName().length() - ".image".length());
            deleteEntry(key);
        }
    }

    private void deleteEntry(String key) {
        imageFile(key).delete();
        metadataFile(key).delete();
    }

    private File imageFile(String key) { return new File(directory, key + ".image"); }
    private File metadataFile(String key) { return new File(directory, key + ".meta"); }

    private static boolean deleteRecursively(File file) {
        if (file == null || !file.exists()) return true;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) for (File child : children) if (!deleteRecursively(child)) return false;
        }
        return file.delete() || !file.exists();
    }

    private static void copyFile(File source, File destination) throws IOException {
        try (InputStream input = new FileInputStream(source); FileOutputStream output = new FileOutputStream(destination)) {
            byte[] buffer = new byte[8192];
            int length;
            while ((length = input.read(buffer)) >= 0) output.write(buffer, 0, length);
            output.getFD().sync();
        }
    }

    private static String normalizeMimeType(String value) {
        if (value == null) return null;
        int separator = value.indexOf(';');
        String mime = (separator >= 0 ? value.substring(0, separator) : value).trim().toLowerCase(Locale.ROOT);
        return MIME_PATTERN.matcher(mime).matches() ? mime : null;
    }

    private static String sha256(String value) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        StringBuilder result = new StringBuilder(digest.length * 2);
        for (byte item : digest) result.append(String.format(Locale.ROOT, "%02x", item & 0xff));
        return result.toString();
    }

    private static FetchResult fetchHttpsImage(String value) throws IOException {
        URL requested = new URL(value);
        if (!"https".equalsIgnoreCase(requested.getProtocol()) || requested.getHost() == null
                || requested.getHost().isEmpty() || requested.getUserInfo() != null) {
            throw new IOException("Only public HTTPS image URLs are supported.");
        }
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) requested.openConnection();
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestMethod("GET");
            connection.setRequestProperty("Accept", "image/*");
            connection.setUseCaches(false);
            int status = connection.getResponseCode();
            URL finalUrl = connection.getURL();
            if (!"https".equalsIgnoreCase(finalUrl.getProtocol())) throw new IOException("Image redirect must remain HTTPS.");
            if (status == HttpURLConnection.HTTP_NOT_FOUND) return new FetchResult(status, "", null, false);
            if (status < 200 || status >= 300) return new FetchResult(status, "", null, false);
            String mimeType = normalizeMimeType(connection.getContentType());
            if (mimeType == null) return new FetchResult(status, "", null, false);
            int declaredLength = connection.getContentLength();
            if (declaredLength > MAX_IMAGE_BYTES) throw new IOException("Image exceeds the local cache size limit.");
            byte[] body;
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream(Math.max(1024, declaredLength))) {
                byte[] buffer = new byte[8192];
                int length;
                int total = 0;
                while ((length = input.read(buffer)) >= 0) {
                    total += length;
                    if (total > MAX_IMAGE_BYTES) throw new IOException("Image exceeds the local cache size limit.");
                    output.write(buffer, 0, length);
                }
                body = output.toByteArray();
            }
            String cacheControl = connection.getHeaderField("Cache-Control");
            boolean cacheable = !hasDirective(cacheControl, "no-store") && !hasDirective(cacheControl, "no-cache");
            return new FetchResult(status, mimeType, body, cacheable);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static boolean hasDirective(String value, String directive) {
        if (value == null) return false;
        for (String part : value.split(",")) {
            String token = part.trim().split("=", 2)[0].trim();
            if (directive.equalsIgnoreCase(token)) return true;
        }
        return false;
    }
}
