// Build-phase checks (tasks B1 to B5 in tasks/todo.md) against the production build served by server.mjs:
// the host itself, the opening zoom, the other three receipts signed end to end, the keyboard path, the phone
// layout, the error states and the health page. Prints a JSON report; a failed expectation is a failed check.
//   PORT=4320 node server.mjs   (in another shell)
//   node build-journey.mjs --origin http://localhost:4320 --out ../../validation/screenshots/build-journey
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const origin = arg('origin', 'http://localhost:4320');
const mount = '/proof-of-delivery/react';
const base = `${origin}${mount}/`;
const out = arg('out', '../../validation/screenshots/build-journey');
mkdirSync(out, { recursive: true });

const steps = [];
const step = (name, expected, observed, pass, extra = {}) => steps.push({ step: name, expected, observed: typeof observed === 'string' ? observed : JSON.stringify(observed), result: pass ? 'passed' : 'failed', ...extra });
const guard = async (name, fn) => { try { await fn(); } catch (error) { step(`${name} (aborted)`, 'the step runs to its end', String(error?.message ?? error).split('\n')[0], false); } };

// ---------- Host (server.mjs) ----------
await guard('H Host', async () => {
  const health = await fetch(`${origin}/healthz`);
  const body = await health.json();
  step('H1 Host /healthz', '200 with status ok, service, version, uptimeSeconds, node, timestamp', { status: health.status, ...body },
    health.status === 200 && body.status === 'ok' && body.service === 'proof-of-delivery' && /^\d+\.\d+\.\d+$/.test(body.version) && typeof body.uptimeSeconds === 'number' && /^v\d+/.test(body.node) && !Number.isNaN(Date.parse(body.timestamp)));

  const html = await (await fetch(`${base}deliveries`)).text();
  const asset = html.match(/src="([^"]+\/assets\/index-[^"]+\.js)"/)?.[1];
  const js = await fetch(`${origin}${asset}`, { headers: { 'Accept-Encoding': 'br' } });
  const plain = await fetch(`${origin}${asset}`, { headers: { 'Accept-Encoding': 'identity' } });
  step('H2 Prefixed asset through the mount path', 'the entry script is served as JavaScript (not index.html), Brotli when accepted, uncompressed otherwise',
    { asset, type: js.headers.get('content-type'), encoding: js.headers.get('content-encoding'), vary: js.headers.get('vary'), brotliBytes: js.headers.get('content-length'), plainEncoding: plain.headers.get('content-encoding'), plainBytes: plain.headers.get('content-length') },
    !!asset && asset.startsWith(mount) && (js.headers.get('content-type') ?? '').startsWith('text/javascript') && js.headers.get('content-encoding') === 'br' && plain.headers.get('content-encoding') === null
      && Number(js.headers.get('content-length')) < Number(plain.headers.get('content-length')));

  const wasm = await fetch(`${base}ej2-pdfviewer-lib/pdfium.wasm`, { headers: { 'Accept-Encoding': 'br' } });
  const pdf = await fetch(`${base}receipts/express-parcel-4471.pdf`);
  const missing = await fetch(`${base}receipts/none.pdf`);
  const root = await fetch(`${origin}/`, { redirect: 'manual' });
  const deep = await fetch(`${base}sign/express-parcel-4471`);
  step('H3 Engine, receipt, missing file, root and deep link', 'pdfium.wasm as application/wasm (compressed); the receipt as a PDF; a missing file is 404, not a page; / redirects into the mount path; a deep link returns the app',
    { wasm: [wasm.status, wasm.headers.get('content-type'), wasm.headers.get('content-encoding')], pdf: [pdf.status, pdf.headers.get('content-type')], missing: missing.status, root: [root.status, root.headers.get('location')], deep: [deep.status, deep.headers.get('content-type')] },
    wasm.status === 200 && wasm.headers.get('content-type') === 'application/wasm' && wasm.headers.get('content-encoding') === 'br' && pdf.status === 200 && (pdf.headers.get('content-type') ?? '').includes('pdf') && missing.status === 404
      && root.status === 308 && root.headers.get('location') === `${mount}/` && deep.status === 200 && (deep.headers.get('content-type') ?? '').startsWith('text/html'));
});

// ---------- Browser ----------
const browser = await chromium.launch();
const consoleErrors = [];
const expectedErrors = [];
const newContext = async (options = {}) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', acceptDownloads: true, ...options });
  context.on('page', (p) => { p.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); }); p.on('pageerror', (e) => consoleErrors.push(e.message)); });
  return context;
};
const helpers = (page) => {
  const viewer = (fn, ...args) => page.evaluate(({ fn, args }) => {
    const v = document.getElementById('receipt-viewer')?.ej2_instances?.[0];
    return v ? new Function('v', 'args', `return (${fn})(v, ...args)`)(v, args) : null;
  }, { fn: fn.toString(), args });
  const shot = async (name) => { const file = join(out, `${name}.png`); await page.screenshot({ path: file }); return file.replace(/\\/g, '/'); };
  const waitReady = async () => { await page.waitForSelector('.viewer-area[data-viewer-state="ready"]', { timeout: 60000 }); await page.waitForTimeout(1500); };
  const open = async (id) => { await page.goto(`${base}sign/${id}`, { waitUntil: 'networkidle' }); await waitReady(); };
  const status = async () => (await page.locator('[data-testid="sign-status"]').innerText()).replace(/\s+/g, ' ').trim();
  const waitStatus = (text) => page.waitForFunction((t) => document.querySelector('[data-testid="sign-status"]')?.textContent?.includes(t), text, { timeout: 10000 });
  const dialog = page.locator('.e-pv-signature-window.e-popup-open');
  const flag = page.locator('[data-testid="next-flag"]');
  const fieldBox = async () => {
    const id = await viewer((v) => v.retrieveFormFields()[0].id);
    await page.locator(`#${id}`).scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    return page.locator(`#${id}`).boundingBox();
  };
  const draw = async (pts = [[0.2, 0.6], [0.3, 0.3], [0.4, 0.7], [0.5, 0.35], [0.6, 0.65], [0.75, 0.4]]) => {
    await dialog.waitFor({ timeout: 10000 });
    await page.waitForTimeout(700);
    const canvas = await dialog.locator('canvas').first().boundingBox();
    await page.mouse.move(canvas.x + canvas.width * pts[0][0], canvas.y + canvas.height * pts[0][1]);
    await page.mouse.down();
    for (const [px, py] of pts.slice(1)) await page.mouse.move(canvas.x + canvas.width * px, canvas.y + canvas.height * py, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);
  };
  /** Signs by pointer: select the box, draw, Create. */
  const sign = async (pts) => {
    const box = await fieldBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await draw(pts);
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await waitStatus('Signed');
  };
  const confirm = async () => {
    await page.getByRole('button', { name: 'Confirm delivery' }).click();
    const box = page.locator('.app-dialog.e-popup-open');
    await box.waitFor({ timeout: 5000 });
    await box.getByRole('button', { name: 'Confirm', exact: true }).click();
  };
  const toast = async (text) => {
    await page.waitForFunction((t) => [...document.querySelectorAll('.e-toast')].some((e) => e.textContent.includes(t)), text, { timeout: 15000 });
    return (await page.locator('.e-toast', { hasText: text }).first().innerText()).replace(/\s+/g, ' ');
  };
  const names = (section) => page.locator(`[data-testid="${section}"] article .e-card-header-title`).allInnerTexts();
  return { viewer, shot, open, waitReady, status, waitStatus, dialog, flag, fieldBox, draw, sign, confirm, toast, names };
};

// ---------- Z. Opening zoom (user request at prototype approval) ----------
await guard('Z Opening zoom', async () => {
  const context = await newContext();
  const page = await context.newPage();
  const h = helpers(page);
  await h.open('express-parcel-4471');
  const wide = await h.viewer((v) => ({ zoom: v.zoomPercentage, viewer: document.getElementById('receipt-viewer').clientWidth, page: Math.round(document.getElementById('receipt-viewer_pageDiv_0').getBoundingClientRect().width) }));
  const flagBox = await h.flag.boundingBox();
  const pageBox = await page.locator('#receipt-viewer_pageDiv_0').boundingBox();
  const field = await h.viewer((v) => { const f = v.retrieveFormFields()[0]; const el = document.getElementById(f.id); const p = document.getElementById('receipt-viewer_pageDiv_0').getBoundingClientRect(); const r = el.getBoundingClientRect(); return { left: Math.round(r.left - p.left), top: Math.round(r.top - p.top), width: Math.round(r.width), height: Math.round(r.height) }; });
  // The field must still sit inside the printed box at 125%: 72pt, 560pt, 260pt, 72pt scaled by 96/72 * 1.25.
  const k = (96 / 72) * 1.25;
  const fieldOk = Math.abs(field.left - 72 * k) <= 3 && Math.abs(field.top - 560 * k) <= 3 && Math.abs(field.width - 260 * k) <= 3 && Math.abs(field.height - 72 * k) <= 3;
  step('Z1 Opens at 125% on a wide screen', 'At 1440px the viewer reports 125%, the page is 1020px wide, the Next button still ends just before the page (0 to 8px) and the signature field still sits in the printed box',
    { ...wide, nextGap: Math.round(pageBox.x - (flagBox.x + flagBox.width)), field, expectedField: { left: Math.round(72 * k), top: Math.round(560 * k), width: Math.round(260 * k), height: Math.round(72 * k) } },
    wide.zoom === 125 && Math.abs(wide.page - 1020) <= 2 && pageBox.x - (flagBox.x + flagBox.width) >= 0 && pageBox.x - (flagBox.x + flagBox.width) <= 8 && fieldOk,
    { screenshot: await h.shot('z1-zoom-125') });
  await context.close();

  const medium = await newContext({ viewport: { width: 1024, height: 768 } });
  const mp = await medium.newPage();
  const mh = helpers(mp);
  await mh.open('express-parcel-4471');
  const mid = await mh.viewer((v) => ({ zoom: v.zoomPercentage, viewer: document.getElementById('receipt-viewer').clientWidth, page: Math.round(document.getElementById('receipt-viewer_pageDiv_0').getBoundingClientRect().width) }));
  const phone = await newContext({ viewport: { width: 390, height: 844 } });
  const pp = await phone.newPage();
  const ph = helpers(pp);
  await ph.open('express-parcel-4471');
  const small = await ph.viewer((v) => ({ zoom: v.zoomPercentage, viewer: document.getElementById('receipt-viewer').clientWidth, page: Math.round(document.getElementById('receipt-viewer_pageDiv_0').getBoundingClientRect().width) }));
  const pageScroll = await pp.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  step('Z2 Narrower screens keep the viewer\'s own fit', 'At 1024px and 390px the viewer is too narrow for the page at 125%, so the zoom is left to the viewer and the page is no wider than the viewer; no horizontal page scroll on the phone',
    { at1024: mid, at390: small, phonePageScroll: pageScroll }, mid.zoom !== 125 && mid.page <= mid.viewer && small.zoom !== 125 && small.page <= small.viewer && pageScroll === false,
    { screenshot: await mh.shot('z2-1024'), phoneScreenshot: await ph.shot('z2-phone') });
  await medium.close();
  await phone.close();
});

// ---------- B1. The other three receipts, end to end ----------
await guard('B1 Remaining receipts', async () => {
  const context = await newContext();
  const page = await context.newPage();
  const h = helpers(page);
  const expected = [
    ['certified-letter-5302', 'Daniel Reyes', 'Delivery receipt BCP-5302-7741-06 - signed.pdf'],
    ['insured-parcel-6118', 'Priya Raman', 'Delivery receipt BCP-6118-3390-52 - signed.pdf'],
    ['registered-document-7045', 'Tom Becker', 'Delivery receipt BCP-7045-1167-83 - signed.pdf'],
  ];
  const results = [];
  await page.goto(`${base}deliveries`, { waitUntil: 'networkidle' });
  for (const [id, recipient, fileName] of expected) {
    await page.getByRole('link', { name: `Sign for delivery to ${recipient}` }).click();
    await h.waitReady();
    const title = (await page.locator('.sign-titleblock h1').innerText()).replace(/\s+/g, ' ');
    await h.sign();
    await h.confirm();
    await page.waitForURL(`**/confirmed/${id}`, { timeout: 30000 });
    const shown = await page.locator('[data-testid="confirmed-recipient"]').innerText();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download receipt' }).click()]);
    if (id === 'certified-letter-5302') {
      // Stop 4 signed before stop 3: the route must tick exactly the stops that are delivered, in any order.
      await page.getByRole('button', { name: 'Back to deliveries' }).click();
      await page.waitForSelector('[data-testid="route-strip"]');
      const outOfOrder = await page.evaluate(() => ({ summary: document.querySelector('[data-testid="route-summary"]').innerText.replace(/\s+/g, ' ').trim(), steps: [...document.querySelectorAll('.route-stepper .e-step-container')].map((s) => s.classList.contains('route-step-delivered')) }));
      step('B1x Route with a stop signed out of order', 'After signing stop 4 before stop 3: "Route 12 3 of 6 delivered" with steps 1, 2 and 4 ticked and step 3 not', outOfOrder, outOfOrder.summary === 'Route 12 3 of 6 delivered' && outOfOrder.steps.join() === 'true,true,false,true,false,false', { screenshot: await h.shot('b1x-route-out-of-order') });
      await page.goBack();
      await page.waitForSelector('#confirmed-title');
    }
    results.push({ id, title, confirmedFor: shown, file: download.suggestedFilename(), ok: title.includes(recipient) && shown === recipient && download.suggestedFilename() === fileName });
    await page.getByRole('button', { name: 'Back to deliveries' }).click();
    await page.waitForSelector('[data-testid="awaiting-section"]');
  }
  step('B1a Three more receipts signed', 'Each opens with its own recipient, signs, confirms for that recipient and downloads under its own tracking number', results, results.every((r) => r.ok));
  const awaiting = await h.names('awaiting-section');
  const delivered = await h.names('delivered-section');
  step('B1b List after three deliveries', '1 awaiting (Maya Okafor); Delivered latest first: Tom Becker, Priya Raman, Daniel Reyes, then the two delivered before the app opened (Owen Fitzgerald, Elena Marsh)', { awaiting, delivered },
    awaiting.join() === 'Maya Okafor' && delivered.join() === 'Tom Becker,Priya Raman,Daniel Reyes,Owen Fitzgerald,Elena Marsh', { screenshot: await h.shot('b1b-list-after-three') });

  // The last one too: the Awaiting section shows its empty state.
  await page.getByRole('link', { name: 'Sign for delivery to Maya Okafor' }).click();
  await h.waitReady();
  await h.sign();
  await h.confirm();
  await page.waitForURL('**/confirmed/express-parcel-4471', { timeout: 30000 });
  await page.getByRole('button', { name: 'Back to deliveries' }).click();
  await page.waitForSelector('[data-testid="delivered-section"]');
  const empty = (await page.locator('[data-testid="awaiting-section"]').innerText()).replace(/\s+/g, ' ');
  const summary = await page.locator('[data-testid="deliveries-summary"]').innerText();
  step('B1c Everything signed', 'Awaiting shows "All deliveries are signed for."; the summary says every delivery has been signed for; 6 delivered', { awaiting: empty, summary, delivered: (await h.names('delivered-section')).length },
    empty.includes('All deliveries are signed for.') && summary.includes('Every delivery has been signed for') && (await h.names('delivered-section')).length === 6, { screenshot: await h.shot('b1c-all-delivered') });

  // A delivered receipt from the list: view read-only, and download.
  await page.getByRole('link', { name: 'View receipt for Priya Raman' }).click();
  await h.waitReady();
  const review = await h.viewer((v) => v.retrieveFormFields().length);
  const s = await h.status();
  await page.getByRole('link', { name: 'Back to deliveries' }).click();
  const [listDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download receipt for Priya Raman' }).click()]);
  step('B1d Delivered receipt from the list', 'View receipt opens it read-only with no field; Download from the card saves the signed PDF', { fields: review, status: s, file: listDownload.suggestedFilename() },
    review === 0 && s.includes('read-only') && listDownload.suggestedFilename() === 'Delivery receipt BCP-6118-3390-52 - signed.pdf');
  await context.close();
});

// ---------- B2. Keyboard and phone ----------
await guard('B2 Keyboard', async () => {
  const context = await newContext();
  const page = await context.newPage();
  const h = helpers(page);
  await h.open('certified-letter-5302');
  const active = () => page.evaluate(() => { const a = document.activeElement; return a ? `${a.tagName.toLowerCase()}${a.className ? '.' + String(a.className).split(' ')[0] : ''}:${(a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 40)}` : 'none'; });
  // Tab from the top of the page until the Next button has focus.
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  let tabsToNext = 0;
  for (; tabsToNext < 20; tabsToNext++) { await page.keyboard.press('Tab'); if ((await active()).includes('next-flag')) break; }
  const onNext = await active();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  const onField = await page.evaluate(() => { const a = document.activeElement; return !!a && document.getElementById('receipt-viewer').contains(a) && a.classList.contains('foreign-object'); });
  await page.keyboard.press('Enter');
  const opened = await h.dialog.waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(600);
  // Inside the dialog: Tab reaches its buttons; Cancel by keyboard closes it without a signature.
  let tabsToCancel = 0;
  let reached = '';
  for (; tabsToCancel < 12; tabsToCancel++) { await page.keyboard.press('Tab'); reached = await active(); if (/Cancel/.test(reached)) break; }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  const closed = (await h.dialog.count()) === 0;
  const stillEmpty = await h.viewer((v) => !v.retrieveFormFields()[0].value);
  step('B2a Keyboard to the signature dialog', 'Tab reaches the Next button; Enter moves focus to the signature field; Enter there opens the dialog; Tab reaches Cancel and Enter closes it with nothing signed',
    { tabsToNext: tabsToNext + 1, onNext, focusOnField: onField, dialogOpened: opened, tabsToCancel: tabsToCancel + 1, reached, dialogClosed: closed, fieldStillEmpty: stillEmpty },
    onNext.includes('next-flag') && onField && opened && /Cancel/.test(reached) && closed && stillEmpty);

  // The drawing itself needs a pointer (app-plan.md, approval item 5). Everything after it by keyboard.
  await h.sign();
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  let tabsToConfirm = 0;
  for (; tabsToConfirm < 20; tabsToConfirm++) { await page.keyboard.press('Tab'); if ((await active()).includes('Confirm delivery')) break; }
  await page.keyboard.press('Enter');
  const box = page.locator('.app-dialog.e-popup-open');
  await box.waitFor({ timeout: 5000 });
  await page.waitForTimeout(500);
  const focusInDialog = await page.evaluate(() => !!document.activeElement?.closest('.app-dialog'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  const escaped = (await box.count()) === 0 && page.url().includes('/sign/');
  await page.keyboard.press('Enter'); // focus returns to Confirm delivery; open it again
  await box.waitFor({ timeout: 5000 });
  await page.waitForTimeout(500);
  let tabsToPrimary = 0;
  for (; tabsToPrimary < 8; tabsToPrimary++) { const a = await active(); if (/:Confirm$/.test(a)) break; await page.keyboard.press('Tab'); }
  await page.keyboard.press('Enter');
  const done = await page.waitForURL('**/confirmed/certified-letter-5302', { timeout: 30000 }).then(() => true).catch(() => false);
  step('B2b Keyboard after the drawing', 'Tab reaches Confirm delivery; Enter opens the confirmation with focus inside it; Escape cancels and leaves the route; opening it again and pressing Enter on Confirm completes the delivery',
    { tabsToConfirm: tabsToConfirm + 1, focusInDialog, escapeCancelled: escaped, completed: done }, focusInDialog && escaped && done);
  await context.close();
});

await guard('B2 Phone and reduced motion', async () => {
  const context = await newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const h = helpers(page);
  await page.goto(`${base}deliveries`, { waitUntil: 'networkidle' });
  const list = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth > document.documentElement.clientWidth, columns: getComputedStyle(document.querySelector('.delivery-grid')).gridTemplateColumns.split(' ').length, resetText: getComputedStyle(document.querySelector('.app-reset .btn-text')).display, routeLabel: getComputedStyle(document.querySelector('.app-route-label')).display }));
  const ring = await page.evaluate(() => { const d = document.createElement('div'); d.className = 'app-loading__ring'; document.body.appendChild(d); const a = getComputedStyle(d).animationName; d.remove(); return a; });
  await page.getByRole('link', { name: 'Sign for delivery to Maya Okafor' }).tap();
  await h.waitReady();
  const layout = await page.evaluate(() => {
    const flag = document.querySelector('.next-flag');
    const confirm = [...document.querySelectorAll('.sign-actions .e-btn')].find((b) => b.textContent.includes('Confirm delivery')).getBoundingClientRect();
    return { scroll: document.documentElement.scrollWidth > document.documentElement.clientWidth, flagBeside: flag.dataset.beside, flagWidth: Math.round(flag.getBoundingClientRect().width), flagName: flag.textContent.trim(), confirmWidth: Math.round(confirm.width), confirmHeight: Math.round(confirm.height) };
  });
  await h.flag.tap();
  await page.waitForTimeout(1500);
  const box = await h.fieldBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await h.dialog.waitFor({ timeout: 10000 });
  await page.waitForTimeout(700);
  const dlg = await h.dialog.boundingBox();
  const dialogShot = await h.shot('b2-phone-dialog');
  await h.draw();
  await h.dialog.getByRole('button', { name: 'Create', exact: true }).tap();
  await h.waitStatus('Signed');
  const signedShot = await h.shot('b2-phone-signed');
  await page.getByRole('button', { name: 'Confirm delivery' }).tap();
  const confirmBox = page.locator('.app-dialog.e-popup-open');
  await confirmBox.waitFor({ timeout: 5000 });
  await confirmBox.getByRole('button', { name: 'Confirm', exact: true }).tap();
  const done = await page.waitForURL('**/confirmed/express-parcel-4471', { timeout: 30000 }).then(() => true).catch(() => false);
  step('B2c Phone (390px, touch) and reduced motion', 'One column of cards, Reset as an icon, no route label, no horizontal scroll; on the signing page the Next button is an arrow at the viewer\'s edge with its name kept, Confirm delivery is full width and at least 44px tall; the signature dialog fits the screen; a delivery completes by tapping (the stroke itself is drawn with the pointer API); the loading ring does not spin under reduced motion',
    { list, signing: layout, dialog: { left: Math.round(dlg.x), width: Math.round(dlg.width) }, completed: done, ringAnimationUnderReducedMotion: ring },
    !list.scroll && list.columns === 1 && list.resetText === 'none' && list.routeLabel === 'none' && !layout.scroll && layout.flagBeside === 'viewer' && layout.flagName === 'Next' && layout.confirmWidth >= 340 && layout.confirmHeight >= 44
      && dlg.x >= 0 && dlg.x + dlg.width <= 390 && done && ring === 'none',
    { screenshot: await h.shot('b2-phone-confirmed'), dialogScreenshot: dialogShot, signedScreenshot: signedShot });
  await context.close();
});

// ---------- B3. Error paths ----------
await guard('B3 Errors', async () => {
  const context = await newContext();
  const page = await context.newPage();
  const h = helpers(page);

  await page.goto(`${base}sign/no-such-delivery`, { waitUntil: 'networkidle' });
  const notFound = (await page.locator('.state.error').innerText()).replace(/\s+/g, ' ');
  step('B3a Unknown delivery', '"Delivery not found." with a link back to deliveries', notFound, notFound.includes('Delivery not found.') && (await page.getByRole('link', { name: 'Back to deliveries' }).count()) === 1);

  // A receipt that cannot be fetched: the viewer is taken down and the app's own message offers Try again.
  // The viewer also rejects with the response's status text ("Not Found") as an uncaught error.
  expectedErrors.push('404', 'Failed to load', 'Not Found');
  await page.route('**/receipts/insured-parcel-6118.pdf', (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' }));
  await page.goto(`${base}sign/insured-parcel-6118`, { waitUntil: 'commit' });
  const failed = await page.waitForSelector('.viewer-area .state.error', { timeout: 130000 }).then(() => true).catch(() => false);
  const message = failed ? (await page.locator('.viewer-area .state.error').innerText()).replace(/\s+/g, ' ') : '';
  const viewerGone = (await page.locator('#receipt-viewer').count()) === 0;
  const failShot = await h.shot('b3b-receipt-failed');
  await page.unroute('**/receipts/insured-parcel-6118.pdf');
  await page.getByRole('button', { name: 'Try again' }).click();
  const recovered = await page.waitForSelector('.viewer-area[data-viewer-state="ready"]', { timeout: 60000 }).then(() => true).catch(() => false);
  step('B3b Receipt cannot be loaded', 'role="alert" message "We couldn\'t open this receipt." with Try again; the viewer is taken down; Try again loads the receipt once it is available',
    { shown: failed, message, viewerRemoved: viewerGone, recovered }, failed && message.includes("We couldn't open this receipt.") && viewerGone && recovered, { screenshot: failShot });

  // Export failure: the delivery is not recorded, the signature stays, and a second attempt works.
  await page.waitForTimeout(1500);
  await h.sign();
  await h.viewer((v) => { v.__save = v.saveAsBlob; v.saveAsBlob = () => Promise.reject(new Error('forced export failure')); });
  expectedErrors.push('The delivery could not be confirmed');
  await h.confirm();
  const failToast = await h.toast("We couldn't confirm the delivery");
  const stillSigning = page.url().includes('/sign/insured-parcel-6118') && (await h.status()) === 'Signed';
  await h.viewer((v) => { v.saveAsBlob = v.__save; });
  await page.locator('.e-toast .e-toast-close-icon').first().click().catch(() => {});
  await h.confirm();
  const retried = await page.waitForURL('**/confirmed/insured-parcel-6118', { timeout: 30000 }).then(() => true).catch(() => false);
  step('B3c Export failure', 'Toast "We couldn\'t confirm the delivery"; the route and the signature are unchanged; trying again completes the delivery', { toast: failToast, stillOnSigningPageSigned: stillSigning, retried }, stillSigning && retried);

  // Missing watermark: the receipt is still completed, and the person is told.
  expectedErrors.push('Signed receipt produced without its watermark');
  const fresh = await newContext();
  const p2 = await fresh.newPage();
  const h2 = helpers(p2);
  await p2.route('**/branding/syncfusion-watermark.jpg', (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' }));
  await h2.open('registered-document-7045');
  await h2.sign();
  await h2.confirm();
  const completed = await p2.waitForURL('**/confirmed/registered-document-7045', { timeout: 30000 }).then(() => true).catch(() => false);
  const warn = await h2.toast('without a watermark');
  step('B3d Watermark image missing', 'The delivery is still confirmed, with a warning that the receipt was completed without a watermark', { completed, toast: warn }, completed && warn.includes('without a watermark'));
  await fresh.close();
  await context.close();
});

// ---------- B4. Health page ----------
await guard('B4 Health page', async () => {
  const context = await newContext();
  const page = await context.newPage();
  await page.goto(`${base}healthz`, { waitUntil: 'networkidle' });
  const facts = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.healthz dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent])));
  const shell = await page.locator('.app-topbar').count();
  step('B4 /healthz page', 'Outside the shell: status ok, app proof-of-delivery, a version, a build time, base path /proof-of-delivery/react, json source, fixture 2, 6 deliveries', { ...facts, shellElements: shell },
    facts.Status === 'ok' && facts.App === 'proof-of-delivery' && /^\d+\.\d+\.\d+$/.test(facts.Version) && !Number.isNaN(Date.parse(facts.Built)) && facts['Base path'] === mount && facts['Fixture version'] === '2' && facts.Deliveries === '6' && shell === 0);
  await context.close();
});

await browser.close();
const unexpected = consoleErrors.filter((e) => !expectedErrors.some((x) => e.includes(x)));
step('Console', 'No console error or uncaught exception other than the ones the error steps force', unexpected.length ? unexpected.join(' | ').slice(0, 800) : `none unexpected (${consoleErrors.length} forced)`, unexpected.length === 0);
const report = { origin, base, finishedAt: new Date().toISOString(), consoleErrors, steps, passed: steps.every((s) => s.result === 'passed') };
console.log(JSON.stringify(report, null, 2));
process.exit(report.passed ? 0 : 1);
