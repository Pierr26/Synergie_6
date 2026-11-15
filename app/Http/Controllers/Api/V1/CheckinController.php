<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\UpsertCheckinRequest;
use App\Http\Resources\DocumentResource;
use App\Rules\CrewMemberOf;
use App\Services\Checkins\CheckinService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Validator;

class CheckinController extends Controller
{
    /**
     * Save the daily check-in of a mission day.
     *
     * Creates or replaces the check-in of `missionDay` for an astronaut. `status` is `draft` or `submitted`; sleep
     * and sleepiness are required, the other answers can be `skipped`.
     *
     * Idempotent: the same body can be replayed after an offline period. A submitted check-in also returns the
     * observations it produced and any SLEEP-001 alert it raised.
     */
    public function upsert(UpsertCheckinRequest $request, string $workspace, string $crewId, int $missionDay, CheckinService $checkins): JsonResponse
    {
        $this->assertAstronaut($workspace, $crewId);

        $result = $checkins->upsert($workspace, $crewId, $missionDay, $request->validated());

        return response()->json([
            'data' => DocumentResource::make($result['checkin']),
            'observations' => DocumentResource::collection($result['observations']),
            'alerts' => DocumentResource::collection($result['alerts']),
            'message' => $result['checkin']['status'] === 'submitted' ? 'Saved on this device and synced.' : 'Draft saved.',
        ]);
    }

    /**
     * Read the check-in of a mission day.
     *
     * Returns 404 when the astronaut has no check-in for `missionDay`.
     */
    public function show(string $workspace, string $crewId, int $missionDay, CheckinService $checkins): DocumentResource
    {
        $this->assertAstronaut($workspace, $crewId);
        $checkin = $checkins->forDay($workspace, $crewId, $missionDay);

        abort_if($checkin === null, 404, 'No check-in for this day.');

        return DocumentResource::make($checkin);
    }

    private function assertAstronaut(string $workspace, string $crewId): void
    {
        Validator::make(['crewId' => $crewId], ['crewId' => [new CrewMemberOf($workspace, 'astronaut')]])->validate();
    }
}
