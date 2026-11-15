<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\DocumentResource;
use App\Rules\CrewMemberOf;
use App\Services\Rules\SleepAlertService;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class AlertController extends Controller
{
    /**
     * Record the CMO review of an alert.
     *
     * The CMO (`cmoId`) answers a SLEEP-001 alert with a note and a decision: `reviewed`, `follow_up_requested` or
     * `monitor`. The alert moves to `reviewed` and is returned.
     */
    public function review(Request $request, string $workspace, string $alertId, SleepAlertService $alerts): DocumentResource
    {
        $input = $request->validate([
            'cmoId' => ['required', 'string', new CrewMemberOf($workspace, 'cmo')],
            'note' => ['required', 'string', 'max:1000'],
            'decision' => ['required', Rule::in(['reviewed', 'follow_up_requested', 'monitor'])],
        ]);

        return DocumentResource::make($alerts->review($workspace, $alertId, $input));
    }
}
