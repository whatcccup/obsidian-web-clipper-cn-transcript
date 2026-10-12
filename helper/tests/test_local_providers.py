import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
from transcript_helper.models import WhisperModelManager, provider_unavailable_reason
from transcript_helper.schemas import TranscriptionRequest, TaskStatus
from transcript_helper.service import TranscriptionService

# Import the API without creating any directories in the real user's home.
with tempfile.TemporaryDirectory() as import_home, patch.object(Path, "home", return_value=Path(import_home)):
    from transcript_helper import api


class LocalProviderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.manager = WhisperModelManager(self.root / "models")

    def install_fixture(self, provider, model="tiny"):
        path = self.manager.path_for(model, provider)
        path.mkdir(parents=True, exist_ok=True)
        names = {"faster-whisper": ["model.bin", "config.json"],
                 "openai-whisper": ["tiny.pt", ".complete"],
                 "mlx-whisper": ["weights.npz", "config.json", ".complete"]}[provider]
        for name in names:
            (path / name).write_text("fixture")
        return path

    def test_model_directories_and_deletion_are_isolated(self):
        for provider in ("faster-whisper", "openai-whisper", "mlx-whisper"):
            self.install_fixture(provider)
            self.assertTrue(self.manager.is_installed("tiny", provider))
        self.assertEqual(self.manager.path_for("tiny"), self.root / "models" / "tiny")
        self.manager.delete("tiny", "openai-whisper")
        self.assertFalse(self.manager.is_installed("tiny", "openai-whisper"))
        self.assertTrue(self.manager.is_installed("tiny", "faster-whisper"))
        self.assertTrue(self.manager.is_installed("tiny", "mlx-whisper"))

    def test_incomplete_download_is_not_installed(self):
        for provider in ("openai-whisper", "mlx-whisper"):
            path = self.install_fixture(provider)
            (path / ".complete").unlink()
            self.assertFalse(self.manager.is_installed("tiny", provider))

    def test_mlx_rejects_intel_and_missing_runtime_is_actionable(self):
        with patch("transcript_helper.models.platform.machine", return_value="x86_64"):
            self.assertIn("Apple", provider_unavailable_reason("mlx-whisper"))
        with patch("transcript_helper.models.importlib.util.find_spec", return_value=None):
            self.assertIn("install.sh", provider_unavailable_reason("openai-whisper"))

    def test_openai_download_marks_complete_only_after_success(self):
        fake = SimpleNamespace(load_model=Mock(side_effect=RuntimeError("download failed")))
        with patch.dict(sys.modules, {"whisper": fake}), patch("transcript_helper.models.provider_unavailable_reason", return_value=None):
            with self.assertRaises(RuntimeError):
                self.manager.download("tiny", "openai-whisper")
        self.assertFalse((self.manager.path_for("tiny", "openai-whisper") / ".complete").exists())

    def test_both_new_engines_receive_decoded_audio_and_return_timestamps(self):
        raw = {"language": "zh", "segments": [{"start": 0.25, "end": 1.5, "text": " 测试 "},
                                                {"start": 1.5, "end": 2, "text": " "}]}
        decoded = object()
        for provider in ("openai-whisper", "mlx-whisper"):
            path = self.install_fixture(provider)
            run = Mock(return_value=raw)
            load = Mock(return_value=SimpleNamespace(transcribe=run))
            modules = {"whisper": SimpleNamespace(load_model=load),
                       "mlx_whisper": SimpleNamespace(transcribe=run),
                       "faster_whisper.audio": SimpleNamespace(decode_audio=Mock(return_value=decoded))}
            with patch.dict(sys.modules, modules), patch("transcript_helper.models.provider_unavailable_reason", return_value=None):
                result = self.manager.transcribe(self.root / "audio.m4a", "tiny", provider)
            self.assertEqual((result.source, result.language, result.fullText), (provider, "zh", "测试"))
            self.assertEqual((result.segments[0].start, result.segments[0].end), (0.25, 1.5))
            self.assertIs(run.call_args.args[0], decoded)
            if provider == "openai-whisper":
                load.assert_called_once_with(str(path / "tiny.pt"), device="cpu")
                self.assertFalse(run.call_args.kwargs["fp16"])
            else:
                self.assertEqual(run.call_args.kwargs["path_or_hf_repo"], str(path))

    def test_transcription_cache_separates_engines(self):
        service = TranscriptionService(self.root)
        self.addCleanup(service.executor.shutdown)
        paths = {service._cache_path(TranscriptionRequest(url="https://www.youtube.com/watch?v=example", provider=p, whisperModel="tiny"))
                 for p in ("faster-whisper", "openai-whisper", "mlx-whisper")}
        self.assertEqual(len(paths), 3)

    def test_service_routes_selected_provider_and_preserves_segments(self):
        service = TranscriptionService(self.root)
        self.addCleanup(service.executor.shutdown)
        from transcript_helper.schemas import TranscriptResult, TranscriptSegment
        for provider in ("openai-whisper", "mlx-whisper"):
            request = TranscriptionRequest(url="https://www.youtube.com/watch?v=example", provider=provider)
            service.tasks[provider] = TaskStatus(task_id=provider, status="queued", stage="queued")
            result = TranscriptResult(language="zh", fullText="测试", source=provider,
                                      segments=[TranscriptSegment(start=0, end=1, text="测试")])
            with patch("transcript_helper.service.download_audio", return_value=self.root / "audio.m4a"), patch.object(service.model_manager, "transcribe", return_value=result) as transcribe:
                service._run(provider, request)
            self.assertEqual(transcribe.call_args.args[2], provider)
            self.assertEqual(service.tasks[provider].status, "completed")
            self.assertEqual(service.tasks[provider].result, result)


class ModelApiTests(unittest.TestCase):
    install_fixture = LocalProviderTests.install_fixture
    def setUp(self):
        LocalProviderTests.setUp(self)
        self.service = TranscriptionService(self.root)
        self.addCleanup(self.service.executor.shutdown)
        self.service.model_manager = self.manager
        patcher = patch.object(api, "service", self.service)
        patcher.start()
        self.addCleanup(patcher.stop)
        availability = patch.object(api, "provider_unavailable_reason", return_value=None)
        availability.start()
        self.addCleanup(availability.stop)
        api.model_downloads.clear()
        self.client = TestClient(api.app)
        self.addCleanup(self.client.close)

    def test_api_defaults_preserve_faster_and_new_status_is_separate(self):
        self.install_fixture("faster-whisper")
        self.assertEqual(self.client.get("/v1/models/tiny/status").json()["status"], "installed")
        response = self.client.get("/v1/models/tiny/status?provider=openai-whisper").json()
        self.assertEqual((response["provider"], response["status"]), ("openai-whisper", "not-installed"))

    def test_unavailable_or_missing_model_rejected_before_task(self):
        with patch.object(self.service, "create") as create:
            response = self.client.post("/v1/transcriptions", json={"url": "https://www.youtube.com/watch?v=example", "provider": "mlx-whisper", "whisperModel": "tiny"})
            self.assertEqual(response.status_code, 409)
            with patch.object(api, "provider_unavailable_reason", return_value="MLX unavailable"):
                self.assertEqual(self.client.post("/v1/models/tiny/download?provider=mlx-whisper").status_code, 409)
            create.assert_not_called()

    def test_download_status_and_deduplication_are_per_engine(self):
        with patch.object(self.service.executor, "submit") as submit:
            for provider in ("faster-whisper", "openai-whisper", "mlx-whisper", "mlx-whisper"):
                response = self.client.post(f"/v1/models/tiny/download?provider={provider}")
                self.assertEqual(response.status_code, 202)
            self.assertEqual(submit.call_count, 3)
        self.assertEqual(len(api.model_downloads), 3)

    def test_delete_preserves_other_engine_and_blocks_active_work(self):
        for provider in ("faster-whisper", "openai-whisper"):
            self.install_fixture(provider)
        api.model_downloads["mlx-whisper:tiny"] = "downloading"
        self.assertEqual(self.client.delete("/v1/models/tiny?provider=openai-whisper").status_code, 409)
        api.model_downloads.clear()
        self.assertEqual(self.client.delete("/v1/models/tiny?provider=openai-whisper").status_code, 200)
        self.assertTrue(self.manager.is_installed("tiny"))
        self.assertFalse(self.manager.is_installed("tiny", "openai-whisper"))

    def test_invalid_provider_and_model_rejected(self):
        self.assertEqual(self.client.get("/v1/models/tiny/status?provider=invalid").status_code, 422)
        self.assertEqual(self.client.get("/v1/models/invalid/status?provider=mlx-whisper").status_code, 422)


if __name__ == "__main__":
    unittest.main()
