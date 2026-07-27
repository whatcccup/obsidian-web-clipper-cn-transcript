import json
import time
from pathlib import Path

import requests

from .schemas import TranscriptResult, TranscriptSegment


API_BASE_URL = "https://member.bilibili.com/x/bcut/rubick-interface"
SUPPORTED_AUDIO = {"flac", "aac", "m4a", "mp3", "wav"}


class BcutClient:
    def __init__(self, session: requests.Session | None = None) -> None:
        self.session = session or requests.Session()
        self.session.headers.update(
            {
                "User-Agent": "Bilibili/1.0.0 (https://www.bilibili.com)",
                "Referer": "https://member.bilibili.com/",
            }
        )

    def _json(self, response: requests.Response) -> dict:
        response.raise_for_status()
        payload = response.json()
        if payload.get("code") != 0:
            raise RuntimeError(f"BCut API 错误：{payload.get('message', payload.get('code'))}")
        return payload["data"]

    def is_available(self) -> bool:
        try:
            response = self.session.get(
                f"{API_BASE_URL}/task/result",
                params={"model_id": 7, "task_id": "transcript-generator-health-check"},
                timeout=5,
            )
            return response.status_code < 500
        except requests.RequestException:
            return False

    def transcribe(self, audio_path: Path, poll_interval: float = 2.0) -> TranscriptResult:
        audio_format = audio_path.suffix.lower().lstrip(".")
        if audio_format not in SUPPORTED_AUDIO:
            raise RuntimeError(
                f"BCut 不支持 {audio_format or '未知'} 音频格式；请选择 Faster Whisper，或安装 FFmpeg 后转为 m4a/aac/mp3"
            )
        sound = audio_path.read_bytes()
        create = self._json(
            self.session.post(
                f"{API_BASE_URL}/resource/create",
                data={
                    "type": 2,
                    "name": audio_path.name,
                    "size": len(sound),
                    "resource_file_type": audio_format,
                    "model_id": 7,
                },
                timeout=30,
            )
        )
        etags: list[str] = []
        part_size = int(create["per_size"])
        for index, upload_url in enumerate(create["upload_urls"]):
            start = index * part_size
            response = self.session.put(
                upload_url,
                data=sound[start : start + part_size],
                timeout=120,
            )
            response.raise_for_status()
            etags.append((response.headers.get("Etag") or "").strip('"'))
        complete = self._json(
            self.session.post(
                f"{API_BASE_URL}/resource/create/complete",
                data={
                    "in_boss_key": create["in_boss_key"],
                    "resource_id": create["resource_id"],
                    "etags": ",".join(etags),
                    "upload_id": create["upload_id"],
                    "model_id": 7,
                },
                timeout=30,
            )
        )
        task = self._json(
            self.session.post(
                f"{API_BASE_URL}/task",
                json={"resource": complete["download_url"], "model_id": "7"},
                timeout=30,
            )
        )
        for _ in range(600):
            state = self._json(
                self.session.get(
                    f"{API_BASE_URL}/task/result",
                    params={"model_id": 7, "task_id": task["task_id"]},
                    timeout=30,
                )
            )
            if state["state"] == 4:
                return parse_bcut_result(state["result"])
            if state["state"] == 3:
                raise RuntimeError(f"BCut 识别失败：{state.get('remark', '未知错误')}")
            time.sleep(poll_interval)
        raise RuntimeError("BCut 识别超时")


def parse_bcut_result(raw_result: str | dict) -> TranscriptResult:
    payload = json.loads(raw_result) if isinstance(raw_result, str) else raw_result
    segments = [
        TranscriptSegment(
            start=float(item.get("start_time", 0)) / 1000,
            end=float(item.get("end_time", 0)) / 1000,
            text=str(item.get("transcript", "")).strip(),
        )
        for item in payload.get("utterances", [])
        if str(item.get("transcript", "")).strip()
    ]
    return TranscriptResult(
        language=str(payload.get("language", "unknown")),
        fullText=" ".join(segment.text for segment in segments),
        segments=segments,
        source="bcut",
    )
