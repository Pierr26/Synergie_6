import { expect, test, type Page } from '@playwright/test';

const shot = (page: Page, name: string) => page.screenshot({ path: `docs/screenshots/${test.info().project.name}/${name}.png`, fullPage: true });
const isMobile = () => test.info().project.name.startsWith('mobile');

test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
        if (!sessionStorage.getItem('keep-guides')) {
            localStorage.setItem('quinta.guide.astronaut', 'done');
            localStorage.setItem('quinta.guide.cmo', 'done');
        }
    });
});

async function startDemo(page: Page) {
    await page.goto('/');
    await page.getByRole('button', { name: /Start demo/ }).click();
    await expect(page.locator('#page-title')).toHaveText('Overview');
}

async function startExplore(page: Page) {
    await page.goto('/');
    await page.getByRole('button', { name: /Explore app/ }).click();
    await expect(page.locator('#page-title')).toHaveText('Overview');
}

async function role(page: Page, r: 'Astronaut' | 'CMO') {
    await page.getByRole('group', { name: 'Role on board' }).getByRole('button', { name: new RegExp(r) }).click();
}

async function nav(page: Page, name: string) {
    if (!isMobile()) return page.locator('aside nav').getByRole('link', { name, exact: true }).click();
    // phone: four tabs plus "More"; screens outside the tab bar are opened by URL
    const path = { Measurements: '/measurements', Body: '/body', Help: '/help' }[name];
    const tab = page.locator('nav.tabbar').getByRole('link', { name, exact: true });
    if (!path) return tab.click();
    await tab.click({ timeout: 3000 }).catch(() => page.goto(path));
}

test('V09 + M03 · Day 142: reminder, snooze survives reload, saving the draft raises one demo alert', async ({ page }) => {
    await startDemo(page);
    await expect(page.getByRole('heading', { name: 'Today’s check-in' })).toBeVisible();
    await expect(page.locator('.plan-row').first()).toContainText('Scheduled');
    await shot(page, '01-overview-0659');

    await page.getByRole('button', { name: 'Advance 1 minute' }).click();
    await expect(page.locator('#banner-title')).toHaveText('Daily check-in is due');
    await expect(page.getByRole('link', { name: /Notifications, 1 unread/ })).toBeVisible();
    await shot(page, '02-overview-due');

    await page.locator('.banner').getByRole('button', { name: 'Snooze 30 min' }).click();
    await expect(page.locator('.plan-row').first()).toContainText('Snoozed until 07:30');
    await page.reload();
    await expect(page.locator('.plan-row').first()).toContainText('Snoozed until 07:30');
    await expect(page.locator('.banner')).toHaveCount(0);

    await page.getByRole('button', { name: 'Advance 30 min' }).click();
    await expect(page.locator('#banner-title')).toHaveText('Daily check-in is due');

    await page.locator('.banner').getByRole('link', { name: 'Open check-in' }).click();
    await expect(page.locator('#sleepHours')).toHaveValue('5');
    await expect(page.locator('#sleepMinutes')).toHaveValue('12');
    await expect(page.locator('#draft-status')).toContainText('Draft saved');
    await shot(page, '03-checkin-draft');

    // no alert before saving
    await role(page, 'CMO');
    await expect(page.getByText('Nothing waiting for review.')).toBeVisible();
    await role(page, 'Astronaut');
    await nav(page, 'Check-in');

    await page.getByRole('button', { name: 'Save check-in' }).click();
    await expect(page.locator('#saved-h')).toHaveText('Saved on this device');
    const alert = page.locator('section.priority.tone-review');
    await expect(alert.getByRole('heading', { name: 'Sleep trend needs review' })).toBeVisible();
    await expect(alert).toContainText('Demo rule');
    await expect(alert).toContainText('Crew review pending');
    await expect(alert.locator('.evidence li')).toHaveText([/Day 140.*5 h 36 min/, /Day 141.*5 h 24 min/, /Day 142.*5 h 12 min/]);
    await shot(page, '04-checkin-saved-alert');

    await nav(page, 'Overview');
    await expect(page.getByRole('heading', { name: 'Sleep trend needs review' })).toBeVisible();
    await expect(page.locator('.plan-row').first()).toContainText('Completed');
    await shot(page, '05-overview-after-save');
});

test('V02 · Day 138 has no alert; a fourth night does not duplicate the episode', async ({ page }) => {
    await startDemo(page);
    await page.getByRole('button', { name: 'Replay Day 138' }).click();
    await expect(page.locator('.mission .day')).toContainText('Day 138');
    await page.getByRole('button', { name: 'Advance 1 minute' }).click();
    await page.goto('/check-in');
    await expect(page.locator('#sleepHours')).toHaveValue('6');
    await expect(page.locator('#sleepMinutes')).toHaveValue('24');
    await page.getByRole('button', { name: 'Save check-in' }).click();
    await expect(page.locator('#saved-h')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sleep trend needs review' })).toHaveCount(0);

    // Day 142 then a fourth short night on Day 143
    await page.getByRole('button', { name: 'Replay Day 142' }).click();
    await expect(page.locator('.mission .day')).toContainText('Day 142');
    await page.goto('/check-in');
    await page.getByRole('button', { name: 'Save check-in' }).click();
    await expect(page.getByRole('heading', { name: 'Sleep trend needs review' })).toBeVisible();
    await page.getByRole('button', { name: 'Next day 07:00' }).click();
    await expect(page.locator('.mission .day')).toContainText('Day 143');
    await page.goto('/check-in');
    await page.locator('#sleepHours').fill('5');
    await page.locator('#sleepMinutes').fill('0');
    await page.locator('label.scale-opt').filter({ hasText: /^7/ }).first().click();
    await page.getByRole('button', { name: 'Save check-in' }).click();
    await expect(page.locator('#saved-h')).toBeVisible();
    await role(page, 'CMO');
    await page.goto('/notifications');
    await expect(page.locator('.notif').filter({ hasText: 'Sleep trend needs review' })).toHaveCount(1);
});

test('V01 · confirmed zero vs not recorded, draft reload', async ({ page }) => {
    await startDemo(page);
    await page.getByRole('button', { name: 'Advance 1 minute' }).click();
    await page.goto('/check-in');
    await page.locator('#sleepHours').fill('0');
    await page.locator('#sleepMinutes').fill('0');
    await page.getByRole('button', { name: 'Save check-in' }).click();
    await expect(page.locator('#err-sleep')).toContainText('confirm a zero');
    await page.getByLabel('I slept 0 minutes (confirm a zero)').check();
    await expect(page.locator('#draft-status')).toContainText('Draft saved');
    await page.waitForTimeout(300);
    await page.reload();
    await expect(page.locator('#sleepHours')).toHaveValue('0');
    await page.getByLabel('I slept 0 minutes (confirm a zero)').check();
    await page.getByRole('button', { name: 'Save check-in' }).click();
    await expect(page.locator('.summary')).toContainText('0 min (zero confirmed)');
});

test('M04 + M09 + M15 · CMO opens the notification, records a review, astronaut answers', async ({ page }) => {
    await startDemo(page);
    await page.getByRole('button', { name: 'Advance 1 minute' }).click();
    await page.goto('/check-in');
    await page.getByRole('button', { name: 'Save check-in' }).click();
    await expect(page.locator('#saved-h')).toBeVisible();

    await role(page, 'CMO');
    await expect(page.getByRole('link', { name: /Notifications, 1 unread/ })).toBeVisible();
    await page.getByRole('link', { name: /Notifications/ }).click();
    const n = page.locator('.notif').filter({ hasText: 'Sleep trend needs review' });
    await expect(n).toContainText('Unread');
    await n.getByRole('button', { name: 'Open' }).click();
    await expect(page.locator('#page-title')).toHaveText('Cdr K. Moreau');
    await expect(page.locator('.alert-card .evidence li')).toHaveCount(3);
    await shot(page, '06-cmo-member-review');
    await page.getByLabel('Your review').fill('Trend confirmed. Noise near the sleep station reported.');
    await page.getByLabel('Request a follow-up (optional)').selectOption({ label: 'Measure blood pressure at rest' });
    await page.getByRole('button', { name: 'Record review' }).click();
    await expect(page.locator('.alert-card')).toContainText('Reviewed');
    await page.goto('/notifications');
    await expect(page.locator('.notif').filter({ hasText: 'Sleep trend needs review' })).toContainText('Read');

    await role(page, 'Astronaut');
    await expect(page.getByRole('heading', { name: 'New follow-up request' })).toBeVisible();
    await page.getByRole('link', { name: /Open the request/ }).click();
    await page.getByRole('link', { name: /Measure blood pressure/ }).click();
    await page.getByLabel('Systolic (mmHg)').fill('118');
    await page.getByLabel('Diastolic (mmHg)').fill('76');
    await page.getByRole('button', { name: 'Save measurement' }).click();
    await page.goto('/follow-up');
    await expect(page.locator('.timeline')).toContainText('Answered');
    await expect(page.locator('.timeline')).toContainText('Trend confirmed');

    await role(page, 'CMO');
    await expect(page.locator('.todo')).toContainText('Follow-up completed');
});

test('M11 + M06 + V05 · two reports, queue offline, lost receipt, retry keeps the same ID', async ({ page }) => {
    await startDemo(page);
    await role(page, 'CMO');
    await nav(page, 'Reports');
    await page.getByLabel('Crew member').selectOption({ label: 'FE H. Sato' });
    await page.getByRole('button', { name: 'Generate report' }).click();
    await expect(page.locator('.report-doc')).toContainText('FE H. Sato');
    await page.goto('/reports');
    await page.getByLabel('Crew member').selectOption({ label: 'Cdr K. Moreau' });
    await page.getByRole('button', { name: 'Generate report' }).click();
    const doc = page.locator('.report-doc');
    await expect(doc).toContainText('Cdr K. Moreau');
    await expect(doc).not.toContainText('FE H. Sato');
    await expect(doc).toContainText('Simulated crew data');
    await expect(doc).toContainText('Below');
    const reportId = (await doc.locator('.rep-meta dd.mono.small').first().textContent())!.trim();

    await page.getByRole('button', { name: 'Queue for ground' }).click();
    await expect(page.locator('.queue-state')).toContainText('Queued');
    await expect(page.getByText('Ground link offline (simulated)')).toBeVisible();
    await shot(page, '07-report-queued');

    await page.getByLabel('Lose next receipt').check();
    await page.getByRole('button', { name: /Ground link/ }).click();
    await expect(page.locator('.queue-state')).toContainText('Retry available', { timeout: 15000 });
    await page.getByRole('button', { name: 'Retry with the same report' }).click();
    await expect(page.locator('.queue-state')).toContainText('Received', { timeout: 15000 });
    await expect(page.locator('#receipt')).toContainText('Simulated ground receiver');
    await expect(page.locator('#receipt')).toContainText(reportId);
    await expect(page.locator('#receipt')).toContainText('Original receipt returned on retry');
    await expect(page.locator('.mission')).toContainText('Received');
    await shot(page, '08-report-received');
});

test('V06 + M13 · Explore data survives a demo reset; Explore has no mission rule', async ({ page }) => {
    await startExplore(page);
    await expect(page.locator('.head-tags')).toContainText('No mission rule configured');
    await page.goto('/measurements?type=spo2');
    await page.getByLabel('SpO₂ (%)').fill('96');
    await page.getByRole('button', { name: 'Save measurement' }).click();
    await expect(page.locator('table')).toContainText('96 %');
    await startDemo(page);
    await page.getByRole('button', { name: 'Replay Day 138' }).click();
    await expect(page.locator('.mission .day')).toContainText('Day 138');
    await startExplore(page);
    await page.goto('/measurements?type=spo2');
    await expect(page.locator('table')).toContainText('96 %');
});

test('V12 · manual review request in Explore reaches the CMO without any ground transmission', async ({ page }) => {
    await startExplore(page);
    await page.goto('/follow-up');
    await page.getByLabel('What should your CMO look at?').fill('Three short nights this week');
    await page.getByRole('button', { name: 'Request crew review' }).click();
    await expect(page.locator('#open-h + article')).toContainText('Crew review pending');
    await role(page, 'CMO');
    await expect(page.locator('.todo')).toContainText('Crew review requested');
    await expect(page.locator('.todo')).not.toContainText('Sleep trend needs review');
    await page.goto('/reports');
    await expect(page.getByText('No report yet.')).toBeVisible();
});

test('V11 · spot measurements: pair check, SpO₂ range, separate temperature series', async ({ page }) => {
    await startDemo(page);
    await page.goto('/measurements?type=bp');
    await page.getByLabel('Systolic (mmHg)').fill('80');
    await page.getByLabel('Diastolic (mmHg)').fill('90');
    await page.getByRole('button', { name: 'Save measurement' }).click();
    await expect(page.locator('table')).toContainText('Check measurement');
    await page.goto('/measurements?type=spo2');
    await page.getByLabel('SpO₂ (%)').fill('101');
    await page.getByRole('button', { name: 'Save measurement' }).click();
    await expect(page.getByText('SpO₂ goes from 0 to 100 %.')).toBeVisible();
    await page.goto('/trends?metric=temperature');
    await expect(page.locator('.legend')).toContainText('oral');
    await expect(page.locator('.legend')).toContainText('skin');
    await page.goto('/trends?metric=glucose');
    await expect(page.locator('.legend li')).toHaveCount(3); // capillary, plasma, hollow-marker note
});

test('M02 · Trends: chart and table agree, gaps and personal reference visible', async ({ page }) => {
    await startDemo(page);
    await page.goto('/trends?metric=sleep_main&period=14');
    await expect(page.locator('.insight')).toContainText('personal reference');
    await expect(page.locator('.legend')).toContainText('sleep-diary');
    await expect(page.locator('.legend')).toContainText('actigraphy');
    await expect(page.locator('tbody tr.row-gap')).toContainText(['Day 142']);
    await shot(page, '09-trends-sleep');
});

test('M07 + M08 · Body & Risks works without WebGL and by keyboard', async ({ page }) => {
    await page.addInitScript(() => {
        const orig = HTMLCanvasElement.prototype.getContext;
        // @ts-expect-error test override: simulate a device without WebGL
        HTMLCanvasElement.prototype.getContext = function (type: string, ...rest: unknown[]) {
            if (String(type).startsWith('webgl')) return null;
            // @ts-expect-error passthrough
            return orig.call(this, type, ...rest);
        };
    });
    await startDemo(page);
    await page.goto('/body?region=heart');
    await expect(page.getByRole('heading', { name: 'Heart', level: 2 })).toBeVisible();
    // 3D opens by default; without WebGL the view says so and stays on the 2D map
    await expect(page.getByText('WebGL is not available on this device')).toBeVisible();
    await expect(page.locator('.figure2d')).toBeVisible();
    await page.locator('.region-list a').first().focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Eyes', level: 2 })).toBeVisible();
    await expect(page.locator('.hazards li')).toHaveCount(5);
    await shot(page, '10-body-2d');
});

test('M10 + V07 · first-access guide: skip, then reopen from Help', async ({ page, context }) => {
    await context.addInitScript(() => {
        sessionStorage.setItem('keep-guides', '1');
    });
    await page.goto('/');
    await page.evaluate(() => {
        localStorage.removeItem('quinta.guide.astronaut');
        sessionStorage.setItem('keep-guides', '1');
    });
    await page.getByRole('button', { name: /Start demo/ }).click();
    const dlg = page.getByRole('dialog');
    await expect(dlg).toContainText('Your daily check-in');
    await dlg.getByRole('button', { name: 'Skip guide' }).click();
    await expect(dlg).toBeHidden();
    await page.goto('/help');
    await page.getByRole('button', { name: /Reopen the astronaut guide/ }).click();
    await expect(page.getByRole('dialog')).toContainText('Your daily check-in');
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Finish guide' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
});
