const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5174';

(async () => {
  const browser = await chromium.launch({ channel: process.env.UI_BROWSER || 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    let mode = 'healthy', posts = 0, held, saved = [], historyFails = false, savedAlerts = [];
    const errors = [];
    await context.addInitScript(() => {
      localStorage.setItem('cdrrmo_user', JSON.stringify({ id: 7, role: 'resident', barangay: 'Marinig', fullName: 'Test Resident' }));
      localStorage.setItem('cdrrmo_token', 'test-session');
    });
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === '/__workflow-test') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;</script></head><body><div id="workflow-root"></div><script type="module" src="/scripts/fixtures/WorkflowHarness.jsx"></script></body></html>` });
      if (url.hostname.endsWith('supabase.co')) {
        const table = url.pathname.split('/').pop();
        if (mode === 'outage') return route.fulfill({ status: 402, contentType: 'application/json', body: '{"message":"Service restricted"}' });
        if (request.method() === 'POST' && table === 'alerts') {
          if (mode === 'rejected') return route.fulfill({ status: 403, contentType: 'application/json', body: '{"message":"Alert rejected"}' });
          const row = { ...request.postDataJSON(), id: 201 };
          savedAlerts = [row];
          if (mode === 'delayed') { held = () => route.fulfill({ contentType: 'application/json', body: JSON.stringify(row) }); return; }
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify(row) });
        }
        if (request.method() === 'POST' && table === 'rescue_requests') {
          posts++;
          if (mode === 'rejected') return route.fulfill({ status: 403, contentType: 'application/json', body: '{"message":"Request rejected"}' });
          const row = { ...request.postDataJSON(), id: 101, verification_status: 'pending' };
          saved = [row];
          if (mode === 'delayed') {
            held = () => route.fulfill({ contentType: 'application/json', body: JSON.stringify(row) });
            return;
          }
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify(row) });
        }
        if (request.method() === 'POST' && table === 'rescue_request_updates' && historyFails) return route.fulfill({ status: 403, contentType: 'application/json', body: '{"message":"History unavailable"}' });
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(table === 'rescue_requests' ? saved : table === 'alerts' ? savedAlerts : []) });
      }
      if (url.origin === new URL(base).origin) return route.continue();
      return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.stack));
    await page.goto(`${base}/__workflow-test`);
    await page.waitForFunction(() => window.workflow && !window.workflow.data.isLoading);
    assert.equal(await page.locator('#workflow-status').innerText(), 'ready');

    mode = 'delayed';
    await page.evaluate(() => {
      const verdict = { verdict: 'no-safe-route', evidence: { roads: [], maxDepthM: 0.8 } };
      window.workflow.rescue.trigger(verdict, { origin: [14.27, 121.13] });
      window.workflow.rescue.trigger(verdict, { origin: [14.27, 121.13] });
    });
    await page.getByRole('heading', { name: 'Awaiting confirmation' }).waitFor();
    assert.equal(posts, 1, 'Double tapping must not submit twice');
    assert.equal(await page.getByRole('heading', { name: 'Request received by CDRRMO' }).count(), 0);
    await held();
    await page.getByRole('heading', { name: 'Request received by CDRRMO' }).waitFor();
    assert.equal(await page.evaluate(() => window.workflow.rescue.request.id), 101);

    saved[0].status = 'responding';
    await page.evaluate(() => window.workflow.data.refresh());
    await page.waitForFunction(() => window.workflow.rescue.request.status === 'responding');
    console.log('PASS: delayed acknowledgement, double-tap suppression, real ID and responder status');

    await page.evaluate(() => window.workflow.rescue.dismiss());
    saved = [];
    await page.evaluate(() => window.workflow.data.refresh());
    await page.waitForFunction(() => window.workflow.data.rescueRequests.length === 0);
    mode = 'rejected';
    await page.evaluate(() => window.workflow.rescue.trigger({ evidence: { roads: [], maxDepthM: 0 } }, { origin: [14.27, 121.13] }));
    await page.getByRole('heading', { name: 'Request not sent yet' }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Request received by CDRRMO' }).count(), 0);
    assert.match(await page.locator('.nsr-instruction').innerText(), /has not been confirmed/);
    mode = 'healthy'; historyFails = true;
    await page.getByRole('button', { name: 'Try sending again' }).click();
    await page.getByRole('heading', { name: 'Request received by CDRRMO' }).waitFor();
    assert.equal(posts, 3);
    console.log('PASS: rejected request remains failed; retry and secondary history failure preserve acknowledgement');

    await page.evaluate(() => window.workflow.rescue.dismiss());
    mode = 'delayed'; held = null;
    await page.evaluate(() => { window.alertResult = null; window.workflow.data.addAlert({ title: 'Test warning', message: 'Mock only', level: 'high', barangay: 'Marinig' }).then(row => { window.alertResult = row; }); });
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => window.workflow.data.alerts.length), 0, 'Pending alerts must not appear as issued');
    await held();
    await page.waitForFunction(() => window.alertResult?.id === 201);
    mode = 'rejected';
    await page.evaluate(async () => {
      try { await window.workflow.data.addAlert({ title: 'Rejected warning', level: 'high', barangay: 'Marinig' }); }
      catch (e) { window.alertFailure = e.message; }
    });
    assert.match(await page.evaluate(() => window.alertFailure), /rejected/);
    assert.equal(await page.evaluate(() => window.workflow.data.alerts.length), 1);
    console.log('PASS: alerts use acknowledged IDs; rejected writes cannot appear as issued');
    mode = 'outage';
    await page.evaluate(() => window.workflow.data.refresh());
    await page.getByText('Current safety data cannot be verified.', { exact: true }).waitFor();
    assert.equal(await page.locator('#workflow-status').innerText(), 'unavailable');
    const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert(size.scroll <= size.width, 'Outage message must fit small phones');
    console.log('PASS: backend restriction produces unavailable health rather than a healthy empty state');
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
