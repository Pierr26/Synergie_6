import { icon } from '../../components/icons';
import { pageHead } from '../../components/ui';
import * as repo from '../../data/repo';
import { hhmm, missionDay } from '../../domain/time';
import { html, type Html } from '../../lib/html';
import { app, cfg, me, ws } from '../../state';

interface LogChoice {
    href: string;
    img: string;
    title: string;
    what: string;
    status: string;
    tone: 'due' | 'done' | 'idle';
    primary?: boolean;
}

/**
 * Log: the three ways an astronaut enters something. One card each, the one that is due comes first.
 * Each card says what it is in plain words and how long it takes.
 */
export async function renderLog(): Promise<Html> {
    const c = cfg();
    const crewId = me();
    const day = missionDay(app.now, c.epoch);
    const [task, ci, obs, symptoms] = await Promise.all([repo.todaysTask(ws(), crewId, app.now), repo.checkinFor(ws(), crewId, day), repo.observationsFor(ws(), crewId), repo.symptomReportsFor(ws(), crewId)]);
    const saved = ci?.status === 'submitted';
    const due = !saved && !!task && (task.ev.state === 'due' || task.ev.state === 'snoozed');
    const today = obs.filter((o) => missionDay(Date.parse(o.measuredAt), c.epoch) === day && o.source !== 'simulated-sensor' && !o.variable.startsWith('sleep') && o.variable !== 'drowsiness');
    const openSym = symptoms.filter((s) => s.status === 'submitted').length;

    const choices: LogChoice[] = [
        {
            href: '/check-in',
            img: saved ? 'done' : 'sleep',
            title: 'Daily check-in',
            what: 'Last night’s sleep and how drowsy you feel. About one minute.',
            status: saved ? 'Done for today' : due ? 'Due now' : ci ? 'Draft saved' : task ? `Opens at ${hhmm(task.ev.effectiveDue)} UTC` : 'Ready',
            tone: saved ? 'done' : due ? 'due' : 'idle',
            primary: due,
        },
        {
            href: '/measurements',
            img: 'message',
            title: 'Spot measurement',
            what: 'Blood pressure, oxygen level, temperature… when you take one.',
            status: today.length ? `${today.length} logged today` : 'Nothing logged today',
            tone: today.length ? 'done' : 'idle',
        },
        {
            href: '/symptoms',
            img: 'symptom',
            title: 'Report a symptom',
            what: 'Something you can see or feel: a photo and a few words for your medical officer.',
            status: openSym ? `${openSym} open with your medical officer` : 'Only when you need it',
            tone: 'idle',
        },
    ];
    choices.sort((a, b) => Number(!!b.primary) - Number(!!a.primary));

    return html`
    ${pageHead('Log', 'What would you like to record?')}
    <div class="log-grid">
      ${choices.map(
          (ch) => html`<a class="log-card ${ch.primary ? 'primary' : ''}" href="${ch.href}" data-link>
          <img src="/assets/illustrations/states/${ch.img}.webp" alt="" width="96" height="96" loading="lazy">
          <span class="log-main"><b>${ch.title}</b><span>${ch.what}</span></span>
          <span class="log-st st-${ch.tone}">${ch.status}</span>
          <span class="log-go" aria-hidden="true">${icon('arrow')}</span>
        </a>`,
      )}
    </div>
    <p class="log-foot">${icon('info', 'sm')}Everything is saved on board first. It never needs the ground link.</p>`;
}
