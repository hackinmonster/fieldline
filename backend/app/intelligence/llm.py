"""Thin OpenAI wrapper: structured output (Pydantic schema)."""
import logging
from typing import TypeVar

from openai import AsyncOpenAI
from pydantic import BaseModel

from ..config import LLM_MODEL, OPENAI_API_KEY

log = logging.getLogger("llm")
T = TypeVar("T", bound=BaseModel)

_client: AsyncOpenAI | None = None


def client() -> AsyncOpenAI:
    global _client
    if _client is None:
        if not OPENAI_API_KEY:
            raise RuntimeError("OPENAI_API_KEY is not set (backend/.env)")
        _client = AsyncOpenAI(api_key=OPENAI_API_KEY)
    return _client


async def structured(system: str, prompt: str, schema: type[T]) -> T:
    content: list[dict] = [{"type": "input_text", "text": prompt}]
    resp = await client().responses.parse(
        model=LLM_MODEL,
        instructions=system,
        input=[{"role": "user", "content": content}],
        text_format=schema,
    )
    if resp.output_parsed is None:
        raise RuntimeError(f"model returned no parsable output: {resp.output_text[:200]!r}")
    return resp.output_parsed
