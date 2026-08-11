#!/usr/bin/env bash

set -euo pipefail

#Install PI
curl -fsSL https://pi.dev/install.sh | sh
# The installer may place `pi` in the user-local bin directory without
# updating this non-interactive shell's PATH.
export PATH="${HOME}/.local/bin:${PATH}"

# Install necessary PI extensions
pi install npm:@gotgenes/pi-permission-system
pi install npm:pi-subagents
pi install npm:@narumitw/pi-plan-mode
pi install npm:@narumitw/pi-lsp
pi install npm:pi-mcp-adapter
pi install npm:pi-web-access


# Adjust permissions for PI
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
"${script_dir}/pi-permission-adjust.sh"