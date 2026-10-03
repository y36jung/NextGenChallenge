// Shared JSON and error helpers. Every error code the API can return is listed here.
export const ERROR_CODES = {
  unauthorized: 401,
  not_found: 404,
  crm_incomplete: 502,
  crm_unavailable: 503,
  crm_timeout: 504,
  not_found_route: 404,
};

export function errorBody(code, message) {
  return { error: code, message };
}

export function send(res, { status, body }) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

// Shorthand for an error response; the status always comes from ERROR_CODES.
export function sendError(res, code, message) {
  send(res, { status: ERROR_CODES[code], body: errorBody(code, message) });
}
