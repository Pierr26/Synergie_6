<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class CrewCase extends Model
{
    public $incrementing = false;

    protected $keyType = 'string';

    protected $guarded = ['id'];

    protected $hidden = ['photo_path'];

    protected function casts(): array
    {
        return ['data' => 'array', 'thread' => 'array'];
    }

    public function crew(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    public function statusLabel(): string
    {
        return match ($this->status) {
            'follow-up' => 'Follow-up requested',
            'answered' => 'Response received',
            'reviewed' => 'Reviewed',
            default => 'Crew review pending',
        };
    }
}
