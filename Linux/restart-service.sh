#!/usr/bin/env bash

set -euo pipefail

service_name='pi-squared.service'
not_registered_status=3

if ! command -v systemctl >/dev/null 2>&1; then
  printf 'Unable to restart %s: systemctl is not available.\n' "${service_name}" >&2
  exit 1
fi

set +e
unit_output="$(systemctl --user cat "${service_name}" 2>&1)"
query_status=$?
set -e
if (( query_status != 0 )); then
  if grep -Eqi 'no files found|not found|could not be found|unit .* does not exist' <<<"${unit_output}"; then
    printf 'Pi Squared user service %s is not registered. Run setup again with background registration enabled.\n' "${service_name}" >&2
    exit "${not_registered_status}"
  fi

  printf 'Unable to query user service %s (systemctl exited %s): %s\n' \
    "${service_name}" "${query_status}" "${unit_output:-no output}" >&2
  exit "${query_status}"
fi

if systemctl --user --no-block restart "${service_name}"; then
  :
else
  status=$?
  printf 'Unable to restart registered user service %s (systemctl exited %s).\n' "${service_name}" "${status}" >&2
  exit "${status}"
fi

printf 'Restart requested for registered user service %s.\n' "${service_name}"
