const isText = v => typeof v === 'string' && v.length > 0;
const isNumber = v => typeof v === 'number' && Number.isFinite(v);
const isTimestamp = v => isText(v) && !Number.isNaN(Date.parse(v));

// Maps the CRM's legacy shape to our schema. Pure: no HTTP, no clock.
// Returns { ok: true, value } or { ok: false, reason: 'not_found' | 'incomplete', missing }.
// Amounts are passed through unchanged, so no rounding happens here.
export function mapCrmRecord(payload, portfolioId) {
  const record = payload?.client_record ?? {};
  // The CRM sometimes nests accounts under relationships, so look in both places.
  const lists = [record.accounts, record.relationships?.accounts].filter(Array.isArray);
  if (lists.length === 0) {
    return { ok: false, reason: 'incomplete', missing: ['client_record.accounts'] };
  }

  // The response lists all of the client's accounts, so select by reference, not position.
  const matches = lists.flat().filter(a => a?.acct_ref === portfolioId);
  if (matches.length === 0) return { ok: false, reason: 'not_found', missing: [] };
  // Two accounts with the same reference: we cannot know which is right, so fail closed.
  if (matches.length > 1) return { ok: false, reason: 'incomplete', missing: ['acct_ref (duplicate)'] };
  const account = matches[0];

  // Checked explicitly: null or absent is "missing", never coerced to 0 or ''.
  const fields = [
    ['clientId', 'client_id', record.client_id, isText],
    ['label', 'acct_nickname', account.acct_nickname, isText],
    ['currency', 'curr_val.ccy', account.curr_val?.ccy, isText],
    ['totalMarketValue', 'curr_val.amt', account.curr_val?.amt, isNumber],
    ['dayChangeAmount', 'chg_1d.amt', account.chg_1d?.amt, isNumber],
    ['dayChangePercent', 'chg_1d.pct', account.chg_1d?.pct, isNumber],
    ['totalReturnSinceInception', 'since_inception_pct', account.since_inception_pct, isNumber],
    ['asOf', 'meta.retrieved_at', payload?.meta?.retrieved_at, isTimestamp],
  ];

  const missing = fields.filter(([, , value, valid]) => !valid(value)).map(([, crmName]) => crmName);
  if (missing.length > 0) return { ok: false, reason: 'incomplete', missing };

  const value = { portfolioId };
  for (const [name, , fieldValue] of fields) value[name] = fieldValue;
  return { ok: true, value };
}

// Calls the CRM for one portfolio and maps the result. Never throws, never sends ?mode=.
// Returns mapCrmRecord's result, or { ok: false, reason: 'not_found' | 'unavailable' | 'timeout' | 'incomplete' }.
// One timeout signal covers both the response headers and reading the body.
export async function fetchCrm(id, { baseUrl, timeoutMs, fetch = globalThis.fetch }) {
  const signal = AbortSignal.timeout(timeoutMs);
  const url = `${baseUrl}/crm/portfolios/${encodeURIComponent(id)}`;
  let text;
  try {
    const res = await fetch(url, { signal, headers: { accept: 'application/json' } });
    if (res.status === 404) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, reason: 'not_found', missing: [] };
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, reason: 'unavailable' };
    }
    text = await res.text();
  } catch (err) {
    if (signal.aborted || err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      return { ok: false, reason: 'timeout' };
    }
    return { ok: false, reason: 'unavailable' };
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'incomplete', missing: ['response body (not JSON)'] };
  }
  return mapCrmRecord(payload, id);
}
