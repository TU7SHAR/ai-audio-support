"""
Application configuration.

Values are read from environment variables (or a local `.env` file).
See `.env.example` for the full list and defaults.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- Ollama connection -------------------------------------------------
    # Ollama runs on the same server as this API, bound to localhost only.
    # We never expose Ollama to the internet directly; this API is the front door.
    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "qwen2.5:3b"

    # How long to wait on Ollama before giving up (seconds).
    # CPU-only inference can be slow, so keep this generous.
    ollama_timeout: float = 120.0

    # --- Model behaviour ---------------------------------------------------
    # The "personality" and rules for the support agent. Keep it short and
    # firm so a small model stays on task.
    system_prompt: str = (
        "You are a helpful, concise customer support voice assistant. "
        "Always reply in clear English. Keep answers short and conversational, "
        "as if speaking on a phone call. Avoid long lists unless asked. "
        "If you do not know something, say so briefly and offer to help another way."
    )

    # Sampling temperature: lower = more focused/consistent answers.
    temperature: float = 0.4

    # --- CORS --------------------------------------------------------------
    # Comma-separated list of allowed browser origins (your Vercel URL, etc).
    # Use "*" only for local testing.
    cors_origins: str = "*"


settings = Settings()
