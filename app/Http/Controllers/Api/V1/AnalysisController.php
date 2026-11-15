<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreAnalysisRequest;
use App\Http\Resources\AnalysisResource;
use App\Rules\CrewMemberOf;
use App\Services\Agent\HealthAnalysisService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Validator;

class AnalysisController extends Controller
{
    /**
     * Run the vision agent on a photo or a webcam pulse signal.
     *
     * `urine_color` and `skin_rash` need the `mediaId` of a photo uploaded with `POST /media` for the same
     * `subjectId`; `webcam_heart_rate` sends `signal.samples` ([timestampMs, r, g, b]) instead of a photo.
     *
     * Returns 201 when the assessment is stored, 202 when the model was unavailable: the analysis is kept as
     * `failed` and can be retried. The result is an AI-assisted estimate for the CMO, never a diagnosis. Rate
     * limited to 10 calls per minute.
     */
    public function store(StoreAnalysisRequest $request, string $workspace, HealthAnalysisService $analyses): JsonResponse
    {
        $analysis = $analyses->start($workspace, $request->validated());

        return AnalysisResource::make($analysis)->response()->setStatusCode($analysis['status'] === 'completed' ? 201 : 202);
    }

    /**
     * Read one analysis.
     *
     * Returns its status, the agent assessment, the escalation level, the guardrails applied, the sources cited and,
     * when one was created, the linked observation and follow-up.
     * Access is restricted to the subject and CMO members of the workspace.
     */
    public function show(string $workspace, string $analysisId, HealthAnalysisService $analyses): AnalysisResource
    {
        $analysis = $analyses->find($workspace, $analysisId);
        $this->authorizeAccess($workspace, $analysis['subjectId']);

        return AnalysisResource::make($analysis);
    }

    /**
     * Re-run a failed analysis.
     *
     * Only analyses in `failed` status can be retried (409 otherwise). Returns 200 when the new run completes, 202
     * when the model is still unavailable. Rate limited to 10 calls per minute.
     * Access is restricted to the subject and CMO members of the workspace.
     */
    public function retry(string $workspace, string $analysisId, HealthAnalysisService $analyses): JsonResponse
    {
        $analysis = $analyses->find($workspace, $analysisId);
        $this->authorizeAccess($workspace, $analysis['subjectId']);

        if ($analysis['status'] !== 'failed') {
            return response()->json(['message' => 'Only failed analyses can be retried.', 'status' => $analysis['status']], 409);
        }

        $analysis = $analyses->run($workspace, $analysisId);

        return AnalysisResource::make($analysis)->response()->setStatusCode($analysis['status'] === 'completed' ? 200 : 202);
    }

    /**
     * List the analyses of one crew member.
     *
     * Every photo and webcam analysis of `crewId`.
     * Access is restricted to the subject and CMO members of the workspace.
     */
    public function forCrewMember(string $workspace, string $crewId, HealthAnalysisService $analyses): AnonymousResourceCollection
    {
        Validator::make(['crewId' => $crewId], ['crewId' => [new CrewMemberOf($workspace)]])->validate();
        $this->authorizeAccess($workspace, $crewId);

        return AnalysisResource::collection($analyses->forSubject($workspace, $crewId));
    }

    /**
     * Ensures the current actor can access analyses for the given subject.
     *
     * Allowed: the subject themselves or CMO members of the workspace.
     */
    private function authorizeAccess(string $workspace, string $subjectId): void
    {
        $actor = request()->attributes->get('hextaActor');

        if ($actor === null) {
            abort(403, 'Authentication required to access this analysis.');
        }

        $actorId = $actor['crewId'] ?? null;
        $actorRole = $actor['role'] ?? null;

        if ($actorId === $subjectId || $actorRole === 'cmo') {
            return;
        }

        abort(403, 'You can only access your own analyses. Medical reviews are restricted to the CMO.');
    }
}
