import type {
  ApplicationErrorCode,
  VeyraExternalIdentity,
  VeyraLoginTicketExchangeInput,
} from "@alchemy-video/contracts";

export type VeyraIdentityFailureCode = Extract<ApplicationErrorCode, "AUTH_FORBIDDEN" | "AUTH_UNAVAILABLE">;

export interface VeyraIdentityPort {
  exchangeTicket(input: VeyraLoginTicketExchangeInput): Promise<VeyraExternalIdentity>;
}
