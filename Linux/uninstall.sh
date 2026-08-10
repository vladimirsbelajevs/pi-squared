#!/usr/bin/env bash

set -euo pipefail

service_name='pi-squared.service'
service_file="${HOME}/.config/systemd/user/${service_name}"

if [[ ! -f "${service_file}" ]]; then
  printf 'User service %s is not installed at %s.\n' "${service_name}" "${service_file}"
  exit 0
fi

systemctl --user disable --now "${service_name}"
rm -- "${service_file}"
systemctl --user daemon-reload
systemctl --user reset-failed "${service_name}" 2>/dev/null || true

printf 'Uninstalled user service %s.\n' "${service_name}"
