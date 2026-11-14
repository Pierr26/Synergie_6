import { describe, expect, it } from 'vitest';
import { dismissBanner, evaluateTask, newTask, rescheduleTask, snoozeTask } from '../../resources/js/domain/reminder';
import { missionDay, timeOnDay } from '../../resources/js/domain/time';

const epoch = '2026-06-20T00:00:00Z';
const at = (day: number, t: string) => timeOnDay(day, epoch, t);
const task = () => newTask('demo', 'M', 'moreau', 142, epoch, { time: '07:00', enabled: true });

describe('check-in reminder (V09)', () => {
    it('mission day 142 is 8 Nov 2026 and the day changes at 00:00 UTC', () => {
        expect(missionDay(Date.parse('2026-11-08T00:00:00Z'), epoch)).toBe(142);
        expect(missionDay(Date.parse('2026-11-07T23:59:59Z'), epoch)).toBe(141);
    });
    it('06:59 Scheduled, 07:00 Due with banner', () => {
        expect(evaluateTask(task(), at(142, '06:59'), 142, epoch, true).state).toBe('scheduled');
        const ev = evaluateTask(task(), at(142, '07:00'), 142, epoch, true);
        expect(ev.state).toBe('due');
        expect(ev.bannerVisible).toBe(true);
    });
    it('snooze to 07:30: 07:29 snoozed, 07:30 due again', () => {
        const s = snoozeTask(task(), at(142, '07:00'), epoch)!;
        expect(s.snoozedUntil).toBe(at(142, '07:30'));
        expect(evaluateTask(s, at(142, '07:29'), 142, epoch, true).state).toBe('snoozed');
        expect(evaluateTask(s, at(142, '07:30'), 142, epoch, true).state).toBe('due');
    });
    it('snooze is refused when it would leave the mission day', () => {
        expect(snoozeTask(task(), at(142, '23:40'), epoch)).toBeNull();
        expect(evaluateTask(task(), at(142, '23:40'), 142, epoch, true).canSnooze).toBe(false);
    });
    it('dismiss hides the banner for the current due time only; a new snooze creates a new due time', () => {
        const d = dismissBanner(task());
        expect(evaluateTask(d, at(142, '07:05'), 142, epoch, true).bannerVisible).toBe(false);
        const s = snoozeTask(d, at(142, '07:05'), epoch)!;
        expect(evaluateTask(s, at(142, '07:35'), 142, epoch, true).bannerVisible).toBe(true);
    });
    it('completed closes the task, next day classifies an open task as missed', () => {
        expect(evaluateTask({ ...task(), completedAt: at(142, '07:02') }, at(142, '08:00'), 142, epoch, true).state).toBe('completed');
        expect(evaluateTask(task(), at(143, '06:00'), 143, epoch, true).state).toBe('missed');
    });
    it('disabling reminders removes the banner; changing the time clears snooze and dismissal', () => {
        expect(evaluateTask(task(), at(142, '08:00'), 142, epoch, false).state).toBe('off');
        const s = snoozeTask(task(), at(142, '07:00'), epoch)!;
        const r = rescheduleTask(s, epoch, '09:00');
        expect(r.snoozedUntil).toBeNull();
        expect(r.dueAt).toBe(at(142, '09:00'));
        expect(evaluateTask(r, at(142, '08:00'), 142, epoch, true).state).toBe('scheduled');
    });
});
