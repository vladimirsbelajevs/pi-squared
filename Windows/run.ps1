[CmdletBinding()]
param(
    [Parameter()]
    [switch]$ServiceMode,

    [Parameter()]
    [string]$DataDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$taskName = 'Pi Squared'

if (-not [string]::IsNullOrWhiteSpace($DataDirectory)) {
    if (-not $ServiceMode) {
        throw '-DataDirectory can only be used with -ServiceMode.'
    }

    if ($DataDirectory -notmatch '^(?:[A-Za-z]:[\\/]|\\\\)') {
        throw 'The Pi Squared data directory must be an absolute path.'
    }

    try {
        $DataDirectory = [System.IO.Path]::GetFullPath($DataDirectory)
    }
    catch {
        throw "The supplied Pi Squared data directory is invalid: $($_.Exception.Message)"
    }

    $env:PI_SQUARED_DATA_DIR = $DataDirectory
}

function Get-PiSquaredTask {
    try {
        Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
    }
    catch {
        if ([string]$_.FullyQualifiedErrorId -match '^CmdletizationQuery_NotFound_TaskName,') {
            return $null
        }

        throw
    }
}

if (-not $ServiceMode) {
    $registeredTask = Get-PiSquaredTask
    if ($null -ne $registeredTask) {
        Write-Host "Scheduled Task '$taskName' is registered; not starting a duplicate server."
        Write-Host "Use Get-ScheduledTask -TaskName '$taskName' to inspect it."
        Write-Host "Use Start-ScheduledTask -TaskName '$taskName' or Stop-ScheduledTask -TaskName '$taskName' to manage it."
        exit 0
    }
}

$npmCommand = (Get-Command 'npm.cmd' -ErrorAction Stop).Source
$server = $null
$exitCode = 0

Push-Location $projectRoot
try {
    $server = Start-Process `
        -FilePath $npmCommand `
        -ArgumentList @('run', 'start') `
        -WorkingDirectory $projectRoot `
        -NoNewWindow `
        -PassThru

    if ($ServiceMode) {
        Write-Host "Running Pi Squared from Scheduled Task '$taskName'."
        while (-not $server.HasExited) {
            Start-Sleep -Milliseconds 200
        }
    }
    else {
        Write-Host 'Press Esc or Ctrl+C to stop the server.'
        while (-not $server.HasExited) {
            if ([Console]::KeyAvailable) {
                $key = [Console]::ReadKey($true)
                if ($key.Key -eq [ConsoleKey]::Escape) {
                    break
                }
            }

            Start-Sleep -Milliseconds 200
        }
    }

    if ($server.HasExited) {
        $exitCode = $server.ExitCode
    }
}
finally {
    if ($null -ne $server -and -not $server.HasExited) {
        & taskkill.exe /PID $server.Id /T /F | Out-Null
    }

    Pop-Location
}

exit $exitCode
