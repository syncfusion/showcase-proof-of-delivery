// Validates the catalogue at load (contracts/data-contract.md, "Schema and scenarios"). Returns every problem found.
import type { Catalogue } from './types';

const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
// US Letter, points.
export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 792;
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const int = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

export function validateCatalogue(input: unknown): string[] {
  const errors: string[] = [];
  const c = input as Partial<Catalogue> | null;
  if (!c || typeof c !== 'object') return ['The catalogue is not an object.'];
  if (c.schemaVersion !== 1) errors.push(`schemaVersion must be 1 (found ${String(c.schemaVersion)}).`);
  if (!int(c.fixtureVersion) || c.fixtureVersion < 1) errors.push('fixtureVersion must be an integer of 1 or more.');
  if (!c.carrier || !text(c.carrier.name) || !text(c.carrier.routeLabel)) errors.push('carrier is incomplete.');

  const list = c.deliveries;
  if (!Array.isArray(list) || list.length < 1 || list.length > 12) return [...errors, 'deliveries must hold 1 to 12 entries.'];
  const ids = new Set<string>();
  const stops = new Set<number>();
  const trackingNumbers = new Set<string>();
  for (const d of list) {
    const where = `Delivery "${d?.id ?? '?'}"`;
    if (!d || !text(d.id) || !KEBAB.test(d.id)) { errors.push(`${where}: id must be kebab-case.`); continue; }
    if (ids.has(d.id)) errors.push(`${where}: duplicate id.`);
    ids.add(d.id);
    if (!int(d.stop) || d.stop < 1) errors.push(`${where}: stop must be 1 or more.`);
    else if (stops.has(d.stop)) errors.push(`${where}: duplicate stop.`);
    stops.add(d.stop);
    if (!text(d.trackingNumber)) errors.push(`${where}: trackingNumber is required.`);
    else if (trackingNumbers.has(d.trackingNumber)) errors.push(`${where}: duplicate trackingNumber.`);
    trackingNumbers.add(d.trackingNumber);
    if (!text(d.service)) errors.push(`${where}: service is required.`);
    if (!d.recipient || !text(d.recipient.name) || !text(d.recipient.addressLine1) || typeof d.recipient.addressLine2 !== 'string') errors.push(`${where}: recipient is incomplete.`);
    if (!text(d.sender)) errors.push(`${where}: sender is required.`);
    if (!text(d.item)) errors.push(`${where}: item is required.`);
    if (typeof d.weight !== 'string') errors.push(`${where}: weight must be text (empty for a letter).`);
    if (!text(d.file) || !d.file.startsWith('receipts/') || !d.file.endsWith('.pdf')) errors.push(`${where}: file must be a PDF under receipts/.`);

    if (d.delivered !== undefined) {
      const m = d.delivered?.minutesBeforeOpen;
      if (!int(m) || m < 1 || m > 1440) errors.push(`${where}: delivered.minutesBeforeOpen must be an integer from 1 to 1440.`);
    }

    const f = d.signatureField;
    if (!f || !text(f.name)) { errors.push(`${where}: signatureField is required.`); continue; }
    if (f.page !== 1) errors.push(`${where}: signatureField.page must be 1.`);
    const b = f.bounds;
    if (!b || !(b.Width > 0) || !(b.Height > 0) || !(b.X >= 0) || !(b.Y >= 0) || b.X + b.Width > PAGE_WIDTH || b.Y + b.Height > PAGE_HEIGHT) errors.push(`${where}: signatureField.bounds must be positive and inside the page.`);
  }
  return errors;
}
