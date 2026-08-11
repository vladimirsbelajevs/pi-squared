#!/usr/bin/env bash

set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${project_root}"

git pull --ff-only
pi update
pi update --extensions
npm install
npm run build

printf 'Source checkout update completed. Stop and rerun the foreground server to use it.\n'
