<?php

namespace App\Http\Controllers;

use Illuminate\Http\Response;

/**
 * Serves the single cached document. Every internal view (/overview, /check-in, ...) gets the same
 * shell so a reload works online and, through the service worker, offline.
 */
class AppShellController extends Controller
{
    public function __invoke(): Response
    {
        return response()->view('app')->header('Cache-Control', 'no-cache');
    }
}
