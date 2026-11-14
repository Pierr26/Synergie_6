export const MINUTE_MS = 60_000;
export const DAY_MS = 86_400_000;

/** Mission day of a timestamp. The day changes at 00:00 UTC; day 1 starts at the epoch. */
export function missionDay(ts: number, epochIso: string): number {
    return Math.floor((ts - Date.parse(epochIso)) / DAY_MS) + 1;
}

export function dayStart(day: number, epochIso: string): number {
    return Date.parse(epochIso) + (day - 1) * DAY_MS;
}

/** "07:00" on a given mission day, in UTC. */
export function timeOnDay(day: number, epochIso: string, hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return dayStart(day, epochIso) + (h * 60 + m) * MINUTE_MS;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function hhmm(ts: number): string {
    const d = new Date(ts);
    return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function hhmmss(ts: number): string {
    const d = new Date(ts);
    return `${hhmm(ts)}:${pad(d.getUTCSeconds())}`;
}

export function isoDate(ts: number): string {
    return new Date(ts).toISOString().slice(0, 10);
}

export function longDate(ts: number): string {
    return new Date(ts).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** 312 → "5 h 12 min"; 0 → "0 min"; null → "No reading" */
export function formatMinutes(min: number | null | undefined): string {
    if (min === null || min === undefined) return 'No reading';
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    if (h === 0) return `${m} min`;
    return `${h} h ${pad(m)} min`;
}

export function utcStamp(ts: number): string {
    return `${isoDate(ts)} ${hhmm(ts)} UTC`;
}
