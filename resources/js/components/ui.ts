import { formatValue } from '../domain/measurements';
import { QUEUE_LABEL, type QueueState } from '../domain/queue';
import { hhmm } from '../domain/time';
import type { Observation } from '../domain/types';
import { html, raw, type Html } from '../lib/html';
import { icon } from './icons';

let toastTimer: number | undefined;

/** Toast complements a state that stays visible elsewhere; the status region announces it. */
export function toast(message: string): void {
    const host = document.getElementById('toast-host');
    const region = document.getElementById('status-region');
    if (region) {
        region.textContent = '';
        window.setTimeout(() => (region.textContent = message), 30);
    }
    if (!host) return;
    host.innerHTML = `<div class="toast">${icon('ok').value}<span></span></div>`;
    host.querySelector('span')!.textContent = message;
    host.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => host.classList.remove('show'), 3800);
}

export type Tone = 'ok' | 'review' | 'info' | 'error' | 'muted';

export function badge(text: string, tone: Tone = 'muted', ic?: string): Html {
    return html`<span class="badge badge-${tone}">${ic ? icon(ic) : ''}${text}</span>`;
}

export function demoRuleTag(): Html {
    return html`<span class="badge badge-review">${icon('review')}Demo rule</span>`;
}

const QUEUE_TONE: Record<QueueState, Tone> = { 'not-queued': 'muted', queued: 'info', sending: 'info', received: 'ok', retry: 'error' };
const QUEUE_ICON: Record<QueueState, string> = { 'not-queued': 'report', queued: 'clock', sending: 'send', received: 'ok', retry: 'retry' };

export function queueBadge(state: QueueState): Html {
    return badge(QUEUE_LABEL[state], QUEUE_TONE[state], QUEUE_ICON[state]);
}

export function qualityBadge(o: Pick<Observation, 'quality' | 'qualityNote'>): Html {
    if (o.quality === 'valid') return badge('Valid', 'ok', 'ok');
    if (o.quality === 'check') return html`<span class="badge badge-review" title="${o.qualityNote ?? ''}">${icon('review')}Check measurement</span>`;
    if (o.quality === 'not-recorded') return badge('Not recorded', 'muted', 'missing');
    return badge('Invalid', 'error', 'review');
}

export function sourceLabel(o: Pick<Observation, 'source'>): string {
    return { manual: 'Entered on this device', 'demo-dataset': 'Demo dataset (simulated)', example: 'Example (simulated)', 'simulated-sensor': 'Simulated sensor' }[o.source];
}

export function obsValue(o: Observation): Html {
    return html`<span class="mono">${formatValue(o)}</span>`;
}

export function timeTag(iso: string): Html {
    return html`<time class="mono" datetime="${iso}">${hhmm(Date.parse(iso))} UTC</time>`;
}

let pendingTitle = '';

/** The shell prints the page title in the mission header (mockup layout); the view keeps the lead and tags. */
export function takePageTitle(): string {
    const t = pendingTitle;
    pendingTitle = '';
    return t;
}

export function pageHead(title: string, lead?: string | Html, extra?: Html): Html {
    pendingTitle = title;
    if (!lead && !extra) return html``;
    return html`<div class="page-head"><div>${lead ? html`<p class="lead">${lead}</p>` : ''}</div>${extra ?? ''}</div>`;
}

export function emptyState(title: string, text: string, action?: Html): Html {
    return html`<div class="empty">${icon('info')}<div><strong>${title}</strong><p>${text}</p>${action ?? ''}</div></div>`;
}

export function field(id: string, label: string, control: Html, hint?: string, error?: string): Html {
    return html`<div class="field ${error ? 'has-error' : ''}"><label for="${id}">${label}</label>${hint ? html`<p class="hint" id="${id}-hint">${hint}</p>` : ''}${control}${error ? html`<p class="error" id="${id}-err">${icon('review')}${error}</p>` : ''}</div>`;
}

export function options(list: [string, string][], selected: string): Html {
    return raw(list.map(([v, l]) => `<option value="${v}"${v === selected ? ' selected' : ''}>${l.replace(/</g, '&lt;')}</option>`).join(''));
}
