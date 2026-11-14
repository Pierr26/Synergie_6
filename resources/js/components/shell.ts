import * as repo from '../data/repo';
import { reviewItems } from '../data/experience';
import { QUEUE_LABEL, type QueueState } from '../domain/queue';
import { hhmm, longDate, missionDay } from '../domain/time';
import { isNight } from '../fx';
import { html, type Html } from '../lib/html';
import { app, cfg, EMBEDDED, homeFor, me, ws, type Viewport } from '../state';
import { icon } from './icons';
import { takePageTitle } from './ui';

interface NavItem {
    href: string;
    label: string;
    ic: string;
    match: string[];
    badge?: number;
}

export function navItems(badges: Record<string, number> = {}): NavItem[] {
    if (app.role === 'ground')
        return [
            { href: '/ground', label: 'Houston', ic: 'link', match: ['ground'], badge: badges.ground },
            { href: '/body', label: 'Body & Risks', ic: 'body', match: ['body'] },
            { href: '/help', label: 'Help', ic: 'help', match: ['help'] },
        ];
    if (app.role === 'cmo')
        return [
            { href: '/crew', label: 'Review queue', ic: 'crew', match: ['crew'], badge: badges.crew },
            { href: '/reports', label: 'Reports', ic: 'report', match: ['reports'] },
            { href: '/trends', label: 'Trends', ic: 'trends', match: ['trends'] },
            { href: '/body', label: 'Body & Risks', ic: 'body', match: ['body'] },
            { href: '/help', label: 'Help', ic: 'help', match: ['help'] },
        ];
    // astronaut: four places only. Help stays one tap away in the header.
    return [
        { href: '/overview', label: 'Today', ic: 'home', match: ['overview', ''] },
        { href: '/log', label: 'Log', ic: 'checkin', match: ['log', 'check-in', 'measurements', 'symptoms'], badge: badges.checkin },
        { href: '/trends', label: 'My health', ic: 'trends', match: ['trends', 'body'] },
        { href: '/follow-up', label: 'Messages', ic: 'followup', match: ['follow-up'], badge: badges.followup },
    ];
}

const ROLE_GROUP: Record<string, string> = { astronaut: 'Astronaut · on board', cmo: 'Crew medical officer · on board', ground: 'Flight surgeon · Houston' };

function isActive(item: NavItem): boolean {
    return item.match.includes(app.route.segments[0] ?? '');
}

/** What the sidebar "Today" card says: the one state that matters now, in words. */
async function todayStatus(): Promise<{ text: string; tone: 'ok' | 'wt' | 'al'; badges: Record<string, number> }> {
    const c = cfg();
    if (app.role === 'ground') {
        const fresh = (await repo.notificationsFor(ws(), me())).filter((n) => !n.readAt).length;
        return { text: fresh ? `${fresh} new report${fresh > 1 ? 's' : ''}` : app.groundLink ? 'In contact with the crew' : 'Link down', tone: fresh ? 'wt' : app.groundLink ? 'ok' : 'wt', badges: { ground: fresh } };
    }
    if (app.role === 'cmo') {
        const open = (await reviewItems(ws())).filter(i => !i.waitingForCrew).length;
        return { text: open ? `${open} item${open > 1 ? 's' : ''} to review` : 'Nothing to review', tone: open ? 'al' : 'ok', badges: { crew: open } };
    }
    const [t, items] = await Promise.all([repo.todaysTask(ws(), c.astronautId, app.now), reviewItems(ws(), c.astronautId)]);
    const openReq = items.filter(i => i.waitingForCrew).length;
    const badges = { checkin: t && (t.ev.state === 'due' || t.ev.state === 'snoozed') ? 1 : 0, followup: openReq };
    if (openReq) return { text: 'Follow-up requested', tone: 'wt', badges };
    if (t?.ev.state === 'due') return { text: 'Check-in due', tone: 'wt', badges };
    if (t?.ev.state === 'snoozed') return { text: `Snoozed until ${hhmm(t.task.snoozedUntil!)}`, tone: 'wt', badges };
    if (items.some(i => !i.waitingForCrew)) return { text: 'Crew review pending', tone: 'al', badges };
    if (t?.ev.state === 'scheduled') return { text: `Check-in at ${hhmm(t.ev.effectiveDue)}`, tone: 'ok', badges };
    return { text: 'Up to date', tone: 'ok', badges };
}

export async function renderShell(view: Html): Promise<Html> {
    const c = cfg();
    const day = missionDay(app.now, c.epoch);
    const who = repo.memberStatic(ws(), me());
    const reports = await repo.reportsFor(ws());
    const counts = reports.reduce<Record<string, number>>((acc, r) => ((acc[r.queue.state] = (acc[r.queue.state] ?? 0) + 1), acc), {});
    const queueSummary = (['retry', 'sending', 'queued', 'received'] as QueueState[]).filter((s) => counts[s]).map((s) => `${counts[s]} ${QUEUE_LABEL[s]}`);
    const banner = app.role === 'astronaut' ? await reminderBanner() : html``;
    const status = await todayStatus();
    const items = navItems(status.badges);
    const demo = ws() === 'demo';
    const title = takePageTitle();
    // phone tab bar: five slots. With more screens, the four most used stay and the rest open from "More".
    const tabOrder = ['/crew', '/reports', '/trends', '/body'];
    const tabs = items.length <= 5 ? items : tabOrder.map((h) => items.find((i) => i.href === h)!);
    const rest = items.filter((i) => !tabs.includes(i));

    return html`
    ${EMBEDDED ? '' : await previewBar()}
    <div class="app ${demo ? 'is-demo' : 'is-explore'} ${app.rail ? 'rail' : ''}">
      <aside class="side" aria-label="Main navigation">
        <div class="sb-top">
          <button type="button" class="brand brand-toggle" data-action="rail-toggle" aria-expanded="${!app.rail}" aria-controls="side-nav" title="${app.rail ? 'Expand the menu' : 'Collapse the menu'}">
            <span class="brand-mark"><svg data-emblem width="38" height="38" aria-hidden="true" focusable="false"></svg></span>
            <b>HEXTA</b>
            <span class="sr-only">${app.rail ? 'Expand the menu' : 'Collapse the menu'}</span>
          </button>
        </div>
        <a href="${homeFor()}" data-link class="sb-today">
          <span class="sb-orb t-${status.tone}" aria-hidden="true"><b>${day}</b></span>
          <span><span class="sb-k">Today · Day ${day}</span><span class="sb-st st-${status.tone}">${status.text}</span><span class="sb-clock mono">${hhmm(app.now)} UTC</span></span>
        </a>
        <nav class="sb-nav" id="side-nav">
          <span class="sb-group">${ROLE_GROUP[app.role]}</span>
          ${items.map((i) => html`<a href="${i.href}" data-link class="sb-item" ${isActive(i) ? html`aria-current="page"` : ''}><span class="sb-ico">${icon(i.ic)}</span><span class="sb-lbl">${i.label}</span>${i.badge ? html`<span class="sb-badge" aria-hidden="true">${i.badge}</span>` : ''}</a>`)}
        </nav>
        <div class="side-foot">
          <div class="crew"><i>${who.initials}</i><div><b>${who.alias}</b><span>${who.title}</span></div></div>
          <div class="link ${app.groundLink ? '' : 'off'}"><span class="pulse"></span>Ground link ${app.groundLink ? 'connected' : 'offline'} · simulated</div>
        </div>
      </aside>

      <div class="main">

        ${demo ? await coach() : ''}
        <header class="top mission" aria-label="Mission status">
          <div class="top-l">
          <div class="eyebrow">
            <span class="eb-day day">Day ${day} <span class="mono">${hhmm(app.now)}</span> <small>UTC</small></span>
            <span class="eb-date">${longDate(app.now)}${demo ? ' · simulated clock' : ''}</span>
            <span class="sim-tag">Simulated data</span>
          </div>
          <h1 tabindex="-1" id="page-title">${title}</h1>
          </div>
          <div class="status-strip">
            <button type="button" class="chip ${app.groundLink ? '' : 'off'}" data-action="toggle-link" aria-pressed="${app.groundLink}" title="Simulated ground link. Select to cut or restore it. ${app.browserOnline ? 'Device online' : 'Device offline'} · ${app.offlineReady ? 'ready offline' : 'preparing offline'}.">
              <span class="link ${app.groundLink ? '' : 'off'}"><span class="pulse"></span></span><span>${app.groundLink ? html`Ground link <b>connected</b>` : html`Ground link <b>offline</b>`}</span>
            </button>
            ${statusMenu(queueSummary, counts.retry ?? 0)}
            <button type="button" class="chip pal-btn" data-action="palette" title="Search screens and actions (Ctrl K)">${icon('menu', 'sm')}<span class="sr-only">Go to a screen or action</span><span class="pal-l">Go to</span></button>
            <button type="button" class="chip night-btn" data-action="night-toggle" aria-pressed="${isNight()}" title="Soft night: warm, dark colours for the sleep period">${icon('moon', 'sm')}<span class="sr-only">Soft night</span></button>
            ${app.role === 'astronaut' ? html`<a href="/help" data-link class="chip help-btn" aria-label="Help">${icon('help', 'sm')}</a>` : ''}
            <a href="/notifications" data-link class="chip bell ${app.route.segments[0] === 'notifications' ? 'active' : ''}" aria-label="Notifications, ${app.unread} unread">${icon('bell', 'sm')}${app.unread ? html`<span class="count">${app.unread}</span>` : ''}</a>
          </div>
        </header>
        ${app.route.segments[0] === 'overview' ? '' : banner}
        ${subTabs()}
        <main id="main" tabindex="-1" class="view">${view}</main>
        <p class="disclaimer">HEXTA · Synergy 5 research prototype for the NASA Space Apps Challenge 2026. Simulated data and demo rules, no clinical validation, not affiliated with NASA. <a href="/help#credits" data-link>Sources and credits</a></p>
        <nav class="tabbar" aria-label="Main navigation">
          ${tabs.map((i) => html`<a href="${i.href}" data-link ${isActive(i) ? html`aria-current="page"` : ''}>${icon(i.ic)}<span>${i.label.replace(' & Risks', '').replace('Review queue', 'Reviews')}</span>${i.badge ? html`<i class="dotb" aria-hidden="true"></i>` : ''}</a>`)}
          ${rest.length ? html`<button type="button" data-action="palette" class="${rest.some(isActive) ? 'on' : ''}" aria-label="More screens and actions">${icon('menu')}<span>More</span></button>` : ''}
        </nav>
      </div>
    </div>`;
}

/**
 * Device, offline cache and report queue in one chip (the mockup shows three quiet chips, not six).
 * The chip names the state that needs attention, if any; the panel lists all three in words.
 */
function statusMenu(queueSummary: string[], retries: number): Html {
    const issue = !app.browserOnline ? 'Device offline' : retries ? `${retries} report${retries > 1 ? 's' : ''} to retry` : !app.offlineReady ? 'Preparing offline' : '';
    const tone = !app.browserOnline || retries ? 'off' : !app.offlineReady ? '' : 'ok';
    return html`<details class="st-menu pop" data-pop>
      <summary class="chip ${tone}" title="Device, offline cache and ground reports">
        ${icon(issue ? 'info' : 'ok', 'sm')}<b>${issue || 'All set'}</b>${icon('chev', 'sm')}
      </summary>
      <div class="pop-panel st-panel" role="group" aria-label="Device and report status">
        <p class="${app.browserOnline ? '' : 'st-off'}">${icon('device', 'sm')}<span>Device</span><b>${app.browserOnline ? 'online' : 'offline'}</b></p>
        <p class="${app.offlineReady ? 'st-ok' : ''}">${icon('cache', 'sm')}<span>Offline cache</span><b>${app.offlineReady ? 'Ready offline' : 'Preparing'}</b></p>
        <a href="/reports" data-link class="${retries ? 'st-off' : ''}">${icon('send', 'sm')}<span>Ground reports</span><b>${queueSummary.length ? queueSummary.join(' · ') : 'None queued'}</b></a>
      </div>
    </details>`;
}

const VIEWPORT_LABEL: Record<Viewport, string> = { auto: 'Adaptive', desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile' };

/** The mockup's preview bar: product line, demo scenario controls, role, display. Outside the app frame. */
export async function previewBar(): Promise<Html> {
    const c = cfg();
    const demo = ws() === 'demo';
    const astro = repo.memberStatic(ws(), c.astronautId).shortName;
    const cmo = repo.memberStatic(ws(), c.cmoId).shortName;
    const ground = repo.memberStatic(ws(), c.groundId).shortName;
    return html`
    <div class="preview">
      <span class="pv-line"><strong>HEXTA</strong> · ${demo ? 'guided demo' : 'explore app'} · Synergy 5 · simulated data</span>
      ${demo
          ? html`<details class="demo-tools"><summary>Scenario controls</summary><section class="scn" aria-label="Demo controls">
          <span class="scn-l">Demo</span>
          <button type="button" data-action="scenario" data-day="138">Replay Day 138</button>
          <button type="button" data-action="scenario" data-day="142" class="j142">Replay Day 142</button>
          <span class="scn-sep" aria-hidden="true"></span>
          <button type="button" data-action="clock" data-min="1">Advance 1 minute</button>
          <button type="button" data-action="clock" data-min="30">Advance 30 min</button>
          <button type="button" data-action="clock" data-min="next-day">Next day 07:00</button>
          <label class="scn-check"><input type="checkbox" data-action="lose-receipt" ${app.loseNextReceipt ? 'checked' : ''}> Lose next receipt</label>
        </section></details>`
          : html`<span class="scn"><span class="scn-l">Real clock · no mission rule configured</span></span>`}
      <div class="pv-btns" role="group" aria-label="Role">
        <button type="button" data-action="role" data-role="astronaut" aria-pressed="${app.role === 'astronaut'}">Astronaut · ${astro}</button>
        <button type="button" data-action="role" data-role="cmo" aria-pressed="${app.role === 'cmo'}">CMO · ${cmo}</button>
        <button type="button" data-action="role" data-role="ground" aria-pressed="${app.role === 'ground'}">Houston · ${ground}</button>
      </div>
      <div class="pv-btns pv-view" role="group" aria-label="Preview display">
        ${(Object.keys(VIEWPORT_LABEL) as Viewport[]).map((v) => html`<button type="button" data-action="viewport" data-viewport="${v}" aria-pressed="${app.viewport === v}">${VIEWPORT_LABEL[v]}</button>`)}
      </div>
    </div>`;
}

/** Second level of navigation inside a section, so every screen is one tap away without a heavy menu. */
function subTabs(): Html {
    if (app.role !== 'astronaut') return html``;
    const seg = app.route.segments[0] ?? '';
    const sub = app.route.segments[1] ?? '';
    const groups: Record<string, { href: string; label: string; on: boolean }[]> = {
        health: [
            { href: '/trends', label: 'Trends', on: seg === 'trends' },
            { href: '/body', label: 'Body & Risks', on: seg === 'body' },
        ],
        log: [
            { href: '/log', label: 'All', on: seg === 'log' && !sub },
            { href: '/check-in', label: 'Check-in', on: seg === 'check-in' },
            { href: '/measurements', label: 'Measurement', on: seg === 'measurements' },
            { href: '/symptoms', label: 'Symptom', on: seg === 'symptoms' },
            { href: '/log/medication', label: 'Medication', on: seg === 'log' && sub === 'medication' },
        ],
    };
    const g = ['trends', 'body'].includes(seg) ? groups.health : ['log', 'check-in', 'measurements', 'symptoms'].includes(seg) ? groups.log : null;
    if (!g) return html``;
    return html`<nav class="sub-tabs" aria-label="In this section">${g.map((t) => html`<a href="${t.href}" data-link ${t.on ? html`aria-current="page"` : ''}>${t.label}</a>`)}</nav>`;
}

async function reminderBanner(): Promise<Html> {
    const t = await repo.todaysTask(ws(), me(), app.now);
    // Overview already leads with the same reminder in its hero card: no second banner there
    const here = app.route.segments[0] ?? 'overview';
    if (!t || !t.ev.bannerVisible || here === 'check-in' || here === 'overview') return html``;
    return html`
    <section class="remind banner" aria-labelledby="banner-title">
      <span class="rm-ico">${icon('bell')}</span>
      <div class="rm-txt"><b id="banner-title">Daily check-in is due</b><span>Due ${hhmm(t.ev.effectiveDue)} UTC · sleep and drowsiness, about one minute. Saved on this device, even with the ground link offline.</span></div>
      <div class="rm-act">
        <a class="btn main" href="/check-in" data-link>Start check-in</a>
        ${t.ev.canSnooze ? html`<button type="button" class="btn ghost" data-action="snooze">Snooze 30 min</button>` : ''}
      </div>
      <button type="button" class="rm-x" data-action="dismiss-banner" aria-label="Dismiss banner">${icon('close', 'sm')}</button>
    </section>`;
}

interface CoachStep {
    label: string;
    done: boolean;
    cta: string;
    why: string;
    attrs: Html;
}

/**
 * Mission guide (demo only): the five steps of the guided scenario, read from real state.
 * The current step is one button that performs or opens the next action.
 */
async function coach(): Promise<Html> {
    let on = true;
    try {
        on = localStorage.getItem('quinta.coach') !== '0';
    } catch {
        /* preference only */
    }
    if (!on) return html`<div class="coach coach-off"><button type="button" class="coach-toggle" data-action="coach-show">${icon('play', 'sm')}Show the mission guide</button></div>`;
    const c = cfg();
    const crew = c.astronautId;
    const day = missionDay(app.now, c.epoch);
    const [t, ci, alerts, reports] = await Promise.all([repo.todaysTask(ws(), crew, app.now), repo.checkinFor(ws(), crew, day), repo.alertsFor(ws(), crew), repo.reportsFor(ws())]);
    const saved = ci?.status === 'submitted';
    const alert = alerts[0];
    const queued = reports.some((r) => r.queue.state !== 'not-queued');
    const received = reports.some((r) => r.queue.state === 'received');
    const retry = reports.find((r) => r.queue.state === 'retry');
    const quiet = saved && !alert;
    const steps: CoachStep[] = [
        { label: 'Reminder', done: saved || (!!t && t.ev.state !== 'scheduled'), cta: 'Advance the clock to 07:00', why: 'It is 06:59. The daily check-in becomes due at 07:00 UTC.', attrs: html`data-action="clock" data-min="1"` },
        { label: 'Check-in', done: saved, cta: 'Open the daily check-in', why: 'The astronaut saves last night’s sleep. A draft is already waiting.', attrs: html`data-action="coach-go" data-role="astronaut" data-href="/check-in"` },
        quiet
            ? { label: 'Signal', done: false, cta: 'Jump to Day 142', why: `No signal on Day ${day}: the demo rule needs three nights under 6 h. Day 142 shows it.`, attrs: html`data-action="scenario" data-day="142"` }
            : { label: 'Crew review', done: alert?.status === 'reviewed', cta: 'Review the sleep trend as CMO', why: 'The rule flagged three short nights. The crew medical officer reviews them on board.', attrs: html`data-action="coach-go" data-role="cmo" data-href="/crew/${crew}"` },
        { label: 'Report', done: queued, cta: 'Prepare the individual report', why: 'The CMO generates a snapshot and decides to queue it for the ground.', attrs: html`data-action="coach-go" data-role="cmo" data-href="/reports?member=${crew}"` },
        retry
            ? { label: 'Receipt', done: false, cta: 'Open the report to retry', why: 'The receipt was lost. Retry sends the same report ID and content.', attrs: html`data-action="coach-go" data-role="cmo" data-href="/reports?report=${retry.id}"` }
            : { label: 'Receipt', done: received, cta: 'Restore the ground link', why: 'The report waits in the queue. Restoring the simulated link delivers it and returns a receipt.', attrs: html`data-action="toggle-link"` },
    ];
    const current = steps.findIndex((s) => !s.done);
    const cur = steps[current];
    const doneCount = steps.filter((s) => s.done).length;
    // one slim line: where we are, why, and the one button. The five steps open on demand.
    return html`<section class="coach coach-slim" aria-label="Mission guide">
      <details class="coach-more pop" data-pop>
        <summary class="coach-pill" title="Show the five steps of the guided demo">
          <span class="coach-ring" style="--p:${doneCount / steps.length}" aria-hidden="true"></span>
          ${cur ? html`<span>Step ${current + 1}/5 · <b>${cur.label}</b></span>` : html`<span><b>Scenario complete</b></span>`}
          ${icon('chev', 'sm')}
        </summary>
        <ol class="coach-steps pop-panel">${steps.map((s, i) => html`<li class="${s.done ? 'done' : i === current ? 'now' : ''}" ${i === current ? html`aria-current="step"` : ''}><span class="coach-n">${s.done ? icon('ok', 'sm') : i + 1}</span>${s.label}</li>`)}</ol>
      </details>
      <p class="coach-why">${cur ? cur.why : 'Everything happened on board. The report has now reached Houston.'}</p>
      ${cur
          ? html`<button type="button" class="coach-cta" ${cur.attrs}>${cur.cta}${icon('arrow', 'sm')}</button>`
          : html`${app.role !== 'ground' ? html`<button type="button" class="coach-cta" data-action="coach-go" data-role="ground" data-href="/ground">See it in Houston${icon('arrow', 'sm')}</button>` : ''}<button type="button" class="coach-cta ghost" data-action="scenario" data-day="142">Play it again${icon('retry', 'sm')}</button>`}
      <button type="button" class="coach-x" data-action="coach-hide" aria-label="Hide the mission guide">${icon('close', 'sm')}</button>
    </section>`;
}
