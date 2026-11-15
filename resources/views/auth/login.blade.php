<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#075b52">
    <title>Sign in · HEXTA</title>
    @vite(['resources/css/app.css', 'resources/js/main.ts'])
    @include('partials.entry-transition')
</head>
<body>
    <div class="home">
        <main id="main" class="home-shell auth-main">
            <section class="auth-card" aria-labelledby="sign-in-title">
                <span class="mission-kicker">YOUR MISSION WORKSPACE</span>
                <h1 id="sign-in-title">Welcome on board.</h1>
                <p>Sign in with your assigned crew account. Your mission and role are set by the account.</p>
                @if($errors->any())
                    <p role="alert" class="error">{{ $errors->first() }}</p>
                @endif
                <form action="/login" method="post">
                    @csrf
                    <div class="field">
                        <label for="email">Email</label>
                        <input id="email" type="email" name="email" autocomplete="username" value="{{ old('email') }}" required>
                    </div>
                    <div class="field">
                        <label for="password">Password</label>
                        <input id="password" type="password" name="password" autocomplete="current-password" required>
                    </div>
                    <button class="home-enter" type="submit">Sign in</button>
                </form>
                <p class="fine">Accounts are assigned by your mission team. Invitation-based account creation is planned next.</p>
                <a class="auth-return" href="/">Back to home</a>
            </section>
        </main>
    </div>
</body>
</html>
