from __future__ import annotations

import shutil
from pathlib import Path

VIDEO_SIZE = (720, 1280)
VIDEO_FPS = 24
OUTPUT_ROOT = Path("static") / "outputs"
CACHE_INDEX = OUTPUT_ROOT / "cache_index.json"
METADATA_NAME = "metadata.json"
FFMPEG_BINARY = shutil.which("ffmpeg") or "ffmpeg"
DEFAULT_FONT_FAMILY = "DejaVu-Sans"
DEFAULT_FONT_SIZE = 70
DEFAULT_FONT_COLOR = "white"
DEFAULT_FONT_WEIGHT = 600
FALLBACK_FONT_FAMILY = "DejaVu-Sans"
MAX_WORDS_PER_CHUNK = 4
MAX_GAP_BETWEEN_WORDS = 0.3
WORDS_METADATA_NAME = "words.json"
CHUNKS_METADATA_NAME = "chunks.json"
SAFE_AREA_WIDTH_RATIO = 0.88
SAFE_AREA_HEIGHT_RATIO = 0.28
MIN_FONT_SIZE = 36
