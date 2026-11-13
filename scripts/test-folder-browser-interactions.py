#!/usr/bin/env python3
"""Exercise icon-file moves and folder management against a mocked GitHub REST API."""
import base64
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "app" / "src" / "main" / "assets"
OUTPUT = ROOT / "previews" / "category-file-manager"
OUTPUT.mkdir(parents=True, exist_ok=True)

OWNER, REPO, BRANCH = "mock-owner", "mock-library", "main"
parent_path = "icon/方图/index.json"
child_path = "icon/方图/子类/index.json"
dest_path = "icon/横图/index.json"
raw = lambda path: f"https://raw.githubusercontent.com/{OWNER}/{REPO}/{BRANCH}/{path}"
index_data = {
    "parent": {"name": "方图", "description": "", "icons": [{"name": "子类图片", "url": raw("icon/方图/子类/child.png")}, {"name": "父级图片", "url": raw("icon/方图/parent.png")}]},
    "child": {"name": "子类", "description": "", "icons": [{"name": "child", "url": raw("icon/方图/子类/child.png")}]},
    "dest": {"name": "横图", "description": "", "icons": [{"name": "destination", "url": raw("icon/横图/dest.png")}]},
}
blobs = {key: base64.b64encode((json.dumps(value, ensure_ascii=False) + "\n").encode()).decode() for key, value in index_data.items()}
TREE = [
    {"path": "icon", "type": "tree", "mode": "040000", "sha": "tree-icon"},
    {"path": "icon/方图", "type": "tree", "mode": "040000", "sha": "tree-square"},
    {"path": parent_path, "type": "blob", "mode": "100644", "sha": "parent-index"},
    {"path": "icon/方图/parent.png", "type": "blob", "mode": "100644", "sha": "parent-image"},
    {"path": "icon/方图/子类", "type": "tree", "mode": "040000", "sha": "tree-child"},
    {"path": child_path, "type": "blob", "mode": "100644", "sha": "child-index"},
    {"path": "icon/方图/子类/child.png", "type": "blob", "mode": "100644", "sha": "child-image"},
    {"path": "icon/方图/子类/空", "type": "tree", "mode": "040000", "sha": "tree-empty"},
    {"path": "icon/方图/子类/空/.gitkeep", "type": "blob", "mode": "100644", "sha": "empty-placeholder"},
    {"path": "icon/横图", "type": "tree", "mode": "040000", "sha": "tree-wide"},
    {"path": dest_path, "type": "blob", "mode": "100644", "sha": "dest-index"},
    {"path": "icon/横图/dest.png", "type": "blob", "mode": "100644", "sha": "dest-image"},
]
blobs.update({
    "parent-index": blobs["parent"], "child-index": blobs["child"], "dest-index": blobs["dest"],
    "parent-image": "", "child-image": "", "dest-image": "", "empty-placeholder": base64.b64encode(b"\n").decode(),
})
state = {"tree": TREE, "commit": "commit-1", "tree_sha": "tree-1", "writes": [], "counter": 0}


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(ASSETS)))
Thread(target=server.serve_forever, daemon=True).start()
assets_url = f"http://127.0.0.1:{server.server_port}/index.html"


def json_response(route, data, status=200):
    route.fulfill(status=status, content_type="application/json", body=json.dumps(data))


def api_mock(route):
    request = route.request
    path = request.url.split("https://api.github.com", 1)[-1]
    method = request.method
    if method in {"POST", "PATCH", "PUT", "DELETE"}:
        state["writes"].append({"method": method, "path": path, "body": request.post_data_json if request.post_data else None})
    if method == "GET" and path.startswith("/user/repos?"):
        return json_response(route, [{"name": REPO, "full_name": f"{OWNER}/{REPO}", "owner": {"login": OWNER}, "default_branch": BRANCH, "private": True}])
    if method == "GET" and path == f"/repos/{OWNER}/{REPO}":
        return json_response(route, {"full_name": f"{OWNER}/{REPO}", "default_branch": BRANCH})
    if method == "GET" and path == f"/repos/{OWNER}/{REPO}/git/ref/heads/{BRANCH}":
        return json_response(route, {"object": {"sha": state["commit"]}})
    if method == "GET" and path == f"/repos/{OWNER}/{REPO}/git/commits/{state['commit']}":
        return json_response(route, {"tree": {"sha": state["tree_sha"]}})
    if method == "GET" and path.startswith(f"/repos/{OWNER}/{REPO}/git/trees/"):
        return json_response(route, {"truncated": False, "tree": state["tree"]})
    if method == "GET" and path.startswith(f"/repos/{OWNER}/{REPO}/git/blobs/"):
        sha = path.rsplit("/", 1)[-1]
        if sha in blobs:
            return json_response(route, {"content": blobs[sha], "encoding": "base64"})
        return json_response(route, {"message": "missing blob"}, 404)
    if method == "POST" and path == f"/repos/{OWNER}/{REPO}/git/blobs":
        body = request.post_data_json
        state["counter"] += 1
        sha = f"new-blob-{state['counter']}"
        blobs[sha] = body["content"]
        return json_response(route, {"sha": sha})
    if method == "POST" and path == f"/repos/{OWNER}/{REPO}/git/trees":
        body = request.post_data_json
        current = {item["path"]: dict(item) for item in state["tree"] if item["type"] == "blob"}
        for item in body["tree"]:
            if item.get("sha") is None:
                current.pop(item["path"], None)
            else:
                current[item["path"]] = {"path": item["path"], "type": "blob", "mode": item.get("mode", "100644"), "sha": item["sha"]}
        folders = {"icon"}
        for path in current:
            parts = path.split("/")[:-1]
            for n in range(1, len(parts) + 1):
                folders.add("/".join(parts[:n]))
        state["tree"] = ([{"path": folder, "type": "tree", "mode": "040000", "sha": f"tree-{folder}"} for folder in sorted(folders)]
                          + list(current.values()))
        state["counter"] += 1
        state["tree_sha"] = f"tree-{state['counter']}"
        return json_response(route, {"sha": state["tree_sha"]})
    if method == "POST" and path == f"/repos/{OWNER}/{REPO}/git/commits":
        state["counter"] += 1
        state["commit"] = f"commit-{state['counter']}"
        return json_response(route, {"sha": state["commit"]})
    if method == "PATCH" and path == f"/repos/{OWNER}/{REPO}/git/refs/heads/{BRANCH}":
        state["commit"] = request.post_data_json["sha"]
        return json_response(route, {"object": {"sha": state["commit"]}})
    json_response(route, {"message": f"unmocked {method} {path}"}, 404)


def row_for(page, path):
    return page.locator(".category-folder-row").filter(has=page.locator(".category-path", has_text=path))


def main():
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"])
            context = browser.new_context(viewport={"width": 360, "height": 780}, device_scale_factor=1, is_mobile=True, has_touch=True)
            context.add_init_script(f"""(() => {{
              localStorage.setItem('cue-onboarding-completed','true');
              localStorage.setItem('cue-selected-repository',JSON.stringify({{owner:'{OWNER}',name:'{REPO}'}}));
              localStorage.setItem('cue-accessible-repositories',JSON.stringify([{{owner:'{OWNER}',name:'{REPO}',full_name:'{OWNER}/{REPO}',default_branch:'{BRANCH}',private:true}}]));
              localStorage.setItem('cue-app-preferences',JSON.stringify({{language:'zh-CN',appearance:'light',navLayout:'fixed',showNavLabels:true,navAutoHide:false,appVersion:'1.1.0'}}));
              window.CueTokenStore={{getSavedToken:()=> 'mock-only-token',saveToken:()=>true,clearSavedToken:()=>true}};
            }})();""")
            page = context.new_page()
            def route_mock(route):
                url = route.request.url
                if url.startswith("https://api.github.com/"):
                    api_mock(route)
                elif url.startswith((f"http://127.0.0.1:{server.server_port}/", "data:")):
                    route.continue_()
                else:
                    route.abort()
            page.route("**/*", route_mock)
            page.goto(assets_url, wait_until="networkidle")
            page.locator("#workspace").wait_for(state="visible", timeout=15000)
            page.locator(".category-folder").first.wait_for()
            page.wait_for_timeout(100)
            assert page.locator("#status-message").inner_text().find("暂时无法") < 0 if page.locator("#status-message").is_visible() else True

            # Enter the parent category and preview a full subtree move to a non-sibling destination.
            page.locator(".category-folder").filter(has=page.locator(".category-path", has_text="icon/方图/")).first.click()
            page.wait_for_timeout(50)
            page.locator(".category-index").filter(has=page.locator(".category-path", has_text=parent_path)).click()
            shared_icon = page.locator(".icon-card").filter(has=page.locator(".icon-name", has_text="子类图片"))
            shared_icon.locator(".icon-action").nth(3).click()
            page.locator("#move-destination").select_option(dest_path)
            expect(page.locator("#move-error")).to_contain_text("其他图标条目也在引用此图片文件")
            assert page.locator("#move-confirm").is_disabled()
            page.locator("#move-cancel").click()
            assert state["writes"] == [], "a blocked shared-file move must not write to GitHub"
            icon = page.locator(".icon-card").filter(has=page.locator(".icon-name", has_text="父级图片"))
            icon.locator(".icon-action").nth(3).click()
            page.locator("#move-destination").select_option(dest_path)
            icon_preview = page.locator("#move-preview").inner_text()
            assert parent_path in icon_preview and dest_path in icon_preview
            assert "icon/方图/parent.png" in icon_preview and "icon/横图/parent.png" in icon_preview
            assert "https://raw.githubusercontent.com/mock-owner/mock-library/main/icon/%E6%A8%AA%E5%9B%BE/parent.png" in icon_preview
            assert "只移动这一个文件" in icon_preview
            page.locator("#move-confirm").click()
            assert state["writes"] == [], "staging an icon-file move must not write to GitHub"
            staged_preview = page.locator("#staged-moves").inner_text()
            assert "icon/方图/parent.png → icon/横图/parent.png" in staged_preview
            page.locator("#save-staged").click()
            page.locator("#app-confirm-modal").wait_for(state="visible")
            review = page.locator("#app-confirm-message").inner_text()
            assert "icon/方图/parent.png → icon/横图/parent.png" in review
            assert state["writes"] == [], "opening final review must not write to GitHub"
            page.locator("#app-confirm-cancel").click()
            page.locator("#discard-staged").click()
            assert state["writes"] == [], "discarding the local icon-file move must not write to GitHub"

            # Stage the same operation again and verify it is applied only after explicit confirmation.
            icon = page.locator(".icon-card").filter(has=page.locator(".icon-name", has_text="父级图片"))
            icon.locator(".icon-action").nth(3).click()
            page.locator("#move-destination").select_option(dest_path)
            page.locator("#move-confirm").click()
            move_write_start = len(state["writes"])
            page.locator("#save-staged").click()
            page.locator("#app-confirm-modal").wait_for(state="visible")
            assert state["writes"] == [], "no GitHub writes are allowed before the explicit confirmation"
            page.locator("#app-confirm-accept").click()
            expect(page.locator("#status-message")).to_contain_text("图标图片文件与 JSON 索引已成功提交", timeout=15000)
            move_tree_write = next(item for item in state["writes"][move_write_start:]
                                   if item["method"] == "POST" and item["path"].endswith("/git/trees"))
            move_tree_paths = {item["path"] for item in move_tree_write["body"]["tree"]}
            assert move_tree_paths == {parent_path, dest_path, "icon/方图/parent.png", "icon/横图/parent.png"}, move_tree_paths
            moved_sha = next(item["sha"] for item in move_tree_write["body"]["tree"] if item["path"] == "icon/横图/parent.png")
            assert moved_sha == "parent-image", "the moved file should reuse the original image blob"
            assert next(item for item in move_tree_write["body"]["tree"] if item["path"] == "icon/方图/parent.png")["sha"] is None
            current_blobs = {item["path"]: item["sha"] for item in state["tree"] if item["type"] == "blob"}
            assert "icon/方图/parent.png" not in current_blobs
            assert current_blobs["icon/横图/parent.png"] == "parent-image"
            assert current_blobs["icon/方图/子类/child.png"] == "child-image", "other icon files must remain untouched"
            updated_parent = json.loads(base64.b64decode(blobs[current_blobs[parent_path]]))
            updated_dest = json.loads(base64.b64decode(blobs[current_blobs[dest_path]]))
            assert all(entry["name"] != "父级图片" for entry in updated_parent["icons"])
            moved_entry = next(entry for entry in updated_dest["icons"] if entry["name"] == "父级图片")
            assert moved_entry["url"] == "https://raw.githubusercontent.com/mock-owner/mock-library/main/icon/%E6%A8%AA%E5%9B%BE/parent.png"

            # The folder operation remains a separate whole-subtree tool.
            source = row_for(page, "icon/方图/子类/")
            assert source.count() == 1
            folder_write_start = len(state["writes"])
            source.locator(".category-folder-action").nth(1).click()
            page.locator("#folder-operation-destination").select_option("icon/横图")
            preview = page.locator("#folder-operation-preview").inner_text()
            assert "icon/方图/子类/index.json" in preview and "icon/横图/子类/index.json" in preview
            assert "icon/方图/子类/child.png" in preview and "icon/横图/子类/child.png" in preview
            assert "icon/方图/index.json" in preview and "JSON URL 更新" in preview
            page.screenshot(path=str(OUTPUT / "move-folder-preview-360x780.png"), full_page=False, animations="disabled")
            page.locator("#folder-operation-stage").click()
            assert page.locator("#staged-actions").is_visible()
            assert state["writes"][folder_write_start:] == [], "staging a folder move must not write to GitHub"
            assert "icon/方图/index.json" in page.locator("#staged-moves").inner_text(), "external index URL rewrite should be staged"
            page.locator("#save-staged").click()
            page.locator("#app-confirm-modal").wait_for(state="visible")
            review = page.locator("#app-confirm-message").inner_text()
            assert "icon/方图/子类/child.png" in review and "icon/横图/子类/child.png" in review
            assert state["writes"][folder_write_start:] == [], "opening the final review must not write to GitHub"
            page.locator("#app-confirm-cancel").click()
            page.locator("#discard-staged").click()

            # Rename the folder and verify that the changed paths remain local until submitted.
            row_for(page, "icon/方图/子类/").locator(".category-folder-action").nth(0).click()
            page.locator("#folder-operation-name").fill("子分类")
            assert "icon/方图/子分类/child.png" in page.locator("#folder-operation-preview").inner_text()
            page.locator("#folder-operation-stage").click()
            assert state["writes"][folder_write_start:] == []
            page.locator("#discard-staged").click()

            # Deletion preview lists child index, image and .gitkeep, including a file count.
            row_for(page, "icon/方图/子类/").locator(".category-folder-action").nth(2).click()
            deletion = page.locator("#folder-operation-preview").inner_text()
            assert "共 3 个文件" in deletion and child_path in deletion
            assert "icon/方图/子类/child.png" in deletion and "icon/方图/子类/空/.gitkeep" in deletion
            page.locator("#folder-operation-cancel").click()
            assert state["writes"][folder_write_start:] == []

            # Creating an empty folder stages .gitkeep, never creates an index, and commits only after the second confirmation.
            page.locator("#create-folder-button").click()
            page.locator("#folder-operation-destination").select_option("icon/方图")
            page.locator("#folder-operation-name").fill("新目录")
            create_preview = page.locator("#folder-operation-preview").inner_text()
            assert "icon/方图/新目录/.gitkeep" in create_preview
            assert ".json" not in create_preview
            page.locator("#folder-operation-stage").click()
            assert state["writes"][folder_write_start:] == []
            page.locator("#save-staged").click()
            page.locator("#app-confirm-modal").wait_for(state="visible")
            assert "icon/方图/新目录/.gitkeep" in page.locator("#app-confirm-message").inner_text()
            assert state["writes"][folder_write_start:] == []
            page.locator("#app-confirm-accept").click()
            expect(page.locator("#status-message")).to_contain_text("文件夹与 JSON 索引变更已成功提交", timeout=15000)
            assert any(item["method"] == "POST" and item["path"].endswith("/git/blobs") for item in state["writes"])
            assert any(item["method"] == "POST" and item["path"].endswith("/git/trees") for item in state["writes"])
            assert any(item["method"] == "POST" and item["path"].endswith("/git/commits") for item in state["writes"])
            assert any(item["method"] == "PATCH" and item["path"].endswith("/git/refs/heads/main") for item in state["writes"])
            assert any(item["path"] == "icon/方图/新目录/.gitkeep" for item in state["tree"])
            print(json.dumps({"result": "passed", "writesOnlyAfterConfirmation": state["writes"], "preview": "all subtree files + external URL-rewritten index", "viewport": "360x780"}, ensure_ascii=False, indent=2))
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
