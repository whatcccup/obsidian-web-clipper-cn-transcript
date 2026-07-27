from typing import Literal

from pydantic import BaseModel, Field, HttpUrl


WhisperModelSize = Literal[
    "tiny", "base", "small", "medium", "large-v3", "large-v3-turbo"
]
Provider = Literal["bcut", "faster-whisper"]


class StoredCookie(BaseModel):
    domain: str
    name: str
    value: str
    path: str = "/"
    secure: bool = False
    expirationDate: float | None = None
    httpOnly: bool = False


class TranscriptSegment(BaseModel):
    start: float
    end: float
    text: str


class TranscriptResult(BaseModel):
    language: str
    fullText: str
    segments: list[TranscriptSegment]
    source: Literal["platform", "bcut", "faster-whisper"]


class TranscriptionRequest(BaseModel):
    url: HttpUrl
    provider: Provider
    whisperModel: WhisperModelSize = "base"
    cookies: list[StoredCookie] = Field(default_factory=list)


class TaskCreated(BaseModel):
    task_id: str
    status: Literal["queued"] = "queued"


class TaskStatus(BaseModel):
    task_id: str
    status: Literal["queued", "downloading", "transcribing", "completed", "failed"]
    stage: str
    result: TranscriptResult | None = None
    error: str | None = None

