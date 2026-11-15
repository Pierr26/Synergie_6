<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\DocumentResource;
use App\Rules\CrewMemberOf;
use App\Services\Notifications\NotificationCenter;
use App\Services\Workspace\WorkspaceClock;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Validator;
use MongoDB\BSON\UTCDateTime;

class NotificationController extends Controller
{
    /**
     * List the notifications of a crew member.
     *
     * Bell content, with `unreadActive` for the unread badge.
     */
    public function index(string $workspace, string $crewId, NotificationCenter $notifications): JsonResponse
    {
        Validator::make(['crewId' => $crewId], ['crewId' => [new CrewMemberOf($workspace)]])->validate();
        $inbox = $notifications->inbox($workspace, $crewId);

        return response()->json(['data' => DocumentResource::collection($inbox['items']), 'unreadActive' => $inbox['unreadActive']]);
    }

    /**
     * Mark a notification as read.
     *
     * 404 when the notification is not in this workspace.
     */
    public function read(string $workspace, string $notificationId, NotificationCenter $notifications, WorkspaceClock $clock): JsonResponse
    {
        abort_unless($notifications->markRead($workspace, $notificationId, new UTCDateTime($clock->now($workspace))), 404, 'Notification not found.');

        return response()->json(['status' => 'read']);
    }
}
