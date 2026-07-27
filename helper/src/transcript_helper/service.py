import hashlib
import json
import tempfile
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .bcut import BcutClient
from .cookies import write_netscape_cookie_file
from .downloader import download_audio
from .models import WhisperModelManager
from .schemas import TaskCreated, TaskStatus, TranscriptionRequest, TranscriptResult


class TranscriptionService:
    def __init__(self, data_root: Path) -> None:
        self.model_manager = WhisperModelManager(data_root / "models")
        self.cache_root = data_root / "transcripts"
        self.cache_root.mkdir(parents=True, exist_ok=True)
        self.tasks: dict[str, TaskStatus] = {}
        self.lock = threading.Lock()
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="transcript-generator")

    def create(self, request: TranscriptionRequest) -> TaskCreated:
        task_id = uuid.uuid4().hex
        self.tasks[task_id] = TaskStatus(task_id=task_id, status="queued", stage="等待处理")
        self.executor.submit(self._run, task_id, request)
        return TaskCreated(task_id=task_id)

    def get(self, task_id: str) -> TaskStatus | None:
        return self.tasks.get(task_id)

    def has_active_tasks(self) -> bool:
        return any(task.status in {"queued", "downloading", "transcribing"} for task in self.tasks.values())

    def _update(self, task_id: str, **changes: object) -> None:
        with self.lock:
            current = self.tasks[task_id]
            self.tasks[task_id] = current.model_copy(update=changes)

    def _cache_path(self, request: TranscriptionRequest) -> Path:
        key = hashlib.sha256(
            f"{request.url}|{request.provider}|{request.whisperModel}".encode()
        ).hexdigest()
        return self.cache_root / f"{key}.json"

    def _run(self, task_id: str, request: TranscriptionRequest) -> None:
        cache_path = self._cache_path(request)
        try:
            if cache_path.exists():
                result = TranscriptResult.model_validate_json(cache_path.read_text())
                self._update(task_id, status="completed", stage="字幕已生成", result=result)
                return
            with tempfile.TemporaryDirectory(prefix="transcript-generator-") as temp_dir:
                root = Path(temp_dir)
                cookiefile = None
                if request.cookies:
                    cookiefile = root / "cookies.txt"
                    write_netscape_cookie_file(request.cookies, cookiefile)
                self._update(task_id, status="downloading", stage="正在下载音频")
                audio = download_audio(str(request.url), root, cookiefile)
                stage = "正在上传 BCut" if request.provider == "bcut" else "正在本地识别"
                self._update(task_id, status="transcribing", stage=stage)
                if request.provider == "bcut":
                    result = BcutClient().transcribe(audio)
                else:
                    result = self.model_manager.transcribe(audio, request.whisperModel)
                cache_path.write_text(
                    json.dumps(result.model_dump(), ensure_ascii=False), encoding="utf-8"
                )
                self._update(task_id, status="completed", stage="字幕已生成", result=result)
        except Exception as exc:
            self._update(task_id, status="failed", stage="生成失败", error=str(exc))
