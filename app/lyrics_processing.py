from typing import Any, Dict, List

from .settings import MAX_GAP_BETWEEN_WORDS, MAX_WORDS_PER_CHUNK


class Word:
    def __init__(self, text: str, start: float, end: float, word_id: str):
        self.id = word_id
        self.text = text
        self.start = start
        self.end = end


class LyricChunk:
    def __init__(self, words: List[Word]):
        self.words = words
        self.text = " ".join(word.text for word in words)
        self.start = min((word.start for word in words), default=0.0)
        self.end = max((word.end for word in words), default=0.0)


def extract_words(result: dict) -> List[Word]:
    words: List[Word] = []
    for seg_idx, segment in enumerate(result.get("segments", [])):
        for word_idx, word_info in enumerate(segment.get("words", [])):
            word_text = word_info.get("word", "").strip()
            if not word_text:
                continue
            words.append(
                Word(
                    text=word_text,
                    start=float(word_info.get("start", 0.0)),
                    end=float(word_info.get("end", 0.0)),
                    word_id=f"{seg_idx}-{word_idx}",
                )
            )
    return words


def build_chunks(words: List[Word]) -> List[LyricChunk]:
    if not words:
        return []
    sorted_words = sorted(words, key=lambda word: word.start)
    chunks: List[LyricChunk] = []
    current: List[Word] = []

    for word in sorted_words:
        if not current:
            current.append(word)
            continue
        gap = word.start - current[-1].end
        if gap > MAX_GAP_BETWEEN_WORDS or len(current) >= MAX_WORDS_PER_CHUNK:
            chunks.append(LyricChunk(current))
            current = [word]
            continue
        current.append(word)

    if current:
        chunks.append(LyricChunk(current))

    return chunks


def words_payload(words: List[Word]) -> List[Dict[str, Any]]:
    return [
        {"id": word.id, "text": word.text, "start": float(word.start), "end": float(word.end)}
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
