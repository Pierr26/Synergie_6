<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\DocumentResource;
use App\Services\Reports\GroundDelivery;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class GroundLinkController extends Controller
{
    /**
     * Read the simulated ground link.
     *
     * Link state (`online` or `offline`) and the receiver used for reports (`simulated` or `atlas`).
     */
    public function show(string $workspace, GroundDelivery $delivery): JsonResponse
    {
        return response()->json(['data' => $delivery->link($workspace)]);
    }

    /**
     * Switch the simulated ground link and choose the receiver.
     *
     * Going `online` immediately sends every queued or retryable report; the reports sent are returned in `flushed`.
     */
    public function update(Request $request, string $workspace, GroundDelivery $delivery): JsonResponse
    {
        $input = $request->validate([
            'state' => ['required', Rule::in(['online', 'offline'])],
            'receiver' => ['required', Rule::in(GroundDelivery::Receivers)],
        ]);

        $result = $delivery->setLink($workspace, $input['state'], $input['receiver']);

        return response()->json(['data' => $result['link'], 'flushed' => DocumentResource::collection($result['flushed'])]);
    }
}
