import { icon } from '../../components/icons';
import { badge, demoRuleTag, obsValue, pageHead, simTag, sourceLabel } from '../../components/ui';
import type { AlertRow, ReportRow, RequestRow } from '../../data/db';
import * as repo from '../../data/repo';
import { VARIABLE_META } from '../../domain/measurements';
import { RECEIVER_LABEL } from '../../domain/queue';
import { TASK_LABEL } from '../../domain/reminder';
import { personalReference, SLEEP_RULE, sleepZone } from '../../domain/sleep';
import { formatMinutes, hhmm, missionDay } from '../../domain/time';
import type { Observation, Variable } from '../../domain/types';
import { html, type Html } from '../../lib/html';
import { app, cfg, me, ws } from '../../state';
import { HAZARDS } from '../body-risks/content';

const TRACKED: { v: Variable; ic: string; region: string }[] = [
    { v: 'sleep_main', ic: 'moon', region: 'brain' },
    { v: 'drowsiness', ic: 'clock', region: 'brain' },
    { v: 'mood', ic: 'user', region: 'brain' },
    { v: 'resting_hr', ic: 'measure', region: 'heart' },
    { v: 'bp', ic: 'measure', region: 'heart' },
    { v: 'spo2', ic: 'link', region: 'lungs' },
    { v: 'temperature', ic: 'info', region: 'lungs' },
    { v: 'glucose', ic: 'info', region: 'kidneys' },
];

/** Which recorded indicators relate to each hazard. Coverage only: how many were recorded today, never a score. */
const HAZARD_VARS: Record<string, Variable[]> = { radiation: [], isolation: ['sleep_main', 'drowsiness', 'mood'], distance: [], gravity: ['resting_hr', 'bp'], environment: ['spo2', 'temperature'] };
const HAZARD_NOTE: Record<string, string> = { radiation: 'Instrument data, not entered by the crew', distance: 'Review and reports stay on board' };

const HAZARD_REGION: Record<string, string> = { radiation: 'brain', isolation: 'brain', distance: 'brain', gravity: 'heart', environment: 'lungs' };

export function latestBy(obs: Observation[], v: Variable, method?: string): Observation | undefined {
    // same timestamp: a reading entered by the crew wins over a simulated sensor, so the row is stable
    const sensor = (o: Observation) => (o.source === 'simulated-sensor' ? 1 : 0);
    return obs.filter((o) => o.variable === v && (!method || o.method === method)).sort((a, b) => b.measuredAt.localeCompare(a.measuredAt) || sensor(a) - sensor(b))[0];
}

/** The mockup's escalation timeline, rebuilt on real states: every step after the rule is a human decision. */
function escalation(alert: AlertRow, evidence: Observation[], reqs: RequestRow[], reports: ReportRow[]): Html {
    const c = cfg();
    const cmo = repo.memberStatic(ws(), c.cmoId).alias;
    const review = alert.reviews[alert.reviews.length - 1];
    const followUp = review?.requestId ? reqs.find((r) => r.id === review.requestId) : undefined;
    const report = reports.find((r) => r.createdAt >= alert.createdAt);
    const steps = [
        { cls: 'done', tm: hhmm(Date.parse(alert.createdAt)), b: 'Demo rule triggered', d: evidence.map((o) => formatMinutes(o.value)).join(' · ') },
        { cls: 'done', tm: hhmm(Date.parse(alert.createdAt)), b: 'CMO notified on board', d: `${cmo} · console notification, no ground link needed` },
        review
            ? { cls: 'done', tm: hhmm(Date.parse(review.at)), b: 'Reviewed by the CMO', d: `“${review.note}”` }
            : { cls: 'now', tm: 'pending', b: 'CMO review', d: 'The crew medical officer checks the three nights' },
        followUp
            ? followUp.status === 'answered'
                ? { cls: 'done', tm: hhmm(Date.parse(followUp.response!.at)), b: 'Follow-up answered', d: followUp.label }
                : { cls: 'now', tm: hhmm(Date.parse(followUp.createdAt)), b: 'Follow-up requested', d: followUp.label }
            : { cls: 'wait', tm: '—', b: 'Follow-up', d: 'Only if the CMO asks for one' },
        report
            ? report.queue.state === 'received'
                ? { cls: 'done', tm: hhmm(Date.parse(report.queue.receipt!.receivedAt)), b: 'Ground report received', d: report.queue.receipt!.receiver }
                : { cls: report.queue.state === 'not-queued' ? 'wait' : 'now', tm: report.queue.state === 'not-queued' ? 'ready' : 'queued', b: report.queue.state === 'not-queued' ? 'Report generated' : 'Queued for ground', d: report.queue.receiver ? RECEIVER_LABEL[report.queue.receiver] : 'Not queued yet' }
            : { cls: 'wait', tm: '—', b: 'Ground report', d: 'Only if the CMO queues a report' },
    ];
    return html`<section class="card esc-card c12" aria-labelledby="esc-h">
      <div class="esc-h">
        <span class="esc-ic">${icon('review')}</span>
        <div><span class="esc-k">${SLEEP_RULE.label} · Days ${alert.startDay}–${alert.endDay}</span><h3 id="esc-h">From your check-in to the crew review</h3></div>
        <span class="esc-sw">${alert.status === 'reviewed' ? 'Reviewed' : 'Review pending'}</span>
      </div>
      <ol class="esc-tl">${steps.map((s) => html`<li class="${s.cls}"><span class="dt" aria-hidden="true"></span><span class="tm">${s.tm}</span><b>${s.b}</b><span class="d">${s.d}</span></li>`)}</ol>
      <p class="fine">${simTag()} Demo rule, not a clinical threshold. Ground transmission is always a CMO decision.</p>
    </section>`;
}

export async function renderOverview(): Promise<Html> {
    const c = cfg();
    const crewId = me();
    const day = missionDay(app.now, c.epoch);
    const [task, draft, alerts, reqs, obs, allObs, reports] = await Promise.all([
        repo.todaysTask(ws(), crewId, app.now),
        repo.checkinFor(ws(), crewId, day),
        repo.alertsFor(ws(), crewId),
        repo.requestsFor(ws(), crewId),
        repo.currentObservations(ws(), crewId),
        repo.observationsFor(ws(), crewId),
        repo.reportsFor(ws(), crewId),
    ]);
    const openFollowUps = reqs.filter((r) => r.kind === 'follow-up' && r.status === 'open');
    const myReviews = reqs.filter((r) => r.kind === 'review-request' && r.status === 'open');
    const activeAlert = alerts[0];
    const evidence = activeAlert ? obs.filter((o) => activeAlert.evidenceIds.includes(o.id)).sort((a, b) => a.missionDay - b.missionDay) : [];
    const who = repo.memberStatic(ws(), crewId);

    /* ---------- hero: the one next action, its reason, one button */
    let tone = 'ok';
    let kicker: Html;
    let title: string;
    let why: Html;
    let actions: Html;
    if (openFollowUps.length) {
        const r = openFollowUps[0];
        tone = 'wt';
        kicker = html`From ${repo.memberStatic(ws(), r.authorId).alias} · ${hhmm(Date.parse(r.createdAt))} UTC`;
        title = 'New follow-up request';
        why = html`<b>${r.label}.</b> ${r.reason}`;
        actions = html`<a class="btn light" href="/follow-up?request=${r.id}" data-link>Open the request</a>`;
    } else if (task && ['due', 'scheduled', 'snoozed', 'off'].includes(task.ev.state)) {
        const isDraft = draft?.status === 'draft';
        tone = task.ev.state === 'due' ? 'wt' : 'ok';
        kicker = html`${task.ev.state === 'due' ? 'Due now' : task.ev.state === 'snoozed' ? `Snoozed until ${hhmm(task.task.snoozedUntil!)} UTC` : `Scheduled ${hhmm(task.ev.effectiveDue)} UTC`}`;
        title = task.ev.state === 'due' ? 'Daily check-in is due' : 'Today’s check-in';
        why = isDraft
            ? html`A draft from ${hhmm(Date.parse(draft!.savedAt))} UTC is waiting: sleep ${draft!.form.sleepHours || '–'} h ${draft!.form.sleepMinutes || '–'} min. Saving it adds today’s night to your trend and closes the reminder.`
            : html`Sleep and drowsiness first, about one minute. It keeps your trend complete for your crew medical officer.`;
        actions = html`<a class="btn light" href="/check-in" data-link>${isDraft ? 'Resume check-in' : 'Open check-in'}</a>${task.ev.state === 'due' && task.ev.canSnooze ? html`<button type="button" class="btn glass" data-action="snooze">Snooze 30 min</button>` : ''}`;
    } else if (activeAlert) {
        const reviewed = activeAlert.status === 'reviewed';
        tone = reviewed ? 'ok' : 'al';
        kicker = html`Demo rule · ${reviewed ? 'Reviewed by CMO' : 'Crew review pending'}`;
        title = 'Sleep trend needs review';
        why = html`Three consecutive sleep-diary nights below 6 h. ${reviewed ? 'Your crew medical officer has reviewed it.' : 'Your crew medical officer has been notified on board. You don’t need to do anything else now.'}`;
        actions = html`<a class="btn light" href="/trends?metric=sleep_main" data-link>See the sleep trend</a><a class="btn glass" href="/follow-up" data-link>Follow-up history</a>`;
    } else {
        kicker = html`Check-in completed${task?.task.completedAt ? html` · ${hhmm(task.task.completedAt)} UTC` : ''}`;
        title = 'You’re up to date';
        why = c.rules.length ? html`Today’s check-in is saved on this device. No review is pending.` : html`Today’s check-in is saved on this device. No mission rule configured in Explore app, so ask for a review if something worries you.`;
        actions = html`<a class="btn light" href="/follow-up#ask" data-link>Request crew review</a><a class="btn glass" href="/measurements" data-link>Add a measurement</a>`;
    }
    const hero = html`<section class="hero c12" aria-labelledby="prio-h">
      <img class="hero-img" src="/assets/illustrations/lunar-window.webp" alt="" width="1200" height="800">
      <canvas class="hero-stars" aria-hidden="true"></canvas>
      <span class="hero-credit">AI-generated image</span>
      <div class="hero-txt">
        <span class="hero-k">Good morning, ${who.shortName} · ${kicker}</span>
        <h2 id="prio-h">${title}</h2>
        <p>${why}</p>
        ${activeAlert && !openFollowUps.length && !(task && ['due', 'scheduled', 'snoozed'].includes(task.ev.state)) ? html`<ol class="hero-ev evidence">${evidence.map((o) => html`<li><span>Day ${o.missionDay}</span><b>${formatMinutes(o.value)}</b></li>`)}</ol>` : ''}
        <div class="hero-row">${actions}</div>
      </div>
      <div class="orb-zone hero-orb t-${tone}">
        <button type="button" class="orb-btn" data-action="breathe" aria-label="Guided breathing: three slow breaths"><span class="halo"></span><span class="orb"></span><span class="orb-txt"><b>${day}</b><span>Mission day</span></span></button>
        <p class="breath-tip" data-tip role="status">Tap the orb for a guided breath</p>
      </div>
    </section>`;

    /* ---------- today's plan as the mockup timeline */
    const ckState = task?.ev.state ?? 'scheduled';
    const plan = html`<section class="card" aria-labelledby="plan-h">
      <div class="card-h"><h3 id="plan-h">Today’s plan</h3><a href="/settings" data-link class="card-link">Reminder settings</a></div>
      <div class="sched">
        <div class="sl plan-row ${ckState === 'completed' ? 'done' : ckState === 'due' ? 'now' : ''}">
          <span class="t">${task ? hhmm(task.ev.effectiveDue) : '07:00'}</span><span class="dt"></span>
          <span><b>Daily check-in</b><span class="d">${ckState === 'completed' ? 'Completed · Saved on this device' : ckState === 'snoozed' ? `Snoozed until ${hhmm(task!.task.snoozedUntil!)} UTC` : draft?.status === 'draft' ? 'Draft saved · resume any time' : 'Sleep, drowsiness, optional extras'}</span></span>
          ${ckState === 'completed' ? html`<span class="st">${TASK_LABEL.completed}</span>` : html`<a class="st-btn" href="/check-in" data-link>${ckState === 'due' ? 'Open' : ckState === 'snoozed' ? `Snoozed until ${hhmm(task!.task.snoozedUntil!)}` : TASK_LABEL[ckState]}</a>`}
        </div>
        ${openFollowUps.map((r) => html`<div class="sl plan-row now"><span class="t">${hhmm(Date.parse(r.createdAt))}</span><span class="dt"></span><span><b>${r.label}</b><span class="d">Requested by ${repo.memberStatic(ws(), r.authorId).alias}</span></span><a class="st-btn" href="/follow-up?request=${r.id}" data-link>Answer</a></div>`)}
        ${myReviews.map((r) => html`<div class="sl plan-row"><span class="t">${hhmm(Date.parse(r.createdAt))}</span><span class="dt"></span><span><b>Crew review requested</b><span class="d">${r.reason}</span></span><span class="st">Crew review pending</span></div>`)}
        ${activeAlert && activeAlert.status === 'needs-review' ? html`<div class="sl plan-row"><span class="t">${hhmm(Date.parse(activeAlert.createdAt))}</span><span class="dt"></span><span><b>Crew review of your sleep trend</b><span class="d">${repo.memberStatic(ws(), c.cmoId).alias} · on board</span></span><span class="st">Pending</span></div>` : ''}
        <div class="sl plan-row"><span class="t">any</span><span class="dt"></span><span><b>Spot measurements</b><span class="d">Blood pressure, SpO₂, temperature, glucose</span></span><a class="st-btn ghost" href="/measurements" data-link>Add</a></div>
      </div>
    </section>`;

    /* ---------- measurements: mockup indicator rows, motivated states, never a score */
    const ref = personalReference(allObs, 122, 135);
    let recorded = 0;
    let missing = 0;
    let review = 0;
    let act = 0;
    const rows = TRACKED.map(({ v, ic, region }) => {
        const o = latestBy(obs, v, v === 'sleep_main' ? SLEEP_RULE.method : undefined);
        const age = o ? day - o.missionDay : null;
        let sw: Html;
        if (!o) {
            missing++;
            sw = html`<span class="sw na">No reading</span>`;
        } else if (o.quality !== 'valid') {
            review++;
            sw = html`<span class="sw wt">Check measurement</span>`;
        } else if (v === 'sleep_main' && activeAlert?.status === 'needs-review' && activeAlert.evidenceIds.includes(o.id)) {
            act++;
            sw = html`<span class="sw al">Needs review</span>`;
        } else {
            // sleep keeps the mockup's three-level demo zones; other values are aged, never judged
            const zone = v === 'sleep_main' ? sleepZone(o.value) : null;
            const stale = age !== null && age > 1;
            const level = zone === 'al' ? 'al' : zone === 'wt' || stale ? 'wt' : 'ok';
            if (level === 'al') act++;
            else if (level === 'wt') review++;
            else recorded++;
            const when = age === 0 ? 'Recorded today' : `${age} day${age === 1 ? '' : 's'} old`;
            sw = html`<span class="sw ${level}">${zone === 'al' ? 'Out of zone' : zone === 'wt' ? 'To watch' : zone === 'ok' ? 'In zone' : when}${zone ? html`<small>${when}</small>` : ''}</span>`;
        }
        const ctx = o
            ? html`Day ${o.missionDay} · ${hhmm(Date.parse(o.measuredAt))} UTC · ${o.method}${o.context.site ? ` · ${o.context.site}` : ''}${o.context.sample ? ` · ${o.context.sample}` : ''}`
            : html`Nothing recorded. No value is assumed.`;
        return html`<a class="ind" href="/trends?metric=${v}" data-link>
          ${icon(ic)}
          <span class="nm"><b>${VARIABLE_META[v].label}</b><span class="ctx">${ctx}</span>${v === 'sleep_main' && ref ? html`<span class="ctx">Personal reference ${formatMinutes(ref.median)} · diary median D${ref.fromDay}–D${ref.toDay}</span>` : ''}</span>
          <span class="val">${o ? obsValue(o) : html`<span class="muted">—</span>`}${o ? html`<small>${sourceLabel(o)}</small>` : ''}</span>
          ${sw}
          <span class="chev" aria-hidden="true">${icon('arrow', 'sm')}</span>
          <span class="sr-only">Body region: ${region}</span>
        </a>`;
    });

    const measures = html`<section class="card" aria-labelledby="meas-h">
      <div class="card-h"><h3 id="meas-h">Recorded measurements</h3><small>Select a line for its trend</small></div>
      <div class="ind-sum" aria-live="polite"><span class="cnt"><i></i><b>${recorded}</b> in zone</span><span class="cnt wt"><i></i><b>${review}</b> to watch</span><span class="cnt al"><i></i><b>${act}</b> to review</span><span class="cnt na"><i></i><b>${missing}</b> no reading</span></div>
      <div class="ind-list">${rows}</div>
      <p class="legend-g">Green, amber and coral are demo zones, not clinical thresholds. Each value keeps its time, method and source. Gaps stay visible; HEXTA never fills them.</p>
    </section>`;

    const hazards = html`<section class="card" aria-labelledby="hz-h">
      <div class="card-h"><h3 id="hz-h">The 5 hazards of spaceflight</h3><a class="card-link" href="https://www.nasa.gov/hrp/hazards/" target="_blank" rel="noopener">NASA HRP model</a></div>
      <div class="hz-links">${HAZARDS.map((h) => {
          const vars = HAZARD_VARS[h.id] ?? [];
          const today = vars.filter((v) => latestBy(obs, v, v === 'sleep_main' ? SLEEP_RULE.method : undefined)?.missionDay === day).length;
          return html`<a class="hzl" href="/body?region=${HAZARD_REGION[h.id]}" data-link>
            <span class="hz-ic">${icon(h.id, 'sm')}</span>
            <span><b>${h.name}</b><small>${h.link}</small></span>
            ${vars.length
                ? html`<span class="hz-cov"><span class="hz-pips" aria-hidden="true">${vars.map((_, i) => html`<i class="${i < today ? 'on' : ''}"></i>`)}</span><small>${today} of ${vars.length} today</small></span>`
                : html`<span class="hz-cov"><small>${HAZARD_NOTE[h.id]}</small></span>`}
          </a>`;
      })}</div>
      <p class="legend-g">Bars count today’s recorded indicators linked to each hazard. They are not a risk score.</p>
    </section>`;

    return html`
    ${pageHead('Overview', html`${who.alias} · ${who.title}`, html`<div class="head-tags">${simTag()}${c.rules.length ? demoRuleTag() : badge('No mission rule configured', 'muted', 'info')}</div>`)}
    <div class="grid">
      ${hero}
      ${activeAlert ? escalation(activeAlert, evidence, reqs, reports) : ''}
      <div class="hcol c5 home-a">${plan}${hazards}</div>
      <div class="hcol c7 home-b">${measures}</div>
    </div>`;
}
