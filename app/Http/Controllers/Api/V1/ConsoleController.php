<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Rules\CrewMemberOf;
use App\Services\Console\CrewConsole;
use App\Support\MongoJson;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Validator;

class ConsoleController extends Controller
{
    /**
     * List the crew with their motivated states.
     *
     * CMO console home: one row per astronaut with a `state` (`needs_review`, `check` or `no_open_item`) and the
     * `reasons` behind it: alerts to review, open follow-ups, missing check-in, answers not recorded today, lab
     * results to verify.
     */
    public function index(string $workspace, CrewConsole $console): JsonResponse
    {
        return response()->json(['data' => MongoJson::normalize($console->overview($workspace))]);
    }

    /**
     * Open the file of one astronaut.
     *
     * Trends over the last `days` mission days (default 14, between 3 and 60), sleep reference, latest measurements,
     * missing data, lab results, alerts, follow-ups and the 10 latest analyses of `crewId`.
     */
    public function show(string $workspace, string $crewId, CrewConsole $console): JsonResponse
    {
        Validator::make(['crewId' => $crewId], ['crewId' => [new CrewMemberOf($workspace, 'astronaut')]])->validate();
        $days = (int) request()->integer('days', 14);

        return response()->json(['data' => MongoJson::normalize($console->crewFile($workspace, $crewId, max(3, min($days, 60))))]);
    }
}
