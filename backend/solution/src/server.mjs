import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { send, sendError } from './http.mjs';
import { getPortfolioSummary } from './summary.mjs';

export const config = {
  port: Number(process.env.PORT ?? 3000),
  crmBaseUrl: process.env.CRM_BASE_URL ?? 'http://localhost:4002',
  crmTimeoutMs: Number(process.env.CRM_TIMEOUT_MS ?? 3000),
  cacheTtlSeconds: Number(process.env.CACHE_TTL_SECONDS ?? 30),
  authToken: process.env.AUTH_TOKEN ?? 'superday-demo-token',
};

// Each route: method, path pattern, handler(req, res, params).
const routes = [
  ['GET', /^\/health$/, (req, res) => send(res, { status: 200, body: { status: 'ok' } })],
  ['GET', /^\/portfolios\/([^/]+)$/, async (req, res, [id]) => send(res, await getPortfolioSummary(id))],
];

export async function handle(req, res) {
  const { pathname } = new URL(req.url, 'http://localhost');
  for (const [method, pattern, handler] of routes) {
    const match = req.method === method && pattern.exec(pathname);
    if (match) return handler(req, res, match.slice(1).map(decodeURIComponent));
  }
  sendError(res, 'not_found_route', `No route for ${req.method} ${pathname}`);
}

export function createServer() {
  return http.createServer((req, res) => {
    Promise.resolve(handle(req, res)).catch((err) => {
      console.error(err);
      if (!res.headersSent) send(res, { status: 500, body: { error: 'internal_error', message: 'Unexpected error' } });
      else res.end();
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer().listen(config.port, () => console.log(`Listening on http://localhost:${config.port}`));
}
