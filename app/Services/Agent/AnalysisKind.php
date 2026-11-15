<?php

namespace App\Services\Agent;

/**
 * The three analyses the vision agent can run.
 */
enum AnalysisKind: string
{
    case UrineColor = 'urine_color';
    case SkinRash = 'skin_rash';
    case WebcamHeartRate = 'webcam_heart_rate';

    public function needsPhoto(): bool
    {
        return $this !== self::WebcamHeartRate;
    }

    /**
     * Knowledge topics boosted during retrieval.
     *
     * @return list<string>
     */
    public function topics(): array
    {
        return match ($this) {
            self::UrineColor => ['urine_color', 'hydration', 'photo_capture'],
            self::SkinRash => ['skin_rash', 'photo_capture', 'immune'],
            self::WebcamHeartRate => ['webcam_heart_rate', 'heart_rate'],
        };
    }
}
