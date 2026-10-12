#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="$HOME/Library/Application Support/ObsidianWebClipperCNTranscript"
ASSUME_YES=false
WHISPER_MODEL="skip"
WHISPER_PROVIDER="faster-whisper"

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

for command_name in node uv; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Error: $command_name is required." >&2
    exit 1
  fi
done

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Error: Node.js 18 or newer is required. Current version: $(node --version)" >&2
  exit 1
fi

if [ -f "$SCRIPT_DIR/extension/package.json" ] && ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is required to build the Chrome extension from source." >&2
  exit 1
fi
if [ ! -f "$SCRIPT_DIR/extension/package.json" ] && [ ! -f "$SCRIPT_DIR/extension/dist/manifest.json" ]; then
  echo "Error: Chrome extension source or a prebuilt extension/dist directory is required." >&2
  exit 1
fi

EXISTING_INSTALL_DIR=""
if [ -d "$INSTALL_DIR" ]; then
  EXISTING_INSTALL_DIR="$INSTALL_DIR"
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

choose_whisper_model() {
  if [ "$ASSUME_YES" = true ] || [ ! -t 0 ]; then
    echo "Skipping Whisper model download. You can download a model later in the extension settings."
    return
  fi

  echo
  echo "Local engines: Faster Whisper, OpenAI Whisper (CPU), MLX Whisper (Apple Silicon GPU)."
  echo "Each engine uses separate model files; existing models are preserved."
  echo "Choose the engine for the model download:"
  echo "  1) Faster Whisper (default)"
  echo "  2) OpenAI Whisper"
  if [ "$(uname -m)" = "arm64" ]; then echo "  3) MLX Whisper"; fi
  echo "  4) Skip model download"
  while true; do
    printf "Select [default 1]: "
    read -r engine_choice
    case "$engine_choice" in
      ""|1) WHISPER_PROVIDER="faster-whisper"; break ;;
      2) WHISPER_PROVIDER="openai-whisper"; break ;;
      3)
        if [ "$(uname -m)" = "arm64" ]; then
          WHISPER_PROVIDER="mlx-whisper"; break
        fi
        echo "MLX Whisper requires an Apple Silicon Mac running natively (arm64)."
        ;;
      4) return ;;
      *) echo "Please choose an available engine." ;;
    esac
  done
  echo "Choose a $WHISPER_PROVIDER model to download now:"
  echo "  1) tiny (recommended; extension default)"
  echo "  2) Skip (download later in the extension settings)"
  echo "  3) base"
  echo "  4) small"
  echo "  5) medium"
  echo "  6) large-v3"
  echo "  7) large-v3-turbo"
  while true; do
    printf "Select [1-7, default 1]: "
    read -r choice
    case "$choice" in
      ""|1) WHISPER_MODEL="tiny"; break ;;
      2) WHISPER_MODEL="skip"; break ;;
      3) WHISPER_MODEL="base"; break ;;
      4) WHISPER_MODEL="small"; break ;;
      5) WHISPER_MODEL="medium"; break ;;
      6) WHISPER_MODEL="large-v3"; break ;;
      7) WHISPER_MODEL="large-v3-turbo"; break ;;
      *) echo "Please enter a number from 1 to 7." ;;
    esac
  done
}

choose_whisper_model

if [ -f "$SCRIPT_DIR/extension/package.json" ]; then
  echo "Building the Chrome extension..."
  (cd "$SCRIPT_DIR/extension" && npm install && npm run build:chrome)
else
  echo "Using the prebuilt Chrome extension from extension/dist."
fi

echo "Installing the on-demand Transcript Helper..."
bash "$SCRIPT_DIR/launcher/install-transcript.sh" --force

if [ "$WHISPER_MODEL" != "skip" ]; then
  echo "Downloading $WHISPER_PROVIDER model: $WHISPER_MODEL"
  if "$INSTALL_DIR/helper/.venv/bin/python" - "$WHISPER_MODEL" "$WHISPER_PROVIDER" <<'PY'
from pathlib import Path
import sys

from transcript_helper.models import WhisperModelManager

model = sys.argv[1]
manager = WhisperModelManager(Path.home() / ".cache" / "obsidian-web-clipper-cn-transcript" / "models")
manager.download(model, sys.argv[2])
PY
  then
    echo "$WHISPER_PROVIDER model installed: $WHISPER_MODEL"
    echo "After loading the extension, select $WHISPER_PROVIDER and $WHISPER_MODEL in Settings > Transcript Generator."
  else
    echo "Warning: model download failed. The extension and Helper are installed; retry from the extension settings." >&2
  fi
fi

echo
echo "Obsidian Web Clipper CN · Transcript installation completed."
echo "Chrome extension directory: $SCRIPT_DIR/extension/dist"
echo "Open chrome://extensions and load or reload that directory."
echo "No LaunchAgent was created. The Helper starts only when requested by the extension."
