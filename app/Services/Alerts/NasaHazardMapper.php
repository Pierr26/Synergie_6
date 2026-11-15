<?php

namespace App\Services\Alerts;

/**
 * NASA Human Research Program (HRP) Hazard Mapper.
 *
 * Maps health indicators to NASA's 5 spaceflight hazards:
 * 1. Space Radiation
 * 2. Isolation & Confinement
 * 3. Distance from Earth
 * 4. Gravity Fields
 * 5. Hostile/Closed Environments
 *
 * Each hazard contains multiple risks (e.g., "Radiation-Induced Cancers").
 * Each risk is associated with specific health indicators.
 *
 * References:
 * - hazards_risks.json from Banque de Données
 * - NASA HRP Evidence Reports: https://www.nasa.gov/hrp/
 */
final class NasaHazardMapper
{
    /** @var array<string, array<string, mixed>> Hazards indexed by _id */
    private array $hazards = [];

    /** @var array<string, list<array{hazard: string, risk: string, nasaUrl: string}>> Reverse mapping: indicator -> hazards */
    private array $indicatorToHazards = [];

    public function __construct()
    {
        $this->loadHazards();
        $this->buildReverseMapping();
    }

    /**
     * Get all hazards related to a health indicator.
     *
     * @return list<array{hazard: string, hazardLabel: string, risk: string, riskLabel: string, nasaUrl: string}>
     */
    public function getHazardsForIndicator(string $indicator): array
    {
        return $this->indicatorToHazards[$indicator] ?? [];
    }

    /**
     * Get all indicators affected by a hazard.
     *
     * @return list<string>
     */
    public function getIndicatorsForHazard(string $hazardId): array
    {
        $hazard = $this->hazards[$hazardId] ?? null;

        if ($hazard === null) {
            return [];
        }

        $indicators = [];

        foreach ($hazard['risks'] as $risk) {
            array_push($indicators, ...($risk['indicators'] ?? []));
        }

        return array_values(array_unique($indicators));
    }

    /**
     * Get hazard information.
     *
     * @return array<string, mixed>|null
     */
    public function getHazard(string $hazardId): ?array
    {
        return $this->hazards[$hazardId] ?? null;
    }

    /**
     * Get all hazards.
     *
     * @return list<array<string, mixed>>
     */
    public function getAllHazards(): array
    {
        return array_values($this->hazards);
    }

    /**
     * Check if indicator is critical for mission safety (multiple hazards).
     */
    public function isCriticalIndicator(string $indicator): bool
    {
        return count($this->indicatorToHazards[$indicator] ?? []) >= 2;
    }

    /**
     * Load hazards from JSON file.
     */
    private function loadHazards(): void
    {
        $jsonPath = base_path('../Banque Données Health Monitoring/03 Code &amp_ reproductibilité/hazards_risks.json');

        if (! file_exists($jsonPath)) {
            // Fallback to hardcoded critical mappings if file not found
            $this->hazards = $this->getFallbackHazards();

            return;
        }

        $data = json_decode(file_get_contents($jsonPath), true);

        foreach ($data as $hazard) {
            $this->hazards[$hazard['_id']] = $hazard;
        }
    }

    /**
     * Build reverse mapping: indicator -> list of hazards.
     */
    private function buildReverseMapping(): void
    {
        foreach ($this->hazards as $hazardId => $hazard) {
            foreach ($hazard['risks'] as $risk) {
                foreach ($risk['indicators'] ?? [] as $indicator) {
                    if (! isset($this->indicatorToHazards[$indicator])) {
                        $this->indicatorToHazards[$indicator] = [];
                    }

                    $this->indicatorToHazards[$indicator][] = [
                        'hazard' => $hazardId,
                        'hazardLabel' => $hazard['label'] ?? $hazardId,
                        'risk' => $risk['label'] ?? 'Unknown risk',
                        'riskLabel' => $risk['label'] ?? 'Unknown risk',
                        'nasaUrl' => $risk['nasaUrl'] ?? $hazard['nasaUrl'] ?? null,
                    ];
                }
            }
        }
    }

    /**
     * Fallback hazard definitions if JSON file not available.
     *
     * @return array<string, array<string, mixed>>
     */
    private function getFallbackHazards(): array
    {
        return [
            'space_radiation' => [
                '_id' => 'space_radiation',
                'label' => 'Radiations spatiales',
                'nasaUrl' => 'https://www.nasa.gov/hrp/hazard-space-radiation/',
                'risks' => [
                    ['label' => 'Radiation-Induced Cancers', 'indicators' => ['radiationDose', 'whiteBloodCellCount', 'hemoglobin']],
                    ['label' => 'Cardiovascular effects', 'indicators' => ['heartRate', 'bloodPressure']],
                ],
            ],
            'isolation_confinement' => [
                '_id' => 'isolation_confinement',
                'label' => 'Isolement et confinement',
                'nasaUrl' => 'https://www.nasa.gov/hrp/hazard-isolation-and-confinement/',
                'risks' => [
                    ['label' => 'Behavioral Changes & Psychiatric Disorders', 'indicators' => ['mood', 'sleepHours']],
                    ['label' => 'Inadequate Sleep', 'indicators' => ['sleepHours', 'mood', 'heartRate']],
                ],
            ],
            'hostile_closed_environments' => [
                '_id' => 'hostile_closed_environments',
                'label' => 'Environnements hostiles/clos',
                'nasaUrl' => 'https://www.nasa.gov/hrp/hazard-hostile-closed-environments/',
                'risks' => [
                    ['label' => 'Hypoxia', 'indicators' => ['o2Partial', 'co2Cabin']],
                    ['label' => 'Host-Microorganism Interactions', 'indicators' => ['whiteBloodCellCount', 'bodyTemperature']],
                    ['label' => 'Inadequate Food and Nutrition', 'indicators' => ['glucose', 'weight']],
                ],
            ],
            'gravity_fields' => [
                '_id' => 'gravity_fields',
                'label' => 'Champs de gravité',
                'nasaUrl' => 'https://www.nasa.gov/hrp/hazard-gravity-fields/',
                'risks' => [
                    ['label' => 'Cardiovascular Adaptations', 'indicators' => ['bloodPressure', 'heartRate']],
                    ['label' => 'Reduced Cardiorespiratory Fitness', 'indicators' => ['heartRate', 'bloodPressure']],
                ],
            ],
            'distance_from_earth' => [
                '_id' => 'distance_from_earth',
                'label' => 'Distance de la Terre',
                'nasaUrl' => 'https://www.nasa.gov/hrp/hazard-distance-from-earth/',
                'risks' => [
                    ['label' => 'Delayed medical communication', 'indicators' => ['mood', 'sleepHours', 'heartRate']],
                ],
            ],
        ];
    }
}
