import { expect, test, type Page } from '@playwright/test';

/** Open the app as a role in a workspace (the home page itself no longer enters one). */
async function enterAs(page: Page, roleId: 'astronaut' | 'cmo' | 'ground', mode: 'demo' | 'explore' = 'demo') {
    // The home page no longer opens a workspace: store the choice the app reads at boot, then open the role's start view.
    await page.goto('/');
    await page.evaluate(([ws, role]) => {
        localStorage.setItem('quinta.ws', ws);
        localStorage.setItem('quinta.role', role);
    }, [mode, roleId]);
    await page.goto(roleId === 'astronaut' ? '/overview' : roleId === 'cmo' ? '/crew' : '/ground');
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


/** "Report a symptom": capture on this device (also offline), onboard review, feedback in Follow-up. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFklEQVR4nGP8z4AdMOEQH5UYrBIAVbwBD1vk9kUAAAAASUVORK5CYII=', 'base64');
const photo = (name = 'arm.png') => ({ name, mimeType: 'image/png', buffer: PNG });
const shot = (page: Page, name: string) => page.screenshot({ path: `docs/screenshots/role-redesign/${test.info().project.name}/${name}.png`, fullPage: true });

test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
        localStorage.setItem('quinta.guide.astronaut', 'done');
        localStorage.setItem('quinta.guide.cmo', 'done');
        localStorage.setItem('quinta.coach', '0');
        localStorage.setItem('quinta.body3d', 'off');
    });
});

async function startDemo(page: Page) {
    await enterAs(page, 'astronaut');
    await expect(page.locator('#page-title')).toHaveText('Today');
}

const role = (page: Page, r: 'Astronaut' | 'CMO') => page.getByRole('group', { name: 'Role' }).getByRole('button', { name: new RegExp(r) }).click();
const loaded = (page: Page, selector: string) => expect.poll(() => page.locator(selector).first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

test('Symptom report · photo draft survives an offline reload, CMO reviews it in the right file, feedback reaches Follow-up', async ({ page, context }) => {
    test.skip(test.info().project.name !== 'desktop-1440', 'offline run once');
    await startDemo(page);
    await expect(page.locator('.st-menu summary')).toContainText('All set', { timeout: 30000 });
    await page.reload(); // page now controlled by the service worker

    // entry points: Daily check-in and Follow-up
    await page.goto('/check-in');
    await step(page, 2);
    await page.getByRole('link', { name: 'Report a symptom with a photo' }).click();
    await expect(page.locator('#page-title')).toHaveText('Report a symptom');

    await page.getByLabel('What do you see?').fill('Red patch on the forearm, about 3 cm, itchy');
    await page.getByLabel('Body area').selectOption('Left arm');
    await page.getByLabel('Choose from this device').setInputFiles(photo());
    await expect(page.locator('.sym-saved')).toContainText('Saved on this device');
    await loaded(page, '.sym-photo img');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.locator('.sym-saved')).toContainText('Saved on this device');

    // reload without network: the draft, its text and its photo come back from IndexedDB
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('#page-title')).toHaveText('Report a symptom');
    await expect(page.getByLabel('What do you see?')).toHaveValue('Red patch on the forearm, about 3 cm, itchy');
    await expect(page.getByLabel('Body area')).toHaveValue('Left arm');
    await loaded(page, '.sym-photo img');
    await page.goto('/follow-up');
    await page.locator('#symptoms').getByRole('link', { name: 'Resume draft' }).first().click();
    await page.getByRole('button', { name: 'Submit for onboard review' }).click();

    await expect(page.locator('#page-title')).toHaveText('Follow-up');
    const mine = page.locator('#symptoms .sym').first();
    await expect(mine).toContainText('Crew review pending');
    await expect(mine).toContainText('Left arm');
    await loaded(page, '#symptoms .sym-photo img');
    await shot(page, '15-symptom-astronaut-submitted');

    // CMO: notification, right member file, photo and context
    await role(page, 'CMO');
    await expect(page.locator('.review-queue')).toContainText('Left arm');
    await page.locator('.review-queue .review-row').filter({ hasText: 'Left arm' }).first().click();
    await expect(page.locator('#page-title')).toHaveText('Cdr K. Moreau');
    const card = page.locator('#symptoms .sym').first();
    await expect(card).toContainText('Red patch on the forearm');
    await expect(card).toContainText('Left arm');
    await expect(card).toContainText('Day 142');
    await loaded(page, '#symptoms .sym-photo img');
    await page.goto('/crew/sato');
    await expect(page.locator('#symptoms')).toContainText('No symptom report submitted by this member');
    await expect(page.locator('#symptoms img')).toHaveCount(0);

    await page.goto('/crew/moreau#symptoms');
    await page.getByLabel('Review note (shown to the crew member)').fill('Is it warm to the touch?');
    await page.getByRole('button', { name: 'Request more information' }).click();
    await expect(page.locator('#symptoms .sym').first()).toContainText('More information requested');

    await role(page, 'Astronaut');
    await page.goto('/follow-up#symptoms');
    await expect(page.locator('#symptoms .sym').first()).toContainText('Is it warm to the touch?');
    await page.getByLabel('Your reply to the CMO').fill('No, not warm.');
    await page.getByRole('button', { name: 'Send reply' }).click();

    await role(page, 'CMO');
    await page.goto('/crew/moreau#symptoms');
    await expect(page.locator('#symptoms .sym').first()).toContainText('No, not warm.');
    await page.getByLabel('Review note (shown to the crew member)').fill('Mild irritation. Recheck in 48 h.');
    await page.getByRole('button', { name: 'Complete review' }).click();
    await expect(page.locator('#symptoms .sym').first()).toContainText('Reviewed');
    await shot(page, '16-symptom-cmo-reviewed');

    // back to the crew member: the feedback is in Follow-up, and nothing was queued for the ground
    await role(page, 'Astronaut');
    await page.goto('/follow-up#symptoms');
    const done = page.locator('#symptoms .sym').first();
    await expect(done).toContainText('Reviewed');
    await expect(done).toContainText('Mild irritation. Recheck in 48 h.');
    await shot(page, '17-symptom-astronaut-feedback');
    await role(page, 'CMO');
    await page.goto('/reports');
    await expect(page.locator('.rep-list li')).toHaveCount(0);
    await context.setOffline(false);
});

test('Symptom report · description only, replace and remove the photo, invalid file rejected with the text kept', async ({ page }) => {
    await startDemo(page);
    await page.goto('/follow-up');
    await page.locator('#symptoms').getByRole('link', { name: 'Report a symptom' }).click();
    await expect(page.locator('#page-title')).toHaveText('Report a symptom');

    // submitting an empty form saves a draft and marks what is missing
    await page.getByRole('button', { name: 'Submit for onboard review' }).click();
    await expect(page.getByText('Describe what you see in a few words.')).toBeVisible();
    await expect(page.getByText('Choose the body area.')).toBeVisible();

    await page.getByLabel('What do you see?').fill('Swollen eyelid since waking up');
    // invalid file: rejected before anything is written, the typed text stays
    await page.getByLabel('Choose from this device').setInputFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
    await expect(page.locator('#photo-err')).toContainText('not a JPEG, PNG or WebP image');
    await expect(page.getByLabel('What do you see?')).toHaveValue('Swollen eyelid since waking up');
    await expect(page.locator('.sym-photo img')).toHaveCount(0);

    // add, replace, remove
    await page.getByLabel('Choose from this device').setInputFiles(photo('first.png'));
    await expect(page.locator('.sym-photo figcaption')).toContainText('first.png');
    await page.getByLabel('Replace from this device').setInputFiles(photo('second.png'));
    await expect(page.locator('.sym-photo figcaption')).toContainText('second.png');
    await page.getByRole('button', { name: 'Remove photo' }).click();
    await expect(page.locator('.sym-photo img')).toHaveCount(0);
    await expect(page.getByLabel('What do you see?')).toHaveValue('Swollen eyelid since waking up');

    // the demo offers a fictional image
    await page.getByRole('button', { name: 'Use a simulated image' }).click();
    await expect(page.locator('.sym-photo figcaption')).toContainText('Simulated image');
    await page.getByRole('button', { name: 'Remove photo' }).click();

    // description only
    await page.getByLabel('Body area').selectOption('Eyes');
    await page.getByRole('button', { name: 'Submit for onboard review' }).click();
    await expect(page.locator('#page-title')).toHaveText('Follow-up');
    const mine = page.locator('#symptoms .sym').first();
    await expect(mine).toContainText('Crew review pending');
    await expect(mine).toContainText('No photo · description only');

    await role(page, 'CMO');
    await page.goto('/crew/moreau#symptoms');
    await expect(page.locator('#symptoms .sym').first()).toContainText('Swollen eyelid since waking up');
    await expect(page.locator('#symptoms .sym').first()).toContainText('No photo · description only');
});
