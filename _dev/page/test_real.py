#!/usr/bin/env python3
"""A short run of the real site page against the REAL deployed backend, using a test row put in the Sheet by hand.
Usage: python3 test_real.py <code>"""
import http.server, json, os, pathlib, socketserver, sys, threading, time
from playwright.sync_api import sync_playwright

here = pathlib.Path(__file__).parent
code = sys.argv[1]
PORT = 8795
fails, passes = [], 0

def check(name, cond, detail=""):
    global passes
    print(("PASS " if cond else "FAIL ") + name + (("  -> " + str(detail)[:300]) if (detail != "" and not cond) else ""), flush=True)
    if cond: passes += 1
    else: fails.append(name)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(here / "out"), **k)
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.TCPServer(("127.0.0.1", PORT), Quiet)
threading.Thread(target=srv.serve_forever, daemon=True).start()
PAGE = f"http://localhost:{PORT}/tracker.html?k={code}"
UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1"

with sync_playwright() as pw:
    browser = pw.chromium.launch(proxy={"server": os.environ["HTTPS_PROXY"], "bypass": "localhost,127.0.0.1"})
    timings, statuses, errors = [], [], []

    def device(name):
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, user_agent=UA)
        def from_disk(route):          # the page itself is handed over from this folder, so only the backend is reached over the network
            name = route.request.url.split("?")[0].rsplit("/", 1)[-1] or "tracker.html"
            f = here / "out" / name
            if f.is_file(): route.fulfill(path=str(f), content_type="text/html; charset=utf-8" if name.endswith(".html") else "image/png")
            else: route.fulfill(status=404, body="not found")
        ctx.route(f"http://localhost:{PORT}/**", from_disk)
        ctx.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        ctx.route("**/fonts.gstatic.com/**", lambda r: r.abort())
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(name + " PAGEERROR " + str(e)))
        t0 = {}
        page.on("request", lambda q: t0.__setitem__(q.url, time.time()) if "script.google.com/macros" in q.url and q.method == "POST" else None)
        def done(r):
            if "script.googleusercontent.com" in r.url or "script.google.com/macros" in r.url:
                statuses.append((r.status, r.request.method, r.url.split("/")[2]))
        page.on("response", done)
        return ctx, page

    def wait_for(fn, timeout, page, step=0.25):
        end = time.time() + timeout
        while time.time() < end:
            try:
                v = fn()
                if v: return v
            except Exception:
                pass
            page.wait_for_timeout(int(step * 1000))
        return False

    def stamp(p): return p.inner_text("#stamp").strip().upper()
    def big(p):
        p.wait_for_timeout(1500)
        return int(p.inner_text("#bigN").replace(",", ""))
    def saved(p):          # the page's own record of where it stands with the backend
        return p.evaluate("(k) => { const r = JSON.parse(localStorage.getItem('kw.count.v1:' + k) || 'null'); return r ? {rev: r.rev, dirty: r.dirty, lines: r.s.lines.length, log: r.s.log.length, who: r.s.who} : null; }", code)

    ctx1, d1 = device("phone")
    t = time.time(); d1.goto(PAGE)
    opened = wait_for(lambda: d1.locator(".adds").count() == 1 or d1.locator("#bigN").count() == 1, 90, d1)
    check("the real backend opens the test link", bool(opened), d1.inner_text("#app")[:200])
    print(f"   first load took {time.time() - t:.1f}s", flush=True)
    check("it is a new, empty tracker", d1.locator("#suWho").count() == 1 and d1.locator("#bigN").count() == 0, d1.inner_text("#app")[:120])

    t = time.time()
    d1.fill("#suWho", "José Test \U0001F94B"); d1.locator('[data-act="lockWho"]').click()
    ok = wait_for(lambda: (saved(d1) or {}).get("rev") == 1 and not saved(d1)["dirty"], 90, d1)
    check("the name is saved to the real Sheet", bool(ok), saved(d1)); print(f"   save took {time.time() - t:.1f}s", flush=True)

    d1.select_option('select[data-add="kata"]', "Bassai"); d1.wait_for_timeout(150)
    d1.select_option('select[data-add="drill"]', "Hammer blocks"); d1.wait_for_timeout(150)
    d1.locator("#itt1").click(); d1.keyboard.type("1000")
    t = time.time(); d1.locator('[data-act="begin"]').click()
    ok = wait_for(lambda: (saved(d1) or {}).get("rev") == 2 and not saved(d1)["dirty"], 90, d1)
    check("BEGIN is saved", bool(ok), saved(d1)); print(f"   save took {time.time() - t:.1f}s", flush=True)

    d1.locator('[data-act="log"]').first.click(); d1.wait_for_timeout(350)
    d1.select_option("#lgForm", label="Bassai"); d1.fill("#lgReps", "50")
    t = time.time(); d1.locator('[data-act="doLog"]').click()
    ok = wait_for(lambda: (saved(d1) or {}).get("rev") == 3 and not saved(d1)["dirty"], 90, d1)
    check("fifty reps are saved", bool(ok), saved(d1)); print(f"   save took {time.time() - t:.1f}s", flush=True)
    check("the foot says Updated", wait_for(lambda: stamp(d1).startswith("UPDATED "), 8, d1), stamp(d1))

    d1.evaluate("localStorage.clear(); sessionStorage.clear()")
    t = time.time(); d1.goto(PAGE)
    back = wait_for(lambda: d1.locator("#bigN").count() == 1, 90, d1)
    check("after the browser is wiped, the real backend brings the count back", bool(back) and big(d1) == 50 and d1.inner_text("#who").strip() == "José Test \U0001F94B" and d1.evaluate("() => [...document.querySelectorAll('.row .nm b')].map(e => e.textContent)") == ["Bassai", "Hammer blocks"], d1.inner_text("#app")[:200])
    print(f"   reload took {time.time() - t:.1f}s", flush=True)

    ctx2, d2 = device("second phone")
    d2.goto(PAGE)
    there = wait_for(lambda: d2.locator("#bigN").count() == 1, 90, d2)
    check("a second phone gets the same count", bool(there) and big(d2) == 50, d2.inner_text("#app")[:200])
    ctx2.set_offline(True)
    d2.locator('[data-act="log"]').first.click(); d2.wait_for_timeout(350)
    d2.select_option("#lgForm", label="Bassai"); d2.fill("#lgReps", "5"); d2.locator('[data-act="doLog"]').click(); d2.wait_for_timeout(400)
    d1.locator('[data-act="log"]').first.click(); d1.wait_for_timeout(350)
    d1.select_option("#lgForm", label="Hammer blocks"); d1.fill("#lgReps", "7"); d1.locator('[data-act="doLog"]').click()
    ok = wait_for(lambda: (saved(d1) or {}).get("rev") == 4 and not saved(d1)["dirty"], 90, d1)
    check("phone one saves while phone two has no signal", bool(ok), saved(d1))
    ctx2.set_offline(False)
    merged = wait_for(lambda: (saved(d2) or {}).get("log") == 3 and not saved(d2)["dirty"], 120, d2)
    check("phone two comes back and the two counts are folded together on the real backend", bool(merged) and big(d2) == 62, (saved(d2), d2.inner_text("#bigN")))
    d1.locator("#stamp").scroll_into_view_if_needed(); d1.locator("#stamp").click()
    agree = wait_for(lambda: (saved(d1) or {}).get("log") == 3, 90, d1)
    check("phone one agrees", bool(agree) and big(d1) == 62, (saved(d1), d1.inner_text("#bigN")))

    bad = [s for s in statuses if s[0] >= 400]
    print("   backend responses:", len(statuses), "| failures:", bad[:6], flush=True)
    check("no page errors", not errors, errors)
    d1.screenshot(path=str(here / "shots" / "real-backend-count.png"), full_page=True)
    browser.close()
srv.shutdown()
print(passes, "passed;", "FAILED: " + str(fails) if fails else "ALL PASSED")
sys.exit(1 if fails else 0)
