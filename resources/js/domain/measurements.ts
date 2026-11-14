import type { Observation, Quality, Variable } from './types';

export interface ValidationResult {
    ok: boolean;
    /** blocking errors, shown next to the field */
    errors: Record<string, string>;
    quality: Quality;
    qualityNote?: string;
}

const ok = (quality: Quality = 'valid', qualityNote?: string): ValidationResult => ({ ok: true, errors: {}, quality, qualityNote });
const fail = (errors: Record<string, string>): ValidationResult => ({ ok: false, errors, quality: 'invalid' });

export function parseNumber(raw: string | number | null | undefined): number | null {
    if (raw === null || raw === undefined) return null;
    const s = String(raw).trim().replace(',', '.');
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
}

/** Sleep: minutes 0-1440 or hours + minutes (0-59). A zero must be confirmed. */
export function parseSleep(hoursRaw: string, minutesRaw: string, confirmZero: boolean): { minutes: number | null; error?: string } {
    const h = parseNumber(hoursRaw);
    const m = parseNumber(minutesRaw);
    if (h === null && m === null) return { minutes: null, error: 'Enter hours and minutes, or choose “Not recorded”.' };
    if (Number.isNaN(h) || Number.isNaN(m)) return { minutes: null, error: 'Use whole numbers only.' };
    const hh = h ?? 0;
    const mm = m ?? 0;
    if (!Number.isInteger(hh) || !Number.isInteger(mm)) return { minutes: null, error: 'Use whole numbers only.' };
    if (mm < 0 || mm > 59) return { minutes: null, error: 'Minutes go from 0 to 59.' };
    const total = hh * 60 + mm;
    if (hh < 0 || total > 1440) return { minutes: null, error: 'Sleep goes from 0 to 24 h (1,440 min).' };
    if (total === 0 && !confirmZero) return { minutes: null, error: 'Tick “I slept 0 minutes” to confirm a zero.' };
    return { minutes: total };
}

export function validateDrowsiness(v: number | null): string | undefined {
    if (v === null) return 'Choose a level from 1 to 9, or “Not recorded”.';
    if (!Number.isInteger(v) || v < 1 || v > 9) return 'Choose a level from 1 to 9.';
    return undefined;
}

export function validateBloodPressure(sys: number | null, dia: number | null): ValidationResult {
    const errors: Record<string, string> = {};
    if (sys === null || Number.isNaN(sys) || sys <= 0) errors.systolic = 'Enter a positive systolic value in mmHg.';
    if (dia === null || Number.isNaN(dia) || dia <= 0) errors.diastolic = 'Enter a positive diastolic value in mmHg.';
    if (Object.keys(errors).length) return fail(errors);
    if (sys! <= dia!) return ok('check', 'Systolic is not above diastolic. Saved for verification, kept out of comparisons.');
    return ok();
}

export function validateSpO2(v: number | null, signal: string): ValidationResult {
    if (v === null || Number.isNaN(v)) return fail({ value: 'Enter SpO₂ as a percentage.' });
    if (v < 0 || v > 100) return fail({ value: 'SpO₂ goes from 0 to 100 %.' });
    if (signal === 'insufficient' || signal === 'unknown' || signal === '')
        return ok('check', signal === 'insufficient' ? 'Insufficient signal. Kept out of comparisons that need a verified signal.' : 'Signal quality unknown. Kept out of comparisons that need a verified signal.');
    return ok();
}

export function validateTemperature(v: number | null, site: string): ValidationResult {
    if (v === null || Number.isNaN(v)) return fail({ value: 'Enter a temperature in °C.' });
    if (!site || site === 'unknown') return ok('check', 'Site unknown. Verify before comparing.');
    return ok();
}

export function validateGlucose(v: number | null, unit: string): ValidationResult {
    if (v === null || Number.isNaN(v) || v <= 0) return fail({ value: 'Enter a positive glucose value.' });
    if (unit !== 'mg/dL' && unit !== 'mmol/L') return fail({ unit: 'Choose mg/dL or mmol/L.' });
    return ok();
}

export function validateRestingHr(v: number | null, rest: string): ValidationResult {
    if (v === null || Number.isNaN(v) || v <= 0) return fail({ value: 'Enter a positive heart rate in beats per minute.' });
    if (rest !== 'yes') return ok('check', 'Rest context not confirmed. Kept out of the resting series.');
    return ok();
}

/**
 * Comparable series key. Observations only share a curve when variable, method, unit
 * and the context that changes meaning (site, sample, fasting state) all match.
 */
export function seriesKey(o: Pick<Observation, 'variable' | 'method' | 'unit' | 'context'>): string {
    const c = o.context ?? {};
    const parts: string[] = [o.variable, o.method, o.unit];
    if (o.variable === 'temperature') parts.push(c.site ?? 'unknown-site');
    if (o.variable === 'glucose') parts.push(c.sample ?? 'unknown-sample', c.meal ?? 'unknown-context');
    if (o.variable === 'bp') parts.push(c.posture ?? 'unknown-posture');
    return parts.join('|');
}

export const VARIABLE_META: Record<Variable, { label: string; unit: string; short: string }> = {
    sleep_main: { label: 'Main sleep', unit: 'min', short: 'Sleep' },
    drowsiness: { label: 'Drowsiness now', unit: '1–9', short: 'Drowsiness' },
    mood: { label: 'Mood', unit: '1–5', short: 'Mood' },
    symptoms: { label: 'Symptoms or concern', unit: '', short: 'Symptoms' },
    resting_hr: { label: 'Resting heart rate', unit: 'bpm', short: 'Resting HR' },
    bp: { label: 'Blood pressure', unit: 'mmHg', short: 'Blood pressure' },
    spo2: { label: 'SpO₂', unit: '%', short: 'SpO₂' },
    temperature: { label: 'Temperature', unit: '°C', short: 'Temperature' },
    glucose: { label: 'Blood glucose', unit: '', short: 'Glucose' },
};

export const DROWSINESS_ANCHORS: Record<number, string> = {
    1: 'Wide awake',
    3: 'Awake',
    5: 'Somewhat drowsy',
    7: 'Drowsy',
    9: 'Struggling to stay awake',
};

export const MOOD_ANCHORS: Record<number, string> = { 1: 'Very low', 2: 'Low', 3: 'Neutral', 4: 'Good', 5: 'Very good' };

export function formatValue(o: Pick<Observation, 'variable' | 'value' | 'value2' | 'unit' | 'text' | 'quality'>): string {
    if (o.quality === 'not-recorded') return 'Not recorded';
    if (o.variable === 'symptoms') return o.text === 'yes' ? 'Yes' : o.text === 'no' ? 'No' : 'Skipped';
    if (o.value === null) return 'No reading';
    if (o.variable === 'sleep_main') {
        const h = Math.floor(o.value / 60);
        const m = o.value % 60;
        return `${h} h ${String(m).padStart(2, '0')} min`;
    }
    if (o.variable === 'bp') return `${o.value}/${o.value2 ?? '—'} mmHg`;
    if (o.variable === 'drowsiness') return `${o.value} / 9`;
    if (o.variable === 'mood') return `${o.value} / 5`;
    return `${o.value} ${o.unit}`;
}
