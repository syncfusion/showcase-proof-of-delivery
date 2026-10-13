// Runs the plan's approval journey (openspec/architecture/app-plan.md) against a running build, in light and
// dark, and prints a JSON report. A failed expectation is a failed check.
//   node journey-check.mjs --base http://localhost:4320/proof-of-delivery/react/ --out ../../validation/screenshots/prototype-journey
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const { PdfDocument } = require('@syncfusion/ej2-pdf');
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const base = arg('base', 'http://localhost:4320/proof-of-delivery/react/');
const out = arg('out', '../../validation/screenshots/prototype-journey');
mkdirSync(out, { recursive: true });

const FIRST = 'express-parcel-4471';
// Text drawn into a PDF sits in its (usually deflated) content streams; returns every literal string found there.
function pdfStrings(bytes) {
  const s = bytes.toString('latin1');
  const found = [];
  let i = 0;
  while ((i = s.indexOf('stream', i)) >= 0) {
    if (s.startsWith('endstream', i - 3)) { i += 6; continue; }
    let start = i + 6;
    if (s[start] === '\r') start++;
    if (s[start] === '\n') start++;
    const end = s.indexOf('endstream', start);
    if (end < 0) break;
    const chunk = bytes.subarray(start, end);
    let text;
    try { text = inflateSync(chunk).toString('latin1'); } catch { text = chunk.toString('latin1'); }
    found.push(...(text.match(/\(([^)]*)\)/g) ?? []));
    i = end + 9;
  }
  return found;
}
const THEME_KEY = 'proof-of-delivery-theme';
const report = { base, startedAt: new Date().toISOString(), runs: [] };
const browser = await chromium.launch();

for (const theme of ['light', 'dark']) {
  const steps = [];
  const consoleErrors = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme, acceptDownloads: true });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  const shot = async (name) => { const file = join(out, `${theme}-${name}.png`); await page.screenshot({ path: file }); return file.replace(/\\/g, '/'); };
  const step = (name, expected, observed, pass, extra = {}) => steps.push({ step: name, expected, observed, result: pass ? 'passed' : 'failed', ...extra });
  const viewer = (fn, ...args) => page.evaluate(({ fn, args }) => {
    const v = document.getElementById('receipt-viewer')?.ej2_instances?.[0];
    return v ? new Function('v', 'args', `return (${fn})(v, ...args)`)(v, args) : null;
  }, { fn: fn.toString(), args });
  const waitViewer = () => page.waitForSelector('.viewer-area[data-viewer-state="ready"]', { timeout: 60000 });
  const statusText = async () => (await page.locator('[data-testid="sign-status"]').innerText()).replace(/\s+/g, ' ').trim();
  // The carrier look (openspec/changes/carrier-look): route strip, brand colour, stop numbers.
  const INK = 'rgb(20, 108, 132)';
  const INK_DARK = 'rgb(15, 86, 105)';
  const LIME = 'rgb(195, 214, 56)';
  const AMBER = 'rgb(243, 179, 79)';
  const route = () => page.evaluate(() => ({
    summary: document.querySelector('[data-testid="route-summary"]').innerText.replace(/\s+/g, ' ').trim(),
    steps: [...document.querySelectorAll('.route-stepper .e-step-container')].map((s) => s.classList.contains('route-step-delivered')),
    icons: [...document.querySelectorAll('.route-stepper .e-step-container .e-indicator')].map((i) => (i.classList.contains('e-check') ? 'check' : i.classList.contains('e-location') ? 'pin' : 'other')),
  }));
  const names = (section) => page.locator(`[data-testid="${section}"] article .e-card-header-title`).allInnerTexts();
  const fieldBox = async () => {
    const id = await viewer((v) => v.retrieveFormFields()[0].id);
    await page.locator(`#${id}`).scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    return page.locator(`#${id}`).boundingBox();
  };
  const openDialog = async () => {
    const box = await fieldBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const dialog = page.locator('.e-pv-signature-window.e-popup-open');
    await dialog.waitFor({ timeout: 10000 });
    await page.waitForTimeout(800);
    return dialog;
  };
  const draw = async (dialog, pts) => {
    const canvas = await dialog.locator('canvas').first().boundingBox();
    await page.mouse.move(canvas.x + canvas.width * pts[0][0], canvas.y + canvas.height * pts[0][1]);
    await page.mouse.down();
    for (const [px, py] of pts.slice(1)) await page.mouse.move(canvas.x + canvas.width * px, canvas.y + canvas.height * py, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);
  };
  const waitStatus = (text) => page.waitForFunction((t) => document.querySelector('[data-testid="sign-status"]')?.textContent?.includes(t), text, { timeout: 10000 });

  try {
    // 1. Deliveries
    await page.goto(new URL('./deliveries', base).href, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="awaiting-section"] article');
    const awaiting1 = await names('awaiting-section');
    const delivered1 = await names('delivered-section');
    const topbar = (await page.locator('.app-topbar').innerText()).replace(/\s+/g, ' ');
    const signIn = await page.locator('.app-topbar').getByText(/sign in|log in|signed in/i).count();
    const appliedTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    step('1 Deliveries', '4 awaiting in stop order (Okafor, Reyes, Raman, Becker); 2 already delivered (Fitzgerald, then Marsh); no profile or sign-in control; theme follows the system setting',
      `awaiting [${awaiting1.join(', ')}]; delivered [${delivered1.join(', ')}]; top bar "${topbar}"; sign-in controls ${signIn}; theme ${appliedTheme}`,
      awaiting1.join() === 'Maya Okafor,Daniel Reyes,Priya Raman,Tom Becker' && delivered1.join() === 'Owen Fitzgerald,Elena Marsh' && signIn === 0 && appliedTheme === theme,
      { screenshot: await shot('01-deliveries') });

    const route1 = await route();
    const look1 = await page.evaluate(() => {
      const button = document.querySelector('.delivery-actions .e-btn.e-primary');
      const firstHeader = document.querySelector('.delivery-item .e-card-header');
      return {
        primary: getComputedStyle(button).backgroundColor, primaryText: getComputedStyle(button).color,
        band: getComputedStyle(document.querySelector('.app-topbar')).backgroundColor, bandText: getComputedStyle(document.querySelector('.app-brand')).color,
        firstInHeader: firstHeader.firstElementChild.className, stopNumbers: [...document.querySelectorAll('.delivery-item .delivery-stop')].map((s) => s.textContent.trim()),
        icon: document.querySelector('link[rel="icon"]').getAttribute('href'),
      };
    });
    const iconResponse = await fetch(new URL('./favicon.svg', base));
    step('1b Carrier look on Deliveries', 'Route strip "Route 12 2 of 6 delivered" with six Stepper steps, the first two ticked (check) and the rest pins; primary buttons Ink with white text; an Ink header band in light (Ink dark in dark) with white text; delivered marks lime; each card starts with its stop number (awaiting 3 to 6, then delivered 2 and 1); the tab icon is the app\'s own SVG',
      JSON.stringify({ route1, ...look1, iconStatus: iconResponse.status, iconType: iconResponse.headers.get('content-type') }),
      route1.summary === 'Route 12 2 of 6 delivered' && route1.steps.join() === 'true,true,false,false,false,false' && route1.icons.join() === 'check,check,pin,pin,pin,pin'
        && look1.primary === INK && look1.primaryText === 'rgb(255, 255, 255)' && look1.band === (theme === 'light' ? INK : INK_DARK) && look1.bandText === 'rgb(255, 255, 255)'
        && look1.firstInHeader === 'delivery-stop' && look1.stopNumbers.join() === '3,4,5,6,2,1' && look1.icon.endsWith('favicon.svg') && iconResponse.status === 200 && (iconResponse.headers.get('content-type') ?? '').includes('svg'));

    // 1c. A stop that is delivered in the baseline: its signed receipt opens read-only and downloads.
    const [baselineDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download receipt for Elena Marsh' }).click()]);
    const baselinePath = join(out, `${theme}-baseline-${baselineDownload.suggestedFilename()}`);
    await baselineDownload.saveAs(baselinePath);
    const baselineBytes = readFileSync(baselinePath);
    const baselinePdf = new PdfDocument(new Uint8Array(baselineBytes));
    const baselineInfo = { pages: baselinePdf.pageCount, formFields: baselinePdf.form ? baselinePdf.form.count : 0, header: baselineBytes.subarray(0, 5).toString('latin1'), images: (baselineBytes.toString('latin1').match(/\/Subtype\s*\/Image/g) ?? []).length };
    baselinePdf.destroy();
    await page.getByRole('link', { name: 'View receipt for Elena Marsh' }).click();
    await waitViewer();
    await page.waitForTimeout(2000);
    const baselineReview = await viewer((v) => ({ pages: v.pageCount, fields: v.retrieveFormFields().length }));
    const baselineStatus = await statusText();
    const baselineControls = await page.getByRole('button', { name: /Confirm delivery|Clear signature|^Next$|^Finish$/ }).count();
    await page.evaluate(() => { const c = document.getElementById('receipt-viewer_viewerContainer'); if (c) c.scrollTop = c.scrollHeight; });
    await page.waitForTimeout(1500);
    const baselineInk = await page.evaluate(({ b }) => {
      const el = document.querySelector('#receipt-viewer_pageDiv_0 canvas, #receipt-viewer_pageDiv_0 img');
      if (!el) return -1;
      let c = el;
      if (el.tagName === 'IMG') { c = document.createElement('canvas'); c.width = el.naturalWidth; c.height = el.naturalHeight; c.getContext('2d').drawImage(el, 0, 0); }
      const k = c.width / 612;
      const d = c.getContext('2d').getImageData(Math.round(b.X * k), Math.round(b.Y * k), Math.round(b.Width * k), Math.round(b.Height * k)).data;
      let dark = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && d[i] + d[i + 1] + d[i + 2] < 384) dark++;
      return dark;
    }, { b: { X: 72, Y: 560, Width: 260, Height: 72 } });
    step('1c A stop delivered before the app opened', 'Download from the card saves "Delivery receipt BCP-2210-4583-71 - signed.pdf": a PDF with 1 page, no form field and the watermark image. "View receipt" opens it read-only: no field, no signing control, a signature visible in the box (more than 50 dark pixels)',
      `file "${baselineDownload.suggestedFilename()}" ${JSON.stringify(baselineInfo)}; review ${JSON.stringify(baselineReview)}; status "${baselineStatus}"; signing controls ${baselineControls}; ${baselineInk} dark pixels in the box`,
      baselineDownload.suggestedFilename() === 'Delivery receipt BCP-2210-4583-71 - signed.pdf' && baselineInfo.header === '%PDF-' && baselineInfo.pages === 1 && baselineInfo.formFields === 0 && baselineInfo.images >= 1
        && baselineReview.pages === 1 && baselineReview.fields === 0 && baselineStatus.includes('read-only') && baselineControls === 0 && baselineInk > 50,
      { screenshot: await shot('01c-baseline-signed-receipt') });
    await page.getByRole('link', { name: 'Back to deliveries' }).click();
    await page.waitForSelector('[data-testid="awaiting-section"] article');

    // 2. Open the first delivery
    // 1d. The whole card opens its delivery: click on the recipient's name, not on the button. The click is made at
    // the name's position with the mouse, as a person would; the element under it is the card's stretched link.
    const clickOn = async (selector) => { await page.locator(selector).scrollIntoViewIfNeeded(); await page.waitForTimeout(300); const box = await page.locator(selector).boundingBox(); await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); };
    const cardLinks = await page.evaluate(() => [...document.querySelectorAll('.delivery-item')].map((c) => c.querySelectorAll('a').length + ':' + c.querySelectorAll('a a, a button, button a, button button').length).join());
    const cardCursor = await page.evaluate(() => getComputedStyle(document.querySelector('.delivery-item .e-card-header-title')).cursor);
    await clickOn('.delivery-item[data-delivery="standard-parcel-2210"] .e-card-header-title');
    await page.waitForURL('**/sign/standard-parcel-2210', { timeout: 10000 });
    const openedDelivered = new URL(page.url()).pathname;
    await page.goBack();
    await page.waitForSelector('[data-testid="awaiting-section"] article');
    // Download on a delivered card is its own action: it downloads and does not navigate.
    const [ownDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download receipt for Owen Fitzgerald' }).click()]);
    const stayed = new URL(page.url()).pathname.endsWith('/deliveries');
    await clickOn(`.delivery-item[data-delivery="${FIRST}"] .e-card-header-title`);
    await page.waitForURL(`**/sign/${FIRST}`, { timeout: 10000 });
    step('1d The whole card opens its delivery', 'Each card has exactly one link and nothing interactive nested; the pointer shows over the card; clicking a delivered card\'s name opens its receipt; Download downloads without leaving the list; clicking Maya Okafor\'s name opens her signing page',
      `links:nested per card [${cardLinks}]; cursor over the title "${cardCursor}"; delivered card opened ${openedDelivered}; Download saved "${ownDownload.suggestedFilename()}" and stayed on the list: ${stayed}; awaiting card opened ${new URL(page.url()).pathname}`,
      cardLinks === '1:0,1:0,1:0,1:0,1:0,1:0' && cardCursor === 'pointer' && openedDelivered.endsWith('/sign/standard-parcel-2210') && ownDownload.suggestedFilename() === 'Delivery receipt BCP-3047-9126-40 - signed.pdf' && stayed);
    await waitViewer();
    await page.waitForTimeout(1500);
    const info = await viewer((v) => ({ pages: v.pageCount, fields: v.retrieveFormFields().map((f) => ({ name: f.name, type: f.type, page: f.pageNumber, required: f.isRequired, filled: !!f.value })) }));
    const title2 = (await page.locator('.sign-titleblock h1').innerText()).replace(/\s+/g, ' ');
    const s2 = await statusText();
    step('2 Open the receipt', 'One page; "BCP 4471 2086 19 · Maya Okafor"; "Signature required"; one required signature field',
      `${info.pages} page(s); "${title2}"; "${s2}"; ${JSON.stringify(info.fields)}`,
      info.pages === 1 && title2.includes('BCP 4471 2086 19') && title2.includes('Maya Okafor') && s2 === 'Signature required'
        && info.fields.length === 1 && info.fields[0].name === 'recipient_signature' && info.fields[0].type === 'SignatureField' && info.fields[0].required && !info.fields[0].filled,
      { screenshot: await shot('02-sign-loaded') });

    // The receipt itself carries the brand colour: the bar across the top of the page, read from the rendered page.
    const bar = await page.evaluate(() => {
      const el = document.querySelector('#receipt-viewer_pageDiv_0 canvas, #receipt-viewer_pageDiv_0 img');
      let c = el;
      if (el.tagName === 'IMG') { c = document.createElement('canvas'); c.width = el.naturalWidth; c.height = el.naturalHeight; c.getContext('2d').drawImage(el, 0, 0); }
      const k = c.width / 612;
      const d = c.getContext('2d').getImageData(Math.round(306 * k), Math.round(3 * k), 1, 1).data;
      return [d[0], d[1], d[2]];
    });
    const flagColour = await page.evaluate(() => getComputedStyle(document.querySelector('.next-flag')).backgroundColor);
    step('2a Receipt and Next button in the brand colour', 'The bar across the top of the receipt is Ink (20, 108, 132, within 6 per channel); the Next button is Ink',
      `bar pixel rgb(${bar.join(', ')}); Next button ${flagColour}`, Math.abs(bar[0] - 20) <= 6 && Math.abs(bar[1] - 108) <= 6 && Math.abs(bar[2] - 132) <= 6 && flagColour === INK);

    // 2b. Next beside the page: one press scrolls the signature box to the middle of the view.
    const flag = page.locator('[data-testid="next-flag"]');
    await page.waitForTimeout(600); // the button settles beside the page
    const flagBox = await flag.boundingBox();
    const pageBox = await page.locator('#receipt-viewer_pageDiv_0').boundingBox();
    const flagGap = Math.round(pageBox.x - (flagBox.x + flagBox.width));
    const flagText1 = (await flag.innerText()).trim();
    const offsetFromMiddle = () => page.evaluate(() => {
      const v = document.getElementById('receipt-viewer').ej2_instances[0];
      const el = document.getElementById(v.retrieveFormFields()[0].id);
      const area = document.querySelector('.viewer-area').getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const scroller = document.getElementById('receipt-viewer_viewerContainer');
      return {
        offset: Math.round(r.top + r.height / 2 - (area.top + area.height / 2)),
        visible: r.top >= area.top && r.bottom <= area.bottom,
        // The box is near the foot of a one-page receipt, so the view can run out of page before the box reaches the middle.
        atEnd: !!scroller && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2,
      };
    });
    const before2b = await offsetFromMiddle();
    await flag.click();
    await page.waitForTimeout(2500);
    const after2b = await offsetFromMiddle();
    step('2b Next beside the page', 'A "Next" button just outside the left edge of the PDF page (0 to 8px from it); one press brings the whole signature box into view, at the middle (within 80px) or as near it as the end of the page allows',
      `button "${flagText1}" ending ${flagGap}px before the page's left edge; signature box before: ${before2b.offset}px from the middle, fully visible ${before2b.visible}; after one press: ${after2b.offset}px, fully visible ${after2b.visible}, scrolled to the end of the page ${after2b.atEnd}`,
      flagText1 === 'Next' && flagGap >= 0 && flagGap <= 8 && after2b.visible && (Math.abs(after2b.offset) <= 80 || after2b.atEnd),
      { screenshot: await shot('02b-next-signature-box') });
    // Back to the top, so the next step shows the app itself bringing the field into view.
    await page.evaluate(() => { const c = document.getElementById('receipt-viewer_viewerContainer'); if (c) c.scrollTop = 0; });
    await page.waitForTimeout(500);

    // 3. Confirm without signing
    await page.getByRole('button', { name: 'Confirm delivery' }).click();
    await page.waitForSelector('.e-toast', { timeout: 5000 });
    await page.waitForTimeout(1500);
    const toast = (await page.locator('.e-toast').first().innerText()).replace(/\s+/g, ' ');
    const b3 = await fieldBox();
    const inView = b3 && b3.y >= 0 && b3.y + b3.height <= 900;
    step('3 Confirm delivery with no signature', 'Toast "A signature is required"; the field is in view; the route does not change',
      `toast "${toast}"; field in view: ${inView}; path ${new URL(page.url()).pathname}`,
      toast.includes('A signature is required') && inView && page.url().includes(`/sign/${FIRST}`),
      { screenshot: await shot('03-validation-toast') });

    // 4. The signature dialog offers drawing only
    let dialog = await openDialog();
    const tabs = (await dialog.locator('.e-tab-header .e-toolbar-item:not(.e-hidden) .e-tab-text').allInnerTexts()).map((t) => t.trim().toUpperCase());
    const saveBox = await dialog.locator('.e-checkbox-wrapper:visible').count();
    const fileInputs = await dialog.locator('input[type="file"]').count();
    const textInputs = await dialog.locator('input[type="text"]:visible').count();
    const buttons = (await dialog.locator('.e-footer-content button').allInnerTexts()).map((t) => t.trim());
    const createDisabledEmpty = await dialog.getByRole('button', { name: 'Create', exact: true }).isDisabled();
    const dialogBox = await dialog.boundingBox();
    const footerBox = await dialog.locator('.e-footer-content').boundingBox();
    const emptyBand = Math.round(dialogBox.y + dialogBox.height - (footerBox.y + footerBox.height));
    step('4 Signature dialog', 'A drawing pad only: the single tab is DRAW, no Type or Upload tab, no save-signature box, no text or file input; Clear, Cancel, Create; Create unavailable while nothing is drawn',
      `tabs [${tabs.join(', ')}]; save-signature boxes ${saveBox}; file inputs ${fileInputs}; text inputs ${textInputs}; buttons [${buttons.join(', ')}]; Create disabled when empty: ${createDisabledEmpty}; empty band under the buttons ${emptyBand}px`,
      tabs.join() === 'DRAW' && saveBox === 0 && fileInputs === 0 && textInputs === 0 && buttons.join() === 'Clear,Cancel,Create' && createDisabledEmpty === true && emptyBand <= 4,
      { screenshot: await shot('04-dialog-draw-only') });

    // 5. Draw any stroke and create
    await draw(dialog, [[0.2, 0.6], [0.3, 0.3], [0.4, 0.7], [0.5, 0.35], [0.6, 0.65], [0.75, 0.4]]);
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await waitStatus('Signed');
    const after5 = await viewer((v) => v.retrieveFormFields().map((f) => ({ name: f.name, filled: !!f.value, kind: f.signatureType || '' })));
    const clearShown = await page.getByRole('button', { name: 'Clear signature' }).count();
    step('5 Signature placed', 'The drawing is in the field; status "Signed"; "Clear signature" is available',
      `${JSON.stringify(after5)}; status "${await statusText()}"; Clear signature buttons ${clearShown}`,
      after5[0].filled && (await statusText()) === 'Signed' && clearShown === 1,
      { screenshot: await shot('05-signed') });
    const flagAfter = (await flag.innerText()).trim();
    step('5b Button beside the page after signing', 'Reads "Finish" once the receipt is signed', `"${flagAfter}"`, flagAfter === 'Finish');

    // 6. Clear, then draw a different signature: any drawing is accepted, nothing is compared
    await page.getByRole('button', { name: 'Clear signature' }).click();
    await waitStatus('Signature required');
    const cleared = await viewer((v) => !!v.retrieveFormFields()[0].value);
    dialog = await openDialog();
    await draw(dialog, [[0.15, 0.6], [0.85, 0.4]]); // one slanted line, nothing like the first drawing
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await waitStatus('Signed');
    const after6 = await viewer((v) => !!v.retrieveFormFields()[0].value);
    step('6 Clear and sign again', 'Clear empties the field; a different drawing (one slanted line) is accepted without any comparison',
      `filled after Clear: ${cleared}; filled after the second drawing: ${after6}; status "${await statusText()}"`,
      cleared === false && after6 === true, { screenshot: await shot('06-signed-again') });

    // 6b. A perfectly straight horizontal line would be missing from the saved PDF (viewer defect, finding F2):
    // the app removes it and asks the person to sign again, then accepts the next drawing.
    await page.getByRole('button', { name: 'Clear signature' }).click();
    await waitStatus('Signature required');
    await page.locator('.e-toast .e-toast-close-icon').first().click().catch(() => {});
    dialog = await openDialog();
    await draw(dialog, [[0.15, 0.5], [0.85, 0.5]]);
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('.e-toast')].some((t) => t.textContent.includes('Please sign again')), null, { timeout: 8000 });
    await page.waitForTimeout(1200);
    const flatFilled = await viewer((v) => !!v.retrieveFormFields()[0].value);
    const flatStatus = await statusText();
    const flatShot = await shot('06b-straight-line-removed');
    dialog = await openDialog();
    await draw(dialog, [[0.2, 0.3], [0.5, 0.7], [0.8, 0.3]]);
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await waitStatus('Signed');
    step('6b A perfectly straight line', 'It is removed with "Please sign again" and the status stays "Signature required"; the next drawing is accepted',
      `filled after the straight line: ${flatFilled}; status "${flatStatus}"; after the next drawing "${await statusText()}"`,
      flatFilled === false && flatStatus === 'Signature required' && (await statusText()) === 'Signed', { screenshot: flatShot });

    // 7. Confirm delivery: from the header in light, from the Finish button beside the page in dark.
    if (theme === 'light') await page.getByRole('button', { name: 'Confirm delivery' }).click(); else await flag.click();
    const confirm = page.locator('.app-dialog.e-popup-open');
    await confirm.waitFor({ timeout: 5000 });
    const confirmText = (await confirm.innerText()).replace(/\s+/g, ' ');
    const confirmShot = await shot('07-confirm-dialog');
    await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();
    await page.waitForURL(`**/confirmed/${FIRST}`, { timeout: 30000 });
    const heading = await page.locator('#confirmed-title').innerText();
    const recipient = await page.locator('[data-testid="confirmed-recipient"]').innerText();
    const slip = await page.evaluate(() => {
      const f = document.querySelector('[data-testid="slip-signature"]');
      const strip = document.querySelector('.slip-strip');
      return {
        strip: strip.innerText.replace(/\s+/g, ' ').trim(), stripColour: getComputedStyle(strip).backgroundColor,
        points: f ? Number(f.dataset.points) : 0, moves: f ? (f.querySelector('path').getAttribute('d').match(/[ML]/g) ?? []).length : 0,
        name: f?.querySelector('svg').getAttribute('aria-label') ?? '', surface: f ? getComputedStyle(f.querySelector('svg')).backgroundColor : '', ink: f ? getComputedStyle(f.querySelector('path')).stroke : '',
      };
    });
    step('7b Delivery slip', 'An amber strip with the carrier and the tracking number; the signature the person drew, as a path with one command per recorded point, in dark ink on a white surface in both themes, named for screen readers',
      JSON.stringify(slip), /bluecrest parcel service/i.test(slip.strip) && slip.strip.includes('BCP 4471 2086 19') && slip.points >= 2 && slip.moves === slip.points
        && slip.name === 'Signature drawn by the recipient' && slip.surface === 'rgb(255, 255, 255)' && slip.ink === 'rgb(10, 58, 71)' && slip.stripColour === AMBER);
    step('7 Confirm delivery', `Confirmation dialog, then /confirmed/${FIRST} with "Delivered" and Maya Okafor`,
      `dialog "${confirmText}"; path ${new URL(page.url()).pathname}; heading "${heading}"; recipient "${recipient}"`,
      confirmText.includes('Confirm delivery?') && confirmText.includes('read-only') && heading === 'Delivered' && recipient === 'Maya Okafor',
      { screenshot: await shot('07b-confirmed'), confirmScreenshot: confirmShot });

    // 8. Download and review
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download receipt' }).click()]);
    const saved = join(out, `${theme}-${download.suggestedFilename()}`);
    await download.saveAs(saved);
    const savedBytes = readFileSync(saved);
    const pdf = new PdfDocument(new Uint8Array(savedBytes));
    const images = (buf) => (buf.toString('latin1').match(/\/Subtype\s*\/Image/g) ?? []).length;
    const pdfInfo = { pages: pdf.pageCount, formFields: pdf.form ? pdf.form.count : 0, bytes: savedBytes.length, header: savedBytes.subarray(0, 5).toString('latin1'), images: images(savedBytes) };
    pdf.destroy();
    // The unsigned receipt has no image at all: the watermark exists only in the signed copy.
    const sourceImages = images(Buffer.from(await (await fetch(new URL(`./receipts/${FIRST}.pdf`, base))).arrayBuffer()));
    await page.getByRole('button', { name: 'View signed receipt' }).click();
    await waitViewer();
    await page.waitForTimeout(2500);
    const review = await viewer((v) => ({ pages: v.pageCount, fields: v.retrieveFormFields().length }));
    const s8 = await statusText();
    const signingControls = await page.getByRole('button', { name: /Confirm delivery|Clear signature|^Next$|^Finish$/ }).count();
    // The signed-on line is page content in the signed copy: read it from the downloaded file.
    const signedOnText = pdfStrings(savedBytes).find((t) => t.includes('Signed on')) ?? '';
    const signedOnLine = /Signed on [A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2} [AP]M/.test(signedOnText);
    await page.evaluate(() => { const c = document.getElementById('receipt-viewer_viewerContainer'); if (c) c.scrollTop = c.scrollHeight; });
    await page.waitForTimeout(2000);
    // The signature itself must be on the page: count dark pixels inside the signature box of the rendered page.
    const ink = await page.evaluate(({ b }) => {
      const el = document.querySelector('#receipt-viewer_pageDiv_0 canvas, #receipt-viewer_pageDiv_0 img');
      if (!el) return -1;
      let c = el;
      if (el.tagName === 'IMG') { c = document.createElement('canvas'); c.width = el.naturalWidth; c.height = el.naturalHeight; c.getContext('2d').drawImage(el, 0, 0); }
      const k = c.width / 612; // the receipt is 612pt wide
      const d = c.getContext('2d').getImageData(Math.round(b.X * k), Math.round(b.Y * k), Math.round(b.Width * k), Math.round(b.Height * k)).data;
      let dark = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && d[i] + d[i + 1] + d[i + 2] < 384) dark++;
      return dark;
    }, { b: { X: 72, Y: 560, Width: 260, Height: 72 } });
    step('8b Signature in the signed receipt', 'The drawn signature is visible inside the signature box of the signed copy (more than 50 dark pixels there)', `${ink} dark pixels inside the box`, ink > 50);
    step('8 Download and review', 'Download named "Delivery receipt BCP-4471-2086-19 - signed.pdf": a PDF with 1 page, no form field and the watermark image; the unsigned receipt has no image; review is read-only with no field and no signing control, and shows "Signed on <date and time>"',
      `file "${download.suggestedFilename()}" ${JSON.stringify(pdfInfo)}; images in the unsigned receipt: ${sourceImages}; review ${JSON.stringify(review)}; status "${s8}"; signing controls ${signingControls}; signed-on line in the file: ${signedOnText || 'none'}`,
      download.suggestedFilename() === 'Delivery receipt BCP-4471-2086-19 - signed.pdf' && pdfInfo.header === '%PDF-' && pdfInfo.pages === 1 && pdfInfo.formFields === 0 && pdfInfo.images >= 1 && sourceImages === 0
        && review.pages === 1 && review.fields === 0 && s8.includes('read-only') && signingControls === 0 && signedOnLine,
      { screenshot: await shot('08-review-signed-watermark'), downloaded: saved.replace(/\\/g, '/') });

    // 9. Back to the list
    await page.getByRole('link', { name: 'Back to deliveries' }).click();
    await page.waitForSelector('[data-testid="awaiting-section"]');
    const awaiting9 = await names('awaiting-section');
    const delivered9 = await names('delivered-section');
    step('9 Back to deliveries', '3 awaiting (Reyes, Raman, Becker), 3 delivered (Okafor first, then Fitzgerald and Marsh)', `awaiting [${awaiting9.join(', ')}]; delivered [${delivered9.join(', ')}]`,
      awaiting9.join() === 'Daniel Reyes,Priya Raman,Tom Becker' && delivered9.join() === 'Maya Okafor,Owen Fitzgerald,Elena Marsh', { screenshot: await shot('09-deliveries-after') });

    const route9 = await route();
    const done9 = await page.evaluate(() => { const s = document.querySelector('.delivery-item[data-delivered="true"] .delivery-stop'); return { text: s.textContent.trim(), check: !!s.querySelector('svg'), colour: getComputedStyle(s).backgroundColor, awaitingColour: getComputedStyle(document.querySelector('.delivery-item[data-delivered="false"] .delivery-stop')).backgroundColor }; });
    step('9a Route after one delivery', '"Route 12 3 of 6 delivered"; stops 1, 2 and 3 ticked (check), the others pins; the delivered card\'s stop square shows a check with its number in lime, the awaiting ones stay Ink',
      JSON.stringify({ route9, done9 }), route9.summary === 'Route 12 3 of 6 delivered' && route9.steps.join() === 'true,true,true,false,false,false' && route9.icons.join() === 'check,check,check,pin,pin,pin'
        && done9.text === '3' && done9.check && done9.colour === LIME && done9.awaitingColour === INK);

    // 9b. A second tab starts from the baseline (session isolation).
    const second = await context.newPage();
    await second.goto(new URL('./deliveries', base).href, { waitUntil: 'networkidle' });
    await second.waitForSelector('[data-testid="awaiting-section"] article');
    const secondAwaiting = await second.locator('[data-testid="awaiting-section"] article').count();
    const secondDelivered = await second.locator('[data-testid="delivered-section"] article').count();
    await second.close();
    step('9b Second tab', 'A second tab shows the starting state: 4 awaiting and 2 delivered', `${secondAwaiting} awaiting, ${secondDelivered} delivered`, secondAwaiting === 4 && secondDelivered === 2);

    // 10. Reset demo
    await page.getByRole('button', { name: 'Reset demo' }).click();
    const resetDialog = page.locator('.app-dialog.e-popup-open');
    await resetDialog.waitFor({ timeout: 5000 });
    await resetDialog.getByRole('button', { name: 'Reset demo', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="awaiting-section"] article').length === 4, null, { timeout: 5000 });
    const delivered10 = (await names('delivered-section')).join();
    const route10 = await route();
    step('10 Reset demo', 'Back to the starting state: 4 awaiting, 2 delivered (Fitzgerald, Marsh); route "2 of 6 delivered" with only the first two stops ticked', `${(await names('awaiting-section')).length} awaiting; delivered [${delivered10}]; route ${JSON.stringify(route10)}`,
      delivered10 === 'Owen Fitzgerald,Elena Marsh' && route10.summary === 'Route 12 2 of 6 delivered' && route10.steps.join() === 'true,true,false,false,false,false');

    // Every other receipt opens, with one loading indicator while it loads.
    const opened = [];
    for (const id of ['certified-letter-5302', 'insured-parcel-6118', 'registered-document-7045']) {
      await page.goto(new URL(`./sign/${id}`, base).href, { waitUntil: 'commit' });
      const loading = await page.waitForFunction(() => {
        const area = document.querySelector('.viewer-area[data-viewer-state="loading"]');
        const own = area?.querySelector('.e-pdfviewer');
        if (!area || !own) return document.querySelector('.viewer-area[data-viewer-state="ready"]') ? 'missed' : false;
        return { appIndicator: !!area.querySelector('.app-loading'), viewerHidden: getComputedStyle(own).visibility === 'hidden' };
      }, null, { timeout: 30000, polling: 50 }).then((h) => h.jsonValue());
      await waitViewer();
      await page.waitForTimeout(800);
      const got = await viewer((v) => ({ pages: v.pageCount, fields: v.retrieveFormFields().length }));
      opened.push({ id, ...got, loading });
    }
    step('Every other receipt opens', 'Each of the other three receipts is 1 page with 1 field; while loading only the app indicator is visible', JSON.stringify(opened),
      opened.every((o) => o.pages === 1 && o.fields === 1 && (o.loading === 'missed' || (o.loading.appIndicator && o.loading.viewerHidden))) && opened.some((o) => o.loading !== 'missed'),
      { screenshot: await shot('11-registered-document') });

    // Theme: the choice made in this tab survives a refresh, and is the only thing the app stores.
    await page.goto(new URL('./deliveries', base).href, { waitUntil: 'networkidle' });
    const before = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.locator('.app-icon-button').click();
    const toggled = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.reload({ waitUntil: 'networkidle' });
    const afterReload = await page.evaluate(() => document.documentElement.dataset.theme);
    step('Theme after a refresh', 'Switching the theme and refreshing keeps the switched theme', `system ${before}, switched to ${toggled}, after refresh ${afterReload}`, before === theme && toggled !== before && afterReload === toggled);

    // Storage: the app writes nothing but the theme; Syncfusion's base library writes its own usage-telemetry ids.
    const storage = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage), cookies: document.cookie }));
    const appKeys = [...storage.local, ...storage.session.filter((k) => k !== THEME_KEY)].filter((k) => !k.startsWith('telemetry_'));
    step('Storage', 'The only key written by the app is the theme choice in sessionStorage; nothing in localStorage or cookies', JSON.stringify(storage),
      appKeys.length === 0 && storage.cookies === '' && storage.session.includes(THEME_KEY) && !storage.local.includes(THEME_KEY));

    const banner = await page.locator('.sf-license-validation-banner, [class*="license"]').count();
    step('Trial banner', 'No Syncfusion trial banner (a license key is registered)', `${banner} banner element(s)`, banner === 0);
    step('Console', 'No console error or uncaught exception during the journey', consoleErrors.length ? consoleErrors.join(' | ').slice(0, 600) : 'none', consoleErrors.length === 0);
  } catch (error) {
    step('Journey aborted', 'Every step runs', String(error?.message ?? error).split('\n')[0], false, { screenshot: await shot('error').catch(() => null), consoleErrors });
  }
  report.runs.push({ theme, viewport: '1440x900', steps, passed: steps.every((s) => s.result === 'passed') });
  await context.close();
}

await browser.close();
report.passed = report.runs.every((r) => r.passed);
report.finishedAt = new Date().toISOString();
console.log(JSON.stringify(report, null, 2));
process.exit(report.passed ? 0 : 1);
