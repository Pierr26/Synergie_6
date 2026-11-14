import { bus } from '../../bus';
import { icon } from '../../components/icons';
import { badge, demoRuleTag, pageHead, simTag, toast } from '../../components/ui';
import type { CheckinForm } from '../../data/db';
import * as repo from '../../data/repo';
import { DROWSINESS_ANCHORS, MOOD_ANCHORS, parseSleep, validateDrowsiness } from '../../domain/measurements';
import { SLEEP_RULE } from '../../domain/sleep';
import { formatMinutes, hhmm, missionDay } from '../../domain/time';
import { html, type Html } from '../../lib/html';
import { registerActions } from '../../router-actions';
import { app, cfg, me, ws } from '../../state';

let form: CheckinForm = { ...repo.EMPTY_FORM };
let formKey = '';
let editing = false;
let errors: Record<string, string> = {};
/** progressive check-in: 0 sleep · 1 drowsiness · 2 extras · 3 review */
let step = 0;
const STEP_OF: Record<string, number> = { sleep: 0, drowsiness: 1, hr: 2 };
const draftWrites = new WeakMap<HTMLFormElement, Promise<void>>();
const correctionKey = (crew: string, day: number, request: string | null) => `checkin-edit:${crew}:${day}:${request ?? 'correction'}`;

function readForm(root: HTMLFormElement): CheckinForm {
    const fd = new FormData(root);
    const num = (k: string) => (fd.get(k) === null || fd.get(k) === '' ? null : Number(fd.get(k)));
    return {
        sleepHours: String(fd.get('sleepHours') ?? ''),
        sleepMinutes: String(fd.get('sleepMinutes') ?? ''),
        sleepNotRecorded: fd.get('sleepNotRecorded') === 'on',
        sleepConfirmZero: fd.get('sleepConfirmZero') === 'on',
        drowsiness: num('drowsiness'),
        drowsinessNotRecorded: fd.get('drowsinessNotRecorded') === 'on',
        mood: num('mood'),
        symptoms: (fd.get('symptoms') as CheckinForm['symptoms']) ?? '',
        symptomsComment: String(fd.get('symptomsComment') ?? ''),
        hr: String(fd.get('hr') ?? ''),
        hrRest: (fd.get('hrRest') as CheckinForm['hrRest']) ?? 'yes',
        hrMethod: String(fd.get('hrMethod') ?? 'Manual pulse count'),
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
        if (step < 3 && submitter?.dataset.save !== '1') {
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
    /** move between steps; going forward checks only the current step */
    'ci-step': async (el) => {
        const f = document.getElementById('checkin-form') as HTMLFormElement | null;
        if (f) form = readForm(f);
        const to = Number(el.dataset.to);
        if (to > step) {
            const v = validate(form);
            const here = Object.keys(v.errors).filter((k) => (STEP_OF[k] ?? 0) === step);
            errors = Object.fromEntries(here.map((k) => [k, v.errors[k]]));
            if (here.length) {
                await bus.refresh();
                document.querySelector<HTMLElement>('.ci-pane:not([hidden]) .has-error input')?.focus();
                return;
            }
        } else errors = {};
        step = Math.max(0, Math.min(3, to));
        await bus.refresh();
        (document.querySelector('.ci-pane:not([hidden]) .ci-title') as HTMLElement | null)?.focus();
    },
    'checkin-edit': async () => {
        editing = true;
        step = 0;
        await bus.refresh();
        (document.getElementById('sleepHours') as HTMLElement | null)?.focus();
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

function scale(name: string, max: number, value: number | null, anchors: Record<number, string>, labelledBy: string, disabled = false): Html {
    return html`<div class="scale scale-${max}" role="radiogroup" aria-labelledby="${labelledBy}">
      ${Array.from({ length: max }, (_, i) => i + 1).map(
          (n) => html`<label class="scale-opt"><input type="radio" name="${name}" value="${n}" ${value === n ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span class="scale-n mono">${n}</span><span class="scale-a">${anchors[n] ?? ''}</span></label>`,
      )}
    </div>`;
}

function err(key: string): Html {
    return errors[key] ? html`<p class="error" id="err-${key}">${icon('review')}${errors[key]}</p>` : html``;
}

export async function renderCheckin(): Promise<Html> {
    const c = cfg();
    const crewId = me();
    const day = missionDay(app.now, c.epoch);
    const record = await repo.checkinFor(ws(), crewId, day);
    const task = await repo.todaysTask(ws(), crewId, app.now);
    const reqId = app.route.query.get('request');
    const key = `${ws()}|${crewId}|${day}|${record?.id ?? 'none'}|${record?.status ?? ''}|${reqId ?? ''}|${editing}`;
    if (key !== formKey) {
        // new day, new record or a demo reset: reload from storage; otherwise keep what is being typed
        const correction = record?.status === 'submitted' ? await repo.kvGet<CheckinForm | null>(ws(), correctionKey(crewId, day, reqId), null) : null;
        form = correction ?? (record ? { ...record.form } : { ...repo.EMPTY_FORM });
        formKey = key;
        errors = {};
        // a waiting draft with both required answers opens straight on "Check and save" (teammate's fast path)
        const req = (form.sleepNotRecorded || !!(form.sleepHours.trim() || form.sleepMinutes.trim())) && (form.drowsinessNotRecorded || !!form.drowsiness);
        step = req ? 3 : !(form.sleepNotRecorded || form.sleepHours.trim() || form.sleepMinutes.trim()) ? 0 : 1;
    }

    if (app.role !== 'astronaut') {
        return html`${pageHead('Daily check-in')}<div class="card">${icon('info')} The daily check-in is filled in by the astronaut. Switch role to Astronaut to open it.</div>`;
    }

    const head = pageHead('Daily check-in', html`Day ${day} · ${task ? (task.ev.state === 'completed' ? 'Completed' : task.ev.state === 'snoozed' ? `Snoozed until ${hhmm(task.task.snoozedUntil!)} UTC` : `Due ${hhmm(task.ev.effectiveDue)} UTC`) : ''}`, simTag());

    const request = reqId ? (await repo.requestsFor(ws(), crewId)).find(r => r.id === reqId && r.status === 'open') : null;
    if (record?.status === 'submitted' && !editing && !request) {
        const obs = (await repo.currentObservations(ws(), crewId)).filter((o) => record.observationIds.includes(o.id));
        const alert = (await repo.alertsFor(ws(), crewId)).find((a) => a.status === 'needs-review' && a.endDay >= day - 1);
        const evidence = alert ? (await repo.currentObservations(ws(), crewId)).filter((o) => alert.evidenceIds.includes(o.id)).sort((a, b) => a.missionDay - b.missionDay) : [];
        const sleep = obs.find((o) => o.variable === 'sleep_main');
        const drowsy = obs.find((o) => o.variable === 'drowsiness');
        return html`${head}
        <div class="checkin-done">
          <section class="card saved done-card" aria-labelledby="saved-h">
            <span class="done-ic">${icon('ok')}</span>
            <p class="prio-k">Completed · ${hhmm(Date.parse(record.submittedAt!))} UTC</p>
            <h2 id="saved-h" tabindex="-1">Saved on this device</h2>
            <p>The reminder is closed. Your crew medical officer sees this check-in on board, even with the ground link offline.</p>
            <dl class="summary">
              <dt>Main sleep</dt><dd class="mono">${sleep?.quality === 'not-recorded' ? 'Not recorded' : formatMinutes(sleep?.value ?? null)}${sleep?.value === 0 ? ' (zero confirmed)' : ''}</dd>
              <dt>Drowsiness now</dt><dd class="mono">${drowsy?.quality === 'not-recorded' ? 'Not recorded' : `${drowsy?.value} / 9${DROWSINESS_ANCHORS[drowsy?.value ?? 0] ? ` · ${DROWSINESS_ANCHORS[drowsy!.value!]}` : ''}`}</dd>
              ${record.form.mood ? html`<dt>Mood</dt><dd class="mono">${record.form.mood} / 5 · ${MOOD_ANCHORS[record.form.mood]}</dd>` : ''}
              ${record.form.symptoms ? html`<dt>Symptoms or concern</dt><dd>${record.form.symptoms === 'yes' ? 'Yes' : record.form.symptoms === 'no' ? 'No' : 'Skipped'}${record.form.symptomsComment ? ` · “${record.form.symptomsComment}”` : ''}</dd>` : ''}
              ${record.form.hr ? html`<dt>Resting heart rate</dt><dd class="mono">${record.form.hr} bpm${record.form.hrRest !== 'yes' ? ' · rest not confirmed' : ''}</dd>` : ''}
              <dt>Method</dt><dd>Sleep diary · HEXTA drowsiness scale · entered on this device</dd>
            </dl>
            <div class="row-actions"><a href="/overview" data-link class="btn btn-primary">Back to Today</a><button type="button" class="btn btn-quiet" data-action="checkin-edit">Correct today’s check-in</button></div>
          </section>
          ${alert ? html`<section class="card priority tone-review" aria-labelledby="alert-h">
              <p class="prio-k">${demoRuleTag()} ${badge('Crew review pending', 'review', 'clock')}</p>
              <h2 id="alert-h">Sleep trend needs review</h2>
              <p class="prio-why">${SLEEP_RULE.label} counted three consecutive sleep-diary nights below 360 min. Your crew medical officer was notified on board.</p>
              <ol class="evidence">${evidence.map((o) => html`<li><span>Day ${o.missionDay}</span><b class="mono">${formatMinutes(o.value)}</b><small>${o.method}</small></li>`)}</ol>
              <p class="fine">${simTag()} Demo rule, not a clinical threshold.</p>
            </section>` : c.rules.length === 0 ? html`<section class="card"><h2>No mission rule configured</h2><p>Explore app does not flag anything automatically. If something worries you, ask your CMO.</p><a class="btn btn-ghost" href="/follow-up#ask" data-link>Request crew review</a></section>` : ''}
        </div>`;
    }

    const isDraft = record?.status === 'draft';
    const zeroVisible = form.sleepConfirmZero || (form.sleepHours.trim() === '0' && ['', '0'].includes(form.sleepMinutes.trim()));
    const sleepDone = form.sleepNotRecorded || !!(form.sleepHours || form.sleepMinutes);
    const drowsyDone = form.drowsinessNotRecorded || !!form.drowsiness;
    const sleepText = form.sleepNotRecorded ? 'Not recorded' : form.sleepHours || form.sleepMinutes ? `${form.sleepHours || 0} h ${String(form.sleepMinutes || 0).padStart(2, '0')}` : '';
    const drowsyText = form.drowsinessNotRecorded ? 'Not recorded' : form.drowsiness ? `${form.drowsiness} / 9${DROWSINESS_ANCHORS[form.drowsiness] ? ` · ${DROWSINESS_ANCHORS[form.drowsiness]}` : ''}` : '';
    const steps = [
        { t: 'Sleep', s: sleepText || 'Required', done: sleepDone },
        { t: 'Drowsiness', s: drowsyText ? `${form.drowsiness ?? '—'} / 9` : form.drowsinessNotRecorded ? 'Not recorded' : 'Required', done: drowsyDone },
        { t: 'Extras', s: 'Optional', done: !!(form.mood || form.symptoms || form.hr) },
        { t: 'Review and save', s: 'Last step', done: false },
    ];
    const left = ['about 1 min left', 'about 40 s left', 'about 20 s left', 'ready to save'][step];
    const tired = (form.drowsiness ?? 0) >= 7;
    const pane = (i: number, title: string, lead: string, body: Html) => html`<section class="ci-pane" data-step="${i}" ${step === i ? '' : 'hidden'} aria-labelledby="ci-t${i}">
        <p class="ci-k">Step ${i + 1} of 4 · ${steps[i].t} · ${left}</p>
        <h2 class="ci-title" id="ci-t${i}" tabindex="-1">${title}</h2>
        <p class="ci-lead">${lead}</p>
        ${body}
      </section>`;
    return html`${head}
    ${request ? html`<section class="notice"><b>Follow-up: ${request.label}</b><p>${request.reason}</p><a href="/follow-up?request=${request.id}#req-${request.id}" data-link>View the request</a></section>` : ''}
    <div class="ci-grid">
    <nav class="card stepper" aria-label="Check-in steps">
      <div class="card-h"><h3>Morning check-in</h3><small>≈ 60 s</small></div>
      ${steps.map((st, i) => html`<button type="button" class="step ${i === step ? 'now' : st.done ? 'done' : ''}" data-action="ci-step" data-to="${i}" ${i === step ? html`aria-current="step"` : ''}><span class="n">${st.done && i !== step ? icon('ok', 'sm') : i + 1}</span><span><b>${st.t}</b><small>${st.s}</small></span></button>`)}
      <p class="step-note">${icon('info', 'sm')}Saved on this device as you go. Works with the ground link offline.</p>
    </nav>
    <form id="checkin-form" class="card checkin ci-steps" data-action="checkin-submit" data-mount="checkin" novalidate>
      <div class="ci-progress" aria-hidden="true"><span style="width:${((step + 1) / 4) * 100}%"></span></div>
      <p class="draft-status" id="draft-status" role="status">${isDraft ? `Draft saved on this device · ${hhmm(Date.parse(record!.savedAt))} UTC` : 'Not saved yet'}</p>

      ${pane(0, `Good morning, ${repo.memberStatic(ws(), crewId).shortName}. How long did you sleep?`, 'Your best estimate of time actually asleep in your main sleep, without naps. It counts for today.', html`
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

      ${pane(1, 'How drowsy do you feel right now?', '1 means wide awake, 9 means fighting to stay awake. Pick the number that fits this moment.', html`
      <fieldset class="q ${errors.drowsiness ? 'has-error' : ''}" id="q-drowsy">
        <legend id="drowsy-l" class="sr-only">How drowsy do you feel right now?</legend>
        ${scale('drowsiness', 9, form.drowsiness, DROWSINESS_ANCHORS, 'drowsy-l', form.drowsinessNotRecorded)}
        <label class="check"><input type="checkbox" name="drowsinessNotRecorded" ${form.drowsinessNotRecorded ? 'checked' : ''} onchange="this.form.querySelectorAll('[name=drowsiness]').forEach(i=>i.disabled=this.checked)"> Skip this today</label>
        ${err('drowsiness')}
      </fieldset>
      <details class="why"><summary>What the numbers mean</summary><p>This is a quick sleepiness scale used in sleep research. 7 or more means you feel clearly sleepy. It is timestamped when you save.</p></details>`)}

      ${pane(2, tired ? 'You feel quite sleepy. Anything else to tell?' : 'Anything else today?', tired ? 'You rated 7 or more. A word on what is going on helps your medical officer. Everything here stays optional.' : 'Optional. Skip this step if nothing comes to mind.', html`
      <fieldset class="q">
        <legend id="mood-l">Mood</legend>
        ${scale('mood', 5, form.mood, MOOD_ANCHORS, 'mood-l')}
      </fieldset>
      <fieldset class="q ${tired ? 'ci-ask' : ''}">
        <legend>${tired ? 'Did something disturb your sleep or worry you?' : 'Any symptom or concern?'}</legend>
        <div class="seg-choice">
          ${(['yes', 'no', 'skip'] as const).map((v) => html`<label><input type="radio" name="symptoms" value="${v}" ${form.symptoms === v ? 'checked' : ''}><span>${v === 'yes' ? 'Yes' : v === 'no' ? 'No' : 'Skip'}</span></label>`)}
        </div>
        <label for="symptomsComment" class="sub">A few words (optional)</label>
        <input id="symptomsComment" name="symptomsComment" maxlength="200" value="${form.symptomsComment}">
        <p class="hint sym-link">Something visible to show? <a href="/symptoms" data-link>Report a symptom with a photo</a></p>
      </fieldset>
      <details class="optional" ${form.hr || errors.hr ? 'open' : ''}>
        <summary>Resting heart rate</summary>
        <fieldset class="q ${errors.hr ? 'has-error' : ''}">
          <legend class="sr-only">Resting heart rate</legend>
          <div class="inline-fields">
            <label for="hr">Beats per minute<input id="hr" name="hr" inputmode="numeric" value="${form.hr}" maxlength="3"></label>
            <label for="hrRest">At rest?<select id="hrRest" name="hrRest">${(['yes', 'no', 'unknown'] as const).map((v) => html`<option value="${v}" ${form.hrRest === v ? 'selected' : ''}>${v === 'yes' ? 'Yes, 5 min at rest' : v === 'no' ? 'No' : 'Not sure'}</option>`)}</select></label>
            <label for="hrMethod">Method<select id="hrMethod" name="hrMethod">${['Manual pulse count', 'Pulse oximeter', 'Chest strap (simulated)'].map((m) => html`<option ${form.hrMethod === m ? 'selected' : ''}>${m}</option>`)}</select></label>
          </div>
          <p class="hint">Without a confirmed rest, the value stays outside the resting series.</p>
          ${err('hr')}
        </fieldset>
      </details>`)}

      ${pane(3, 'Check and save', 'Saved on this device and visible to your medical officer on board, even with the ground link offline.', html`
      <dl class="ci-sum">
        ${[
            { t: 'Main sleep', v: sleepText, missing: !sleepDone, i: 0 },
            { t: 'Drowsiness now', v: drowsyText, missing: !drowsyDone, i: 1 },
            { t: 'Extras', v: [form.mood ? `Mood ${form.mood}/5` : '', form.symptoms ? `Symptom or concern: ${form.symptoms === 'yes' ? 'yes' : form.symptoms === 'no' ? 'no' : 'skipped'}${form.symptomsComment ? ` · “${form.symptomsComment}”` : ''}` : '', form.hr ? `${form.hr} bpm` : ''].filter(Boolean).join(' · ') || 'Nothing added', missing: false, i: 2 },
        ].map((r) => html`<div class="${r.missing ? 'missing' : ''}"><dt>${r.t}</dt><dd class="mono">${r.v || 'Required'}</dd><button type="button" class="btn-link" data-action="ci-step" data-to="${r.i}">Edit<span class="sr-only"> ${r.t}</span></button></div>`)}
      </dl>`)}

      <div class="form-actions ci-nav">
        ${step > 0 ? html`<button type="button" class="btn btn-ghost" data-action="ci-step" data-to="${step - 1}">${icon('back', 'sm')}Previous</button>` : task && task.ev.state === 'due' && task.ev.canSnooze ? html`<button type="button" class="btn btn-quiet" data-action="snooze">Snooze 30 min</button>` : ''}
        <span class="ci-spacer"></span>
        ${step < 3
            ? html`${sleepDone && drowsyDone ? html`<button type="submit" class="btn btn-quiet" data-save="1">Save now</button>` : ''}<button type="button" class="btn btn-primary" data-action="ci-step" data-to="${step + 1}">${step === 2 ? 'Review' : 'Continue'}${icon('arrow', 'sm')}</button>`
            : html`<button type="button" class="btn btn-quiet" data-action="checkin-draft">Save draft</button><button type="submit" class="btn btn-primary" data-save="1">${icon('ok')}Save check-in</button>`}
      </div>
    </form>
    </div>`;
}
