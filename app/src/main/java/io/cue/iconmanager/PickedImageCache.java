package io.cue.iconmanager;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/** Copies one-time picker grants to private storage so WebView can reread the source later. */
final class PickedImageCache {
    static final long MAX_FILE_BYTES = 12L * 1024L * 1024L;
    static final long MAX_BATCH_BYTES = 24L * 1024L * 1024L;
    private static final long MAX_CACHE_AGE_MS = 7L * 24L * 60L * 60L * 1000L;
    private static final String AUTHORITY_SUFFIX = ".selected-images";

    private final Context context;
    private final File cacheDirectory;

    PickedImageCache(Context context) throws IOException {
        this.context = context.getApplicationContext();
        this.cacheDirectory = new File(this.context.getCacheDir(), "picked-images");
        if (!cacheDirectory.exists() && !cacheDirectory.mkdirs()) {
            throw new IOException("无法准备图片临时缓存目录。");
        }
        pruneExpiredFiles(System.currentTimeMillis() - MAX_CACHE_AGE_MS);
    }

    synchronized Uri[] copyUris(Uri[] sourceUris) throws IOException {
        if (sourceUris == null || sourceUris.length == 0) return null;
        List<Uri> cachedUris = new ArrayList<>(sourceUris.length);
        List<File> cachedFiles = new ArrayList<>(sourceUris.length);
        long batchBytes = 0;
        try {
            for (Uri sourceUri : sourceUris) {
                if (sourceUri == null) continue;
                CachedImage cached = copyUri(sourceUri);
                batchBytes += cached.bytes;
                if (batchBytes > MAX_BATCH_BYTES) {
                    deleteCachedFile(cached.file);
                    throw new IOException("本次选择总大小不能超过 24 MB，请分批选择图片。");
                }
                cachedFiles.add(cached.file);
                cachedUris.add(FileProvider.getUriForFile(context,
                        context.getPackageName() + AUTHORITY_SUFFIX, cached.file));
            }
            if (cachedUris.isEmpty()) throw new IOException("系统没有返回可读取的图片，请重新选择。");
            return cachedUris.toArray(new Uri[0]);
        } catch (IOException | RuntimeException error) {
            for (File cachedFile : cachedFiles) deleteCachedFile(cachedFile);
            if (error instanceof IOException) throw (IOException) error;
            throw new IOException("无法安全准备所选图片，请重新选择。", error);
        }
    }

    synchronized void deleteCachedUris(Uri[] cachedUris) {
        if (cachedUris == null) return;
        String expectedAuthority = context.getPackageName() + AUTHORITY_SUFFIX;
        try {
            String canonicalDirectory = cacheDirectory.getCanonicalPath();
            for (Uri uri : cachedUris) {
                if (uri == null || !"content".equalsIgnoreCase(uri.getScheme())
                        || !expectedAuthority.equals(uri.getAuthority())) continue;
                List<String> segments = uri.getPathSegments();
                if (segments.size() < 2 || !"picked_images".equals(segments.get(0))) continue;
                StringBuilder relativePath = new StringBuilder();
                for (int i = 1; i < segments.size(); i++) {
                    String segment = segments.get(i);
                    if (segment.isEmpty() || ".".equals(segment) || "..".equals(segment)) continue;
                    if (relativePath.length() > 0) relativePath.append(File.separatorChar);
                    relativePath.append(segment.replace('/', File.separatorChar));
                }
                if (relativePath.length() == 0) continue;
                File candidate = new File(cacheDirectory, relativePath.toString());
                String canonicalCandidate = candidate.getCanonicalPath();
                if (canonicalCandidate.startsWith(canonicalDirectory + File.separator)
                        && candidate.isFile()) deleteCachedFile(candidate);
            }
        } catch (IOException ignored) {
            // Stale cache files remain private and are pruned on the next app launch.
        }
    }

    synchronized long[] getCacheStats() {
        long[] stats = new long[]{0L, 0L};
        collectCacheStats(cacheDirectory, stats);
        return stats;
    }

    synchronized boolean clearCache() {
        if (!cacheDirectory.exists() && !cacheDirectory.mkdirs()) return false;
        File[] files = cacheDirectory.listFiles();
        if (files == null) return false;
        boolean cleared = true;
        for (File file : files) cleared &= deleteRecursively(file);
        return cleared;
    }

    private static void collectCacheStats(File directory, long[] stats) {
        File[] files = directory.listFiles();
        if (files == null) return;
        for (File file : files) {
            if (file.isDirectory()) {
                collectCacheStats(file, stats);
            } else if (file.isFile()) {
                stats[0] += file.length();
                stats[1]++;
            }
        }
    }

    private static boolean deleteRecursively(File file) {
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children == null) return false;
            boolean deleted = true;
            for (File child : children) deleted &= deleteRecursively(child);
            if (!file.delete() && file.exists()) deleted = false;
            return deleted;
        }
        return file.delete() || !file.exists();
    }

    private CachedImage copyUri(Uri sourceUri) throws IOException {
        String scheme = sourceUri.getScheme();
        if (!"content".equalsIgnoreCase(scheme) && !"file".equalsIgnoreCase(scheme)) {
            throw new IOException("系统返回了不支持的图片地址，请重新选择。");
        }
        ContentResolver resolver = context.getContentResolver();
        String displayName = queryDisplayName(resolver, sourceUri);
        String mimeType = resolver.getType(sourceUri);
        if ((displayName == null || displayName.trim().isEmpty()) && sourceUri.getLastPathSegment() != null) {
            displayName = sourceUri.getLastPathSegment();
        }
        String id = UUID.randomUUID().toString();
        File temporary = new File(cacheDirectory, "." + id + ".tmp");
        long byteCount = 0;
        try (InputStream input = resolver.openInputStream(sourceUri)) {
            if (input == null) throw new IOException("系统无法打开所选图片，请重新选择。");
            try (FileOutputStream output = new FileOutputStream(temporary)) {
                byte[] buffer = new byte[32 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    byteCount += count;
                    if (byteCount > MAX_FILE_BYTES) {
                        throw new IOException("单张图片不能超过 12 MB。");
                    }
                    output.write(buffer, 0, count);
                }
                output.flush();
                output.getFD().sync();
            }
        } catch (IOException | RuntimeException error) {
            temporary.delete();
            if (error instanceof IOException) throw (IOException) error;
            throw new IOException("系统读取所选图片时出错，请重新选择。", error);
        }
        if (byteCount == 0) {
            temporary.delete();
            throw new IOException("所选图片内容为空，请重新选择。");
        }
        String safeName = safeDisplayName(displayName, mimeType, temporary);
        File imageDirectory = new File(cacheDirectory, id);
        if (!imageDirectory.mkdir()) {
            temporary.delete();
            throw new IOException("无法保存所选图片的本机副本，请重试。");
        }
        File target = new File(imageDirectory, safeName);
        if (!temporary.renameTo(target)) {
            temporary.delete();
            imageDirectory.delete();
            throw new IOException("无法保存所选图片的本机副本，请重试。");
        }
        return new CachedImage(target, byteCount);
    }

    private static String queryDisplayName(ContentResolver resolver, Uri uri) {
        if (!"content".equalsIgnoreCase(uri.getScheme())) return null;
        try (Cursor cursor = resolver.query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) return cursor.getString(index);
            }
        } catch (RuntimeException ignored) {
            // Some cloud/document providers omit metadata; use the URI path and MIME type instead.
        }
        return null;
    }

    private static String safeDisplayName(String displayName, String mimeType, File copiedFile) {
        String name = displayName == null ? "image" : displayName.replace('\\', '/');
        int slash = name.lastIndexOf('/');
        if (slash >= 0) name = name.substring(slash + 1);
        name = name.replaceAll("[\\p{Cntrl}\\/:*?\"<>|]", "_").trim();
        if (name.isEmpty() || ".".equals(name) || "..".equals(name)) name = "image";
        if (name.length() > 120) name = name.substring(name.length() - 120);
        int dot = name.lastIndexOf('.');
        boolean hasExtension = dot > 0 && dot < name.length() - 1;
        String extension = extensionForMime(mimeType);
        if ((extension == null || extension.isEmpty()) && mimeType != null) {
            String guessed = MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType.toLowerCase(Locale.ROOT));
            if (guessed != null && !guessed.isEmpty()) extension = guessed.toLowerCase(Locale.ROOT);
        }
        String sniffed = sniffSupportedExtension(copiedFile);
        if (!hasExtension) {
            if (!isSupportedExtension(extension)) extension = sniffed;
            if (extension != null && !extension.isEmpty()) {
                if (dot == name.length() - 1) name = name.substring(0, dot);
                name += "." + extension;
            }
        } else if (!isSupportedExtension(name.substring(dot + 1))
                && (isSupportedExtension(extension) || sniffed != null)) {
            String replacement = isSupportedExtension(extension) ? extension : sniffed;
            name = name.substring(0, dot + 1) + replacement;
        }
        return name;
    }

    private static boolean isSupportedExtension(String extension) {
        if (extension == null) return false;
        switch (extension.toLowerCase(Locale.ROOT)) {
            case "png": case "jpg": case "jpeg": case "gif": case "webp": case "avif": return true;
            default: return false;
        }
    }

    private static String sniffSupportedExtension(File file) {
        if (file == null) return null;
        byte[] header = new byte[32];
        try (FileInputStream input = new FileInputStream(file)) {
            int count = 0;
            while (count < header.length) {
                int read = input.read(header, count, header.length - count);
                if (read < 0) break;
                count += read;
            }
            if (count >= 8 && (header[0] & 0xff) == 0x89 && header[1] == 'P'
                    && header[2] == 'N' && header[3] == 'G') return "png";
            if (count >= 3 && (header[0] & 0xff) == 0xff && (header[1] & 0xff) == 0xd8
                    && (header[2] & 0xff) == 0xff) return "jpg";
            if (count >= 6 && header[0] == 'G' && header[1] == 'I' && header[2] == 'F'
                    && header[3] == '8' && (header[4] == '7' || header[4] == '9') && header[5] == 'a') return "gif";
            if (count >= 12 && header[0] == 'R' && header[1] == 'I' && header[2] == 'F'
                    && header[3] == 'F' && header[8] == 'W' && header[9] == 'E'
                    && header[10] == 'B' && header[11] == 'P') return "webp";
            if (count >= 12 && header[4] == 'f' && header[5] == 't' && header[6] == 'y' && header[7] == 'p') {
                String brand = new String(header, 8, 4, java.nio.charset.StandardCharsets.US_ASCII);
                if ("avif".equals(brand) || "avis".equals(brand)) return "avif";
            }
        } catch (IOException ignored) { }
        return null;
    }

    private static String extensionForMime(String mimeType) {
        if (mimeType == null) return null;
        switch (mimeType.toLowerCase(Locale.ROOT)) {
            case "image/jpeg":
            case "image/jpg": return "jpg";
            case "image/png": return "png";
            case "image/gif": return "gif";
            case "image/webp": return "webp";
            case "image/avif": return "avif";
            case "image/heic": return "heic";
            case "image/heif": return "heif";
            default: return null;
        }
    }

    private void pruneExpiredFiles(long cutoff) {
        File[] files = cacheDirectory.listFiles();
        if (files == null) return;
        for (File file : files) {
            if (file.isFile() && (file.getName().endsWith(".tmp") || file.lastModified() < cutoff)) {
                file.delete();
            } else if (file.isDirectory()) {
                File[] children = file.listFiles();
                if (children != null) {
                    for (File child : children) {
                        if (child.isFile() && (child.getName().endsWith(".tmp") || child.lastModified() < cutoff)) {
                            child.delete();
                        }
                    }
                }
                String[] remaining = file.list();
                if (file.lastModified() < cutoff && (remaining == null || remaining.length == 0)) file.delete();
            }
        }
    }

    private static void deleteCachedFile(File file) {
        if (file == null) return;
        File parent = file.getParentFile();
        file.delete();
        if (parent != null) parent.delete();
    }

    private static final class CachedImage {
        final File file;
        final long bytes;

        CachedImage(File file, long bytes) {
            this.file = file;
            this.bytes = bytes;
        }
    }
}
