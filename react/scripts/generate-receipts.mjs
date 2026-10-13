// Generates the four delivery receipts in public/receipts/ with the Syncfusion JS PDF library (@syncfusion/ej2-pdf).
// All content is fictional, written for this app, and read from src/data/deliveries.json, which also holds the
// signature field's position: this script only prints the box the interactive field will sit in. The receipts
// carry no date; the signing date is printed on the signed copy (src/adapters/pdfFinalizer.ts).
// Rerun with `npm run generate-receipts` when the catalogue or the layout changes; the PDFs are committed.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { PdfDocument, PdfPageSettings, PdfMargins, PdfStandardFont, PdfFontFamily, PdfFontStyle, PdfBrush, PdfPen, PdfPath, PdfBitmap } = require('@syncfusion/ej2-pdf');

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'public', 'receipts');
const catalogue = JSON.parse(readFileSync(join(root, 'src', 'data', 'deliveries.json'), 'utf8'));

const PAGE = { width: 612, height: 792 }; // US Letter, points
const MARGIN = 72;
const WIDTH = PAGE.width - MARGIN * 2;
const INK = { r: 23, g: 32, b: 51 };
const MUTED = { r: 102, g: 112, b: 133 };
const BRAND = { r: 20, g: 108, b: 132 }; // the app's Ink, #146c84 (src/styles/app-tokens.css)
const RULE = { r: 208, g: 213, b: 221 };
const BAND = { r: 236, g: 244, b: 246 };
const SIGN_INK = { r: 10, g: 58, b: 71 }; // Ink deep, #0a3a47
// Same placement as the watermark in src/adapters/pdfFinalizer.ts (WATERMARK).
const WATERMARK = { file: join(root, 'public', 'branding', 'syncfusion-watermark.jpg'), widthPt: 112, opacity: 0.16, rightPt: 24, bottomPt: 60 };

/** A handwritten-looking stroke built from Bezier curves, for a stop that is already delivered; `seed` varies the shape. */
function drawInk(g, x, y, scale, seed) {
  const path = new PdfPath();
  let px = x, py = y + 22 * scale;
  for (let i = 0; i < 9; i++) {
    const up = i % 2 === 0;
    const w = (10 + ((i * 7 + seed * 3) % 9)) * scale;
    const h = (up ? -(14 + ((i * 5 + seed) % 12)) : 10 + ((i * 3 + seed) % 8)) * scale;
    path.addBezier({ x: px, y: py }, { x: px + w * 0.3, y: py + h }, { x: px + w * 0.7, y: py + h }, { x: px + w, y: py + (up ? 4 : -4) * scale });
    px += w; py += (up ? 4 : -4) * scale;
  }
  path.addBezier({ x: px, y: py }, { x: px + 12 * scale, y: py - 6 * scale }, { x: px + 26 * scale, y: py + 6 * scale }, { x: px + 44 * scale, y: py - 2 * scale });
  g.drawPath(path, new PdfPen(SIGN_INK, 1.4));
}

// The printed box extends this far beyond the field on every side.
const BOX_PAD = 8;

const font = (size, style = PdfFontStyle.regular) => new PdfStandardFont(PdfFontFamily.helvetica, size, style);

function receipt(delivery) {
  // Fonts belong to one document: reusing font objects in a second PdfDocument made ej2-pdf 34.2.8 write duplicate
  // object numbers (an unreadable file), so each receipt gets its own set.
  const F = { brand: font(12, PdfFontStyle.bold), title: font(22, PdfFontStyle.bold), label: font(8.5, PdfFontStyle.bold), body: font(11), strong: font(11, PdfFontStyle.bold), tracking: font(16, PdfFontStyle.bold), small: font(8.5) };
  const doc = new PdfDocument();
  const settings = new PdfPageSettings();
  settings.size = PAGE;
  settings.margins = new PdfMargins(0);
  const g = doc.addPage(settings).graphics;
  const ink = new PdfBrush(INK);
  const muted = new PdfBrush(MUTED);
  const rule = new PdfPen(RULE, 0.75);
  const text = (value, f, x, y, width = WIDTH, brush = ink) => g.drawString(value, f, { x, y, width, height: f.size * 1.5 }, brush);
  const label = (value, x, y, width = WIDTH) => text(value.toUpperCase(), F.label, x, y, width, muted);

  // Letterhead
  g.drawRectangle({ x: 0, y: 0, width: PAGE.width, height: 6 }, new PdfBrush(BRAND));
  text(catalogue.carrier.name.toUpperCase(), F.brand, MARGIN, 34, WIDTH, new PdfBrush(BRAND));
  text('Signature on delivery', F.small, MARGIN, 52, WIDTH, muted);
  text('Delivery Receipt', F.title, MARGIN, 84);

  // Tracking band
  g.drawRectangle({ x: MARGIN, y: 128, width: WIDTH, height: 58 }, new PdfBrush(BAND));
  label('Tracking number', MARGIN + 14, 138, 240);
  text(delivery.trackingNumber, F.tracking, MARGIN + 14, 152, 280);
  label('Service', MARGIN + 300, 138, 160);
  text(delivery.service, F.strong, MARGIN + 300, 155, 160);

  // Deliver to / From
  const colY = 214;
  label('Deliver to', MARGIN, colY, 220);
  text(delivery.recipient.name, F.strong, MARGIN, colY + 16, 220);
  text(delivery.recipient.addressLine1, F.body, MARGIN, colY + 33, 220);
  text(delivery.recipient.addressLine2, F.body, MARGIN, colY + 50, 220);
  label('From', MARGIN + 260, colY, 208);
  text(delivery.sender, F.strong, MARGIN + 260, colY + 16, 208);
  label('Route stop', MARGIN + 260, colY + 40, 208);
  text(String(delivery.stop), F.body, MARGIN + 260, colY + 54, 208);

  // Item
  const tableY = 312;
  g.drawLine(rule, { x: MARGIN, y: tableY }, { x: PAGE.width - MARGIN, y: tableY });
  label('Item', MARGIN, tableY + 10, 260);
  label('Weight', MARGIN + 300, tableY + 10, 100);
  label('Pieces', MARGIN + 400, tableY + 10, 68);
  g.drawLine(rule, { x: MARGIN, y: tableY + 28 }, { x: PAGE.width - MARGIN, y: tableY + 28 });
  text(delivery.item, F.body, MARGIN, tableY + 38, 290);
  text(delivery.weight || 'Letter', F.body, MARGIN + 300, tableY + 38, 100);
  text('1', F.body, MARGIN + 400, tableY + 38, 68);
  g.drawLine(rule, { x: MARGIN, y: tableY + 62 }, { x: PAGE.width - MARGIN, y: tableY + 62 });

  // Acknowledgment
  label('Acknowledgment', MARGIN, 410);
  g.drawString('I confirm that I have received the item described above in good condition. My signature below is the proof of delivery for this tracking number.',
    F.body, { x: MARGIN, y: 426, width: WIDTH, height: 48 }, ink);

  // Signature box, around the field's position from the catalogue.
  const b = delivery.signatureField.bounds;
  const box = { x: b.X - BOX_PAD, y: b.Y - BOX_PAD, width: b.Width + BOX_PAD * 2, height: b.Height + BOX_PAD * 2 };
  if (box.y - 18 < 480 || box.x < MARGIN - BOX_PAD || box.x + box.width > PAGE.width - MARGIN) throw new Error(`${delivery.id}: the signature box does not fit the layout`);
  label('Recipient signature', box.x, box.y - 16, 260);
  g.drawRectangle(box, new PdfPen(INK, 0.9));
  label('Printed name', box.x + box.width + 24, box.y + 4, 150);
  text(delivery.recipient.name, F.body, box.x + box.width + 24, box.y + 20, 150);

  // A stop that is delivered in the baseline ships as a signed receipt: a stroke in the box, a signed line with
  // no date (the app works the time out from when it is opened), and the watermark every signed copy carries.
  if (delivery.delivered) {
    drawInk(g, b.X + 34, b.Y + 14, 1.1, delivery.stop * 3 + 1);
    text('Signed electronically on delivery. This receipt is complete and read-only.', F.small, box.x, box.y + box.height + 6, 420, muted);
    const mark = new PdfBitmap(new Uint8Array(readFileSync(WATERMARK.file)));
    const markHeight = mark.height * (WATERMARK.widthPt / mark.width);
    const state = g.save();
    g.setTransparency(WATERMARK.opacity);
    g.drawImage(mark, { x: PAGE.width - WATERMARK.widthPt - WATERMARK.rightPt, y: PAGE.height - markHeight - WATERMARK.bottomPt, width: WATERMARK.widthPt, height: markHeight });
    g.restore(state);
  }

  // Footer
  g.drawLine(rule, { x: MARGIN, y: PAGE.height - 54 }, { x: PAGE.width - MARGIN, y: PAGE.height - 54 });
  text(`${catalogue.carrier.name}  |  Sample receipt, fictional content`, F.small, MARGIN, PAGE.height - 46, WIDTH, muted);

  const bytes = doc.save();
  doc.destroy();
  // Self-check: the file must open again as one page with unique object numbers.
  const check = new PdfDocument(bytes);
  const pages = check.pageCount;
  void check.getPage(0).size;
  check.destroy();
  const ids = [...Buffer.from(bytes).toString('latin1').matchAll(/(?:^|[\r\n])(\d+) 0 obj/g)].map((m) => m[1]);
  if (pages !== 1 || new Set(ids).size !== ids.length) throw new Error(`${delivery.file}: generated file failed its self-check (pages ${pages}, objects ${ids.length}, unique ${new Set(ids).size})`);
  writeFileSync(join(root, 'public', delivery.file), bytes);
  console.log(`${delivery.file}${delivery.delivered ? ' (signed, baseline delivery)' : ''}: 1 page, ${bytes.length} bytes, signature box at (${box.x}, ${box.y}) ${box.width} x ${box.height}, self-check passed`);
}

mkdirSync(outDir, { recursive: true });
for (const delivery of catalogue.deliveries) receipt(delivery);
// ej2 keeps the Node event loop alive after the work is done.
process.exit(0);
