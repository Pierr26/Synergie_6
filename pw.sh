#!/bin/sh
# Run a command in the local browser image (node:22 + Debian Chromium), as the current user, host network.
# Build once: docker build -t quinta-browser -f tools/docker/Dockerfile.browser tools/docker
exec docker run --rm -i -u "$(id -u):$(id -g)" -e HOME=/tmp/home -e BASE="${BASE:-http://127.0.0.1:8000}" -e QUINTA_URL="${BASE:-http://127.0.0.1:8000}" -v "$PWD":/app -w /app --network host --ipc=host quinta-browser "$@"
