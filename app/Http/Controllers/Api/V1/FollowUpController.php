<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreFollowUpRequest;
use App\Http\Resources\DocumentResource;
use App\Rules\CrewMemberOf;
use App\Services\FollowUps\FollowUpService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class FollowUpController extends Controller
{
    /**
     * List review and follow-up requests.
     *
     * Filter by `crewId` and by `status` (`open`, `answered`, `closed`).
     */
    public function index(Request $request, string $workspace, FollowUpService $followUps): JsonResponse
    {
        $filters = $request->validate([
            'crewId' => ['nullable', 'string', new CrewMemberOf($workspace)],
            'status' => ['nullable', Rule::in(['open', 'answered', 'closed'])],
        ]);

        return response()->json(['data' => DocumentResource::collection($followUps->list($workspace, $filters))]);
    }

    /**
     * Open a review or follow-up request.
     *
     * `review_request`: an astronaut asks the CMO to look at their own data. `follow_up_request`: the CMO asks an
     * astronaut for a check-in, a measurement or a photo. `evidence` links the observation, analysis, symptom or
     * alert behind the request.
     *
     * Returns 201 when created, 200 when the same `clientRequestId` was already received.
     */
    public function store(StoreFollowUpRequest $request, string $workspace, FollowUpService $followUps): JsonResponse
    {
        $result = $followUps->open($workspace, $request->validated());

        return DocumentResource::make($result['followUp'])->response()->setStatusCode($result['created'] ? 201 : 200);
    }

    /**
     * Read one request with its responses.
     *
     * Returns the request, its status, the evidence behind it and every response received. 404 when the request is
     * not in this workspace.
     */
    public function show(string $workspace, string $followUpId, FollowUpService $followUps): DocumentResource
    {
        return DocumentResource::make($followUps->find($workspace, $followUpId));
    }

    /**
     * Answer a request.
     *
     * Only the addressee can answer, and only while the request is not closed (409 otherwise). The answer can point
     * to a check-in and up to 20 observations.
     */
    public function respond(Request $request, string $workspace, string $followUpId, FollowUpService $followUps): DocumentResource
    {
        $input = $request->validate([
            'responseId' => ['nullable', 'uuid'],
            'responderId' => ['required', 'string', new CrewMemberOf($workspace)],
            'message' => ['required', 'string', 'max:1000'],
            'checkinId' => ['nullable', 'string', 'max:200'],
            'observationIds' => ['nullable', 'array', 'max:20'],
            'observationIds.*' => ['string', 'max:200'],
        ]);

        return DocumentResource::make($followUps->respond($workspace, $followUpId, $input));
    }

    /**
     * Close a request (CMO only).
     *
     * The CMO (`cmoId`) closes the request with an optional note. A closed request accepts no more answers.
     */
    public function close(Request $request, string $workspace, string $followUpId, FollowUpService $followUps): DocumentResource
    {
        $input = $request->validate([
            'cmoId' => ['required', 'string', new CrewMemberOf($workspace, 'cmo')],
            'note' => ['nullable', 'string', 'max:1000'],
        ]);

        return DocumentResource::make($followUps->close($workspace, $followUpId, $input['cmoId'], $input['note'] ?? null));
    }
}
