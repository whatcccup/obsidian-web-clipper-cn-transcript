#!/usr/bin/env python3
import json
import os
import secrets
import signal
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


APP_DIR = Path.home() / "Library" / "Application Support" / "ClipNote"
CONFIG_PATH = APP_DIR / "config.json"
SESSION_PATH = APP_DIR / "runtime" / "session.json"
LOG_PATH = APP_DIR / "logs" / "helper.log"


def read_message() -> dict:
    raw_length = sys.stdin.buffer.read(4)
    if len(raw_length) != 4:
        return {"action": "status"}
    length = struct.unpack("=I", raw_length)[0]
    return json.loads(sys.stdin.buffer.read(length).decode("utf-8"))


def write_message(message: dict) -> None:
    encoded = json.dumps(message, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("=I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def process_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except (ProcessLookupError, PermissionError):
        return False


def health(session: dict, timeout: float = 1.0) -> dict | None:
    if not session.get("pid") or not process_alive(int(session["pid"])):
        return None
    request = urllib.request.Request(
        f"{session['url']}/v1/health",
        headers={"Authorization": f"Bearer {session['token']}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, KeyError):
        return None


def status() -> dict:
    session = load_json(SESSION_PATH)
    current_health = health(session)
    if not current_health:
        if SESSION_PATH.exists():
            SESSION_PATH.unlink()
        return {"ok": True, "status": "stopped"}
    return {"ok": True, "status": "ready", **session, "health": current_health}


def start() -> dict:
    current = status()
    if current["status"] == "ready":
        return current
    config = load_json(CONFIG_PATH)
    python = config.get("python")
    helper_dir = config.get("helperDir")
    if not python or not helper_dir or not Path(python).exists():
        return {"ok": False, "status": "not-installed", "error": "Transcript Helper 未正确安装"}

    port = int(config.get("port", 8484))
    token = secrets.token_urlsafe(32)
    env = os.environ.copy()
    env["CLIP_NOTE_TOKEN"] = token
    env["CLIP_NOTE_IDLE_TIMEOUT"] = str(config.get("idleTimeoutSeconds", 900))
    node_dir = config.get("nodeDir")
    if node_dir:
        env["PATH"] = f"{node_dir}:{env.get('PATH', '')}"
    APP_DIR.joinpath("runtime").mkdir(parents=True, exist_ok=True)
    APP_DIR.joinpath("logs").mkdir(parents=True, exist_ok=True)
    with LOG_PATH.open("ab") as log:
        process = subprocess.Popen(
            [python, "-m", "uvicorn", "clip_note_helper.api:app", "--host", "127.0.0.1", "--port", str(port)],
            cwd=helper_dir,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=log,
            start_new_session=True,
        )
    session = {
        "pid": process.pid,
        "url": f"http://127.0.0.1:{port}",
        "token": token,
        "startedAt": int(time.time() * 1000),
    }
    SESSION_PATH.write_text(json.dumps(session), encoding="utf-8")
    os.chmod(SESSION_PATH, 0o600)
    for _ in range(150):
        current_health = health(session, timeout=0.5)
        if current_health:
            return {"ok": True, "status": "ready", **session, "health": current_health}
        if not process_alive(process.pid):
            break
        time.sleep(0.1)
    return {"ok": False, "status": "error", "error": f"Helper 启动失败，请查看 {LOG_PATH}"}


def stop() -> dict:
    session = load_json(SESSION_PATH)
    if not session.get("pid") or not process_alive(int(session["pid"])):
        if SESSION_PATH.exists():
            SESSION_PATH.unlink()
        return {"ok": True, "status": "stopped"}
    request = urllib.request.Request(
        f"{session['url']}/v1/shutdown",
        method="POST",
        headers={"Authorization": f"Bearer {session['token']}"},
    )
    try:
        urllib.request.urlopen(request, timeout=2).read()
    except (urllib.error.URLError, TimeoutError, KeyError):
        os.kill(int(session["pid"]), signal.SIGTERM)
    for _ in range(30):
        if not process_alive(int(session["pid"])):
            break
        time.sleep(0.1)
    if SESSION_PATH.exists():
        SESSION_PATH.unlink()
    return {"ok": True, "status": "stopped"}


def handle(message: dict) -> dict:
    action = message.get("action", "status")
    if action == "start":
        return start()
    if action == "stop":
        return stop()
    if action == "restart":
        stop()
        return start()
    if action == "status":
        return status()
    return {"ok": False, "status": "error", "error": f"不支持的操作：{action}"}


if __name__ == "__main__":
    try:
        write_message(handle(read_message()))
    except Exception as exc:
        write_message({"ok": False, "status": "error", "error": str(exc)})
