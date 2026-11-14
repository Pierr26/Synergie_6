import { DAY_MS, MINUTE_MS, dayStart, timeOnDay } from './time';

export const SNOOZE_MS = 30 * MINUTE_MS;

export interface ReminderSettings {
    time: string;
    enabled: boolean;
}

export const DEFAULT_REMINDER: ReminderSettings = { time: '07:00', enabled: true };

export interface CheckinTask {
    key: string;
    ws: string;
    missionId: string;
    crewId: string;
    missionDay: number;
    type: 'checkin';
    dueAt: number;
    snoozedUntil: number | null;
    /** due time for which the banner was dismissed */
    dismissedFor: number | null;
    completedAt: number | null;
    /** snooze end for which the notification was already re-marked unread (once) */
    reactivatedFor: number | null;
}

export type TaskState = 'scheduled' | 'due' | 'snoozed' | 'completed' | 'missed' | 'off';

export const TASK_LABEL: Record<TaskState, string> = {
    scheduled: 'Scheduled',
    due: 'Due now',
    snoozed: 'Snoozed',
    completed: 'Completed',
    missed: 'Missed',
    off: 'Reminders off',
};

export function taskKey(ws: string, missionId: string, crewId: string, day: number): string {
    return `${ws}|${missionId}|${crewId}|${day}|checkin`;
}

export function newTask(ws: string, missionId: string, crewId: string, day: number, epoch: string, settings: ReminderSettings): CheckinTask {
    return {
        key: taskKey(ws, missionId, crewId, day),
        ws,
        missionId,
        crewId,
        missionDay: day,
        type: 'checkin',
        dueAt: timeOnDay(day, epoch, settings.time),
        snoozedUntil: null,
        dismissedFor: null,
        completedAt: null,
        reactivatedFor: null,
    };
}

export interface TaskEvaluation {
    state: TaskState;
    effectiveDue: number;
    bannerVisible: boolean;
    canSnooze: boolean;
}

export function evaluateTask(task: CheckinTask, now: number, currentDay: number, epoch: string, enabled: boolean): TaskEvaluation {
    const effectiveDue = task.snoozedUntil ?? task.dueAt;
    const dayEnd = dayStart(task.missionDay, epoch) + DAY_MS;
    const canSnooze = now + SNOOZE_MS < dayEnd;
    if (task.completedAt) return { state: 'completed', effectiveDue, bannerVisible: false, canSnooze: false };
    if (task.missionDay < currentDay) return { state: 'missed', effectiveDue, bannerVisible: false, canSnooze: false };
    if (!enabled) return { state: 'off', effectiveDue, bannerVisible: false, canSnooze: false };
    if (task.snoozedUntil !== null && now < task.snoozedUntil) return { state: 'snoozed', effectiveDue, bannerVisible: false, canSnooze: false };
    if (now >= effectiveDue) return { state: 'due', effectiveDue, bannerVisible: task.dismissedFor !== effectiveDue, canSnooze };
    return { state: 'scheduled', effectiveDue, bannerVisible: false, canSnooze: false };
}

/** Snooze 30 min from the action time; refused if it would leave the current mission day. */
export function snoozeTask(task: CheckinTask, now: number, epoch: string): CheckinTask | null {
    const until = now + SNOOZE_MS;
    if (until >= dayStart(task.missionDay, epoch) + DAY_MS) return null;
    return { ...task, snoozedUntil: until, dismissedFor: null };
}

export function dismissBanner(task: CheckinTask): CheckinTask {
    return { ...task, dismissedFor: task.snoozedUntil ?? task.dueAt };
}

/** Changing the reminder time of an open task recomputes the due time and clears snooze and dismissal. */
export function rescheduleTask(task: CheckinTask, epoch: string, time: string): CheckinTask {
    if (task.completedAt) return task;
    return { ...task, dueAt: timeOnDay(task.missionDay, epoch, time), snoozedUntil: null, dismissedFor: null, reactivatedFor: null };
}
