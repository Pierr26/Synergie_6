<?php

use App\Http\Controllers\AppShellController;
use App\Http\Controllers\CrewAccountController;
use App\Http\Controllers\SessionController;
use App\Http\Middleware\NoStoreResponse;
use Illuminate\Support\Facades\Route;

Route::middleware(NoStoreResponse::class)->group(function () {
    Route::get('/login', [SessionController::class, 'create'])->name('login');
    Route::post('/login', [SessionController::class, 'store'])->middleware('throttle:5,1');
    Route::post('/logout', [SessionController::class, 'destroy']);
    Route::middleware('auth')->prefix('account')->group(function () {
        Route::get('/', [CrewAccountController::class, 'index']);
        Route::get('/cases/{case}', [CrewAccountController::class, 'show'])->whereUuid('case');
        Route::get('/cases/{case}/photo', [CrewAccountController::class, 'photo'])->whereUuid('case');
        Route::post('/cases', [CrewAccountController::class, 'store']);
        Route::patch('/cases/{case}', [CrewAccountController::class, 'update'])->whereUuid('case');
        Route::post('/reports', [CrewAccountController::class, 'report']);
        Route::post('/reports/{report}/queue', [CrewAccountController::class, 'queue'])->whereUuid('report');
        Route::get('/{page}', [CrewAccountController::class, 'index'])->where('page', 'today|check-in|symptoms|trends|body|follow-up|reviews|reports|transmission');
    });
});

Route::get('/{view?}', AppShellController::class)
    ->where('view', '(overview|log|symptoms|check-in|measurements|trends|body|follow-up|crew|ground|notifications|reports|help|settings)(/.*)?')
    ->name('app');
