import { bus } from '../../bus';
import { icon } from '../../components/icons';
import { badge, pageHead, toast } from '../../components/ui';
import type { NotificationRow } from '../../data/db';
import * as repo from '../../data/repo';
import { missionDay, utcStamp } from '../../domain/time';
import { html, type Html } from '../../lib/html';
import { registerActions } from '../../router-actions';
import { app, cfg, me, ws } from '../../state';

const ICON: Record<NotificationRow['type'], string> = {
    'checkin-due': 'bell',
    'follow-up-request': 'followup',
    'review-requested': 'review',
    'follow-up-completed': 'ok',
    'sleep-review': 'review',
    'report-received': 'send',
    'report-retry': 'retry',
    'symptom-submitted': 'camera',
    'symptom-reply': 'followup',
    'symptom-more-info': 'followup',
    'symptom-feedback': 'ok',
    'ground-note': 'link',
};

registerActions({
    'notif-read': async (el) => {
        await repo.markRead(el.dataset.id!, app.now);
        toast('Marked as read.');
        await bus.refresh();
    },
    'notif-open': async (el) => {
        await repo.markRead(el.dataset.id!, app.now);
        bus.navigate(el.dataset.href!);
    },
    'notif-all': async () => {
        await repo.markAllRead(ws(), me(), app.now);
        toast('All notifications marked as read.');
        await bus.refresh();
    },
});

function item(n: NotificationRow): Html {
    const unread = !n.readAt;
    const action = n.type === 'checkin-due' ? 'Open check-in' : n.type === 'report-received' ? 'Open receipt' : n.type === 'report-retry' ? 'Open queue' : n.type === 'follow-up-request' ? 'Open request' : 'Open';
    return html`<li class="notif ${unread ? 'unread' : ''}">
      <span class="notif-ic">${icon(ICON[n.type])}</span>
      <div class="notif-b">
        <p class="notif-t"><b>${n.title}</b> ${unread ? badge('Unread', 'info') : html`<span class="muted small">Read</span>`} ${n.type === 'sleep-review' ? badge('Demo rule', 'review') : ''}</p>
        <p>${n.body}</p>
        <small class="mono">${utcStamp(Date.parse(n.createdAt))} · Day ${missionDay(Date.parse(n.createdAt), cfg().epoch)}</small>
      </div>
      <div class="notif-a">
        <button type="button" class="btn btn-small btn-primary" data-action="notif-open" data-id="${n.id}" data-href="${n.link}">${action}</button>
        ${unread ? html`<button type="button" class="btn btn-small btn-quiet" data-action="notif-read" data-id="${n.id}">Mark as read</button>` : ''}
      </div>
    </li>`;
}

export async function renderNotifications(): Promise<Html> {
    const rows = await repo.notificationsFor(ws(), me());
    const active = rows.filter((n) => n.active);
    const history = rows.filter((n) => !n.active);
    const who = repo.memberStatic(ws(), me());
    return html`
    ${pageHead('Notifications', html`For ${who.alias} (${app.role === 'cmo' ? 'crew medical officer' : 'astronaut'}) · on-board notifications keep working without the ground link`, rows.some((n) => !n.readAt) ? html`<button type="button" class="btn btn-ghost" data-action="notif-all">Mark all as read</button>` : undefined)}
    <section class="card" aria-labelledby="act-h">
      <h2 id="act-h">Needs action</h2>
      ${active.length ? html`<ul class="notifs">${active.map(item)}</ul>` : html`<p class="muted">${icon('ok')} Nothing needs action.</p>`}
    </section>
    <section class="card" aria-labelledby="hist-h">
      <h2 id="hist-h">History</h2>
      ${history.length ? html`<ul class="notifs">${history.map(item)}</ul>` : html`<p class="muted">No past notification.</p>`}
    </section>`;
}
