import os

from src.core.config import settings
from src.core.interfaces import LLMWorkerBase


class LlamaCPPEngine(LLMWorkerBase):
    def __init__(self, model_path: str = settings.llama_model_path):
        try:
            from llama_cpp import Llama
        except ImportError as exc:
            raise RuntimeError(
                "Install the llm extra to use LlamaCPPEngine: uv sync --extra llm"
            ) from exc

        kwargs = {"model_path": model_path}
        if os.path.exists("/usr/local/cuda"):
            kwargs["n_gpu_layers"] = -1
        else:
            kwargs["n_threads"] = os.cpu_count() or 1

        self.model = Llama(**kwargs)

    def generate_response(self, prompt: str, context: list[str]) -> str:
        full_prompt = "\n\n".join([*context, prompt])
        response = self.model(full_prompt)
        return response["choices"][0]["text"].strip()
