#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

source_file="${script_dir}/../configs/permissions.json"

agent_dir="${PI_CODING_AGENT_DIR:-${HOME}/.pi/agent}"
target_dir="${agent_dir}/extensions/pi-permission-system"
target_file="${PI_PERMISSION_SYSTEM_CONFIG_PATH:-${target_dir}/config.json}"

if [[ ! -f "${source_file}" ]]; then
    printf 'Error: source config not found: %s\n' "${source_file}" >&2
    exit 1
fi

mkdir -p -- "$(dirname -- "${target_file}")"

if [[ -f "${target_file}" ]]; then
    temporary_file="$(mktemp "${target_file}.tmp.XXXXXX")"
    trap 'rm -f -- "${temporary_file}"' EXIT
    node - "${source_file}" "${target_file}" "${temporary_file}" <<'NODE'
const fs = require('node:fs');
const [sourcePath, targetPath, outputPath] = process.argv.slice(2);
const shared = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
let user = {};
try {
  user = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
} catch {
  // An invalid existing file is replaced by the validated shared defaults.
}
function merge(sharedValue, userValue) {
  if (!sharedValue || typeof sharedValue !== 'object' || Array.isArray(sharedValue)) {
    return sharedValue;
  }
  const result = { ...sharedValue };
  if (userValue && typeof userValue === 'object' && !Array.isArray(userValue)) {
    for (const [key, value] of Object.entries(userValue)) {
      result[key] = Object.prototype.hasOwnProperty.call(sharedValue, key)
        ? merge(sharedValue[key], value)
        : value;
    }
  }
  return result;
}
fs.writeFileSync(outputPath, `${JSON.stringify(merge(shared, user), null, 2)}\n`);
NODE
    mv -- "${temporary_file}" "${target_file}"
    trap - EXIT
else
    cp -- "${source_file}" "${target_file}"
fi

printf 'Installed Pi permission config:\n  %s\n  -> %s\n' \
    "${source_file}" \
    "${target_file}"