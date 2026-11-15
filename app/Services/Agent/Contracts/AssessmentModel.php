<?php

namespace App\Services\Agent\Contracts;

use App\Services\Agent\AgentRequest;
use App\Services\Agent\AgentResult;
use App\Services\Agent\AgentUnavailableException;

/**
 * Boundary to the vision model. The production binding calls Claude; tests
 * bind a fake so the pipeline runs without network or API key.
 */
interface AssessmentModel
{
    /**
     * @throws AgentUnavailableException
     */
    public function assess(AgentRequest $request): AgentResult;
}
