import * as repo from '../data/repo';
import { reviewItems } from '../data/experience';
import { QUEUE_LABEL, type QueueState } from '../domain/queue';
import { hhmm, longDate, missionDay } from '../domain/time';
import { isNight } from '../fx';
import { html, type Html } from '../lib/html';
import { app, cfg, me, ws } from '../state';
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
    if (app.role === 'cmo')
        return [
            { href: '/crew', label: 'Review queue', ic: 'crew', match: ['crew'], badge: badges.crew },
            { href: '/reports', label: 'Reports', ic: 'report', match: ['reports'] },
            { href: '/trends', label: 'Trends', ic: 'trends', match: ['trends'] },
            { href: '/body', label: 'Body & Risks', ic: 'body', match: ['body'] },
            { href: '/help', label: 'Help', ic: 'help', match: ['help'] },
        ];
    return [
        { href: '/overview', label: 'Today', ic: 'home', match: ['overview', ''] },
        { href: '/check-in', label: 'Daily Check-in', ic: 'checkin', match: ['check-in'], badge: badges.checkin },
        { href: '/trends', label: 'Trends', ic: 'trends', match: ['trends'] },
        { href: '/body', label: 'Body & Risks', ic: 'body', match: ['body'] },
        { href: '/symptoms', label: 'Report a Symptom', ic: 'camera', match: ['symptoms'] },
        { href: '/follow-up', label: 'Follow-up', ic: 'followup', match: ['follow-up'], badge: badges.followup },
        { href: '/measurements', label: 'Measurements', ic: 'measure', match: ['measurements'] },
        { href: '/help', label: 'Help', ic: 'help', match: ['help'] },
    ];
}

function isActive(item: NavItem): boolean {
    return item.match.includes(app.route.segments[0] ?? '');
}

/** What the sidebar "Today" card says: the one state that matters now, in words. */
async function todayStatus(): Promise<{ text: string; tone: 'ok' | 'wt' | 'al'; badges: Record<string, number> }> {
    const c = cfg();
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
    const astro = repo.memberStatic(ws(), c.astronautId);
    const cmo = repo.memberStatic(ws(), c.cmoId);
    const reports = await repo.reportsFor(ws());
    const counts = reports.reduce<Record<string, number>>((acc, r) => ((acc[r.queue.state] = (acc[r.queue.state] ?? 0) + 1), acc), {});
    const queueSummary = (['retry', 'sending', 'queued', 'received'] as QueueState[]).filter((s) => counts[s]).map((s) => `${counts[s]} ${QUEUE_LABEL[s]}`);
    const banner = app.role === 'astronaut' ? await reminderBanner() : html``;
    const status = await todayStatus();
    const items = navItems(status.badges);
    const demo = ws() === 'demo';
    const title = takePageTitle();
    // phone tab bar: five slots. With more screens, the four most used stay and the rest open from "More".
    const tabOrder = app.role === 'cmo' ? ['/crew', '/reports', '/trends', '/body'] : ['/overview', '/check-in', '/follow-up', '/trends'];
    const tabs = items.length <= 5 ? items : tabOrder.map((h) => items.find((i) => i.href === h)!);
    const rest = items.filter((i) => !tabs.includes(i));

    return html`
    ${previewBar(demo, astro.shortName, cmo.shortName)}
    <div class="app ${demo ? 'is-demo' : 'is-explore'}">
      <aside class="side" aria-label="Main navigation">
        <div class="sb-top">
          <a href="/" data-link class="brand" aria-label="QUINTA home: choose demo or explore">
            <img src="/assets/brand/quinta-logo.svg" alt="QUINTA" width="132" height="36">
          </a>
        </div>
        <a href="${app.role === 'cmo' ? '/crew' : '/overview'}" data-link class="sb-today">
          <span class="sb-orb t-${status.tone}" aria-hidden="true"><b>${day}</b></span>
          <span><span class="sb-k">Today · Day ${day}</span><span class="sb-st st-${status.tone}">${status.text}</span><span class="sb-clock mono">${hhmm(app.now)} UTC</span></span>
        </a>
        <nav class="sb-nav">
          <span class="sb-group">${app.role === 'cmo' ? 'Crew medical officer' : 'Astronaut'}</span>
          ${items.map((i) => html`<a href="${i.href}" data-link class="sb-item" ${isActive(i) ? html`aria-current="page"` : ''}><span class="sb-ico">${icon(i.ic)}</span><span class="sb-lbl">${i.label}</span>${i.badge ? html`<span class="sb-badge" aria-hidden="true">${i.badge}</span>` : ''}</a>`)}
        </nav>
        <div class="side-foot">
          <div class="crew"><i>${who.initials}</i><div><b>${who.alias}</b><span>${who.title}</span></div></div>
          <div class="link ${app.groundLink ? '' : 'off'}"><span class="pulse"></span>Ground link ${app.groundLink ? 'connected' : 'offline'} · simulated</div>
        </div>
      </aside>

      <div class="main">

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
            <button type="button" class="chip ${app.groundLink ? '' : 'off'}" data-action="toggle-link" aria-pressed="${app.groundLink}" title="Simulated ground link. Select to cut or restore it.">
              <span class="link-dot ${app.groundLink ? '' : 'off'}" aria-hidden="true"></span>Ground link <b>${app.groundLink ? 'connected' : 'offline'}</b>
            </button>
            <span class="chip ${app.browserOnline ? '' : 'off'}" title="Network state reported by this browser">${icon('device', 'sm')}<span class="chip-l">Device</span> <b>${app.browserOnline ? 'online' : 'offline'}</b></span>
            <span class="chip ${app.offlineReady ? 'ok' : ''}" title="Whether the app is cached on this device">${icon('cache', 'sm')}<b>${app.offlineReady ? 'Ready offline' : 'Preparing offline'}</b></span>
            ${queueSummary.length ? html`<a href="/reports" data-link class="chip info" title="Ground report queue">${icon('send', 'sm')}Reports <b>${queueSummary.join(' · ')}</b></a>` : ''}
            <button type="button" class="chip pal-btn" data-action="palette" title="Search screens and actions (Ctrl K)">${icon('menu', 'sm')}<span class="sr-only">Go to a screen or action</span><span class="pal-l">Go to</span><kbd>Ctrl K</kbd></button>
            <button type="button" class="chip night-btn" data-action="night-toggle" aria-pressed="${isNight()}" title="Soft night: warm, dark colours for the sleep period">${icon('moon', 'sm')}<span class="sr-only">Soft night</span></button>
            <a href="/notifications" data-link class="chip bell ${app.route.segments[0] === 'notifications' ? 'active' : ''}" aria-label="Notifications, ${app.unread} unread">${icon('bell', 'sm')}${app.unread ? html`<span class="count">${app.unread}</span>` : ''}</a>
          </div>
        </header>
        ${app.route.segments[0] === 'overview' ? '' : banner}
        <main id="main" tabindex="-1" class="view">${view}</main>
        <p class="disclaimer">QUINTA · Synergy 5 research prototype for the NASA Space Apps Challenge 2026. Simulated data and demo rules, no clinical validation, not affiliated with NASA. <a href="/help#credits" data-link>Sources and credits</a></p>
        <nav class="tabbar" aria-label="Main navigation">
          ${tabs.map((i) => html`<a href="${i.href}" data-link ${isActive(i) ? html`aria-current="page"` : ''}>${icon(i.ic)}<span>${i.label.replace(' & Risks', '').replace('Daily Check-in', 'Check-in').replace('Review queue', 'Reviews')}</span>${i.badge ? html`<i class="dotb" aria-hidden="true"></i>` : ''}</a>`)}
          ${rest.length ? html`<button type="button" data-action="palette" class="${rest.some(isActive) ? 'on' : ''}" aria-label="More screens and actions">${icon('menu')}<span>More</span></button>` : ''}
        </nav>
      </div>
    </div>`;
}

/** The mockup's preview bar: product line, demo scenario controls, role. Outside the app frame. */
function previewBar(demo: boolean, astro: string, cmo: string): Html {
    return html`
    <div class="preview">
      <span class="pv-line"><strong>QUINTA</strong> · ${demo ? 'guided demo' : 'explore app'} · Synergy 5 · simulated data</span>
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
      <div class="pv-btns" role="group" aria-label="Role on board">
        <button type="button" data-action="role" data-role="astronaut" aria-pressed="${app.role === 'astronaut'}">Astronaut · ${astro}</button>
        <button type="button" data-action="role" data-role="cmo" aria-pressed="${app.role === 'cmo'}">CMO · ${cmo}</button>
      </div>
    </div>`;
}

async function reminderBanner(): Promise<Html> {
    const t = await repo.todaysTask(ws(), me(), app.now);
    if (!t || !t.ev.bannerVisible || app.route.segments[0] === 'check-in') return html``;
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
