"""Source-aligned boundary for OpenMontage's TTS selector.

Source: OpenMontage ``tools/audio/tts_selector.py`` and provider tools at
``4eab34c5cfcccaa4f1970554928feccce73ee930``.  The source discovers TTS
providers from its registry and only selects a usable provider after the
preference/rank path.  This Runtime does not host that registry, so an
implicit/``auto`` selection is unavailable rather than a reason to invent a
local provider list or silently choose Piper.
"""
import os

def select_provider(preferred: str | None = "auto") -> str:
    """Resolve an explicit source provider without inventing a fallback.

    OpenMontage's ``TTSSelector`` uses registry discovery for ``auto`` and
    ranks candidates before generation.  No equivalent registry is available
    inside this thin Runtime adapter; returning Piper for ``auto`` would turn
    an unresolved owner into an implicit platform narration route.  Callers
    must therefore name the existing local fallback explicitly.
    """
    if preferred in {"piper", "piper_tts"}:
        return "piper"
    if preferred in {"doubao", "doubao_tts"}:
        if not os.environ.get("DOUBAO_SPEECH_API_KEY"):
            raise RuntimeError("The requested TTS provider is unavailable in the local Runtime.")
        return "doubao"
    if preferred is None or preferred in {"", "auto"}:
        raise RuntimeError("No source-discovered TTS provider is available in the local Runtime.")
    raise RuntimeError("The requested TTS provider is unavailable in the local Runtime.")
