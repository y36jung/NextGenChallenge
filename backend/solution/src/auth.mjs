// Bearer-token auth. Pure: no HTTP, never throws.
import { timingSafeEqual } from 'node:crypto';

const CALLER = { id: 'demo' }; // fixed identity until real users exist

export function isProtected(pathname) {
  return /^\/(portfolios|clients)(\/|$)/.test(pathname);
}

// Returns { ok: true, caller } or { ok: false, message }.
export function authenticate(header, expectedToken) {
  if (typeof header !== 'string' || header.trim() === '') return { ok: false, message: 'Missing Authorization header' };
  const match = /^\s*(\S+)\s+(\S+)\s*$/.exec(header);
  if (!match || match[1].toLowerCase() !== 'bearer') {
    return { ok: false, message: 'Authorization header must be "Bearer <token>"' };
  }
  const given = Buffer.from(match[2]);
  const expected = Buffer.from(String(expectedToken ?? ''));
  if (expected.length === 0 || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, message: 'Invalid token' };
  }
  return { ok: true, caller: { ...CALLER } };
}
