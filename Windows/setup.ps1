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

function Stop-PiSquaredTaskIfRunning {
    $task = Get-PiSquaredTask
    if ($null -eq $task -or $task.State -ne 'Running') {
        return
    }

    Stop-ScheduledTask -TaskName $taskName -ErrorAction Stop
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    do {
        Start-Sleep -Milliseconds 200
        $task = Get-PiSquaredTask
        if ($null -eq $task) {
            return
        }
    } while ($task.State -eq 'Running' -and [DateTime]::UtcNow -lt $deadline)

    if ($task.State -eq 'Running') {
        throw "Scheduled Task '$taskName' did not stop before it was re-registered."
    }
}

function ConvertTo-CommandLineArgument {
    param(
        [Parameter(Mandatory)]
        [string]$Value
    )

    $escaped = $Value -replace '(\\*)"', '$1$1\\"'
    $escaped = $escaped -replace '(\\+)$', '$1$1'
    return '"' + $escaped + '"'
}

function Register-PiSquaredTask {
    param(
        [Parameter(Mandatory)]
        [string]$DataDirectory
    )

    Stop-PiSquaredTaskIfRunning
    $runScript = Join-Path $projectRoot 'Windows\run.ps1'
    $powerShellCommand = (Get-Command 'powershell.exe' -ErrorAction Stop).Source
    $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $quotedRunScript = ConvertTo-CommandLineArgument $runScript
    $quotedDataDirectory = ConvertTo-CommandLineArgument $DataDirectory
    $actionArguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $quotedRunScript -ServiceMode -DataDirectory $quotedDataDirectory"

    $action = New-ScheduledTaskAction `
        -Execute $powerShellCommand `
        -Argument $actionArguments `
        -WorkingDirectory $projectRoot
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
    $principal = New-ScheduledTaskPrincipal `
        -UserId $currentUser `
        -LogonType InteractiveToken `
        -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet `
        -Hidden `
        -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -MultipleInstances StopExisting

    Register-ScheduledTask `
        -TaskName $taskName `
        -Action $action `
        -Trigger $trigger `
        -Principal $principal `
        -Settings $settings `
        -Description 'Starts Pi Squared at logon.' `
        -Force `
        -ErrorAction Stop | Out-Null
    Start-ScheduledTask -TaskName $taskName -ErrorAction Stop

    Write-Host "Registered and started Scheduled Task '$taskName'."
    Write-Host "Inspect it with: Get-ScheduledTask -TaskName '$taskName'"
}

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

    $dataDirectory = (& node (Join-Path $projectRoot 'scripts\initialize-update-reminder.mjs') --print-path).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($dataDirectory)) {
        throw "Application update reminder data directory resolution failed with exit code $LASTEXITCODE."
    }

    & node (Join-Path $projectRoot 'scripts\initialize-update-reminder.mjs')
    if ($LASTEXITCODE -ne 0) {
        throw "Application update reminder initialization failed with exit code $LASTEXITCODE."
    }

    $registerTask = (Read-Host "Register Pi Squared as a Scheduled Task ('$taskName')? [y/N]").Trim()
    if ($registerTask -match '^[yY]$') {
        Register-PiSquaredTask -DataDirectory $dataDirectory
    }
    elseif ($registerTask -notmatch '^[nN]?$') {
        throw 'Please answer y or n. No Scheduled Task was registered.'
    }
    else {
        Write-Host 'Skipping Scheduled Task registration.'
    }
}
finally {
    Pop-Location
}
