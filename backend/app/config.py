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
        "When SEARCH RESULTS are provided, answer using ONLY those results. "
        "Synthesize across the results into a clear answer; do not just list them. "
        "If the results do not contain the answer, say so plainly instead of "
        "guessing. Refer to sources by their number like [1], [2] when helpful."
    )

    # Sampling temperature: lower = more focused/consistent answers.
    temperature: float = 0.4

    # --- Context management -------------------------------------------------
    # Keep prompts small so the CPU model stays fast and doesn't overflow its
    # context window. We keep only the most recent turns, within a char budget.
    max_history_turns: int = 8          # at most N prior messages kept
    max_history_chars: int = 4000       # ...and no more than this many chars

    # --- Ollama runtime options (efficiency) -------------------------------
    # num_ctx: context window size. Smaller = faster on CPU. Qwen 3b handles
    #   larger, but 2048 is a good speed/quality balance for short support chats.
    # keep_alive: how long Ollama keeps the model loaded in RAM between requests
    #   ("10m" avoids a cold reload — the slowest part — on every message).
    num_ctx: int = 2048
    keep_alive: str = "10m"

    # --- Web search (Brave Search API) ------------------------------------
    # Optional. If a key is set, the /chat endpoints can fetch live web results
    # and feed them to the model. Get a free key at:
    #   https://api-dashboard.search.brave.com/
    # Leave blank to disable web search (the app still works without it).
    brave_api_key: str = ""
    brave_endpoint: str = "https://api.search.brave.com/res/v1/web/search"
    # How many results to fetch and how many to actually feed the model.
    search_results_count: int = 6
    search_context_count: int = 4
    search_timeout: float = 15.0
    # Country/language bias for more relevant results (Brave params).
    search_country: str = "us"
    search_lang: str = "en"

    # --- CORS --------------------------------------------------------------
    # Comma-separated list of allowed browser origins (your Vercel URL, etc).
    # Use "*" only for local testing.
    cors_origins: str = "*"

    @property
    def web_search_enabled(self) -> bool:
        return bool(self.brave_api_key.strip())


settings = Settings()
