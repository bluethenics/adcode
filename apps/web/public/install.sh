#!/bin/sh
#
# ADCode installer for Linux, and macOS once macOS builds ship.
#
#   curl -fsSL https://adcode.bluethenics.com/install.sh | sh
#
# Picks the right artifact for the platform, verifies it against the checksum published
# with the release, installs it, and then tells you everything you need to look after it
# without opening a browser.
#
# POSIX sh, not bash: macOS ships bash 3.2 and some minimal Linux images have no bash at
# all. Nothing here needs more than sh provides.

set -eu

OWNER="${ADCODE_GH_OWNER:-bluethenics}"
REPO="${ADCODE_GH_REPO:-adcode}"
API="https://api.github.com/repos/${OWNER}/${REPO}/releases/latest"
SITE="${ADCODE_SITE:-https://adcode.bluethenics.com}"

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
  Linux)
    # .deb where dpkg exists, AppImage otherwise - AppImage runs anywhere and needs no
    # package manager, but a .deb is what a Debian user expects to be able to remove.
    if command -v dpkg >/dev/null 2>&1; then PATTERN='\.deb"'; else PATTERN='\.AppImage"'; fi
    ;;
  Darwin)
    # Signing and notarising a macOS build needs a paid Apple Developer membership, and
    # an un-notarised app is not warned about but refused outright by Gatekeeper. Saying
    # so plainly is better than downloading something that will not open.
    printf '  %sADCode for macOS is not published yet.%s\n\n' "$YELLOW" "$RESET"
    printf '  Builds need Apple notarisation before they will open at all, and that is\n'
    printf '  not in place. Windows and Linux are available today.\n\n'
    printf '  Follow along at %s/versions\n\n' "$SITE"
    exit 0
    ;;
  *) fail "This script installs ADCode on Linux. On Windows use install.ps1; see ${SITE}/versions" ;;
esac

case "$ARCH" in
  x86_64|amd64) : ;;
  arm64|aarch64) fail "ADCode has no arm64 Linux build yet. See ${SITE}/versions" ;;
  *) fail "No ADCode build for $ARCH yet. See ${SITE}/versions" ;;
esac

say "Finding the latest release..."

RELEASE="$(curl -fsSL -H 'User-Agent: adcode-installer' "$API" 2>/dev/null)" \
  || fail "Couldn't reach GitHub to find a release. Check your connection and try again."

URL="$(printf '%s' "$RELEASE" \
  | grep -o '"browser_download_url": *"[^"]*"' \
  | sed 's/.*"browser_download_url": *"//; s/"$//' \
  | grep -E "$(printf '%s' "$PATTERN" | sed 's/"$//')$" \
  | head -n 1)"

[ -n "$URL" ] || fail "That release has no build for your platform. See ${SITE}/versions"

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
  || fail "Download failed. Try again, or grab it from ${SITE}/versions"

# electron-builder publishes latest-linux.yml with a SHA-512 per artifact.
META_URL="$(printf '%s' "$RELEASE" \
  | grep -o '"browser_download_url": *"[^"]*"' \
  | sed 's/.*"browser_download_url": *"//; s/"$//' \
  | grep '/latest-linux.yml$' | head -n 1)"

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

# Everything somebody installing from a terminal needs next, printed in the terminal.
#
# A person who installs this way may never open the website, so the four things they will
# actually need - how to launch it, how it updates, how to remove it, and where to get
# help - are stated here rather than linked to. The ads sentence is here for the same
# reason: it is the one thing about this editor somebody should not discover by surprise.
guidance() {
  printf '\n  %sNext%s\n' "$BOLD" "$RESET"
  printf '    Launch            %s\n' "$1"
  printf '    Open a folder     adcode open .\n'
  printf '    Every command     adcode help\n'
  printf '\n  %sLooking after it%s\n' "$BOLD" "$RESET"
  printf '    Updates           automatic; turn off in Settings, Updates\n'
  printf '    Reinstall         run this same command again\n'
  printf '    Uninstall         %s\n' "$2"
  printf '\n  %sHelp%s\n' "$BOLD" "$RESET"
  printf '    In the editor     Help menu, Feature Guide - every feature, explained\n'
  printf '    Documentation     %s/docs\n' "$SITE"
  printf '    Something wrong   %s/support\n' "$SITE"
  printf '\n  %sADCode shows an occasional sponsored card and credits you half of what it pays.%s\n' "$DIM" "$RESET"
  printf '  %sTurn ads off entirely in Settings, Ads and Earnings. The editor stays complete.%s\n\n' "$DIM" "$RESET"
}

case "$FILE" in
  *.deb)
    say "Installing with dpkg (you'll be asked for your password)..."
    sudo dpkg -i "$WORKDIR/$FILE" || sudo apt-get install -f -y
    printf '\n  %sInstalled.%s\n' "$GREEN" "$RESET"
    guidance "adcode" "sudo apt remove adcode"
    ;;
  *.AppImage)
    DEST="${HOME}/.local/bin"
    mkdir -p "$DEST"
    mv "$WORKDIR/$FILE" "$DEST/adcode"
    chmod +x "$DEST/adcode"
    printf '\n  %sInstalled to %s/adcode%s\n' "$GREEN" "$DEST" "$RESET"

    case ":$PATH:" in
      *":$DEST:"*)
        guidance "adcode" "rm ${DEST}/adcode"
        ;;
      *)
        printf '  %s%s is not on your PATH.%s\n' "$YELLOW" "$DEST" "$RESET"
        printf '  %sAdd it with: echo '"'"'export PATH="$HOME/.local/bin:$PATH"'"'"' >> ~/.profile%s\n' "$DIM" "$RESET"
        guidance "${DEST}/adcode" "rm ${DEST}/adcode"
        ;;
    esac
    ;;
esac
