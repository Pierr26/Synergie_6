<?php

namespace App\Http\Requests;

use App\Rules\CrewMemberOf;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Correction of an Hb / Hct result: new version, verification pending.
 */
class CorrectLabResultRequest extends FormRequest
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
            'correctedBy' => ['required', 'string', new CrewMemberOf((string) $this->route('workspace'), 'cmo')],
            'reason' => ['required', 'string', 'max:500'],
            'value' => ['required', 'numeric', 'gt:0'],
            'unit' => ['nullable', 'string', 'in:g/L,g/dL,%,L/L'],
            'sourceText' => ['nullable', 'string', 'max:500'],
        ];
    }
}
