// Compares computed styles of class names shared by the mockup and the app, view by view.
import { chromium } from '@playwright/test';
const MOCK = process.env.MOCKUP ?? 'http://127.0.0.1:8001';
const APP = process.env.BASE ?? 'http://127.0.0.1:8000';
const PROPS = ['color', 'backgroundColor', 'backgroundImage', 'borderTopColor', 'borderTopWidth', 'borderRadius', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'boxShadow', 'paddingTop', 'paddingLeft', 'textTransform'];
const grab = (props) => {
    const out = {};
    const seen = new Set();
    document.querySelectorAll('body *').forEach((el) => {
        if (!(el instanceof HTMLElement) || !el.offsetParent) return;
        for (const c of el.classList) {
            const key = c;
            if (seen.has(key)) continue;
            seen.add(key);
            const cs = getComputedStyle(el);
            out[key] = Object.fromEntries(props.map((p) => [p, cs[p]]));
            out[key].tag = el.tagName;
        }
    });
    out.__body = Object.fromEntries(props.map((p) => [p, getComputedStyle(document.body)[p]]));
    return out;
};
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
await ctx.addInitScript(() => { if (location.port !== '8001') ['astronaut', 'cmo', 'ground'].forEach((r) => localStorage.setItem('quinta.guide.' + r, 'done')); });
const m = await ctx.newPage();
await m.goto(MOCK + '/index.html');
await m.waitForTimeout(1500);
await m.evaluate(() => document.querySelector('[data-scn="j142"]')?.click());
const a = await ctx.newPage();
await a.goto(APP + '/');
await a.getByRole('button', { name: /Astronaut/ }).first().click();
await a.waitForTimeout(800);
const pairs = [['accueil', '/overview', 'astronaut'], ['checkin', '/check-in', 'astronaut'], ['suivi', '/trends', 'astronaut'], ['corps', '/body', 'astronaut'], ['equipage', '/crew', 'cmo']];
const diffs = new Map();
for (const [mv, av, role] of pairs) {
    await m.evaluate((v) => document.querySelector(`[data-go="${v}"]`)?.click(), mv);
    await m.waitForTimeout(500);
    await a.evaluate((r) => localStorage.setItem('quinta.role', r), role);
    await a.goto(APP + av);
    await a.waitForTimeout(900);
    const [ms, as] = [await m.evaluate(grab, PROPS), await a.evaluate(grab, PROPS)];
    for (const k of Object.keys(as)) {
        if (!ms[k]) continue;
        for (const p of PROPS) {
            if (ms[k][p] !== as[k][p]) {
                const id = `.${k} ${p}`;
                if (!diffs.has(id)) diffs.set(id, `${id}\n    mock: ${ms[k][p]}\n    app:  ${as[k][p]}   (${mv})`);
            }
        }
    }
}
console.log([...diffs.values()].join('\n'));
console.log('TOTAL', diffs.size);
await browser.close();
