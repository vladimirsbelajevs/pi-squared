[CmdletBinding()]
param(
    [switch]$NoRestart
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory)]
        [string]$Name,

        [Parameter()]
        [string[]]$Arguments = @()
    )

    & $Name @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command '$Name $($Arguments -join ' ')' failed with exit code $LASTEXITCODE."
    }
}

Push-Location $projectRoot
try {
    Invoke-CheckedCommand -Name 'git' -Arguments @('pull', '--ff-only')
    Invoke-CheckedCommand -Name 'pi' -Arguments @('update')
    Invoke-CheckedCommand -Name 'pi' -Arguments @('update', '--extensions')
    Invoke-CheckedCommand -Name 'npm' -Arguments @('install')
    Invoke-CheckedCommand -Name 'npm' -Arguments @('run', 'build')

    if ($NoRestart) {
        Write-Host 'Update completed without restarting the application.'
        return
    }

    & (Join-Path $projectRoot 'Windows\restart-service.ps1')
    $restartStatus = $LASTEXITCODE
    if ($restartStatus -eq 3) {
        Write-Host "Update completed; no registered Scheduled Task was restarted."
        return
    }
    if ($restartStatus -ne 0) {
        throw "Restart script failed with exit code $restartStatus."
    }
}
finally {
    Pop-Location
}
