export type C2paStatus =
  | "disabled"
  | "unsupported_format"
  | "absent"
  | "present_unverified"
  | "present_valid"
  | "present_valid_ai_claimed"
  | "error";

export interface C2paScanResult {
  status: C2paStatus;
  summary: string;
  validationState?: string | null;
  claimGenerator?: string;
  manifestLabel?: string;
  softwareAgents: string[];
  actions: string[];
  digitalSourceTypes: string[];
  validationIssues: string[];
  scannedAt: number;
  errorMessage?: string;
}

const VALID_STATUSES = new Set<C2paStatus>([
  "disabled",
  "unsupported_format",
  "absent",
  "present_unverified",
  "present_valid",
  "present_valid_ai_claimed",
  "error",
]);

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item == null) return "";
      if (typeof item === "number" || typeof item === "boolean") return String(item);
      return "";
    })
    .filter(Boolean);
}

/** Ensures scan results are safe to render (avoids React child object errors). */
export function normalizeC2paScanResult(
  raw: Partial<C2paScanResult> | null | undefined
): C2paScanResult | null {
  if (!raw || typeof raw !== "object") return null;

  const status = VALID_STATUSES.has(raw.status as C2paStatus)
    ? (raw.status as C2paStatus)
    : "error";

  return {
    status,
    summary:
      typeof raw.summary === "string" && raw.summary.trim()
        ? raw.summary.trim()
        : "C2PA scan result unavailable.",
    validationState:
      typeof raw.validationState === "string" ? raw.validationState : null,
    claimGenerator:
      typeof raw.claimGenerator === "string" ? raw.claimGenerator : undefined,
    manifestLabel:
      typeof raw.manifestLabel === "string" ? raw.manifestLabel : undefined,
    softwareAgents: toStringList(raw.softwareAgents),
    actions: toStringList(raw.actions),
    digitalSourceTypes: toStringList(raw.digitalSourceTypes),
    validationIssues: toStringList(raw.validationIssues),
    scannedAt:
      typeof raw.scannedAt === "number" && Number.isFinite(raw.scannedAt)
        ? raw.scannedAt
        : Date.now(),
    errorMessage:
      typeof raw.errorMessage === "string" ? raw.errorMessage : undefined,
  };
}

export function formatC2paContextForChat(
  result: C2paScanResult | Partial<C2paScanResult> | null
): string {
  const normalized = normalizeC2paScanResult(result);
  if (!normalized || normalized.status === "disabled") {
    return "C2PA: scanning disabled or not run.";
  }

  return [
    `C2PA status: ${normalized.status}`,
    `Summary: ${normalized.summary}`,
    normalized.validationState
      ? `Validation state: ${normalized.validationState}`
      : null,
    normalized.claimGenerator ? `Claim generator: ${normalized.claimGenerator}` : null,
    normalized.actions.length ? `Actions: ${normalized.actions.join(", ")}` : null,
    normalized.digitalSourceTypes.length
      ? `Digital source types: ${normalized.digitalSourceTypes.join(", ")}`
      : null,
    normalized.softwareAgents.length
      ? `Software agents: ${normalized.softwareAgents.join("; ")}`
      : null,
    normalized.validationIssues.length
      ? `Validation issues: ${normalized.validationIssues.join("; ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function getC2paChipLabel(
  result: C2paScanResult | Partial<C2paScanResult> | null
): string {
  const normalized = normalizeC2paScanResult(result);
  if (!normalized) return "C2PA: —";
  switch (normalized.status) {
    case "present_valid":
      return `C2PA: VALID${normalized.claimGenerator ? ` · ${truncate(normalized.claimGenerator, 24)}` : ""}`;
    case "present_valid_ai_claimed":
      return `C2PA: AI ASSERTED${normalized.claimGenerator ? ` · ${truncate(normalized.claimGenerator, 18)}` : ""}`;
    case "present_unverified":
      return "C2PA: UNVERIFIED";
    case "absent":
      return "C2PA: NONE";
    case "unsupported_format":
      return "C2PA: N/A";
    case "error":
      return "C2PA: ERROR";
    case "disabled":
      return "C2PA: OFF";
    default:
      return "C2PA: —";
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
