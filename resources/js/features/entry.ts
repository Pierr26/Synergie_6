import { html, type Html } from '../lib/html';
import { registerActions } from '../router-actions';
import { writePref } from '../state';

/** Home page: hero, the three crew roles as tabs with one description panel, and the project footer. */

type HomeTheme = 'light' | 'dark';
type RoleId = 'astronaut' | 'cmo' | 'ground';

interface RoleCard {
    id: RoleId;
    photo: string;
    title: string;
    where: string;
    lead: string;
    flow: string;
}

const ROLES: RoleCard[] = [
    {
        id: 'astronaut',
        photo: 'astronaut-cupola',
        title: 'Astronaut',
        where: 'On board',
        lead: 'Logs sleep, measurements and symptoms during the mission.',
        flow: 'Each entry reaches the crew medical officer on board.',
    },
    {
        id: 'cmo',
        photo: 'crew-medical-exam',
        title: 'Crew medical officer',
        where: 'On board',
        lead: 'Reviews what the astronauts log, right on board.',
        flow: 'Decides what to send to the flight surgeon on Earth.',
    },
    {
        id: 'ground',
        photo: 'mission-control-houston',
        title: 'Flight surgeon',
        where: 'Houston',
        lead: 'Reviews the reports that arrive from the spacecraft.',
        flow: 'Replies to the crew medical officer when the link allows.',
    },
];

const THEME_KEY = 'quinta.home-theme';
const FOOTER_LINKS = [
    { label: 'Crew health', href: 'https://www.nasa.gov/hhp/' },
    { label: 'Space medicine', href: 'https://www.nasa.gov/hrp/' },
    { label: 'Moon', href: 'https://science.nasa.gov/moon/' },
    { label: 'Earth', href: 'https://science.nasa.gov/earth/' },
    { label: 'NASA photos', href: 'https://images.nasa.gov/' },
];
const systemLight = matchMedia('(prefers-color-scheme: light)');

/** Kept for the session so a re-render keeps the card the visitor picked; the mockup state is the default. */
let selectedRole: RoleId = 'cmo';

function storedTheme(): HomeTheme | null {
    try {
        const value = localStorage.getItem(THEME_KEY);
        return value === 'light' || value === 'dark' ? value : null;
    } catch {
        return null;
    }
}

function currentTheme(): HomeTheme {
    return storedTheme() ?? (systemLight.matches ? 'light' : 'dark');
}

function themeLabel(theme: HomeTheme): string {
    return theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
}

function syncThemeButton(): void {
    const button = document.querySelector<HTMLButtonElement>('.home-theme');
    if (!button) return;
    const label = themeLabel(currentTheme());
    button.setAttribute('aria-label', label);
    button.title = label;
}

systemLight.addEventListener('change', syncThemeButton);

function selectRole(tab: HTMLElement, moveFocus: boolean): void {
    const id = tab.dataset.role as RoleId;
    selectedRole = id;
    const tabs = document.querySelectorAll<HTMLElement>('.home-role');
    tabs.forEach((other) => {
        const selected = other === tab;
        other.setAttribute('aria-selected', String(selected));
        other.tabIndex = selected ? 0 : -1;
        const panel = document.getElementById(other.getAttribute('aria-controls')!);
        if (panel) panel.hidden = !selected;
    });
    if (moveFocus) tab.focus();
    // Stacked cards on a phone push the panel below the fold: bring it into view after a tap.
    const panel = document.getElementById(`role-panel-${id}`);
    if (panel) {
        const box = panel.getBoundingClientRect();
        if (box.bottom > innerHeight || box.top < 0) {
            const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
            panel.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
        }
    }
}

registerActions({
    'home-theme': async () => {
        const home = document.querySelector<HTMLElement>('.home');
        const next: HomeTheme = currentTheme() === 'dark' ? 'light' : 'dark';
        writePref(THEME_KEY, next);
        home?.setAttribute('data-theme', next);
        syncThemeButton();
    },
    'home-role': async (el) => selectRole(el, false),
});

document.addEventListener('keydown', (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>('.home-role');
    if (!tab) return;
    const tabs = [...document.querySelectorAll<HTMLElement>('.home-role')];
    const index = tabs.indexOf(tab);
    const next = ({ ArrowRight: index + 1, ArrowDown: index + 1, ArrowLeft: index - 1, ArrowUp: index - 1, Home: 0, End: tabs.length - 1 } as Record<string, number>)[e.key];
    if (next === undefined) return;
    e.preventDefault();
    selectRole(tabs[(next + tabs.length) % tabs.length], true);
});

const SUN = html`<svg class="home-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg>`;
const CHEVRON = html`<svg class="home-role-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;
const MOON = html`<svg class="home-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10Z"/></svg>`;

export async function renderEntry(): Promise<Html> {
    const stored = storedTheme();
    const label = themeLabel(currentTheme());
    return html`
    <div class="home" ${stored ? html`data-theme="${stored}"` : ''}>
      <header class="home-bar">
        <div class="home-shell home-bar-inner">
          <button class="home-theme" type="button" data-action="home-theme" aria-label="${label}" title="${label}">${SUN}${MOON}</button>
          <a class="home-login" href="/login">Login</a>
        </div>
      </header>
      <main id="main" tabindex="-1">
        <section class="home-hero" aria-labelledby="home-title">
          <div class="home-hero-art" aria-hidden="true"></div>
          <div class="home-shell home-hero-inner">
            <h1 id="home-title" tabindex="-1"><span>Crew health,</span> <span>even when Earth</span> <span>is <em>out of reach.</em></span></h1>
            <p>Track crew health on board. Share reports when the link allows.</p>
          </div>
        </section>
        <section class="home-shell home-roles" aria-label="Crew roles">
          <div class="home-role-list" role="tablist" aria-label="Crew roles">
            ${ROLES.map(
                (r) => html`<button class="home-role" type="button" role="tab" id="role-tab-${r.id}" aria-controls="role-panel-${r.id}" aria-selected="${r.id === selectedRole}" tabindex="${r.id === selectedRole ? '0' : '-1'}" data-action="home-role" data-role="${r.id}">
                <span class="home-role-photo"><img src="/assets/photos/${r.photo}.webp" alt="" width="1200" height="800"></span>
                <span class="home-role-copy"><span class="home-role-place">${r.where}</span> <span class="home-role-name">${r.title}</span>${CHEVRON}</span>
              </button>`,
            )}
          </div>
          ${ROLES.map(
              (r, i) => html`<div class="home-panel" id="role-panel-${r.id}" role="tabpanel" aria-labelledby="role-tab-${r.id}" tabindex="0" ${r.id === selectedRole ? '' : html`hidden`}>
              <div><span class="home-panel-step">Step ${i + 1} of ${ROLES.length} · ${r.where}</span><h2>${r.title}</h2></div>
              <div>
                <p><strong>${r.lead}</strong></p><p>${r.flow}</p>
                <ol class="home-flow" aria-label="Path of the health information">
                  ${ROLES.map((o) => html`<li ${o.id === r.id ? html`aria-current="step"` : ''}>${o.title}</li>`)}
                </ol>
              </div>
            </div>`,
          )}
        </section>
      </main>
      <footer class="home-footer">
        <div class="home-shell home-footer-top">
          <span class="home-brand">Synergy</span>
          <nav aria-label="Further reading">
            <ul>${FOOTER_LINKS.map((l) => html`<li><a href="${l.href}" rel="noopener">${l.label}</a></li>`)}</ul>
          </nav>
        </div>
      </footer>
    </div>`;
}
