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
let saveTimer: number | undefined;

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
    'checkin-submit': async (el) => {
        const f = readForm(el as HTMLFormElement);
        const v = validate(f);
        form = f;
        errors = v.errors;
        if (Object.keys(v.errors).length) {
            await bus.refresh();
            const first = document.querySelector<HTMLElement>('.has-error input, .has-error [role=radiogroup] input');
            first?.focus();
            toast('Some fields need attention before saving.');
            return;
        }
        const requestId = app.route.query.get('request');
        const res = await repo.submitCheckin(ws(), me(), f, v.minutes, app.now, requestId);
        editing = false;
        toast(res.newAlert ? 'Check-in saved on this device. Sleep trend needs review — your CMO was notified.' : 'Check-in saved on this device.');
        await bus.refresh();
        (document.getElementById('saved-h') as HTMLElement | null)?.focus();
    },
    'checkin-draft': async () => {
        const el = document.getElementById('checkin-form') as HTMLFormElement;
        form = readForm(el);
        await repo.saveDraft(ws(), me(), form, app.now);
        toast('Draft saved on this device. Resume it any time today.');
        await bus.refresh();
    },
    'checkin-edit': async () => {
        editing = true;
        await bus.refresh();
        (document.getElementById('sleepHours') as HTMLElement | null)?.focus();
    },
    'mount:checkin': (el) => {
        const f = el as HTMLFormElement;
        const persist = () =>
            void repo.saveDraft(ws(), me(), form, app.now).then(() => {
                const s = document.getElementById('draft-status');
                if (s) s.textContent = `Draft saved on this device · ${hhmm(app.now)} UTC`;
            });
        // choices (radios, checkboxes, selects, blurred fields) are saved at once; typing is debounced
        f.addEventListener('change', () => {
            form = readForm(f);
            window.clearTimeout(saveTimer);
            persist();
        });
        f.addEventListener('input', () => {
            form = readForm(f);
            window.clearTimeout(saveTimer);
            saveTimer = window.setTimeout(persist, 600);
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
    const key = `${ws()}|${crewId}|${day}|${record?.id ?? 'none'}|${record?.status ?? ''}`;
    if (key !== formKey) {
        // new day, new record or a demo reset: reload from storage; otherwise keep what is being typed
        if (!(formKey.endsWith('|none|') && record?.status === 'draft')) form = record ? { ...record.form } : { ...repo.EMPTY_FORM };
        formKey = key;
        errors = {};
    }

    if (app.role !== 'astronaut') {
        return html`${pageHead('Daily check-in')}<div class="card">${icon('info')} The daily check-in is filled in by the astronaut. Switch role to Astronaut to open it.</div>`;
    }

    const head = pageHead('Daily check-in', html`Day ${day} · ${task ? (task.ev.state === 'completed' ? 'Completed' : task.ev.state === 'snoozed' ? `Snoozed until ${hhmm(task.task.snoozedUntil!)} UTC` : `Due ${hhmm(task.ev.effectiveDue)} UTC`) : ''}`, simTag());

    if (record?.status === 'submitted' && !editing) {
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
              <dt>Method</dt><dd>Sleep diary · QUINTA drowsiness scale · entered on this device</dd>
            </dl>
            <div class="row-actions"><a href="/overview" data-link class="btn btn-primary">Back to Overview</a><button type="button" class="btn btn-quiet" data-action="checkin-edit">Correct today’s check-in</button></div>
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
    const optionalOpen = !!(form.mood || form.symptoms || form.hr || errors.hr);
    return html`${head}
    ${reqId ? html`<p class="notice">${icon('followup')}This check-in answers a follow-up request from your crew medical officer.</p>` : ''}
    <div class="ci-grid">
    <nav class="card stepper" aria-label="Check-in steps">
      ${[
          { href: '#q-sleep', n: '1', t: 'Main sleep', s: form.sleepNotRecorded ? 'Not recorded' : form.sleepHours || form.sleepMinutes ? `${form.sleepHours || 0} h ${form.sleepMinutes || 0} min` : 'Required', done: form.sleepNotRecorded || !!(form.sleepHours || form.sleepMinutes) },
          { href: '#q-drowsy', n: '2', t: 'Drowsiness now', s: form.drowsinessNotRecorded ? 'Not recorded' : form.drowsiness ? `${form.drowsiness} / 9` : 'Required', done: form.drowsinessNotRecorded || !!form.drowsiness },
          { href: '#q-optional', n: '3', t: 'Optional extras', s: 'Mood, symptoms, heart rate', done: !!(form.mood || form.symptoms || form.hr) },
      ].map((st, i, all) => html`<a class="step ${st.done ? 'done' : ''} ${!st.done && all.slice(0, i).every((x) => x.done) ? 'now' : ''}" href="${st.href}"><span class="n">${st.done ? icon('ok', 'sm') : st.n}</span><span><b>${st.t}</b><small>${st.s}</small></span></a>`)}
      <p class="step-note">${icon('info', 'sm')}Saved on this device. Works with the ground link offline.</p>
    </nav>
    <form id="checkin-form" class="card checkin" data-action="checkin-submit" data-mount="checkin" novalidate>
      <div class="q-h"><span class="k">Day ${day} · about one minute</span><h2>Good morning, ${repo.memberStatic(ws(), crewId).shortName}. How did you sleep?</h2><p class="draft-status" id="draft-status" role="status">${isDraft ? `Draft saved on this device · ${hhmm(Date.parse(record!.savedAt))} UTC` : 'Not saved yet'}</p></div>

      <fieldset class="q ${errors.sleep ? 'has-error' : ''}" id="q-sleep">
        <legend><span class="q-n">1</span>Main sleep that ended today</legend>
        <p class="hint" id="sleep-hint">Your estimate of time actually asleep in your main sleep period, without awakenings or naps. Counted on the day you woke up (Day ${app.now ? missionDay(app.now, c.epoch) : ''}).</p>
        <div class="sleep-entry">
          <div class="dial" aria-hidden="true">
            <svg viewBox="0 0 200 200"><circle class="dial-bg" cx="100" cy="100" r="86" pathLength="1"/><circle class="dial-val" cx="100" cy="100" r="86"/></svg>
            <div class="dial-txt"><b class="dial-big">– h –</b><span class="dial-sub">enter your night</span></div>
          </div>
          <div class="sleep-inputs">
        <div class="duration">
          <label for="sleepHours">Hours<input id="sleepHours" name="sleepHours" inputmode="numeric" pattern="[0-9]*" maxlength="2" value="${form.sleepHours}" aria-describedby="sleep-hint${errors.sleep ? ' err-sleep' : ''}" ${form.sleepNotRecorded ? 'disabled' : ''}></label>
          <span aria-hidden="true">h</span>
          <label for="sleepMinutes">Minutes<input id="sleepMinutes" name="sleepMinutes" inputmode="numeric" pattern="[0-9]*" maxlength="2" value="${form.sleepMinutes}" aria-describedby="sleep-hint${errors.sleep ? ' err-sleep' : ''}" ${form.sleepNotRecorded ? 'disabled' : ''}></label>
          <span aria-hidden="true">min</span>
        </div>
            <div class="nudge" role="group" aria-label="Adjust by 15 minutes">
              <button type="button" class="nudge-btn" data-action="sleep-step" data-d="-15" aria-label="15 minutes less">− 15 min</button>
              <button type="button" class="nudge-btn" data-action="sleep-step" data-d="15" aria-label="15 minutes more">+ 15 min</button>
            </div>
          </div>
        </div>
        <label class="check" id="zero-row" ${zeroVisible ? '' : 'hidden'}><input type="checkbox" name="sleepConfirmZero" ${form.sleepConfirmZero ? 'checked' : ''}> I slept 0 minutes (confirm a zero)</label>
        <label class="check"><input type="checkbox" name="sleepNotRecorded" ${form.sleepNotRecorded ? 'checked' : ''} onchange="this.form.sleepHours.disabled=this.form.sleepMinutes.disabled=this.checked"> Not recorded — I can’t estimate it today</label>
        ${err('sleep')}
      </fieldset>

      <fieldset class="q ${errors.drowsiness ? 'has-error' : ''}" id="q-drowsy">
        <legend id="drowsy-l"><span class="q-n">2</span>How drowsy do you feel right now?</legend>
        <p class="hint">1 = wide awake, 9 = struggling to stay awake. Timestamped when you save.</p>
        ${scale('drowsiness', 9, form.drowsiness, DROWSINESS_ANCHORS, 'drowsy-l', form.drowsinessNotRecorded)}
        <label class="check"><input type="checkbox" name="drowsinessNotRecorded" ${form.drowsinessNotRecorded ? 'checked' : ''} onchange="this.form.querySelectorAll('[name=drowsiness]').forEach(i=>i.disabled=this.checked)"> Not recorded</label>
        ${err('drowsiness')}
      </fieldset>

      <details class="optional" id="q-optional" ${optionalOpen ? 'open' : ''}>
        <summary>Optional: mood, symptoms, resting heart rate</summary>
        <fieldset class="q">
          <legend id="mood-l">Mood</legend>
          ${scale('mood', 5, form.mood, MOOD_ANCHORS, 'mood-l')}
        </fieldset>
        <fieldset class="q">
          <legend>Any symptom or concern?</legend>
          <div class="seg-choice">
            ${(['yes', 'no', 'skip'] as const).map((v) => html`<label><input type="radio" name="symptoms" value="${v}" ${form.symptoms === v ? 'checked' : ''}><span>${v === 'yes' ? 'Yes' : v === 'no' ? 'No' : 'Skip'}</span></label>`)}
          </div>
          <label for="symptomsComment" class="sub">Short comment (optional)</label>
          <input id="symptomsComment" name="symptomsComment" maxlength="200" value="${form.symptomsComment}">
          <p class="hint sym-link">Something visible to show your CMO? <a href="/follow-up/symptom" data-link>Report a symptom with a photo</a></p>
        </fieldset>
        <fieldset class="q ${errors.hr ? 'has-error' : ''}">
          <legend>Resting heart rate</legend>
          <div class="inline-fields">
            <label for="hr">Beats per minute<input id="hr" name="hr" inputmode="numeric" value="${form.hr}" maxlength="3"></label>
            <label for="hrRest">At rest?<select id="hrRest" name="hrRest">${(['yes', 'no', 'unknown'] as const).map((v) => html`<option value="${v}" ${form.hrRest === v ? 'selected' : ''}>${v === 'yes' ? 'Yes, 5 min at rest' : v === 'no' ? 'No' : 'Not sure'}</option>`)}</select></label>
            <label for="hrMethod">Method<select id="hrMethod" name="hrMethod">${['Manual pulse count', 'Pulse oximeter', 'Chest strap (simulated)'].map((m) => html`<option ${form.hrMethod === m ? 'selected' : ''}>${m}</option>`)}</select></label>
          </div>
          <p class="hint">Without a confirmed rest context, the value stays outside the resting series.</p>
          ${err('hr')}
        </fieldset>
        <p><a href="/measurements" data-link>${icon('plus')}Add a spot measurement</a> (blood pressure, SpO₂, temperature, glucose)</p>
      </details>

      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${icon('ok')}Save check-in</button>
        <button type="button" class="btn btn-ghost" data-action="checkin-draft">Save draft</button>
        ${task && task.ev.state === 'due' && task.ev.canSnooze ? html`<button type="button" class="btn btn-quiet" data-action="snooze">Snooze 30 min</button>` : ''}
      </div>
    </form>
    </div>`;
}
