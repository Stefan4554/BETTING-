const { chromium } = require('playwright');
const EMAIL = process.env.E2E_EMAIL || 'e2e@example.com';
const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const assert = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE + '/login');
  await page.click('text=Create account');
  await page.fill('input[type=email]', EMAIL); await page.fill('input[type=password]', 'password123');
  await page.click('button[type=submit]'); await page.waitForTimeout(1500);
  if (page.url().includes('/login')) { await page.click('text=Have an account? Sign in').catch(()=>{}); await page.fill('input[type=email]', EMAIL); await page.fill('input[type=password]', 'password123'); await page.click('button[type=submit]'); }
  await page.waitForURL(u => !u.toString().includes('/login'), { timeout: 20000 });
  assert(await page.locator('text=No bets in this period').count() > 0, 'fresh live workspace is empty');

  // Deposit 1000
  await page.goto(BASE + '/bankroll', { waitUntil: 'networkidle' });
  await page.click('button:has-text("Deposit")');
  await page.locator('[role=dialog] input').first().fill('1000');
  await page.click('[role=dialog] button:has-text("Record")');
  await page.waitForTimeout(1500);
  assert(await page.locator('text=€1,000.00').count() > 0, 'deposit shows €1,000.00');

  // Fast entry bet with N
  await page.goto(BASE + '/bets', { waitUntil: 'networkidle' });
  await page.keyboard.press('n');
  const dlg = page.locator('[role=dialog]');
  await dlg.locator('label:has-text("Home") input').fill('Alpha FC');
  await dlg.locator('label:has-text("Away") input').fill('Beta United');
  await dlg.locator('label:has-text("Selection") input').fill('Alpha FC');
  await dlg.locator('label:has-text("Odds") input').fill('2.50');
  await dlg.locator('label:has-text("Stake") input').first().fill('100');
  await page.waitForTimeout(300);
  assert(await dlg.locator('text=€250.00').count() > 0, 'preview payout €250.00');
  await dlg.locator('button:has-text("Save bet")').click();
  await page.waitForTimeout(2500);
  assert(await page.locator('td:has-text("Alpha FC v Beta United")').count() === 1, 'bet listed once');

  // Settle it as won via row menu
  await page.locator('button[aria-label="Bet actions"]').first().click();
  await page.click('text=Settle / cash out');
  await page.locator('[role=dialog] button:has-text("Won")').first().click();
  await page.locator('[role=dialog] label:has-text("Closing odds") input').fill('2.30');
  assert(await page.locator('[role=dialog]').getByText('+€150.00').count() > 0, 'settle preview +€150.00');
  await page.click('[role=dialog] button:has-text("Confirm settlement")');
  await page.waitForTimeout(2500);
  assert(await page.locator('td >> text=+€150.00').count() > 0, 'row shows +€150.00 P/L');

  // Bankroll reflects ledger: 1000 − 100 + 250 = 1150
  await page.goto(BASE + '/bankroll', { waitUntil: 'networkidle' });
  assert(await page.locator('text=€1,150.00').count() > 0, 'bankroll €1,150.00 after win');
  await page.click('button:has-text("Verify ledger")');
  await page.waitForTimeout(1200);
  assert(await page.locator('text=Ledger verified').count() > 0, 'ledger verified');

  // Dashboard KPIs from DB
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const main = await page.locator('main').innerText();
  assert(main.includes('+150.00%'), 'ROI +150.00% (150 / 100)');
  assert(main.includes('+8.70%'), 'CLV +8.70% (2.50/2.30 − 1)');
  console.log('page errors:', errs.length ? errs : 'none');
  await browser.close();
})();
