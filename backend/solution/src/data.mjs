// Seed data, loaded once into memory.
import { readFileSync } from 'node:fs';

const seed = JSON.parse(readFileSync(new URL('../../fixtures/seed.json', import.meta.url), 'utf8'));

const portfoliosById = new Map(seed.portfolios.map((p) => [p.portfolioId, p]));

export function getPortfolio(portfolioId) {
  return portfoliosById.get(portfolioId) ?? null;
}

export function getHoldings(portfolioId) {
  return seed.holdings.filter((h) => h.portfolioId === portfolioId);
}
