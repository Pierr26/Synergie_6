<?php

use App\Http\Controllers\AppShellController;
use Illuminate\Support\Facades\Route;

Route::get('/{view?}', AppShellController::class)
    ->where('view', '(overview|check-in|measurements|trends|body|follow-up|crew|notifications|reports|help|settings)(/.*)?')
    ->name('app');
