import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { authenticate, isProtected } from '../src/auth.mjs';
import { createServer, config } from '../src/server.mjs';

const TOKEN = 'superday-demo-token';

// Unit tests: authenticate() is pure.

test('missing header is rejected', () => {
  for (const header of [undefined, null, '', 42, ['Bearer x']]) {
    const result = authenticate(header, TOKEN);
    assert.equal(result.ok, false);
    assert.equal(typeof result.message, 'string');
  }
});

test('malformed headers are rejected', () => {
  for (const header of ['Token abc', 'Bearer', 'Bearer ', 'Bearer a b', `Bearer ${TOKEN} extra`]) {
    assert.equal(authenticate(header, TOKEN).ok, false, header);
  }
});

test('wrong token is rejected (same and different length)', () => {
  assert.equal(authenticate('Bearer wrong', TOKEN).ok, false);
  assert.equal(authenticate(`Bearer ${TOKEN.replace('s', 'x')}`, TOKEN).ok, false);
});

test('valid token returns the caller', () => {
  assert.deepEqual(authenticate(`Bearer ${TOKEN}`, TOKEN), { ok: true, caller: { id: 'demo' } });
});

test('scheme is case-insensitive and whitespace is tolerated', () => {
  assert.equal(authenticate(`  bearer   ${TOKEN} `, TOKEN).ok, true);
});

test('isProtected covers /portfolios and /clients only', () => {
  for (const p of ['/portfolios', '/portfolios/P-9001', '/clients', '/clients/x']) assert.equal(isProtected(p), true, p);
  for (const p of ['/health', '/', '/portfoliosX', '/nope']) assert.equal(isProtected(p), false, p);
});

// HTTP tests on an ephemeral port.

let server;
let base;

before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}`;
});

after(() => server.close());

async function assertUnauthorized(res) {
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error, 'unauthorized');
  assert.equal(typeof body.message, 'string');
}

test('protected route returns 401 for missing, malformed and wrong tokens', async () => {
  const cases = [{}, { authorization: 'Token abc' }, { authorization: 'Bearer ' }, { authorization: 'Bearer wrong' }];
  for (const headers of cases) {
    await assertUnauthorized(await fetch(`${base}/portfolios/P-9001/nope`, { headers }));
  }
});

test('valid token passes through to routing', async () => {
  // A sub-path with no route, so the CRM is never called.
  const res = await fetch(`${base}/portfolios/P-9001/nope`, { headers: { authorization: `Bearer ${config.authToken}` } });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'not_found_route');
});

test('/health stays open without a header', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
});

test('/clients/* is protected', async () => {
  await assertUnauthorized(await fetch(`${base}/clients/x`));
});
