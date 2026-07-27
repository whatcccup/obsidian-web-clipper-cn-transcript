#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! REPOSITORY_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null)" || [ "$REPOSITORY_ROOT" != "$SCRIPT_DIR" ]; then
  echo "Error: update.sh must be run from a Git clone of Clip Note." >&2
  echo "Download or clone the latest source, then run bash install.sh --yes." >&2
  exit 1
fi

if [ -n "$(git -C "$SCRIPT_DIR" status --porcelain)" ]; then
  echo "Error: local source changes were found. Commit or remove them before updating." >&2
  exit 1
fi

echo "Downloading the latest Clip Note source..."
git -C "$SCRIPT_DIR" pull --ff-only

echo "Installing the updated extension and Helper..."
bash "$SCRIPT_DIR/install.sh" --yes

echo
echo "Clip Note update completed."
echo "Open chrome://extensions and click Reload on the existing Clip Note extension."
