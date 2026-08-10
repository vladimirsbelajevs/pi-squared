[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

Push-Location $projectRoot
try {
    & (Join-Path $projectRoot 'pi_setup\Windows\pi-install.ps1')

    & npm install
    if ($LASTEXITCODE -ne 0) {
        throw "Dependency installation failed with exit code $LASTEXITCODE."
    }

    & npm run build
    if ($LASTEXITCODE -ne 0) {
        throw "Application build failed with exit code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}
