#!/usr/bin/env bash

set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${project_root}"

printf 'Pi Squared is running at http://127.0.0.1:3049. Press Ctrl+C to stop.\n'
exec npm run start
