<?php

namespace App\Services\Lab;

use RuntimeException;

final class LabResultNotFoundException extends RuntimeException
{
    public function __construct()
    {
        parent::__construct('Lab result not found in this workspace.');
    }
}
