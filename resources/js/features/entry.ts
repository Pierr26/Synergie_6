import { html, type Html } from '../lib/html';
import { registerActions } from '../router-actions';
import { icon } from '../components/icons';
import { applyNight, isNight } from '../fx';
import { writePref } from '../state';
import type { WorkspaceId } from '../domain/types';

const ROLES = [
    { id: 'astronaut', title: 'Astronaut', description: 'Track my health and report symptoms.', start: 'Start as an astronaut' },
    { id: 'cmo', title: 'Crew medical officer', description: 'Monitor crew health and review observations.', start: 'Start as the crew medical officer' },
    { id: 'ground', title: 'Flight surgeon', description: 'Review reports and support the crew from Earth.', start: 'Start as the flight surgeon' },
] as const;
let selectedRole: (typeof ROLES)[number] = ROLES[0];

const INTRO_SEEN_KEY = 'hexta.earth-entry-seen';
const INTRO_VIDEO = '/assets/illustrations/earth-entry.mp4';
// The closing part of the source embeds a mock interface. Stop on the clean Earth shot.
const EARTH_FRAME = 2.35;
let introSeen = false;

export function prepareHomeScene(root: HTMLElement, allowIntro: boolean): boolean {
    const intro = root.querySelector<HTMLDialogElement>('.home-intro');
    const video = intro?.querySelector('video');
    if (!intro || !video || !video.canPlayType('video/mp4') || !navigator.onLine) return false;
    let playIntro = allowIntro && !introSeen && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    try {
        playIntro &&= sessionStorage.getItem(INTRO_SEEN_KEY) !== '1';
    } catch { /* The in-memory flag covers this visit. */ }
    if (!playIntro || typeof intro.showModal !== 'function') return false;

    intro.showModal();
    introSeen = true;
    try { sessionStorage.setItem(INTRO_SEEN_KEY, '1'); } catch { /* Already tracked in memory. */ }

    let closing = false;
    let playbackLimit: number | undefined;
    const startupLimit = window.setTimeout(() => reveal(), 1800);
    function reveal(): void {
        if (closing) return;
        closing = true;
        window.clearTimeout(startupLimit);
        window.clearTimeout(playbackLimit);
        video?.pause();
        intro?.classList.add('leaving');
        window.setTimeout(() => {
            if (!intro?.isConnected) return;
            intro.close();
            intro.remove();
            root.querySelector<HTMLElement>('#home-title')?.focus({ preventScroll: true });
        }, 480);
    }

    intro.querySelector('button')?.addEventListener('click', reveal);
    intro.addEventListener('cancel', (event) => {
        event.preventDefault();
        reveal();
    });
    video.addEventListener('playing', () => {
        window.clearTimeout(startupLimit);
        playbackLimit = window.setTimeout(reveal, 2800);
    }, { once: true });
    if (typeof video.requestVideoFrameCallback === 'function') {
        const checkFrame: VideoFrameRequestCallback = (_, { mediaTime }) => {
            if (closing) return;
            if (mediaTime >= EARTH_FRAME) reveal();
            else video.requestVideoFrameCallback(checkFrame);
        };
        video.requestVideoFrameCallback(checkFrame);
    } else {
        video.addEventListener('timeupdate', () => {
            if (video.currentTime >= EARTH_FRAME) reveal();
        });
    }
    video.addEventListener('ended', reveal, { once: true });
    video.addEventListener('error', reveal, { once: true });
    video.muted = true;
    video.src = INTRO_VIDEO;
    void video.play().catch(reveal);
    return true;
}

function entryMode(): WorkspaceId {
    try { return localStorage.getItem('quinta.entry-mode') === 'explore' ? 'explore' : 'demo'; }
    catch { return 'demo'; }
}

export function initHomeTheme(): void {
    let preference: string | null = null;
    try {
        preference = localStorage.getItem('quinta.night');
    } catch { /* Use the home page's default when preferences are unavailable. */ }
    applyNight(preference === null || preference === '1');
    if (preference === null) writePref('quinta.night', '1');
}

function selectRadio(button: HTMLElement, group: string): void {
    document.querySelectorAll<HTMLElement>(group).forEach((other) => {
        const selected = other === button;
        other.setAttribute('aria-checked', String(selected));
        other.tabIndex = selected ? 0 : -1;
    });
}

function selectRole(button: HTMLElement): void {
    const role = ROLES.find((item) => item.id === button.dataset.role);
    const enter = document.querySelector<HTMLButtonElement>('.home-enter');
    const label = enter?.querySelector('span');
    if (!role || !enter || !label) return;

    selectedRole = role;
    selectRadio(button, '.home-role');
    enter.dataset.role = role.id;
    label.textContent = role.start;
}

registerActions({
    'home-theme': (button) => {
        const night = !isNight();
        applyNight(night);
        writePref('quinta.night', night ? '1' : '0');
        button.setAttribute('aria-pressed', String(night));
        button.title = night ? 'Switch to light mode' : 'Switch to dark mode';
        button.innerHTML = (night ? MOON : SUN).value;
    },
    'home-role': selectRole,
    'home-mode': (button) => {
        const mode = button.dataset.ws;
        const enter = document.querySelector<HTMLButtonElement>('.home-enter');
        if (!enter || (mode !== 'demo' && mode !== 'explore')) return;
        writePref('quinta.entry-mode', mode);
        selectRadio(button, '.home-mode');
        enter.dataset.ws = mode;
    },
});

document.addEventListener('keydown', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.home-role, .home-mode');
    const group = button?.closest('[role="radiogroup"]');
    if (!button || !group) return;
    const options = [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    const index = options.indexOf(button);
    const next = ({
        ArrowRight: index + 1, ArrowDown: index + 1, ArrowLeft: index - 1, ArrowUp: index - 1,
        Home: 0, End: options.length - 1,
    } as Record<string, number>)[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const option = options[(next + options.length) % options.length];
    option.click();
    option.focus();
});

const SUN = html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg>`;
const MOON = html`<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21 15A9 9 0 0 1 9 3a9.5 9.5 0 1 0 12 12Z"/></svg>`;
const CHECK = html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4.5 4.5L19 7"/></svg>`;
const WORDMARK = html`<a class="home-wordmark" href="/"><img src="/assets/brand/hexta-symbole.svg" alt="" width="32" height="32">HEXTA</a>`;

export async function renderEntry(): Promise<Html> {
    initHomeTheme();
    const mode = entryMode();
    const night = isNight();
    return html`
    <dialog class="home-intro" lang="en" aria-label="Introduction, Earth from space">
      <video muted playsinline disablepictureinpicture aria-hidden="true"></video>
      <button type="button" class="home-intro-skip">Skip intro ${icon('arrow', 'sm')}</button>
    </dialog>
    <div class="home" lang="en">
      <header class="home-bar">
        <div class="home-shell home-bar-inner">
          ${WORDMARK}
          <a class="home-login" href="/login">Sign in</a>
          <button class="home-theme" type="button" data-action="home-theme" aria-label="Night mode" aria-pressed="${String(night)}" title="${night ? 'Switch to light mode' : 'Switch to dark mode'}">
            ${night ? MOON : SUN}
          </button>
        </div>
      </header>
      <main id="main" tabindex="-1">
        <section class="home-shell home-hero" aria-labelledby="home-title">
          <h1 id="home-title" tabindex="-1">Crew health,<br> even <em>far from Earth.</em></h1>
          <p>Track crew health on board. Share reports when the link allows.</p>
        </section>
        <section class="home-shell home-roles" aria-labelledby="home-roles-title">
          <header class="home-roles-heading">
            <h2 id="home-roles-title">Choose your role</h2>
            <p>A workspace tailored to your mission.</p>
          </header>
          <div class="home-role-list" role="radiogroup" aria-labelledby="home-roles-title">
            ${ROLES.map((role) => html`
              <button class="home-role" type="button" role="radio" aria-labelledby="home-role-${role.id}" aria-describedby="home-description-${role.id}" aria-checked="${role === selectedRole}" tabindex="${role === selectedRole ? '0' : '-1'}" data-action="home-role" data-role="${role.id}">
                <span class="home-role-photo"><img src="/assets/photos/entry-${role.id}.webp" alt=""></span>
                <span class="home-role-check">${CHECK}</span>
                <span class="home-role-copy">
                  <span class="home-role-name" id="home-role-${role.id}">${role.title}</span>
                  <span id="home-description-${role.id}">${role.description}</span>
                </span>
              </button>`)}
          </div>
          <div class="home-entry-tools">
            <div class="home-mode-group" role="radiogroup" aria-label="Mission mode">
              <button class="home-mode" type="button" role="radio" aria-checked="${mode === 'demo'}" tabindex="${mode === 'demo' ? '0' : '-1'}" data-action="home-mode" data-ws="demo">Guided demo</button>
              <button class="home-mode" type="button" role="radio" aria-checked="${mode === 'explore'}" tabindex="${mode === 'explore' ? '0' : '-1'}" data-action="home-mode" data-ws="explore">Free exploration</button>
            </div>
            <button class="home-enter" type="button" data-action="enter-as" data-role="${selectedRole.id}" data-ws="${mode}"><span>${selectedRole.start}</span>${icon('arrow')}</button>
          </div>
        </section>
      </main>
    </div>`;
}
