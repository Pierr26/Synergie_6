<?php

namespace App\Http\Requests;

use App\Rules\CrewMemberOf;
use App\Services\Agent\AnalysisKind;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * Starts a vision agent analysis.
 *
 * Photo analyses reference an uploaded mediaId of the same workspace and
 * crew member. Webcam analyses send the colour trace computed in the
 * browser: signal.samples = [[timestampMs, r, g, b], ...].
 */
class StoreAnalysisRequest extends FormRequest
{
    public const int MinSamples = 150;

    public const int MaxSamples = 3600;

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
        $webcam = AnalysisKind::WebcamHeartRate->value;

        return [
            'kind' => ['required', Rule::enum(AnalysisKind::class)],
            'subjectId' => ['required', 'string', new CrewMemberOf($workspace)],
            'requestedBy' => ['required', 'string', new CrewMemberOf($workspace)],
            'mediaId' => ["exclude_if:kind,{$webcam}", 'required', 'uuid'],
            'notes' => ['nullable', 'string', 'max:1000'],
            'bodySite' => ['nullable', 'string', 'max:120'],
            'atRest' => ["required_if:kind,{$webcam}", 'nullable', 'boolean'],
            'signal' => ["exclude_unless:kind,{$webcam}", 'required', 'array:samples,roi'],
            'signal.roi' => ['nullable', Rule::in(['face', 'forehead', 'cheeks'])],
            'signal.samples' => ["exclude_unless:kind,{$webcam}", 'required', 'array', 'min:'.self::MinSamples, 'max:'.self::MaxSamples],
        ];
    }

    /**
     * Sample shape and media ownership are checked once, without per-item
     * wildcard rules (a 30 s trace has ~900 x 4 numbers).
     *
     * @return array<int, callable(Validator): void>
     */
    public function after(): array
    {
        return [
            function (Validator $validator): void {
                if ($validator->errors()->isNotEmpty()) {
                    return;
                }

                $data = $validator->getData();

                if (($data['kind'] ?? null) === AnalysisKind::WebcamHeartRate->value) {
                    $this->checkSamples($validator, $data['signal']['samples']);

                    return;
                }

                $this->checkMedia($validator, (string) $data['mediaId'], (string) $data['subjectId'], (string) $data['kind']);
            },
        ];
    }

    /**
     * @param  array<mixed>  $samples
     */
    private function checkSamples(Validator $validator, array $samples): void
    {
        foreach ($samples as $index => $sample) {
            $valid = is_array($sample) && array_is_list($sample) && count($sample) === 4;

            foreach ($valid ? $sample : [] as $position => $number) {
                $valid = $valid && is_numeric($number) && is_finite((float) $number) && ($position === 0 || ($number >= 0 && $number <= 255));
            }

            if (! $valid) {
                $validator->errors()->add("signal.samples.{$index}", 'Each sample must be [timestampMs, r, g, b] with colour values between 0 and 255.');

                return;
            }
        }
    }

    private function checkMedia(Validator $validator, string $mediaId, string $subjectId, string $kind): void
    {
        $file = DB::connection('mongodb')->getCollection(config('hexta.media.bucket').'.files')->findOne([
            '_id' => $mediaId,
            'metadata.workspaceId' => (string) $this->route('workspace'),
        ]);

        if ($file === null) {
            $validator->errors()->add('mediaId', 'No photo with this mediaId in this workspace.');
        } elseif ($file['metadata']['subjectId'] !== $subjectId) {
            $validator->errors()->add('mediaId', 'The photo belongs to another crew member.');
        } elseif (! in_array($file['metadata']['kind'], [$kind, 'other'], true)) {
            $validator->errors()->add('mediaId', "The photo was uploaded as {$file['metadata']['kind']}, not {$kind}.");
        }
    }
}
