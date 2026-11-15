import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, QuintaDb, useDatabase } from '../../resources/js/data/db';
import * as repo from '../../resources/js/data/repo';
import { reviewItems } from '../../resources/js/data/experience';
import { WORKSPACES } from '../../resources/js/demo/config';
import { seedWorkspace } from '../../resources/js/demo/seed';
import { timeOnDay } from '../../resources/js/domain/time';
import { renderOverview } from '../../resources/js/features/overview/overview';
import { app } from '../../resources/js/state';

let sequence = 0;
const now = timeOnDay(142, WORKSPACES.demo.epoch, '07:02');
beforeEach(async () => {
    useDatabase(new QuintaDb(`quinta-experience-${sequence++}`));
    await db.open();
    await seedWorkspace('demo',142);
    app.ws = 'demo'; app.role = 'astronaut'; app.now = now;
});
afterEach(async () => { await db.delete(); });

async function saveCheckin() {
    const draft = (await repo.checkinFor('demo','moreau',142))!;
    await repo.submitCheckin('demo','moreau',draft.form,312,now);
}

describe('the shared astronaut and medical officer experience', () => {
    it('Today moves from check-in due to saved confirmation and review pending using actual records', async () => {
        await repo.syncReminders('demo','moreau',now);
        const due = (await renderOverview()).value;
        expect(due).toContain('Check-in due');
        expect(due).not.toContain('href="/check-in"');
        await saveCheckin();
        const page = (await renderOverview()).value;
        expect(page).toContain('Crew review pending');
        expect(page).toContain('Check-in saved');
        expect(page).not.toContain('href="/check-in"');
        const queue = await reviewItems('demo');
        expect(queue).toHaveLength(1);
        expect(queue[0].crewId).toBe('moreau');
        expect(queue[0].status).toBe('Crew review pending');
    });

    it('a CMO follow-up becomes the next action; the response returns to the queue and can be acknowledged', async () => {
        await saveCheckin();
        const alert = (await repo.alertsFor('demo'))[0];
        await repo.recordReview('demo',alert.key,'haddad','Please clarify sleep.',{label:'Clarify sleep duration',measurement:'sleep_main',reason:'Exclude naps.'},now);
        const request = (await repo.requestsFor('demo','moreau'))[0];
        expect((await renderOverview()).value).toContain('Respond to follow-up');
        expect((await renderOverview()).value).toContain(request.id);
        expect((await reviewItems('demo'))[0].waitingForCrew).toBe(true);
        await repo.answerRequest('demo',request.id,'moreau','No naps included.',[],now);
        expect((await reviewItems('demo'))[0].status).toBe('Response received');
        await repo.closeRequest('demo',request.id,now);
        expect(await reviewItems('demo')).toHaveLength(0);
        expect((await renderOverview()).value).toContain('Your check-in is saved.');
    });

    it('symptom review and photo state survive reopening IndexedDB and follow the same case throughout', async () => {
        const input = { description:'Fictional small skin patch',bodyArea:'Left arm',noticedAt:new Date(now-60000).toISOString() };
        const draft = await repo.saveSymptomDraft('demo','moreau',input,{name:'demo.png',mime:'image/png',data:new Uint8Array([1,2,3]).buffer,simulated:true},now);
        const name = db.name; db.close(); useDatabase(new QuintaDb(name)); await db.open();
        expect((await repo.symptomDraft('demo','moreau'))?.attachmentId).toBe(draft.attachmentId);
        expect((await repo.symptomAttachment('demo','moreau',draft.attachmentId!))?.data.byteLength).toBe(3);
        await repo.submitSymptomReport('demo','moreau',now);
        expect((await reviewItems('demo'))[0].id).toBe(draft.id);
        await repo.reviewSymptomReport('demo',draft.id,'haddad','more-info','Is the patch itchy?',now);
        expect((await renderOverview()).value).toContain('Respond to follow-up');
        expect((await reviewItems('demo'))[0].status).toBe('Follow-up requested');
        await repo.replySymptomReport('demo',draft.id,'moreau','No itching.',now);
        expect((await reviewItems('demo'))[0].status).toBe('Response received');
        await repo.reviewSymptomReport('demo',draft.id,'haddad','completed','Review complete.',now);
        expect(await reviewItems('demo')).toHaveLength(0);
        expect(await repo.reportsFor('demo')).toHaveLength(0);
    });

    it('drafts never enter the review queue, including a description-only draft', async () => {
        await repo.saveSymptomDraft('demo','moreau',{description:'Draft',bodyArea:'Eyes',noticedAt:new Date(now).toISOString()},undefined,now);
        expect(await reviewItems('demo')).toHaveLength(0);
        await seedWorkspace('explore',142);
        expect(await reviewItems('explore')).toHaveLength(0);
    });
});
