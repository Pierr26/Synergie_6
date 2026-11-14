/**
 * HEXTA living emblem, ported from the HEXTA-lot4 mockup.
 * Fixed sphere, three 3D orbits (radius 136, tilted ~70°) and two satellites per orbit.
 * - spin(opening): the orbits make one full turn around the sphere (sidebar open / close).
 * - scrollBy(dy): satellites move forward or back with the page scroll, then stop where they are.
 * The angles live in this module so they survive the shell re-rendering the SVG.
 */

const NS = 'http://www.w3.org/2000/svg';
const CX = 400;
const CY = 310;
const R = 136;
const SAMPLES = 144;
const TAU = Math.PI * 2;
const DURATION_MS = 1500;
const PX_PER_LAP = 1400;
const DELAY = [0, 0.14, 0.28];

interface Ring {
    col: string;
    grad: 'black' | 'sand' | 'sage';
    a: [number, number];
    b: [number, number];
    k: number;
    s: number;
    t0: number[];
    dir: number;
    dur: number;
}

const RINGS: Ring[] = [
    { col: '#242a27', grad: 'black', a: [-1.0, 0.0], b: [-0.0, -1.0], k: 0.34559, s: -1, t0: [0.50265, -2.63894], dir: 1, dur: 16 },
    { col: '#c3ab79', grad: 'sand', a: [0.17365, 0.98481], b: [-0.98481, 0.17365], k: 0.34559, s: 1, t0: [-1.75929, 1.3823], dir: 1, dur: 20 },
    { col: '#84384b', grad: 'sage', a: [0.76604, -0.64279], b: [0.64279, 0.76604], k: 0.34559, s: -1, t0: [2.38761, -0.75398], dir: 1, dur: 24 },
];

type Vec3 = [number, number, number];

interface RingEls {
    U: Vec3;
    V: Vec3;
    backDark: SVGPathElement;
    backLight: SVGPathElement;
    frontDark: SVGPathElement;
    frontLight: SVGPathElement;
    sats: SVGCircleElement[];
}

const state = { rot: [0, 0, 0], sat: [0, 0, 0] };
let anim: { dir: number; from: number[]; t0: number | null } | null = null;
let pendingScroll = 0;
let raf = 0;
let prevFrame = 0;
let svgEl: SVGSVGElement | null = null;
let ringEls: RingEls[] = [];
let groups: { satBack: SVGGElement; satFront: SVGGElement } | null = null;
let idSeq = 0;

const reduceMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

function el<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>, parent: Element): SVGElementTagNameMap[K] {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, String(attrs[k]));
    parent.appendChild(e);
    return e;
}

function rotY(v: Vec3, c: number, s: number): Vec3 {
    return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

const fx = (n: number): string => n.toFixed(2);

function draw(): void {
    if (!svgEl || !groups) return;
    const { satBack, satFront } = groups;
    RINGS.forEach((r, i) => {
        const e = ringEls[i];
        const ang = state.rot[i];
        const [U, V] = ang ? [rotY(e.U, Math.cos(ang), Math.sin(ang)), rotY(e.V, Math.cos(ang), Math.sin(ang))] : [e.U, e.V];
        const pt = (t: number): Vec3 => {
            const c = Math.cos(t);
            const s = Math.sin(t);
            return [CX + R * (c * U[0] + s * V[0]), CY + R * (c * U[1] + s * V[1]), c * U[2] + s * V[2]];
        };
        const d = { b: '', f: '' };
        let last: 'b' | 'f' | null = null;
        let prev = pt(0);
        for (let k = 1; k <= SAMPLES; k++) {
            const cur = pt((TAU * k) / SAMPLES);
            const side = prev[2] + cur[2] < 0 ? 'b' : 'f';
            if (side !== last) d[side] += `M${fx(prev[0])},${fx(prev[1])}`;
            d[side] += `L${fx(cur[0])},${fx(cur[1])}`;
            last = side;
            prev = cur;
        }
        e.backDark.setAttribute('d', d.b);
        e.backLight.setAttribute('d', d.b);
        e.frontDark.setAttribute('d', d.f);
        e.frontLight.setAttribute('d', d.f);
        e.sats.forEach((c, j) => {
            const p = pt(r.t0[j] + state.sat[i]);
            const parent = p[2] < 0 ? satBack : satFront;
            c.setAttribute('cx', fx(p[0]));
            c.setAttribute('cy', fx(p[1]));
            if (c.parentNode !== parent) parent.appendChild(c);
        });
    });
}

function ease(x: number): number {
    const v = Math.max(0, Math.min(1, x));
    return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2;
}

function tick(now: number): void {
    const dt = prevFrame ? Math.min((now - prevFrame) / 1000, 0.05) : 0;
    let live = false;
    prevFrame = now;
    if (anim) {
        if (anim.t0 === null) anim.t0 = now;
        const p = Math.min(1, (now - anim.t0) / DURATION_MS);
        const a = anim;
        RINGS.forEach((r, i) => {
            const e = ease((p - DELAY[i]) / (1 - DELAY[2]));
            state.rot[i] = a.dir * TAU * ease(p);
            state.sat[i] = a.from[i] + r.dir * Math.PI * e;
        });
        if (p >= 1) {
            RINGS.forEach((r, i) => {
                state.rot[i] = 0;
                state.sat[i] = (((a.from[i] + r.dir * Math.PI) % TAU) + TAU) % TAU;
            });
            anim = null;
        } else live = true;
    }
    if (pendingScroll) {
        const step = Math.abs(pendingScroll) < 0.0005 ? pendingScroll : pendingScroll * Math.min(1, dt * 9);
        pendingScroll -= step;
        RINGS.forEach((r, i) => {
            state.sat[i] = (((state.sat[i] + (r.dir * step * 16) / r.dur) % TAU) + TAU) % TAU;
        });
        if (pendingScroll) live = true;
    }
    draw();
    if (live && svgEl?.isConnected) raf = requestAnimationFrame(tick);
    else {
        raf = 0;
        prevFrame = 0;
    }
}

function run(): void {
    if (!raf) {
        prevFrame = 0;
        raf = requestAnimationFrame(tick);
    }
}

/** Builds the emblem inside the given SVG (called after every shell render). */
export function mountEmblem(svg: SVGSVGElement): void {
    const P = `hx${++idSeq}-`;
    svg.setAttribute('viewBox', '250 160 300 300');
    svg.innerHTML =
        `<defs>` +
        `<radialGradient id="${P}core" cx="28%" cy="22%" r="80%"><stop stop-color="#e2f3e8"/><stop offset=".28" stop-color="#b3d8c4"/><stop offset=".65" stop-color="#70a58f"/><stop offset="1" stop-color="#365f54"/></radialGradient>` +
        `<radialGradient id="${P}sage" cx="28%" cy="22%" r="80%"><stop stop-color="#d9a6af"/><stop offset=".35" stop-color="#a95a6c"/><stop offset=".75" stop-color="#782d42"/><stop offset="1" stop-color="#451526"/></radialGradient>` +
        `<radialGradient id="${P}black" cx="28%" cy="22%" r="80%"><stop stop-color="#707875"/><stop offset=".3" stop-color="#343a37"/><stop offset=".7" stop-color="#131715"/><stop offset="1" stop-color="#050706"/></radialGradient>` +
        `<radialGradient id="${P}sand" cx="28%" cy="22%" r="80%"><stop stop-color="#fff3d9"/><stop offset=".4" stop-color="#dfcca3"/><stop offset="1" stop-color="#ac9468"/></radialGradient>` +
        `</defs><g></g><g></g><circle cx="400" cy="310" r="54" fill="url(#${P}core)"/><g></g><g></g>`;
    const gs = svg.querySelectorAll('g');
    const [ringBack, satBack, ringFront, satFront] = [gs[0], gs[1], gs[2], gs[3]];
    ringEls = RINGS.map((r) => {
        const q = Math.sqrt(1 - r.k * r.k);
        return {
            U: [r.a[0], r.a[1], 0],
            V: [r.k * r.b[0], r.k * r.b[1], r.s * q],
            backDark: el('path', { fill: 'none', stroke: r.col, 'stroke-width': 3.2, 'stroke-linecap': 'round', opacity: 0.72 }, ringBack),
            backLight: el('path', { fill: 'none', stroke: '#eff9f1', 'stroke-width': 0.65, 'stroke-linecap': 'round', opacity: 0.65 }, ringBack),
            frontDark: el('path', { fill: 'none', stroke: r.col, 'stroke-width': 3.2, 'stroke-linecap': 'round' }, ringFront),
            frontLight: el('path', { fill: 'none', stroke: '#eff9f1', 'stroke-width': 0.65, 'stroke-linecap': 'round', opacity: 0.65 }, ringFront),
            sats: r.t0.map(() => el('circle', { r: 10, fill: `url(#${P}${r.grad})` }, satBack)),
        };
    });
    svgEl = svg;
    groups = { satBack, satFront };
    draw();
    if (anim || pendingScroll) run();
}

/** One full turn of the orbits: opening the sidebar turns one way, closing the other. */
export function spinEmblem(opening: boolean): void {
    if (reduceMotion()) return;
    if (anim) state.rot = [0, 0, 0];
    anim = { dir: opening ? 1 : -1, from: state.sat.slice(), t0: null };
    run();
}

/** Satellites follow the page scroll (down: forward, up: back). */
export function scrollEmblem(dy: number): void {
    if (reduceMotion() || !dy) return;
    pendingScroll += (dy / PX_PER_LAP) * TAU;
    run();
}
