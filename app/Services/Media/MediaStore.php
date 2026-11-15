<?php

namespace App\Services\Media;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use InvalidArgumentException;
use MongoDB\BSON\UTCDateTime;
use MongoDB\GridFS\Bucket;

/**
 * Crew photos stored in MongoDB GridFS (bucket "media").
 *
 * Every upload is decoded and re-encoded as JPEG: this strips EXIF/GPS
 * metadata, bounds the size sent to the vision model and rejects files
 * that are not real images. Metadata keeps the workspace so photos never
 * cross between Explore app and Start demo.
 */
final class MediaStore
{
    /** @var list<string> */
    public const array Kinds = ['urine_color', 'skin_rash', 'other'];

    /** Decoding is refused above this size to bound memory use. */
    private const int MaxPixels = 40_000_000;

    /**
     * @param  array{workspaceId: string, subjectId: string, kind: string, uploadedBy: string, capturedAt?: ?string, bodySite?: ?string}  $metadata
     * @return array{mediaId: string, sha256: string, width: int, height: int, bytes: int, contentType: string}
     */
    public function store(UploadedFile $file, array $metadata): array
    {
        [$jpeg, $width, $height] = $this->normalize((string) file_get_contents($file->getRealPath()));

        $mediaId = (string) Str::uuid();
        $sha256 = hash('sha256', $jpeg);
        $stream = fopen('php://temp', 'w+b');
        fwrite($stream, $jpeg);
        rewind($stream);

        $this->bucket()->uploadFromStream("{$mediaId}.jpg", $stream, [
            '_id' => $mediaId,
            'metadata' => [
                ...$metadata,
                'contentType' => 'image/jpeg',
                'sha256' => $sha256,
                'width' => $width,
                'height' => $height,
                'originalContentType' => $file->getMimeType(),
                'exifStripped' => true,
                'uploadedAt' => new UTCDateTime(now('UTC')),
            ],
        ]);

        fclose($stream);

        return [
            'mediaId' => $mediaId,
            'sha256' => $sha256,
            'width' => $width,
            'height' => $height,
            'bytes' => strlen($jpeg),
            'contentType' => 'image/jpeg',
        ];
    }

    /**
     * @return array{bytes: string, metadata: array<string, mixed>}|null
     */
    public function find(string $workspaceId, string $mediaId): ?array
    {
        $file = $this->bucket()->findOne(
            ['_id' => $mediaId, 'metadata.workspaceId' => $workspaceId],
            ['typeMap' => ['root' => 'array', 'document' => 'array', 'array' => 'array']],
        );

        if ($file === null) {
            return null;
        }

        $stream = $this->bucket()->openDownloadStream($mediaId);
        $bytes = (string) stream_get_contents($stream);
        fclose($stream);

        return ['bytes' => $bytes, 'metadata' => $file['metadata']];
    }

    /**
     * @return array{0: string, 1: int, 2: int}
     */
    private function normalize(string $bytes): array
    {
        $size = @getimagesizefromstring($bytes);

        if ($size === false) {
            throw new InvalidArgumentException('The file is not a readable image.');
        }

        if ($size[0] * $size[1] > self::MaxPixels) {
            throw new InvalidArgumentException('The image is larger than 40 megapixels.');
        }

        $image = @imagecreatefromstring($bytes);

        if ($image === false) {
            throw new InvalidArgumentException('The file is not a readable image.');
        }

        $image = $this->applyExifOrientation($image, $bytes);
        $width = imagesx($image);
        $height = imagesy($image);
        $maxDimension = (int) config('hexta.media.max_dimension');
        $scale = min(1.0, $maxDimension / max($width, $height));

        if ($scale < 1.0) {
            $resized = imagescale($image, (int) round($width * $scale), (int) round($height * $scale), IMG_BICUBIC);
            imagedestroy($image);
            $image = $resized;
            $width = imagesx($image);
            $height = imagesy($image);
        }

        ob_start();
        imagejpeg($image, null, (int) config('hexta.media.jpeg_quality'));
        $jpeg = (string) ob_get_clean();
        imagedestroy($image);

        return [$jpeg, $width, $height];
    }

    /**
     * Phone photos are often stored sideways with an EXIF orientation flag;
     * the flag is lost on re-encoding, so the rotation is applied first.
     */
    private function applyExifOrientation(\GdImage $image, string $bytes): \GdImage
    {
        if (! function_exists('exif_read_data') || ! str_starts_with($bytes, "\xFF\xD8")) {
            return $image;
        }

        $exif = @exif_read_data('data://image/jpeg;base64,'.base64_encode($bytes));
        $angle = match ((int) ($exif['Orientation'] ?? 1)) {
            3 => 180,
            6 => -90,
            8 => 90,
            default => 0,
        };

        return $angle === 0 ? $image : (imagerotate($image, $angle, 0) ?: $image);
    }

    private function bucket(): Bucket
    {
        return DB::connection('mongodb')->getDatabase()->selectGridFSBucket([
            'bucketName' => config('hexta.media.bucket'),
        ]);
    }
}
