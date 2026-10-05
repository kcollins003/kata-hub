#!/usr/bin/env python3
"""Pictures of the door for Kevin, at iPhone size, with the site's own typeface. Run after test_site.py (it uses out-test/)."""
import json, pathlib, subprocess, time, urllib.request
from playwright.sync_api import sync_playwright

here = pathlib.Path(__file__).parent
fonts = here.parent / "shelved" / "fonts"
shots = here / "shots"; shots.mkdir(exist_ok=True)
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1"
PAGE = "http://localhost:8790/tracker.html"


def ctl(path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request("http://localhost:8789" + path, data=data, method="GET" if body is None else "POST", headers={"Content-Type": "application/json"})
    return json.loads(opener.open(req, timeout=15).read())


server = subprocess.Popen(["node", str(here.parent / "backend" / "mock_server.js"), str(here / "out-test")], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
try:
    for _ in range(50):
        try:
            ctl("/reset", {}); break
        except Exception:
            time.sleep(0.2)
    css = "".join("@font-face{font-family:'Cinzel';font-weight:%d;src:url('https://fonts.gstatic.com/local/Cinzel-%s.ttf')}" % (w, n) for w, n in ((400, "Regular"), (600, "Bold"), (900, "Black")))
    with sync_playwright() as pw:
        b = pw.chromium.launch()

        def dev(w=390, h=844):
            ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=3, is_mobile=True, has_touch=True, user_agent=UA)
            ctx.route("**/fonts.googleapis.com/**", lambda r: r.fulfill(status=200, content_type="text/css", body=css))
            ctx.route("**/fonts.gstatic.com/local/*", lambda r: r.fulfill(status=200, content_type="font/ttf", path=str(fonts / r.request.url.split("/")[-1])))
            return ctx, ctx.new_page()

        ctx, p = dev()
        p.goto(PAGE); p.wait_for_timeout(900)
        p.screenshot(path=str(shots / "door-1-empty.png"))
        p.fill("#jnEmail", "kevin@"); p.locator("#jnGo").click(); p.wait_for_timeout(300)
        p.screenshot(path=str(shots / "door-2-bad-email.png"))
        p.fill("#jnEmail", "kevin@example.com"); p.locator("#jnGo").click(); p.wait_for_timeout(1200)
        p.screenshot(path=str(shots / "door-3-check-email.png"))
        link = ctl("/dump")["mail"][0]["body"].split("\n")[-1].replace("https://katawarrior.com/tracker.html", PAGE)
        p.goto(link); p.wait_for_timeout(1200)
        p.screenshot(path=str(shots / "door-4-link-opened.png"))
        p.goto(PAGE + "?k=kw_" + "0" * 32); p.wait_for_timeout(1200)
        p.screenshot(path=str(shots / "door-5-bad-link.png"))
        ctx2, s = dev(320, 568)
        s.goto(PAGE); s.wait_for_timeout(900)
        s.fill("#jnEmail", "kevin@example.com"); s.locator("#jnGo").click(); s.wait_for_timeout(1200)
        s.screenshot(path=str(shots / "door-6-320-check-email.png"))
        print(json.dumps(ctl("/dump")["mail"][0], indent=1))
        b.close()
finally:
    server.terminate()
