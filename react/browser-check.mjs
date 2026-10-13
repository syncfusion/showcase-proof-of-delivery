#!/usr/bin/env node
// Behaviour checks for a running React showcase (factory/standards/app-source-baseline.md,
// "Browser evidence"). Proves what a DOM-presence check cannot: nothing failed to load, nothing
// overlaps the sidebar, no trial banner, controls re-measure after the sidebar docks, map markers
// survive a zoom, colours follow design-system.md "Colour semantics" (config colourRules), and, with
// config `loading`, nothing is blank while a page loads on a slow network (served build only).
//
// Usage (from frontend/react, with the dev or preview server running):
//   npx playwright install chromium        # once per machine
//   node browser-check.mjs --config browser-check.config.json > ../../validation/logs/browser-check.json
// Exit code 0 = every check passed. Screenshots land in the config's screenshotDir.
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyColour } from './colour-tones.mjs';

const args = process.argv.slice(2);
const configPath = args[args.indexOf('--config') + 1] ?? 'browser-check.config.json';
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const {
  baseUrl, routes, themes = { light: {}, dark: {} },
  viewports = [{ name: 'wide', width: 1440, height: 900 }, { name: 'docked-edge', width: 1024, height: 800 },
    { name: 'drawer-edge', width: 1023, height: 800 }, { name: 'phone', width: 390, height: 844 }],
  sidebar = '#app-shell-sidebar', menuButton = '#app-shell-menu-button',
  screenshotDir = '../../validation/screenshots/unnamed-phase', allowTrialBanner = false, ignoreRequests = ['favicon'],
  colourRules = [], loading = null
} = config;
const MEASURED = '.e-chart, .e-accumulationchart, .e-maps, .e-grid, .e-schedule, .e-kanban, .e-gantt, .e-dashboardlayout';
mkdirSync(screenshotDir, { recursive: true });

const results = [];
const browser = await chromium.launch();
try {
  for (const [themeName, theme] of Object.entries(themes)) {
    for (const viewport of viewports) {
      // App-specific addition to the factory template: this app keeps its theme in memory and follows the system setting,
      // so a theme is selected with themes.<name>.colorScheme instead of a localStorage entry.
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, ...(theme.colorScheme ? { colorScheme: theme.colorScheme } : {}) });
      if (theme.localStorage) await context.addInitScript(entries => {
        for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
      }, theme.localStorage);
      const page = await context.newPage();
      for (const route of routes) {
        const problems = [];
        const consoleErrors = [], failed = [];
        page.removeAllListeners('console'); page.removeAllListeners('pageerror');
        page.removeAllListeners('requestfailed'); page.removeAllListeners('response');
        page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
        page.on('pageerror', error => consoleErrors.push(error.message));
        page.on('requestfailed', request => failed.push(request.url() + ' ' + (request.failure()?.errorText ?? '')));
        page.on('response', response => {
          if (response.status() >= 400) { failed.push(response.url() + ' ' + response.status()); return; }
          // A file URL answered with an HTML page is a soft 404 (it returns 200), e.g. a sample PDF
          // that no longer exists: the PDF Viewer then reports "File Corrupted".
          const type = response.headers()['content-type'] ?? '';
          if (/\.(pdf|png|jpe?g|gif|svg|webp|js|mjs|css|json|woff2?|ttf|docx?|xlsx?|pptx?)(\?|$)/i.test(new URL(response.url()).pathname) && type.startsWith('text/html'))
            failed.push(response.url() + ' served text/html instead of the file');
        });

        const url = new URL(route.path, baseUrl);
        for (const [key, value] of Object.entries(theme.query ?? {})) url.searchParams.set(key, value);
        await page.goto(url.href, { waitUntil: 'networkidle' });
        await page.waitForTimeout(route.settleMs ?? 800);
        // A view behind a button (a board behind "Workflow Board"): click each named button first.
        for (const name of route.click ?? []) {
          try { await page.getByRole('button', { name }).first().click({ timeout: 5000 }); await page.waitForTimeout(1000); }
          catch (error) { problems.push({ check: 'route click failed: ' + name, detail: error.message.split('\n')[0] }); }
        }

        const state = await page.evaluate(({ sidebar, measured }) => {
          const box = el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }; };
          const nav = document.querySelector(sidebar);
          const navBox = nav ? box(nav) : null;
          const navVisible = !!navBox && navBox.right > 1 && navBox.width > 1;
          const banner = /trial version of Syncfusion/i.test(document.body.innerText);
          // An open Syncfusion dialog nobody asked for (an error, a "File Corrupted" notice) blocks the page.
          const dialogs = [...document.querySelectorAll('.e-dialog')].filter(d => getComputedStyle(d).display !== 'none' && d.getBoundingClientRect().width > 0)
            .map(d => d.innerText.trim().replace(/\s+/g, ' ').slice(0, 120));
          // Only images with an address count: controls such as the PDF Viewer create empty <img> placeholders.
          const brokenImages = [...document.images].filter(img => (img.currentSrc || img.getAttribute('src')) && img.complete && img.naturalWidth === 0).map(img => img.currentSrc || img.src);
          const controls = [...document.querySelectorAll(measured)].filter(el => !el.parentElement?.closest(measured));
          // A control that starts left of the sidebar's right edge is drawn under or over it.
          const overlapping = navVisible ? controls.filter(el => box(el).left < navBox.right - 1 && box(el).width > 0).map(el => el.id || el.className.split(' ')[0]) : [];
          // A board squeezed into a narrow screen still "fits", so nothing overflows: catch the
          // cards themselves getting too narrow to read (text one letter per line).
          const squeezed = [...document.querySelectorAll('.e-kanban .e-card')].filter(card => { const w = card.getBoundingClientRect().width; return w > 0 && w < 120; }).length;
          // Kanban keys each card by cardSettings.headerField. A field that repeats (a property name)
          // gives two cards one id, and a drag moves the wrong card: real-estate-portfolio, 2026-10-07.
          const kanbanDuplicates = [...document.querySelectorAll('.e-kanban')].flatMap(board => {
            const ids = [...board.querySelectorAll('.e-card[data-id]')].map(card => card.getAttribute('data-id'));
            const repeated = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
            return repeated.length ? [`${board.id || 'kanban'}: ${ids.length} cards, ${new Set(ids).size} distinct ids (${repeated.slice(0, 3).join(', ')}…)`] : [];
          });
          // Cards (syncfusion-component-patterns.md, "Syncfusion first"): a card with no surface (transparent,
          // no border, no shadow) reads as flat page text; text clipped inside a card is cut off. From
          // real-estate-portfolio (2026-10-08): KPI cards lost their styles when their CSS class was removed,
          // and the theme's 20px line for <p> in card content cut "23 Pending".
          const cardLike = [...document.querySelectorAll('.e-card, [class*="card"]')].filter(el => !el.closest('.e-kanban')
            && ([...el.classList].some(c => c === 'e-card' || /(^|-)card$/.test(c))) && el.getBoundingClientRect().width > 0);
          const flatCards = cardLike.filter(el => { const cs = getComputedStyle(el);
            return cs.backgroundColor === 'rgba(0, 0, 0, 0)' && parseFloat(cs.borderTopWidth) === 0 && cs.boxShadow === 'none'; })
            .map(el => el.getAttribute('aria-label') || el.className.split(' ').find(c => /card/.test(c)));
          const clippedText = cardLike.flatMap(card => [...card.querySelectorAll('*')].filter(el => {
              if (!el.childNodes.length || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return false;
              const cs = getComputedStyle(el); return cs.overflow === 'hidden' && el.scrollHeight > el.clientHeight + 1 && el.clientHeight > 0;
            }).map(el => `"${el.textContent.trim().slice(0, 30)}" (${el.clientHeight}px box, ${el.scrollHeight}px text)`));
          return { navVisible, banner, dialogs, brokenImages, overlapping, squeezed, kanbanDuplicates, flatCards, clippedText, horizontalScroll: document.documentElement.scrollWidth > innerWidth + 1, controls: controls.length };
        }, { sidebar, measured: MEASURED });

        // Without a key the trial banner covers the header; when it is explicitly allowed, take it
        // out of the way so the remaining checks can still interact.
        if (state.banner && allowTrialBanner) await page.evaluate(() => document.querySelector('.sf-license-validation-banner')?.remove());

        const relevantFailures = failed.filter(entry => !ignoreRequests.some(skip => entry.includes(skip)));
        if (consoleErrors.length) problems.push({ check: 'console errors', detail: consoleErrors.slice(0, 5) });
        if (relevantFailures.length) problems.push({ check: 'failed requests', detail: relevantFailures.slice(0, 5) });
        if (state.brokenImages.length) problems.push({ check: 'broken images (map tiles?)', detail: state.brokenImages.slice(0, 5) });
        if (state.dialogs.length && !route.expectDialog) problems.push({ check: 'unexpected dialog open', detail: state.dialogs });
        if (state.banner && !allowTrialBanner) problems.push({ check: 'trial license banner', detail: 'register VITE_SYNCFUSION_LICENSE_KEY' });
        if (state.overlapping.length) problems.push({ check: 'overlaps the sidebar', detail: state.overlapping });
        if (state.flatCards.length) problems.push({ check: 'cards without a surface', detail: state.flatCards.slice(0, 4).join('; ') + ': transparent, no border, no shadow; use the Syncfusion Card (e-card), which the theme draws' });
        if (state.clippedText.length) problems.push({ check: 'text cut off in a card', detail: state.clippedText.slice(0, 4).join('; ') + '; give it a div (the theme sets card <p> to a 20px line with hidden overflow) or its own line height' });
        if (state.kanbanDuplicates.length) problems.push({ check: 'Kanban card ids not unique', detail: state.kanbanDuplicates.join('; ') + '; set cardSettings.headerField to the record id and draw the title with a card template' });
        if (state.squeezed) problems.push({ check: 'Kanban cards squeezed under 120px', detail: state.squeezed + ' card(s); give the board a min-width inside an overflow-x container' });
        if (state.horizontalScroll) problems.push({ check: 'horizontal scroll', detail: 'page wider than the viewport' });

        // Maps redraws its markers on every zoom and pan (a wheel or trackpad over the map). React
        // marker templates come back empty after that redraw: the wrappers stay, sized 0x0. Zoom in and
        // back out over each map with markers; every marker drawn before must still be drawn.
        if (route.zoomMaps !== false) {
          const drawnMarkers = id => page.evaluate(id => [...document.querySelectorAll('#' + CSS.escape(id) + ' [id*="_MarkerIndex_"][id*="_dataIndex_"]')]
            .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length, id);
          for (const id of await page.evaluate(() => [...document.querySelectorAll('.e-maps[id]')].map(map => map.id))) {
            const before = await drawnMarkers(id);
            if (!before) continue;
            const map = page.locator('#' + id);
            await map.scrollIntoViewIfNeeded();
            const box = await map.boundingBox();
            if (!box) continue;
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            for (const delta of [-200, 200]) { await page.mouse.wheel(0, delta); await page.waitForTimeout(800); }
            const after = await drawnMarkers(id);
            if (after < before) problems.push({ check: 'map markers vanish after zoom', detail: `${id}: ${before} drawn before, ${after} after zooming in and out; use native marker shapes (colorValuePath, width/heightValuePath, border), not a React template` });

            // Frame the data (syncfusion-component-patterns.md, "Maps: frame the data"). Reload so the map
            // is at its starting view, then: the markers fill a fair part of it; zooming out cannot reach
            // a view where they shrink to a corner (the world for one country's data); and zooming in on
            // any cluster or overlap separates every marker.
            await page.reload({ waitUntil: 'networkidle' });
            await page.waitForTimeout(route.settleMs ?? 800);
            await map.scrollIntoViewIfNeeded();
            const view = () => page.evaluate(id => {
              const m = document.getElementById(id), mr = m.getBoundingClientRect();
              const shown = [...m.querySelectorAll('[id*="_MarkerIndex_"][id*="_dataIndex_"]')]
                .filter(el => !el.id.includes('_datalabel_') && getComputedStyle(el).visibility !== 'hidden')
                .map(el => ({ cluster: el.id.includes('_cluster_'), r: el.getBoundingClientRect() }))
                .filter(({ r }) => r.width > 0 && r.height > 0 && r.right > mr.left && r.left < mr.right && r.bottom > mr.top && r.top < mr.bottom);
              const overlap = shown.filter((a, i) => shown.some((b, j) => j !== i && a.r.left < b.r.right && b.r.left < a.r.right && a.r.top < b.r.bottom && b.r.top < a.r.bottom));
              const xs = shown.map(({ r }) => r.left + r.width / 2), ys = shown.map(({ r }) => r.top + r.height / 2);
              return { count: shown.length, clusters: shown.filter(s => s.cluster).length, overlapping: overlap.length,
                span: shown.length > 1 ? Math.max((Math.max(...xs) - Math.min(...xs)) / mr.width, (Math.max(...ys) - Math.min(...ys)) / mr.height) : 1 };
            }, id);
            const start = await view();
            const pct = v => Math.round(v * 100) + '%';
            if (start.count > 1 && start.span < 0.25)
              problems.push({ check: 'map does not frame its data', detail: `${id}: the markers span ${pct(start.span)} of the map at its starting view; open framed to the data (zoomSettings.shouldZoomInitially) or the region (a GeoJSON layer of just that region)` });
            if (start.count > 1) {
              const box2 = await map.boundingBox();
              await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
              for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 200); await page.waitForTimeout(250); }
              await page.waitForTimeout(600);
              const out = await view();
              if (out.span < 0.25)
                problems.push({ check: 'map zooms out past its data', detail: `${id}: zoomed out, the markers span ${pct(out.span)} of the map (${pct(start.span)} at the start); set minZoom to the starting zoom level` });
              await page.reload({ waitUntil: 'networkidle' });
              await page.waitForTimeout(route.settleMs ?? 800);
              await map.scrollIntoViewIfNeeded();
            }
            // Every cluster or overlap at the starting view must separate at full zoom. Zoom straight to the
            // map's maxZoom on that marker's own coordinates, read from its data (an element id names its
            // data index; a cluster's names its first member). Wheel steps drift off the map, and
            // pointToLatLong returns wrong coordinates on tile layers.
            const spots = await page.evaluate(id => {
              const m = document.getElementById(id), mr = m.getBoundingClientRect(), maps = m.ej2_instances?.[0];
              if (!maps) return [];
              const shown = [...m.querySelectorAll('[id*="_MarkerIndex_"][id*="_dataIndex_"]')]
                .filter(el => !el.id.includes('_datalabel_') && getComputedStyle(el).visibility !== 'hidden')
                .map(el => ({ id: el.id, cluster: el.id.includes('_cluster_'), r: el.getBoundingClientRect() }))
                .filter(({ r }) => r.width > 0 && r.right > mr.left && r.left < mr.right && r.bottom > mr.top && r.top < mr.bottom);
              const hit = (a, b) => a.r.left < b.r.right && b.r.left < a.r.right && a.r.top < b.r.bottom && b.r.top < a.r.bottom;
              return shown.filter((s, i) => s.cluster || shown.some((o, j) => j !== i && hit(s, o))).map(s => {
                const [, layer, marker, index] = s.id.match(/LayerIndex_(\d+)_MarkerIndex_(\d+)_dataIndex_(\d+)/).map(Number);
                const settings = maps.layers[layer].markerSettings[marker], row = settings.dataSource?.[index];
                const lat = row?.[settings.latitudeValuePath || 'latitude'], lon = row?.[settings.longitudeValuePath || 'longitude'];
                return Number.isFinite(lat) && Number.isFinite(lon) ? { latitude: lat, longitude: lon, element: id + '_LayerIndex_' + layer + '_MarkerIndex_' + marker + '_dataIndex_' + index } : null;
              }).filter(Boolean);
            }, id);
            const stacked = [];
            for (const spot of spots) {
              await page.evaluate(([id, spot]) => { const maps = document.getElementById(id).ej2_instances[0]; maps.zoomByPosition({ latitude: spot.latitude, longitude: spot.longitude }, maps.zoomSettings.maxZoom); }, [id, spot]);
              await page.waitForTimeout(1200);
              const onScreen = await page.evaluate(([id, element]) => { const m = document.getElementById(id).getBoundingClientRect(), el = document.getElementById(element); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.left < m.right && r.right > m.left && r.top < m.bottom && r.bottom > m.top; }, [id, spot.element]);
              const deep = await view();
              if (!onScreen) stacked.push(`could not zoom to the marker at ${spot.latitude.toFixed(3)}, ${spot.longitude.toFixed(3)}`);
              else if (deep.clusters || deep.overlapping) stacked.push(`${deep.clusters} cluster(s) and ${deep.overlapping} overlapping marker(s) near ${spot.latitude.toFixed(3)}, ${spot.longitude.toFixed(3)}`);
            }
            if (stacked.length)
              problems.push({ check: 'map markers stay stacked at full zoom', detail: `${id}: at maxZoom, ${stacked.slice(0, 3).join('; ')}; raise maxZoom until the closest markers separate (about 14 for points inside a city)` });
            await page.reload({ waitUntil: 'networkidle' });
            await page.waitForTimeout(route.settleMs ?? 800);
          }
        }

        // Chart tooltips read correctly (syncfusion-component-patterns.md, "Charts: tooltips"). Hover up to
        // six points of each chart and read its tooltip: a share over 100%, a raw number of seven or more
        // digits, or an unfilled template ("${", "undefined", "NaN") is wrong. From real-estate-portfolio,
        // whose donut tooltip printed the valuation with a % sign ("Office: 2295000000%").
        if (route.chartTooltips !== false) {
          for (const id of await page.evaluate(() => [...document.querySelectorAll('.e-chart[id], .e-accumulationchart[id]')].map(chart => chart.id))) {
            const points = await page.evaluate(id => [...document.querySelectorAll(`#${CSS.escape(id)} [id^="${id}_Series_"][id*="_Point_"]`)]
              .filter(el => /_Point_\d+$/.test(el.id)).slice(0, 6).map(el => el.id), id);
            const wrong = [];
            for (const pointId of points) {
              const spot = await page.evaluate(pointId => {
                const el = document.getElementById(pointId);
                el.scrollIntoView({ block: 'center' });
                // A slice's bounding-box centre can fall in the donut hole, and a point on its outline can miss
                // it: take an outline point and step 15% toward the centre of all the series' slices.
                if (el.getTotalLength && el.tagName.toLowerCase() === 'path' && el.getAttribute('d')?.includes('A')) {
                  const all = [...document.querySelectorAll(`[id^="${pointId.replace(/_Point_\d+$/, '_Point_')}"]`)].map(s => s.getBoundingClientRect());
                  const cx = (Math.min(...all.map(r => r.left)) + Math.max(...all.map(r => r.right))) / 2, cy = (Math.min(...all.map(r => r.top)) + Math.max(...all.map(r => r.bottom))) / 2;
                  const p = el.getPointAtLength(el.getTotalLength() * 0.25), m = el.getScreenCTM();
                  const x = p.x * m.a + m.e, y = p.y * m.d + m.f;
                  return { x: x + (cx - x) * 0.15, y: y + (cy - y) * 0.15 };
                }
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
              }, pointId);
              if (!spot) continue;
              await page.mouse.move(spot.x, spot.y);
              await page.waitForTimeout(700);
              const text = await page.evaluate(id => document.getElementById(id + '_tooltip')?.textContent?.trim() ?? '', id);
              if (!text) continue;
              const shares = [...text.matchAll(/(-?\d[\d,]*(?:\.\d+)?)\s*%/g)].map(m => parseFloat(m[1].replace(/,/g, '')));
              if (shares.some(v => v > 100) || /\d{7,}/.test(text) || /\$\{|undefined|NaN/.test(text)) wrong.push(text.slice(0, 80));
            }
            if (wrong.length) problems.push({ check: 'chart tooltip reads wrong', detail: `${id}: ${[...new Set(wrong)].slice(0, 3).join(' | ')}; show shares with point.percentage and money as formatted text (tooltipMappingName)` });
          }
          await page.mouse.move(0, 0);
        }

        // Pie and donut slices run largest first (syncfusion-component-patterns.md, "Charts"): read each
        // pie series' visible points in drawing order from the chart; a final "Other" slice may break the
        // order. From real-estate-portfolio, whose donut drew Retail (11.2%) before Multi-Family (17.1%).
        const pies = await page.evaluate(() => [...document.querySelectorAll('.e-accumulationchart[id]')].flatMap(chart => {
          const inst = chart.ej2_instances?.[0];
          return (inst?.visibleSeries ?? []).filter(s => s.type === 'Pie').map(s => ({ id: chart.id,
            labels: s.dataLabel?.visible === true || !!s.dataLabel?.template,
            points: s.points.filter(p => p.visible !== false).map(p => ({ x: String(p.x), y: Number(p.y) })) }));
        }));
        for (const pie of pies) {
          // Pie and donut charts show their values (syncfusion-component-patterns.md, "Charts"); the
          // legend names the categories, the labels give each slice's share or value.
          if (route.pieValues !== false && !pie.labels)
            problems.push({ check: 'pie values not shown', detail: `${pie.id}: no data labels; show each slice's share or value (dataLabel visible, inside the slice if outside labels do not fit)` });
          const points = pie.points.length > 1 && /^other\b/i.test(pie.points.at(-1).x) ? pie.points.slice(0, -1) : pie.points;
          if (points.some((p, i) => i > 0 && p.y > points[i - 1].y))
            problems.push({ check: 'pie slices not largest first', detail: `${pie.id}: ${pie.points.map(p => p.x).join(', ')}; sort the data by value, descending (an "Other" slice last)` });
        }

        // Chart data labels are whole: none cut with an ellipsis, none drawn past the chart's own edge, where
        // the SVG clips it. From real-estate-portfolio, whose donut's outside labels read "Multi..." and, at
        // 1024 px, "ulti-Family" and "ndustrial" (textContent was whole; the drawing was clipped).
        const clipped = await page.evaluate(() => [...document.querySelectorAll('.e-chart[id], .e-accumulationchart[id]')].flatMap(chart => {
          // The chart's own drawing surface (<id>_svg); a chart holds other small svgs (legend icons).
          const svg = document.getElementById(chart.id + '_svg') ?? chart.querySelector('svg'); if (!svg) return [];
          const box = svg.getBoundingClientRect();
          return [...chart.querySelectorAll('text[id*="_datalabel_"]')].filter(t => getComputedStyle(t).visibility !== 'hidden' && t.getBoundingClientRect().width > 0)
            .filter(t => { const r = t.getBoundingClientRect(); return /\.\.\.|…/.test(t.textContent) || r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1; })
            .map(t => `${chart.id}: "${t.textContent.trim()}"`);
        }));
        // A label drawn inside a slice reads on the slice: 4.5:1 against its fill. The chart's own ink choice
        // put white on #3b82f6 (3.7:1) in real-estate-portfolio's donut.
        const faint = await page.evaluate(() => {
          const rgb = c => { const m = c.match(/^#([0-9a-f]{6})$/i); if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
            const n = c.match(/[\d.]+/g); return n ? n.slice(0, 3).map(Number) : null; };
          const lum = c => { const v = rgb(c).map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
          return [...document.querySelectorAll('.e-accumulationchart[id]')].flatMap(chart => {
            const inst = chart.ej2_instances?.[0];
            return (inst?.visibleSeries ?? []).filter(s => s.dataLabel?.visible && s.dataLabel?.position === 'Inside').flatMap(s =>
              [...chart.querySelectorAll(`text[id^="${chart.id}_datalabel_Series_${s.index}_text_"]`)].filter(t => getComputedStyle(t).visibility !== 'hidden').map(t => {
                const slice = document.getElementById(`${chart.id}_Series_${s.index}_Point_${t.id.match(/(\d+)$/)[1]}`);
                const ink = t.getAttribute('fill') || getComputedStyle(t).fill, fill = slice?.getAttribute('fill');
                if (!fill || !rgb(ink) || !rgb(fill)) return null;
                const [a, b] = [lum(ink), lum(fill)].sort((x, y) => y - x), ratio = (a + 0.05) / (b + 0.05);
                return ratio < 4.5 ? `${chart.id}: "${t.textContent.trim()}" ${ink} on ${fill} ${ratio.toFixed(2)}:1` : null;
              }).filter(Boolean));
          });
        });
        if (faint.length) problems.push({ check: 'slice labels hard to read', detail: faint.slice(0, 4).join('; ') + '; set each label\'s ink in textRender to white or near-black, whichever reads better on the slice' });

        if (clipped.length) problems.push({ check: 'chart labels cut off', detail: clipped.slice(0, 4).join('; ') + '; give the chart room (radius, margin), wrap the label, or drop slice labels and let the legend name the categories' });

        // Colour semantics (design-system.md): config `colourRules` per route. "categorical" fails an
        // element drawn in a status tone: either theme's token, or any colour whose hue reads as one
        // (colour-tones.mjs: red, orange to yellow, lime to green). "banded" reads a number from each
        // element and fails one whose colour is not its band's tone. Tones come from the page's tokens for
        // the current theme, or from `tones` in the rule (for markers on light map tiles).
        for (const rule of colourRules.filter(r => r.route === route.name && (!r.viewports || r.viewports.includes(viewport.name)))) {
          const outcome = await page.evaluate(([rule, classifierSource]) => {
            const classify = new Function('return (' + classifierSource + ')')();
            const probe = document.createElement('span'); document.body.appendChild(probe);
            const rgb = value => { probe.style.color = ''; probe.style.color = value; return getComputedStyle(probe).color; };
            const tone = name => rule.tones?.[name] ? rgb(rule.tones[name]) : rgb(`var(--color-sf-fg-${name}-primary)`);
            const status = { success: tone('success'), warning: tone('warning'), danger: tone('danger') };
            // A category drawn in either theme's status tone is wrong (a hard-coded light green shows up
            // in dark mode too), so read the other theme's tones as well, then switch straight back.
            const root = document.documentElement, theme = root.getAttribute('data-theme'), dark = root.classList.contains('dark');
            root.setAttribute('data-theme', theme === 'dark' ? 'light' : 'dark'); root.classList.toggle('dark', !dark);
            const otherStatus = [tone('success'), tone('warning'), tone('danger')];
            if (theme === null) root.removeAttribute('data-theme'); else root.setAttribute('data-theme', theme);
            root.classList.toggle('dark', dark);
            const elements = [...document.querySelectorAll(rule.selector)];
            const property = rule.property ?? 'color';
            const colourOf = el => rgb(getComputedStyle(el)[property]);
            const wrong = [];
            for (const el of elements) {
              const colour = colourOf(el);
              if (rule.kind === 'categorical') {
                const hit = Object.entries(status).find(([, value]) => value === colour)?.[0]
                  ?? (otherStatus.includes(colour) ? 'the other theme\'s status tone' : null)
                  ?? (classify(colour) ? `a ${classify(colour)} hue (${colour})` : null);
                if (hit) wrong.push(`${(el.textContent || el.id).trim().slice(0, 30)} uses ${hit}`);
              } else {
                const source = rule.value?.startsWith('attribute:') ? el.getAttribute(rule.value.slice(10)) : el.textContent;
                const number = parseFloat(String(source ?? '').replace(/[^0-9.-]+/g, ' ').trim().split(' ')[0]);
                if (Number.isNaN(number)) { wrong.push('no number in "' + String(source).slice(0, 30) + '"'); continue; }
                const band = rule.bands.find(b => b.min === undefined || number >= b.min);
                if (colour !== tone(band.tone)) wrong.push(`${number} is not ${band.tone}`);
              }
            }
            probe.remove();
            return { count: elements.length, wrong };
          }, [rule, classifyColour.toString()]);
          if (!outcome.count) problems.push({ check: 'colour rule matched nothing: ' + rule.name, detail: rule.selector });
          else if (outcome.wrong.length) problems.push({ check: 'colour rule: ' + rule.name, detail: outcome.wrong.slice(0, 6) });
        }

        // Clickables (design-system.md, "Interaction states"): every button, link and role="button" the app
        // draws shows the pointer, and hovering it changes more than its opacity. Tailwind 4's preflight
        // sets buttons to cursor: default; real-estate-portfolio's "Sample AI Advisor" button showed the arrow
        // and only faded to 90% on hover (2026-10-08). Syncfusion data controls keep their own cursors.
        // Once per theme, at the first size.
        if (viewport === viewports[0] && route.clickables !== false) {
          const SYNCFUSION_OWNED = '.e-schedule, .e-kanban, .e-grid, .e-pdfviewer, .e-maps, .e-chart, .e-accumulationchart, .e-ddl, .e-popup, .e-toolbar, .e-aiassistview, .e-dialog';
          const clickables = await page.evaluate(owned => [...document.querySelectorAll('button, a[href], [role="button"]')]
            .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < innerHeight && !el.disabled && !el.closest(owned); })
            .map((el, i) => { el.setAttribute('data-bc-click', String(i)); return { i, name: (el.getAttribute('aria-label') || el.textContent.trim() || el.className).slice(0, 40), cursor: getComputedStyle(el).cursor,
              // The current page's link, the selected item (aria-current) or a pressed toggle is a state, not
              // an action: it need not change on hover.
              current: (el.getAttribute('aria-current') ?? 'false') !== 'false' || el.getAttribute('aria-pressed') === 'true' }; }), SYNCFUSION_OWNED);
          const arrow = clickables.filter(c => c.cursor !== 'pointer').map(c => c.name);
          if (arrow.length) problems.push({ check: 'clickable without a pointer', detail: arrow.slice(0, 5).join('; ') + '; add cursor: pointer for buttons in the base layer (Tailwind 4 sets cursor: default)' });
          const faint = [];
          for (const c of clickables.filter(c => !c.current).slice(0, 12)) {
            const target = page.locator(`[data-bc-click="${c.i}"]`);
            const look = () => target.evaluate(el => { const cs = getComputedStyle(el); return [cs.backgroundColor, cs.borderTopColor, cs.color, cs.boxShadow, cs.textDecorationLine, cs.outlineStyle].join('|'); });
            try {
              await page.mouse.move(0, 0); await page.waitForTimeout(150);
              const before = await look(); await target.hover({ timeout: 2000 }); await page.waitForTimeout(250);
              if (await look() === before) faint.push(c.name);
            } catch { /* covered or detached: not this rule's concern */ }
          }
          await page.mouse.move(0, 0);
          if (faint.length) problems.push({ check: 'no visible hover state', detail: faint.slice(0, 5).join('; ') + '; on hover change the background, border, colour or shadow (opacity alone is too faint)' });
        }

        // Wide screens: dock the sidebar, then every measured control must fit its new container.
        if (viewport.width >= 1024 && state.navVisible && route.toggleSidebar !== false && await page.locator(menuButton).count()) {
          for (const step of ['after collapse', 'after expand']) {
            try { await page.locator(menuButton).click({ timeout: 5000 }); }
            catch (error) { problems.push({ check: 'menu button not clickable ' + step, detail: error.message.split('\n')[0] }); break; }
            await page.waitForTimeout(1200);
            const sizes = await page.evaluate(measured => [...document.querySelectorAll(measured)]
              .filter(el => !el.parentElement?.closest(measured))
              .map(el => { // Charts and Maps draw into their own svg; every other control is measured by its box.
                const svg = el.matches('.e-chart, .e-accumulationchart, .e-maps') ? el.querySelector('svg') : null; const parent = el.parentElement.getBoundingClientRect();
                return { id: el.id || el.className.split(' ')[0], width: Math.round((svg ?? el).getBoundingClientRect().width), container: Math.round(parent.width) }; }), MEASURED);
            const stale = sizes.filter(size => size.width > size.container + 2 || size.width < size.container * 0.8);
            if (stale.length) problems.push({ check: 'control did not re-measure ' + step, detail: stale });
          }
        }

        const shot = join(screenshotDir, [route.name, themeName, viewport.name].join('-') + '.png');
        await page.screenshot({ path: shot, fullPage: true });
        results.push({ route: route.name, theme: themeName, viewport: viewport.name, controls: state.controls,
          trialBanner: state.banner, screenshot: shot, passed: problems.length === 0, problems });
      }
      await context.close();
    }
  }

  // Loading states (app-source-baseline.md, "Loading states"): run against the served production build
  // (server.mjs or vite preview), never the dev server. Each route loads on a throttled network with an
  // empty cache and is sampled every `sampleMs` from the first parsed body until it settles. Every sample must
  // show either a loading indicator (a visible role="status" / progressbar / aria-busy region, or a
  // Syncfusion spinner), a message (role="alert"), or the page: a visible <main> heading with every
  // stylesheet loaded; a visible PDF Viewer must have a page drawn or an indicator. Large same-origin
  // scripts, stylesheets and wasm must arrive compressed. From real-estate-portfolio on Azure (2026-10-07):
  // blank for 2.5 s, then an unstyled page until a 4.8 MB uncompressed theme bundle arrived.
  if (loading) {
    const NETWORKS = { fast3g: { latency: 563, downloadThroughput: 188743, uploadThroughput: 86400 },
      slow4g: { latency: 150, downloadThroughput: 1258291, uploadThroughput: 86400 } };
    const network = typeof loading.network === 'object' ? loading.network : NETWORKS[loading.network ?? 'fast3g'];
    const { sampleMs = 250, timeoutMs = 90000, minCompressKb = 100 } = loading;
    const viewport = loading.viewport ?? viewports[0];
    const origin = new URL(baseUrl).origin;
    for (const [themeName, theme] of Object.entries(themes)) {
      for (const route of routes) {
        if (route.loading === false) continue;
        const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
        if (theme.localStorage) await context.addInitScript(entries => {
          for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
        }, theme.localStorage);
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
        await cdp.send('Network.emulateNetworkConditions', { offline: false, ...network });
        const uncompressed = [];
        page.on('response', async response => {
          const url = new URL(response.url());
          if (url.origin !== origin || response.status() !== 200 || !/\.(m?js|css|wasm|json|svg|html?)$/i.test(url.pathname)) return;
          if (response.headers()['content-encoding']) return;
          try { const kb = Math.round((await response.body()).length / 1024); if (kb >= minCompressKb) uncompressed.push(`${url.pathname.split('/').pop()} ${kb} KB`); } catch { /* body gone after navigation */ }
        });
        const t0 = Date.now();
        const url = new URL(route.path, baseUrl);
        for (const [key, value] of Object.entries(theme.query ?? {})) url.searchParams.set(key, value);
        page.goto(url.href, { waitUntil: 'commit', timeout: timeoutMs }).catch(() => {});
        const samples = []; let settledSince = 0;
        while (Date.now() - t0 < timeoutMs) {
          await page.waitForTimeout(sampleMs);
          const s = await page.evaluate(() => {
            if (!document.body) return null;
            const shown = el => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
              return r.width >= 16 && r.height >= 16 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05 && r.bottom > 0 && r.top < innerHeight; };
            const indicator = [...document.querySelectorAll('[role="status"], [role="progressbar"], [aria-busy="true"], .e-spinner-pane.e-spin-show')].some(shown);
            const message = [...document.querySelectorAll('[role="alert"]')].some(el => shown(el) && el.innerText.trim());
            const heading = [...document.querySelectorAll('main h1, [role="main"] h1')].some(shown);
            const pendingSheets = [...document.querySelectorAll('link[rel="stylesheet"]')].filter(l => !l.sheet && !l.disabled).map(l => l.href.split('/').pop());
            const blankViewers = [...document.querySelectorAll('.e-pdfviewer')].filter(shown)
              .filter(v => !v.querySelector('.e-pv-page-div canvas, .e-pv-page-div img[src]')).length;
            return { indicator, message, heading, pendingSheets, blankViewers };
          }).catch(() => null);
          if (!s) continue;
          const at = Date.now() - t0;
          const state = s.indicator || s.message ? 'indicator'
            : !s.heading ? 'blank'
            : s.pendingSheets.length ? 'unstyled'
            : s.blankViewers ? 'document blank' : 'content';
          samples.push({ at, state, sheets: s.pendingSheets });
          settledSince = state === 'content' ? (settledSince || at) : 0;
          if (settledSince && at - settledSince >= 1500) break;
        }
        // Collapse the samples into runs, e.g. "blank 0-2250 ms".
        const runs = [];
        for (const sample of samples) {
          const last = runs.at(-1);
          if (last && last.state === sample.state) last.to = sample.at; else runs.push({ state: sample.state, from: sample.at, to: sample.at, sheets: sample.sheets });
        }
        const problems = [];
        const bad = runs.filter(r => r.state !== 'indicator' && r.state !== 'content');
        if (bad.length) problems.push({ check: 'page blank while loading', detail: bad.map(r => `${r.state} ${r.from}-${r.to} ms${r.state === 'unstyled' ? ' (' + r.sheets.join(', ') + ' still loading)' : ''}`).join('; ') + '; show a loading indicator (index.html, the route Suspense fallback, heavy controls) until the content and its stylesheets are ready' });
        if (!samples.some(sample => sample.state === 'content')) problems.push({ check: 'page never finished loading', detail: `no settled content within ${timeoutMs} ms` });
        if (uncompressed.length) problems.push({ check: 'assets not compressed', detail: uncompressed.slice(0, 6).join('; ') + '; serve Brotli or gzip (precompressed copies from the build, Content-Encoding by Accept-Encoding)' });
        const first = state => samples.find(sample => sample.state === state)?.at ?? null;
        results.push({ route: route.name, theme: themeName, viewport: 'loading-' + (loading.network ?? 'custom'),
          timings: { firstIndicatorMs: first('indicator'), contentMs: first('content') }, runs: runs.map(({ sheets, ...r }) => r),
          passed: problems.length === 0, problems });
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}
const failedCount = results.filter(result => !result.passed).length;
process.stdout.write(JSON.stringify({ checkedAt: new Date().toISOString(), baseUrl, passed: failedCount === 0, failed: failedCount, total: results.length, results }, null, 2) + '\n');
process.exitCode = failedCount ? 1 : 0;
