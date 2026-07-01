import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SRC_DIRS = [
    ROOT / "api" / "src",
    ROOT / "embedding" / "src",
    ROOT / "ingestion" / "src",
    ROOT / "llm" / "src",
    ROOT / "packages" / "rag_core" / "src",
    ROOT / "packages" / "rag_grpc" / "src",
    ROOT / "packages" / "rag_storage" / "src",
]

for src_dir in SRC_DIRS:
    src_path = str(src_dir)
    if src_path not in sys.path:
        sys.path.insert(0, src_path)
