import os
import subprocess
import sys
import importlib.util


def main() -> None:
    if importlib.util.find_spec("vllm") is None:
        raise SystemExit(
            "vLLM is not installed in this environment. Native vLLM CPU/GPU "
            "extras are Linux x86_64 only; use WSL2, Docker, or "
            "`uv sync --extra mock && uv run python -m rag_llm.mock_server`."
        )

    cmd = [
        sys.executable,
        "-m",
        "vllm.entrypoints.grpc_server",
        "--host",
        os.getenv("LLM_GRPC_HOST", "0.0.0.0"),
        "--port",
        os.getenv("LLM_GRPC_PORT", "50052"),
        "--model",
        os.getenv("LLM_MODEL", "Qwen/Qwen2.5-7B-Instruct"),
    ]
    subprocess.run(cmd, check=True)


if __name__ == "__main__":
    main()
