# katawarrior.com

Four pages:

- `index.html` — Kevin's own count.
- `log.html` — where he logs it.
- `tracker.html` — the Kata Warrior Tracker: a free tracker any man can sign up for with his email.
- `privacy.html` — what the tracker keeps about a man, and what is done with it.

This note is for the tracker and its privacy page. It is not part of the website.

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
  While Google is sending, the privacy page is wrong about who delivers the email, and the email shows the
  Google account's own address. Put the address back as soon as Resend is fixed. If Google is going to stay,
  change the privacy page.
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

## To change the links on the home page

`index.html`, near the bottom: the line with `tracker.html` in it, and the line with `privacy.html` in it.
The word before `</a>` is the label. Whatever the second one says, keep the word privacy in it.

## The privacy page

`privacy.html`. Plain words, no script. Two links lead to it: the foot of the home page, and the tracker's door,
under the button.

California's online privacy law (Business and Professions Code, sections 22575 to 22579) asks a commercial site
that collects personal details, email addresses among them, from California consumers to post one where it can
be found. Whether a free tracker counts is arguable. Posting one is the safe side. A link on the home page with
the word "privacy" in it meets the law's rule on where it goes. So keep the word in both links.

- **To change the words:** they are in `privacy.html`, between `<main>` and `</main>`. Branch, pull request.
- **Change the date at the top every time the words change.** The page promises that, and nothing else:
  it does not promise an email about a change.
- **The label on the door** is the line `privacy:` in `tracker.html`, in the block that begins `const COPY = {`.
- **The page has to stay true.** Change it, and its date, before any of these changes:
  - what a row of the Sheet holds;
  - who can open the Sheet. The page says only you can. On 5 Oct 2026 the Sheet was shared with no one.
    That covers helpers and AI tools too: once other men's rows are on the **Trackers** tab, no one else
    reads that tab and no tool is pointed at it;
  - who sends the link email, or how long they keep it (today: Resend, 30 days);
  - anything on the site that counts visitors, shows ads, or sets a cookie (today: nothing does);
  - what the emails are for (today: the link, and nothing else).

## When a man asks you to delete or fix his tracker

The privacy page promises both. It asks him to write from the address he signed up with. Check that he did:
anyone can claim to be him.

To delete it:

1. The Sheet, tab **Trackers**. Find his row by his email.
2. Right-click the row's number at the left edge. **Delete row**.
3. Tell him it is done. His link is dead. His phone keeps its own copy until he clears this site's data
   in his browser, but it can no longer save.
4. If he wants to start again, he opens `katawarrior.com/tracker.html?new` and types his email. He gets a new link.

To change his email:

1. In his row, type the new address over the old one in the **Email** cell. Touch nothing else in the row.
2. Tell him to open `katawarrior.com/tracker.html?new` and type the new address. His link is emailed there.
   It is the same link, and his count is as he left it.

If he mistyped his address when he signed up, he never got a link. He signs up again with the right one.
Delete the mistyped row.

Deleting the row does not reach three things: Resend's copy of his link email, which goes on its own after
30 days; the copy on his own phone; and the Sheet's own history (File > Version history), where an older
version still shows the row to you and to no one else.

## Before any email other than the link email

The privacy page says none are planned yet. Before the first one goes out:

1. Change that line on the privacy page, and the date.
2. If the email promotes anything (a video, a program, merch), federal law (CAN-SPAM) applies to it. The main
   things: a way to stop the emails that works, your postal address, and nothing misleading in the From or the
   subject. A P.O. box counts as the address. A man who asks to stop is off the list within 10 business days.
   The whole list is on the FTC's page "CAN-SPAM Act: A Compliance Guide for Business".
3. Sending to the whole list is a separate job from the link email. Nothing here does it yet.

## To see who has signed up

The Sheet, tab **Trackers**. One row per man: his email, his name, his count, when he last saved, and when his link was emailed.

- Do not rename, move or delete columns.
- Deleting a row erases that man's tracker for good. His phone keeps what it had but can no longer save.
  The steps are above, under **When a man asks you to delete or fix his tracker**.
- The **Link** column opens that man's tracker. That is why the Sheet stays private.

## If the script behind the Sheet ever has to change

That is not a job to do by hand. The steps and the tests are in `_dev/README.md` on the `tracker-dev` branch.

## Worth knowing

- The one key in the whole thing is the sending service's, and it lives in the script's settings. None belong in this repo.
- 80 new men can be emailed in a day. The other 20 of the day's 100 are kept for men asking for their link again.
  Past that, a new man is told the page could not load. His row is kept, and the same tap works the next day.
- An email Resend accepts is not always an email that arrives. Bounces show at resend.com, not in the Sheet.
  If too many bounce, Resend can pause sending. The quick fix above covers that.
