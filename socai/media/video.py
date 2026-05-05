"""Video frame extraction and video-note enrichment."""

from __future__ import annotations

import hashlib
import shutil
from pathlib import Path
from typing import Any

from .audio import AudioProcessor
from .common import MediaConfig, MediaUnavailable, USER_AGENT, ensure_dir, run_command, short, url_suffix
from .image import ImageProcessor


class VideoProcessor:
    def __init__(self, config: MediaConfig, *, images: ImageProcessor, audio: AudioProcessor):
        self.config = config
        self.images = images
        self.audio = audio

    def extract_video_frames(
        self,
        source: str,
        *,
        referer: str = "",
        max_seconds: int | None = None,
        num_frames: int = 4,
    ) -> list[str]:
        if not self.config.use_ffmpeg:
            raise MediaUnavailable("ffmpeg frame extraction is disabled")
        if not shutil.which("ffmpeg"):
            raise MediaUnavailable("ffmpeg is not installed or not on PATH")
        frame_dir = ensure_dir(self.config.base_dir / "frames" / hashlib.md5(str(source).encode()).hexdigest()[:10])
        pattern = str(frame_dir / "frame_%02d.jpg")
        safe_frames = max(1, int(num_frames or 1))
        safe_seconds = max(1, int(max_seconds or self.config.max_frame_seconds))
        interval = max(1, safe_seconds // safe_frames)
        cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error"]
        if referer and str(source).startswith(("http://", "https://")):
            cmd.extend(["-headers", f"Referer: {referer}\r\nUser-Agent: {USER_AGENT}\r\n"])
        cmd.extend(
            [
                "-t",
                str(safe_seconds),
                "-i",
                str(source),
                "-vf",
                f"fps=1/{interval},scale=min(960\\,iw):-2",
                "-frames:v",
                str(safe_frames),
                pattern,
            ]
        )
        run_command(cmd, timeout=self.config.ffmpeg_timeout_s)
        return [str(path) for path in sorted(frame_dir.glob("frame_*.jpg"))]

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
        result = dict(video)
        source = str(result.get("resolved_url") or result.get("url") or "")
        poster_url = str(result.get("poster_url") or "")
        label = note_id or title or "video"

        if poster_url:
            try:
                poster = self.images.download_bytes(poster_url, referer=referer)
                result["poster_local_path"] = self.images.save_bytes(
                    poster,
                    label=f"{label}_poster",
                    suffix=url_suffix(poster_url, ".jpg"),
                )
                if self.config.use_ocr:
                    try:
                        result["poster_ocr"] = short(self.images.ocr_image(poster), 800)
                    except Exception as exc:  # noqa: BLE001
                        result["poster_ocr_error"] = str(exc)
                if run_vision and self.config.use_vision:
                    try:
                        result["poster_description"] = self.images.describe_image(
                            poster,
                            f"Describe the poster image for Xiaohongshu video: {title}",
                        )
                    except Exception as exc:  # noqa: BLE001
                        result["poster_vision_error"] = str(exc)
            except Exception as exc:  # noqa: BLE001
                result["poster_download_error"] = str(exc)

        if source:
            try:
                transcript = self.audio.transcribe_audio(source, referer=referer)
                result["transcript"] = transcript
                result["transcript_summary"] = short(transcript, 1200)
            except Exception as exc:  # noqa: BLE001
                result["transcript_error"] = str(exc)
            try:
                frame_paths = self.extract_video_frames(source, referer=referer, num_frames=max_frames)
                result["frame_paths"] = frame_paths
                frame_notes: list[str] = []
                for frame_path in frame_paths:
                    payload = Path(frame_path).read_bytes()
                    if run_vision and self.config.use_vision:
                        try:
                            frame_notes.append(
                                self.images.describe_image(payload, f"Describe this sampled video frame for: {title}")
                            )
                            continue
                        except Exception:
                            pass
                    if self.config.use_ocr:
                        try:
                            ocr = self.images.ocr_image(payload)
                            if ocr:
                                frame_notes.append(ocr)
                        except Exception:
                            pass
                if frame_notes:
                    result["frame_descriptions"] = frame_notes
                    result["visual_summary"] = short("\n".join(frame_notes), 1200)
            except Exception as exc:  # noqa: BLE001
                result["frame_error"] = str(exc)
        return result
