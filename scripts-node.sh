#!/bin/sh
# Run a Node command inside the official node:22 image, as the current user, in the project root.
exec docker run --rm -i -u "$(id -u):$(id -g)" -e HOME=/tmp/home -e npm_config_cache=/tmp/npm-cache -v "$PWD":/app -w /app --network host node:22-bookworm "$@"
