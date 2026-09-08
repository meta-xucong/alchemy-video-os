import type { CreativeBriefFactContext, FrozenDocumentFact, SegmentFactPack } from "@alchemy-video/contracts";
import { DeterministicFactSelector } from "@alchemy-video/document-intelligence";

export type FreezeFactContextInput = {
  workspaceId: string;
  projectId: string;
  creativeBriefRevisionId: string;
  knowledgeRevisionId: string;
  facts: readonly FrozenDocumentFact[];
};

const briefKey = (workspaceId: string, projectId: string, briefId: string) => `${workspaceId}:${projectId}:${briefId}`;
const cloneContexts = (contexts: readonly CreativeBriefFactContext[]) => contexts.map((context) => ({
  ...context,
  fact: { ...context.fact, source: { ...context.fact.source } },
}));

/**
 * Workspace-scoped repository for immutable CreativeBrief fact snapshots.
 * The Drizzle implementation can use the same contract; this adapter keeps
 * local MVP and worker tests deterministic without introducing a second
 * source of truth or ever re-reading Markdown.
 */
export class InMemoryCreativeBriefFactContextStore {
  private readonly contexts = new Map<string, readonly CreativeBriefFactContext[]>();
  private readonly selector = new DeterministicFactSelector();

  freeze(input: FreezeFactContextInput): readonly CreativeBriefFactContext[] {
    const key = briefKey(input.workspaceId, input.projectId, input.creativeBriefRevisionId);
    const existing = this.contexts.get(key);
    if (existing) return cloneContexts(existing);
    const frozen = this.selector.selectForBrief({
      creativeBriefRevisionId: input.creativeBriefRevisionId,
      sourceText: "",
      stylePreferences: "",
      facts: input.facts,
    });
    // Store a new array so caller mutation cannot alter the historical brief.
    const snapshot = cloneContexts(frozen);
    this.contexts.set(key, snapshot);
    return cloneContexts(snapshot);
  }

  list(workspaceId: string, projectId: string, creativeBriefRevisionId: string) {
    return cloneContexts(this.contexts.get(briefKey(workspaceId, projectId, creativeBriefRevisionId)) ?? []);
  }

  selectForSegment(input: { workspaceId: string; projectId: string; creativeBriefRevisionId: string; segmentSequence: number; narrativeText: string }): SegmentFactPack | undefined {
    const contexts = this.contexts.get(briefKey(input.workspaceId, input.projectId, input.creativeBriefRevisionId));
    return contexts ? this.selector.selectForSegment({ segmentSequence: input.segmentSequence, narrativeText: input.narrativeText, contexts }) : undefined;
  }
}
