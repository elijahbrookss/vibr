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

VIDEO_SIZE = (720, 1280)
VIDEO_FPS = 24
OUTPUT_ROOT = Path("static") / "outputs"
CACHE_INDEX = OUTPUT_ROOT / "cache_index.json"
METADATA_NAME = "metadata.json"
FFMPEG_BINARY = shutil.which("ffmpeg") or "ffmpeg"
DEFAULT_FONT_FAMILY = "DejaVu-Sans"
DEFAULT_FONT_SIZE = 70
DEFAULT_FONT_COLOR = "white"
FALLBACK_FONT_FAMILY = "DejaVu-Sans"
MAX_WORDS_PER_CHUNK = 4
MAX_GAP_BETWEEN_WORDS = 0.3
WORDS_METADATA_NAME = "words.json"
CHUNKS_METADATA_NAME = "chunks.json"
SAFE_AREA_WIDTH_RATIO = 0.88
SAFE_AREA_HEIGHT_RATIO = 0.28
MIN_FONT_SIZE = 36
MIN_WORD_DURATION = 0.03

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


def load_words_metadata(output_dir: Path) -> Optional[List[Dict[str, Any]]]:
    metadata_path = output_dir / WORDS_METADATA_NAME
    if not metadata_path.exists():
        return None
    try:
        with metadata_path.open("r", encoding="utf-8") as metadata_file:
            return json.load(metadata_file)
    except json.JSONDecodeError:
        LOGGER.warning("words metadata corrupted, resetting", extra={"path": str(metadata_path)})
        return None


def write_words_metadata(payload: List[Dict[str, Any]], output_dir: Path) -> None:
    metadata_path = output_dir / WORDS_METADATA_NAME
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    with metadata_path.open("w", encoding="utf-8") as metadata_file:
        json.dump(payload, metadata_file)


def load_chunks_metadata(output_dir: Path) -> Optional[List[Dict[str, Any]]]:
    metadata_path = output_dir / CHUNKS_METADATA_NAME
    if not metadata_path.exists():
        return None
    try:
        with metadata_path.open("r", encoding="utf-8") as metadata_file:
            return json.load(metadata_file)
    except json.JSONDecodeError:
        LOGGER.warning("chunks metadata corrupted, resetting", extra={"path": str(metadata_path)})
        return None


def write_chunks_metadata(payload: List[Dict[str, Any]], output_dir: Path) -> None:
    metadata_path = output_dir / CHUNKS_METADATA_NAME
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
class Word:
    id: str
    text: str
    start: float
    end: float


@dataclass
class LyricChunk:
    text: str
    start: float
    end: float
    words: List[Word]


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


def extract_words(result: dict) -> List[Word]:
    words: List[Word] = []
    for seg_idx, segment in enumerate(result.get("segments", [])):
        for word_idx, word_info in enumerate(segment.get("words", [])):
            word_text = word_info.get("word", "").strip()
            if not word_text:
                continue
            words.append(
                Word(
                    id=f"{seg_idx}-{word_idx}",
                    text=word_text,
                    start=float(word_info.get("start", 0.0)),
                    end=float(word_info.get("end", 0.0)),
                )
            )
    return words


def chunk_from_words(words: List[Word]) -> LyricChunk:
    return LyricChunk(
        text=" ".join(word.text for word in words),
        start=min((word.start for word in words), default=0.0),
        end=max((word.end for word in words), default=0.0),
        words=words,
    )


def build_chunks(words: List[Word]) -> List[LyricChunk]:
    if not words:
        return []
    sorted_words = sorted(words, key=lambda w: w.start)
    chunks: List[LyricChunk] = []
    current: List[Word] = []

    for word in sorted_words:
        if not current:
            current.append(word)
            continue
        gap = word.start - current[-1].end
        if gap > MAX_GAP_BETWEEN_WORDS or len(current) >= MAX_WORDS_PER_CHUNK:
            chunks.append(chunk_from_words(current))
            current = [word]
            continue
        current.append(word)

    if current:
        chunks.append(chunk_from_words(current))

    return chunks


def validate_word_timings(words: List[Word], total_duration: Optional[float] = None) -> List[Word]:
    ordered = sorted(words, key=lambda w: (w.start, w.end))
    previous_end = 0.0
    for index, word in enumerate(ordered):
        if word.start < 0 or word.end < 0:
            raise HTTPException(status_code=400, detail="Word timings cannot be negative.")
        if word.end - word.start < MIN_WORD_DURATION:
            raise HTTPException(
                status_code=400,
                detail=f"Word '{word.text}' must be at least {int(MIN_WORD_DURATION * 1000)}ms long.",
            )
        if word.end <= word.start:
            raise HTTPException(status_code=400, detail=f"Word '{word.text}' must end after it starts.")
        if index > 0 and word.start < previous_end:
            raise HTTPException(status_code=400, detail="Words must be ordered without overlapping.")
        if total_duration is not None and word.end > total_duration + 0.001:
            raise HTTPException(status_code=400, detail="Word timing exceeds the available audio duration.")
        previous_end = word.end
    return ordered


def words_payload(words: List[Word]) -> List[Dict[str, Any]]:
    return [
        {
            "id": word.id,
            "text": word.text,
            "start": float(word.start),
            "end": float(word.end),
        }
        for word in words
    ]


def chunks_payload(chunks: List[LyricChunk]) -> List[Dict[str, Any]]:
    return [
        {
            "text": chunk.text,
            "start": float(chunk.start),
            "end": float(chunk.end),
            "words": words_payload(chunk.words),
        }
        for chunk in chunks
    ]


def build_lyrics_file(chunks: List[LyricChunk], destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("w", encoding="utf-8") as lyrics_file:
        for chunk in chunks:
            lyrics_file.write(f"{chunk.text}\n")


def _build_safe_text_clip(
    chunk: LyricChunk, font_family: str, font_size: int, font_color: str
) -> tuple[TextClip, str, int, tuple[int, int]]:
    safe_width = int(VIDEO_SIZE[0] * SAFE_AREA_WIDTH_RATIO)
    safe_height = int(VIDEO_SIZE[1] * SAFE_AREA_HEIGHT_RATIO)
    chosen_font = font_family
    current_size = font_size
    picked_size = current_size
    last_clip: Optional[TextClip] = None
    while current_size >= MIN_FONT_SIZE:
        try:
            clip = TextClip(
                text=chunk.text,
                font_size=current_size,
                font=chosen_font,
                color=font_color,
                size=(safe_width, safe_height),
                method="caption",
            )
        except ValueError:
            LOGGER.warning("font unavailable, falling back to default", extra={"font": chosen_font})
            chosen_font = None
            current_size = current_size - 2
            continue
        last_clip = clip
        picked_size = current_size
        if clip.w <= safe_width and clip.h <= safe_height:
            return clip, chosen_font or FALLBACK_FONT_FAMILY, picked_size, (safe_width, safe_height)
        current_size -= 2
    if last_clip is None:
        last_clip = TextClip(
            text=chunk.text,
            font_size=MIN_FONT_SIZE,
            color=font_color,
            size=(safe_width, safe_height),
            method="caption",
        )
        picked_size = MIN_FONT_SIZE
    return last_clip, chosen_font or FALLBACK_FONT_FAMILY, picked_size, (safe_width, safe_height)


def build_lyric_video(
    chunks: List[LyricChunk],
    destination: Path,
    audio_path: Path,
    font_family: str = DEFAULT_FONT_FAMILY,
    font_size: int = DEFAULT_FONT_SIZE,
    font_color: str = DEFAULT_FONT_COLOR,
) -> str:
    LOGGER.info("building lyric video", extra={"chunks": len(chunks), "destination": str(destination)})
    video_start = time.time()
    total_duration = max((chunk.end for chunk in chunks), default=0.5)
    background = ColorClip(size=VIDEO_SIZE, color=(0, 0, 0), duration=total_duration)
    text_clips = []
    font_used = font_family
    for chunk in chunks:
        if not chunk.words:
            continue
        text_clip, used_font, resolved_size, safe_dimensions = _build_safe_text_clip(
            chunk, font_used, font_size, font_color
        )
        prefix_clips: list[TextClip] = []
        for idx, word in enumerate(chunk.words):
            prefix_text = " ".join(w.text for w in chunk.words[: idx + 1])
            try:
                word_clip = TextClip(
                    text=prefix_text,
                    font_size=resolved_size,
                    font=used_font,
                    color=font_color,
                    size=safe_dimensions,
                    method="caption",
                )
            except ValueError:
                LOGGER.warning("word clip font fallback", extra={"font": used_font})
                word_clip = TextClip(
                    text=prefix_text,
                    font_size=resolved_size,
                    color=font_color,
                    size=safe_dimensions,
                    method="caption",
                )
            word_clip = (
                word_clip.with_start(word.start)
                .with_duration(max(chunk.end - word.start, 0.2))
                .with_position("center")
            )
            prefix_clips.append(word_clip)
        text_clip.close()
        text_clips.extend(prefix_clips)
        font_used = used_font

    if not text_clips:
        raise RuntimeError("Cannot build a video without lyric chunks.")

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
        cached_words = load_words_metadata(cached_dir)
        cached_chunks = load_chunks_metadata(cached_dir)
        cached_metadata = load_output_metadata(cached_dir)
        if cached_video.exists() and cached_lyrics.exists():
            LOGGER.info("cache hit, returning existing assets", extra={"cache_key": audio_hash})
            response = {
                "lyrics_url": f"/static/outputs/{cached_output}/lyrics.txt",
                "video_url": f"/static/outputs/{cached_output}/lyrics.mp4",
                "output_id": cached_output,
            }
            if cached_words:
                response["words"] = cached_words
            if cached_chunks:
                response["chunks"] = cached_chunks
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

        words = validate_word_timings(extract_words(transcription))
        LOGGER.info("extracted words", extra={"count": len(words)})
        chunks = build_chunks(words)
        LOGGER.info("built chunks", extra={"chunks": len(chunks)})
        if not chunks:
            raise HTTPException(status_code=400, detail="No lyrics detected in the provided audio.")

        output_id = uuid.uuid4().hex
        output_dir = OUTPUT_ROOT / output_id
        output_dir.mkdir(parents=True, exist_ok=True)

        lyrics_path = output_dir / "lyrics.txt"
        video_path = output_dir / "lyrics.mp4"

        build_lyrics_file(chunks, lyrics_path)
        LOGGER.info("lyrics file written", extra={"path": str(lyrics_path)})
        total_duration = max((chunk.end for chunk in chunks), default=0.5)
        effective_font_size = int(font_size) if font_size and font_size > 0 else DEFAULT_FONT_SIZE
        used_font = build_lyric_video(
            chunks,
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

        words_data = words_payload(words)
        chunks_data = chunks_payload(chunks)

        write_words_metadata(words_data, output_dir)
        write_chunks_metadata(chunks_data, output_dir)

        return {
            "lyrics_url": f"/static/outputs/{output_id}/lyrics.txt",
            "video_url": f"/static/outputs/{output_id}/lyrics.mp4",
            "words": words_data,
            "chunks": chunks_data,
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
    updated_words: Optional[List[Dict[str, Any]]] = None
    video_trim_start: Optional[float] = None
    video_trim_end: Optional[float] = None
    font_family: Optional[str] = None
    font_size: Optional[float] = None
    font_color: Optional[str] = None


@app.post("/api/update")
def update_output(payload: UpdatePayload):
    output_dir = OUTPUT_ROOT / payload.output_id
    if not output_dir.exists():
        LOGGER.warning("update requested for missing output", extra={"output_id": payload.output_id})
        raise HTTPException(
            status_code=404,
            detail="Output not found. Please regenerate your video before applying edits.",
        )

    metadata = load_output_metadata(output_dir)
    audio_path = output_dir / metadata.get("audio_path", "audio.wav")
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Associated audio not available.")

    current_trim_offset = metadata.get("video_trim", {}).get("start", 0.0)
    source_words = payload.updated_words if payload.updated_words is not None else load_words_metadata(output_dir)
    if not source_words:
        raise HTTPException(status_code=400, detail="No lyric words to update.")

    offset = current_trim_offset if payload.updated_words is not None else 0.0
    base_words: List[Word] = []
    for idx, word in enumerate(source_words):
        raw_id = word.get("id")
        resolved_id = str(raw_id) if raw_id is not None else f"{idx}-{uuid.uuid4().hex[:8]}"
        base_words.append(
            Word(
                id=resolved_id,
                text=word.get("text", ""),
                start=float(word.get("start", 0.0)) + offset,
                end=float(word.get("end", 0.0)) + offset,
            )
        )

    original_duration = metadata.get("video_duration", max((word.end for word in base_words), default=0.0))
    base_words = validate_word_timings(base_words, original_duration)
    trim_start = payload.video_trim_start if payload.video_trim_start is not None else metadata.get("video_trim", {}).get("start", 0.0)
    trim_end = payload.video_trim_end if payload.video_trim_end is not None else metadata.get("video_trim", {}).get("end", original_duration)
    trim_start = max(0.0, min(trim_start, original_duration))
    trim_end = max(trim_start + 0.001, min(trim_end, original_duration))

    filtered_words: List[Word] = []
    for word in base_words:
        if word.end <= trim_start or word.start >= trim_end:
            continue
        word_start = max(word.start, trim_start) - trim_start
        word_end = min(word.end, trim_end) - trim_start
        if word_end <= word_start:
            continue
        filtered_words.append(Word(id=word.id, text=word.text, start=word_start, end=word_end))

    if not filtered_words:
        raise HTTPException(status_code=400, detail="Trim range removed all lyric words.")

    filtered_words = validate_word_timings(filtered_words, trim_end - trim_start)

    chunks = build_chunks(filtered_words)

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
    build_lyrics_file(chunks, lyrics_path)
    used_font = build_lyric_video(
        chunks,
        video_path,
        temp_audio,
        font_family=font_settings["family"],
        font_size=font_settings["size"],
        font_color=font_settings["color"],
    )
    if temp_audio.exists():
        temp_audio.unlink()

    chunks_data = chunks_payload(chunks)
    video_duration = max((chunk.end for chunk in chunks), default=0.5)
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
    write_words_metadata(words_payload(base_words), output_dir)
    write_chunks_metadata(chunks_data, output_dir)

    return {
        "lyrics_url": f"/static/outputs/{payload.output_id}/lyrics.txt",
        "video_url": f"/static/outputs/{payload.output_id}/lyrics.mp4",
        "words": words_payload(filtered_words),
        "chunks": chunks_data,
        "metadata": metadata,
        "output_id": payload.output_id,
    }
