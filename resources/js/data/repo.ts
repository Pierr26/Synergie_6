import { compareToInterval, LAB_META, type LabResult } from '../domain/labs';
import { acknowledge, canonicalJson, EMPTY_QUEUE, enqueue, fail, RECEIVER_LABEL, retry, sha256Hex, startSending, type ReceiverId, type Receipt } from '../domain/queue';
import { syncAlertReview, syncAnswer, syncCheckin, syncClose, syncDemoClock, syncDemoReset, syncFollowUp, syncLab, syncMeasurement, syncReviewRequest } from './sync';
import { DEFAULT_REMINDER, dismissBanner, evaluateTask, newTask, rescheduleTask, snoozeTask, type CheckinTask, type ReminderSettings } from '../domain/reminder';
import { episodeKey, evaluateSleep001, personalReference, SLEEP_RULE } from '../domain/sleep';
import { awaitingReply, type ReviewKind, type SymptomAttachment, type SymptomInput, type SymptomReport, type SymptomReviewEntry } from '../domain/symptoms';
import { hhmm, missionDay, utcStamp } from '../domain/time';
import type { Member, Observation, Role, WorkspaceId } from '../domain/types';
import { MEMBERS, WORKSPACES } from '../demo/config';
import { seedWorkspace } from '../demo/seed';
import { db, uuid, WS_TABLES, type AlertRow, type CheckinForm, type CheckinRecord, type GroundNoteRow, type NotificationRow, type NotificationType, type ReportRow, type RequestRow } from './db';

/* ------------------------------------------------------------------ kv / clock */

export async function kvGet<T>(ws: WorkspaceId | 'global', key: string, fallback: T): Promise<T> {
    const row = await db.kv.get([ws, key]);
    return row ? (row.value as T) : fallback;
}

export async function kvSet(ws: WorkspaceId | 'global', key: string, value: unknown): Promise<void> {
    await db.kv.put({ ws, key, value });
}

/** Demo uses a controlled clock stored in its own workspace; Explore uses real time. */
export async function readNow(ws: WorkspaceId): Promise<number> {
    if (!WORKSPACES[ws].simulatedClock) return Date.now();
    return kvGet<number>(ws, 'clock', Date.parse('2026-11-08T06:59:00Z'));
}

export async function setDemoClock(ts: number): Promise<void> {
    await kvSet('demo', 'clock', ts);
    void syncDemoClock(ts);
}

/** Mirrors a request answer to the HEXTA API once it is saved locally. */
async function syncAnswerFor(ws: WorkspaceId, requestId: string): Promise<void> {
    const req = await db.requests.get(requestId);
    if (req?.response) await syncAnswer(ws, requestId, req.response.id, req.response.authorId, req.response.text, req.response.observationIds);
}

export async function ensureSeeded(ws: WorkspaceId): Promise<void> {
    const seeded = await kvGet<string | null>(ws, 'seeded', null);
    if (!seeded) await seedWorkspace(ws, 142);
}

/** Reset touches only the demo workspace rows. */
export async function resetDemo(scenario: 138 | 142): Promise<void> {
    await db.transaction('rw', WS_TABLES.map((t) => db.table(t)), async () => {
        for (const t of WS_TABLES) await db.table(t).where('ws').equals('demo').delete();
    });
    await seedWorkspace('demo', scenario);
    void syncDemoReset(scenario);
}

/* ------------------------------------------------------------------ members */

export async function members(ws: WorkspaceId): Promise<Member[]> {
    return db.members.where('ws').equals(ws).toArray();
}

export function memberStatic(ws: WorkspaceId, id: string): Omit<Member, 'ws'> {
    return MEMBERS[ws].find((m) => m.id === id) ?? { id, alias: id, shortName: id, initials: '?', role: 'astronaut', title: '' };
}

/* ------------------------------------------------------------------ observations */

export async function observationsFor(ws: WorkspaceId, crewId: string): Promise<Observation[]> {
    return db.observations.where('[ws+crewId]').equals([ws, crewId]).toArray();
}

export async function currentObservations(ws: WorkspaceId, crewId: string): Promise<Observation[]> {
    return (await observationsFor(ws, crewId)).filter((o) => !o.supersededBy);
}

type NewObs = Omit<Observation, 'id' | 'ws' | 'missionId' | 'crewId' | 'version' | 'supersededBy' | 'recordedAt'>;

/**
 * Adds an observation. For daily fields (one effective value per day and method) an existing
 * value for the same day/method is superseded and kept as history (version + 1).
 */
async function putObservation(ws: WorkspaceId, crewId: string, data: NewObs, nowIso: string, daily: boolean): Promise<Observation> {
    const cfg = WORKSPACES[ws];
    let version = 1;
    if (daily) {
        const prev = (await db.observations.where('[ws+crewId+missionDay]').equals([ws, crewId, data.missionDay]).toArray()).filter(
            (o) => o.variable === data.variable && o.method === data.method && !o.supersededBy,
        );
        const id = uuid();
        for (const p of prev) {
            version = Math.max(version, p.version + 1);
            await db.observations.update(p.id, { supersededBy: id });
        }
        const row: Observation = { ...data, id, ws, missionId: cfg.missionId, crewId, version, supersededBy: null, recordedAt: nowIso };
        await db.observations.add(row);
        return row;
    }
    const row: Observation = { ...data, id: uuid(), ws, missionId: cfg.missionId, crewId, version, supersededBy: null, recordedAt: nowIso };
    await db.observations.add(row);
    return row;
}

/** Correction keeps the previous version and links it. Re-evaluates the demo rule. */
export async function correctObservation(ws: WorkspaceId, id: string, patch: Partial<Pick<Observation, 'value' | 'value2' | 'quality' | 'qualityNote' | 'comment'>>, authorId: string, now: number): Promise<void> {
    await db.transaction('rw', [db.observations, db.alerts, db.notifications, db.kv], async () => {
        const old = await db.observations.get(id);
        if (!old || old.ws !== ws || old.supersededBy) return;
        const next: Observation = { ...old, ...patch, id: uuid(), version: old.version + 1, supersededBy: null, recordedAt: new Date(now).toISOString(), author: authorId, source: 'manual' };
        await db.observations.update(old.id, { supersededBy: next.id });
        await db.observations.add(next);
        if (old.variable === 'sleep_main') await evaluateRules(ws, old.crewId, now);
    });
}

/* ------------------------------------------------------------------ notifications */

async function notify(n: Omit<NotificationRow, 'id' | 'readAt' | 'createdAt' | 'active'> & { active?: boolean }, now: number): Promise<NotificationRow> {
    const existing = await db.notifications.where('eventKey').equals(n.eventKey).first();
    if (existing) return existing;
    const row: NotificationRow = { ...n, id: uuid(), createdAt: new Date(now).toISOString(), readAt: null, active: n.active ?? true };
    await db.notifications.add(row);
    return row;
}

export async function notificationsFor(ws: WorkspaceId, recipientId: string): Promise<NotificationRow[]> {
    const rows = await db.notifications.where('[ws+recipientId]').equals([ws, recipientId]).toArray();
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function markRead(id: string, now: number): Promise<void> {
    const n = await db.notifications.get(id);
    if (n && !n.readAt) await db.notifications.update(id, { readAt: new Date(now).toISOString() });
}

export async function markAllRead(ws: WorkspaceId, recipientId: string, now: number): Promise<void> {
    const rows = await notificationsFor(ws, recipientId);
    await db.transaction('rw', db.notifications, async () => {
        for (const r of rows) if (!r.readAt) await db.notifications.update(r.id, { readAt: new Date(now).toISOString() });
    });
}

/* ------------------------------------------------------------------ reminders (M14) */

export async function reminderSettings(ws: WorkspaceId, crewId: string): Promise<ReminderSettings> {
    return kvGet(ws, `reminder:${crewId}`, DEFAULT_REMINDER);
}

export async function checkinFor(ws: WorkspaceId, crewId: string, day: number): Promise<CheckinRecord | undefined> {
    return db.checkins.where('[ws+crewId+missionDay]').equals([ws, crewId, day]).first();
}

/**
 * Recomputes the check-in task of the current day, classifies open tasks of previous days as missed
 * and keeps the "Daily check-in is due" notification in sync (one entry per day, unread again once
 * when a snooze ends). Runs at open, on return to foreground, on a timer and after clock changes.
 */
export async function syncReminders(ws: WorkspaceId, crewId: string, now: number): Promise<void> {
    const cfg = WORKSPACES[ws];
    const day = missionDay(now, cfg.epoch);
    const settings = await reminderSettings(ws, crewId);
    await db.transaction('rw', [db.tasks, db.notifications, db.checkins], async () => {
        const key = `${ws}|${cfg.missionId}|${crewId}|${day}|checkin`;
        let task = await db.tasks.get(key);
        if (!task) {
            task = newTask(ws, cfg.missionId, crewId, day, cfg.epoch, settings);
            const ci = await checkinFor(ws, crewId, day);
            if (ci?.status === 'submitted') task.completedAt = Date.parse(ci.submittedAt!);
            await db.tasks.add(task);
        }
        const ev = evaluateTask(task, now, day, cfg.epoch, settings.enabled);
        const eventKey = `${task.key}|due`;
        const existing = await db.notifications.where('eventKey').equals(eventKey).first();
        if (ev.state === 'due') {
            if (!existing) {
                await notify({ eventKey, ws, recipientId: crewId, recipientRole: 'astronaut', subjectCrewId: crewId, type: 'checkin-due', title: 'Daily check-in is due', body: `Day ${day} · due ${hhmm(ev.effectiveDue)} UTC. Sleep and drowsiness take about a minute.`, link: '/check-in' }, now);
            } else {
                const patch: Partial<NotificationRow> = { active: true, body: `Day ${day} · due ${hhmm(ev.effectiveDue)} UTC. Sleep and drowsiness take about a minute.` };
                if (task.snoozedUntil && task.reactivatedFor !== task.snoozedUntil) {
                    patch.readAt = null;
                    await db.tasks.update(task.key, { reactivatedFor: task.snoozedUntil });
                }
                await db.notifications.update(existing.id, patch);
            }
        } else if (existing && ev.state === 'snoozed') {
            const body = `Snoozed until ${hhmm(task.snoozedUntil!)} UTC. The reminder comes back then.`;
            if (existing.body !== body) await db.notifications.update(existing.id, { active: true, body });
        } else if (existing && existing.active && (ev.state === 'completed' || ev.state === 'off')) {
            await db.notifications.update(existing.id, { active: false, body: ev.state === 'off' ? 'Reminders are off. The task stays in Today’s plan.' : 'Completed · Saved on this device.' });
        }
    });
}

export async function todaysTask(ws: WorkspaceId, crewId: string, now: number) {
    const cfg = WORKSPACES[ws];
    const day = missionDay(now, cfg.epoch);
    const task = await db.tasks.get(`${ws}|${cfg.missionId}|${crewId}|${day}|checkin`);
    const settings = await reminderSettings(ws, crewId);
    if (!task) return null;
    return { task, settings, ev: evaluateTask(task, now, day, cfg.epoch, settings.enabled) };
}

export async function taskHistory(ws: WorkspaceId, crewId: string, now: number) {
    const cfg = WORKSPACES[ws];
    const day = missionDay(now, cfg.epoch);
    const settings = await reminderSettings(ws, crewId);
    const tasks = await db.tasks.where('[ws+crewId]').equals([ws, crewId]).toArray();
    return tasks
        .sort((a, b) => b.missionDay - a.missionDay)
        .map((t) => ({ task: t, ev: evaluateTask(t, now, day, cfg.epoch, settings.enabled) }));
}

export async function snooze(ws: WorkspaceId, crewId: string, now: number): Promise<CheckinTask | null> {
    const t = await todaysTask(ws, crewId, now);
    if (!t || t.ev.state !== 'due') return null;
    const next = snoozeTask(t.task, now, WORKSPACES[ws].epoch);
    if (!next) return null;
    await db.tasks.put(next);
    await syncReminders(ws, crewId, now);
    return next;
}

export async function dismiss(ws: WorkspaceId, crewId: string, now: number): Promise<void> {
    const t = await todaysTask(ws, crewId, now);
    if (t) await db.tasks.put(dismissBanner(t.task));
}

export async function saveReminderSettings(ws: WorkspaceId, crewId: string, settings: ReminderSettings, now: number): Promise<void> {
    const before = await reminderSettings(ws, crewId);
    await kvSet(ws, `reminder:${crewId}`, settings);
    const t = await todaysTask(ws, crewId, now);
    if (t && before.time !== settings.time) await db.tasks.put(rescheduleTask(t.task, WORKSPACES[ws].epoch, settings.time));
    await syncReminders(ws, crewId, now);
}

/* ------------------------------------------------------------------ check-in (M01) */

export const EMPTY_FORM: CheckinForm = {
    sleepHours: '',
    sleepMinutes: '',
    sleepNotRecorded: false,
    sleepConfirmZero: false,
    drowsiness: null,
    drowsinessNotRecorded: false,
    mood: null,
    symptoms: '',
    symptomsComment: '',
    hr: '',
    hrRest: 'yes',
    hrMethod: 'Manual pulse count',
};

export async function saveDraft(ws: WorkspaceId, crewId: string, form: CheckinForm, now: number): Promise<CheckinRecord> {
    const cfg = WORKSPACES[ws];
    const day = missionDay(now, cfg.epoch);
    const existing = await checkinFor(ws, crewId, day);
    if (existing?.status === 'submitted') return existing;
    const row: CheckinRecord = existing
        ? { ...existing, form, savedAt: new Date(now).toISOString() }
        : { id: uuid(), ws, missionId: cfg.missionId, crewId, missionDay: day, status: 'draft', form, observationIds: [], unavailable: [], savedAt: new Date(now).toISOString(), submittedAt: null };
    await db.checkins.put(row);
    return row;
}

export interface SubmitResult {
    checkin: CheckinRecord;
    newAlert: AlertRow | null;
}

/**
 * Saves the check-in in one transaction: observations (with origin, unit, method, quality,
 * timestamps), check-in record, task completion, reminder notification closure and — in the demo
 * only — SLEEP-001 evaluation with the CMO notification.
 */
export async function submitCheckin(ws: WorkspaceId, crewId: string, form: CheckinForm, sleepMinutes: number | null, now: number, answersRequestId: string | null = null): Promise<SubmitResult> {
    const cfg = WORKSPACES[ws];
    const day = missionDay(now, cfg.epoch);
    const iso = new Date(now).toISOString();
    let newAlert: AlertRow | null = null;
    let record!: CheckinRecord;
    await db.transaction('rw', [db.observations, db.checkins, db.tasks, db.notifications, db.alerts, db.kv, db.requests], async () => {
        const base = { missionDay: day, measuredAt: iso, author: crewId, source: 'manual' as const, context: {} };
        const ids: string[] = [];
        const unavailable: string[] = [];
        const sleep = await putObservation(ws, crewId, {
            ...base,
            variable: 'sleep_main',
            value: form.sleepNotRecorded ? null : sleepMinutes,
            unit: 'min',
            method: SLEEP_RULE.method,
            context: { episode: 'main sleep ending this mission day', wakeDay: String(day), zeroConfirmed: form.sleepConfirmZero ? 'yes' : 'no' },
            quality: form.sleepNotRecorded ? 'not-recorded' : 'valid',
        }, iso, true);
        ids.push(sleep.id);
        if (form.sleepNotRecorded) unavailable.push('sleep_main');
        const drowsy = await putObservation(ws, crewId, {
            ...base,
            variable: 'drowsiness',
            value: form.drowsinessNotRecorded ? null : form.drowsiness,
            unit: 'score 1–9',
            method: 'HEXTA drowsiness scale (KSS-inspired)',
            quality: form.drowsinessNotRecorded ? 'not-recorded' : 'valid',
        }, iso, true);
        ids.push(drowsy.id);
        if (form.drowsinessNotRecorded) unavailable.push('drowsiness');
        if (form.mood !== null) ids.push((await putObservation(ws, crewId, { ...base, variable: 'mood', value: form.mood, unit: 'score 1–5', method: 'self-report', quality: 'valid' }, iso, true)).id);
        if (form.symptoms) ids.push((await putObservation(ws, crewId, { ...base, variable: 'symptoms', value: null, text: form.symptoms, comment: form.symptomsComment || undefined, unit: '', method: 'self-report', quality: form.symptoms === 'skip' ? 'not-recorded' : 'valid' }, iso, true)).id);
        if (form.hr.trim() !== '') {
            const v = Number(form.hr.replace(',', '.'));
            ids.push((await putObservation(ws, crewId, { ...base, variable: 'resting_hr', value: v, unit: 'bpm', method: form.hrMethod || 'Manual pulse count', context: { rest: form.hrRest }, quality: form.hrRest === 'yes' ? 'valid' : 'check', qualityNote: form.hrRest === 'yes' ? undefined : 'Rest context not confirmed. Kept out of the resting series.' }, iso, true)).id);
        }
        const existing = await checkinFor(ws, crewId, day);
        record = { id: existing?.id ?? uuid(), ws, missionId: cfg.missionId, crewId, missionDay: day, status: 'submitted', form, observationIds: ids, unavailable, savedAt: iso, submittedAt: iso };
        await db.checkins.put(record);

        const key = `${ws}|${cfg.missionId}|${crewId}|${day}|checkin`;
        const task = await db.tasks.get(key);
        if (task) await db.tasks.update(key, { completedAt: now, snoozedUntil: null });
        const due = await db.notifications.where('eventKey').equals(`${key}|due`).first();
        if (due) await db.notifications.update(due.id, { active: false, readAt: due.readAt ?? iso, body: 'Completed · Saved on this device.' });

        if (answersRequestId) await answerRequestInTx(ws, answersRequestId, crewId, 'New check-in saved.', ids, now);
        newAlert = await evaluateRules(ws, crewId, now);
    });
    void syncCheckin(ws, crewId, day, form, sleepMinutes, record.id, iso).then(() => (answersRequestId ? syncAnswerFor(ws, answersRequestId) : undefined));
    return { checkin: record, newAlert };
}

/** SLEEP-001 runs only where the workspace enables it (the demo). One alert + one CMO notification per episode. */
async function evaluateRules(ws: WorkspaceId, crewId: string, now: number): Promise<AlertRow | null> {
    const cfg = WORKSPACES[ws];
    if (!cfg.rules.includes(SLEEP_RULE.id)) return null;
    const obs = await observationsFor(ws, crewId);
    const episodes = evaluateSleep001(obs, missionDay(now, cfg.epoch));
    let created: AlertRow | null = null;
    const iso = new Date(now).toISOString();
    for (const ep of episodes) {
        const key = episodeKey(ws, cfg.missionId, crewId, ep.startDay);
        const existing = await db.alerts.get(key);
        const evidenceIds = ep.evidence.map((o) => o.id);
        if (existing) {
            if (existing.endDay !== ep.endDay || existing.evidenceIds.join() !== evidenceIds.join()) await db.alerts.update(key, { endDay: ep.endDay, evidenceIds, updatedAt: iso });
            continue;
        }
        const row: AlertRow = { key, ws, missionId: cfg.missionId, crewId, ruleId: ep.ruleId, ruleVersion: ep.ruleVersion, startDay: ep.startDay, endDay: ep.endDay, evidenceIds, createdAt: iso, updatedAt: iso, status: 'needs-review', reviews: [] };
        await db.alerts.add(row);
        const who = memberStatic(ws, crewId);
        const nights = ep.evidence.map((o) => `Day ${o.missionDay} ${Math.floor(o.value! / 60)} h ${String(o.value! % 60).padStart(2, '0')}`).join(' · ');
        await notify({ eventKey: key, ws, recipientId: cfg.cmoId, recipientRole: 'cmo', subjectCrewId: crewId, type: 'sleep-review', title: 'Sleep trend needs review', body: `${who.alias} · Demo rule ${SLEEP_RULE.label} · ${nights}`, link: `/crew/${crewId}?alert=${encodeURIComponent(key)}` }, now);
        created = row;
    }
    return created;
}

export async function alertsFor(ws: WorkspaceId, crewId?: string): Promise<AlertRow[]> {
    const rows = crewId ? await db.alerts.where('[ws+crewId]').equals([ws, crewId]).toArray() : await db.alerts.where('ws').equals(ws).toArray();
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function recordReview(ws: WorkspaceId, alertKey: string, cmoId: string, note: string, followUp: { label: string; measurement: string | null; reason: string } | null, now: number): Promise<void> {
    await db.transaction('rw', [db.alerts, db.requests, db.notifications], async () => {
        const alert = await db.alerts.get(alertKey);
        if (!alert || alert.ws !== ws) return;
        let requestId: string | null = null;
        if (followUp) requestId = (await createFollowUpInTx(ws, alert.crewId, cmoId, followUp.label, followUp.reason, followUp.measurement, { type: 'alert', ids: [alertKey] }, now)).id;
        await db.alerts.update(alertKey, { status: 'reviewed', updatedAt: new Date(now).toISOString(), reviews: [...alert.reviews, { at: new Date(now).toISOString(), byId: cmoId, note, requestId }] });
        const n = await db.notifications.where('eventKey').equals(alertKey).first();
        if (n) await db.notifications.update(n.id, { active: false, readAt: n.readAt ?? new Date(now).toISOString() });
    });
    const reviewed = await db.alerts.get(alertKey);
    if (!reviewed || reviewed.ws !== ws) return;
    const last = reviewed.reviews[reviewed.reviews.length - 1];
    if (last?.requestId && followUp) await syncFollowUp(ws, last.requestId, reviewed.crewId, cmoId, followUp.label, followUp.reason, followUp.measurement);
    void syncAlertReview(ws, reviewed.crewId, reviewed.ruleId, reviewed.startDay, cmoId, note, Boolean(followUp), last?.at ?? new Date(now).toISOString());
}

/* ------------------------------------------------------------------ follow-up (M04) */

async function createFollowUpInTx(ws: WorkspaceId, crewId: string, cmoId: string, label: string, reason: string, measurement: string | null, evidence: RequestRow['evidence'], now: number): Promise<RequestRow> {
    const cfg = WORKSPACES[ws];
    const row: RequestRow = { id: uuid(), ws, missionId: cfg.missionId, crewId, kind: 'follow-up', authorId: cmoId, authorRole: 'cmo', label, reason, evidence, measurement, status: 'open', createdAt: new Date(now).toISOString(), response: null };
    await db.requests.add(row);
    await notify({ eventKey: `request|${row.id}`, ws, recipientId: crewId, recipientRole: 'astronaut', subjectCrewId: crewId, type: 'follow-up-request', title: 'New follow-up request', body: `${memberStatic(ws, cmoId).alias}: ${label}`, link: `/follow-up?request=${row.id}` }, now);
    return row;
}

export async function createFollowUp(ws: WorkspaceId, crewId: string, cmoId: string, label: string, reason: string, measurement: string | null, now: number): Promise<RequestRow> {
    let row!: RequestRow;
    await db.transaction('rw', [db.requests, db.notifications], async () => {
        row = await createFollowUpInTx(ws, crewId, cmoId, label, reason, measurement, { type: 'none', ids: [] }, now);
    });
    void syncFollowUp(ws, row.id, crewId, cmoId, label, reason, measurement);
    return row;
}

/** Astronaut → CMO. Works offline, never triggers SLEEP-001 nor any ground transmission. */
export async function requestReview(ws: WorkspaceId, crewId: string, reason: string, evidenceIds: string[], now: number): Promise<RequestRow> {
    const cfg = WORKSPACES[ws];
    const row: RequestRow = { id: uuid(), ws, missionId: cfg.missionId, crewId, kind: 'review-request', authorId: crewId, authorRole: 'astronaut', label: 'Crew review requested', reason, evidence: { type: evidenceIds.length ? 'observation' : 'none', ids: evidenceIds }, measurement: null, status: 'open', createdAt: new Date(now).toISOString(), response: null };
    await db.transaction('rw', [db.requests, db.notifications], async () => {
        await db.requests.add(row);
        await notify({ eventKey: `review|${row.id}`, ws, recipientId: cfg.cmoId, recipientRole: 'cmo', subjectCrewId: crewId, type: 'review-requested', title: 'Crew review requested', body: `${memberStatic(ws, crewId).alias}: ${reason}`, link: `/crew/${crewId}?request=${row.id}` }, now);
    });
    void syncReviewRequest(ws, row.id, crewId, reason, evidenceIds);
    return row;
}

async function answerRequestInTx(ws: WorkspaceId, requestId: string, authorId: string, text: string, observationIds: string[], now: number): Promise<void> {
    const req = await db.requests.get(requestId);
    if (!req || req.ws !== ws || req.status !== 'open') return;
    const iso = new Date(now).toISOString();
    const response = { id: uuid(), at: iso, authorId, text, observationIds };
    await db.requests.update(requestId, { status: 'answered', response });
    const reqNotif = await db.notifications.where('eventKey').equals(`request|${requestId}`).first();
    if (reqNotif) await db.notifications.update(reqNotif.id, { active: false });
    const reviewNotif = await db.notifications.where('eventKey').equals(`review|${requestId}`).first();
    if (reviewNotif) await db.notifications.update(reviewNotif.id, { active: false });
    if (req.kind === 'follow-up') {
        await notify({ eventKey: `response|${response.id}`, ws, recipientId: req.authorId, recipientRole: 'cmo', subjectCrewId: req.crewId, type: 'follow-up-completed', title: 'Follow-up completed', body: `${memberStatic(ws, req.crewId).alias}: ${text}`, link: `/crew/${req.crewId}?request=${requestId}` }, now);
    }
}

export async function answerRequest(ws: WorkspaceId, requestId: string, authorId: string, text: string, observationIds: string[], now: number): Promise<void> {
    await db.transaction('rw', [db.requests, db.notifications], () => answerRequestInTx(ws, requestId, authorId, text, observationIds, now));
    void syncAnswerFor(ws, requestId);
}

export async function closeRequest(ws: WorkspaceId, requestId: string, now: number): Promise<void> {
    await db.transaction('rw', [db.requests, db.notifications], async () => {
        const row = await db.requests.get(requestId);
        if (!row || row.ws !== ws || row.kind !== 'follow-up' || row.status !== 'answered') return;
        await db.requests.update(requestId, { status: 'closed' });
        const notifications = await db.notifications.where('ws').equals(ws).toArray();
        for (const n of notifications.filter(n => n.link.includes(requestId))) await db.notifications.update(n.id, { active: false, readAt: n.readAt ?? new Date(now).toISOString() });
    });
    const closed = await db.requests.get(requestId);
    if (closed?.status === 'closed') void syncClose(ws, requestId, WORKSPACES[ws].cmoId);
}

export async function requestsFor(ws: WorkspaceId, crewId?: string): Promise<RequestRow[]> {
    const rows = crewId ? await db.requests.where('[ws+crewId]').equals([ws, crewId]).toArray() : await db.requests.where('ws').equals(ws).toArray();
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/* ------------------------------------------------------------------ spot measurements (M16) */

export async function addMeasurement(ws: WorkspaceId, crewId: string, data: NewObs, now: number, answersRequestId: string | null = null): Promise<Observation> {
    let row!: Observation;
    await db.transaction('rw', [db.observations, db.requests, db.notifications], async () => {
        row = await putObservation(ws, crewId, data, new Date(now).toISOString(), false);
        if (answersRequestId) await answerRequestInTx(ws, answersRequestId, crewId, `${data.variable === 'bp' ? 'Blood pressure' : data.variable} measured.`, [row.id], now);
    });
    void syncMeasurement(ws, crewId, row).then(() => (answersRequestId ? syncAnswerFor(ws, answersRequestId) : undefined));
    return row;
}

/* ------------------------------------------------------------------ labs (M12) */

export async function labsFor(ws: WorkspaceId, crewId: string): Promise<LabResult[]> {
    return (await db.labs.where('[ws+crewId]').equals([ws, crewId]).toArray()).sort((a, b) => (b.collectedAt ?? '').localeCompare(a.collectedAt ?? ''));
}

export async function addLab(ws: WorkspaceId, data: Omit<LabResult, 'id' | 'ws' | 'missionId' | 'version' | 'supersededBy' | 'recordedAt' | 'loinc'>, now: number, supersedes: string | null = null): Promise<LabResult> {
    const cfg = WORKSPACES[ws];
    const row: LabResult = { ...data, id: uuid(), ws, missionId: cfg.missionId, loinc: LAB_META[data.analyte].loinc, version: 1, supersededBy: null, recordedAt: new Date(now).toISOString() };
    await db.transaction('rw', db.labs, async () => {
        if (supersedes) {
            const old = await db.labs.get(supersedes);
            if (old) {
                row.version = old.version + 1;
                await db.labs.update(old.id, { supersededBy: row.id });
            }
        }
        await db.labs.add(row);
    });
    void syncLab(ws, row, supersedes);
    return row;
}

/* ------------------------------------------------------------------ reports (M11, M06) */

export async function generateReport(ws: WorkspaceId, crewId: string, fromDay: number, toDay: number, authorId: string, now: number): Promise<ReportRow> {
    const cfg = WORKSPACES[ws];
    const id = uuid();
    const member = memberStatic(ws, crewId);
    const obs = (await currentObservations(ws, crewId)).filter((o) => o.missionDay >= fromDay && o.missionDay <= toDay);
    const allObs = await observationsFor(ws, crewId);
    const labs = (await labsFor(ws, crewId)).filter((l) => !l.supersededBy);
    const dayOf = (iso: string | null) => (iso ? missionDay(Date.parse(iso), cfg.epoch) : null);
    const labsInPeriod = labs.filter((l) => {
        const d = dayOf(l.collectedAt);
        return d !== null && d >= fromDay && d <= toDay;
    });
    const labsToVerify = labs.filter((l) => !l.collectedAt);
    const alerts = (await alertsFor(ws, crewId)).filter((a) => a.endDay >= fromDay && a.startDay <= toDay);
    const reqs = (await requestsFor(ws, crewId)).filter((r) => {
        const d = missionDay(Date.parse(r.createdAt), cfg.epoch);
        return d >= fromDay && d <= toDay;
    });
    const daily: Record<string, { day: number; value: string }[]> = {};
    // one row per variable AND method: diary and actigraphy are never mixed
    const rows: [string, Observation['variable'], (o: Observation) => boolean][] = [
        ['sleep_main', 'sleep_main', (o) => o.method === SLEEP_RULE.method],
        ['sleep_actigraphy', 'sleep_main', (o) => o.method.startsWith('actigraphy')],
        ['drowsiness', 'drowsiness', () => true],
    ];
    for (const [key, v, match] of rows) {
        daily[key] = [];
        for (let d = fromDay; d <= toDay; d++) {
            const o = obs.find((x) => x.variable === v && x.missionDay === d && match(x));
            daily[key].push({ day: d, value: o ? (o.quality === 'not-recorded' ? 'Not recorded' : String(o.value)) : 'Missing' });
        }
    }
    if (daily.sleep_actigraphy.every((c) => c.value === 'Missing')) delete daily.sleep_actigraphy;
    const ref = personalReference(allObs, 122, 135);
    const snapshot = {
        reportId: id,
        schema: 'quinta-report/1',
        simulated: true,
        label: 'Simulated crew data',
        workspace: cfg.label,
        mission: { id: cfg.missionId, name: cfg.missionName, timezone: 'UTC' },
        member: { id: crewId, alias: member.alias, title: member.title },
        period: { fromDay, toDay, days: toDay - fromDay + 1 },
        author: memberStatic(ws, authorId).alias,
        generatedAt: new Date(now).toISOString(),
        generatedAtLabel: utcStamp(now),
        missionDayAtGeneration: missionDay(now, cfg.epoch),
        empty: obs.length === 0 && labsInPeriod.length === 0,
        observations: obs
            .sort((a, b) => a.missionDay - b.missionDay || a.variable.localeCompare(b.variable))
            .map((o) => ({ id: o.id, day: o.missionDay, variable: o.variable, value: o.value, value2: o.value2 ?? null, text: o.text ?? null, comment: o.comment ?? null, unit: o.unit, method: o.method, context: o.context, quality: o.quality, qualityNote: o.qualityNote ?? null, source: o.source, author: o.author, measuredAt: o.measuredAt, version: o.version })),
        dailyGrid: daily,
        personalReference: ref,
        labs: labsInPeriod.map((l) => ({ id: l.id, analyte: l.analyte, value: l.value, unit: l.unit, specimen: l.specimen, method: l.method, lab: l.lab, status: l.status, collectedAt: l.collectedAt, analysedAt: l.analysedAt, issuedAt: l.issuedAt, interval: l.interval, verdict: compareToInterval(l), labFlag: l.labFlag, version: l.version })),
        labsToVerify: labsToVerify.map((l) => ({ id: l.id, analyte: l.analyte, value: l.value, unit: l.unit, note: 'No collection date — kept in the member file for verification.' })),
        rules: cfg.rules.length ? cfg.rules.map((r) => (r === SLEEP_RULE.id ? { id: SLEEP_RULE.id, version: SLEEP_RULE.version, label: 'Demo rule', description: SLEEP_RULE.description } : { id: r })) : [{ id: 'none', label: 'No mission rule configured' }],
        alerts: alerts.map((a) => ({ key: a.key, rule: `${a.ruleId} v${a.ruleVersion}`, startDay: a.startDay, endDay: a.endDay, status: a.status, evidence: a.evidenceIds, reviews: a.reviews.map((r) => ({ at: r.at, by: memberStatic(ws, r.byId).alias, note: r.note })) })),
        followUps: reqs.map((r) => ({ id: r.id, kind: r.kind, label: r.label, reason: r.reason, status: r.status, createdAt: r.createdAt, response: r.response ? { at: r.response.at, text: r.response.text } : null })),
    };
    const content = canonicalJson(snapshot);
    const row: ReportRow = { id, ws, crewId, fromDay, toDay, authorId, createdAt: new Date(now).toISOString(), content, sha256: await sha256Hex(content), queue: { ...EMPTY_QUEUE } };
    await db.reports.add(row);
    return row;
}

export async function reportsFor(ws: WorkspaceId, crewId?: string): Promise<ReportRow[]> {
    const rows = crewId ? await db.reports.where('[ws+crewId]').equals([ws, crewId]).toArray() : await db.reports.where('ws').equals(ws).toArray();
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Queueing is a CMO decision. */
export async function queueReport(ws: WorkspaceId, id: string, receiver: ReceiverId, now: number): Promise<void> {
    const r = await db.reports.get(id);
    if (!r || r.ws !== ws) return;
    await db.reports.update(id, { queue: enqueue(r.queue, receiver, new Date(now).toISOString()) });
}

export async function retryReport(ws: WorkspaceId, id: string): Promise<void> {
    await db.transaction('rw', [db.reports, db.notifications], async () => {
        const r = await db.reports.get(id);
        if (!r || r.ws !== ws) return;
        await db.reports.update(id, { queue: retry(r.queue) });
        const n = await db.notifications.where('eventKey').equals(`retry|${id}|${r.queue.attempts.length}`).first();
        if (n) await db.notifications.update(n.id, { active: false });
    });
}

export interface LinkState {
    groundLink: boolean;
    browserOnline: boolean;
    loseNextReceipt: boolean;
}

/**
 * Processes queued reports. The simulated ground receiver lives in IndexedDB (no Laravel call) and
 * answers only when the simulated ground link is up. The MongoDB Atlas ground receiver (HEXTA API) is a distinct
 * destination reached over the browser network. Only an acknowledgement from the selected
 * receiver marks a report Received; any failure leaves it in the queue with Retry available.
 */
export async function processQueue(ws: WorkspaceId, link: LinkState, now: () => number, fetchImpl: typeof fetch = fetch, onProgress?: () => Promise<void>): Promise<number> {
    const pending = (await reportsFor(ws)).filter((r) => r.queue.state === 'queued');
    let changed = 0;
    for (const r of pending) {
        const receiver = r.queue.receiver!;
        if (receiver === 'simulated-ground' && !link.groundLink) continue;
        if (receiver === 'laravel-test' && !link.browserOnline) continue;
        await db.reports.update(r.id, { queue: startSending(r.queue, new Date(now()).toISOString()) });
        changed++;
        if (onProgress) {
            // let every view show "Sending" from the same source before the receiver answers
            await onProgress();
            await new Promise((resolve) => setTimeout(resolve, 1200));
        }
        let receipt: Receipt | null = null;
        let error = '';
        try {
            receipt = receiver === 'simulated-ground' ? await simulatedReceive(r, now) : await laravelReceive(r, fetchImpl);
            if (receiver === 'simulated-ground' && link.loseNextReceipt) {
                await kvSet(ws, 'loseNextReceipt', false);
                receipt = null;
                error = 'Receipt lost on the simulated ground link';
            }
        } catch (e) {
            error = e instanceof Error ? e.message : 'Network request failed';
        }
        await db.transaction('rw', [db.reports, db.notifications], async () => {
            const cur = (await db.reports.get(r.id))!;
            const at = new Date(now()).toISOString();
            if (receipt) {
                const q = acknowledge(cur.queue, receipt, at);
                await db.reports.update(r.id, { queue: q });
                if (q.state === 'received') {
                    await notify({ eventKey: `received|${r.id}`, ws, recipientId: r.authorId, recipientRole: 'cmo', subjectCrewId: r.crewId, type: 'report-received', title: 'Ground report received', body: `${memberStatic(ws, r.crewId).alias} · Day ${r.fromDay}–${r.toDay} · ${receipt.receiver} · ${utcStamp(Date.parse(receipt.receivedAt))}`, link: `/reports?report=${r.id}`, active: false }, now());
                    await notify({ eventKey: `ground-in|${r.id}`, ws, recipientId: WORKSPACES[ws].groundId, recipientRole: 'ground', subjectCrewId: r.crewId, type: 'report-received', title: 'New report from the crew', body: `${memberStatic(ws, r.crewId).alias} · Day ${r.fromDay}–${r.toDay} · sent by the crew medical officer`, link: `/ground?report=${r.id}` }, now());
                    return;
                }
            }
            const q = fail(cur.queue, at, error || 'No acknowledgement');
            await db.reports.update(r.id, { queue: q });
            await notify({ eventKey: `retry|${r.id}|${q.attempts.length}`, ws, recipientId: r.authorId, recipientRole: 'cmo', subjectCrewId: r.crewId, type: 'report-retry', title: 'Report retry available', body: `${memberStatic(ws, r.crewId).alias} · ${error || 'No acknowledgement'}. Same report ID on retry.`, link: `/reports?report=${r.id}` }, now());
        });
    }
    return changed;
}

async function simulatedReceive(r: ReportRow, now: () => number): Promise<Receipt> {
    const existing = await db.groundSim.get(r.id);
    if (existing) {
        if (existing.sha256 !== r.sha256) throw new Error('409 · different content under the same report ID');
        return { ...existing.receipt, replayed: true };
    }
    const receipt: Receipt = { reportId: r.id, receiptId: uuid(), receiver: RECEIVER_LABEL['simulated-ground'], receivedAt: new Date(now()).toISOString(), sha256: r.sha256, replayed: false };
    await db.groundSim.put({ reportId: r.id, sha256: r.sha256, receipt });
    return receipt;
}

async function laravelReceive(r: ReportRow, fetchImpl: typeof fetch): Promise<Receipt> {
    const res = await fetchImpl(`/api/v1/reports/${r.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ content: r.content }) });
    if (!res.ok) throw new Error(`MongoDB Atlas ground receiver answered ${res.status}`);
    const body = (await res.json()) as Receipt;
    if (body.reportId !== r.id || body.sha256 !== r.sha256) throw new Error('Receipt does not match the report');
    return body;
}

/* ------------------------------------------------------------------ report a symptom */

export interface PhotoInput {
    name: string;
    mime: string;
    data: ArrayBuffer;
    simulated?: boolean;
}

/** The single open draft of a crew member, if any. */
export async function symptomDraft(ws: WorkspaceId, crewId: string): Promise<SymptomReport | undefined> {
    return (await db.symptomReports.where('[ws+crewId]').equals([ws, crewId]).toArray()).find((r) => r.status === 'draft');
}

export async function symptomReportsFor(ws: WorkspaceId, crewId: string): Promise<SymptomReport[]> {
    const rows = await db.symptomReports.where('[ws+crewId]').equals([ws, crewId]).toArray();
    return rows.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function symptomReport(ws: WorkspaceId, id: string): Promise<SymptomReport | undefined> {
    const r = await db.symptomReports.get(id);
    return r && r.ws === ws ? r : undefined;
}

/** Bytes of a photo, only for the workspace and crew member it belongs to. */
export async function symptomAttachment(ws: WorkspaceId, crewId: string, id: string): Promise<SymptomAttachment | undefined> {
    const a = await db.attachments.get(id);
    return a && a.ws === ws && a.crewId === crewId ? a : undefined;
}

export async function symptomThread(ws: WorkspaceId, reportId: string): Promise<SymptomReviewEntry[]> {
    const rows = await db.symptomReviews.where('reportId').equals(reportId).toArray();
    return rows.filter((r) => r.ws === ws).sort((a, b) => a.seq - b.seq);
}

/**
 * Writes the draft on this device (text and, when given, the photo) in one transaction.
 * `photo`: a new image replaces the previous one, `null` removes it, `undefined` keeps it.
 */
export async function saveSymptomDraft(ws: WorkspaceId, crewId: string, input: SymptomInput, photo: PhotoInput | null | undefined, now: number): Promise<SymptomReport> {
    const cfg = WORKSPACES[ws];
    const iso = new Date(now).toISOString();
    let row!: SymptomReport;
    await db.transaction('rw', [db.symptomReports, db.attachments], async () => {
        const existing = await symptomDraft(ws, crewId);
        row = existing
            ? { ...existing, ...input, savedAt: iso }
            : { id: uuid(), ws, missionId: cfg.missionId, crewId, status: 'draft', ...input, attachmentId: null, createdAt: iso, savedAt: iso, submittedAt: null, reviewedAt: null };
        if (photo !== undefined && row.attachmentId) {
            await db.attachments.delete(row.attachmentId);
            row.attachmentId = null;
        }
        if (photo) {
            const att: SymptomAttachment = { id: uuid(), ws, crewId, reportId: row.id, name: photo.name, mime: photo.mime, size: photo.data.byteLength, data: photo.data, simulated: !!photo.simulated, createdAt: iso };
            await db.attachments.add(att);
            row.attachmentId = att.id;
        }
        await db.symptomReports.put(row);
    });
    return row;
}

export async function discardSymptomDraft(ws: WorkspaceId, crewId: string): Promise<void> {
    await db.transaction('rw', [db.symptomReports, db.attachments], async () => {
        const d = await symptomDraft(ws, crewId);
        if (!d) return;
        if (d.attachmentId) await db.attachments.delete(d.attachmentId);
        await db.symptomReports.delete(d.id);
    });
}

/**
 * Makes the draft available in the on-board console of the same workspace and notifies the CMO.
 * This is an on-board step only: nothing is queued for or sent to the ground.
 */
export async function submitSymptomReport(ws: WorkspaceId, crewId: string, now: number): Promise<SymptomReport | null> {
    const cfg = WORKSPACES[ws];
    const iso = new Date(now).toISOString();
    let row: SymptomReport | null = null;
    await db.transaction('rw', [db.symptomReports, db.notifications], async () => {
        const d = await symptomDraft(ws, crewId);
        if (!d) return;
        row = { ...d, status: 'submitted', savedAt: iso, submittedAt: iso };
        await db.symptomReports.put(row);
        await notify({ eventKey: `symptom|${d.id}`, ws, recipientId: cfg.cmoId, recipientRole: 'cmo', subjectCrewId: crewId, type: 'symptom-submitted', title: 'Symptom report to review', body: `${memberStatic(ws, crewId).alias} · ${d.bodyArea} · ${d.attachmentId ? 'with photo' : 'description only'}`, link: `/crew/${crewId}?symptom=${d.id}#symptoms` }, now);
    });
    return row;
}

/** CMO: add a note, ask for more information, or complete the review. The crew member is notified on board. */
export async function reviewSymptomReport(ws: WorkspaceId, reportId: string, cmoId: string, kind: Exclude<ReviewKind, 'reply'>, text: string, now: number): Promise<SymptomReviewEntry | null> {
    const iso = new Date(now).toISOString();
    let entry: SymptomReviewEntry | null = null;
    await db.transaction('rw', [db.symptomReports, db.symptomReviews, db.notifications], async () => {
        const r = await db.symptomReports.get(reportId);
        if (!r || r.ws !== ws || r.status === 'draft') return;
        entry = { id: uuid(), ws, reportId, crewId: r.crewId, kind, authorId: cmoId, authorRole: 'cmo', text, at: iso, seq: await db.symptomReviews.where('reportId').equals(reportId).count() };
        await db.symptomReviews.add(entry);
        if (kind === 'completed') await db.symptomReports.update(reportId, { status: 'reviewed', reviewedAt: iso });
        // the open "to review" item closes once the CMO has answered; a reply from the crew reopens one
        for (const key of [`symptom|${reportId}`, ...(await db.notifications.where('ws').equals(ws).toArray()).filter((n) => n.type === 'symptom-reply' && n.link.includes(reportId)).map((n) => n.eventKey)]) {
            const n = await db.notifications.where('eventKey').equals(key).first();
            if (n && n.active) await db.notifications.update(n.id, { active: false, readAt: n.readAt ?? iso });
        }
        const who = memberStatic(ws, cmoId).alias;
        await notify(
            {
                eventKey: `symptom-review|${entry.id}`,
                ws,
                recipientId: r.crewId,
                recipientRole: 'astronaut',
                subjectCrewId: r.crewId,
                type: kind === 'more-info' ? 'symptom-more-info' : 'symptom-feedback',
                title: kind === 'more-info' ? 'More information requested' : kind === 'completed' ? 'Symptom report reviewed' : 'Note on your symptom report',
                body: `${who}: ${text}`,
                link: `/follow-up?symptom=${reportId}#symptoms`,
                active: kind === 'more-info',
            },
            now,
        );
    });
    return entry;
}

/** Crew member answers a request for more information. */
export async function replySymptomReport(ws: WorkspaceId, reportId: string, crewId: string, text: string, now: number): Promise<SymptomReviewEntry | null> {
    const cfg = WORKSPACES[ws];
    const iso = new Date(now).toISOString();
    let entry: SymptomReviewEntry | null = null;
    await db.transaction('rw', [db.symptomReports, db.symptomReviews, db.notifications], async () => {
        const r = await db.symptomReports.get(reportId);
        if (!r || r.ws !== ws || r.crewId !== crewId || r.status === 'draft') return;
        const thread = (await db.symptomReviews.where('reportId').equals(reportId).toArray()).filter((e) => e.ws === ws);
        entry = { id: uuid(), ws, reportId, crewId, kind: 'reply', authorId: crewId, authorRole: 'astronaut', text, at: iso, seq: thread.length };
        await db.symptomReviews.add(entry);
        for (const e of thread.filter((x) => x.kind === 'more-info')) {
            const n = await db.notifications.where('eventKey').equals(`symptom-review|${e.id}`).first();
            if (n && n.active) await db.notifications.update(n.id, { active: false, readAt: n.readAt ?? iso });
        }
        if (awaitingReply(thread) || r.status === 'submitted') {
            await notify({ eventKey: `symptom-reply|${entry.id}`, ws, recipientId: cfg.cmoId, recipientRole: 'cmo', subjectCrewId: crewId, type: 'symptom-reply', title: 'Reply on a symptom report', body: `${memberStatic(ws, crewId).alias}: ${text}`, link: `/crew/${crewId}?symptom=${reportId}#symptoms` }, now);
        }
    });
    return entry;
}

/* ------------------------------------------------------------------ helpers for views */

/* ------------------------------------------------------------------ ground (Houston) */

/** Reports the ground actually holds: only those with a receipt. Everything else stays on board. */
export async function receivedReports(ws: WorkspaceId): Promise<ReportRow[]> {
    return (await reportsFor(ws)).filter((r) => r.queue.state === 'received' && r.queue.receipt).sort((a, b) => b.queue.receipt!.receivedAt.localeCompare(a.queue.receipt!.receivedAt));
}

export async function groundNotes(ws: WorkspaceId): Promise<GroundNoteRow[]> {
    return (await db.groundNotes.where('ws').equals(ws).toArray()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function addGroundNote(ws: WorkspaceId, authorId: string, text: string, reportId: string | null, now: number): Promise<GroundNoteRow> {
    const report = reportId ? await db.reports.get(reportId) : undefined;
    const row: GroundNoteRow = { id: uuid(), ws, authorId, reportId: report?.id ?? null, crewId: report?.crewId ?? null, text, createdAt: new Date(now).toISOString(), deliveredAt: null };
    await db.groundNotes.put(row);
    return row;
}

/** Store-and-forward uplink: called when the simulated ground link is up. Returns how many notes reached the crew. */
export async function deliverGroundNotes(ws: WorkspaceId, now: number): Promise<number> {
    const waiting = (await db.groundNotes.where('ws').equals(ws).toArray()).filter((n) => !n.deliveredAt);
    const cfg = WORKSPACES[ws];
    for (const n of waiting) {
        const at = new Date(now).toISOString();
        await db.groundNotes.update(n.id, { deliveredAt: at });
        const author = memberStatic(ws, n.authorId).alias;
        await notify({ eventKey: `ground-note|${n.id}`, ws, recipientId: cfg.cmoId, recipientRole: 'cmo', subjectCrewId: n.crewId ?? cfg.astronautId, type: 'ground-note', title: `Note from Houston · ${author}`, body: n.text.length > 120 ? `${n.text.slice(0, 117)}…` : n.text, link: '/crew#houston' }, now);
    }
    return waiting.length;
}

export type { NotificationType, Role };
