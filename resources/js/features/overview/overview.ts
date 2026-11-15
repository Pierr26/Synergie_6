import { icon } from '../../components/icons';
import { badge, obsValue, pageHead, sourceLabel } from '../../components/ui';
import * as repo from '../../data/repo';
import { reviewItems } from '../../data/experience';
import { VARIABLE_META } from '../../domain/measurements';
import { missionDay, hhmm } from '../../domain/time';
import { html, type Html } from '../../lib/html';
import { registerActions } from '../../router-actions';
import { app, cfg, me, ws } from '../../state';

const COCKPIT_VIDEO = '/assets/illustrations/today-cockpit.mp4';
let cockpit: HTMLVideoElement | null = null;

registerActions({
    'mount:today-cockpit': (container) => {
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const video = container as HTMLVideoElement;
        const resumeAt = cockpit?.currentTime ?? 0;
        cockpit = video;
        video.addEventListener('loadedmetadata', () => {
            if (resumeAt > 0 && resumeAt < video.duration) video.currentTime = resumeAt;
        }, { once: true });
        video.muted = true;
        video.src = COCKPIT_VIDEO;
        void video.play().catch(() => { /* The poster remains visible if autoplay is blocked. */ });
    },
});

/** A next action is derived from the same records the medical officer reviews. */
export async function renderOverview(): Promise<Html> {
    const crew = me(), day = missionDay(app.now, cfg().epoch);
    const [task, checkin, requests, items, observations, symptoms] = await Promise.all([
        repo.todaysTask(ws(), crew, app.now), repo.checkinFor(ws(), crew, day), repo.requestsFor(ws(), crew),
        reviewItems(ws(), crew), repo.currentObservations(ws(), crew), repo.symptomReportsFor(ws(), crew),
    ]);
    const follow = requests.find(r => r.kind === 'follow-up' && r.status === 'open');
    const symptomFollow = items.find(i => i.waitingForCrew && symptoms.some(s => s.id === i.id));
    const pending = items.filter(i => !i.waitingForCrew);
    const saved = checkin?.status === 'submitted';
    let title = saved ? 'Your check-in is saved.' : 'A moment for your health.';
    let reason = saved ? 'Today’s sleep and drowsiness are saved on this device. Your summary is ready.' : 'Start with sleep and drowsiness. About one minute, at your own pace.';
    let cta: { href: string; label: string } | null = null;
    let state = saved ? 'Saved on this device' : task?.ev.state === 'due' ? 'Check-in due' : task?.ev.state === 'snoozed' ? `Snoozed until ${hhmm(task.task.snoozedUntil!)} UTC` : `Scheduled ${hhmm(task?.ev.effectiveDue ?? app.now)} UTC`;
    if (follow || symptomFollow) {
        title = 'Your medical officer has a question.';
        reason = follow ? `${follow.label}. ${follow.reason}` : symptomFollow!.reason;
        cta = { label: 'Respond to follow-up', href: follow ? `/follow-up?request=${follow.id}#req-${follow.id}` : `/follow-up?symptom=${symptomFollow!.id}#sym-${symptomFollow!.id}` };
        state = 'Follow-up requested';
    } else if (pending.length && saved) {
        title = 'Crew review pending';
        reason = `${pending[0].reason}. Your medical officer can review it in this demo on the same device. You can keep using every section.`;
        cta = { label: 'Track crew review', href: '/follow-up' }; state = 'Crew review pending';
    }
    const latest = ['sleep_main', 'drowsiness', 'resting_hr'] as const;
    const nextSteps = [
        { href: '/symptoms', ic: 'camera', title: 'Report a Symptom', text: symptoms.some(s => s.status === 'draft') ? 'Your draft and photo are kept here' : 'Describe a visible sign · optional photo' },
        { href: '/follow-up', ic: 'followup', title: 'Follow-up', text: follow || symptomFollow ? 'Your response is requested' : pending.length ? 'Track your crew review' : 'Requests, responses and review history' },
    ];
    return html`${pageHead('Today', html`Welcome back, ${repo.memberStatic(ws(), crew).shortName}. Your next step, then the rest of your day.`)}
      <section class="today-hero" aria-labelledby="next-h">
        <div class="today-copy"><span class="mission-kicker">Crew health · Day ${day}</span>
          ${badge(state, saved && !pending.length && !follow && !symptomFollow ? 'ok' : 'info', saved ? 'ok' : 'clock')}
          <h2 id="next-h">${title}</h2><p>${reason}</p>
          ${cta ? html`<a class="btn btn-primary" data-link href="${cta.href}">${cta.label}${icon('arrow')}</a>` : ''}
          ${saved ? html`<span class="today-saved">${icon('ok', 'sm')}Check-in saved · ${hhmm(Date.parse(checkin.submittedAt!))} UTC</span>` : ''}
        </div>
        <div class="today-window" aria-hidden="true">
          <video data-mount="today-cockpit" muted loop playsinline disablepictureinpicture poster="/assets/illustrations/lunar-window.webp"></video>
        </div>
      </section>
      <nav class="journey-links" aria-label="Your daily journey">
        ${nextSteps.map((s,i) => html`<a href="${s.href}" data-link class="journey-link"><span class="journey-step">0${i+1}</span>${icon(s.ic)}<span><b>${s.title}</b><small>${s.text}</small></span>${icon('arrow', 'sm')}</a>`)}
      </nav>
      <div class="grid-2 today-lower">
        <section class="card" aria-labelledby="today-readings"><div class="card-h"><h2 id="today-readings">Your latest readings</h2><a href="/trends" data-link>All trends ${icon('arrow','sm')}</a></div>
          ${latest.map(v => {
              const o = observations.filter(o => o.variable === v).sort((a,b) => b.measuredAt.localeCompare(a.measuredAt))[0];
              return html`<a class="today-reading" href="/trends?metric=${v}" data-link><span>${VARIABLE_META[v].label}<small>${o ? `Day ${o.missionDay} · ${hhmm(Date.parse(o.measuredAt))} UTC · ${sourceLabel(o)}` : 'No measurement recorded'}</small></span><b class="mono">${o ? obsValue(o) : '—'}</b></a>`;
          })}<p class="fine">Missing readings stay missing. No value is inferred.</p>
        </section>
        <section class="card" aria-labelledby="open-actions"><h2 id="open-actions">Also open to you</h2>
          <p><a href="/body" data-link>Explore Body & Risks ${icon('arrow','sm')}</a></p>
          <p><a href="/measurements" data-link>Add a spot measurement ${icon('arrow','sm')}</a></p>
          <p><a href="/follow-up#ask" data-link>Ask for a crew review ${icon('arrow','sm')}</a></p>
          <div class="storage-note"><b>Three separate steps</b><span>Saved on this device → available to the CMO demo in this browser → ground transmission only when a report is queued.</span><small>No live crew-device sync is implied by the demo. Photos stay out of ground reports.</small></div>
        </section>
      </div>`;
}
