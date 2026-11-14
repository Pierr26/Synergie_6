import { expect, test, type Page } from '@playwright/test';

/** Entry screen: guided demo is the default mode; pick a role card. */
async function enterAs(page: Page, roleId: 'astronaut' | 'cmo' | 'ground', mode: 'demo' | 'explore' = 'demo') {
    await page.goto('/');
    await page.getByRole('radio', { name: mode === 'explore' ? /Free sandbox/ : /Guided demo/ }).click();
    await page.locator(`.role-card[data-role="${roleId}"]`).click();
}

/** Progressive check-in: open a step from the stepper (0 sleep, 1 drowsiness, 2 extras, 3 review). */
async function step(page: Page, n: number) {
    await page.locator('.stepper .step').nth(n).click();
}

/** Save the check-in as a user would: "Save now" on an early step, else the last step's "Save check-in". */
async function saveCheckin(page: Page) {
    const now = page.getByRole('button', { name: 'Save now', exact: true });
    if (await now.isVisible()) return now.click();
    const save = page.getByRole('button', { name: 'Save check-in', exact: true });
    if (!(await save.isVisible())) await step(page, 3);
    await save.click();
}


/**
 * M05 / V05 · offline after preparation, served from the same origin as Laravel.
 * Prepare online (service worker precache), cut the browser network, reload an internal view,
 * do a check-in, generate, print-preview and queue a report; then simulate a cache update.
 */
test('M05 · reload offline on an internal view, keep working, data survives a cache update', async ({ page, context }) => {
    test.skip(test.info().project.name !== 'desktop-1440', 'offline run once');
    await context.addInitScript(() => {
        localStorage.setItem('quinta.guide.astronaut', 'done');
        localStorage.setItem('quinta.guide.cmo', 'done');
    });
    await enterAs(page, 'astronaut');
    await expect(page.locator('.st-menu summary')).toContainText('All set', { timeout: 30000 });
    await page.reload(); // page now controlled by the service worker

    await context.setOffline(true);
    await page.goto('/trends?metric=sleep_main');
    await expect(page.locator('#page-title')).toHaveText('Trends');
    await expect(page.locator('.mission')).toContainText('Device offline');

    await scenario(page, 'Advance 1 minute');
    await page.goto('/check-in');
    await saveCheckin(page);
    await expect(page.locator('#saved-h')).toHaveText('Saved on this device');

    await page.getByRole('group', { name: 'Role' }).getByRole('button', { name: /CMO/ }).click();
    await page.goto('/crew/moreau');
    await page.getByLabel('Your review').fill('Reviewed offline');
    await page.getByRole('button', { name: 'Record review' }).click();
    await page.goto('/reports');
    await page.getByRole('button', { name: 'Generate report' }).click();
    await expect(page.locator('.report-doc')).toContainText('Cdr K. Moreau');
    await page.getByRole('button', { name: 'Queue for ground' }).click();
    await expect(page.locator('.queue-state')).toContainText('Queued');
    await page.reload();
    await expect(page.locator('.queue-state')).toContainText('Queued');
    await page.screenshot({ path: 'docs/screenshots/role-redesign/offline-queued-1440.png', fullPage: true });

    // simulate a new deployment: drop the current shell cache, keep IndexedDB, go back online
    await context.setOffline(false);
    await page.evaluate(async () => {
        for (const k of await caches.keys()) await caches.delete(k);
        const reg = await navigator.serviceWorker.getRegistration();
        await reg?.update();
    });
    await page.goto('/reports');
    await expect(page.locator('.rep-list li')).toHaveCount(1);
    await expect(page.locator('.rep-list')).toContainText('Queued');
    await page.goto('/crew/moreau');
    await expect(page.locator('.alert-card')).toContainText('Reviewed offline');
});

async function scenario(page: Page, label: string) {
    const tools = page.locator('details.demo-tools');
    if (await tools.getAttribute('open') === null) await tools.locator('summary').click();
    await page.getByRole('button', { name: label, exact: true }).click();
}
