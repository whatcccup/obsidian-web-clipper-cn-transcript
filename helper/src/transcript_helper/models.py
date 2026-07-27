from pathlib import Path
import os

from .schemas import TranscriptResult, TranscriptSegment, WhisperModelSize


class WhisperModelManager:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def path_for(self, model: WhisperModelSize) -> Path:
        return self.root / model

    def is_installed(self, model: WhisperModelSize) -> bool:
        path = self.path_for(model)
        return (path / "model.bin").is_file() and (path / "config.json").is_file()

    def download(self, model: WhisperModelSize) -> None:
        os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
        try:
            from faster_whisper.utils import download_model
        except ImportError as exc:
            raise RuntimeError("faster-whisper 未安装") from exc
        path = self.path_for(model)
        path.mkdir(parents=True, exist_ok=True)
        faster_whisper_name = "turbo" if model == "large-v3-turbo" else model
        download_model(faster_whisper_name, output_dir=str(path))
        if not self.is_installed(model):
            raise RuntimeError("模型下载未完成")

    def delete(self, model: WhisperModelSize) -> None:
        import shutil

        path = self.path_for(model)
        if path.exists():
            shutil.rmtree(path)

    def transcribe(self, audio_path: Path, model: WhisperModelSize) -> TranscriptResult:
        if not self.is_installed(model):
            raise RuntimeError(f"Faster Whisper 模型 {model} 尚未安装")
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:
            raise RuntimeError("faster-whisper 未安装") from exc
        whisper = WhisperModel(
            str(self.path_for(model)), device="cpu", compute_type="int8"
        )
        raw_segments, info = whisper.transcribe(
            str(audio_path), beam_size=5, vad_filter=True
        )
        segments = [
            TranscriptSegment(
                start=float(segment.start),
                end=float(segment.end),
                text=segment.text.strip(),
            )
            for segment in raw_segments
            if segment.text.strip()
        ]
        return TranscriptResult(
            language=info.language,
            fullText=" ".join(segment.text for segment in segments),
            segments=segments,
            source="faster-whisper",
        )
