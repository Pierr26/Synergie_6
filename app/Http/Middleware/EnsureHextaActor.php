<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

final class EnsureHextaActor
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! config('hexta.identity.required', false)) {
            return $next($request);
        }

        $workspace = (string) $request->route('workspace');
        $actorId = (string) $request->header('X-Hexta-Actor');

        if ($actorId === '') {
            return response()->json(['message' => 'X-Hexta-Actor is required.'], 401);
        }

        $actor = DB::connection('mongodb')->getCollection('crew_members')->findOne([
            'workspaceId' => $workspace,
            'crewId' => $actorId,
        ], ['typeMap' => ['root' => 'array', 'document' => 'array', 'array' => 'array']]);

        if ($actor === null) {
            return response()->json(['message' => 'The actor is not a member of this workspace.'], 403);
        }

        $request->attributes->set('hextaActor', $actor);

        return $next($request);
    }
}
