#!/usr/bin/env python3
"""The site page against the backend, end to end: the real Code.gs behind an Apps-Script-shaped web address,
real browsers in front. Covers what was promised: a count that survives a cleared browser and a new phone."""
import json
import pathlib
import subprocess
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

here = pathlib.Path(__file__).parent
PAGE = "http://localhost:8790/tracker.html"
CTRL = "http://localhost:8789"
shots = here / "shots"; shots.mkdir(exist_ok=True)
fails, passes, errors = [], 0, []
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1"


def check(name, cond, detail=""):
    global passes
    print(("PASS " if cond else "FAIL ") + name + (("  -> " + str(detail)[:400]) if (detail != "" and not cond) else ""))
    if cond: passes += 1
    else: fails.append(name)


def ctl(path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(CTRL + path, data=data, method="GET" if body is None else "POST", headers={"Content-Type": "application/json"})
    return json.loads(opener.open(req, timeout=15).read())


def dump(): return ctl("/dump")
def row(code): return next((r for r in dump()["rows"] if r["code"] == code), None)
def state(code):
    r = row(code)
    return json.loads(r["data"]) if r and r["data"] else None
def code(tag): return "cs_test_" + (tag + "0123456789abcdefghijABCDEFGHIJ0123456789abcdefghijABCDEFGHIJ")[:58]
pump = [None]                       # a page to wait on, so the browsers keep running while a test waits
def until(fn, timeout=12.0, step=0.15):
    end = time.time() + timeout
    while time.time() < end:
        try:
            v = fn()
            if v: return v
        except Exception:
            pass
        if pump[0]: pump[0].wait_for_timeout(int(step * 1000))
        else: time.sleep(step)
    return False


server = subprocess.Popen(["node", str(here.parent / "backend" / "mock_server.js"), str(here / "out")], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
try:
    assert until(lambda: ctl("/reset", {})["ok"], 10), "mock backend did not start"

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        hosts = set()

        def device(name):
            ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, user_agent=UA,
                                      permissions=["clipboard-read", "clipboard-write"])
            ctx.route("**/fonts.googleapis.com/**", lambda r: r.abort())
            ctx.route("**/fonts.gstatic.com/**", lambda r: r.abort())
            page = ctx.new_page()
            page.on("request", lambda q: hosts.add(q.url.split("/")[2]))
            page.on("pageerror", lambda e: errors.append(name + " PAGEERROR " + str(e)))
            page.on("console", lambda m: errors.append(name + " " + m.text) if m.type == "error" and "net::" not in m.text and "Failed to load resource" not in m.text and "Failed to fetch" not in m.text else None)
            return ctx, page

        def text(page): return page.inner_text("#app").strip().upper()
        def stamp(page): return page.inner_text("#stamp").strip().upper()
        def big(page):
            page.wait_for_timeout(1500)
            return int(page.inner_text("#bigN").replace(",", ""))
        def names(page): return page.evaluate("() => [...document.querySelectorAll('.row .nm b')].map(e => e.textContent)")
        def log(page, n, form=None):
            page.locator('[data-act="log"]').first.click(); page.wait_for_timeout(350)
            if form: page.select_option("#lgForm", label=form)
            page.fill("#lgReps", str(n))
            page.locator('[data-act="doLog"]').click(); page.wait_for_timeout(450)
        def synced(c, logged): return until(lambda: (row(c) or {}).get("logged") == logged)
        def sync_now(page):
            page.locator("#stamp").scroll_into_view_if_needed(); page.locator("#stamp").click(); page.wait_for_timeout(900)

        # ------------------------------------------------------------------ no link, bad link
        A, B, C, D, U = code("A"), code("B"), code("C"), code("D"), code("U")
        ctx1, d1 = device("phone")
        pump[0] = d1
        d1.goto(PAGE); d1.wait_for_timeout(500)
        check("opened with no link: one line saying so", text(d1) == "OPEN THIS PAGE FROM YOUR OWN LINK", text(d1))
        check("opened with no link: nothing is asked of the backend", len(dump()["log"]) == 0, dump()["log"])
        check("opened with no link: no log button, no menu, and the way back to the site", d1.locator("#dock").is_hidden() and d1.locator("#more").is_hidden() and d1.locator('footer a[href="https://katawarrior.com"]').count() == 1)

        d1.goto(PAGE + "?k=" + U)
        check("a made-up link: the line says it is not active", until(lambda: text(d1) == "THIS LINK IS NOT ACTIVE", 8), text(d1))
        check("a made-up link: Stripe was asked once and no row was made", dump()["stripeCalls"] == 1 and len(dump()["rows"]) == 0, dump()["stripeCalls"])
        d1.locator(".boot").click(); d1.wait_for_timeout(1200)
        check("tapping the line tries again, and Stripe is not asked twice", text(d1) == "THIS LINK IS NOT ACTIVE" and dump()["stripeCalls"] == 1 and len(dump()["log"]) == 2, (text(d1), dump()["stripeCalls"]))
        ctl("/stripe", {"id": code("N"), "status": "complete", "payment_status": "unpaid"})
        d1.goto(PAGE + "?k=" + code("N"))
        check("a checkout that was never paid is not let in", until(lambda: text(d1) == "THIS LINK IS NOT ACTIVE", 8), text(d1))
        d1.goto(PAGE + "?k=cs_test_%3Cscript%3E")
        d1.wait_for_timeout(500)
        check("a malformed code is treated as no link at all", text(d1) == "OPEN THIS PAGE FROM YOUR OWN LINK", text(d1))

        # ------------------------------------------------------------------ a new buyer
        ctl("/stripe", {"id": A, "email": "john@example.com"})
        ctl("/mode", {"delay": 700})
        d1.goto(PAGE + "?k=" + A)
        check("a paid link shows Loading while it is checked", until(lambda: text(d1) == "LOADING", 3), text(d1))
        ctl("/mode", {"delay": 0})
        check("then opens the first screen", until(lambda: d1.locator(".adds").count() == 1 and d1.locator("#suWho").count() == 1, 8), text(d1))
        r = row(A)
        check("the buyer has a row: his code, his email, his link", bool(r) and r["email"] == "john@example.com" and r["link"] == "https://katawarrior.com/tracker.html?k=" + A and r["rev"] == 0 and r["data"] == "", r)
        d1.screenshot(path=str(shots / "site-01-first-screen.png"))

        d1.fill("#suWho", "John Smith"); d1.locator('[data-act="lockWho"]').click()
        check("his name reaches the sheet", until(lambda: (row(A) or {}).get("name") == "John Smith"), row(A))
        d1.select_option('select[data-add="kata"]', "Bassai"); d1.wait_for_timeout(120)
        d1.select_option('select[data-add="drill"]', "Front kicks"); d1.wait_for_timeout(120)
        d1.locator("#itt1").click(); d1.keyboard.type("1000")
        d1.locator('[data-act="begin"]').click()
        check("BEGIN reaches the sheet: two lines, of 1,500", until(lambda: (row(A) or {}).get("lines") == 2 and row(A)["of"] == 1500), row(A))
        log(d1, 50, "Bassai")
        check("fifty reps reach the sheet", synced(A, 50), row(A))
        check("the foot says when it was last saved", until(lambda: stamp(d1).startswith("UPDATED "), 4) and "warn" not in (d1.get_attribute("#stamp", "class") or ""), stamp(d1))
        st = state(A)
        check("the sheet holds the whole count", st["who"] == "John Smith" and [l["name"] for l in st["lines"]] == ["Bassai", "Front kicks"] and [l["target"] for l in st["lines"]] == [500, 1000] and len(st["log"]) == 1 and st["log"][0]["r"] == 50 and "ui" not in st, st)
        d1.screenshot(path=str(shots / "site-02-count.png"), full_page=True)

        d1.locator("#more").click(); d1.wait_for_timeout(400)
        link = "http://localhost:8790/tracker.html?k=" + A
        check("the menu shows his own link", d1.inner_text("#myLink").strip() == link, d1.inner_text("#myLink"))
        d1.locator('#panel [data-act="copyLink"]').click(); d1.wait_for_timeout(300)
        check("Copy my link copies it", d1.evaluate("navigator.clipboard.readText()") == link, d1.evaluate("navigator.clipboard.readText()"))
        d1.locator('[data-act="close"]').click(); d1.wait_for_timeout(400)

        # ------------------------------------------------------------------ the promise
        calls = dump()["stripeCalls"]
        d1.evaluate("localStorage.clear(); sessionStorage.clear()")
        d1.goto(PAGE + "?k=" + A)
        check("after his browser is wiped clean, his link brings the count back", until(lambda: d1.locator("#bigN").count() == 1, 8) and big(d1) == 50 and names(d1) == ["Bassai", "Front kicks"] and d1.inner_text("#who").strip().upper() == "JOHN SMITH", text(d1)[:200])
        ctx2, d2 = device("second phone")
        d2.goto(PAGE + "?k=" + A)
        check("on a phone that has never seen it, his link brings the count", until(lambda: d2.locator("#bigN").count() == 1, 8) and big(d2) == 50 and d2.inner_text("#who").strip().upper() == "JOHN SMITH", text(d2)[:200])
        check("a returning buyer is never checked with Stripe again", dump()["stripeCalls"] == calls, (calls, dump()["stripeCalls"]))
        check("a new phone shows the Home Screen card", d2.locator(".keep").count() == 1)
        d2.locator('[data-act="keepDone"]').click(); d2.wait_for_timeout(600)
        revs = row(A)["rev"]
        d2.wait_for_timeout(1500)
        check("putting the card away is this phone's business: nothing is sent", row(A)["rev"] == revs and d1.locator(".keep").count() == 1)

        d1.goto(PAGE); d1.wait_for_timeout(700)
        check("opened without the link on a phone that has used it: the count, and the address is his link again", d1.locator("#bigN").count() == 1 and d1.evaluate("location.search") == "?k=" + A, d1.evaluate("location.href"))

        # ------------------------------------------------------------------ no signal
        ctl("/mode", {"down": True})
        log(d1, 30, "Bassai")
        check("with the backend unreachable the count still moves on the phone", big(d1) == 80)
        check("and the foot says it is not saved yet", until(lambda: stamp(d1) == "NOT SAVED YET" and "warn" in d1.get_attribute("#stamp", "class"), 6), stamp(d1))
        check("the sheet still has the old number", row(A)["logged"] == 50)
        d1.screenshot(path=str(shots / "site-03-not-saved.png"), full_page=True)
        d1.reload(); d1.wait_for_timeout(900)
        check("reloading with no signal keeps the unsaved reps", d1.locator("#bigN").count() == 1 and big(d1) == 80, text(d1)[:120])
        log(d1, 20, "Bassai")
        ctl("/mode", {"down": False})
        d1.evaluate("window.dispatchEvent(new Event('online'))")
        check("when the signal returns, everything is sent", synced(A, 100), row(A))
        check("and the foot goes back to Updated", until(lambda: stamp(d1).startswith("UPDATED "), 5), stamp(d1))

        ctl("/mode", {"down": True})
        ctx3, d3 = device("third phone")
        d3.goto(PAGE + "?k=" + A)
        check("a first visit with the backend unreachable says it could not load", until(lambda: text(d3) == "COULD NOT LOAD", 8), text(d3))
        ctl("/mode", {"down": False})
        d3.locator(".boot").click()
        check("and a tap loads it once the backend is back", until(lambda: d3.locator("#bigN").count() == 1, 8) and big(d3) == 100, text(d3)[:120])
        ctx3.close()

        # ------------------------------------------------------------------ two phones
        sync_now(d2)
        check("the second phone catches up when asked", big(d2) == 100, d2.inner_text("#bigN"))
        ctx2.set_offline(True)
        log(d2, 5, "Bassai")                                           # phone two, no signal
        log(d1, 7, "Front kicks")                                      # phone one, meanwhile
        d1.select_option('.adds.below select[data-add="kata"]', "Jion"); d1.wait_for_timeout(300)
        check("phone one's changes reach the sheet", until(lambda: (row(A) or {}).get("logged") == 107 and row(A)["lines"] == 3), row(A))
        ctx2.set_offline(False)
        check("phone two comes back: both phones' reps are in the sheet, none lost, none doubled", synced(A, 112) and len(state(A)["log"]) == 5 and len({e["id"] for e in state(A)["log"]}) == 5, row(A))
        check("phone two now shows phone one's reps and new line", until(lambda: "Jion" in names(d2), 6) and big(d2) == 112, (names(d2), d2.inner_text("#bigN")))
        sync_now(d1)
        check("phone one shows phone two's reps", big(d1) == 112, d1.inner_text("#bigN"))

        ctx2.set_offline(True)
        d2.locator('.row[data-act="line"]', has_text="Bassai").click(); d2.wait_for_timeout(400)
        d2.locator(".hrow .rm").first.click(); d2.wait_for_timeout(300)      # phone two removes its last Bassai entry (5)
        d2.locator('[data-act="close"]').click(); d2.wait_for_timeout(400)
        d2.locator('.row[data-act="line"]', has_text="Jion").click(); d2.wait_for_timeout(400)
        d2.locator('[data-act="delLine"]').click(); d2.locator('[data-act="delLine"]').click(); d2.wait_for_timeout(450)   # and deletes Jion
        log(d1, 3, "Bassai")                                            # phone one adds three
        d1.locator('.row[data-act="line"]', has_text="Front kicks").click(); d1.wait_for_timeout(400)
        d1.locator("#lnTarget").click(); d1.keyboard.type("2000"); d1.locator('[data-act="saveLine"]').click(); d1.wait_for_timeout(400)
        check("phone one's edits reach the sheet", until(lambda: (row(A) or {}).get("logged") == 115 and row(A)["of"] == 3000), row(A))
        ctx2.set_offline(False)
        check("a removal on one phone and an addition on the other both stand", until(lambda: (row(A) or {}).get("logged") == 110 and row(A)["lines"] == 2 and row(A)["of"] == 2500), row(A))
        check("phone two shows the merged count", until(lambda: names(d2) == ["Bassai", "Front kicks"], 6) and big(d2) == 110, (names(d2), d2.inner_text("#bigN")))
        sync_now(d1)
        check("phone one agrees", big(d1) == 110 and names(d1) == ["Bassai", "Front kicks"], (d1.inner_text("#bigN"), names(d1)))

        # ------------------------------------------------------------------ an answer lost on the way back
        before = len(state(A)["log"])
        ctl("/mode", {"dropNext": 1})
        log(d1, 4, "Bassai")
        check("a save whose answer never arrived is not counted twice", synced(A, 114) and len(state(A)["log"]) == before + 1 and big(d1) == 114, (row(A), before))
        check("and the foot settles on Updated", until(lambda: stamp(d1).startswith("UPDATED "), 8), stamp(d1))

        # ------------------------------------------------------------------ undo, start over
        log(d1, 9, "Bassai")
        d1.locator('[data-act="undo"]').click()
        check("Undo is sent too", synced(A, 114) and big(d1) == 114, row(A))

        # ------------------------------------------------------------------ the sheet loses his row
        ctl("/delete", {"k": A})
        check("(the row is gone from the sheet)", row(A) is None)
        log(d1, 6, "Bassai")
        check("if his row is deleted from the sheet, his phone puts the whole count back", until(lambda: (row(A) or {}).get("logged") == 120 and row(A)["lines"] == 2 and row(A)["name"] == "John Smith" and row(A)["email"] == "john@example.com"), row(A))
        check("and nothing on his screen changed", big(d1) == 120 and names(d1) == ["Bassai", "Front kicks"])

        # ------------------------------------------------------------------ another buyer on the same phone
        ctl("/stripe", {"id": B, "email": "second@example.com"})
        d1.goto(PAGE + "?k=" + B)
        check("a second link on the same phone opens its own empty tracker", until(lambda: d1.locator(".adds").count() == 1 and d1.locator("#suWho").count() == 1, 8) and d1.locator("#bigN").count() == 0, text(d1)[:100])
        d1.fill("#suWho", '=HYPERLINK("http://evil.example","x")'); d1.locator('[data-act="lockWho"]').click()
        check("a name written like a formula is defused in the sheet", until(lambda: (row(B) or {}).get("rev") == 1) and row(B)["name"] == 'HYPERLINK("http://evil.example","x")' and dump()["hazards"] == [], (row(B), dump()["hazards"]))
        d1.evaluate("localStorage.clear()"); d1.goto(PAGE + "?k=" + B)
        check("and comes back to him exactly as he typed it", until(lambda: d1.locator("#who").is_visible(), 8) and d1.inner_text("#who").strip() == '=HYPERLINK("http://evil.example","x")' and d1.evaluate("document.querySelectorAll('#who a, #who script').length") == 0, d1.inner_text("#who"))
        d1.goto(PAGE + "?k=" + A)
        check("the first link still opens the first count", until(lambda: d1.locator("#bigN").count() == 1, 8) and big(d1) == 120)

        # ------------------------------------------------------------------ typing is never interrupted
        ctl("/stripe", {"id": C, "email": "ann@example.com"})
        d2.goto(PAGE + "?k=" + C)
        until(lambda: d2.locator("#suWho").count() == 1, 8)
        d2.fill("#suWho", "Ann"); d2.locator('[data-act="lockWho"]').click()
        until(lambda: (row(C) or {}).get("rev") == 1)
        d2.select_option('select[data-add="kata"]', "Bassai"); d2.wait_for_timeout(150)
        other = {"v": 1, "who": "Ann", "lines": [{"id": "zz1", "name": "Jion", "target": 300, "kind": "kata"}], "log": []}
        took = ctl("/call", {"a": "save", "k": C, "rev": 1, "data": json.dumps(other), "sum": {"who": "Ann", "logged": 0, "of": 300, "lines": 1}})
        ctl("/mode", {"delay": 1200})
        d2.locator("#who").click(); d2.wait_for_timeout(150)
        d2.locator("#suWho").click(); d2.keyboard.press("End"); d2.keyboard.type(" B"); d2.keyboard.press("Enter")
        d2.locator("#itt0").click()
        d2.keyboard.type("123", delay=1100)                             # the newer count arrives while he is typing this
        mid = d2.evaluate("() => [document.querySelector('#itt0') ? document.querySelector('#itt0').value : null, document.activeElement && document.activeElement.id, document.querySelectorAll('.adds').length, document.querySelectorAll('#bigN').length]")
        check("(another phone's BEGIN was saved first)", took.get("rev") == 2, took)
        check("a newer count arriving does not disturb the box he is typing in", mid == ["123", "itt0", 1, 0], mid)
        ctl("/mode", {"delay": 0})
        d2.locator(".intro").click()
        check("once he stops typing, the screen catches up", until(lambda: d2.locator("#bigN").count() == 1 and names(d2) == ["Jion"], 6), text(d2)[:120])
        check("and his own change, the name, was folded in", until(lambda: (state(C) or {}).get("who") == "Ann B" and [l["name"] for l in state(C)["lines"]] == ["Jion"]) and d2.inner_text("#who").strip().upper() == "ANN B", state(C))

        # ------------------------------------------------------------------ years of entries
        ctl("/stripe", {"id": D, "email": "long@example.com"})
        ctl("/call", {"a": "load", "k": D})
        longlog = [{"id": "e%05d" % i, "l": "l1", "r": 20, "d": "2026-%02d-%02d" % (1 + i % 9, 1 + i % 28), "t": 1760000000000 + i * 1000} for i in range(3000)]
        longstate = {"v": 1, "who": "Long Hauler", "lines": [{"id": "l1", "name": "Heian Shodan", "target": 99999, "kind": "kata"}], "log": longlog}
        ctl("/call", {"a": "save", "k": D, "rev": 0, "data": json.dumps(longstate, separators=(",", ":")), "sum": {"who": "Long Hauler", "logged": 60000, "of": 99999, "lines": 1}})
        d2.goto(PAGE + "?k=" + D)
        check("three thousand entries load", until(lambda: d2.locator("#bigN").count() == 1, 10) and big(d2) == 60000, text(d2)[:100])
        log(d2, 1)
        check("and save, cut across several cells of the sheet", until(lambda: (row(D) or {}).get("logged") == 60001, 15) and row(D)["cells"] >= 5 and len(state(D)["log"]) == 3001, (row(D) or {}).get("cells"))

        # ------------------------------------------------------------------ start over
        d1.locator("#more").click(); d1.wait_for_timeout(400)
        d1.locator('[data-act="startOver"]').click(); d1.locator('[data-act="startOver"]').click(); d1.wait_for_timeout(500)
        check("Start over empties the count in the sheet and keeps his name", until(lambda: (row(A) or {}).get("lines") == 0 and row(A)["logged"] == 0 and row(A)["name"] == "John Smith") and d1.locator(".adds").count() == 1 and d1.inner_text("#who").strip().upper() == "JOHN SMITH", row(A))

        # ------------------------------------------------------------------ how it talks
        d = dump()
        posts = [e for e in d["log"] if e["m"] == "POST"]
        check("the page never causes a preflight", all(e["m"] != "OPTIONS" for e in d["log"]), [e for e in d["log"] if e["m"] == "OPTIONS"])
        check("every request is a plain-text POST from the site", len(posts) > 30 and all(e.get("ct", "text/plain").startswith("text/plain") for e in posts) and {e["origin"] for e in posts if "k" in e and e["origin"]} == {"http://localhost:8790"}, {e.get("ct") for e in posts})
        check("nothing written to the sheet could be read as a formula", d["hazards"] == [], d["hazards"])
        check("the backend raised no errors and left no lock held", d["errors"] == [] and d["locks"] == 0, d["errors"])
        check("the page talks only to its own site, the backend, and the font host", hosts <= {"localhost:8790", "localhost:8787", "127.0.0.1:8788", "fonts.googleapis.com", "fonts.gstatic.com"}, hosts)

        head = d1.evaluate("() => ({robots: document.querySelector('meta[name=robots]').content, ref: document.querySelector('meta[name=referrer]').content, title: document.title, app: document.querySelector('meta[name=\"apple-mobile-web-app-title\"]').content, icon: document.querySelector('link[rel=\"apple-touch-icon\"]').href, sw: 'serviceWorker' in navigator ? 'present' : 'absent'})")
        icon = opener.open(head["icon"], timeout=10)
        regs = d1.evaluate("navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then(r => r.length) : 0")
        check("the page asks not to be indexed and sends no referrer", head["robots"] == "noindex,nofollow" and head["ref"] == "no-referrer", head)
        check("it has a Home Screen name and icon", head["app"] == "Kata Warrior" and icon.status == 200 and icon.headers["Content-Type"] == "image/png", head)
        check("no service worker is registered", regs == 0, regs)
        src = (here / "out" / "tracker.html").read_text()
        import re
        check("no key of any kind is in the page", not re.search(r"\b(rk|sk|pk)_(test|live)_", src) and "Bearer" not in src and "password" not in src.lower())
        browser.close()
finally:
    server.terminate()

print("console errors:", errors if errors else "none")
print(passes, "passed;", "FAILED: " + str(fails) if fails else "ALL PASSED")
sys.exit(1 if (fails or errors) else 0)
