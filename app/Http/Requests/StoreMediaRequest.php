<?php

namespace App\Http\Requests;

use App\Rules\CrewMemberOf;
use App\Services\Media\MediaStore;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Health photo upload (urine colour, skin finding).
 */
class StoreMediaRequest extends FormRequest
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
            'file' => ['required', 'file', 'mimetypes:image/jpeg,image/png,image/webp', 'max:'.config('hexta.media.max_kilobytes')],
            'kind' => ['required', Rule::in(MediaStore::Kinds)],
            'subjectId' => ['required', 'string', new CrewMemberOf($workspace)],
            'uploadedBy' => ['required', 'string', new CrewMemberOf($workspace)],
            'capturedAt' => ['nullable', 'date'],
            'bodySite' => ['nullable', 'string', 'max:120'],
        ];
    }
}
