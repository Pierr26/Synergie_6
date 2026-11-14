<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CrewReport extends Model
{
    public $incrementing = false;

    protected $keyType = 'string';

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['snapshot' => 'array', 'queued_at' => 'datetime'];
    }
}
