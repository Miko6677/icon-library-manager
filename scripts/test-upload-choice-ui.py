#!/usr/bin/env python3
"""Exercise the in-app upload destination picker in a phone-sized Chromium viewport."""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PAGE_URL = (ROOT / "app/src/main/assets/index.html").as_uri()


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path="/usr/bin/chromium",
            headless=True,
            args=["--no-sandbox"],
        )
        page = browser.new_page(
            viewport={"width": 360, "height": 780},
            device_scale_factor=1,
            is_mobile=True,
            has_touch=True,
        )
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(PAGE_URL, wait_until="load")
        page.wait_for_timeout(350)
        assert not errors, errors
        if page.locator("#walkthrough-modal").is_visible():
            page.locator("#walkthrough-modal").evaluate("element => element.classList.add('hidden')")

        assert page.locator(".upload-target-choice-button").count() == 5
        assert page.locator(".upload-target-native-select").count() == 5
        for button in page.locator(".upload-target-choice-button").all():
            assert button.get_attribute("aria-haspopup") == "dialog"
            assert button.get_attribute("aria-controls") == "settings-choice-modal"
            assert button.get_attribute("aria-label")
        for select in page.locator(".upload-target-native-select").all():
            assert select.get_attribute("aria-hidden") == "true"
            assert select.get_attribute("tabindex") == "-1"
            assert select.evaluate("element => getComputedStyle(element).display") == "none"

        page.locator("#upload-confirm-modal").evaluate("element => element.classList.remove('hidden')")
        page.locator("html").evaluate("element => element.setAttribute('data-theme', 'dark')")
        one_option_controls = [
            ("repository", "仓库", "owner/repo"),
            ("branch", "分支", "main"),
            ("category", "目标分类", "icon/Fang/tubiao.json"),
            ("directory", "目标图片文件夹", "icon/Fang/icon"),
            ("index", "JSON 索引", "icon/Fang/tubiao.json"),
        ]
        picker = page.locator("#settings-choice-modal")
        for field, label, value in one_option_controls:
            select = page.locator(f"#upload-confirm-{field}")
            trigger = page.locator(f"#upload-confirm-{field}-choice")
            select.evaluate("""(element, value) => {
              element.disabled = false;
              element.replaceChildren(new Option(value, value));
              element.value = value;
            }""", value)
            trigger.evaluate("""(button, value) => {
              button.disabled = false;
              button.querySelector('.upload-target-choice-value').textContent = value;
            }""", value)
            trigger.click()
            assert picker.is_visible(), f"{field} one-option chooser should open"
            assert page.locator("#settings-choice-title").inner_text() == label
            radios = page.get_by_role("radio")
            assert radios.count() == 1, f"{field} chooser should show its one valid option"
            assert radios.nth(0).get_attribute("aria-checked") == "true", f"{field} option should be selected"
            assert radios.nth(0).evaluate("element => document.activeElement === element")
            assert trigger.get_attribute("aria-expanded") == "true"
            radios.nth(0).click()
            assert not picker.is_visible(), f"{field} chooser should close after selection"
            assert select.input_value() == value
            assert trigger.locator(".upload-target-choice-value").inner_text() == value
            assert trigger.get_attribute("aria-expanded") == "false"
            assert trigger.evaluate("element => document.activeElement === element"), f"{field} focus should be restored"
            assert page.locator("#upload-confirm-modal").is_visible(), "choosing a destination must not bypass final upload confirmation"

        # Multi-branch selection stays active and updates the branch control without closing final confirmation.
        branch_select = page.locator("#upload-confirm-branch")
        branch_trigger = page.locator("#upload-confirm-branch-choice")
        branch_select.evaluate("""select => {
          select.replaceChildren(new Option('main', 'main'), new Option('feature/icons', 'feature/icons'));
          select.value = 'main';
        }""")
        branch_trigger.evaluate("button => { button.disabled = false; button.querySelector('.upload-target-choice-value').textContent = 'main'; }")
        branch_trigger.click()
        assert picker.is_visible()
        assert page.locator("#settings-choice-title").inner_text() == "分支"
        radios = page.get_by_role("radio")
        assert radios.count() == 2
        assert radios.nth(0).get_attribute("aria-checked") == "true"
        radios.nth(1).click()
        assert not picker.is_visible()
        assert branch_select.input_value() == "feature/icons"
        assert branch_trigger.locator(".upload-target-choice-value").inner_text() == "feature/icons"
        assert page.locator("#upload-confirm-modal").is_visible()

        # Escape and Android's hardware-back route close only the topmost choice dialog.
        branch_trigger.click()
        page.keyboard.press("Escape")
        assert not picker.is_visible() and page.locator("#upload-confirm-modal").is_visible()
        branch_trigger.click()
        handled = page.evaluate("window.onCueAndroidBackPressed()")
        assert handled is True
        assert not picker.is_visible() and page.locator("#upload-confirm-modal").is_visible()

        # The control remains comfortably tappable and receives the app's normal theme surface.
        control_metrics = branch_trigger.evaluate("element => ({height: element.getBoundingClientRect().height, bg: getComputedStyle(element).backgroundColor, border: getComputedStyle(element).borderColor})")
        assert control_metrics["height"] >= 40, control_metrics
        assert control_metrics["bg"] != "rgba(0, 0, 0, 0)", control_metrics
        assert control_metrics["border"] not in ("rgba(0, 0, 0, 0)", "transparent"), control_metrics
        dark_card = page.locator(".settings-choice-card").evaluate("element => getComputedStyle(element).backgroundColor")
        page.locator("html").evaluate("element => element.setAttribute('data-theme', 'light')")
        light_card = page.locator(".settings-choice-card").evaluate("element => getComputedStyle(element).backgroundColor")
        assert light_card != dark_card, (light_card, dark_card)
        assert not errors, errors

        browser.close()
        print("Upload target UI regressions passed: all five single-option controls open the themed chooser with the option selected; multi-branch selection, keyboard/back close, focus restoration, touch sizing, and final-write confirmation are preserved.")


if __name__ == "__main__":
    main()
