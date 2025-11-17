from __future__ import annotations

import json
import logging
import tempfile
import hashlib
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

import whisper
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.staticfiles import StaticFiles
from moviepy.audio.io.AudioFileClip import AudioFileClip
from moviepy.video.VideoClip import ColorClip, TextClip
from moviepy.video.compositing.CompositeVideoClip import CompositeVideoClip

BAR_PAUSE_THRESHOLD = 0.5
VIDEO_SIZE = (1280, 720)
VIDEO_FPS = 24
OUTPUT_ROOT = Path("static") / "outputs"
CACHE_INDEX = OUTPUT_ROOT / "cache_index.json"

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


def get_cached_output(audio_hash: str) -> Optional[str]:
    with cache_lock:
        cache = load_cache_index()
        return cache.get(audio_hash)


def set_cached_output(audio_hash: str, output_id: str) -> None:
    with cache_lock:
        cache = load_cache_index()
        cache[audio_hash] = output_id
        write_cache_index(cache)


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
    for segment in result.get("segments", []):
        for word_info in segment.get("words", []):
            word_text = word_info.get("word", "").strip()
            if not word_text:
                continue
            words.append(
                {
                    "text": word_text,
                    "start": float(word_info.get("start", 0.0)),
                    "end": float(word_info.get("end", 0.0)),
                }
            )
    return words


def split_into_bars(words: List[dict]) -> List[LyricBar]:
    bars: List[LyricBar] = []
    current_words: List[str] = []
    current_start = 0.0
    previous_end = 0.0

    for word in words:
        start = word["start"]
        end = word["end"]
        if current_words and start - previous_end > BAR_PAUSE_THRESHOLD:
            bars.append(LyricBar(" ".join(current_words), current_start, previous_end))
            current_words = []
        if not current_words:
            current_start = start
        current_words.append(word["text"])
        previous_end = end

    if current_words:
        bars.append(LyricBar(" ".join(current_words), current_start, previous_end))

    return bars


def build_lyrics_file(bars: List[LyricBar], destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("w", encoding="utf-8") as lyrics_file:
        for bar in bars:
            lyrics_file.write(f"{bar.text}\n")


def build_lyric_video(bars: List[LyricBar], destination: Path, audio_path: Path) -> None:
    LOGGER.info("building lyric video", extra={"bars": len(bars), "destination": str(destination)})
    video_start = time.time()
    total_duration = max((bar.end for bar in bars), default=0.5)
    background = ColorClip(size=VIDEO_SIZE, color=(0, 0, 0), duration=total_duration)
    text_clips = []
    for bar in bars:
        bar_duration = max(bar.end - bar.start, 0.5)
        text_clip = (
            TextClip(
                text=bar.text,
                font_size=60,
                color="white",
                size=VIDEO_SIZE,
                method="caption",
            )
            .with_start(bar.start)
            .with_duration(bar_duration)
            .with_position("center")
        )
        text_clips.append(text_clip)

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


@app.post("/api/process")
async def process_audio(file: UploadFile = File(...)):
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
    cached_output = get_cached_output(audio_hash)
    if cached_output:
        cached_dir = OUTPUT_ROOT / cached_output
        cached_video = cached_dir / "lyrics.mp4"
        cached_lyrics = cached_dir / "lyrics.txt"
        if cached_video.exists() and cached_lyrics.exists():
            LOGGER.info("cache hit, returning existing assets", extra={"cache_key": audio_hash})
            return {
                "lyrics_url": f"/static/outputs/{cached_output}/lyrics.txt",
                "video_url": f"/static/outputs/{cached_output}/lyrics.mp4",
            }
    LOGGER.info("saved upload", extra={"path": str(temp_audio_path), "size_bytes": temp_audio_path.stat().st_size})
    try:
        model = get_whisper_model()
        start_transcription = time.time()
        transcription = model.transcribe(str(temp_audio_path), word_timestamps=True, verbose=False)
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
        build_lyric_video(bars, video_path, temp_audio_path)
        LOGGER.info("video file written", extra={"path": str(video_path)})
        set_cached_output(audio_hash, output_id)

        return {
            "lyrics_url": f"/static/outputs/{output_id}/lyrics.txt",
            "video_url": f"/static/outputs/{output_id}/lyrics.mp4",
        }
    except HTTPException:
        raise
    except Exception:
        LOGGER.exception("unexpected failure during processing")
        raise HTTPException(status_code=500, detail="Internal server error")
    finally:
        if temp_audio_path.exists():
            temp_audio_path.unlink()
