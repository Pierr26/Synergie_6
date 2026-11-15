<?php

namespace App\Services\Agent;

use App\Services\Agent\Contracts\AssessmentModel;

/**
 * Bound when ANTHROPIC_API_KEY is empty: analyses are stored as failed and
 * retryable instead of crashing, so the rest of the API keeps working.
 */
final class UnconfiguredAssessmentModel implements AssessmentModel
{
    public function assess(AgentRequest $request): AgentResult
    {
        throw new AgentUnavailableException('The vision agent is not configured: set ANTHROPIC_API_KEY on the server.');
    }
}
