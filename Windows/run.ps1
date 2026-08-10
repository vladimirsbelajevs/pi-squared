[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$npmCommand = (Get-Command 'npm.cmd' -ErrorAction Stop).Source
$server = $null
$exitCode = 0

Push-Location $projectRoot
try {
    $server = Start-Process -FilePath $npmCommand -ArgumentList @('run', 'start') -NoNewWindow -PassThru
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
