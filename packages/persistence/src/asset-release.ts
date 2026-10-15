import { sql } from "drizzle-orm";

import type { ControlAsset } from "./asset-workspace-repository.js";
import type { ControlTaskRun } from "./task-run-repository.js";
import { assets, taskRuns } from "./schema.js";

/** READY proves stored bytes are valid; generated video release also requires task success. */
export const isAssetReleased = (asset: ControlAsset, taskRun?: ControlTaskRun): boolean => {
  if (asset.kind !== "VIDEO" || asset.origin !== "GENERATED") return true;
  return asset.status === "READY"
    && taskRun?.kind === "VIDEO_GENERATION"
    && taskRun.id === asset.metadata.task_run_id
    && taskRun.workspaceId === asset.workspaceId
    && taskRun.projectId === asset.projectId
    && taskRun.status === "SUCCEEDED"
    && taskRun.resultAssetId === asset.id;
};

/** Apply at user-facing reads and reference reuse, never at internal billing recovery. */
export const releasedAssetScope = () => sql`(
  ${assets.kind} <> 'VIDEO' OR ${assets.origin} <> 'GENERATED' OR (
    ${assets.status} = 'READY' AND EXISTS (
      SELECT 1 FROM ${taskRuns}
      WHERE ${taskRuns.id} = ${assets.metadata}->>'task_run_id'
        AND ${taskRuns.workspaceId} = ${assets.workspaceId}
        AND ${taskRuns.projectId} = ${assets.projectId}
        AND ${taskRuns.kind} = 'VIDEO_GENERATION'
        AND ${taskRuns.status} = 'SUCCEEDED'
        AND ${taskRuns.resultAssetId} = ${assets.id}
    )
  )
)`;
