#!/usr/bin/env bash

set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
service_name='pi-squared.service'
service_file="${HOME}/.config/systemd/user/${service_name}"

escape_systemd_value() {
  local value=$1
  local escape_dollar=${2:-false}

  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  value=${value//$'\n'/\\n}
  value=${value//$'\r'/\\r}
  value=${value//$'\t'/\\t}
  value=${value//%/%%}
  if [[ "${escape_dollar}" == true ]]; then
    value=${value//\$/\$\$}
  fi
  printf '"%s"' "${value}"
}

install_user_service() {
  local data_directory="$1"
  local service_directory
  local temporary_file
  local runtime_path
  local bash_path
  local run_script

  service_directory="$(dirname -- "${service_file}")"
  temporary_file="${service_file}.tmp.$$"
  runtime_path=${PATH}
  bash_path="$(command -v bash)"
  run_script="${project_root}/Linux/run.sh"

  mkdir -p -- "${service_directory}"
  if ! {
    printf '[Unit]\n'
    printf 'Description=Pi Squared\n\n'
    printf '[Service]\n'
    printf 'Type=simple\n'
    printf 'WorkingDirectory=%s\n' "$(escape_systemd_value "${project_root}")"
    printf 'Environment=%s\n' "$(escape_systemd_value "PATH=${runtime_path}")"
    printf 'Environment=%s\n' "$(escape_systemd_value "PI_SQUARED_DATA_DIR=${data_directory}")"
    printf 'ExecStart=%s %s --service\n' \
      "$(escape_systemd_value "${bash_path}" true)" \
      "$(escape_systemd_value "${run_script}" true)"
    printf 'Restart=on-failure\n\n'
    printf '[Install]\n'
    printf 'WantedBy=default.target\n'
  } > "${temporary_file}"; then
    rm -f -- "${temporary_file}"
    return 1
  fi

  mv -- "${temporary_file}" "${service_file}"
  systemctl --user daemon-reload
  systemctl --user enable --now "${service_name}"
  systemctl --user restart "${service_name}"

  printf 'Installed and started user service %s.\n' "${service_name}"
  printf 'Check it with: systemctl --user status %s\n' "${service_name}"
}

"${project_root}/pi_setup/Linux/pi-install.sh"
cd "${project_root}"
npm install
npm run build
data_directory="$(node "${project_root}/scripts/initialize-update-reminder.mjs" --print-path)"
node "${project_root}/scripts/initialize-update-reminder.mjs"

printf 'Install Pi Squared as a user systemd service (%s)? [y/N] ' "${service_name}"
IFS= read -r install_service || install_service=''
case "${install_service}" in
  y|Y)
    install_user_service "${data_directory}"
    ;;
  n|N|'')
    printf 'Skipping user service registration.\n'
    ;;
  *)
    printf 'Please answer y or n. No service was registered.\n' >&2
    exit 2
    ;;
esac
