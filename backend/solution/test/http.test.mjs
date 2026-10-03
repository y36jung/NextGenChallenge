import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.mjs';

let server;
let base;

before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}`;
});

after(() => server.close());

test('GET /health returns ok', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
});

test('unknown route returns 404 not_found_route', async () => {
  const res = await fetch(`${base}/nope`);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error, 'not_found_route');
  assert.equal(typeof body.message, 'string');
});

test('wrong method on a known path returns not_found_route', async () => {
  const res = await fetch(`${base}/health`, { method: 'POST' });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'not_found_route');
});
