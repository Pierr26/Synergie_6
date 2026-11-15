<?php

namespace App\Http\Requests;

use App\Rules\CrewMemberOf;
use App\Services\Lab\LabIntervalEvaluator;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Hb / Hct result entered by the CMO in Lab Results (M12).
 * A missing unit or collection time is accepted and flagged for review.
 */
class StoreLabResultRequest extends FormRequest
{
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
        $analyte = (string) $this->input('analyte');
        $units = array_keys(LabIntervalEvaluator::Analytes[$analyte]['factors'] ?? []);

        return [
            'resultId' => ['required', 'uuid'],
            'enteredBy' => ['required', 'string', new CrewMemberOf($workspace, 'cmo')],
            'analyte' => ['required', Rule::in(array_keys(LabIntervalEvaluator::Analytes))],
            'value' => ['required', 'numeric', 'gt:0'],
            'unit' => ['nullable', Rule::in($units)],
            'specimen' => ['nullable', 'string', 'max:60'],
            'method' => ['nullable', 'string', 'max:120'],
            'laboratory' => ['nullable', 'string', 'max:120'],
            'collectedAt' => ['nullable', 'date'],
            'analyzedAt' => ['nullable', 'date'],
            'issuedAt' => ['nullable', 'date'],
            'status' => ['required', Rule::in(['preliminary', 'final', 'corrected'])],
            'labFlag' => ['nullable', 'string', 'max:20'],
            'interval' => ['nullable', 'array:low,high,unit,source,population'],
            'interval.low' => ['nullable', 'numeric'],
            'interval.high' => ['nullable', 'numeric'],
            'interval.unit' => ['required_with:interval', Rule::in($units)],
            'interval.source' => ['required_with:interval', 'string', 'max:200'],
            'interval.population' => ['nullable', 'string', 'max:200'],
            'sourceText' => ['nullable', 'string', 'max:500'],
        ];
    }
}
