#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="$HOME/Library/Application Support/TranscriptGenerator"
LEGACY_INSTALL_DIR="$HOME/Library/Application Support/ClipNote"
ASSUME_YES=false

usage() {
  echo "Usage: bash install.sh [--yes]"
  echo "  --yes  Confirm overwrite without an interactive prompt."
}

for arg in "$@"; do
  case "$arg" in
    --yes|-y)
      ASSUME_YES=true
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Error: unknown option: $arg" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Error: the current installer only supports macOS." >&2
  exit 1
fi

for command_name in node npm uv; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Error: $command_name is required." >&2
    exit 1
  fi
done

EXISTING_INSTALL_DIR=""
if [ -d "$INSTALL_DIR" ]; then
  EXISTING_INSTALL_DIR="$INSTALL_DIR"
elif [ -d "$LEGACY_INSTALL_DIR" ]; then
  EXISTING_INSTALL_DIR="$LEGACY_INSTALL_DIR"
fi

if [ -n "$EXISTING_INSTALL_DIR" ]; then
  echo "Existing Transcript Helper installation detected: $EXISTING_INSTALL_DIR"
  echo "The Helper and Launcher program files will be overwritten."
  echo "Browser settings, Cookies, templates, local models, and transcript cache will be preserved."
  if [ "$ASSUME_YES" != true ]; then
    if [ ! -t 0 ]; then
      echo "Error: interactive confirmation is required. Rerun with --yes to confirm." >&2
      exit 1
    fi
    printf "Continue with overwrite installation? [y/N] "
    read -r reply
    case "$reply" in
      y|Y|yes|YES)
        ;;
      *)
        echo "Installation cancelled."
        exit 0
        ;;
    esac
  fi
fi

echo "Building the Chrome extension..."
(cd "$SCRIPT_DIR/extension" && npm install && npm run build:chrome)

echo "Installing the on-demand Transcript Helper..."
bash "$SCRIPT_DIR/launcher/install-transcript.sh" --force

echo
echo "Obsidian Web Clipper CN · Transcript installation completed."
echo "Chrome extension directory: $SCRIPT_DIR/extension/dist"
echo "Open chrome://extensions and load or reload that directory."
echo "No LaunchAgent was created. The Helper starts only when requested by the extension."
