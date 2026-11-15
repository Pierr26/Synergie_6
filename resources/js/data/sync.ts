/**
 * Background sync with the HEXTA API (Laravel + MongoDB).
 *
 * The app stays offline-first: every record is written to IndexedDB first, exactly as before.
 * After a local write, a job is added to a persistent outbox (IndexedDB, kv table) and sent to the
 * API when the browser is online. Jobs keep their order, carry the client-generated IDs (so a
 * re-send is idempotent on the server) and are retried on the next `online` event or timer tick.
 * A job the server rejects as invalid (4xx) is dropped and logged; it never blocks the queue.
 */
import type { CheckinForm } from './db';
import { db } from './db';
import type { LabResult } from '../domain/labs';
import type { Observation, WorkspaceId } from '../domain/types';

export interface SyncJob {
    id: string;
    method: 'PUT' | 'POST';
    path: string;
    body: unknown;
    actor: string;
    ws: WorkspaceId;
    createdAt: string;
    attempts: number;
    lastError?: string;
}

export interface SyncStatus {
    pending: number;
    lastSyncedAt: string | null;
    lastError: string | null;
}

const OUTBOX = 'hexta-sync-outbox';
const STATUS = 'hexta-sync-status';
const API = '/api/v1';
const RETRY_MS = 30_000;

const disabled = (): boolean => import.meta.env?.MODE === 'test' || typeof fetch === 'undefined';

async function readOutbox(): Promise<SyncJob[]> {
    return ((await db.kv.get(['global', OUTBOX]))?.value as SyncJob[] | undefined) ?? [];
}

async function writeOutbox(jobs: SyncJob[]): Promise<void> {
    await db.kv.put({ ws: 'global', key: OUTBOX, value: jobs });
}

async function writeStatus(patch: Partial<SyncStatus>): Promise<void> {
    const current = ((await db.kv.get(['global', STATUS]))?.value as SyncStatus | undefined) ?? { pending: 0, lastSyncedAt: null, lastError: null };
    await db.kv.put({ ws: 'global', key: STATUS, value: { ...current, ...patch } });
}

export async function syncStatus(): Promise<SyncStatus> {
    const status = ((await db.kv.get(['global', STATUS]))?.value as SyncStatus | undefined) ?? { pending: 0, lastSyncedAt: null, lastError: null };
    return { ...status, pending: (await readOutbox()).length };
}

/** Adds a job (ignored if the same id is already waiting) and tries to send right away. */
export async function enqueue(job: Omit<SyncJob, 'createdAt' | 'attempts'>, replaces?: (existing: SyncJob) => boolean): Promise<void> {
    if (disabled()) return;
    let jobs = await readOutbox();
    if (replaces) jobs = jobs.filter((existing) => !replaces(existing));
    if (!jobs.some((existing) => existing.id === job.id)) jobs.push({ ...job, createdAt: new Date().toISOString(), attempts: 0 });
    await writeOutbox(jobs);
    void flush();
}

let flushing: Promise<number> | null = null;

/** Sends waiting jobs in order. Stops at the first network or server error and keeps the rest. */
export function flush(fetchImpl: typeof fetch = fetch): Promise<number> {
    if (disabled()) return Promise.resolve(0);
    if (flushing) return flushing;
    flushing = (async () => {
        let sent = 0;
        let jobs = await readOutbox();
        while (jobs.length > 0) {
            const job = jobs[0];
            let response: Response | null = null;
            try {
                response = await fetchImpl(API + job.path, {
                    method: job.method,
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Hexta-Actor': job.actor },
                    body: JSON.stringify(job.body),
                });
            } catch (error) {
                job.attempts++;
                job.lastError = error instanceof Error ? error.message : 'Network error';
                await writeOutbox(jobs);
                await writeStatus({ lastError: job.lastError });
                break;
            }
            const retryable = response.status >= 500 || response.status === 408 || response.status === 429;
            if (retryable) {
                job.attempts++;
                job.lastError = `HEXTA API answered ${response.status}`;
                await writeOutbox(jobs);
                await writeStatus({ lastError: job.lastError });
                break;
            }
            if (!response.ok && response.status !== 409) {
                const detail = await response.text().catch(() => '');
                console.warn(`[HEXTA sync] ${job.method} ${job.path} rejected (${response.status}); dropped.`, detail.slice(0, 300));
                await writeStatus({ lastError: `${job.path} rejected (${response.status})` });
            } else {
                sent++;
            }
            jobs = jobs.slice(1);
            await writeOutbox(jobs);
            await writeStatus({ lastSyncedAt: new Date().toISOString(), lastError: response.ok || response.status === 409 ? null : undefined });
        }
        return sent;
    })().finally(() => {
        flushing = null;
    });
    return flushing;
}

/** Starts the retry loop once, in the browser only. */
export function startSync(): void {
    if (disabled() || typeof window === 'undefined') return;
    window.addEventListener('online', () => void flush());
    window.setInterval(() => {
        if (navigator.onLine) void flush();
    }, RETRY_MS);
    void flush();
}

/* ------------------------------------------------------------------ mapping to the API */

const crewPath = (ws: WorkspaceId, crewId: string): string => `/workspaces/${ws}/crew/${crewId}`;

export function syncCheckin(ws: WorkspaceId, crewId: string, day: number, form: CheckinForm, sleepMinutes: number | null, recordId: string, savedAt: string): Promise<void> {
    const hr = form.hr.trim();
    const body: Record<string, unknown> = {
        status: 'submitted',
        submittedBy: crewId,
        recordedAt: savedAt,
        sleep: form.sleepNotRecorded || sleepMinutes === null
            ? { status: 'not_recorded' }
            : { status: 'recorded', minutes: Math.round(sleepMinutes), zeroConfirmed: form.sleepConfirmZero },
        sleepiness: form.drowsinessNotRecorded || form.drowsiness === null
            ? { status: 'not_recorded' }
            : { status: 'recorded', value: form.drowsiness },
    };
    if (form.mood !== null) body.mood = { status: 'recorded', value: form.mood };
    if (form.symptoms) body.symptoms = { answer: form.symptoms, comment: form.symptomsComment || null };
    if (hr !== '' && Number.isFinite(Number(hr.replace(',', '.')))) {
        body.restingHeartRate = {
            status: 'recorded',
            value: Number(hr.replace(',', '.')),
            method: form.hrMethod || 'Manual pulse count',
            atRest: form.hrRest === 'yes' ? true : form.hrRest === 'no' ? false : null,
        };
    }
    return enqueue({ id: `checkin|${recordId}|${savedAt}`, method: 'PUT', path: `${crewPath(ws, crewId)}/checkins/${day}`, body, actor: crewId, ws });
}

const POSTURES = ['seated', 'supine', 'standing', 'restrained'] as const;

function measurementBody(o: Observation): Record<string, unknown> | null {
    const c = o.context;
    const context: Record<string, unknown> = {};
    if (c.rest) context.atRest = c.rest.startsWith('5 min') ? true : c.rest === 'unknown' ? null : false;
    if (c.posture) context.posture = POSTURES.find((p) => c.posture.toLowerCase().includes(p.slice(0, 7))) ?? 'unknown';
    if (c.signal) context.signalQuality = ['good', 'fair', 'insufficient'].includes(c.signal) ? c.signal : 'unknown';
    if (c.supplementalO2 && c.supplementalO2 !== 'unknown') context.supplementalOxygen = c.supplementalO2 === 'yes';
    if (c.site) context.site = ['oral', 'skin', 'tympanic', 'axillary', 'forehead', 'rectal'].includes(c.site) ? c.site : 'unknown';
    if (c.sample) context.specimen = ['capillary', 'plasma', 'interstitial'].includes(c.sample) ? c.sample : 'unknown';
    if (c.meal) context.context = c.meal === 'fasting' ? 'fasting' : c.meal === 'after meal' ? 'post_meal' : 'unknown';
    if (o.comment) context.note = o.comment.slice(0, 500);

    const base = { observationId: o.id, recordedBy: o.author, method: o.method || 'manual entry', observedAt: o.measuredAt, context };
    switch (o.variable) {
        case 'bp':
            return { ...base, variable: 'blood_pressure', value: { systolic: o.value, diastolic: o.value2 }, unit: 'mmHg' };
        case 'spo2':
            return { ...base, variable: 'spo2', value: o.value, unit: '%' };
        case 'temperature':
            return { ...base, variable: 'temperature', value: o.value, unit: 'Cel' };
        case 'glucose':
            return { ...base, variable: 'glucose', value: o.value, unit: o.unit };
        case 'resting_hr':
            return { ...base, variable: 'resting_heart_rate', value: o.value, unit: 'bpm' };
        default:
            return null;
    }
}

export function syncMeasurement(ws: WorkspaceId, crewId: string, o: Observation): Promise<void> {
    const body = measurementBody(o);
    if (!body || o.value === null) return Promise.resolve();
    return enqueue({ id: `observation|${o.id}`, method: 'POST', path: `${crewPath(ws, crewId)}/observations`, body, actor: o.author, ws });
}

const ANALYTE: Record<LabResult['analyte'], string> = { Hb: 'hemoglobin', Hct: 'hematocrit' };

export async function syncLab(ws: WorkspaceId, lab: LabResult, supersedes: string | null): Promise<void> {
    const lineageKey = 'hexta-lab-lineage';
    const lineages = ((await db.kv.get(['global', lineageKey]))?.value as Record<string, string> | undefined) ?? {};
    const lineage = supersedes ? lineages[supersedes] ?? supersedes : lab.id;
    await db.kv.put({ ws: 'global', key: lineageKey, value: { ...lineages, [lab.id]: lineage } });

    if (supersedes) {
        return enqueue({
            id: `lab-version|${lab.id}`, method: 'POST', path: `/workspaces/${ws}/lab-results/${lineage}/versions`,
            body: { correctedBy: lab.author, reason: 'Corrected in the crew medical console', value: lab.value, unit: lab.unit },
            actor: lab.author, ws,
        });
    }
    const body: Record<string, unknown> = {
        resultId: lab.id,
        enteredBy: lab.author,
        analyte: ANALYTE[lab.analyte],
        value: lab.value,
        unit: lab.unit,
        specimen: lab.specimen || null,
        method: lab.method || null,
        laboratory: lab.lab || null,
        collectedAt: lab.collectedAt,
        analyzedAt: lab.analysedAt,
        issuedAt: lab.issuedAt,
        status: lab.status === 'unverified' ? 'preliminary' : lab.status,
        labFlag: lab.labFlag,
    };
    if (lab.interval) body.interval = { low: lab.interval.low, high: lab.interval.high, unit: lab.interval.unit, source: lab.interval.source || 'Entered by the CMO', population: lab.interval.population || null };
    return enqueue({ id: `lab|${lab.id}`, method: 'POST', path: `${crewPath(ws, lab.crewId)}/lab-results`, body, actor: lab.author, ws });
}

export function syncFollowUp(ws: WorkspaceId, requestId: string, crewId: string, cmoId: string, label: string, reason: string, measurement: string | null): Promise<void> {
    return enqueue({
        id: `follow-up|${requestId}`, method: 'POST', path: `/workspaces/${ws}/follow-ups`,
        body: {
            clientRequestId: requestId, type: 'follow_up_request', authorId: cmoId, subjectId: crewId,
            reason: [label, reason].filter(Boolean).join(': ').slice(0, 1000),
            requested: measurement ? { kind: 'measurement', variable: measurement.slice(0, 40), label: label.slice(0, 200) } : { kind: 'checkin', label: label.slice(0, 200) },
        },
        actor: cmoId, ws,
    });
}

export function syncReviewRequest(ws: WorkspaceId, requestId: string, crewId: string, reason: string, evidenceIds: string[]): Promise<void> {
    return enqueue({
        id: `review-request|${requestId}`, method: 'POST', path: `/workspaces/${ws}/follow-ups`,
        body: { clientRequestId: requestId, type: 'review_request', authorId: crewId, subjectId: crewId, reason: reason.slice(0, 1000), evidence: evidenceIds[0] ? { observationId: evidenceIds[0] } : null },
        actor: crewId, ws,
    });
}

export function syncAnswer(ws: WorkspaceId, requestId: string, responseId: string, authorId: string, text: string, observationIds: string[]): Promise<void> {
    return enqueue({
        id: `answer|${responseId}`, method: 'POST', path: `/workspaces/${ws}/follow-ups/${requestId}/responses`,
        body: { responseId, responderId: authorId, message: text.slice(0, 1000) || 'Answered.', observationIds: observationIds.slice(0, 20) },
        actor: authorId, ws,
    });
}

export function syncClose(ws: WorkspaceId, requestId: string, cmoId: string): Promise<void> {
    return enqueue({ id: `close|${requestId}`, method: 'POST', path: `/workspaces/${ws}/follow-ups/${requestId}/close`, body: { cmoId }, actor: cmoId, ws });
}

export function syncAlertReview(ws: WorkspaceId, crewId: string, ruleId: string, startDay: number, cmoId: string, note: string, followUpRequested: boolean, at: string): Promise<void> {
    return enqueue({
        id: `alert-review|${ws}|${crewId}|${startDay}|${at}`, method: 'POST', path: `/workspaces/${ws}/alerts/alert-${ws}-${crewId}-${ruleId}-J${startDay}/reviews`,
        body: { cmoId, note: note.trim() || 'Reviewed by the crew medical officer.', decision: followUpRequested ? 'follow_up_requested' : 'reviewed' },
        actor: cmoId, ws,
    });
}

/** The controlled demo clock: only the latest position matters. */
export function syncDemoClock(ts: number): Promise<void> {
    return enqueue(
        { id: `clock|${ts}`, method: 'POST', path: '/workspaces/demo/clock', body: { at: new Date(ts).toISOString() }, actor: 'demo-clock', ws: 'demo' },
        (existing) => existing.path === '/workspaces/demo/clock',
    );
}

/** Demo reset: waiting demo jobs are obsolete, the server workspace restarts on the same scenario day. */
export function syncDemoReset(scenario: 138 | 142): Promise<void> {
    return enqueue(
        { id: `reset|${scenario}|${Date.now()}`, method: 'POST', path: '/workspaces/demo/reset', body: { scenario }, actor: 'demo-reset', ws: 'demo' },
        (existing) => existing.ws === 'demo',
    );
}
