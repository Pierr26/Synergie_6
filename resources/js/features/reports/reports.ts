import { bus } from '../../bus';
import { icon } from '../../components/icons';
import { badge, pageHead, queueBadge, simTag, toast } from '../../components/ui';
import type { ReportRow } from '../../data/db';
import * as repo from '../../data/repo';
import { LAB_META } from '../../domain/labs';
import { formatValue, VARIABLE_META } from '../../domain/measurements';
import { QUEUE_LABEL, RECEIVER_LABEL, type ReceiverId } from '../../domain/queue';
import { formatMinutes, hhmm, missionDay, utcStamp } from '../../domain/time';
import type { Observation } from '../../domain/types';
import { html, type Html } from '../../lib/html';
import { registerActions } from '../../router-actions';
import { app, cfg, me, ws } from '../../state';

registerActions({
    'report-generate': async (el) => {
        const fd = new FormData(el as HTMLFormElement);
        const crewId = String(fd.get('member'));
        const toDay = Number(fd.get('toDay'));
        const fromDay = Number(fd.get('fromDay'));
        if (!Number.isInteger(fromDay) || !Number.isInteger(toDay) || fromDay > toDay) {
            toast('Choose a period where the first day is not after the last day.');
            return;
        }
        const r = await repo.generateReport(ws(), crewId, fromDay, toDay, me(), app.now);
        toast(`Report generated on this device for ${repo.memberStatic(ws(), crewId).alias}. Not queued yet.`);
        bus.navigate(`/reports?report=${r.id}`);
    },
    'report-print': () => window.print(),
    'report-queue': async (el) => {
        const receiver = (document.getElementById('receiver') as HTMLSelectElement).value as ReceiverId;
        await repo.queueReport(ws(), el.dataset.id!, receiver, app.now);
        toast(`Queued for ground · ${RECEIVER_LABEL[receiver]}. Same report ID and content on every attempt.`);
        await bus.refresh();
    },
    'report-retry': async (el) => {
        await repo.retryReport(ws(), el.dataset.id!);
        toast('Queued again with the same report ID and content.');
        await bus.refresh();
    },
});

interface Snap {
    reportId: string;
    label: string;
    workspace: string;
    mission: { id: string; name: string; timezone: string };
    member: { alias: string; title: string };
    period: { fromDay: number; toDay: number; days: number };
    author: string;
    generatedAtLabel: string;
    empty: boolean;
    observations: (Pick<Observation, 'variable' | 'value' | 'unit' | 'method' | 'quality' | 'context'> & { id: string; day: number; value2: number | null; text: string | null; comment: string | null; qualityNote: string | null; source: string; measuredAt: string; version: number })[];
    dailyGrid: Record<string, { day: number; value: string }[]>;
    personalReference: { median: number; nights: number; fromDay: number; toDay: number } | null;
    labs: { analyte: 'Hb' | 'Hct'; value: number; unit: string | null; specimen: string; status: string; collectedAt: string | null; analysedAt: string | null; interval: { low: number; high: number; unit: string; source: string } | null; verdict: string; labFlag: string | null; version: number }[];
    labsToVerify: { analyte: string; value: number; unit: string | null; note: string }[];
    rules: { id: string; version?: number; label: string; description?: string }[];
    alerts: { rule: string; startDay: number; endDay: number; status: string; reviews: { at: string; by: string; note: string }[] }[];
    followUps: { label: string; reason: string; status: string; createdAt: string; response: { at: string; text: string } | null }[];
}

export function reportDoc(r: ReportRow): Html {
    const s = JSON.parse(r.content) as Snap;
    const spot = s.observations.filter((o) => ['bp', 'spo2', 'temperature', 'glucose', 'resting_hr', 'mood', 'symptoms'].includes(o.variable));
    return html`<article class="report-doc print-area" aria-labelledby="rep-title">
      <header class="rep-head">
        <img src="/assets/brand/hexta-logo.svg" alt="HEXTA" width="46" height="56">
        <div><h2 id="rep-title">Individual crew health report</h2><p class="sim-line">${s.label} · ${s.workspace}</p></div>
      </header>
      <dl class="rep-meta">
        <dt>Crew member</dt><dd>${s.member.alias} · ${s.member.title}</dd>
        <dt>Mission</dt><dd>${s.mission.name} · ${s.mission.id} · times in ${s.mission.timezone}</dd>
        <dt>Period</dt><dd>Day ${s.period.fromDay} to Day ${s.period.toDay} (${s.period.days} days, inclusive)</dd>
        <dt>Author</dt><dd>${s.author}</dd>
        <dt>Generated</dt><dd class="mono">${s.generatedAtLabel}</dd>
        <dt>Report ID</dt><dd class="mono small">${s.reportId}</dd>
        <dt>Content SHA-256</dt><dd class="mono small">${r.sha256}</dd>
        <dt>Origin</dt><dd>Observations entered on board or from the versioned demo dataset, each with its method, unit and quality.</dd>
      </dl>
      ${s.empty ? html`<p class="notice">No observations in this period.</p>` : ''}
      <h3>Daily check-in</h3>
      <div class="table-wrap"><table class="rep-table">
        <thead><tr><th scope="col">Field</th>${s.dailyGrid.sleep_main.map((d) => html`<th scope="col">D${d.day}</th>`)}</tr></thead>
        <tbody>
          <tr><th scope="row">Main sleep, min<br><small>sleep diary</small></th>${s.dailyGrid.sleep_main.map((d) => html`<td class="mono ${d.value === 'Missing' || d.value === 'Not recorded' ? 'muted' : Number(d.value) < 360 ? 'low' : ''}">${d.value}</td>`)}</tr>
          ${s.dailyGrid.sleep_actigraphy ? html`<tr><th scope="row">Main sleep, min<br><small>actigraphy (simulated), separate series</small></th>${s.dailyGrid.sleep_actigraphy.map((d) => html`<td class="mono ${d.value === 'Missing' ? 'muted' : ''}">${d.value}</td>`)}</tr>` : ''}
          <tr><th scope="row">Drowsiness, 1–9<br><small>HEXTA scale</small></th>${s.dailyGrid.drowsiness.map((d) => html`<td class="mono ${d.value === 'Missing' ? 'muted' : ''}">${d.value}</td>`)}</tr>
        </tbody>
      </table></div>
      ${s.personalReference ? html`<p class="small">Personal reference: ${formatMinutes(s.personalReference.median)} (median of ${s.personalReference.nights} diary nights, Days ${s.personalReference.fromDay}–${s.personalReference.toDay}).</p>` : ''}
      <h3>Rules</h3>
      <ul class="small">${s.rules.map((ru) => html`<li>${ru.id === 'none' ? 'No mission rule configured.' : html`<b>${ru.id} v${ru.version}</b> · ${ru.label}: ${ru.description}`}</li>`)}</ul>
      ${s.alerts.length ? html`<h3>Signals and review</h3><ul class="small">${s.alerts.map((a) => html`<li><b>Sleep trend needs review</b> (${a.rule}, Demo rule) · Days ${a.startDay}–${a.endDay} · ${a.status === 'reviewed' ? 'Reviewed' : 'Needs review'}${a.reviews.map((rv) => html`<br>Review ${rv.by}, ${utcStamp(Date.parse(rv.at))}: “${rv.note}”`)}</li>`)}</ul>` : ''}
      <h3>Measurements</h3>
      ${spot.length ? html`<div class="table-wrap"><table class="rep-table">
        <thead><tr><th scope="col">Day · time</th><th scope="col">Indicator</th><th scope="col">Value</th><th scope="col">Method · context</th><th scope="col">Quality</th></tr></thead>
        <tbody>${spot.map((o) => html`<tr><td class="mono">D${o.day} ${hhmm(Date.parse(o.measuredAt))}</td><td>${VARIABLE_META[o.variable].label}</td><td class="mono">${formatValue({ ...o, value2: o.value2, text: o.text ?? undefined })}</td><td>${o.method}${Object.entries(o.context).map(([k, v]) => html`<br><small>${k}: ${v}</small>`)}</td><td>${o.quality === 'valid' ? 'Valid' : o.quality === 'check' ? html`Check measurement${o.qualityNote ? html`<br><small>${o.qualityNote}</small>` : ''}` : o.quality}</td></tr>`)}</tbody>
      </table></div>` : html`<p class="small muted">No spot measurement in this period.</p>`}
      <h3>Lab results</h3>
      ${s.labs.length ? html`<div class="table-wrap"><table class="rep-table">
        <thead><tr><th scope="col">Analyte</th><th scope="col">Result</th><th scope="col">Interval (source)</th><th scope="col">Comparison</th><th scope="col">Collected</th><th scope="col">Status</th></tr></thead>
        <tbody>${s.labs.map((l) => html`<tr><td>${LAB_META[l.analyte].name}</td><td class="mono">${l.value} ${l.unit ?? 'unit missing'}</td><td>${l.interval ? html`<span class="mono">${l.interval.low}–${l.interval.high} ${l.interval.unit}</span><br><small>${l.interval.source}</small>` : 'Reference unavailable'}</td><td>${l.verdict}${l.labFlag ? ` · lab flag ${l.labFlag}` : ''}</td><td class="mono">${l.collectedAt ? `D${missionDay(Date.parse(l.collectedAt), cfg().epoch)} ${hhmm(Date.parse(l.collectedAt))}` : '—'}</td><td>${l.status}</td></tr>`)}</tbody>
      </table></div>` : html`<p class="small muted">No lab result collected in this period.</p>`}
      ${s.labsToVerify.length ? html`<p class="small">${s.labsToVerify.length} result(s) without collection date kept in the member file for verification.</p>` : ''}
      <h3>Follow-up</h3>
      ${s.followUps.length ? html`<ul class="small">${s.followUps.map((f) => html`<li><b>${f.label}</b> · ${f.status} · ${utcStamp(Date.parse(f.createdAt))}${f.response ? html` — answer: “${f.response.text}”` : ''}</li>`)}</ul>` : html`<p class="small muted">No follow-up in this period.</p>`}
      <footer class="rep-foot">${s.label}. Demo rules are not clinical thresholds. Generated by HEXTA, a Synergy 5 prototype · not affiliated with NASA.</footer>
    </article>`;
}

function queuePanel(r: ReportRow): Html {
    const q = r.queue;
    return html`<section class="card queue-panel" aria-labelledby="q-h">
      <h2 id="q-h">Ground transmission</h2>
      <p class="queue-state">${queueBadge(q.state)} ${q.receiver ? html`to <b>${RECEIVER_LABEL[q.receiver]}</b>` : ''}</p>
      <ol class="q-steps">${(['queued', 'sending', 'received'] as const).map((st) => {
          const order = { 'not-queued': 0, queued: 1, sending: 2, received: 3, retry: 2 }[q.state];
          const idx = { queued: 1, sending: 2, received: 3 }[st];
          return html`<li class="${order >= idx ? 'done' : ''} ${q.state === 'retry' && st === 'sending' ? 'failed' : ''}">${QUEUE_LABEL[st]}</li>`;
      })}</ol>
      ${q.state === 'not-queued' ? html`
        <p class="hint">Queuing is your decision. The report keeps this ID and this frozen content on every attempt.</p>
        <div class="field"><label for="receiver">Receiver</label><select id="receiver"><option value="simulated-ground">Simulated ground receiver (default, works without the server)</option><option value="laravel-test">Laravel test receiver (same server, needs device network)</option></select></div>
        <button type="button" class="btn btn-primary" data-action="report-queue" data-id="${r.id}">${icon('send')}Queue for ground</button>` : ''}
      ${q.state === 'queued' && q.receiver === 'simulated-ground' && !app.groundLink ? html`<p class="notice">${icon('linkoff')}Ground link offline (simulated). The report waits in the queue on this device.</p>` : ''}
      ${q.state === 'queued' && q.receiver === 'laravel-test' && !app.browserOnline ? html`<p class="notice">${icon('device')}Device offline. The report waits until the network is back.</p>` : ''}
      ${q.state === 'retry' ? html`<p class="notice tone-error">${icon('retry')}${q.attempts[q.attempts.length - 1]?.detail}. Not received.</p><button type="button" class="btn btn-primary" data-action="report-retry" data-id="${r.id}">${icon('retry')}Retry with the same report</button>` : ''}
      ${q.receipt ? html`<div class="receipt" id="receipt">
          <h3>${icon('ok')}Receipt</h3>
          <dl class="defs"><dt>Receiver</dt><dd>${q.receipt.receiver}${q.receiver === 'simulated-ground' ? html` ${badge('Simulated', 'muted')}` : ''}</dd><dt>Received</dt><dd class="mono">${utcStamp(Date.parse(q.receipt.receivedAt))}</dd><dt>Receipt ID</dt><dd class="mono small">${q.receipt.receiptId}</dd><dt>Report ID</dt><dd class="mono small">${q.receipt.reportId}</dd><dt>Content match</dt><dd>${q.receipt.sha256 === r.sha256 ? 'SHA-256 identical' : 'Mismatch'}</dd>${q.receipt.replayed ? html`<dt>Note</dt><dd>Original receipt returned on retry: no duplicate.</dd>` : ''}</dl>
        </div>` : ''}
      ${q.attempts.length ? html`<details><summary>Attempts (${q.attempts.length})</summary><ol class="small">${q.attempts.map((a) => html`<li class="mono">${utcStamp(Date.parse(a.at))} · ${a.outcome} · ${a.detail}</li>`)}</ol></details>` : ''}
    </section>`;
}

export async function renderReports(): Promise<Html> {
    const c = cfg();
    const day = missionDay(app.now, c.epoch);
    const all = await repo.reportsFor(ws());
    const reports = app.role === 'cmo' ? all : all.filter((r) => r.crewId === me());
    const selId = app.route.query.get('report');
    const sel = reports.find((r) => r.id === selId);
    const astronauts = (await repo.members(ws())).filter((m) => m.role === 'astronaut');
    const memberQ = app.route.query.get('member') ?? c.astronautId;

    const generator = app.role === 'cmo' ? html`<form class="card gen" data-action="report-generate" aria-labelledby="gen-h">
        <h2 id="gen-h">New individual report</h2>
        <div class="form-grid">
          <div class="field"><label for="member">Crew member</label><select id="member" name="member">${astronauts.map((m) => html`<option value="${m.id}" ${m.id === memberQ ? 'selected' : ''}>${m.alias}</option>`)}</select></div>
          <div class="field"><label for="fromDay">From mission day</label><input id="fromDay" name="fromDay" inputmode="numeric" value="${day - 6}"></div>
          <div class="field"><label for="toDay">To mission day</label><input id="toDay" name="toDay" inputmode="numeric" value="${day}"></div>
        </div>
        <p class="hint">Seven days including today by default. The snapshot is frozen at generation: later corrections do not change it.</p>
        <button class="btn btn-primary" type="submit">${icon('report')}Generate report</button>
      </form>` : html`<p class="notice">${icon('info')}Reports are generated and queued by your crew medical officer. You can read the ones about you.</p>`;

    return html`
    ${pageHead('Reports', 'Individual snapshots, printable, queued for ground only when the CMO decides.', simTag())}
    <div class="reports">
      <div class="rep-side">
        ${generator}
        <section class="card" aria-labelledby="list-h">
          <h2 id="list-h">Generated reports</h2>
          ${reports.length ? html`<ul class="rep-list">${reports.map((r) => html`<li class="${r.id === selId ? 'active' : ''}"><a href="/reports?report=${r.id}" data-link><b>${repo.memberStatic(ws(), r.crewId).alias}</b><small>Day ${r.fromDay}–${r.toDay} · ${utcStamp(Date.parse(r.createdAt))}</small></a>${queueBadge(r.queue.state)}</li>`)}</ul>` : html`<p class="muted">No report yet.</p>`}
        </section>
      </div>
      <div class="rep-main">
        ${sel ? html`
          <div class="rep-actions"><button type="button" class="btn btn-ghost" data-action="report-print">${icon('print')}Print / Save as PDF</button></div>
          ${app.role === 'cmo' ? queuePanel(sel) : html`<p>${queueBadge(sel.queue.state)}</p>`}
          ${reportDoc(sel)}` : html`<div class="card empty-big">${icon('report')}<p>Select or generate a report to see its snapshot and transmission state.</p></div>`}
      </div>
    </div>`;
}
