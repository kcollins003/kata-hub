/**
 * @OnlyCurrentDoc
 *
 * KATA WARRIOR - TRACKER BACKEND
 *
 * This script lives inside one Google Sheet. That Sheet is where every man's count is kept:
 * one row per man, on the tab called "Trackers".
 * The page at katawarrior.com/tracker.html talks to this script. Nothing else does.
 *
 * HOW A MAN GETS IN
 *   He types his email on the page. This script gives that email a row and a private link,
 *   and emails him the link. The link is his key: it is sent to his inbox and shown nowhere else,
 *   so no one opens another man's tracker by typing his address.
 *   The email goes out from the Google account that owns this Sheet.
 *
 * KEVIN'S SWITCHES AND HIS EMAIL WORDS are on the tab called "Words", not in this file.
 *   Change a cell there and it takes effect at once. Nothing here needs touching.
 *
 * NO SECRETS IN THIS FILE.
 *   The tracker is free, so no Stripe key is needed. If it is ever sold, the two keys go in
 *   Project Settings (the gear on the left) > Script Properties
 *     STRIPE_KEY_TEST   a restricted key from a Stripe sandbox   (starts rk_test_)
 *     STRIPE_KEY_LIVE   a restricted key from Stripe live mode   (starts rk_live_)
 *   Each key needs one permission only: Checkout Sessions, Read.
 *
 * AFTER ANY CHANGE TO THIS FILE:
 *   1. Run "setup" from this editor (pick it in the menu above, press Run). It must end with SELF-TEST PASSED.
 *   2. Deploy > Manage deployments > Edit (the pencil) > Version: New version > Deploy.
 *      That keeps the same web address. "New deployment" makes a new address and breaks the page.
 */

var TAB        = 'Trackers';
var PAGE       = 'https://katawarrior.com/tracker.html';
var HEAD       = ['Code', 'Email', 'Name', 'Logged', 'Of', 'Lines', 'Started', 'Last saved', 'Saves', 'Link', 'Data'];
var COL        = { code: 1, email: 2, name: 3, logged: 4, of: 5, lines: 6, started: 7, saved: 8, rev: 9, link: 10, data: 11, mailed: 21 };
var CHUNK      = 40000;                    // Sheets holds 50,000 characters in a cell, so a count is cut into pieces
var MAX_CHUNKS = 10;                       // 400,000 characters in all: roughly 5,000 log entries for one man
var WIDTH      = COL.data + MAX_CHUNKS - 1;
var MARK       = 'kw1:';                   // every data cell starts with this, so Sheets always reads it as plain text
var TAIL       = ';';                      // and ends with this, so nothing at the end of a piece can be trimmed away
var HEAD_MAILED = 'Link emailed';          // the column after the hidden data: when his link last went out by email

/* A man's code is his private key. Two kinds: one made here when he signs up (kw_), one from a Stripe checkout (cs_). */
var CODE_RE    = /^(cs_(test|live)_[A-Za-z0-9]{10,200}|kw_[a-f0-9]{32})$/;
/* One plain address: letters, digits and . _ % + ' - before the @, a real-looking domain after it.
   Nothing else gets near the Sheet or the mail: no space, comma, semicolon, bracket, quote mark or line break. */
var EMAIL_RE   = /^[a-z0-9_][a-z0-9._%+'\-]{0,63}@(?:[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
var EMAIL_MAX  = 120;

var NEW_PER_MINUTE  = 40;                  // most never-seen Stripe codes checked with Stripe in one minute
var JOIN_PER_MINUTE = 10;                  // most new sign-ups in one minute
var JOIN_PER_HOUR   = 60;                  // and in one hour. Past either, the page is told to try again.
var RESEND_SECONDS  = 600;                 // a mailbox asking for its link again is not sent it twice inside ten minutes
var BOX_SECONDS     = 21600;               // six hours: the longest the script's memory keeps a tally
var BOX_NEW         = 3;                   // most new sign-ups for one mailbox in that time (name+anything@ is the same mailbox)
var BOX_MAILS       = 4;                   // most link emails to one mailbox in that time
var MAIL_RESERVE    = 20;                  // the last emails of the day are kept for men asking again for a link they were sent before

/* The Words tab: what each row is called, what is used while its cell is empty, and a note to Kevin on what it does. */
var WORDS_TAB  = 'Words';
var DEF        = { from: 'Kata Warrior', subject: 'Kata Warrior Tracker', body: 'Build your own kata challenge and track it' };
var WORDS      = [
  ['Sign-ups',        'open',      'open or closed. Closed stops new sign-ups and all link emails. Men who already have a link keep using it.'],
  ['Open right away', 'no',        'no: his link is emailed and shown nowhere else, so every address on the list is one that works. yes: a new email also has its tracker opened on the spot. Faster for him, but the address is never checked: a mistyped or made-up address gets a tracker, and whoever types an address first holds its link.'],
  ['From name',       DEF.from,    'The name the email comes from. The address it comes from is the Google account that owns this Sheet.'],
  ['Email subject',   DEF.subject, 'The subject of the email that carries his link.'],
  ['Email body',      DEF.body,    'The email itself. His link is added underneath. To put it somewhere else, write {link} where it goes.']
];

/* ------------------------------------------------------------------
   THE WEB ADDRESS
   Opening the address in a browser answers with a short "ok".
   The page sends everything else as a POST: sign up, load a count, or save one.
------------------------------------------------------------------ */
function doGet() {
  return out_({ ok: true, service: 'kata-warrior-tracker', v: 2 });
}

function doPost(e) {
  var answer;
  try {
    var raw = (e && e.postData && e.postData.contents) || '{}';
    if (raw.length > 1000000) return out_({ ok: false, error: 'size' });      // far more than any count: not worth reading
    var body = JSON.parse(raw);
    if (body.a === 'load') answer = load_(String(body.k || ''));
    else if (body.a === 'save') answer = save_(body);
    else if (body.a === 'join') answer = join_(body);
    else answer = { ok: false, error: 'request' };
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    answer = { ok: false, error: 'server' };
  }
  return out_(answer);
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------------------
   SIGN UP
   The page sends an email address. One row per address.
     a new address      -> a row, a private link, and the link by email.
     a known address    -> his link by email again.
   Either way the page is told only "sent". The link itself goes to the inbox and nowhere else.
   The one exception is Kevin's to switch on: with "Open right away" set to yes, a NEW address
   is also handed its code, so the tracker opens there and then, before the address is ever checked.
------------------------------------------------------------------ */
function join_(b) {
  var email = String(b.e == null ? '' : b.e).trim().toLowerCase();
  if (!email_(email)) return { ok: false, error: 'email' };

  var words = words_();
  if (!words.open) return { ok: false, error: 'closed' };

  var cache = CacheService.getScriptCache();
  var box = box_(email);
  var sh = sheet_();
  var code = '', fresh = false, sentBefore = false;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var row = findEmail_(sh, email);
    if (row) {
      var cells = sh.getRange(row, 1, 1, 2).getValues()[0];                   // his code and his email, read together from one row
      code = String(cells[COL.code - 1]);
      if (String(cells[COL.email - 1]).trim().toLowerCase() !== email || !CODE_RE.test(code)) {
        console.error('sign-up: the row found for an email did not hold that email and a code');
        return { ok: false, error: 'server' };                                 // never send one man's link to another
      }
      sentBefore = !!sh.getRange(row, COL.mailed).getValue();
    } else {
      if (!room_(cache, box)) return { ok: false, error: 'busy' };
      code = newCode_(sh);
      sh.appendRow([code, email, '', 0, 0, 0, new Date(), '', 0, PAGE + '?k=' + code, '']);
      SpreadsheetApp.flush();                                                  // on the Sheet before the lock is let go, so the next request sees it
      fresh = true;
    }
  } finally {
    lock.releaseLock();
  }

  var mailed = mail_(email, box, code, words, cache, fresh, sentBefore);
  if (fresh && words.instant) return { ok: true, k: code, mailed: mailed };
  return mailed ? { ok: true, sent: true } : { ok: false, error: 'mail' };
}

function email_(email) {
  return email.length <= EMAIL_MAX && EMAIL_RE.test(email) && !/\.\.|\.@/.test(email);
}

/* The mailbox an address lands in, as near as can be told: name+anything@ is name@, and Gmail ignores dots.
   Used only to count, so that one inbox cannot be sent email after email under a string of spellings. */
function box_(email) {
  var at = email.lastIndexOf('@');
  var name = email.slice(0, at).split('+')[0], host = email.slice(at + 1);
  if (host === 'googlemail.com') host = 'gmail.com';
  if (host === 'gmail.com') name = name.replace(/\./g, '');
  return name + '@' + host;
}

/* A code no row has yet. */
function newCode_(sh) {
  for (var i = 0; i < 3; i++) {
    var code = 'kw_' + Utilities.getUuid().replace(/-/g, '').toLowerCase();
    if (CODE_RE.test(code) && !find_(sh, code)) return code;
  }
  throw new Error('could not make a new code');
}

/* New sign-ups are counted by the minute, by the hour and by the mailbox, so a flood is slowed to a walk.
   (The script's memory may forget a tally early. These slow a flood; Google's own daily limit on email is what stops one.) */
function room_(cache, box) {
  var now = Date.now();
  var mk = 'jm:' + Math.floor(now / 60000), hk = 'jh:' + Math.floor(now / 3600000), bk = 'jb:' + box;
  var m = Number(cache.get(mk)) || 0, h = Number(cache.get(hk)) || 0, n = Number(cache.get(bk)) || 0;
  if (m >= JOIN_PER_MINUTE || h >= JOIN_PER_HOUR || n >= BOX_NEW) return false;
  cache.put(mk, String(m + 1), 120);
  cache.put(hk, String(h + 1), 7200);
  cache.put(bk, String(n + 1), BOX_SECONDS);
  return true;
}

/* Send a man his link. True if it went, or went minutes ago. Nothing he typed is in the email but his own address. */
function mail_(email, box, code, words, cache, fresh, sentBefore) {
  var spaced = 'm:' + box, tally = 'q:' + box, had = 0;
  try {
    had = Number(cache.get(tally)) || 0;
    if (!fresh && (cache.get(spaced) || had >= BOX_MAILS)) return true;        // it went out minutes ago, or this mailbox has had its share for now
  } catch (err0) {
    had = 0;                                                                   // the tallies are a courtesy: carry on without them
  }
  if (!email_(email) || !CODE_RE.test(code)) return false;                     // a second lock on the door; join_ has already checked both
  var link = PAGE + '?k=' + code;
  var body = words.body.indexOf('{link}') >= 0 ? words.body.split('{link}').join(link) : words.body + '\n\n' + link;
  try {
    if (!sentBefore && MailApp.getRemainingDailyQuota() <= MAIL_RESERVE) {
      throw new Error('the last ' + MAIL_RESERVE + ' emails of the day are kept for men asking again for a link they were sent before');
    }
    MailApp.sendEmail({ to: email, subject: words.subject, body: body, name: words.from });
  } catch (err) {
    console.error('link email not sent: ' + (err && err.message ? err.message : err));   // most often: the day's email is used up
    return false;
  }
  try {
    cache.put(spaced, '1', RESEND_SECONDS);
    cache.put(tally, String(had + 1), BOX_SECONDS);
  } catch (err1) { /* a courtesy, as above */ }
  try {
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var sh = sheet_();
      var row = find_(sh, code);
      if (row) { sh.getRange(row, COL.mailed).setValue(new Date()); SpreadsheetApp.flush(); }
    } finally {
      lock.releaseLock();
    }
  } catch (err2) {
    console.error('link email sent, but the date was not noted: ' + (err2 && err2.message ? err2.message : err2));
  }
  return true;
}

/* Kevin's switches and email words, from the Words tab. A missing tab, a missing row or an empty cell means the built-in word.
   Rows are found by name, capitals and punctuation aside. A switch that says anything but its "on" word is off:
   Sign-ups is open only if it says open; a new email opens right away only if it says yes. */
function words_() {
  var w = { open: true, instant: false, from: DEF.from, subject: DEF.subject, body: DEF.body };
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(WORDS_TAB);
  if (!sh) return w;
  var last = Math.min(sh.getLastRow(), 30);
  if (last < 1) return w;
  var rows = sh.getRange(1, 1, last, 2).getDisplayValues();
  for (var i = 0; i < rows.length; i++) {
    var name = String(rows[i][0]).toLowerCase().replace(/[^a-z]/g, '');
    var text = String(rows[i][1]).replace(/\r\n?/g, '\n').replace(/^\s+|\s+$/g, '');
    if (!text) continue;
    if (name === 'signups') w.open = text.toLowerCase() === 'open';
    else if (name === 'openrightaway') w.instant = text.toLowerCase() === 'yes';
    else if (name === 'fromname') w.from = text.replace(/[\u0000-\u001f\u007f<>"]/g, ' ').slice(0, 60);
    else if (name === 'emailsubject') w.subject = text.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 150);
    else if (name === 'emailbody') w.body = text.slice(0, 5000);
  }
  return w;
}

/* ------------------------------------------------------------------
   LOAD
   A code this Sheet has seen before is answered from its row.
   A sign-up code it has never seen is refused: those are only ever made here.
   A Stripe code it has never seen is checked with Stripe once. If Stripe says it is a paid checkout,
   the buyer gets a row of his own, and from then on the row is the proof.
------------------------------------------------------------------ */
function load_(code) {
  if (!CODE_RE.test(code)) return { ok: false, error: 'code' };
  var sh = sheet_();
  var row = find_(sh, code);
  if (row) return read_(sh, row, code);
  if (code.indexOf('kw_') === 0) return { ok: false, error: 'code' };

  var paid = verify_(code);
  if (!paid.ok) return paid;

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    row = find_(sh, code);                 // two phones opening the same link at once make one row, not two
    if (!row) {
      sh.appendRow([code, plain_(paid.email, 120), '', 0, 0, 0, new Date(), '', 0, PAGE + '?k=' + code, '']);
      SpreadsheetApp.flush();
    }
  } finally {
    lock.releaseLock();
  }
  return { ok: true, rev: 0, data: '' };
}

/* ------------------------------------------------------------------
   SAVE
   The page sends the whole count and the save number it last saw.
   If another phone saved in between, nothing is written: the page is handed the newer
   count, folds its own changes in, and sends again.
------------------------------------------------------------------ */
function save_(b) {
  var code = String(b.k || '');
  if (!CODE_RE.test(code)) return { ok: false, error: 'code' };
  var data = b.data;
  if (typeof data !== 'string' || data.charAt(0) !== '{') return { ok: false, error: 'request' };
  try { JSON.parse(data); } catch (err) { return { ok: false, error: 'request' }; }
  data = ascii_(data);                     // stored as plain ASCII, so no accent or emoji can be damaged where the count is cut
  if (data.length > CHUNK * MAX_CHUNKS) return { ok: false, error: 'size' };
  var rev = Math.floor(Number(b.rev));
  if (!(rev >= 0)) return { ok: false, error: 'request' };
  var sum = (b.sum && typeof b.sum === 'object') ? b.sum : {};

  var sh = sheet_();
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var row = find_(sh, code);
    if (!row) return { ok: false, error: 'code' };     // a count is saved only for a link that has been opened, and checked, first
    var range = sh.getRange(row, 1, 1, WIDTH);
    var cells = range.getValues()[0];
    if (String(cells[COL.code - 1]) !== code) return { ok: false, error: 'server' };   // the rows moved under us (someone sorting the Sheet): the page sends again
    var cur = unpack_(cells);
    if (cur.rev !== rev) return { ok: false, conflict: true, rev: cur.rev, data: cur.data };

    var next = rev + 1;
    cells[COL.name - 1]   = plain_(sum.who, 40);
    cells[COL.logged - 1] = num_(sum.logged);
    cells[COL.of - 1]     = num_(sum.of);
    cells[COL.lines - 1]  = num_(sum.lines);
    cells[COL.saved - 1]  = new Date();
    cells[COL.rev - 1]    = next;
    for (var i = 0; i < MAX_CHUNKS; i++) {
      var part = data.substr(i * CHUNK, CHUNK);
      cells[COL.data - 1 + i] = part ? MARK + part + TAIL : '';
    }
    range.setValues([cells]);              // the whole row in one write
    SpreadsheetApp.flush();                // on the Sheet before the lock is let go, so the next save sees this one
    return { ok: true, rev: next };
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------
   THE SHEET
------------------------------------------------------------------ */
function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TAB);
  if (!sh) sh = build_(ss);
  if (sh.getMaxColumns() < COL.mailed) sh.insertColumnsAfter(sh.getMaxColumns(), COL.mailed - sh.getMaxColumns());
  return sh;
}

function build_(ss) {
  var sh = ss.insertSheet(TAB);
  if (sh.getMaxColumns() < COL.mailed) sh.insertColumnsAfter(sh.getMaxColumns(), COL.mailed - sh.getMaxColumns());
  sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]).setFontWeight('bold');
  sh.setFrozenRows(1);
  var rows = sh.getMaxRows();
  sh.getRange(1, COL.code, rows, 3).setNumberFormat('@');                 // code, email, name: always plain text
  sh.getRange(1, COL.link, rows, 1 + MAX_CHUNKS).setNumberFormat('@');    // link and data: always plain text
  sh.getRange(1, COL.started, rows, 2).setNumberFormat('yyyy-mm-dd hh:mm');
  sh.hideColumns(COL.data, MAX_CHUNKS);                                   // the data is for the page, not for reading
  mailedHead_(sh);
  return sh;
}

/* The "Link emailed" column, for a new tab and for a tab made before sign-up by email. */
function mailedHead_(sh) {
  if (String(sh.getRange(1, COL.mailed).getValue()) === HEAD_MAILED) return;
  sh.getRange(1, COL.mailed, sh.getMaxRows(), 1).setNumberFormat('yyyy-mm-dd hh:mm');
  sh.getRange(1, COL.mailed).setValue(HEAD_MAILED).setFontWeight('bold');
}

/* The Words tab, made once. After that it is Kevin's: this script only reads it. */
function buildWords_(ss) {
  var sh = ss.insertSheet(WORDS_TAB);
  sh.getRange(1, 1, WORDS.length, 3).setNumberFormat('@').setValues(WORDS);
  sh.getRange(1, 1, WORDS.length, 1).setFontWeight('bold');
  sh.getRange(1, 1, WORDS.length, 3).setWrap(true).setVerticalAlignment('top');
  sh.setColumnWidth(1, 150);
  sh.setColumnWidth(2, 420);
  sh.setColumnWidth(3, 560);
  try {                                                                   // the two switches get a drop-down, so a slip of the keys cannot leave one half-set
    sh.getRange(1, 2).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['open', 'closed'], true).setAllowInvalid(false).build());
    sh.getRange(2, 2).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['no', 'yes'], true).setAllowInvalid(false).build());
  } catch (err) {
    console.error('the drop-downs on the Words tab were not made: ' + (err && err.message ? err.message : err));
  }
  return sh;
}

function find_(sh, code) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var hit = sh.getRange(2, COL.code, last - 1, 1).createTextFinder(code).useRegularExpression(false).matchEntireCell(true).matchCase(true).findNext();
  return hit ? hit.getRow() : 0;
}

/* The row that holds an email. Capitals do not matter: an address is one address however it was typed. */
function findEmail_(sh, email) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var hit = sh.getRange(2, COL.email, last - 1, 1).createTextFinder(email).useRegularExpression(false).matchEntireCell(true).matchCase(false).findNext();
  return hit ? hit.getRow() : 0;
}

function read_(sh, row, code) {
  var cells = sh.getRange(row, 1, 1, WIDTH).getValues()[0];
  if (String(cells[COL.code - 1]) !== code) return { ok: false, error: 'server' };     // the rows moved under us (someone sorting the Sheet): the page asks again
  var cur = unpack_(cells);
  return { ok: true, rev: cur.rev, data: cur.data };
}

function unpack_(cells) {
  var data = '';
  for (var c = COL.data - 1; c < WIDTH; c++) {
    var cell = String(cells[c] == null ? '' : cells[c]);
    if (cell.indexOf(MARK) !== 0) break;
    data += cell.slice(MARK.length, cell.charAt(cell.length - 1) === TAIL ? cell.length - 1 : cell.length);
  }
  return { rev: Number(cells[COL.rev - 1]) || 0, data: data };
}

/* Words a man typed, on their way into a cell Kevin reads. Nothing that could start a formula gets through. */
function plain_(v, max) {
  return String(v == null ? '' : v)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/^[\s=+\-@']+/, '')
    .slice(0, max)
    .replace(/[\ud800-\udbff]$/, '');      // never leave half an emoji at the cut
}

/* JSON text with every character beyond plain ASCII written as its \uXXXX escape. It reads back as the same count. */
function ascii_(json) {
  return json.replace(/[\u0080-\uffff]/g, function (c) {
    return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
  });
}

function num_(v) {
  v = Math.floor(Number(v));
  return (v >= 0 && v < 1e12) ? v : 0;
}

/* ------------------------------------------------------------------
   STRIPE (only if the tracker is ever sold)
   One question, asked once per buyer: is this code a completed, paid checkout?
------------------------------------------------------------------ */
function verify_(code) {
  var cache = CacheService.getScriptCache();
  if (cache.get('no:' + code)) return { ok: false, error: 'code' };

  var minute = 'new:' + Math.floor(Date.now() / 60000);
  var seen = Number(cache.get(minute)) || 0;
  if (seen >= NEW_PER_MINUTE) return { ok: false, error: 'busy' };
  cache.put(minute, String(seen + 1), 120);

  var live = code.indexOf('cs_live_') === 0;
  var key = PropertiesService.getScriptProperties().getProperty(live ? 'STRIPE_KEY_LIVE' : 'STRIPE_KEY_TEST');
  if (!key) return { ok: false, error: 'closed' };

  var res = UrlFetchApp.fetch('https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(code), {
    method: 'get',
    headers: { Authorization: 'Bearer ' + key },
    muteHttpExceptions: true
  });
  var status = res.getResponseCode();
  if (status === 404) { cache.put('no:' + code, '1', 600); return { ok: false, error: 'code' }; }
  if (status !== 200) {
    console.error('Stripe answered ' + status + ': ' + String(res.getContentText()).slice(0, 300));
    return { ok: false, error: 'server' };
  }
  var s = JSON.parse(res.getContentText());
  var paid = s.status === 'complete' && (s.payment_status === 'paid' || s.payment_status === 'no_payment_required');
  if (!paid) return { ok: false, error: 'unpaid' };
  return { ok: true, email: (s.customer_details && s.customer_details.email) || s.customer_email || '' };
}

/* ------------------------------------------------------------------
   RUN THESE BY HAND, FROM THIS EDITOR
------------------------------------------------------------------ */

/* Run after putting a new version of this file in, before deploying it.
   Makes the tabs if they are missing, then tests the Sheet end to end with a made-up man. Sends no email. */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = sheet_();
  mailedHead_(sh);
  if (!ss.getSheetByName(WORDS_TAB)) buildWords_(ss);
  var left;
  try {
    left = MailApp.getRemainingDailyQuota();
  } catch (err) {
    throw new Error('EMAIL IS NOT ALLOWED YET. Run setup again and, when Google asks, tick every box, "Send email as you" included. (' + (err && err.message ? err.message : err) + ')');
  }
  var problems = selfTest_(sh);
  if (problems.length) {
    console.log('SELF-TEST FAILED');
    for (var i = 0; i < problems.length; i++) console.log('  ' + problems[i]);
    throw new Error('SELF-TEST FAILED: ' + problems.join(' | '));
  }
  console.log('SELF-TEST PASSED. The Trackers tab is ready.');
  var w = words_();
  console.log('Sign-ups: ' + (w.open ? 'open' : 'closed') + '. A new email ' + (w.instant ? 'opens its tracker at once, and is emailed its link' : 'is emailed its link, and shown it nowhere else') + '.');
  console.log('Email: ' + left + ' more can be sent today. Subject: ' + w.subject);
}

/* Only if the tracker is ever sold: run after pasting a Stripe key into Script Properties. Says whether Stripe accepts it. */
function checkStripe() {
  var props = PropertiesService.getScriptProperties();
  var names = ['STRIPE_KEY_TEST', 'STRIPE_KEY_LIVE'];
  for (var i = 0; i < names.length; i++) {
    var key = props.getProperty(names[i]);
    if (!key) { console.log(names[i] + ': not set'); continue; }
    var res = UrlFetchApp.fetch('https://api.stripe.com/v1/checkout/sessions?limit=1', {
      method: 'get', headers: { Authorization: 'Bearer ' + key }, muteHttpExceptions: true
    });
    var status = res.getResponseCode();
    if (status === 200) console.log(names[i] + ': OK');
    else console.log(names[i] + ': Stripe answered ' + status + '. ' + String(res.getContentText()).slice(0, 200));
  }
}

function selfTest_(sh) {
  var bad = [];
  function check(name, ok, detail) { if (!ok) bad.push(name + (detail === undefined ? '' : ' -> ' + String(detail).slice(0, 120))); }
  function locked(fn) {                    // the made-up row comes and goes under the same lock the page's requests wait on
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try { fn(); SpreadsheetApp.flush(); } finally { lock.releaseLock(); }
  }

  var code = 'cs_test_selftest' + Date.now();
  var who = 'Self.Test+(made.up)[x]@Example.invalid';    // no sign-up can ever take this address: the brackets alone rule it out
  locked(function () { sh.appendRow([code, who, '', 0, 0, 0, new Date(), '', 0, PAGE + '?k=' + code, '']); });
  try {
    var row = find_(sh, code);
    check('the made-up man has a row', row >= 2, row);
    check('codes are matched exactly, capitals and all', find_(sh, code.toUpperCase()) === 0);
    check('his row is found by his email, letter for letter, however it is capitalised', findEmail_(sh, who.toUpperCase()) === row && findEmail_(sh, who.toLowerCase()) === row, findEmail_(sh, who.toLowerCase()));
    check('and only by the whole of it', findEmail_(sh, 'made.up') === 0 && findEmail_(sh, '.*') === 0);

    /* A long count, full of the characters a spreadsheet would mistake for a formula, cut across three cells. */
    var odd = '=+-@\' ' + String.fromCharCode(233, 10003, 26085, 55357, 56613) + '  ';   // accents, a tick, kanji, an emoji, trailing spaces
    var pad = '';
    while (pad.length < 95000) pad += odd;
    var big = JSON.stringify({ v: 1, who: '=SUM(1,2)', lines: [{ id: 'a', name: '+Bassai', target: 500, kind: 'kata' }], log: [], pad: pad });
    var first = save_({ a: 'save', k: code, rev: 0, data: big, sum: { who: '=SUM(1,2)', logged: 7, of: 500, lines: 1 } });
    check('a first save is taken', first.ok === true && first.rev === 1, JSON.stringify(first).slice(0, 100));

    var back = load_(code);
    var same = false;
    try { same = JSON.stringify(JSON.parse(back.data)) === big; } catch (err) { same = false; }
    check('a long count comes back exactly as sent', back.ok === true && back.rev === 1 && same, back.data ? back.data.length + ' characters back, ' + big.length + ' sent' : JSON.stringify(back));
    check('it is stored as plain ASCII', /^[\x20-\x7e]*$/.test(back.data), back.data.replace(/[\x20-\x7e]/g, '').slice(0, 20));

    var cells = sh.getRange(row, 1, 1, WIDTH);
    var formulas = cells.getFormulas()[0].join('');
    check('nothing a man sends becomes a formula', formulas === '', formulas.slice(0, 60));
    var name = cells.getValues()[0][COL.name - 1];
    check('the name is kept as plain words', name === 'SUM(1,2)', name);

    var stale = save_({ a: 'save', k: code, rev: 0, data: '{"v":1}', sum: {} });
    check('an out-of-date save is refused and handed the newer count', stale.ok === false && stale.conflict === true && stale.rev === 1 && stale.data === back.data, JSON.stringify(stale).slice(0, 100));

    var small = '{"v":1,"who":"Kevin","lines":[],"log":[]}';
    var second = save_({ a: 'save', k: code, rev: 1, data: small, sum: { who: 'Kevin', logged: 0, of: 0, lines: 0 } });
    back = load_(code);
    check('a shorter count replaces a longer one cleanly', second.ok === true && second.rev === 2 && back.data === small && back.rev === 2, JSON.stringify(back).slice(0, 100));

    check('a save for a code with no row is refused', save_({ a: 'save', k: 'cs_test_nobodyhere12345', rev: 0, data: small, sum: {} }).error === 'code');
    check('a malformed code is refused', load_('not-a-code').error === 'code');
    check('a save that is not a count is refused', save_({ a: 'save', k: code, rev: 2, data: '=1+1', sum: {} }).error === 'request');

    /* Sign-up, as far as it can be tested without sending anyone an email. */
    check('a made-up sign-up link is refused', load_('kw_0123456789abcdef0123456789abcdef').error === 'code');
    var refused = ['', 'nobody', 'a@b', who, 'two@example.com,three@example.com', '=cmd@example.com', 'a b@example.com', 'a@example.com\nBcc: b@example.com'];
    for (var r = 0; r < refused.length; r++) {
      check('this is not taken as an email: ' + JSON.stringify(refused[r]), join_({ a: 'join', e: refused[r] }).error === 'email');
    }
    var w = words_();
    check('the email has a subject, a body and a sender name', !!w.subject && !!w.body && !!w.from && !/[\r\n]/.test(w.subject + w.from), JSON.stringify(w).slice(0, 100));
    var fresh = newCode_(sh);
    check('a new code is the right shape and no one has it', CODE_RE.test(fresh) && fresh.indexOf('kw_') === 0 && find_(sh, fresh) === 0, fresh.length);
  } catch (err) {
    bad.push('the test stopped: ' + (err && err.message ? err.message : err));
  } finally {
    locked(function () { var gone = find_(sh, code); if (gone) sh.deleteRow(gone); });
  }
  return bad;
}
