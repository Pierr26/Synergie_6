<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign in · QUINTA</title>
@vite(['resources/css/app.css', 'resources/js/main.ts'])
</head><body><main id="main" class="auth-main"><a href="/"><img src="/assets/brand/quinta-logo.svg" width="160" height="44" alt="QUINTA"></a>
<section class="card"><span class="mission-kicker">YOUR MISSION WORKSPACE</span><h1>Welcome on board.</h1><p>Sign in with your assigned crew account. Your mission and role are set by the account.</p>
@if($errors->any())<p role="alert" class="error">{{ $errors->first() }}</p>@endif
<form action="/login" method="post">@csrf
<div class="field"><label for="email">Email</label><input id="email" type="email" name="email" autocomplete="username" value="{{ old('email') }}" required autofocus></div>
<div class="field"><label for="password">Password</label><input id="password" type="password" name="password" autocomplete="current-password" required></div>
<button class="btn btn-primary" type="submit">Sign in</button></form>
<p class="fine">Accounts are assigned by your mission team. Invitation-based account creation is planned next.</p></section>
<p><a href="/">Return to Start demo</a> · no account needed</p></main></body></html>
