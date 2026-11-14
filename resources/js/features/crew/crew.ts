import { bus } from '../../bus';
import { icon } from '../../components/icons';
import { badge, demoRuleTag, obsValue, pageHead, qualityBadge, queueBadge, simTag, sourceLabel, toast } from '../../components/ui';
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
    const [ci, alerts, reqs, labs] = await Promise.all([repo.checkinFor(ws(), crewId, day), repo.alertsFor(ws(), crewId), repo.requestsFor(ws(), crewId), repo.labsFor(ws(), crewId)]);
    const pendingAlert = alerts.find((a) => a.status === 'needs-review');
    const reviewReq = reqs.find((r) => r.kind === 'review-request' && r.status === 'open');
    const answered = reqs.find((r) => r.kind === 'follow-up' && r.status === 'answered');
    const symptoms = await pendingSymptomReports(crewId);
    const outOfRange = labs.filter((l) => !l.supersededBy && ['Below', 'Above'].includes(compareToInterval(l)));
    let state: Html;
    if (pendingAlert) state = html`${badge('Crew review pending', 'review', 'review')}`;
    else if (reviewReq) state = badge('Crew review requested', 'review', 'review');
    else if (symptoms) state = badge('Symptom report to review', 'review', 'camera');
    else if (ci?.status === 'submitted') state = badge('Check-in today', 'ok', 'ok');
    else state = badge('No check-in yet today', 'muted', 'missing');
    return { ci, pendingAlert, reviewReq, answered, outOfRange, state, symptoms };
}

export async function renderCrew(): Promise<Html> {
    if (app.role !== 'cmo') return html`${pageHead('Crew console')}<div class="card">${icon('info')} The crew console is for the crew medical officer. Switch role to CMO.</div>`;
    const id = app.route.segments[1];
    if (id) return renderMember(id);
    const c = cfg();
    const day = missionDay(app.now, c.epoch);
    const astronauts = (await repo.members(ws())).filter((m) => m.role === 'astronaut');
    const queue = await reviewItems(ws());
    const rows = await Promise.all(
        astronauts.map(async (m) => {
            const all = await repo.currentObservations(ws(), m.id);
            const diary = new Map(all.filter((o) => o.variable === 'sleep_main' && o.method === SLEEP_RULE.method).map((o) => [o.missionDay, o]));
            const latest = (v: Variable) => all.filter((o) => o.variable === v).sort((a, b) => b.measuredAt.localeCompare(a.measuredAt))[0];
            return { m, s: await memberState(m.id), diary, drowsy: latest('drowsiness'), hr: latest('resting_hr'), bp: latest('bp') };
        }),
    );
    const week = Array.from({ length: 7 }, (_, i) => day - 6 + i);
    const fromGround = (await repo.groundNotes(ws())).filter((n) => n.deliveredAt);
    const houston = html`<section class="card houston" id="houston" aria-labelledby="hou-h">
      <div class="card-h"><h3 id="hou-h">From Houston</h3><small>${app.groundLink ? 'Ground link up' : 'Ground link offline · new notes wait on Earth'}</small></div>
      ${fromGround.length
          ? html`<ol class="gn-list">${fromGround.slice(0, 3).map((n) => html`<li class="gn"><p>${n.text}</p><p class="gn-meta">${repo.memberStatic(ws(), n.authorId).alias} · <span class="mono">${hhmm(Date.parse(n.deliveredAt!))} UTC</span>${n.crewId ? ` · about ${repo.memberStatic(ws(), n.crewId).shortName}` : ''}</p></li>`)}</ol>`
          : html`<p class="muted small">No note from the flight surgeon. Houston only sees the reports you choose to send.</p>`}
    </section>`;
    return html`
    ${pageHead('Review queue', html`${repo.memberStatic(ws(), me()).alias} · crew medical officer`, html`<div class="head-tags">${simTag()}${c.rules.length ? demoRuleTag() : badge('No mission rule configured', 'muted', 'info')}</div>`)}
    <div class="cmo-top">
  <section class="card review-queue" aria-labelledby="queue-h">
      <div class="card-h"><div><span class="mission-kicker">On-board care</span><h2 id="queue-h">Review queue</h2></div>${badge(`${queue.filter(i => !i.waitingForCrew).length} ready for review`, 'info', 'review')}</div>
      <p class="hint">Open a case to see observations, the sleep trend and any photo. Follow-up responses return to the same file.</p>
      ${queue.length ? html`<div class="review-list">${queue.map(i => html`<a class="review-row" href="${i.href}" data-link><span class="av">${repo.memberStatic(ws(),i.crewId).initials}</span><span><b>${repo.memberStatic(ws(),i.crewId).alias}</b><span>${i.reason}</span><small class="mono">${utcStamp(Date.parse(i.at))} · Day ${missionDay(Date.parse(i.at),c.epoch)}</small></span>${badge(i.status, i.waitingForCrew ? 'muted' : 'review', i.waitingForCrew ? 'clock' : 'review')}<span class="rr-act">${i.waitingForCrew ? 'Waiting for the crew' : i.status === 'Response received' ? 'Read the reply' : i.href.includes('symptom=') ? 'Look at the photo' : 'Review the evidence'}${icon('arrow','sm')}</span></a>`)}</div>` : html`<div class="empty-q">${icon('ok')}<p>No review waiting. New observations and crew replies appear here.</p></div>`}
    </section>
      ${houston}
    </div>
    <h2 class="sec-h">Crew at a glance</h2>
    <div class="cmo-board">
        <section class="card board" aria-labelledby="crew-h">
          <div class="card-h"><h3 id="crew-h">Crew board</h3><small>Latest values · select a member for the file</small></div>
          <div class="bd" role="table" aria-label="Crew board">
            <div class="bd-hd" role="row"><span role="columnheader">Member</span><span role="columnheader">Check-in</span><span role="columnheader">Last night</span><span role="columnheader">Drowsy</span><span role="columnheader">Rest HR</span><span role="columnheader">BP</span><span role="columnheader">State</span></div>
            ${rows.map(({ m, s, diary, drowsy, hr, bp }) => {
                const last = [...diary.values()].sort((a, b) => b.missionDay - a.missionDay)[0];
                const tone = s.pendingAlert ? 'al' : s.reviewReq || s.symptoms || s.ci?.status !== 'submitted' ? 'wt' : 'ok';
                return html`<a class="bd-row" role="row" href="/crew/${m.id}" data-link>
                  <span class="bd-who" role="cell"><span class="av ${tone}">${m.initials}</span><span><b>${m.alias}</b><small>${m.title}</small></span></span>
                  <span data-label="Check-in" class="cell ci ${s.ci?.status === 'submitted' ? '' : 'miss'}" role="cell">${s.ci?.status === 'submitted' ? hhmm(Date.parse(s.ci.submittedAt!)) : 'Not yet'}</span>
                  <span data-label="Last night" class="cell ${last ? (sleepZone(last.value) ?? '').replace('ok', '') : 'na'}" role="cell">${last ? `${Math.floor((last.value ?? 0) / 60)}h${String((last.value ?? 0) % 60).padStart(2, '0')}` : '—'}</span>
                  <span data-label="Drowsy" class="cell ${drowsy ? '' : 'na'}" role="cell">${drowsy?.value ?? '—'}</span>
                  <span data-label="Rest HR" class="cell ${hr ? '' : 'na'}" role="cell">${hr?.value ?? '—'}</span>
                  <span data-label="BP" class="cell ${bp ? (bp.quality === 'check' ? 'wt' : '') : 'na'}" role="cell">${bp ? `${bp.value}/${bp.value2}` : '—'}</span>
                  <span class="bd-state" role="cell">${s.state}${s.outOfRange.length ? html`<small>${s.outOfRange.length} lab outside interval</small>` : ''}</span>
                </a>`;
            })}
          </div>
          <div class="bd-leg"><span><i class="lg-c ok"></i>In zone</span><span><i class="lg-c wt"></i>To watch</span><span><i class="lg-c al"></i>Out of zone</span><span><i class="lg-c na"></i>No reading</span><span class="bd-leg-n">Demo zones</span></div>
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
          <p class="sl-foot">Diary nights only; actigraphy stays a separate series in each member file.</p>
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
    <p class="crumbs"><a href="/crew" data-link>${icon('back')}Review queue</a></p>
    ${pageHead(m.alias, html`${m.title} · member file · Day ${day}`, html`<div class="head-tags">${simTag()}<a class="btn btn-ghost btn-small" href="/trends?member=${crewId}" data-link>${icon('trends')}Trends</a><a class="btn btn-ghost btn-small" href="/reports?member=${crewId}" data-link>${icon('report')}Report</a></div>`)}

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
          <p class="fine">Context: drowsiness ${ev.map((o) => obs.find((x) => x.variable === 'drowsiness' && x.missionDay === o.missionDay)?.value ?? '—').join(' · ')} (1–9), mood ${ev.map((o) => obs.find((x) => x.variable === 'mood' && x.missionDay === o.missionDay)?.value ?? '—').join(' · ')} (1–5). Demo rule, not a clinical threshold. ${simTag()}</p>
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
