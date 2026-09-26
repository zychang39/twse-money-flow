from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SAMPLES = ROOT / "tests" / "fixtures" / "samples"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def sample(name: str) -> bytes:
    return (SAMPLES / name).read_bytes()


@pytest.fixture
def load_sample():
    return sample
