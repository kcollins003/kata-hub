/* A stand-in for the Google services Code.gs calls, strict enough to catch the mistakes that matter:
   a cell over 50,000 characters throws, and any text that Sheets would read as a formula is recorded as a hazard. */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');

function makeWorld() {
  const world = {
    sheets: {},            // name -> Sheet
    props: {},             // script properties
    cache: {},             // key -> {v, until}
    hazards: [],           // every write Sheets would have treated as a formula
    stripe: { sessions: {}, keys: { rk_test_good: 'test', rk_live_good: 'live' }, calls: [], fail: 0 },
    locks: 0, lockWaits: 0,
    logs: [], errors: [],
    now: null              // set to a number to freeze the clock
  };
  const clock = () => (world.now == null ? Date.now() : world.now);
  class ClockDate extends Date { constructor(...a) { if (a.length === 0) super(clock()); else super(...a); } static now() { return clock(); } }   // so Code.gs reads the same clock the tests set

  class Sheet {
    constructor(name) { this.name = name; this.rows = []; this.maxCols = 26; this.maxRows = 1000; this.formats = {}; this.frozen = 0; this.hidden = []; this.formulas = {}; }
    getMaxColumns() { return this.maxCols; }
    getMaxRows() { return this.maxRows; }
    insertColumnsAfter(col, n) { this.maxCols += n; }
    getLastRow() { for (let r = this.rows.length; r >= 1; r--) { if ((this.rows[r - 1] || []).some(v => v !== '' && v != null)) return r; } return 0; }
    getLastColumn() { let m = 0; this.rows.forEach(row => (row || []).forEach((v, i) => { if (v !== '' && v != null) m = Math.max(m, i + 1); })); return m; }
    setFrozenRows(n) { this.frozen = n; }
    hideColumns(col, n) { this.hidden.push([col, n]); }
    deleteRow(n) { if (n < 1 || n > this.rows.length) throw new Error('deleteRow out of range ' + n); this.rows.splice(n - 1, 1); }
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
    createTextFinder(text) {
      const range = this; let entire = false, cased = false;
      return {
        matchEntireCell(b) { entire = b; return this; },
        matchCase(b) { cased = b; return this; },
        findNext() {
          for (let r = 0; r < range.nr; r++) for (let c = 0; c < range.nc; c++) {
            let cell = String(range.sh._get(range.row + r, range.col + c)), want = String(text);
            if (!cased) { cell = cell.toLowerCase(); want = want.toLowerCase(); }
            if (entire ? cell === want : cell.indexOf(want) >= 0) return new Range(range.sh, range.row + r, range.col + c, 1, 1);
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

  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    LockService: { getScriptLock: () => ({ waitLock() { world.locks++; world.lockWaits++; if (world.locks > 1) throw new Error('lock taken twice'); }, releaseLock() { world.locks--; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in world.props ? world.props[k] : null), setProperty: (k, v) => { world.props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({
      get(k) { if (k.length > 250) throw new Error('cache key too long'); const e = world.cache[k]; return (e && e.until > clock()) ? e.v : null; },
      put(k, v, ttl) { if (k.length > 250) throw new Error('cache key too long'); world.cache[k] = { v: String(v), until: clock() + (ttl || 600) * 1000 }; }
    }) },
    UrlFetchApp: { fetch: stripeFetch },
    ContentService: { MimeType: { JSON: 'JSON' }, createTextOutput: text => ({ text: text, mime: null, setMimeType(m) { this.mime = m; return this; }, getContent() { return this.text; } }) },
    console: { log: (...a) => world.logs.push(a.join(' ')), error: (...a) => world.errors.push(a.join(' ')) },
    Date: ClockDate, JSON: JSON, Math: Math, String: String, Number: Number, Array: Array, Object: Object, Error: Error, RegExp: RegExp, encodeURIComponent, decodeURIComponent
  };
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8');
  vm.runInContext(src, sandbox, { filename: 'Code.gs' });
  world.gs = sandbox;
  world.post = body => JSON.parse(sandbox.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body), type: 'text/plain' } }).getContent());
  world.get = () => JSON.parse(sandbox.doGet({ parameter: {} }).getContent());
  world.tab = () => world.sheets.Trackers;
  return world;
}

module.exports = { makeWorld };
