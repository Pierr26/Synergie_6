import { bus } from '../../bus';
import { icon } from '../../components/icons';
import { badge, pageHead, queueBadge, simTag, toast } from '../../components/ui';
import type { RequestRow } from '../../data/db';
import * as repo from '../../data/repo';
import { formatValue, VARIABLE_META } from '../../domain/measurements';
import { RECEIVER_LABEL } from '../../domain/queue';
import { hhmm, missionDay, utcStamp } from '../../domain/time';
import { html, type Html } from '../../lib/html';
import { registerActions } from '../../router-actions';
import { app, cfg, me, ws } from '../../state';
import { renderSymptomForm, symptomSection } from '../symptoms/symptoms';

registerActions({
    'review-request': async (el) => {
        const f = el as HTMLFormElement;
        const fd = new FormData(f);
        const reason = String(fd.get('reason') ?? '').trim();
        if (!reason) {
            f.querySelector('.field')?.classList.add('has-error');
            const e = f.querySelector('#reason-err') as HTMLElement;
            e.hidden = false;
            (f.querySelector('#reason') as HTMLElement).focus();
            return;
        }
        const evidence = fd.getAll('evidence').map(String);
        await repo.requestReview(ws(), me(), reason, evidence, app.now);
        f.reset();
        toast('Crew review requested. Your CMO was notified on board.');
        await bus.refresh();
    },
    'answer-request': async (el) => {
        const f = el as HTMLFormElement;
        const text = String(new FormData(f).get('answer') ?? '').trim();
        if (!text) {
            (f.querySelector('textarea') as HTMLElement).focus();
            toast('Write a short answer before sending.');
            return;
        }
        await repo.answerRequest(ws(), String(f.dataset.id), me(), text, [], app.now);
        f.reset();
        toast('Answer saved. Your CMO was notified.');
        await bus.refresh();
    },
});

export function requestCard(r: RequestRow, viewer: 'astronaut' | 'cmo', highlight: boolean): Html {
    const author = repo.memberStatic(ws(), r.authorId).alias;
    const tone = r.status === 'open' ? (r.kind === 'review-request' ? 'review' : 'info') : 'ok';
    const statusText = r.status === 'open' ? (r.kind === 'review-request' ? 'Crew review pending' : 'Open') : 'Answered';
    const canAnswer = r.status === 'open' && ((viewer === 'astronaut' && r.kind === 'follow-up') || (viewer === 'cmo' && r.kind === 'review-request'));
    const action = r.measurement ? `/measurements?type=${r.measurement}&request=${r.id}` : r.label.toLowerCase().includes('check-in') ? `/check-in?request=${r.id}` : null;
    return html`<article class="req ${highlight ? 'req-hl' : ''}" id="req-${r.id}">
      <header><span class="req-k">${icon(r.kind === 'review-request' ? 'review' : 'followup')}${r.kind === 'review-request' ? 'Review requested by' : 'Follow-up from'} ${author}</span>${badge(statusText, tone, r.status === 'open' ? 'clock' : 'ok')}</header>
      <h3>${r.label}</h3>
      <p>${r.reason}</p>
      <p class="fine mono">${utcStamp(Date.parse(r.createdAt))} · Day ${missionDay(Date.parse(r.createdAt), cfg().epoch)}${r.evidence.ids.length ? ` · ${r.evidence.ids.length} linked item${r.evidence.ids.length > 1 ? 's' : ''}` : ''}</p>
      ${r.response ? html`<div class="req-answer"><b>${repo.memberStatic(ws(), r.response.authorId).alias}</b> · <span class="mono">${utcStamp(Date.parse(r.response.at))}</span><p>${r.response.text}</p></div>` : ''}
      ${canAnswer ? html`
        ${viewer === 'astronaut' && action ? html`<a class="btn btn-primary" href="${action}" data-link>${r.measurement ? `Measure ${VARIABLE_META[r.measurement as 'bp'].label.toLowerCase()}` : 'Open check-in'} ${icon('arrow')}</a>` : ''}
        <form class="answer" data-action="answer-request" data-id="${r.id}">
          <label for="ans-${r.id}">${viewer === 'cmo' ? 'Reply to the crew member' : 'Answer'}</label>
          <textarea id="ans-${r.id}" name="answer" rows="2" maxlength="400"></textarea>
          <button class="btn btn-ghost" type="submit">Send answer</button>
        </form>` : ''}
    </article>`;
}

export async function renderFollowUp(): Promise<Html> {
    if (app.route.segments[1] === 'symptom') return renderSymptomForm();
    const crewId = me();
    const day = missionDay(app.now, cfg().epoch);
    const [reqs, alerts, obs, reports] = await Promise.all([repo.requestsFor(ws(), crewId), repo.alertsFor(ws(), crewId), repo.currentObservations(ws(), crewId), repo.reportsFor(ws(), crewId)]);
    const hl = app.route.query.get('request');
    const open = reqs.filter((r) => r.status === 'open');
    const done = reqs.filter((r) => r.status !== 'open');
    const recent = obs.filter((o) => o.missionDay >= day - 3 && o.value !== null).sort((a, b) => b.measuredAt.localeCompare(a.measuredAt)).slice(0, 8);
    const c = cfg();
    return html`
    ${pageHead('Follow-up', 'Requests between you and your crew medical officer, with answers and history. Exchanges stay on board when the ground link is offline.', simTag())}
    <div class="grid-2 fu-grid">
      <section class="card" aria-labelledby="open-h">
        <h2 id="open-h">Open requests</h2>
        ${open.length ? open.map((r) => requestCard(r, 'astronaut', r.id === hl)) : html`<div class="empty-q">${icon('ok')}<div><b>Nothing waiting for you</b><p>When your CMO asks for a measurement or a check-in, it appears here with one button to answer.</p></div></div>`}
      </section>
      <section class="card" id="ask" aria-labelledby="ask-h">
        <h2 id="ask-h">Request crew review</h2>
        <p class="hint">${c.rules.length ? 'Ask your CMO to look at something, even if no rule flagged it.' : html`<b>No mission rule configured</b> in Explore app. A manual request is the way to get a review.`} The request stays on board: nothing is sent to the ground automatically.</p>
        <form data-action="review-request" novalidate>
          <div class="field"><label for="reason">What should your CMO look at?</label><textarea id="reason" name="reason" rows="3" maxlength="400" aria-describedby="reason-err"></textarea><p class="error" id="reason-err" hidden>${icon('review')}Write a short reason so your CMO knows what to check.</p></div>
          ${recent.length ? html`<fieldset class="q"><legend>Attach recent readings (optional)</legend>${recent.map((o) => html`<label class="check"><input type="checkbox" name="evidence" value="${o.id}"> ${VARIABLE_META[o.variable].label}: <span class="mono">${formatValue(o)}</span> <span class="muted">· Day ${o.missionDay} · ${o.method}</span></label>`)}</fieldset>` : ''}
          <button class="btn btn-primary" type="submit">${icon('send')}Request crew review</button>
        </form>
      </section>
    </div>
    ${await symptomSection('astronaut', crewId, app.route.query.get('symptom'))}
    <section class="card" aria-labelledby="hist-h">
      <h2 id="hist-h">History</h2>
      <ol class="timeline">
        ${alerts.flatMap((a) => [
            html`<li><span class="mono">${utcStamp(Date.parse(a.createdAt))}</span><span>${badge('Demo rule', 'review', 'review')} Sleep trend needs review · Days ${a.startDay}–${a.endDay}</span></li>`,
            ...a.reviews.map((rv) => html`<li><span class="mono">${utcStamp(Date.parse(rv.at))}</span><span>${badge('Reviewed', 'ok', 'ok')} ${repo.memberStatic(ws(), rv.byId).alias}: “${rv.note}”</span></li>`),
        ])}
        ${done.map((r) => html`<li><span class="mono">${utcStamp(Date.parse(r.response!.at))}</span><span>${badge('Answered', 'ok', 'ok')} ${r.label} — “${r.response!.text}”</span></li>`)}
        ${reports.map((r) => html`<li><span class="mono">${utcStamp(Date.parse(r.createdAt))}</span><span>${queueBadge(r.queue.state)} Individual report Day ${r.fromDay}–${r.toDay} by ${repo.memberStatic(ws(), r.authorId).alias}${r.queue.receipt ? ` · ${r.queue.receipt.receiver} ${hhmm(Date.parse(r.queue.receipt.receivedAt))} UTC` : r.queue.receiver ? ` · to ${RECEIVER_LABEL[r.queue.receiver]}` : ''}</span></li>`)}
        ${!alerts.length && !done.length && !reports.length ? html`<li class="muted">Nothing yet.</li>` : ''}
      </ol>
    </section>`;
}
