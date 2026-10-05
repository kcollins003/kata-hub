# The Kata Warrior Tracker: working files

Nothing in this folder is part of the website. GitHub Pages skips folders that start with an underscore.

## What the product is

A free rep tracker. A man types his email at `katawarrior.com/tracker.html`. His private link,
`tracker.html?k=<his code>`, is emailed to him. That link is his key. The page keeps his count on his phone
and in one row of a Google Sheet, so the count survives a cleared browser or a new phone.
The Sheet is also the email list: one row per man.

| Piece | Where it lives | Made from |
|---|---|---|
| The page | `tracker.html` at the top of the repo | `page/tracker.src.html` |
| The Home Screen icon | `tracker-icon.png` at the top of the repo | `page/make_icon.py` |
| The backend | Apps Script inside the Google Sheet "Kata Warrior Trackers" | `backend/Code.gs` |
| Kevin's switches and email words | The "Words" tab of that Sheet | made once by `setup()` in `Code.gs` |

No keys or passwords are needed anywhere, and none are in this repo.

## Where the backend is

- Sheet: "Kata Warrior Trackers", in Kevin's Drive. **Keep it private**: it holds every man's email, and the Link
  column opens any man's tracker.
- Script: bound to that Sheet (Extensions > Apps Script), project "Kata Warrior Trackers".
- Web address: in `backend/API_URL.txt`. It is not a secret; it is in `tracker.html`. Opening it in a browser
  answers `{"ok":true,"service":"kata-warrior-tracker","v":2}`. `v` is 2 once sign-up by email is deployed.
- The link email is sent by the Google account that owns the Sheet. A personal Google account may send about
  100 a day (Google's limit, not ours).

## How a man gets in

1. He types his email at the door (`tracker.html` with no link). The page posts `{a:'join', e:<email>}`.
2. A new email gets a row, a code `kw_` + 32 hex characters, and an email carrying his link.
   A known email is emailed its link again. Either way the page is told only `{ok:true, sent:true}`
   and says "Check your email". The link is shown nowhere but his inbox.
3. He opens the link. From then on that phone remembers it; `tracker.html` with no link opens his count.

`tracker.html?new` shows the door even on a phone that already has a link.

## The Words tab (Kevin's, in the Sheet)

Column A is the name of the row, column B is his, column C says what the row does. A change takes effect at once.

| Row | Default | What it does |
|---|---|---|
| Sign-ups | open | Anything but `open` stops new sign-ups and all link emails. Men with a link keep using it. |
| Open right away | no | `yes`: a new email also has its tracker opened on the spot. Faster, but the address is never checked: a mistyped or made-up address gets a tracker, and whoever types an address first holds its link. Useful on a day sign-ups outrun the 100 emails. |
| From name | Kata Warrior | The name the email comes from. |
| Email subject | Kata Warrior Tracker | |
| Email body | Build your own kata challenge and track it | His link is added underneath, or wherever `{link}` is written. |

An empty cell means the default. If the tab is deleted, the defaults apply; run `setup` to make it again.

## The page

`page/tracker.src.html` is the file to edit. Every word a man sees on the page is in the `COPY` block near the top
of its script: Kevin's words first, stand-ins waiting for his words second.

    python3 build.py                        # out/tracker.page.html, a preview with no backend (and so no door)
    python3 build.py <backend web address>  # also out/tracker.html, the page for the site

## The backend

`backend/Code.gs` is pasted whole into the Sheet's Apps Script editor. After any change:

1. Run `setup` from the editor. It must end with `SELF-TEST PASSED`. It sends no email.
   The first run after email was added asks for one more Google permission, "Send email as you". Tick every box.
2. Deploy > Manage deployments > Edit > Version: New version > Deploy. That keeps the web address.

The Trackers tab has one row per man: Code, Email, Name, Logged, Of, Lines, Started, Last saved, Saves, Link,
ten hidden Data columns holding the count itself, then Link emailed. Do not move or rename the columns.
Deleting a row erases that man's tracker for good; if he signs up again he starts fresh.
Do not sort or delete rows at a busy moment; a filter view is the safe way to look around.

The page talks to the backend with three requests, each a plain-text POST of JSON:

    {a:'join', e}                      -> {ok, sent}                 or {ok:false, error}   (with "Open right away": {ok, k, mailed} for a new email)
    {a:'load', k}                      -> {ok, rev, data}            or {ok:false, error}
    {a:'save', k, rev, data, sum}      -> {ok, rev}                  or {ok:false, conflict:true, rev, data}

Errors: `email` (not an address), `closed`, `busy` (too many sign-ups just now), `mail` (the email could not be sent),
`code` (no such link), `server`, `request`, `size`.

A save carries the save number the page last saw. If another phone saved in between, the page is handed the newer
count, folds its own changes in (`merge3` in the page), and saves again.

What slows abuse of the sign-up, all in `Code.gs`: 10 new sign-ups a minute and 60 an hour; 3 new sign-ups and
4 link emails per mailbox in six hours (`name+anything@` is one mailbox, and Gmail dots are ignored); one link email
per mailbox per ten minutes; the last 20 emails of the day kept for men who were sent a link before.
These slow a flood. Google's own daily limit is what stops one.

Links from a Stripe checkout (`cs_test_`, `cs_live_`) still open a tracker if a row for one is added by hand, or if
Stripe keys are ever put in Script Properties. That path is kept in case the tracker is ever sold.

## Tests

    node backend/test_backend.js            # Code.gs against stand-in Google services (fake_gas.js)
    cd page
    python3 test_site.py                    # the page against Code.gs, end to end (builds its own copy, starts mock_server.js itself)
    python3 build.py && python3 wrap_preview.py && python3 test_preview.py && python3 test_widths.py   # the tracker itself, and ten screen widths
    python3 build.py <backend web address> && python3 test_real.py <code of a test row>   # the real backend
    python3 shots_door.py                   # pictures of the door, after test_site.py

Needs Node, Python, and Playwright with Chromium. `wrap_preview.py`, `shots_door.py` and `make_icon.py` want the
Cinzel font files in `../shelved/fonts` (they are not in this repo).

## Known limits

- About 100 link emails a day from a personal Google account, 20 of them kept back for men asking again.
  Past that a new man is told "Could not load" and his row waits; the next day the same tap sends his link.
- The email comes from the personal address of whoever owns the Sheet. Moving the Sheet to a Kata Warrior Google
  account changes the sender, and keeps any abuse of the form away from a personal mailbox.
- The page's words for a failed sign-up are one line, "Could not load", whatever the cause.
- A man's link is his key. Anyone he shares the page with after opening it has his tracker.
- The email check refuses a few real but unusual addresses (quoted names, non-English letters).
- One man's count can hold about 5,000 log entries (400,000 characters).
- Two colours on the page, the grey of small labels and the edge of an empty box, are below the usual contrast
  guideline. They are katawarrior.com's own.
