<?php

namespace App\Services\Agent;

/**
 * Everything the agent needs for one analysis.
 */
final readonly class AgentRequest
{
    /**
     * @param  array{bpm: ?float, snrDb: float, signalQuality: string, durationSeconds: float, sampleRateHz: float, samples: int, issues: list<string>}|null  $heartRate
     */
    public function __construct(
        public AnalysisKind $kind,
        public string $workspaceId,
        public string $subjectId,
        public string $subjectAlias,
        public ?int $missionDay,
        public ?string $imageJpeg = null,
        public ?array $heartRate = null,
        public ?bool $atRest = null,
        public ?string $bodySite = null,
        public ?string $crewNotes = null,
    ) {}
}
