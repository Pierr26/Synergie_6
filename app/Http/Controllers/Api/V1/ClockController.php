<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\AdvanceClockRequest;
use App\Services\Workspace\WorkspaceClock;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;

class ClockController extends Controller
{
    /**
     * Read the workspace clock.
     *
     * Current UTC time, mission day and clock type. `explore` follows the real clock; `demo` uses a controlled clock
     * that only moves through `POST /clock`.
     */
    public function show(string $workspace, WorkspaceClock $clock): JsonResponse
    {
        return response()->json(['data' => $clock->describe($workspace)]);
    }

    /**
     * Move the controlled clock (Start demo only).
     *
     * Send either `minutes` (1 to 10080) to advance the clock, as the "Advance 1 minute" button does, or `at` to set
     * an exact time. The `explore` workspace has a real clock and answers 409.
     */
    public function update(AdvanceClockRequest $request, string $workspace, WorkspaceClock $clock): JsonResponse
    {
        $request->filled('minutes')
            ? $clock->advance($workspace, (int) $request->integer('minutes'))
            : $clock->set($workspace, CarbonImmutable::parse($request->string('at'))->utc());

        return response()->json(['data' => $clock->describe($workspace)]);
    }
}
