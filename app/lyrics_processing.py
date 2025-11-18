from typing import Any, Dict, List

from .settings import (
    BAR_PAUSE_THRESHOLD,
    BREAK_PUNCTUATION,
    MAX_BAR_DURATION,
    MAX_WORDS_PER_BAR,
    PREFERRED_BAR_WORDS,
)


class LyricBar:
    def __init__(self, text: str, start: float, end: float) -> None:
        self.text = text
        self.start = start
        self.end = end


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


def split_into_bars(words: List[dict]) -> List[LyricBar]:
    bars: List[LyricBar] = []
    current_words: List[str] = []
    current_start = 0.0
    current_end = 0.0

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
