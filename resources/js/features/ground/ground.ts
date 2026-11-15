import { bus } from '../../bus';
import { icon } from '../../components/icons';
import { badge, pageHead, toast } from '../../components/ui';
import type { GroundNoteRow, ReportRow } from '../../data/db';
import * as repo from '../../data/repo';
import { hhmm, missionDay, utcStamp } from '../../domain/time';
import { html, type Html } from '../../lib/html';
import { registerActions } from '../../router-actions';
import { app, cfg, me, ws } from '../../state';
import { reportDoc } from '../reports/reports';

registerActions({
    'ground-note': async (el) => {
        const f = el as HTMLFormElement;
        const fd = new FormData(f);
        const text = String(fd.get('note') ?? '').trim();
        if (!text) {
            f.querySelector('.field')?.classList.add('has-error');
            (f.querySelector('#gn-err') as HTMLElement).hidden = false;
            (f.querySelector('textarea') as HTMLElement).focus();
            return;
        }
        await repo.addGroundNote(ws(), me(), text, String(fd.get('report') ?? '') || null, app.now);
        let delivered = 0;
        if (app.groundLink) delivered = await repo.deliverGroundNotes(ws(), app.now);
        f.reset();
        toast(delivered ? 'Note delivered to the crew medical officer on board.' : 'Note saved in Houston. It waits for the ground link, then reaches the crew.');
        await bus.refresh();
    },
});

/** "3 h 20 min ago" in mission time */
function ago(iso: string): string {
    const min = Math.max(0, Math.round((app.now - Date.parse(iso)) / 60000));
    if (min < 1) return 'just now';
    if (min < 60) return `${min} min ago`;
    const h = Math.floor(min / 60);
    if (h < 48) return `${h} h ${String(min % 60).padStart(2, '0')} min ago`;
    return `${Math.floor(h / 24)} days ago`;
}

function linkPanel(last: ReportRow | undefined): Html {
    const up = app.groundLink;
    return html`<section class="card gl-panel ${up ? 'up' : 'down'}" aria-labelledby="gl-h">
      <span class="gl-ic" aria-hidden="true">${icon(up ? 'link' : 'linkoff')}</span>
      <div>
        <h2 id="gl-h">${up ? 'In contact with the crew' : 'No contact with the crew'}</h2>
        <p>${up ? 'Reports the crew medical officer queues arrive here within seconds. Your notes reach the crew at once.' : 'The crew keeps working on board. Reports and notes wait at each end until the link returns.'}</p>
        <p class="gl-last">${last ? html`Last report received <b>${ago(last.queue.receipt!.receivedAt)}</b> · <span class="mono">${utcStamp(Date.parse(last.queue.receipt!.receivedAt))}</span>` : 'No report received yet.'}</p>
      </div>
    </section>`;
}

function reportCard(r: ReportRow, open: boolean): Html {
    const who = repo.memberStatic(ws(), r.crewId);
    const author = repo.memberStatic(ws(), r.authorId);
    return html`<a class="gr ${open ? 'on' : ''}" href="/ground?report=${r.id}" data-link ${open ? html`aria-current="true"` : ''}>
      <i class="av">${who.initials}</i>
      <span class="gr-main"><b>${who.alias}</b><small>Days ${r.fromDay}–${r.toDay} · sent by ${author.alias}</small></span>
      <span class="gr-when"><span class="mono">${hhmm(Date.parse(r.queue.receipt!.receivedAt))} UTC</span><small>${ago(r.queue.receipt!.receivedAt)}</small></span>
      ${icon('arrow', 'sm')}
    </a>`;
}

function noteRow(n: GroundNoteRow): Html {
    const about = n.crewId ? repo.memberStatic(ws(), n.crewId).alias : null;
    return html`<li class="gn">
      <p>${n.text}</p>
      <p class="gn-meta"><span class="mono">${utcStamp(Date.parse(n.createdAt))}</span>${about ? html` · about ${about}` : ''}</p>
      ${n.deliveredAt ? badge(`Delivered on board · ${hhmm(Date.parse(n.deliveredAt))} UTC`, 'ok', 'ok') : badge('Waiting for the ground link', 'info', 'clock')}
    </li>`;
}

export async function renderGround(): Promise<Html> {
    if (app.role !== 'ground') return html`${pageHead('Houston')}<div class="card">${icon('info')} This console is for the flight surgeon in Houston. Switch role to Houston.</div>`;
    const c = cfg();
    const [reports, notes] = await Promise.all([repo.receivedReports(ws()), repo.groundNotes(ws())]);
    const selId = app.route.query.get('report');
    const sel = reports.find((r) => r.id === selId);
    const waiting = notes.filter((n) => !n.deliveredAt).length;

    const form = html`<form class="card gn-form" data-action="ground-note" novalidate aria-labelledby="gn-h">
      <h2 id="gn-h">Note to the crew medical officer</h2>
      <p class="hint">Advice or a question for ${repo.memberStatic(ws(), c.cmoId).alias}. The decision stays on board.</p>
      <div class="field"><label for="gn-text">Your note</label><textarea id="gn-text" name="note" rows="3" maxlength="600"></textarea><p class="error" id="gn-err" hidden>${icon('review')}Write a short note before sending.</p></div>
      ${reports.length ? html`<div class="field"><label for="gn-report">About</label><select id="gn-report" name="report"><option value="">No specific report</option>${reports.map((r) => html`<option value="${r.id}" ${r.id === sel?.id ? 'selected' : ''}>${repo.memberStatic(ws(), r.crewId).alias} · Days ${r.fromDay}–${r.toDay}</option>`)}</select></div>` : ''}
      <button class="btn btn-primary" type="submit">${icon('send')}${app.groundLink ? 'Send note' : 'Save note for the next contact'}</button>
    </form>`;

    const sees = html`<section class="card gl-scope" aria-labelledby="scope-h">
      <h2 id="scope-h">What Houston sees</h2>
      <ul class="scope">
        <li class="yes">${icon('ok', 'sm')}<span>Reports the crew medical officer chose to send, frozen, with their receipt</span></li>
        <li class="no">${icon('close', 'sm')}<span>Daily check-ins, symptom photos and live values. They stay on board.</span></li>
        <li class="no">${icon('close', 'sm')}<span>Anything while the link is down. Earth is not needed for the crew to act.</span></li>
      </ul>
    </section>`;

    return html`
    ${pageHead('Houston', html`${repo.memberStatic(ws(), me()).alias} · flight surgeon on Earth · ${c.missionName}, Day ${missionDay(app.now, c.epoch)}`)}
    ${linkPanel(reports[0])}
    ${sel
        ? html`<p><a href="/ground" data-link class="link-quiet">${icon('back', 'sm')}All received reports</a></p>
          <section class="card" aria-label="Received report">${reportDoc(sel)}<p class="fine">Received <span class="mono">${utcStamp(Date.parse(sel.queue.receipt!.receivedAt))}</span> by ${sel.queue.receipt!.receiver} · receipt <span class="mono">${sel.queue.receipt!.receiptId.slice(0, 8)}</span></p></section>`
        : html`<section class="card" aria-labelledby="rr-h">
          <div class="card-h"><h2 id="rr-h">Received reports</h2><small>${reports.length} on Earth</small></div>
          ${reports.length
              ? html`<div class="gr-list">${reports.map((r) => reportCard(r, false))}</div>`
              : html`<div class="empty-q gl-empty">${icon('linkoff')}<div><b>Nothing received yet</b><p>A report arrives when the crew medical officer queues one and the ground link is up. Until then, the crew handles everything on board.</p></div></div>`}
        </section>`}
    ${form}
    <section class="card" aria-labelledby="gnl-h">
      <div class="card-h"><h2 id="gnl-h">Your notes</h2>${waiting ? badge(`${waiting} waiting`, 'info', 'clock') : ''}</div>
      ${notes.length ? html`<ol class="gn-list">${notes.map(noteRow)}</ol>` : html`<p class="muted">No note yet.</p>`}
    </section>
    ${sees}`;
}
