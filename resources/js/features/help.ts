import { icon } from '../components/icons';
import { pageHead } from '../components/ui';
import { html, type Html } from '../lib/html';
import { registerActions } from '../router-actions';
import type { Role } from '../domain/types';
import { app, writePref } from '../state';
import { SOURCES } from './body-risks/content';

interface Step {
    title: string;
    text: string;
}

const ROLE_NAME: Record<Role, string> = { astronaut: 'Astronaut', cmo: 'Crew medical officer', ground: 'Flight surgeon · Houston' };

const GUIDES: Record<Role, Step[]> = {
    astronaut: [
        { title: 'Your daily check-in', text: 'Each morning, log your main sleep and how drowsy you feel. Optional fields come after. About one minute.' },
        { title: 'Reminder and snooze', text: 'At 07:00 UTC a banner says “Daily check-in is due”. Snooze 30 min if you are busy; the reminder returns at the new time.' },
        { title: 'Saved on this device', text: 'Everything is stored locally and keeps working without network or ground link. Your CMO on board sees your entries.' },
        { title: 'Ask for a review', text: 'From Follow-up or any Body & Risks card, ask the crew medical officer for a review. Answers appear in Follow-up.' },
    ],
    cmo: [
        { title: 'Crew console', text: 'Open a member to see check-ins, trends, missing observations, lab results and requests.' },
        { title: 'Review a signal', text: 'A notification opens the trend and the observations behind it. Record your review and request a follow-up if needed.' },
        { title: 'Individual report', text: 'Choose a member and period, generate a snapshot, print it, then decide whether to queue it for ground.' },
        { title: 'Receipts', text: 'A report shows Queued, Sending, Received or Retry available. Received only appears after the selected receiver acknowledges it.' },
    ],
    ground: [
        { title: 'What reaches Earth', text: 'You see only the reports the crew medical officer decided to send, frozen, with their receipt. Check-ins, photos and live values stay on board.' },
        { title: 'Link outages', text: 'When the ground link is down, nothing arrives and the crew keeps working. The console shows when the last report came in.' },
        { title: 'Notes to the crew', text: 'Write advice or a question for the crew medical officer. It waits in Houston until the link returns, then appears in the crew console.' },
    ],
};

function guideKey(): string {
    return `quinta.guide.${app.role}`;
}

function guideSeen(): boolean {
    try {
        return localStorage.getItem(guideKey()) !== null;
    } catch {
        return true;
    }
}

let step = 0;

function dialogHtml(): Html {
    const steps = GUIDES[app.role];
    const s = steps[step];
    return html`
    <form method="dialog" class="guide" data-action="guide-next">
      <p class="eyebrow">${ROLE_NAME[app.role]} guide · ${step + 1} of ${steps.length}</p>
      <h2 id="guide-title">${s.title}</h2>
      <p>${s.text}</p>
      <div class="guide-dots" aria-hidden="true">${steps.map((_, i) => html`<i class="${i === step ? 'on' : ''}"></i>`)}</div>
      <div class="guide-actions">
        <button type="button" class="btn btn-quiet" data-action="guide-skip">Skip guide</button>
        <button type="submit" class="btn btn-primary">${step === steps.length - 1 ? 'Finish guide' : 'Next'}</button>
      </div>
    </form>`;
}

function openGuide(): void {
    step = 0;
    let dlg = document.getElementById('guide-dialog') as HTMLDialogElement | null;
    if (!dlg) {
        dlg = document.createElement('dialog');
        dlg.id = 'guide-dialog';
        dlg.setAttribute('aria-labelledby', 'guide-title');
        dlg.addEventListener('cancel', () => writePref(guideKey(), 'skipped'));
        document.body.appendChild(dlg);
    }
    dlg.innerHTML = dialogHtml().value;
    if (!dlg.open) dlg.showModal();
}

function closeGuide(state: 'skipped' | 'done'): void {
    writePref(guideKey(), state);
    (document.getElementById('guide-dialog') as HTMLDialogElement | null)?.close();
    (document.getElementById('page-title') as HTMLElement | null)?.focus();
}

export async function maybeShowGuide(): Promise<void> {
    if (!guideSeen()) openGuide();
}

registerActions({
    'guide-open': () => openGuide(),
    'guide-skip': () => closeGuide('skipped'),
    'guide-next': () => {
        if (step >= GUIDES[app.role].length - 1) return closeGuide('done');
        step++;
        const dlg = document.getElementById('guide-dialog') as HTMLDialogElement;
        dlg.innerHTML = dialogHtml().value;
        (dlg.querySelector('button[type=submit]') as HTMLElement).focus();
    },
});

export async function renderHelp(): Promise<Html> {
    return html`
    ${pageHead('Help', 'Short guides for each role. Available offline.', html`<button type="button" class="btn btn-primary" data-action="guide-open">${icon('play')}Reopen the ${app.role === 'cmo' ? 'CMO' : app.role === 'ground' ? 'Houston' : 'astronaut'} guide</button>`)}
    <div class="grid-3">
      ${(['astronaut', 'cmo', 'ground'] as const).map(
          (r) => html`
        <section class="card ${r !== app.role ? 'muted-card' : ''}" aria-labelledby="h-${r}">
          <h2 id="h-${r}">${ROLE_NAME[r]}</h2>
          <ol class="steps">${GUIDES[r].map((s) => html`<li><strong>${s.title}</strong><span>${s.text}</span></li>`)}</ol>
        </section>`,
      )}
    </div>
    <section class="card" aria-labelledby="h-states">
      <h2 id="h-states">Status words</h2>
      <dl class="defs">
        <dt>Ground link</dt><dd>Simulated link with mission control. When offline, the crew keeps working; reports wait in the queue.</dd>
        <dt>Device online / offline</dt><dd>Network state reported by this browser. Independent from the simulated ground link.</dd>
        <dt>Ready offline</dt><dd>The app is cached on this device and reloads without network.</dd>
        <dt>No reading</dt><dd>Nothing was recorded. HEXTA never fills a gap with an assumed value.</dd>
        <dt>Not recorded</dt><dd>The crew member explicitly marked the field as unavailable.</dd>
        <dt>Check measurement</dt><dd>Kept, but needs verification (e.g. systolic not above diastolic, unknown site or signal).</dd>
        <dt>Demo rule</dt><dd>SLEEP-001 v1, only in the guided demo: three consecutive diary nights under 360 min ask the CMO for a review. Not a clinical threshold.</dd>
        <dt>No mission rule configured</dt><dd>Explore app has no automatic rule. Anyone can still ask for a crew review.</dd>
        <dt>Queued · Sending · Received · Retry available</dt><dd>States of a report in the ground queue. Received needs an acknowledgement from the selected receiver.</dd>
      </dl>
    </section>
    <section class="card" id="nasa" aria-labelledby="h-nasa">
      <h2 id="h-nasa">NASA resources in HEXTA</h2>
      <p class="hint">What each public NASA resource is used for. Crew values are simulated: public NASA pages describe risks and measures, not day-by-day crew vitals.</p>
      <dl class="defs">
        <dt><a href="${SOURCES.S01.url}" target="_blank" rel="noopener">Five hazards of human spaceflight</a></dt><dd>Structure of Overview and Body &amp; Risks: every recorded indicator is linked to one of the five hazards.</dd>
        <dt><a href="${SOURCES.S02.url}" target="_blank" rel="noopener">Human spaceflight risks</a></dt><dd>The “Why this matters” text of each body region (sleep, cardiovascular, SANS, bone and muscle, renal).</dd>
        <dt><a href="${SOURCES.S11.url}" target="_blank" rel="noopener">Standard Measures</a></dt><dd>Choice of the daily and spot indicators, and keeping method, context and time with every value.</dd>
        <dt><a href="${SOURCES.STD.url}" target="_blank" rel="noopener">NASA-STD-3001 Vol. 2</a></dt><dd>Design reference for crew autonomy: on-board review first, ground report only by crew decision, operation without the ground link.</dd>
        <dt><a href="${SOURCES.EX.url}" target="_blank" rel="noopener">Astronaut exercise on the ISS</a></dt><dd>“What you can do” advice for bones, muscles and heart.</dd>
      </dl>
    </section>
    <section class="card" id="credits" aria-labelledby="h-credits">
      <h2 id="h-credits">Sources &amp; credits</h2>
      <ul class="sources">${Object.values(SOURCES).map((s) => html`<li><a href="${s.url}" target="_blank" rel="noopener">${s.title}</a> · ${s.org}</li>`)}</ul>
      <ul class="credits">
        <li>HEXTA logo · Synergy 5 team.</li>
        <li>Lunar window scene · AI-generated image, made for the HEXTA kit. Labelled on screen wherever it appears. Not a NASA photo.</li>
        <li>3D anatomy · <a href="https://humanatlas.io/3d-reference-library" target="_blank" rel="noopener">HuBMAP Human Reference Atlas</a> female and male reference bodies (Visible Human, Allen brain), CC BY 4.0, simplified for HEXTA. Motion is illustrative and never reflects a crew member’s heart rate.</li>
        <li>2D body map · original stylised render from the HEXTA kit.</li>
        <li>Fonts · Figtree, Young Serif and IBM Plex Mono, SIL Open Font License 1.1, served from this app.</li>
        <li>Libraries · Laravel (MIT), Vite (MIT), Dexie.js (Apache-2.0), three.js (MIT).</li>
        <li>All crew records are simulated. Not affiliated with or endorsed by NASA.</li>
      </ul>
    </section>`;
}
