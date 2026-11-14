import { beforeEach, describe, expect, it } from 'vitest';
import { db, QuintaDb, useDatabase } from '../../resources/js/data/db';
import * as repo from '../../resources/js/data/repo';
import { WORKSPACES } from '../../resources/js/demo/config';
import { seedWorkspace } from '../../resources/js/demo/seed';
import { missionDay, timeOnDay } from '../../resources/js/domain/time';

const epoch = WORKSPACES.demo.epoch;
const at = (day: number, t: string) => timeOnDay(day, epoch, t);
let dbn = 0;

async function draft(day: number) {
    return (await repo.checkinFor('demo', 'moreau', day))!;
}

async function submitDraft(day: number, now: number) {
    const d = await draft(day);
    const minutes = Number(d.form.sleepHours) * 60 + Number(d.form.sleepMinutes);
    return repo.submitCheckin('demo', 'moreau', d.form, minutes, now);
}

async function cmoNotifs(type?: string) {
    return (await repo.notificationsFor('demo', 'haddad')).filter((n) => !type || n.type === type);
}

beforeEach(async () => {
    const fresh = new QuintaDb(`quinta-test-${dbn++}`);
    useDatabase(fresh);
    await fresh.open();
});

describe('guided scenario', () => {
    it('J138: saving 384 min raises no alert', async () => {
        await seedWorkspace('demo', 138);
        const res = await submitDraft(138, at(138, '07:02'));
        expect(res.newAlert).toBeNull();
        expect(await repo.alertsFor('demo')).toHaveLength(0);
    });

    it('J142: no alert before saving, one alert and one CMO notification after saving 312 min', async () => {
        await seedWorkspace('demo', 142);
        expect(await repo.alertsFor('demo')).toHaveLength(0);
        expect((await draft(142)).status).toBe('draft');
        const res = await submitDraft(142, at(142, '07:02'));
        expect(res.newAlert).not.toBeNull();
        const alerts = await repo.alertsFor('demo', 'moreau');
        expect(alerts).toHaveLength(1);
        const evidence = await Promise.all(alerts[0].evidenceIds.map((id) => db.observations.get(id)));
        expect(evidence.map((o) => o!.value)).toEqual([336, 324, 312]);
        const n = await cmoNotifs('sleep-review');
        expect(n).toHaveLength(1);
        expect(n[0].title).toBe('Sleep trend needs review');
        expect(n[0].readAt).toBeNull();
    });

    it('a fourth night keeps the same alert and does not duplicate the notification', async () => {
        await seedWorkspace('demo', 142);
        await submitDraft(142, at(142, '07:02'));
        await repo.setDemoClock(at(143, '07:01'));
        const form = { ...repo.EMPTY_FORM, sleepHours: '5', sleepMinutes: '0', drowsiness: 7 };
        await repo.submitCheckin('demo', 'moreau', form, 300, at(143, '07:01'));
        const alerts = await repo.alertsFor('demo', 'moreau');
        expect(alerts).toHaveLength(1);
        expect(alerts[0].endDay).toBe(143);
        expect(alerts[0].evidenceIds).toHaveLength(4);
        expect(await cmoNotifs('sleep-review')).toHaveLength(1);
    });

    it('re-saving the same day versions the night instead of duplicating it', async () => {
        await seedWorkspace('demo', 142);
        await submitDraft(142, at(142, '07:02'));
        const form = { ...(await draft(142)).form, sleepHours: '6', sleepMinutes: '10' };
        await repo.submitCheckin('demo', 'moreau', form, 370, at(142, '07:10'));
        const nights = (await repo.observationsFor('demo', 'moreau')).filter((o) => o.missionDay === 142 && o.variable === 'sleep_main' && o.method === 'sleep-diary');
        expect(nights).toHaveLength(2);
        expect(nights.filter((o) => !o.supersededBy)).toHaveLength(1);
        expect(nights.find((o) => !o.supersededBy)!.version).toBe(2);
    });
});

describe('reminder (M14)', () => {
    it('06:59 scheduled, 07:00 due + one notification, snooze survives a reload, save closes the reminder', async () => {
        await seedWorkspace('demo', 142);
        await repo.syncReminders('demo', 'moreau', at(142, '06:59'));
        expect((await repo.todaysTask('demo', 'moreau', at(142, '06:59')))!.ev.state).toBe('scheduled');
        await repo.syncReminders('demo', 'moreau', at(142, '07:00'));
        expect((await repo.todaysTask('demo', 'moreau', at(142, '07:00')))!.ev.state).toBe('due');
        const due = (await repo.notificationsFor('demo', 'moreau')).filter((n) => n.type === 'checkin-due');
        expect(due).toHaveLength(1);
        await repo.markRead(due[0].id, at(142, '07:00'));
        await repo.snooze('demo', 'moreau', at(142, '07:00'));
        // "reload": read straight from the database again
        expect((await repo.todaysTask('demo', 'moreau', at(142, '07:29')))!.ev.state).toBe('snoozed');
        await repo.syncReminders('demo', 'moreau', at(142, '07:30'));
        const again = (await repo.notificationsFor('demo', 'moreau')).filter((n) => n.type === 'checkin-due');
        expect(again).toHaveLength(1);
        expect(again[0].readAt).toBeNull(); // unread again once when the snooze ends
        await repo.markRead(again[0].id, at(142, '07:31'));
        await repo.syncReminders('demo', 'moreau', at(142, '07:32'));
        expect((await repo.notificationsFor('demo', 'moreau')).find((n) => n.type === 'checkin-due')!.readAt).not.toBeNull();
        await submitDraft(142, at(142, '07:35'));
        expect((await repo.todaysTask('demo', 'moreau', at(142, '07:36')))!.ev.state).toBe('completed');
    });
});

describe('isolation (M13, V04, V06)', () => {
    it('reset demo leaves Explore data, preferences and plan untouched', async () => {
        await seedWorkspace('explore', 142);
        const now = Date.now();
        await repo.saveReminderSettings('explore', 'okafor', { time: '08:15', enabled: true }, now);
        await repo.addMeasurement('explore', 'okafor', { missionDay: missionDay(now, WORKSPACES.explore.epoch), variable: 'spo2', value: 96, unit: '%', method: 'Finger pulse oximeter', context: { signal: 'good' }, quality: 'valid', author: 'okafor', source: 'manual', measuredAt: new Date(now).toISOString() }, now);
        const before = await repo.observationsFor('explore', 'okafor');
        await seedWorkspace('demo', 142);
        await repo.resetDemo(138);
        expect(await repo.observationsFor('explore', 'okafor')).toEqual(before);
        expect(await repo.reminderSettings('explore', 'okafor')).toEqual({ time: '08:15', enabled: true });
        expect(await repo.kvGet('demo', 'scenario', 0)).toBe(138);
    });

    it('Explore app never runs SLEEP-001, even with three short nights; a manual review reaches the CMO', async () => {
        await seedWorkspace('explore', 142);
        const now = Date.now();
        const day = missionDay(now, WORKSPACES.explore.epoch);
        await repo.submitCheckin('explore', 'okafor', { ...repo.EMPTY_FORM, sleepHours: '5', sleepMinutes: '0', drowsiness: 6 }, 300, now);
        expect(await repo.alertsFor('explore')).toHaveLength(0);
        await repo.requestReview('explore', 'okafor', 'Short nights this week', [], now);
        const n = await repo.notificationsFor('explore', 'ibarra');
        expect(n.map((x) => x.title)).toContain('Crew review requested');
        expect(await repo.reportsFor('explore')).toHaveLength(0); // no automatic ground transmission
        expect(day).toBeGreaterThan(0);
    });

    it('two reports stay limited to their member and a report is frozen after a correction', async () => {
        await seedWorkspace('demo', 142);
        const now = at(142, '08:00');
        const m = await repo.generateReport('demo', 'moreau', 136, 142, 'haddad', now);
        const s = await repo.generateReport('demo', 'sato', 136, 142, 'haddad', now);
        const mc = JSON.parse(m.content);
        const sc = JSON.parse(s.content);
        expect(mc.member.alias).toBe('Cdr K. Moreau');
        expect(sc.member.alias).toBe('FE H. Sato');
        expect(mc.observations.every((o: { id: string }) => sc.observations.every((p: { id: string }) => p.id !== o.id))).toBe(true);
        expect(mc.labs.find((l: { analyte: string }) => l.analyte === 'Hb').verdict).toBe('Below');
        expect(sc.labs.find((l: { analyte: string }) => l.analyte === 'Hb').verdict).toBe('Within');
        expect(mc.label).toBe('Simulated crew data');
        // diary and actigraphy never mixed in the daily grid
        expect(mc.dailyGrid.sleep_main.map((c: { value: string }) => c.value)).toEqual(['450', '432', '384', '366', '336', '324', 'Missing']);
        expect(mc.dailyGrid.sleep_actigraphy[0].value).toBe('468');
        const bp = (await repo.currentObservations('demo', 'moreau')).find((o) => o.variable === 'bp')!;
        await repo.correctObservation('demo', bp.id, { value: 120 }, 'moreau', now);
        expect((await db.reports.get(m.id))!.content).toBe(m.content);
    });
});

describe('report queue (M06, V05)', () => {
    it('stays queued while the ground link is down, receipt lost → retry with same UUID → original receipt', async () => {
        await seedWorkspace('demo', 142);
        let t = at(142, '08:00');
        const now = () => t;
        const r = await repo.generateReport('demo', 'moreau', 136, 142, 'haddad', t);
        await repo.queueReport('demo', r.id, 'simulated-ground', t);
        await repo.processQueue('demo', { groundLink: false, browserOnline: false, loseNextReceipt: false }, now);
        expect((await db.reports.get(r.id))!.queue.state).toBe('queued');

        t += 60_000;
        await repo.processQueue('demo', { groundLink: true, browserOnline: false, loseNextReceipt: true }, now);
        const afterLoss = (await db.reports.get(r.id))!;
        expect(afterLoss.queue.state).toBe('retry');
        expect((await cmoNotifs('report-retry'))).toHaveLength(1);
        const stored = await db.groundSim.get(r.id);
        expect(stored).toBeDefined();

        await repo.retryReport('demo', r.id);
        t += 60_000;
        await repo.processQueue('demo', { groundLink: true, browserOnline: false, loseNextReceipt: false }, now);
        const done = (await db.reports.get(r.id))!;
        expect(done.queue.state).toBe('received');
        expect(done.id).toBe(r.id);
        expect(done.content).toBe(r.content);
        expect(done.queue.receipt!.receiptId).toBe(stored!.receipt.receiptId);
        expect(done.queue.receipt!.replayed).toBe(true);
        expect(done.queue.receipt!.receiver).toBe('Simulated ground receiver');
        expect(await cmoNotifs('report-received')).toHaveLength(1);
    });

    it('a failed Laravel request leaves the report in the queue with Retry available', async () => {
        await seedWorkspace('demo', 142);
        const t = at(142, '08:00');
        const r = await repo.generateReport('demo', 'moreau', 136, 142, 'haddad', t);
        await repo.queueReport('demo', r.id, 'laravel-test', t);
        const failing = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
        await repo.processQueue('demo', { groundLink: true, browserOnline: true, loseNextReceipt: false }, () => t, failing);
        expect((await db.reports.get(r.id))!.queue.state).toBe('retry');
    });
});

describe('follow-up (M04)', () => {
    it('CMO review → follow-up request → astronaut answers → CMO notified, visible to both roles', async () => {
        await seedWorkspace('demo', 142);
        await submitDraft(142, at(142, '07:02'));
        const [alert] = await repo.alertsFor('demo', 'moreau');
        await repo.recordReview('demo', alert.key, 'haddad', 'Trend confirmed, ask for a new check-in tomorrow', { label: 'New sleep check-in tomorrow', measurement: null, reason: 'Sleep trend review' }, at(142, '08:00'));
        const [req] = await repo.requestsFor('demo', 'moreau');
        expect(req.status).toBe('open');
        expect((await repo.notificationsFor('demo', 'moreau')).some((n) => n.title === 'New follow-up request')).toBe(true);
        await repo.answerRequest('demo', req.id, 'moreau', 'Will do, slept badly due to noise', [], at(142, '09:00'));
        expect((await repo.requestsFor('demo', 'moreau'))[0].status).toBe('answered');
        expect((await cmoNotifs('follow-up-completed'))).toHaveLength(1);
        expect((await repo.alertsFor('demo', 'moreau'))[0].status).toBe('reviewed');
        expect(await repo.requestsFor('demo', 'sato')).toHaveLength(0);
    });
});
