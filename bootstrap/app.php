<?php

use App\Http\Middleware\EnsureHextaActor;
use App\Services\Checkins\CheckinException;
use App\Services\FollowUps\FollowUpException;
use App\Services\Lab\LabResultException;
use App\Services\Lab\LabResultNotFoundException;
use App\Services\Observations\ObservationConflictException;
use App\Services\Reminders\ReminderActionException;
use App\Services\Reports\ReportException;
use App\Services\Workspace\ControlledClockException;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use MongoDB\Driver\Exception\ConnectionException;
use MongoDB\Driver\Exception\ServerException;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withSchedule(function (Schedule $schedule): void {
        $schedule->command('hexta:refresh-reminders')->everyMinute();
    })
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias(['hexta.actor' => EnsureHextaActor::class]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );

        $exceptions->render(fn (CheckinException|FollowUpException|ReportException|ReminderActionException|LabResultException|ObservationConflictException|ControlledClockException $exception) => response()->json(
            ['message' => $exception->getMessage()],
            409,
        ));

        $exceptions->render(fn (LabResultNotFoundException $exception) => response()->json(['message' => $exception->getMessage()], 404));

        $exceptions->render(function (ConnectionException|ServerException $exception, Request $request) {
            if ($request->is('api/*')) {
                return response()->json([
                    'message' => 'Ground receiver storage is unavailable. Keep the report queued and retry.',
                    'retryable' => true,
                ], 503);
            }
        });
    })->create();
