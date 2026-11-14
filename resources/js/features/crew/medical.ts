/**
 * Emergency card and medication log (fictional crew data).
 * The card is read-only demo content; medication intakes are stored on this device per crew member.
 */
import { icon } from '../../components/icons';
import { toast } from '../../components/ui';
import { bus } from '../../bus';
import * as repo from '../../data/repo';
import { uuid } from '../../data/db';
import { hhmm, missionDay } from '../../domain/time';
import { html, type Html } from '../../lib/html';
import { registerActions } from '../../router-actions';
import { app, cfg, me, ws } from '../../state';

interface Card {
    blood: string;
    allergies: string[];
    treatments: string[];
    conditions: string[];
    contact: string;
}

/** Fictional cards for the fictional crews. */
const CARDS: Record<string, Card> = {
    moreau: { blood: 'A+', allergies: ['Penicillin (rash)'], treatments: ['Melatonin 1 mg if needed, before sleep'], conditions: ['None declared'], contact: 'Flight surgeon on duty, Houston' },
    sato: { blood: 'O−', allergies: ['None known'], treatments: ['None'], conditions: ['Mild seasonal asthma, inhaler on board'], contact: 'Flight surgeon on duty, Houston' },
    okafor: { blood: 'B+', allergies: ['Latex'], treatments: ['None'], conditions: ['None declared'], contact: 'Flight surgeon on duty, Houston' },
    lindqvist: { blood: 'AB+', allergies: ['None known'], treatments: ['Vitamin D 1000 IU daily'], conditions: ['None declared'], contact: 'Flight surgeon on duty, Houston' },
};

export function medicalCard(crewId: string, compact = false): Html {
    const c = CARDS[crewId];
    if (!c) return html``;
    return html`<section class="card med-card ${compact ? 'compact' : ''}" aria-labelledby="mc-${crewId}">
      <div class="card-h"><h2 id="mc-${crewId}">${icon('info', 'sm')}Emergency card</h2><small>Fictional data</small></div>
      <dl class="med-dl">
        <div><dt>Blood type</dt><dd class="mono">${c.blood}</dd></div>
        <div class="${c.allergies[0] !== 'None known' ? 'warn' : ''}"><dt>Allergies</dt><dd>${c.allergies.join(' · ')}</dd></div>
        <div><dt>Regular treatment</dt><dd>${c.treatments.join(' · ')}</dd></div>
        <div><dt>Known conditions</dt><dd>${c.conditions.join(' · ')}</dd></div>
        <div><dt>Contact</dt><dd>${c.contact}</dd></div>
      </dl>
    </section>`;
}

export interface MedIntake {
    id: string;
    name: string;
    dose: string;
    reason: string;
    at: string;
}

const key = (crewId: string) => `meds:${crewId}`;
export const MEDS = ['Melatonin', 'Paracetamol', 'Ibuprofen', 'Antihistamine', 'Motion-sickness tablet', 'Sleep aid (prescribed)', 'Other'];

export async function medsFor(crewId: string): Promise<MedIntake[]> {
    return (await repo.kvGet<MedIntake[]>(ws(), key(crewId), [])).sort((a, b) => b.at.localeCompare(a.at));
}

registerActions({
    'med-add': async (el) => {
        const f = el as HTMLFormElement;
        const fd = new FormData(f);
        const name = String(fd.get('med') ?? '');
        const other = String(fd.get('other') ?? '').trim();
        const dose = String(fd.get('dose') ?? '').trim();
        if (!name || (name === 'Other' && !other)) {
            (f.querySelector('#med-err') as HTMLElement).hidden = false;
            return;
        }
        const list = await medsFor(me());
        list.push({ id: uuid(), name: name === 'Other' ? other : name, dose, reason: String(fd.get('reason') ?? '').trim(), at: new Date(app.now).toISOString() });
        await repo.kvSet(ws(), key(me()), list);
        toast('Medication saved on this device. Your medical officer sees it on board.');
        bus.navigate('/log/medication');
    },
});

export function medList(list: MedIntake[], empty: string): Html {
    const epoch = cfg().epoch;
    return list.length
        ? html`<ul class="med-list">${list.slice(0, 8).map((m) => html`<li><b>${m.name}</b>${m.dose ? html` · ${m.dose}` : ''}<small>Day ${missionDay(Date.parse(m.at), epoch)} · <span class="mono">${hhmm(Date.parse(m.at))} UTC</span>${m.reason ? ` · ${m.reason}` : ''}</small></li>`)}</ul>`
        : html`<p class="muted">${empty}</p>`;
}

/** Log › Medication: one short form, then what was taken recently. */
export async function renderMedication(): Promise<Html> {
    const list = await medsFor(me());
    return html`
    <p class="crumbs"><a href="/log" data-link>${icon('back')}Log</a></p>
    <div class="grid-2">
      <form class="card med-form" data-action="med-add" novalidate aria-labelledby="med-h">
        <h2 id="med-h">I took a medication</h2>
        <p class="hint">Takes 20 seconds. Time is now, mission clock.</p>
        <div class="field"><label for="med">Which one</label><select id="med" name="med"><option value="">Choose…</option>${MEDS.map((m) => html`<option>${m}</option>`)}</select></div>
        <div class="field"><label for="med-other">If other, its name</label><input id="med-other" name="other" maxlength="60"></div>
        <div class="field"><label for="med-dose">Dose (optional)</label><input id="med-dose" name="dose" maxlength="30" placeholder="e.g. 1 mg"></div>
        <div class="field"><label for="med-reason">Why (optional)</label><input id="med-reason" name="reason" maxlength="80" placeholder="e.g. headache, trouble sleeping"></div>
        <p class="error" id="med-err" hidden>${icon('review')}Choose the medication, or write its name.</p>
        <button class="btn btn-primary" type="submit">${icon('ok')}Save</button>
      </form>
      <section class="card" aria-labelledby="medl-h">
        <h2 id="medl-h">Recently taken</h2>
        ${medList(list, 'Nothing logged yet.')}
      </section>
    </div>
    ${medicalCard(me(), true)}`;
}
