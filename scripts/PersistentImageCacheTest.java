package io.cue.iconmanager;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

public final class PersistentImageCacheTest {
    private static final String IMAGE_URL = "https://raw.githubusercontent.com/mock/library/main/icon/test.png";
    private static final Map<String, String> IMAGE_HEADERS = Collections.singletonMap("Accept", "image/png");

    public static void main(String[] args) throws Exception {
        File root = Files.createTempDirectory("cue-image-cache-test-").toFile();
        File cacheDirectory = new File(root, "remote-icon-images");
        AtomicInteger downloads = new AtomicInteger();
        PersistentImageCache.Fetcher fetcher = url -> {
            downloads.incrementAndGet();
            return new PersistentImageCache.FetchResult(200, "image/png", bytes("mock-png-data"), true);
        };

        PersistentImageCache firstLaunch = new PersistentImageCache(cacheDirectory, fetcher, 60_000L, 120_000L, 1024L);
        assertBody(firstLaunch.get(IMAGE_URL, "GET", IMAGE_HEADERS), "mock-png-data", "initial network fetch");
        require(downloads.get() == 1, "first request should fetch exactly once");
        require(firstLaunch.getStats().files == 1, "successful image should be cached on disk");

        AtomicInteger unexpectedDownloads = new AtomicInteger();
        PersistentImageCache nextLaunch = new PersistentImageCache(cacheDirectory, url -> {
            unexpectedDownloads.incrementAndGet();
            throw new java.io.IOException("network should not be needed for a fresh cached image");
        }, 60_000L, 120_000L, 1024L);
        assertBody(nextLaunch.get(IMAGE_URL, "GET", IMAGE_HEADERS), "mock-png-data", "subsequent app launch");
        require(unexpectedDownloads.get() == 0, "a fresh image must survive cache instance recreation without network");

        File staleDirectory = new File(root, "stale-cache");
        PersistentImageCache expiring = new PersistentImageCache(staleDirectory, fetcher, 1L, 120_000L, 1024L);
        assertBody(expiring.get(IMAGE_URL, "GET", IMAGE_HEADERS), "mock-png-data", "initial short-lived cache");
        Thread.sleep(20L);
        AtomicInteger offlineAttempts = new AtomicInteger();
        PersistentImageCache offlineLaunch = new PersistentImageCache(staleDirectory, url -> {
            offlineAttempts.incrementAndGet();
            throw new java.io.IOException("offline");
        }, 1L, 120_000L, 1024L);
        assertBody(offlineLaunch.get(IMAGE_URL, "GET", IMAGE_HEADERS), "mock-png-data", "expired cache offline fallback");
        require(offlineAttempts.get() == 1, "expired cache should try the network before using the stale fallback");

        AtomicInteger noStoreDownloads = new AtomicInteger();
        PersistentImageCache noStoreCache = new PersistentImageCache(new File(root, "no-store"), url -> {
            noStoreDownloads.incrementAndGet();
            return new PersistentImageCache.FetchResult(200, "image/png", bytes("no-store-image"), false);
        }, 60_000L, 120_000L, 1024L);
        assertBody(noStoreCache.get(IMAGE_URL, "GET", IMAGE_HEADERS), "no-store-image", "no-store first response");
        assertBody(noStoreCache.get(IMAGE_URL, "GET", IMAGE_HEADERS), "no-store-image", "no-store second response");
        require(noStoreDownloads.get() == 2 && noStoreCache.getStats().files == 0,
                "non-cacheable responses must not be kept on disk");

        AtomicInteger filteredFetches = new AtomicInteger();
        PersistentImageCache filtered = new PersistentImageCache(new File(root, "filtered"), url -> {
            filteredFetches.incrementAndGet();
            return new PersistentImageCache.FetchResult(200, "image/png", bytes("unexpected"), true);
        }, 60_000L, 120_000L, 1024L);
        require(filtered.get(IMAGE_URL.replace("https://", "http://"), "GET", IMAGE_HEADERS) == null,
                "cleartext URLs must not be intercepted");
        require(filtered.get(IMAGE_URL.replace("test.png", "index.json"), "GET", IMAGE_HEADERS) == null,
                "JSON/API resources must not be intercepted as images");
        require(filteredFetches.get() == 0, "filtered requests must not reach the image fetcher");

        require(nextLaunch.clear(), "explicit image cache clearing should succeed");
        require(nextLaunch.getStats().files == 0 && nextLaunch.getStats().bytes == 0,
                "clear should remove persistent image bodies and metadata");
        assertBody(firstLaunch.get(IMAGE_URL, "GET", IMAGE_HEADERS), "mock-png-data", "download after explicit refresh");
        require(downloads.get() == 3 && firstLaunch.getStats().files == 1,
                "a new image should be fetched and persisted after explicit cache clearing");

        deleteRecursively(root);
        System.out.println("PersistentImageCacheTest passed: cross-launch hit, stale offline fallback, no-store, request filtering and explicit clear.");
    }

    private static byte[] bytes(String value) {
        return value.getBytes(StandardCharsets.UTF_8);
    }

    private static void assertBody(PersistentImageCache.ImageResponse response, String expected, String label) throws Exception {
        require(response != null, label + " should return an image");
        require("image/png".equals(response.mimeType), label + " should preserve the image MIME type");
        try (InputStream input = response.body; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[256];
            int length;
            while ((length = input.read(buffer)) >= 0) output.write(buffer, 0, length);
            require(expected.equals(new String(output.toByteArray(), StandardCharsets.UTF_8)), label + " returned unexpected bytes");
        }
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    private static void deleteRecursively(File file) {
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) for (File child : children) deleteRecursively(child);
        }
        file.delete();
    }
}
