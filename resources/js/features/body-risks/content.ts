/** Shared business IDs for 2D and 3D (same as the GLB nodes `zone-*`). */
export type RegionId = 'brain' | 'eyes' | 'inner-ear' | 'heart' | 'lungs' | 'kidneys' | 'bones' | 'leg-muscles';
export type HazardId = 'radiation' | 'isolation' | 'distance' | 'gravity' | 'environment';

export interface Source {
    id: string;
    title: string;
    org: string;
    url: string;
}

export const SOURCES: Record<string, Source> = {
    S01: { id: 'S01', title: 'Five Hazards of Human Spaceflight', org: 'NASA Human Research Program', url: 'https://www.nasa.gov/hrp/hazards/' },
    S02: { id: 'S02', title: 'Human Spaceflight Risks', org: 'NASA Human Research Program', url: 'https://www.nasa.gov/hrp/risks/' },
    S03: { id: 'S03', title: 'Ongoing HRP Research', org: 'NASA Human Research Program', url: 'https://www.nasa.gov/hrp/ongoing-hrp-research/' },
    S04: { id: 'S04', title: 'Monitoring Radiation for Astronaut Health', org: 'Canadian Space Agency', url: 'https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp' },
    S05: { id: 'S05', title: 'Why Do We Conduct Science Experiments in Space?', org: 'Canadian Space Agency', url: 'https://www.asc-csa.gc.ca/eng/iss/science/why-do-we-conduct-science-experiments-in-space.asp' },
    S11: { id: 'S11', title: 'Standard Measures', org: 'NASA', url: 'https://www.nasa.gov/reference/standard-measures/' },
    S29: { id: 'S29', title: 'Sleep and neurobehavioral performance on the ISS (Jones et al., 2022)', org: 'SLEEP journal', url: 'https://academic.oup.com/sleep/article/45/3/zsac006/6505235' },
    S32: { id: 'S32', title: 'Bio-Monitor', org: 'Canadian Space Agency', url: 'https://www.asc-csa.gc.ca/eng/sciences/bio-monitor.asp' },
    SANS: { id: 'SANS', title: 'Risk of Spaceflight Associated Neuro-ocular Syndrome (SANS)', org: 'NASA', url: 'https://www.nasa.gov/reference/risk-of-spaceflight-associated-neuro-ocular-syndrome-sans/' },
    EX: { id: 'EX', title: 'Astronaut exercise on the ISS', org: 'NASA', url: 'https://www.nasa.gov/missions/station/iss-research/astronaut-exercise/' },
    STD: { id: 'R18', title: 'NASA-STD-3001 Volume 2 Rev F', org: 'NASA', url: 'https://standards.nasa.gov/system/files/tmp/NASA-STD-3001%20Vol%202%20Rev%20F.pdf' },
};

export interface Hazard {
    id: HazardId;
    name: string;
    summary: string;
    link: string;
}

/** NASA HRP five hazards (RIDGE) [S01]. Texts paraphrase the public HRP framing. */
export const HAZARDS: Hazard[] = [
    { id: 'radiation', name: 'Space radiation', summary: 'Outside Earth’s protective magnetic field, crews receive more ionising radiation. Exposure is measured by instruments, not by the crew’s check-in.', link: 'Instrument readings and dosimetry (extension)' },
    { id: 'isolation', name: 'Isolation and confinement', summary: 'Long periods in a small crew, with irregular schedules, affect sleep, mood and vigilance.', link: 'Sleep, drowsiness, mood' },
    { id: 'distance', name: 'Distance from Earth', summary: 'Communication delays and link outages mean the crew must notice, review and act on board.', link: 'On-board review, queued reports' },
    { id: 'gravity', name: 'Gravity fields', summary: 'Microgravity shifts fluids toward the head and unloads bones and muscles; each gravity change disturbs balance.', link: 'Heart rate, blood pressure, exercise' },
    { id: 'environment', name: 'Hostile and closed environments', summary: 'The habitat’s air, noise, temperature and microbes are controlled systems that can drift.', link: 'SpO₂, temperature, symptoms' },
];

export interface Region {
    id: RegionId;
    name: string;
    system: string;
    hazards: HazardId[];
    /** marker position on body-front.webp (percent of the 640×900 frame) */
    x: number;
    y: number;
    why: string;
    measure: { label: string; href: string }[];
    read: string;
    action: string;
    sources: string[];
}

export const REGIONS: Region[] = [
    {
        id: 'brain', name: 'Brain', system: 'Sleep and alertness', hazards: ['isolation'], x: 47, y: 7.5,
        why: 'Irregular schedules, light and workload disturb sleep. Short sleep over several nights is linked to lower vigilance, which matters for operations and extravehicular activity.',
        measure: [{ label: 'Main sleep (diary)', href: '/trends?metric=sleep_main' }, { label: 'Drowsiness now (1–9)', href: '/trends?metric=drowsiness' }, { label: 'Mood (1–5)', href: '/trends?metric=mood' }],
        read: 'Compare nights recorded with the same method. A sleep diary and an actigraph are two different series. In the guided demo, SLEEP-001 v1 flags three consecutive diary nights under 6 h for crew review.',
        action: 'Log your main sleep each morning. If you feel unusually drowsy, ask for a crew review.',
        sources: ['S02', 'S29', 'S11'],
    },
    {
        id: 'eyes', name: 'Eyes', system: 'Vision', hazards: ['gravity'], x: 55, y: 13,
        why: 'Fluid shifting toward the head during long missions is associated with Spaceflight Associated Neuro-ocular Syndrome (SANS), followed with specialised exams.',
        measure: [{ label: 'Symptoms or concern (check-in)', href: '/check-in' }],
        read: 'QUINTA records declared symptoms only. Eye imaging belongs to the specialised SANS follow-up, not to this prototype.',
        action: 'Report new blurred vision as a symptom in the check-in or ask for a crew review.',
        sources: ['SANS', 'S02'],
    },
    {
        id: 'inner-ear', name: 'Inner ear', system: 'Balance', hazards: ['gravity'], x: 41, y: 12.5,
        why: 'Without gravity the inner ear loses its up and down cue. Nausea and disorientation are common after each gravity transition.',
        measure: [{ label: 'Symptoms or concern (check-in)', href: '/check-in' }],
        read: 'A “No” answer is recorded and differs from a skipped question. Symptoms give context to the CMO; they do not trigger an automatic rule.',
        action: 'Declare symptoms after a gravity change; the CMO sees them in your file.',
        sources: ['S01', 'S02'],
    },
    {
        id: 'heart', name: 'Heart', system: 'Cardiovascular', hazards: ['gravity'], x: 55.5, y: 27.5,
        why: 'In microgravity blood shifts toward the upper body and the heart works less against gravity. Crews keep exercising to limit deconditioning before returning to gravity.',
        measure: [{ label: 'Resting heart rate', href: '/trends?metric=resting_hr' }, { label: 'Blood pressure', href: '/trends?metric=bp' }],
        read: 'A resting heart rate needs a confirmed rest context; without it the value stays outside the resting series. Blood pressure pairs where systolic is not above diastolic are kept for verification.',
        action: 'Add a measurement at rest, seated and restrained, and note the device.',
        sources: ['S02', 'EX', 'S32'],
    },
    {
        id: 'lungs', name: 'Lungs', system: 'Respiratory', hazards: ['environment'], x: 42, y: 26.5,
        why: 'In a closed habitat, air quality depends on life-support systems. Carbon dioxide build-up can cause headache and fatigue.',
        measure: [{ label: 'SpO₂', href: '/trends?metric=spo2' }],
        read: 'SpO₂ with insufficient or unknown signal stays visible but out of comparisons that need a verified signal.',
        action: 'Measure SpO₂ at rest with the oximeter and record signal quality.',
        sources: ['S01', 'STD', 'S32'],
    },
    {
        id: 'kidneys', name: 'Kidneys', system: 'Renal', hazards: ['gravity', 'environment'], x: 44, y: 42,
        why: 'Bone loss in microgravity releases calcium that the kidneys must clear, raising the risk of kidney stones during long missions.',
        measure: [{ label: 'Blood glucose (spot measurement)', href: '/trends?metric=glucose' }],
        read: 'Glucose series stay separate by sample (capillary, plasma, interstitial), unit and meal context.',
        action: 'Record the sample type and fasting state with each glucose value.',
        sources: ['S02', 'S11'],
    },
    {
        id: 'bones', name: 'Bones', system: 'Musculoskeletal', hazards: ['gravity'], x: 58, y: 70,
        why: 'Without loading, weight-bearing bones lose density. Bone density is measured before and after flight, not in this app.',
        measure: [{ label: 'Haemoglobin and haematocrit (lab results, CMO)', href: '/crew' }],
        read: 'QUINTA does not estimate bone loss. Lab values are compared only to an applicable, documented interval.',
        action: 'Follow the exercise plan; the CMO enters lab results with their reference interval.',
        sources: ['S02', 'S05', 'EX'],
    },
    {
        id: 'leg-muscles', name: 'Leg muscles', system: 'Musculoskeletal', hazards: ['gravity'], x: 42, y: 59,
        why: 'Leg muscles that carry the body on Earth lose mass and strength in microgravity. Resistive and aerobic exercise counter this.',
        measure: [{ label: 'Resting heart rate', href: '/trends?metric=resting_hr' }],
        read: 'Strength tests are a protocol extension. The card links the risk to exercise, not to a score.',
        action: 'Report pain or unusual weakness as a symptom.',
        sources: ['EX', 'S02'],
    },
];

export function regionById(id: string | null | undefined): Region {
    return REGIONS.find((r) => r.id === id) ?? REGIONS[0];
}
