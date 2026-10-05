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
- **From address** is the address it comes from, once the sending service is set up (see below).

## Who sends the email

- **Until the sending service is set up:** Google sends it, from the Google account that owns the Sheet.
  It shows that account's address. A personal Google account may send about 100 a day.
- **Once it is set up:** Resend (resend.com) sends it, as the address on the **From address** row.
  The free plan sends 100 a day and 3,000 a month.

Setting it up takes three things only Kevin can do:

1. A Resend account.
2. The domain `katawarrior.com` added and verified there. Resend's "Sign in to Cloudflare" button adds the
   records it needs. They sit on their own names and leave the iCloud mail records alone.
3. A key made in Resend with **Sending access** only, pasted into the script's settings:
   the Sheet > Extensions > Apps Script > Project Settings (the gear) > Script Properties > `RESEND_KEY`.

The key is a password. It goes in that one box and nowhere else: not in this repo, not in a chat, not in the Sheet.
To stop using the service, delete `RESEND_KEY` or empty the **From address** cell; Google sends again.

## To stop sign-ups

Tab **Words**, row **Sign-ups**: pick `closed`. Pick `open` to start again.
While it is closed, men who already have a link keep using it.

## To let men in without waiting for the email

Tab **Words**, row **Open right away**: pick `yes`. Read the note beside it first.
It is for a day when sign-ups outrun the roughly 100 emails Google lets a personal account send.

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
- Deleting a row erases that man's tracker for good.
- The **Link** column opens that man's tracker. That is why the Sheet stays private.

## If the script behind the Sheet ever has to change

That is not a job to do by hand. The steps and the tests are in `_dev/README.md` on the `tracker-dev` branch.

## Worth knowing

- The one key in the whole thing is the sending service's, and it lives in the script's settings. None belong in this repo.
- Past the day's limit on emails, a new man is told the page could not load. His row is kept, and the same tap works the next day.
