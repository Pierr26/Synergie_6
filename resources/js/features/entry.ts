import { icon } from '../components/icons';
import { html, type Html } from '../lib/html';
import { app } from '../state';

export async function renderEntry(): Promise<Html> {
    const resume = app.ws ? html`<p class="entry-resume">Last used: <b>${app.ws === 'demo' ? 'Guided demo' : 'Explore app'}</b>. Both keep their own fictional crew records on this device.</p>` : '';
    return html`
    <div class="entry">
      <div class="entry-visual" aria-hidden="true">
        <img src="/assets/illustrations/lunar-window.webp" alt="" width="1200" height="800" fetchpriority="high">
        <span class="entry-credit">AI-generated image</span>
      </div>
      <main class="entry-panel" id="main" tabindex="-1">
        <img class="entry-logo" src="/assets/brand/quinta-logo.svg" alt="QUINTA" width="200" height="55">
        <h1 tabindex="-1">Crew health, even when the ground link drops.</h1>
        <p class="entry-lead">The astronaut logs sleep and drowsiness, the crew medical officer reviews the signal on board, and a crew member's report waits in the queue until the ground acknowledges it.</p>
        <div class="entry-choices">
          <button type="button" class="entry-choice primary" data-action="enter-demo">
            <span class="entry-choice-h">${icon('play')}Start demo</span>
            <span>Guided scenario on mission Day 142, 06:59 UTC. Controlled clock, demo sleep rule, reset any time.</span>
          </button>
          <button type="button" class="entry-choice" data-action="enter-explore">
            <span class="entry-choice-h">${icon('arrow')}Explore app</span>
            <span>An independent fictional crew on the real clock. No mission rule configured. Your entries stay here.</span>
          </button>
        </div>
        ${resume}
        <p class="entry-note">${icon('info')}No account. Works offline after the first visit. Simulated crew data — a Synergy 5 prototype for the NASA Space Apps Challenge 2026, not affiliated with NASA.</p>
      </main>
    </div>`;
}
