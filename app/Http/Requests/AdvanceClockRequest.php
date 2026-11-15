<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Start demo clock control: advance by N minutes or jump to a time.
 */
class AdvanceClockRequest extends FormRequest
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
            'minutes' => ['required_without:at', 'prohibits:at', 'integer', 'between:1,10080'],
            'at' => ['required_without:minutes', 'date'],
        ];
    }
}
