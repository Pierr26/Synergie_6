<?php

namespace App\Services\Agent;

use Anthropic\Beta\Messages\BetaMessage;
use Anthropic\Client;
use Anthropic\Core\Exceptions\APIConnectionException;
use Anthropic\Core\Exceptions\APIStatusException;
use Anthropic\Core\Exceptions\AuthenticationException;
use Anthropic\Core\Exceptions\BadRequestException;
use Anthropic\Core\Exceptions\RateLimitException;
use App\Services\Agent\Contracts\AssessmentModel;
use JsonException;

/**
 * Vision agent backed by Claude (Messages API, tool use + structured output).
 *
 * The model looks at the photo (or the computed webcam heart rate), calls
 * `search_knowledge` (MongoDB Atlas Search over the knowledge base) and
 * `get_recent_observations` (the crew member's records in MongoDB), then
 * answers with JSON matching AssessmentSchema.
 */
final class ClaudeAssessmentModel implements AssessmentModel
{
    private const string FallbackBeta = 'server-side-fallback-2026-07-01';

    private const string SystemPrompt = <<<'PROMPT'
        You are the HEXTA health observation assistant on a long-duration crewed mission. The ground link may be delayed or unavailable. A crew member has sent a photo or a webcam pulse measurement. Your answer is shown to that crew member and to the Crew Medical Officer (CMO), who makes every medical decision.

        What you do:
        - Describe what is visible and estimate only what the method allows: the urine colour on the 8-point chart, a neutral description of a skin finding, or the meaning and reliability of a webcam pulse estimate.
        - Judge image quality first. If the photo is blurred, dark, colour-cast or does not show the expected subject, mark it unusable, explain how to retake it and do not estimate.
        - CRITICAL: Distinguish what you observe in the photo from what the crew member reports in their notes. For skin findings, list visible red flags in redFlagsObserved (based only on what you see in the image) and symptoms mentioned in crew notes in symptomsReportedByCrew (fever, pain, timing, progression). Never assume a reported symptom is visible or vice versa.
        - Before writing recommendations, call search_knowledge for the relevant topics and use get_recent_observations when the crew member's recent records would change the advice (fluid intake, temperature, symptoms, sleep, previous readings).
        - Give at most four practical recommendations the crew member can do now (retake, drink and re-check later, measure manually, document daily, request a CMO review). Each recommendation cites the ids of the documents it relies on, using only ids returned by search_knowledge. If no document supports it, leave sourceIds empty.

        Limits you keep:
        - Never name a diagnosis, never suggest a medication or dose, never say that something is normal or safe. Use words like "consistent with", "may suggest", "worth reviewing".
        - A single photo or reading does not characterise a health state. Say so in limitations when relevant.
        - Escalation: use cmo_urgent when a red-flag criterion from the knowledge base is visible or reported; cmo_review when the finding is unusual, persistent, or outside what the crew member can follow alone; none otherwise. When unsure between two levels, choose the higher one.
        - Write in plain English, short sentences, no markdown.
        PROMPT;

    public function __construct(
        private readonly Client $client,
        private readonly KnowledgeSearch $knowledge,
        private readonly CrewContext $crewContext,
        private readonly string $model,
        private readonly string $effort,
        private readonly int $maxTokens,
        private readonly int $maxToolRounds,
    ) {}

    public function assess(AgentRequest $request): AgentResult
    {
        $messages = [['role' => 'user', 'content' => $this->userContent($request)]];
        $retrieved = [];
        $toolCalls = [];
        $usage = ['inputTokens' => 0, 'outputTokens' => 0, 'cacheReadInputTokens' => 0];

        for ($round = 0; $round <= $this->maxToolRounds; $round++) {
            $response = $this->send($messages);
            $usage['inputTokens'] += $response->usage->inputTokens;
            $usage['outputTokens'] += $response->usage->outputTokens;
            $usage['cacheReadInputTokens'] += $response->usage->cacheReadInputTokens ?? 0;

            if ($response->stopReason === 'refusal') {
                throw new AgentUnavailableException('The model declined this request.', retryable: false);
            }

            if ($response->stopReason === 'max_tokens') {
                throw new AgentUnavailableException('The model answer was truncated.');
            }

            if ($response->stopReason !== 'tool_use') {
                return new AgentResult(
                    assessment: $this->parseAssessment($response),
                    retrievedSourceIds: array_values(array_unique($retrieved)),
                    toolCalls: $toolCalls,
                    model: $response->model,
                    usage: $usage,
                );
            }

            $results = [];

            foreach ($response->content as $block) {
                if ($block->type !== 'tool_use') {
                    continue;
                }

                $input = is_array($block->input) ? $block->input : [];
                $toolCalls[] = ['tool' => $block->name, 'input' => $input];
                [$payload, $ids] = $this->runTool($block->name, $input, $request);
                array_push($retrieved, ...$ids);

                $results[] = [
                    'type' => 'tool_result',
                    'toolUseID' => $block->id,
                    'content' => json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                ];
            }

            $messages[] = ['role' => 'assistant', 'content' => $response->content];
            $messages[] = ['role' => 'user', 'content' => $results];
        }

        throw new AgentUnavailableException('The agent exceeded its tool budget.');
    }

    /**
     * @param  list<array<string, mixed>>  $messages
     */
    private function send(array $messages): BetaMessage
    {
        try {
            return $this->client->beta->messages->create(
                maxTokens: $this->maxTokens,
                messages: $messages,
                model: $this->model,
                system: [['type' => 'text', 'text' => self::SystemPrompt, 'cacheControl' => ['type' => 'ephemeral']]],
                thinking: ['type' => 'adaptive'],
                outputConfig: [
                    'effort' => $this->effort,
                    'format' => ['type' => 'json_schema', 'schema' => AssessmentSchema::schema()],
                ],
                tools: $this->tools(),
                fallbacks: 'default',
                betas: [self::FallbackBeta],
            );
        } catch (AuthenticationException $exception) {
            throw new AgentUnavailableException('Anthropic credentials are missing or invalid.', retryable: false, previous: $exception);
        } catch (BadRequestException $exception) {
            throw new AgentUnavailableException('The model rejected the request: '.$exception->getMessage(), retryable: false, previous: $exception);
        } catch (RateLimitException $exception) {
            throw new AgentUnavailableException('The model is rate limited. Retry later.', previous: $exception);
        } catch (APIStatusException $exception) {
            throw new AgentUnavailableException('The model service returned an error.', previous: $exception);
        } catch (APIConnectionException $exception) {
            throw new AgentUnavailableException('The model service is unreachable (ground link or network).', previous: $exception);
        }
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function tools(): array
    {
        return [
            [
                'name' => 'search_knowledge',
                'description' => 'Full-text search over the HEXTA knowledge base (NASA HRP pages, peer-reviewed studies, prototype guidance). Returns document ids, titles, sources, whether the guidance is validated, and an excerpt. Use the returned ids in recommendation sourceIds.',
                'strict' => true,
                'inputSchema' => [
                    'type' => 'object',
                    'properties' => [
                        'query' => ['type' => 'string', 'description' => 'English keywords, for example "urine colour hydration chart".'],
                    ],
                    'required' => ['query'],
                    'additionalProperties' => false,
                ],
            ],
            [
                'name' => 'get_recent_observations',
                'description' => 'Most recent recorded observations of the crew member being assessed, newest first, with method, quality and context. Variables: '.implode(', ', CrewContext::Variables).'.',
                'strict' => true,
                'inputSchema' => [
                    'type' => 'object',
                    'properties' => [
                        'variables' => ['type' => 'array', 'items' => ['type' => 'string', 'enum' => CrewContext::Variables]],
                    ],
                    'required' => ['variables'],
                    'additionalProperties' => false,
                ],
            ],
        ];
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array{0: mixed, 1: list<string>}
     */
    private function runTool(string $name, array $input, AgentRequest $request): array
    {
        return match ($name) {
            'search_knowledge' => $this->searchKnowledge((string) ($input['query'] ?? ''), $request),
            'get_recent_observations' => [
                $this->crewContext->recentObservations($request->workspaceId, $request->subjectId, (array) ($input['variables'] ?? [])),
                [],
            ],
            default => [['error' => "Unknown tool {$name}"], []],
        };
    }

    /**
     * @return array{0: list<array<string, mixed>>, 1: list<string>}
     */
    private function searchKnowledge(string $query, AgentRequest $request): array
    {
        $documents = trim($query) === '' ? [] : $this->knowledge->search($query, $request->kind->topics());

        return [$documents, array_column($documents, 'id')];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function userContent(AgentRequest $request): array
    {
        $content = [];

        if ($request->imageJpeg !== null) {
            $content[] = [
                'type' => 'image',
                'source' => ['type' => 'base64', 'mediaType' => 'image/jpeg', 'data' => base64_encode($request->imageJpeg)],
            ];
        }

        $context = [
            'analysis' => $request->kind->value,
            'crewMember' => $request->subjectAlias,
            'missionDay' => $request->missionDay,
            'crewNotes' => $request->crewNotes,
        ];

        $context += match ($request->kind) {
            AnalysisKind::UrineColor => ['task' => 'Estimate the urine colour on the 8-point chart and advise on hydration follow-up.'],
            AnalysisKind::SkinRash => ['task' => 'Describe the skin finding neutrally, check visible red flags and advise on documentation and review.', 'bodySite' => $request->bodySite],
            AnalysisKind::WebcamHeartRate => [
                'task' => 'Explain the webcam pulse estimate computed by HEXTA (POS rPPG), how reliable it is, and what to do next. There is no image.',
                'measurement' => $request->heartRate,
                'atRest' => $request->atRest,
            ],
        };

        $content[] = ['type' => 'text', 'text' => json_encode($context, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)];

        return $content;
    }

    /**
     * @return array<string, mixed>
     */
    private function parseAssessment(BetaMessage $response): array
    {
        foreach ($response->content as $block) {
            if ($block->type === 'text') {
                try {
                    $decoded = json_decode($block->text, true, flags: JSON_THROW_ON_ERROR);
                } catch (JsonException $exception) {
                    throw new AgentUnavailableException('The model answer was not valid JSON.', previous: $exception);
                }

                if (is_array($decoded)) {
                    return $decoded;
                }
            }
        }

        throw new AgentUnavailableException('The model returned no assessment.');
    }
}
