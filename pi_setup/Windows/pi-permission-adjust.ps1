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

function Merge-SharedConfig {
    param(
        [Parameter(Mandatory = $true)] $Shared,
        [Parameter(Mandatory = $false)] $User
    )

    if ($null -eq $Shared -or $Shared -is [string] -or $Shared -is [ValueType] -or $Shared -is [System.Array]) {
        return $Shared
    }

    $result = [ordered]@{}
    foreach ($property in $Shared.PSObject.Properties) {
        $userProperty = if ($null -ne $User) { $User.PSObject.Properties[$property.Name] } else { $null }
        $result[$property.Name] = if ($null -ne $userProperty) {
            Merge-SharedConfig -Shared $property.Value -User $userProperty.Value
        } else {
            $property.Value
        }
    }

    if ($null -ne $User) {
        foreach ($property in $User.PSObject.Properties) {
            if (-not $result.Contains($property.Name)) {
                $result[$property.Name] = $property.Value
            }
        }
    }

    return [PSCustomObject]$result
}

$sharedConfig = Get-Content -LiteralPath $sourceFile -Raw | ConvertFrom-Json
$userConfig = $null
if (Test-Path -LiteralPath $targetFile -PathType Leaf) {
    try {
        $userConfig = Get-Content -LiteralPath $targetFile -Raw | ConvertFrom-Json
    }
    catch {
        $userConfig = $null
    }
}
$mergedConfig = Merge-SharedConfig -Shared $sharedConfig -User $userConfig
$temporaryFile = "$targetFile.$([System.Guid]::NewGuid().ToString('N')).tmp"
$mergedConfig | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $temporaryFile -Encoding utf8
Move-Item -LiteralPath $temporaryFile -Destination $targetFile -Force

Write-Host "Installed Pi permission config:`n  $sourceFile`n  -> $targetFile"
