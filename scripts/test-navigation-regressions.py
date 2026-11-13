#!/usr/bin/env python3
"""Phone-sized browser navigation/header regression tests and screenshots."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "app" / "src" / "main" / "assets"
OUTPUT = ROOT / "previews" / "back-nav-regression"
OUTPUT.mkdir(parents=True, exist_ok=True)


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(ASSETS)))
Thread(target=server.serve_forever, daemon=True).start()
base_url = f"http://127.0.0.1:{server.server_port}/index.html"


def center_y(locator):
    box = locator.bounding_box()
    assert box is not None, f"element has no visible box: {locator}"
    return box["y"] + box["height"] / 2


def assert_top_header(page, expected_title, nested):
    header = page.locator(".topbar")
    title = page.locator(".brand-copy strong")
    brand_copy = page.locator(".brand-copy")
    status = page.locator("#connection-state")
    assert title.inner_text() == expected_title, (title.inner_text(), expected_title)
    assert header.bounding_box()["height"] <= 68, "topbar unexpectedly expanded into a second row"
    if nested:
        back = page.locator("#settings-subpage-back")
        assert back.is_visible(), "nested page back arrow is not visible"
        assert back.evaluate("el => el.parentElement.classList.contains('brand')"), "back arrow is not in the leading brand/icon slot"
        assert page.locator(".brand-mark").evaluate("el => getComputedStyle(el).display") == "none", "nested page still shows the brand icon beside the arrow"
        centers = [center_y(back), center_y(title)]
        assert max(centers) - min(centers) <= 2.5, f"back arrow is not aligned with the title text row: {centers}"
        header_box = header.bounding_box()
        status_box = status.bounding_box()
        assert header_box["y"] <= status_box["y"] and status_box["y"] + status_box["height"] <= header_box["y"] + header_box["height"], "connection status is outside the same topbar row"
        header_box = header.bounding_box()
        back_box = back.bounding_box()
        assert header_box["y"] <= back_box["y"] and back_box["y"] + back_box["height"] <= header_box["y"] + header_box["height"], "back arrow escaped the real topbar"
    else:
        assert page.locator("#settings-subpage-back").evaluate("el => getComputedStyle(el).display") == "none", "top-level page should not show a back arrow"
        assert page.locator(".brand-mark").evaluate("el => getComputedStyle(el).display") != "none", "top-level page should retain its branded icon"
        centers = [center_y(brand_copy), center_y(status)]
        assert max(centers) - min(centers) <= 2.5, f"title and connection status are not on one row: {centers}"


def active_screen(page):
    return page.locator(".bottom-nav-item.active").get_attribute("data-screen")


def screenshot(page, name):
    page.screenshot(path=str(OUTPUT / name), full_page=False, animations="disabled")


def assert_vertical_balance(page, selector, balanced):
    geometry = page.evaluate(
        """selector => {
          const item = document.querySelector(selector).getBoundingClientRect();
          const header = document.querySelector('.topbar').getBoundingClientRect();
          const nav = document.querySelector('.bottom-navigation').getBoundingClientRect();
          return {top: item.top, center: (item.top + item.bottom) / 2,
            availableCenter: (header.bottom + nav.top) / 2, headerBottom: header.bottom};
        }""",
        selector,
    )
    if balanced:
        delta = abs(geometry["center"] - geometry["availableCenter"])
        assert delta <= 30, f"short content is not vertically balanced ({selector}): {geometry}"
    else:
        offset = geometry["top"] - geometry["headerBottom"]
        assert offset <= 20, f"long content should remain top-aligned ({selector}): {geometry}"


try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"])
        context = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        context.add_init_script("localStorage.setItem('cue-onboarding-completed', 'true');")
        page = context.new_page()
        page.goto(base_url, wait_until="networkidle")
        page.locator(".topbar").wait_for()
        page.wait_for_timeout(250)

        # Three top-level destinations retain the branded icon and have no page back arrow.
        for screen, title, filename in [
            ("library", "图标库", "top-level-library.png"),
            ("cutout", "抠图", "top-level-cutout.png"),
            ("settings", "设置", "settings-home.png"),
        ]:
            page.locator(f'.bottom-nav-item[data-screen="{screen}"]').click()
            assert active_screen(page) == screen
            assert_top_header(page, title, nested=False)
            content_selector = {
                "library": ".screen-content",
                "cutout": ".cutout-home-card",
                "settings": "#settings-index",
            }[screen]
            assert_vertical_balance(page, content_selector, balanced=True)
            screenshot(page, filename)

        page_names = {
            "appearance": ("外观与语言", "settings-appearance.png"),
            "navigation": ("导航与布局", "settings-navigation.png"),
            "cache": ("缓存管理", "settings-cache.png"),
            "account": ("GitHub 账号与仓库", "settings-account.png"),
            "about": ("关于", "settings-about.png"),
        }
        for index, (page_key, (title, filename)) in enumerate(page_names.items()):
            page.locator(f'[data-settings-page="{page_key}"]').click()
            page.wait_for_timeout(80)
            page.evaluate("window.scrollTo(0, 0)")
            assert active_screen(page) == "settings"
            assert_top_header(page, title, nested=True)
            assert_vertical_balance(
                page,
                f"#settings-{page_key}-page",
                balanced=page_key in {"navigation", "cache", "about"},
            )
            screenshot(page, filename)

            if page_key == "account":
                # A return from the repository picker is navigation only; unsaved form state survives.
                page.locator("#token-input").fill("cue-navigation-test-placeholder")
                page.evaluate("document.getElementById('repo-picker-back').click()")
                assert page.locator("#token-input").input_value() == "cue-navigation-test-placeholder", "repository-picker return cleared the connection form state"
                page.locator('[data-settings-page="account"]').click()
                assert page.locator("#token-input").input_value() == "cue-navigation-test-placeholder"
                page.locator("#token-input").fill("")

            page.locator("#settings-subpage-back").click()
            assert_top_header(page, "设置", nested=False)
            assert active_screen(page) == "settings"

            # Enter the same route again and independently verify Android's system-back callback.
            page.locator(f'[data-settings-page="{page_key}"]').click()
            assert_top_header(page, title, nested=True)
            consumed = page.evaluate("window.onCueAndroidBackPressed()")
            assert consumed is True, f"Android system back did not consume Settings route: {page_key}"
            assert_top_header(page, "设置", nested=False)
            assert active_screen(page) == "settings"

        # Android system back from Settings home and Cutout returns to Library.
        assert page.evaluate("window.onCueAndroidBackPressed()") is True
        assert active_screen(page) == "library"
        assert_top_header(page, "图标库", nested=False)
        assert page.evaluate("window.onCueAndroidBackPressed()") is False, "Library root should defer back to Android instead of changing route"
        page.locator('.bottom-nav-item[data-screen="cutout"]').click()
        assert page.evaluate("window.onCueAndroidBackPressed()") is True
        assert active_screen(page) == "library"

        # Crop is a nested modal step: render and geometrically verify its own header arrow/title/close row.
        page.evaluate("document.getElementById('original-crop-modal').classList.remove('hidden')")
        page.wait_for_timeout(80)
        crop_arrow = page.locator("#original-crop-back")
        crop_title = page.locator("#original-crop-title")
        crop_title_block = page.locator(".original-crop-title-row")
        crop_close = page.locator("#original-crop-close")
        crop_centers = [center_y(crop_arrow), center_y(crop_title_block), center_y(crop_close)]
        assert crop_title.is_visible() and crop_title.evaluate("el => el.closest('.original-crop-heading') !== null"), "crop title is not inside its page header"
        assert max(crop_centers) - min(crop_centers) <= 2.5, f"crop-step back, title and close are not in the same modal header row: {crop_centers}"
        assert page.locator(".original-crop-actions #original-crop-back").count() == 0, "duplicate crop back row remains under the modal header"
        screenshot(page, "original-crop-step.png")

        browser.close()
finally:
    server.shutdown()
    server.server_close()

print(f"Navigation regressions passed: 3 top-level routes, both back paths on all 5 Settings subpages, state-preserving account return, Library-root fallback, and crop-header alignment. Screenshots: {OUTPUT}")
