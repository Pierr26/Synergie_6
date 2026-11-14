<?php

namespace App\Http\Requests;

use Closure;
use Illuminate\Foundation\Http\FormRequest;

class StoreReceivedReportRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * The client sends the frozen snapshot as a canonical JSON string so the server can hash
     * exactly the bytes that were generated on board.
     *
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        $reportId = (string) $this->route('reportId');

        return [
            'content' => ['required', 'string', 'json', 'max:1000000', function (string $attribute, mixed $value, Closure $fail) use ($reportId): void {
                $decoded = json_decode((string) $value, true);
                if (! is_array($decoded) || ($decoded['reportId'] ?? null) !== $reportId) {
                    $fail('The snapshot must carry the same reportId as the URL.');
                }
                foreach (['member', 'period', 'generatedAt', 'author'] as $key) {
                    if (! is_array($decoded) || ! array_key_exists($key, $decoded)) {
                        $fail("The snapshot is missing {$key}.");
                    }
                }
            }],
        ];
    }
}
