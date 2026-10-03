# Backend Implementation Plan (45 min)

Source of truth: [../REQUIREMENTS.md](../REQUIREMENTS.md), [../CRM.md](../CRM.md), [../START-HERE.md](../START-HERE.md).
Work top to bottom. Tick boxes as you go. Timeboxes total 42 min, leaving 3 min of slack. The seed-only endpoints come before the CRM work, so tested endpoints exist early even if the CRM steps overrun. If you run out of time, list what's left as unfinished, but never cut the notes.

Useful Claude generations:
PRD: https://claude.ai/artifact/LbBHqAV368e43jRrkvrmJq#ffcf3ea7-5639.maz3463jh4r.3503
Design Diagram: https://claude.ai/artifact/Ny8fTzxDir4JF628dB61VC
Split Diagram between Pair Programmer: https://claude.ai/artifact/WNWnQR1QBTjpJFuMi6hAHQ

## Scope

| In scope | Out of scope (list as unfinished in README) |
|---|---|
| Task 4 auth, Task 2 holdings, Task 5 allocation, Task 1 CRM integration, Task 9 caching | Task 3 performance history, Task 6 household, Task 7 currency, Task 8 holding detail, Task 10 replay function and ERD |

Task 10's replay function was cut because the timeboxes added up to 47 minutes. It was the stretch step, and it doesn't depend on anything else.

## Open decisions

| Decision | Options | Default until resolved | Why it matters |
|---|---|---|---|
| **Who the caller is** (question for staff) | A client viewing their own portfolios, or an advisor acting for many clients | Unknown; see the auth decision below | It decides the per-client authorization rule an assessor is likely to ask about. |

## Locked decisions

Do not revisit these while building. Each one goes in the README with its reason.

### Response contract

- **List endpoints (holdings, allocation) return a bare array.** The spec says "Array of…" and Task 7 (currency) is out of scope. Note in the README that adding Task 7 would need an envelope, which is a breaking change.
- **Error codes are lowercase snake_case**, matching the brief's `"unauthorized"`: `unauthorized`, `not_found`, `crm_unavailable`, `crm_timeout`, `crm_incomplete`, `not_found_route`. Use one shared `{ error, message }` helper and never write a code inline.

### Missing CRM values

- **An incomplete CRM record counts as a CRM failure.** A record is incomplete when a field we map is missing or `null` (`mode=missing` sends `curr_val.amt: null` and no `acct_nickname`). [REQUIREMENTS.md](../REQUIREMENTS.md) only asks for this to be "handled explicitly"; it doesn't pick an option.
- An incomplete record goes through the same path as a 5xx. With a cold cache, return 502 `crm_incomplete`. With an expired cache entry, serve it with `stale: true`. An incomplete record **never** replaces a cached entry.
- Why: under the alternative (200 with the field `null`), a `missing` response would replace a good cached 48930 with `null` and mark it `stale: false`, and a later outage would then serve that `null` as the stale fallback. Rejecting the record avoids this with no extra cache logic. It also keeps the mapped fields typed as numbers, so consumers never handle `null`.

### Data source for holdings and allocation

- **Compute from the seed only and never call the CRM.** Weights divide by the sum of the holdings, not by the CRM's total. If the two totals ever differed, dividing by the CRM's total would make weights stop adding up to about 100%. Using the holdings sum keeps the endpoint self-consistent.
- As a result, **the 404 for an unknown ID in Tasks 2 and 5 comes from the seed's `portfolios` list**, not from the CRM. `P-EMPTY` is known and returns `[]`.
- Back up the claim that the two sources agree today with a test: the seed holdings for `P-9001` sum to 48,930, the CRM's `curr_val.amt`.

### Auth

- **One global token, `Bearer superday-demo-token`.** The brief explicitly allows a hardcoded token.
- **Known gap:** anyone holding the token can read any client's portfolio. State this in the README.
- **Mitigation built in now:** the auth function returns **who the caller is** (a fixed value today), and routes receive it on the request. A per-client check later is then one lookup in one place instead of a change to every route. Changing this later is therefore **cheap**.

### Other choices (cheap to change)

| Area | Decision |
|---|---|
| Stack | Node 24 with built-in `http` and `node:test`; no dependencies. Seed loaded into memory. Port 3000. |
| Auth paths | Protects `/portfolios/*` and `/clients/*`; `/health` is open. The scheme is case-insensitive, whitespace is trimmed, and an empty token gets 401. |
| CRM timeout | 3s (configurable). No retries and no coalescing. |
| CRM 404 | Authoritative: return 404, never fall back to stale data. |
| CRM errors, cold cache | 503 `crm_unavailable` for 5xx; 504 `crm_timeout` for a timeout; 502 `crm_incomplete` for an incomplete record. |
| Account lookup | Match `acct_ref` in `client_record.accounts` **or** `client_record.relationships.accounts`. Never assume the first account. |
| Cache | In memory, keyed by portfolio ID, 30s TTL (configurable). Only a successful, complete fetch overwrites the entry and resets `stale: false` and `cachedAt`. |
| `asOf` / `cachedAt` | `asOf` is the CRM's `meta.retrieved_at`; `cachedAt` is when this backend fetched it. |
| Previous close 0 | Holdings return `dayChangePercent: null`. Check for the zero explicitly; don't rely on `JSON.stringify` turning `Infinity` into `null`. Task 1 passes the CRM's `0` through (document the difference). |
| Quantity 0 | `marketValue`, `weightPercent`, `unrealizedGainLoss` and `dayChangeAmount` are 0. `dayChangePercent` is price-based, so it stays as calculated (`0.2` for `ZERO`), because the requirement only zeroes the amount fields. |
| Portfolio total 0 | Every weight is 0. |
| Rounding | Calculations stay unrounded. Round only in the response: money to 2 decimal places, ratios to 4. |
| Allocation | Only classes with value > 0, sorted by value, highest first. |

## Target layout

```
backend/solution/
  README.md            run, token, tests, assumptions, unfinished work
  PLAN.md              this file
  package.json         "start" and "test" scripts only
  src/
    server.mjs         routing, error helper, startup
    auth.mjs           middleware; returns the caller's identity
    data.mjs           seed loading and lookups
    crm.mjs            CRM client (timeout) + mapping
    cache.mjs          TTL cache + stale fallback
    holdings.mjs       pure calculations: holdings and allocation
  test/
    *.test.mjs         unit tests for the pure modules, plus HTTP tests
```

Keep the calculation and mapping modules free of HTTP. Unit tests run against them directly, as Task 2 requires.

---

## Step 1: Scaffold (5 min)

- [x] Create the layout above and `package.json` (`"type": "module"`, scripts `start` and `test`).
- [x] `data.mjs` loads `../fixtures/seed.json` and exposes lookups for portfolios and their holdings.
- [x] `server.mjs`: a small router, the shared `{ error, message }` helper with lowercase codes, a JSON response helper, and `not_found_route` for unknown routes.
- [x] Config from environment variables with defaults: `PORT=3000`, `CRM_BASE_URL=http://localhost:4002`, `CRM_TIMEOUT_MS=3000`, `CACHE_TTL_SECONDS=30`, `AUTH_TOKEN=superday-demo-token`.
- [x] `GET /health` returns `{ "status": "ok" }`.

**Done when:** `npm start` serves `/health`, and `npm test` runs (even if there are no tests yet).

## Step 2: Task 4, auth (3 min)

- [x] Middleware runs before any route logic on protected paths.
- [x] On success it attaches the caller's identity to the request (fixed value for now).
- [x] Missing header → 401 `unauthorized`.
- [x] Malformed header (no `Bearer `, empty token) → 401, never a 500.
- [x] Wrong token → 401.
- [x] Valid token → passes through.

**Tests:** missing, malformed (`Token abc`), wrong token, valid token (identity attached).

## Step 3: Task 2, holdings (8 min)

- [ ] Pure function: holdings for a portfolio → enriched holdings. Compute the total once as the **sum of holding market values**, then the per-holding fields.
- [ ] Fields: `ticker, name, assetClass, quantity, costBasisPerShare, price, previousClosePrice, marketValue, weightPercent, unrealizedGainLoss, dayChangeAmount, dayChangePercent`.
- [ ] Route `GET /portfolios/:id/holdings`: an ID not in the seed's `portfolios` list → 404 `not_found`; a known ID with no holdings → `[]`.
- [ ] Round only in the response.

**Tests (unit):** expected values below, `P-EMPTY` gives `[]`, `ZERO` is zeroed, `NEW` has `dayChangePercent: null` (assert on the unserialized value), and **the `P-9001` holdings total is 48930** (matches the CRM).

| Ticker (portfolio) | marketValue | weightPercent | unrealizedGainLoss | dayChangeAmount | dayChangePercent |
|---|---|---|---|---|---|
| AAPL (P-9001) | 27300 | 0.5579 | 3300 | 300 | 0.0111 |
| BND (P-9001) | 21630 | 0.4421 | -570 | -270 | -0.0123 |
| ZERO (P-9001) | 0 | 0 | 0 | 0 | 0.2 |
| NEW (P-9002) | 500 | 1 | 100 | 500 | null |
| AAPL (P-SINGLE) | 2275 | 1 | 275 | 25 | 0.0111 |

## Step 4: Task 5, allocation (3 min)

- [ ] Reuse Step 3's calculations. Group by `assetClass` → `{ assetClass, value, percent }`.
- [ ] Route `GET /portfolios/:id/allocation`: an ID not in the seed → 404; empty portfolio → `[]`.

**Tests (unit):**

| Portfolio | Expected |
|---|---|
| P-9001 | Equity 27300 / 0.5579, Fixed Income 21630 / 0.4421 |
| P-SINGLE | one entry: Equity 2275 / 1.0 |
| P-EMPTY | `[]` |

## Step 5: Task 1, CRM integration (10 min)

- [x] The CRM client calls `GET {CRM_BASE_URL}/crm/portfolios/:id` with an abort timeout. Never send `?mode=` from the backend.
- [x] Find the account by `acct_ref` in either nesting location.
- [x] Map to `portfolioId, clientId, label, currency, totalMarketValue, dayChangeAmount, dayChangePercent, totalReturnSinceInception, asOf`.
- [x] If any mapped field is missing or `null`, the mapping reports the record as incomplete. Check for `null` explicitly; never coerce it (`Number(null)`, `?? 0` and `* 1` all turn it into `0`).
- [x] CRM 404, or no matching `acct_ref` → 404 `not_found`.
- [x] CRM 5xx → 503 `crm_unavailable`. Timeout → 504 `crm_timeout`. Incomplete record → 502 `crm_incomplete`. None may crash or hang.
- [x] Keep the mapping as a pure function so it can be unit-tested with fixture payloads.

**Tests (unit, mapping):** standard shape, nested shape, incomplete record (`amt: null`, no `acct_nickname`) is rejected, account not first (`P-9002` returns 500, not P-9001's 48930).
**Manual check:** run the CRM in each mode (`ok`, `missing`, `nested`, `error`, `timeout`) via `POST /__control`.

| Fixture | Expected (P-9001, `ok`) |
|---|---|
| `totalMarketValue` | 48930 |
| `dayChangeAmount` | 30 |
| `totalReturnSinceInception` | 0.187 |
| `P-9002` `dayChangePercent` | 0 (CRM value, passed through) |

## Step 6: Task 9, caching (8 min)

- [ ] Cache interface: `get(key)`, `set(key, value, ttlSeconds)`. Each entry stores `value`, `cachedAt` and `expiresAt`.
- [ ] Fresh hit → serve from the cache with no CRM call, `stale: false`.
- [ ] Miss or expired → call the CRM. On a complete success, overwrite the entry and return `stale: false`.
- [ ] Expired + CRM failure (5xx, timeout or incomplete record) → serve the cached value with `stale: true` and the original `cachedAt`.
- [ ] Cold cache + CRM failure → 502/503/504 error (different from the stale case).
- [ ] CRM 404 → 404, no fallback.
- [ ] Keys are scoped per portfolio ID.

**Tests (unit, with a fake clock and a stubbed CRM):** hit within TTL makes no call; expired + failure is stale; **expired + incomplete record serves the cached 48930 with `stale: true`**; cold + failure is an error; recovery resets `stale`; keys don't leak between IDs.
**Manual check:** the 5-step walkthrough in [CRM.md](../CRM.md#check-your-cache), using `GET /__stats` call counts.

## Step 7: Notes (5 min, protected)

Write `README.md` with:
- [ ] Install and run: Node 24, `npm start`, how to start the mock CRM, environment variables.
- [ ] Auth token and an example header.
- [ ] `npm test`, and what it covers.
- [ ] Assumptions: the **Locked decisions** above, condensed, each with its reason. Include the missing-values decision and the cache problem it avoids.
- [ ] Known gaps: the global token lets any holder read any portfolio. Explain that the auth function already returns the caller's identity, and name the open client-vs-advisor question.
- [ ] Unfinished work: Tasks 3, 6, 7, 8, and Task 10 (replay function and ERD). Note that Task 7 would need an envelope for list responses.

---

## Final check before submitting

- [ ] `npm test` passes, starting from a clean run.
- [ ] Every request in [../requests.http](../requests.http) that is in scope behaves as expected.
- [ ] The CRM.md cache walkthrough passes.
- [ ] No request hangs longer than the CRM timeout.
- [ ] Every error code in responses is lowercase snake_case.
