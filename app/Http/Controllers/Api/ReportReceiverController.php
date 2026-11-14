<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreReceivedReportRequest;
use App\Models\ReceivedReport;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Laravel test receiver: a destination distinct from the simulated ground receiver.
 * PUT is idempotent per report UUID. Same UUID + same content returns the original receipt,
 * same UUID + different content returns 409.
 */
class ReportReceiverController extends Controller
{
    public function update(StoreReceivedReportRequest $request, string $reportId): JsonResponse
    {
        $content = (string) $request->validated('content');
        $hash = hash('sha256', $content);

        return DB::transaction(function () use ($reportId, $content, $hash): JsonResponse {
            $existing = ReceivedReport::query()->lockForUpdate()->find($reportId);

            if ($existing !== null) {
                if (! hash_equals($existing->content_sha256, $hash)) {
                    return response()->json([
                        'message' => 'A different snapshot was already received under this report ID.',
                        'reportId' => $reportId,
                    ], 409);
                }

                return response()->json($this->receipt($existing, replayed: true));
            }

            $report = ReceivedReport::query()->create([
                'report_id' => $reportId,
                'content_sha256' => $hash,
                'content' => $content,
                'receipt_id' => (string) Str::uuid(),
                'received_at' => now('UTC'),
            ]);

            return response()->json($this->receipt($report, replayed: false), 201);
        });
    }

    /**
     * @return array{reportId: string, receiptId: string, receiver: string, receivedAt: string, sha256: string, replayed: bool}
     */
    private function receipt(ReceivedReport $report, bool $replayed): array
    {
        return [
            'reportId' => $report->report_id,
            'receiptId' => $report->receipt_id,
            'receiver' => 'Laravel test receiver',
            'receivedAt' => $report->received_at->utc()->toIso8601ZuluString(),
            'sha256' => $report->content_sha256,
            'replayed' => $replayed,
        ];
    }
}
