import os
import subprocess
import sys
import importlib.util
from pathlib import Path
from dotenv import load_dotenv

# Load env variables before importing engine or starting sub-processes
load_dotenv(Path(__file__).resolve().parents[2] / ".env", encoding="utf-8-sig")


def main() -> None:
    if importlib.util.find_spec("vllm") is None:
        raise SystemExit(
            "vLLM is not installed in this environment. Native vLLM CPU/GPU "
            "extras are Linux x86_64 only; use WSL2, Docker, or "
            "`uv sync --extra mock && uv run python -m rag_llm.mock_server`."
        )

    env = os.environ.copy()
    gpu_memory_util = env.pop("VLLM_GPU_MEMORY_UTIL", "0.88")
    max_model_len = env.pop("VLLM_MAX_MODEL_LEN", "").strip()
    cmd = [
        sys.executable,
        "-m",
        "vllm.entrypoints.grpc_server",
        "--host",
        env.get("LLM_GRPC_HOST", "0.0.0.0"),
        "--port",
        env.get("LLM_GRPC_PORT", "50052"),
        "--model",
        env.get("LLM_MODEL", "Qwen/Qwen2.5-3B-Instruct"),
        "--gpu-memory-utilization",
        gpu_memory_util,
    ]
    if max_model_len:
        cmd.extend(["--max-model-len", max_model_len])
    subprocess.run(cmd, check=True, env=env)


if __name__ == "__main__":
    main()
