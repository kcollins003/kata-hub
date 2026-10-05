"""Nothing may sit on top of a control, at any width, and a click or tap anywhere in a number box must let him type.
Run after wrap.py."""
import pathlib, sys
from playwright.sync_api import sync_playwright

here = pathlib.Path(__file__).parent
url = (here / "out" / "local.html").resolve().as_uri()
shots = here / "shots"
fails, passes = [], 0

def check(name, cond, detail=""):
    global passes
    if cond: passes += 1
    else:
        fails.append(name); print("FAIL", name, "->", detail)

HIT = """(sel) => [...document.querySelectorAll(sel)].map(e => {
    e.scrollIntoView({block: 'center'});
    const r = e.getBoundingClientRect(), out = [];
    for (const [fx, fy] of [[.5,.5],[.12,.5],[.88,.5],[.5,.2],[.5,.8]]) {
        const x = r.left + r.width * fx, y = r.top + r.height * fy, top = document.elementFromPoint(x, y);
        out.push(!!top && (top === e || e.contains(top) || top.contains(e) && top.matches('label.pick')));
    }
    return [e.id || e.className, out.every(Boolean), Math.round(r.width), Math.round(r.height), r.left >= 0 && r.right <= document.documentElement.clientWidth + 0.5];
})"""

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    for w, h, touch in [(280, 600, True), (320, 568, True), (360, 740, True), (390, 844, True), (414, 896, True), (440, 956, True),
                        (520, 800, False), (768, 900, False), (1024, 768, False), (1366, 900, False)]:
        tag = f"w{w}"
        ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=2, has_touch=touch, is_mobile=touch)
        page = ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        page.goto(url); page.evaluate("localStorage.clear()"); page.reload(); page.wait_for_timeout(250)
        page.select_option('select[data-add="kata"]', "Bassai"); page.wait_for_timeout(100)
        page.select_option('select[data-add="drill"]', "Side-thrust kicks"); page.wait_for_timeout(100)
        page.select_option('select[data-add="drill"]', "Knife-hand blocks"); page.wait_for_timeout(100)
        page.click('[data-act="addOther"]'); page.wait_for_timeout(100)
        page.keyboard.type("Kitchen laps")
        rows = page.locator(".it").count()
        check(f"{tag} four rows staged", rows == 4, rows)
        for sel in (".itt", ".itn", ".rm", ".pick", '[data-act="begin"]', "#suWho", ".lock"):
            for name, clear, bw, bh, inside in page.evaluate(HIT, sel):
                check(f"{tag} nothing sits on top of {sel} ({name})", clear, (bw, bh))
                check(f"{tag} {sel} stays inside the screen", inside, (bw, bh))
        sizes = page.evaluate("() => [...document.querySelectorAll('.itt')].map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })")
        check(f"{tag} every number box is a full-size target", all(a >= 88 and b >= 44 for a, b in sizes), sizes)

        # a click or tap anywhere in the box, then keys: the number goes in
        for i, (fx, typed) in enumerate([(0.5, "1000"), (0.1, "9999"), (0.9, "2750"), (0.5, "1234")]):
            box = page.locator(f"#itt{i}")
            box.scroll_into_view_if_needed()
            bb = box.bounding_box()
            x, y = bb["x"] + bb["width"] * fx, bb["y"] + bb["height"] / 2
            if touch: page.touchscreen.tap(x, y)
            else: page.mouse.click(x, y)
            page.wait_for_timeout(80)
            focused = page.evaluate(f"document.activeElement && document.activeElement.id") == f"itt{i}"
            page.keyboard.type(typed, delay=25)
            live = page.input_value(f"#itt{i}")
            check(f"{tag} box {i + 1}: {'tap' if touch else 'click'} at {int(fx * 100)}% then type {typed}", focused and live == typed, (focused, live))
            if i == 0: page.screenshot(path=str(shots / f"{tag}-typing.png"))
        # a second tap in a box he is already typing in must not wipe it
        box = page.locator("#itt3"); bb = box.bounding_box()
        (page.touchscreen.tap if touch else page.mouse.click)(bb["x"] + bb["width"] * 0.95, bb["y"] + bb["height"] / 2)
        page.keyboard.type("5")
        check(f"{tag} a second tap in the box keeps what he typed", page.input_value("#itt3") == "12345", page.input_value("#itt3"))
        page.keyboard.press("Backspace"); page.keyboard.press("Backspace")
        check(f"{tag} backspace works like any text box", page.input_value("#itt3") == "123", page.input_value("#itt3"))
        # straight from one box to BEGIN, no stop in between
        page.locator('[data-act="begin"]').scroll_into_view_if_needed()
        bb = page.locator('[data-act="begin"]').bounding_box()
        (page.touchscreen.tap if touch else page.mouse.click)(bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2)
        page.wait_for_timeout(450)
        total = page.inner_text(".count .of").strip().upper() if page.locator(".count .of").count() else "(no count screen)"
        check(f"{tag} BEGIN straight from the last box carries every number", total == "OF 13,872", total)
        amts = page.evaluate("() => [...document.querySelectorAll('.row')].map(r => r.innerText.replace(/\\s+/g, ' ').trim())")
        check(f"{tag} each line shows on the count screen", len(amts) == 4, amts)
        page.screenshot(path=str(shots / f"{tag}-count.png"))

        # the same box inside a line's own screen
        page.locator(".row").first.click(); page.wait_for_timeout(450)
        for sel in ("#lnTarget", "#lnName"):
            for name, clear, bw, bh, inside in page.evaluate(HIT, sel):
                check(f"{tag} nothing sits on top of {sel}", clear, (bw, bh))
        bb = page.locator("#lnTarget").bounding_box()
        (page.touchscreen.tap if touch else page.mouse.click)(bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2)
        page.keyboard.type("4321", delay=25)
        check(f"{tag} line screen: type a four-digit number", page.input_value("#lnTarget") == "4321", page.input_value("#lnTarget"))
        if w in (280, 390, 1024): page.screenshot(path=str(shots / f"{tag}-line.png"))
        sv = page.locator('[data-act="saveLine"]'); sv.scroll_into_view_if_needed(); bb = sv.bounding_box()
        (page.touchscreen.tap if touch else page.mouse.click)(bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2)
        page.wait_for_timeout(450)
        total = page.inner_text(".count .of").strip().upper()
        check(f"{tag} line screen: SAVE keeps it", total == "OF 17,193", total)
        check(f"{tag} no page errors", not errs, errs)
        ctx.close()
    browser.close()

print(passes, "passed;", "ALL PASSED" if not fails else "FAILED: " + str(fails))
sys.exit(1 if fails else 0)
