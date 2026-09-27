[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)] [int]$WebPort = 3000,
    [ValidateRange(1024, 65535)] [int]$CorePort = 8090,
    [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$webRoot = Join-Path $projectRoot 'Web'
$coreProject = Join-Path $projectRoot 'Standalone\Llm2Pcg.CoreHost\Llm2Pcg.CoreHost.csproj'
$serverModule = Join-Path $webRoot 'src\server.mjs'
$threeModule = Join-Path $webRoot 'node_modules\three\build\three.module.js'
$sharedDefaults = Join-Path $projectRoot 'Shared\pcg-request.mjs'

$dotnetCommand = Get-Command dotnet -ErrorAction Stop
$nodeCommand = Get-Command node -ErrorAction Stop
$npmCommand = Get-Command npm -ErrorAction Stop

if (-not (Test-Path -LiteralPath $threeModule)) {
    Write-Host 'Installing locked Web dependencies...'
    Push-Location $webRoot
    try {
        & $npmCommand.Source ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE." }
    }
    finally { Pop-Location }
}

$previousWebPort = $env:WEB_PORT
$previousCoreUrl = $env:LLM2PCG_CORE_URL
$previousCoreEndpoint = $env:PCG_CORE_ENDPOINT
$previousV4Endpoint = $env:PCG_V4_CORE_ENDPOINT
$coreProcess = $null
$webProcess = $null

function Restore-EnvironmentValue([string]$Name, [AllowNull()][string]$Value) {
    if ($null -eq $Value) { Remove-Item -Path "Env:$Name" -ErrorAction SilentlyContinue }
    else { Set-Item -Path "Env:$Name" -Value $Value }
}

function Stop-OwnedProcess([System.Diagnostics.Process]$Process) {
    if ($null -eq $Process) { return }
    $Process.Refresh()
    if (-not $Process.HasExited) {
        Stop-Process -Id $Process.Id -ErrorAction SilentlyContinue
        $Process.WaitForExit(5000) | Out-Null
    }
}

function Assert-LoopbackPortAvailable([string]$Name, [int]$Port) {
    $occupied = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() |
        Where-Object { $_.Port -eq $Port } | Select-Object -First 1
    if ($null -ne $occupied) { throw "$Name port $Port is already in use." }
}

try {
    if ($WebPort -eq $CorePort) { throw 'WebPort and CorePort must be different.' }
    Assert-LoopbackPortAvailable -Name 'Web' -Port $WebPort
    Assert-LoopbackPortAvailable -Name 'CoreHost' -Port $CorePort

    $env:WEB_PORT = $WebPort.ToString()
    $env:LLM2PCG_CORE_URL = "http://127.0.0.1:$CorePort"
    $env:PCG_CORE_ENDPOINT = "http://127.0.0.1:$CorePort/api/world/generate"
    $env:PCG_V4_CORE_ENDPOINT = "http://127.0.0.1:$CorePort/api/v4/world/generate"

    $coreProcess = Start-Process -FilePath $dotnetCommand.Source `
        -ArgumentList @('run', '--project', $coreProject, '--no-launch-profile') `
        -WorkingDirectory $projectRoot -PassThru -WindowStyle Hidden
    $webProcess = Start-Process -FilePath $nodeCommand.Source `
        -ArgumentList @($serverModule) -WorkingDirectory $webRoot -PassThru -WindowStyle Hidden

    $healthUri = "http://127.0.0.1:$WebPort/api/health"
    $health = $null
    for ($attempt = 0; $attempt -lt 80; $attempt++) {
        $coreProcess.Refresh(); $webProcess.Refresh()
        if ($coreProcess.HasExited) { throw "CoreHost exited during startup with code $($coreProcess.ExitCode)." }
        if ($webProcess.HasExited) { throw "Web server exited during startup with code $($webProcess.ExitCode)." }
        try {
            $health = Invoke-RestMethod -Uri $healthUri -TimeoutSec 1
            if ($health.ok -and $health.unityRequired -eq $false) { break }
        }
        catch { Start-Sleep -Milliseconds 250 }
    }
    if ($null -eq $health -or -not $health.ok) { throw "Standalone runtime did not become healthy at $healthUri." }

    Write-Host "Browser demo: http://127.0.0.1:$WebPort" -ForegroundColor Green
    Write-Host "Unity bridge UI: http://127.0.0.1:$WebPort/unity/" -ForegroundColor Cyan
    Write-Host "CoreHost: http://127.0.0.1:$CorePort"

    if ($ValidateOnly) {
        foreach ($assetPath in @('/', '/app.js', '/renderer.js', '/world-codec.mjs', '/natural-language-status.mjs', '/asset-manifest.json', '/unity/', '/unity/app.js', '/unity/styles.css', '/vendor/three.module.js', '/vendor/three.core.js', '/vendor/addons/loaders/GLTFLoader.js', '/vendor/addons/utils/BufferGeometryUtils.js')) {
            $assetResponse = Invoke-WebRequest -Uri "http://127.0.0.1:$WebPort$assetPath"
            if ($assetResponse.StatusCode -ne 200 -or $assetResponse.RawContentLength -le 0) { throw "Static Web asset validation failed for $assetPath." }
        }
        Write-Host 'PASS Web modules and asset manifest'

        foreach ($world in @('Dungeon', 'Cave', 'Forest', 'City', 'Swamp', 'Snowfield', 'Desert')) {
            $requestJson = & $nodeCommand.Source --input-type=module -e `
                "import { defaultRequest } from './Shared/pcg-request.mjs'; console.log(JSON.stringify({ request: defaultRequest(process.argv[1], 234, 64, 64) }));" $world
            if ($LASTEXITCODE -ne 0) { throw "Could not build the default $world request." }
            $result = Invoke-RestMethod -Uri "http://127.0.0.1:$WebPort/api/generate-direct" `
                -Method Post -ContentType 'application/json' -Body ([string]::Join('', $requestJson))
            $decodedCells = [Convert]::FromBase64String($result.world.cells)
            if (-not $result.ok -or $decodedCells.Length -ne $result.world.width * $result.world.height) {
                throw "GeneratedWorld validation failed for $world."
            }
            Write-Host ("PASS {0,-9} hash={1} cells={2}" -f $result.world.worldType, $result.world.worldHash, $decodedCells.Length)
        }
        & $nodeCommand.Source (Join-Path $PSScriptRoot 'Test-NaturalLanguage.mjs') "http://127.0.0.1:$WebPort"
        if ($LASTEXITCODE -ne 0) { throw "Natural-language smoke test failed with exit code $LASTEXITCODE." }
        Write-Host 'Standalone Web end-to-end validation passed.' -ForegroundColor Green
        return
    }

    Write-Host 'Press Ctrl+C to stop both processes.' -ForegroundColor Yellow
    while ($true) {
        Start-Sleep -Milliseconds 500
        $coreProcess.Refresh(); $webProcess.Refresh()
        if ($coreProcess.HasExited) { throw "CoreHost exited with code $($coreProcess.ExitCode)." }
        if ($webProcess.HasExited) { throw "Web server exited with code $($webProcess.ExitCode)." }
    }
}
finally {
    Stop-OwnedProcess $webProcess
    Stop-OwnedProcess $coreProcess
    Restore-EnvironmentValue -Name 'WEB_PORT' -Value $previousWebPort
    Restore-EnvironmentValue -Name 'LLM2PCG_CORE_URL' -Value $previousCoreUrl
    Restore-EnvironmentValue -Name 'PCG_CORE_ENDPOINT' -Value $previousCoreEndpoint
    Restore-EnvironmentValue -Name 'PCG_V4_CORE_ENDPOINT' -Value $previousV4Endpoint
}
