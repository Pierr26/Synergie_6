import { beforeEach, describe, expect, it } from 'vitest';
import { db, QuintaDb, useDatabase } from '../../resources/js/data/db';
import * as repo from '../../resources/js/data/repo';
import { WORKSPACES } from '../../resources/js/demo/config';
import { seedWorkspace } from '../../resources/js/demo/seed';
import { awaitingReply, PHOTO_MAX_BYTES, validatePhoto, validateSubmission } from '../../resources/js/domain/symptoms';
import { timeOnDay } from '../../resources/js/domain/time';

const now = timeOnDay(142, WORKSPACES.demo.epoch, '08:00');
const input = { description: 'Red patch, about 3 cm, itchy', bodyArea: 'Left arm', noticedAt: new Date(now - 3_600_000).toISOString() };
const photo = (bytes = 2048) => ({ name: 'arm.png', mime: 'image/png', data: new Uint8Array(bytes).fill(7).buffer });
let dbn = 0;

beforeEach(async () => {
    const fresh = new QuintaDb(`quinta-symptoms-${dbn++}`);
    useDatabase(fresh);
    await fresh.open();
    await seedWorkspace('demo', 142);
    await seedWorkspace('explore', 142);
});

describe('photo and submission validation', () => {
    it('accepts JPEG, PNG and WebP up to 5 MB', () => {
        expect(validatePhoto({ type: 'image/jpeg', size: 1000 })).toBeNull();
        expect(validatePhoto({ type: 'image/webp', size: PHOTO_MAX_BYTES })).toBeNull();
    });
    it('rejects other formats, empty and oversized files with a way to retry', () => {
        expect(validatePhoto({ type: 'application/pdf', size: 1000 })).toMatch(/JPEG, PNG or WebP/);
        expect(validatePhoto({ type: 'image/png', size: 0 })).toMatch(/empty/);
        expect(validatePhoto({ type: 'image/png', size: PHOTO_MAX_BYTES + 1 })).toMatch(/limit is 5 MB/);
    });
    it('requires description, area and a past time to submit', () => {
        expect(validateSubmission(input, now)).toEqual({});
        const e = validateSubmission({ description: ' ', bodyArea: '', noticedAt: new Date(now + 3_600_000).toISOString() }, now);
        expect(Object.keys(e).sort()).toEqual(['bodyArea', 'description', 'noticedAt']);
    });
});

describe('draft on this device', () => {
    it('keeps one draft with its photo, replaces and removes the photo', async () => {
        const d1 = await repo.saveSymptomDraft('demo', 'moreau', input, photo(), now);
        expect(d1.status).toBe('draft');
        expect(d1.attachmentId).not.toBeNull();
        const stored = await repo.symptomAttachment('demo', 'moreau', d1.attachmentId!);
        expect(stored?.size).toBe(2048);

        const d2 = await repo.saveSymptomDraft('demo', 'moreau', { ...input, description: 'Edited' }, undefined, now + 1000);
        expect(d2.id).toBe(d1.id);
        expect(d2.attachmentId).toBe(d1.attachmentId);

        const d3 = await repo.saveSymptomDraft('demo', 'moreau', input, photo(4096), now + 2000);
        expect(d3.attachmentId).not.toBe(d1.attachmentId);
        expect(await db.attachments.count()).toBe(1);

        const d4 = await repo.saveSymptomDraft('demo', 'moreau', input, null, now + 3000);
        expect(d4.attachmentId).toBeNull();
        expect(await db.attachments.count()).toBe(0);
        expect((await repo.symptomReportsFor('demo', 'moreau')).length).toBe(1);
    });

    it('does not notify anyone while it is a draft', async () => {
        await repo.saveSymptomDraft('demo', 'moreau', input, photo(), now);
        expect((await repo.notificationsFor('demo', 'haddad')).filter((n) => n.type === 'symptom-submitted')).toHaveLength(0);
    });
});

describe('onboard review', () => {
    it('submits with or without a photo and notifies the CMO once', async () => {
        await repo.saveSymptomDraft('demo', 'moreau', input, undefined, now);
        const r = (await repo.submitSymptomReport('demo', 'moreau', now))!;
        expect(r.status).toBe('submitted');
        expect(r.attachmentId).toBeNull();
        const notes = (await repo.notificationsFor('demo', 'haddad')).filter((n) => n.type === 'symptom-submitted');
        expect(notes).toHaveLength(1);
        expect(notes[0].link).toBe(`/crew/moreau?symptom=${r.id}#symptoms`);
        expect(await repo.symptomDraft('demo', 'moreau')).toBeUndefined();
        // submission is an on-board step: no report is queued for the ground
        expect(await db.reports.count()).toBe(0);
    });

    it('records notes, a request for more information, the reply and the completed review', async () => {
        await repo.saveSymptomDraft('demo', 'moreau', input, photo(), now);
        const r = (await repo.submitSymptomReport('demo', 'moreau', now))!;
        await repo.reviewSymptomReport('demo', r.id, 'haddad', 'more-info', 'Is it warm to the touch?', now + 1000);
        expect(awaitingReply(await repo.symptomThread('demo', r.id))).toBe(true);
        const ask = (await repo.notificationsFor('demo', 'moreau')).find((n) => n.type === 'symptom-more-info')!;
        expect(ask.active).toBe(true);
        expect(ask.link).toBe(`/follow-up?symptom=${r.id}#symptoms`);

        await repo.replySymptomReport('demo', r.id, 'moreau', 'No, not warm.', now + 2000);
        expect(awaitingReply(await repo.symptomThread('demo', r.id))).toBe(false);
        expect((await repo.notificationsFor('demo', 'haddad')).some((n) => n.type === 'symptom-reply' && n.active)).toBe(true);
        expect((await repo.notificationsFor('demo', 'moreau')).find((n) => n.type === 'symptom-more-info')!.active).toBe(false);

        await repo.reviewSymptomReport('demo', r.id, 'haddad', 'completed', 'Mild irritation. Recheck in 48 h.', now + 3000);
        const done = (await repo.symptomReport('demo', r.id))!;
        expect(done.status).toBe('reviewed');
        expect(done.reviewedAt).not.toBeNull();
        expect((await repo.symptomThread('demo', r.id)).map((t) => t.kind)).toEqual(['more-info', 'reply', 'completed']);
        expect((await repo.notificationsFor('demo', 'haddad')).filter((n) => n.active && n.type.startsWith('symptom'))).toHaveLength(0);
        expect((await repo.notificationsFor('demo', 'moreau')).some((n) => n.type === 'symptom-feedback')).toBe(true);
        // capture is untouched by the review
        expect(done.description).toBe(input.description);
        expect(done.attachmentId).toBe(r.attachmentId);
    });

    it('cannot review a draft', async () => {
        const d = await repo.saveSymptomDraft('demo', 'moreau', input, undefined, now);
        expect(await repo.reviewSymptomReport('demo', d.id, 'haddad', 'note', 'x', now)).toBeNull();
    });
});

describe('separation', () => {
    it('keeps workspaces and member files apart, and demo reset leaves Explore alone', async () => {
        await repo.saveSymptomDraft('demo', 'moreau', input, photo(), now);
        const demo = (await repo.submitSymptomReport('demo', 'moreau', now))!;
        await repo.saveSymptomDraft('explore', 'okafor', input, photo(), now);
        const explore = (await repo.submitSymptomReport('explore', 'okafor', now))!;

        expect(await repo.symptomReportsFor('demo', 'sato')).toHaveLength(0);
        expect(await repo.symptomReport('explore', demo.id)).toBeUndefined();
        expect(await repo.symptomAttachment('demo', 'sato', demo.attachmentId!)).toBeUndefined();
        expect(await repo.symptomAttachment('explore', 'moreau', demo.attachmentId!)).toBeUndefined();
        expect(await repo.reviewSymptomReport('explore', demo.id, 'ibarra', 'note', 'x', now)).toBeNull();

        await repo.resetDemo(142);
        expect(await repo.symptomReportsFor('demo', 'moreau')).toHaveLength(0);
        expect(await db.attachments.where('ws').equals('demo').count()).toBe(0);
        expect((await repo.symptomReportsFor('explore', 'okafor'))[0].id).toBe(explore.id);
        expect(await repo.symptomAttachment('explore', 'okafor', explore.attachmentId!)).toBeDefined();
    });

    it('never puts a symptom report or photo in a ground report', async () => {
        await repo.saveSymptomDraft('demo', 'moreau', input, photo(), now);
        await repo.submitSymptomReport('demo', 'moreau', now);
        const report = await repo.generateReport('demo', 'moreau', 136, 142, 'haddad', now);
        expect(report.content).not.toContain('Red patch');
        expect(report.content).not.toContain('arm.png');
    });
});
