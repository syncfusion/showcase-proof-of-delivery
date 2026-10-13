// Turns the viewer's saved copy into the final signed receipt (app-plan.md, "Signing pipeline"): the signing date
// is printed under the signature box, the watermark is stamped on the page, then the form field and signature are
// flattened into page content, so the result is read-only everywhere. The watermark is part of the signed copy
// only; it is never shown while signing.
import { PdfBitmap, PdfBrush, PdfDocument, PdfFontFamily, PdfFontStyle, PdfStandardFont } from '@syncfusion/ej2-pdf';
import type { PdfPage } from '@syncfusion/ej2-pdf';
import { assetUrl } from './basePath';
import type { FieldBounds } from '../domain/types';

// Size, opacity and corner follow apps/e-signing-portal; the bottom offset clears the page footer.
export const WATERMARK = { path: 'branding/syncfusion-watermark.jpg', widthPt: 112, opacity: 0.16, rightPt: 24, bottomPt: 60 } as const;
// The printed signature box extends 8pt beyond the field (scripts/generate-receipts.mjs, BOX_PAD); the line sits under it.
const SIGNED_ON = { boxPadPt: 8, gapPt: 6, fontPt: 9, ink: { r: 71, g: 84, b: 103 } } as const;

/** Where the signature sits and the line to print under it. */
export interface SignedStamp { page: number; bounds: FieldBounds; signedOn: string }
export interface FinalizedPdf { pdf: Blob; watermarked: boolean }
export interface PdfFinalizer { finalize(saved: Blob, stamp: SignedStamp): Promise<FinalizedPdf> }

let watermarkBytes: Promise<Uint8Array> | null = null;
function loadWatermark(): Promise<Uint8Array> {
  watermarkBytes ??= fetch(assetUrl(WATERMARK.path)).then(async (response) => {
    if (!response.ok || !(response.headers.get('content-type') ?? '').startsWith('image/')) throw new Error(`Watermark image not available (${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  });
  // A failed load is not kept, so the next signing tries again.
  watermarkBytes.catch(() => { watermarkBytes = null; });
  return watermarkBytes;
}

/** Stamps the watermark at the bottom right of one page. */
export function drawWatermark(page: PdfPage, image: PdfBitmap): void {
  const height = image.height * (WATERMARK.widthPt / image.width);
  const g = page.graphics;
  const state = g.save();
  g.setTransparency(WATERMARK.opacity);
  g.drawImage(image, { x: page.size.width - WATERMARK.widthPt - WATERMARK.rightPt, y: page.size.height - height - WATERMARK.bottomPt, width: WATERMARK.widthPt, height });
  g.restore(state);
}

/** Prints "Signed on <date and time>" under the signature box. */
export function drawSignedOn(page: PdfPage, stamp: SignedStamp): void {
  const b = stamp.bounds;
  const font = new PdfStandardFont(PdfFontFamily.helvetica, SIGNED_ON.fontPt, PdfFontStyle.regular);
  // Standard PDF fonts cover Latin-1 only; a narrow no-break space from the date formatter becomes a plain space.
  const text = stamp.signedOn.replace(/[   ]/g, ' ').replace(/[^\x20-\x7e¡-ÿ]/g, '');
  page.graphics.drawString(text, font, { x: b.X - SIGNED_ON.boxPadPt, y: b.Y + b.Height + SIGNED_ON.boxPadPt + SIGNED_ON.gapPt, width: 420, height: SIGNED_ON.fontPt * 1.6 }, new PdfBrush(SIGNED_ON.ink));
}

export const signedCopyFinalizer: PdfFinalizer = {
  async finalize(saved, stamp) {
    const [bytes, mark] = await Promise.all([
      saved.arrayBuffer().then((b) => new Uint8Array(b)),
      loadWatermark().catch((error) => { console.warn('Signed receipt produced without its watermark', error); return null; }),
    ]);
    const doc = new PdfDocument(bytes);
    try {
      drawSignedOn(doc.getPage(stamp.page - 1), stamp);
      let watermarked = false;
      if (mark) {
        const image = new PdfBitmap(mark);
        for (let i = 0; i < doc.pageCount; i++) drawWatermark(doc.getPage(i), image);
        watermarked = true;
      }
      doc.flatten = true;
      const out = doc.save();
      // Copy into a plain ArrayBuffer: save() is typed over ArrayBufferLike, which Blob does not accept.
      const buffer = new ArrayBuffer(out.byteLength);
      new Uint8Array(buffer).set(out);
      return { pdf: new Blob([buffer], { type: 'application/pdf' }), watermarked };
    } finally {
      doc.destroy();
    }
  },
};
