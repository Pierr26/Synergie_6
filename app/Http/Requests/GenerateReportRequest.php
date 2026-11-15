<?php

namespace App\Http\Requests;

use App\Rules\CrewMemberOf;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

/**
 * "Generate report": one crew member, one period (default: 7 days including today).
 */
class GenerateReportRequest extends FormRequest
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

        return [
            'subjectId' => ['required', 'string', new CrewMemberOf($workspace, 'astronaut')],
            'authorId' => ['required', 'string', new CrewMemberOf($workspace, 'cmo')],
            'fromDay' => ['nullable', 'integer', 'min:0'],
            'toDay' => ['nullable', 'integer', 'min:0'],
        ];
    }
}
