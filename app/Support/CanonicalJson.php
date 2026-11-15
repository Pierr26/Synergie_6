<?php

namespace App\Support;

/**
 * Deterministic JSON serialisation used to fingerprint report payloads.
 *
 * Object keys are sorted recursively, list order is preserved, slashes and
 * unicode are left unescaped. Two payloads with the same meaning therefore
 * produce the same SHA-256, whatever the key order sent by the client.
 */
final class CanonicalJson
{
    public static function encode(mixed $value): string
    {
        return json_encode(
            self::normalize($value),
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR,
        );
    }

    public static function sha256(mixed $value): string
    {
        return hash('sha256', self::encode($value));
    }

    private static function normalize(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }

        if (array_is_list($value)) {
            return array_map(self::normalize(...), $value);
        }

        ksort($value, SORT_STRING);

        return (object) array_map(self::normalize(...), $value);
    }
}
