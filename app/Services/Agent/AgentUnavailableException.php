<?php

namespace App\Services\Agent;

use RuntimeException;

/**
 * The model could not produce an assessment (no API key, network down,
 * refusal, rate limit, malformed answer). The analysis is stored as failed
 * and can be retried; nothing is invented.
 */
final class AgentUnavailableException extends RuntimeException
{
    public function __construct(string $message, public readonly bool $retryable = true, ?\Throwable $previous = null)
    {
        parent::__construct($message, 0, $previous);
    }
}
