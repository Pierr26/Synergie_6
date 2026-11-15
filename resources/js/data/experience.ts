import * as repo from './repo';
import { symptomReviewState } from '../domain/symptoms';
import type { WorkspaceId } from '../domain/types';

export interface ReviewItem {
    id: string;
    crewId: string;
    reason: string;
    at: string;
    status: string;
    href: string;
    waitingForCrew: boolean;
}

/** One read model for Today, the navigation and the medical review queue. */
export async function reviewItems(ws: WorkspaceId, crewId?: string): Promise<ReviewItem[]> {
    const [alerts, requests, members] = await Promise.all([repo.alertsFor(ws, crewId), repo.requestsFor(ws, crewId), repo.members(ws)]);
    const rows: ReviewItem[] = alerts.filter(a => a.status === 'needs-review').map(a => ({
        id: a.key, crewId: a.crewId, reason: `Three short sleep-diary nights · Days ${a.startDay}–${a.endDay}`,
        at: a.createdAt, status: 'Crew review pending', href: `/crew/${a.crewId}?alert=${encodeURIComponent(a.key)}`, waitingForCrew: false,
    }));
    for (const r of requests.filter(r => r.status !== 'closed')) {
        if (r.kind === 'review-request' && r.status !== 'open') continue;
        rows.push({ id: r.id, crewId: r.crewId, reason: `${r.label} · ${r.reason}`, at: r.response?.at ?? r.createdAt,
            status: r.kind === 'review-request' ? 'Crew review pending' : r.status === 'open' ? 'Follow-up requested' : 'Response received',
            href: `/crew/${r.crewId}?request=${r.id}#req-${r.id}`, waitingForCrew: r.kind === 'follow-up' && r.status === 'open' });
    }
    for (const m of members.filter(m => m.role === 'astronaut' && (!crewId || m.id === crewId))) {
        for (const r of await repo.symptomReportsFor(ws, m.id)) {
            if (r.status !== 'submitted') continue;
            const thread = await repo.symptomThread(ws, r.id);
            const state = symptomReviewState(r, thread);
            rows.push({ id: r.id, crewId: r.crewId, reason: `${r.bodyArea} · ${state === 'Follow-up requested' ? [...thread].reverse().find(e => e.kind === 'more-info')?.text ?? r.description : r.description}`, at: thread.at(-1)?.at ?? r.submittedAt!,
                status: state, href: `/crew/${r.crewId}?symptom=${r.id}#sym-${r.id}`, waitingForCrew: state === 'Follow-up requested' });
        }
    }
    return rows.sort((a,b) => Number(a.waitingForCrew) - Number(b.waitingForCrew) || b.at.localeCompare(a.at));
}
