// The tab's delivery session: the validated catalogue plus an in-memory overlay of receipts signed here.
// Nothing is written to browser storage; a reload or Reset returns to the baseline (app-plan.md, "Profiles").
// The baseline itself has stops that are already delivered (catalogue `delivered`); they come from the shipped
// JSON and static PDFs and are the same in every tab.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { absoluteAssetUrl } from '../adapters/basePath';
import type { CatalogueResult } from '../adapters/catalogue';
import { browserClock } from '../adapters/clock';
import type { Clock } from '../adapters/clock';
import type { Catalogue, Delivery, DeliveredEntry, DeliverySession, StrokePoint } from '../domain/types';
import { deliveredEntry, signedFileName, statusOf } from '../domain/rules';

/** A delivered stop with the address its signed receipt can be opened or downloaded from. */
export type DeliveredReceipt = DeliveredEntry & { url: string };

interface Store {
  load: CatalogueResult;
  catalogue: Catalogue | null;
  session: DeliverySession;
  /** When this tab opened the app; baseline deliveries' times are worked out from it. */
  openedAt: Date;
  /** The delivered state of a stop (this session's or the baseline's), or null while it awaits a signature. */
  delivered(delivery: Delivery): DeliveredReceipt | null;
  /** Records a confirmed delivery; the blob is the flattened signed receipt. This is the one place a signature is
   *  accepted, so it is where a customer would add real verification. */
  completeDelivery(delivery: Delivery, signedPdf: Blob, signedAt: Date, signature: StrokePoint[]): void;
  reset(): void;
}

const Ctx = createContext<Store | null>(null);

export function DeliveryStoreProvider({ load, clock = browserClock, children }: { load: CatalogueResult; clock?: Clock; children: ReactNode }) {
  const [session, setSession] = useState<DeliverySession>({});
  const [openedAt] = useState(() => clock.now());
  const urls = useRef<string[]>([]);

  const completeDelivery = useCallback((delivery: Delivery, signedPdf: Blob, signedAt: Date, signature: StrokePoint[]) => {
    const signedUrl = URL.createObjectURL(signedPdf);
    urls.current.push(signedUrl);
    setSession((s) => (statusOf(delivery, s) === 'delivered' ? s : { ...s, [delivery.id]: { signedAt: signedAt.toISOString(), signedUrl, fileName: signedFileName(delivery), signature } }));
  }, []);

  const reset = useCallback(() => {
    urls.current.forEach((u) => URL.revokeObjectURL(u));
    urls.current = [];
    setSession({});
  }, []);

  useEffect(() => () => { urls.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  const delivered = useCallback((delivery: Delivery): DeliveredReceipt | null => {
    const entry = deliveredEntry(delivery, session, openedAt);
    // The PDF Viewer needs a full URL; a download accepts one too.
    return entry ? { ...entry, url: entry.receipt.kind === 'session' ? entry.receipt.url : absoluteAssetUrl(entry.receipt.file) } : null;
  }, [session, openedAt]);

  const value = useMemo<Store>(() => ({
    load, catalogue: load.ok ? load.catalogue : null, session, openedAt, delivered, completeDelivery, reset,
  }), [load, session, openedAt, delivered, completeDelivery, reset]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDeliveryStore(): Store {
  const store = useContext(Ctx);
  if (!store) throw new Error('useDeliveryStore must be used inside DeliveryStoreProvider');
  return store;
}
