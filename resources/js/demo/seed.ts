import { db, uuid, type CheckinRecord } from '../data/db';
import { DEFAULT_REMINDER, newTask } from '../domain/reminder';
import type { LabResult } from '../domain/labs';
import { SLEEP_RULE } from '../domain/sleep';
import { MINUTE_MS, dayStart, missionDay, timeOnDay } from '../domain/time';
import type { Observation, WorkspaceId } from '../domain/types';
import { DEMO_DATASET, MEMBERS, WORKSPACES, type Scenario } from './config';

type Src = Observation['source'];

function obs(ws: WorkspaceId, crewId: string, day: number, p: Partial<Observation> & Pick<Observation, 'variable' | 'value' | 'unit' | 'method'>, source: Src, minute = 6 * 60 + 40): Observation {
    const cfg = WORKSPACES[ws];
    const at = new Date(dayStart(day, cfg.epoch) + minute * MINUTE_MS).toISOString();
    return {
        id: uuid(),
        ws,
        missionId: cfg.missionId,
        crewId,
        missionDay: day,
        context: {},
        quality: 'valid',
        author: crewId,
        source,
        measuredAt: at,
        recordedAt: at,
        version: 1,
        supersededBy: null,
        ...p,
    };
}

function dailyCheckin(ws: WorkspaceId, crewId: string, day: number, v: { sleep: number; drowsiness: number; mood: number; hr: number }, source: Src): { rows: Observation[]; record: CheckinRecord } {
    const rows = [
        obs(ws, crewId, day, { variable: 'sleep_main', value: v.sleep, unit: 'min', method: SLEEP_RULE.method, context: { episode: 'main sleep ending this mission day', wakeDay: String(day) } }, source),
        obs(ws, crewId, day, { variable: 'drowsiness', value: v.drowsiness, unit: 'score 1–9', method: 'QUINTA drowsiness scale (KSS-inspired)' }, source),
        obs(ws, crewId, day, { variable: 'mood', value: v.mood, unit: 'score 1–5', method: 'self-report' }, source),
        obs(ws, crewId, day, { variable: 'resting_hr', value: v.hr, unit: 'bpm', method: 'Manual pulse count', context: { rest: 'yes' } }, source),
    ];
    const cfg = WORKSPACES[ws];
    const at = rows[0].recordedAt;
    return {
        rows,
        record: {
            id: uuid(),
            ws,
            missionId: cfg.missionId,
            crewId,
            missionDay: day,
            status: 'submitted',
            form: formFor(v),
            observationIds: rows.map((r) => r.id),
            unavailable: [],
            savedAt: at,
            submittedAt: at,
        },
    };
}

function formFor(v: { sleep: number; drowsiness: number; mood: number; hr: number }) {
    return {
        sleepHours: String(Math.floor(v.sleep / 60)),
        sleepMinutes: String(v.sleep % 60),
        sleepNotRecorded: false,
        sleepConfirmZero: false,
        drowsiness: v.drowsiness,
        drowsinessNotRecorded: false,
        mood: v.mood,
        symptoms: 'no' as const,
        symptomsComment: '',
        hr: String(v.hr),
        hrRest: 'yes' as const,
        hrMethod: 'Manual pulse count',
    };
}

function lab(ws: WorkspaceId, crewId: string, p: Partial<LabResult> & Pick<LabResult, 'analyte' | 'value' | 'unit'>): LabResult {
    const cfg = WORKSPACES[ws];
    return {
        id: uuid(),
        ws,
        missionId: cfg.missionId,
        crewId,
        loinc: p.analyte === 'Hb' ? '718-7' : '4544-3',
        specimen: 'Venous whole blood',
        method: 'Automated haematology analyser (simulated)',
        lab: 'On-board analyser (simulated)',
        status: 'final',
        collectedAt: null,
        analysedAt: null,
        issuedAt: null,
        interval: null,
        labFlag: null,
        author: cfg.cmoId,
        recordedAt: new Date(dayStart(140, cfg.epoch) + 10 * 60 * MINUTE_MS).toISOString(),
        version: 1,
        supersededBy: null,
        source: 'demo-dataset',
        ...p,
    };
}

/** Seeds one workspace. Never touches the other workspace's rows. */
export async function seedWorkspace(ws: WorkspaceId, scenario: Scenario): Promise<void> {
    const cfg = WORKSPACES[ws];
    await db.transaction('rw', [db.kv, db.members, db.observations, db.checkins, db.tasks, db.labs], async () => {
        await db.members.bulkPut(MEMBERS[ws].map((m) => ({ ...m, ws })));
        for (const m of MEMBERS[ws].filter((x) => x.role === 'astronaut')) await db.kv.put({ ws, key: `reminder:${m.id}`, value: DEFAULT_REMINDER });
        if (ws === 'demo') await seedDemo(scenario);
        else await seedExplore();
        await db.kv.bulkPut([
            { ws, key: 'seeded', value: ws === 'demo' ? DEMO_DATASET.version : 'explore-v1' },
            { ws, key: 'scenario', value: scenario },
            { ws, key: 'groundLink', value: ws !== 'demo' },
            { ws, key: 'loseNextReceipt', value: false },
        ]);
        if (cfg.simulatedClock) await db.kv.put({ ws, key: 'clock', value: timeOnDay(scenario, cfg.epoch, '06:59') });
    });
}

async function seedDemo(scenario: Scenario): Promise<void> {
    const ws: WorkspaceId = 'demo';
    const cfg = WORKSPACES.demo;
    const src: Src = 'demo-dataset';
    const rows: Observation[] = [];
    const records: CheckinRecord[] = [];
    const ref = DEMO_DATASET.reference;
    ref.minutes.forEach((m, i) => rows.push(obs(ws, 'moreau', ref.fromDay + i, { variable: 'sleep_main', value: m, unit: 'min', method: SLEEP_RULE.method, context: { episode: 'main sleep ending this mission day', wakeDay: String(ref.fromDay + i) } }, src)));
    for (let d = 136; d < scenario; d++) {
        const c = dailyCheckin(ws, 'moreau', d, DEMO_DATASET.days[d], src);
        rows.push(...c.rows);
        records.push(c.record);
    }
    // Sato: steady nights, check-in of the scenario day already saved
    DEMO_DATASET.sato.forEach((m, i) => {
        const d = 122 + i;
        if (d > scenario) return;
        if (d >= 136) {
            const c = dailyCheckin(ws, 'sato', d, { sleep: m, drowsiness: 3, mood: 4, hr: 55 + (i % 3) }, src);
            rows.push(...c.rows);
            records.push(c.record);
        } else rows.push(obs(ws, 'sato', d, { variable: 'sleep_main', value: m, unit: 'min', method: SLEEP_RULE.method }, src));
    });
    // Actigraphy is a distinct method and series: never counted by SLEEP-001
    for (let d = 136; d < scenario; d++) rows.push(obs(ws, 'moreau', d, { variable: 'sleep_main', value: DEMO_DATASET.days[d].sleep + 18, unit: 'min', method: 'actigraphy (simulated)', context: { device: 'wrist actigraph (simulated)' } }, 'simulated-sensor', 6 * 60 + 30));

    // Spot measurements (cadrage p.9 test set) + series isolation examples
    const md = scenario - 1;
    rows.push(
        obs(ws, 'moreau', md, { variable: 'bp', value: 118, value2: 76, unit: 'mmHg', method: 'Automatic cuff, left arm', context: { rest: '5 min seated', posture: 'seated (restrained)' } }, src, 12 * 60 + 30),
        obs(ws, 'moreau', md, { variable: 'spo2', value: 97, unit: '%', method: 'Finger pulse oximeter', context: { signal: 'good', supplementalO2: 'no' } }, src, 7 * 60 + 5),
        obs(ws, 'moreau', md, { variable: 'temperature', value: 36.7, unit: '°C', method: 'Digital thermometer', context: { site: 'oral' } }, src, 7 * 60 + 6),
        obs(ws, 'moreau', md, { variable: 'temperature', value: 34.2, unit: '°C', method: 'Skin sensor (simulated)', context: { site: 'skin' } }, 'simulated-sensor', 7 * 60 + 6),
        obs(ws, 'moreau', md, { variable: 'glucose', value: 92, unit: 'mg/dL', method: 'Capillary meter', context: { sample: 'capillary', meal: 'fasting' } }, src, 7 * 60 + 10),
        obs(ws, 'moreau', md - 1, { variable: 'glucose', value: 5.1, unit: 'mmol/L', method: 'Laboratory analyser (simulated)', context: { sample: 'plasma', meal: 'fasting' } }, src, 8 * 60),
        obs(ws, 'sato', md, { variable: 'bp', value: 112, value2: 70, unit: 'mmHg', method: 'Automatic cuff, left arm', context: { rest: '5 min seated', posture: 'seated (restrained)' } }, src, 12 * 60 + 40),
    );
    await db.observations.bulkAdd(rows);
    await db.checkins.bulkAdd(records);

    // Draft of the scenario day (J138: 384 min → no alert; J142: 312 min → completes 336 · 324 · 312)
    const today = DEMO_DATASET.days[scenario];
    await db.checkins.add({
        id: uuid(),
        ws,
        missionId: cfg.missionId,
        crewId: 'moreau',
        missionDay: scenario,
        status: 'draft',
        form: { ...formFor(today), symptoms: '' },
        observationIds: [],
        unavailable: [],
        savedAt: new Date(timeOnDay(scenario, cfg.epoch, '06:41')).toISOString(),
        submittedAt: null,
    });
    // Past tasks: completed history
    const tasks = [];
    for (let d = 136; d < scenario; d++) {
        for (const crew of ['moreau', 'sato']) {
            const t = newTask(ws, cfg.missionId, crew, d, cfg.epoch, DEFAULT_REMINDER);
            t.completedAt = timeOnDay(d, cfg.epoch, '06:40');
            tasks.push(t);
        }
    }
    const satoToday = newTask(ws, cfg.missionId, 'sato', scenario, cfg.epoch, DEFAULT_REMINDER);
    satoToday.completedAt = timeOnDay(scenario, cfg.epoch, '06:40');
    tasks.push(satoToday);
    await db.tasks.bulkAdd(tasks);

    // Lab results (cadrage p.11 synthetic example): Moreau Hb 139 g/L vs 140–170 → Below; Sato within.
    const interval = { low: 140, high: 170, unit: 'g/L', source: 'Synthetic interval for the demo', population: 'Adult crew, venous whole blood (synthetic)', confirmedByCmo: true };
    const coll = (d: number, t: string) => new Date(timeOnDay(d, cfg.epoch, t)).toISOString();
    await db.labs.bulkAdd([
        lab(ws, 'moreau', { analyte: 'Hb', value: 139, unit: 'g/L', collectedAt: coll(140, '07:30'), analysedAt: coll(140, '08:10'), issuedAt: coll(140, '09:00'), interval, labFlag: 'L' }),
        lab(ws, 'moreau', { analyte: 'Hct', value: 0.42, unit: 'L/L', collectedAt: coll(140, '07:30'), analysedAt: coll(140, '08:10'), issuedAt: coll(140, '09:00'), interval: { low: 40, high: 50, unit: '%', source: 'Synthetic interval for the demo', population: 'Adult crew (synthetic)', confirmedByCmo: true } }),
        lab(ws, 'sato', { analyte: 'Hb', value: 15.2, unit: 'g/dL', collectedAt: coll(140, '07:45'), analysedAt: coll(140, '08:20'), issuedAt: coll(140, '09:00'), interval }),
        lab(ws, 'sato', { analyte: 'Hct', value: 45, unit: '%', collectedAt: coll(140, '07:45'), analysedAt: coll(140, '08:20'), issuedAt: coll(140, '09:00'), interval: { low: 40, high: 50, unit: '%', source: 'Synthetic interval for the demo', population: 'Adult crew (synthetic)', confirmedByCmo: true } }),
    ]);
}

/** Explore app: independent fictional crew, example rows labelled as examples, real-time clock. */
async function seedExplore(): Promise<void> {
    const ws: WorkspaceId = 'explore';
    const cfg = WORKSPACES.explore;
    const today = missionDay(Date.now(), cfg.epoch);
    const rows: Observation[] = [];
    const examples = [410, 352, 341, 338];
    examples.forEach((m, i) => {
        const d = today - examples.length + i;
        rows.push(obs(ws, 'okafor', d, { variable: 'sleep_main', value: m, unit: 'min', method: SLEEP_RULE.method }, 'example'));
        rows.push(obs(ws, 'okafor', d, { variable: 'drowsiness', value: 4 + i, unit: 'score 1–9', method: 'QUINTA drowsiness scale (KSS-inspired)' }, 'example'));
    });
    rows.push(obs(ws, 'lindqvist', today - 1, { variable: 'sleep_main', value: 455, unit: 'min', method: SLEEP_RULE.method }, 'example'));
    await db.observations.bulkAdd(rows);
}
