# The buyer's tracker: working files

Nothing in this folder is part of the website. GitHub Pages skips folders that start with an underscore.

## What the product is

A buyer pays through a Stripe Payment Link. Stripe sends him to `tracker.html?k=<his checkout id>`.
That address is his private link. The page keeps his count on his phone and in one row of a Google Sheet,
so the count survives a cleared browser or a new phone.

| Piece | Where it lives | Made from |
|---|---|---|
| The page | `tracker.html` at the top of the repo | `page/tracker.src.html` |
| The Home Screen icon | `tracker-icon.png` at the top of the repo | `page/make_icon.py` |
| The backend | Apps Script inside the Google Sheet "Kata Warrior Trackers" | `backend/Code.gs` |
| The Stripe keys | Script Properties of that Apps Script. Never in this repo. | |

## Where the backend is (deployed 4 Oct 2026)

- Sheet: "Kata Warrior Trackers", in Kevin's Drive. Keep it private: the Link column opens any buyer's tracker.
- Script: bound to that Sheet (Extensions > Apps Script), project "Kata Warrior Trackers".
- Web address: `https://script.google.com/macros/s/AKfycbyiPm1fkIKWs4jJ0RZmidV3mJGNO6wIqYaAxmY_tM4BceeGC0I3UyHxFO_aoynH2Y-g8g/exec`
  It is not a secret; it is in `tracker.html`. Opening it in a browser answers `{"ok":true,...}`.
- A row added to the Sheet by hand, with any code shaped like `cs_test_` or `cs_live_` plus ten or more letters and
  digits, opens a tracker without a purchase. That is how to give one away, and how the first test row was made.

## The page

`page/tracker.src.html` is the file to edit. Every word a buyer sees is in the `COPY` block near the top of its script.

    python3 build.py                        # out/tracker.page.html, a preview with no backend
    python3 build.py <backend web address>  # also out/tracker.html, the page for the site

## The backend

`backend/Code.gs` is pasted whole into the Sheet's Apps Script editor. After any change:
Deploy > Manage deployments > Edit > Version: New version > Deploy. That keeps the web address.

The Sheet has one row per buyer: Code, Email, Name, Logged, Of, Lines, Started, Last saved, Saves, Link,
then ten hidden Data columns holding the count itself. Do not move or rename the columns.

The page talks to the backend with two requests, both a plain-text POST of JSON:

    {a:'load', k}                      -> {ok, rev, data}            or {ok:false, error}
    {a:'save', k, rev, data, sum}      -> {ok, rev}                  or {ok:false, conflict:true, rev, data}

A code the Sheet has never seen is checked with Stripe once (`GET /v1/checkout/sessions/<id>`); a paid one gets a row.
A save carries the save number the page last saw. If another phone saved in between, the page is handed the newer
count, folds its own changes in (`merge3` in the page), and saves again.

## Tests

    node backend/test_backend.js            # Code.gs against stand-in Google services (fake_gas.js)
    cd page
    python3 build.py http://localhost:8787/macros/s/FAKE/exec
    python3 test_site.py                    # the site page against Code.gs, end to end (starts mock_server.js itself)
    python3 wrap_preview.py && python3 test_preview.py && python3 test_widths.py   # the buyer's path, and ten screen widths
    python3 build.py <backend web address> && python3 test_real.py <code of a test row>   # the real backend

Needs Node, Python, and Playwright with Chromium.

## Known limits

- One buyer's count can hold about 5,000 log entries (400,000 characters).
- A refund in Stripe does not close a tracker.
- A buyer who loses his link needs it sent again: find his email in the Sheet and copy the Link column.
