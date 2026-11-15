<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Rules\CrewMemberOf;
use App\Services\Exports\CrewExporter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\Rule;

class ExportController extends Controller
{
    /**
     * Export the data of one astronaut.
     *
     * `format=json` (default) returns the full record, `csv` the observations as a table, `matlab-sleep` the nightly
     * sleep series (minutes, method, baseline flag) for MATLAB. `fromDay` and `toDay` limit the mission-day range.
     * The response is sent as a file download.
     */
    public function __invoke(Request $request, string $workspace, string $crewId, CrewExporter $exporter): JsonResponse|Response
    {
        $input = $request->merge(['crewId' => $crewId])->validate([
            'crewId' => [new CrewMemberOf($workspace, 'astronaut')],
            'format' => ['nullable', Rule::in(['json', 'csv', 'matlab-sleep'])],
            'fromDay' => ['nullable', 'integer', 'min:0'],
            'toDay' => ['nullable', 'integer', 'min:0'],
        ]);

        $fromDay = isset($input['fromDay']) ? (int) $input['fromDay'] : null;
        $toDay = isset($input['toDay']) ? (int) $input['toDay'] : null;
        $basename = "hexta-{$workspace}-{$crewId}";

        return match ($input['format'] ?? 'json') {
            'csv' => $this->csv(CrewExporter::toCsv($exporter->csvRows($workspace, $crewId, $fromDay, $toDay)), "{$basename}.csv"),
            'matlab-sleep' => $this->csv(CrewExporter::toCsv($exporter->matlabSleepRows($workspace, $crewId)), "{$basename}-sleep.csv"),
            default => response()->json($exporter->json($workspace, $crewId, $fromDay, $toDay))
                ->header('Content-Disposition', "attachment; filename=\"{$basename}.json\""),
        };
    }

    private function csv(string $content, string $filename): Response
    {
        return response($content, 200, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Content-Disposition' => "attachment; filename=\"{$filename}\"",
        ]);
    }
}
