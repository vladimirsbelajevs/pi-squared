[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

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

$task = Get-PiSquaredTask
if ($null -eq $task) {
    Write-Host "Scheduled Task '$taskName' is not registered."
    exit 0
}

if ($task.State -eq 'Running') {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction Stop
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    do {
        Start-Sleep -Milliseconds 200
        $task = Get-PiSquaredTask
        if ($null -eq $task) {
            Write-Host "Scheduled Task '$taskName' was removed while it was stopping."
            exit 0
        }
    } while ($task.State -eq 'Running' -and [DateTime]::UtcNow -lt $deadline)

    if ($task.State -eq 'Running') {
        throw "Scheduled Task '$taskName' did not stop within 30 seconds."
    }
}

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop
Write-Host "Unregistered Scheduled Task '$taskName'."
