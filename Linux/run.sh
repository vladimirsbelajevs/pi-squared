#!/usr/bin/env bash

set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${project_root}"

server_pid=""

stop_server() {
  if [[ -n "${server_pid}" ]] && kill -0 "${server_pid}" 2>/dev/null; then
    kill -TERM -- "-${server_pid}" 2>/dev/null || true
    wait "${server_pid}" 2>/dev/null || true
  fi
}

trap stop_server EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

setsid npm run start &
server_pid=$!

echo "Press Esc or Ctrl+C to stop the server."

while kill -0 "${server_pid}" 2>/dev/null; do
  if IFS= read -rsn1 -t 0.2 key && [[ "${key}" == $'\e' ]]; then
    exit 0
  fi
done

if wait "${server_pid}"; then
  status=0
else
  status=$?
fi
server_pid=""
exit "${status}"
