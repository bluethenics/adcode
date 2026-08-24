#!/bin/sh
#
# ADCode installer for macOS and Linux.
#
#   curl -fsSL https://adcode.bluethenics.com/install.sh | sh
#
# Picks the right artifact for the platform, verifies it against the checksum published
# with the release, and installs it.
#
# POSIX sh, not bash: macOS ships bash 3.2 and some minimal Linux images have no bash at
# all. Nothing here needs more than sh provides.

set -eu

OWNER="${ADCODE_GH_OWNER:-bluethenics}"
REPO="${ADCODE_GH_REPO:-adcode}"
API="https://api.github.com/repos/${OWNER}/${REPO}/releases/latest"

BOLD=''
DIM=''
RED=''
GREEN=''
YELLOW=''
RESET=''
if [ -t 1 ]; then
  BOLD="$(printf '\033[1m')"
  DIM="$(printf '\033[2m')"
  RED="$(printf '\033[31m')"
  GREEN="$(printf '\033[32m')"
  YELLOW="$(printf '\033[33m')"
  RESET="$(printf '\033[0m')"
fi

say() { printf '  %s\n' "$1"; }
fail() { printf '\n  %s%s%s\n\n' "$RED" "$1" "$RESET" >&2; exit 1; }

printf '\n  %sADCode%s\n' "$BOLD" "$RESET"
printf '  %sAn editor that pays you back.%s\n\n' "$DIM" "$RESET"

need() { command -v "$1" >/dev/null 2>&1 || fail "This installer needs $1, which isn't on your PATH."; }
need curl

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin) PATTERN='\.dmg"' ;;
  Linux)
    # .deb where dpkg exists, AppImage otherwise - AppImage runs anywhere and needs no
    # package manager, but a .deb is what a Debian user expects to be able to remove.
    if command -v dpkg >/dev/null 2>&1; then PATTERN='\.deb"'; else PATTERN='\.AppImage"'; fi
    ;;
  *) fail "ADCode supports macOS and Linux from this script, and Windows via install.ps1." ;;
esac

case "$ARCH" in
  x86_64|amd64|arm64|aarch64) : ;;
  *) fail "No ADCode build for $ARCH yet." ;;
esac

say "Finding the latest release..."

RELEASE="$(curl -fsSL -H 'User-Agent: adcode-installer' "$API" 2>/dev/null)" \
  || fail "Couldn't reach GitHub to find a release. Check your connection and try again."

URL="$(printf '%s' "$RELEASE" \
  | grep -o '"browser_download_url": *"[^"]*"' \
  | sed 's/.*"browser_download_url": *"//; s/"$//' \
  | grep -E "$(printf '%s' "$PATTERN" | sed 's/"$//')$" \
  | head -n 1)"

[ -n "$URL" ] || fail "That release has no build for your platform. See https://adcode.bluethenics.com/download"

VERSION="$(printf '%s' "$RELEASE" | grep -o '"tag_name": *"[^"]*"' | sed 's/.*: *"//; s/"$//')"
FILE="$(basename "$URL")"

say "Found ${VERSION:-latest}"

# mktemp -d, so the download lands in a directory only this user can write. A predictable
# path in /tmp is one another user could pre-create and swap under us.
WORKDIR="$(mktemp -d 2>/dev/null || mktemp -d -t adcode)"
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT INT TERM

say "Downloading $FILE..."
curl -fsSL --progress-bar "$URL" -o "$WORKDIR/$FILE" \
  || fail "Download failed. Try again, or grab it from https://adcode.bluethenics.com/download"

# electron-builder publishes latest-mac.yml / latest-linux.yml with a SHA-512 per artifact.
case "$OS" in
  Darwin) META="latest-mac.yml" ;;
  *)      META="latest-linux.yml" ;;
esac

META_URL="$(printf '%s' "$RELEASE" \
  | grep -o '"browser_download_url": *"[^"]*"' \
  | sed 's/.*"browser_download_url": *"//; s/"$//' \
  | grep "/${META}$" | head -n 1)"

if [ -n "$META_URL" ] && command -v shasum >/dev/null 2>&1; then
  EXPECTED="$(curl -fsSL "$META_URL" 2>/dev/null | grep -m1 -o 'sha512: *[A-Za-z0-9+/=]*' | sed 's/sha512: *//')"
  if [ -n "$EXPECTED" ]; then
    ACTUAL="$(shasum -a 512 -b "$WORKDIR/$FILE" | cut -d' ' -f1 | xxd -r -p | base64 | tr -d '\n' 2>/dev/null || true)"
    if [ -n "$ACTUAL" ] && [ "$ACTUAL" != "$EXPECTED" ]; then
      fail "The download didn't match its published checksum. Nothing was installed. This is worth reporting."
    fi
    [ -n "$ACTUAL" ] && say "Checksum verified."
  fi
else
  printf '  %sChecksum not published for this release; the download is unverified.%s\n' "$YELLOW" "$RESET"
fi

case "$OS" in
  Darwin)
    say "Opening the disk image..."
    printf '  %smacOS will say the app is from an unidentified developer.%s\n' "$YELLOW" "$RESET"
    printf '  %sBuilds are not notarised yet. Right-click the app and choose Open.%s\n' "$DIM" "$RESET"
    open "$WORKDIR/$FILE"
    # The image is mounted by the user, so the temp dir has to survive this script.
    trap - EXIT
    printf '\n  %sDrag ADCode to Applications to finish.%s\n\n' "$GREEN" "$RESET"
    ;;
  Linux)
    case "$FILE" in
      *.deb)
        say "Installing with dpkg (you'll be asked for your password)..."
        sudo dpkg -i "$WORKDIR/$FILE" || sudo apt-get install -f -y
        printf '\n  %sDone. Run it with: adcode%s\n\n' "$GREEN" "$RESET"
        ;;
      *.AppImage)
        DEST="${HOME}/.local/bin"
        mkdir -p "$DEST"
        mv "$WORKDIR/$FILE" "$DEST/adcode"
        chmod +x "$DEST/adcode"
        printf '\n  %sInstalled to %s/adcode%s\n' "$GREEN" "$DEST" "$RESET"
        case ":$PATH:" in
          *":$DEST:"*) printf '  Run it with: adcode\n\n' ;;
          *) printf '  %s%s is not on your PATH. Add it, or run %s/adcode%s\n\n' "$YELLOW" "$DEST" "$DEST" "$RESET" ;;
        esac
        ;;
    esac
    ;;
esac

say "ADCode keeps itself up to date; turn that off in Settings if you'd rather not."
printf '\n'
