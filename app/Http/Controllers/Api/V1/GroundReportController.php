<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreGroundReportRequest;
use App\Http\Requests\StoreReceivedReportRequest;
use App\Services\Reports\GroundReportReceiver;
use App\Services\Reports\ReceiveOutcome;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class GroundReportController extends Controller
{
    /**
     * Receive a report on the ground (idempotent).
     *
     * Two body formats reach the same MongoDB receiver: the web app sends `{content}` (its frozen snapshot as a
     * canonical JSON string) and gets a flat receipt; the HEXTA API delivery queue sends the structured report and gets
     * `{status, replayed, receipt}`. `reportId` must match the path in both cases.
     *
     * Returns 201 with a receipt on first reception, 200 with `replayed: true` when the same report is sent again,
     * 409 when a different report already holds this `reportId`, 503 when the receiver storage is unavailable (keep
     * the report queued and retry).
     */
    public function update(Request $request, string $reportId, GroundReportReceiver $receiver): JsonResponse
    {
        if ($request->has('content')) {
            $content = (string) app(StoreReceivedReportRequest::class)->validated('content');
            $outcome = $receiver->receiveSnapshot($reportId, $content);

            if ($outcome->kind === ReceiveOutcome::Conflict) {
                return response()->json(['message' => 'A different snapshot was already received under this report ID.', 'reportId' => $reportId], 409);
            }

            return response()->json([...$outcome->receipt, 'replayed' => $outcome->kind === ReceiveOutcome::Replayed], $outcome->httpStatus());
        }

        $outcome = $receiver->receive($reportId, app(StoreGroundReportRequest::class)->validated());

        if ($outcome->kind === ReceiveOutcome::Conflict) {
            return response()->json([
                'message' => 'A different report was already received with this reportId.',
                'reportId' => $reportId,
                'storedSha256' => $outcome->receipt['sha256'],
                'submittedSha256' => $outcome->submittedSha256,
            ], $outcome->httpStatus());
        }

        return response()->json([
            'status' => 'received',
            'replayed' => $outcome->kind === ReceiveOutcome::Replayed,
            'receipt' => $outcome->receipt,
        ], $outcome->httpStatus());
    }

    /**
     * Read a receipt again.
     *
     * Lets the board confirm a report was received after the acknowledgement was lost. 404 when nothing was received
     * with this `reportId`.
     */
    public function receipt(string $reportId, GroundReportReceiver $receiver): JsonResponse
    {
        $receipt = $receiver->receiptFor($reportId);

        abort_if($receipt === null, 404, 'No report received with this reportId.');

        return response()->json(['status' => 'received', 'receipt' => $receipt]);
    }
}
