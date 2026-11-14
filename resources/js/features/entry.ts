import { icon } from '../components/icons';
import { html, type Html } from '../lib/html';
import { registerActions } from '../router-actions';
import { app, writePref } from '../state';
import type { Role, WorkspaceId } from '../domain/types';
import { bus } from '../bus';

interface RoleCard {
    role: Role;
    img: string;
    title: string;
    where: string;
    does: string;
}

const ROLES: RoleCard[] = [
    { role: 'astronaut', img: 'astronaut', title: 'Astronaut', where: 'On board', does: 'Log your sleep, a measurement or a symptom. See what it means for you.' },
    { role: 'cmo', img: 'crew-medical-officer', title: 'Crew medical officer', where: 'On board', does: 'Review what the crew logged, answer, and decide what goes to Earth.' },
    { role: 'ground', img: 'houston-flight-surgeon', title: 'Flight surgeon', where: 'Houston', does: 'Read the reports the crew sends. Reply when the link allows.' },
];

function mode(): WorkspaceId {
    let m: string | null = null;
    try {
        m = localStorage.getItem('quinta.entry-mode');
    } catch {
        /* preference only */
    }
    return m === 'explore' ? 'explore' : 'demo';
}

registerActions({
    'entry-mode': async (el) => {
        writePref('quinta.entry-mode', el.dataset.ws!);
        await bus.refresh();
    },
});

export async function renderEntry(): Promise<Html> {
    const m = mode();
    return html`
    <div class="entry entry-roles">
      <main class="entry-panel" id="main" tabindex="-1">
        <header class="entry-top">
          <img class="entry-logo" src="/assets/brand/quinta-logo.svg" alt="QUINTA" width="160" height="44">
          <div class="entry-mode" role="radiogroup" aria-label="Which crew">
            <button type="button" role="radio" aria-checked="${m === 'demo'}" data-action="entry-mode" data-ws="demo">${icon('play', 'sm')}Guided demo</button>
            <button type="button" role="radio" aria-checked="${m === 'explore'}" data-action="entry-mode" data-ws="explore">${icon('arrow', 'sm')}Real app</button>
          </div>
        </header>
        <h1 tabindex="-1">Crew health, even when Earth is out of reach.</h1>
        <p class="entry-lead">${m === 'demo' ? 'A scripted mission, Day 142 at 06:59 UTC. Controlled clock, demo sleep rule, reset any time.' : 'An independent fictional crew on the real clock. Your entries stay on this device.'}</p>
        <p class="entry-ask">Who are you today?</p>
        <div class="entry-cards">
          ${ROLES.map(
              (r) => html`<button type="button" class="role-card" data-action="enter-as" data-role="${r.role}" data-ws="${m}">
              <span class="rc-img"><img src="/assets/illustrations/roles/${r.img}.webp" alt="" width="1400" height="875" loading="${r.role === 'astronaut' ? 'eager' : 'lazy'}"><span class="rc-where">${icon(r.role === 'ground' ? 'link' : 'device', 'sm')}${r.where}</span></span>
              <span class="rc-body"><b>${r.title}</b><span>${r.does}</span><span class="rc-go">Enter${icon('arrow', 'sm')}</span></span>
            </button>`,
          )}
        </div>
        ${app.ws ? html`<p class="entry-resume">Last used: <b>${app.ws === 'demo' ? 'Guided demo' : 'Real app'}</b>. Each keeps its own fictional records on this device.</p>` : ''}
        <p class="entry-note">${icon('info')}No account. Works offline after the first visit. Simulated crew data · AI-generated images · NASA Space Apps Challenge 2026 prototype, not affiliated with NASA.</p>
      </main>
    </div>`;
}
