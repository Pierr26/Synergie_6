import type { Member, WorkspaceConfig, WorkspaceId } from '../domain/types';

export const WORKSPACES: Record<WorkspaceId, WorkspaceConfig> = {
    demo: {
        id: 'demo',
        label: 'Guided demo',
        missionId: 'QN-LO-03',
        missionName: 'Lunar orbit expedition',
        epoch: '2026-06-20T00:00:00Z',
        timezone: 'UTC',
        rules: ['SLEEP-001'],
        astronautId: 'moreau',
        cmoId: 'haddad',
        groundId: 'brennan',
        simulatedClock: true,
    },
    explore: {
        id: 'explore',
        label: 'Explore app',
        missionId: 'QN-EX-01',
        missionName: 'Explore crew',
        epoch: '2026-09-01T00:00:00Z',
        timezone: 'UTC',
        rules: [],
        astronautId: 'okafor',
        cmoId: 'ibarra',
        groundId: 'nakamura',
        simulatedClock: false,
    },
};

export const MEMBERS: Record<WorkspaceId, Omit<Member, 'ws'>[]> = {
    demo: [
        { id: 'moreau', alias: 'Cdr K. Moreau', shortName: 'Moreau', initials: 'KM', role: 'astronaut', title: 'Commander' },
        { id: 'sato', alias: 'FE H. Sato', shortName: 'Sato', initials: 'HS', role: 'astronaut', title: 'Flight engineer' },
        { id: 'haddad', alias: 'Dr A. Haddad', shortName: 'Haddad', initials: 'AH', role: 'cmo', title: 'Crew medical officer' },
        { id: 'brennan', alias: 'Dr J. Brennan', shortName: 'Brennan', initials: 'JB', role: 'ground', title: 'Flight surgeon · Houston' },
    ],
    explore: [
        { id: 'okafor', alias: 'I. Okafor', shortName: 'Okafor', initials: 'IO', role: 'astronaut', title: 'Mission specialist' },
        { id: 'lindqvist', alias: 'M. Lindqvist', shortName: 'Lindqvist', initials: 'ML', role: 'astronaut', title: 'Flight engineer' },
        { id: 'ibarra', alias: 'Dr R. Ibarra', shortName: 'Ibarra', initials: 'RI', role: 'cmo', title: 'Crew medical officer' },
        { id: 'nakamura', alias: 'Dr S. Nakamura', shortName: 'Nakamura', initials: 'SN', role: 'ground', title: 'Flight surgeon · Houston' },
    ],
};

/** Versioned guided-scenario dataset (cadrage v5.2 p.18). Simulated crew data. */
export const DEMO_DATASET = {
    version: 'demo-2026.11-v1',
    reference: { fromDay: 122, toDay: 135, minutes: [440, 430, 445, 435, 438, 442, 436, 439, 443, 431, 441, 437, 434, 446] },
    days: {
        136: { sleep: 450, drowsiness: 3, mood: 4, hr: 58 },
        137: { sleep: 432, drowsiness: 4, mood: 4, hr: 59 },
        138: { sleep: 384, drowsiness: 4, mood: 4, hr: 61 },
        139: { sleep: 366, drowsiness: 5, mood: 3, hr: 62 },
        140: { sleep: 336, drowsiness: 6, mood: 3, hr: 64 },
        141: { sleep: 324, drowsiness: 7, mood: 3, hr: 66 },
        142: { sleep: 312, drowsiness: 8, mood: 2, hr: 67 },
    } as Record<number, { sleep: number; drowsiness: number; mood: number; hr: number }>,
    sato: [452, 446, 461, 438, 470, 444, 455, 449, 463, 441, 458, 450, 447, 466, 454, 443, 459, 451, 448, 462, 445],
} as const;

export type Scenario = 138 | 142;
