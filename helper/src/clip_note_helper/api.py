import importlib.util
import os
import signal
import shutil
import threading
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .bcut import BcutClient
from .schemas import TaskCreated, TaskStatus, TranscriptionRequest, WhisperModelSize
from .service import TranscriptionService


DATA_ROOT = Path.home() / ".cache" / "clip-note"
service = TranscriptionService(DATA_ROOT)
model_downloads: dict[str, str] = {}
model_downloads_lock = threading.Lock()
auth_token = os.environ.get("CLIP_NOTE_TOKEN", "")
idle_timeout_seconds = int(os.environ.get("CLIP_NOTE_IDLE_TIMEOUT", "900"))
last_activity = time.monotonic()
activity_lock = threading.Lock()
app = FastAPI(title="Transcript Helper", version=__version__)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(chrome-extension://[a-p]{32}|moz-extension://[0-9a-f-]+|http://(localhost|127\.0\.0\.1)(:\d+)?)$",
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)


@app.middleware("http")
async def authorize_and_track(request: Request, call_next):
    global last_activity
    if request.method != "OPTIONS" and auth_token:
        if request.headers.get("Authorization") != f"Bearer {auth_token}":
            from fastapi.responses import JSONResponse

            return JSONResponse(status_code=401, content={"detail": "Transcript Helper 会话无效"})
    with activity_lock:
        last_activity = time.monotonic()
    return await call_next(request)


def _has_active_work() -> bool:
    with model_downloads_lock:
        model_active = any(status == "downloading" for status in model_downloads.values())
    return model_active or service.has_active_tasks()


def _idle_monitor() -> None:
    while True:
        time.sleep(min(5, max(1, idle_timeout_seconds)))
        with activity_lock:
            idle_for = time.monotonic() - last_activity
        if idle_timeout_seconds > 0 and idle_for >= idle_timeout_seconds and not _has_active_work():
            os.kill(os.getpid(), signal.SIGTERM)
            return


@app.on_event("startup")
def start_idle_monitor() -> None:
    threading.Thread(target=_idle_monitor, name="clip-note-idle", daemon=True).start()


@app.get("/v1/health")
def health() -> dict:
    return {
        "status": "ok",
        "version": __version__,
        "idleTimeoutSeconds": idle_timeout_seconds,
        "capabilities": {
            "bilibili": True,
            "youtube": True,
            "bcut": True,
            "fasterWhisper": importlib.util.find_spec("faster_whisper") is not None,
            "node": shutil.which("node") is not None,
        },
    }


@app.post("/v1/shutdown")
def shutdown() -> dict:
    threading.Timer(0.2, lambda: os.kill(os.getpid(), signal.SIGTERM)).start()
    return {"status": "stopping"}


@app.get("/v1/transcribers")
def transcribers() -> dict:
    return {
        "transcribers": [
            {"id": "bcut", "available": BcutClient().is_available(), "remote": True},
            {
                "id": "faster-whisper",
                "available": importlib.util.find_spec("faster_whisper") is not None,
                "remote": False,
            },
        ]
    }


@app.post("/v1/transcriptions", response_model=TaskCreated, status_code=202)
def create_transcription(request: TranscriptionRequest) -> TaskCreated:
    if request.provider == "faster-whisper" and not service.model_manager.is_installed(request.whisperModel):
        raise HTTPException(status_code=409, detail=f"模型 {request.whisperModel} 尚未安装")
    return service.create(request)


@app.get("/v1/transcriptions/{task_id}", response_model=TaskStatus)
def get_transcription(task_id: str) -> TaskStatus:
    task = service.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    return task


@app.post("/v1/models/{model}/download", status_code=202)
def download_model(model: WhisperModelSize) -> dict:
    if service.model_manager.is_installed(model):
        return {"model": model, "status": "installed"}
    with model_downloads_lock:
        if model_downloads.get(model) == "downloading":
            return {"model": model, "status": "downloading"}
        model_downloads[model] = "downloading"

    def run_download() -> None:
        try:
            service.model_manager.download(model)
            status = "installed"
        except Exception:
            status = "failed"
        with model_downloads_lock:
            model_downloads[model] = status

    service.executor.submit(run_download)
    return {"model": model, "status": "downloading"}


@app.get("/v1/models/{model}/status")
def model_status(model: WhisperModelSize) -> dict:
    path = service.model_manager.path_for(model)
    with model_downloads_lock:
        active_status = model_downloads.get(model)
    status = "installed" if service.model_manager.is_installed(model) else (active_status or "not-installed")
    return {
        "model": model,
        "status": status,
        "sizeBytes": sum(item.stat().st_size for item in path.rglob("*") if item.is_file()) if path.exists() else 0,
    }


@app.delete("/v1/models/{model}")
def delete_model(model: WhisperModelSize) -> dict:
    service.model_manager.delete(model)
    with model_downloads_lock:
        model_downloads.pop(model, None)
    return {"model": model, "status": "not-installed"}
