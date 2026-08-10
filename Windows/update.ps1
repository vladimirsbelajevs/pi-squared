[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$taskName = 'Pi Squared'

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

    $registeredTask = Get-PiSquaredTask
    if ($null -ne $registeredTask) {
        if ($registeredTask.State -eq 'Running') {
            Stop-ScheduledTask -TaskName $taskName -ErrorAction Stop
            $deadline = [DateTime]::UtcNow.AddSeconds(30)
            do {
                Start-Sleep -Milliseconds 200
                $registeredTask = Get-PiSquaredTask
                if ($null -eq $registeredTask) {
                    throw "Scheduled Task '$taskName' disappeared while it was being restarted."
                }
            } while ($registeredTask.State -eq 'Running' -and [DateTime]::UtcNow -lt $deadline)

            if ($registeredTask.State -eq 'Running') {
                throw "Scheduled Task '$taskName' did not stop within 30 seconds."
            }
        }

        Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
        Write-Host "Restarted registered Scheduled Task '$taskName'."
    }
}
finally {
    Pop-Location
}
