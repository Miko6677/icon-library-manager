#!/usr/bin/env python3
"""Compile and exercise the persistent image cache with injected local mock responses."""
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "app" / "src" / "main" / "java" / "io" / "cue" / "iconmanager" / "PersistentImageCache.java"
TEST = ROOT / "scripts" / "PersistentImageCacheTest.java"


def main():
    with tempfile.TemporaryDirectory(prefix="cue-image-cache-jvm-") as build_dir:
        subprocess.run(["javac", "-d", build_dir, str(SOURCE), str(TEST)], check=True)
        subprocess.run(["java", "-cp", build_dir, "io.cue.iconmanager.PersistentImageCacheTest"], check=True)


if __name__ == "__main__":
    main()
