<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreObservationRequest;
use App\Http\Resources\DocumentResource;
use App\Rules\CrewMemberOf;
use App\Services\Observations\ObservationRecorder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

class ObservationController extends Controller
{
    /**
     * List the observations of a crew member.
     *
     * Current version of each observation, filtered by `variable` and mission-day range. `series` groups the ids by
     * comparable series (same variable and method).
     */
    public function index(Request $request, string $workspace, string $crewId, ObservationRecorder $recorder): JsonResponse
    {
        $this->assertCrew($workspace, $crewId);
        $filters = $request->validate([
            'variable' => ['nullable', 'string', 'max:40'],
            'fromDay' => ['nullable', 'integer', 'min:0'],
            'toDay' => ['nullable', 'integer', 'min:0'],
        ]);

        $observations = DocumentResource::collection($recorder->list($workspace, $crewId, [
            'variable' => $filters['variable'] ?? null,
            'fromDay' => isset($filters['fromDay']) ? (int) $filters['fromDay'] : null,
            'toDay' => isset($filters['toDay']) ? (int) $filters['toDay'] : null,
        ]))->resolve($request);

        $series = [];

        foreach ($observations as $observation) {
            $series[$observation['seriesKey'] ?? $observation['variable'].'|'.$observation['method']][] = $observation['id'];
        }

        return response()->json(['data' => $observations, 'series' => $series]);
    }

    /**
     * Record an on-demand measurement.
     *
     * Blood pressure, SpO2, temperature, heart rate, cabin readings and other variables, each with its allowed
     * units. `observationId` makes the call idempotent: 201 when created, 200 for the same measurement sent again.
     */
    public function store(StoreObservationRequest $request, string $workspace, string $crewId, ObservationRecorder $recorder): JsonResponse
    {
        $this->assertCrew($workspace, $crewId);
        $input = $request->validated();

        $result = $recorder->record($workspace, $crewId, $input['observationId'], $this->reading($input), $this->author($workspace, $input['recordedBy']));

        return DocumentResource::make($result['observation'])->response()->setStatusCode($result['created'] ? 201 : 200);
    }

    /**
     * Correct an observation.
     *
     * Adds a new version with a `reason`; earlier versions stay in the history. 404 when the observation does not
     * exist.
     */
    public function correct(StoreObservationRequest $request, string $workspace, string $crewId, string $lineageId, ObservationRecorder $recorder): JsonResponse
    {
        $this->assertCrew($workspace, $crewId);
        abort_if($recorder->current($workspace, $lineageId) === null, 404, 'Observation not found.');
        $input = $request->validated();

        $result = $recorder->record($workspace, $crewId, $lineageId, $this->reading($input), $this->author($workspace, $input['recordedBy']), 'crew_correction', $input['reason']);

        return DocumentResource::make($result['observation'])->response()->setStatusCode($result['created'] ? 201 : 200);
    }

    /**
     * List every version of an observation.
     *
     * Full correction history of `lineageId` for this crew member. 404 when not found.
     */
    public function history(string $workspace, string $crewId, string $lineageId, ObservationRecorder $recorder): JsonResponse
    {
        $this->assertCrew($workspace, $crewId);
        $versions = array_values(array_filter($recorder->history($workspace, $lineageId), fn (array $version): bool => $version['subjectId'] === $crewId));

        abort_if($versions === [], 404, 'Observation not found.');

        return response()->json(['data' => DocumentResource::collection($versions)]);
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    private function reading(array $input): array
    {
        return [
            'variable' => $input['variable'],
            'value' => $input['value'],
            'unit' => $input['unit'],
            'method' => $input['method'],
            'device' => $input['device'] ?? null,
            'context' => $input['context'] ?? [],
            'observedAt' => $input['observedAt'],
        ];
    }

    /**
     * @return array{crewId: string, role: string}
     */
    private function author(string $workspace, string $crewId): array
    {
        $role = Validator::make(['crewId' => $crewId], ['crewId' => [new CrewMemberOf($workspace, 'cmo')]])->passes() ? 'cmo' : 'astronaut';

        return ['crewId' => $crewId, 'role' => $role];
    }

    private function assertCrew(string $workspace, string $crewId): void
    {
        Validator::make(['crewId' => $crewId], ['crewId' => [new CrewMemberOf($workspace)]])->validate();
    }
}
