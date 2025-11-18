from __future__ import annotations

import shutil
from pathlib import Path

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
BREAK_PUNCTUATION = {".", "?", "!", ";", ":"}
