# Portfolio backend

A Node.js HTTP service that serves portfolio data. It reads portfolio metadata from the mock CRM in [`../mock-crm.mjs`](../mock-crm.mjs) and requires a bearer token on every `/portfolios` and `/clients` route.

## Requirements

- Node.js 18 or later. The code uses the built-in `fetch` and `node:test`.
- No `npm install` step: the project has no dependencies.
- Optional: [`jq`](https://jqlang.github.io/jq/) to pretty-print JSON (`brew install jq`).

## Run the service

You need two terminals: one for the mock CRM and one for the backend.

**Terminal 1: mock CRM** (port 4002). Start it from the repository root (`NextGenChallenge/`), because it imports `support/http.mjs`:

```sh
node backend/mock-crm.mjs
```

**Terminal 2: backend** (port 3000):

```sh
cd backend/solution
npm start
```

### Configuration

All settings are environment variables with defaults, read in [`src/config.mjs`](src/config.mjs).

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Port the backend listens on |
| `CRM_BASE_URL` | `http://localhost:4002` | Base URL of the CRM |
| `CRM_TIMEOUT_MS` | `3000` | How long to wait for the CRM before returning `crm_timeout` |
| `CACHE_TTL_SECONDS` | `30` | How long a CRM response stays fresh in the cache |
| `AUTH_TOKEN` | `superday-demo-token` | The bearer token the backend accepts |

Example:

```sh
PORT=3000 CACHE_TTL_SECONDS=5 AUTH_TOKEN=superday-demo-token npm start
```

### Authentication

Send this header on every `/portfolios/*` and `/clients/*` request:

```
Authorization: Bearer superday-demo-token
```

The `Bearer` scheme is case-insensitive. A missing, malformed or wrong header gets `401 unauthorized`. `/health` needs no token.

## Automated tests

```sh
cd backend/solution
npm test
```

The tests run on `node:test` and need neither server running: they start the backend on a random port and stub the CRM.

| File | Covers |
| --- | --- |
| [`test/auth.test.mjs`](test/auth.test.mjs) | Token parsing and comparison, which paths require a token, and the 401 response on protected routes |
| [`test/http.test.mjs`](test/http.test.mjs) | `/health`, and `404 not_found_route` for unknown paths and wrong methods |
| [`test/crm.test.mjs`](test/crm.test.mjs) | Mapping CRM records (standard and nested shapes, account lookup by `acct_ref`, incomplete records), CRM HTTP errors and timeouts, and the status codes from `GET /portfolios/:id` |

## Manual testing from the terminal

With both servers running, open a third terminal and set these shortcuts:

```sh
B=http://localhost:3000
CRM=http://localhost:4002
AUTH='Authorization: Bearer superday-demo-token'

# Sets the CRM's global failure mode: ok | auto | error | timeout | missing | nested
setmode() { curl -s -X POST $CRM/__control -H 'Content-Type: application/json' -d "{\"mode\":\"$1\"}"; }
```

Add `-i` to any `curl` command to see the status line and headers.

### 1. Make the CRM predictable

In its default `auto` mode, the mock CRM fails every 5th call with a 503 and makes every 10th call wait 10 seconds. Turn this off before testing the success cases:

```sh
setmode ok
```

### 2. Health check

```sh
curl -i $B/health
```

Expect `200 {"status":"ok"}`, with no token.

### 3. Authentication

| Command | Expected |
| --- | --- |
| `curl -i $B/portfolios/P-9001` | `401` Missing Authorization header |
| `curl -i $B/portfolios/P-9001 -H 'Authorization: Basic xyz'` | `401` must be "Bearer &lt;token&gt;" |
| `curl -i $B/portfolios/P-9001 -H 'Authorization: Bearer wrong'` | `401` Invalid token |
| `curl -i $B/clients/abc123/portfolios` | `401` (`/clients` is protected too) |

### 4. `GET /portfolios/:id`: successful responses

```sh
curl -s $B/portfolios/P-9001   -H "$AUTH" | jq
curl -s $B/portfolios/P-9002   -H "$AUTH" | jq
curl -s $B/portfolios/P-EMPTY  -H "$AUTH" | jq
curl -s $B/portfolios/P-SINGLE -H "$AUTH" | jq
curl -i $B/portfolios/UNKNOWN  -H "$AUTH"
```

- `P-9001` returns `200` with `totalMarketValue: 48930`, `dayChangeAmount: 30` and `totalReturnSinceInception: 0.187`.
- `P-9002` is not the first account in the CRM record, so it checks that the backend finds accounts by `acct_ref`. Its `dayChangePercent` is `0`.
- `UNKNOWN` returns `404 not_found`.

### 5. `GET /portfolios/:id`: CRM failures

Set the CRM's global mode, then call the backend. Do not add `?mode=` to the backend URL. The CRM only reads that parameter on its own URLs.

| Mode | Command | Expected |
| --- | --- | --- |
| `error` | `setmode error; curl -i $B/portfolios/P-9001 -H "$AUTH"` | `503 crm_unavailable` |
| `timeout` | `setmode timeout; time curl -i $B/portfolios/P-9001 -H "$AUTH"` | `504 crm_timeout` after about `CRM_TIMEOUT_MS`, not 10 s |
| `missing` | `setmode missing; curl -i $B/portfolios/P-9001 -H "$AUTH"` | `502 crm_incomplete`, with the missing fields named in the message |
| `nested` | `setmode nested; curl -s $B/portfolios/P-9001 -H "$AUTH" \| jq` | `200` with the same data as in `ok` mode |

Run `setmode ok` when you finish.

To see the raw CRM data the backend receives:

```sh
curl -s "$CRM/crm/portfolios/P-9001?mode=missing" | jq
curl -s "$CRM/crm/portfolios/P-9001?mode=nested"  | jq
```

### 6. Unknown routes

```sh
curl -i $B/nope
```

Expect `404 not_found_route`.

### 7. Cache

> **Not implemented yet.** The backend has no cache module yet, so every request calls the CRM. Right now the two calls below give `callsByPortfolio["P-9001"]` of 2, and the stale check returns `503 crm_unavailable`. The expected results below apply once the cache is built.

For a shorter wait, start the backend with `CACHE_TTL_SECONDS=5`. `GET $CRM/__stats` shows how many times the backend called the CRM.

```sh
setmode ok
curl -s $B/portfolios/P-9001 -H "$AUTH" > /dev/null
curl -s $B/portfolios/P-9001 -H "$AUTH" > /dev/null
curl -s $CRM/__stats | jq                  # callsByPortfolio["P-9001"] is 1

setmode error
sleep 6                                    # wait past the TTL
curl -i $B/portfolios/P-9001 -H "$AUTH"    # the stale cached value, marked stale
curl -i $B/portfolios/P-9002 -H "$AUTH"    # never cached, so 503 crm_unavailable

setmode ok
```

Restarting the mock CRM resets its call counts and mode. Restarting the backend clears its cache.

### 8. Other endpoints

> **Not implemented yet.** With a valid token, each of these returns `404 not_found_route` for now. Without a token, the `/portfolios/*` and `/clients/*` requests return `401`, because auth runs before route matching.

These are the remaining requests from [`../requests.http`](../requests.http). Before testing performance history, generate its data from the repository root with `node backend/fixtures/generate-history.mjs`.

```sh
curl -s "$B/portfolios/P-9001/holdings?currency=USD" -H "$AUTH" | jq
curl -s "$B/portfolios/P-9001/performance-history?range=YTD" -H "$AUTH" | jq
curl -i "$B/portfolios/P-9001/performance-history?range=invalid" -H "$AUTH"
curl -s $B/portfolios/P-9001/allocation -H "$AUTH" | jq
curl -s $B/portfolios/P-EMPTY/holdings -H "$AUTH" | jq
curl -s $B/clients/abc123/portfolios -H "$AUTH" | jq
curl -s $B/clients/abc123/household-summary -H "$AUTH" | jq
curl -s $B/holdings/NEW/detail -H "$AUTH" | jq
```

## Error format

Every error has the same body shape:

```json
{ "error": "crm_timeout", "message": "The CRM did not respond in time" }
```

| Code | Status |
| --- | --- |
| `unauthorized` | 401 |
| `not_found` | 404 |
| `not_found_route` | 404 |
| `crm_incomplete` | 502 |
| `crm_unavailable` | 503 |
| `crm_timeout` | 504 |
