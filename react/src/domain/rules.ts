// Pure delivery rules and selectors (contracts/data-contract.md and openspec/changes/carrier-look/contracts/data-contract.md).
import type { Delivery, DeliveredEntry, DeliverySession, DeliveryStatus, FieldValues } from './types';

/** Delivered when the catalogue says so (a baseline delivery) or this tab's session holds a signed receipt for it. */
export function statusOf(delivery: Delivery, session: DeliverySession): DeliveryStatus {
  return delivery.delivered || session[delivery.id] ? 'delivered' : 'awaiting';
}

/** What is known about a delivered stop: this session's signing, or the baseline's, whose time is worked out from
 *  when the app was opened so the shipped data never shows a stale date. Null while the stop awaits a signature. */
export function deliveredEntry(delivery: Delivery, session: DeliverySession, openedAt: Date): DeliveredEntry | null {
  const entry = session[delivery.id];
  if (entry) return { signedAt: entry.signedAt, fileName: entry.fileName, signature: entry.signature, receipt: { kind: 'session', url: entry.signedUrl } };
  if (!delivery.delivered) return null;
  const signedAt = new Date(openedAt.getTime() - delivery.delivered.minutesBeforeOpen * 60_000).toISOString();
  return { signedAt, fileName: signedFileName(delivery), signature: [], receipt: { kind: 'baseline', file: delivery.file } };
}

export function groupByStatus(deliveries: readonly Delivery[], session: DeliverySession, openedAt: Date) {
  const awaiting = deliveries.filter((d) => statusOf(d, session) === 'awaiting').sort((a, b) => a.stop - b.stop);
  const signedTime = (d: Delivery) => new Date(deliveredEntry(d, session, openedAt)!.signedAt).getTime();
  const delivered = deliveries.filter((d) => statusOf(d, session) === 'delivered')
    .sort((a, b) => signedTime(b) - signedTime(a) || b.stop - a.stop);
  return { awaiting, delivered };
}

export interface RouteStop { id: string; stop: number; label: string; delivered: boolean }

/** The route for the Deliveries page: every stop in route order with whether it has been signed for. */
export function routeProgress(deliveries: readonly Delivery[], session: DeliverySession) {
  const stops: RouteStop[] = [...deliveries].sort((a, b) => a.stop - b.stop)
    .map((d) => ({ id: d.id, stop: d.stop, label: d.recipient.name.trim().split(/\s+/).pop() ?? '', delivered: statusOf(d, session) === 'delivered' }));
  return { stops, delivered: stops.filter((s) => s.delivered).length, total: stops.length };
}

export const hasSignature = (values: FieldValues, fieldName: string) => (values[fieldName] ?? '').trim().length > 0;

/** A delivery can be confirmed once the field holds any drawing. The drawing itself is never examined:
 *  the app does not verify signatures (user decision of 2026-10-11). */
export const canConfirm = hasSignature;

export function signedFileName(delivery: Pick<Delivery, 'trackingNumber'>): string {
  const tracking = delivery.trackingNumber.replace(/[\\/:*?"<>|]+/g, ' ').trim().replace(/\s+/g, '-');
  return `Delivery receipt ${tracking || 'unknown'} - signed.pdf`;
}

export const SIGNATURE_REQUIRED_MESSAGE = 'A signature is required';
