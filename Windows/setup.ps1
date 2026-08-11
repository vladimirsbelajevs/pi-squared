[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
& (Join-Path $projectRoot 'pi_setup\Windows\pi-install.ps1')
if ($LASTEXITCODE -ne 0) { throw "Pi setup failed with exit code $LASTEXITCODE." }

Push-Location $projectRoot
try {
    & npm install
    if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed with exit code $LASTEXITCODE." }
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "Application build failed with exit code $LASTEXITCODE." }
    & node (Join-Path $projectRoot 'scripts\initialize-update-reminder.mjs')
    if ($LASTEXITCODE -ne 0) { throw "Application data initialization failed with exit code $LASTEXITCODE." }
    Write-Host 'Pi Squared manual web app is ready. Run Windows/run.ps1 to start the foreground server.'
}
finally {
    Pop-Location
}
