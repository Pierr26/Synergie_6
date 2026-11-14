import { describe, expect, it } from 'vitest';
import { compareToInterval, normalizeLab } from '../../resources/js/domain/labs';
import { parseSleep, seriesKey, validateBloodPressure, validateSpO2, validateTemperature } from '../../resources/js/domain/measurements';

const iv = { low: 140, high: 170, unit: 'g/L', source: 's', population: 'p', confirmedByCmo: true };
const hb = (value: number, unit: string | null = 'g/L', status: 'final' | 'preliminary' = 'final', interval: typeof iv | null = iv) =>
    compareToInterval({ analyte: 'Hb', value, unit, status, interval, collectedAt: 'x' });

describe('V03 lab results', () => {
    it('139 below, 140 and 170 within (bounds included), 171 above', () => {
        expect(hb(139)).toBe('Below');
        expect(hb(140)).toBe('Within');
        expect(hb(170)).toBe('Within');
        expect(hb(171)).toBe('Above');
    });
    it('13.9 g/dL → 139 g/L, Hct 0.42 L/L → 42 %', () => {
        expect(normalizeLab('Hb', 13.9, 'g/dL')).toBe(139);
        expect(normalizeLab('Hct', 0.42, 'L/L')).toBe(42);
        expect(hb(13.9, 'g/dL')).toBe('Below');
    });
    it('compares before rounding (169.96 within, 170.04 above)', () => {
        expect(hb(169.96)).toBe('Within');
        expect(hb(170.04)).toBe('Above');
    });
    it('missing unit or preliminary → pending verification; missing interval → reference unavailable', () => {
        expect(hb(150, null)).toBe('Result pending verification');
        expect(hb(150, 'g/L', 'preliminary')).toBe('Result pending verification');
        expect(hb(150, 'g/L', 'final', null)).toBe('Reference unavailable');
    });
});

describe('V01 / V11 entry rules', () => {
    it('distinguishes empty from confirmed zero', () => {
        expect(parseSleep('', '', false).minutes).toBeNull();
        expect(parseSleep('0', '0', false).error).toMatch(/confirm/);
        expect(parseSleep('0', '0', true).minutes).toBe(0);
        expect(parseSleep('5', '12', false).minutes).toBe(312);
        expect(parseSleep('5', '60', false).error).toBeDefined();
        expect(parseSleep('24', '1', false).error).toBeDefined();
    });
    it('systolic ≤ diastolic is kept for verification', () => {
        const r = validateBloodPressure(80, 80);
        expect(r.ok).toBe(true);
        expect(r.quality).toBe('check');
        expect(validateBloodPressure(118, 76).quality).toBe('valid');
    });
    it('SpO₂ outside 0–100 is refused', () => {
        expect(validateSpO2(101, 'good').ok).toBe(false);
        expect(validateSpO2(-1, 'good').ok).toBe(false);
        expect(validateSpO2(97, 'good').quality).toBe('valid');
    });
    it('temperature without site is kept with a check flag', () => {
        expect(validateTemperature(36.7, '').quality).toBe('check');
    });
    it('skin vs oral temperature and capillary vs plasma glucose stay in separate series', () => {
        const t = (site: string) => seriesKey({ variable: 'temperature', method: 'm', unit: '°C', context: { site } });
        expect(t('skin')).not.toBe(t('oral'));
        const g = (sample: string, unit: string) => seriesKey({ variable: 'glucose', method: 'm', unit, context: { sample, meal: 'fasting' } });
        expect(g('capillary', 'mg/dL')).not.toBe(g('plasma', 'mmol/L'));
    });
});
