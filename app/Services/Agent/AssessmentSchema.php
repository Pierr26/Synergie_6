<?php

namespace App\Services\Agent;

/**
 * JSON schema of the agent's final answer (structured outputs).
 *
 * Every object is closed (additionalProperties: false) and every property is
 * required; optional parts are expressed as nullable with anyOf.
 */
final class AssessmentSchema
{
    /**
     * @return array<string, mixed>
     */
    public static function schema(): array
    {
        $stringList = ['type' => 'array', 'items' => ['type' => 'string']];

        return self::closed([
            'imageQuality' => self::closed([
                'usable' => ['type' => 'boolean'],
                'issues' => $stringList,
            ]),
            'urineColor' => self::nullable(self::closed([
                'scale' => ['type' => 'integer', 'enum' => [1, 2, 3, 4, 5, 6, 7, 8]],
                'label' => ['type' => 'string'],
                'unusualColor' => ['type' => 'boolean'],
                'unusualColorDescription' => self::nullable(['type' => 'string']),
            ])),
            'skinFinding' => self::nullable(self::closed([
                'bodySite' => ['type' => 'string'],
                'description' => ['type' => 'string'],
                'distribution' => ['type' => 'string'],
                'estimatedSize' => ['type' => 'string'],
                'redFlagsObserved' => $stringList,
                'symptomsReportedByCrew' => $stringList,
            ])),
            'heartRate' => self::nullable(self::closed([
                'interpretation' => ['type' => 'string'],
                'retakeAdvised' => ['type' => 'boolean'],
            ])),
            'summary' => ['type' => 'string'],
            'recommendations' => [
                'type' => 'array',
                'items' => self::closed([
                    'action' => ['type' => 'string'],
                    'rationale' => ['type' => 'string'],
                    'sourceIds' => $stringList,
                ]),
            ],
            'escalation' => self::closed([
                'level' => ['type' => 'string', 'enum' => ['none', 'cmo_review', 'cmo_urgent']],
                'reasons' => $stringList,
            ]),
            'confidence' => ['type' => 'string', 'enum' => ['low', 'medium', 'high']],
            'limitations' => $stringList,
        ]);
    }

    /**
     * @param  array<string, array<string, mixed>>  $properties
     * @return array<string, mixed>
     */
    private static function closed(array $properties): array
    {
        return [
            'type' => 'object',
            'properties' => $properties,
            'required' => array_keys($properties),
            'additionalProperties' => false,
        ];
    }

    /**
     * @param  array<string, mixed>  $schema
     * @return array<string, mixed>
     */
    private static function nullable(array $schema): array
    {
        return ['anyOf' => [$schema, ['type' => 'null']]];
    }
}
