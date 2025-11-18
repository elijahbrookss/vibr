import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from .settings import BARS_METADATA_NAME, METADATA_NAME


def load_bars_metadata(output_dir: Path) -> Optional[List[Dict[str, Any]]]:
    metadata_path = output_dir / BARS_METADATA_NAME
    if not metadata_path.exists():
        return None
    try:
        with metadata_path.open("r", encoding="utf-8") as metadata_file:
            return json.load(metadata_file)
    except json.JSONDecodeError:
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
        return {}


def write_output_metadata(data: Dict[str, Any], output_dir: Path) -> None:
    metadata_path = output_dir / METADATA_NAME
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    with metadata_path.open("w", encoding="utf-8") as metadata_file:
        json.dump(data, metadata_file)
