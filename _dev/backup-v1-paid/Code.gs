/**
 * @OnlyCurrentDoc
 *
 * KATA WARRIOR - TRACKER BACKEND
 *
 * This script lives inside one Google Sheet. That Sheet is where every buyer's count is kept:
 * one row per buyer, on the tab called "Trackers".
 * The page at katawarrior.com/tracker.html talks to this script. Nothing else does.
 *
 * NO SECRETS IN THIS FILE. The two Stripe keys go in
 *   Project Settings (the gear on the left) > Script Properties
 *     STRIPE_KEY_TEST   a restricted key from Stripe test mode   (starts rk_test_)
 *     STRIPE_KEY_LIVE   a restricted key from Stripe live mode   (starts rk_live_)
 *   Each key needs one permission only: Checkout Sessions, Read.
 *
 * AFTER ANY CHANGE TO THIS FILE:
 *   Deploy > Manage deployments > Edit (the pencil) > Version: New version > Deploy.
 *   That keeps the same web address. "New deployment" makes a new address and breaks the page.
 */

var TAB        = 'Trackers';
var PAGE       = 'https://katawarrior.com/tracker.html';
var HEAD       = ['Code', 'Email', 'Name', 'Logged', 'Of', 'Lines', 'Started', 'Last saved', 'Saves', 'Link', 'Data'];
var COL        = { code: 1, email: 2, name: 3, logged: 4, of: 5, lines: 6, started: 7, saved: 8, rev: 9, link: 10, data: 11 };
var CHUNK      = 40000;                    // Sheets holds 50,000 characters in a cell, so a count is cut into pieces
var MAX_CHUNKS = 10;                       // 400,000 characters in all: roughly 5,000 log entries for one buyer
var WIDTH      = COL.data + MAX_CHUNKS - 1;
var MARK       = 'kw1:';                   // every data cell starts with this, so Sheets always reads it as plain text
var TAIL       = ';';                      // and ends with this, so nothing at the end of a piece can be trimmed away
var CODE_RE    = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/;   // a Stripe checkout id. It is the buyer's private key.
var NEW_PER_MINUTE = 40;                   // most never-seen codes checked with Stripe in one minute

/* ------------------------------------------------------------------
   THE WEB ADDRESS
   Opening the address in a browser answers with a short "ok".
   The page sends everything else as a POST: load a count, or save one.
------------------------------------------------------------------ */
function doGet() {
  return out_({ ok: true, service: 'kata-warrior-tracker', v: 1 });
}

function doPost(e) {
  var answer;
  try {
    var raw = (e && e.postData && e.postData.contents) || '{}';
    if (raw.length > 1000000) return out_({ ok: false, error: 'size' });      // far more than any count: not worth reading
    var body = JSON.parse(raw);
    if (body.a === 'load') answer = load_(String(body.k || ''));
    else if (body.a === 'save') answer = save_(body);
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
   LOAD
   A code this Sheet has seen before is answered from its row.
   A code it has never seen is checked with Stripe once. If Stripe says it is a paid checkout,
   the buyer gets a row of his own, and from then on the row is the proof.
------------------------------------------------------------------ */
function load_(code) {
  if (!CODE_RE.test(code)) return { ok: false, error: 'code' };
  var sh = sheet_();
  var row = find_(sh, code);
  if (row) return read_(sh, row);

  var paid = verify_(code);
  if (!paid.ok) return paid;

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    row = find_(sh, code);                 // two phones opening the same link at once make one row, not two
    if (!row) sh.appendRow([code, plain_(paid.email, 120), '', 0, 0, 0, new Date(), '', 0, PAGE + '?k=' + code, '']);
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
  if (sh.getMaxColumns() < WIDTH) sh.insertColumnsAfter(sh.getMaxColumns(), WIDTH - sh.getMaxColumns());
  return sh;
}

function build_(ss) {
  var sh = ss.insertSheet(TAB);
  if (sh.getMaxColumns() < WIDTH) sh.insertColumnsAfter(sh.getMaxColumns(), WIDTH - sh.getMaxColumns());
  sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]).setFontWeight('bold');
  sh.setFrozenRows(1);
  var rows = sh.getMaxRows();
  sh.getRange(1, COL.code, rows, 3).setNumberFormat('@');                 // code, email, name: always plain text
  sh.getRange(1, COL.link, rows, 1 + MAX_CHUNKS).setNumberFormat('@');    // link and data: always plain text
  sh.getRange(1, COL.started, rows, 2).setNumberFormat('yyyy-mm-dd hh:mm');
  sh.hideColumns(COL.data, MAX_CHUNKS);                                   // the data is for the page, not for reading
  return sh;
}

function find_(sh, code) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var hit = sh.getRange(2, COL.code, last - 1, 1).createTextFinder(code).matchEntireCell(true).matchCase(true).findNext();
  return hit ? hit.getRow() : 0;
}

function read_(sh, row) {
  var cur = unpack_(sh.getRange(row, 1, 1, WIDTH).getValues()[0]);
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

/* Words a buyer typed, on their way into a cell Kevin reads. Nothing that could start a formula gets through. */
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
   STRIPE
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

/* Run once, before the first deploy. Makes the Trackers tab, then tests the Sheet end to end with a made-up buyer. */
function setup() {
  var sh = sheet_();
  var problems = selfTest_(sh);
  if (problems.length) {
    console.log('SELF-TEST FAILED');
    for (var i = 0; i < problems.length; i++) console.log('  ' + problems[i]);
    throw new Error('SELF-TEST FAILED: ' + problems.join(' | '));
  }
  console.log('SELF-TEST PASSED. The Trackers tab is ready.');
}

/* Run after pasting a Stripe key into Script Properties. Says whether Stripe accepts it. */
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

  var code = 'cs_test_selftest' + Date.now();
  sh.appendRow([code, 'selftest@example.com', '', 0, 0, 0, new Date(), '', 0, PAGE + '?k=' + code, '']);
  try {
    var row = find_(sh, code);
    check('the made-up buyer has a row', row >= 2, row);
    check('codes are matched exactly, capitals and all', find_(sh, code.toUpperCase()) === 0);

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
    check('nothing a buyer sends becomes a formula', formulas === '', formulas.slice(0, 60));
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
  } catch (err) {
    bad.push('the test stopped: ' + (err && err.message ? err.message : err));
  } finally {
    var gone = find_(sh, code);
    if (gone) sh.deleteRow(gone);
  }
  return bad;
}
