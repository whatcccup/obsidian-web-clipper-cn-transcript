#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
if [ -d "$WORKSPACE_ROOT/helper" ]; then
  SOURCE_HELPER="$WORKSPACE_ROOT/helper"
else
  SOURCE_HELPER="$WORKSPACE_ROOT/transcript-helper"
fi
INSTALL_DIR="$HOME/Library/Application Support/TranscriptGenerator"
LEGACY_INSTALL_DIR="$HOME/Library/Application Support/ClipNote"
LEGACY_CACHE_DIR="$HOME/.cache/clip-note"
CACHE_DIR="$HOME/.cache/transcript-generator"
HELPER_DIR="$INSTALL_DIR/helper"
LAUNCHER_DIR="$INSTALL_DIR/launcher"
BIN_DIR="$INSTALL_DIR/bin"
NATIVE_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
HOST_NAME="cn.transcript.generator.launcher"
LEGACY_HOST_NAME="cn.clipnote.launcher"
EXTENSION_ID="nkmploheccefaplolbophdngjnoncani"
FORCE=false

for arg in "$@"; do
  case "$arg" in
    --force)
      FORCE=true
      ;;
    *)
      echo "Error: unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

if { [ -d "$INSTALL_DIR" ] || [ -d "$LEGACY_INSTALL_DIR" ]; } && [ "$FORCE" != true ]; then
  echo "Error: an existing Transcript Helper installation was found." >&2
  echo "Run the repository root install.sh to confirm an overwrite installation." >&2
  exit 2
fi

if ! command -v uv >/dev/null 2>&1; then
  echo "Error: uv is required to prepare the local Helper runtime." >&2
  exit 1
fi

if [ -d "$LEGACY_INSTALL_DIR" ] && [ ! -e "$INSTALL_DIR" ]; then
  mv "$LEGACY_INSTALL_DIR" "$INSTALL_DIR"
fi
if [ -d "$LEGACY_CACHE_DIR" ] && [ ! -e "$CACHE_DIR" ]; then
  mv "$LEGACY_CACHE_DIR" "$CACHE_DIR"
fi

mkdir -p "$HELPER_DIR/src" "$LAUNCHER_DIR" "$BIN_DIR" "$INSTALL_DIR/runtime" "$INSTALL_DIR/logs" "$NATIVE_DIR"
cp "$SOURCE_HELPER/pyproject.toml" "$HELPER_DIR/pyproject.toml"
if [ -f "$SOURCE_HELPER/uv.lock" ]; then cp "$SOURCE_HELPER/uv.lock" "$HELPER_DIR/uv.lock"; fi
rm -rf "$HELPER_DIR/src/transcript_helper" "$HELPER_DIR/src/clip_note_helper"
cp -R "$SOURCE_HELPER/src/transcript_helper" "$HELPER_DIR/src/transcript_helper"
cp "$SCRIPT_DIR/transcript_launcher.py" "$LAUNCHER_DIR/transcript_launcher.py"

(cd "$HELPER_DIR" && uv sync --python 3.11)

NODE_BIN="$(command -v node || true)"
NODE_DIR=""
if [ -n "$NODE_BIN" ]; then NODE_DIR="$(dirname "$NODE_BIN")"; fi

cat > "$INSTALL_DIR/config.json" <<EOF
{
  "python": "$HELPER_DIR/.venv/bin/python",
  "helperDir": "$HELPER_DIR",
  "nodeDir": "$NODE_DIR",
  "port": 8484,
  "idleTimeoutSeconds": 900
}
EOF

cat > "$BIN_DIR/transcript-launcher" <<EOF
#!/bin/sh
exec "$HELPER_DIR/.venv/bin/python" "$LAUNCHER_DIR/transcript_launcher.py"
EOF
chmod 755 "$BIN_DIR/transcript-launcher"

cat > "$NATIVE_DIR/$HOST_NAME.json" <<EOF
{
  "name": "$HOST_NAME",
  "description": "Transcript Generator on-demand Helper launcher",
  "path": "$BIN_DIR/transcript-launcher",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTENSION_ID/"]
}
EOF

rm -f "$NATIVE_DIR/$LEGACY_HOST_NAME.json" "$BIN_DIR/clip-note-launcher" "$LAUNCHER_DIR/clip_note_launcher.py"

echo "Transcript Helper installed without LaunchAgent."
echo "Native host: $NATIVE_DIR/$HOST_NAME.json"
echo "Helper starts only when the browser extension requests it."
