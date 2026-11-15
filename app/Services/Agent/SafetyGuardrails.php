<?php

namespace App\Services\Agent;

/**
 * Deterministic server-side rules applied after the model answers.
 *
 * They can only raise the escalation level, never lower it, remove sources
 * the agent did not actually retrieve, and record every change so the CMO
 * sees why the final answer differs from the model output.
 */
final class SafetyGuardrails
{
    private const array LevelOrder = ['none' => 0, 'cmo_review' => 1, 'cmo_urgent' => 2];

    /** Words in crew notes that match the skin red-flag document. */
    private const array SkinRedFlagTerms = [
        'fever', 'blister', 'peeling', 'eye', 'mouth', 'lip', 'genital', 'swelling', 'swollen',
        'spreading', 'spread', 'pus', 'streak', 'purple', 'bleeding', 'intense pain',
    ];

    public const float HeartRateReviewLow = 40.0;

    public const float HeartRateReviewHigh = 120.0;

    /**
     * @param  array<string, mixed>  $assessment
     * @param  list<string>  $retrievedSourceIds
     * @return array{assessment: array<string, mixed>, applied: list<string>}
     */
    public function apply(AgentRequest $request, array $assessment, array $retrievedSourceIds): array
    {
        $applied = [];
        $usable = (bool) ($assessment['imageQuality']['usable'] ?? false) || ! $request->kind->needsPhoto();

        $assessment['recommendations'] = $this->keepRetrievedSources($assessment['recommendations'] ?? [], $retrievedSourceIds, $applied);
        $assessment['recommendations'] = $this->ensureBackedRecommendations($assessment['recommendations'], $request, $usable, $applied);

        if ($request->kind->needsPhoto() && ! $usable) {
            $assessment['urineColor'] = null;
            $assessment['skinFinding'] = null;
        }

        match ($request->kind) {
            AnalysisKind::SkinRash => $this->skinRules($request, $assessment, $usable, $applied),
            AnalysisKind::UrineColor => $this->urineRules($assessment, $applied),
            AnalysisKind::WebcamHeartRate => $this->heartRateRules($request, $assessment, $applied),
        };

        return ['assessment' => $assessment, 'applied' => $applied];
    }

    /**
     * @param  array<string, mixed>  $assessment
     * @param  list<string>  $applied
     */
    private function skinRules(AgentRequest $request, array &$assessment, bool $usable, array &$applied): void
    {
        $notes = mb_strtolower((string) $request->crewNotes);
        $detectedInNotes = $this->detectAffirmativeSymptoms($notes, self::SkinRedFlagTerms);
        $visibleFlags = $assessment['skinFinding']['redFlagsObserved'] ?? [];
        $reportedByCrew = $assessment['skinFinding']['symptomsReportedByCrew'] ?? [];

        $allFlags = array_values(array_unique([...$visibleFlags, ...$detectedInNotes, ...$reportedByCrew]));

        if ($allFlags !== []) {
            $sources = [];

            if ($visibleFlags !== []) {
                $sources[] = 'visible: '.implode(', ', $visibleFlags);
            }

            if ($detectedInNotes !== [] || $reportedByCrew !== []) {
                $reported = array_values(array_unique([...$detectedInNotes, ...$reportedByCrew]));
                $sources[] = 'reported: '.implode(', ', $reported);
            }

            $this->raise($assessment, 'cmo_urgent', 'Red-flag criterion detected ('.implode('; ', $sources).')', $applied);

            return;
        }

        if ($usable) {
            $this->raise($assessment, 'cmo_review', 'Every documented skin finding is shared with the CMO.', $applied);
        }
    }

    /**
     * @param  array<string, mixed>  $assessment
     * @param  list<string>  $applied
     */
    private function urineRules(array &$assessment, array &$applied): void
    {
        $urine = $assessment['urineColor'] ?? null;

        if ($urine === null) {
            return;
        }

        if (($urine['unusualColor'] ?? false) === true) {
            $this->raise($assessment, 'cmo_review', 'Unusual urine colour reported by the image analysis.', $applied);
        } elseif (($urine['scale'] ?? 0) >= 7) {
            $this->raise($assessment, 'cmo_review', 'Urine colour 7 or 8 on the chart.', $applied);
        }
    }

    /**
     * @param  array<string, mixed>  $assessment
     * @param  list<string>  $applied
     */
    private function heartRateRules(AgentRequest $request, array &$assessment, array &$applied): void
    {
        $bpm = $request->heartRate['bpm'] ?? null;

        if ($bpm === null) {
            if (($assessment['escalation']['level'] ?? 'none') !== 'none') {
                $applied[] = 'Escalation kept as proposed although no reliable pulse value was obtained.';
            }

            $assessment['heartRate'] = [
                'interpretation' => $assessment['heartRate']['interpretation'] ?? 'No reliable pulse value was obtained from this recording.',
                'retakeAdvised' => true,
            ];

            return;
        }

        if ($request->atRest === true && ($bpm < self::HeartRateReviewLow || $bpm > self::HeartRateReviewHigh)) {
            $this->raise($assessment, 'cmo_review', sprintf('Webcam estimate of %.0f bpm at rest is outside 40-120 bpm; confirm with a manual pulse.', $bpm), $applied);
        }
    }

    /**
     * @param  list<array<string, mixed>>  $recommendations
     * @param  list<string>  $retrievedSourceIds
     * @param  list<string>  $applied
     * @return list<array<string, mixed>>
     */
    private function keepRetrievedSources(array $recommendations, array $retrievedSourceIds, array &$applied): array
    {
        foreach ($recommendations as $index => $recommendation) {
            $sources = $recommendation['sourceIds'] ?? [];
            $kept = array_values(array_intersect($sources, $retrievedSourceIds));

            if (count($kept) !== count($sources)) {
                $applied[] = 'Removed source ids that were not returned by the knowledge search: '.implode(', ', array_diff($sources, $kept)).'.';
            }

            $recommendations[$index]['sourceIds'] = $kept;
        }

        return array_values($recommendations);
    }

    /**
     * Detects symptoms in crew notes while filtering out negations and past tense.
     *
     * Returns only terms that appear in affirmative, present-tense contexts.
     * Filters: "no X", "not X", "without X", "X yesterday", "X last week", etc.
     *
     * @param  list<string>  $terms
     * @return list<string>
     */
    private function detectAffirmativeSymptoms(string $notes, array $terms): array
    {
        $detected = [];

        foreach ($terms as $term) {
            if (! str_contains($notes, $term)) {
                continue;
            }

            $patterns = [
                "/\b(no|not|without|never)\s+\w*\s*{$term}/i",
                "/\b{$term}\s+(yesterday|ago|last\s+\w+|before|earlier|previously)/i",
                "/\b(yesterday|ago|last\s+\w+|before|earlier|previously)\s+\w*\s*{$term}/i",
            ];

            $negated = false;

            foreach ($patterns as $pattern) {
                if (preg_match($pattern, $notes) === 1) {
                    $negated = true;
                    break;
                }
            }

            if (! $negated) {
                $detected[] = $term;
            }
        }

        return array_values(array_unique($detected));
    }

    /**
     * Replaces recommendations without valid sources by predefined fallback responses.
     *
     * @param  list<array<string, mixed>>  $recommendations
     * @param  list<string>  $applied
     * @return list<array<string, mixed>>
     */
    private function ensureBackedRecommendations(array $recommendations, AgentRequest $request, bool $usable, array &$applied): array
    {
        $backed = [];

        foreach ($recommendations as $recommendation) {
            if (($recommendation['sourceIds'] ?? []) !== []) {
                $backed[] = $recommendation;
            } else {
                $applied[] = 'Removed recommendation without valid sources: '.$recommendation['action'];
            }
        }

        if ($backed === []) {
            $fallback = $this->fallbackRecommendation($request, $usable);

            if ($fallback !== null) {
                $backed[] = $fallback;
                $applied[] = 'Used predefined fallback recommendation: '.$fallback['action'];
            }
        }

        return $backed;
    }

    /**
     * Returns a predefined recommendation when the model cannot provide backed actions.
     *
     * @return array<string, mixed>|null
     */
    private function fallbackRecommendation(AgentRequest $request, bool $usable): ?array
    {
        if ($request->kind->needsPhoto() && ! $usable) {
            return [
                'action' => 'Retake the photo following the capture guidance.',
                'rationale' => 'The submitted photo cannot be used for analysis. Ensure good lighting, focus, and framing of the target.',
                'sourceIds' => [],
            ];
        }

        return match ($request->kind) {
            AnalysisKind::UrineColor, AnalysisKind::SkinRash => [
                'action' => 'Request a review by the Crew Medical Officer.',
                'rationale' => 'This observation requires medical expertise beyond automated analysis capabilities.',
                'sourceIds' => [],
            ],
            AnalysisKind::WebcamHeartRate => [
                'action' => 'Measure your pulse manually and document the result.',
                'rationale' => 'Manual measurement provides a reliable baseline when webcam estimates are uncertain.',
                'sourceIds' => [],
            ],
        };
    }

    /**
     * @param  array<string, mixed>  $assessment
     * @param  list<string>  $applied
     */
    private function raise(array &$assessment, string $level, string $reason, array &$applied): void
    {
        $current = $assessment['escalation']['level'] ?? 'none';

        if (self::LevelOrder[$level] > (self::LevelOrder[$current] ?? 0)) {
            $assessment['escalation']['level'] = $level;
            $assessment['escalation']['reasons'][] = $reason;
            $applied[] = "Escalation raised from {$current} to {$level}: {$reason}";
        }
    }
}
