import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mapCrmRecord, fetchCrm } from '../src/crm.mjs';
import { getPortfolioSummary } from '../src/summary.mjs';
import { ERROR_CODES } from '../src/http.mjs';

const account = (ref, nickname, amt, change, pct, inception) => ({
  acct_ref: ref,
  acct_nickname: nickname,
  curr_val: { amt, ccy: 'CAD' },
  chg_1d: { amt: change, pct },
  since_inception_pct: inception,
});

const p9001 = () => account('P-9001', 'Retirement', 48930, 30, 30 / 48900, 0.187);
const p9002 = () => account('P-9002', 'Savings', 500, 500, 0, 0.25);

const payload = accounts => ({
  client_record: { client_id: 'C-1001', full_name: 'Test Client', accounts },
  meta: { retrieved_at: '2026-01-15T10:00:00Z', source: 'legacy-crm' },
});

test('standard shape maps every field', () => {
  const result = mapCrmRecord(payload([p9001(), p9002()]), 'P-9001');
  assert.deepEqual(result, {
    ok: true,
    value: {
      portfolioId: 'P-9001',
      clientId: 'C-1001',
      label: 'Retirement',
      currency: 'CAD',
      totalMarketValue: 48930,
      dayChangeAmount: 30,
      dayChangePercent: 30 / 48900,
      totalReturnSinceInception: 0.187,
      asOf: '2026-01-15T10:00:00Z',
    },
  });
});

test('nested shape (relationships.accounts) maps the same way', () => {
  const nested = {
    client_record: { client_id: 'C-1001', relationships: { accounts: [p9001(), p9002()] } },
    meta: { retrieved_at: '2026-01-15T10:00:00Z' },
  };
  const result = mapCrmRecord(nested, 'P-9001');
  assert.equal(result.ok, true);
  assert.equal(result.value.totalMarketValue, 48930);
});

test('account that is not first is selected by acct_ref, not position', () => {
  const result = mapCrmRecord(payload([p9001(), p9002()]), 'P-9002');
  assert.equal(result.ok, true);
  assert.equal(result.value.totalMarketValue, 500);
  // A real 0 from the CRM is a value, not a missing field.
  assert.equal(result.value.dayChangePercent, 0);
});

test('incomplete record (amt null, no nickname) is rejected, never turned into 0', () => {
  const broken = p9001();
  broken.curr_val.amt = null;
  delete broken.acct_nickname;
  const result = mapCrmRecord(payload([broken, p9002()]), 'P-9001');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'incomplete');
  assert.deepEqual(result.missing, ['acct_nickname', 'curr_val.amt']);
  assert.equal(result.value, undefined);
});

test('no matching acct_ref is not_found', () => {
  const result = mapCrmRecord(payload([p9001()]), 'P-NOPE');
  assert.deepEqual(result, { ok: false, reason: 'not_found', missing: [] });
});

test('payload with no accounts list at all is incomplete, not a crash', () => {
  for (const bad of [null, {}, { client_record: {} }, { client_record: { accounts: 'x' } }]) {
    const result = mapCrmRecord(bad, 'P-9001');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'incomplete');
  }
});

// ---- Failure paths, one test per way the CRM record can be wrong ----

const setPath = (obj, path, value) => {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => o[k], obj);
  if (value === undefined) delete target[last];
  else target[last] = value;
};

// [CRM field name, where it lives: 'account' | 'record' | 'payload', path inside that object]
const mappedFields = [
  ['client_id', 'record', 'client_id'],
  ['acct_nickname', 'account', 'acct_nickname'],
  ['curr_val.ccy', 'account', 'curr_val.ccy'],
  ['curr_val.amt', 'account', 'curr_val.amt'],
  ['chg_1d.amt', 'account', 'chg_1d.amt'],
  ['chg_1d.pct', 'account', 'chg_1d.pct'],
  ['since_inception_pct', 'account', 'since_inception_pct'],
  ['meta.retrieved_at', 'payload', 'meta.retrieved_at'],
];
const numericFields = ['curr_val.amt', 'chg_1d.amt', 'chg_1d.pct', 'since_inception_pct'];
const textFields = ['client_id', 'acct_nickname', 'curr_val.ccy', 'meta.retrieved_at'];

const brokenPayload = (crmName, badValue) => {
  const [, where, path] = mappedFields.find(([name]) => name === crmName);
  const target = p9001();
  const body = payload([target, p9002()]);
  setPath({ account: target, record: body.client_record, payload: body }[where], path, badValue);
  return body;
};

const assertIncomplete = (result, crmName) => {
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'incomplete');
  assert.deepEqual(result.missing, [crmName]);
  assert.equal(result.value, undefined);
};

for (const [crmName] of mappedFields) {
  test(`${crmName} absent is incomplete and names the field`, () => {
    assertIncomplete(mapCrmRecord(brokenPayload(crmName, undefined), 'P-9001'), crmName);
  });
  test(`${crmName} null is incomplete and names the field`, () => {
    assertIncomplete(mapCrmRecord(brokenPayload(crmName, null), 'P-9001'), crmName);
  });
}

for (const crmName of numericFields) {
  for (const [label, bad] of [['numeric string', '48930'], ['NaN', NaN], ['Infinity', Infinity], ['boolean', true], ['object', {}]]) {
    test(`${crmName} as ${label} is incomplete, never coerced to a number`, () => {
      assertIncomplete(mapCrmRecord(brokenPayload(crmName, bad), 'P-9001'), crmName);
    });
  }
}

for (const crmName of textFields) {
  for (const [label, bad] of [['empty string', ''], ['number', 42], ['object', {}]]) {
    test(`${crmName} as ${label} is incomplete`, () => {
      assertIncomplete(mapCrmRecord(brokenPayload(crmName, bad), 'P-9001'), crmName);
    });
  }
}

test('meta.retrieved_at that is not a date is incomplete', () => {
  assertIncomplete(mapCrmRecord(brokenPayload('meta.retrieved_at', 'yesterday-ish'), 'P-9001'), 'meta.retrieved_at');
});

test('whole curr_val, chg_1d or meta block absent lists every field in it', () => {
  const noVal = p9001(); delete noVal.curr_val;
  assert.deepEqual(mapCrmRecord(payload([noVal]), 'P-9001').missing, ['curr_val.ccy', 'curr_val.amt']);
  const noChg = p9001(); noChg.chg_1d = null;
  assert.deepEqual(mapCrmRecord(payload([noChg]), 'P-9001').missing, ['chg_1d.amt', 'chg_1d.pct']);
  const noMeta = payload([p9001()]); delete noMeta.meta;
  assert.deepEqual(mapCrmRecord(noMeta, 'P-9001').missing, ['meta.retrieved_at']);
});

test('payload that is not a CRM record is incomplete, not a crash', () => {
  for (const bad of [undefined, null, 'oops', 42, [], {}, { client_record: null }, { client_record: 'x' },
    { client_record: { accounts: {} } }, { client_record: { relationships: { accounts: 'x' } } }]) {
    const result = mapCrmRecord(bad, 'P-9001');
    assert.equal(result.ok, false, JSON.stringify(bad));
    assert.equal(result.reason, 'incomplete', JSON.stringify(bad));
    assert.deepEqual(result.missing, ['client_record.accounts']);
  }
});

test('empty accounts list is not_found', () => {
  assert.equal(mapCrmRecord(payload([]), 'P-9001').reason, 'not_found');
});

test('junk entries in the accounts list are skipped, not a crash', () => {
  const result = mapCrmRecord(payload([null, 7, 'x', {}, p9001()]), 'P-9001');
  assert.equal(result.ok, true);
  assert.equal(result.value.totalMarketValue, 48930);
});

test('account found under relationships even when a top-level accounts list also exists', () => {
  const body = payload([p9002()]);
  body.client_record.relationships = { accounts: [p9001()] };
  const result = mapCrmRecord(body, 'P-9001');
  assert.equal(result.ok, true);
  assert.equal(result.value.totalMarketValue, 48930);
});

test('acct_ref match is exact: wrong case, padding or prefix is not_found', () => {
  for (const id of ['p-9001', ' P-9001', 'P-900', 'P-90011', '', undefined, null, 9001]) {
    assert.equal(mapCrmRecord(payload([p9001(), p9002()]), id).reason, 'not_found', String(id));
  }
});

test('same acct_ref listed twice is ambiguous, so it is rejected rather than guessed', () => {
  const other = p9001(); other.curr_val.amt = 1;
  const result = mapCrmRecord(payload([p9001(), other]), 'P-9001');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'incomplete');
  assert.deepEqual(result.missing, ['acct_ref (duplicate)']);
});

// ---- Values that look odd but are valid ----

test('zero and negative amounts are real values, not missing', () => {
  const result = mapCrmRecord(payload([account('P-EMPTY', 'Empty', 0, -12.5, -0.01, 0)]), 'P-EMPTY');
  assert.equal(result.ok, true);
  assert.equal(result.value.totalMarketValue, 0);
  assert.equal(result.value.dayChangeAmount, -12.5);
  assert.equal(result.value.totalReturnSinceInception, 0);
});

test('output carries only the nine mapped fields (no full_name or other CRM data)', () => {
  const result = mapCrmRecord(payload([p9001()]), 'P-9001');
  assert.deepEqual(Object.keys(result.value).sort(), ['asOf', 'clientId', 'currency', 'dayChangeAmount',
    'dayChangePercent', 'label', 'portfolioId', 'totalMarketValue', 'totalReturnSinceInception']);
});

test('the CRM payload is not modified', () => {
  const body = payload([p9001(), p9002()]);
  const before = structuredClone(body);
  mapCrmRecord(body, 'P-9001');
  assert.deepEqual(body, before);
});

// ---- fetchCrm against a throwaway local HTTP server ----

// Each request is answered according to `behavior`, which a test sets before calling.
// behavior: { status, body } | { hang: true } | { hangBody: true } (headers sent, body never finished)
const fake = { behavior: { status: 200, body: '{}' }, urls: [] };
const server = createServer((req, res) => {
  fake.urls.push(req.url);
  const b = fake.behavior;
  if (b.hang) return;
  if (b.hangBody) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"client_record":');
    return;
  }
  res.writeHead(b.status, { 'Content-Type': 'application/json' });
  res.end(b.body);
});
let baseUrl;

before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  // Hanging requests keep sockets open; close them so node --test can exit.
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});

const respond = (status, body) => { fake.behavior = { status, body: typeof body === 'string' ? body : JSON.stringify(body) }; };
const callCrm = (id, timeoutMs = 1000) => fetchCrm(id, { baseUrl, timeoutMs });

test('fetchCrm: ok payload maps P-9001 to 48930 / 30 / 0.187', async () => {
  respond(200, payload([p9001(), p9002()]));
  const result = await callCrm('P-9001');
  assert.equal(result.ok, true);
  assert.equal(result.value.totalMarketValue, 48930);
  assert.equal(result.value.dayChangeAmount, 30);
  assert.equal(result.value.totalReturnSinceInception, 0.187);
});

test('fetchCrm: P-9002 passes dayChangePercent 0 through', async () => {
  respond(200, payload([p9001(), p9002()]));
  const result = await callCrm('P-9002');
  assert.equal(result.ok, true);
  assert.equal(result.value.totalMarketValue, 500);
  assert.equal(result.value.dayChangePercent, 0);
});

test('fetchCrm: CRM 404 is not_found', async () => {
  respond(404, { error: 'not found' });
  assert.deepEqual(await callCrm('P-NOPE'), { ok: false, reason: 'not_found', missing: [] });
});

test('fetchCrm: CRM 503 (and other non-OK statuses) is unavailable', async () => {
  for (const status of [503, 500, 400]) {
    respond(status, { error: 'down' });
    assert.deepEqual(await callCrm('P-9001'), { ok: false, reason: 'unavailable' }, String(status));
  }
});

test('fetchCrm: a CRM that never responds times out quickly', async () => {
  fake.behavior = { hang: true };
  const started = Date.now();
  const result = await callCrm('P-9001', 50);
  assert.deepEqual(result, { ok: false, reason: 'timeout' });
  assert.ok(Date.now() - started < 1000, 'resolved in well under 1s');
});

test('fetchCrm: the timeout also covers reading the body', async () => {
  fake.behavior = { hangBody: true };
  const started = Date.now();
  const result = await callCrm('P-9001', 50);
  assert.deepEqual(result, { ok: false, reason: 'timeout' });
  assert.ok(Date.now() - started < 1000, 'resolved in well under 1s');
});

test('fetchCrm: a refused connection is unavailable', async () => {
  const closed = createServer();
  await new Promise(resolve => closed.listen(0, '127.0.0.1', resolve));
  const port = closed.address().port;
  await new Promise(resolve => closed.close(resolve));
  const result = await fetchCrm('P-9001', { baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 1000 });
  assert.deepEqual(result, { ok: false, reason: 'unavailable' });
});

test('fetchCrm: a body that is not JSON is incomplete', async () => {
  respond(200, '<html>oops</html>');
  const result = await callCrm('P-9001');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'incomplete');
});

test('fetchCrm: requests the right path and never sends ?mode=', async () => {
  respond(200, payload([p9001()]));
  fake.urls = [];
  await callCrm('P-9001');
  await callCrm('P 9/1');
  assert.equal(fake.urls[0], '/crm/portfolios/P-9001');
  assert.equal(fake.urls[1], '/crm/portfolios/P%209%2F1');
  for (const url of fake.urls) {
    assert.equal(new URL(url, 'http://x').searchParams.has('mode'), false, url);
    assert.ok(!url.includes('?'), url);
  }
});

test('fetchCrm: never throws, even if fetch itself throws synchronously', async () => {
  const boom = () => { throw new Error('boom'); };
  assert.deepEqual(await fetchCrm('P-9001', { baseUrl, timeoutMs: 50, fetch: boom }), { ok: false, reason: 'unavailable' });
});

// ---- getPortfolioSummary with an injected CRM client ----

const stubCrm = result => async () => result;

test('getPortfolioSummary: success is 200 with the mapped value', async () => {
  const value = mapCrmRecord(payload([p9001()]), 'P-9001').value;
  const calls = [];
  const crm = async (id, opts) => { calls.push([id, opts]); return { ok: true, value }; };
  const result = await getPortfolioSummary('P-9001', { crm });
  assert.deepEqual(result, { status: 200, body: value });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'P-9001');
  assert.equal(typeof calls[0][1].baseUrl, 'string');
  assert.equal(typeof calls[0][1].timeoutMs, 'number');
});

for (const [reason, code, status] of [
  ['not_found', 'not_found', 404],
  ['unavailable', 'crm_unavailable', 503],
  ['timeout', 'crm_timeout', 504],
  ['incomplete', 'crm_incomplete', 502],
]) {
  test(`getPortfolioSummary: ${reason} is ${status} ${code}`, async () => {
    const result = await getPortfolioSummary('P-9001', { crm: stubCrm({ ok: false, reason, missing: [] }) });
    assert.equal(result.status, status);
    assert.equal(result.status, ERROR_CODES[code]);
    assert.equal(result.body.error, code);
    assert.equal(typeof result.body.message, 'string');
  });
}

test('getPortfolioSummary: incomplete message lists the missing fields', async () => {
  const crm = stubCrm({ ok: false, reason: 'incomplete', missing: ['acct_nickname', 'curr_val.amt'] });
  const result = await getPortfolioSummary('P-9001', { crm });
  assert.equal(result.status, 502);
  assert.match(result.body.message, /acct_nickname/);
  assert.match(result.body.message, /curr_val\.amt/);
});

test('getPortfolioSummary: a client that throws becomes 503, not a crash', async () => {
  const result = await getPortfolioSummary('P-9001', { crm: async () => { throw new Error('boom'); } });
  assert.equal(result.status, 503);
  assert.equal(result.body.error, 'crm_unavailable');
});
