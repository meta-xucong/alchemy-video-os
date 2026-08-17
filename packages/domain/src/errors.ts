export class DomainInvariantError extends Error {
  constructor(
    readonly code:
      | "TASK_STATE_INVALID"
      | "INPUT_SNAPSHOT_IMMUTABLE"
      | "RESULT_ASSET_IMMUTABLE"
      | "PROVIDER_RESUBMIT_FORBIDDEN"
      | "ACTIVE_TASK_RUN_EXISTS"
      | "IDEMPOTENCY_CONFLICT"
      | "BILLING_RECEIPT_INVALID"
      | "DOCUMENT_CONVERSION_STATE_INVALID"
      | "DOCUMENT_RESULT_IMMUTABLE"
      | "CREATIVE_PLAN_STATE_INVALID"
      | "STORYBOARD_SPEC_INVALID"
      | "PRODUCTION_RUN_STATE_INVALID"
      | "PRODUCTION_SEGMENT_STATE_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "DomainInvariantError";
  }
}
