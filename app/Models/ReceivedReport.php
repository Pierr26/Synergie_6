<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A report snapshot accepted by the Laravel test receiver.
 *
 * @property string $report_id
 * @property string $content_sha256
 * @property string $content
 * @property string $receipt_id
 * @property \Illuminate\Support\Carbon $received_at
 */
class ReceivedReport extends Model
{
    protected $primaryKey = 'report_id';

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = ['report_id', 'content_sha256', 'content', 'receipt_id', 'received_at'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['received_at' => 'datetime'];
    }
}
