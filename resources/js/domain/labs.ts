export type Analyte = 'Hb' | 'Hct';
export type LabStatus = 'final' | 'corrected' | 'preliminary' | 'unverified';

export interface LabInterval {
    low: number;
    high: number;
    /** unit of the bounds, already normalised (g/L for Hb, % for Hct) */
    unit: string;
    source: string;
    population: string;
    confirmedByCmo: boolean;
}

export interface LabResult {
    id: string;
    ws: string;
    missionId: string;
    crewId: string;
    analyte: Analyte;
    value: number;
    unit: string | null;
    loinc: string;
    specimen: string;
    method: string;
    lab: string;
    status: LabStatus;
    collectedAt: string | null;
    analysedAt: string | null;
    issuedAt: string | null;
    interval: LabInterval | null;
    labFlag: string | null;
    author: string;
    recordedAt: string;
    version: number;
    supersededBy: string | null;
    source: 'manual' | 'demo-dataset';
}

export const LAB_META: Record<Analyte, { name: string; loinc: string; baseUnit: string; units: string[] }> = {
    Hb: { name: 'Haemoglobin (Hb)', loinc: '718-7', baseUnit: 'g/L', units: ['g/L', 'g/dL'] },
    Hct: { name: 'Haematocrit (Hct)', loinc: '4544-3', baseUnit: '%', units: ['%', 'L/L'] },
};

/** Normalise to g/L (Hb) or % (Hct). Unknown or missing unit → null (never guessed). */
export function normalizeLab(analyte: Analyte, value: number, unit: string | null): number | null {
    if (!Number.isFinite(value) || unit === null || unit === '') return null;
    if (analyte === 'Hb') {
        if (unit === 'g/L') return value;
        if (unit === 'g/dL') return round6(value * 10);
        return null;
    }
    if (unit === '%') return value;
    if (unit === 'L/L') return round6(value * 100);
    return null;
}

/** removes binary float noise (13.9*10 = 138.99999…) without rounding clinically meaningful digits */
function round6(n: number): number {
    return Math.round(n * 1e6) / 1e6;
}

export type IntervalVerdict = 'Below' | 'Within' | 'Above' | 'Reference unavailable' | 'Result pending verification';

/** Compare before rounding, bounds included. */
export function compareToInterval(result: Pick<LabResult, 'analyte' | 'value' | 'unit' | 'status' | 'interval' | 'collectedAt'>): IntervalVerdict {
    const normalized = normalizeLab(result.analyte, result.value, result.unit);
    if (normalized === null || (result.status !== 'final' && result.status !== 'corrected')) return 'Result pending verification';
    const iv = result.interval;
    if (!iv || iv.unit !== LAB_META[result.analyte].baseUnit || !Number.isFinite(iv.low) || !Number.isFinite(iv.high)) return 'Reference unavailable';
    if (normalized < iv.low) return 'Below';
    if (normalized > iv.high) return 'Above';
    return 'Within';
}

export function hoursBetween(a: string | null, b: string | null): number | null {
    if (!a || !b) return null;
    return Math.round(((Date.parse(b) - Date.parse(a)) / 3_600_000) * 10) / 10;
}
