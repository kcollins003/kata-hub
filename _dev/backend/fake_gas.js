/* A stand-in for the Google services Code.gs calls, strict enough to catch the mistakes that matter:
   a cell over 50,000 characters throws, any text that Sheets would read as a formula is recorded as a hazard,
   and an email is refused unless it goes to exactly one plain address with no line break in its headers. */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');

function makeWorld(file) {
  const world = {
    sheets: {},            // name -> Sheet
    props: {},             // script properties
    cache: {},             // key -> {v, until}
    hazards: [],           // every write Sheets would have treated as a formula
    stripe: { sessions: {}, keys: { rk_test_good: 'test', rk_live_good: 'live' }, calls: [], fail: 0 },
    send: { keys: { re_goodKey1234567890: 'katawarrior.com' }, sent: [], calls: [], quota: 100, fail: 0, down: false,     // the sending service: key -> the domain it may send as
            full: {}, dead: {}, domains: [{ name: 'katawarrior.com', status: 'verified' }], checks: [], odd: null },       // full: keys that may do anything; dead: keys it knows but will not use; checks: every question asked of /domains
    fetched: [],           // every address the script reached out to
    mail: { sent: [], quota: 100, fail: '', denied: false },   // every email sent; how many more today; a fault to raise instead of sending; permission never given
    unflushed: 0,          // times a lock was let go with a write still waiting to reach the Sheet
    wroteInLock: false,
    afterFind: null,       // run once, straight after the next search finds a row: someone rearranging the Sheet at the worst moment
    uuids: [],             // if not empty, the next "random" ids, in order
    cacheFail: '',         // cache keys starting with this cannot be written
    validations: {},
    locks: 0, lockWaits: 0,
    logs: [], errors: [],
    now: null,             // set to a number to freeze the clock
    skew: 0                // or leave it running and push it forward by this many milliseconds
  };
  const clock = () => (world.now == null ? Date.now() + world.skew : world.now);
  class ClockDate extends Date { constructor(...a) { if (a.length === 0) super(clock()); else super(...a); } static now() { return clock(); } }   // so Code.gs reads the same clock the tests set

  class Sheet {
    constructor(name) { this.name = name; this.rows = []; this.maxCols = 26; this.maxRows = 1000; this.formats = {}; this.frozen = 0; this.hidden = []; this.formulas = {}; }
    getMaxColumns() { return this.maxCols; }
    getMaxRows() { return this.maxRows; }
    insertColumnsAfter(col, n) { this.maxCols += n; }
    insertRowsAfter(row, n) { if (!(row >= 1) || row > this.maxRows || !(n >= 1)) throw new Error('insertRowsAfter out of range ' + [row, n]); this.maxRows += n; }
    getLastRow() { for (let r = this.rows.length; r >= 1; r--) { if ((this.rows[r - 1] || []).some(v => v !== '' && v != null)) return r; } return 0; }
    getLastColumn() { let m = 0; this.rows.forEach(row => (row || []).forEach((v, i) => { if (v !== '' && v != null) m = Math.max(m, i + 1); })); return m; }
    setFrozenRows(n) { this.frozen = n; }
    setColumnWidth(col, w) { if (!(col >= 1) || !(w > 0)) throw new Error('bad column width'); this.widths = this.widths || {}; this.widths[col] = w; return this; }
    hideColumns(col, n) { this.hidden.push([col, n]); }
    deleteRow(n) { if (n < 1 || n > this.rows.length) throw new Error('deleteRow out of range ' + n); this.rows.splice(n - 1, 1); if (world.locks > 0) world.wroteInLock = true; }
    appendRow(arr) { const r = this.getLastRow() + 1; arr.forEach((v, i) => this._put(r, i + 1, v)); return this; }
    getRange(row, col, numRows, numCols) {
      numRows = numRows == null ? 1 : numRows; numCols = numCols == null ? 1 : numCols;
      if (!(row >= 1) || !(col >= 1) || !(numRows >= 1) || !(numCols >= 1)) throw new Error('bad range ' + [row, col, numRows, numCols]);
      if (col + numCols - 1 > this.maxCols) throw new Error('Those columns are out of bounds.');
      if (row + numRows - 1 > this.maxRows) throw new Error('Those rows are out of bounds.');
      return new Range(this, row, col, numRows, numCols);
    }
    _get(r, c) { const row = this.rows[r - 1]; const v = row ? row[c - 1] : ''; return v == null ? '' : (v instanceof Date ? new Date(v.getTime()) : v); }
    _put(r, c, v) {
      if (c > this.maxCols) throw new Error('Those columns are out of bounds.');
      while (this.rows.length < r) this.rows.push([]);
      if (world.locks > 0) world.wroteInLock = true;
      const text = this.formats[c] === '@';
      let stored = v;
      if (typeof v === 'string') {
        if (v.length > 50000) throw new Error('Your input contains more than the maximum of 50000 characters in a single cell.');
        v = v.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(^|[^\ud800-\udbff])[\udc00-\udfff]/g, (m, lead) => (lead || '') + '\ufffd');   // half an emoji does not survive storage
        v = v.replace(/\s+$/, '');                                               // assume the worst: trailing space is trimmed
        if (/^[=+\-@]/.test(v)) { world.hazards.push({ sheet: this.name, row: r, col: c, value: v.slice(0, 60) }); this.formulas[r + ':' + c] = v; stored = '#HAZARD'; }
        else if (v.charAt(0) === "'") stored = v.slice(1);                       // Sheets swallows a leading apostrophe
        else if (!text && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) stored = Number(v);    // and turns number-like text into numbers
        if (stored !== '#HAZARD') delete this.formulas[r + ':' + c];
      } else {
        delete this.formulas[r + ':' + c];
      }
      this.rows[r - 1][c - 1] = stored;
    }
  }

  class Range {
    constructor(sh, row, col, nr, nc) { this.sh = sh; this.row = row; this.col = col; this.nr = nr; this.nc = nc; }
    getRow() { return this.row; }
    getValues() { const out = []; for (let r = 0; r < this.nr; r++) { const line = []; for (let c = 0; c < this.nc; c++) line.push(this.sh._get(this.row + r, this.col + c)); out.push(line); } return out; }
    getFormulas() { const out = []; for (let r = 0; r < this.nr; r++) { const line = []; for (let c = 0; c < this.nc; c++) line.push(this.sh.formulas[(this.row + r) + ':' + (this.col + c)] || ''); out.push(line); } return out; }
    setValues(v) {
      if (!Array.isArray(v) || v.length !== this.nr || v.some(line => !Array.isArray(line) || line.length !== this.nc)) throw new Error('The number of rows or columns in the data does not match the range.');
      for (let r = 0; r < this.nr; r++) for (let c = 0; c < this.nc; c++) this.sh._put(this.row + r, this.col + c, v[r][c]);
      return this;
    }
    setValue(v) { for (let r = 0; r < this.nr; r++) for (let c = 0; c < this.nc; c++) this.sh._put(this.row + r, this.col + c, v); return this; }
    setNumberFormat(f) { for (let c = 0; c < this.nc; c++) this.sh.formats[this.col + c] = f; return this; }
    setFontWeight() { return this; }
    setWrap() { return this; }
    setDataValidation(rule) { if (!rule || !rule.built) throw new Error('fake: setDataValidation needs a built rule'); world.validations[this.sh.name + '!' + this.row + ':' + this.col] = rule; return this; }
    setVerticalAlignment() { return this; }
    getValue() { return this.sh._get(this.row, this.col); }
    getDisplayValues() { return this.getValues().map(line => line.map(v => (v instanceof Date ? v.toISOString() : String(v == null ? '' : v)))); }
    createTextFinder(text) {
      const range = this; let entire = false, cased = false;
      return {
        matchEntireCell(b) { entire = b; return this; },
        matchCase(b) { cased = b; return this; },
        useRegularExpression(b) { if (b) throw new Error('fake: regular-expression search is not modelled'); return this; },
        findNext() {
          for (let r = 0; r < range.nr; r++) for (let c = 0; c < range.nc; c++) {
            let cell = String(range.sh._get(range.row + r, range.col + c)), want = String(text);
            if (!cased) { cell = cell.toLowerCase(); want = want.toLowerCase(); }
            if (entire ? cell === want : cell.indexOf(want) >= 0) {
              const hit = new Range(range.sh, range.row + r, range.col + c, 1, 1);
              if (world.afterFind) { const f = world.afterFind; world.afterFind = null; f(hit); }
              return hit;
            }
          }
          return null;
        }
      };
    }
  }

  const ss = {
    getSheetByName(name) { return world.sheets[name] || null; },
    insertSheet(name) { if (world.sheets[name]) throw new Error('sheet exists'); world.sheets[name] = new Sheet(name); return world.sheets[name]; }
  };

  function stripeFetch(url, opts) {
    const auth = ((opts && opts.headers && opts.headers.Authorization) || '').replace(/^Bearer\s+/, '');
    world.stripe.calls.push({ url, key: auth });
    const reply = (code, body) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(body) });
    if (world.stripe.fail) return reply(world.stripe.fail, { error: { message: 'simulated' } });
    const mode = world.stripe.keys[auth];
    if (!mode) return reply(401, { error: { message: 'Invalid API Key provided' } });
    const m = /^https:\/\/api\.stripe\.com\/v1\/checkout\/sessions(?:\/([^?]+))?(\?.*)?$/.exec(url);
    if (!m) return reply(404, { error: { message: 'Unrecognized request URL' } });
    if (!m[1]) return reply(200, { object: 'list', data: [] });
    const id = decodeURIComponent(m[1]);
    const s = world.stripe.sessions[id];
    const idMode = id.indexOf('cs_live_') === 0 ? 'live' : 'test';
    if (!s || idMode !== mode) return reply(404, { error: { code: 'resource_missing', message: 'No such checkout.session: ' + id } });
    return reply(200, Object.assign({ id: id, object: 'checkout.session', livemode: mode === 'live', mode: 'payment' }, s));
  }

  /* The sending service, as its documentation describes it: one POST of JSON, a Bearer key, 200 with an id or an error with a name and a message. */
  const FETCH_OPTIONS = ['method', 'contentType', 'headers', 'payload', 'muteHttpExceptions', 'timeoutSeconds'];
  const knownOptions = o => { const odd = Object.keys(o).filter(k => FETCH_OPTIONS.indexOf(k) < 0); if (odd.length) throw new Error('fake: UrlFetchApp has no option called ' + odd.join(',')); if ('timeoutSeconds' in o && !(Number.isInteger(o.timeoutSeconds) && o.timeoutSeconds >= 1 && o.timeoutSeconds <= 360)) throw new Error('fake: timeoutSeconds must be a whole number of seconds, 1 to 360'); };
  function serviceFetch(url, opts) {
    const o = opts || {};
    knownOptions(o);
    const reply = (code, body) => {
      const text = JSON.stringify(body);
      if (code >= 400 && !o.muteHttpExceptions) throw new Error('Request failed for https://api.resend.com returned code ' + code + '. Truncated server response: ' + text);
      return { getResponseCode: () => code, getContentText: () => text };
    };
    const bearer = /^Bearer (\S+)$/.exec((o.headers && o.headers.Authorization) || '');     // anything else in that header is no key at all
    const key = bearer ? bearer[1] : '';
    let msg = null; try { msg = JSON.parse(o.payload); } catch (e) { msg = null; }
    world.send.calls.push({ url: url, method: o.method, type: o.contentType, key: key, msg: msg, raw: o.payload, timeout: o.timeoutSeconds, headers: Object.keys(o.headers || {}).sort().join(','), mute: !!o.muteHttpExceptions });
    if (world.send.down) throw new Error('Address unavailable: ' + url);
    if (world.send.stall) throw new Error('Request to ' + url + ' timed out after ' + (o.timeoutSeconds || 360) + ' seconds');
    if (world.send.oddSend) { const [code, text] = world.send.oddSend; if (code >= 400 && !o.muteHttpExceptions) throw new Error('Request failed for https://api.resend.com returned code ' + code + '. Truncated server response: ' + text); return { getResponseCode: () => code, getContentText: () => text }; }   // an answer that is not the service's own
    if (String(o.method).toLowerCase() !== 'post') return reply(405, { statusCode: 405, name: 'method_not_allowed', message: 'Method is not allowed for the requested path.' });
    if (!key) return reply(401, { statusCode: 401, name: 'missing_api_key', message: 'Missing API Key' });
    const domain = world.send.keys[key];
    if (world.send.dead[key]) return reply(403, { statusCode: 403, name: 'restricted_api_key', message: 'API key is not active' });
    if (!domain) return reply(401, { statusCode: 401, name: 'validation_error', message: 'API key is invalid' });
    if (o.contentType !== 'application/json' || !msg || typeof msg !== 'object') return reply(422, { statusCode: 422, name: 'missing_required_field', message: 'The request body is not JSON.' });
    const extra = Object.keys(msg).filter(k => ['from', 'to', 'subject', 'text'].indexOf(k) < 0);
    if (extra.length) throw new Error('fake service: unexpected field ' + extra.join(','));              // no cc, no bcc, no html, no reply_to, no attachments
    const one = a => typeof a === 'string' && /^[^\s,;<>"()\\]+@[^\s,;<>"'()\\@]+$/.test(a);
    if (!Array.isArray(msg.to) || msg.to.length !== 1 || !one(msg.to[0])) throw new Error('fake service: "to" must be exactly one plain address, got ' + JSON.stringify(msg.to));
    if (typeof msg.subject !== 'string' || !msg.subject || /[\r\n]/.test(msg.subject)) throw new Error('fake service: a subject that could be bent');
    if (typeof msg.text !== 'string' || !msg.text) throw new Error('fake service: no text');
    const m = /^(?:([^<>"\r\n,;:@\\()\[\]]*) <([^<>\s]+)>|([^<>\s]+))$/.exec(String(msg.from));
    const from = m ? (m[2] || m[3]) : '';
    if (!m || !one(from)) return reply(422, { statusCode: 422, name: 'validation_error', message: 'Invalid `from` field. The email address needs to follow the `email@example.com` or `Name <email@example.com>` format.' });
    if (from.split('@')[1] !== domain) return reply(403, { statusCode: 403, name: 'validation_error', message: 'The ' + from.split('@')[1] + ' domain is not verified. Please, add and verify your domain on https://resend.com/domains' });
    if (world.send.fail) return reply(world.send.fail, { statusCode: world.send.fail, name: world.send.fail === 429 ? 'rate_limit_exceeded' : 'application_error', message: 'Could not deliver to ' + msg.to[0] + ' using key ' + key });   // a message that says too much, to test what reaches the log
    if (world.send.quota < 1) return reply(429, { statusCode: 429, name: 'daily_quota_exceeded', message: 'You have reached your daily email sending quota.' });
    world.send.quota--;
    world.send.sent.push({ from: msg.from, fromAddress: from, to: msg.to[0], subject: msg.subject, body: msg.text, at: clock() });
    return reply(world.send.okCode || 200, { id: require('crypto').randomUUID() });
  }
  /* GET /domains: the one question checkSender asks. A key that can only send is told so; that is how such a key is known to be good. */
  function domainsFetch(url, opts) {
    const o = opts || {};
    knownOptions(o);
    const reply = (code, body) => {
      const text = typeof body === 'string' ? body : JSON.stringify(body);
      if (code >= 400 && !o.muteHttpExceptions) throw new Error('Request failed for https://api.resend.com returned code ' + code + '. Truncated server response: ' + text);
      return { getResponseCode: () => code, getContentText: () => text };
    };
    const bearer = /^Bearer (\S+)$/.exec((o.headers && o.headers.Authorization) || '');     // anything else in that header is no key at all
    const key = bearer ? bearer[1] : '';
    world.send.checks.push({ url: url, method: String(o.method || 'get').toLowerCase(), key: key, timeout: o.timeoutSeconds, headers: Object.keys(o.headers || {}).sort().join(','), mute: !!o.muteHttpExceptions, payload: o.payload === undefined ? null : o.payload });
    if (world.send.down) throw new Error('Address unavailable: ' + url);
    if (world.send.odd) return reply(world.send.odd[0], world.send.odd[1]);
    if (String(o.method || 'get').toLowerCase() !== 'get') throw new Error('fake service: checkSender must only ever ask, never change anything');
    if (!key) return reply(401, { statusCode: 401, message: 'Missing API Key', name: 'missing_api_key' });
    if (world.send.dead[key]) return reply(403, { statusCode: 403, message: 'API key is not active', name: 'restricted_api_key' });
    if (world.send.full[key]) return reply(200, { object: 'list', has_more: false, data: world.send.domains.map((d, i) => ({ id: 'd91cd9bd-1176-453e-8fc1-35364d38020' + i, name: d.name, status: d.status, created_at: '2026-10-05 18:00:00.000000+00', region: 'us-east-1', open_tracking: false, click_tracking: false, capabilities: { sending: 'enabled', receiving: 'disabled' } })) });
    if (world.send.keys[key]) return reply(401, { statusCode: 401, message: 'This API key is restricted to only send emails', name: 'restricted_api_key' });
    return reply(400, { statusCode: 400, message: 'API key is invalid', name: 'validation_error' });
  }

  function fetchAny(url, opts) {
    world.fetched.push(String(url).split('/').slice(0, 3).join('/'));
    if (/^https:\/\/api\.stripe\.com\//.test(url)) return stripeFetch(url, opts);
    if (url === 'https://api.resend.com/emails') return serviceFetch(url, opts);
    if (url === 'https://api.resend.com/domains') return domainsFetch(url, opts);
    throw new Error('fake: the script reached out to somewhere it should not: ' + url);
  }

  const sandbox = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      flush() { world.wroteInLock = false; },
      newDataValidation() {
        const rule = { list: null, dropdown: null, allowInvalid: true, built: false };
        return { requireValueInList(v, show) { if (!Array.isArray(v) || !v.length) throw new Error('fake: a list is needed'); rule.list = v.slice(); rule.dropdown = show; return this; }, setAllowInvalid(b) { rule.allowInvalid = b; return this; }, build() { if (!rule.list) throw new Error('fake: a rule with no list'); rule.built = true; return rule; } };
      }
    },
    LockService: { getScriptLock: () => ({
      waitLock() { world.locks++; world.lockWaits++; world.wroteInLock = false; if (world.locks > 1) throw new Error('lock taken twice'); },
      releaseLock() { if (world.wroteInLock) world.unflushed++; world.wroteInLock = false; world.locks--; }     // Google: flush before letting the lock go
    }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty(k) { if (world.propsDown) throw new Error('Service error: Properties'); return (k in world.props ? world.props[k] : null); },
      setProperty(k, v) { if (world.propsDown || world.propsStuck) throw new Error('Service error: Properties'); if (typeof v !== 'string') throw new Error('fake: a property value must be text'); world.props[k] = v; }
    }) },
    CacheService: { getScriptCache: () => ({
      get(k) { if (k.length > 250) throw new Error('cache key too long'); const e = world.cache[k]; return (e && e.until > clock()) ? e.v : null; },
      put(k, v, ttl) {
        if (k.length > 250) throw new Error('cache key too long');
        if (ttl !== undefined && !(ttl > 0 && ttl <= 21600)) throw new Error('cache: expiration must be between 1 and 21600 seconds');
        if (world.cacheFail && k.indexOf(world.cacheFail) === 0) throw new Error('cache: simulated fault');
        world.cache[k] = { v: String(v), until: clock() + (ttl || 600) * 1000 };
      }
    }) },
    UrlFetchApp: { fetch: fetchAny },
    MailApp: {
      getRemainingDailyQuota() { if (world.mail.denied) throw new Error('You do not have permission to call MailApp.getRemainingDailyQuota. Required permissions: https://www.googleapis.com/auth/script.send_mail'); return world.mail.quota; },
      sendEmail(m) {
        if (arguments.length !== 1 || !m || typeof m !== 'object') throw new Error('fake MailApp: sendEmail takes one message');
        const extra = Object.keys(m).filter(k => ['to', 'subject', 'body', 'name'].indexOf(k) < 0);
        if (extra.length) throw new Error('fake MailApp: unexpected ' + extra.join(','));            // no cc, no bcc, no html, no reply-to
        ['to', 'subject', 'body', 'name'].forEach(k => { if (typeof m[k] !== 'string' || !m[k]) throw new Error('fake MailApp: missing ' + k); });
        if (world.mail.denied) throw new Error('You do not have permission to call MailApp.sendEmail. Required permissions: https://www.googleapis.com/auth/script.send_mail');
        if (!/^[^\s,;<>"()\\]+@[^\s,;<>"'()\\@]+$/.test(m.to)) throw new Error('Invalid email: ' + m.to);        // one plain address
        if (/[\r\n]/.test(m.subject) || /[\r\n<>"]/.test(m.name)) throw new Error('fake MailApp: a header that could be bent');
        if (world.mail.fail) throw new Error(world.mail.fail);
        if (world.mail.quota < 1) throw new Error('Service invoked too many times for one day: email.');
        world.mail.quota--;
        world.mail.sent.push({ to: m.to, subject: m.subject, body: m.body, name: m.name, at: clock() });
      }
    },
    Utilities: { getUuid: () => (world.uuids.length ? world.uuids.shift() : require('crypto').randomUUID()) },
    ContentService: { MimeType: { JSON: 'JSON' }, createTextOutput: text => ({ text: text, mime: null, setMimeType(m) { this.mime = m; return this; }, getContent() { return this.text; } }) },
    console: { log: (...a) => world.logs.push(a.join(' ')), error: (...a) => world.errors.push(a.join(' ')) },
    Date: ClockDate, JSON: JSON, Math: Math, String: String, Number: Number, Array: Array, Object: Object, Error: Error, RegExp: RegExp, encodeURIComponent, decodeURIComponent
  };
  vm.createContext(sandbox);
  const src = fs.readFileSync(file || path.join(__dirname, 'Code.gs'), 'utf8');      // a test may run an older copy of the script
  vm.runInContext(src, sandbox, { filename: 'Code.gs' });
  world.gs = sandbox;
  world.answers = [];        // every answer the web address gave, word for word
  const answer = out => { const text = out.getContent(); world.answers.push(text); return JSON.parse(text); };
  world.post = body => answer(sandbox.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body), type: 'text/plain' } }));
  world.get = () => answer(sandbox.doGet({ parameter: {} }));
  world.tab = () => world.sheets.Trackers;
  return world;
}

module.exports = { makeWorld };
