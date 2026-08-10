[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$taskName = 'Pi Squared'
$notRegisteredStatus = 3

try {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
}
catch {
    $errorId = [string]$_.FullyQualifiedErrorId
    if ($errorId -match '^CmdletizationQuery_NotFound_TaskName,') {
        [Console]::Error.WriteLine("Scheduled Task '$taskName' is not registered. Run setup again with background registration enabled.")
        exit $notRegisteredStatus
    }

    [Console]::Error.WriteLine("Unable to query Scheduled Task '$taskName': $($_.Exception.Message)")
    exit 1
}

if ($null -eq $task) {
    [Console]::Error.WriteLine("Scheduled Task '$taskName' is not registered. Run setup again with background registration enabled.")
    exit $notRegisteredStatus
}

try {
    Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
}
catch {
    [Console]::Error.WriteLine("Unable to restart registered Scheduled Task '$taskName': $($_.Exception.Message)")
    exit 1
}

Write-Host "Restart requested for registered Scheduled Task '$taskName'."
