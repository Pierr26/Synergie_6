#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -f vendor/autoload.php || ! -d node_modules ]]; then
  echo 'Install dependencies first: composer install && npm ci'
  exit 1
fi
if [[ ! -f .env ]]; then
  cp .env.example .env
  php artisan key:generate
fi
mkdir -p storage/framework/{cache/data,sessions,views} storage/logs tests/Unit
touch database/database.sqlite
php artisan migrate --force
php artisan quinta:profiles
npm run build
printf '\nQUINTA preview: http://localhost:8001\n'
exec php artisan serve --host=127.0.0.1 --port=8001
