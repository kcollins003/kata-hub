"""Break Code.gs on purpose, one way at a time, and make sure test_backend.js notices each time.

    python3 breakages.py            # every breakage
    python3 breakages.py scrub      # only those with "scrub" in the name
    python3 breakages.py -v         # also name the checks that caught each one

Each breakage is a small wrong edit to a copy of Code.gs. A breakage the tests do not catch is a hole in the tests.
A breakage marked NOT APPLICABLE means Code.gs has changed and the entry here needs bringing up to date.
"""
import pathlib, shutil, subprocess, sys, tempfile
here = pathlib.Path(__file__).resolve().parent
root = here.parent
work = pathlib.Path(tempfile.mkdtemp(prefix='kw-breakages-'))
src = (here / 'Code.gs').read_text()

M = []
def m(name, old, new, count=1): M.append((name, old, new, count))

# --- who sends
m('service used with a From address but no key', "    if (key && words.sender) {", "    if (words.sender) {")
m('the key is read even when the From address cell is empty', "    if (words.sender || words.senderBad) key = serviceKey_();", "    key = serviceKey_();")
m('a bad From address is not looked at when reading the key', "    if (words.sender || words.senderBad) key = serviceKey_();", "    if (words.sender) key = serviceKey_();")
m('a bad From address with a key falls back to Google', "    if (key && words.senderBad) throw new Error('the sending service is switched on, but the From address on the Words tab is not one plain address');\n", "")
m('a bad From address stops Google even with no key', "    if (key && words.senderBad) throw new Error(", "    if (words.senderBad) throw new Error(")
m('a bad From address counts as empty', "{ if (email_(text.toLowerCase())) w.sender = text.toLowerCase(); else w.senderBad = true; }", "{ if (email_(text.toLowerCase())) w.sender = text.toLowerCase(); }")
m('From address not checked', "{ if (email_(text.toLowerCase())) w.sender = text.toLowerCase(); else w.senderBad = true; }", "{ w.sender = text.toLowerCase(); }")
m('From address: capitals refused', "{ if (email_(text.toLowerCase())) w.sender = text.toLowerCase(); else w.senderBad = true; }", "{ if (email_(text)) w.sender = text; else w.senderBad = true; }")
m('Google used instead when the service fails', "      send_(key, words, email, body);\n", "      try { send_(key, words, email, body); } catch (e9) { MailApp.sendEmail({ to: email, subject: words.subject, body: body, name: words.from }); }\n")
m('returning men fall to Google once the day is spent', "    if (key && words.sender) {", "    if (key && words.sender && !(sentBefore && sentToday_() >= SERVICE_PER_DAY)) {")
m('the email goes to the counted mailbox, not the address typed', "      send_(key, words, email, body);\n", "      send_(key, words, box, body);\n")
# --- the day's count
m('service: nothing kept back for returning men', "sentToday_() >= SERVICE_PER_DAY - MAIL_RESERVE", "sentToday_() >= SERVICE_PER_DAY")
m('service: returning men held by the reserve too', "if (!sentBefore && sentToday_() >=", "if (sentToday_() >=")
m('service: the day is never counted', "      countToday_();\n", "")
m('service: the day is counted double', "day_() + '|' + (sentToday_() + 1)", "day_() + '|' + (sentToday_() + 2)")
m('service: yesterday counts as today', "return v[0] === day_() ? (Math.floor(Number(v[1])) || 0) : 0;", "return (Math.floor(Number(v[1])) || 0);")
m('service: the tally failing fails the send', "  try {\n    PropertiesService.getScriptProperties().setProperty(SERVICE_TALLY, day_() + '|' + (sentToday_() + 1));\n  } catch (err) { /* the tally is a courtesy */ }", "  PropertiesService.getScriptProperties().setProperty(SERVICE_TALLY, day_() + '|' + (sentToday_() + 1));")
m('service: Google allowance checked on the service road', "      if (!sentBefore && sentToday_() >= SERVICE_PER_DAY - MAIL_RESERVE) throw new Error(kept);\n", "      if (!sentBefore && sentToday_() >= SERVICE_PER_DAY - MAIL_RESERVE) throw new Error(kept);\n      if (!sentBefore && MailApp.getRemainingDailyQuota() <= MAIL_RESERVE) throw new Error(kept);\n")
# --- the request
m('a refusal from the service counts as sent', "if (status >= 200 && status < 300) return;", "if (status < 500) return;")
m('a server error from the service counts as sent', "if (status >= 200 && status < 300) return;", "if (status >= 200) return;")
m('only a bare 200 counts as sent', "if (status >= 200 && status < 300) return;", "if (status === 200) return;")
m('service errors thrown raw by UrlFetch', "can arrive damaged\n    muteHttpExceptions: true,", "can arrive damaged\n    muteHttpExceptions: false,")
m('no time limit on the send', "    muteHttpExceptions: true,\n    timeoutSeconds: SERVICE_WAIT\n  });", "    muteHttpExceptions: true\n  });")
m('a time limit longer than the page waits', "var SERVICE_WAIT    = 15;", "var SERVICE_WAIT    = 150;")
m('a second recipient', "to: [email], subject: words.subject, text: body", "to: [email, words.sender], subject: words.subject, text: body")
m('a bcc', "to: [email], subject: words.subject, text: body", "to: [email], bcc: [words.sender], subject: words.subject, text: body")
m('sent as html', "subject: words.subject, text: body })", "subject: words.subject, html: body })")
m('to as a bare string', "to: [email], subject", "to: email, subject")
m('his words sent raw, not as plain ASCII', "payload: ascii_(JSON.stringify({ from: fromLine_(words), to: [email], subject: words.subject, text: body })),", "payload: JSON.stringify({ from: fromLine_(words), to: [email], subject: words.subject, text: body }),")
m('key sent without Bearer', "    headers: { Authorization: 'Bearer ' + key },\n    payload", "    headers: { Authorization: key },\n    payload")
m('wrong address for the service', "var SERVICE_URL     = 'https://api.resend.com/emails';", "var SERVICE_URL     = 'https://api.resend.com/email';")
m('the service reached over plain http', "var SERVICE_URL     = 'https://api.resend.com/emails';", "var SERVICE_URL     = 'http://api.resend.com/emails';")
m('key: pasted white space kept', "return String(PropertiesService.getScriptProperties().getProperty(SERVICE_KEY) || '').replace(/\\s+/g, '');", "return String(PropertiesService.getScriptProperties().getProperty(SERVICE_KEY) || '');")
# --- the From line
m('From line not cleaned', "payload: ascii_(JSON.stringify({ from: fromLine_(words),", "payload: ascii_(JSON.stringify({ from: words.from + ' <' + words.sender + '>',")
m('From line: comma let through', "<>\".,;:@", "<>\".;:@")
m('From line: full stop let through', "<>\".,;:@", "<>\",;:@")
m('From line: bracket let through', "\\\\()\\[\\]]/g, ' ').replace(/\\s+/g, ' ').replace(/^ | $/g, '');\n  return name ?", "\\\\()]/g, ' ').replace(/\\s+/g, ' ').replace(/^ | $/g, '');\n  return name ?")
m('From line: empty name leaves a bare space', "return name ? name + ' <' + words.sender + '>' : words.sender;", "return name + ' <' + words.sender + '>';")
# --- what reaches the log, and the answers
m('the reason for a failure is logged raw', "console.error('link email not sent: ' + scrub_(err && err.message ? err.message : err, [email, key]));", "console.error('link email not sent: ' + (err && err.message ? err.message : err));")
m('scrub: the very address and key not taken out', "    if (h.length >= 6) s = s.split(h).join(h.indexOf('@') > 0 ? '(an address)' : '(a key)');\n", "")
m('scrub: mail_ does not hand over the address and the key', "scrub_(err && err.message ? err.message : err, [email, key]));", "scrub_(err && err.message ? err.message : err));")
m('scrub: short words taken for keys', "if (h.length >= 6) s = s.split(h)", "if (h.length >= 1) s = s.split(h)")
m('scrub leaves addresses', ".replace(/[^\\s<>\"`,;:()]+@[^\\s<>\"'`,;:()]+/g, '(an address)')", "")
m('scrub: lower-case addresses only', "return s.replace(/[^\\s<>\"`,;:()]+@", "return s.replace(/[a-z]+@")
m('scrub: stops at an apostrophe before the @', "return s.replace(/[^\\s<>\"`,;:()]+@", "return s.replace(/[^\\s<>\"'`,;:()]+@")
m('scrub leaves keys', ".replace(/\\b(re|rk|sk|pk)_[A-Za-z0-9_]{6,}/g, '(a key)')", "")
m('scrub: a key with an underscore inside is cut short', "(re|rk|sk|pk)_[A-Za-z0-9_]{6,}/g", "(re|rk|sk|pk)_[A-Za-z0-9]{6,}/g")
m('scrub: ordinary words mangled', "/\\b(re|rk|sk|pk)_[A-Za-z0-9_]{6,}/g", "/(re|rk|sk|pk)_[A-Za-z0-9_]{6,}/g")
m('scrub: no limit on length', "'(a key)').slice(0, 300);", "'(a key)');")
m('said: nothing shown when the answer is not the service\'s own', "  if (!/\\S/.test(why)) why = text.replace(/<[^>]*>/g, ' ');", "")
m('said: an error page shown with its tags', "why = text.replace(/<[^>]*>/g, ' ');", "why = text;")
m('the key handed out by the web address', "service: 'kata-warrior-tracker', v: 3 });", "service: 'kata-warrior-tracker', v: 3, s: serviceKey_() });")
m('the From address handed out by the web address', "service: 'kata-warrior-tracker', v: 3 });", "service: 'kata-warrior-tracker', v: 3, f: words_().sender });")
m('version not raised', "service: 'kata-warrior-tracker', v: 3", "service: 'kata-warrior-tracker', v: 2")
# --- the Words tab
m('addWords adds rows that are there', "    if (have[key_(WORDS[j][0])]) continue;\n", "")
m('addWords misses a retyped label', "for (var i = 0; i < names.length; i++) have[key_(names[i][0])] = true;", "for (var i = 0; i < names.length; i++) have[names[i][0]] = true;")
m('addWords writes over row one', "    last++;\n    if (last > sh.getMaxRows())", "    if (last > sh.getMaxRows())")
m('addWords stops on a tab with no room', "    if (last > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), last - sh.getMaxRows());   // a tab trimmed to its last row has no room: make some\n", "")
m('setup does not add the missing row', "if (!words) buildWords_(ss); else addWords_(words);", "if (!words) buildWords_(ss);")
m('the Words tab is read only thirty rows down', "var last = Math.min(sh.getLastRow(), WORDS_ROWS);", "var last = Math.min(sh.getLastRow(), 30);")
m('the From address row has a value out of the box', "['From address',    '',  ", "['From address',    'kevin@katawarrior.com',  ")
# --- setup's lines
m('key shown by setup', "'\". Its key is in place'", "'\". Its key is ' + key")
m('setup: a badly pasted key not pointed out', "(/^re_/.test(key) ? '' : ', but does not start with re_ as its keys do: check it was pasted whole')", "''")
m('setup: sender line wrong when only the address is set', "  } else if (w.sender) {\n    console.log('Sender: still Google", "  } else if (false) {\n    console.log('Sender: still Google")
m('setup: says the service when there is no key', "  } else if (key && w.sender) {\n    console.log('Sender: the sending service", "  } else if (w.sender) {\n    console.log('Sender: the sending service")
m('setup: silent when nobody is sending', "  if (key && w.senderBad) {\n    console.log('Sender: NOBODY.", "  if (false) {\n    console.log('Sender: NOBODY.")
m('setup: no note on a bad cell while Google sends', "(w.senderBad ? ' (The From address on the Words tab is not one plain address. It changes nothing while there is no ' + SERVICE_KEY + '.)' : '')", "''")
# --- checkSender
A = "var ask = { method: 'get', muteHttpExceptions: true, timeoutSeconds: SERVICE_WAIT };"
m('checkSender changes something (POST)', A, A.replace("'get'", "'post'"))
m('checkSender sends a body', A, A.replace(" };", ", payload: '{}' };"))
m('checkSender: errors thrown raw', A, A.replace("muteHttpExceptions: true", "muteHttpExceptions: false"))
m('checkSender: no time limit', A, "var ask = { method: 'get', muteHttpExceptions: true };")
m('checkSender: a switched-off key called good', "name === 'restricted_api_key' && /send/i.test(message) && !/active|suspend/i.test(message)", "name === 'restricted_api_key'")
m('checkSender: any 401 called good', "name === 'restricted_api_key' && /send/i.test(message) && !/active|suspend/i.test(message)", "status === 401 || status === 400")
m('checkSender: any 200 called a full key', "status === 200 && j && Array.isArray(j.data)", "status === 200")
m('checkSender: shows the key', "console.log(SERVICE_KEY + ': the service knows this key, and it can only send.", "console.log(key + ': the service knows this key, and it can only send.")
m('checkSender: shows the key when refused', "console.log(SERVICE_KEY + ': the service did NOT accept this key. It answered '", "console.log(key + ': the service did NOT accept this key. It answered '")
m('checkSender: a blocked request called reachable', "name === 'missing_api_key' ? 'The service can be reached from this script.'", "true ? 'The service can be reached from this script.'")
m('checkSender: domain matched with capitals', "String(j.data[i].name).toLowerCase() === host", "String(j.data[i].name) === host")
m('checkSender: any status called verified', "else if (found === 'verified') console.log", "else if (found) console.log")
m('checkSender: refusal shown raw', "It answered ' + status + '. ' + scrub_(said_(res), [key]));\n    console.log('Check it was pasted whole", "It answered ' + status + '. ' + said_(res));\n    console.log('Check it was pasted whole")
m('checkSender: refusal scrubbed without the very key', "It answered ' + status + '. ' + scrub_(said_(res), [key]));\n    console.log('Check it was pasted whole", "It answered ' + status + '. ' + scrub_(said_(res)));\n    console.log('Check it was pasted whole")
m('checkSender: last line ignores the From address', "  else console.log(key && w.sender ? 'As things stand, the sending service", "  else console.log(key ? 'As things stand, the sending service")
m('checkSender: silent when nobody is sending', "  if (key && w.senderBad) console.log('As things stand, NO link email is sent", "  if (false) console.log('As things stand, NO link email is sent")
m('checkSender: no key sent when there is one', "if (key) ask.headers = { Authorization: 'Bearer ' + key };", "")
m('checkSender: unreachable service throws', "  } catch (err) {\n    console.log('The service could not be reached from this script: ' + scrub_(err && err.message ? err.message : err, [key]));\n    return;\n  }", "  } catch (err) {\n    throw err;\n  }")
m('checkSender: writes the tally', "  var w = words_();\n  var key = serviceKey_();\n  console.log(w.sender ? 'From address: '", "  var w = words_();\n  var key = serviceKey_();\n  countToday_();\n  console.log(w.sender ? 'From address: '")
m('checkSender: a bad cell reported as none', "(w.senderBad ? 'From address: what is on the Words tab is not one plain address.' : 'From address: none yet on the Words tab.')", "'From address: none yet on the Words tab.'")

only = [a for a in sys.argv[1:] if a != '-v']
bad = []
for i, (name, old, new, count) in enumerate(M):
    if only and not any(o in name for o in only): continue
    if src.count(old) != count:
        print('!! NOT APPLICABLE (%d found): %s' % (src.count(old), name)); bad.append(name); continue
    d = work / 'case'
    if d.exists(): shutil.rmtree(d)
    (d / 'backend').mkdir(parents=True)
    for f in ('fake_gas.js', 'test_backend.js'): shutil.copy(here / f, d / 'backend' / f)
    for b in ('backup-v1-paid', 'backup-v2-deployed'): shutil.copytree(root / b, d / b)
    (d / 'backend' / 'Code.gs').write_text(src.replace(old, new))
    r = subprocess.run(['node', 'test_backend.js'], cwd=d / 'backend', capture_output=True, text=True, timeout=300)
    out = r.stdout + r.stderr
    fails = [l[5:] for l in out.splitlines() if l.startswith('FAIL ')]
    crashed = 'ALL PASSED' not in out and not fails
    if 'ALL PASSED' in out:
        print('!! SURVIVED: ' + name); bad.append(name)
    else:
        print('caught (%2d) %s%s' % (len(fails), name, '  [stopped: ' + out.strip().splitlines()[-1][:110] + ']' if crashed else ''))
        if '-v' in sys.argv: print('      ' + '\n      '.join(f[:150] for f in fails[:6]))
print()
print('%d breakages tried, %d not caught: %s' % (len([1 for n in M if not only or any(o in n[0] for o in only)]), len(bad), bad))
shutil.rmtree(work, ignore_errors=True)
sys.exit(1 if bad else 0)
