<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#075b52">
    <meta name="description" content="QUINTA — crew health check-in, on-board medical review and ground reports that keep working when the ground link drops.">
    <title>QUINTA · Crew health</title>
    <link rel="icon" href="/assets/brand/favicon-32.png" sizes="32x32">
    <link rel="apple-touch-icon" href="/assets/brand/quinta-icone-app-180.png">
    <link rel="manifest" href="/manifest.webmanifest">
    @vite(['resources/css/app.css', 'resources/js/main.ts'])
</head>
<body>
    <a class="skip-link" href="#main">Skip to content</a>
    <div id="app" data-booting="true">
        <div class="boot">
            <img src="/assets/brand/quinta-logo.svg" alt="QUINTA" width="180" height="50">
            <p>Loading crew health… Simulated crew data.</p>
        </div>
    </div>
    <div id="status-region" class="sr-only" role="status" aria-live="polite"></div>
    <div id="toast-host" class="toast-host" aria-hidden="true"></div>
    <noscript>
        <p class="noscript">QUINTA needs JavaScript to run on this device. Simulated crew data.</p>
    </noscript>
</body>
</html>
