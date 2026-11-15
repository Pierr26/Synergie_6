<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\CorrectLabResultRequest;
use App\Http\Requests\StoreLabResultRequest;
use App\Http\Resources\DocumentResource;
use App\Rules\CrewMemberOf;
use App\Services\Lab\LabResultService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

class LabResultController extends Controller
{
    /**
     * List the lab results of one crew member.
     *
     * Current version of each result, with its reference interval and verification state.
     */
    public function index(string $workspace, string $crewId, LabResultService $labs): JsonResponse
    {
        $this->assertCrew($workspace, $crewId);

        return response()->json(['data' => DocumentResource::collection($labs->list($workspace, $crewId))]);
    }

    /**
     * Enter a lab result (CMO).
     *
     * The CMO enters an analyte value with its unit, status and optional reference interval. `resultId` makes the
     * call idempotent: 201 when created, 200 for the same result sent again, 409 when a different result already
     * uses this `resultId` (send a correction instead).
     */
    public function store(StoreLabResultRequest $request, string $workspace, string $crewId, LabResultService $labs): JsonResponse
    {
        $this->assertCrew($workspace, $crewId);
        $result = $labs->create($workspace, $crewId, $request->validated());

        return DocumentResource::make($result['result'])->response()->setStatusCode($result['created'] ? 201 : 200);
    }

    /**
     * Correct a lab result.
     *
     * Adds a new version with the corrected value and a `reason`. The previous version is kept and the new one waits
     * for CMO verification.
     */
    public function correct(CorrectLabResultRequest $request, string $workspace, string $lineageId, LabResultService $labs): JsonResponse
    {
        return DocumentResource::make($labs->correct($workspace, $lineageId, $request->validated()))->response()->setStatusCode(201);
    }

    /**
     * Verify the current version of a lab result (CMO).
     *
     * The CMO (`verifiedBy`) confirms the current version after a correction.
     */
    public function verify(Request $request, string $workspace, string $lineageId, LabResultService $labs): DocumentResource
    {
        $input = $request->validate(['verifiedBy' => ['required', 'string', new CrewMemberOf($workspace, 'cmo')]]);

        return DocumentResource::make($labs->verify($workspace, $lineageId, $input['verifiedBy']));
    }

    /**
     * List every version of a lab result.
     *
     * Full correction history. 404 when the result is not in this workspace.
     */
    public function history(string $workspace, string $lineageId, LabResultService $labs): JsonResponse
    {
        $versions = $labs->history($workspace, $lineageId);

        abort_if($versions === [], 404, 'Lab result not found in this workspace.');

        return response()->json(['data' => DocumentResource::collection($versions)]);
    }

    private function assertCrew(string $workspace, string $crewId): void
    {
        Validator::make(['crewId' => $crewId], ['crewId' => [new CrewMemberOf($workspace)]])->validate();
    }
}
