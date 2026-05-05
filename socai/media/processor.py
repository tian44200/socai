"""Thin facade over image, audio, and video media processors."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from socai.agent.backends import Backend

from .audio import AudioProcessor
from .common import MediaConfig, download_bytes, download_file, ensure_dir, save_bytes
from .image import ImageProcessor
from .video import VideoProcessor


class MediaProcessor:
    """Optional media processor for XHS image/video enrichment."""

    def __init__(self, config: MediaConfig, *, backend: Backend | None = None):
        self.config = config
        ensure_dir(self.config.base_dir)
        self.images = ImageProcessor(config, backend=backend)
        self.audio = AudioProcessor(config, backend=backend)
        self.video = VideoProcessor(config, images=self.images, audio=self.audio)

    @classmethod
    def for_run_dir(cls, run_dir: str | Path, *, backend: Backend | None = None) -> "MediaProcessor":
        return cls(MediaConfig(base_dir=Path(run_dir) / "site_media"), backend=backend)

    def download_bytes(self, url: str, *, referer: str = "") -> bytes:
        return download_bytes(url, referer=referer, timeout=self.config.request_timeout_s)

    def save_bytes(self, payload: bytes, *, label: str, suffix: str = ".bin") -> str:
        return save_bytes(self.config.base_dir, payload, label=label, suffix=suffix)

    def download_file(self, url: str, *, referer: str = "", label: str = "media", suffix: str = "") -> str:
        return download_file(
            self.config.base_dir,
            url,
            referer=referer,
            label=label,
            suffix=suffix,
            timeout=self.config.request_timeout_s,
        )

    def ocr_image(self, payload: bytes) -> str:
        return self.images.ocr_image(payload)

    def describe_image(self, payload: bytes, prompt: str, *, max_tokens: int = 180) -> str:
        return self.images.describe_image(payload, prompt, max_tokens=max_tokens)

    def enrich_images(
        self,
        images: list[dict[str, Any]],
        *,
        referer: str = "",
        label: str = "image",
        run_vision: bool = False,
    ) -> list[dict[str, Any]]:
        return self.images.enrich_images(images, referer=referer, label=label, run_vision=run_vision)

    def transcribe_video(self, source: str, *, referer: str = "", language: str = "") -> str:
        return self.audio.transcribe_audio(source, referer=referer, language=language)

    def extract_video_frames(
        self,
        source: str,
        *,
        referer: str = "",
        max_seconds: int | None = None,
        num_frames: int = 4,
    ) -> list[str]:
        return self.video.extract_video_frames(
            source,
            referer=referer,
            max_seconds=max_seconds,
            num_frames=num_frames,
        )

    def enrich_video(
        self,
        video: dict[str, Any],
        *,
        note_id: str = "",
        title: str = "",
        referer: str = "",
        max_frames: int = 4,
        run_vision: bool = False,
    ) -> dict[str, Any]:
        return self.video.enrich_video(
            video,
            note_id=note_id,
            title=title,
            referer=referer,
            max_frames=max_frames,
            run_vision=run_vision,
        )

    def diagnostics(self) -> dict[str, Any]:
        return {
            **self.images.diagnostics(),
            **self.audio.diagnostics(),
        }
