import { createC2pa, type C2paSdk } from "@contentauth/c2pa-web";
import { isSupportedReaderFormat } from "@contentauth/c2pa-web";
import type {
  Manifest,
  ManifestAssertion,
  Reader as C2paManifestStoreData,
} from "@contentauth/c2pa-types";
import wasmSrc from "@contentauth/c2pa-web/resources/c2pa.wasm?url";
import type { C2paScanResult, C2paStatus } from "./c2paTypes";
import { normalizeC2paScanResult } from "./c2paTypes";

export type { C2paScanResult, C2paStatus } from "./c2paTypes";
export {
  formatC2paContextForChat,
  getC2paChipLabel,
  normalizeC2paScanResult,
} from "./c2paTypes";

const AI_SOURCE_MARKERS = [
  "trainedalgorithmicmedia",
  "algorithmicmedia",
  "compositesynthetic",
  "compositewithtrainedalgorithmicmedia",
  "softwareimage",
  "digitalcreation",
  "trainedalgorithmicdata",
  "algorithmicallyenhanced",
];

let c2paSdkPromise: Promise<C2paSdk> | null = null;

export function isC2paEnabled(): boolean {
  return import.meta.env.VITE_C2PA_ENABLED !== "false";
}

function getC2paSdk(): Promise<C2paSdk> {
  if (!c2paSdkPromise) {
    c2paSdkPromise = createC2pa({ wasmSrc }).catch((error) => {
      c2paSdkPromise = null;
      throw error;
    });
  }
  return c2paSdkPromise;
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function asClaimGenerator(value: unknown): string | undefined {
  const direct = asString(value);
  if (direct) return direct;
  if (value && typeof value === "object" && "name" in value) {
    const info = value as { name?: string; version?: string | null };
    if (info.name) {
      return info.version ? `${info.name} ${info.version}` : info.name;
    }
  }
  return undefined;
}

async function resolveActiveManifest(
  reader: { activeManifest: () => Promise<Manifest>; manifestStore: () => Promise<C2paManifestStoreData> }
): Promise<Manifest> {
  try {
    return await reader.activeManifest();
  } catch (activeError) {
    console.warn("C2PA activeManifest() failed, using manifestStore fallback:", activeError);
    const store = await reader.manifestStore();
    const label = asString(store.active_manifest);
    if (label && store.manifests?.[label]) {
      return store.manifests[label];
    }
    throw activeError;
  }
}

function formatSoftwareAgent(agent: unknown): string | null {
  if (typeof agent === "string" && agent.trim()) return agent.trim();
  if (agent && typeof agent === "object" && "name" in agent) {
    const info = agent as { name?: string; version?: string | null };
    if (!info.name) return null;
    return info.version ? `${info.name} ${info.version}` : info.name;
  }
  return null;
}

function isAiDigitalSourceType(value: string): boolean {
  const lower = value.toLowerCase();
  return AI_SOURCE_MARKERS.some((marker) => lower.includes(marker));
}

function collectFromActionsAssertion(
  assertion: ManifestAssertion,
  actions: string[],
  softwareAgents: Set<string>,
  digitalSourceTypes: Set<string>
): boolean {
  let hasCreated = false;
  const data = assertion.data;

  if (!data || typeof data !== "object") {
    return hasCreated;
  }

  const actionList = Array.isArray(data)
    ? data
    : Array.isArray((data as { actions?: unknown[] }).actions)
      ? (data as { actions: unknown[] }).actions
      : [];

  for (const entry of actionList) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as {
      action?: unknown;
      softwareAgent?: unknown;
      digitalSourceType?: unknown;
    };

    const actionName = asString(item.action);
    if (actionName) {
      actions.push(actionName);
      if (actionName.toLowerCase().includes("created")) {
        hasCreated = true;
      }
    }

    const agent = formatSoftwareAgent(item.softwareAgent);
    if (agent) softwareAgents.add(agent);

    const sourceType = asString(item.digitalSourceType);
    if (sourceType) digitalSourceTypes.add(sourceType);
  }

  return hasCreated;
}

function extractManifestSignals(manifest: Manifest) {
  const actions: string[] = [];
  const softwareAgents = new Set<string>();
  const digitalSourceTypes = new Set<string>();
  let hasCreatedAction = false;

  const claimGenerator = asClaimGenerator(manifest.claim_generator);
  if (claimGenerator) softwareAgents.add(claimGenerator);

  for (const info of manifest.claim_generator_info ?? []) {
    if (!info?.name) continue;
    const label = info.version ? `${info.name} ${info.version}` : info.name;
    softwareAgents.add(label);
  }

  for (const assertion of manifest.assertions ?? []) {
    if (assertion.label?.toLowerCase().includes("actions")) {
      const created = collectFromActionsAssertion(
        assertion,
        actions,
        softwareAgents,
        digitalSourceTypes
      );
      hasCreatedAction = hasCreatedAction || created;
    }
  }

  const hasAiSource = [...digitalSourceTypes].some(isAiDigitalSourceType);

  return {
    actions,
    softwareAgents: [...softwareAgents],
    digitalSourceTypes: [...digitalSourceTypes],
    hasCreatedAction,
    hasAiSource,
  };
}

function collectValidationIssues(store: C2paManifestStoreData): string[] {
  const issues: string[] = [];
  const validationStatus = store.validation_status;

  if (Array.isArray(validationStatus)) {
    for (const status of validationStatus) {
      if (status.success === false) {
        issues.push(
          asString(status.explanation) ||
            asString(status.code) ||
            "Validation failure"
        );
      }
    }
  }

  const failures = store.validation_results?.activeManifest?.failure ?? [];
  if (Array.isArray(failures)) {
    for (const failure of failures) {
      issues.push(
        asString(failure.explanation) ||
          asString(failure.code) ||
          "Manifest validation failure"
      );
    }
  }

  return [...new Set(issues)].slice(0, 8);
}

function isManifestCryptographicallyValid(store: C2paManifestStoreData): boolean {
  const state = store.validation_state;
  if (state === "Valid" || state === "Trusted") return true;
  if (state === "Invalid") return false;

  const issues = collectValidationIssues(store);
  return issues.length === 0;
}

function buildScanResult(
  status: C2paStatus,
  partial: Partial<Omit<C2paScanResult, "status" | "scannedAt">> = {}
): C2paScanResult {
  return normalizeC2paScanResult({
    status,
    summary: partial.summary ?? defaultSummary(status),
    softwareAgents: partial.softwareAgents ?? [],
    actions: partial.actions ?? [],
    digitalSourceTypes: partial.digitalSourceTypes ?? [],
    validationIssues: partial.validationIssues ?? [],
    scannedAt: Date.now(),
    validationState:
      typeof partial.validationState === "string" ? partial.validationState : null,
    claimGenerator: asString(partial.claimGenerator),
    manifestLabel: asString(partial.manifestLabel),
    errorMessage: asString(partial.errorMessage),
  })!;
}

function defaultSummary(status: C2paStatus): string {
  switch (status) {
    case "disabled":
      return "C2PA scanning is disabled.";
    case "unsupported_format":
      return "File format is not supported for Content Credentials.";
    case "absent":
      return "No C2PA manifest detected in this file.";
    case "present_unverified":
      return "C2PA manifest found, but credentials are not fully verified.";
    case "present_valid":
      return "Valid Content Credentials present.";
    case "present_valid_ai_claimed":
      return "Valid Content Credentials with AI creation indicators.";
    case "error":
      return "C2PA scan failed.";
    default:
      return "Unknown C2PA status.";
  }
}

export async function scanImageForC2pa(file: File): Promise<C2paScanResult> {
  if (!isC2paEnabled()) {
    return buildScanResult("disabled", {});
  }

  if (!isSupportedReaderFormat(file.type)) {
    return buildScanResult("unsupported_format", {
      summary: `Format "${file.type || "unknown"}" is not supported for C2PA scanning.`,
    });
  }

  try {
    const c2pa = await getC2paSdk();
    const reader = await c2pa.reader.fromBlob(file.type, file);

    if (!reader) {
      return buildScanResult("absent", {});
    }

    try {
      const store = await reader.manifestStore();
      const manifest = await resolveActiveManifest(reader);
      const valid = isManifestCryptographicallyValid(store);
      const signals = extractManifestSignals(manifest);
      const validationIssues = collectValidationIssues(store);
      const claimGenerator =
        asClaimGenerator(manifest.claim_generator) ??
        (manifest.claim_generator_info?.[0]?.name
          ? manifest.claim_generator_info[0].version
            ? `${manifest.claim_generator_info[0].name} ${manifest.claim_generator_info[0].version}`
            : manifest.claim_generator_info[0].name
          : undefined);

      const aiClaimed = signals.hasCreatedAction || signals.hasAiSource;

      let status: C2paStatus;
      if (!valid) {
        status = "present_unverified";
      } else if (aiClaimed) {
        status = "present_valid_ai_claimed";
      } else {
        status = "present_valid";
      }

      return buildScanResult(status, {
        validationState: asString(store.validation_state) ?? null,
        claimGenerator,
        manifestLabel:
          asString(store.active_manifest) ?? asString(manifest.label) ?? undefined,
        softwareAgents: signals.softwareAgents,
        actions: signals.actions,
        digitalSourceTypes: signals.digitalSourceTypes,
        validationIssues,
        summary: aiClaimed && valid
          ? "Valid Content Credentials; manifest asserts synthetic or AI-assisted creation."
          : undefined,
      });
    } finally {
      await reader.free();
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown C2PA scan error";
    return buildScanResult("error", {
      errorMessage: message,
      summary: `C2PA scan failed: ${message}`,
    });
  }
}
