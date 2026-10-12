from pathlib import Path
import os
import importlib.util
import platform

from .schemas import TranscriptResult, TranscriptSegment, WhisperModelSize, LocalProvider


PROVIDER_LABELS = {
    "faster-whisper": "Faster Whisper",
    "openai-whisper": "OpenAI Whisper",
    "mlx-whisper": "MLX Whisper",
}


def provider_unavailable_reason(provider: LocalProvider) -> str | None:
    if provider == "mlx-whisper" and (platform.system() != "Darwin" or platform.machine() != "arm64"):
        return "MLX Whisper 仅支持 Apple 芯片 Mac；请使用原生 arm64 Python"
    module = {"faster-whisper": "faster_whisper", "openai-whisper": "whisper", "mlx-whisper": "mlx_whisper"}[provider]
    if importlib.util.find_spec(module) is None:
        return f"{PROVIDER_LABELS[provider]} 未安装，请使用新版 install.sh 安装或更新 Helper"
    return None


class WhisperModelManager:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def path_for(self, model: WhisperModelSize, provider: LocalProvider = "faster-whisper") -> Path:
        # Keep the existing Faster Whisper cache path for installed users.
        return self.root / model if provider == "faster-whisper" else self.root / provider / model

    def is_installed(self, model: WhisperModelSize, provider: LocalProvider = "faster-whisper") -> bool:
        path = self.path_for(model, provider)
        if provider == "openai-whisper":
            return (path / ".complete").is_file() and (path / f"{model}.pt").is_file()
        if provider == "mlx-whisper":
            return (path / ".complete").is_file() and (path / "config.json").is_file() and any(
                (path / name).is_file() for name in ("weights.npz", "weights.safetensors", "model.safetensors")
            )
        return (path / "model.bin").is_file() and (path / "config.json").is_file()

    def download(self, model: WhisperModelSize, provider: LocalProvider = "faster-whisper") -> None:
        reason = provider_unavailable_reason(provider)
        if reason:
            raise RuntimeError(reason)
        path = self.path_for(model, provider)
        path.mkdir(parents=True, exist_ok=True)
        if provider == "openai-whisper":
            import whisper

            # The public loader downloads, verifies the checkpoint, and validates it.
            loaded = whisper.load_model(model, device="cpu", download_root=str(path))
            del loaded
            (path / ".complete").touch()
            return
        os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
        if provider == "mlx-whisper":
            from huggingface_hub import snapshot_download

            suffix = model if model == "large-v3-turbo" else f"{model}-mlx"
            snapshot_download(
                repo_id=f"mlx-community/whisper-{suffix}", local_dir=str(path),
                allow_patterns=["config.json", "weights.npz", "weights.safetensors", "model.safetensors"],
            )
            if not (path / "config.json").is_file() or not any(
                (path / name).is_file() for name in ("weights.npz", "weights.safetensors", "model.safetensors")
            ):
                raise RuntimeError("MLX 模型下载未完成")
            (path / ".complete").touch()
            return
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

    def delete(self, model: WhisperModelSize, provider: LocalProvider = "faster-whisper") -> None:
        import shutil

        path = self.path_for(model, provider)
        if path.exists():
            shutil.rmtree(path)

    def transcribe(self, audio_path: Path, model: WhisperModelSize, provider: LocalProvider = "faster-whisper") -> TranscriptResult:
        reason = provider_unavailable_reason(provider)
        if reason:
            raise RuntimeError(reason)
        if not self.is_installed(model, provider):
            raise RuntimeError(f"{PROVIDER_LABELS[provider]} 模型 {model} 尚未安装")
        if provider != "faster-whisper":
            return self._transcribe_whisper(audio_path, model, provider)
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

    def _transcribe_whisper(self, audio_path: Path, model: WhisperModelSize, provider: LocalProvider) -> TranscriptResult:
        # PyAV (already used by Faster Whisper) decodes to mono 16 kHz, avoiding
        # an extra system ffmpeg requirement for the official and MLX engines.
        from faster_whisper.audio import decode_audio

        audio = decode_audio(str(audio_path), sampling_rate=16000)
        path = self.path_for(model, provider)
        if provider == "openai-whisper":
            import whisper

            loaded = whisper.load_model(str(path / f"{model}.pt"), device="cpu")
            result = loaded.transcribe(audio, fp16=False, verbose=None)
        else:
            import mlx_whisper

            result = mlx_whisper.transcribe(audio, path_or_hf_repo=str(path), verbose=None)
        segments = [
            TranscriptSegment(start=float(item["start"]), end=float(item["end"]), text=item["text"].strip())
            for item in result["segments"] if item["text"].strip()
        ]
        return TranscriptResult(
            language=result.get("language", "und"),
            fullText=" ".join(segment.text for segment in segments),
            segments=segments, source=provider,
        )
