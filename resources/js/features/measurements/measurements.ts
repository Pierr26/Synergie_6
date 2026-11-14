import { bus } from '../../bus';
import { icon } from '../../components/icons';
import { obsValue, pageHead, qualityBadge, simTag, sourceLabel, toast } from '../../components/ui';
import * as repo from '../../data/repo';
import { parseNumber, validateBloodPressure, validateGlucose, validateSpO2, validateTemperature, VARIABLE_META, type ValidationResult } from '../../domain/measurements';
import { hhmm, missionDay } from '../../domain/time';
import type { Variable } from '../../domain/types';
import { html, raw, type Html } from '../../lib/html';
import { registerActions } from '../../router-actions';
import { app, cfg, me, ws } from '../../state';

type Kind = 'bp' | 'spo2' | 'temperature' | 'glucose';
const KINDS: Kind[] = ['bp', 'spo2', 'temperature', 'glucose'];
let errors: Record<string, string> = {};
let lastValues: Record<string, string> = {};
let lastKind: Kind | null = null;

function current(): Kind {
    const t = app.route.query.get('type') as Kind | null;
    return t && KINDS.includes(t) ? t : 'bp';
}

function measuredAtIso(fd: FormData): string {
    const t = String(fd.get('time') ?? '');
    const c = cfg();
    if (/^\d{2}:\d{2}$/.test(t)) {
        const day = missionDay(app.now, c.epoch);
        const [h, m] = t.split(':').map(Number);
        return new Date(Date.parse(c.epoch) + (day - 1) * 86_400_000 + (h * 60 + m) * 60_000).toISOString();
    }
    return new Date(app.now).toISOString();
}

registerActions({
    'measure-submit': async (el) => {
        const f = el as HTMLFormElement;
        const fd = new FormData(f);
        const kind = current();
        lastValues = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
        let v: ValidationResult;
        let value: number | null = null;
        let value2: number | null = null;
        let unit = VARIABLE_META[kind].unit;
        const context: Record<string, string> = {};
        const method = String(fd.get('method') ?? '');
        if (kind === 'bp') {
            value = parseNumber(String(fd.get('systolic')));
            value2 = parseNumber(String(fd.get('diastolic')));
            v = validateBloodPressure(value, value2);
            context.rest = String(fd.get('rest'));
            context.posture = String(fd.get('posture'));
        } else if (kind === 'spo2') {
            value = parseNumber(String(fd.get('value')));
            context.signal = String(fd.get('signal'));
            context.supplementalO2 = String(fd.get('o2'));
            v = validateSpO2(value, context.signal);
        } else if (kind === 'temperature') {
            value = parseNumber(String(fd.get('value')));
            context.site = String(fd.get('site'));
            v = validateTemperature(value, context.site === 'unknown' ? '' : context.site);
        } else {
            value = parseNumber(String(fd.get('value')));
            unit = String(fd.get('unit'));
            context.sample = String(fd.get('sample'));
            context.meal = String(fd.get('meal'));
            v = validateGlucose(value, unit);
        }
        errors = v.errors;
        if (!v.ok) {
            await bus.refresh();
            document.querySelector<HTMLElement>('.has-error input, .has-error select')?.focus();
            return;
        }
        const requestId = app.route.query.get('request');
        await repo.addMeasurement(ws(), me(), {
            missionDay: missionDay(app.now, cfg().epoch),
            variable: kind as Variable,
            value,
            value2,
            unit,
            method,
            context,
            quality: v.quality,
            qualityNote: v.qualityNote,
            author: me(),
            source: 'manual',
            measuredAt: measuredAtIso(fd),
        }, app.now, requestId);
        lastValues = {};
        f.reset();
        toast(v.quality === 'check' ? `Saved on this device · flagged “Check measurement”: ${v.qualityNote}` : `${VARIABLE_META[kind].label} saved on this device.`);
        await bus.refresh();
    },
    'measure-correct': async (el) => {
        const f = el as HTMLFormElement;
        const fd = new FormData(f);
        const value = parseNumber(String(fd.get('value')));
        const value2 = fd.has('value2') ? parseNumber(String(fd.get('value2'))) : undefined;
        if (value === null || Number.isNaN(value)) {
            toast('Enter a number to correct the value.');
            return;
        }
        await repo.correctObservation(ws(), String(f.dataset.id), value2 === undefined ? { value } : { value, value2 }, me(), app.now);
        toast('Correction saved. The previous version is kept in the history.');
        await bus.refresh();
    },
});

function input(name: string, label: string, attrs = '', hint?: string): Html {
    const e = errors[name === 'systolic' || name === 'diastolic' || name === 'value' ? name : ''];
    return html`<div class="field ${e ? 'has-error' : ''}"><label for="m-${name}">${label}</label>${hint ? html`<p class="hint">${hint}</p>` : ''}<input id="m-${name}" name="${name}" inputmode="decimal" value="${lastValues[name] ?? ''}" ${raw(attrs)}>${e ? html`<p class="error">${icon('review')}${e}</p>` : ''}</div>`;
}

function select(name: string, label: string, opts: [string, string][], def?: string): Html {
    const sel = lastValues[name] ?? def ?? opts[0][0];
    return html`<div class="field"><label for="m-${name}">${label}</label><select id="m-${name}" name="${name}">${opts.map(([v, l]) => html`<option value="${v}" ${v === sel ? 'selected' : ''}>${l}</option>`)}</select></div>`;
}

function formFor(kind: Kind): Html {
    const time = html`<div class="field"><label for="m-time">Time measured (UTC)</label><input id="m-time" name="time" type="time" value="${lastValues.time ?? hhmm(app.now)}"></div>`;
    if (kind === 'bp')
        return html`<div class="form-grid">${input('systolic', 'Systolic (mmHg)', 'required')}${input('diastolic', 'Diastolic (mmHg)', 'required')}${select('method', 'Device', [['Automatic cuff, left arm', 'Automatic cuff, left arm'], ['Manual cuff', 'Manual cuff'], ['Other identified device', 'Other identified device']])}${select('rest', 'Rest before measuring', [['5 min seated', '5 min seated'], ['less than 5 min', 'Less than 5 min'], ['unknown', 'Unknown']])}${select('posture', 'Posture or restraint', [['seated (restrained)', 'Seated, restrained'], ['free floating', 'Free floating'], ['unknown', 'Unknown']])}${time}</div>`;
    if (kind === 'spo2')
        return html`<div class="form-grid">${input('value', 'SpO₂ (%)', 'required', 'Entry range 0–100 %.')}${select('method', 'Oximeter', [['Finger pulse oximeter', 'Finger pulse oximeter'], ['Wearable (simulated)', 'Wearable (simulated)']])}${select('signal', 'Signal quality', [['good', 'Good'], ['insufficient', 'Insufficient'], ['unknown', 'Unknown']])}${select('o2', 'Supplemental oxygen', [['no', 'No'], ['yes', 'Yes'], ['unknown', 'Not stated']])}${time}</div>`;
    if (kind === 'temperature')
        return html`<div class="form-grid">${input('value', 'Temperature (°C)', 'required')}${select('site', 'Site', [['oral', 'Oral'], ['skin', 'Skin (cutaneous)'], ['tympanic', 'Ear (tympanic)'], ['unknown', 'Unknown']])}${select('method', 'Device', [['Digital thermometer', 'Digital thermometer'], ['Skin sensor (simulated)', 'Skin sensor (simulated)']])}${time}</div><p class="hint">Each site and method is a separate series. Skin temperature never feeds the core series.</p>`;
    return html`<div class="form-grid">${input('value', 'Glucose', 'required')}${select('unit', 'Unit', [['mg/dL', 'mg/dL'], ['mmol/L', 'mmol/L']])}${select('sample', 'Sample', [['capillary', 'Capillary (meter)'], ['plasma', 'Plasma (laboratory)'], ['interstitial', 'Interstitial (sensor)']])}${select('meal', 'Context', [['fasting', 'Fasting'], ['after meal', 'After meal'], ['unknown', 'Unknown']])}${select('method', 'Method', [['Capillary meter', 'Capillary meter'], ['Laboratory analyser (simulated)', 'Laboratory analyser'], ['CGM (simulated)', 'Continuous sensor (simulated)']])}${time}</div><p class="hint">Readings are grouped by sample, context and unit. Each group has its own curve and report line.</p>`;
}

export async function renderMeasurements(): Promise<Html> {
    const kind = current();
    const crewId = me();
    if (lastKind !== kind) {
        errors = {};
        lastValues = {};
        lastKind = kind;
    }
    const reqId = app.route.query.get('request');
    const all = (await repo.observationsFor(ws(), crewId)).filter((o) => KINDS.includes(o.variable as Kind)).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
    const current_ = all.filter((o) => !o.supersededBy).slice(0, 12);
    return html`
    ${pageHead('Spot measurements', 'Blood pressure, SpO₂, temperature and glucose, entered when asked or useful. Value, unit, method, context and time stay with each reading.', simTag())}
    ${reqId ? html`<p class="notice">${icon('followup')}Saving this measurement answers your CMO’s follow-up request.</p>` : ''}
    <div class="tabs" role="tablist" aria-label="Measurement type">
      ${KINDS.map((k) => html`<a role="tab" href="/measurements?type=${k}${reqId ? `&request=${reqId}` : ''}" data-link aria-selected="${k === kind}" class="${k === kind ? 'active' : ''}">${VARIABLE_META[k].label}</a>`)}
    </div>
    <form class="card" data-action="measure-submit" novalidate aria-labelledby="mf-h">
      <h2 id="mf-h">New ${VARIABLE_META[kind].label.toLowerCase()} reading</h2>
      ${formFor(kind)}
      <div class="form-actions"><button type="submit" class="btn btn-primary">${icon('ok')}Save measurement</button><a class="btn btn-quiet" href="/trends?metric=${kind}" data-link>See ${VARIABLE_META[kind].label} trend</a></div>
    </form>
    <section class="card" aria-labelledby="recent-h">
      <h2 id="recent-h">Recent spot measurements</h2>
      ${current_.length === 0 ? html`<p class="muted">No spot measurement yet.</p>` : html`
      <div class="table-wrap"><table>
        <thead><tr><th scope="col">Day · time</th><th scope="col">Indicator</th><th scope="col">Value</th><th scope="col">Method · context</th><th scope="col">Quality</th><th scope="col">Source</th><th scope="col"><span class="sr-only">Correct</span></th></tr></thead>
        <tbody>${current_.map((o) => html`<tr>
          <td class="mono">Day ${o.missionDay} · ${hhmm(Date.parse(o.measuredAt))}</td>
          <td>${VARIABLE_META[o.variable].label}</td>
          <td>${obsValue(o)}${o.version > 1 ? html` <small class="muted">v${o.version}</small>` : ''}</td>
          <td>${o.method}${Object.entries(o.context).filter(([, v]) => v).map(([k, v]) => html`<small class="ctx">${k}: ${v}</small>`)}</td>
          <td>${qualityBadge(o)}${o.qualityNote ? html`<small class="ctx">${o.qualityNote}</small>` : ''}</td>
          <td>${sourceLabel(o)}</td>
          <td><details class="correct"><summary>Correct</summary>
            <form data-action="measure-correct" data-id="${o.id}" class="correct-form">
              <label>${o.variable === 'bp' ? 'Systolic' : 'Value'}<input name="value" inputmode="decimal" value="${o.value ?? ''}"></label>
              ${o.variable === 'bp' ? html`<label>Diastolic<input name="value2" inputmode="decimal" value="${o.value2 ?? ''}"></label>` : ''}
              <button class="btn btn-small" type="submit">Save correction</button>
            </form></details></td>
        </tr>`)}</tbody>
      </table></div>`}
    </section>`;
}
