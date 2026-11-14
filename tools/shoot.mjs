// Quick screenshot helper: node tools/shoot.mjs <outdir> <width> <path...>
import { chromium } from '@playwright/test';
const [out, width, ...paths] = process.argv.slice(2);
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: Number(width), height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => { localStorage.setItem('quinta.guide.astronaut', 'done'); localStorage.setItem('quinta.guide.cmo', 'done'); });
const page = await ctx.newPage();
page.on('console', (m) => m.type() === 'error' && console.log('console error:', m.text()));
page.on('pageerror', (e) => console.log('page error:', e.message));
await page.goto(process.env.BASE + '/');
for (const p of paths) {
  if (p.startsWith('click:')) { await page.getByRole('button', { name: p.slice(6) }).first().click(); await page.waitForTimeout(500); continue; }
  if (p.startsWith('link:')) { await page.getByRole('link', { name: p.slice(5) }).first().click(); await page.waitForTimeout(500); continue; }
  if (p.startsWith('shot:')) { await page.screenshot({ path: `${out}/${p.slice(5)}.png`, fullPage: true }); continue; }
  await page.goto(process.env.BASE + p); await page.waitForTimeout(700);
}
await browser.close();
