<?php

namespace App\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Support\Facades\DB;
use Illuminate\Translation\PotentiallyTranslatedString;

/**
 * The value must be the crewId of a member of the given workspace,
 * optionally with a given role (astronaut or cmo).
 */
class CrewMemberOf implements ValidationRule
{
    public function __construct(private readonly string $workspaceId, private readonly ?string $role = null) {}

    /**
     * @param  Closure(string, ?string=): PotentiallyTranslatedString  $fail
     */
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        $exists = is_string($value) && DB::connection('mongodb')->getCollection('crew_members')
            ->countDocuments(array_filter(['workspaceId' => $this->workspaceId, 'crewId' => $value, 'role' => $this->role]), ['limit' => 1]) > 0;

        if (! $exists) {
            $fail($this->role === null
                ? "The :attribute is not a crew member of the {$this->workspaceId} workspace."
                : "The :attribute must be a {$this->role} of the {$this->workspaceId} workspace.");
        }
    }
}
