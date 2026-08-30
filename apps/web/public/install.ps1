# ADCode installer for Windows.
#
#   irm https://adcode.bluethenics.com/install.ps1 | iex
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
$Site  = if ($env:ADCODE_SITE) { $env:ADCODE_SITE } else { 'https://adcode.bluethenics.com' }

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
Write-Host "  Starting the installer..."

# No SmartScreen prompt is expected here, and that is not luck.
#
# The "Windows protected your PC" dialog fires on files carrying the Mark of the Web - the
# zone tag a browser attaches to a download. Invoke-WebRequest does not set it, and the
# installer is per-user, so it needs no elevation either. This is why the terminal install
# is the recommended path while builds are not yet code-signed: it is not a workaround for
# a warning, it is the route that does not produce one.
#
# If Windows does interpose anyway - some managed machines tighten this - choose More info,
# then Run anyway.
Start-Process -FilePath $target -Wait

Write-Host ""
Write-Host "  Installed." -ForegroundColor Green

# Everything somebody installing from a terminal needs next, printed in the terminal.
#
# A person who installs this way may never open the website, so the four things they will
# actually need - how to launch it, how it updates, how to remove it, and where to get
# help - are stated here rather than linked to. The ads line is here for the same reason:
# it is the one thing about this editor nobody should discover by surprise.
Write-Host ""
Write-Host "  Next" -ForegroundColor White
Write-Host "    Launch            the Start menu, or: adcode"
Write-Host "    Open a folder     adcode open ."
Write-Host "    Every command     adcode help"
Write-Host ""
Write-Host "  Looking after it" -ForegroundColor White
Write-Host "    Updates           automatic; turn off in Settings, Updates"
Write-Host "    Reinstall         run this same command again"
Write-Host "    Uninstall         Settings, Apps, Installed apps, ADCode"
Write-Host ""
Write-Host "  Help" -ForegroundColor White
Write-Host "    In the editor     Help menu, Feature Guide - every feature, explained"
Write-Host "    Documentation     $Site/docs"
Write-Host "    Something wrong   $Site/support"
Write-Host ""
Write-Host "  ADCode shows an occasional sponsored card and credits you half of what it pays." -ForegroundColor DarkGray
Write-Host "  Turn ads off entirely in Settings, Ads and Earnings. The editor stays complete." -ForegroundColor DarkGray
Write-Host ""
