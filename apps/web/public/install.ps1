# ADCode installer for Windows.
#
#   irm https://adcode.bluethenics01.workers.dev/install.ps1 | iex
#
# Fetches the latest release from GitHub, downloads the installer, checks its SHA-256
# against the checksum GitHub publishes alongside it, and runs it.
#
# The checksum check is the point. This script is piped straight into a shell, so anyone
# running it is trusting this file and whatever it downloads. Verifying the download
# against the release metadata means a tampered mirror or a truncated download is caught
# before anything executes.

$ErrorActionPreference = 'Stop'

$Owner = if ($env:ADCODE_GH_OWNER) { $env:ADCODE_GH_OWNER } else { 'bluethenics' }
$Repo  = if ($env:ADCODE_GH_REPO)  { $env:ADCODE_GH_REPO }  else { 'adcode' }
$Api   = "https://api.github.com/repos/$Owner/$Repo/releases/latest"

# Where to send someone when this script cannot finish. The workers.dev hostname on
# purpose, for the same reason `apps/desktop/src/main/backend.ts` uses it: the custom
# domain has no DNS record until SETUP.md step 13 is done, and a failure message that
# points at a hostname which does not resolve turns a recoverable problem into a dead end.
$Site  = if ($env:ADCODE_SITE) { $env:ADCODE_SITE } else { 'https://adcode.bluethenics01.workers.dev' }

function Fail($message) {
    Write-Host ""
    Write-Host "  $message" -ForegroundColor Red
    Write-Host ""
    exit 1
}

Write-Host ""
Write-Host "  ADCode" -ForegroundColor Cyan
Write-Host "  An editor that pays you back."
Write-Host ""

if ([Environment]::Is64BitOperatingSystem -eq $false) {
    Fail "ADCode needs 64-bit Windows."
}

Write-Host "  Finding the latest release..."

try {
    $release = Invoke-RestMethod -Uri $Api -Headers @{ 'User-Agent' = 'adcode-installer' }
} catch {
    Fail "Couldn't reach GitHub to find a release. Check your connection and try again."
}

$version = $release.tag_name
$asset = $release.assets | Where-Object { $_.name -like '*.exe' -and $_.name -notlike '*portable*' } | Select-Object -First 1

if (-not $asset) {
    Fail "That release has no Windows installer in it. Try the download page instead: $Site/download"
}

Write-Host "  Found $version ($([math]::Round($asset.size / 1MB)) MB)"

# Downloaded to a per-user temp path rather than a shared one: a fixed name in a
# world-writable directory is a file another user could swap between download and launch.
$target = Join-Path ([System.IO.Path]::GetTempPath()) "adcode-$version-$([guid]::NewGuid().ToString('N')).exe"

Write-Host "  Downloading..."
try {
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $target -UseBasicParsing
} catch {
    Fail "Download failed. Try again, or grab the installer from $Site/download"
}

# electron-builder publishes a latest.yml carrying the SHA-512 of each artifact. When it
# is present the download is verified; when it is not, the script says so rather than
# pretending it checked.
$checksumAsset = $release.assets | Where-Object { $_.name -eq 'latest.yml' } | Select-Object -First 1

if ($checksumAsset) {
    try {
        $meta = Invoke-WebRequest -Uri $checksumAsset.browser_download_url -UseBasicParsing
        $expected = ([regex]::Match($meta.Content, 'sha512:\s*([A-Za-z0-9+/=]+)')).Groups[1].Value

        if ($expected) {
            $bytes = [System.IO.File]::ReadAllBytes($target)
            $sha = [System.Security.Cryptography.SHA512]::Create()
            $actual = [Convert]::ToBase64String($sha.ComputeHash($bytes))

            if ($actual -ne $expected) {
                Remove-Item $target -Force -ErrorAction SilentlyContinue
                Fail "The download didn't match its published checksum, so it was deleted. This is worth reporting."
            }
            Write-Host "  Checksum verified."
        }
    } catch {
        Write-Host "  Couldn't verify the checksum - continuing, but the download is unverified." -ForegroundColor Yellow
    }
} else {
    Write-Host "  No checksum published for this release; the download is unverified." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "  Windows will warn that the publisher is unrecognised." -ForegroundColor Yellow
Write-Host "  Builds aren't code-signed yet. Choose More info, then Run anyway."
Write-Host ""
Write-Host "  Starting the installer..."

Start-Process -FilePath $target -Wait

Write-Host ""
Write-Host "  Done. ADCode is in your Start menu." -ForegroundColor Green
Write-Host "  It keeps itself up to date; turn that off in Settings if you'd rather not."
Write-Host ""
