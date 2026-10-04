"""Thin LLM wrapper: structured output validated against a Pydantic schema.

Uses the Chat Completions API, which both OpenAI and OpenRouter (Qwen by default) serve. The schema is sent as a
JSON-schema response format; the reply is still validated with Pydantic, and one retry quotes the validation error.
"""
import json
import logging
from typing import TypeVar

from openai import AsyncOpenAI
from pydantic import BaseModel, ValidationError

from ..config import LLM_BASE_URL, LLM_MODEL, OPENAI_API_KEY, OPENROUTER_API_KEY

log = logging.getLogger("llm")
T = TypeVar("T", bound=BaseModel)

_client: AsyncOpenAI | None = None


def client() -> AsyncOpenAI:
    global _client
    if _client is None:
        key = OPENROUTER_API_KEY or OPENAI_API_KEY
        if not key:
            raise RuntimeError("Set OPENROUTER_API_KEY (or OPENAI_API_KEY) in backend/.env")
        _client = AsyncOpenAI(api_key=key, base_url=LLM_BASE_URL or None)
    return _client


def _strip_fences(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else t
        t = t.rsplit("```", 1)[0]
    return t.strip()


async def structured(system: str, prompt: str, schema: type[T]) -> T:
    json_schema = schema.model_json_schema()
    messages = [
        {"role": "system", "content": f"{system}\n\nReply with a single JSON object that matches this JSON schema:\n{json.dumps(json_schema)}"},
        {"role": "user", "content": prompt},
    ]
    extra = {"provider": {"require_parameters": True}} if OPENROUTER_API_KEY else None  # route only to providers honoring the schema
    last_err = ""
    for attempt in range(2):
        resp = await client().chat.completions.create(
            model=LLM_MODEL,
            messages=messages,
            response_format={"type": "json_schema", "json_schema": {"name": schema.__name__, "schema": json_schema, "strict": False}},
            extra_body=extra,
        )
        text = resp.choices[0].message.content or ""
        try:
            return schema.model_validate_json(_strip_fences(text))
        except ValidationError as e:
            last_err = str(e)[:600]
            log.warning("LLM output failed %s validation (attempt %d): %s", schema.__name__, attempt + 1, last_err)
            messages += [{"role": "assistant", "content": text},
                         {"role": "user", "content": f"That did not match the schema: {last_err}\nReply again with only the corrected JSON object."}]
    raise RuntimeError(f"model returned no valid {schema.__name__}: {last_err}")
