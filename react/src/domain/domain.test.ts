// Expected-value vectors from contracts/data-contract.md (V1 to V8) and from
// openspec/changes/carrier-look/contracts/data-contract.md (C1, C2, C7 to C9), with the fixture at version 2:
// six stops, of which stops 1 and 2 are delivered in the baseline.
// V9 (completing without a signature is refused) is exercised in the browser journey, where the command lives.
import { describe, expect, it } from 'vitest';
import raw from '../data/deliveries.json';
import type { Catalogue, DeliverySession } from './types';
import { canConfirm, deliveredEntry, groupByStatus, hasSignature, routeProgress, signedFileName, statusOf } from './rules';
import { validateCatalogue } from './validate';

const catalogue = raw as Catalogue;
const FIELD = 'recipient_signature';
const openedAt = new Date(2026, 9, 12, 12, 0); // Oct 12, 2026, 12:00 local time
const after = (minutes: number) => new Date(openedAt.getTime() + minutes * 60_000).toISOString();
const entry = (at: string) => ({ signedAt: at, signedUrl: 'blob:x', fileName: 'x.pdf', signature: [] });
const stop3: DeliverySession = { 'express-parcel-4471': entry(after(5)) };
const stop3Then5: DeliverySession = { ...stop3, 'insured-parcel-6118': entry(after(10)) };
const names = (list: Catalogue['deliveries']) => list.map((d) => d.recipient.name.split(' ')[1]);
const byId = (id: string) => catalogue.deliveries.find((d) => d.id === id)!;
const clone = (): Catalogue => JSON.parse(JSON.stringify(catalogue));

describe('fixture', () => {
  it('is valid', () => expect(validateCatalogue(catalogue)).toEqual([]));
  it('holds six stops with one signature field each, two delivered in the baseline', () => {
    expect(catalogue.deliveries).toHaveLength(6);
    expect(catalogue.deliveries.every((d) => d.signatureField.name === FIELD)).toBe(true);
    expect(catalogue.deliveries.filter((d) => d.delivered).map((d) => d.stop)).toEqual([1, 2]);
  });
});

describe('selectors', () => {
  it('V1 and C7 baseline: 4 awaiting in stop order; 2 delivered, the later one first', () => {
    const g = groupByStatus(catalogue.deliveries, {}, openedAt);
    expect(names(g.awaiting)).toEqual(['Okafor', 'Reyes', 'Raman', 'Becker']);
    expect(names(g.delivered)).toEqual(['Fitzgerald', 'Marsh']);
  });
  it('V2 nothing drawn', () => {
    expect(hasSignature({}, FIELD)).toBe(false);
    expect(canConfirm({}, FIELD)).toBe(false);
  });
  it('V3 empty value', () => expect(canConfirm({ [FIELD]: '' }, FIELD)).toBe(false));
  it('V4 any drawing is accepted', () => {
    expect(canConfirm({ [FIELD]: 'M10 10 L11 11' }, FIELD)).toBe(true);
    expect(canConfirm({ [FIELD]: 'x' }, FIELD)).toBe(true);
  });
  it('V5 and C9 after completing stop 3', () => {
    const g = groupByStatus(catalogue.deliveries, stop3, openedAt);
    expect(names(g.awaiting)).toEqual(['Reyes', 'Raman', 'Becker']);
    expect(names(g.delivered)).toEqual(['Okafor', 'Fitzgerald', 'Marsh']);
    expect(statusOf(byId('express-parcel-4471'), stop3)).toBe('delivered');
  });
  it('V6 two completed in this session: latest first, then the baseline', () => {
    expect(names(groupByStatus(catalogue.deliveries, stop3Then5, openedAt).delivered)).toEqual(['Raman', 'Okafor', 'Fitzgerald', 'Marsh']);
  });
  it('V7 reset equals the baseline', () => {
    const g = groupByStatus(catalogue.deliveries, {}, openedAt);
    expect([g.awaiting.length, g.delivered.length]).toEqual([4, 2]);
  });
  it('V8 file name', () => expect(signedFileName(byId('express-parcel-4471'))).toBe('Delivery receipt BCP-4471-2086-19 - signed.pdf'));
});

describe('baseline deliveries', () => {
  it('C8 a baseline entry is worked out from when the app opened', () => {
    const marsh = deliveredEntry(byId('standard-parcel-2210'), {}, openedAt)!;
    const signed = new Date(marsh.signedAt);
    expect([signed.getHours(), signed.getMinutes()]).toEqual([10, 25]);
    expect(marsh.fileName).toBe('Delivery receipt BCP-2210-4583-71 - signed.pdf');
    expect(marsh.signature).toEqual([]);
    expect(marsh.receipt).toEqual({ kind: 'baseline', file: 'receipts/standard-parcel-2210-signed.pdf' });
  });
  it('a stop awaiting a signature has no entry; a session signing has its own', () => {
    expect(deliveredEntry(byId('express-parcel-4471'), {}, openedAt)).toBeNull();
    expect(deliveredEntry(byId('express-parcel-4471'), stop3, openedAt)!.receipt).toEqual({ kind: 'session', url: 'blob:x' });
  });
  it('is delivered whatever the session holds', () => expect(statusOf(byId('certified-letter-3047'), {})).toBe('delivered'));
});

describe('route progress', () => {
  it('C1 baseline: six stops in route order, the first two delivered', () => {
    const r = routeProgress(catalogue.deliveries, {});
    expect(r.stops.map((s) => [s.stop, s.label, s.delivered])).toEqual([[1, 'Marsh', true], [2, 'Fitzgerald', true], [3, 'Okafor', false], [4, 'Reyes', false], [5, 'Raman', false], [6, 'Becker', false]]);
    expect([r.delivered, r.total]).toEqual([2, 6]);
  });
  it('C2 stops signed out of order', () => {
    const r = routeProgress(catalogue.deliveries, stop3Then5);
    expect(r.stops.map((s) => s.delivered)).toEqual([true, true, true, false, true, false]);
    expect([r.delivered, r.total]).toEqual([4, 6]);
  });
});

describe('invalid catalogues are rejected', () => {
  const bad = (change: (c: Catalogue) => void) => { const c = clone(); change(c); return validateCatalogue(c); };
  it('schemaVersion 2', () => expect(bad((c) => { (c as { schemaVersion: number }).schemaVersion = 2; })).not.toEqual([]));
  it('duplicate id', () => expect(bad((c) => { c.deliveries[1].id = c.deliveries[0].id; })).not.toEqual([]));
  it('duplicate stop', () => expect(bad((c) => { c.deliveries[1].stop = c.deliveries[0].stop; })).not.toEqual([]));
  it('empty recipient name', () => expect(bad((c) => { c.deliveries[0].recipient.name = ' '; })).not.toEqual([]));
  it('signature field on page 2', () => expect(bad((c) => { c.deliveries[0].signatureField.page = 2; })).not.toEqual([]));
  it('zero width', () => expect(bad((c) => { c.deliveries[0].signatureField.bounds.Width = 0; })).not.toEqual([]));
  it('file that is not a PDF', () => expect(bad((c) => { c.deliveries[0].file = 'receipts/x.txt'; })).not.toEqual([]));
  it('delivered 0 minutes before open', () => expect(bad((c) => { c.deliveries[0].delivered = { minutesBeforeOpen: 0 }; })).not.toEqual([]));
  it('delivered 2000 minutes before open', () => expect(bad((c) => { c.deliveries[0].delivered = { minutesBeforeOpen: 2000 }; })).not.toEqual([]));
  it('delivered a fraction of a minute before open', () => expect(bad((c) => { c.deliveries[0].delivered = { minutesBeforeOpen: 1.5 }; })).not.toEqual([]));
  it('not an object', () => expect(validateCatalogue(null)).not.toEqual([]));
});
