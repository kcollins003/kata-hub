#!/usr/bin/env python3
"""The privacy page, and the two links to it: the home page's foot and the tracker's door.

    python3 test_privacy.py <folder>     # a checkout of the branch about to be published: it holds index.html,
                                         # privacy.html, tracker.html and tracker-icon.png
    python3 test_privacy.py              # the same four files as they stand on origin/main

Serves a throwaway copy of those files from this machine. Nothing outside it is reached: the font request is
answered from local files (../shelved/fonts, not in the repo) and every request to the backend is turned away.
The words of the page are written out below, line for line. A change to the page is a change to that list.
"""
import http.server, pathlib, re, shutil, socketserver, subprocess, sys, threading
from playwright.sync_api import sync_playwright

here = pathlib.Path(__file__).resolve().parent
root = here.parent
site = here / "out-site"
shots = here / "shots"
PORT = 8798
FILES = ("index.html", "privacy.html", "tracker.html", "tracker-icon.png")
fails, passes = [], 0

def check(name, cond, detail=""):
    global passes
    print(("PASS " if cond else "FAIL ") + name + (("  -> " + str(detail)[:400]) if (detail != "" and not cond) else ""), flush=True)
    if cond: passes += 1
    else: fails.append(name)

# ---------------------------------------------------------------- a throwaway copy of the site
if site.exists(): shutil.rmtree(site)
(site / "_fonts").mkdir(parents=True); shots.mkdir(exist_ok=True)
if len(sys.argv) > 1:
    src = pathlib.Path(sys.argv[1]).resolve()
    for f in FILES: shutil.copy(src / f, site / f)
    print("the site files are from", src, flush=True)
else:
    for f in FILES: (site / f).write_bytes(subprocess.run(["git", "-C", str(here), "show", "origin/main:" + f], check=True, capture_output=True).stdout)
    print("the site files are from origin/main", flush=True)
for f in ("Cinzel-Regular.ttf", "Cinzel-Bold.ttf", "Cinzel-Black.ttf"):
    shutil.copy(root / "shelved" / "fonts" / f, site / "_fonts" / f)
FACES = "".join("@font-face{font-family:'Cinzel';font-weight:%d;src:url('http://localhost:%d/_fonts/Cinzel-%s.ttf')}" % (w, PORT, n)
                for w, n in ((400, "Regular"), (600, "Bold"), (900, "Black")))

class Quiet(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(site), **k)
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.TCPServer(("127.0.0.1", PORT), Quiet)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = "http://localhost:%d/" % PORT
UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1"

# the page's words, exactly. Kevin's own lines are marked.
WORDS = [
    "Privacy",
    "Effective October 5, 2026",
    "The Kata Warrior Tracker is run by me, Kevin Collins, as Kata Warrior LLC.",
    "What I keep",
    "Your email address.",
    "The name you type into your tracker.",
    "Your challenge, and every rep you log with its date and time.",
    "Your private link.",
    "When you signed up, when your tracker last saved, how many times it has saved, and when your link was emailed.",
    "Where it is kept",
    "In a Google Sheet that only I can open.",
    "On your phone, in the browser, so your tracker opens next time.",
    "Resend, the service that delivers the link email, gets your address and that email. It keeps a copy for 30 days.",
    "What I use it for",
    "To email you your link.",
    "To keep your challenge tracker live.",                                                                        # Kevin's
    "I'm not planning on sending any other emails yet. I'll wait until I have something to share, like kata tutorials.",   # Kevin's, tightened
    "I won't sell your info. Definitely not.",                                                                     # Kevin's
    "What is not here",
    "No ads. No trackers. No cookies. The link email has no tracking in it. This site does not follow you to other sites, so there is nothing for a browser's Do Not Track signal to switch off.",
    "The pages are served by GitHub. The lettering comes from Google, and your tracker saves to Google. Each sees your internet address when a page loads or your tracker saves, as any website's host does, and may keep its own record of it.",
    "Your link is your key",
    "There is no password. Anyone with your link can open your tracker and change it. If your link gets out, email me and I will delete the tracker. You can start a new one at katawarrior.com/tracker.html?new.",
    "To fix it or delete it",
    "Email kevin@katawarrior.com from the address you signed up with. I will correct it or delete it. The copy on your phone stays until you clear this site's data in your browser.",
    "If this page changes",
    "I will change the date at the top.",
]

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    errors, hosts, turned_away = [], set(), []

    def device(name, width=390, height=844, mobile=True):
        ctx = browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=2, is_mobile=mobile, has_touch=mobile, user_agent=UA)
        ctx.route("**/fonts.googleapis.com/**", lambda r: r.fulfill(status=200, content_type="text/css", body=FACES))
        ctx.route("**/fonts.gstatic.com/**", lambda r: r.abort())
        def away(r): turned_away.append(r.request.url.split("/")[2]); r.abort()
        ctx.route("**/script.google.com/**", away)
        ctx.route("**/script.googleusercontent.com/**", away)
        page = ctx.new_page()
        page.on("request", lambda q: hosts.add(q.url.split("/")[2]))
        page.on("pageerror", lambda e: errors.append(name + " PAGEERROR " + str(e)))
        page.on("console", lambda m: errors.append(name + " " + m.text) if m.type == "error" and "net::" not in m.text and "Failed to load resource" not in m.text and "Failed to fetch" not in m.text else None)
        return ctx, page
    def sideways(page): return page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
    def overlap(page, sel):
        return page.evaluate("""(sel) => { const b = [...document.querySelectorAll(sel)].map(e => e.getBoundingClientRect()); const out = [];
            for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) { const x = Math.min(b[i].right, b[j].right) - Math.max(b[i].left, b[j].left), y = Math.min(b[i].bottom, b[j].bottom) - Math.max(b[i].top, b[j].top); if (x > 0.5 && y > 0.5) out.push([i, j]); }
            return out; }""", sel)

    # ================================================================ the privacy page
    ctx, p = device("privacy page")
    r = p.goto(BASE + "privacy.html")
    check("the privacy page loads", r.status == 200, r.status)
    seen = p.evaluate("() => [...document.querySelectorAll('main h1, main h2, main p, main li')].map(e => e.innerText.replace(/\\s+/g, ' ').trim())")
    seen = [("Effective October 5, 2026" if s.upper() == "EFFECTIVE OCTOBER 5, 2026" else s) for s in seen]
    heads = p.evaluate("() => [...document.querySelectorAll('main h1, main h2')].map(e => e.textContent.trim())")
    plain = [re.sub(r"\s+", " ", s) for s in p.evaluate("() => [...document.querySelectorAll('main h1, main h2, main p, main li')].map(e => e.textContent.trim())")]
    check("it says exactly the agreed words, in order, and nothing else", plain == WORDS, [a for a in plain if a not in WORDS] + ["MISSING: " + w for w in WORDS if w not in plain])
    check("the page is headed Privacy, and its tab says so too", heads[0] == "Privacy" and p.title() == "Kata Warrior — Privacy", (heads[:1], p.title()))
    check("it has an effective date", p.inner_text(".date").strip().upper() == "EFFECTIVE OCTOBER 5, 2026", p.inner_text(".date"))
    check("Kevin's own lines are on it, word for word", all(w in plain for w in ["To keep your challenge tracker live.", "I won't sell your info. Definitely not.", "I'm not planning on sending any other emails yet. I'll wait until I have something to share, like kata tutorials."]))
    check("it makes no promise he did not make: nothing about stopping emails, nothing about emailing everyone", not any(x in p.inner_text("main").lower() for x in ("how to stop", "unsubscribe", "email everyone", "not named on this page")))
    check("the line he replaced is gone", not any("keep your count" in w.lower() for w in plain))
    check("nothing in it is still in square brackets", "[" not in p.inner_text("main") and "]" not in p.inner_text("main"))
    check("it runs no script at all", p.evaluate("document.scripts.length") == 0)
    check("it sets no cookie and keeps nothing in the browser", p.evaluate("document.cookie") == "" and p.evaluate("localStorage.length + sessionStorage.length") == 0)
    check("the address to write to is a link that opens an email", p.get_attribute('main a[href^="mailto:"]', "href") == "mailto:kevin@katawarrior.com" and p.inner_text('main a[href^="mailto:"]') == "kevin@katawarrior.com")
    links = p.evaluate("() => [...document.querySelectorAll('a')].map(a => [a.textContent.trim(), a.getAttribute('href')])")
    check("its links are home, the door, the address, home and the tracker, and nothing else", links == [["KATA WARRIOR", "./"], ["katawarrior.com/tracker.html?new", "tracker.html?new"], ["kevin@katawarrior.com", "mailto:kevin@katawarrior.com"], ["katawarrior.com", "./"], ["Tracker", "tracker.html"]], links)
    size = p.evaluate("() => [...document.querySelectorAll('main p:not(.date), main li')].map(e => parseFloat(getComputedStyle(e).fontSize))")
    check("every line of the words is sixteen points or more: readable on a phone without pinching", len(size) == 18 and min(size) >= 16, size)
    def lum(c):
        v = [int(x) / 255 for x in re.findall(r"\d+", c)[:3]]; v = [x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4 for x in v]
        return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
    def contrast(sel):
        fg, bg = p.evaluate("(s) => [getComputedStyle(document.querySelector(s)).color, getComputedStyle(document.body).backgroundColor]", sel)
        a, b = sorted([lum(fg), lum(bg)], reverse=True); return (a + 0.05) / (b + 0.05)
    cs = {s: round(contrast(s), 1) for s in ("main p.lead", "main li", "main h2", "main h1", ".date", "main a")}
    check("every line of it stands well clear of the background (4.5 to 1 or better)", min(cs.values()) >= 4.5, cs)
    check("the brand is in Cinzel, as on the home page", "Cinzel" in p.evaluate("getComputedStyle(document.querySelector('.brand')).fontFamily") and p.evaluate("document.fonts.check(\"900 26px Cinzel\")"))
    check("no word the project rules out", not re.search(r"\b(gi|dojo)\b", p.inner_text("body"), re.I))
    p.screenshot(path=str(shots / "privacy-390.png"), full_page=True)
    ctx.close()

    worst, split = [], []
    for wd, ht, mob in [(280, 600, True), (320, 568, True), (360, 740, True), (375, 667, True), (390, 844, True), (430, 932, True), (520, 800, True), (768, 900, False), (1024, 768, False), (1366, 900, False)]:
        ctxW, pW = device("privacy %d" % wd, wd, ht, mob)
        pW.goto(BASE + "privacy.html"); pW.wait_for_timeout(150)
        over = sideways(pW)
        cut = pW.evaluate("() => [...document.querySelectorAll('main *, footer a, .brand')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.left < -0.5 || r.right > document.documentElement.clientWidth + 0.5); }).map(e => e.tagName + ':' + e.textContent.trim().slice(0, 30))")
        if over > 0 or cut or overlap(pW, "footer a"): worst.append((wd, over, cut[:3], overlap(pW, "footer a")))
        b = pW.evaluate("() => { const e = document.querySelector('.brand'); return [e.getBoundingClientRect().height, parseFloat(getComputedStyle(e).fontSize)]; }")
        if wd >= 320 and b[0] > b[1] * 1.5: split.append((wd, b))
        if wd == 320: pW.screenshot(path=str(shots / "privacy-320.png"), full_page=True)
        ctxW.close()
    check("at ten widths, 280 to 1366: nothing runs off the side and nothing overlaps", worst == [], worst)
    check("from 320 up, KATA WARRIOR stays on one line, as on the tracker page", split == [], split)

    # ================================================================ the home page's foot
    ctx, h = device("home page")
    r = h.goto(BASE + "index.html"); h.wait_for_timeout(600)
    check("the home page loads", r.status == 200)
    foot = h.evaluate("() => [...document.querySelectorAll('footer a')].map(a => [a.textContent.trim(), a.getAttribute('href')])")
    check("its foot now ends with a link that has the word privacy in it", len(foot) == 5 and foot[-1][1] == "privacy.html" and "privacy" in foot[-1][0].lower(), foot)
    check("and the links that were there are as they were, in the same order", foot[:-1] == [["TikTok", "https://tiktok.com/@kata.warrior"], ["YouTube", "https://youtube.com/@KataWarrior"], ["Instagram", "https://instagram.com/KataWarrior"], ["Tracker", "tracker.html"]], foot)
    check("there is no Donate link", not any("donate" in (a[0] + a[1]).lower() for a in foot))
    worstH = []
    for wd in (280, 320, 360, 375, 390, 430, 520, 768, 1366):
        h.set_viewport_size({"width": wd, "height": 800}); h.wait_for_timeout(120)
        if sideways(h) > 0 or overlap(h, "footer a"): worstH.append((wd, sideways(h), overlap(h, "footer a")))
    check("at nine widths the foot's five links neither overlap nor push the page sideways", worstH == [], worstH)
    for wd in (375, 440, 390):
        h.set_viewport_size({"width": wd, "height": 844}); h.wait_for_timeout(120)
        h.locator("footer").scroll_into_view_if_needed(); h.wait_for_timeout(200)
        h.locator("footer").screenshot(path=str(shots / ("home-foot-%d.png" % wd)))
    h.locator('footer a[href="privacy.html"]').click(); h.wait_for_load_state("domcontentloaded")
    check("tapping it opens the privacy page", h.url == BASE + "privacy.html" and h.inner_text("main h1").strip() == "Privacy", h.url)
    h.locator('footer a[href="./"]').click(); h.wait_for_load_state("domcontentloaded")
    check("and the privacy page's foot leads back home", h.url == BASE and h.locator("footer a").count() == 5, h.url)
    check("the home page's own request for the count was turned away, not sent", len(turned_away) >= 1 and set(turned_away) <= {"script.google.com", "script.googleusercontent.com"}, turned_away[:3])
    ctx.close()

    # ================================================================ the tracker's door
    ctx, d = device("tracker door")
    asked_before = len(turned_away)
    d.goto(BASE + "tracker.html"); d.wait_for_timeout(500)
    check("the door shows", d.locator("#jnEmail").count() == 1 and d.locator("#jnGo").count() == 1)
    a = d.locator(".fine.pv a")
    check("under the button and its line there is a link with the word privacy in it", a.count() == 1 and "privacy" in a.inner_text().strip().lower() and a.get_attribute("href") == "privacy.html", a.count())
    if a.count() == 1:
        check("it opens beside the door, without handing the door over", a.get_attribute("target") == "_blank" and a.get_attribute("rel") == "noopener")
        box = a.bounding_box(); note = d.locator(".fine").first.bounding_box(); go = d.locator("#jnGo").bounding_box()
        check("it sits below the note, which sits below the button", go["y"] + go["height"] <= note["y"] and note["y"] + note["height"] <= box["y"] + 1, (go, note, box))
        check("it is big enough for a thumb (40 or more high, 60 or more wide)", box["height"] >= 40 and box["width"] >= 60, box)
        d.fill("#jnEmail", "typing@example.com")
        with ctx.expect_page() as pop:
            a.click()
        q = pop.value; q.wait_for_load_state("domcontentloaded")
        check("tapping it opens the privacy page in a new tab", q.url == BASE + "privacy.html" and q.inner_text("main h1").strip() == "Privacy", q.url)
        check("and what he had typed at the door is still there", d.input_value("#jnEmail") == "typing@example.com" and d.locator("#jnGo").count() == 1)
        check("the door asked the backend for nothing, and neither did opening the privacy page", len(turned_away) == asked_before, turned_away)
        q.locator('main a[href="tracker.html?new"]').click(); q.wait_for_load_state("domcontentloaded"); q.wait_for_timeout(400)
        check("the page's own link for starting a new one shows the door", q.url == BASE + "tracker.html?new" and q.locator("#jnEmail").count() == 1 and q.locator("#jnGo").count() == 1, q.url)
        q.evaluate("localStorage.setItem('kw.count.v1.code', 'kw_' + 'ab'.repeat(16))")
        q.goto(BASE + "tracker.html?new"); q.wait_for_timeout(400)
        check("and it shows the door on a phone that already has a tracker, leaving that tracker's link where it was", q.locator("#jnEmail").count() == 1 and q.evaluate("localStorage.getItem('kw.count.v1.code')") == "kw_" + "ab" * 16, q.url)
        check("still nothing asked of the backend", len(turned_away) == asked_before, turned_away)
    else:
        check("the door's link is there to be tried", False, "no link at the door")
    worstD = []
    for wd in (280, 320, 360, 390, 430, 768):
        d.set_viewport_size({"width": wd, "height": 800}); d.wait_for_timeout(120)
        if sideways(d) > 0: worstD.append((wd, sideways(d)))
    check("the door does not run off the side at six widths", worstD == [], worstD)
    d.set_viewport_size({"width": 390, "height": 844}); d.wait_for_timeout(150)
    d.fill("#jnEmail", "")
    d.screenshot(path=str(shots / "door-390.png"), full_page=True)
    ctx.close()

    check("no page raised an error", errors == [], errors[:4])
    check("the three pages reached only this site and the font host", hosts <= {"localhost:%d" % PORT, "fonts.googleapis.com", "fonts.gstatic.com", "script.google.com", "script.googleusercontent.com"}, hosts)
    browser.close()
srv.shutdown()
print(passes, "passed;", "FAILED: " + str(fails) if fails else "ALL PASSED")
sys.exit(1 if fails else 0)
