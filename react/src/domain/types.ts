// Domain types (contracts/data-contract.md). No React or Syncfusion imports in this folder.

/** Field position in PDF points from the page's top-left corner (capitalised, as the PDF Viewer expects). */
export interface FieldBounds { X: number; Y: number; Width: number; Height: number }

/** The one field on a receipt: the recipient's signature. */
export interface SignatureField {
  name: string;
  /** 1-based page number; receipts are one page. */
  page: number;
  bounds: FieldBounds;
}

export interface Delivery {
  id: string;
  /** Order on the route and in the list. */
  stop: number;
  trackingNumber: string;
  service: string;
  recipient: { name: string; addressLine1: string; addressLine2: string };
  sender: string;
  item: string;
  /** Display text such as "4.8 lb"; empty for a letter. */
  weight: string;
  /** The unsigned receipt; for a baseline delivery, the signed receipt (flattened, no field). */
  file: string;
  signatureField: SignatureField;
  /** Present on a stop that is already delivered when the app opens. */
  delivered?: { minutesBeforeOpen: number };
}

export interface Catalogue {
  schemaVersion: 1;
  fixtureVersion: number;
  carrier: { name: string; routeLabel: string };
  deliveries: Delivery[];
}

/** One point of a drawn signature, as the viewer reports it. Only relative positions matter. */
export interface StrokePoint { command: 'M' | 'L'; x: number; y: number }

/** One signed receipt held for this tab only, with the drawing it was confirmed with (shown on the delivery slip). */
export interface SessionEntry { signedAt: string; signedUrl: string; fileName: string; signature: StrokePoint[] }
export type DeliverySession = Readonly<Record<string, SessionEntry>>;

/** A delivered stop, whichever way it became one: signed in this tab, or delivered in the shipped baseline. */
export interface DeliveredEntry {
  signedAt: string;
  fileName: string;
  signature: StrokePoint[];
  receipt: { kind: 'session'; url: string } | { kind: 'baseline'; file: string };
}

/** Current values of a receipt's fields, by field name. Empty or missing means not signed. */
export type FieldValues = Readonly<Record<string, string | undefined>>;

export type DeliveryStatus = 'awaiting' | 'delivered';
