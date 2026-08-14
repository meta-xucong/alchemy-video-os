export const CERTIFIER_PROFILE = "grok-imagine-video-1.5";
export const CERTIFIER_MAX_SUBMISSIONS = "1";
export const CERTIFIER_BUDGET_USD = "1.00";
export const CERTIFIER_ESTIMATED_COST_USD = "0.08";
export const CERTIFIER_RECOVERY_TTL_MS = 15 * 60 * 1000;
export const CERTIFIER_ACTIVE_CLAIM_LEASE_MS = 60 * 1000;
export const CERTIFIER_MAX_RESUME_GET_ATTEMPTS = 3;
export const CERTIFIER_POLL_INTERVAL_MS = 5_000;
export const CERTIFIER_MAX_POLL_ATTEMPTS = 120;

export const CERTIFIER_INPUT = Object.freeze({
  model: CERTIFIER_PROFILE,
  prompt: "A paper kite moving gently above a green field, daylight, static camera.",
  duration: 1,
  resolution: "480p",
  ratio: "16:9",
  reference_asset_ids: [],
});

export type CertifierMode = "stop-after-submit" | "resume" | "invalid";

export type CertifierArguments = Readonly<{
  live: boolean;
  profile?: string;
  maxSubmissions?: string;
  budgetUsd?: string;
  mode: CertifierMode;
  validSyntax: boolean;
}>;

const optionValues = new Set(["--profile", "--max-submissions", "--budget-usd"]);

export const parseCertifierArguments = (argv: readonly string[]): CertifierArguments => {
  let live = false;
  let profile: string | undefined;
  let maxSubmissions: string | undefined;
  let budgetUsd: string | undefined;
  let stopAfterSubmit = false;
  let resume = false;
  let validSyntax = true;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--live") {
      if (live) validSyntax = false;
      live = true;
      continue;
    }
    if (argument === "--stop-after-submit") {
      if (stopAfterSubmit) validSyntax = false;
      stopAfterSubmit = true;
      continue;
    }
    if (argument === "--resume") {
      if (resume) validSyntax = false;
      resume = true;
      continue;
    }
    if (optionValues.has(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        validSyntax = false;
        continue;
      }
      index += 1;
      if (argument === "--profile") {
        if (profile !== undefined) validSyntax = false;
        profile = value;
      }
      if (argument === "--max-submissions") {
        if (maxSubmissions !== undefined) validSyntax = false;
        maxSubmissions = value;
      }
      if (argument === "--budget-usd") {
        if (budgetUsd !== undefined) validSyntax = false;
        budgetUsd = value;
      }
      continue;
    }
    validSyntax = false;
  }

  const mode: CertifierMode = stopAfterSubmit === resume
    ? "invalid"
    : stopAfterSubmit
      ? "stop-after-submit"
      : "resume";

  return { live, profile, maxSubmissions, budgetUsd, mode, validSyntax };
};

const parseCents = (value: string) => {
  if (!/^\d+\.\d{2}$/.test(value)) return undefined;
  const [whole, fraction] = value.split(".");
  const cents = Number(`${whole}${fraction}`);
  return Number.isSafeInteger(cents) ? cents : undefined;
};

export const isExactLiveAuthorization = (arguments_: CertifierArguments) => {
  if (!arguments_.validSyntax || !arguments_.live) return false;
  if (arguments_.profile !== CERTIFIER_PROFILE) return false;
  if (arguments_.maxSubmissions !== CERTIFIER_MAX_SUBMISSIONS) return false;
  if (arguments_.budgetUsd !== CERTIFIER_BUDGET_USD) return false;
  if (arguments_.mode === "invalid") return false;
  const estimatedCents = parseCents(CERTIFIER_ESTIMATED_COST_USD);
  const budgetCents = parseCents(arguments_.budgetUsd);
  return estimatedCents !== undefined && budgetCents !== undefined && estimatedCents <= budgetCents;
};
