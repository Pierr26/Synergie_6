<?php

namespace App\Services\Demo;

use App\Services\Observations\ObservationRecorder;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use MongoDB\BSON\UTCDateTime;
use MongoDB\Collection;

/**
 * Versioned guided scenario (cahier des charges p.2 et p.18).
 *
 * Builds the two isolated workspaces: "demo" (Start demo, controlled clock,
 * SLEEP-001 demo rule, Moreau/Sato fictional records) and "explore"
 * (Explore app, real clock, no mission rule configured). Resetting only
 * touches documents whose workspaceId is "demo".
 */
final class DemoScenario
{
    public const string Version = '2026-11-14.1';

    public const string MissionId = 'QN-LO-03';

    /** Explore app mission, aligned with the web app (resources/js/demo/config.ts). */
    public const string ExploreMissionId = 'QN-EX-01';

    /** Explore mission day 0 at 00:00 UTC (the web app counts 2026-09-01 as day 1). */
    public const string ExploreEpoch = '2026-08-31T00:00:00Z';

    /** Mission day 0 at 00:00 UTC: J138 falls on Wednesday 4 November 2026. */
    public const string MissionEpoch = '2026-06-19T00:00:00Z';

    /** Guided scenario starts at J142 06:59 UTC. */
    public const int StartDay = 142;

    public const string StartTime = '06:59';

    /** @var list<string> */
    public const array BoardCollections = [
        'crew_members', 'observations', 'checkins', 'tasks', 'notifications',
        'follow_ups', 'alerts', 'lab_results', 'report_snapshots',
    ];

    /** @var array<int, int> */
    public const array BaselineSleep = [
        122 => 440, 123 => 430, 124 => 445, 125 => 435, 126 => 438, 127 => 442, 128 => 436,
        129 => 439, 130 => 443, 131 => 431, 132 => 441, 133 => 437, 134 => 434, 135 => 446,
    ];

    /**
     * J136-J141. J142 (312 min) is entered live during the demo.
     *
     * @var array<int, array{sleep: int, sleepiness: int, mood: int, restingHr: int}>
     */
    public const array GuidedDays = [
        136 => ['sleep' => 450, 'sleepiness' => 3, 'mood' => 4, 'restingHr' => 58],
        137 => ['sleep' => 432, 'sleepiness' => 4, 'mood' => 4, 'restingHr' => 59],
        138 => ['sleep' => 384, 'sleepiness' => 4, 'mood' => 4, 'restingHr' => 61],
        139 => ['sleep' => 366, 'sleepiness' => 5, 'mood' => 3, 'restingHr' => 62],
        140 => ['sleep' => 336, 'sleepiness' => 6, 'mood' => 3, 'restingHr' => 64],
        141 => ['sleep' => 324, 'sleepiness' => 7, 'mood' => 3, 'restingHr' => 66],
    ];

    /**
     * @var list<array{crewId: string, alias: string, role: string, position: string}>
     */
    public const array Crew = [
        ['crewId' => 'moreau', 'alias' => 'Cdr K. Moreau', 'role' => 'astronaut', 'position' => 'Commander'],
        ['crewId' => 'sato', 'alias' => 'FE H. Sato', 'role' => 'astronaut', 'position' => 'Flight engineer'],
        ['crewId' => 'haddad', 'alias' => 'Dr A. Haddad', 'role' => 'cmo', 'position' => 'Crew medical officer'],
        ['crewId' => 'brennan', 'alias' => 'Dr J. Brennan', 'role' => 'ground', 'position' => 'Flight surgeon · Houston'],
    ];

    /**
     * Explore app crew, same identifiers as the web app.
     *
     * @var list<array{crewId: string, alias: string, role: string, position: string}>
     */
    public const array ExploreCrew = [
        ['crewId' => 'okafor', 'alias' => 'I. Okafor', 'role' => 'astronaut', 'position' => 'Mission specialist'],
        ['crewId' => 'lindqvist', 'alias' => 'M. Lindqvist', 'role' => 'astronaut', 'position' => 'Flight engineer'],
        ['crewId' => 'ibarra', 'alias' => 'Dr R. Ibarra', 'role' => 'cmo', 'position' => 'Crew medical officer'],
        ['crewId' => 'nakamura', 'alias' => 'Dr S. Nakamura', 'role' => 'ground', 'position' => 'Flight surgeon · Houston'],
    ];

    public static function epoch(): CarbonImmutable
    {
        return CarbonImmutable::parse(self::MissionEpoch, 'UTC');
    }

    public static function dayStart(int $missionDay): CarbonImmutable
    {
        return self::epoch()->addDays($missionDay);
    }

    /**
     * Rebuilds both workspaces. Explore data is kept unless $resetExplore.
     */
    public function install(bool $resetExplore = false): void
    {
        $this->resetDemo();

        if ($resetExplore || $this->collection('workspaces')->countDocuments(['_id' => 'explore']) === 0) {
            $this->purge('explore');
            $this->seedWorkspace('explore');
        }
    }

    /**
     * Start demo reset: only the "demo" workspace is touched (M13, V06).
     *
     * The web app offers two starting points, day 138 (nominal) and day 142 (alert). Records dated on or after the
     * chosen day are left out, so the server never holds data from the future of the controlled clock.
     */
    public function resetDemo(int $scenarioDay = self::StartDay): void
    {
        $this->purge('demo');
        $this->seedWorkspace('demo', $scenarioDay);
        $this->seedDemoRecords($scenarioDay);
    }

    private function purge(string $workspaceId): void
    {
        foreach (self::BoardCollections as $collection) {
            $this->collection($collection)->deleteMany(['workspaceId' => $workspaceId]);
        }

        $this->collection('workspaces')->deleteOne(['_id' => $workspaceId]);
    }

    private function seedWorkspace(string $workspaceId, int $scenarioDay = self::StartDay): void
    {
        $isDemo = $workspaceId === 'demo';
        $missionId = $isDemo ? self::MissionId : self::ExploreMissionId;
        $epoch = $isDemo ? self::epoch() : CarbonImmutable::parse(self::ExploreEpoch, 'UTC');

        $this->collection('workspaces')->insertOne([
            '_id' => $workspaceId,
            'mode' => $workspaceId,
            'label' => $isDemo ? 'Start demo' : 'Explore app',
            'missionId' => $missionId,
            'missionEpoch' => new UTCDateTime($epoch),
            'dayBoundaryUtc' => '00:00',
            'timezone' => 'UTC',
            'clock' => $isDemo
                ? ['type' => 'controlled', 'current' => new UTCDateTime(self::dayStart($scenarioDay)->setTimeFromTimeString(self::StartTime))]
                : ['type' => 'real'],
            'policy' => [
                'sleepRule' => $isDemo ? ['id' => 'SLEEP-001', 'version' => 1, 'label' => 'Demo rule'] : null,
                'sleepRuleMessage' => $isDemo ? null : 'No mission rule configured',
                'baselineWindow' => $isDemo ? ['fromDay' => 122, 'toDay' => 135] : null,
                'labIntervals' => $isDemo ? [
                    'hemoglobin' => ['low' => 140, 'high' => 170, 'unit' => 'g/L', 'source' => 'Synthetic test interval', 'cmoConfirmed' => true],
                    'hematocrit' => ['low' => 40, 'high' => 50, 'unit' => '%', 'source' => 'Synthetic test interval', 'cmoConfirmed' => true],
                ] : [],
            ],
            'groundLink' => ['state' => $isDemo ? 'offline' : 'online', 'receiver' => 'simulated'],
            'dataLabel' => 'Simulated crew data',
            'scenarioVersion' => self::Version,
            'createdAt' => new UTCDateTime(now('UTC')),
        ]);

        $this->collection('crew_members')->insertMany(array_map(fn (array $member): array => [
            ...$member,
            'workspaceId' => $workspaceId,
            'missionId' => $missionId,
            'reminder' => ['enabled' => $member['role'] === 'astronaut', 'time' => config('hexta.reminder.default_time')],
            'simulated' => true,
        ], $isDemo ? self::Crew : self::ExploreCrew));
    }

    private function seedDemoRecords(int $scenarioDay = self::StartDay): void
    {
        $observations = [];

        foreach (self::BaselineSleep as $day => $minutes) {
            $observations[] = $this->sleepObservation('moreau', $day, $minutes);
        }

        foreach (self::GuidedDays as $day => $values) {
            $observations[] = $this->sleepObservation('moreau', $day, $values['sleep']);
            $observations[] = $this->observation('moreau', $day, 'sleepiness', $values['sleepiness'], 'score_1_9', 'hexta_sleepiness_scale', '07:02');
            $observations[] = $this->observation('moreau', $day, 'mood', $values['mood'], 'score_1_5', 'self_report', '07:02');
            $observations[] = $this->observation('moreau', $day, 'resting_heart_rate', $values['restingHr'], 'bpm', 'manual_pulse', '07:03', ['atRest' => true]);
        }

        foreach ([136 => 432, 137 => 445, 138 => 418, 139 => 440, 140 => 426, 141 => 437] as $day => $minutes) {
            $observations[] = $this->sleepObservation('sato', $day, $minutes);
        }

        array_push($observations, ...$this->spotMeasurements());
        array_push($observations, ...$this->thresholdTestReadings());
        array_push($observations, ...$this->environmentalReadings());
        array_push($observations, ...$this->pvtReadings());

        $beforeScenario = fn (array $record): bool => ($record['missionDay'] ?? 0) < $scenarioDay;
        $scenarioStart = new UTCDateTime(self::dayStart($scenarioDay));

        $this->collection('observations')->insertMany(array_values(array_filter($observations, $beforeScenario)));

        $labs = array_values(array_filter($this->labResults(), fn (array $lab): bool => $lab['collectedAt']->toDateTime() < $scenarioStart->toDateTime()));

        if ($labs !== []) {
            $this->collection('lab_results')->insertMany($labs);
        }

        $checkins = array_map(fn (int $day): array => $this->checkin('moreau', $day), array_keys(self::GuidedDays));

        $this->collection('checkins')->insertMany(array_values(array_filter($checkins, $beforeScenario)));
    }

    /**
     * Fictional acceptance set (cahier des charges p.9).
     *
     * @return list<array<string, mixed>>
     */
    private function spotMeasurements(): array
    {
        return [
            $this->observation('moreau', 141, 'blood_pressure', ['systolic' => 118, 'diastolic' => 76], 'mmHg', 'cuff_oscillometric', '07:10', ['atRest' => true, 'posture' => 'seated']),
            $this->observation('moreau', 141, 'spo2', 97, '%', 'pulse_oximeter', '07:11', ['signalQuality' => 'good', 'supplementalOxygen' => false]),
            $this->observation('moreau', 141, 'temperature', 36.7, 'Cel', 'digital_thermometer', '07:12', ['site' => 'oral']),
            $this->observation('moreau', 141, 'temperature', 34.1, 'Cel', 'skin_sensor', '07:12', ['site' => 'skin']),
            $this->observation('moreau', 141, 'glucose', 92, 'mg/dL', 'glucometer', '07:15', ['specimen' => 'capillary', 'context' => 'fasting']),
            $this->observation('moreau', 141, 'glucose', 95, 'mg/dL', 'laboratory', '07:40', ['specimen' => 'plasma', 'context' => 'fasting']),
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function labResults(): array
    {
        return [
            $this->labResult('moreau', 'hemoglobin', 152, 'g/L', 140),
            $this->labResult('moreau', 'hematocrit', 45, '%', 140),
            $this->labResult('sato', 'hemoglobin', 13.9, 'g/dL', 140),
            $this->labResult('sato', 'hematocrit', 0.42, 'L/L', 140),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function sleepObservation(string $crewId, int $wakeDay, int $minutes): array
    {
        return $this->observation($crewId, $wakeDay, 'sleep_duration', $minutes, 'min', 'sleep_diary', '07:01', ['episode' => 'main', 'wakeDay' => $wakeDay]);
    }

    /**
     * @param  int|float|array<string, int|float>  $value
     * @param  array<string, mixed>  $context
     * @return array<string, mixed>
     */
    private function observation(string $crewId, int $day, string $variable, int|float|array $value, string $unit, string $method, string $time, array $context = []): array
    {
        $lineageId = "demo-{$crewId}-{$variable}-".($context['site'] ?? $context['specimen'] ?? $context['sensorId'] ?? 'main')."-J{$day}";
        $observedAt = new UTCDateTime(self::dayStart($day)->setTimeFromTimeString($time));

        return [
            '_id' => "{$lineageId}-v1",
            'workspaceId' => 'demo',
            'missionId' => self::MissionId,
            'subjectId' => $crewId,
            'variable' => $variable,
            'value' => $value,
            'unit' => $unit,
            'method' => $method,
            'context' => $context,
            'quality' => 'valid',
            'qualityFlags' => [],
            'seriesKey' => ObservationRecorder::seriesKey($variable, $method, $unit, $context),
            'author' => ['crewId' => $crewId, 'role' => 'astronaut'],
            'source' => 'simulated_crew_data',
            'missionDay' => $day,
            'observedAt' => $observedAt,
            'recordedAt' => $observedAt,
            'lineageId' => $lineageId,
            'version' => 1,
            'status' => 'current',
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function labResult(string $crewId, string $analyte, float|int $value, string $unit, int $collectedDay): array
    {
        $lineageId = "demo-{$crewId}-{$analyte}-J{$collectedDay}";
        $collectedAt = self::dayStart($collectedDay)->setTimeFromTimeString('06:30');

        return [
            '_id' => "{$lineageId}-v1",
            'workspaceId' => 'demo',
            'missionId' => self::MissionId,
            'subjectId' => $crewId,
            'analyte' => $analyte,
            'loinc' => $analyte === 'hemoglobin' ? '718-7' : '4544-3',
            'value' => $value,
            'unit' => $unit,
            'specimen' => 'venous_blood',
            'method' => 'point_of_care_analyzer',
            'laboratory' => 'Onboard analyzer (simulated)',
            'collectedAt' => new UTCDateTime($collectedAt),
            'analyzedAt' => new UTCDateTime($collectedAt->addMinutes(25)),
            'issuedAt' => new UTCDateTime($collectedAt->addMinutes(40)),
            'status' => 'final',
            'verified' => true,
            'labFlag' => null,
            'enteredBy' => ['crewId' => 'haddad', 'role' => 'cmo'],
            'source' => 'simulated_crew_data',
            'lineageId' => $lineageId,
            'version' => 1,
            'current' => true,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    /**
     * Readings that exceed thresholds from health_indicators.json (for alert testing).
     *
     * @return list<array<string, mixed>>
     */
    private function thresholdTestReadings(): array
    {
        return [
            // Glucose CRITICAL (≥180 mg/dL) on J140 - should trigger urgent alert
            $this->observation('moreau', 140, 'glucose', 195, 'mg/dL', 'glucometer', '06:30', ['specimen' => 'capillary', 'context' => 'fasting']),

            // Blood pressure WATCH_HIGH (≥140 mmHg systolic) on J139
            $this->observation('moreau', 139, 'blood_pressure', ['systolic' => 148, 'diastolic' => 88], 'mmHg', 'cuff_oscillometric', '07:00', ['atRest' => true, 'posture' => 'seated']),

            // Body temperature CRITICAL_HIGH (≥39.0°C) on J138 - fever
            $this->observation('sato', 138, 'temperature', 39.2, 'Cel', 'digital_thermometer', '18:00', ['site' => 'oral']),

            // Heart rate CRITICAL_HIGH (≥130 bpm) on J141
            $this->observation('sato', 141, 'heart_rate', 135, 'bpm', 'pulse_oximeter', '15:30', ['atRest' => false]),
        ];
    }

    /**
     * Environmental readings (p.15): radiation dose rate, cabin CO₂, cabin temperature, respiratory rate.
     *
     * @return list<array<string, mixed>>
     */
    private function environmentalReadings(): array
    {
        $readings = [];

        // Radiation dose rate history (SHOULD priority p.15): module-level readings in µGy/h
        foreach ([136 => 0.42, 137 => 0.38, 138 => 0.44, 139 => 0.41, 140 => 0.39, 141 => 0.43] as $day => $rate) {
            $readings[] = $this->observation('moreau', $day, 'radiation_dose_rate', $rate, 'uGy/h', 'dosimeter_reading', '12:00', [
                'sensorId' => 'RAD-MODULE-A',
                'source' => 'Gateway Module A',
                'assignment' => 'module',
                'windowStart' => self::dayStart($day)->setTimeFromTimeString('00:00')->toIso8601String(),
                'windowEnd' => self::dayStart($day)->setTimeFromTimeString('23:59')->toIso8601String(),
            ]);
        }

        // Cabin CO₂: one with ppm + pressure (convertible), one with ppm only
        $readings[] = $this->observation('moreau', 141, 'cabin_co2', 520, 'ppm', 'co2_sensor', '14:00', [
            'sensorId' => 'CO2-SENSOR-01',
            'assignment' => 'module_a',
            'absolutePressure' => 760.0,
            'windowStart' => self::dayStart(141)->setTimeFromTimeString('13:00')->toIso8601String(),
            'windowEnd' => self::dayStart(141)->setTimeFromTimeString('14:00')->toIso8601String(),
        ]);

        $readings[] = $this->observation('moreau', 141, 'cabin_co2', 485, 'ppm', 'co2_sensor', '15:00', [
            'sensorId' => 'CO2-SENSOR-02',
            'assignment' => 'module_b',
            'windowStart' => self::dayStart(141)->setTimeFromTimeString('14:00')->toIso8601String(),
            'windowEnd' => self::dayStart(141)->setTimeFromTimeString('15:00')->toIso8601String(),
            'note' => 'Absolute pressure not available - comparison unavailable',
        ]);

        // Cabin temperature
        $readings[] = $this->observation('moreau', 141, 'cabin_temperature', 21.5, 'Cel', 'temperature_sensor', '14:00', [
            'sensorId' => 'TEMP-SENSOR-01',
            'assignment' => 'module_a',
        ]);

        // Respiratory rate (SHOULD)
        $readings[] = $this->observation('moreau', 141, 'respiratory_rate', 16, '/min', 'manual_count', '07:13', ['atRest' => true]);

        return $readings;
    }

    /**
     * PVT readings (p.14-15): simulated data with protocol and testDuration.
     *
     * @return list<array<string, mixed>>
     */
    private function pvtReadings(): array
    {
        return [
            $this->observation('moreau', 139, 'pvt_reaction_time', 285, 'ms', 'pvt_protocol_v1', '08:00', [
                'protocol' => 'PVT-192-10min',
                'testDuration' => 600000,
                'device' => 'Simulated PVT device',
                'simulated' => true,
            ]),
            $this->observation('moreau', 140, 'pvt_reaction_time', 298, 'ms', 'pvt_protocol_v1', '08:00', [
                'protocol' => 'PVT-192-10min',
                'testDuration' => 600000,
                'device' => 'Simulated PVT device',
                'simulated' => true,
            ]),
            $this->observation('moreau', 141, 'pvt_reaction_time', 312, 'ms', 'pvt_protocol_v1', '08:00', [
                'protocol' => 'PVT-192-10min',
                'testDuration' => 600000,
                'device' => 'Simulated PVT device',
                'simulated' => true,
            ]),
        ];
    }

    private function checkin(string $crewId, int $day): array
    {
        $prefix = "demo-{$crewId}";

        return [
            '_id' => "{$prefix}-checkin-J{$day}",
            'workspaceId' => 'demo',
            'missionId' => self::MissionId,
            'subjectId' => $crewId,
            'missionDay' => $day,
            'status' => 'submitted',
            'observationIds' => [
                "{$prefix}-sleep_duration-main-J{$day}-v1",
                "{$prefix}-sleepiness-main-J{$day}-v1",
                "{$prefix}-mood-main-J{$day}-v1",
                "{$prefix}-resting_heart_rate-main-J{$day}-v1",
            ],
            'unavailableFields' => [],
            'symptoms' => ['answer' => 'no', 'comment' => null],
            'submittedAt' => new UTCDateTime(self::dayStart($day)->setTimeFromTimeString('07:04')),
        ];
    }

    private function collection(string $name): Collection
    {
        return DB::connection('mongodb')->getCollection($name);
    }
}
