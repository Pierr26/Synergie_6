<?php

namespace App\Http\Resources;

use App\Support\MongoJson;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @property-read array<string, mixed> $resource
 */
class AnalysisResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $analysis = MongoJson::normalize($this->resource);

        return [
            'analysisId' => $analysis['_id'],
            'workspaceId' => $analysis['workspaceId'],
            'subjectId' => $analysis['subjectId'],
            'requestedBy' => $analysis['requestedBy'],
            'kind' => $analysis['kind'],
            'status' => $analysis['status'],
            'missionDay' => $analysis['missionDay'] ?? null,
            'input' => $analysis['input'],
            'assessment' => $analysis['assessment'] ?? null,
            'escalation' => $analysis['escalation'] ?? null,
            'guardrails' => $analysis['guardrails'] ?? [],
            'sources' => $analysis['sources'] ?? [],
            'observationId' => $analysis['observationId'] ?? null,
            'followUpId' => $analysis['followUpId'] ?? null,
            'model' => $analysis['model'] ?? null,
            'usage' => $analysis['usage'] ?? null,
            'error' => $analysis['error'] ?? null,
            'attempts' => $analysis['attempts'] ?? 0,
            'disclaimer' => $analysis['disclaimer'],
            'createdAt' => $analysis['createdAt'],
            'completedAt' => $analysis['completedAt'] ?? null,
        ];
    }
}
