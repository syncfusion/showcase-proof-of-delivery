// The JSON source: imported with the bundle and validated once at startup (contracts/data-contract.md).
import raw from '../data/deliveries.json';
import type { Catalogue } from '../domain/types';
import { validateCatalogue } from '../domain/validate';

export type CatalogueResult = { ok: true; catalogue: Catalogue } | { ok: false; errors: string[] };

export function loadCatalogue(source: unknown = raw): CatalogueResult {
  const errors = validateCatalogue(source);
  return errors.length ? { ok: false, errors } : { ok: true, catalogue: source as Catalogue };
}
