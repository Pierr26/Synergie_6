<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Ground receiver
    |--------------------------------------------------------------------------
    |
    | Name written in every receipt so the crew can see which receiver
    | acknowledged a report (cahier des charges p.17 et p.21).
    |
    */

    'receiver_name' => env('HEXTA_RECEIVER_NAME', 'MongoDB Atlas ground receiver'),

    /*
    |--------------------------------------------------------------------------
    | Workspaces
    |--------------------------------------------------------------------------
    |
    | "explore" = Explore app (real mission clock), "demo" = Start demo
    | (controlled clock, SLEEP-001 demo rule). Data never crosses workspaces.
    |
    */

    'workspaces' => ['explore', 'demo'],

    'identity' => [
        'required' => (bool) env('HEXTA_REQUIRE_ACTOR', false),
        'header' => 'X-Hexta-Actor',
    ],

    /*
    |--------------------------------------------------------------------------
    | SLEEP-001 v1 (demo rule)
    |--------------------------------------------------------------------------
    */

    'sleep_rule' => [
        'id' => 'SLEEP-001',
        'version' => 1,
        'threshold_minutes' => 360,
        'consecutive_days' => 3,
        'method' => 'sleep_diary',
        'baseline_min_nights' => 7,
    ],

    /*
    |--------------------------------------------------------------------------
    | Daily check-in reminder
    |--------------------------------------------------------------------------
    */

    'reminder' => [
        'default_time' => '07:00',
        'snooze_minutes' => 30,
    ],

    /*
    |--------------------------------------------------------------------------
    | Health vision agent (Claude)
    |--------------------------------------------------------------------------
    |
    | Photo and webcam analyses. The agent only produces AI-assisted
    | estimates that the CMO reviews: it never diagnoses or prescribes.
    |
    */

    'agent' => [
        'model' => env('HEXTA_AGENT_MODEL', 'claude-opus-5-5'),
        'effort' => env('HEXTA_AGENT_EFFORT', 'high'),
        'max_tokens' => (int) env('HEXTA_AGENT_MAX_TOKENS', 16000),
        'max_tool_rounds' => 6,
        'timeout_seconds' => (int) env('HEXTA_AGENT_TIMEOUT', 120),
        'prompt_version' => 'vision-agent-2026-11-14.1',
    ],

    'media' => [
        'bucket' => 'media',
        'max_kilobytes' => 8192,
        'max_dimension' => 1568,
        'jpeg_quality' => 88,
    ],

    /*
    | Atlas Search ($search) on knowledge_documents. When false (plain
    | MongoDB without Atlas Search), the agent falls back to a $text index.
    */

    'atlas_search' => [
        'enabled' => (bool) env('HEXTA_ATLAS_SEARCH', false),
        'index' => 'knowledge_search',
    ],

    /*
    |--------------------------------------------------------------------------
    | API documentation (Scramble + Swagger UI)
    |--------------------------------------------------------------------------
    |
    | /docs/api (Stoplight Elements), /docs/swagger (Swagger UI) and
    | /docs/api.json (OpenAPI 3.1). Outside APP_ENV=local, Scramble only
    | serves them when this flag is true. All data is simulated crew data.
    |
    */

    'api_docs' => [
        'public' => (bool) env('HEXTA_API_DOCS_PUBLIC', true),
    ],

];
