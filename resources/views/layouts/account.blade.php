<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#075b52"><title>@yield('title', 'Mission workspace') · HEXTA</title>
    <link rel="icon" href="/assets/brand/favicon-32.png">
    @vite(['resources/css/app.css', 'resources/js/main.ts'])
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<div class="account-app" data-account-user="{{ $user->id }}" data-account-mission="{{ $user->mission_id }}">
    <aside class="account-side"><a class="brand" href="/account"><img src="/assets/brand/hexta-logo.svg" width="40" height="48" alt="HEXTA"></a>
        <span class="mission-kicker">{{ $user->role === 'cmo' ? 'CREW MEDICAL OFFICER' : 'ASTRONAUT' }}</span>
        <nav aria-label="Main navigation">
            @php($nav = $user->role === 'cmo' ? ['reviews'=>'Review queue','reports'=>'Reports','transmission'=>'Ground transmission','trends'=>'Trends','body'=>'Body & Risks'] : ['today'=>'Today','check-in'=>'Daily Check-in','trends'=>'Trends','body'=>'Body & Risks','symptoms'=>'Report a Symptom','follow-up'=>'Follow-up'])
            @foreach($nav as $key => $label)<a href="/account/{{ $key }}" @if(($page ?? '') === $key) aria-current="page" @endif>{{ $label }}</a>@endforeach
        </nav>
    </aside>
    <main id="main" class="account-content">
        <header class="account-head"><div><span class="mission-kicker">MISSION {{ $user->mission_id }}</span><h1>@yield('title', 'Mission workspace')</h1><p>{{ $user->name }} · {{ $user->role === 'cmo' ? 'Crew medical officer' : 'Astronaut' }}</p></div>
            <form action="/logout" method="post">@csrf<button class="btn btn-ghost">Sign out</button></form>
        </header>
        <p class="account-banner">Connected workspace · your account determines your role and mission. Demo records are kept separately.</p>
        @if(session('saved'))<p class="account-banner" role="status">{{ session('saved') }}</p>@endif
        @if($errors->any())<div class="account-banner" role="alert"><b>Please check these fields</b><ul>@foreach($errors->all() as $error)<li>{{ $error }}</li>@endforeach</ul></div>@endif
        @yield('content')
        <p class="fine">HEXTA · Synergy 5 · NASA Space Apps Challenge prototype. Local profiles use fictional crew data. No automated image analysis.</p>
    </main>
</div>
<div id="status-region" class="sr-only" role="status" aria-live="polite"></div>
@if(session('submitted_draft'))<span hidden data-clear-account-draft="{{ session('submitted_draft') }}"></span>@endif
</body>
</html>
