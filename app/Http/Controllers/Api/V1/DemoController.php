<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\Demo\DemoScenario;
use App\Services\Workspace\WorkspaceClock;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class DemoController extends Controller
{
    /**
     * Reset the Start demo workspace.
     *
     * Deletes and reinstalls the scripted demo data and its controlled clock. Only the `demo` workspace is touched:
     * `explore` data is kept. Send `scenario` (138 or 142, default 142) to start on the nominal day or on the alert
     * day, as the web app does.
     */
    public function reset(Request $request, DemoScenario $scenario, WorkspaceClock $clock): JsonResponse
    {
        $input = $request->validate(['scenario' => ['nullable', 'integer', Rule::in([138, 142])]]);

        $scenario->resetDemo((int) ($input['scenario'] ?? DemoScenario::StartDay));

        return response()->json(['data' => ['scenarioVersion' => DemoScenario::Version, 'clock' => $clock->describe('demo')]]);
    }
}
