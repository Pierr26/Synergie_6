/**
 * Interface effects, all optional: the app works the same without them.
 * - view transitions between screens (native View Transitions API)
 * - "Soft night" theme from the mockup
 * - guided breathing on the hero orb (mockup interaction)
 * - starfield and parallax in the hero porthole
 * - sleep dial in the check-in
 * - chart hover read-out
 * - command palette (Ctrl/⌘ K)
 * Everything respects prefers-reduced-motion.
 */
import { bus } from './bus';
import { actions, registerActions } from './router-actions';
import { app, writePref } from './state';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------------ view transitions */

export async function withTransition(update: () => void, isNavigation: boolean): Promise<void> {
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
    if (!isNavigation || reduced() || !doc.startViewTransition) {
        update();
        return;
    }
    try {
        const t = doc.startViewTransition(update);
        await t.finished.catch(() => undefined);
    } catch {
        update();
    }
}

/* ------------------------------------------------------------------ soft night */

export function applyNight(on: boolean): void {
    document.documentElement.classList.toggle('night', on);
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', on ? '#16121f' : '#2f7f74');
}

export function isNight(): boolean {
    return document.documentElement.classList.contains('night');
}

/* ------------------------------------------------------------------ breathing orb */

let breathTimer: number | undefined;

function stopBreathing(): void {
    window.clearInterval(breathTimer);
    breathTimer = undefined;
    document.querySelector('.orb-zone')?.classList.remove('go', 'in', 'out');
    const tip = document.querySelector('[data-tip]');
    if (tip) tip.textContent = 'Tap the orb for a guided breath';
}

function startBreathing(): void {
    const zone = document.querySelector('.orb-zone');
    const tip = document.querySelector('[data-tip]');
    if (!zone || !tip) return;
    // 4 s in, 6 s out, three cycles
    let t = 0;
    const total = 30;
    const frame = () => {
        const phase = t % 10;
        const breathingIn = phase < 4;
        zone.classList.add('go');
        zone.classList.toggle('in', breathingIn);
        zone.classList.toggle('out', !breathingIn);
        tip.textContent = breathingIn ? `Breathe in · ${4 - phase}` : `Breathe out · ${10 - phase}`;
        t++;
        if (t > total) {
            stopBreathing();
            tip.textContent = 'Three breaths done. Tap to start again';
        }
    };
    frame();
    breathTimer = window.setInterval(frame, 1000);
}

/* ------------------------------------------------------------------ hero starfield + parallax */

let starRaf = 0;

function mountStars(): void {
    cancelAnimationFrame(starRaf);
    const canvas = document.querySelector<HTMLCanvasElement>('.hero-stars');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    // deterministic stars so the porthole does not reshuffle at each render
    let seed = 142;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const stars = Array.from({ length: Math.round((w * h) / 9000) }, () => ({ x: rnd() * w, y: rnd() * h * 0.9, r: 0.4 + rnd() * 1.1, p: rnd() * 6.28, s: 0.4 + rnd() * 1.2 }));
    const draw = (time: number) => {
        ctx.clearRect(0, 0, w, h);
        for (const s of stars) {
            const a = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(s.p + (time / 1000) * s.s));
            ctx.globalAlpha = a;
            ctx.fillStyle = '#eaf6f2';
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, 6.283);
            ctx.fill();
        }
    };
    if (reduced()) {
        draw(0);
        return;
    }
    const loop = (time: number) => {
        if (!canvas.isConnected) return;
        if (!document.hidden) draw(time);
        starRaf = requestAnimationFrame(loop);
    };
    starRaf = requestAnimationFrame(loop);
}

function mountParallax(): void {
    const hero = document.querySelector<HTMLElement>('.hero');
    if (!hero || reduced() || matchMedia('(hover: none)').matches) return;
    hero.addEventListener('pointermove', (e) => {
        const r = hero.getBoundingClientRect();
        hero.style.setProperty('--px', (((e.clientX - r.left) / r.width - 0.5) * -14).toFixed(1) + 'px');
        hero.style.setProperty('--py', (((e.clientY - r.top) / r.height - 0.5) * -10).toFixed(1) + 'px');
    });
    hero.addEventListener('pointerleave', () => {
        hero.style.setProperty('--px', '0px');
        hero.style.setProperty('--py', '0px');
    });
}

/* ------------------------------------------------------------------ sleep dial */

const DIAL_MAX = 720; // the dial shows 0–12 h; longer nights stay valid and simply fill it
const DIAL_LEN = 2 * Math.PI * 86 * 0.75;

function syncDial(): void {
    const dial = document.querySelector<HTMLElement>('.dial');
    const h = document.getElementById('sleepHours') as HTMLInputElement | null;
    const m = document.getElementById('sleepMinutes') as HTMLInputElement | null;
    if (!dial || !h || !m) return;
    const off = (document.querySelector('[name=sleepNotRecorded]') as HTMLInputElement | null)?.checked;
    const hh = Number(h.value);
    const mm = Number(m.value);
    const valid = !off && (h.value !== '' || m.value !== '') && Number.isFinite(hh) && Number.isFinite(mm);
    const total = valid ? hh * 60 + mm : 0;
    const arc = dial.querySelector<SVGCircleElement>('.dial-val');
    if (arc) arc.style.strokeDashoffset = String(DIAL_LEN * (1 - Math.min(total, DIAL_MAX) / DIAL_MAX));
    const big = dial.querySelector('.dial-big');
    const sub = dial.querySelector('.dial-sub');
    if (big) big.textContent = off ? 'Not recorded' : valid ? `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, '0')}` : '– h –';
    if (sub) sub.textContent = off ? 'no value is assumed' : valid ? 'time asleep' : 'enter your night';
    dial.classList.toggle('is-off', !!off);
}

function stepSleep(delta: number): void {
    const h = document.getElementById('sleepHours') as HTMLInputElement | null;
    const m = document.getElementById('sleepMinutes') as HTMLInputElement | null;
    if (!h || !m || h.disabled) return;
    const cur = (Number(h.value) || 0) * 60 + (Number(m.value) || 0);
    const next = Math.max(0, Math.min(1440, Math.round((cur + delta) / 15) * 15));
    h.value = String(Math.floor(next / 60));
    m.value = String(next % 60);
    m.dispatchEvent(new Event('input', { bubbles: true }));
    m.dispatchEvent(new Event('change', { bubbles: true }));
}

/* ------------------------------------------------------------------ chart read-out */

function mountChartHover(): void {
    const wrap = document.querySelector<HTMLElement>('.chart-wrap');
    const svg = wrap?.querySelector<SVGSVGElement>('svg.chart');
    if (!wrap || !svg) return;
    const points = [...svg.querySelectorAll<SVGGElement>('g[data-tip]')];
    if (!points.length) return;
    const tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    wrap.appendChild(tip);
    const cross = svg.querySelector<SVGLineElement>('.cross');
    const show = (g: SVGGElement) => {
        const r = g.getBoundingClientRect();
        const wr = wrap.getBoundingClientRect();
        tip.textContent = g.dataset.tip ?? '';
        tip.hidden = false;
        const x = r.left + r.width / 2 - wr.left;
        tip.style.left = `${Math.max(70, Math.min(wr.width - 70, x))}px`;
        tip.style.top = `${r.top - wr.top - 10}px`;
        points.forEach((p) => p.classList.toggle('hot', p === g));
        if (cross) {
            cross.setAttribute('x1', g.dataset.x ?? '0');
            cross.setAttribute('x2', g.dataset.x ?? '0');
            cross.style.opacity = '1';
        }
    };
    const hide = () => {
        tip.hidden = true;
        points.forEach((p) => p.classList.remove('hot'));
        if (cross) cross.style.opacity = '0';
    };
    svg.addEventListener('pointermove', (e) => {
        let best: SVGGElement | null = null;
        let bd = Infinity;
        for (const p of points) {
            const r = p.getBoundingClientRect();
            const d = Math.hypot(r.left + r.width / 2 - e.clientX, (r.top + r.height / 2 - e.clientY) * 0.6);
            if (d < bd) {
                bd = d;
                best = p;
            }
        }
        if (best) show(best);
    });
    svg.addEventListener('pointerleave', hide);
    points.forEach((p) => {
        p.addEventListener('focus', () => show(p));
        p.addEventListener('blur', hide);
    });
}

/* ------------------------------------------------------------------ command palette */

interface Command {
    label: string;
    hint: string;
    run: () => void;
}

function commands(): Command[] {
    const go = (href: string) => () => bus.navigate(href);
    const act = (name: string, data: Record<string, string> = {}) => () => {
        const el = document.createElement('button');
        Object.assign(el.dataset, data);
        void actions[name]?.(el, new Event('palette'));
    };
    const nav: Command[] =
        app.role === 'cmo'
            ? [
                  { label: 'Review queue', hint: 'Screen', run: go('/crew') },
                  { label: 'Team', hint: 'Screen', run: go('/crew/teammates') },
                  { label: 'Daily Check-in', hint: 'Screen', run: go('/check-in') },
                  { label: 'Reports', hint: 'Screen', run: go('/reports') },
                  { label: 'Trends', hint: 'Screen', run: go('/trends') },
              ]
            : [
                  { label: 'Today', hint: 'Screen', run: go('/overview') },
                  { label: 'Daily check-in', hint: 'Screen', run: go('/check-in') },
                  { label: 'Report a Symptom', hint: 'Screen', run: go('/symptoms') },
                  { label: 'Follow-up', hint: 'Screen', run: go('/follow-up') },
                  { label: 'Spot measurements', hint: 'Screen', run: go('/measurements') },
                  { label: 'Add blood pressure', hint: 'Measure', run: go('/measurements?type=bp') },
                  { label: 'Add SpO₂', hint: 'Measure', run: go('/measurements?type=spo2') },
                  { label: 'Add temperature', hint: 'Measure', run: go('/measurements?type=temperature') },
                  { label: 'Add glucose', hint: 'Measure', run: go('/measurements?type=glucose') },
                  { label: 'Request crew review', hint: 'Action', run: go('/follow-up#ask') },
                  { label: 'Reminder settings', hint: 'Screen', run: go('/settings') },
              ];
    return [
        ...nav,
        { label: 'Trends · sleep', hint: 'Screen', run: go('/trends?metric=sleep_main') },
        { label: 'Trends · blood pressure', hint: 'Screen', run: go('/trends?metric=bp') },
        { label: 'Body & Risks', hint: 'Screen', run: go('/body') },
        { label: 'Heart · risk sheet', hint: 'Screen', run: go('/body?region=heart') },
        { label: 'Notifications', hint: 'Screen', run: go('/notifications') },
        { label: 'Help and guides', hint: 'Screen', run: go('/help') },
        { label: app.role === 'cmo' ? 'Switch to astronaut' : 'Switch to crew medical officer', hint: 'Role', run: act('role', { role: app.role === 'cmo' ? 'astronaut' : 'cmo' }) },
        { label: app.groundLink ? 'Cut the ground link (simulated)' : 'Restore the ground link (simulated)', hint: 'Link', run: act('toggle-link') },
        { label: isNight() ? 'Turn soft night off' : 'Turn soft night on', hint: 'Display', run: act('night-toggle') },
        { label: 'Home: demo or explore', hint: 'Screen', run: go('/') },
    ];
}

let paletteItems: Command[] = [];
let paletteIndex = 0;

function renderPalette(query: string): void {
    const list = document.getElementById('palette-list');
    if (!list) return;
    const q = query.trim().toLowerCase();
    paletteItems = commands().filter((c) => !q || `${c.label} ${c.hint}`.toLowerCase().includes(q));
    paletteIndex = Math.min(paletteIndex, Math.max(0, paletteItems.length - 1));
    list.innerHTML = '';
    paletteItems.forEach((c, i) => {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.id = `pal-${i}`;
        li.setAttribute('aria-selected', String(i === paletteIndex));
        const label = document.createElement('span');
        label.textContent = c.label;
        const hint = document.createElement('small');
        hint.textContent = c.hint;
        li.append(label, hint);
        li.addEventListener('click', () => runPalette(i));
        list.appendChild(li);
    });
    if (!paletteItems.length) {
        const li = document.createElement('li');
        li.className = 'pal-empty';
        li.textContent = 'No match. Try “check-in”, “report” or “night”.';
        list.appendChild(li);
    }
    document.getElementById('palette-input')?.setAttribute('aria-activedescendant', `pal-${paletteIndex}`);
    document.getElementById(`pal-${paletteIndex}`)?.scrollIntoView({ block: 'nearest' });
}

function runPalette(i: number): void {
    const c = paletteItems[i];
    (document.getElementById('palette') as HTMLDialogElement | null)?.close();
    c?.run();
}

function openPalette(): void {
    if (!app.ws) return;
    let dlg = document.getElementById('palette') as HTMLDialogElement | null;
    if (!dlg) {
        dlg = document.createElement('dialog');
        dlg.id = 'palette';
        dlg.setAttribute('aria-label', 'Go to a screen or run an action');
        dlg.innerHTML =
            '<input id="palette-input" type="text" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-label="Search screens and actions" placeholder="Where to? Type a screen or an action" autocomplete="off"><ul id="palette-list" role="listbox"></ul><p class="pal-foot"><kbd>↑</kbd><kbd>↓</kbd> to move · <kbd>Enter</kbd> to open · <kbd>Esc</kbd> to close</p>';
        document.body.appendChild(dlg);
        const input = dlg.querySelector('input')!;
        input.addEventListener('input', () => {
            paletteIndex = 0;
            renderPalette(input.value);
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                paletteIndex = (paletteIndex + (e.key === 'ArrowDown' ? 1 : -1) + paletteItems.length) % Math.max(1, paletteItems.length);
                renderPalette(input.value);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                runPalette(paletteIndex);
            }
        });
        dlg.addEventListener('click', (e) => {
            if (e.target === dlg) dlg!.close();
        });
    }
    const input = dlg.querySelector('input')!;
    input.value = '';
    paletteIndex = 0;
    renderPalette('');
    if (!dlg.open) dlg.showModal();
    input.focus();
}

/* ------------------------------------------------------------------ wiring */

export function initFx(): void {
    let night = false;
    try {
        night = localStorage.getItem('quinta.night') === '1';
    } catch {
        /* preference only */
    }
    applyNight(night);
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            openPalette();
        }
    });
    registerActions({
        'night-toggle': async () => {
            const on = !isNight();
            applyNight(on);
            writePref('quinta.night', on ? '1' : '0');
            await bus.refresh();
        },
        palette: () => openPalette(),
        breathe: () => (breathTimer ? stopBreathing() : startBreathing()),
        'sleep-step': (el) => stepSleep(Number(el.dataset.d)),
    });
}

/** Called after each render. */
export function mountFx(isNavigation: boolean): void {
    if (isNavigation) stopBreathing();
    mountStars();
    mountParallax();
    mountChartHover();
    syncDial();
    const form = document.getElementById('checkin-form');
    form?.addEventListener('input', syncDial);
    form?.addEventListener('change', syncDial);
    const view = document.querySelector('.view');
    if (view && isNavigation && !reduced()) {
        view.classList.add('nav-in');
        window.setTimeout(() => view.classList.remove('nav-in'), 900);
    }
}
