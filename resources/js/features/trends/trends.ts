import { icon } from '../../components/icons';
import { badge, demoRuleTag, obsValue, pageHead, qualityBadge, simTag, sourceLabel } from '../../components/ui';
import * as repo from '../../data/repo';
import { formatValue, seriesKey, VARIABLE_META } from '../../domain/measurements';
import { personalReference, SLEEP_RULE } from '../../domain/sleep';
import { formatMinutes, hhmm, missionDay } from '../../domain/time';
import type { Observation, Variable } from '../../domain/types';
import { escape, html, raw, type Html } from '../../lib/html';
import { app, cfg, me, ws } from '../../state';

const METRICS: Variable[] = ['sleep_main', 'drowsiness', 'mood', 'resting_hr', 'bp', 'spo2', 'temperature', 'glucose'];
const DAILY: Variable[] = ['sleep_main', 'drowsiness', 'mood', 'resting_hr'];
const SHAPES = ['circle', 'square', 'triangle', 'diamond'] as const;

/** One sentence in plain words for someone without medical training. */
const PLAIN: Record<string, string> = {
    sleep_main: 'Time actually asleep in your main sleep. Several short nights in a row lower alertness, which matters for operations and spacewalks.',
    drowsiness: 'How sleepy you feel when you log it, from 1 (wide awake) to 9 (fighting sleep). 7 or more means clearly sleepy.',
    mood: 'How you feel overall, from 1 (very low) to 5 (very good). Long missions in confinement can wear mood down; a trend matters more than one day.',
    resting_hr: 'Heartbeats per minute after 5 minutes at rest. In microgravity, fluids shift and the heart adapts; a steady rise can mean fatigue or illness.',
    bp: 'Blood pressure: the top number is when the heart beats, the bottom one when it rests between beats.',
    spo2: 'Oxygen level in your blood. Usually 95 % or more; lower values can come from cabin air or a measurement problem.',
    temperature: 'Body temperature. It depends on where it is taken (mouth, ear, skin), so each site is its own series.',
    glucose: 'Sugar in your blood. It depends on meals and on the sample, so each context is its own series.',
};

interface Series {
    key: string;
    label: string;
    points: Observation[];
    primary: boolean;
}

function seriesLabel(o: Observation): string {
    const c = o.context;
    const parts = [o.method];
    if (o.variable === 'temperature') parts.push(c.site ?? 'site unknown');
    if (o.variable === 'glucose') parts.push(`${c.sample ?? 'sample unknown'}, ${c.meal ?? 'context unknown'}, ${o.unit}`);
    return parts.join(' · ');
}

function marker(shape: (typeof SHAPES)[number], x: number, y: number, cls: string, hollow = false): string {
    const f = hollow ? 'fill="var(--surface)"' : '';
    if (shape === 'square') return `<rect class="${cls}" x="${x - 4}" y="${y - 4}" width="8" height="8" ${f}/>`;
    if (shape === 'triangle') return `<path class="${cls}" d="M${x} ${y - 5}L${x + 5} ${y + 4}H${x - 5}Z" ${f}/>`;
    if (shape === 'diamond') return `<path class="${cls}" d="M${x} ${y - 5}L${x + 5} ${y}L${x} ${y + 5}L${x - 5} ${y}Z" ${f}/>`;
    return `<circle class="${cls}" cx="${x}" cy="${y}" r="4.5" ${f}/>`;
}

/** Monotone cubic interpolation (Fritsch–Carlson): smooth, and never overshoots a recorded value. */
function monotonePath(p: [number, number][]): string {
    if (p.length === 1) return `M${p[0][0]} ${p[0][1]}`;
    const n = p.length;
    const dx: number[] = [];
    const m: number[] = [];
    for (let i = 0; i < n - 1; i++) {
        dx.push(p[i + 1][0] - p[i][0]);
        m.push((p[i + 1][1] - p[i][1]) / dx[i]);
    }
    const t: number[] = [m[0]];
    for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]));
    t.push(m[n - 2]);
    let d = `M${p[0][0]} ${p[0][1]}`;
    for (let i = 0; i < n - 1; i++) {
        const h = dx[i] / 3;
        d += `C${(p[i][0] + h).toFixed(1)} ${(p[i][1] + t[i] * h).toFixed(1)} ${(p[i + 1][0] - h).toFixed(1)} ${(p[i + 1][1] - t[i + 1] * h).toFixed(1)} ${p[i + 1][0]} ${p[i + 1][1]}`;
    }
    return d;
}

function chart(metric: Variable, series: Series[], fromDay: number, toDay: number, refLines: { value: number; label: string; cls: string }[], missingDays: number[]): Html {
    const W = 720;
    const H = 280;
    const L = 52;
    const R = 16;
    const T = 18;
    const B = 44;
    const values: number[] = [];
    for (const s of series) for (const p of s.points) {
        if (p.value !== null) values.push(p.value);
        if (p.value2 != null) values.push(p.value2);
    }
    for (const r of refLines) values.push(r.value);
    if (values.length === 0) return html`<div class="chart-empty">${icon('missing')}No reading in this period. Nothing is drawn for missing days.</div>`;
    let min = Math.min(...values);
    let max = Math.max(...values);
    const pad = (max - min || Math.abs(max) || 1) * 0.15;
    min -= pad;
    max += pad;
    if (metric === 'drowsiness') [min, max] = [1, 9];
    if (metric === 'mood') [min, max] = [1, 5];
    const days = toDay - fromDay;
    const x = (d: number) => L + ((d - fromDay) / Math.max(days, 1)) * (W - L - R);
    const y = (v: number) => T + (1 - (v - min) / (max - min)) * (H - T - B);
    const fmt = (v: number) => (metric === 'sleep_main' ? `${Math.floor(v / 60)}h${String(Math.round(v % 60)).padStart(2, '0')}` : Number.isInteger(v) ? String(v) : v.toFixed(1));
    let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${escape(VARIABLE_META[metric].label)} from Day ${fromDay} to Day ${toDay}. The table below lists the same values."><defs><linearGradient id="area-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--s1)" stop-opacity=".26"/><stop offset="1" stop-color="var(--s1)" stop-opacity="0"/></linearGradient></defs><line class="cross" x1="0" x2="0" y1="${T}" y2="${H - B}"/>`;
    // "nice" ticks: whole hours for sleep, 1-2-5 steps otherwise
    const rawStep = (max - min) / 4;
    const niceStep = metric === 'sleep_main' ? Math.max(30, Math.ceil(rawStep / 30) * 30) : (() => {
        const p = 10 ** Math.floor(Math.log10(rawStep));
        return [1, 2, 5, 10].map((m) => m * p).find((st) => st >= rawStep) ?? rawStep;
    })();
    for (let v = Math.ceil(min / niceStep) * niceStep; v <= max; v += niceStep) {
        svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`;
    }
    const step = days > 14 ? 5 : days > 7 ? 2 : 1;
    for (let d = fromDay; d <= toDay; d += step) svg += `<text class="axis" x="${x(d)}" y="${H - B + 18}" text-anchor="middle">D${d}</text>`;
    for (const d of missingDays) svg += `<g class="gap"><line x1="${x(d)}" x2="${x(d)}" y1="${T}" y2="${H - B}"/><text x="${x(d)}" y="${H - B + 34}" text-anchor="${x(d) > W - 70 ? 'end' : x(d) < L + 40 ? 'start' : 'middle'}">no reading</text></g>`;
    for (const r of refLines) svg += `<line class="${r.cls}" x1="${L}" x2="${W - R}" y1="${y(r.value)}" y2="${y(r.value)}"/><text class="ref-label ${r.cls}-t" x="${r.cls === 'ref' ? W - R - 4 : L + 6}" y="${y(r.value) - 7}" text-anchor="${r.cls === 'ref' ? 'end' : 'start'}">${escape(r.label)}</text>`;
    series.forEach((s, i) => {
        const shape = SHAPES[i % SHAPES.length];
        const cls = `s${(i % 4) + 1}`;
        const pts = [...s.points].filter((p) => p.value !== null).sort((a, b) => a.missionDay - b.missionDay || a.measuredAt.localeCompare(b.measuredAt));
        // smooth curve only across consecutive days of a daily series: a missing day breaks the line
        if (DAILY.includes(metric)) {
            const runs: [number, number][][] = [];
            pts.forEach((p, j) => {
                if (j === 0 || p.missionDay !== pts[j - 1].missionDay + 1) runs.push([]);
                runs[runs.length - 1].push([x(p.missionDay), y(p.value!)]);
            });
            for (const run of runs) {
                const d = monotonePath(run);
                if (i === 0 && run.length > 1) svg += `<path class="area ${cls}" d="${d}L${run[run.length - 1][0]} ${H - B}L${run[0][0]} ${H - B}Z"/>`;
                svg += `<path class="line ${cls}" d="${d}" pathLength="1"/>`;
            }
        }
        for (const p of pts) {
            const hollow = p.quality !== 'valid';
            const tip = `Day ${p.missionDay} · ${formatValue(p)} · ${s.label}${hollow ? ' · Check measurement' : ''}`;
            svg += `<g tabindex="0" data-x="${x(p.missionDay)}" data-tip="${escape(tip)}">${marker(shape, x(p.missionDay), y(p.value!), `pt ${cls}`, hollow)}<title>${escape(tip)}</title></g>`;
            if (p.value2 != null) svg += `<g>${marker(shape, x(p.missionDay), y(p.value2), `pt ${cls}`, true)}<title>Diastolic ${p.value2} mmHg</title></g>`;
        }
    });
    svg += '</svg>';
    return raw(`<div class="chart-wrap">${svg}</div>`);
}

export async function renderTrends(): Promise<Html> {
    const c = cfg();
    const metricQ = app.route.query.get('metric') as Variable | null;
    const metric = metricQ && METRICS.includes(metricQ) ? metricQ : 'sleep_main';
    const period = [7, 14, 30].includes(Number(app.route.query.get('period'))) ? Number(app.route.query.get('period')) : 7;
    const crewMembers = repo.memberStatic;
    const astronauts = (await repo.members(ws())).filter((m) => m.role === 'astronaut');
    const memberQ = app.route.query.get('member');
    const crewId = app.role === 'cmo' ? (memberQ && astronauts.some((m) => m.id === memberQ) ? memberQ : c.astronautId) : me();
    const today = missionDay(app.now, c.epoch);
    const fromDay = today - period + 1;
    const all = await repo.observationsFor(ws(), crewId);
    const current = all.filter((o) => !o.supersededBy && o.variable === metric && o.missionDay >= fromDay && o.missionDay <= today && o.value !== null);
    const notRecorded = all.filter((o) => !o.supersededBy && o.variable === metric && o.missionDay >= fromDay && o.quality === 'not-recorded');
    const groups = new Map<string, Series>();
    for (const o of current) {
        const k = seriesKey(o);
        if (!groups.has(k)) groups.set(k, { key: k, label: seriesLabel(o), points: [], primary: false });
        groups.get(k)!.points.push(o);
    }
    const series = [...groups.values()].sort((a, b) => b.points.length - a.points.length);
    if (metric === 'sleep_main') series.sort((a, b) => (a.key.includes(SLEEP_RULE.method) ? -1 : b.key.includes(SLEEP_RULE.method) ? 1 : 0));
    if (series[0]) series[0].primary = true;
    const primary = series[0];
    const missingDays: number[] = [];
    if (DAILY.includes(metric)) {
        const daysWith = new Set((primary?.points ?? []).map((p) => p.missionDay));
        for (let d = fromDay; d <= today; d++) if (!daysWith.has(d)) missingDays.push(d);
    }
    const ref = metric === 'sleep_main' ? personalReference(all, 122, 135) : null;
    const refLines: { value: number; label: string; cls: string }[] = [];
    if (ref) refLines.push({ value: ref.median, label: `Personal reference ${formatMinutes(ref.median)} (diary median D${ref.fromDay}–D${ref.toDay})`, cls: 'ref' });
    if (metric === 'sleep_main' && c.rules.includes(SLEEP_RULE.id)) refLines.push({ value: SLEEP_RULE.thresholdMin, label: 'Demo rule threshold 360 min', cls: 'thr' });
    const latest = primary ? [...primary.points].sort((a, b) => b.measuredAt.localeCompare(a.measuredAt))[0] : undefined;
    const tableRows = [...current, ...notRecorded].sort((a, b) => b.missionDay - a.missionDay || b.measuredAt.localeCompare(a.measuredAt));
    const memberAlias = crewMembers(ws(), crewId).alias;
    const q = (p: Record<string, string | number>) => {
        const u = new URLSearchParams({ metric, period: String(period), ...(app.role === 'cmo' ? { member: crewId } : {}) });
        for (const [k, v] of Object.entries(p)) u.set(k, String(v));
        return `/trends?${u.toString()}`;
    };

    const vals = (primary?.points ?? []).map((p) => p.value as number).filter((v) => Number.isFinite(v));
    const avg = vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : null;
    const isMin = metric === 'sleep_main';
    const avgText = avg === null ? '—' : isMin ? formatMinutes(Math.round(avg)) : `${Math.round(avg * 10) / 10}`;
    const gap = ref && latest?.value != null ? latest.value - ref.median : null;
    const gapText = gap === null ? '—' : `${gap < 0 ? '−' : '+'}${formatMinutes(Math.abs(gap))}`;
    const gapTone = gap !== null && gap <= -60 ? 'wt' : '';
    // consecutive short nights ending with the latest diary night
    const sorted = [...(primary?.points ?? [])].sort((x, y) => y.missionDay - x.missionDay);
    let streak = 0;
    for (const o of sorted) if ((o.value ?? 999) < SLEEP_RULE.thresholdMin) streak++; else break;
    const ord = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh'];
    const verdict = !latest
        ? 'No reading in this period.'
        : isMin && streak >= 2
          ? `${ord[streak] ?? `${streak}th`} night in a row under 6 h${ref && avg !== null ? `: about ${formatMinutes(Math.max(0, Math.round(ref.median - avg)))} less than your usual each night.` : '.'}`
          : isMin && gap !== null
            ? gap < -30 ? `Last night was ${formatMinutes(-gap)} shorter than your usual.` : 'Your sleep is close to your usual.'
            : `${VARIABLE_META[metric].label}: ${formatValue(latest)} on Day ${latest.missionDay}${missingDays.length ? `, ${missingDays.length} day${missingDays.length > 1 ? 's' : ''} without a reading` : ''}.`;
    return html`
    ${pageHead('Trends', html`${memberAlias} · Day ${fromDay}–${today} · values, methods and gaps`, html`<div class="head-tags">${simTag()}</div>`)}
    <div class="trend-controls">
      ${app.role === 'cmo' ? html`<label class="inline-select">Crew member<select data-action="trend-member">${astronauts.map((m) => html`<option value="${m.id}" ${m.id === crewId ? 'selected' : ''}>${m.alias}</option>`)}</select></label>` : ''}
      <nav class="chips-nav metric-tabs" aria-label="Indicator">${METRICS.map((m) => html`<a href="${q({ metric: m })}" data-link class="${m === metric ? 'active' : ''}" ${m === metric ? html`aria-current="true"` : ''}>${VARIABLE_META[m].short}</a>`)}</nav>
      <div class="seg" role="group" aria-label="Period">${[7, 14, 30].map((p) => html`<a href="${q({ period: p })}" data-link aria-current="${p === period}" class="${p === period ? 'active' : ''}">${p} days</a>`)}</div>
    </div>
    <section class="card trend-card" aria-labelledby="trend-h">
      <div class="card-h"><h2 id="trend-h" class="sr-only">${VARIABLE_META[metric].label}</h2>${metric === 'sleep_main' && c.rules.length ? demoRuleTag() : metric === 'sleep_main' ? badge('No mission rule configured', 'muted', 'info') : ''}</div>
      <p class="verdict-h">${verdict}</p>
      <details class="why"><summary>What does this mean?</summary><p>${PLAIN[metric] ?? ''}</p></details>
      ${chart(metric, series, fromDay, today, refLines, missingDays)}
      ${series.length > 1 || refLines.length ? html`<ul class="legend">${series.map((s, i) => html`<li><span class="lg lg-${SHAPES[i % 4]} s${(i % 4) + 1}" aria-hidden="true"></span>${s.label}${s.primary && series.length > 1 ? ' (main)' : ''}</li>`)}${refLines.map((r) => html`<li><span class="lg lg-line ${r.cls}" aria-hidden="true"></span>${r.cls === 'ref' ? 'Your usual' : 'Demo rule'}</li>`)}</ul>` : ''}
      <div class="tiles">
        <div class="tile"><span>Latest</span><b class="mono">${latest ? formatValue(latest) : '—'}</b></div>
        <div class="tile"><span>Average ${period} days</span><b class="mono">${avgText}</b></div>
        <div class="tile"><span>Your usual</span><b class="mono">${ref ? formatMinutes(ref.median) : '—'}</b></div>
        <div class="tile ${gapTone}"><span>Gap to your usual</span><b class="mono">${gapText}</b></div>
      </div>
      <dl class="prov-row">
        <div><dt>Source</dt><dd>${primary?.label ?? '—'}</dd></div>
        <div><dt>Frequency</dt><dd>${DAILY.includes(metric) ? 'Daily' : 'When taken'}</dd></div>
        <div><dt>Quality</dt><dd>${current.length} reading${current.length === 1 ? '' : 's'} · ${missingDays.length ? `${missingDays.length} missing` : 'none missing'}</dd></div>
        <div><dt>Origin</dt><dd>${c.id === 'demo' ? 'Simulated · demo dataset' : 'Simulated · this device'}</dd></div>
        <div><dt>Thresholds</dt><dd>${metric === 'sleep_main' && c.rules.length ? 'Demo rule, not clinical' : 'None set'}</dd></div>
      </dl>
      ${series.length > 1 ? html`<p class="hint">${icon('info')}Different methods are separate series, never merged.</p>` : ''}
    </section>
    <details class="card fold" aria-labelledby="table-h">
      <summary><h2 id="table-h">All readings and provenance</h2><small>${tableRows.length + missingDays.length} rows</small></summary>
      <div class="table-wrap"><table>
        <caption class="sr-only">${VARIABLE_META[metric].label}, Day ${fromDay} to ${today}, newest first</caption>
        <thead><tr><th scope="col">Day</th><th scope="col">Time (UTC)</th><th scope="col">Value</th><th scope="col">Series (method · context)</th><th scope="col">Quality</th><th scope="col">Source</th></tr></thead>
        <tbody>
          ${missingDays.map((d) => html`<tr class="row-gap"><td class="mono">Day ${d}</td><td>—</td><td>${badge('No reading', 'muted', 'missing')}</td><td>${primary?.label ?? '—'}</td><td>—</td><td>—</td></tr>`)}
          ${tableRows.map((o) => html`<tr><td class="mono">Day ${o.missionDay}</td><td class="mono">${hhmm(Date.parse(o.measuredAt))}</td><td>${obsValue(o)}${o.version > 1 ? html` <small class="muted">corrected v${o.version}</small>` : ''}</td><td>${seriesLabel(o)}</td><td>${qualityBadge(o)}</td><td>${sourceLabel(o)}</td></tr>`)}
        </tbody>
      </table></div>
      <dl class="defs">
        <dt>Unit</dt><dd>${current[0]?.unit ?? VARIABLE_META[metric].unit ?? '—'}</dd>
        <dt>Data</dt><dd>${c.id === 'demo' ? 'Simulated crew data · versioned demo dataset demo-2026.11-v1 and entries made on this device' : 'Simulated crew data · Explore app examples and entries made on this device'}</dd>
        ${ref ? html`<dt>Your usual</dt><dd>Median of ${ref.nights} valid sleep-diary nights, Days ${ref.fromDay}–${ref.toDay}. Context only.</dd>` : ''}
        ${metric === 'sleep_main' ? html`<dt>Rule</dt><dd>${c.rules.length ? `${SLEEP_RULE.label} (Demo rule): ${SLEEP_RULE.description}` : 'No mission rule configured.'}</dd>` : ''}
      </dl>
    </details>`;
}

import { registerActions } from '../../router-actions';
import { bus } from '../../bus';

registerActions({
    'trend-member': (el) => {
        const u = new URLSearchParams(app.route.query);
        u.set('member', (el as HTMLSelectElement).value);
        bus.navigate(`/trends?${u.toString()}`);
    },
});
