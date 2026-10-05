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
| The sending service's key | Script Properties of that Apps Script project, as `RESEND_KEY` | pasted by Kevin, by hand |

That key is the only secret in the whole thing. It is not in this repo and must never be.

## Where the backend is

- Sheet: "Kata Warrior Trackers", in Kevin's Drive. **Keep it private**: it holds every man's email, and the Link
  column opens any man's tracker.
- Script: bound to that Sheet (Extensions > Apps Script), project "Kata Warrior Trackers".
- Web address: in `backend/API_URL.txt`. It is not a secret; it is in `tracker.html`. Opening it in a browser
  answers `{"ok":true,"service":"kata-warrior-tracker","v":3}`. `v` is 2 for sign-up by email, 3 once the version
  that can use the sending service is deployed.

## How a man gets in

1. He types his email at the door (`tracker.html` with no link). The page posts `{a:'join', e:<email>}`.
2. A new email gets a row, a code `kw_` + 32 hex characters, and an email carrying his link.
   A known email is emailed its link again. Either way the page is told only `{ok:true, sent:true}`
   and says "Check your email". The link is shown nowhere but his inbox.
3. He opens the link. From then on that phone remembers it; `tracker.html` with no link opens his count.

`tracker.html?new` shows the door even on a phone that already has a link.

## Who sends the email

Two roads. The script takes exactly one of them for each email.

| | Google | The sending service (Resend) |
|---|---|---|
| Used when | the From address cell on the Words tab is empty, or there is no `RESEND_KEY` | the From address cell holds one plain address **and** `RESEND_KEY` is in Script Properties |
| The email comes from | the Google account that owns the Sheet | the address in the From address cell |
| Daily limit | about 100 (Google's, for a personal account) | 100 on Resend's free plan, 3,000 a month |
| If it fails | the man is told "Could not load"; his row is kept | the same. **Google is not used instead** |

Why Google is not used when the service fails: the point of the service is that the email does not come from a
personal Gmail address. A quiet fall-back would put it back there without anyone knowing.
For the same reason, once the key is in place a From address cell holding anything that is not one plain address
(a comma for the dot, two addresses, a pasted invisible character) sends **nothing**, by either road.
An empty cell is the off switch: Google sends again.

What goes to the service: one request per email, `POST https://api.resend.com/emails`, with four things in it:
who it is from, the one man it is to, the subject, the words as plain text. No html, no cc, no bcc, no tracking.
The key rides in the request's header and nowhere else. The request gives up after 15 seconds (the page gives up at 25).

What Resend keeps: a copy of every email it sends, body included, for 30 days, in its dashboard. Each body holds a
man's private link. The Resend login is as sensitive as the Sheet.

What the script keeps: `MAIL_TALLY` in Script Properties, the day (by the world clock, which is when Resend's own
day turns over) and how many emails it has sent through the service that day. The last 20 of the day's 100 are kept
for men asking again for a link they were sent before. It is a count, not a key. Leave it be.
On a paid Resend plan with no daily limit, raise `SERVICE_PER_DAY` in `Code.gs`.

### Switching the service on

Order matters. The second of the two settings to land is the live switch.

1. Kevin: a Resend account; the domain added there and showing Verified; a key made with **Sending access**,
   limited to that domain, pasted into Script Properties as `RESEND_KEY`.
   The From address cell is still empty, so Google is still sending.
2. Run `checkSender` from the editor. It sends no email and never shows the key. It asks the service one question
   (`GET /domains`) and reports one of:
   - the service knows the key and it can only send (the right kind);
   - the service knows the key but it is a full access key (works; replace it), with the domain's standing;
   - the service did not accept the key, with the service's own reason;
   - the service could not be reached.
3. Put the address in the From address cell. That is the switch.
4. Sign up at `katawarrior.com/tracker.html?new` with a real inbox. The email should come from that address.
   A sending-only key cannot be asked whether the domain is verified, so this sign-up is the real proof.

To switch it off: empty the From address cell, or delete `RESEND_KEY`.

### If link emails stop going out

- New rows on the Trackers tab with an empty **Link emailed** cell are men who were not sent their link.
- The reason is in the Apps Script project, under Executions, on a line starting `link email not sent:`.
  No address and no key is ever written there.
- `setup` says who the sender is on its `Sender:` line. `Sender: NOBODY` means the key is in place and the
  From address cell is not one plain address.

## The Words tab (Kevin's, in the Sheet)

Column A is the name of the row, column B is his, column C says what the row does. A change takes effect at once.
Rows are found by name, capitals and punctuation aside, anywhere in the first 100 rows.

| Row | Default | What it does |
|---|---|---|
| Sign-ups | open | Anything but `open` stops new sign-ups and all link emails. Men with a link keep using it. |
| Open right away | no | `yes`: a new email also has its tracker opened on the spot. Faster, but the address is never checked: a mistyped or made-up address gets a tracker, and whoever types an address first holds its link. Useful on a day sign-ups outrun the day's emails. |
| From name | Kata Warrior | The name the email comes from. |
| From address | (empty) | See "Who sends the email". |
| Email subject | Kata Warrior Tracker | |
| Email body | Build your own kata challenge and track it | His link is added underneath, or wherever `{link}` is written. |

An empty cell means the default. If the tab is deleted, the defaults apply; run `setup` to make it again.
A tab made by an earlier version is given any row it lacks, at the bottom, the next time `setup` runs.
Nothing already on the tab is touched.

## The page

`page/tracker.src.html` is the file to edit. Every word a man sees on the page is in the `COPY` block near the top
of its script: Kevin's words first, stand-ins waiting for his words second.

    python3 build.py                        # out/tracker.page.html, a preview with no backend (and so no door)
    python3 build.py <backend web address>  # also out/tracker.html, the page for the site

The page knows nothing about who sends the email. Changing the sender never needs a new page.

## The backend

`backend/Code.gs` is pasted whole into the Sheet's Apps Script editor. After any change:

1. Run `setup` from the editor. It must end with `SELF-TEST PASSED`. It sends no email.
2. Deploy > Manage deployments > Edit > Version: New version > Deploy. That keeps the web address.

Functions meant to be run by hand: `setup`, `checkSender`, and `checkStripe` (only if the tracker is ever sold).

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
These slow a flood. The sender's own daily limit is what stops one.

Links from a Stripe checkout (`cs_test_`, `cs_live_`) still open a tracker if a row for one is added by hand, or if
Stripe keys are ever put in Script Properties. That path is kept in case the tracker is ever sold.

Google permissions the script needs, all granted already: this Sheet only, send email as the owner, and connect
to an outside service (first used for Stripe; the sending service uses the same permission).

## Tests

    node backend/test_backend.js            # Code.gs against stand-in Google services and a stand-in Resend (fake_gas.js)
    python3 backend/breakages.py            # Code.gs broken on purpose, one way at a time; the tests must catch each
    cd page
    python3 test_site.py                    # the page against Code.gs, end to end (builds its own copy, starts mock_server.js itself)
    python3 build.py && python3 wrap_preview.py && python3 test_preview.py && python3 test_widths.py   # the tracker itself, and ten screen widths
    python3 build.py <backend web address> && python3 test_real.py <code of a test row>   # the real backend
    python3 shots_door.py                   # pictures of the door, after test_site.py

Needs Node, Python, and Playwright with Chromium. `wrap_preview.py`, `shots_door.py` and `make_icon.py` want the
Cinzel font files in `../shelved/fonts` (they are not in this repo).

`backup-v1-paid/Code.gs` and `backup-v2-deployed/Code.gs` are earlier deployed versions of the script, kept so the
tests can run today's script against a Sheet those versions made.

The stand-in Resend answers as the real one did on 5 Oct 2026: a key it does not know gets `401 validation_error
"API key is invalid"` on `/emails` and `400` on `/domains` (Resend's own pages say 403); no key gets
`401 missing_api_key`. What a sending-only key gets on `/domains` (`401 restricted_api_key`) is from Resend's pages,
not yet seen for real.

## Known limits

- About 100 link emails a day by either road, 20 of them kept back for men asking again.
  Past that a new man is told "Could not load" and his row waits; the next day the same tap sends his link.
- Through Resend, an accepted email is not a delivered one. Bounces and spam complaints show in Resend's dashboard,
  not in the Sheet. Resend may pause an account whose bounce rate passes 4% or whose complaint rate passes 0.08%.
  A public form that emails whatever address is typed will bounce now and then; at a few sign-ups a day one typo is
  a large share. If Resend pauses sending, empty the From address cell and Google sends while it is sorted out.
- The day's count through the service is the script's own. Two sign-ups at the same instant can be counted as one,
  so a little of the 20 kept back can be spent early. Resend's own limit still holds.
- Until the sending service is switched on, the email comes from the personal address of whoever owns the Sheet.
- The page's words for a failed sign-up are one line, "Could not load", whatever the cause.
- A man's link is his key. Anyone he shares the page with after opening it has his tracker.
- The email check refuses a few real but unusual addresses (quoted names, non-English letters).
- A From name is cleaned before it goes to the service: `< > " . , ; : @ \ ( ) [ ]` become spaces.
- One man's count can hold about 5,000 log entries (400,000 characters).
- Two colours on the page, the grey of small labels and the edge of an empty box, are below the usual contrast
  guideline. They are katawarrior.com's own.
