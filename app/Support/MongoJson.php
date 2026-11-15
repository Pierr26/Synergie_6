<?php

namespace App\Support;

use MongoDB\BSON\ObjectId;
use MongoDB\BSON\UTCDateTime;

/**
 * Converts BSON values in a decoded document to plain JSON values
 * (UTC dates as ISO-8601 strings, ObjectIds as strings).
 */
final class MongoJson
{
    public static function normalize(mixed $value): mixed
    {
        return match (true) {
            $value instanceof UTCDateTime => $value->toDateTime()->format('Y-m-d\TH:i:s.v\Z'),
            $value instanceof ObjectId => (string) $value,
            is_array($value) => array_map(self::normalize(...), $value),
            default => $value,
        };
    }
}
