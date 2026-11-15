<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Login · Crew health</title>
<script>
    // Same light/dark choice as the home page (stored there), otherwise the system preference.
    try {
        const theme = localStorage.getItem('quinta.home-theme');
        if (theme === 'light' || theme === 'dark') document.documentElement.dataset.authTheme = theme;
    } catch {}
</script>
@vite(['resources/css/app.css', 'resources/js/main.ts'])
</head><body><main id="main" class="auth-photo">
<a class="auth-home" href="/">Crew health</a>
<section class="auth-card" aria-labelledby="auth-title">
<h1 id="auth-title">Login</h1>
@if($errors->any())<p role="alert" class="error">{{ $errors->first() }}</p>@endif
<form action="/login" method="post">@csrf
<div class="field"><label for="email">Identifier</label><input id="email" type="email" name="email" autocomplete="username" value="{{ old('email') }}" required autofocus></div>
<div class="field"><label for="password">Password</label>
<div class="auth-password"><input id="password" type="password" name="password" autocomplete="current-password" required>
<button type="button" class="auth-reveal" aria-controls="password" aria-pressed="false">Show</button></div></div>
<button class="btn btn-primary auth-submit" type="submit">Sign in</button></form></section>
<p class="auth-credit"><a href="https://images.nasa.gov/details/art002e021007" rel="noopener"><span>Artemis II · 6 April 2026</span> Earthset over the far side of the Moon · NASA</a></p>
</main>
<script>
    // Show or hide the password without losing focus or the cursor position.
    const reveal = document.querySelector('.auth-reveal');
    const password = document.getElementById('password');
    reveal.addEventListener('click', () => {
        const shown = password.type === 'text';
        password.type = shown ? 'password' : 'text';
        reveal.textContent = shown ? 'Show' : 'Hide';
        reveal.setAttribute('aria-pressed', String(!shown));
        password.focus();
    });
</script>
</body></html>
