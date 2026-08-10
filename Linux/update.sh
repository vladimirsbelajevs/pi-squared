#!/usr/bin/env bash

set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
service_name='pi-squared.service'
service_file="${HOME}/.config/systemd/user/${service_name}"
cd "${project_root}"

git pull --ff-only
pi update
pi update --extensions
npm install
npm run build

if [[ -f "${service_file}" ]] || {
  command -v systemctl >/dev/null 2>&1 && systemctl --user cat "${service_name}" >/dev/null 2>&1
}; then
  systemctl --user restart "${service_name}"
  printf 'Restarted registered user service %s.\n' "${service_name}"
fi
