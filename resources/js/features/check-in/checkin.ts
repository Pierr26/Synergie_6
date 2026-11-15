import { bus } from '../../bus';
import { icon } from '../../components/icons';
import { badge, demoRuleTag, obsValue, pageHead, qualityBadge, sourceLabel, toast } from '../../components/ui';
import type { CheckinForm } from '../../data/db';
import * as repo from '../../data/repo';
import { DROWSINESS_ANCHORS, MOOD_ANCHORS, parseSleep, validateDrowsiness } from '../../domain/measurements';
import { SLEEP_RULE } from '../../domain/sleep';
import { formatMinutes, hhmm, missionDay } from '../../domain/time';
import type { Variable } from '../../domain/types';
import { html, type Html } from '../../lib/html';
import { registerActions } from '../../router-actions';
import { app, cfg, me, ws } from '../../state';

let form: CheckinForm = { ...repo.EMPTY_FORM };
let formKey = '';
let editing = false;
let errors: Record<string, string> = {};
const STEPS = [
    { title: 'Sleep', sensor: true, seconds: 15 },
    { title: 'Vitals', sensor: true, seconds: 5 },
    { title: 'Mood, energy, stress', sensor: false, seconds: 20 },
    { title: 'Symptoms', sensor: false, seconds: 15 },
    { title: 'Hydration', sensor: false, seconds: 10 },
    { title: 'Meals', sensor: false, seconds: 10 },
    { title: 'Exercise', sensor: true, seconds: 5 },
    { title: 'Review', sensor: false, seconds: 10 },
] as const;
const LAST = STEPS.length - 1;
let step = 0;
let progress = 0;
const STEP_OF: Record<string, number> = { sleep: 0, hr: 1, drowsiness: 2 };
const draftWrites = new WeakMap<HTMLFormElement, Promise<void>>();
const correctionKey = (crew: string, day: number, request: string | null) => `checkin-edit:${crew}:${day}:${request ?? 'correction'}`;

/** Morning symptom chips (HEXTA mockup). "None" alone means no concern; any other chip means yes, with the list kept as the comment. */
const SYMPTOM_CHIPS = ['None', 'Headache', 'Stuffy nose', 'Nausea', 'Back pain', 'Blurred vision', 'Digestive trouble', 'Skin irritation'] as const;

function readSymptoms(fd: FormData): Pick<CheckinForm, 'symptoms' | 'symptomsComment'> {
    const chips = (fd.getAll('symptom') as string[]).filter((c) => c !== 'None');
    const any = fd.getAll('symptom').length > 0;
    return { symptoms: any ? (chips.length ? 'yes' : 'no') : '', symptomsComment: chips.join(', ') };
}

function readForm(root: HTMLFormElement): CheckinForm {
    const fd = new FormData(root);
    const num = (k: string) => (fd.get(k) === null || fd.get(k) === '' ? null : Number(fd.get(k)));
    const bounded = (k: string, min: number, max: number) => {
        const value = num(k);
        return value !== null && Number.isInteger(value) && value >= min && value <= max ? value : null;
    };
    return {
        sleepHours: String(fd.get('sleepHours') ?? ''),
        sleepMinutes: String(fd.get('sleepMinutes') ?? ''),
        sleepNotRecorded: fd.get('sleepNotRecorded') === 'on',
        sleepConfirmZero: fd.get('sleepConfirmZero') === 'on',
        drowsiness: num('drowsiness'),
        drowsinessNotRecorded: fd.get('drowsinessNotRecorded') === 'on',
        mood: num('mood'),
        ...readSymptoms(fd),
        hr: String(fd.get('hr') ?? ''),
        hrRest: (fd.get('hrRest') as CheckinForm['hrRest']) ?? 'yes',
        hrMethod: String(fd.get('hrMethod') ?? 'Manual pulse count'),
        energy: bounded('energy', 1, 5),
        stress: bounded('stress', 1, 10),
        waterMl: bounded('waterMl', 0, 10000),
        urineShade: bounded('urineShade', 1, 8),
        breakfast: String(fd.get('breakfast') ?? ''),
        appetite: String(fd.get('appetite') ?? ''),
    };
}

function validate(f: CheckinForm): { errors: Record<string, string>; minutes: number | null } {
    const e: Record<string, string> = {};
    let minutes: number | null = null;
    if (!f.sleepNotRecorded) {
        const s = parseSleep(f.sleepHours, f.sleepMinutes, f.sleepConfirmZero);
        if (s.error) e.sleep = s.error;
        minutes = s.minutes;
    }
    if (!f.drowsinessNotRecorded) {
        const d = validateDrowsiness(f.drowsiness);
        if (d) e.drowsiness = d;
    }
    if (f.hr.trim() !== '') {
        const v = Number(f.hr.replace(',', '.'));
        if (!Number.isFinite(v) || v <= 0) e.hr = 'Enter a positive heart rate in beats per minute.';
    }
    return { errors: e, minutes };
}

registerActions({
    'checkin-submit': async (el, e) => {
        const submitter = (e as SubmitEvent | undefined)?.submitter as HTMLElement | null | undefined;
        if (step < LAST && submitter?.dataset.save !== '1') {
            // Enter inside a step moves on instead of saving early
            (el.querySelector('.ci-nav .btn-primary') as HTMLButtonElement | null)?.click();
            return;
        }
        const f = readForm(el as HTMLFormElement);
        const v = validate(f);
        form = f;
        errors = v.errors;
        if (Object.keys(v.errors).length) {
            step = Math.min(...Object.keys(v.errors).map((k) => STEP_OF[k] ?? 0));
            await bus.refresh();
            const first = document.querySelector<HTMLElement>('.has-error input, .has-error [role=radiogroup] input');
            first?.focus();
            toast('Some fields need attention before saving.');
            return;
        }
        const requestId = app.route.query.get('request');
        await draftWrites.get(el as HTMLFormElement);
        const res = await repo.submitCheckin(ws(), me(), f, v.minutes, app.now, requestId);
        await repo.kvSet(ws(), correctionKey(me(), missionDay(app.now, cfg().epoch), requestId), null);
        editing = false;
        step = LAST;
        toast(res.newAlert ? 'Check-in saved on this device. Sleep trend needs review — your CMO was notified.' : 'Check-in saved on this device.');
        await bus.refresh();
        (document.getElementById('saved-h') as HTMLElement | null)?.focus();
    },
    'checkin-draft': async () => {
        const el = document.getElementById('checkin-form') as HTMLFormElement;
        form = readForm(el);
        await draftWrites.get(el);
        const existing = await repo.checkinFor(ws(), me(), missionDay(app.now, cfg().epoch));
        if (existing?.status === 'submitted') await repo.kvSet(ws(), correctionKey(me(), existing.missionDay, app.route.query.get('request')), form);
        else await repo.saveDraft(ws(), me(), form, app.now);
        toast('Draft saved on this device. Resume it any time today.');
        await bus.refresh();
    },
    /** The sidebar opens any panel. Continue validates the current panel before advancing. */
    'ci-step': async (el) => {
        const f = document.getElementById('checkin-form') as HTMLFormElement | null;
        if (f?.dataset.mount === 'checkin') form = readForm(f);
        const to = Number(el.dataset.to);
        if (el.dataset.advance === 'true' && to > step) {
            const v = validate(form);
            const here = Object.keys(v.errors).filter((k) => (STEP_OF[k] ?? 0) === step);
            errors = Object.fromEntries(here.map((k) => [k, v.errors[k]]));
            if (here.length) {
                await bus.refresh();
                document.querySelector<HTMLElement>('.ci-pane:not([hidden]) .has-error input')?.focus();
                return;
            }
        } else errors = {};
        step = Math.max(0, Math.min(LAST, to));
        if (el.dataset.advance === 'true') progress = Math.max(progress, step);
        await bus.refresh();
        (document.querySelector('.ci-pane:not([hidden]) .ci-title') as HTMLElement | null)?.focus();
    },
    'checkin-edit': async () => {
        editing = true;
        step = 0;
        progress = 0;
        await bus.refresh();
        (document.getElementById('sleepHours') as HTMLElement | null)?.focus();
    },
    'ci-water': (el) => {
        const water = document.querySelector<HTMLInputElement>('#ci-water');
        if (!water || water.disabled) return;
        const ml = Math.max(0, Math.min(10000, Number(water.value || 0) + Number(el.dataset.delta)));
        water.value = String(ml);
        const out = document.getElementById('ci-water-out');
        if (out) out.textContent = ml >= 1000 ? `${(ml / 1000).toFixed(2)} L` : `${ml} mL`;
        const bar = document.getElementById('ci-water-bar');
        if (bar) bar.style.width = `${Math.min(100, (ml / 2500) * 100)}%`;
        water.dispatchEvent(new Event('input', { bubbles: true }));
    },
    // Mood / energy pad (HEXTA mockup): drag or arrow-keys set a point; mood is the x axis, energy the y axis.
    'mount:ci-pad': (el) => {
        const pad = el as HTMLElement;
        const dot = pad.querySelector<HTMLElement>('.pad-dot')!;
        const wrap = pad.parentElement!;
        const out = wrap.querySelector<HTMLElement>('.pad-out')!;
        const moodInput = wrap.querySelector<HTMLInputElement>('#ci-mood')!;
        const energyInput = wrap.querySelector<HTMLInputElement>('#ci-energy')!;
        const startMood = Number(pad.dataset.mood) || 0;
        const startEnergy = Number(pad.dataset.energy) || 0;
        let px = startMood ? (startMood - 1) / 4 : 0.72;
        let py = startEnergy ? 1 - (startEnergy - 1) / 4 : 0.42;
        const place = () => {
            dot.style.left = `${px * 100}%`;
            dot.style.top = `${py * 100}%`;
        };
        const commit = () => {
            px = Math.max(0.04, Math.min(0.96, px));
            py = Math.max(0.04, Math.min(0.96, py));
            place();
            const mood = Math.round(1 + px * 4);
            const energy = Math.round(1 + (1 - py) * 4);
            const energyWord = py < 0.4 ? 'high energy' : py > 0.6 ? 'low energy' : 'medium energy';
            out.textContent = `Mood ${mood} / 5 · ${energyWord}`;
            pad.setAttribute('aria-valuetext', `${px < 0.4 ? 'unpleasant' : px > 0.6 ? 'pleasant' : 'neutral'} mood, ${energyWord}`);
            moodInput.value = String(mood);
            energyInput.value = String(energy);
            moodInput.dispatchEvent(new Event('input', { bubbles: true }));
        };
        const fromEvent = (ev: PointerEvent) => {
            const r = pad.getBoundingClientRect();
            px = (ev.clientX - r.left) / r.width;
            py = (ev.clientY - r.top) / r.height;
            commit();
        };
        let down = false;
        pad.addEventListener('pointerdown', (ev) => {
            down = true;
            pad.setPointerCapture(ev.pointerId);
            fromEvent(ev);
        });
        pad.addEventListener('pointermove', (ev) => down && fromEvent(ev));
        pad.addEventListener('pointerup', () => (down = false));
        pad.addEventListener('keydown', (ev) => {
            const step = { ArrowLeft: [-0.05, 0], ArrowRight: [0.05, 0], ArrowUp: [0, -0.05], ArrowDown: [0, 0.05] }[ev.key];
            if (!step) return;
            ev.preventDefault();
            px += step[0];
            py += step[1];
            commit();
        });
        // Show the dot, but only fill the values once the user has actually set a point (a blank stays "not recorded").
        place();
        if (startMood || startEnergy) commit();
        else out.textContent = 'Drag to set your mood and energy';
    },
    'mount:checkin': (el) => {
        const f = el as HTMLFormElement;
        const owner = me(), workspace = ws(), epoch = cfg().epoch, request = app.route.query.get('request');
        let writes = Promise.resolve();
        const persist = () => {
            const snapshot = { ...form }, at = app.now;
            writes = writes.then(async () => {
                const day = missionDay(at, epoch);
                const existing = await repo.checkinFor(workspace, owner, day);
                if (existing?.status === 'submitted') await repo.kvSet(workspace, correctionKey(owner, day, request), snapshot);
                else await repo.saveDraft(workspace, owner, snapshot, at);
                const status = f.querySelector('#draft-status');
                if (status) status.textContent = `Draft saved on this device · ${hhmm(at)} UTC`;
            }).catch(() => toast('Draft could not be saved. Keep this page open and try again.'));
            draftWrites.set(f, writes);
        };
        // Every change is saved immediately, so a quick reload keeps the latest draft.
        f.addEventListener('change', () => {
            form = readForm(f);
            persist();
        });
        f.addEventListener('input', () => {
            form = readForm(f);
            persist();
            const zero = document.getElementById('zero-row');
            if (zero) zero.hidden = !(form.sleepHours.trim() === '0' && (form.sleepMinutes.trim() === '' || form.sleepMinutes.trim() === '0')) && !form.sleepConfirmZero;
        });
    },
});


function err(key: string): Html {
    return errors[key] ? html`<p class="error" id="err-${key}">${icon('review')}${errors[key]}</p>` : html``;
}

function stepper(completed: boolean): Html {
    const done = (i: number) => completed || i < progress;
    const state = (i: number) => `${i === step ? 'now' : ''} ${done(i) ? 'done' : ''}`.trim();
    return html`<nav class="card stepper morning-stepper" aria-label="Morning Check-in steps">
      <div class="card-h"><h3>Morning Check-in</h3><small>≈ 90 s</small></div>
      ${STEPS.map((item, i) => html`<button type="button" class="step ${state(i)}" data-action="ci-step" data-to="${i}" aria-controls="checkin-panel" ${i === step ? html`aria-current="step"` : ''}>
        <span class="n" aria-hidden="true">${done(i) ? '✓' : i + 1}</span><span>${item.title}${done(i) ? html`<span class="sr-only"> · Completed</span>` : ''}</span>
        ${item.sensor ? html`<span class="src">Sensor</span>` : html`<span></span>`}
      </button>`)}
    </nav>`;
}

function choice(name: string, options: readonly string[], value: string | undefined): Html {
    return html`<div class="seg-choice">${options.map(option => html`
      <label><input type="radio" name="${name}" value="${option}" ${option === value ? 'checked' : ''}><span>${option}</span></label>`
    )}</div>`;
}


function extraRows(f: CheckinForm): { label: string; value: string; step: number }[] {
    const rows = [
        { label: 'Energy', value: f.energy == null ? '' : `${f.energy}/5`, step: 2 },
        { label: 'Stress', value: f.stress == null ? '' : `${f.stress}/10`, step: 2 },
        { label: 'Water since waking', value: f.waterMl == null ? '' : `${f.waterMl} mL`, step: 4 },
        { label: 'Urine colour', value: f.urineShade == null ? '' : `${f.urineShade}/8`, step: 4 },
        { label: 'Breakfast', value: f.breakfast ?? '', step: 5 },
        { label: 'Appetite', value: f.appetite ?? '', step: 5 },
    ];
    return rows.filter(r => r.value);
}

async function renderCrewCheckins(day: number): Promise<Html> {
    const crew = (await repo.members(ws())).filter(m => m.role === 'astronaut');
    const entries = await Promise.all(crew.map(async m => {
        const [record, task] = await Promise.all([repo.checkinFor(ws(), m.id, day), repo.todaysTask(ws(), m.id, app.now)]);
        const submitted = record?.status === 'submitted' ? record : null;
        const readings = submitted ? (await repo.currentObservations(ws(), m.id)).filter(o => submitted.observationIds.includes(o.id)) : [];
        return { m, task, submitted, sleep: readings.find(o => o.variable === 'sleep_main')?.value, drowsy: readings.find(o => o.variable === 'drowsiness')?.value };
    }));
    return html`${pageHead('Crew check-ins', `Crew submissions · Day ${day}`, html`<a class="btn btn-ghost" href="/check-in" data-link>My Daily Check-in</a>`)}
    <section class="card" aria-labelledby="crew-checkins">
      <div class="card-h"><h2 id="crew-checkins">On-board check-ins</h2><span>${entries.filter(e => e.submitted).length} of ${entries.length} submitted</span></div>
      <div class="review-list">${entries.map(({ m, task, submitted, sleep, drowsy }) => {
          const status = submitted?.submittedAt ? `Submitted · ${hhmm(Date.parse(submitted.submittedAt))} UTC`
              : task?.ev.state === 'due' ? 'Due' : task?.ev.state === 'snoozed' ? 'Snoozed'
              : task?.ev.state === 'scheduled' ? `Scheduled · ${hhmm(task.ev.effectiveDue)} UTC` : 'No submission today';
          return html`<a id="checkin-${m.id}" class="review-row" href="/crew/${m.id}" data-link>
            <span class="av">${m.initials}</span><span><b>${m.alias}</b><span>${submitted ? `Sleep: ${sleep == null ? 'not recorded' : formatMinutes(sleep)} · Drowsiness: ${drowsy == null ? 'not recorded' : `${drowsy}/9`}` : m.title}</span></span>
            ${badge(status, submitted ? 'ok' : task?.ev.state === 'due' ? 'review' : 'muted')}
            <span class="rr-act">Open member file ${icon('arrow','sm')}</span>
          </a>`;
      })}</div>
    </section>`;
}

export async function renderCheckin(): Promise<Html> {
    const c = cfg();
    const day = missionDay(app.now, c.epoch);
    if (app.role === 'cmo' && app.route.segments[1] === 'crew') return renderCrewCheckins(day);
    if (app.role === 'ground') {
        return html`${pageHead('Daily Check-in')}<div class="card">${icon('info')} Daily check-ins are available to the on-board crew.</div>`;
    }
    const crewId = me();
    const record = await repo.checkinFor(ws(), crewId, day);
    const task = await repo.todaysTask(ws(), crewId, app.now);
    const reqId = app.route.query.get('request');
    const key = `${ws()}|${crewId}|${day}|${record?.status === 'submitted' ? record.id : 'draft'}|${reqId ?? ''}|${editing}`;
    if (key !== formKey) {
        // new day, new record or a demo reset: reload from storage; otherwise keep what is being typed
        const correction = record?.status === 'submitted' ? await repo.kvGet<CheckinForm | null>(ws(), correctionKey(crewId, day, reqId), null) : null;
        form = correction ?? (record ? { ...record.form } : { ...repo.EMPTY_FORM });
        formKey = key;
        errors = {};
        step = record?.status === 'submitted' && !editing && !reqId ? LAST : 0;
        progress = 0;
    }

    const head = pageHead('Daily Check-in', undefined,
        app.role === 'cmo' ? html`<a class="btn btn-ghost btn-small" href="/check-in/crew" data-link>Crew submissions</a>` : undefined);

    const request = reqId ? (await repo.requestsFor(ws(), crewId)).find(r => r.id === reqId && r.status === 'open') : null;
    const completed = record?.status === 'submitted' && !editing && !request;
    const readings = await repo.currentObservations(ws(), crewId);
    if (completed && step === LAST) {
        const obs = readings.filter((o) => record.observationIds.includes(o.id));
        const alert = (await repo.alertsFor(ws(), crewId)).find((a) => a.status === 'needs-review' && a.endDay >= day - 1);
        const evidence = alert ? readings.filter((o) => alert.evidenceIds.includes(o.id)).sort((a, b) => a.missionDay - b.missionDay) : [];
        const sleep = obs.find((o) => o.variable === 'sleep_main');
        const drowsy = obs.find((o) => o.variable === 'drowsiness');
        return html`${head}
        <div class="ci-grid">
        ${stepper(true)}
        <div class="checkin-done" id="checkin-panel">
          <section class="card saved done-card" aria-labelledby="saved-h">
            <span class="done-ic">${icon('ok')}</span>
            <p class="prio-k">Completed · ${hhmm(Date.parse(record.submittedAt!))} UTC</p>
            <h2 id="saved-h" tabindex="-1">Saved on this device</h2>
            <p>Your check-in is available on board, even with the ground link offline.</p>
            <dl class="summary">
              <dt>Main sleep</dt><dd class="mono">${sleep?.quality === 'not-recorded' ? 'Not recorded' : formatMinutes(sleep?.value ?? null)}${sleep?.value === 0 ? ' (zero confirmed)' : ''}</dd>
              <dt>Drowsiness now</dt><dd class="mono">${drowsy?.quality === 'not-recorded' ? 'Not recorded' : `${drowsy?.value} / 9${DROWSINESS_ANCHORS[drowsy?.value ?? 0] ? ` · ${DROWSINESS_ANCHORS[drowsy!.value!]}` : ''}`}</dd>
              ${record.form.mood ? html`<dt>Mood</dt><dd class="mono">${record.form.mood} / 5 · ${MOOD_ANCHORS[record.form.mood]}</dd>` : ''}
              ${record.form.symptoms ? html`<dt>Symptoms or concern</dt><dd>${record.form.symptoms === 'yes' ? 'Yes' : record.form.symptoms === 'no' ? 'No' : 'Skipped'}${record.form.symptomsComment ? ` · “${record.form.symptomsComment}”` : ''}</dd>` : ''}
              ${record.form.hr ? html`<dt>Resting heart rate</dt><dd class="mono">${record.form.hr} bpm${record.form.hrRest !== 'yes' ? ' · rest not confirmed' : ''}</dd>` : ''}
              ${extraRows(record.form).map(row => html`<dt>${row.label}</dt><dd>${row.value}</dd>`)}
              <dt>Method</dt><dd>Sleep diary · HEXTA drowsiness scale · entered on this device</dd>
            </dl>
            <div class="row-actions"><button type="button" class="btn btn-quiet" data-action="checkin-edit">Correct today’s check-in</button></div>
          </section>
          ${alert ? html`<section class="card priority tone-review" aria-labelledby="alert-h">
              <p class="prio-k">${demoRuleTag()} ${badge('Crew review pending', 'review', 'clock')}</p>
              <h2 id="alert-h">Sleep trend needs review</h2>
              <p class="prio-why">${SLEEP_RULE.label} counted three consecutive sleep-diary nights below 360 min. Your crew medical officer was notified on board.</p>
              <ol class="evidence">${evidence.map((o) => html`<li><span>Day ${o.missionDay}</span><b class="mono">${formatMinutes(o.value)}</b><small>${o.method}</small></li>`)}</ol>
              <p class="fine">Demo rule, not a clinical threshold.</p>
            </section>` : c.rules.length === 0 ? html`<section class="card"><h2>No mission rule configured</h2><p>Explore app does not flag anything automatically. If something worries you, ask your CMO.</p><a class="btn btn-ghost" href="/follow-up#ask" data-link>Request crew review</a></section>` : ''}
        </div></div>`;
    }

    const isDraft = record?.status === 'draft';
    const zeroVisible = form.sleepConfirmZero || (form.sleepHours.trim() === '0' && ['', '0'].includes(form.sleepMinutes.trim()));
    const sleepDone = form.sleepNotRecorded || !!(form.sleepHours || form.sleepMinutes);
    const drowsyDone = form.drowsinessNotRecorded || !!form.drowsiness;
    const sleepText = form.sleepNotRecorded ? 'Not recorded' : form.sleepHours || form.sleepMinutes ? `${form.sleepHours || 0} h ${String(form.sleepMinutes || 0).padStart(2, '0')}` : '';
    const drowsyText = form.drowsinessNotRecorded ? 'Not recorded' : form.drowsiness ? `${form.drowsiness} / 9${DROWSINESS_ANCHORS[form.drowsiness] ? ` · ${DROWSINESS_ANCHORS[form.drowsiness]}` : ''}` : '';
    const seconds = STEPS.slice(step).reduce((sum, item) => sum + item.seconds, 0);
    const left = seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s`;
    const checkedSymptoms = form.symptoms === 'no' ? ['None'] : form.symptoms === 'yes' ? form.symptomsComment.split(', ').filter(Boolean) : [];
    const symptomChecked = (name: string) => checkedSymptoms.includes(name);
    const sensorRow = (variable: Variable, label: string) => {
        const observation = readings.filter(o => o.missionDay === day && o.variable === variable && o.source === 'simulated-sensor')
            .sort((a, b) => b.measuredAt.localeCompare(a.measuredAt))[0];
        return html`<div><dt>${label}</dt><dd>${observation ? html`${obsValue(observation)} ${qualityBadge(observation)}<small>${sourceLabel(observation)} · ${hhmm(Date.parse(observation.measuredAt))} UTC</small>` : 'No sensor reading today'}</dd></div>`;
    };
    const pane = (i: number, title: string, lead: string, body: Html) => html`<section class="ci-pane" data-step="${i}" ${step === i ? '' : 'hidden'} aria-labelledby="ci-t${i}">
        <p class="ci-k">Step ${i + 1} of ${STEPS.length} · ${STEPS[i].title}${completed ? '' : ` · about ${left} left`}</p>
        <h2 class="ci-title" id="ci-t${i}" tabindex="-1">${title}</h2>
        <p class="ci-lead">${lead}</p>
        ${body}
      </section>`;
    return html`${head}
    ${request ? html`<section class="notice"><b>Follow-up: ${request.label}</b><p>${request.reason}</p><a href="/follow-up?request=${request.id}#req-${request.id}" data-link>View the request</a></section>` : ''}
    <div class="ci-grid">
    ${stepper(completed)}
    <form id="checkin-form" class="card checkin ci-steps" ${completed ? '' : html`data-action="checkin-submit" data-mount="checkin"`} novalidate>
      <div class="ci-progress ci-progress-eight" aria-hidden="true">${STEPS.map((_, i) => html`<i class="${i === step ? 'now' : completed || i < progress ? 'done' : ''}"></i>`)}</div>
      <fieldset class="ci-panel" id="checkin-panel" ${completed ? 'disabled' : ''}>
      <legend class="sr-only">Check-in responses</legend>

      ${pane(0, `Good morning, ${repo.memberStatic(ws(), crewId).shortName}. How long did you sleep?`, 'Your best estimate of time actually asleep in your main sleep, without naps. It counts for today.', html`
      <dl class="ci-sensor-list">${sensorRow('sleep_main', 'Sleep · actigraphy')}</dl>
      <fieldset class="q ${errors.sleep ? 'has-error' : ''}" id="q-sleep">
        <legend class="sr-only">Main sleep that ended today</legend>
        <div class="sleep-entry">
          <div class="dial" aria-hidden="true">
            <svg viewBox="0 0 200 200"><circle class="dial-bg" cx="100" cy="100" r="86" pathLength="1"/><circle class="dial-val" cx="100" cy="100" r="86"/></svg>
            <div class="dial-txt"><b class="dial-big">– h –</b><span class="dial-sub">enter your night</span></div>
          </div>
          <div class="sleep-inputs">
            <div class="duration">
              <label for="sleepHours">Hours<input id="sleepHours" name="sleepHours" inputmode="numeric" pattern="[0-9]*" maxlength="2" value="${form.sleepHours}" ${errors.sleep ? 'aria-describedby="err-sleep"' : ''} ${form.sleepNotRecorded ? 'disabled' : ''}></label>
              <span aria-hidden="true">h</span>
              <label for="sleepMinutes">Minutes<input id="sleepMinutes" name="sleepMinutes" inputmode="numeric" pattern="[0-9]*" maxlength="2" value="${form.sleepMinutes}" ${errors.sleep ? 'aria-describedby="err-sleep"' : ''} ${form.sleepNotRecorded ? 'disabled' : ''}></label>
              <span aria-hidden="true">min</span>
            </div>
            <div class="nudge" role="group" aria-label="Adjust by 15 minutes">
              <button type="button" class="nudge-btn" data-action="sleep-step" data-d="-15" aria-label="15 minutes less">− 15 min</button>
              <button type="button" class="nudge-btn" data-action="sleep-step" data-d="15" aria-label="15 minutes more">+ 15 min</button>
            </div>
          </div>
        </div>
        <label class="check" id="zero-row" ${zeroVisible ? '' : 'hidden'}><input type="checkbox" name="sleepConfirmZero" ${form.sleepConfirmZero ? 'checked' : ''}> I slept 0 minutes (confirm a zero)</label>
        <label class="check"><input type="checkbox" name="sleepNotRecorded" ${form.sleepNotRecorded ? 'checked' : ''} onchange="this.form.sleepHours.disabled=this.form.sleepMinutes.disabled=this.checked"> I can’t estimate it today</label>
        ${err('sleep')}
      </fieldset>
      <details class="why"><summary>Why we ask</summary><p>Several short nights in a row lower alertness, which matters for operations and spacewalks. Your medical officer sees the trend, never a judgement.</p></details>`)}

      ${pane(1, 'Your morning vitals', 'Imported automatically. Nothing to enter.', html`
      <div class="ci-auto">
        <span class="ci-auto-k">${icon('ok', 'sm')}Imported · on-board sensors, 06:58 UTC</span>
        <div class="ci-auto-row"><span>Resting heart rate</span><b>61 bpm</b></div>
        <div class="ci-auto-row"><span>SpO₂</span><b>97 %</b></div>
        <div class="ci-auto-row"><span>Temperature</span><b>36.6 °C</b></div>
        <div class="ci-auto-row"><span>Respiratory rate</span><b>14 / min</b></div>
        <div class="ci-auto-row"><span>Fasting glucose</span><b>92 mg/dL</b></div>
        <div class="ci-auto-row"><span>Blood pressure</span><b>Guided measurement at 12:30</b></div>
      </div>
      <p class="hint">Demo dataset (simulated). Blood pressure is taken with the guided cuff later in the day.</p>`)}

      ${pane(2, 'How do you feel this morning?', 'Place the dot where you are. The trend over several days is what matters.', html`
      <div class="ci-feel">
        <div class="pad-wrap">
          <div class="pad" id="ci-pad" data-mount="ci-pad" data-mood="${form.mood ?? ''}" data-energy="${form.energy ?? ''}" tabindex="0" role="slider" aria-label="Mood and energy, arrow keys to move" aria-valuetext="">
            <span class="pq pq1">Tense</span><span class="pq pq2">Driven</span><span class="pq pq3">Drained</span><span class="pq pq4">Calm</span>
            <span class="pad-dot" id="ci-pad-dot"></span>
          </div>
          <div class="pad-axes"><span>← unpleasant</span><span>pleasant →</span></div>
          <p class="pad-out" id="ci-pad-out">Not set</p>
          <input type="hidden" name="mood" id="ci-mood" value="${form.mood ?? ''}">
          <input type="hidden" name="energy" id="ci-energy" value="${form.energy ?? ''}">
        </div>
        <div class="ci-feel-fields">
          <div class="ci-field">
            <label id="stressL">Perceived stress level</label>
            <div class="seg10" role="radiogroup" aria-labelledby="stressL">
              ${Array.from({ length: 10 }, (_, i) => i + 1).map((n) => html`<label class="seg10-o"><input type="radio" name="stress" value="${n}" ${form.stress === n ? 'checked' : ''}><span>${n}</span></label>`)}
            </div>
          </div>
          <fieldset class="ci-field q ${errors.drowsiness ? 'has-error' : ''}" id="q-drowsy">
            <label id="drowsy-l">How drowsy do you feel right now? <small>1 wide awake · 9 struggling to stay awake</small></label>
            <div class="seg10 seg9" role="radiogroup" aria-labelledby="drowsy-l">
              ${Array.from({ length: 9 }, (_, i) => i + 1).map((n) => html`<label class="seg10-o"><input type="radio" name="drowsiness" value="${n}" ${form.drowsiness === n ? 'checked' : ''} ${form.drowsinessNotRecorded ? 'disabled' : ''}><span>${n}</span></label>`)}
            </div>
            <label class="check"><input type="checkbox" name="drowsinessNotRecorded" ${form.drowsinessNotRecorded ? 'checked' : ''} onchange="this.form.querySelectorAll('[name=drowsiness]').forEach(i=>i.disabled=this.checked)"> Skip this today</label>
            ${err('drowsiness')}
          </fieldset>
          <div class="ci-auto">
            <span class="ci-auto-k">${icon('ok', 'sm')}Imported automatically from the sensors</span>
            <div class="ci-auto-row"><span>Sleep (actigraphy)</span><b>6 h 24</b></div>
            <div class="ci-auto-row"><span>Resting heart rate</span><b>61 bpm</b></div>
            <div class="ci-auto-row"><span>SpO₂</span><b>97 %</b></div>
          </div>
        </div>
      </div>`)}

      ${pane(3, 'Have you noticed any of these symptoms?', 'Tap everything that applies. Blurred vision is always sent to the medical officer.', html`
      <fieldset class="q">
        <legend class="sr-only">Symptoms this morning</legend>
        <div class="chips-sel" role="group" aria-label="Symptoms">
          ${SYMPTOM_CHIPS.map((name) => html`<label class="chip-sel ${name === 'None' ? 'chip-none' : ''}"><input type="checkbox" name="symptom" value="${name}" ${symptomChecked(name) ? 'checked' : ''}><span>${name}</span></label>`)}
        </div>
      </fieldset>
      <div class="ci-sym-report">
        <p class="ci-sym-lead">${icon('camera', 'sm')}Something visible — a mark, swelling, redness? Add a description and a photo for your medical officer.</p>
        <ol class="sym-steps">
          <li><b>Saved on this device</b><span>Your draft and photo survive a reload, even offline after the first visit.</span></li>
          <li><b>Submitted for onboard review</b><span>Your CMO reviews it on board; nothing is sent to the ground.</span></li>
          <li><b>Feedback in Follow-up</b><span>You find the CMO’s note and any question in Follow-up.</span></li>
        </ol>
        <a class="btn btn-primary" href="/symptoms" data-link>${icon('camera')}Report a symptom with a photo</a>
      </div>
`)}

      ${pane(4, 'How much have you drunk since waking?', 'Add water in 250 mL glasses. The connected bottle fills in the rest of the day.', html`
      <div class="ci-water-big">
        <button class="wbtn" type="button" data-action="ci-water" data-delta="-250" aria-label="Subtract 250 mL">−</button>
        <div class="ci-water-val"><b class="mono" id="ci-water-out" aria-live="polite">${(form.waterMl ?? 0) >= 1000 ? `${((form.waterMl ?? 0) / 1000).toFixed(2)} L` : `${form.waterMl ?? 0} mL`}</b><span>since waking</span></div>
        <button class="wbtn" type="button" data-action="ci-water" data-delta="250" aria-label="Add 250 mL">+</button>
        <input type="hidden" name="waterMl" id="ci-water" value="${form.waterMl ?? ''}">
      </div>
      <div class="ci-bar" aria-hidden="true"><i id="ci-water-bar" style="width:${Math.min(100, ((form.waterMl ?? 0) / 2500) * 100)}%"></i></div>
      <p class="hint">Flight-surgeon goal: 2.5 L across the day.</p>
      <fieldset class="q ci-urine">
        <legend>Urine colour at waking <small>shade 1 to 8</small></legend>
        <div class="urine-scale" role="radiogroup" aria-label="Urine colour, shade 1 to 8">
          ${['#FBF8E1', '#F8F0B4', '#F3E487', '#EED45E', '#E6BE3F', '#D9A42A', '#C3871E', '#A06A18'].map((colour, i) => html`<label class="urine-dot" style="--u:${colour}"><input type="radio" name="urineShade" value="${i + 1}" ${form.urineShade === i + 1 ? 'checked' : ''}><span aria-label="Shade ${i + 1} of 8">${i + 1}</span></label>`)}
        </div>
        <p class="hint">1–3 well hydrated · 4–5 drink more · 6–8 tell your medical officer.</p>
      </fieldset>`)}

      ${pane(5, 'Have you had breakfast?', 'These answers are optional.', html`
        <fieldset class="q"><legend>Breakfast</legend>${choice('breakfast', ['Eaten', 'Not yet', 'Skipped'], form.breakfast)}</fieldset>
        <fieldset class="q"><legend>Appetite</legend>${choice('appetite', ['Low', 'Normal', 'High'], form.appetite)}</fieldset>`)}

      ${pane(6, 'Yesterday’s exercise', 'Imported from the exercise log. Nothing to enter.', html`
      <dl class="ci-sensor-list">
        <div><dt>ARED · resistive</dt><dd>75 min · 110 kg <small>Demo dataset (simulated)</small></dd></div>
        <div><dt>CEVIS · cycle</dt><dd>30 min <small>Demo dataset (simulated)</small></dd></div>
        <div><dt>7-day regularity</dt><dd>6 of 7 days <small>Demo dataset (simulated)</small></dd></div>
      </dl>
      <p class="hint">Resistive and aerobic exercise protect bone, muscle and the heart in microgravity.</p>`)}

      ${pane(LAST, 'Check and save', 'Your responses are saved on this device and available on board, even with the ground link offline.', html`
      <dl class="ci-sum">
        ${[
            { t: 'Main sleep', v: sleepText, missing: !sleepDone, i: 0 },
            { t: 'Drowsiness now', v: drowsyText, missing: !drowsyDone, i: 2 },
            { t: 'Mood', v: form.mood ? `${form.mood}/5` : 'Not recorded', missing: false, i: 2 },
            { t: 'Symptoms', v: form.symptoms === 'yes' ? form.symptomsComment || 'Yes' : form.symptoms === 'no' ? 'None' : 'Not recorded', missing: false, i: 3 },
            ...extraRows(form).map(r => ({ t: r.label, v: r.value, missing: false, i: r.step })),
        ].map((r) => html`<div class="${r.missing ? 'missing' : ''}"><dt>${r.t}</dt><dd class="mono">${r.v || 'Required'}</dd><button type="button" class="btn-link" data-action="ci-step" data-to="${r.i}">Edit<span class="sr-only"> ${r.t}</span></button></div>`)}
      </dl>`)}
      </fieldset>

      <p class="draft-status" id="draft-status" role="status">${completed ? 'Saved on this device' : isDraft ? `Draft saved on this device · ${hhmm(Date.parse(record!.savedAt))} UTC` : 'Not saved yet'}</p>
      <div class="form-actions ci-nav">
        ${step > 0 ? html`<button type="button" class="btn btn-ghost" data-action="ci-step" data-to="${step - 1}">${icon('back', 'sm')}Previous</button>` : task && task.ev.state === 'due' && task.ev.canSnooze ? html`<button type="button" class="btn btn-quiet" data-action="snooze">Snooze 30 min</button>` : ''}
        <span class="ci-spacer"></span>
        ${completed ? html`<button type="button" class="btn btn-primary" data-action="ci-step" data-to="${step + 1}">Next ${icon('arrow', 'sm')}</button>` : step < LAST
            ? html`${sleepDone && drowsyDone && step !== 5 ? html`<button type="submit" class="btn btn-quiet" data-save="1">Save now</button>` : ''}<button type="button" class="btn btn-primary" data-action="ci-step" data-advance="true" data-to="${step + 1}">Continue ${icon('arrow', 'sm')}</button>`
            : html`${task && task.ev.state === 'due' && task.ev.canSnooze ? html`<button type="button" class="btn btn-quiet" data-action="snooze">Snooze 30 min</button>` : ''}<button type="button" class="btn btn-quiet" data-action="checkin-draft">Save draft</button><button type="submit" class="btn btn-primary" data-save="1">${icon('ok')}Save check-in</button>`}
      </div>
    </form>
    </div>`;
}
