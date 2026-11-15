import { expect, test, type Page } from '@playwright/test';

/** Entry screen: guided demo is the default mode; pick a role card. */
async function enterAs(page: Page, roleId: 'astronaut' | 'cmo' | 'ground', mode: 'demo' | 'explore' = 'demo') {
    await page.goto('/');
    await page.getByRole('radio', { name: mode === 'explore' ? 'Free exploration' : 'Guided demo' }).click();
    await page.locator(`.home-role[data-role="${roleId}"]`).click();
    await page.locator('.home-entry-tools .home-enter').click();
}

/** Progressive check-in: open a step from the stepper (0 sleep, 1 drowsiness, 2 extras, 3 review). */
async function step(page: Page, n: number) {
    await page.locator('.stepper .step').nth(n).click();
}

/** Save the check-in as a user would: "Save now" on an early step, else the last step's "Save check-in". */
async function saveCheckin(page: Page) {
    const now = page.getByRole('button', { name: 'Save now', exact: true });
    const save = page.getByRole('button', { name: 'Save check-in', exact: true });
    // a background refresh can swallow a click: retry until one of the save buttons is reached
    await expect(async () => {
        if (await save.isVisible()) return save.click({ timeout: 2000 });
        if (await now.isVisible()) return now.click({ timeout: 2000 });
        await step(page, 3);
        throw new Error('save button not reached yet');
    }).toPass({ timeout: 20000 });
}


const shot = (page: Page, name: string) => page.screenshot({ path: `docs/screenshots/role-redesign/${test.info().project.name}/${name}.png`, fullPage: true });
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
    await enterAs(page, 'astronaut');
    await expect(page.locator('#page-title')).toHaveText('Today');
}

async function startExplore(page: Page) {
    await enterAs(page, 'astronaut', 'explore');
    await expect(page.locator('#page-title')).toHaveText('Today');
}

async function role(page: Page, r: 'Astronaut' | 'CMO') {
    await page.getByRole('group', { name: 'Role' }).getByRole('button', { name: new RegExp(r) }).click();
}

async function nav(page: Page, name: string) {
    if (!isMobile()) return page.locator('aside nav').getByRole('link', { name: name === 'Overview' ? 'Today' : name === 'Check-in' ? 'Daily Check-in' : name, exact: true }).click();
    if (name === 'Overview') name = 'Today';
    // phone: four tabs plus "More"; screens outside the tab bar are opened by URL
    const path = { Measurements: '/measurements', Body: '/body', Help: '/help' }[name];
    const tab = page.locator('nav.tabbar').getByRole('link', { name, exact: true });
    if (!path) return tab.click();
    await tab.click({ timeout: 3000 }).catch(() => page.goto(path));
}

test('V09 + M03 · Today has one next step; snooze, saved summary and pending review reflect the dossier', async ({ page }) => {
    await startDemo(page);
    await expect(page.locator('.today-copy')).toContainText('Scheduled 07:00');
    await shot(page, '01-today-scheduled');
    await scenario(page, 'Advance 1 minute');
    await expect(page.locator('.today-copy')).toContainText('Check-in due');
    await shot(page, '02-today-due');
    await nav(page, 'Check-in');
    await expect(page.locator('#sleepHours')).toHaveValue('5');
    await expect(page.locator('#sleepMinutes')).toHaveValue('12');
    await page.getByRole('button', { name: 'Snooze 30 min' }).click();
    await page.goto('/overview');
    await expect(page.locator('.today-copy')).toContainText('Snoozed until 07:30');
    await page.reload();
    await expect(page.locator('.today-copy')).toContainText('Snoozed until 07:30');
    await scenario(page, 'Advance 30 min');
    await page.goto('/check-in');
    await shot(page, '03-checkin-draft');
    await role(page, 'CMO');
    await expect(page.locator('.review-queue')).toContainText('No review waiting');
    await role(page, 'Astronaut');
    await page.goto('/check-in');
    await saveCheckin(page);
    await expect(page.locator('#saved-h')).toHaveText('Saved on this device');
    await expect(page.locator('section.priority.tone-review')).toContainText('Crew review pending');
    await shot(page, '04-checkin-saved-alert');
    await page.goto('/overview');
    await expect(page.locator('.today-copy h2')).toHaveText('Crew review pending');
    await expect(page.locator('.today-copy')).toContainText('Check-in saved');
    await shot(page, '05-today-after-save');
});

test('V02 · Day 138 has no alert; a fourth night does not duplicate the episode', async ({ page }) => {
    await startDemo(page);
    await scenario(page, 'Replay Day 138');
    await expect(page.locator('.mission .day')).toContainText('Day 138');
    await scenario(page, 'Advance 1 minute');
    await page.goto('/check-in');
    await expect(page.locator('#sleepHours')).toHaveValue('6');
    await expect(page.locator('#sleepMinutes')).toHaveValue('24');
    await saveCheckin(page);
    await expect(page.locator('#saved-h')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sleep trend needs review' })).toHaveCount(0);

    // Day 142 then a fourth short night on Day 143
    await scenario(page, 'Replay Day 142');
    await expect(page.locator('.mission .day')).toContainText('Day 142');
    await page.goto('/check-in');
    await saveCheckin(page);
    await expect(page.getByRole('heading', { name: 'Sleep trend needs review' })).toBeVisible();
    await scenario(page, 'Next day 07:00');
    await expect(page.locator('.mission .day')).toContainText('Day 143');
    await page.goto('/check-in');
    await step(page, 0);
    await page.locator('#sleepHours').fill('5');
    await page.locator('#sleepMinutes').fill('0');
    await step(page, 1);
    await page.locator('label.scale-opt').filter({ hasText: /^7/ }).first().click();
    await saveCheckin(page);
    await expect(page.locator('#saved-h')).toBeVisible();
    await role(page, 'CMO');
    await page.goto('/notifications');
    await expect(page.locator('.notif').filter({ hasText: 'Sleep trend needs review' })).toHaveCount(1);
});

test('V01 · confirmed zero vs not recorded, draft reload', async ({ page }) => {
    await startDemo(page);
    await scenario(page, 'Advance 1 minute');
    await page.goto('/check-in');
    await step(page, 0);
    await page.locator('#sleepHours').fill('0');
    await page.locator('#sleepMinutes').fill('0');
    await saveCheckin(page);
    await expect(page.locator('#err-sleep')).toContainText('confirm a zero');
    await step(page, 0);
    await page.getByLabel('I slept 0 minutes (confirm a zero)').check();
    await expect(page.locator('#draft-status')).toContainText('Draft saved');
    await page.waitForTimeout(300);
    await page.reload();
    await expect(page.locator('#sleepHours')).toHaveValue('0');
    await step(page, 0);
    await page.getByLabel('I slept 0 minutes (confirm a zero)').check();
    await saveCheckin(page);
    await expect(page.locator('.summary')).toContainText('0 min (zero confirmed)');
});

test('M04 + M09 + M15 · CMO opens the notification, records a review, astronaut answers', async ({ page }) => {
    await startDemo(page);
    await scenario(page, 'Advance 1 minute');
    await page.goto('/check-in');
    await saveCheckin(page);
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
    await expect(page.locator('.today-copy')).toContainText('Follow-up requested');
    await page.getByRole('link', { name: 'Respond to follow-up' }).click();
    await page.getByRole('link', { name: /Measure blood pressure/ }).click();
    await page.getByLabel('Systolic (mmHg)').fill('118');
    await page.getByLabel('Diastolic (mmHg)').fill('76');
    await page.getByRole('button', { name: 'Save measurement' }).click();
    await page.goto('/follow-up');
    await expect(page.locator('.timeline')).toContainText('Response received');
    await expect(page.locator('.timeline')).toContainText('Trend confirmed');

    await role(page, 'CMO');
    await expect(page.locator('.review-queue')).toContainText('Response received');
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

    await page.locator('.demo-tools summary').click();
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
    await expect(page.locator('.preview')).toContainText('no mission rule configured');
    await page.goto('/measurements?type=spo2');
    await page.getByLabel('SpO₂ (%)').fill('96');
    await page.getByRole('button', { name: 'Save measurement' }).click();
    await expect(page.locator('table')).toContainText('96 %');
    await startDemo(page);
    await scenario(page, 'Replay Day 138');
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
    await expect(page.locator('.review-queue')).toContainText('Crew review requested');
    await expect(page.locator('.review-queue')).not.toContainText('Sleep trend needs review');
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
    await expect(page.locator('.legend li')).toHaveCount(2); // capillary and plasma: separate series
});

test('M02 · Trends: chart and table agree, gaps and personal reference visible', async ({ page }) => {
    await startDemo(page);
    await page.goto('/trends?metric=sleep_main&period=14');
    await expect(page.locator('.tiles')).toContainText('Your usual');
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
    // 3D only: without WebGL the page says so and the region list and sheets stay usable
    await expect(page.getByText(/WebGL is not available on this device/)).toBeVisible();
    await page.locator('.region-list a').first().focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Eyes', level: 2 })).toBeVisible();
    await expect(page.locator('.hazards li')).toHaveCount(5);
    await shot(page, '10-body-no-webgl');
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
    await page.locator('.home-role[data-role="astronaut"]').click();
    await page.locator('.home-entry-tools .home-enter').click();
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

async function scenario(page: Page, label: string) {
    const tools = page.locator('details.demo-tools');
    if (await tools.getAttribute('open') === null) await tools.locator('summary').click();
    await page.getByRole('button', { name: label, exact: true }).click();
}

test('Sleep follow-up opens the requested field and preserves its correction draft offline', async ({ page, context }) => {
    await startDemo(page);
    await expect(page.locator('.st-menu summary')).toContainText('All set', { timeout: 30000 });
    await page.goto('/check-in');
    await saveCheckin(page);
    await expect(page.locator('#saved-h')).toBeVisible();
    await role(page, 'CMO');
    await page.goto('/crew/moreau');
    await page.getByLabel('Your review').fill('Please exclude naps from the sleep duration.');
    await page.getByLabel('Request a follow-up (optional)').selectOption({ label: 'Clarify your sleep duration' });
    await page.getByRole('button', { name: 'Record review', exact: true }).click();
    await role(page, 'Astronaut');
    await page.getByRole('link', { name: 'Respond to follow-up', exact: true }).click();
    await page.locator('.req a[href^="/check-in?request="]').click();
    await expect(page.locator('.notice')).toContainText('exclude naps');
    await step(page, 0);
    await page.locator('#sleepHours').fill('6');
    await page.locator('#sleepMinutes').fill('30');
    await expect(page.locator('#draft-status')).toContainText('Draft saved on this device');
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('#sleepHours')).toHaveValue('6');
    await expect(page.locator('#sleepMinutes')).toHaveValue('30');
    await shot(page, '20-followup-correction-offline');
    await saveCheckin(page);
    await expect(page.locator('#saved-h')).toBeVisible();
    await role(page, 'CMO');
    await expect(page.locator('.review-queue')).toContainText('Response received');
    await context.setOffline(false);
});
