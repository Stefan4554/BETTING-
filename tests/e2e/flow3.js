// Review-fix flows: trade reservation, accumulator payout status, date basis, risk-adjusted
// metrics, notification settings + test email, odds connection test. Fresh user per run.
const { chromium } = require('playwright');
const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const EMAIL = (process.env.E2E_EMAIL || `e2e-${Date.now()}@example.com`).replace('@', '+fix@');
const assert = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const text = async (page, sel = 'main') => (await page.locator(sel).innerText()).replace(/\s+/g, ' ');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE + '/login');
  await page.click('text=Create account');
  await page.fill('input[type=email]', EMAIL); await page.fill('input[type=password]', 'password123');
  await page.click('button[type=submit]');
  await page.waitForTimeout(1500);
  if (page.url().includes('/login')) {
    await page.click('text=Have an account? Sign in').catch(() => {});
    await page.fill('input[type=email]', EMAIL); await page.fill('input[type=password]', 'password123');
    await page.click('button[type=submit]');
  }
  await page.waitForURL((u) => !u.toString().includes('/login'), { timeout: 30000 });

  // deposit
  await page.goto(BASE + '/bankroll', { waitUntil: 'networkidle' });
  await page.click('button:has-text("Deposit")');
  await page.locator('[role=dialog] input').first().fill('1000');
  await page.click('[role=dialog] button:has-text("Record")');
  await page.waitForTimeout(1500);

  // ── live trade: back 100 @ 3.0 reserves 100
  await page.goto(BASE + '/live', { waitUntil: 'networkidle' });
  await page.click('button:has-text("New trade")');
  const d = page.locator('[role=dialog]');
  await d.locator('label:has-text("Event") input').fill('Reserve FC v Ledger Utd');
  await d.locator('label:has-text("Selection") input').fill('Reserve FC');
  await d.locator('label:has-text("Commission") input').fill('0');
  await d.locator('label:has-text("Odds") input').fill('3');
  await d.locator('label:has-text("Stake") input').fill('100');
  await d.locator('button:has-text("Open trade")').click();
  await page.waitForTimeout(2000);
  await page.goto(BASE + '/bankroll', { waitUntil: 'networkidle' });
  let t = await text(page);
  assert(/Reserved: open trades €100\.00/.test(t), 'opening a trade reserves €100 in the ledger');
  assert(/Available bankroll \(ledger cash\) €900\.00/.test(t) && /Total bankroll \(available \+ reserved\) €1,000\.00/.test(t), 'available €900, total €1,000 (no expense recorded)');
  assert(/Trade reservation/.test(t), 'reservation visible in the transaction ledger');

  // partial close: cash out 40 stake for 70 → reserved 60, +30 realised
  await page.goto(BASE + '/live', { waitUntil: 'networkidle' });
  await page.click('button:has-text("Execute")');
  await d.locator('label:has-text("Side") select').selectOption('cashout');
  await d.locator('label:has-text("Amount received") input').fill('70');
  await d.locator('label:has-text("Back stake closed") input').fill('40');
  await d.locator('button:has-text("Record")').click();
  await page.waitForTimeout(2000);
  if (await d.count()) console.log('dialog still open; toasts:', await page.locator('[data-sonner-toast]').allInnerTexts(), (await d.innerText()).slice(0, 300));
  t = await text(page);
  assert(/€60\.00/.test(t) && /realised \+€30\.00/.test(t), 'partial close: €60 still reserved, +€30 realised');
  // final close: selection loses → total P/L −30
  await page.click('button:has-text("Settle")');
  await d.locator('button:has-text("Selection lost")').click();
  await page.waitForTimeout(2000);
  await page.goto(BASE + '/bankroll', { waitUntil: 'networkidle' });
  t = await text(page);
  assert(/Reserved: open trades €0\.00/.test(t) && /Available bankroll \(ledger cash\) €970\.00/.test(t), 'full close releases everything: available €970 (P/L −€30)');
  await page.click('button:has-text("Verify ledger")'); await page.waitForTimeout(1000);
  assert(await page.locator('text=Ledger verified').count() > 0, 'ledger consistent after open / partial / full close');

  // ── accumulator with a half-lost leg and payout below stake → Partial loss
  await page.goto(BASE + '/bets', { waitUntil: 'networkidle' });
  await page.keyboard.press('n');
  await d.locator('button[role=radio]:has-text("Accumulator")').click();
  const legs = d.locator('input[placeholder="Event"]');
  await legs.nth(0).fill('Leg A'); await d.locator('input[placeholder="Selection"]').nth(0).fill('A'); await d.locator('input[placeholder="Odds"]').nth(0).fill('1.5');
  await legs.nth(1).fill('Leg B'); await d.locator('input[placeholder="Selection"]').nth(1).fill('B -0.25'); await d.locator('input[placeholder="Odds"]').nth(1).fill('1.9');
  await d.locator('label:has-text("Description") input').fill('AH double');
  await d.locator('label:has-text("Stake") input').first().fill('10');
  await d.locator('button:has-text("Save bet")').click();
  await page.waitForTimeout(2000);
  await page.locator('button[aria-label="Bet actions"]').first().click();
  await page.click('text=Settle / cash out');
  const sel = d.locator('select');
  await sel.nth(0).selectOption('won');
  await d.locator('button:has-text("Save leg results")').click();   // partial settlement
  await page.waitForTimeout(1500);
  assert((await text(page)).includes('PENDING'), 'saving one leg keeps the accumulator open');
  await page.locator('button[aria-label="Bet actions"]').first().click();
  await page.click('text=Settle / cash out');
  await d.locator('select').nth(1).selectOption('half_lost');
  await page.waitForTimeout(300);
  const prev = await text(page, '[role=dialog]');
  assert(/Partial loss/i.test(prev) && /−€2\.50/.test(prev) && /Settlement components/i.test(prev), 'preview: Partial loss −€2.50 with split components');
  await d.locator('button:has-text("Confirm settlement")').click();
  await page.waitForTimeout(2000);
  t = await text(page);
  assert(/PARTIAL LOSS/.test(t) && /−€2\.50/.test(t), 'tracker shows PARTIAL LOSS −€2.50 (not "won")');

  // ── date basis switch
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.click('button[title="Global date filter"]');
  await page.click('button:has-text("Settlement")');
  await page.waitForTimeout(2000);
  assert((await page.locator('button[title="Global date filter"]').innerText()).includes('settled'), 'global date basis switched to settlement');
  if (!(await page.locator('button:has-text("This month")').count())) await page.click('button[title="Global date filter"]');
  await page.click('button:has-text("This month")');
  await page.waitForTimeout(2000);
  assert(/This month/.test(await page.locator('button[title="Global date filter"]').innerText()), '"This month" preset applied');

  // ── risk-adjusted metrics are withheld on small samples
  await page.goto(BASE + '/performance', { waitUntil: 'networkidle' });
  t = await text(page);
  assert(/Risk-adjusted returns/i.test(t) && /needs ≥/.test(t) && /Methodology/.test(t), 'risk-adjusted panel shows methodology and withholds insufficient samples');

  // ── notifications: preferences + real test email attempt
  await page.goto(BASE + '/settings?tab=notifications', { waitUntil: 'networkidle' });
  await page.locator('input[aria-label="Daily loss limit email"]').check();
  await page.click('button:has-text("Save preferences")');
  await page.waitForTimeout(1500);
  await page.reload({ waitUntil: 'networkidle' });
  assert(await page.locator('input[aria-label="Daily loss limit email"]').isChecked(), 'email preference persisted');
  await page.click('button:has-text("Send test email")');
  await page.waitForTimeout(3000);
  const toasts = (await page.locator('[data-sonner-toast]').allInnerTexts()).join(' ');
  t = await text(page);
  const configured = !/not configured/.test(t);
  assert(configured ? /accepted by the provider|failed/.test(toasts) : /failed/.test(toasts) && /RESEND_API_KEY/.test(toasts), configured ? 'test email sent through provider' : 'test email reported FAILED with the missing-config reason (not "delivered")');
  await page.reload({ waitUntil: 'networkidle' });
  assert(/test .* (failed|sent)/.test(await text(page)), 'test email appears in the delivery log with its real status');

  // ── odds provider connection test (real request from the server)
  await page.goto(BASE + '/settings?tab=data', { waitUntil: 'networkidle' });
  const card = page.locator('section', { hasText: 'Multi-sport bookmaker odds' }).first();
  await card.locator('input[type=password]').fill('probe-key-not-real-123');
  await card.locator('label:has-text("Sport keys") input').fill('soccer_epl');
  await card.locator('button:has-text("Connect")').click();
  await page.waitForTimeout(2000);
  await card.locator('button:has-text("Test connection")').click();
  await page.waitForTimeout(6000);
  await page.reload({ waitUntil: 'networkidle' });
  t = (await card.innerText()).replace(/\s+/g, ' ');
  assert(/unreachable|auth_error/.test(t) && !/\bVerified\b/.test(t.replace(/Not verified/g, '')), 'connection test stored a non-success status (unreachable / not verified)');
  assert(/Last test/.test(t) && /✗/.test(t), 'test result checks displayed');

  console.log('page errors:', errs.length ? errs : 'none');
  await browser.close();
})();
