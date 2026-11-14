// "Before" captures of the original mockup (reference/QUINTA-lot4) at 1440 and 390 px.
import { chromium } from '@playwright/test';
const base = process.env.MOCKUP ?? 'http://127.0.0.1:8001';
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [w, h, tag] of [[1440, 900, '1440'], [390, 844, '390']]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.goto(base + '/index.html');
  await page.waitForTimeout(1500);
  const views = [['accueil', 'bilan-j138'], ['checkin', 'checkin'], ['suivi', 'trends'], ['corps', 'body'], ['equipage', 'cmo-console']];
  for (const [id, name] of views) {
    await page.evaluate((v) => document.querySelector(`[data-go="${v}"]`)?.click(), id);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `docs/screenshots/before/${name}-${tag}.png`, fullPage: true, timeout: 90000, animations: 'disabled' });
  }
  await page.evaluate(() => document.querySelector('[data-scn="j142"]')?.click());
  await page.evaluate(() => document.querySelector('[data-go="accueil"]')?.click());
  await page.waitForTimeout(600);
  await page.screenshot({ path: `docs/screenshots/before/bilan-j142-${tag}.png`, fullPage: true, timeout: 90000, animations: 'disabled' });
  await ctx.close();
}
await browser.close();
