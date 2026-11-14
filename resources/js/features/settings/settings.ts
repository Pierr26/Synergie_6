import { bus } from '../../bus';
import { icon } from '../../components/icons';
import { badge, pageHead, toast } from '../../components/ui';
import * as repo from '../../data/repo';
import { TASK_LABEL } from '../../domain/reminder';
import { hhmm } from '../../domain/time';
import { html, type Html } from '../../lib/html';
import { registerActions } from '../../router-actions';
import { app, cfg, me, ws } from '../../state';

registerActions({
    'reminder-save': async (el) => {
        const fd = new FormData(el as HTMLFormElement);
        const time = String(fd.get('time') || '07:00');
        const enabled = fd.get('enabled') === 'on';
        await repo.saveReminderSettings(ws(), me(), { time, enabled }, app.now);
        toast(enabled ? `Daily reminder set to ${time} UTC.` : 'Personal reminders off. The task stays in Today’s plan.');
        await bus.refresh();
    },
});

export async function renderSettings(): Promise<Html> {
    if (app.role !== 'astronaut') return html`${pageHead('Reminder settings')}<div class="card">${icon('info')} Reminder settings belong to each astronaut. Switch role to Astronaut.</div>`;
    const s = await repo.reminderSettings(ws(), me());
    const history = await repo.taskHistory(ws(), me(), app.now);
    return html`
    ${pageHead('Reminder settings', `Times are in mission time (UTC). The mission day changes at 00:00 UTC.`)}
    <form class="card" data-action="reminder-save" aria-labelledby="rs-h">
      <h2 id="rs-h">Daily check-in reminder</h2>
      <div class="form-grid">
        <div class="field"><label for="rem-time">Reminder time (UTC)</label><input id="rem-time" name="time" type="time" value="${s.time}" required></div>
        <label class="check"><input type="checkbox" name="enabled" ${s.enabled ? 'checked' : ''}> Show the banner and notification</label>
      </div>
      <p class="hint">Changing the time of an open task recomputes its due time and clears any snooze or dismissed banner.</p>
      <button class="btn btn-primary" type="submit">Save reminder</button>
    </form>
    <section class="card" aria-labelledby="th-h">
      <h2 id="th-h">Check-in history</h2>
      <div class="table-wrap"><table>
        <thead><tr><th scope="col">Day</th><th scope="col">Due (UTC)</th><th scope="col">State</th><th scope="col">Completed</th></tr></thead>
        <tbody>${history.map(({ task, ev }) => html`<tr><td class="mono">Day ${task.missionDay}</td><td class="mono">${hhmm(ev.effectiveDue)}</td><td>${badge(ev.state === 'snoozed' ? `Snoozed until ${hhmm(task.snoozedUntil!)}` : TASK_LABEL[ev.state], ev.state === 'completed' ? 'ok' : ev.state === 'missed' ? 'error' : ev.state === 'due' ? 'review' : 'muted')}</td><td class="mono">${task.completedAt ? hhmm(task.completedAt) : '—'}</td></tr>`)}</tbody>
      </table></div>
      <p class="hint">Mission: ${cfg().missionName}.</p>
    </section>`;
}
