<?php

use App\Http\Controllers\Api\ReportReceiverController;
use Illuminate\Support\Facades\Route;

Route::put('/v1/reports/{reportId}', [ReportReceiverController::class, 'update'])
    ->whereUuid('reportId')
    ->name('api.reports.update');
