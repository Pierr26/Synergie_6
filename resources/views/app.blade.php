<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#075b52">
    <meta name="description" content="HEXTA — crew health check-in, on-board medical review and ground reports that keep working when the ground link drops.">
    <title>HEXTA · Crew health</title>
    <link rel="icon" href="/assets/brand/favicon-32.png" sizes="32x32">
    <link rel="apple-touch-icon" href="/assets/brand/hexta-icone-app-180.png">
    <link rel="manifest" href="/manifest.webmanifest">
    @vite(['resources/css/app.css', 'resources/js/main.ts'])
    @if(request()->is('/'))
        @include('partials.entry-transition')
    @endif
</head>
<body>
    <a class="skip-link" href="#main">Skip to content</a>
    <div id="app" data-booting="true">
        @if(request()->is('/'))
            <div class="home" aria-hidden="true"></div>
        @else
            <p class="boot" role="status">Loading crew health…</p>
        @endif
    </div>
    <div id="status-region" class="sr-only" role="status" aria-live="polite"></div>
    <div id="toast-host" class="toast-host" aria-hidden="true"></div>
    <noscript>
        <p class="noscript">HEXTA needs JavaScript to run on this device. Simulated crew data.</p>
    </noscript>
</body>
</html>
