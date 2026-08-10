#!/usr/bin/env bash

set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

"${project_root}/pi_setup/Linux/pi-install.sh"
cd "${project_root}"
npm install
npm run build
