/* A local stand-in for the deployed backend, for testing the page end to end.
   It runs the real Code.gs (through fake_gas.js) and answers over HTTP the way an Apps Script web app does:
   every request is answered with a 302 to a second host, which serves the JSON with open CORS.
   A preflight (OPTIONS) is refused, as Apps Script refuses it, so the page must never cause one.

   node mock_server.js <pageDir>
     page     http://localhost:8790/tracker.html
     backend  http://localhost:8787/macros/s/FAKE/exec
     control  http://localhost:8789/...            (tests only)
*/
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { makeWorld } = require('./fake_gas');

const pageDir = path.resolve(process.argv[2] || '.');
const PORT = { api: 8787, echo: 8788, ctrl: 8789, page: 8790 };
let world, mode, parked, seq, log;

function reset() {
  world = makeWorld();
  world.props.STRIPE_KEY_TEST = 'rk_test_good';
  world.props.STRIPE_KEY_LIVE = 'rk_live_good';
  mode = { down: false, delay: 0, dropNext: 0, asGet: 0 };
  parked = {}; seq = 0; log = [];
}
reset();

function readBody(req) { return new Promise(res => { const parts = []; req.on('data', c => parts.push(c)); req.on('end', () => res(Buffer.concat(parts).toString('utf8'))); }); }
const CORS = { 'Access-Control-Allow-Origin': '*' };

/* the web app address */
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/macros/s/FAKE/exec') { res.writeHead(404); res.end('no'); return; }
  if (req.method === 'OPTIONS') { log.push({ m: 'OPTIONS' }); res.writeHead(405); res.end(''); return; }      // no CORS headers: a preflight fails
  const body = req.method === 'POST' ? await readBody(req) : '';
  if (mode.down) { log.push({ m: req.method, down: true }); req.socket.destroy(); return; }
  if (mode.delay) await new Promise(r => setTimeout(r, mode.delay));
  let out;
  const asGet = req.method === 'POST' && mode.asGet > 0;          // seen once on the real backend: a POST answered as if the address had simply been opened. The request itself is not carried out.
  if (asGet) mode.asGet--;
  try {
    out = (req.method === 'POST' && !asGet)
      ? world.gs.doPost({ postData: { contents: body, type: req.headers['content-type'] || '' }, parameter: Object.fromEntries(url.searchParams) })
      : world.gs.doGet({ parameter: Object.fromEntries(url.searchParams) });
  } catch (err) { res.writeHead(500, CORS); res.end('<html>script error</html>'); return; }
  let parsed = {}; try { parsed = JSON.parse(body || '{}'); } catch (e) { /* not JSON */ }
  log.push({ m: req.method, ct: req.headers['content-type'] || '', a: parsed.a, k: parsed.k, e: parsed.e, keys: Object.keys(parsed).sort().join(','), rev: parsed.rev, bytes: body.length, origin: req.headers.origin || '', answer: JSON.parse(out.getContent()).ok, said: out.getContent().slice(0, 200), asGet: asGet });
  if (mode.dropNext > 0) { mode.dropNext--; req.socket.destroy(); return; }                                   // the script ran, the answer never arrived
  const id = String(++seq); parked[id] = out.getContent();
  res.writeHead(302, Object.assign({ Location: 'http://127.0.0.1:' + PORT.echo + '/macros/echo?id=' + id }, CORS));
  res.end('');
}).listen(PORT.api, 'localhost');

/* where the answer is actually served from */
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const body = parked[url.searchParams.get('id')];
  if (req.method !== 'GET' || body === undefined) { res.writeHead(404, CORS); res.end('no'); return; }
  delete parked[url.searchParams.get('id')];
  res.writeHead(200, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache, no-store' }, CORS));
  res.end(body);
}).listen(PORT.echo, '127.0.0.1');

/* the site */
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.join(pageDir, name);
  if (file.indexOf(pageDir) !== 0 || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('not found'); return; }
  const type = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(fs.readFileSync(file));
}).listen(PORT.page, 'localhost');

/* test controls */
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const body = req.method === 'POST' ? JSON.parse((await readBody(req)) || '{}') : {};
  const send = obj => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const tab = () => world.sheets.Trackers;
  if (url.pathname === '/reset') { reset(); return send({ ok: true }); }
  if (url.pathname === '/stripe') { world.stripe.sessions[body.id] = { status: body.status || 'complete', payment_status: body.payment_status || 'paid', customer_details: { email: body.email || 'buyer@example.com' } }; return send({ ok: true }); }
  if (url.pathname === '/mode') { Object.assign(mode, body); return send(mode); }
  if (url.pathname === '/props') { Object.keys(body).forEach(k => { if (body[k] === null) delete world.props[k]; else world.props[k] = body[k]; }); return send(world.props); }
  if (url.pathname === '/delete') { const t = tab(); const i = t ? t.rows.findIndex(r => r[0] === body.k) : -1; if (i >= 1) t.deleteRow(i + 1); return send({ deleted: i >= 1 }); }
  if (url.pathname === '/call') { return send(world.post(body)); }                                            // act as another device, straight to the script
  if (url.pathname === '/mail') { Object.assign(world.mail, body); return send({ quota: world.mail.quota, fail: world.mail.fail, sent: world.mail.sent.length }); }
  if (url.pathname === '/service') { Object.assign(world.send, body); return send({ quota: world.send.quota, fail: world.send.fail, down: world.send.down, sent: world.send.sent.length }); }   // the sending service: make it refuse, or let it work
  if (url.pathname === '/clock') { world.skew += Number(body.add) || 0; return send({ skew: world.skew }); }  // let time pass for the script
  if (url.pathname === '/setup') { world.gs.setup(); return send({ ok: true, tabs: Object.keys(world.sheets) }); }
  if (url.pathname === '/words') {                                                                            // Kevin changes a cell on the Words tab
    const W = world.sheets.Words; const i = W ? W.rows.findIndex(r => r[0] === body.name) : -1;
    if (i < 0) return send({ ok: false });
    W.getRange(i + 1, 2).setValue(body.text); return send({ ok: true });
  }
  if (url.pathname === '/dump') {
    const t = tab();
    const rows = t ? t.rows.slice(1).map(r => { const data = world.gs.unpack_(Array.from({ length: 20 }, (_, i) => r[i])).data; return { code: r[0], email: r[1], name: r[2], logged: r[3], of: r[4], lines: r[5], started: !!r[6], saved: !!r[7], rev: r[8], link: r[9], data: data, cells: r.slice(10, 20).filter(c => c !== '' && c != null).length, mailed: !!r[20] }; }) : [];
    return send({ rows: rows, hazards: world.hazards, stripeCalls: world.stripe.calls.length, log: log, errors: world.errors, locks: world.locks, unflushed: world.unflushed, mail: world.mail.sent, sends: world.send.sent, asked: world.send.calls.length, fetched: world.fetched });
  }
  res.writeHead(404); res.end('no');
}).listen(PORT.ctrl, 'localhost');

console.log('mock backend up', JSON.stringify(PORT), 'serving', pageDir);
