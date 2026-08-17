# C10 source record

- Source repository: `microsoft/markitdown`
- Fixed commit: `fd239d5d2be43d9b68329730206b9312c7d5a388`
- Reused symbols: `MarkItDown`, `StreamInfo`, and `convert_stream`.
- Platform adaptation: `runtime.py` passes only a bounded in-memory byte stream and verified MIME/name hints to `convert_stream`, with plugins disabled. The FastAPI handler receives no URL, local path, object key, workspace, or database handle.
- Not reused: permissive conversion entrypoints, URL/local-path conversion, plugins, MCP server, OCR/LLM integrations, and all networking behavior.
- Regression commands: `.codex-longrun/c10-document-runtime-venv/Scripts/python.exe -m unittest discover -s services/document-runtime/tests`.
