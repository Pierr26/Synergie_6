import Dexie, { type Table } from 'dexie';
import type { LabResult } from '../domain/labs';
import type { QueueInfo, Receipt } from '../domain/queue';
import type { CheckinTask } from '../domain/reminder';
import type { SymptomAttachment, SymptomReport, SymptomReviewEntry } from '../domain/symptoms';
import type { Member, Observation, Role, WorkspaceId } from '../domain/types';

export interface KvRow {
    ws: WorkspaceId | 'global';
    key: string;
    value: unknown;
}

export interface CheckinForm {
    sleepHours: string;
    sleepMinutes: string;
    sleepNotRecorded: boolean;
    sleepConfirmZero: boolean;
    drowsiness: number | null;
    drowsinessNotRecorded: boolean;
    mood: number | null;
    symptoms: 'yes' | 'no' | 'skip' | '';
    symptomsComment: string;
    hr: string;
    hrRest: 'yes' | 'no' | 'unknown';
    hrMethod: string;
}

export interface CheckinRecord {
    id: string;
    ws: WorkspaceId;
    missionId: string;
    crewId: string;
    missionDay: number;
    status: 'draft' | 'submitted';
    form: CheckinForm;
    observationIds: string[];
    unavailable: string[];
    savedAt: string;
    submittedAt: string | null;
}

export type NotificationType =
    | 'checkin-due'
    | 'follow-up-request'
    | 'review-requested'
    | 'follow-up-completed'
    | 'sleep-review'
    | 'report-received'
    | 'report-retry'
    | 'symptom-submitted'
    | 'symptom-reply'
    | 'symptom-more-info'
    | 'symptom-feedback';

export interface NotificationRow {
    id: string;
    /** unique event key: one entry per event (idempotent re-creation) */
    eventKey: string;
    ws: WorkspaceId;
    recipientId: string;
    recipientRole: Role;
    subjectCrewId: string;
    type: NotificationType;
    title: string;
    body: string;
    link: string;
    createdAt: string;
    readAt: string | null;
    /** true while the related action is still open (task due, request open, retry pending) */
    active: boolean;
}

export interface RequestRow {
    id: string;
    ws: WorkspaceId;
    missionId: string;
    crewId: string;
    kind: 'review-request' | 'follow-up';
    authorId: string;
    authorRole: Role;
    label: string;
    reason: string;
    evidence: { type: 'observation' | 'alert' | 'none'; ids: string[] };
    measurement: string | null;
    status: 'open' | 'answered' | 'closed';
    createdAt: string;
    response: { id: string; at: string; authorId: string; text: string; observationIds: string[] } | null;
}

export interface AlertRow {
    key: string;
    ws: WorkspaceId;
    missionId: string;
    crewId: string;
    ruleId: string;
    ruleVersion: number;
    startDay: number;
    endDay: number;
    evidenceIds: string[];
    createdAt: string;
    updatedAt: string;
    status: 'needs-review' | 'reviewed';
    reviews: { at: string; byId: string; note: string; requestId: string | null }[];
}

export interface ReportRow {
    id: string;
    ws: WorkspaceId;
    crewId: string;
    fromDay: number;
    toDay: number;
    authorId: string;
    createdAt: string;
    /** frozen canonical JSON of the snapshot — never regenerated */
    content: string;
    sha256: string;
    queue: QueueInfo;
}

export interface GroundSimRow {
    reportId: string;
    sha256: string;
    receipt: Receipt;
}

export class QuintaDb extends Dexie {
    kv!: Table<KvRow, [string, string]>;
    members!: Table<Member, [string, string]>;
    observations!: Table<Observation, string>;
    checkins!: Table<CheckinRecord, string>;
    tasks!: Table<CheckinTask, string>;
    notifications!: Table<NotificationRow, string>;
    requests!: Table<RequestRow, string>;
    alerts!: Table<AlertRow, string>;
    labs!: Table<LabResult, string>;
    reports!: Table<ReportRow, string>;
    groundSim!: Table<GroundSimRow, string>;
    symptomReports!: Table<SymptomReport, string>;
    attachments!: Table<SymptomAttachment, string>;
    symptomReviews!: Table<SymptomReviewEntry, string>;

    constructor(name = 'quinta') {
        super(name);
        this.version(1).stores({
            kv: '[ws+key], ws',
            members: '[ws+id], ws',
            observations: 'id, ws, [ws+crewId], [ws+crewId+variable], [ws+crewId+missionDay]',
            checkins: 'id, ws, [ws+crewId+missionDay]',
            tasks: 'key, ws, [ws+crewId]',
            notifications: 'id, &eventKey, ws, [ws+recipientId]',
            requests: 'id, ws, [ws+crewId]',
            alerts: 'key, ws, [ws+crewId]',
            labs: 'id, ws, [ws+crewId]',
            reports: 'id, ws, [ws+crewId]',
            groundSim: 'reportId',
        });
        // v2: "Report a symptom" — capture (report + photo) and review thread in separate tables
        this.version(2).stores({
            symptomReports: 'id, ws, [ws+crewId]',
            attachments: 'id, ws, reportId',
            symptomReviews: 'id, ws, reportId',
        });
    }
}

export let db = new QuintaDb();

/** tests only */
export function useDatabase(instance: QuintaDb): void {
    db = instance;
}

export const WS_TABLES = ['kv', 'members', 'observations', 'checkins', 'tasks', 'notifications', 'requests', 'alerts', 'labs', 'reports', 'symptomReports', 'attachments', 'symptomReviews'] as const;

export function uuid(): string {
    return crypto.randomUUID();
}
