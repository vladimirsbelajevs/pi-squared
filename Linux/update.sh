#!/usr/bin/env bash

set -euo pipefail

no_restart=false
for argument in "$@"; do
  case "${argument}" in
    --no-restart)
      no_restart=true
      ;;
    *)
      printf 'Usage: %s [--no-restart]\n' "$0" >&2
      exit 2
      ;;
  esac
done

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${project_root}"

git pull --ff-only
pi update
pi update --extensions
npm install
npm run build

if [[ "${no_restart}" == true ]]; then
  printf 'Update completed without restarting the application.\n'
  exit 0
fi

set +e
"${project_root}/Linux/restart-service.sh"
restart_status=$?
set -e
if (( restart_status == 3 )); then
  printf 'Update completed; no registered user service was restarted.\n'
  exit 0
fi
if (( restart_status != 0 )); then
  exit "${restart_status}"
fi
