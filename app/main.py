from __future__ import annotations

import json
import logging
import tempfile
import hashlib
import threading
import time
import uuid
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

import whisper
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.staticfiles import StaticFiles
from moviepy.audio.io.AudioFileClip import AudioFileClip
from moviepy.video.VideoClip import ColorClip, TextClip
from moviepy.video.compositing.CompositeVideoClip import CompositeVideoClip
from pydantic import BaseModel

BAR_PAUSE_THRESHOLD = 0.35
MAX_BAR_DURATION = 4.0
PREFERRED_BAR_WORDS = 10
VIDEO_SIZE = (720, 1280)
VIDEO_FPS = 24
OUTPUT_ROOT = Path("static") / "outputs"
CACHE_INDEX = OUTPUT_ROOT / "cache_index.json"
MAX_WORDS_PER_BAR = 20
BARS_METADATA_NAME = "bars.json"
METADATA_NAME = "metadata.json"
FFMPEG_BINARY = shutil.which("ffmpeg") or "ffmpeg"
DEFAULT_FONT_FAMILY = "DejaVu-Sans"
DEFAULT_FONT_SIZE = 70
DEFAULT_FONT_COLOR = "white"
FALLBACK_FONT_FAMILY = "DejaVu-Sans"

MODEL: Optional[whisper.Whisper] = None
LOGGER = logging.getLogger("lyric_backend")

if not LOGGER.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(
        logging.Formatter(
            "%(asctime)s %(levelname)s %(name)s %(message)s",
            datefmt="%Y-%m-%dT%H:%M:%S%z",
        )
    )
    LOGGER.addHandler(handler)
LOGGER.setLevel(logging.INFO)

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")

cache_lock = threading.Lock()


def load_cache_index() -> Dict[str, str]:
    if not CACHE_INDEX.exists():
        return {}
    try:
        with CACHE_INDEX.open("r", encoding="utf-8") as cache_file:
            return json.load(cache_file)
    except json.JSONDecodeError:
        LOGGER.warning("cache index corrupted, resetting", extra={"path": str(CACHE_INDEX)})
        return {}


def write_cache_index(data: Dict[str, str]) -> None:
    CACHE_INDEX.parent.mkdir(parents=True, exist_ok=True)
    with CACHE_INDEX.open("w", encoding="utf-8") as cache_file:
        json.dump(data, cache_file)


def get_cached_output(cache_key: str) -> Optional[str]:
    with cache_lock:
        cache = load_cache_index()
        return cache.get(cache_key)


def set_cached_output(cache_key: str, output_id: str) -> None:
    with cache_lock:
        cache = load_cache_index()
        cache[cache_key] = output_id
        write_cache_index(cache)


def build_cache_key(audio_hash: str, trim_start: Optional[float], trim_end: Optional[float]) -> str:
    if trim_start is None or trim_end is None or trim_end <= trim_start:
        return f"{audio_hash}:full"
    return f"{audio_hash}:{trim_start:.3f}:{trim_end:.3f}"


def load_bars_metadata(output_dir: Path) -> Optional[List[Dict[str, Any]]]:
    metadata_path = output_dir / BARS_METADATA_NAME
    if not metadata_path.exists():
        return None
    try:
        with metadata_path.open("r", encoding="utf-8") as metadata_file:
            return json.load(metadata_file)
    except json.JSONDecodeError:
        LOGGER.warning("bars metadata corrupted, resetting", extra={"path": str(metadata_path)})
        return None


def write_bars_metadata(payload: List[Dict[str, Any]], output_dir: Path) -> None:
    metadata_path = output_dir / BARS_METADATA_NAME
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    with metadata_path.open("w", encoding="utf-8") as metadata_file:
        json.dump(payload, metadata_file)


def load_output_metadata(output_dir: Path) -> Dict[str, Any]:
    metadata_path = output_dir / METADATA_NAME
    if not metadata_path.exists():
        return {}
    try:
        with metadata_path.open("r", encoding="utf-8") as metadata_file:
            return json.load(metadata_file)
    except json.JSONDecodeError:
        LOGGER.warning("metadata corrupted, resetting", extra={"path": str(metadata_path)})
        return {}


def write_output_metadata(data: Dict[str, Any], output_dir: Path) -> None:
    metadata_path = output_dir / METADATA_NAME
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    with metadata_path.open("w", encoding="utf-8") as metadata_file:
        json.dump(data, metadata_file)


def trim_audio_segment(source: Path, start: float, end: float) -> Path:
    trimmed_path = Path(tempfile.gettempdir()) / f"{uuid.uuid4().hex}.wav"
    with AudioFileClip(str(source)) as audio_clip:
        duration = audio_clip.duration
    sanitized_start = max(0.0, min(start, duration))
    sanitized_end = max(sanitized_start + 0.001, min(end, duration))
    if sanitized_end <= sanitized_start:
        raise ValueError("Trim range must be greater than zero.")
    duration_t = sanitized_end - sanitized_start
    cmd = [
        FFMPEG_BINARY,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        str(sanitized_start),
        "-i",
        str(source),
        "-t",
        str(duration_t),
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        str(trimmed_path),
    ]
    try:
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"ffmpeg failed to trim audio: {exc}") from exc
    return trimmed_path


def hash_file(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as fp:
        for chunk in iter(lambda: fp.read(8192), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


@app.on_event("startup")
def load_whisper_model():
    global MODEL
    LOGGER.info("loading whisper model")
    MODEL = whisper.load_model("base")
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    LOGGER.info("whisper model loaded")


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.time()
    LOGGER.info("request start", extra={"method": request.method, "path": request.url.path})
    try:
        response = await call_next(request)
    except Exception:
        LOGGER.exception("request failed")
        raise
    duration_ms = (time.time() - start) * 1000
    LOGGER.info(
        "request complete",
        extra={"method": request.method, "path": request.url.path, "status": response.status_code, "duration_ms": f"{duration_ms:.2f}"},
    )
    return response


@dataclass
class LyricBar:
    text: str
    start: float
    end: float


def get_whisper_model() -> whisper.Whisper:
    if MODEL is None:
        raise RuntimeError("Whisper model is not loaded.")
    return MODEL


async def save_upload_file(upload_file: UploadFile, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("wb") as buffer:
        while chunk := await upload_file.read(1024 * 1024):
            buffer.write(chunk)
    await upload_file.close()


def extract_words(result: dict) -> List[dict]:
    words = []
    for seg_idx, segment in enumerate(result.get("segments", [])):
        for word_info in segment.get("words", []):
            word_text = word_info.get("word", "").strip()
            if not word_text:
                continue
            words.append(
                {
                    "text": word_text,
                    "start": float(word_info.get("start", 0.0)),
                    "end": float(word_info.get("end", 0.0)),
                    "segment_index": seg_idx,
                }
            )
    return words


def build_bars_payload(bars: List[LyricBar], words: List[dict]) -> List[Dict[str, Any]]:
    payload: List[Dict[str, Any]] = []
    word_idx = 0
    total_words = len(words)
    tolerance = 1e-3

    for bar in bars:
        bar_words: List[Dict[str, float]] = []
        while word_idx < total_words and words[word_idx]["end"] <= bar.start + tolerance:
            word_idx += 1

        temp_idx = word_idx
        while temp_idx < total_words and words[temp_idx]["start"] <= bar.end + tolerance:
            word = words[temp_idx]
            bar_words.append(
                {
                    "text": word["text"],
                    "start": float(word["start"]),
                    "end": float(word["end"]),
                }
            )
            temp_idx += 1

        word_idx = temp_idx
        if not bar_words:
            bar_words.append(
                {
                    "text": bar.text,
                    "start": float(bar.start),
                    "end": float(bar.end),
                }
            )

        payload.append(
            {
                "text": bar.text,
                "start": float(bar.start),
                "end": float(bar.end),
                "words": bar_words,
            }
        )

    return payload


def split_into_bars(words: List[dict]) -> List[LyricBar]:
    bars: List[LyricBar] = []
    current_words: List[str] = []
    current_start = 0.0
    current_end = 0.0
    BREAK_PUNCTUATION = {".", "?", "!", ";", ":"}

    def flush_bar(end_time: float) -> None:
        nonlocal current_words
        if not current_words:
            return
        bars.append(LyricBar(" ".join(current_words), current_start, end_time))
        current_words = []

    for word in words:
        start = word["start"]
        end = word["end"]
        text = word["text"]
        pause = start - current_end if current_words else 0.0
        duration = current_end - current_start if current_words else 0.0

        if current_words and (pause >= BAR_PAUSE_THRESHOLD or duration >= MAX_BAR_DURATION):
            flush_bar(current_end)

        if not current_words:
            current_start = start

        current_words.append(text)
        current_end = end

        if len(current_words) >= MAX_WORDS_PER_BAR:
            flush_bar(current_end)
            continue

        if (
            len(current_words) >= PREFERRED_BAR_WORDS
            or (text and text[-1] in BREAK_PUNCTUATION and len(current_words) >= 2)
        ):
            flush_bar(current_end)

    if current_words:
        flush_bar(current_end)

    return bars


def build_lyrics_file(bars: List[LyricBar], destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("w", encoding="utf-8") as lyrics_file:
        for bar in bars:
            lyrics_file.write(f"{bar.text}\n")


def build_lyric_video(
    bars: List[LyricBar],
    destination: Path,
    audio_path: Path,
    font_family: str = DEFAULT_FONT_FAMILY,
    font_size: int = DEFAULT_FONT_SIZE,
    font_color: str = DEFAULT_FONT_COLOR,
) -> str:
    LOGGER.info("building lyric video", extra={"bars": len(bars), "destination": str(destination)})
    video_start = time.time()
    total_duration = max((bar.end for bar in bars), default=0.5)
    background = ColorClip(size=VIDEO_SIZE, color=(0, 0, 0), duration=total_duration)
    text_clips = []
    font_used = font_family
    for bar in bars:
        bar_duration = max(bar.end - bar.start, 0.5)
        used_font = font_used
        try:
            text_clip = TextClip(
                text=bar.text,
                font_size=font_size,
                font=used_font,
                color=font_color,
                size=VIDEO_SIZE,
                method="caption",
            )
        except ValueError:
            LOGGER.warning("font unavailable, falling back to default", extra={"font": used_font})
            used_font = None
            text_clip = TextClip(
                text=bar.text,
                font_size=font_size,
                color=font_color,
                size=VIDEO_SIZE,
                method="caption",
            )
        text_clip = text_clip.with_start(bar.start).with_duration(bar_duration).with_position("center")
        text_clips.append(text_clip)
        font_used = used_font

    if not text_clips:
        raise RuntimeError("Cannot build a video without lyric bars.")

    video = CompositeVideoClip([background, *text_clips])
    video = video.with_duration(total_duration)
    audio_clip = None
    try:
        audio_clip = AudioFileClip(str(audio_path))
        video = video.with_audio(audio_clip)
    except Exception as exc:
        LOGGER.warning(
            f"failed to attach audio to lyric video: {exc}",
            extra={"audio_path": str(audio_path)},
        )
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.parent.mkdir(parents=True, exist_ok=True)
    video.write_videofile(
        str(destination),
        fps=VIDEO_FPS,
        codec="libx264",
        audio=True,
        write_logfile=False,
        logger=None,
    )
    video.close()
    if audio_clip:
        audio_clip.close()
    duration = (time.time() - video_start) * 1000
    LOGGER.info("lyric video written", extra={"path": str(destination), "duration_ms": f"{duration:.2f}"})
    return font_used


@app.post("/api/process")
async def process_audio(
    file: UploadFile = File(...),
    trim_start: Optional[float] = Form(None),
    trim_end: Optional[float] = Form(None),
    font_family: str = Form(DEFAULT_FONT_FAMILY),
    font_size: Optional[float] = Form(None),
    font_color: str = Form(DEFAULT_FONT_COLOR),
):
    LOGGER.info(
        "processing audio upload",
        extra={
            "uploaded_filename": file.filename,
            "content_type": file.content_type,
            "headers": dict(file.headers),
        },
    )
    if not file.content_type or not file.content_type.startswith("audio"):
        raise HTTPException(status_code=400, detail="Only audio files are supported.")

    temp_audio_path = Path(tempfile.gettempdir()) / f"{uuid.uuid4().hex}{Path(file.filename).suffix}"
    await save_upload_file(file, temp_audio_path)
    audio_hash = hash_file(temp_audio_path)
    if trim_start is not None:
        trim_start = max(0.0, trim_start)
    if trim_end is not None:
        trim_end = max(0.0, trim_end)
    cache_key = build_cache_key(audio_hash, trim_start, trim_end)
    cached_output = get_cached_output(cache_key)
    if cached_output:
        cached_dir = OUTPUT_ROOT / cached_output
        cached_video = cached_dir / "lyrics.mp4"
        cached_lyrics = cached_dir / "lyrics.txt"
        cached_bars = load_bars_metadata(cached_dir)
        cached_metadata = load_output_metadata(cached_dir)
        if cached_video.exists() and cached_lyrics.exists():
            LOGGER.info("cache hit, returning existing assets", extra={"cache_key": audio_hash})
            response = {
                "lyrics_url": f"/static/outputs/{cached_output}/lyrics.txt",
                "video_url": f"/static/outputs/{cached_output}/lyrics.mp4",
                "output_id": cached_output,
            }
            if cached_bars:
                response["bars"] = cached_bars
            if cached_metadata:
                response["metadata"] = cached_metadata
            return response
    LOGGER.info("saved upload", extra={"path": str(temp_audio_path), "size_bytes": temp_audio_path.stat().st_size})
    selected_audio_path = temp_audio_path
    trimmed_audio_path: Optional[Path] = None
    trim_requested = trim_start is not None and trim_end is not None and trim_end > trim_start
    try:
        if trim_requested:
            assert trim_start is not None and trim_end is not None
            try:
                trimmed_audio_path = trim_audio_segment(temp_audio_path, trim_start, trim_end)
                selected_audio_path = trimmed_audio_path
                LOGGER.info(
                    "trimmed audio",
                    extra={
                        "start": trim_start,
                        "end": trim_end,
                        "trimmed_path": str(trimmed_audio_path),
                    },
                )
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc))
        model = get_whisper_model()
        start_transcription = time.time()
        transcription = model.transcribe(str(selected_audio_path), word_timestamps=True, verbose=False)
        duration_ms = (time.time() - start_transcription) * 1000
        LOGGER.info("transcription complete", extra={"duration_ms": f"{duration_ms:.2f}", "segments": len(transcription.get("segments", []))})

        words = extract_words(transcription)
        LOGGER.info("extracted words", extra={"count": len(words)})
        bars = split_into_bars(words)
        LOGGER.info("split into bars", extra={"bars": len(bars)})
        if not bars:
            raise HTTPException(status_code=400, detail="No lyrics detected in the provided audio.")

        output_id = uuid.uuid4().hex
        output_dir = OUTPUT_ROOT / output_id
        output_dir.mkdir(parents=True, exist_ok=True)

        lyrics_path = output_dir / "lyrics.txt"
        video_path = output_dir / "lyrics.mp4"

        build_lyrics_file(bars, lyrics_path)
        LOGGER.info("lyrics file written", extra={"path": str(lyrics_path)})
        total_duration = max((bar.end for bar in bars), default=0.5)
        effective_font_size = int(font_size) if font_size and font_size > 0 else DEFAULT_FONT_SIZE
        used_font = build_lyric_video(
            bars,
            video_path,
            selected_audio_path,
            font_family=font_family or DEFAULT_FONT_FAMILY,
            font_size=effective_font_size,
            font_color=font_color or DEFAULT_FONT_COLOR,
        )
        LOGGER.info("video file written", extra={"path": str(video_path)})
        audio_store_path = output_dir / "audio.wav"
        stored_audio = trim_audio_segment(selected_audio_path, 0.0, total_duration)
        shutil.move(str(stored_audio), str(audio_store_path))
        metadata = {
            "audio_path": "audio.wav",
            "video_duration": float(total_duration),
            "video_trim": {"start": 0.0, "end": float(total_duration)},
            "font": {
                "family": used_font,
                "size": effective_font_size,
                "color": font_color or DEFAULT_FONT_COLOR,
            },
        }
        write_output_metadata(metadata, output_dir)
        set_cached_output(cache_key, output_id)

        # Prepare bars data for frontend (text + timestamps)
        bars_payload = build_bars_payload(bars, words)

        write_bars_metadata(bars_payload, output_dir)

        return {
            "lyrics_url": f"/static/outputs/{output_id}/lyrics.txt",
            "video_url": f"/static/outputs/{output_id}/lyrics.mp4",
            "bars": bars_payload,
            "metadata": metadata,
            "output_id": output_id,
        }
    except HTTPException:
        raise
    except Exception:
        LOGGER.exception("unexpected failure during processing")
        raise HTTPException(status_code=500, detail="Internal server error")
    finally:
        if temp_audio_path.exists():
            temp_audio_path.unlink()
        if trimmed_audio_path and trimmed_audio_path.exists():
            trimmed_audio_path.unlink()


class UpdatePayload(BaseModel):
    output_id: str
    updated_bars: Optional[List[Dict[str, Any]]] = None
    video_trim_start: Optional[float] = None
    video_trim_end: Optional[float] = None
    font_family: Optional[str] = None
    font_size: Optional[float] = None
    font_color: Optional[str] = None


@app.post("/api/update")
def update_output(payload: UpdatePayload):
    output_dir = OUTPUT_ROOT / payload.output_id
    if not output_dir.exists():
        raise HTTPException(status_code=404, detail="Output not found.")

    metadata = load_output_metadata(output_dir)
    audio_path = output_dir / metadata.get("audio_path", "audio.wav")
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Associated audio not available.")

    bars_data = payload.updated_bars or load_bars_metadata(output_dir)
    if not bars_data:
        raise HTTPException(status_code=400, detail="No lyric bars to update.")

    original_duration = metadata.get("video_duration", max((bar.get("end", 0.0) for bar in bars_data), default=0.0))
    trim_start = payload.video_trim_start if payload.video_trim_start is not None else metadata.get("video_trim", {}).get("start", 0.0)
    trim_end = payload.video_trim_end if payload.video_trim_end is not None else metadata.get("video_trim", {}).get("end", original_duration)
    trim_start = max(0.0, min(trim_start, original_duration))
    trim_end = max(trim_start + 0.001, min(trim_end, original_duration))

    filtered_bars: List[Dict[str, Any]] = []
    for bar in bars_data:
        start = float(bar.get("start", 0.0))
        end = float(bar.get("end", 0.0))
        if end <= trim_start or start >= trim_end:
            continue
        new_start = max(start, trim_start) - trim_start
        new_end = min(end, trim_end) - trim_start
        if new_end <= new_start:
            continue
        adjusted_words = []
        for word in bar.get("words", []):
            wstart = float(word.get("start", 0.0))
            wend = float(word.get("end", 0.0))
            if wend <= trim_start or wstart >= trim_end:
                continue
            word_start = max(wstart, trim_start) - trim_start
            word_end = min(wend, trim_end) - trim_start
            if word_end <= word_start:
                continue
            adjusted_words.append(
                {
                    "text": word.get("text", ""),
                    "start": float(word_start),
                    "end": float(word_end),
                }
            )
        filtered_bars.append(
            {
                "text": bar.get("text", ""),
                "start": float(new_start),
                "end": float(new_end),
                "words": adjusted_words,
            }
        )

    if not filtered_bars:
        raise HTTPException(status_code=400, detail="Trim range removed all lyric bars.")

    font_settings = {
        "family": payload.font_family or metadata.get("font", {}).get("family", DEFAULT_FONT_FAMILY),
        "size": int(payload.font_size)
        if payload.font_size and payload.font_size > 0
        else int(metadata.get("font", {}).get("size", DEFAULT_FONT_SIZE)),
        "color": payload.font_color or metadata.get("font", {}).get("color", DEFAULT_FONT_COLOR),
    }

    temp_audio = trim_audio_segment(audio_path, trim_start, trim_end)
    video_path = output_dir / "lyrics.mp4"
    lyrics_path = output_dir / "lyrics.txt"
    build_lyrics_file([LyricBar(bar["text"], bar["start"], bar["end"]) for bar in filtered_bars], lyrics_path)
    used_font = build_lyric_video(
        [LyricBar(bar["text"], bar["start"], bar["end"]) for bar in filtered_bars],
        video_path,
        temp_audio,
        font_family=font_settings["family"],
        font_size=font_settings["size"],
        font_color=font_settings["color"],
    )
    if temp_audio.exists():
        temp_audio.unlink()

    bars_payload = filtered_bars
    video_duration = max((bar["end"] for bar in filtered_bars), default=0.5)
    metadata.update(
        {
            "video_duration": float(video_duration),
            "video_trim": {"start": float(trim_start), "end": float(trim_end)},
            "font": {
                "family": used_font,
                "size": font_settings["size"],
                "color": font_settings["color"],
            },
        }
    )
    write_output_metadata(metadata, output_dir)
    write_bars_metadata(bars_payload, output_dir)

    return {
        "lyrics_url": f"/static/outputs/{payload.output_id}/lyrics.txt",
        "video_url": f"/static/outputs/{payload.output_id}/lyrics.mp4",
        "bars": bars_payload,
        "metadata": metadata,
        "output_id": payload.output_id,
    }
