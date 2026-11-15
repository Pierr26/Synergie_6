<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Validates an individual report snapshot queued for ground (M11, M06).
 */
class StoreGroundReportRequest extends FormRequest
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
        return [
            'reportId' => ['required', 'uuid', Rule::in([$this->route('reportId')])],
            'schemaVersion' => ['required', 'integer', Rule::in([1])],
            'workspaceId' => ['required', 'string', Rule::in(config('hexta.workspaces'))],
            'missionId' => ['required', 'string', 'max:64'],
            'simulated' => ['required', 'boolean'],
            'subject' => ['required', 'array:crewId,alias'],
            'subject.crewId' => ['required', 'string', 'max:64'],
            'subject.alias' => ['required', 'string', 'max:120'],
            'author' => ['required', 'array:crewId,alias,role'],
            'author.crewId' => ['required', 'string', 'max:64'],
            'author.alias' => ['required', 'string', 'max:120'],
            'author.role' => ['required', Rule::in(['cmo', 'astronaut'])],
            'period' => ['required', 'array:from,to'],
            'period.from' => ['required', 'date'],
            'period.to' => ['required', 'date', 'after_or_equal:period.from'],
            'generatedAt' => ['required', 'date'],
            'missionDay' => ['nullable', 'integer', 'min:0'],
            'timezone' => ['required', 'string', Rule::in(['UTC'])],
            'observations' => ['present', 'array'],
            'absences' => ['present', 'array'],
            'labResults' => ['present', 'array'],
            'reviews' => ['present', 'array'],
            'followUps' => ['present', 'array'],
            'rules' => ['present', 'array'],
            'notes' => ['nullable', 'string', 'max:4000'],
        ];
    }

    public function messages(): array
    {
        return [
            'reportId.in' => 'The reportId in the body must match the reportId in the URL.',
        ];
    }
}
