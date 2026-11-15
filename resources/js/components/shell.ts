import * as repo from '../data/repo';
import { reviewItems } from '../data/experience';
import { QUEUE_LABEL, type QueueState } from '../domain/queue';
import { hhmm, missionDay } from '../domain/time';
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

const HELP_NAV: NavItem = { href: '/help', label: 'Help', ic: 'help', match: ['help'] };

export function navItems(badges: Record<string, number> = {}): NavItem[] {
    if (app.role === 'ground')
        return [
            { href: '/ground', label: 'Houston', ic: 'link', match: ['ground'], badge: badges.ground },
            { href: '/body', label: 'Body & Risks', ic: 'body', match: ['body'] },
            HELP_NAV,
        ];
    if (app.role === 'cmo')
        return [
            { href: '/crew', label: 'Review queue', ic: 'review', match: ['crew'], badge: badges.crew },
            { href: '/crew/teammates', label: 'Team', ic: 'crew', match: [] },
            { href: '/check-in', label: 'Daily Check-in', ic: 'checkin', match: ['check-in'] },
            { href: '/reports', label: 'Reports', ic: 'report', match: ['reports'] },
            { href: '/trends', label: 'Trends', ic: 'trends', match: ['trends'] },
            { href: '/body', label: 'Body & Risks', ic: 'body', match: ['body'] },
            HELP_NAV,
        ];
    return [
        { href: '/overview', label: 'Today', ic: 'home', match: ['overview', ''] },
        { href: '/check-in', label: 'Daily Check-in', ic: 'checkin', match: ['check-in'], badge: badges.checkin },
        { href: '/trends', label: 'My health', ic: 'trends', match: ['trends', 'body', 'measurements', 'log'] },
        { href: '/follow-up', label: 'Messages', ic: 'followup', match: ['follow-up'], badge: badges.followup },
        HELP_NAV,
    ];
}

const ROLE_GROUP: Record<string, string> = { astronaut: 'Astronaut · on board', cmo: 'Crew medical officer · on board', ground: 'Flight surgeon · Houston' };

function isActive(item: NavItem): boolean {
    if (app.route.segments[0] === 'crew' && app.route.segments[1] === 'teammates') return item.href === '/crew/teammates';
    return item.match.includes(app.route.segments[0] ?? '');
}

function profile(who: { initials: string; alias: string; title: string }, mobile = false): Html {
    const place = app.role === 'ground' ? 'Houston · Ground' : `${cfg().missionId} · On board`;
    if (mobile)
        return html`<details class="profile-menu profile-mobile" data-pop>
          <summary class="crew" id="mobile-profile" aria-label="Profile: ${who.alias}">
            <i aria-hidden="true">${who.initials}</i><span>Profile</span>
          </summary>
          <div class="pop-panel profile-panel">
            <button type="button" class="btn btn-ghost" data-action="sign-out" aria-label="Sign out">${icon('signout', 'sm')}Sign out</button>
          </div>
        </details>`;
    // Desktop: the crew card from the HEXTA mockup — ringed avatar, name, place, and the ground-link signal.
    return html`<details class="profile-menu profile-side" data-pop>
      <summary class="sb-crew" id="side-profile" aria-label="Profile: ${who.alias}">
        <span class="sb-av" aria-hidden="true">${who.initials}</span>
        <div class="profile-name">
          <b>${who.alias}</b><span>${place}</span>
          <div class="sb-link ${app.groundLink ? '' : 'off'}"><span class="sb-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="link">Ground link · ${app.groundLink ? 'online' : 'offline'}</span></div>
        </div>
      </summary>
      <div class="pop-panel profile-panel">
        <button type="button" class="btn btn-ghost" data-action="sign-out" aria-label="Sign out">${icon('signout', 'sm')}Sign out</button>
      </div>
    </details>`;
}

/** Keep the mission day indicator and the navigation badges in sync with open work. */
async function todayStatus(): Promise<{ tone: 'ok' | 'wt' | 'al'; badges: Record<string, number> }> {
    const c = cfg();
    if (app.role === 'ground') {
        const fresh = (await repo.notificationsFor(ws(), me())).filter((n) => !n.readAt).length;
        return { tone: fresh || !app.groundLink ? 'wt' : 'ok', badges: { ground: fresh } };
    }
    if (app.role === 'cmo') {
        const open = (await reviewItems(ws())).filter(i => !i.waitingForCrew).length;
        return { tone: open ? 'al' : 'ok', badges: { crew: open } };
    }
    const [t, items] = await Promise.all([repo.todaysTask(ws(), c.astronautId, app.now), reviewItems(ws(), c.astronautId)]);
    const openReq = items.filter(i => i.waitingForCrew).length;
    const badges = { checkin: t && (t.ev.state === 'due' || t.ev.state === 'snoozed') ? 1 : 0, followup: openReq };
    if (openReq || badges.checkin) return { tone: 'wt', badges };
    return { tone: items.some(i => !i.waitingForCrew) ? 'al' : 'ok', badges };
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
    const tabOrder = ['/crew', '/crew/teammates', '/check-in', '/body'];
    const tabs = items.length <= 5 ? items : tabOrder.map((h) => items.find((i) => i.href === h)!);
    const rest = items.filter((i) => !tabs.includes(i));

    return html`
    <div class="app ${demo ? 'is-demo' : 'is-explore'} ${app.rail ? 'rail' : ''}">
      <aside class="side" aria-label="Main navigation">
        <div class="sb-top">
          <button type="button" class="brand brand-toggle" data-action="rail-toggle" aria-expanded="${!app.rail}" aria-controls="side-nav" title="${app.rail ? 'Expand the menu' : 'Collapse the menu'}">
            <span class="brand-mark"><svg data-emblem width="38" height="38" aria-hidden="true" focusable="false"></svg></span>
            <b>HEXTA</b>
            <span class="sr-only">${app.rail ? 'Expand the menu' : 'Collapse the menu'}</span>
          </button>
        </div>
        <nav class="sb-nav" id="side-nav">
          <span class="sb-group">${ROLE_GROUP[app.role]}</span>
          ${items.map((i) => html`<a href="${i.href}" data-link class="sb-item" aria-label="${i.label}" title="${i.label}" ${isActive(i) ? html`aria-current="page"` : ''}><span class="sb-ico">${icon(i.ic)}</span><span class="sb-lbl">${i.label}</span>${i.badge ? html`<span class="sb-badge" aria-hidden="true">${i.badge}</span>` : ''}</a>`)}
        </nav>
        <div class="side-foot">
          ${profile(who)}
        </div>
      </aside>

      <div class="main">

        <header class="top mission" aria-label="Mission status">
          <div class="top-l">
          <span class="sb-orb title-orb t-${status.tone}" aria-hidden="true"><b>${day}</b></span>
          <h1 tabindex="-1" id="page-title">${title}</h1>
          <div class="eyebrow">
            <span class="eb-day day"><span class="mono">${new Date(app.now).toISOString().slice(11, 19)}</span> <small>UTC</small></span>
          </div>
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
        <nav class="tabbar" aria-label="Main navigation">
          ${profile(who, true)}
          ${tabs.map((i) => html`<a href="${i.href}" data-link ${isActive(i) ? html`aria-current="page"` : ''}>${icon(i.ic)}<span>${i.label.replace(' & Risks', '').replace('Review queue', 'Reviews').replace('Daily Check-in', 'Check-in')}</span>${i.badge ? html`<i class="dotb" aria-hidden="true"></i>` : ''}</a>`)}
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

/** Second level of navigation inside a section, so every screen is one tap away without a heavy menu. */
function subTabs(): Html {
    if (app.role !== 'astronaut') return html``;
    const seg = app.route.segments[0] ?? '';
    const sub = app.route.segments[1] ?? '';
    // One "My health" section: trends and body to read, measurements and medication to record.
    // (The daily check-in is its own screen; reporting a symptom lives in it.)
    const health = [
        { href: '/trends', label: 'Trends', on: seg === 'trends' },
        { href: '/body', label: 'Body & Risks', on: seg === 'body' },
        { href: '/measurements', label: 'Measurements', on: seg === 'measurements' },
        { href: '/log/medication', label: 'Medication', on: seg === 'log' && sub === 'medication' },
    ];
    const g = ['trends', 'body', 'measurements', 'log'].includes(seg) ? health : null;
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
