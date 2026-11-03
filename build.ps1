$ErrorActionPreference = 'Stop'

$projectRoot = $PSScriptRoot
$source = Join-Path $projectRoot 'tools\PaperGraphLauncher.cs'
$output = Join-Path $projectRoot 'PaperGraph.exe'
$compilerCandidates = @(
    "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)
$compiler = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not $compiler) {
    throw 'The .NET Framework C# compiler was not found. Enable or install .NET Framework 4.x.'
}

& $compiler /nologo /target:winexe /optimize+ `
    /reference:System.dll `
    /reference:System.Core.dll `
    /reference:System.Web.Extensions.dll `
    /reference:System.Windows.Forms.dll `
    /out:$output $source

if ($LASTEXITCODE -ne 0) {
    throw 'Launcher compilation failed.'
}

Write-Host "Built: $output" -ForegroundColor Green

