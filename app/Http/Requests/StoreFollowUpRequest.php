<?php

namespace App\Http\Requests;

use App\Rules\CrewMemberOf;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * review_request: an astronaut asks the CMO to review (author = subject).
 * follow_up_request: the CMO asks an astronaut for a check-in or measurement.
 */
class StoreFollowUpRequest extends FormRequest
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
        $isReview = $this->input('type') === 'review_request';

        return [
            'clientRequestId' => ['nullable', 'uuid'],
            'type' => ['required', Rule::in(['review_request', 'follow_up_request'])],
            'authorId' => ['required', 'string', new CrewMemberOf($workspace, $isReview ? 'astronaut' : 'cmo')],
            'subjectId' => ['required', 'string', new CrewMemberOf($workspace, 'astronaut')],
            'reason' => ['required', 'string', 'max:1000'],
            'requested' => ['nullable', 'array:kind,variable,label'],
            'requested.kind' => ['required_with:requested', Rule::in(['checkin', 'measurement', 'photo', 'other'])],
            'requested.variable' => ['nullable', 'string', 'max:40'],
            'requested.label' => ['nullable', 'string', 'max:200'],
            'evidence' => ['nullable', 'array:observationId,analysisId,symptom,alertId'],
            'evidence.observationId' => ['nullable', 'string', 'max:200'],
            'evidence.analysisId' => ['nullable', 'uuid'],
            'evidence.symptom' => ['nullable', 'string', 'max:500'],
            'evidence.alertId' => ['nullable', 'string', 'max:200'],
            'dueAt' => ['nullable', 'date'],
        ];
    }

    /**
     * @return array<int, callable(Validator): void>
     */
    public function after(): array
    {
        return [
            function (Validator $validator): void {
                if ($this->input('type') === 'review_request' && $this->input('authorId') !== $this->input('subjectId')) {
                    $validator->errors()->add('authorId', 'A crew member can only request a review of their own data.');
                }
            },
        ];
    }
}
