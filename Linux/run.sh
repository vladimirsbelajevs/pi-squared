#!/usr/bin/env bash

set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
service_name='pi-squared.service'
service_file="${HOME}/.config/systemd/user/${service_name}"
service_mode=false

if [[ "${1:-}" == '--service' ]]; then
  service_mode=true
  shift
fi

if (( $# > 0 )); then
  printf 'Usage: %s [--service]\n' "${BASH_SOURCE[0]}" >&2
  exit 2
fi

if [[ "${service_mode}" == false ]] && {
  [[ -f "${service_file}" ]] || {
    command -v systemctl >/dev/null 2>&1 && systemctl --user cat "${service_name}" >/dev/null 2>&1
  }
}; then
  printf 'Service %s is registered; not starting a duplicate server.\n' "${service_name}"
  printf 'Inspect it with: systemctl --user status %s\n' "${service_name}"
  printf 'Manage it with: systemctl --user start %s; systemctl --user stop %s; systemctl --user restart %s\n' \
    "${service_name}" "${service_name}" "${service_name}"
  exit 0
fi

cd "${project_root}"

server_pid=''

stop_server() {
  if [[ -n "${server_pid}" ]] && kill -0 "${server_pid}" 2>/dev/null; then
    if ! kill -TERM -- "-${server_pid}" 2>/dev/null; then
      kill -TERM "${server_pid}" 2>/dev/null || true
    fi
    wait "${server_pid}" 2>/dev/null || true
  fi
}

trap stop_server EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

setsid npm run start &
server_pid=$!

if [[ "${service_mode}" == true ]]; then
  printf 'Running Pi Squared from user service %s.\n' "${service_name}"
  if wait "${server_pid}"; then
    status=0
  else
    status=$?
  fi
else
  printf 'Press Esc or Ctrl+C to stop the server.\n'

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
fi

server_pid=''
exit "${status}"
