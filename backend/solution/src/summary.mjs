// STUB from Person A's scaffold. Person B owns this file and replaces it with
// the CRM + cache logic for GET /portfolios/:id.
import { errorBody } from './http.mjs';

export async function getPortfolioSummary(id, { now = Date.now } = {}) {
  return { status: 501, body: errorBody('not_implemented', 'Portfolio summary is not implemented yet') };
}
