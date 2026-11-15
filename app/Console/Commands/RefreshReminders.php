<?php

namespace App\Console\Commands;

use App\Services\Reminders\ReminderEngine;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use MongoDB\Collection;

#[Signature('hexta:refresh-reminders')]
#[Description('Refresh daily check-in reminders and mark missed tasks')]
class RefreshReminders extends Command
{
    public function handle(ReminderEngine $reminders): int
    {
        foreach (config('hexta.workspaces') as $workspace) {
            foreach ($this->members()->find(['workspaceId' => $workspace, 'role' => 'astronaut'], [
                'projection' => ['crewId' => 1],
            ]) as $member) {
                $reminders->plan($workspace, (string) $member['crewId']);
            }
        }

        return self::SUCCESS;
    }

    private function members(): Collection
    {
        return DB::connection('mongodb')->getCollection('crew_members');
    }
}
