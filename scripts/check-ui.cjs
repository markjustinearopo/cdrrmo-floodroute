// Run against a local Vite server. PLAYWRIGHT_MODULE may point to a bundled runtime.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const baseUrl = process.env.UI_BASE_URL || 'http://127.0.0.1:5174';
const routes = {
  resident: ['dashboard', 'flood-map', 'road-status', 'evacuation-routing', 'alerts', 'evacuation', 'flood-reports'],
  barangay: ['dashboard', 'flood-map', 'hazard-layer', 'road-status', 'evacuation-routing', 'alerts', 'incidents', 'evacuation', 'operations'],
  admin: ['dashboard', 'flood-map', 'routing', 'road-status', 'alerts', 'incidents', 'evacuation', 'rescue', 'flood-reports', 'reports', 'settings', 'notifications'],
};
(async () => {
  const browser = await chromium.launch({ channel: process.env.UI_BROWSER || 'msedge', headless: true });
  fs.mkdirSync('tmp', { recursive: true });
  const results = [];
  for (const width of (process.env.AUDIT_WIDTHS || '390,1366').split(',').map(Number)) {
    for (const [role, paths] of Object.entries(routes)) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
      await context.addInitScript(role => {
        localStorage.setItem('cdrrmo_user', JSON.stringify({ id: 'ui-test', role, fullName: 'UI Test', barangay: 'Marinig', phoneVerified: true }));
      }, role);
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.hostname.endsWith('supabase.co')) {
          const table = url.pathname.split('/').pop();
          const rows = table === 'alerts' ? [{ id: 1, title: 'Flood warning for Marinig', message: 'Follow official evacuation instructions.', level: 'moderate', status: 'active', barangay: 'Marinig', issued_at: new Date().toISOString() }]
            : table === 'evacuation_centers' ? [{ id: 1, name: 'Marinig Evacuation Centre', barangay: 'Marinig', capacity: 500, occupancy: 120, status: 'open', lat: 14.276, lng: 121.14 }]
            : [];
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
        }
        // Public map tiles and fonts are read-only; no external mutations allowed.
        if (!['GET', 'HEAD'].includes(route.request().method())) return route.abort();
        return route.continue();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      let errors = [];
      page.on('pageerror', e => errors.push(e.stack));
      for (const path of paths) {
        if (process.env.AUDIT_ROUTE && !process.env.AUDIT_ROUTE.split(',').includes(`${role}/${path}`)) continue;
        if (process.env.AUDIT_ROUTE) console.log(`Checking ${role}/${path} at ${width}px`);
        errors = [];
        await page.goto(`${baseUrl}/${role}/${path}`);
        await page.locator('main').waitFor({ timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(900);
        const layout = await page.evaluate(() => ({
          width: innerWidth, scroll: document.documentElement.scrollWidth,
          overflow: [...document.querySelectorAll('main *')].filter(e => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && r.right > innerWidth + 2 && !e.closest('.leaflet-container, .mapboxgl-map, table, .mng-filters, .subtab-bar, .report-stage');
          }).slice(0, 8).map(e => `${e.tagName}.${e.className}`),
          mainHeight: document.querySelector('main')?.getBoundingClientRect().height,
        }));
        const entry = { role, path, width, ...layout, errors: [...errors] };
        results.push(entry);
        if (errors.length || layout.overflow.length || layout.scroll > width) console.log(JSON.stringify(entry));
        if (role === 'resident' && path === 'dashboard') {
          assert.match(await page.locator('.res-risk-level').innerText(), /MODERATE/);
          const summary = page.locator('.res-prep-card > summary');
          await summary.focus();
          await page.keyboard.press('Enter');
          assert.equal(await page.locator('.res-prep-card').getAttribute('open'), '');
        }
        if (role === 'resident' && path === 'flood-map') {
          const layers = page.locator('.resident-map-controls details').first();
          if (await layers.getAttribute('open') === null) {
            await page.getByRole('button', { name: 'Show Layers', exact: true }).click();
            await page.waitForTimeout(100);
          }
          assert.equal(await layers.getAttribute('open'), '');
          assert(await page.getByRole('slider', { name: 'Map layer intensity' }).isVisible());
          await page.getByRole('button', { name: 'Overview', exact: true }).focus();
          await page.keyboard.press('Enter');
          assert.equal(await page.getByRole('button', { name: 'Overview', exact: true }).getAttribute('aria-pressed'), 'true');
          await layers.locator('summary').click();
          await page.getByRole('button', { name: 'Report Flood Status', exact: true }).click();
          const dialog = page.getByRole('dialog').last();
          await dialog.waitFor();
          const box = await dialog.boundingBox();
          assert(box.x >= 0 && box.x + box.width <= width + 1, 'Report dialog must fit viewport');
          await page.keyboard.press('Escape');
        }
        if (role === 'admin' && path === 'flood-map') {
          if (width <= 760) await page.getByRole('button', { name: 'Menu', exact: true }).click();
          await page.getByRole('button', { name: 'Drill', exact: true }).click();
          const confirm = page.getByRole('alertdialog');
          await confirm.waitFor();
          await confirm.getByRole('button', { name: 'Cancel', exact: true }).last().focus();
          await page.keyboard.press('Enter');
          await confirm.waitFor({ state: 'hidden' });
          assert.equal(await page.locator('.drill-bar').count(), 0, 'Enter on Cancel must never start a drill');
          if (width <= 760) await page.keyboard.press('Escape');
          if (process.env.UI_TEST_3D && [320, 1366].includes(width)) {
            await page.getByRole('button', { name: '3D', exact: true }).click();
            const canvas = page.locator('.mapboxgl-canvas').first();
            await canvas.waitFor({ timeout: 30000 });
            await page.waitForTimeout(3000);
            const png = await canvas.screenshot();
            const colors = await page.evaluate(async data => {
              const img = new Image();
              img.src = `data:image/png;base64,${data}`;
              await img.decode();
              const c = document.createElement('canvas');
              c.width = 100; c.height = 100;
              const ctx = c.getContext('2d');
              ctx.drawImage(img, 0, 0, 100, 100);
              const pixels = ctx.getImageData(0, 0, 100, 100).data;
              const colors = new Set();
              for (let i = 0; i < pixels.length; i += 4) colors.add(`${pixels[i]},${pixels[i+1]},${pixels[i+2]}`);
              return colors.size;
            }, png.toString('base64'));
            assert(colors > 20, '3D canvas must render map detail');
            fs.writeFileSync(`tmp/ui-3d-${width}.png`, png);
            const box = await canvas.boundingBox();
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.down();
            await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 25, { steps: 5 });
            await page.mouse.up();
            await page.waitForTimeout(500);
            assert(!(await canvas.screenshot()).equals(png), '3D map must respond to dragging');
            await page.getByRole('button', { name: '2D', exact: true }).click();
          }
        }
        if (['dashboard', 'flood-map', 'routing'].includes(path)) await page.screenshot({ path: `tmp/ui-${role}-${path}-${width}.png`, fullPage: true });
        entry.errors = [...errors];
      }
      await context.close();
    }
  }
  fs.writeFileSync('tmp/usability-audit.json', JSON.stringify(results, null, 2));
  await browser.close();
  const failures = results.filter(r => r.errors.length || r.overflow.length || r.scroll > r.width);
  console.log(`${results.length} page/viewport checks; ${failures.length} failures. Results: tmp/usability-audit.json`);
  if (failures.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exit(1); });
