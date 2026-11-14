import type { Observation, Variable } from './types';

export const SLEEP_RULE = {
    id: 'SLEEP-001',
    version: 1,
    label: 'SLEEP-001 v1',
    thresholdMin: 360,
    nights: 3,
    method: 'sleep-diary',
    description: 'Three consecutive mission days with a valid sleep-diary entry strictly below 360 min.',
} as const;

export interface SleepEpisode {
    ruleId: string;
    ruleVersion: number;
    startDay: number;
    endDay: number;
    evidence: Observation[];
}

/** Latest non-superseded observation per mission day, for one variable and one method. */
export function effectiveDaily(observations: Observation[], variable: Variable, method: string): Map<number, Observation> {
    const byDay = new Map<number, Observation>();
    for (const o of observations) {
        if (o.variable !== variable || o.method !== method || o.supersededBy) continue;
        const prev = byDay.get(o.missionDay);
        if (!prev || o.version > prev.version || (o.version === prev.version && o.recordedAt > prev.recordedAt)) {
            byDay.set(o.missionDay, o);
        }
    }
    return byDay;
}

/** A night counts toward SLEEP-001 only if it is a valid diary value strictly below the threshold. */
export function countsTowardSleepRule(o: Observation | undefined): boolean {
    return !!o && o.quality === 'valid' && typeof o.value === 'number' && Number.isFinite(o.value) && o.value < SLEEP_RULE.thresholdMin;
}

/**
 * SLEEP-001 v1. Runs of >= 3 consecutive mission days whose effective diary entry is valid and < 360 min.
 * A value of 360, a missing day, a non-valid entry or a sensor-only day breaks the run.
 * One episode per run: a fourth qualifying night extends the same episode (same startDay → same key).
 */
export function evaluateSleep001(observations: Observation[], uptoDay: number): SleepEpisode[] {
    const daily = effectiveDaily(observations, 'sleep_main', SLEEP_RULE.method);
    if (daily.size === 0) return [];
    const days = [...daily.keys()].filter((d) => d <= uptoDay);
    if (days.length === 0) return [];
    const first = Math.min(...days);
    const episodes: SleepEpisode[] = [];
    let run: Observation[] = [];
    const close = () => {
        if (run.length >= SLEEP_RULE.nights) {
            episodes.push({
                ruleId: SLEEP_RULE.id,
                ruleVersion: SLEEP_RULE.version,
                startDay: run[0].missionDay,
                endDay: run[run.length - 1].missionDay,
                evidence: [...run],
            });
        }
        run = [];
    };
    for (let d = first; d <= uptoDay; d++) {
        const o = daily.get(d);
        if (countsTowardSleepRule(o)) run.push(o!);
        else close();
    }
    close();
    return episodes;
}

/**
 * Mockup colour code for a sleep-diary night: green from 7 h, amber between 6 h and 7 h, coral under 6 h.
 * Demo zones only (same 6 h bound as the demo rule), never a clinical threshold.
 */
export type Zone = 'ok' | 'wt' | 'al';
export function sleepZone(minutes: number | null | undefined): Zone | null {
    if (minutes === null || minutes === undefined) return null;
    return minutes < SLEEP_RULE.thresholdMin ? 'al' : minutes < 420 ? 'wt' : 'ok';
}

export function episodeKey(ws: string, missionId: string, crewId: string, startDay: number): string {
    return `${ws}|${missionId}|${crewId}|${SLEEP_RULE.id}|v${SLEEP_RULE.version}|${startDay}`;
}

export function median(values: number[]): number | null {
    if (values.length === 0) return null;
    const s = [...values].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface PersonalReference {
    median: number;
    nights: number;
    fromDay: number;
    toDay: number;
    method: string;
}

/** Personal reference: median of valid diary nights over a window, only with >= minNights. */
export function personalReference(observations: Observation[], fromDay: number, toDay: number, minNights = 7): PersonalReference | null {
    const daily = effectiveDaily(observations, 'sleep_main', SLEEP_RULE.method);
    const vals: number[] = [];
    for (const [d, o] of daily) {
        if (d >= fromDay && d <= toDay && o.quality === 'valid' && typeof o.value === 'number') vals.push(o.value);
    }
    if (vals.length < minNights) return null;
    return { median: median(vals)!, nights: vals.length, fromDay, toDay, method: SLEEP_RULE.method };
}
