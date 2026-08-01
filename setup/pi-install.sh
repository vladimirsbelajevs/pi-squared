#!/usr/bin/env bash

#Install PI
curl -fsSL https://pi.dev/install.sh | sh


# Install necessary PI extensions
pi install npm:@gotgenes/pi-permission-system
pi install npm:pi-subagents
pi install npm:@narumitw/pi-plan-mode
pi install npm:@narumitw/pi-lsp
pi install npm:pi-mcp-adapter
pi install npm:pi-web-access


# Adjust permissions for PI
./pi-permission-adjust.sh