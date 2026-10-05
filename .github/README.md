# katawarrior.com

Three pages:

- `index.html` — Kevin's own count.
- `log.html` — where he logs it.
- `tracker.html` — the Kata Warrior Tracker: a free tracker any man can sign up for with his email.

This note is for the tracker. It is not part of the website.

## How the tracker works

A man types his email at `katawarrior.com/tracker.html`. He is emailed a private link. That link opens his tracker.
His count is kept on his phone and in one row of the Google Sheet **Kata Warrior Trackers**.
That Sheet is also the email list. Keep it private.

## To change the email he gets

Open the Sheet. Go to the tab **Words**. Type in column B. It takes effect at once.

- **Email subject** and **Email body** are the email. His link is added under the body.
  To put the link somewhere else, write `{link}` where it goes.
- **From name** is the name the email comes from.
- **From address** is the address it comes from. Read the next part before touching it.

## Who sends the email

Resend (resend.com) sends it, as the address on the **From address** row: `kevin@katawarrior.com`.
Switched on and proven with a real sign-up on 5 Oct 2026. Resend's free plan sends 100 a day and 3,000 a month.

Two things make that work, and both must be in place:

1. The **From address** cell holds one plain address at katawarrior.com.
2. The key from Resend is in the script's settings as `RESEND_KEY`:
   the Sheet > Extensions > Apps Script > Project Settings (the gear) > Script Properties.

What follows from that:

- **To go back to Google sending it:** empty the **From address** cell. Google sends at once, from the Google
  account that owns the Sheet, showing that account's address. About 100 a day.
- **If Resend refuses an email, Google is not used instead.** The man is told the page could not load, and his row
  is kept. That is on purpose: a quiet fall-back would put the email back on a personal Gmail address.
- **With the key in place, anything in the From address cell that is not one plain address means no email goes out.**

The key is a password. It lives in that one box and nowhere else: not in this repo, not in a chat, not in the Sheet.
The Project Settings page shows it in plain sight, so do not open that page with anyone watching.
If the key is ever seen by someone else: delete it at resend.com/api-keys, make a new one with **Sending access**
limited to katawarrior.com, and paste it over the old value.

`MAIL_TALLY`, in the same place, is not a key. It is the script's count of the day's emails. Leave it.

Resend keeps a copy of every email it sends for 30 days, link included. Guard that login like the Sheet.
In Resend, leave **Receiving** off and tracking off.

The records Resend needs are at Cloudflare, on the names `send`, `rsend` and `resend._domainkey`.
Do not delete them. They are separate from the iCloud mail records and do not touch them.

## If link emails stop

- **The sign:** new rows on the **Trackers** tab with an empty **Link emailed** cell.
- **The quick fix:** empty the **From address** cell. Google sends again at once.
- **Then find out why:** at resend.com, is the domain still Verified, is the key still there, has sending been paused?
  The script also writes the reason in the Apps Script project, under Executions, on a line starting
  `link email not sent:`.
- A man who was not sent his link gets it by typing his email at the door again.

## To stop sign-ups

Tab **Words**, row **Sign-ups**: pick `closed`. Pick `open` to start again.
While it is closed, men who already have a link keep using it.

## To let men in without waiting for the email

Tab **Words**, row **Open right away**: pick `yes`. Read the note beside it first.
It is for a day when sign-ups outrun the day's emails.

## To see a sign-up at the door on a phone that already has a tracker

Open `katawarrior.com/tracker.html?new`. A phone that has opened a tracker goes straight to it otherwise.

## To change a word on the tracker page

The words are in `tracker.html`, in the block that begins `const COPY = {`.
Each line is a name, then the words between quote marks. Change the words. Leave the name and the quote marks.
Do it on a branch and open a pull request.
The same block is in `_dev/page/tracker.src.html` on the `tracker-dev` branch; change it there too, or the next build puts the old words back.

## To change the link on the home page

`index.html`, near the bottom, the line with `tracker.html` in it. The word before `</a>` is the label.

## To see who has signed up

The Sheet, tab **Trackers**. One row per man: his email, his name, his count, when he last saved, and when his link was emailed.

- Do not rename, move or delete columns.
- Deleting a row erases that man's tracker for good. His phone keeps what it had but can no longer save.
- The **Link** column opens that man's tracker. That is why the Sheet stays private.

## If the script behind the Sheet ever has to change

That is not a job to do by hand. The steps and the tests are in `_dev/README.md` on the `tracker-dev` branch.

## Worth knowing

- The one key in the whole thing is the sending service's, and it lives in the script's settings. None belong in this repo.
- 80 new men can be emailed in a day. The other 20 of the day's 100 are kept for men asking for their link again.
  Past that, a new man is told the page could not load. His row is kept, and the same tap works the next day.
- An email Resend accepts is not always an email that arrives. Bounces show at resend.com, not in the Sheet.
  If too many bounce, Resend can pause sending. The quick fix above covers that.
