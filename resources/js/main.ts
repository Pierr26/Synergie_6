import { mountEmblem, scrollEmblem, spinEmblem } from './components/brand';
import { previewBar, renderShell } from './components/shell';
import { toast } from './components/ui';
import * as repo from './data/repo';
import { WORKSPACES } from './demo/config';
import { MINUTE_MS, missionDay, timeOnDay } from './domain/time';
import type { Role, WorkspaceId } from './domain/types';
import { renderEntry } from './features/entry';
import { maybeShowGuide } from './features/help';
import { html, type Html } from './lib/html';
import { registerServiceWorker } from './offline/register';
import { actions, registerActions } from './router-actions';
import { app, EMBEDDED, homeFor, me, syncPrefs, VIEWPORT_SIZE, writePref, ws, type Viewport } from './state';
import { routes } from './routes';
import { bus } from './bus';
import { initFx, mountFx, withTransition } from './fx';

const root = document.getElementById('app')!;
let rendering = false;
let pending = false;
let lastSignature = '';

function parseRoute(): void {
    const url = new URL(location.href);
    const segments = url.pathname.split('/').filter(Boolean);
    app.route = { path: url.pathname, segments, query: url.searchParams };
}

export function navigate(href: string, replace = false): void {
    if (replace) history.replaceState(null, '', href);
    else history.pushState(null, '', href);
    parseRoute();
    if (isDeviceMode()) postToFrame({ type: 'hexta-navigate', href });
    void render(true);
}

/* ---------------------------------------------------------------- preview display (device frame) */

/** The top document shows the app inside a device-sized iframe, so media queries and touch sizes are the real ones. */
function isDeviceMode(): boolean {
    return !EMBEDDED && app.viewport !== 'auto' && !!app.ws && app.route.segments.length > 0;
}

function deviceFrame(): HTMLIFrameElement | null {
    return root.querySelector<HTMLIFrameElement>('iframe.device-frame');
}

type FrameMessage = { type: 'hexta-refresh' } | { type: 'hexta-navigate'; href: string } | { type: 'hexta-rendered'; href: string };

function postToFrame(msg: FrameMessage): void {
    deviceFrame()?.contentWindow?.postMessage(msg, location.origin);
}

/** True while the top document redraws because the frame reported a change: it must not echo a refresh back. */
let fromFrame = false;

async function renderDevice(): Promise<void> {
    const bar = (await previewBar()).value;
    const frame = deviceFrame();
    if (frame && frame.dataset.viewport === app.viewport) {
        const old = root.querySelector('.preview');
        if (old) old.outerHTML = bar;
        if (!fromFrame) postToFrame({ type: 'hexta-refresh' });
        return;
    }
    const vp = app.viewport as Exclude<Viewport, 'auto'>;
    const [w, h] = VIEWPORT_SIZE[vp];
    const src = location.pathname + location.search + location.hash;
    root.innerHTML = `${bar}<div class="device-stage"><iframe class="device-frame vp-${vp}" data-viewport="${vp}" style="--w:${w}px;--h:${h}px" src="${src.replace(/"/g, '&quot;')}" title="HEXTA in a ${vp} frame (${w} × ${h})"></iframe></div>`;
    root.removeAttribute('data-booting');
    document.title = `HEXTA · ${vp} preview`;
}

async function reloadSharedState(): Promise<void> {
    syncPrefs();
    if (!app.ws) return;
    app.groundLink = await repo.kvGet(ws(), 'groundLink', ws() !== 'demo');
    app.loseNextReceipt = await repo.kvGet(ws(), 'loseNextReceipt', false);
}

window.addEventListener('message', (e: MessageEvent<FrameMessage>) => {
    if (e.origin !== location.origin || !e.data || typeof e.data !== 'object') return;
    const msg = e.data;
    if (EMBEDDED && msg.type === 'hexta-refresh') void reloadSharedState().then(() => render());
    else if (EMBEDDED && msg.type === 'hexta-navigate') void reloadSharedState().then(() => navigate(msg.href));
    else if (!EMBEDDED && msg.type === 'hexta-rendered' && isDeviceMode()) {
        history.replaceState(null, '', msg.href);
        parseRoute();
        void reloadSharedState().then(async () => {
            fromFrame = true;
            try {
                await render();
            } finally {
                fromFrame = false;
            }
        });
    }
});

async function viewHtml(): Promise<Html> {
    let key = app.route.segments[0] ?? '';
    const fallback = homeFor().slice(1);
    if (app.role !== 'astronaut' && key === 'overview') key = fallback;
    const r = routes[key] ?? routes[fallback];
    return r();
}

/** Re-renders the shell and the current view. Keeps focus and scroll on refresh, focuses the title on navigation. */
export async function render(isNavigation = false): Promise<void> {
    if (!root) return;
    if (rendering) {
        pending = true;
        return;
    }
    rendering = true;
    try {
        if (!app.ws || app.route.segments.length === 0) {
            // The home page holds no app state: a background refresh (offline status poll) must not rebuild it and drop focus.
            if (!isNavigation && root.querySelector('.home')) return;
            const entry = (await renderEntry()).value;
            await withTransition(() => {
                root.innerHTML = entry;
            }, isNavigation);
            root.removeAttribute('data-booting');
            document.title = 'Crew health';
            if (isNavigation) (root.querySelector('h1') as HTMLElement | null)?.focus();
            if (EMBEDDED) parent.postMessage({ type: 'hexta-rendered', href: location.pathname + location.search + location.hash }, location.origin);
            return;
        }
        if (isDeviceMode()) {
            await renderDevice();
            return;
        }
        app.now = await repo.readNow(ws());
        await repo.syncReminders(ws(), WORKSPACES[ws()].astronautId, app.now);
        app.unread = (await repo.notificationsFor(ws(), me())).filter((n) => !n.readAt).length;
        const activeId = (document.activeElement as HTMLElement | null)?.id;
        const scrollY = window.scrollY;
        const view = await viewHtml();
        const html = (await renderShell(view)).value;
        const edits = isNavigation ? null : captureEdits();
        // a background refresh must not close a menu or panel the user has open (scenario controls, status, guide)
        const openPanels = isNavigation ? [] : [...root.querySelectorAll<HTMLDetailsElement>('details[open]')].map((d) => d.className).filter(Boolean);
        await withTransition(() => {
            root.innerHTML = html;
            if (edits) restoreEdits(edits);
            for (const cls of openPanels) root.querySelector<HTMLDetailsElement>(`details[class="${cls}"]`)?.setAttribute('open', '');
        }, isNavigation);
        root.removeAttribute('data-booting');
        const title = root.querySelector('#page-title')?.textContent;
        document.title = title ? `${title} · HEXTA` : 'HEXTA';
        mountCurrent();
        mountFx(isNavigation);
        const emblem = root.querySelector<SVGSVGElement>('svg[data-emblem]');
        if (emblem) mountEmblem(emblem);
        if (EMBEDDED) parent.postMessage({ type: 'hexta-rendered', href: location.pathname + location.search + location.hash }, location.origin);
        if (isNavigation) {
            window.scrollTo(0, 0);
            (root.querySelector('#page-title') as HTMLElement | null)?.focus({ preventScroll: true });
            void maybeShowGuide();
        } else {
            window.scrollTo(0, scrollY);
            if (activeId) (document.getElementById(activeId) as HTMLElement | null)?.focus({ preventScroll: true });
        }
        lastSignature = await signature();
    } finally {
        rendering = false;
        if (pending) {
            pending = false;
            void render();
        }
    }
}

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function fieldKey(el: Field): string | null {
    if (el instanceof HTMLInputElement && el.type === 'file') return null; // a file input cannot be restored by script
    const form = el.form?.id || el.form?.dataset.action || '';
    if (el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox')) return el.name ? `${form}|${el.name}|${el.value}` : null;
    return el.id ? `${form}|#${el.id}` : el.name ? `${form}|${el.name}` : null;
}

/** Values the user changed but has not saved yet: background re-renders must never overwrite them. */
function captureEdits(): Map<string, string | boolean> {
    const edits = new Map<string, string | boolean>();
    root.querySelectorAll<Field>('main input, main select, main textarea').forEach((el) => {
        const key = fieldKey(el);
        if (!key) return;
        if (el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox')) {
            if (el.checked !== el.defaultChecked) edits.set(key, el.checked);
        } else if (el instanceof HTMLSelectElement) {
            const def = [...el.options].find((o) => o.defaultSelected)?.value ?? el.options[0]?.value;
            if (el.value !== def) edits.set(key, el.value);
        } else if (el.value !== el.defaultValue) edits.set(key, el.value);
    });
    return edits;
}

function restoreEdits(edits: Map<string, string | boolean>): void {
    if (!edits.size) return;
    root.querySelectorAll<Field>('main input, main select, main textarea').forEach((el) => {
        const key = fieldKey(el);
        if (!key || !edits.has(key)) return;
        const v = edits.get(key)!;
        if (typeof v === 'boolean') (el as HTMLInputElement).checked = v;
        else el.value = v;
    });
}

function mountCurrent(): void {
    const hash = location.hash.slice(1);
    if (hash) document.getElementById(hash)?.scrollIntoView();
    root.querySelectorAll<HTMLElement>('[data-mount]').forEach((el) => {
        const fn = actions[`mount:${el.dataset.mount}`];
        if (fn) void fn(el, new Event('mount'));
    });
}

/** Cheap fingerprint of what the shell shows, so background ticks only re-render when needed. */
async function signature(): Promise<string> {
    if (!app.ws) return '';
    const t = await repo.todaysTask(ws(), WORKSPACES[ws()].astronautId, app.now);
    const reports = await repo.reportsFor(ws());
    const notes = await repo.notificationsFor(ws(), me());
    return [t?.ev.state, t?.ev.bannerVisible, notes.length, notes.filter((n) => !n.readAt).length, reports.map((r) => r.queue.state).join(), app.groundLink, app.browserOnline, app.offlineReady, Math.floor(app.now / MINUTE_MS)].join('|');
}

/** Background work: reminders, queue processing. Re-renders only if visible state changed and no form is being edited. */
async function tick(): Promise<void> {
    // in device preview the framed app runs the reminders and the queue; the top document only hosts it
    if (!app.ws || document.hidden || isDeviceMode()) return;
    app.now = await repo.readNow(ws());
    await repo.syncReminders(ws(), WORKSPACES[ws()].astronautId, app.now);
    const changed = await repo.processQueue(ws(), { groundLink: app.groundLink, browserOnline: app.browserOnline, loseNextReceipt: app.loseNextReceipt }, () => (WORKSPACES[ws()].simulatedClock ? app.now : Date.now()), fetch.bind(window), () => render());
    if (app.groundLink && app.browserOnline) await repo.deliverGroundNotes(ws(), app.now);
    if (changed) {
        app.loseNextReceipt = await repo.kvGet(ws(), 'loseNextReceipt', false);
    }
    const editing = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    if (!editing && (await signature()) !== lastSignature) await render();
}

async function enterWorkspace(id: WorkspaceId, role: Role = 'astronaut'): Promise<void> {
    await repo.ensureSeeded(id);
    app.ws = id;
    app.role = role;
    writePref('quinta.ws', id);
    writePref('quinta.role', role);
    app.groundLink = await repo.kvGet(id, 'groundLink', id !== 'demo');
    app.loseNextReceipt = await repo.kvGet(id, 'loseNextReceipt', false);
}

registerActions({
    'enter-demo': async () => {
        await enterWorkspace('demo');
        navigate('/overview');
    },
    'enter-explore': async () => {
        await enterWorkspace('explore');
        navigate('/overview');
    },
    /** entry screen: pick a mode (demo or real app) and a role in one tap */
    'enter-as': async (el) => {
        const role = el.dataset.role as Role;
        await enterWorkspace(el.dataset.ws as WorkspaceId, role);
        navigate(homeFor(role));
    },
    'toggle-link': async () => {
        app.groundLink = !app.groundLink;
        await repo.kvSet(ws(), 'groundLink', app.groundLink);
        if (app.groundLink) await repo.deliverGroundNotes(ws(), app.now);
        toast(app.groundLink ? 'Ground link restored (simulated). Queued reports will be sent.' : 'Ground link offline (simulated). Work continues on board.');
        await tick();
        await render();
    },
    role: async (el) => {
        app.role = el.dataset.role as Role;
        writePref('quinta.role', app.role);
        navigate(homeFor());
        toast(app.role === 'cmo' ? 'Viewing as crew medical officer, on board' : app.role === 'ground' ? 'Viewing as flight surgeon, in Houston' : 'Viewing as astronaut');
    },
    clock: async (el) => {
        const now = await repo.readNow('demo');
        const c = WORKSPACES.demo;
        const next = el.dataset.min === 'next-day' ? timeOnDay(missionDay(now, c.epoch) + 1, c.epoch, '07:00') : now + Number(el.dataset.min) * MINUTE_MS;
        await repo.setDemoClock(next);
        await render();
    },
    scenario: async (el) => {
        const day = Number(el.dataset.day) as 138 | 142;
        await repo.resetDemo(day);
        app.groundLink = false;
        app.loseNextReceipt = false;
        toast(`Demo reset to Day ${day} 06:59 UTC. Explore app data untouched.`);
        navigate(homeFor());
    },
    'lose-receipt': async (el) => {
        app.loseNextReceipt = (el as HTMLInputElement).checked;
        await repo.kvSet(ws(), 'loseNextReceipt', app.loseNextReceipt);
        toast(app.loseNextReceipt ? 'The next simulated receipt will be lost on the way back.' : 'Receipts are delivered normally.');
    },
    'coach-go': async (el) => {
        const role = el.dataset.role as Role | undefined;
        if (role && role !== app.role) {
            app.role = role;
            writePref('quinta.role', role);
        }
        navigate(el.dataset.href!);
    },
    'coach-hide': async () => {
        writePref('quinta.coach', '0');
        await render();
    },
    'coach-show': async () => {
        writePref('quinta.coach', '1');
        await render();
    },
    snooze: async () => {
        const t = await repo.snooze(ws(), me(), app.now);
        toast(t ? `Snoozed until ${new Date(t.snoozedUntil!).toISOString().slice(11, 16)} UTC` : 'Snooze is not available after this time today.');
        await render();
    },
    viewport: async (el) => {
        const next = el.dataset.viewport as Viewport;
        if (next === app.viewport) return;
        app.viewport = next;
        writePref('hexta.viewport', next);
        await reloadSharedState();
        await render(true);
    },
    'rail-toggle': async () => {
        // tablet widths (700–1099 px) always show the icon rail: the logo opens the full menu over the content
        if (innerWidth >= 700 && innerWidth < 1100) {
            const shell = root.querySelector<HTMLElement>('.app');
            const open = !shell?.classList.contains('drawer');
            shell?.classList.toggle('drawer', open);
            root.querySelector('.brand-toggle')?.setAttribute('aria-expanded', String(open));
            return;
        }
        app.rail = !app.rail;
        writePref('hexta.rail', app.rail ? '1' : '0');
        // fold in place (not a re-render) so the grid width and the labels can animate
        const shell = root.querySelector<HTMLElement>('.app');
        const btn = root.querySelector<HTMLElement>('.brand-toggle');
        const label = app.rail ? 'Expand the menu' : 'Collapse the menu';
        shell?.classList.toggle('rail', app.rail);
        shell?.classList.toggle('unfold', !app.rail);
        btn?.setAttribute('aria-expanded', String(!app.rail));
        btn?.setAttribute('title', label);
        const sr = btn?.querySelector('.sr-only');
        if (sr) sr.textContent = label;
        spinEmblem(!app.rail);
    },
    'dismiss-banner': async () => {
        await repo.dismiss(ws(), me(), app.now);
        toast('Banner hidden. The check-in stays in Today’s plan and Notifications.');
        await render();
    },
});

/* ---------------------------------------------------------------- global listeners */

/** Chip drop-downs (<details data-pop>): one open at a time, closed by an outside click, a choice inside, or Escape. */
function closePops(except?: Element | null): void {
    if (!root) return; // server-rendered pages (login, account) load this bundle without the app root
    root.querySelectorAll<HTMLDetailsElement>('details[data-pop][open]').forEach((d) => {
        if (d !== except) d.open = false;
    });
}
document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const pop = target.closest('details[data-pop]');
    closePops(pop && target.closest('summary') ? pop : null);
}, true);
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = root?.querySelector<HTMLDetailsElement>('details[data-pop][open]');
    if (!open) return;
    open.open = false;
    open.querySelector('summary')?.focus();
});

document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const link = target.closest<HTMLAnchorElement>('a[data-link]');
    if (link && !e.metaKey && !e.ctrlKey && !e.shiftKey && link.origin === location.origin) {
        e.preventDefault();
        const url = new URL(link.href);
        if (url.pathname === location.pathname && url.search === location.search && url.hash) {
            document.getElementById(url.hash.slice(1))?.scrollIntoView();
            return;
        }
        navigate(url.pathname + url.search + url.hash);
        return;
    }
    const el = target.closest<HTMLElement>('[data-action]');
    if (el && el.tagName !== 'INPUT' && el.tagName !== 'FORM') {
        const fn = actions[el.dataset.action!];
        if (fn) {
            e.preventDefault();
            void fn(el, e);
        }
    }
});

document.addEventListener('change', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('input[data-action], select[data-action]');
    if (el) void actions[el.dataset.action!]?.(el, e);
});

document.addEventListener('submit', (e) => {
    const form = e.target as HTMLFormElement;
    const fn = form.dataset.action ? actions[form.dataset.action] : undefined;
    if (fn) {
        e.preventDefault();
        void fn(form, e);
    }
});

window.addEventListener('popstate', () => {
    parseRoute();
    void render(true);
});
window.addEventListener('online', () => {
    app.browserOnline = true;
    void tick();
});
window.addEventListener('offline', () => {
    app.browserOnline = false;
    void render();
});
let lastScrollY = window.scrollY;
window.addEventListener(
    'scroll',
    () => {
        const y = window.scrollY;
        scrollEmblem(y - lastScrollY);
        lastScrollY = y;
    },
    { passive: true },
);
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void tick();
});

async function boot(): Promise<void> {
    initFx();
    bus.navigate = navigate;
    bus.refresh = () => render();
    parseRoute();
    if (app.ws) await enterWorkspace(app.ws, app.role);
    await render(false);
    registerServiceWorker((ready) => {
        app.offlineReady = ready;
        void render();
    });
    window.setInterval(() => void tick(), 5000);
    // live clock text in Explore (real time) without full re-render
    window.setInterval(() => {
        if (app.ws === 'explore') {
            const el = document.querySelector('.mission .day .mono');
            if (el) el.textContent = new Date().toISOString().slice(11, 16);
        }
    }, 1000);
}

if (root) void boot().catch((err) => {
    console.error(err);
    root.innerHTML = html`<div class="boot"><h1>HEXTA could not start</h1><p>Local storage may be blocked in this browser window (private mode or site data disabled). ${String(err)}</p></div>`.value;
});

if (!root && document.querySelector('.account-app')) void import('./features/account-drafts').then(m => m.mountAccountDrafts());

/** Tablet menu drawer: closes on Escape or a click outside the sidebar. */
function closeDrawer(): void {
    if (!root) return;
    const shell = root.querySelector<HTMLElement>('.app.drawer');
    if (!shell) return;
    shell.classList.remove('drawer');
    root.querySelector('.brand-toggle')?.setAttribute('aria-expanded', 'false');
}
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDrawer();
});
document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (!t.closest('.side') || t.closest('.sb-item, .sb-today')) closeDrawer();
}, true);
