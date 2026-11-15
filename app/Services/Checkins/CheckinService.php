<?php

namespace App\Services\Checkins;

use App\Services\Observations\ObservationRecorder;
use App\Services\Reminders\ReminderEngine;
use App\Services\Rules\SleepAlertService;
use App\Services\Workspace\WorkspaceClock;
use Illuminate\Support\Facades\DB;
use MongoDB\BSON\UTCDateTime;
use MongoDB\Collection;

/**
 * Daily check-in (M01, cahier des charges p.8).
 *
 * A draft keeps the reminder open. A submission writes one versioned
 * observation per field — including explicit absences ("Not recorded",
 * kept with quality "missing") — closes the reminder and evaluates the
 * workspace sleep rule. Re-submitting the same day corrects the night by
 * adding observation versions; identical replays change nothing.
 */
final class CheckinService
{
    private const array TypeMap = ['root' => 'array', 'document' => 'array', 'array' => 'array'];

    public function __construct(
        private readonly WorkspaceClock $clock,
        private readonly ObservationRecorder $observations,
        private readonly ReminderEngine $reminders,
        private readonly SleepAlertService $sleepAlerts,
    ) {}

    /**
     * @param  array<string, mixed>  $input  Validated by UpsertCheckinRequest
     * @return array{checkin: array<string, mixed>, observations: list<array<string, mixed>>, alerts: list<array<string, mixed>>}
     */
    public function upsert(string $workspaceId, string $crewId, int $missionDay, array $input): array
    {
        $today = $this->clock->missionDay($workspaceId);

        if ($missionDay > $today) {
            throw new CheckinException("Day {$missionDay} has not started yet (current mission day {$today}).");
        }

        $checkinId = "{$workspaceId}-{$crewId}-checkin-J{$missionDay}";
        $existing = $this->checkins()->findOne(['_id' => $checkinId], ['typeMap' => self::TypeMap]);
        $now = new UTCDateTime($this->clock->now($workspaceId));

        if ($input['status'] === 'draft') {
            if (($existing['status'] ?? null) === 'submitted') {
                throw new CheckinException('This check-in is already submitted. Send a submitted correction instead of a draft.');
            }

            $this->checkins()->updateOne(['_id' => $checkinId], [
                '$set' => [...$this->baseFields($workspaceId, $crewId, $missionDay), 'status' => 'draft', 'draft' => $this->fields($input), 'updatedAt' => $now],
            ], ['upsert' => true]);

            return ['checkin' => $this->find($checkinId), 'observations' => [], 'alerts' => []];
        }

        $author = ['crewId' => $input['submittedBy'], 'role' => 'astronaut'];
        $recorded = [];
        $unavailable = [];

        foreach ($this->readings($input, $missionDay) as $field => $reading) {
            if ($reading['value'] === null) {
                $unavailable[] = $field;
            }

            $lineageId = "{$workspaceId}-{$crewId}-{$reading['variable']}-main-J{$missionDay}";
            $recorded[] = $this->observations->record($workspaceId, $crewId, $lineageId, [
                ...$reading,
                'missionDay' => $missionDay,
                'observedAt' => $input['recordedAt'] ?? null,
            ], $author, 'daily_checkin', 'Check-in resubmitted')['observation'];
        }

        $this->checkins()->updateOne(['_id' => $checkinId], [
            '$set' => [
                ...$this->baseFields($workspaceId, $crewId, $missionDay),
                'status' => 'submitted',
                'observationIds' => array_column($recorded, '_id'),
                'unavailableFields' => $unavailable,
                'symptoms' => $input['symptoms'] ?? ['answer' => 'skip', 'comment' => null],
                'submittedBy' => $input['submittedBy'],
                'submittedAt' => $existing['submittedAt'] ?? $now,
                'updatedAt' => $now,
                'clientCheckinId' => $input['clientCheckinId'] ?? null,
            ],
            '$unset' => ['draft' => ''],
            '$inc' => ['revision' => 1],
        ], ['upsert' => true]);

        $this->reminders->complete($workspaceId, $crewId, $missionDay);

        return [
            'checkin' => $this->find($checkinId),
            'observations' => $recorded,
            'alerts' => $this->sleepAlerts->evaluate($workspaceId, $crewId),
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    public function forDay(string $workspaceId, string $crewId, int $missionDay): ?array
    {
        return $this->checkins()->findOne(['_id' => "{$workspaceId}-{$crewId}-checkin-J{$missionDay}"], ['typeMap' => self::TypeMap]);
    }

    /**
     * Field -> observation. A field marked not recorded gives a null value.
     *
     * @param  array<string, mixed>  $input
     * @return array<string, array{variable: string, value: mixed, unit: ?string, method: string, context: array<string, mixed>, device?: ?string}>
     */
    private function readings(array $input, int $missionDay): array
    {
        $recordedValue = fn (array $field, string $key = 'value'): mixed => ($field['status'] ?? 'recorded') === 'recorded' ? ($field[$key] ?? null) : null;

        $readings = [
            'sleep' => [
                'variable' => 'sleep_duration',
                'value' => $recordedValue($input['sleep'], 'minutes'),
                'unit' => 'min',
                'method' => 'sleep_diary',
                'context' => ['episode' => 'main', 'wakeDay' => $missionDay, 'zeroConfirmed' => (bool) ($input['sleep']['zeroConfirmed'] ?? false)],
            ],
            'sleepiness' => [
                'variable' => 'sleepiness',
                'value' => $recordedValue($input['sleepiness']),
                'unit' => 'score_1_9',
                'method' => 'hexta_sleepiness_scale',
                'context' => [],
            ],
        ];

        if (isset($input['mood'])) {
            $readings['mood'] = ['variable' => 'mood', 'value' => $recordedValue($input['mood']), 'unit' => 'score_1_5', 'method' => 'self_report', 'context' => ['answer' => $input['mood']['status']]];
        }

        foreach ([
            'fatigue' => 'fatigue',
            'stress' => 'stress',
            'perceivedIsolation' => 'perceived_isolation',
            'workload' => 'perceived_workload',
        ] as $field => $variable) {
            if (isset($input[$field])) {
                $readings[$field] = [
                    'variable' => $variable,
                    'value' => $recordedValue($input[$field]),
                    'unit' => 'score_1_5',
                    'method' => 'self_report',
                    'context' => ['answer' => $input[$field]['status']],
                ];
            }
        }

        if (isset($input['symptoms'])) {
            $answer = $input['symptoms']['answer'];
            $readings['symptoms'] = ['variable' => 'symptoms', 'value' => $answer === 'skip' ? null : $answer, 'unit' => null, 'method' => 'self_report', 'context' => ['comment' => $input['symptoms']['comment'] ?? null]];
        }

        if (isset($input['restingHeartRate'])) {
            $heartRate = $input['restingHeartRate'];
            $readings['restingHeartRate'] = [
                'variable' => 'resting_heart_rate',
                'value' => $recordedValue($heartRate),
                'unit' => 'bpm',
                'method' => $heartRate['method'] ?? 'manual_pulse',
                'device' => $heartRate['device'] ?? null,
                'context' => ['atRest' => $heartRate['atRest'] ?? null],
            ];
        }

        return $readings;
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    private function fields(array $input): array
    {
        return array_intersect_key($input, array_flip([
            'sleep', 'sleepiness', 'mood', 'fatigue', 'stress', 'perceivedIsolation', 'workload', 'symptoms', 'restingHeartRate',
        ]));
    }

    /**
     * @return array<string, mixed>
     */
    private function baseFields(string $workspaceId, string $crewId, int $missionDay): array
    {
        return [
            'workspaceId' => $workspaceId,
            'missionId' => $this->clock->missionId($workspaceId),
            'subjectId' => $crewId,
            'missionDay' => $missionDay,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function find(string $checkinId): array
    {
        return $this->checkins()->findOne(['_id' => $checkinId], ['typeMap' => self::TypeMap]);
    }

    private function checkins(): Collection
    {
        return DB::connection('mongodb')->getCollection('checkins');
    }
}
