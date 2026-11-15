<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\ReminderSettingsRequest;
use App\Http\Resources\DocumentResource;
use App\Rules\CrewMemberOf;
use App\Services\Reminders\ReminderEngine;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Validator;

class PlanController extends Controller
{
    /**
     * Read today's plan, the reminder banner and the history.
     *
     * Call it when the app opens, when it comes back to the foreground and at the reminder due time.
     */
    public function show(string $workspace, string $crewId, ReminderEngine $reminders): JsonResponse
    {
        $this->assertAstronaut($workspace, $crewId);

        return $this->respond($reminders->plan($workspace, $crewId));
    }

    /**
     * Snooze today's reminder for 30 minutes.
     *
     * Only today's open reminder can be snoozed, and only if the new time stays within the same mission day (409
     * otherwise). Returns the updated plan.
     */
    public function snooze(string $workspace, string $crewId, int $missionDay, ReminderEngine $reminders): JsonResponse
    {
        $this->assertAstronaut($workspace, $crewId);

        return $this->respond($reminders->snooze($workspace, $crewId, $missionDay));
    }

    /**
     * Hide the reminder banner.
     *
     * Hides the banner for the current due time only, while the reminder is due (409 otherwise). Returns the updated
     * plan.
     */
    public function dismissBanner(string $workspace, string $crewId, int $missionDay, ReminderEngine $reminders): JsonResponse
    {
        $this->assertAstronaut($workspace, $crewId);

        return $this->respond($reminders->dismissBanner($workspace, $crewId, $missionDay));
    }

    /**
     * Change the daily reminder settings.
     *
     * Turns the check-in reminder on or off and sets its time (`HH:MM`). Returns the updated plan.
     */
    public function settings(ReminderSettingsRequest $request, string $workspace, string $crewId, ReminderEngine $reminders): JsonResponse
    {
        $this->assertAstronaut($workspace, $crewId);

        return $this->respond($reminders->updateSettings($workspace, $crewId, $request->boolean('enabled'), $request->string('time')->toString()));
    }

    /**
     * @param  array{clock: array<string, mixed>, today: array<string, mixed>, banner: array<string, mixed>, history: list<array<string, mixed>>}  $plan
     */
    private function respond(array $plan): JsonResponse
    {
        return response()->json(['data' => [
            'clock' => $plan['clock'],
            'today' => DocumentResource::make($plan['today']),
            'banner' => $plan['banner'],
            'history' => DocumentResource::collection($plan['history']),
        ]]);
    }

    private function assertAstronaut(string $workspace, string $crewId): void
    {
        Validator::make(['crewId' => $crewId], ['crewId' => [new CrewMemberOf($workspace, 'astronaut')]])->validate();
    }
}
