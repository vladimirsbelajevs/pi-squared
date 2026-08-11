[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Invoke-CheckedCommand {
    param([Parameter(Mandatory)][string]$Name, [Parameter()][string[]]$Arguments = @())
    & $Name @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Command '$Name $($Arguments -join ' ')' failed with exit code $LASTEXITCODE." }
}

Push-Location $projectRoot
try {
    Invoke-CheckedCommand -Name 'git' -Arguments @('pull', '--ff-only')
    Invoke-CheckedCommand -Name 'pi' -Arguments @('update')
    Invoke-CheckedCommand -Name 'pi' -Arguments @('update', '--extensions')
    Invoke-CheckedCommand -Name 'npm' -Arguments @('install')
    Invoke-CheckedCommand -Name 'npm' -Arguments @('run', 'build')
    Write-Host 'Source checkout update completed. Stop and rerun the foreground server to use it.'
}
finally {
    Pop-Location
}
