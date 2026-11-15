<?php

namespace App\Http\Resources;

use App\Support\MongoJson;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Generic MongoDB document: BSON values converted to JSON, `_id` exposed as `id`.
 *
 * @property-read array<string, mixed> $resource
 */
class DocumentResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $document = MongoJson::normalize($this->resource);

        if (array_key_exists('_id', $document)) {
            $document = ['id' => $document['_id'], ...array_diff_key($document, ['_id' => true])];
        }

        return $document;
    }
}
