#!/usr/bin/env python3
"""Phone-width horizontal file/folder rail regression using offline mock data.

Set ICON_MANAGER_ASSET_ROOT to an extracted APK assets directory to render the
preview from the exact assets packaged in the APK under review.
"""
import json
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ASSETS = Path(os.environ.get("ICON_MANAGER_ASSET_ROOT", ROOT / "app" / "src" / "main" / "assets")).resolve()
OUTPUT = ROOT / "previews" / "folder-horizontal-1.1.3"
OUTPUT.mkdir(parents=True, exist_ok=True)

CATEGORIES = []
for index in range(1, 10):
    folder = f"icons/category-{index:02d}"
    icons = [{
        "name": f"mock-icon-{item + 1:02d}",
        "url": f"https://raw.githubusercontent.com/mock/library/main/{folder}/icon-{item + 1:02d}.png",
    } for item in range(24 if index == 1 else 2)]
    CATEGORIES.append({
        "path": f"{folder}/index.json",
        "data": {"name": f"分类 {index:02d}", "description": "离线手机尺寸回归测试", "icons": icons},
        "assetDirectory": folder,
    })
CATEGORIES.append({
    "path": "icons/index.json",
    "data": {"name": "根目录索引", "description": "用于验证独立 JSON 行", "icons": []},
    "assetDirectory": "icons",
})
CATEGORIES.append({
    "path": "icons/category-01/variants/index.json",
    "data": {"name": "变体", "description": "嵌套目录", "icons": []},
    "assetDirectory": "icons/category-01/variants",
})
SNAPSHOT = {
    "version": 1, "owner": "mock-owner", "name": "mock-library", "branch": "main",
    "commitSha": "mock-commit", "baseTreeSha": "mock-tree",
    "activeCategoryPath": CATEGORIES[0]["path"],
    "treePaths": [item["path"] for item in CATEGORIES], "categories": CATEGORIES,
}


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(ASSETS)))
Thread(target=server.serve_forever, daemon=True).start()
base_url = f"http://127.0.0.1:{server.server_port}/index.html"


def main():
    results = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"])
            for width, height in [(320, 720), (360, 780)]:
                context = browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=1,
                                             is_mobile=True, has_touch=True)
                context.add_init_script(f"""(() => {{
                  localStorage.setItem('cue-onboarding-completed', 'true');
                  localStorage.setItem('cue-selected-repository', JSON.stringify({{owner:'mock-owner',name:'mock-library'}}));
                  localStorage.setItem('cue-library-snapshot:mock-owner/mock-library', {json.dumps(json.dumps(SNAPSHOT))});
                  localStorage.setItem('cue-app-preferences', JSON.stringify({{language:'zh-CN',appearance:'light',navLayout:'fixed',showNavLabels:true,navAutoHide:false,appVersion:'1.1.3'}}));
                  window.CueTokenStore = {{getSavedToken: () => 'mock-only-token', saveToken: () => true, clearSavedToken: () => true}};
                }})();""")
                page = context.new_page()
                page.route("**/*", lambda route: route.continue_() if route.request.url.startswith((f"http://127.0.0.1:{server.server_port}/", "data:")) else route.abort())
                page.goto(base_url, wait_until="networkidle")
                page.wait_for_timeout(300)
                page.locator("#workspace").wait_for(state="visible")
                page.locator('.bottom-nav-item[data-screen="library"]').evaluate("el => el.click()")

                listing = page.locator("#category-list")
                folders = listing.locator(".category-folder")
                for _ in range(4):
                    if folders.count() == 9:
                        break
                    back = page.locator("#category-browser-back")
                    if back.is_visible():
                        back.click()
                    else:
                        roots = listing.locator(".category-folder")
                        root = next((roots.nth(i) for i in range(roots.count())
                                     if roots.nth(i).locator(".category-path").inner_text().strip("/") == "icons"), None)
                        assert root is not None, f"could not navigate to icons/ root at {width}px"
                        root.click()
                    page.wait_for_timeout(80)
                assert folders.count() == 9, f"expected nine folders at icons/ root at {width}px, got {folders.count()}"

                metrics = page.evaluate("""() => {
                  const doc=document.documentElement, list=document.querySelector('#category-list');
                  const nav=document.querySelector('#bottom-navigation'), nr=nav.getBoundingClientRect();
                  const folderRail=list.querySelector('.category-folder-list');
                  const indexRail=list.querySelector('.category-index-list');
                  const cards=[...list.querySelectorAll('.category-folder-row')];
                  const a=cards[0]?.getBoundingClientRect(), b=cards[1]?.getBoundingClientRect();
                  const json=indexRail?.querySelector('.category-index')?.getBoundingClientRect();
                  const folderRect=folderRail?.getBoundingClientRect();
                  return {
                    viewport:{width:innerWidth,height:innerHeight},pageWidth:doc.scrollWidth,bodyWidth:document.body.scrollWidth,
                    documentHeight:doc.scrollHeight,
                    list:{width:list.clientWidth,scrollWidth:list.scrollWidth,clientHeight:list.clientHeight,
                      scrollHeight:list.scrollHeight,overflowX:getComputedStyle(list).overflowX,
                      overflowY:getComputedStyle(list).overflowY,flexDirection:getComputedStyle(list).flexDirection,
                      role:list.getAttribute('role'),tabIndex:list.tabIndex,ariaLabel:list.getAttribute('aria-label'),
                      cardsSideBySide:Boolean(a&&b&&Math.abs(a.top-b.top)<1&&b.left>=a.right-1),
                      separateRows:Boolean(folderRail&&indexRail&&json&&folderRect&&json.top>folderRect.bottom)},
                    folderRail:folderRail?{width:folderRail.clientWidth,scrollWidth:folderRail.scrollWidth,overflowX:getComputedStyle(folderRail).overflowX,flexDirection:getComputedStyle(folderRail).flexDirection}:null,
                    indexRail:indexRail?{width:indexRail.clientWidth,scrollWidth:indexRail.scrollWidth,overflowX:getComputedStyle(indexRail).overflowX,flexDirection:getComputedStyle(indexRail).flexDirection}:null,
                    folderCount:cards.length,rowCount:list.querySelectorAll('.category-folder-row').length,
                    indexCount:list.querySelectorAll('.category-index').length,
                    folderSectionTitle:list.querySelector('.category-folder-section .category-browser-section-heading strong')?.textContent,
                    indexSectionTitle:list.querySelector('.category-index-section .category-browser-section-heading strong')?.textContent,
                    actions:list.querySelectorAll('.category-folder-action').length,
                    firstFolderLabel:cards[0]?.querySelector('.category-folder')?.getAttribute('aria-label'),
                    firstFolderType:cards[0]?.querySelector('.category-type-label')?.textContent,
                    swipeHintVisible:!document.querySelector('#category-scroll-hint').classList.contains('hidden')
                      && getComputedStyle(document.querySelector('#category-scroll-hint')).display!=='none',
                    createFolderVisible:getComputedStyle(document.querySelector('#create-folder-button')).display!=='none',
                    breadcrumbVisible:getComputedStyle(document.querySelector('#category-browser-navigation')).display!=='none',
                    nav:{position:getComputedStyle(nav).position,left:nr.left,right:nr.right,top:nr.top,bottom:nr.bottom,
                      hidden:nav.classList.contains('nav-auto-hidden')}
                  };
                }""")
                assert metrics["viewport"]["width"] == width, f"layout viewport widened: {metrics}"
                assert metrics["pageWidth"] <= width and metrics["bodyWidth"] <= width, f"whole-page horizontal overflow: {metrics}"
                assert metrics["folderCount"] == 9 and metrics["rowCount"] == 9 and metrics["indexCount"] == 1, f"folder/JSON rows changed: {metrics}"
                assert metrics["actions"] == 27, f"each folder should retain rename, move and delete: {metrics}"
                assert metrics["folderSectionTitle"] == "文件夹" and metrics["indexSectionTitle"] == "JSON 索引", f"separate section headings missing: {metrics}"
                assert metrics["list"]["flexDirection"] == "column" and metrics["list"]["separateRows"], f"folders and JSON indexes must occupy separate rows: {metrics}"
                assert metrics["folderRail"]["flexDirection"] == "row" and metrics["list"]["cardsSideBySide"], f"folder cards should be arranged horizontally: {metrics}"
                assert metrics["folderRail"]["overflowX"] == "auto" and metrics["folderRail"]["scrollWidth"] > metrics["folderRail"]["width"], f"folder rail must be horizontally swipeable: {metrics}"
                assert metrics["list"]["overflowY"] == "visible", f"separate rows should follow the page's vertical flow: {metrics}"
                assert metrics["list"]["role"] == "region" and metrics["list"]["tabIndex"] == 0 and metrics["list"]["ariaLabel"], f"list accessibility regressed: {metrics}"
                assert metrics["firstFolderType"] == "文件夹" and metrics["swipeHintVisible"], f"folder identification or swipe hint missing: {metrics}"
                assert metrics["createFolderVisible"] and metrics["breadcrumbVisible"], f"creation/navigation controls not visible: {metrics}"
                nav = metrics["nav"]
                assert nav["position"] == "fixed" and not nav["hidden"] and 0 <= nav["left"] and nav["right"] <= width + 1, f"bottom navigation should remain fixed and visible: {nav}"
                assert nav["top"] < height and nav["bottom"] <= height + 1, f"bottom navigation outside phone viewport: {nav}"
                assert metrics["documentHeight"] > height, f"the app page should retain its own vertical scroll: {metrics}"

                # The strip scrolls independently and does not enlarge or rotate the page.
                before_y = page.evaluate("window.scrollY")
                folder_rail = listing.locator(".category-folder-list")
                max_left = folder_rail.evaluate("el => { el.scrollLeft=el.scrollWidth; return el.scrollLeft; }")
                assert max_left > 0, f"list did not move horizontally at {width}px"
                assert page.evaluate("window.scrollY") == before_y, "horizontal list movement changed page scroll"
                assert page.evaluate("document.documentElement.scrollWidth") <= width, "horizontal list movement widened the page"
                folder_rail.evaluate("el => el.scrollLeft=0")
                page.evaluate("() => { document.documentElement.style.scrollBehavior='auto'; window.scrollTo(0,160); }")
                page.wait_for_timeout(50)
                page_scroll_y = page.evaluate("window.scrollY")
                assert page_scroll_y > 0, f"the app page no longer scrolls vertically at {width}px"
                assert listing.evaluate("el => el.scrollTop") == 0, "page vertical scroll was trapped by the list"
                page.evaluate("window.scrollTo(0,0)")
                page.wait_for_timeout(50)
                assert page.evaluate("window.innerWidth") == width, "app viewport/orientation unexpectedly changed"
                page.screenshot(path=str(OUTPUT / f"library-{width}x{height}.png"), full_page=False, animations="disabled")

                # Browse into a nested folder and select the JSON leaf as before.
                listing.locator(".category-folder").first.click()
                page.wait_for_timeout(80)
                assert page.locator("#category-browser-back").is_visible(), "nested view should expose back/up navigation"
                assert page.locator("#category-breadcrumbs .current").inner_text() == "category-01", "breadcrumb should show the current parent folder"
                assert listing.locator(".category-folder").count() == 1
                index = listing.locator(".category-index")
                assert index.count() == 1 and index.locator(".category-type-label").inner_text() == "JSON"
                assert "icons/category-01/index.json" in index.get_attribute("aria-label")
                assert listing.locator(".category-folder-list").count() == 1 and listing.locator(".category-index-list").count() == 1
                rows_are_separate = listing.evaluate("""el=>{
                  const folders=el.querySelector('.category-folder-section').getBoundingClientRect();
                  const indexes=el.querySelector('.category-index-section').getBoundingClientRect();
                  return indexes.top>folders.bottom;
                }""")
                assert rows_are_separate, f"nested folder and JSON index must remain in separate rows at {width}px"
                if width == 360:
                    page.screenshot(path=str(OUTPUT / "nested-360x780.png"), full_page=False, animations="disabled")
                index.click()
                assert index.get_attribute("aria-pressed") == "true", "JSON index selection state should be visible"
                results.append({"viewport": f"{width}x{height}", **metrics,
                                "horizontalListMaxScroll": max_left, "pageVerticalScrollY": page_scroll_y,
                                "nestedIndex": "icons/category-01/index.json"})
                context.close()
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    print(json.dumps({"assets": str(ASSETS), "results": results}, ensure_ascii=False, indent=2))
    (OUTPUT / "layout-metrics.json").write_text(json.dumps({"assets": str(ASSETS), "results": results}, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
