// Config from environment variables, with defaults. Its own module so any file can read it
// without importing server.mjs (which would make server.mjs and summary.mjs import each other).
export const config = {
  port: Number(process.env.PORT ?? 3000),
  crmBaseUrl: process.env.CRM_BASE_URL ?? 'http://localhost:4002',
  crmTimeoutMs: Number(process.env.CRM_TIMEOUT_MS ?? 3000),
  cacheTtlSeconds: Number(process.env.CACHE_TTL_SECONDS ?? 30),
  authToken: process.env.AUTH_TOKEN ?? 'superday-demo-token',
};
