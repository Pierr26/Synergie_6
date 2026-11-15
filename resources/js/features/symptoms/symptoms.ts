/**
 * "Report a symptom": the crew member documents a visible sign (description, body area, time noticed,
 * optional photo) and submits it to the crew medical officer on board. Capture and review are stored
 * apart (see domain/symptoms.ts). Photos live in IndexedDB only. Nothing here talks to the ground.
 */
import { bus } from '../../bus';
import { icon } from '../../components/icons';
import { badge, pageHead, toast } from '../../components/ui';
import * as repo from '../../data/repo';
import { awaitingReply, BODY_AREAS, symptomReviewState, validatePhoto, validateSubmission, type ReviewKind, type SymptomInput, type SymptomReport, type SymptomReviewEntry } from '../../domain/symptoms';
import { hhmm, missionDay, timeOnDay, utcStamp } from '../../domain/time';
import { html, type Html } from '../../lib/html';
import { actions, registerActions } from '../../router-actions';
import { app, cfg, me, ws } from '../../state';

let errors: Partial<Record<keyof SymptomInput | 'photo', string>> = {};
const draftWrites = new WeakMap<HTMLFormElement, Promise<void>>();

function readForm(f: HTMLFormElement): SymptomInput {
    const fd = new FormData(f);
    const day = Number(fd.get('noticedDay'));
    const time = String(fd.get('noticedTime') ?? '');
    const ok = Number.isInteger(day) && day > 0 && /^\d{2}:\d{2}$/.test(time);
    return {
        description: String(fd.get('description') ?? '').trim(),
        bodyArea: String(fd.get('bodyArea') ?? ''),
        noticedAt: ok ? new Date(timeOnDay(day, cfg().epoch, time)).toISOString() : '',
    };
}

/** Fictional image for the demo: drawn locally, clearly labelled, never a real person. */
async function simulatedPhoto(): Promise<{ name: string; mime: string; data: ArrayBuffer; simulated: boolean }> {
    const response = await fetch('/assets/illustrations/simulated-skin-mark.webp');
    if (!response.ok) throw new Error('The demo image is unavailable. You can still submit without a photo.');
    return { name: 'simulated-skin-mark.webp', mime: 'image/webp', data: await response.arrayBuffer(), simulated: true };
}

function showPhotoError(message: string): void {
    const el = document.getElementById('photo-err');
    if (!el) return;
    el.innerHTML = `${icon('review').value}<span></span>`;
    el.querySelector('span')!.textContent = message;
    el.hidden = false;
    document.getElementById('status-region')!.textContent = message;
}

async function storePhoto(form: HTMLFormElement, photo: { name: string; mime: string; data: ArrayBuffer; simulated?: boolean } | null): Promise<void> {
    try {
        await draftWrites.get(form);
        await repo.saveSymptomDraft(ws(), me(), readForm(form), photo, app.now);
    } catch (e) {
        showPhotoError(`The photo could not be saved on this device (${e instanceof Error ? e.message : 'storage error'}). Your text is kept: try again, or submit the description alone.`);
        return;
    }
    errors = {};
    toast(photo ? 'Photo and draft saved on this device.' : 'Photo removed. Draft saved on this device.');
    await bus.refresh();
}

registerActions({
    'symptom-photo': async (el) => {
        const input = el as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;
        const problem = validatePhoto(file);
        if (problem) {
            input.value = '';
            showPhotoError(problem);
            return;
        }
        let data: ArrayBuffer;
        try {
            data = await file.arrayBuffer();
        } catch {
            input.value = '';
            showPhotoError('This file could not be read. Choose it again or take a new photo; your text is kept.');
            return;
        }
        await storePhoto(input.form!, { name: file.name, mime: file.type, data });
    },
    'symptom-demo-photo': async (el) => {
        try { await storePhoto((el as HTMLButtonElement).form!, await simulatedPhoto()); }
        catch { showPhotoError('Demo image unavailable. Choose a photo or submit the description alone.'); }
    },
    'symptom-photo-remove': async (el) => {
        await storePhoto((el as HTMLButtonElement).form!, null);
    },
    'symptom-save': async (el, e) => {
        const f = el as HTMLFormElement;
        const intent = ((e as SubmitEvent).submitter as HTMLButtonElement | null)?.value ?? 'draft';
        const input = readForm(f);
        await draftWrites.get(f);
        await repo.saveSymptomDraft(ws(), me(), input, undefined, app.now);
        if (intent === 'draft') {
            errors = {};
            toast('Draft saved on this device.');
            await bus.refresh();
            return;
        }
        errors = validateSubmission(input, app.now);
        if (Object.keys(errors).length) {
            await bus.refresh();
            const first = (['description', 'bodyArea', 'noticedAt'] as const).find((k) => errors[k]);
            document.getElementById(first === 'noticedAt' ? 'sym-day' : first === 'bodyArea' ? 'sym-area' : 'sym-desc')?.focus();
            toast('Draft saved on this device. Complete the marked fields to submit.');
            return;
        }
        const row = await repo.submitSymptomReport(ws(), me(), app.now);
        errors = {};
        toast('Submitted for onboard review. Your CMO was notified on board; nothing was sent to the ground.');
        bus.navigate(row ? `/follow-up?symptom=${row.id}#symptoms` : '/follow-up#symptoms');
    },
    'symptom-discard': async (el) => {
        await draftWrites.get((el as HTMLButtonElement).form!);
        await repo.discardSymptomDraft(ws(), me());
        errors = {};
        toast('Draft deleted from this device.');
        bus.navigate('/follow-up#symptoms');
    },
    'symptom-review': async (el, e) => {
        const f = el as HTMLFormElement;
        const kind = (((e as SubmitEvent).submitter as HTMLButtonElement | null)?.value ?? 'note') as Exclude<ReviewKind, 'reply'>;
        const area = f.querySelector('textarea')!;
        const text = area.value.trim();
        if (!text) {
            f.querySelector('.error')?.removeAttribute('hidden');
            area.focus();
            return;
        }
        await repo.reviewSymptomReport(ws(), String(f.dataset.id), me(), kind, text, app.now);
        f.reset();
        toast(kind === 'completed' ? 'Review recorded. The crew member was notified on board.' : kind === 'more-info' ? 'Request sent to the crew member on board.' : 'Note saved. The crew member was notified on board.');
        await bus.refresh();
    },
    'symptom-reply': async (el) => {
        const f = el as HTMLFormElement;
        const area = f.querySelector('textarea')!;
        const text = area.value.trim();
        if (!text) {
            f.querySelector('.error')?.removeAttribute('hidden');
            area.focus();
            return;
        }
        await repo.replySymptomReport(ws(), String(f.dataset.id), me(), text, app.now);
        f.reset();
        toast('Reply saved. Your CMO was notified on board.');
        await bus.refresh();
    },
    // photos are read from IndexedDB after each render; object URLs never leave this page
    'mount:symptom-draft': async (el) => {
        const f = el as HTMLFormElement;
        const owner = me(), workspace = ws();
        let saving = Promise.resolve();
        const persist = () => {
            const input = readForm(f);
            saving = saving.then(async () => {
                await repo.saveSymptomDraft(workspace, owner, input, undefined, app.now);
                const status = f.querySelector('.sym-saved');
                if (status) status.textContent = 'Draft saved on this device · photo kept with your draft';
            }).catch(() => { showPhotoError('Local storage is full or unavailable. Keep this page open and try saving again.'); });
            draftWrites.set(f, saving);
        };
        f.addEventListener('input', persist);
        f.addEventListener('change', persist);
        await actions['mount:symptom-photos']?.(el, new Event('mount'));
    },
    'mount:symptom-photos': async (el) => {
        const needed = new Set([...document.querySelectorAll<HTMLElement>('img[data-att]')].map(i => i.dataset.att!));
        for (const [id, url] of urls) if (!needed.has(id)) { URL.revokeObjectURL(url); urls.delete(id); }
        const imgs = [...el.querySelectorAll<HTMLImageElement>('img[data-att]')];
        for (const img of imgs) {
            const id = img.dataset.att!;
            let url = urls.get(id);
            if (!url) {
                const att = await repo.symptomAttachment(ws(), img.dataset.crew!, id);
                if (!att) {
                    img.alt = 'Photo not available on this device';
                    continue;
                }
                url = URL.createObjectURL(new Blob([att.data], { type: att.mime }));
                urls.set(id, url);
            }
            img.src = url;
        }
    },
});

const urls = new Map<string, string>();

function statusBadge(r: SymptomReport, thread: SymptomReviewEntry[]): Html {
    const state = symptomReviewState(r, thread);
    return badge(state, r.status === 'reviewed' ? 'ok' : state === 'Follow-up requested' ? 'review' : 'info', r.status === 'reviewed' ? 'ok' : 'clock');
}

const KIND_LABEL: Record<ReviewKind, string> = { note: 'Note', 'more-info': 'More information requested', completed: 'Review completed', reply: 'Reply' };

/** One report as a card, for the crew member (Follow-up) or the CMO (member file). */
function reportCard(r: SymptomReport, thread: SymptomReviewEntry[], viewer: 'astronaut' | 'cmo', highlight: boolean): Html {
    const c = cfg();
    const waiting = awaitingReply(thread);
    return html`<article class="req sym ${highlight ? 'req-hl' : ''}" id="sym-${r.id}">
      <header><span class="req-k">${icon('camera')}Symptom report · ${r.bodyArea || 'area not set'}</span><span class="sym-st">${statusBadge(r, thread)}</span></header>
      <p class="fine mono">Report ${r.id}${r.attachmentId ? ` · Photo ${r.attachmentId}` : ''}</p>
      <div class="sym-body">
        ${r.attachmentId
            ? html`<figure class="sym-photo"><img data-att="${r.attachmentId}" data-crew="${r.crewId}" alt="Photo attached to the symptom report: ${r.bodyArea}" width="320" height="240"><figcaption>Demo attachment · stored in this browser</figcaption></figure>`
            : html`<p class="sym-nophoto">${icon('image')}No photo · description only</p>`}
        <div>
          <p class="sym-desc">${r.description || html`<span class="muted">No description yet.</span>`}</p>
          <dl class="sym-meta">
            <div><dt>Body area</dt><dd>${r.bodyArea || '—'}</dd></div>
            <div><dt>Noticed</dt><dd class="mono">${r.noticedAt ? `Day ${missionDay(Date.parse(r.noticedAt), c.epoch)} · ${hhmm(Date.parse(r.noticedAt))} UTC` : '—'}</dd></div>
            <div><dt>${r.submittedAt ? 'Submitted' : 'Saved'}</dt><dd class="mono">${utcStamp(Date.parse(r.submittedAt ?? r.savedAt))}</dd></div>
          </dl>
        </div>
      </div>
      ${thread.length ? html`<ol class="sym-thread">${thread.map((t) => html`<li class="k-${t.kind}"><b>${KIND_LABEL[t.kind]} · ${repo.memberStatic(ws(), t.authorId).alias}</b> <span class="mono">${utcStamp(Date.parse(t.at))}</span><p>${t.text}</p></li>`)}</ol>` : ''}
      ${viewer === 'astronaut' && r.status === 'draft' ? html`<a class="btn btn-primary" href="/symptoms" data-link>Resume draft ${icon('arrow')}</a>` : ''}
      ${viewer === 'astronaut' && r.status === 'submitted' && !thread.length ? html`<p class="fine">Waiting for your CMO. This report stays on board: sending anything to the ground is a separate CMO decision.</p>` : ''}
      ${viewer === 'astronaut' && r.status !== 'draft' && waiting ? html`<form class="answer" data-action="symptom-reply" data-id="${r.id}" novalidate>
          <label for="rep-${r.id}">Your reply to the CMO</label>
          <textarea id="rep-${r.id}" name="text" rows="2" maxlength="400"></textarea>
          <p class="error" hidden>${icon('review')}Write a short reply before sending.</p>
          <button class="btn btn-primary" type="submit">${icon('send')}Send reply</button>
        </form>` : ''}
      ${viewer === 'cmo' && r.status === 'submitted' ? html`<form class="answer sym-review" data-action="symptom-review" data-id="${r.id}" novalidate>
          <label for="rev-${r.id}">Review note (shown to the crew member)</label>
          <textarea id="rev-${r.id}" name="text" rows="2" maxlength="400"></textarea>
          <p class="error" hidden>${icon('review')}Write a short note first.</p>
          <div class="row-actions">
            <button class="btn btn-primary" type="submit" name="kind" value="completed">${icon('ok')}Complete review</button>
            <button class="btn btn-ghost" type="submit" name="kind" value="more-info">Request more information</button>
            <button class="btn btn-ghost" type="submit" name="kind" value="note">Add note</button>
          </div>
        </form>` : ''}
    </article>`;
}

/** Section listing a crew member's reports. The CMO never sees drafts. */
export async function symptomSection(viewer: 'astronaut' | 'cmo', crewId: string, highlight: string | null): Promise<Html> {
    const all = await repo.symptomReportsFor(ws(), crewId);
    const rows = viewer === 'cmo' ? all.filter((r) => r.status !== 'draft') : all;
    const threads = await Promise.all(rows.map((r) => repo.symptomThread(ws(), r.id)));
    const hasDraft = all.some((r) => r.status === 'draft');
    return html`<section class="card" id="symptoms" aria-labelledby="sym-h" data-mount="symptom-photos">
      <div class="card-h"><h2 id="sym-h">Symptom reports</h2>${viewer === 'astronaut' ? html`<a class="btn btn-ghost btn-small" href="/symptoms" data-link>${icon('camera')}${hasDraft ? 'Resume draft' : 'Report a symptom'}</a>` : ''}</div>
      ${viewer === 'astronaut' ? html`<p class="hint">Document something you can see (skin, eye, swelling) with a description and an optional photo. Your CMO reviews it on board.</p>` : html`<p class="hint">Submitted by the crew member for onboard review. Photos stay on board and are not part of ground reports.</p>`}
      ${rows.length ? rows.map((r, i) => reportCard(r, threads[i], viewer, r.id === highlight)) : html`<p class="muted">${viewer === 'cmo' ? 'No symptom report submitted by this member.' : 'No symptom report yet.'}</p>`}
    </section>`;
}

export async function pendingSymptomReports(crewId: string): Promise<number> {
    return (await repo.symptomReportsFor(ws(), crewId)).filter((r) => r.status === 'submitted').length;
}

export async function renderSymptomForm(): Promise<Html> {
    if (app.role !== 'astronaut') return html`${pageHead('Report a symptom')}<div class="card">${icon('info')} Symptom reports are written by the crew member. As CMO, open a member file to review them.</div>`;
    const c = cfg();
    const day = missionDay(app.now, c.epoch);
    const draft = await repo.symptomDraft(ws(), me());
    const noticed = draft?.noticedAt ? Date.parse(draft.noticedAt) : app.now;
    const att = draft?.attachmentId ? await repo.symptomAttachment(ws(), me(), draft.attachmentId) : undefined;
    const err = (k: keyof typeof errors) => (errors[k] ? html`<p class="error">${icon('review')}${errors[k]}</p>` : '');
    return html`
    <p class="crumbs"><a href="/follow-up#symptoms" data-link>${icon('back')}Follow-up</a></p>
    ${pageHead('Report a symptom', 'Describe what you see and add a photo if it helps. Your crew medical officer reviews it on board.')}
    <div class="grid-2 sym-grid">
      <form class="card sym-form" data-action="symptom-save" data-mount="symptom-draft" novalidate>
        <p class="sym-saved" role="status">${draft ? html`${badge('Saved on this device', 'ok', 'device')} <span class="mono">${hhmm(Date.parse(draft.savedAt))} UTC</span> · you can leave and resume, even offline` : html`${badge('Not saved yet', 'muted', 'missing')} Save a draft or add a photo to keep it on this device`}</p>
        <div class="field ${errors.description ? 'has-error' : ''}"><label for="sym-desc">What do you see?</label><p class="hint">A few words: aspect, size, colour, pain or itching.</p><textarea id="sym-desc" name="description" rows="3" maxlength="600">${draft?.description ?? ''}</textarea>${err('description')}</div>
        <div class="field ${errors.bodyArea ? 'has-error' : ''}"><label for="sym-area">Body area</label><select id="sym-area" name="bodyArea"><option value="">Choose an area</option>${BODY_AREAS.map((a) => html`<option value="${a}" ${draft?.bodyArea === a ? html`selected` : ''}>${a}</option>`)}</select>${err('bodyArea')}</div>
        <fieldset class="q ${errors.noticedAt ? 'has-error' : ''}"><legend>When did you notice it?</legend>
          <div class="sym-when">
            <div class="field"><label for="sym-day">Mission day</label><input id="sym-day" name="noticedDay" inputmode="numeric" value="${missionDay(noticed, c.epoch)}" size="5"></div>
            <div class="field"><label for="sym-time">Time (UTC)</label><input id="sym-time" name="noticedTime" type="time" value="${hhmm(noticed)}"></div>
          </div>
          ${err('noticedAt')}<p class="hint">Today is Day ${day}.</p>
        </fieldset>
        <fieldset class="q sym-photo-f"><legend>Photo (optional)</legend>
          ${att
              ? html`<figure class="sym-photo lg"><img data-att="${att.id}" data-crew="${me()}" alt="Preview of the attached photo" width="320" height="240"><figcaption>${att.simulated ? 'Simulated image · ' : ''}${att.name} · ${(att.size / 1024).toFixed(0)} kB · saved on this device</figcaption></figure>`
              : html`<p class="hint">JPEG, PNG or WebP, up to 5 MB. The photo stays in this browser. The CMO demo uses the same device.</p>`}
          <div class="row-actions">
            <label class="btn btn-ghost file-btn">${icon('camera')}${att ? 'Replace with a new photo' : 'Take a photo'}<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" data-action="symptom-photo" aria-label="${att ? 'Replace with a new photo' : 'Take a photo'}"></label>
            <label class="btn btn-ghost file-btn">${icon('image')}${att ? 'Replace from this device' : 'Choose from this device'}<input type="file" accept="image/jpeg,image/png,image/webp" data-action="symptom-photo" aria-label="${att ? 'Replace from this device' : 'Choose from this device'}"></label>
            ${c.id === 'demo' && !att ? html`<button type="button" class="btn btn-quiet" data-action="symptom-demo-photo">Use a simulated image</button>` : ''}
            ${att ? html`<button type="button" class="btn btn-quiet" data-action="symptom-photo-remove">${icon('trash')}Remove photo</button>` : ''}
          </div>
          <p class="error" id="photo-err" role="alert" hidden></p>
        </fieldset>
        <div class="form-actions">
          <button class="btn btn-primary" type="submit" name="intent" value="submit">${icon('send')}Submit for onboard review</button>
          <button class="btn btn-ghost" type="submit" name="intent" value="draft">Save draft</button>
          ${draft ? html`<button type="button" class="btn btn-quiet" data-action="symptom-discard">Delete draft</button>` : ''}
        </div>
      </form>
      <aside class="card sym-help" aria-labelledby="symh-h">
        <h2 id="symh-h">What happens next</h2>
        <ol class="sym-steps">
          <li><b>Saved on this device</b><span>Text saves as you type. Your draft and photo survive a reload, including offline after the first visit.</span></li>
          <li><b>Submitted for onboard review</b><span>In this demo, switch to CMO in the same browser to review it. This does not sync to another device.</span></li>
          <li><b>Reviewed</b><span>Your CMO records the review. You find the feedback in Follow-up.</span></li>
        </ol>
        <p class="note"><b>Stays on board</b>Submitting is not a ground transmission. Photos are never added to ground reports by default.</p>
        <p class="fine">Not for emergencies: follow your crew’s medical procedure if you need help now. No automated image analysis is performed.</p>
      </aside>
    </div>`;
}
