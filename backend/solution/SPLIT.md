# Work Split: Two-Person Plan

How [PLAN.md](PLAN.md) is divided between two people so that they never edit the same file. PLAN.md stays the source of truth for *what* to build. This file covers *who* builds it and tracks progress.

Tick a box only when its "done when" condition holds. Tick only boxes in your own lane.

## Lanes and file ownership

| | **Person A: seed, HTTP, docs** | **Person B: CRM and cache** |
|---|---|---|
| PLAN steps | 1 Scaffold, 2 Auth, 3 Holdings, 4 Allocation, 7 README | 5 CRM integration, 6 Caching, manual checks |
| Owns these files | `package.json`, `src/server.mjs`, `src/http.mjs`, `src/auth.mjs`, `src/data.mjs`, `src/holdings.mjs`, `test/auth.test.mjs`, `test/holdings.test.mjs`, `test/allocation.test.mjs`, `test/http.test.mjs`, `README.md` | `src/crm.mjs`, `src/cache.mjs`, `src/summary.mjs` (after A's stub), `test/crm.test.mjs`, `test/cache.test.mjs` |
| Routes | `/health`, `/portfolios/:id/holdings`, `/portfolios/:id/allocation` | Logic behind `GET /portfolios/:id` |
| Branch | `a-seed` | `b-crm` |
| Claude agent | `seed-lane` | `crm-lane` |

Two changes to PLAN.md's layout, made so that neither person has to edit the other's files:

1. The error and JSON helpers live in `src/http.mjs`, not in `server.mjs`. Every error code is listed there from the start, including `crm_unavailable`, `crm_timeout` and `crm_incomplete`.
2. `src/summary.mjs` holds the logic for `GET /portfolios/:id`: CRM, then cache, then `{ status, body }`.

## Shared contract (agree on it before writing code)

```js
// src/http.mjs (owned by A)
export const ERROR_CODES = { unauthorized: 401, not_found: 404, crm_incomplete: 502,
  crm_unavailable: 503, crm_timeout: 504, not_found_route: 404 };
export function errorBody(code, message)   // returns { error, message }
export function send(res, { status, body }) // writes JSON

// src/summary.mjs (owned by B; A pushes a stub that returns 501)
export async function getPortfolioSummary(id, { now = Date.now } = {})
  // returns { status: number, body: object }

// auth (owned by A)
req.caller = { id: 'demo' }
```

- [x] Both people agree on the contract above (change it here before coding, never after).

## Timeline

| Minute | A | B |
|---|---|---|
| 0–1 | Agree on the contract | Agree on the contract |
| 1–6 | Scaffold, then commit and push | Pure `mapCrmRecord()` and its tests (no dependencies) |
| 6 | Push the `summary.mjs` stub; B owns the file from here | Pull the scaffold |
| 6–24 | Auth → holdings → allocation → README | CRM fetch → `summary.mjs` → cache |
| ~25 | Collect B's README bullets | Manual CRM modes and the cache walkthrough |
| 25–42 | Final check together | Final check together |

---

## Checklist: Person A

### A0. Scaffold (PLAN Step 1), the blocking step for B
- [ ] `package.json` has `"type": "module"` and scripts `start` and `test` (`node --test`).
- [ ] `src/http.mjs` exports `ERROR_CODES`, `errorBody` and `send`, with every code from the contract.
- [ ] `src/data.mjs` loads `../fixtures/seed.json` and exposes lookups for portfolios and holdings.
- [ ] `src/server.mjs` reads config from environment variables (`PORT`, `CRM_BASE_URL`, `CRM_TIMEOUT_MS`, `CACHE_TTL_SECONDS`, `AUTH_TOKEN`), and unknown routes return `not_found_route`.
- [ ] `GET /health` returns `{ "status": "ok" }`.
- [ ] `src/summary.mjs` stub returns 501, and `GET /portfolios/:id` is wired to it.
- [ ] **Done when:** `npm start` serves `/health`, `npm test` runs, and the branch is pushed. Tell B.

### A1. Auth (PLAN Step 2)
- [ ] Protects `/portfolios/*` and `/clients/*`; `/health` stays open.
- [ ] Missing header, malformed header (`Token abc`, empty token), and wrong token each return 401 `unauthorized`, never a 500.
- [ ] A valid token sets `req.caller`.
- [ ] **Done when:** `test/auth.test.mjs` covers all four cases and passes.

### A2. Holdings (PLAN Step 3)
- [ ] Pure function in `holdings.mjs`. The total is the sum of the holdings' market values.
- [ ] All 12 fields are present; rounding happens only in the response.
- [ ] An unknown ID returns 404 `not_found`; `P-EMPTY` returns `[]`.
- [ ] **Done when:** unit tests match the PLAN Step 3 table, `NEW` has `dayChangePercent === null` before serialization, and the `P-9001` total is 48930.

### A3. Allocation (PLAN Step 4)
- [ ] Reuses the holdings calculations; groups by `assetClass`; keeps only values > 0, sorted by value, highest first.
- [ ] An unknown ID returns 404; `P-EMPTY` returns `[]`.
- [ ] **Done when:** unit tests for P-9001, P-SINGLE and P-EMPTY pass.

### A4. README (PLAN Step 7, protected: never cut it)
- [ ] Install and run instructions, how to start the mock CRM, and the environment variables.
- [ ] Auth token and an example header.
- [ ] What `npm test` covers.
- [ ] Assumptions (the locked decisions, each with its reason), including B's CRM and cache bullets.
- [ ] Known gaps: the global token, and the open client-vs-advisor question.
- [ ] Unfinished work: Tasks 3, 6, 7, 8 and 10, and the envelope note for Task 7.
- [ ] **Done when:** every section above exists and B has read the CRM and cache section.

## Checklist: Person B

### B0. Mapping, in parallel with A's scaffold
- [x] Pure `mapCrmRecord(payload, portfolioId)` in `crm.mjs`.
- [x] Finds `acct_ref` in `accounts` **or** `relationships.accounts`; never assumes the first account.
- [x] Reports a missing or `null` mapped field as incomplete; no `Number(null)`, `?? 0` or `* 1`.
- [x] **Done when:** `test/crm.test.mjs` passes for the standard shape, the nested shape, the incomplete record, and the account-not-first case (P-9002 gives 500).

### B1. CRM client and route (PLAN Step 5)
- [ ] `fetch` to `{CRM_BASE_URL}/crm/portfolios/:id` with an abort timeout of `CRM_TIMEOUT_MS`. Never sends `?mode=`.
- [ ] CRM 404 or no matching account → 404 `not_found`; 5xx → 503; timeout → 504; incomplete → 502.
- [ ] `summary.mjs` replaces A's stub and returns `{ status, body }`, using `errorBody` from `http.mjs`.
- [ ] **Done when:** P-9001 in `ok` mode returns 48930, 30 and 0.187, and P-9002 passes `dayChangePercent: 0` through.

### B2. Cache (PLAN Step 6)
- [ ] `cache.mjs`: `get` and `set` with `value`, `cachedAt` and `expiresAt`; the TTL comes from `CACHE_TTL_SECONDS`; the clock can be injected.
- [ ] A fresh hit makes no CRM call and returns `stale: false`.
- [ ] Expired + failure (5xx, timeout or incomplete) serves the cached value with `stale: true` and the original `cachedAt`.
- [ ] Cold + failure returns 502, 503 or 504. A CRM 404 never falls back to cached data.
- [ ] Only a complete success overwrites an entry.
- [ ] **Done when:** `test/cache.test.mjs` passes for: hit makes no call, expired + failure is stale, expired + incomplete serves 48930 stale, cold + failure is an error, recovery resets `stale`, keys don't leak between IDs.

### B3. Manual checks and README input
- [ ] Each CRM mode (`ok`, `missing`, `nested`, `error`, `timeout`), set via `POST /__control`, behaves as expected.
- [ ] The 5-step cache walkthrough in [CRM.md](../CRM.md#check-your-cache) passes, confirmed with `/__stats`.
- [ ] 4–5 bullets on the CRM and cache decisions sent to A for the README.

---

## Final check (both people)

- [ ] Both branches merged into `implementation-plan-md`.
- [ ] `npm test` passes from a clean run.
- [ ] Every in-scope request in [../requests.http](../requests.http) behaves as expected.
- [ ] No request hangs longer than the CRM timeout.
- [ ] Every error code is lowercase snake_case and comes from `ERROR_CODES`.

## Collision rules

1. Never edit a file the other person owns. Ask in chat instead.
2. Only A's scaffold commit has to land before the other person continues. After that, rebase onto the other branch often.
3. Don't add a shared test file. Each person adds only their own `test/*.test.mjs` files.
4. Tick boxes only in your own lane, in this file and in PLAN.md.
