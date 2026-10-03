// GET /portfolios/:id: calls the CRM and turns the result into { status, body }.
// The cache (B2) will wrap the CRM call here.
import { errorBody, ERROR_CODES } from './http.mjs';
import { config } from './config.mjs';
import { fetchCrm } from './crm.mjs';

const reasonToCode = {
  not_found: 'not_found',
  unavailable: 'crm_unavailable',
  timeout: 'crm_timeout',
  incomplete: 'crm_incomplete',
};

function messageFor(code, id, missing) {
  switch (code) {
    case 'not_found': return `Portfolio ${id} was not found`;
    case 'crm_timeout': return 'The CRM did not respond in time';
    case 'crm_incomplete':
      return `The CRM record is incomplete; missing or invalid: ${(missing ?? []).join(', ') || 'unknown'}`;
    default: return 'The CRM is unavailable';
  }
}

export async function getPortfolioSummary(id, { now = Date.now, crm = fetchCrm } = {}) {
  let result;
  try {
    result = await crm(id, { baseUrl: config.crmBaseUrl, timeoutMs: config.crmTimeoutMs });
  } catch {
    // fetchCrm never throws, but an injected client might; treat that as unavailable.
    result = { ok: false, reason: 'unavailable' };
  }
  if (result?.ok) return { status: 200, body: result.value };
  const code = reasonToCode[result?.reason] ?? 'crm_unavailable';
  return { status: ERROR_CODES[code], body: errorBody(code, messageFor(code, id, result?.missing)) };
}
