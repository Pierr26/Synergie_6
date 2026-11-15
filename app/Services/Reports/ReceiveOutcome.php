<?php

namespace App\Services\Reports;

/**
 * Result of a PUT /api/v1/reports/{reportId} call.
 */
final readonly class ReceiveOutcome
{
    public const string Created = 'created';

    public const string Replayed = 'replayed';

    public const string Conflict = 'conflict';

    /**
     * @param  array{receiptId: string, reportId: string, receiver: string, receivedAt: string, sha256: string}  $receipt
     */
    public function __construct(
        public string $kind,
        public array $receipt,
        public ?string $submittedSha256 = null,
    ) {}

    public function httpStatus(): int
    {
        return match ($this->kind) {
            self::Created => 201,
            self::Replayed => 200,
            self::Conflict => 409,
        };
    }
}
