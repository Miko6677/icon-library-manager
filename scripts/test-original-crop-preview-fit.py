#!/usr/bin/env python3
"""Regression test: crop-preview canvases must stay inside their adjustment frame.

Only synthetic canvas pixels are used. This test does not load, upload, or modify
any user image or repository data.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "app" / "src" / "main" / "assets"
VIEWPORTS = (
    {"width": 390, "height": 844},
    {"width": 360, "height": 640},
    {"width": 768, "height": 900},
)
SYNTHETIC_SIZES = ((512, 512), (341, 512), (512, 341))
SHAPES = ("rounded", "circle")


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def measure_preview(page, width, height):
    return page.evaluate(
        """([width, height]) => {
          const shell = document.querySelector('.original-crop-preview-shell');
          const canvas = document.querySelector('#original-crop-preview');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d');
          context.fillStyle = '#d74d6b';
          context.fillRect(0, 0, width / 2, height / 2);
          context.fillStyle = '#4d78d7';
          context.fillRect(width / 2, 0, width / 2, height / 2);
          context.fillStyle = '#57a878';
          context.fillRect(0, height / 2, width / 2, height / 2);
          context.fillStyle = '#e0ad43';
          context.fillRect(width / 2, height / 2, width / 2, height / 2);
          const frame = shell.getBoundingClientRect();
          const preview = canvas.getBoundingClientRect();
          return {
            frame: {
              left: frame.left + shell.clientLeft,
              top: frame.top + shell.clientTop,
              right: frame.left + shell.clientLeft + shell.clientWidth,
              bottom: frame.top + shell.clientTop + shell.clientHeight,
              width: shell.clientWidth,
              height: shell.clientHeight,
              scrollWidth: shell.scrollWidth,
              scrollHeight: shell.scrollHeight
            },
            canvas: {
              left: preview.left,
              top: preview.top,
              right: preview.right,
              bottom: preview.bottom,
              width: preview.width,
              height: preview.height
            },
            css: {
              maxWidth: getComputedStyle(canvas).maxWidth,
              maxHeight: getComputedStyle(canvas).maxHeight,
              touchAction: getComputedStyle(canvas).touchAction,
              userSelect: getComputedStyle(canvas).userSelect
            }
          };
        }""",
        [width, height],
    )


def assert_contained(result, viewport, size, shape):
    frame = result["frame"]
    canvas = result["canvas"]
    tolerance = 0.6
    assert canvas["left"] >= frame["left"] - tolerance, (viewport, size, shape, result)
    assert canvas["top"] >= frame["top"] - tolerance, (viewport, size, shape, result)
    assert canvas["right"] <= frame["right"] + tolerance, (viewport, size, shape, result)
    assert canvas["bottom"] <= frame["bottom"] + tolerance, (viewport, size, shape, result)
    assert frame["scrollWidth"] <= frame["width"] + 1, (viewport, size, shape, result)
    assert frame["scrollHeight"] <= frame["height"] + 1, (viewport, size, shape, result)
    assert result["css"]["maxWidth"] != "none", (viewport, size, shape, result)
    assert result["css"]["touchAction"] == "none", (viewport, size, shape, result)


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(ASSETS)))
    Thread(target=server.serve_forever, daemon=True).start()
    cases = 0
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                executable_path="/usr/bin/chromium",
                headless=True,
                args=["--no-sandbox"],
            )
            try:
                for viewport in VIEWPORTS:
                    page = browser.new_page(
                        viewport=viewport,
                        device_scale_factor=2,
                        is_mobile=viewport["width"] < 500,
                        has_touch=viewport["width"] < 500,
                    )
                    page.add_init_script("localStorage.setItem('cue-onboarding-completed', 'true');")
                    page.goto(f"http://127.0.0.1:{server.server_port}/index.html", wait_until="domcontentloaded")
                    page.evaluate("document.querySelector('#original-crop-modal').classList.remove('hidden')")
                    for size in SYNTHETIC_SIZES:
                        for shape in SHAPES:
                            page.locator(f'[data-original-crop-shape="{shape}"]').click()
                            assert page.locator(f'[data-original-crop-shape="{shape}"]').get_attribute("aria-pressed") == "true"
                            result = measure_preview(page, *size)
                            assert_contained(result, viewport, size, shape)
                            cases += 1
                    page.close()
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
    print(f"PASS: {cases} synthetic preview layouts fit the adjustment frame")


if __name__ == "__main__":
    main()
