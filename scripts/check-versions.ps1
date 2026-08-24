# The version lives in three files that are bumped by hand. They must agree.
#
# This used to be merely untidy. It is now load-bearing: the release workflow
# derives the telemetry signing key from package.json's version, while the
# running app sends Cargo.toml's version in the x-ov-ver header and the server
# derives the verification key from THAT. One mismatched file and every
# request from that release is rejected with 401, silently, forever.
# tauri.conf.json's version is what the updater compares.
#
# On a tag build the tag must match too, so v1.4.4 cannot ship 1.4.3.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

function Get-Version($path, $pattern) {
    $text = Get-Content -Raw -LiteralPath (Join-Path $root $path)
    $m = [regex]::Match($text, $pattern)
    if (-not $m.Success) { throw "version not found in $path" }
    return $m.Groups[1].Value
}

$found = [ordered]@{
    "package.json"            = Get-Version "package.json" '"version"\s*:\s*"([^"]+)"'
    "src-tauri/Cargo.toml"    = Get-Version "src-tauri/Cargo.toml" '(?m)^version\s*=\s*"([^"]+)"'
    "src-tauri/tauri.conf.json" = Get-Version "src-tauri/tauri.conf.json" '"version"\s*:\s*"([^"]+)"'
}

foreach ($k in $found.Keys) { Write-Host ("{0,-28} {1}" -f $k, $found[$k]) }

# @(...) forces an array: a single result would otherwise be a bare
# string, and $distinct[0] would index its first CHARACTER.
$distinct = @($found.Values | Sort-Object -Unique)
if ($distinct.Count -ne 1) {
    Write-Error "version mismatch across files: $($distinct -join ', ')"
    exit 1
}

# GITHUB_REF_NAME is "v1.4.3" on a tag build and a branch name otherwise.
$tag = $env:GITHUB_REF_NAME
if ($tag -and $tag -match '^v(.+)$') {
    if ($Matches[1] -ne $distinct[0]) {
        Write-Error "tag $tag does not match version $($distinct[0])"
        exit 1
    }
    Write-Host "tag $tag matches"
}

Write-Host "version check passed ($($distinct[0]))"
