<?php

namespace App\Http\Requests;

use App\Rules\CrewMemberOf;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * On-demand measurement (M16) or correction of one (new version).
 *
 * Domains are enforced (SpO2 0-100, finite positive values), but coherence
 * issues such as systolic <= diastolic or an unknown site are accepted and
 * flagged "to_verify" by the recorder, as the cahier des charges requires.
 */
class StoreObservationRequest extends FormRequest
{
    /** @var array<string, list<string>> */
    public const array Units = [
        'blood_pressure' => ['mmHg'],
        'spo2' => ['%'],
        'temperature' => ['Cel'],
        'glucose' => ['mg/dL', 'mmol/L'],
        'resting_heart_rate' => ['bpm'],
        'heart_rate' => ['bpm'],
        'respiratory_rate' => ['/min'],
        'actigraphy_sleep_duration' => ['min'],
        'pvt_reaction_time' => ['ms'],
        'cabin_co2' => ['mmHg', 'ppm'],
        'cabin_temperature' => ['Cel'],
        'radiation_dose_rate' => ['uGy/h'],
        'radiation_absorbed_dose' => ['mGy'],
    ];

    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        $workspace = (string) $this->route('workspace');
        $variable = (string) $this->input('variable');
        $isCorrection = $this->route('lineageId') !== null;

        $valueRules = match ($variable) {
            'blood_pressure' => [
                'value' => ['required', 'array:systolic,diastolic'],
                'value.systolic' => ['required', 'numeric', 'gt:0', 'max:400'],
                'value.diastolic' => ['required', 'numeric', 'gt:0', 'max:300'],
            ],
            'spo2' => ['value' => ['required', 'numeric', 'between:0,100']],
            'temperature' => ['value' => ['required', 'numeric', 'between:20,45']],
            'respiratory_rate' => ['value' => ['required', 'numeric', 'min:0', 'max:120']],
            'actigraphy_sleep_duration' => ['value' => ['required', 'numeric', 'between:0,1440']],
            'pvt_reaction_time' => ['value' => ['required', 'numeric', 'min:0', 'max:5000']],
            'cabin_co2' => ['value' => ['required', 'numeric', 'min:0', 'max:100000']],
            'cabin_temperature' => ['value' => ['required', 'numeric', 'between:-100,100']],
            'radiation_dose_rate' => ['value' => ['required', 'numeric', 'min:0', 'max:100000']],
            'radiation_absorbed_dose' => ['value' => ['required', 'numeric', 'min:0', 'max:1000000']],
            default => ['value' => ['required', 'numeric', 'gt:0', 'max:2000']],
        };

        return [
            'observationId' => [$isCorrection ? 'prohibited' : 'required', 'uuid'],
            'reason' => [$isCorrection ? 'required' : 'prohibited', 'string', 'max:500'],
            'recordedBy' => ['required', 'string', new CrewMemberOf($workspace)],
            'variable' => ['required', Rule::in(array_keys(self::Units))],
            'unit' => ['required', Rule::in(self::Units[$variable] ?? [])],
            'method' => ['required', 'string', 'max:60'],
            'device' => ['nullable', 'string', 'max:120'],
            'observedAt' => ['required', 'date'],
            'context' => ['nullable', 'array:atRest,posture,site,signalQuality,supplementalOxygen,specimen,context,note,sensorId,sensorType,assignment,source,simulated,wearStatus,sleepOnset,wakeTime,windowStart,windowEnd,protocol,testDuration,absolutePressure'],
            'context.atRest' => ['nullable', 'boolean'],
            'context.posture' => ['nullable', Rule::in(['seated', 'supine', 'standing', 'restrained', 'unknown'])],
            'context.site' => ['nullable', Rule::in(['oral', 'skin', 'tympanic', 'axillary', 'forehead', 'rectal', 'unknown'])],
            'context.signalQuality' => ['nullable', Rule::in(['good', 'fair', 'insufficient', 'unknown'])],
            'context.supplementalOxygen' => ['nullable', 'boolean'],
            'context.specimen' => ['nullable', Rule::in(['capillary', 'plasma', 'interstitial', 'unknown'])],
            'context.context' => ['nullable', Rule::in(['fasting', 'post_meal', 'unknown'])],
            'context.note' => ['nullable', 'string', 'max:500'],
            'context.sensorId' => ['nullable', 'string', 'max:120'],
            'context.sensorType' => ['nullable', 'string', 'max:120'],
            'context.assignment' => ['nullable', 'string', 'max:120'],
            'context.source' => ['nullable', 'string', 'max:200'],
            'context.simulated' => ['nullable', 'boolean'],
            'context.wearStatus' => ['nullable', Rule::in(['worn', 'not_worn', 'unknown'])],
            'context.sleepOnset' => ['nullable', 'date'],
            'context.wakeTime' => ['nullable', 'date'],
            'context.windowStart' => ['nullable', 'date'],
            'context.windowEnd' => ['nullable', 'date'],
            'context.protocol' => ['nullable', 'string', 'max:120'],
            'context.testDuration' => ['nullable', 'numeric', 'min:0'],
            'context.absolutePressure' => ['nullable', 'numeric', 'min:0'],
            ...$valueRules,
        ];
    }
}
