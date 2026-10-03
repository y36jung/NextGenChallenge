import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { send, sendError } from './http.mjs';
import { getPortfolioSummary } from './summary.mjs';
import { config } from './config.mjs';
import { authenticate, isProtected } from './auth.mjs';

export { config };

// Each route: method, path pattern, handler(req, res, params).
const routes = [
  ['GET', /^\/health$/, (req, res) => send(res, { status: 200, body: { status: 'ok' } })],
  ['GET', /^\/portfolios\/([^/]+)$/, async (req, res, [id]) => send(res, await getPortfolioSummary(id))],
];

export async function handle(req, res) {
  const { pathname } = new URL(req.url, 'http://localhost');
  // Auth runs before any route logic on protected paths.
  if (isProtected(pathname)) {
    const auth = authenticate(req.headers.authorization, config.authToken);
    if (!auth.ok) return sendError(res, 'unauthorized', auth.message);
    req.caller = auth.caller;
  }
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
