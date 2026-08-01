#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

source_file="${script_dir}/configs/permissions.json"

agent_dir="${PI_CODING_AGENT_DIR:-${HOME}/.pi/agent}"
target_dir="${agent_dir}/extensions/pi-permission-system"
target_file="${PI_PERMISSION_SYSTEM_CONFIG_PATH:-${target_dir}/config.json}"

if [[ ! -f "${source_file}" ]]; then
    printf 'Error: source config not found: %s\n' "${source_file}" >&2
    exit 1
fi

mkdir -p -- "$(dirname -- "${target_file}")"
cp -- "${source_file}" "${target_file}"

printf 'Installed Pi permission config:\n  %s\n  -> %s\n' \
    "${source_file}" \
    "${target_file}"