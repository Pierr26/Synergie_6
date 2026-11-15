<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\Agent\KnowledgeSearch;
use App\Services\Nasa\NasaCatalog;
use App\Support\MongoJson;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * NASA reference data (M07). Static content: clients may cache it for offline use.
 */
class NasaDataController extends Controller
{
    /**
     * List the five NASA HRP hazards.
     *
     * The five hazards of the NASA Human Research Program and their risks. Cached for 24 hours.
     */
    public function hazards(NasaCatalog $catalog): JsonResponse
    {
        return $this->cached($catalog->hazards());
    }

    /**
     * Read one NASA hazard.
     *
     * The hazard with its indicator cards. 404 for an unknown `hazardId`.
     */
    public function hazard(string $hazardId, NasaCatalog $catalog): JsonResponse
    {
        $hazard = $catalog->hazard($hazardId);
        abort_if($hazard === null, 404, 'Unknown hazard.');

        return $this->cached($hazard);
    }

    /**
     * List the indicator cards.
     *
     * Each card explains why the indicator matters, how it is measured and with which instrument.
     */
    public function indicators(NasaCatalog $catalog): JsonResponse
    {
        return $this->cached($catalog->indicatorCards());
    }

    /**
     * Read one indicator card.
     *
     * The card with its non-normative advice. 404 for an unknown `indicatorId`.
     */
    public function indicator(string $indicatorId, NasaCatalog $catalog): JsonResponse
    {
        $card = $catalog->indicatorCard($indicatorId);
        abort_if($card === null, 404, 'Unknown indicator.');

        return $this->cached($card);
    }

    /**
     * List the analytes available as NASA OSDR series.
     *
     * Optional `category` filter.
     */
    public function osdrIndicators(Request $request, NasaCatalog $catalog): JsonResponse
    {
        $input = $request->validate(['category' => ['nullable', 'string', 'max:60']]);

        return $this->cached($catalog->osdrIndicators($input['category'] ?? null));
    }

    /**
     * Read a NASA OSDR series.
     *
     * Values of `indicator` from launch to return (L-92 to R+194) for the four subjects, or for one `subjectId`
     * (C001 to C004), with unit and source provenance. 404 when no series exists.
     */
    public function osdrSeries(Request $request, NasaCatalog $catalog): JsonResponse
    {
        $input = $request->validate([
            'indicator' => ['required', 'string', 'max:80'],
            'subjectId' => ['nullable', 'string', 'regex:/^C00[1-4]$/'],
        ]);

        $series = $catalog->osdrSeries($input['indicator'], $input['subjectId'] ?? null);
        abort_if($series === null, 404, 'No OSDR series for this indicator.');

        return $this->cached($series);
    }

    /**
     * List the provenance of imported NASA files.
     *
     * Source, licence and SHA-256 of every imported dataset file.
     */
    public function datasets(NasaCatalog $catalog): JsonResponse
    {
        return $this->cached($catalog->datasets());
    }

    /**
     * Search the knowledge base.
     *
     * Full-text search over the NASA knowledge documents used by the vision agent (Atlas Search, or a `$text` index
     * without Atlas). `q` is required, `topic` narrows the search. Returns 8 results at most.
     */
    public function knowledge(Request $request, KnowledgeSearch $search): JsonResponse
    {
        $input = $request->validate([
            'q' => ['required', 'string', 'min:2', 'max:200'],
            'topic' => ['nullable', 'string', 'max:40'],
        ]);

        return response()->json(['data' => $search->search($input['q'], array_filter([$input['topic'] ?? null]), 8)]);
    }

    private function cached(mixed $data): JsonResponse
    {
        return response()->json(['data' => MongoJson::normalize($data)])->header('Cache-Control', 'public, max-age=86400');
    }
}
