[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$sourceFile = Join-Path $PSScriptRoot '..\configs\permissions.json'

if ($env:PI_CODING_AGENT_DIR) {
    $agentDir = $env:PI_CODING_AGENT_DIR
}
else {
    $agentDir = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.pi\agent'
}

if ($env:PI_PERMISSION_SYSTEM_CONFIG_PATH) {
    $targetFile = $env:PI_PERMISSION_SYSTEM_CONFIG_PATH
}
else {
    $targetFile = Join-Path $agentDir 'extensions\pi-permission-system\config.json'
}

if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
    throw "Source config not found: $sourceFile"
}

$targetDirectory = Split-Path -Parent $targetFile
if ([string]::IsNullOrWhiteSpace($targetDirectory)) {
    throw "The target config path must include a parent directory: $targetFile"
}

New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null
Copy-Item -LiteralPath $sourceFile -Destination $targetFile -Force

Write-Host "Installed Pi permission config:`n  $sourceFile`n  -> $targetFile"
