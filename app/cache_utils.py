import json
import threading
from typing import Dict, Optional

from .settings import CACHE_INDEX

cache_lock = threading.Lock()


def load_cache_index() -> Dict[str, str]:
    if not CACHE_INDEX.exists():
        return {}
    try:
        with CACHE_INDEX.open("r", encoding="utf-8") as cache_file:
            return json.load(cache_file)
    except json.JSONDecodeError:
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
