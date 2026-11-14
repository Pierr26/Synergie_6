export type WorkspaceId = 'demo' | 'explore';
export type Role = 'astronaut' | 'cmo';

/** valid: usable · check: kept but needs verification · not-recorded: explicit absence · invalid: excluded */
export type Quality = 'valid' | 'check' | 'not-recorded' | 'invalid';

export type Variable =
    | 'sleep_main'
    | 'drowsiness'
    | 'mood'
    | 'symptoms'
    | 'resting_hr'
    | 'bp'
    | 'spo2'
    | 'temperature'
    | 'glucose';

export interface Observation {
    id: string;
    ws: WorkspaceId;
    missionId: string;
    crewId: string;
    missionDay: number;
    variable: Variable;
    /** null = no value (explicit absence or unknown) — never imputed as 0 */
    value: number | null;
    /** second value of a pair (diastolic) */
    value2?: number | null;
    /** free text answer, e.g. symptoms yes/no/skip */
    text?: string;
    comment?: string;
    unit: string;
    method: string;
    context: Record<string, string>;
    quality: Quality;
    qualityNote?: string;
    author: string;
    /** where the record comes from: manual entry, versioned demo dataset, simulated sensor */
    source: 'manual' | 'demo-dataset' | 'example' | 'simulated-sensor';
    measuredAt: string;
    recordedAt: string;
    version: number;
    supersededBy: string | null;
    checkinId?: string;
    requestId?: string;
}

export interface Member {
    ws: WorkspaceId;
    id: string;
    alias: string;
    shortName: string;
    initials: string;
    role: Role;
    title: string;
}

export interface WorkspaceConfig {
    id: WorkspaceId;
    label: string;
    missionId: string;
    missionName: string;
    /** UTC midnight of mission day 1 */
    epoch: string;
    timezone: 'UTC';
    /** mission rules enabled in this workspace */
    rules: string[];
    astronautId: string;
    cmoId: string;
    simulatedClock: boolean;
}
