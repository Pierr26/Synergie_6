<?php

use App\Http\Controllers\Api\V1\AlertController;
use App\Http\Controllers\Api\V1\AnalysisController;
use App\Http\Controllers\Api\V1\CheckinController;
use App\Http\Controllers\Api\V1\ClockController;
use App\Http\Controllers\Api\V1\ConsoleController;
use App\Http\Controllers\Api\V1\DemoController;
use App\Http\Controllers\Api\V1\ExportController;
use App\Http\Controllers\Api\V1\FollowUpController;
use App\Http\Controllers\Api\V1\GroundLinkController;
use App\Http\Controllers\Api\V1\GroundReportController;
use App\Http\Controllers\Api\V1\HealthController;
use App\Http\Controllers\Api\V1\LabResultController;
use App\Http\Controllers\Api\V1\MediaController;
use App\Http\Controllers\Api\V1\NasaDataController;
use App\Http\Controllers\Api\V1\NotificationController;
use App\Http\Controllers\Api\V1\ObservationController;
use App\Http\Controllers\Api\V1\PlanController;
use App\Http\Controllers\Api\V1\ReportController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->name('api.v1.')->group(function (): void {
    Route::get('health', HealthController::class)->name('health');

    Route::put('reports/{reportId}', [GroundReportController::class, 'update'])
        ->whereUuid('reportId')
        ->name('reports.update');

    Route::get('reports/{reportId}/receipt', [GroundReportController::class, 'receipt'])
        ->whereUuid('reportId')
        ->name('reports.receipt');

    Route::prefix('nasa')->name('nasa.')->controller(NasaDataController::class)->group(function (): void {
        Route::get('hazards', 'hazards')->name('hazards');
        Route::get('hazards/{hazardId}', 'hazard')->name('hazard');
        Route::get('indicators', 'indicators')->name('indicators');
        Route::get('indicators/{indicatorId}', 'indicator')->name('indicator');
        Route::get('osdr/indicators', 'osdrIndicators')->name('osdr.indicators');
        Route::get('osdr/series', 'osdrSeries')->name('osdr.series');
        Route::get('datasets', 'datasets')->name('datasets');
        Route::get('knowledge', 'knowledge')->name('knowledge');
    });

    Route::post('workspaces/demo/reset', [DemoController::class, 'reset'])->name('demo.reset');

    Route::prefix('workspaces/{workspace}')
        ->whereIn('workspace', config('hexta.workspaces'))
        ->middleware('hexta.actor')
        ->name('workspaces.')
        ->group(function (): void {
            Route::get('console', [ConsoleController::class, 'index'])->name('console.index');
            Route::get('console/crew/{crewId}', [ConsoleController::class, 'show'])->name('console.show');

            Route::get('follow-ups', [FollowUpController::class, 'index'])->name('follow-ups.index');
            Route::post('follow-ups', [FollowUpController::class, 'store'])->name('follow-ups.store');
            Route::get('follow-ups/{followUpId}', [FollowUpController::class, 'show'])->name('follow-ups.show');
            Route::post('follow-ups/{followUpId}/responses', [FollowUpController::class, 'respond'])->name('follow-ups.respond');
            Route::post('follow-ups/{followUpId}/close', [FollowUpController::class, 'close'])->name('follow-ups.close');

            Route::post('alerts/{alertId}/reviews', [AlertController::class, 'review'])->name('alerts.review');

            Route::post('reports', [ReportController::class, 'store'])->name('reports.store');
            Route::get('reports/{reportId}', [ReportController::class, 'show'])->whereUuid('reportId')->name('reports.show');
            Route::post('reports/{reportId}/queue', [ReportController::class, 'queue'])->whereUuid('reportId')->name('reports.queue');
            Route::post('reports/{reportId}/send', [ReportController::class, 'send'])->whereUuid('reportId')->name('reports.send');
            Route::get('crew/{crewId}/reports', [ReportController::class, 'forCrewMember'])->name('crew.reports');

            Route::get('ground-link', [GroundLinkController::class, 'show'])->name('ground-link.show');
            Route::put('ground-link', [GroundLinkController::class, 'update'])->name('ground-link.update');

            Route::get('clock', [ClockController::class, 'show'])->name('clock.show');
            Route::post('clock', [ClockController::class, 'update'])->name('clock.update');

            Route::prefix('crew/{crewId}')->name('crew.')->group(function (): void {
                Route::get('plan', [PlanController::class, 'show'])->name('plan');
                Route::post('tasks/{missionDay}/snooze', [PlanController::class, 'snooze'])->whereNumber('missionDay')->name('tasks.snooze');
                Route::post('tasks/{missionDay}/dismiss-banner', [PlanController::class, 'dismissBanner'])->whereNumber('missionDay')->name('tasks.dismiss');
                Route::put('reminder-settings', [PlanController::class, 'settings'])->name('reminder-settings');

                Route::put('checkins/{missionDay}', [CheckinController::class, 'upsert'])->whereNumber('missionDay')->name('checkins.upsert');
                Route::get('checkins/{missionDay}', [CheckinController::class, 'show'])->whereNumber('missionDay')->name('checkins.show');

                Route::get('observations', [ObservationController::class, 'index'])->name('observations.index');
                Route::post('observations', [ObservationController::class, 'store'])->name('observations.store');
                Route::post('observations/{lineageId}/versions', [ObservationController::class, 'correct'])->name('observations.correct');
                Route::get('observations/{lineageId}/versions', [ObservationController::class, 'history'])->name('observations.history');

                Route::get('lab-results', [LabResultController::class, 'index'])->name('lab-results.index');
                Route::post('lab-results', [LabResultController::class, 'store'])->name('lab-results.store');

                Route::get('notifications', [NotificationController::class, 'index'])->name('notifications.index');
                Route::get('export', ExportController::class)->name('export');
            });

            Route::post('lab-results/{lineageId}/versions', [LabResultController::class, 'correct'])->name('lab-results.correct');
            Route::get('lab-results/{lineageId}/versions', [LabResultController::class, 'history'])->name('lab-results.history');
            Route::post('lab-results/{lineageId}/verify', [LabResultController::class, 'verify'])->name('lab-results.verify');
            Route::post('notifications/{notificationId}/read', [NotificationController::class, 'read'])->name('notifications.read');

            Route::post('media', [MediaController::class, 'store'])->name('media.store');
            Route::get('media/{mediaId}', [MediaController::class, 'show'])->whereUuid('mediaId')->name('media.show');

            Route::post('analyses', [AnalysisController::class, 'store'])->middleware('throttle:agent')->name('analyses.store');
            Route::get('analyses/{analysisId}', [AnalysisController::class, 'show'])->whereUuid('analysisId')->name('analyses.show');
            Route::post('analyses/{analysisId}/retry', [AnalysisController::class, 'retry'])->whereUuid('analysisId')->middleware('throttle:agent')->name('analyses.retry');
            Route::get('crew/{crewId}/analyses', [AnalysisController::class, 'forCrewMember'])->name('crew.analyses');
        });
});
