<?php

use App\Models\User;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Str;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Local, fictional profiles only. The generated credential file is private and ignored by Git.
Artisan::command('quinta:profiles', function () {
    if (! app()->environment('local')) {
        $this->error('Preconfigured profiles are only available in the local environment.');

        return 1;
    }
    $credentials = [];
    foreach (['astronaut' => 'I. Okafor', 'cmo' => 'Dr R. Ibarra'] as $role => $name) {
        $email = $role.'@quinta.local';
        if (User::where('email', $email)->exists()) {
            continue;
        }
        $password = Str::password(24);
        $user = new User;
        $user->forceFill(['name' => $name, 'email' => $email, 'password' => $password, 'role' => $role, 'mission_id' => 'quinta-local-01'])->save();
        $credentials[] = $email.'  '.$password;
    }
    if ($credentials) {
        $path = storage_path('app/private/local-profiles.txt');
        file_put_contents($path, implode(PHP_EOL, $credentials).PHP_EOL, FILE_APPEND | LOCK_EX);
        chmod($path, 0600);
    }
    $this->info('Local profiles are ready. Credentials: storage/app/private/local-profiles.txt (not tracked).');
})->purpose('Create two isolated fictional mission accounts for local sign-in');
