const { chromium } = require('playwright');
const EMAIL = process.env.E2E_EMAIL || 'e2e@example.com';
const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const assert = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE + '/login');
  await page.fill('input[type=email]', EMAIL); await page.fill('input[type=password]', 'password123'); await page.click('button[type=submit]');
  await page.waitForURL(u => !u.toString().includes('/login'), { timeout: 30000 });

  // Import CSV
  await page.goto(BASE + '/bets?import=1', { waitUntil: 'networkidle' });
  await page.setInputFiles('[role=dialog] input[type=file]', '' + require('path').join(__dirname, 'import.csv') + '');
  await page.waitForTimeout(800);
  const dlgText = await page.locator('[role=dialog]').innerText();
  assert(/5 rows · 4 valid · 1 with errors/.test(dlgText.replace(/\s+/g, ' ')), 'preview: 4 valid, 1 error');
  await page.click('[role=dialog] button:has-text("Import 4 bets")');
  await page.waitForSelector('[role=dialog] >> text=imported', { timeout: 30000 });
  const res = (await page.locator('[role=dialog]').innerText()).replace(/\s+/g, ' ');
  assert(/(3 imported · 1|0 imported · 4) duplicates skipped · 1 errors/.test(res), 'result: 3 imported, 1 duplicate, 1 error → ' + res.match(/\d+ imported[^R]*/)?.[0]);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800); await page.reload({ waitUntil: 'networkidle' }); assert(!page.url().includes('import=1'), 'import param cleared on close');
  assert(await page.locator('td:has-text("Gamma v Delta")').count() === 2, 'two Gamma v Delta bets (duplicate skipped)');

  // Export CSV
  await page.click('button:has-text("Export")');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'CSV' }).click()]);
  const p = await dl.path(); const csv = require('fs').readFileSync(p, 'utf8');
  assert(csv.split('\r\n').length === 5 || csv.split('\r\n').length === 8 && csv.startsWith('ref,placed_at'), 'CSV export has header + 4 bets');

  // Reports exports
  await page.goto(BASE + '/reports', { waitUntil: 'networkidle' });
  await page.waitForSelector('h2:text-is("Summary")', { timeout: 30000 });
  for (const [btn, ext] of [['PDF', '.pdf'], ['Excel', '.xlsx'], ['CSV', '.csv']]) {
    const [d] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click(`button:has-text("${btn}")`)]);
    const size = require('fs').statSync(await d.path()).size;
    assert(d.suggestedFilename().endsWith(ext) && size > 500, `report ${btn} download (${size} bytes)`);
  }
  // JSON backup
  const r = await page.request.get(BASE + '/api/export/backup');
  const j = await r.json();
  assert(j.format === 'betting-edge-pro-backup' && j.data.bets.length >= 4 && !JSON.stringify(j).includes('ciphertext'), 'JSON backup: 5 bets, no secrets');
  const anon = await (await browser.newContext()).request.get(BASE + '/api/export/backup', { maxRedirects: 0 });
  assert(anon.status() === 401, 'backup requires auth (' + anon.status() + ')');

  // Staking page + strategy creation
  await page.goto(BASE + '/staking', { waitUntil: 'networkidle' });
  assert(/recommended stake/i.test(await page.locator('main').innerText()), 'staking calculator renders');
  await page.goto(BASE + '/strategies', { waitUntil: 'networkidle' });
  await page.click('button:has-text("New strategy")');
  await page.locator('[role=dialog] label:has-text("Name") input').fill('Value v1');
  await page.click('[role=dialog] button:has-text("Save")');
  await page.waitForTimeout(1500);
  assert(await page.locator('td:has-text("Value v1")').count() === 1, 'strategy created');

  // Risk limit enforcement through UI
  await page.goto(BASE + '/risk', { waitUntil: 'networkidle' });
  await page.locator('label:has-text("Max stake per bet") input').fill('20');
  await page.locator('label:has-text("Enforce per-bet limits") input').check();
  await page.click('button:has-text("Save & evaluate")');
  await page.waitForTimeout(1500);
  await page.keyboard.press('n');
  const dlg = page.locator('[role=dialog]');
  await dlg.locator('label:has-text("Event") input').first().fill('Limit test');
  await dlg.locator('label:has-text("Selection") input').fill('X');
  await dlg.locator('label:has-text("Odds") input').fill('2');
  await dlg.locator('label:has-text("Stake") input').first().fill('50');
  await dlg.locator('button:has-text("Save bet")').click();
  await page.waitForTimeout(1500);
  assert(await page.getByText(/Risk limit: stake 50/).count() > 0, 'over-limit bet rejected with a clear message');
  console.log('page errors:', errs.length ? errs : 'none');
  await browser.close();
})();
