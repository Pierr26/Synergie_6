<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\GenerateReportRequest;
use App\Http\Resources\DocumentResource;
use App\Rules\CrewMemberOf;
use App\Services\Reports\GroundDelivery;
use App\Services\Reports\ReportBuilder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

class ReportController extends Controller
{
    /**
     * Generate an individual report.
     *
     * The CMO (`authorId`) freezes a snapshot of one astronaut's data over a mission-day range: observations,
     * absences, lab results, reviews, follow-ups and rules. The report never changes afterwards.
     */
    public function store(GenerateReportRequest $request, string $workspace, ReportBuilder $reports): JsonResponse
    {
        $input = $request->validated();
        $report = $reports->generate(
            $workspace,
            $input['subjectId'],
            $input['authorId'],
            isset($input['fromDay']) ? (int) $input['fromDay'] : null,
            isset($input['toDay']) ? (int) $input['toDay'] : null,
        );

        return DocumentResource::make($report)->response()->setStatusCode(201);
    }

    /**
     * Read one report.
     *
     * Content and delivery state of the report.
     */
    public function show(string $workspace, string $reportId, ReportBuilder $reports): DocumentResource
    {
        return DocumentResource::make($reports->find($workspace, $reportId));
    }

    /**
     * List the reports of one astronaut.
     *
     * Every report generated for `crewId`, with its delivery state.
     */
    public function forCrewMember(string $workspace, string $crewId, ReportBuilder $reports): JsonResponse
    {
        Validator::make(['crewId' => $crewId], ['crewId' => [new CrewMemberOf($workspace, 'astronaut')]])->validate();

        return response()->json(['data' => DocumentResource::collection($reports->forSubject($workspace, $crewId))]);
    }

    /**
     * Queue a report for the ground.
     *
     * "Queue for ground": the report is sent immediately when the ground link is online, otherwise it waits in the
     * queue. `receiver` (`simulated` or `atlas`) overrides the workspace receiver.
     */
    public function queue(Request $request, string $workspace, string $reportId, GroundDelivery $delivery): DocumentResource
    {
        $input = $request->validate(['receiver' => ['nullable', Rule::in(GroundDelivery::Receivers)]]);

        return DocumentResource::make($delivery->queue($workspace, $reportId, $input['receiver'] ?? null));
    }

    /**
     * Retry sending a queued report now.
     *
     * One delivery attempt when the link is online. A report already received is not sent again.
     */
    public function send(string $workspace, string $reportId, GroundDelivery $delivery): DocumentResource
    {
        return DocumentResource::make($delivery->attempt($workspace, $reportId));
    }
}
