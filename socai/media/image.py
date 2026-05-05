"""Image download, OCR, and current-backend vision helpers."""

from __future__ import annotations

import base64
from typing import Any

from socai.agent.backends import Backend

from .common import (
    MediaConfig,
    MediaUnavailable,
    detect_media_type,
    download_bytes,
    save_bytes,
    short,
    url_suffix,
)


class ImageProcessor:
    def __init__(self, config: MediaConfig, *, backend: Backend | None = None):
        self.config = config
        self.backend = backend

    def download_bytes(self, url: str, *, referer: str = "") -> bytes:
        return download_bytes(url, referer=referer, timeout=self.config.request_timeout_s)

    def save_bytes(self, payload: bytes, *, label: str, suffix: str = ".bin") -> str:
        return save_bytes(self.config.base_dir, payload, label=label, suffix=suffix)

    def ocr_image(self, payload: bytes) -> str:
        if not self.config.use_ocr:
            raise MediaUnavailable("OCR is disabled")
        if not payload:
            return ""
        try:
            import Foundation  # type: ignore
            import Vision  # type: ignore
        except Exception as exc:  # noqa: BLE001 - optional dependency
            raise MediaUnavailable("Apple Vision OCR is unavailable; install PyObjC Vision bindings") from exc

        data = Foundation.NSData.dataWithBytes_length_(payload, len(payload))
        handler = Vision.VNImageRequestHandler.alloc().initWithData_options_(data, {})
        request = Vision.VNRecognizeTextRequest.alloc().init()
        try:
            request.setRecognitionLanguages_(["zh-Hans", "zh-Hant", "en-US"])
            request.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
        except Exception:
            pass
        ok, error = handler.performRequests_error_([request], None)
        if not ok:
            raise RuntimeError(f"Apple Vision OCR failed: {error}")
        lines: list[str] = []
        for observation in request.results() or []:
            try:
                candidates = observation.topCandidates_(1)
                if candidates:
                    text = str(candidates[0].string() or "").strip()
                    if text:
                        lines.append(text)
            except Exception:
                continue
        return "\n".join(lines)

    def describe_image(self, payload: bytes, prompt: str, *, max_tokens: int = 180) -> str:
        if not self.config.use_vision:
            raise MediaUnavailable("Vision is disabled")
        if self.backend is None:
            raise MediaUnavailable("No agent LLM backend was provided for image vision")
        if not payload:
            return ""

        media_type = detect_media_type(payload) or "image/jpeg"
        response = self.backend.create_message(
            system="You describe images concisely and only state visible evidence.",
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": base64.b64encode(payload).decode("ascii"),
                            },
                        },
                    ],
                }
            ],
            tools=[],
            max_tokens=max_tokens,
        )
        return "\n".join(response.text_blocks).strip()

    def enrich_images(
        self,
        images: list[dict[str, Any]],
        *,
        referer: str = "",
        label: str = "image",
        run_vision: bool = False,
    ) -> list[dict[str, Any]]:
        enriched: list[dict[str, Any]] = []
        seen_hashes: set[str] = set()
        import hashlib

        for index, image in enumerate(images):
            url = str(image.get("url") or "").strip()
            if not url:
                continue
            item = dict(image)
            try:
                payload = self.download_bytes(url, referer=referer)
            except Exception as exc:  # noqa: BLE001 - per-media best effort
                item["download_error"] = f"{type(exc).__name__}: {exc}"
                enriched.append(item)
                continue
            digest = hashlib.md5(payload).hexdigest()
            if digest in seen_hashes:
                continue
            seen_hashes.add(digest)
            item["local_path"] = self.save_bytes(payload, label=f"{label}_{index + 1}", suffix=url_suffix(url, ".jpg"))
            if self.config.use_ocr and not item.get("ocr_text"):
                try:
                    item["ocr_text"] = short(self.ocr_image(payload), 800)
                except Exception as exc:  # noqa: BLE001 - optional capability
                    item["ocr_error"] = str(exc)
            if run_vision and self.config.use_vision and not item.get("vision_description"):
                try:
                    item["vision_description"] = self.describe_image(
                        payload,
                        "Describe this Xiaohongshu image for the note. Focus on concrete visible facts.",
                    )
                except Exception as exc:  # noqa: BLE001 - optional capability
                    item["vision_error"] = str(exc)
            enriched.append(item)
        return enriched

    def diagnostics(self) -> dict[str, Any]:
        return {
            "apple_vision_ocr": self._module_importable("Vision") and self._module_importable("Foundation"),
            "agent_vision_backend": type(self.backend).__name__ if self.backend else "",
        }

    @staticmethod
    def _module_importable(name: str) -> bool:
        try:
            __import__(name)
            return True
        except Exception:
            return False
