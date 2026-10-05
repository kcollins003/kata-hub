#!/usr/bin/env python3
"""The site page against the backend, end to end: the real Code.gs behind an Apps-Script-shaped web address,
real browsers in front. Covers what was promised: a man gives his email and gets a tracker of his own,
his link reaches him by email, and his count survives a cleared browser and a new phone."""
import json
import pathlib
import re
import shutil
import subprocess
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

here = pathlib.Path(__file__).parent
sys.path.insert(0, str(here))
from build import site_page

PAGE = "http://localhost:8790/tracker.html"
CTRL = "http://localhost:8789"
FAKE = "http://localhost:8787/macros/s/FAKE/exec"
LINK = "https://katawarrior.com/tracker.html?k="          # what the backend writes in the Sheet and in the email
shots = here / "shots"; shots.mkdir(exist_ok=True)
site = here / "out-test"; site.mkdir(exist_ok=True)       # the tests' own copy of the page; out/tracker.html is never touched
(site / "tracker.html").write_text(site_page(FAKE))
shutil.copy(here / "out" / "tracker-icon.png", site / "tracker-icon.png")
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


server = subprocess.Popen(["node", str(here.parent / "backend" / "mock_server.js"), str(site)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
try:
    assert until(lambda: ctl("/reset", {})["ok"], 10), "mock backend did not start"

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        hosts = set()

        def device(name, width=390, height=844):
            ctx = browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=2, is_mobile=True, has_touch=True, user_agent=UA,
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


        # ================================================================== THE DOOR: sign-up by email
        KW = re.compile(r"^kw_[a-f0-9]{32}$")
        def at_door(page): return page.locator("#jnEmail").count() == 1 and page.locator("#jnGo").count() == 1 and page.locator(".adds").count() == 0 and page.locator("#bigN").count() == 0
        def said(page): return (page.inner_text("#jnMsg").strip(), page.get_attribute("#jnMsg", "class"))
        def note(page): return page.inner_text("#jnNote").strip() if page.locator("#jnNote").count() else ""
        def k_of(page): return page.evaluate("new URLSearchParams(location.search).get('k')") or ""
        def mails(): return dump()["mail"]
        def mail_to(email): return [x for x in mails() if x["to"] == email]
        def row_of(email): return next((x for x in dump()["rows"] if x["email"] == email), None)
        def joins(): return [e for e in dump()["log"] if e.get("a") == "join"]
        def first_screen(page, t=8): return until(lambda: page.locator(".adds").count() == 1 and page.locator("#suWho").count() == 1, t)
        def join(page, email, enter=False):
            page.fill("#jnEmail", email)
            if enter: page.locator("#jnEmail").press("Enter")
            else: page.locator("#jnGo").click()
        def emailed_link(email):            # the link as it sits in his inbox, pointed at the test site
            return mail_to(email)[-1]["body"].split("\n")[-1].replace("https://katawarrior.com/tracker.html", PAGE)
        def kept(page): return page.evaluate("JSON.stringify(Object.assign({}, localStorage))")
        CHECK, FAILED, WRONG = ("Check your email", "msg ok"), ("Could not load", "msg err"), ("Check the email address", "msg err")

        ctx0, p0 = device("door phone")
        pump[0] = p0
        p0.goto(PAGE); p0.wait_for_timeout(500)
        check("opened with no link: the door", at_door(p0), text(p0))
        check("the door says what this is, in Kevin's words", p0.locator("#tag").is_visible() and p0.inner_text("#tag").strip() == "Tracker" and p0.inner_text(".intro").strip() == "Build your own kata challenge and track it", (p0.inner_text("#tag"), p0.inner_text(".intro")))
        check("the door: nothing is asked of the backend until he acts", len(dump()["log"]) == 0, dump()["log"])
        check("the door: no log button, no menu, no name, and the way back to the site", p0.locator("#dock").is_hidden() and p0.locator("#more").is_hidden() and p0.locator("#who").is_hidden() and p0.locator('footer a[href="https://katawarrior.com"]').count() == 1)
        box = p0.evaluate("() => { const e = document.querySelector('#jnEmail'), c = getComputedStyle(e); return {type: e.type, mode: e.inputMode, auto: e.autocomplete, name: e.name, caps: e.getAttribute('autocapitalize'), fix: e.getAttribute('autocorrect'), max: e.maxLength, size: c.fontSize, h: e.getBoundingClientRect().height, label: document.querySelector('label[for=jnEmail]').textContent, says: e.getAttribute('aria-describedby')}; }")
        check("the email box asks the phone for its email keyboard and his saved address, and is big enough not to zoom", box["type"] == "email" and box["mode"] == "email" and box["auto"] == "email" and box["name"] == "email" and box["caps"] == "off" and box["fix"] == "off" and box["max"] == 120 and box["size"] == "16px" and box["h"] >= 44 and box["label"] == "Email" and box["says"] == "jnMsg", box)
        check("under the button, a line says what giving his email means", p0.locator(".fine").is_visible() and len(p0.inner_text(".fine").strip()) > 20)
        p0.screenshot(path=str(shots / "site-00-door.png"), full_page=True)

        for bad in ["", "   ", "john", "john@", "john@example", "john smith@example.com", "john@example.com, x@example.com", "<img src=x onerror=alert(1)>@example.com"]:
            p0.fill("#jnEmail", bad); p0.locator("#jnGo").click(); p0.wait_for_timeout(120)
            if said(p0) != WRONG or "bad" not in (p0.get_attribute("#jnEmail", "class") or "") or p0.get_attribute("#jnEmail", "aria-invalid") != "true": break
        else: bad = None
        check("something that is not an email is caught on the page", bad is None, (bad, said(p0)))
        check("and never sent to the backend", len(dump()["log"]) == 0 and p0.evaluate("document.querySelectorAll('#app img, #app script').length") == 0, dump()["log"])
        geo = p0.evaluate("""() => { const r = s => document.querySelector(s).getBoundingClientRect(), b = r('#jnEmail'), m = r('#jnMsg'), g = r('#jnGo'), c = s => getComputedStyle(document.querySelector(s));
            return {order: b.bottom <= m.top && m.bottom <= g.top, msgBottom: Math.round(m.bottom), focused: document.activeElement.id, edge: c('#jnEmail').borderTopColor}; }""")
        check("the message sits between the box and the button, where a keyboard does not cover it, and the box stays ready to retype", geo["order"] and geo["msgBottom"] < 400 and geo["focused"] == "jnEmail", geo)
        check("the wrong box is edged in a colour of its own, not the colour every focused box has", geo["edge"] == "rgb(224, 139, 134)", geo["edge"])
        p0.fill("#jnEmail", "j"); p0.wait_for_timeout(60)
        check("typing again clears the mark", "bad" not in (p0.get_attribute("#jnEmail", "class") or "") and p0.get_attribute("#jnEmail", "aria-invalid") is None)

        # ------------------------------------------------------------------ a new man: his link goes to his inbox
        ctl("/mode", {"delay": 800})
        join(p0, "  John.Smith@Example.com ")
        check("while his email is on its way the button says Loading and is switched off, the box cannot be changed, and the keyboard is put away", until(lambda: p0.inner_text("#jnGo").strip() == "Loading" and p0.locator("#jnGo").is_disabled(), 2) and p0.evaluate("document.querySelector('#jnEmail').readOnly") is True and p0.evaluate("document.activeElement.id") != "jnEmail", p0.inner_text("#jnGo"))
        p0.locator("#jnEmail").press("Enter"); p0.locator("#jnGo").click(force=True)        # impatient: Enter and a second tap
        ctl("/mode", {"delay": 0})
        check("a new email: the door says to check his email, and stays the door", until(lambda: said(p0) == CHECK, 6) and at_door(p0), (said(p0), text(p0)[:80]))
        r = row_of("john.smith@example.com")
        K = r["code"] if r else ""
        check("he has a row: a code of his own, his email in small letters, an empty count, his link", bool(r) and bool(KW.match(K)) and r["link"] == LINK + K and r["rev"] == 0 and r["data"] == "" and r["name"] == "", r)
        m = mails()
        check("one email went, to him alone, carrying that link", len(m) == 1 and m[0]["to"] == "john.smith@example.com" and m[0]["body"].endswith("\n\n" + LINK + K) and m[0]["subject"] == "Kata Warrior Tracker" and m[0]["name"] == "Kata Warrior", m)
        check("the sheet notes that his link was emailed", r["mailed"] is True, r)
        j = joins()
        check("for all his tapping, his email went to the backend once: plain text, his address and nothing else", len(j) == 1 and j[0]["keys"] == "a,e" and j[0]["e"] == "john.smith@example.com" and j[0]["ct"].startswith("text/plain") and j[0]["m"] == "POST", j)
        check("the backend answered with nothing but 'sent'", j[0]["said"] == '{"ok":true,"sent":true}', j[0]["said"])
        check("his link is nowhere on that screen, in its address, or in what the phone kept", K not in p0.content() and k_of(p0) == "" and kept(p0) == "{}", (p0.evaluate("location.href"), kept(p0)))
        check("the button and the box are ready again", p0.inner_text("#jnGo").strip() == "START" and not p0.locator("#jnGo").is_disabled() and p0.evaluate("document.querySelector('#jnEmail').readOnly") is False)
        check("Stripe is never asked about a sign-up", dump()["stripeCalls"] == 0)
        p0.screenshot(path=str(shots / "site-00c-door-check-email.png"), full_page=True)

        # ------------------------------------------------------------------ he opens the link in his email
        emailed = emailed_link("john.smith@example.com")
        p0.goto(emailed)
        check("the link in his email opens his tracker, on the first screen", first_screen(p0) and k_of(p0) == K and p0.locator("#tag").is_hidden(), text(p0)[:120])
        check("this phone remembers the link as its own from then on", p0.evaluate("localStorage.getItem('kw.count.v1.code')") == K)
        p0.fill("#suWho", "John Smith"); p0.locator('[data-act="lockWho"]').click()
        check("his name reaches his row", until(lambda: (row(K) or {}).get("name") == "John Smith"), row(K))
        p0.select_option('select[data-add="kata"]', "Heian Shodan"); p0.wait_for_timeout(120)
        p0.locator('[data-act="begin"]').click()
        log(p0, 25)
        check("and so does his count", synced(K, 25) and row(K)["lines"] == 1 and row(K)["of"] == 500, row(K))
        check("the foot says when it was last saved", until(lambda: stamp(p0).startswith("UPDATED "), 4) and "warn" not in (p0.get_attribute("#stamp", "class") or ""), stamp(p0))
        p0.locator("#more").click(); p0.wait_for_timeout(400)
        check("the menu shows his link, the same code the email carried", p0.inner_text("#myLink").strip() == PAGE + "?k=" + K, p0.inner_text("#myLink"))
        p0.locator('[data-act="close"]').click(); p0.wait_for_timeout(400)

        # ------------------------------------------------------------------ the promise, by the emailed link
        p0.evaluate("localStorage.clear(); sessionStorage.clear()")
        p0.goto(emailed)
        check("after his browser is wiped clean, the link in his email brings the count back", until(lambda: p0.locator("#bigN").count() == 1, 8) and big(p0) == 25 and names(p0) == ["Heian Shodan"] and p0.inner_text("#who").strip().upper() == "JOHN SMITH", text(p0)[:200])
        ctxS, pS = device("his Safari, never seen it")
        pS.goto(emailed)
        check("on a browser that has never seen it, the emailed link brings the count", until(lambda: pS.locator("#bigN").count() == 1, 8) and big(pS) == 25, text(pS)[:200])
        p0.goto(PAGE); p0.wait_for_timeout(700)
        check("opened with no link on a phone that has his: straight to his count, never the door", p0.locator("#bigN").count() == 1 and k_of(p0) == K and p0.locator("#jnEmail").count() == 0, p0.evaluate("location.href"))

        # ------------------------------------------------------------------ a second man on the same phone
        p0.goto(PAGE + "?new"); p0.wait_for_timeout(600)
        check("tracker.html?new shows the door even on a phone that has a link, with no complaint about the link", at_door(p0) and note(p0) == "" and p0.evaluate("localStorage.getItem('kw.count.v1.code')") == K, (text(p0)[:60], note(p0)))
        p0.goto(PAGE); p0.wait_for_timeout(700)
        check("and leaving that door without signing up changes nothing: his count is still what opens", p0.locator("#bigN").count() == 1 and k_of(p0) == K and big(p0) == 25, p0.evaluate("location.href"))
        p0.goto(PAGE + "?new"); p0.wait_for_timeout(500)
        join(p0, "brother@example.com")
        check("a second man signs up from that door and is told to check his email", until(lambda: said(p0) == CHECK, 6) and at_door(p0) and bool(row_of("brother@example.com")), said(p0))
        check("until he opens his own link, the phone still belongs to the first man's count", p0.evaluate("localStorage.getItem('kw.count.v1.code')") == K)
        p0.goto(emailed_link("brother@example.com"))
        KB = row_of("brother@example.com")["code"]
        check("his own link opens a tracker of his own", first_screen(p0) and k_of(p0) == KB and KB != K, p0.evaluate("location.href"))
        p0.goto(PAGE); p0.wait_for_timeout(700)
        check("the phone now opens the newer tracker when no link is given", k_of(p0) == KB and p0.locator(".adds").count() == 1, p0.evaluate("location.href"))
        p0.goto(PAGE + "?k=" + K)
        check("and the first man's link still opens the first man's count, untouched", until(lambda: p0.locator("#bigN").count() == 1, 8) and big(p0) == 25 and p0.inner_text("#who").strip().upper() == "JOHN SMITH" and row(K)["logged"] == 25, text(p0)[:100])
        p0.goto(PAGE + "?new&k=" + K)
        check("a real link wins over ?new", until(lambda: p0.locator("#bigN").count() == 1, 8) and k_of(p0) == K)

        # ------------------------------------------------------------------ someone else types his email
        ctxX, pX = device("someone else's phone")
        pX.goto(PAGE); pX.wait_for_timeout(400)
        join(pX, "JOHN.SMITH@example.com")
        check("an email that already has a tracker gets the very same answer: check your email", until(lambda: said(pX) == CHECK, 6) and at_door(pX), (said(pX), text(pX)[:80]))
        check("his code is nowhere on that screen, in its address, or in what the phone kept", K not in pX.content() and k_of(pX) == "" and kept(pX) == "{}", pX.evaluate("location.href"))
        check("nor in what the backend answered", joins()[-1]["said"] == '{"ok":true,"sent":true}', joins()[-1]["said"])
        check("no second row for him, and no second email inside ten minutes", len([x for x in dump()["rows"] if x["email"] == "john.smith@example.com"]) == 1 and len(mail_to("john.smith@example.com")) == 1, len(mail_to("john.smith@example.com")))
        ctl("/clock", {"add": 11 * 60000})
        join(pX, "john.smith@example.com", enter=True)
        check("eleven minutes on, asking again (with the Enter key) emails the same link again", until(lambda: len(mail_to("john.smith@example.com")) == 2, 6) and mail_to("john.smith@example.com")[1]["body"] == mail_to("john.smith@example.com")[0]["body"], mail_to("john.smith@example.com"))
        check("asking for his link never touched his count", row(K)["logged"] == 25 and len(state(K)["log"]) == 1 and row(K)["name"] == "John Smith", row(K))

        # ------------------------------------------------------------------ links that are not his
        made = "kw_" + "0123456789abcdef" * 2
        pX.goto(PAGE + "?k=" + made)
        check("a made-up link: the door, with a line saying the link is not active", until(lambda: at_door(pX) and note(pX) == "This link is not active", 8), (note(pX), text(pX)[:80]))
        check("a made-up link makes no row, and Stripe is not asked", all(x["code"] != made for x in dump()["rows"]) and len(dump()["rows"]) == 2 and dump()["stripeCalls"] == 0, len(dump()["rows"]))
        check("and this phone does not remember it", kept(pX) == "{}", kept(pX))
        asked = len(dump()["log"])
        pX.goto(PAGE + "?k=kw_tooshort")
        pX.wait_for_timeout(500)
        check("a link cut short in the post: the door, with the same line, and the backend is not asked", at_door(pX) and note(pX) == "This link is not active" and len(dump()["log"]) == asked, (note(pX), len(dump()["log"]), asked))
        pX.goto(PAGE + "?k=kw_%3Cscript%3Ealert(1)%3C/script%3E"); pX.wait_for_timeout(400)
        check("a link with markup in it is just a bad link", at_door(pX) and pX.evaluate("document.querySelectorAll('#app script').length") == 0)
        join(pX, "second.man@example.com")
        check("from that door a man can still sign up", until(lambda: said(pX) == CHECK, 6) and bool(row_of("second.man@example.com")), said(pX))
        pX.goto(emailed_link("second.man@example.com"))
        K2 = row_of("second.man@example.com")["code"]
        check("and his emailed link opens a tracker of his own", first_screen(pX) and k_of(pX) == K2)
        pX.fill("#suWho", "Second"); pX.locator('[data-act="lockWho"]').click()
        check("which saves to his own row, not the first man's", until(lambda: (row(K2) or {}).get("name") == "Second") and row(K)["name"] == "John Smith", (row(K2), row(K)))

        # ------------------------------------------------------------------ trouble at the door
        ctxT, pT = device("phone with trouble")
        pT.goto(PAGE); pT.wait_for_timeout(400)
        ctl("/mode", {"down": True})
        join(pT, "trouble@example.com")
        check("with the backend unreachable, the door says it could not load", until(lambda: said(pT) == FAILED, 8) and at_door(pT), said(pT))
        check("the button is ready for another try, and his email is still in the box", pT.inner_text("#jnGo").strip() == "START" and not pT.locator("#jnGo").is_disabled() and pT.input_value("#jnEmail") == "trouble@example.com" and pT.evaluate("document.querySelector('#jnEmail').readOnly") is False)
        ctl("/mode", {"down": False})
        pT.locator("#jnGo").click()
        check("when it is back, the same tap sends his link", until(lambda: said(pT) == CHECK, 6) and len(mail_to("trouble@example.com")) == 1, said(pT))

        ctxL, pL = device("phone that lost the answer")
        pL.goto(PAGE); pL.wait_for_timeout(400)
        ctl("/mode", {"dropNext": 1})
        join(pL, "lost@example.com")
        check("the backend made his row and sent his link, but the answer never arrived: the door says it could not load", until(lambda: said(pL) == FAILED, 8) and bool(row_of("lost@example.com")) and len(mail_to("lost@example.com")) == 1, (said(pL), len(mail_to("lost@example.com"))))
        pL.locator("#jnGo").click()
        check("he tries again: told to check his email, where the one link is waiting; not sent twice", until(lambda: said(pL) == CHECK, 6) and len([x for x in dump()["rows"] if x["email"] == "lost@example.com"]) == 1 and len(mail_to("lost@example.com")) == 1, (said(pL), len(mail_to("lost@example.com"))))
        pL.goto(emailed_link("lost@example.com"))
        check("and that link opens his tracker", first_screen(pL) and row(k_of(pL))["email"] == "lost@example.com")

        ctl("/mail", {"quota": 0})
        ctxQ, pQ = device("phone on a day the email ran out")
        pQ.goto(PAGE); pQ.wait_for_timeout(400)
        join(pQ, "noemail@example.com")
        check("on a day the email has run out, the door says it could not load rather than claim a link was sent", until(lambda: said(pQ) == FAILED, 6) and len(mail_to("noemail@example.com")) == 0, said(pQ))
        check("his row is kept, marked as not emailed", bool(row_of("noemail@example.com")) and row_of("noemail@example.com")["mailed"] is False, row_of("noemail@example.com"))
        ctl("/mail", {"quota": 100})
        pQ.locator("#jnGo").click()
        check("next day the same tap sends it", until(lambda: said(pQ) == CHECK, 6) and len(mail_to("noemail@example.com")) == 1 and row_of("noemail@example.com")["mailed"] is True, said(pQ))
        ctxQ.close(); ctxT.close(); ctxL.close()

        # ------------------------------------------------------------------ his row is deleted from the sheet
        p0.goto(PAGE + "?k=" + K)
        until(lambda: p0.locator("#bigN").count() == 1, 8)
        ctl("/delete", {"k": K})
        log(p0, 5)
        check("if Kevin deletes a man's row, the man's phone keeps its count and says it is not saved", until(lambda: stamp(p0) == "NOT SAVED YET", 14) and big(p0) == 30 and row(K) is None, stamp(p0))
        asked = len(dump()["log"])
        p0.wait_for_timeout(7000)
        check("and stops asking the backend, instead of asking for ever", len(dump()["log"]) == asked, (asked, len(dump()["log"])))
        check("the row is not brought back: deleting it is final", row(K) is None and all(x["email"] != "john.smith@example.com" for x in dump()["rows"]))
        sync_now(p0)
        check("a tap on the foot asks once more, and no more", len(dump()["log"]) == asked + 1 and stamp(p0) == "NOT SAVED YET", (asked, len(dump()["log"])))
        ctxS.close(); ctxX.close()

        # ------------------------------------------------------------------ Kevin's words and switches, on the Words tab
        ctl("/setup", {})
        ctl("/words", {"name": "Email subject", "text": "Your Kata Warrior tracker"})
        ctl("/words", {"name": "Email body", "text": "Kevin here.\nKeep this email.\n{link}\nOpen it in Safari."})
        ctxE, pE = device("phone after Kevin wrote his email")
        pE.goto(PAGE); pE.wait_for_timeout(400)
        join(pE, "words@example.com")
        until(lambda: said(pE) == CHECK, 6)
        m = mail_to("words@example.com"); r = row_of("words@example.com")
        check("the email carries Kevin's own subject and words, with the link where he put it", len(m) == 1 and bool(r) and m[0]["subject"] == "Your Kata Warrior tracker" and m[0]["body"] == "Kevin here.\nKeep this email.\n" + LINK + r["code"] + "\nOpen it in Safari.", m)

        ctl("/words", {"name": "Open right away", "text": "yes"})
        ctxI, pI = device("phone with Open right away on")
        pI.goto(PAGE); pI.wait_for_timeout(400)
        asked = len(dump()["log"])
        join(pI, "Quick.Man@Example.com")
        check("with Open right away on, a new email has its tracker opened here and now", first_screen(pI) and pI.locator("#jnEmail").count() == 0 and pI.locator("#tag").is_hidden(), text(pI)[:100])
        KI = k_of(pI)
        check("the address in the bar is now his own link, and the phone remembers it", bool(KW.match(KI)) and row(KI)["email"] == "quick.man@example.com" and pI.evaluate("localStorage.getItem('kw.count.v1.code')") == KI, pI.evaluate("location.href"))
        check("it opened on that one answer: no second trip to the backend", len(dump()["log"]) == asked + 1, len(dump()["log"]) - asked)
        check("the address his link went to is shown for a moment, so a slip is seen", until(lambda: "show" in (pI.get_attribute("#toast", "class") or ""), 2) and pI.inner_text("#toast").strip() == "quick.man@example.com", pI.inner_text("#toast"))
        check("and the email carries the same code", len(mail_to("quick.man@example.com")) == 1 and LINK + KI in mail_to("quick.man@example.com")[0]["body"])
        pI.screenshot(path=str(shots / "site-00b-opened-right-away.png"))
        pI.fill("#suWho", "Quick"); pI.locator('[data-act="lockWho"]').click()
        check("his tracker saves to his own row", until(lambda: (row(KI) or {}).get("name") == "Quick"), row(KI))
        ctxI2, pI2 = device("another phone, Open right away on")
        pI2.goto(PAGE); pI2.wait_for_timeout(400)
        join(pI2, "quick.man@example.com")
        check("even with it on, an email that already has a tracker is only told to check email", until(lambda: said(pI2) == CHECK, 6) and at_door(pI2) and KI not in pI2.content() and kept(pI2) == "{}", said(pI2))
        ctl("/mail", {"quota": 0})
        pI2.goto(PAGE + "?new"); pI2.wait_for_timeout(400)
        join(pI2, "dry@example.com")
        check("with it on and the day's email run out, a new man still gets in, and nothing claims an email was sent", first_screen(pI2) and row(k_of(pI2))["mailed"] is False and "show" not in (pI2.get_attribute("#toast", "class") or ""), text(pI2)[:60])
        ctl("/mail", {"quota": 100})
        ctl("/words", {"name": "Open right away", "text": "no"})
        ctxI.close(); ctxI2.close()

        ctl("/words", {"name": "Sign-ups", "text": "closed"})
        ctxC, pC = device("phone at a closed door")
        pC.goto(PAGE); pC.wait_for_timeout(400)
        rows_before, mail_before = len(dump()["rows"]), len(mails())
        join(pC, "shut@example.com")
        check("with Sign-ups closed, the door says it could not load", until(lambda: said(pC) == FAILED, 6) and at_door(pC), said(pC))
        check("closed: no row, no email", len(dump()["rows"]) == rows_before and len(mails()) == mail_before)
        pX2ctx, pX2 = device("second man again")
        pX2.goto(PAGE + "?k=" + K2)
        until(lambda: pX2.locator("#suWho").count() == 1 or pX2.locator(".adds").count() == 1, 8)
        pX2.select_option('select[data-add="kata"]', "Jion"); pX2.wait_for_timeout(120)
        pX2.locator('[data-act="begin"]').click()
        check("closed: a man who is already in still opens his link and saves", until(lambda: (row(K2) or {}).get("lines") == 1, 8), row(K2))
        ctl("/words", {"name": "Sign-ups", "text": "open"})
        pC.locator("#jnGo").click()
        check("opened again, the same tap sends his link", until(lambda: said(pC) == CHECK, 6) and len(mail_to("shut@example.com")) == 1)
        ctxC.close(); ctxE.close(); pX2ctx.close()

        # ------------------------------------------------------------------ the door at every width
        worst = []
        for wd, ht in [(280, 600), (320, 568), (360, 740), (390, 844), (430, 932), (520, 800), (768, 900), (1024, 768), (1366, 900)]:
            ctxW, pW = device("width %d" % wd, wd, ht)
            pW.goto(PAGE + "?k=kw_nope"); pW.wait_for_timeout(350)          # with the not-active line showing, the fullest the door gets
            pW.fill("#jnEmail", "nobody"); pW.locator("#jnGo").click(); pW.wait_for_timeout(150)
            g = pW.evaluate("""() => {
                const vw = document.documentElement.clientWidth, out = {vw: vw, scroll: document.documentElement.scrollWidth, items: []};
                for (const sel of ['#brand', '#tag', '#jnNote', '.intro', 'label[for=jnEmail]', '#jnEmail', '#jnMsg', '#jnGo', '.fine', 'footer a']) {
                    const e = document.querySelector(sel); if (!e) { out.items.push([sel, 'missing']); continue; }
                    const r = e.getBoundingClientRect();
                    out.items.push([sel, Math.round(r.left), Math.round(r.right), Math.round(r.height), r.left >= -0.5 && r.right <= vw + 0.5 && r.width > 0 && r.height > 0]);
                }
                const b = document.querySelector('#jnGo').getBoundingClientRect(), i = document.querySelector('#jnEmail').getBoundingClientRect();
                out.tap = Math.min(b.height, i.height);
                document.querySelector('#jnGo').scrollIntoView({block: 'center'});
                const b2 = document.querySelector('#jnGo').getBoundingClientRect();
                const top = document.elementFromPoint(b2.left + b2.width / 2, b2.top + b2.height / 2);
                out.clear = top === document.querySelector('#jnGo');
                return out; }""")
            ok = g["scroll"] <= g["vw"] and all(it[-1] is True for it in g["items"]) and g["tap"] >= 44 and g["clear"]
            if not ok: worst.append((wd, g))
            if wd in (320, 390): pW.screenshot(path=str(shots / ("site-00d-door-%d.png" % wd)), full_page=True)
            ctxW.close()
        check("at every width from 280 to 1366 the door fits: nothing runs off the side, nothing covers the button, both controls are 44 high or more", not worst, worst[:1])

        # ------------------------------------------------------------------ how the door talks
        d = dump()
        check("the door never causes a preflight", all(e["m"] != "OPTIONS" for e in d["log"]), [e for e in d["log"] if e["m"] == "OPTIONS"])
        check("every request from the door is a plain-text POST from the site", all(e.get("ct", "").startswith("text/plain") and e.get("origin") == "http://localhost:8790" for e in d["log"] if e["m"] == "POST" and not e.get("down")) and len([e for e in d["log"] if e["m"] == "POST" and not e.get("down")]) > 25, {(e.get("ct"), e.get("origin")) for e in d["log"]})
        check("a sign-up sends his email and nothing else about him", all(e["keys"] == "a,e" for e in d["log"] if e.get("a") == "join") and len([e for e in d["log"] if e.get("a") == "join"]) >= 14, {e["keys"] for e in d["log"] if e.get("a") == "join"})
        alive = {x["email"]: x["code"] for x in d["rows"]}
        check("every email went to the address typed, with the link of that address's own row and no other", all((mm["to"] not in alive and mm["to"] == "john.smith@example.com") or mm["body"].count(LINK + alive[mm["to"]]) == 1 for mm in d["mail"]) and all(mm["body"].count("kw_") == 1 for mm in d["mail"]) and len(d["mail"]) == 10, [(mm["to"], mm["body"][-12:]) for mm in d["mail"]])
        check("only one answer in all of this carried a code: the new man's, with Open right away on", sum(1 for e in d["log"] if "kw_" in (e.get("said") or "") and e.get("a") == "join") == 2 and all(e["e"] in ("quick.man@example.com", "dry@example.com") for e in d["log"] if e.get("a") == "join" and "kw_" in (e.get("said") or "")), [(e.get("e"), e.get("said")) for e in d["log"] if e.get("a") == "join" and "kw_" in (e.get("said") or "")])
        check("one row per email", len({x["email"] for x in d["rows"]}) == len(d["rows"]), [x["email"] for x in d["rows"]])
        check("nothing written to the sheet could be read as a formula", d["hazards"] == [], d["hazards"])
        check("the only faults the backend noted were the two times the email had run out", len(d["errors"]) == 2 and all("link email not sent" in e for e in d["errors"]) and d["locks"] == 0 and d["unflushed"] == 0, (d["errors"], d["unflushed"]))
        ctx0.close()
        ctl("/reset", {})

        # ================================================================== LINKS FROM A CHECKOUT (kept, in case the tracker is ever sold)
        A, B, C, D, U = code("A"), code("B"), code("C"), code("D"), code("U")
        ctx1, d1 = device("phone")
        pump[0] = d1
        d1.goto(PAGE + "?k=" + U)
        check("a made-up checkout link: the door, with the line saying it is not active", until(lambda: at_door(d1) and note(d1) == "This link is not active", 8), text(d1)[:80])
        check("a made-up checkout link: Stripe was asked once and no row was made", dump()["stripeCalls"] == 1 and len(dump()["rows"]) == 0, dump()["stripeCalls"])
        d1.reload()
        check("opening it again asks the backend again, and Stripe is not asked twice", until(lambda: at_door(d1) and note(d1) == "This link is not active" and len(dump()["log"]) == 2, 8) and dump()["stripeCalls"] == 1, (note(d1), dump()["stripeCalls"], len(dump()["log"])))
        ctl("/stripe", {"id": code("N"), "status": "complete", "payment_status": "unpaid"})
        d1.goto(PAGE + "?k=" + code("N"))
        check("a checkout that was never paid is not let in", until(lambda: at_door(d1) and note(d1) == "This link is not active", 8), text(d1)[:80])
        asked = len(dump()["log"])
        d1.goto(PAGE + "?k=cs_test_%3Cscript%3E")
        d1.wait_for_timeout(500)
        check("a malformed checkout code never reaches the backend", at_door(d1) and note(d1) == "This link is not active" and len(dump()["log"]) == asked, (note(d1), len(dump()["log"])))

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
        check("a first visit with the backend unreachable keeps trying before it says so", until(lambda: text(d3) == "COULD NOT LOAD", 15) and len([e for e in dump()["log"] if e.get("down")]) >= 3, (text(d3), len([e for e in dump()["log"] if e.get("down")])))
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
        check("the backend raised no errors, left no lock held, and never let a lock go with a write still waiting", d["errors"] == [] and d["locks"] == 0 and d["unflushed"] == 0, (d["errors"], d["locks"], d["unflushed"]))
        check("the page talks only to its own site, the backend, and the font host", hosts <= {"localhost:8790", "localhost:8787", "127.0.0.1:8788", "fonts.googleapis.com", "fonts.gstatic.com"}, hosts)

        head = d1.evaluate("() => ({robots: document.querySelector('meta[name=robots]').content, ref: document.querySelector('meta[name=referrer]').content, title: document.title, app: document.querySelector('meta[name=\"apple-mobile-web-app-title\"]').content, icon: document.querySelector('link[rel=\"apple-touch-icon\"]').href, sw: 'serviceWorker' in navigator ? 'present' : 'absent'})")
        icon = opener.open(head["icon"], timeout=10)
        regs = d1.evaluate("navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then(r => r.length) : 0")
        check("the page asks not to be indexed and sends no referrer", head["robots"] == "noindex,nofollow" and head["ref"] == "no-referrer", head)
        check("it has a Home Screen name and icon", head["app"] == "Kata Warrior" and icon.status == 200 and icon.headers["Content-Type"] == "image/png", head)
        check("no service worker is registered", regs == 0, regs)
        src = (site / "tracker.html").read_text()
        check("no key of any kind is in the page", not re.search(r"\b(rk|sk|pk)_(test|live)_", src) and "Bearer" not in src and "password" not in src.lower())
        api_file = here.parent / "backend" / "API_URL.txt"
        real = here / "out" / "tracker.html"
        if api_file.exists() and real.exists():
            api = api_file.read_text().strip()
            check("the page built for the site is this tested page, with only the backend's address changed", real.read_text() == src.replace(FAKE, api) and src.count(FAKE) == 1 and api.startswith("https://script.google.com/macros/s/") and api.endswith("/exec"), (len(real.read_text()), len(src)))
        browser.close()
finally:
    server.terminate()

print("console errors:", errors if errors else "none")
print(passes, "passed;", "FAILED: " + str(fails) if fails else "ALL PASSED")
sys.exit(1 if (fails or errors) else 0)
