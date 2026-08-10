[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw 'npm was not found. Install Node.js and ensure npm is available on PATH.'
}

# Install Pi. --ignore-scripts is the recommended installation mode.
& npm install -g --ignore-scripts '@earendil-works/pi-coding-agent'
if ($LASTEXITCODE -ne 0) {
    throw "Pi installation failed with exit code $LASTEXITCODE."
}

if (-not (Get-Command pi -ErrorAction SilentlyContinue)) {
    throw 'Pi was installed, but the pi command is not available on PATH. Restart PowerShell and run this script again.'
}

# Install the Pi extensions used by this project.
$extensions = @(
    'npm:@gotgenes/pi-permission-system'
    'npm:pi-subagents'
    'npm:@narumitw/pi-plan-mode'
    'npm:@narumitw/pi-lsp'
    'npm:pi-mcp-adapter'
    'npm:pi-web-access'
)

foreach ($extension in $extensions) {
    & pi install $extension
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to install Pi extension '$extension' (exit code $LASTEXITCODE)."
    }
}

# Install the shared permission configuration.
& (Join-Path $PSScriptRoot 'pi-permission-adjust.ps1')
