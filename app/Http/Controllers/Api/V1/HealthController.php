<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Throwable;

class HealthController extends Controller
{
    /**
     * Check the API and its databases.
     *
     * Pings the board and ground MongoDB connections so the client can show the receiver state. Returns 503 with
     * `database: unreachable` when either one is down.
     */
    public function __invoke(): JsonResponse
    {
        try {
            DB::connection('mongodb')->getDatabase()->command(['ping' => 1]);
            DB::connection('ground')->getDatabase()->command(['ping' => 1]);
        } catch (Throwable) {
            return response()->json(['receiver' => config('hexta.receiver_name'), 'database' => 'unreachable'], 503);
        }

        return response()->json([
            'receiver' => config('hexta.receiver_name'),
            'database' => 'ok',
            'serverTime' => now('UTC')->toIso8601ZuluString('millisecond'),
        ]);
    }
}
