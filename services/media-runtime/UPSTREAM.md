# C12 source record

- Source repository: `calesthio/OpenMontage`
- Fixed commit: `4eab34c5cfcccaa4f1970554928feccce73ee930`
- Reused concepts: `BaseTool` fixed-tool contract, `ToolResult` artifact/result separation, and the video composition/QC tool boundaries.
- Platform adaptation: this Runtime exposes only three loopback-only, bounded byte-stream tools. It has no tool discovery, Agent orchestration, Backlot event file, project directory, external Provider, URL, or arbitrary command support. Platform persistence remains the only source of truth.
- Not copied: OpenMontage Python implementation, registry discovery, Backlot, provider integrations, filesystem project model, command-line passthrough, and global `.env` loading.
