export class DomainInvariantError extends Error {
  constructor(
    readonly code:
      | "TASK_STATE_INVALID"
      | "INPUT_SNAPSHOT_IMMUTABLE"
      | "RESULT_ASSET_IMMUTABLE"
      | "PROVIDER_RESUBMIT_FORBIDDEN"
      | "ACTIVE_TASK_RUN_EXISTS"
      | "IDEMPOTENCY_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "DomainInvariantError";
  }
}
