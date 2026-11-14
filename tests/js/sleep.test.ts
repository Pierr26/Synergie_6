import { describe, expect, it } from 'vitest';
import { evaluateSleep001, personalReference, median } from '../../resources/js/domain/sleep';
import type { Observation } from '../../resources/js/domain/types';

let n = 0;
function night(day: number, value: number | null, extra: Partial<Observation> = {}): Observation {
    return {
        id: `o${n++}`, ws: 'demo', missionId: 'M', crewId: 'moreau', missionDay: day, variable: 'sleep_main', value, unit: 'min',
        method: 'sleep-diary', context: {}, quality: value === null ? 'not-recorded' : 'valid', author: 'moreau', source: 'manual',
        measuredAt: '', recordedAt: `2026-01-01T00:00:${String(n).padStart(2, '0')}Z`, version: 1, supersededBy: null, ...extra,
    };
}
const scenario = (upto: number) => [450, 432, 384, 366, 336, 324, 312].slice(0, upto - 135).map((v, i) => night(136 + i, v));

describe('SLEEP-001 v1', () => {
    it('J138 shows no alert', () => {
        expect(evaluateSleep001(scenario(138), 138)).toEqual([]);
    });
    it('J142 before saving the draft (data up to J141) shows no alert', () => {
        expect(evaluateSleep001(scenario(141), 142)).toEqual([]);
    });
    it('J142 after saving 312 min triggers one episode with 336 · 324 · 312', () => {
        const eps = evaluateSleep001(scenario(142), 142);
        expect(eps).toHaveLength(1);
        expect(eps[0].startDay).toBe(140);
        expect(eps[0].evidence.map((o) => o.value)).toEqual([336, 324, 312]);
    });
    it('359 counts, 360 breaks the run', () => {
        expect(evaluateSleep001([night(1, 359), night(2, 359), night(3, 359)], 3)).toHaveLength(1);
        expect(evaluateSleep001([night(1, 359), night(2, 360), night(3, 359), night(4, 359)], 4)).toEqual([]);
    });
    it('a missing day breaks the run', () => {
        expect(evaluateSleep001([night(1, 300), night(2, 300), night(4, 300)], 4)).toEqual([]);
    });
    it('a not-recorded or check-quality entry breaks the run', () => {
        expect(evaluateSleep001([night(1, 300), night(2, null), night(3, 300), night(4, 300)], 4)).toEqual([]);
        expect(evaluateSleep001([night(1, 300), night(2, 300, { quality: 'check' }), night(3, 300)], 3)).toEqual([]);
    });
    it('a sensor-only day (actigraphy) breaks the diary run', () => {
        const rows = [night(1, 300), night(2, 300, { method: 'actigraphy (simulated)' }), night(3, 300), night(4, 300)];
        expect(evaluateSleep001(rows, 4)).toEqual([]);
    });
    it('a fourth night extends the same episode (same start day, no duplicate)', () => {
        const eps = evaluateSleep001([...scenario(142), night(143, 300)], 143);
        expect(eps).toHaveLength(1);
        expect(eps[0].startDay).toBe(140);
        expect(eps[0].endDay).toBe(143);
    });
    it('a confirmed zero is a valid value and counts', () => {
        expect(evaluateSleep001([night(1, 0), night(2, 0), night(3, 0)], 3)).toHaveLength(1);
    });
    it('a corrected night uses the latest version only', () => {
        const old = night(3, 300, { supersededBy: 'x' });
        const corrected = night(3, 400, { version: 2 });
        expect(evaluateSleep001([night(1, 300), night(2, 300), old, corrected], 3)).toEqual([]);
    });
});

describe('personal reference', () => {
    it('J122–J135 median is 438.5 min over 14 nights', () => {
        const ref = [440, 430, 445, 435, 438, 442, 436, 439, 443, 431, 441, 437, 434, 446].map((v, i) => night(122 + i, v));
        expect(personalReference(ref, 122, 135)).toEqual({ median: 438.5, nights: 14, fromDay: 122, toDay: 135, method: 'sleep-diary' });
    });
    it('needs at least seven valid nights', () => {
        expect(personalReference([1, 2, 3, 4, 5, 6].map((d) => night(d, 400)), 1, 10)).toBeNull();
        expect(median([])).toBeNull();
    });
});
