[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

Push-Location $projectRoot
try {
    Write-Host 'Pi Squared is running at http://127.0.0.1:3049. Press Ctrl+C to stop.'
    & npm run start
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
