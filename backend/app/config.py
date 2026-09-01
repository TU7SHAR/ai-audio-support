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
    # The "personality" and rules for the support agent. Kept firm so a small
    # model stays on task, replies in the user's language, and does NOT invent
    # facts (it should say it doesn't know instead of hallucinating).
    system_prompt: str = (
        "You are a helpful, concise customer support voice assistant. "
        "Reply in the SAME language the user used (e.g. English, Hindi, Punjabi). "
        "Keep answers short and conversational, as if speaking on a phone call. "
        "Avoid long lists unless asked. "
        "Do NOT invent facts, product details, or prices. If you are not sure, "
        "say you do not have that information and offer to help another way. "
        "When you are given SEARCH RESULTS, base your answer on them and briefly "
        "mention that the info comes from a web search."
    )

    # Sampling temperature: lower = more focused/consistent answers.
    temperature: float = 0.4

    # --- Conversation memory (context-window management) -------------------
    # The client sends the full conversation history on every request. On a
    # small model (qwen2.5:3b) running CPU-only, replaying an unbounded history
    # makes each turn slower and eventually overflows the context window (which
    # causes Ollama to silently truncate from the front, dropping the system
    # prompt and earliest turns unpredictably).
    #
    # To keep latency stable and behaviour predictable we bound how much history
    # is replayed into the prompt. The system prompt is ALWAYS kept; we drop the
    # OLDEST history turns first.
    #
    # A "turn" is one message (either a user or an assistant message).
    #   - max_history_turns: hard cap on how many recent turns to keep.
    #   - max_history_chars: soft cap on the total characters across kept turns
    #     (a cheap proxy for tokens). Set either to 0 to disable that limit.
    max_history_turns: int = 12
    max_history_chars: int = 6000

    # --- Web search (Brave Search API) ------------------------------------
    # Optional. If a key is set, the /chat endpoints can fetch live web results
    # and feed them to the model. Get a free key at:
    #   https://api-dashboard.search.brave.com/
    # Leave blank to disable web search (the app still works without it).
    brave_api_key: str = ""
    brave_endpoint: str = "https://api.search.brave.com/res/v1/web/search"
    # How many search results to feed into the prompt.
    search_results_count: int = 4
    search_timeout: float = 15.0

    # --- CORS --------------------------------------------------------------
    # Comma-separated list of allowed browser origins (your Vercel URL, etc).
    # Use "*" only for local testing.
    cors_origins: str = "*"

    @property
    def web_search_enabled(self) -> bool:
        return bool(self.brave_api_key.strip())


settings = Settings()
