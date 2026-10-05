#!/usr/bin/env python3
"""Drive the tracker the way a buyer would: build a challenge, log, edit, finish. Check the numbers, take screenshots."""
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

here = pathlib.Path(__file__).parent
url = (here / "out" / "local.html").resolve().as_uri()
shots = here / "shots"
shots.mkdir(exist_ok=True)
for f in shots.glob("p[0-9]*.png"):
    f.unlink()

fails, errors = [], []
EM = chr(0x2014)

def twenty():
    """A count with twenty lines and 1,560 logged, the shape of Kevin's own: two forms done, two under way."""
    names = ['Bassai','Empi','Gankaku','Hangetsu','Heian Godan','Heian Nidan','Heian Sandan','Heian Shodan','Heian Yodan','Jion','Jitte','Kwanku','Naifanchi No Sai','Nicho Sai','Sakagawa','Sanchin','Sancho Sai','Tekki Nidan','Tekki Sandan','Tekki Shodan']
    lines = [{"id": "L%02d" % i, "name": n, "target": 500, "kind": "kata"} for i, n in enumerate(names)]
    log, t = [], 1790000000000
    for name, total in (("Heian Shodan", 500), ("Tekki Sandan", 500), ("Heian Nidan", 400), ("Naifanchi No Sai", 160)):
        lid = next(l["id"] for l in lines if l["name"] == name)
        for _ in range(total // 20):
            t += 3600000
            log.append({"id": "e%d" % t, "l": lid, "r": 20, "d": "2026-09-01", "t": t})
    return {"v": 2, "s": {"v": 1, "who": "John Smith", "lines": lines, "log": log, "ui": {"kept": 1}}}


def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + (("  -> " + str(detail)) if (detail != "" and not cond) else ""))
    if not cond:
        fails.append(name)


def run(pw, w, h, tag, full_suite):
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=2,
                              is_mobile=True, has_touch=True,
                              user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1")
    page = ctx.new_page()
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append("PAGEERROR " + str(e)))
    calls = []                                   # the tracker must not call out anywhere but the font host
    page.route("**/*", lambda r: (calls.append(r.request.url), r.continue_())[1] if r.request.url.startswith("file:") else (calls.append(r.request.url), r.abort())[1])

    def shot(name, full=False):
        page.wait_for_timeout(350)
        page.screenshot(path=str(shots / f"{tag}-{name}.png"), full_page=full)

    def no_sideways(name):
        over = page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
        check(f"{tag} no sideways scroll: {name}", over <= 0, over)

    def big():
        page.wait_for_timeout(1500)
        return page.inner_text("#bigN")

    def tap(sel):
        page.locator(sel).first.click()

    def pick(kind, value):
        page.select_option(f'select[data-add="{kind}"]', value)
        page.wait_for_timeout(120)

    def up(sel):
        return page.inner_text(sel).strip().upper()

    def staged():
        return page.evaluate("""() => [...document.querySelectorAll('.it')].map(r => {
            const t = r.querySelector('.itn'), s = r.querySelector('.itname');
            const n = r.querySelector('.itt');
            return [r.querySelector('.idx').textContent.trim(), t ? t.value : s.textContent.trim(), n.value !== '' ? n.value : n.dataset.val, !!t]; })""")

    def held(sel):
        return page.evaluate("(q) => { const e = document.querySelector(q); return [e.value, e.dataset.val, e.placeholder]; }", sel)

    def away():
        page.locator(".intro").click(); page.wait_for_timeout(60)

    def rows():
        return page.evaluate("""() => [...document.querySelectorAll('.row[data-act="line"]')].map(r => r.querySelector('b').textContent.trim())""")

    def saved():
        rec = page.evaluate("JSON.parse(localStorage.getItem('kw.count.v1') || 'null')")
        return rec["s"] if rec and "s" in rec else rec

    def seed(rec):
        page.evaluate("(r) => localStorage.setItem('kw.count.v1', JSON.stringify(r))", rec)
        page.reload(); page.wait_for_timeout(300)

    def log(n, label=None):
        tap('[data-act="log"]'); page.wait_for_timeout(350)
        if label:
            page.select_option("#lgForm", label=label)
        page.fill("#lgReps", str(n)); tap('[data-act="doLog"]')
        page.wait_for_timeout(250)

    page.goto(url)
    page.evaluate("localStorage.clear()")
    page.reload()
    page.wait_for_timeout(300)

    # ---------- the first screen ----------
    check(f"{tag} top line reads Customize your tracker", page.inner_text(".intro").strip() == "Customize your tracker", page.inner_text(".intro"))
    check(f"{tag} name box is labelled Warrior's Name", up('label[for="suWho"]') == "WARRIOR'S NAME", up('label[for="suWho"]'))
    check(f"{tag} section reads Build your challenge", up("#app .lab") == "BUILD YOUR CHALLENGE", up("#app .lab"))
    labels = [t.strip().upper() for t in page.locator(".adds .pick > span").all_inner_texts()]
    check(f"{tag} three buttons: add kata, add drills, add other", labels == ["ADD KATA", "ADD DRILLS", "ADD OTHER"], labels)
    kata_opts = page.locator('select[data-add="kata"] option').all_inner_texts()
    drill_opts = page.locator('select[data-add="drill"] option').all_inner_texts()
    check(f"{tag} kata menu: the twenty, all twenty by name, then Other", kata_opts[0] == "Add kata" and kata_opts[1] == "The Twenty" and len(kata_opts) == 23 and kata_opts[2] == "Bassai" and kata_opts[21] == "Tekki Shodan" and kata_opts[-1] == "Other", kata_opts)
    basics = ["Front punches", "Reverse punches", "Jabs", "Back-fist strikes", "Downward blocks", "Rising blocks", "Forearm blocks", "Hammer blocks", "Knife-hand blocks",
              "Front kicks", "Side-up kicks", "Side-thrust kicks", "Round kicks", "Rear kicks", "Crescent kicks", "Stamping kicks"]
    check(f"{tag} drills menu: the sixteen basics, then Other", drill_opts == ["Add drills"] + basics + ["Other"], drill_opts)
    check(f"{tag} log button hidden before he begins", page.locator("#dock").is_hidden())
    check(f"{tag} no name shows before one is typed", page.locator("#who").is_hidden())
    links = page.eval_on_selector_all("a[href]", "els => els.map(a => [a.getAttribute('href'), a.textContent.trim().toLowerCase(), a.target, a.rel])")
    check(f"{tag} the only link out is katawarrior.com, at the bottom", links == [["https://katawarrior.com", "katawarrior.com", "_blank", "noopener"]] and page.locator("footer a").count() == 1, links)
    no_sideways("first screen, empty")
    shot("01-first-screen")

    tap('[data-act="lockWho"]')
    check(f"{tag} an empty name cannot be locked in", page.locator("#suWho.bad").count() == 1)
    page.fill("#suWho", "John Smith")
    check(f"{tag} name appears under the masthead as he types", page.locator("#who").is_visible() and up("#who") == "JOHN SMITH", up("#who"))
    shot("01b-name-typed")
    tap('[data-act="lockWho"]')
    check(f"{tag} locking the name puts its label and box away and leaves it at the top", page.locator("#suWho").count() == 0 and page.locator('label[for="suWho"]').count() == 0 and up("#who") == "JOHN SMITH")
    check(f"{tag} the locked name is saved", saved()["who"] == "John Smith", saved())
    shot("01c-name-locked")
    tap("#who")
    check(f"{tag} tapping the name brings its box back, filled in", page.input_value("#suWho") == "John Smith" and page.evaluate("document.activeElement && document.activeElement.id") == "suWho")
    page.fill("#suWho", "John Smith")
    page.press("#suWho", "Enter")
    check(f"{tag} the Enter key locks the name in too", page.locator("#suWho").count() == 0 and up("#who") == "JOHN SMITH")

    tap('[data-act="begin"]')
    check(f"{tag} BEGIN with nothing added stays put and points at the buttons", page.locator("#bigN").count() == 0 and page.locator(".adds.nudge").count() == 1)

    # ---------- build a challenge ----------
    pick("kata", "Heian Shodan")
    check(f"{tag} picking a kata adds it with 500", staged() == [["1", "Heian Shodan", "500", False]], staged())
    check(f"{tag} the kata button goes back to its label", page.input_value('select[data-add="kata"]') == "")
    check(f"{tag} total reads OF 500", up("#suTotal") == "OF 500", up("#suTotal"))
    check(f"{tag} the number box starts empty, showing 500", held("#itt0") == ["", "500", "500"], held("#itt0"))
    page.evaluate("""() => { const e = document.querySelector('#itt0'); const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        window.__box = e; window.__writes = 0;
        Object.defineProperty(e, 'value', { get() { return d.get.call(this); }, set(v) { window.__writes++; d.set.call(this, v); }, configurable: true }); }""")
    page.locator("#itt0").click(); page.wait_for_timeout(400); y0 = page.evaluate("window.scrollY")
    page.keyboard.type("3141", delay=40)
    quiet = page.evaluate("() => [window.__writes, document.querySelector('#itt0') === window.__box, document.activeElement === window.__box, window.__box.value]")
    check(f"{tag} while he types, the page leaves the number box alone", quiet == [0, True, True, "3141"] and page.evaluate("window.scrollY") == y0, (quiet, y0, page.evaluate("window.scrollY")))
    away()
    check(f"{tag} the box is written once, when he leaves it", page.evaluate("window.__writes") == 1 and held("#itt0") == ["", "3141", "3141"], (page.evaluate("window.__writes"), held("#itt0")))
    page.evaluate("() => { delete window.__box.value; }")
    shown = page.evaluate("() => { const e = document.querySelector('#itt0'); const c = getComputedStyle(e, '::placeholder'); return [c.color, c.opacity, c.fontFamily.indexOf('Cinzel') >= 0]; }")
    check(f"{tag} the held number is drawn like a real number, not greyed out", shown == ["rgb(242, 237, 229)", "1", True], shown)
    page.locator("#itt0").click(); page.keyboard.type("500"); away()
    for typed in ("1000", "9999", "2750"):
        page.locator("#itt0").click(); page.keyboard.type(typed)
        check(f"{tag} typing {typed} into the number box shows exactly {typed}", page.input_value("#itt0") == typed and up("#suTotal") == "OF " + format(int(typed), ","), (page.input_value("#itt0"), up("#suTotal")))
        away()
        check(f"{tag} after leaving the box it holds {typed} and is empty for the next number", held("#itt0") == ["", typed, typed] and up("#suTotal") == "OF " + format(int(typed), ","), held("#itt0"))
    page.locator("#itt0").click(); page.keyboard.type("12ab3")
    check(f"{tag} the number box takes digits only", page.input_value("#itt0") == "123", page.input_value("#itt0"))
    page.keyboard.type("4567")
    check(f"{tag} the number box stops at five digits", page.input_value("#itt0") == "12345", page.input_value("#itt0"))
    away()
    page.locator("#itt0").click(); away()
    check(f"{tag} tapping in and out without typing keeps the number", held("#itt0") == ["", "12345", "12345"], held("#itt0"))
    page.locator("#itt0").click(); page.keyboard.type("0"); away()
    check(f"{tag} zero is not a number to count to", held("#itt0") == ["", "12345", "12345"], held("#itt0"))
    page.locator("#itt0").click(); page.keyboard.type("500"); page.keyboard.press("Enter"); page.wait_for_timeout(60)
    check(f"{tag} the return key sets the number", held("#itt0") == ["", "500", "500"] and up("#suTotal") == "OF 500", held("#itt0"))
    check(f"{tag} the number box asks for the number pad", page.get_attribute("#itt0", "inputmode") == "numeric" and page.get_attribute("#itt0", "type") == "text")
    pick("drill", "Front punches")
    check(f"{tag} picking a drill adds it", staged()[1] == ["2", "Front punches", "500", False], staged())
    pick("kata", "__other")
    check(f"{tag} Other in the kata menu gives a box to type a form", len(staged()) == 3 and staged()[2][3] and page.get_attribute("#itn2", "placeholder") == "Custom form", staged())
    check(f"{tag} that box has the cursor", page.evaluate("document.activeElement && document.activeElement.id") == "itn2")
    page.fill("#itn2", "Kitchen form")
    pick("drill", "__other")
    check(f"{tag} Other in the drills menu gives a box to type a drill", page.get_attribute("#itn3", "placeholder") == "Custom drill")
    page.fill("#itn3", "Slow kicks")
    tap('[data-act="addOther"]')
    check(f"{tag} Add other gives a box to type anything", page.get_attribute("#itn4", "placeholder") == "Custom item" and page.evaluate("document.activeElement && document.activeElement.id") == "itn4")
    page.fill("#itn4", "Push-ups")
    page.fill("#itt4", "100")
    check(f"{tag} each has its own number and the total follows", up("#suTotal") == "OF 2,100", up("#suTotal"))
    check(f"{tag} name stays at the top while he builds", page.locator("#suWho").count() == 0 and up("#who") == "JOHN SMITH")
    pick("kata", "Heian Shodan")
    check(f"{tag} the same kata is not added twice", len(staged()) == 5, staged())
    no_sideways("first screen, built")
    shot("02-built", full=True)

    page.locator('.it [data-act="rmItem"]').nth(3).click()
    check(f"{tag} a row can be removed and the rest renumber", staged() == [["1", "Heian Shodan", "500", False], ["2", "Front punches", "500", False], ["3", "Kitchen form", "500", True], ["4", "Push-ups", "100", True]], staged())
    check(f"{tag} total after removing reads OF 1,600", up("#suTotal") == "OF 1,600", up("#suTotal"))

    if not full_suite:
        tap('[data-act="begin"]')
        page.wait_for_timeout(1600)
        no_sideways("count screen")
        shot("03-count", full=True)
        tap('[data-act="log"]'); page.wait_for_timeout(400)
        shot("04-log")
        tap('[data-act="close"]'); page.wait_for_timeout(400)
        seed(twenty()); page.wait_for_timeout(1400)
        no_sideways("twenty lines")
        shot("05-twenty", full=True)
        browser.close()
        return

    tap('[data-act="addOther"]')
    tap('[data-act="begin"]')
    check("BEGIN refuses a row with no name", page.locator("#itn4.bad").count() == 1 and page.locator("#bigN").count() == 0)
    page.locator('.it [data-act="rmItem"]').nth(4).click()

    tap('[data-act="begin"]')
    check("BEGIN opens the count", page.locator("#bigN").count() == 1)
    check("count starts at 0", big() == "0", page.inner_text("#bigN"))
    check("his challenge is listed in the order he built it", rows() == ["Heian Shodan", "Front punches", "Kitchen form", "Push-ups"], rows())
    check("target is the sum: OF 1,600", "OF 1,600" in page.inner_text(".count .of"), page.inner_text(".count .of"))
    check("list heading reads The Four", up(".head span:first-child") == "THE FOUR", up(".head"))
    check("in training starts on his first line", "Heian Shodan" in page.inner_text(".pair .cell:first-child"))
    check("the count screen keeps In Training", up(".pair .cell:first-child .k") == "IN TRAINING")
    check("name shows under the masthead", up("#who") == "JOHN SMITH")
    tap("#who"); page.wait_for_timeout(350)
    check("tapping the name on the count screen opens its box in the menu", page.locator("#panel.open #mnWho").count() == 1 and page.input_value("#mnWho") == "John Smith")
    tap('[data-act="close"]'); page.wait_for_timeout(350)
    check("keep card shows after he begins", page.locator(".keep").count() == 1)
    check("each line remembers what kind it is", [l["kind"] for l in saved()["lines"]] == ["kata", "drill", "kata", "other"], saved()["lines"])
    check("the three add buttons sit under his list", page.locator("#app .adds.below .pick").count() == 3)
    no_sideways("count screen, fresh")
    shot("03-count-fresh", full=True)

    # ---------- log, undo, persistence ----------
    tap('[data-act="log"]'); page.wait_for_timeout(400)
    check("log panel opens with the form picker", page.locator("#panel.open select#lgForm").count() == 1)
    check("picker defaults to the line in training", page.locator("#lgForm option:checked").inner_text().strip() == "Heian Shodan")
    check("reps box has the cursor", page.evaluate("document.activeElement && document.activeElement.id") == "lgReps")
    shot("04-log-panel")
    tap('[data-act="doLog"]')
    check("empty reps says Enter reps", page.inner_text("#lgMsg") == "Enter reps", page.inner_text("#lgMsg"))
    page.fill("#lgReps", "20"); tap('[data-act="doLog"]'); page.wait_for_timeout(200)
    check("toast reads form, dash, total, logged", f"Heian Shodan {EM} 20 logged" in page.inner_text("#toast"), page.inner_text("#toast"))
    shot("05-after-log")
    check("count reads 20", big() == "20", page.inner_text("#bigN"))
    check("row reads 20 / 500", "20 / 500" in page.locator(".row .amt").first.inner_text())
    tap('[data-act="undo"]')
    check("undo takes it back to 0", big() == "0", page.inner_text("#bigN"))
    tap('[data-act="log"]'); page.wait_for_timeout(350)
    page.keyboard.type("12345")
    check("the reps box stops at four digits", page.input_value("#lgReps") == "1234", page.input_value("#lgReps"))
    page.fill("#lgReps", ""); page.locator("#lgReps").click(); page.keyboard.type("1000")
    check("typing 1000 into the reps box gives exactly 1000", page.input_value("#lgReps") == "1000", page.input_value("#lgReps"))
    page.keyboard.press("Enter"); page.wait_for_timeout(1300)
    page.locator(".donep .dnum").click(); page.wait_for_timeout(400)
    check("a four digit entry is logged", big() == "1,000" and "1,000 / 500" in page.locator(".row .amt").first.inner_text(), page.inner_text("#bigN"))
    tap('[data-act="log"]'); page.wait_for_timeout(350); tap('[data-act="close"]'); page.wait_for_timeout(350)
    page.locator('.row[data-act="line"]').first.click(); page.wait_for_timeout(350)
    tap('[data-act="rmEntry"]'); page.wait_for_timeout(300); tap('[data-act="close"]'); page.wait_for_timeout(350)
    check("and can be taken back out", big() == "0", page.inner_text("#bigN"))
    tap('[data-act="log"]'); page.fill("#lgReps", "35"); page.keyboard.press("Enter")
    check("enter key logs", big() == "35", page.inner_text("#bigN"))
    page.reload()
    check("count survives a reload", big() == "35", page.inner_text("#bigN"))
    check("name survives a reload", up("#who") == "JOHN SMITH")
    tap('[data-act="keepDone"]')
    check("keep card dismisses", page.locator(".keep").count() == 0)

    # ---------- add more after he has begun ----------
    pick("kata", "Tekki Shodan")
    check("a kata picked later joins his list at 500", rows()[-1] == "Tekki Shodan" and "OF 2,100" in page.inner_text(".count .of"), (rows(), page.inner_text(".count .of")))
    pick("kata", "Tekki Shodan")
    check("the same kata is not added twice later either", len(rows()) == 5, rows())
    pick("drill", "__other"); page.wait_for_timeout(350)
    check("Other in the drills menu opens a box for a drill", page.locator("#panel.open #lnName").count() == 1 and up(".ptop h2") == "ADD DRILLS" and up('label[for="lnName"]') == "DRILL" and page.get_attribute("#lnName", "placeholder") == "Custom drill", (up(".ptop h2"), up('label[for="lnName"]')))
    shot("06-add-drill-other")
    page.fill("#lnName", "Slow kicks")
    page.locator("#lnTarget").click(); page.keyboard.type("2500")
    check("typing 2500 into a line's number box gives exactly 2500", page.input_value("#lnTarget") == "2500", page.input_value("#lnTarget"))
    page.fill("#lnTarget", "50"); tap('[data-act="saveLine"]'); page.wait_for_timeout(400)
    check("the typed drill is added with its own number", rows()[-1] == "Slow kicks" and "OF 2,150" in page.inner_text(".count .of") and saved()["lines"][-1]["kind"] == "drill", rows())
    tap('[data-act="addOther"]'); page.wait_for_timeout(350)
    check("Add other opens a box for anything", up(".ptop h2") == "ADD OTHER" and up('label[for="lnName"]') == "OTHER" and page.get_attribute("#lnName", "placeholder") == "Custom item", (up(".ptop h2"), up('label[for="lnName"]')))
    tap('[data-act="saveLine"]')
    check("an empty name is refused", page.locator("#lnName.bad").count() == 1 and len(rows()) == 6)
    page.fill("#lnName", "Walk"); page.fill("#lnTarget", "10"); tap('[data-act="saveLine"]'); page.wait_for_timeout(400)
    check("the typed item is added", rows()[-1] == "Walk" and "OF 2,160" in page.inner_text(".count .of") and saved()["lines"][-1]["kind"] == "other", rows())
    check("list heading reads The Seven", up(".head span:first-child") == "THE SEVEN", up(".head"))
    shot("07-count-seven", full=True)

    # ---------- finishing a line ----------
    log(10, "Walk")
    page.wait_for_timeout(1200)
    check("finishing a line opens the finish screen", page.locator("#panel.open .donep").count() == 1)
    check("finish screen names the line and its number", "Walk" in page.inner_text(".donep .dn") and page.inner_text("#dNum") == "10", page.inner_text(".donep"))
    check("finish screen shows 1 / 7", page.inner_text(".donep .dv").replace(" ", "") == "1/7", page.inner_text(".donep .dv"))
    shot("08-line-finished")
    page.locator(".donep .dnum").click(); page.wait_for_timeout(450)
    check("tap closes the finish screen", page.locator("#panel").is_hidden())
    check("undo is offered after the finish screen", f"Walk {EM} 10 logged" in page.inner_text("#toast"), page.inner_text("#toast"))
    check("count reads 45", big() == "45", page.inner_text("#bigN"))
    check("finished line is marked done", page.locator(".row.done").count() == 1)
    check("forms complete 1 / 7", page.inner_text(".cell .v.big").replace(" ", "") == "1/7")

    # ---------- one line: rename, number, history, delete ----------
    page.locator('.row[data-act="line"]').first.click(); page.wait_for_timeout(350)
    check("a kata's name is labelled Kata", up('label[for="lnName"]') == "KATA", up('label[for="lnName"]'))
    check("a line's number box shows its number and is empty for typing", held("#lnTarget") == ["", "500", "500"], held("#lnTarget"))
    check("history lists the entry", page.locator(".hrow").count() == 1)
    shot("09-line-panel")
    page.fill("#lnName", "Heian Shodan, slow"); page.fill("#lnTarget", "400"); tap('[data-act="saveLine"]'); page.wait_for_timeout(400)
    check("rename and new number show in the list", rows()[0] == "Heian Shodan, slow" and "35 / 400" in page.locator(".row .amt").first.inner_text(), rows())
    check("an edited line keeps its kind", saved()["lines"][0]["kind"] == "kata")
    page.locator('.row[data-act="line"]').first.click(); page.wait_for_timeout(350)
    tap('[data-act="rmEntry"]'); page.wait_for_timeout(350)
    check("removing an entry empties the history", page.locator(".hrow").count() == 0)
    tap('[data-act="close"]')
    check("count drops to 10", big() == "10", page.inner_text("#bigN"))
    page.locator('.row[data-act="line"]').first.click(); page.wait_for_timeout(350)
    tap('[data-act="delLine"]')
    check("first tap only arms delete", page.locator(".danger.arm").count() == 1)
    tap('[data-act="delLine"]'); page.wait_for_timeout(450)
    check("second tap deletes the line", len(rows()) == 6 and rows()[0] == "Front punches", rows())

    # ---------- menu, name, start over ----------
    tap('[data-act="menu"]'); page.wait_for_timeout(350)
    check("menu shows his name under Warrior's Name", page.input_value("#mnWho") == "John Smith" and up('label[for="mnWho"]') == "WARRIOR'S NAME")
    shot("10-menu")
    page.fill("#mnWho", "")
    check("clearing the name removes it from the masthead", page.locator("#who").is_hidden())
    page.fill("#mnWho", "J. Smith <b>")
    check("a changed name shows at once, as plain text", up("#who") == "J. SMITH <B>" and page.locator("#who b").count() == 0, up("#who"))
    page.fill("#mnWho", "John Smith")
    tap('[data-act="startOver"]'); tap('[data-act="startOver"]'); page.wait_for_timeout(450)
    check("start over returns to an empty first screen", page.locator(".adds").count() == 1 and page.locator(".it").count() == 0 and page.locator("#bigN").count() == 0)
    check("start over keeps his name at the top, box put away", page.locator("#suWho").count() == 0 and up("#who") == "JOHN SMITH")

    # ---------- the twenty in one pick ----------
    pick("kata", "Bassai")
    pick("kata", "__twenty")
    st = staged()
    check("The Twenty adds all twenty once each", len(st) == 20 and sorted(r[1] for r in st) == sorted(kata_opts[2:22]) and up("#suTotal") == "OF 10,000", (len(st), up("#suTotal")))
    check("heading reads The Twenty", up(".head span:first-child") == "THE TWENTY", up(".head"))
    shot("11-built-twenty", full=True)
    tap('[data-act="begin"]')
    check("twenty lines begin at OF 10,000", len(rows()) == 20 and "OF 10,000" in page.inner_text(".count .of"))
    log(480); page.wait_for_timeout(300)
    check("no finish screen before the number is reached", page.locator(".donep").count() == 0)
    log(20); page.wait_for_timeout(1300)
    check("finish screen opens at 500", page.locator("#panel.open .donep").count() == 1 and page.inner_text("#dNum") == "500" and "Bassai" in page.inner_text(".donep .dn"))
    page.locator(".donep .dnum").click(); page.wait_for_timeout(450)
    check("in training moves to the next line", "Empi" in page.inner_text(".pair .cell:first-child"), page.inner_text(".pair .cell:first-child"))

    # ---------- what he saved is what comes back; a long count holds its shape ----------
    page.reload()
    check("his own count is what was saved", big() == "500" and len(rows()) == 20, page.inner_text("#bigN"))
    seed(twenty())
    check("a twenty-line count reads 1,560", big() == "1,560", page.inner_text("#bigN"))
    check("it carries his name", up("#who") == "JOHN SMITH")
    check("in training is Naifanchi No Sai, 2 / 20 complete", "Naifanchi No Sai" in page.inner_text(".pair .cell:first-child") and page.inner_text(".cell .v.big").replace(" ", "") == "2/20")
    check("only his own count is on the screen", page.locator(".pair .cell").count() == 2 and "KEVIN" not in page.inner_text("body").upper())
    no_sideways("twenty lines")
    shot("13-twenty", full=True)
    log(20)
    check("logging adds to it", big() == "1,580", page.inner_text("#bigN"))

    # ---------- deleting his last line returns him to the first screen ----------
    page.evaluate("localStorage.setItem('kw.count.v1', JSON.stringify({v:1,who:'John Smith',lines:[{id:'a',name:'Only',target:10,kind:'other'}],log:[],ui:{kept:1}}))")
    page.reload(); page.wait_for_timeout(300)
    page.locator('.row[data-act="line"]').first.click(); page.wait_for_timeout(350)
    check("a custom line is labelled Other", up('label[for="lnName"]') == "OTHER")
    tap('[data-act="delLine"]'); tap('[data-act="delLine"]'); page.wait_for_timeout(450)
    check("deleting the last line returns to the first screen, name kept", page.locator(".adds").count() == 1 and page.locator("#bigN").count() == 0 and page.locator("#suWho").count() == 0 and up("#who") == "JOHN SMITH")

    # ---------- nothing of the draft is left ----------
    check("no draft bar, no draft tools", page.locator("#draft, .draft, [data-act^='d'][id^='d'], .slot").count() == 0 and "DRAFT" not in page.inner_text("body").upper())
    check("the page opens at KATA WARRIOR", page.evaluate("document.body.innerText.trim().split('\\n')[0]") == "KATA WARRIOR", page.evaluate("document.body.innerText.trim().split('\\n')[0]"))
    check("the foot shows when it was last updated", up("#stamp").startswith("UPDATED "), up("#stamp"))
    page.evaluate("localStorage.clear()"); page.reload(); page.wait_for_timeout(300)
    check("with nothing saved, it opens as a new buyer", page.locator(".adds").count() == 1 and page.input_value("#suWho") == "" and page.locator("#who").is_hidden())
    shot("15-first-screen-new")

    # ---------- bad or old data in storage must not break the page ----------
    page.evaluate("localStorage.setItem('kw.count.v1','{not json')")
    page.reload(); page.wait_for_timeout(300)
    check("corrupt storage falls back to the first screen", page.locator(".adds").count() == 1 and page.locator("#bigN").count() == 0)
    page.evaluate("localStorage.setItem('kw.count.v1', JSON.stringify({v:1,lines:[{id:'a',name:'<img src=x onerror=window.__x=1>',target:10}],log:[{id:'1',l:'a',r:3,d:'2026-10-04',t:1},{id:'2',l:'zz',r:9,d:'2026-10-04',t:2},{id:'3',l:'a',r:-5,d:'bad',t:3}],ui:{}}))")
    page.reload()
    check("odd names are shown as text, not run", big() == "3" and page.evaluate("window.__x") is None, page.inner_text("#bigN"))
    check("older saved data without a name or a kind still loads", page.locator("#who").is_hidden() and len(rows()) == 1)
    page.evaluate("localStorage.setItem('kw.count.v1', JSON.stringify({v:1,who:'  " + "W" * 60 + "  ',lines:[{id:'a',name:'x',target:10}],log:[],ui:{}}))")
    page.reload(); page.wait_for_timeout(300)
    check("an over-long saved name is trimmed to 40", len(page.inner_text("#who").strip()) == 40, len(page.inner_text("#who").strip()))
    no_sideways("long name")

    outside = sorted({u.split("/")[2] for u in calls if not u.startswith("file:")})
    check("the preview calls nothing but the font host", outside in ([], ["fonts.googleapis.com"]), outside)
    browser.close()


with sync_playwright() as pw:
    run(pw, 390, 844, "p390", True)
    run(pw, 440, 956, "p440", False)
    run(pw, 360, 740, "p360", False)

real = [e for e in errors if "ERR_FAILED" not in e and "net::" not in e and "Failed to load resource" not in e]
print("console errors:", real if real else "none")
print("FAILED:" if fails else "ALL PASSED", fails if fails else "")
sys.exit(1 if (fails or real) else 0)
