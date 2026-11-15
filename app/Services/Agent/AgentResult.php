<?php

namespace App\Services\Agent;

/**
 * Raw output of the vision agent before server-side guardrails.
 */
final readonly class AgentResult
{
    /**
     * @param  array<string, mixed>  $assessment  Validated against AssessmentSchema
     * @param  list<string>  $retrievedSourceIds  Knowledge documents actually returned by search_knowledge
     * @param  list<array{tool: string, input: array<string, mixed>}>  $toolCalls
     * @param  array{inputTokens: int, outputTokens: int, cacheReadInputTokens: int}  $usage
     */
    public function __construct(
        public array $assessment,
        public array $retrievedSourceIds,
        public array $toolCalls,
        public string $model,
        public array $usage,
    ) {}
}
