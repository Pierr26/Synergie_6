<?php

namespace App\Http\Requests;

use App\Rules\CrewMemberOf;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * Daily check-in (M01). Sleep and sleepiness are required, either with a
 * value or explicitly "not_recorded". A declared zero sleep must be confirmed.
 */
class UpsertCheckinRequest extends FormRequest
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
            'status' => ['required', Rule::in(['draft', 'submitted'])],
            'submittedBy' => ['required', 'string', new CrewMemberOf($workspace)],
            'clientCheckinId' => ['nullable', 'uuid'],
            'recordedAt' => ['nullable', 'date'],

            'sleep' => ['required', 'array:status,minutes,zeroConfirmed'],
            'sleep.status' => ['required', Rule::in(['recorded', 'not_recorded'])],
            'sleep.minutes' => ['exclude_unless:sleep.status,recorded', 'required', 'integer', 'between:0,1440'],
            'sleep.zeroConfirmed' => ['nullable', 'boolean'],

            'sleepiness' => ['required', 'array:status,value'],
            'sleepiness.status' => ['required', Rule::in(['recorded', 'not_recorded'])],
            'sleepiness.value' => ['exclude_unless:sleepiness.status,recorded', 'required', 'integer', 'between:1,9'],

            'mood' => ['nullable', 'array:status,value'],
            'mood.status' => ['required_with:mood', Rule::in(['recorded', 'not_recorded', 'skipped'])],
            'mood.value' => ['exclude_unless:mood.status,recorded', 'required', 'integer', 'between:1,5'],

            'fatigue' => ['nullable', 'array:status,value'],
            'fatigue.status' => ['required_with:fatigue', Rule::in(['recorded', 'not_recorded', 'skipped'])],
            'fatigue.value' => ['exclude_unless:fatigue.status,recorded', 'required', 'integer', 'between:1,5'],

            'stress' => ['nullable', 'array:status,value'],
            'stress.status' => ['required_with:stress', Rule::in(['recorded', 'not_recorded', 'skipped'])],
            'stress.value' => ['exclude_unless:stress.status,recorded', 'required', 'integer', 'between:1,5'],

            'perceivedIsolation' => ['nullable', 'array:status,value'],
            'perceivedIsolation.status' => ['required_with:perceivedIsolation', Rule::in(['recorded', 'not_recorded', 'skipped'])],
            'perceivedIsolation.value' => ['exclude_unless:perceivedIsolation.status,recorded', 'required', 'integer', 'between:1,5'],

            'workload' => ['nullable', 'array:status,value'],
            'workload.status' => ['required_with:workload', Rule::in(['recorded', 'not_recorded', 'skipped'])],
            'workload.value' => ['exclude_unless:workload.status,recorded', 'required', 'integer', 'between:1,5'],

            'symptoms' => ['nullable', 'array:answer,comment'],
            'symptoms.answer' => ['required_with:symptoms', Rule::in(['yes', 'no', 'skip'])],
            'symptoms.comment' => ['nullable', 'string', 'max:1000'],

            'restingHeartRate' => ['nullable', 'array:status,value,method,device,atRest'],
            'restingHeartRate.status' => ['required_with:restingHeartRate', Rule::in(['recorded', 'not_recorded'])],
            'restingHeartRate.value' => ['exclude_unless:restingHeartRate.status,recorded', 'required', 'numeric', 'gt:0', 'max:300'],
            'restingHeartRate.method' => ['nullable', 'string', 'max:60'],
            'restingHeartRate.device' => ['nullable', 'string', 'max:120'],
            'restingHeartRate.atRest' => ['nullable', 'boolean'],
        ];
    }

    /**
     * @return array<int, callable(Validator): void>
     */
    public function after(): array
    {
        return [
            function (Validator $validator): void {
                $sleep = $this->input('sleep', []);

                if (($sleep['status'] ?? null) === 'recorded' && ($sleep['minutes'] ?? null) === 0 && ! ($sleep['zeroConfirmed'] ?? false)) {
                    $validator->errors()->add('sleep.zeroConfirmed', 'Confirm that no sleep was recorded (zeroConfirmed: true).');
                }
            },
        ];
    }
}
