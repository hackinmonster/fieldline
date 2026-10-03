"""Thin OpenAI wrapper: structured output (Pydantic schema) + optional image."""
import base64
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


async def structured(system: str, prompt: str, schema: type[T], *,
                     image: bytes | None = None, image_mime: str = "image/jpeg") -> T:
    content: list[dict] = [{"type": "input_text", "text": prompt}]
    if image is not None:
        b64 = base64.b64encode(image).decode()
        content.append({"type": "input_image", "image_url": f"data:{image_mime};base64,{b64}"})
    resp = await client().responses.parse(
        model=LLM_MODEL,
        instructions=system,
        input=[{"role": "user", "content": content}],
        text_format=schema,
    )
    if resp.output_parsed is None:
        raise RuntimeError(f"model returned no parsable output: {resp.output_text[:200]!r}")
    return resp.output_parsed
