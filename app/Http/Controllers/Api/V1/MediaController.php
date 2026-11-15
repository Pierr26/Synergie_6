<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreMediaRequest;
use App\Services\Media\MediaStore;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;
use InvalidArgumentException;

class MediaController extends Controller
{
    /**
     * Upload a health photo.
     *
     * Multipart upload (JPEG, PNG or WebP, 8 MB max). The image is re-encoded as JPEG without EXIF or GPS data, 1568
     * px at most, and stored in GridFS. Use the returned id as `mediaId` in `POST /analyses`.
     */
    public function store(StoreMediaRequest $request, string $workspace, MediaStore $media): JsonResponse
    {
        try {
            $stored = $media->store($request->file('file'), [
                'workspaceId' => $workspace,
                ...$request->safe()->only(['kind', 'subjectId', 'uploadedBy', 'capturedAt', 'bodySite']),
            ]);
        } catch (InvalidArgumentException $exception) {
            return response()->json(['message' => $exception->getMessage(), 'errors' => ['file' => [$exception->getMessage()]]], 422);
        }

        return response()->json($stored, 201);
    }

    /**
     * Download a stored photo.
     *
     * Returns the re-encoded JPEG with its SHA-256 in the `X-Content-SHA256` header. 404 when the photo is not in
     * this workspace.
     */
    public function show(string $workspace, string $mediaId, MediaStore $media): Response
    {
        $file = $media->find($workspace, $mediaId);

        abort_if($file === null, 404, 'Photo not found in this workspace.');

        return response($file['bytes'], 200, [
            'Content-Type' => 'image/jpeg',
            'Cache-Control' => 'private, max-age=3600',
            'X-Content-SHA256' => $file['metadata']['sha256'],
        ]);
    }
}
