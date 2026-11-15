import { bus } from '../../bus';
import { icon } from '../../components/icons';
import { badge, demoRuleTag, obsValue, pageHead, qualityBadge, queueBadge, sourceLabel, toast } from '../../components/ui';
import * as repo from '../../data/repo';
import { reviewItems } from '../../data/experience';
import { compareToInterval, hoursBetween, LAB_META, normalizeLab, type Analyte, type LabStatus } from '../../domain/labs';
import { VARIABLE_META } from '../../domain/measurements';
import { SLEEP_RULE, sleepZone } from '../../domain/sleep';
import { formatMinutes, hhmm, missionDay, utcStamp } from '../../domain/time';
import type { Variable } from '../../domain/types';
import { html, type Html } from '../../lib/html';
import { registerActions } from '../../router-actions';
import { app, cfg, me, ws } from '../../state';
import { requestCard } from '../follow-up/followup';
import { pendingSymptomReports, symptomSection } from '../symptoms/symptoms';
import { medicalCard, medList, medsFor } from './medical';

const FOLLOW_UPS: { label: string; measurement: string | null }[] = [
    { label: 'Clarify your sleep duration', measurement: 'sleep_main' },
    { label: 'Clarify your drowsiness', measurement: 'drowsiness' },
    { label: 'New sleep check-in tomorrow morning', measurement: null },
    { label: 'Measure blood pressure at rest', measurement: 'bp' },
    { label: 'Measure SpO₂ at rest', measurement: 'spo2' },
    { label: 'Measure oral temperature', measurement: 'temperature' },
];

registerActions({
    'record-review': async (el) => {
        const f = el as HTMLFormElement;
        const fd = new FormData(f);
        const note = String(fd.get('note') ?? '').trim();
        if (!note) {
            (f.querySelector('#review-note') as HTMLElement).focus();
            f.querySelector('#note-err')!.removeAttribute('hidden');
            return;
        }
        const fu = String(fd.get('followup') ?? '');
        const preset = FOLLOW_UPS[Number(fu)];
        await repo.recordReview(ws(), String(f.dataset.key), me(), note, fu !== '' && preset ? { label: preset.label, measurement: preset.measurement, reason: note } : null, app.now);
        f.reset();
        toast(preset ? `Review recorded. Follow-up request sent to the crew member on board.` : 'Review recorded.');
        await bus.refresh();
    },
    'send-followup': async (el) => {
        const f = el as HTMLFormElement;
        const fd = new FormData(f);
        const preset = FOLLOW_UPS[Number(fd.get('preset'))];
        const reason = String(fd.get('reason') ?? '').trim() || 'Requested by your crew medical officer.';
        await repo.createFollowUp(ws(), String(f.dataset.crew), me(), preset.label, reason, preset.measurement, app.now);
        f.reset();
        toast('Follow-up request sent on board.');
        await bus.refresh();
    },
    'add-lab': async (el) => {
        const f = el as HTMLFormElement;
        const fd = new FormData(f);
        const analyte = String(fd.get('analyte')) as Analyte;
        const value = Number(String(fd.get('value')).replace(',', '.'));
        if (!Number.isFinite(value)) {
            (f.querySelector('#lab-value') as HTMLElement).focus();
            toast('Enter the result value as a number.');
            return;
        }
        const c = cfg();
        const toIso = (k: string) => {
            const d = String(fd.get(`${k}Day`) ?? '');
            const t = String(fd.get(`${k}Time`) ?? '');
            if (!d) return null;
            const [h, m] = (t || '00:00').split(':').map(Number);
            return new Date(Date.parse(c.epoch) + (Number(d) - 1) * 86_400_000 + (h * 60 + m) * 60_000).toISOString();
        };
        const unit = String(fd.get('unit') ?? '') || null;
        const low = Number(String(fd.get('low')).replace(',', '.'));
        const high = Number(String(fd.get('high')).replace(',', '.'));
        const hasInterval = String(fd.get('low')) !== '' && String(fd.get('high')) !== '' && Number.isFinite(low) && Number.isFinite(high);
        await repo.addLab(ws(), {
            crewId: String(f.dataset.crew),
            analyte,
            value,
            unit,
            specimen: String(fd.get('specimen')),
            method: String(fd.get('method')),
            lab: 'On-board analyser',
            status: String(fd.get('status')) as LabStatus,
            collectedAt: toIso('coll'),
            analysedAt: toIso('anal'),
            issuedAt: null,
            interval: hasInterval ? { low, high, unit: LAB_META[analyte].baseUnit, source: String(fd.get('ivSource') || 'Entered by CMO'), population: 'As stated by the source', confirmedByCmo: fd.get('ivConfirm') === 'on' } : null,
            labFlag: String(fd.get('flag') ?? '') || null,
            author: me(),
            source: 'manual',
        }, app.now, String(fd.get('supersedes') ?? '') || null);
        f.reset();
        toast(`${LAB_META[analyte].name} saved in the member file.`);
        await bus.refresh();
    },
});

async function memberState(crewId: string) {
    const c = cfg();
    const day = missionDay(app.now, c.epoch);
    const [ci, alerts, reqs, symptoms] = await Promise.all([repo.checkinFor(ws(), crewId, day), repo.alertsFor(ws(), crewId), repo.requestsFor(ws(), crewId), pendingSymptomReports(crewId)]);
    const pendingAlert = alerts.find((a) => a.status === 'needs-review');
    const reviewReq = reqs.find((r) => r.kind === 'review-request' && r.status === 'open');
    return { ci, pendingAlert, reviewReq, symptoms };
}

export async function renderCrew(): Promise<Html> {
    if (app.role !== 'cmo') return html`${pageHead('Crew console')}<div class="card">${icon('info')} The crew console is for the crew medical officer. Switch role to CMO.</div>`;
    const id = app.route.segments[1];
    if (id === 'teammates') return renderTeammates();
    if (id) return renderMember(id);
    const c = cfg();
    const queue = await reviewItems(ws());
    const fromGround = (await repo.groundNotes(ws())).filter((n) => n.deliveredAt);
    const houston = html`<section class="card houston" id="houston" aria-labelledby="hou-h">
      <div class="card-h"><h3 id="hou-h">From Houston</h3><small>${app.groundLink ? 'Ground link up' : 'Ground link offline · new notes wait on Earth'}</small></div>
      ${fromGround.length
          ? html`<ol class="gn-list">${fromGround.slice(0, 3).map((n) => html`<li class="gn"><p>${n.text}</p><p class="gn-meta">${repo.memberStatic(ws(), n.authorId).alias} · <span class="mono">${hhmm(Date.parse(n.deliveredAt!))} UTC</span>${n.crewId ? ` · about ${repo.memberStatic(ws(), n.crewId).shortName}` : ''}</p></li>`)}</ol>`
          : html`<p class="muted small">No note from the flight surgeon. Houston only sees the reports you choose to send.</p>`}
    </section>`;
    return html`
    ${pageHead('Review queue', html`${repo.memberStatic(ws(), me()).alias} · crew medical officer`, html`<div class="head-tags">${c.rules.length ? demoRuleTag() : badge('No mission rule configured', 'muted', 'info')}</div>`)}
    <div class="cmo-top">
  <section class="card review-queue" aria-labelledby="queue-h">
      <div class="card-h"><div><span class="mission-kicker">On-board care</span><h2 id="queue-h">Review queue</h2></div>${badge(`${queue.filter(i => !i.waitingForCrew).length} ready for review`, 'info', 'review')}</div>
      <p class="hint">Open a case to see observations, the sleep trend and any photo. Follow-up responses return to the same file.</p>
      ${queue.length ? html`<div class="review-list">${queue.map(i => html`<a class="review-row" href="${i.href}" data-link><span class="av">${repo.memberStatic(ws(),i.crewId).initials}</span><span><b>${repo.memberStatic(ws(),i.crewId).alias}</b><span>${i.reason}</span><small class="mono">${utcStamp(Date.parse(i.at))} · Day ${missionDay(Date.parse(i.at),c.epoch)}</small></span>${badge(i.status, i.waitingForCrew ? 'muted' : 'review', i.waitingForCrew ? 'clock' : 'review')}<span class="rr-act">${i.waitingForCrew ? 'Waiting for the crew' : i.status === 'Response received' ? 'Read the reply' : i.href.includes('symptom=') ? 'Look at the photo' : 'Review the evidence'}${icon('arrow','sm')}</span></a>`)}</div>` : html`<div class="empty-q">${icon('ok')}<p>No review waiting. New observations and crew replies appear here.</p></div>`}
    </section>
      ${houston}
    </div>`;
}

async function renderTeammates(): Promise<Html> {
    const day = missionDay(app.now, cfg().epoch);
    const [members, queue] = await Promise.all([repo.members(ws()), reviewItems(ws())]);
    const rows = await Promise.all(members.filter(m => m.role !== 'ground').map(async m => {
        const [all, s, task] = await Promise.all([repo.currentObservations(ws(), m.id), memberState(m.id), repo.todaysTask(ws(), m.id, app.now)]);
        const diary = new Map(all.filter(o => o.variable === 'sleep_main' && o.method === SLEEP_RULE.method).map(o => [o.missionDay, o]));
        const latest = (v: Variable) => all.filter(o => o.variable === v).sort((a, b) => b.measuredAt.localeCompare(a.measuredAt))[0];
        return { m, s, task, diary, drowsy: latest('drowsiness'), hr: latest('resting_hr'), bp: latest('bp'), mood: latest('mood') };
    }));
    const week = Array.from({ length: 7 }, (_, i) => day - 6 + i);
    const expected = rows.filter(({ task, s }) => (task && task.ev.state !== 'off') || s.ci?.status === 'submitted');
    const submitted = expected.filter(({ s }) => s.ci?.status === 'submitted').length;
    const overdue = expected.filter(({ task, s }) => task?.ev.state === 'due' && s.ci?.status !== 'submitted');
    const review = queue.filter(i => !i.waitingForCrew);
    const watchCount = overdue.length + review.length;
    const nights = rows.flatMap(({ diary }) => week.map(d => diary.get(d)?.value)).filter((v): v is number => v != null);
    const average = nights.length ? formatMinutes(Math.round(nights.reduce((a, b) => a + b, 0) / nights.length)) : null;
    const reading = (o: { missionDay: number; quality: string } | undefined, value: string | number | undefined) =>
        value == null || !o || o.quality === 'not-recorded' ? '—' : html`${value}${o.missionDay < day ? html`<sup title="Day ${o.missionDay}">*</sup>` : ''}`;
    return html`
    ${pageHead('Team', html`Crew medical officer · ${repo.memberStatic(ws(), me()).alias}`)}
    <div class="teammates-summary">
      <span>${expected.length ? html`Today · <b>${submitted} of ${expected.length} check-ins</b>` : 'No check-ins scheduled today'}${overdue.length ? html` · <span class="teammates-overdue">${overdue.map(({ m }) => m.shortName).join(', ')} overdue</span>` : ''}</span>
      <a href="/check-in/crew" data-link>Crew check-ins ${icon('arrow', 'sm')}</a>
    </div>
    <div class="teammates-grid">
      <div class="cmo-board">
        <section class="card board" aria-labelledby="crew-h">
          <div class="card-h"><h3 id="crew-h">Crew board</h3><small>Latest values · select a member for the file</small></div>
          <div class="bd" role="table" aria-label="Crew board">
            <div class="bd-hd" role="row"><span role="columnheader">Member</span><span role="columnheader">Sleep</span><span role="columnheader">Rest HR</span><span role="columnheader">BP</span><span role="columnheader">Mood</span><span role="columnheader">Drowsy</span><span role="columnheader">Check-in</span></div>
            ${rows.map(({ m, s, task, diary, drowsy, hr, bp, mood }) => {
                const last = [...diary.values()].sort((a, b) => b.missionDay - a.missionDay)[0];
                const tone = s.pendingAlert ? 'al' : s.reviewReq || s.symptoms || s.ci?.status !== 'submitted' ? 'wt' : 'ok';
                return html`<a class="bd-row" role="row" href="/crew/${m.id}" data-link>
                  <span class="bd-who" role="cell"><span class="av ${tone}">${m.initials}</span><span><b>${m.alias}</b><small>${m.title}</small></span></span>
                  <span data-label="Sleep" class="cell ${sleepZone(last?.value ?? null) ?? 'na'}" role="cell">${reading(last, last?.value == null ? undefined : formatMinutes(last.value))}</span>
                  <span data-label="Rest HR" class="cell ${hr ? '' : 'na'}" role="cell">${reading(hr, hr?.value ?? undefined)}</span>
                  <span data-label="BP" class="cell ${bp ? (bp.quality === 'check' ? 'wt' : '') : 'na'}" role="cell">${reading(bp, bp?.value != null && bp.value2 != null ? `${bp.value}/${bp.value2}` : undefined)}</span>
                  <span data-label="Mood" class="cell ${mood ? '' : 'na'}" role="cell">${reading(mood, mood?.value == null ? undefined : `${mood.value}/5`)}</span>
                  <span data-label="Drowsy" class="cell ${drowsy ? '' : 'na'}" role="cell">${reading(drowsy, drowsy?.value ?? undefined)}</span>
                  <span data-label="Check-in" class="cell ci ${task?.ev.state === 'due' ? 'miss' : ''}" role="cell">${s.ci?.status === 'submitted' ? hhmm(Date.parse(s.ci.submittedAt!)) : task && task.ev.state !== 'off' ? 'Not yet' : '—'}</span>
                </a>`;
            })}
          </div>
          <div class="bd-leg"><span><i class="lg-c ok"></i>In zone</span><span><i class="lg-c wt"></i>To watch</span><span><i class="lg-c al"></i>Out of zone</span><span><i class="lg-c na"></i>No reading</span><span>* Earlier reading</span><span class="bd-leg-n">Demo zones</span></div>
        </section>
        <section class="card" aria-labelledby="sl-h">
          <div class="card-h"><h3 id="sl-h">Crew sleep · 7 nights</h3><small>Demo zones · 7 h and more, 6 to 7 h, under 6 h</small></div>
          <div class="sl-grid" role="table" aria-label="Crew sleep diary, last 7 nights">
            <span class="h" role="columnheader"></span>${week.map((d) => html`<span class="h" role="columnheader">D${d}</span>`)}
            ${rows.map(({ m, diary }) => html`<span class="n" role="rowheader">${m.shortName}</span>${week.map((d) => {
                const o = diary.get(d);
                return html`<span class="slc ${o ? (sleepZone(o.value) ?? '').replace('ok', '') : 'na'}" role="cell">${o ? (o.value === null ? 'n/r' : `${Math.floor(o.value / 60)}h${String(o.value % 60).padStart(2, '0')}`) : '—'}</span>`;
            })}`)}
          </div>
          <p class="sl-foot">${average ? html`Crew average · <b>${average}</b> across ${nights.length} recorded diary nights.` : 'No diary nights recorded for this week.'}</p>
        </section>
      </div>
      <section class="card teammates-watch" aria-labelledby="watch-h">
        <div class="card-h"><div><h3 id="watch-h">Duty watch</h3><small>Day ${day} · ${watchCount} open</small></div>${badge(String(watchCount), watchCount ? 'review' : 'ok', 'clock')}</div>
        ${watchCount ? html`<ul class="watch-list">
          ${overdue.map(({ m, task }) => html`<li><a href="/check-in/crew#checkin-${m.id}" data-link>${icon('clock', 'sm')}<span><b>${m.alias} · Check-in overdue</b><small>Due ${hhmm(task!.ev.effectiveDue)} UTC</small></span>${icon('arrow', 'sm')}</a></li>`)}
          ${review.map(i => html`<li><a href="${i.href}" data-link>${icon('review', 'sm')}<span><b>${repo.memberStatic(ws(), i.crewId).alias}</b><small>${i.reason}</small></span>${icon('arrow', 'sm')}</a></li>`)}
        </ul>` : html`<p class="muted small">No check-ins overdue or reviews waiting.</p>`}
      </section>
    </div>`;
}

async function renderMember(crewId: string): Promise<Html> {
    const c = cfg();
    const m = repo.memberStatic(ws(), crewId);
    const day = missionDay(app.now, c.epoch);
    const [obs, alerts, reqs, labsAll, reports] = await Promise.all([repo.currentObservations(ws(), crewId), repo.alertsFor(ws(), crewId), repo.requestsFor(ws(), crewId), repo.labsFor(ws(), crewId), repo.reportsFor(ws(), crewId)]);
    const labs = labsAll.filter((l) => !l.supersededBy);
    const hlAlert = app.route.query.get('alert');
    const hlReq = app.route.query.get('request');
    const latest = (v: Variable) => obs.filter((o) => o.variable === v && (v !== 'sleep_main' || o.method === SLEEP_RULE.method)).sort((a, b) => b.measuredAt.localeCompare(a.measuredAt))[0];
    const tracked: Variable[] = ['sleep_main', 'drowsiness', 'mood', 'symptoms', 'resting_hr', 'bp', 'spo2', 'temperature', 'glucose'];
    const week = Array.from({ length: 7 }, (_, i) => day - 6 + i);
    const diary = new Map(obs.filter((o) => o.variable === 'sleep_main' && o.method === SLEEP_RULE.method).map((o) => [o.missionDay, o]));

    return html`
    <p class="crumbs"><a href="/crew/teammates" data-link>${icon('back')}Team</a> <a href="/crew" data-link>Review queue</a></p>
    ${pageHead(m.alias, html`${m.title} · member file · Day ${day}`, html`<div class="head-tags"><a class="btn btn-ghost btn-small" href="/trends?member=${crewId}" data-link>${icon('trends')}Trends</a><a class="btn btn-ghost btn-small" href="/reports?member=${crewId}" data-link>${icon('report')}Report</a></div>`)}

    <div class="grid-2 med-row">
      ${medicalCard(crewId)}
      <section class="card" aria-labelledby="medt-h"><div class="card-h"><h2 id="medt-h">Medications taken</h2><small>Logged by ${m.shortName}</small></div>${medList(await medsFor(crewId), 'Nothing logged by the crew member.')}</section>
    </div>
    ${alerts.map((a) => {
        const ev = obs.filter((o) => a.evidenceIds.includes(o.id)).sort((x, y) => x.missionDay - y.missionDay);
        return html`<section class="card alert-card ${a.key === hlAlert ? 'req-hl' : ''} ${a.status === 'reviewed' ? 'is-reviewed' : ''}" aria-labelledby="al-${a.startDay}">
          <p class="prio-k">${demoRuleTag()} ${badge(a.status === 'reviewed' ? 'Reviewed' : 'Crew review pending', a.status === 'reviewed' ? 'ok' : 'review', a.status === 'reviewed' ? 'ok' : 'review')} <span class="mono">${utcStamp(Date.parse(a.createdAt))}</span></p>
          <h2 id="al-${a.startDay}">Sleep trend needs review</h2>
          <p>${SLEEP_RULE.label}: ${SLEEP_RULE.description} Days ${a.startDay}–${a.endDay}.</p>
          <ol class="evidence">${ev.map((o) => html`<li><span>Day ${o.missionDay}</span><b class="mono">${formatMinutes(o.value)}</b><small>${o.method} · ${sourceLabel(o)} · ${hhmm(Date.parse(o.measuredAt))} UTC</small></li>`)}</ol>
          <p class="fine">Context: drowsiness ${ev.map((o) => obs.find((x) => x.variable === 'drowsiness' && x.missionDay === o.missionDay)?.value ?? '—').join(' · ')} (1–9), mood ${ev.map((o) => obs.find((x) => x.variable === 'mood' && x.missionDay === o.missionDay)?.value ?? '—').join(' · ')} (1–5). Demo rule, not a clinical threshold.</p>
          ${a.reviews.map((r) => html`<div class="req-answer"><b>Review · ${repo.memberStatic(ws(), r.byId).alias}</b> <span class="mono">${utcStamp(Date.parse(r.at))}</span><p>${r.note}</p>${r.requestId ? html`<small>Follow-up request sent.</small>` : ''}</div>`)}
          ${a.status === 'needs-review' ? html`
          <details class="protocol" open>
            <summary>${icon('review', 'sm')}What to do · on-board steps (demo protocol)</summary>
            <ol>
              <li><b>Check the nights.</b> Same method on each night (sleep diary)? A missing night stays missing.</li>
              <li><b>Talk with ${m.shortName}.</b> Sleep station noise, light, workload, caffeine, worries, any symptom.</li>
              <li><b>Decide on board.</b> Record your review; if useful, request a follow-up (blood pressure at rest, sleep clarification) or adjust the schedule.</li>
              <li><b>Earth only if needed.</b> Generate a report and queue it for Houston. It leaves when the ground link is up.</li>
            </ol>
            <p class="fine">Demo guidance for the prototype, not a clinical protocol.</p>
          </details>
          <form class="review-form" data-action="record-review" data-key="${a.key}" novalidate>
            <div class="field"><label for="review-note">Your review</label><textarea id="review-note" name="note" rows="2" maxlength="400" placeholder="e.g. Trend confirmed, noise near sleep station reported"></textarea><p class="error" id="note-err" hidden>${icon('review')}Write a short note to record the review.</p></div>
            <div class="field"><label for="review-fu">Request a follow-up (optional)</label><select id="review-fu" name="followup"><option value="">No follow-up</option>${FOLLOW_UPS.map((f, i) => html`<option value="${i}">${f.label}</option>`)}</select></div>
            <button class="btn btn-primary" type="submit">${icon('ok')}Record review</button>
          </form>` : ''}
        </section>`;
    })}

    <div class="grid-2">
      <section class="card" aria-labelledby="obs-h">
        <h2 id="obs-h">Latest observations</h2>
        <div class="week" role="img" aria-label="Sleep diary, last 7 days">${week.map((d) => {
            const o = diary.get(d);
            return html`<span class="wk ${o ? `wk-${sleepZone(o.value) ?? 'ok'}` : 'wk-miss'}"><small>D${d}</small><b class="mono">${o ? (o.value === null ? 'n/r' : `${Math.floor(o.value / 60)}h${String(o.value % 60).padStart(2, '0')}`) : '—'}</b></span>`;
        })}</div>
        <div class="table-wrap"><table>
          <thead><tr><th scope="col">Indicator</th><th scope="col">Value</th><th scope="col">When</th><th scope="col">Quality</th></tr></thead>
          <tbody>${tracked.map((v) => {
              const o = latest(v);
              return o ? html`<tr><td>${VARIABLE_META[v].label}<small class="ctx">${o.method}</small></td><td>${obsValue(o)}</td><td class="mono">Day ${o.missionDay} ${hhmm(Date.parse(o.measuredAt))}</td><td>${qualityBadge(o)}</td></tr>` : html`<tr class="row-gap"><td>${VARIABLE_META[v].label}</td><td colspan="3">${badge('No reading', 'muted', 'missing')}</td></tr>`;
          })}</tbody>
        </table></div>
      </section>

      <section class="card" aria-labelledby="req-h">
        <h2 id="req-h">Requests and follow-up</h2>
        ${reqs.length ? reqs.map((r) => requestCard(r, 'cmo', r.id === hlReq)) : html`<p class="muted">No request yet.</p>`}
        <form class="followup-form" data-action="send-followup" data-crew="${crewId}">
          <h3>Request a follow-up</h3>
          <div class="field"><label for="fu-preset">What</label><select id="fu-preset" name="preset">${FOLLOW_UPS.map((f, i) => html`<option value="${i}">${f.label}</option>`)}</select></div>
          <div class="field"><label for="fu-reason">Reason (shown to the crew member)</label><input id="fu-reason" name="reason" maxlength="200"></div>
          <button class="btn btn-ghost" type="submit">${icon('send')}Send request on board</button>
        </form>
      </section>
    </div>

    ${await symptomSection('cmo', crewId, app.route.query.get('symptom'))}

    <section class="card" id="labs" aria-labelledby="labs-h">
      <h2 id="labs-h">Lab results</h2>
      <p class="hint">Haemoglobin and haematocrit only. Compared to an applicable closed interval, bounds included, before rounding. The lab flag is kept separately.</p>
      ${labs.length ? html`<div class="table-wrap"><table>
        <thead><tr><th scope="col">Analyte</th><th scope="col">Result</th><th scope="col">Normalised</th><th scope="col">Interval</th><th scope="col">Comparison</th><th scope="col">Collected · analysed</th><th scope="col">Status · flag</th></tr></thead>
        <tbody>${labs.map((l) => {
            const n = normalizeLab(l.analyte, l.value, l.unit);
            const verdict = compareToInterval(l);
            const delay = hoursBetween(l.collectedAt, l.analysedAt);
            return html`<tr>
              <td>${LAB_META[l.analyte].name}<small class="ctx">LOINC ${l.loinc} · ${l.specimen}</small></td>
              <td class="mono">${l.value} ${l.unit ?? html`<span class="badge badge-review">unit missing</span>`}${l.version > 1 ? html` <small>v${l.version}</small>` : ''}</td>
              <td class="mono">${n === null ? '—' : `${n} ${LAB_META[l.analyte].baseUnit}`}</td>
              <td>${l.interval ? html`<span class="mono">${l.interval.low}–${l.interval.high} ${l.interval.unit}</span><small class="ctx">${l.interval.source}${l.interval.confirmedByCmo ? ' · confirmed by CMO' : ' · not confirmed'}</small>` : html`<span class="muted">—</span>`}</td>
              <td>${badge(verdict, verdict === 'Within' ? 'ok' : verdict === 'Below' || verdict === 'Above' ? 'info' : 'muted', verdict === 'Within' ? 'ok' : 'info')}</td>
              <td>${l.collectedAt ? html`<span class="mono">Day ${missionDay(Date.parse(l.collectedAt), c.epoch)} ${hhmm(Date.parse(l.collectedAt))}</span>` : html`${badge('Collection date missing — verify', 'review', 'review')}`}${delay !== null ? html`<small class="ctx">${delay} h to analysis</small>` : ''}</td>
              <td>${l.status}${l.labFlag ? html` · lab flag <b>${l.labFlag}</b>` : ''}</td>
            </tr>`;
        })}</tbody>
      </table></div>` : html`<p class="muted">No lab result for this member.</p>`}
      <details class="lab-add">
        <summary>${icon('plus')}Enter a lab result</summary>
        <form data-action="add-lab" data-crew="${crewId}" class="form-grid" novalidate>
          <div class="field"><label for="lab-analyte">Analyte</label><select id="lab-analyte" name="analyte"><option value="Hb">Haemoglobin (Hb) · LOINC 718-7</option><option value="Hct">Haematocrit (Hct) · LOINC 4544-3</option></select></div>
          <div class="field"><label for="lab-value">Value</label><input id="lab-value" name="value" inputmode="decimal" required></div>
          <div class="field"><label for="lab-unit">Unit as reported</label><select id="lab-unit" name="unit"><option value="g/L">g/L</option><option value="g/dL">g/dL</option><option value="%">%</option><option value="L/L">L/L</option><option value="">Not stated</option></select></div>
          <div class="field"><label for="lab-status">Status</label><select id="lab-status" name="status"><option value="final">Final</option><option value="corrected">Corrected</option><option value="preliminary">Preliminary</option><option value="unverified">Unverified</option></select></div>
          <div class="field"><label for="lab-specimen">Specimen</label><input id="lab-specimen" name="specimen" value="Venous whole blood"></div>
          <div class="field"><label for="lab-method">Method</label><input id="lab-method" name="method" value="Automated haematology analyser"></div>
          <div class="field"><label for="lab-collDay">Collected · mission day</label><input id="lab-collDay" name="collDay" inputmode="numeric" value="${day}"></div>
          <div class="field"><label for="lab-collTime">Collected · time UTC</label><input id="lab-collTime" name="collTime" type="time" value="07:30"></div>
          <div class="field"><label for="lab-analDay">Analysed · mission day</label><input id="lab-analDay" name="analDay" inputmode="numeric"></div>
          <div class="field"><label for="lab-analTime">Analysed · time UTC</label><input id="lab-analTime" name="analTime" type="time"></div>
          <div class="field"><label for="lab-low">Interval low (g/L or %)</label><input id="lab-low" name="low" inputmode="decimal"></div>
          <div class="field"><label for="lab-high">Interval high (g/L or %)</label><input id="lab-high" name="high" inputmode="decimal"></div>
          <div class="field"><label for="lab-ivSource">Interval source</label><input id="lab-ivSource" name="ivSource" placeholder="e.g. laboratory report"></div>
          <div class="field"><label for="lab-flag">Lab flag (as printed)</label><input id="lab-flag" name="flag" maxlength="4"></div>
          <div class="field"><label for="lab-supersedes">Corrects an earlier result</label><select id="lab-supersedes" name="supersedes"><option value="">No, new result</option>${labs.map((l) => html`<option value="${l.id}">${l.analyte} ${l.value} ${l.unit ?? ''} (v${l.version})</option>`)}</select></div>
          <label class="check"><input type="checkbox" name="ivConfirm" checked> I confirm the interval applies (method, specimen, population)</label>
          <div class="form-actions"><button class="btn btn-primary" type="submit">Save lab result</button></div>
        </form>
      </details>
    </section>

    <section class="card" aria-labelledby="rep-h">
      <div class="card-h"><h2 id="rep-h">Reports for ${m.shortName}</h2><a class="btn btn-ghost btn-small" href="/reports?member=${crewId}" data-link>New report</a></div>
      ${reports.length ? html`<ul class="rep-list">${reports.map((r) => html`<li><a href="/reports?report=${r.id}" data-link>Day ${r.fromDay}–${r.toDay} · ${utcStamp(Date.parse(r.createdAt))}</a> ${queueBadge(r.queue.state)}</li>`)}</ul>` : html`<p class="muted">No report generated yet.</p>`}
    </section>`;
}

/** Opening a notification link from the console marks it read. */
registerActions({});
document.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>('[data-read]');
    if (a) void repo.markRead(a.dataset.read!, app.now);
}, true);
