import { ExternalLink, Shield, ShieldAlert, ShieldCheck, ShieldOff, Loader2 } from "lucide-react";
import { normalizeC2paScanResult, type C2paScanResult, type C2paStatus } from "../services/c2paTypes";

interface C2paCredentialsPanelProps {
  scanning: boolean;
  result: C2paScanResult | null;
}

function statusStyles(status: C2paStatus): {
  border: string;
  badge: string;
  Icon: typeof Shield;
} {
  switch (status) {
    case "present_valid":
      return {
        border: "border-cyan-500/30 bg-cyan-950/20",
        badge: "text-cyan-400 bg-cyan-500/10 border-cyan-500/30",
        Icon: ShieldCheck,
      };
    case "present_valid_ai_claimed":
      return {
        border: "border-amber-500/40 bg-amber-950/20",
        badge: "text-amber-400 bg-amber-500/10 border-amber-500/40",
        Icon: ShieldAlert,
      };
    case "present_unverified":
      return {
        border: "border-amber-500/30 bg-amber-950/10",
        badge: "text-amber-500 bg-amber-500/10 border-amber-500/30",
        Icon: ShieldAlert,
      };
    case "absent":
      return {
        border: "border-white/10 bg-white/2",
        badge: "text-gray-500 bg-white/5 border-white/10",
        Icon: ShieldOff,
      };
    case "error":
      return {
        border: "border-red-500/30 bg-red-950/20",
        badge: "text-red-400 bg-red-500/10 border-red-500/30",
        Icon: ShieldAlert,
      };
    default:
      return {
        border: "border-white/10 bg-white/2",
        badge: "text-gray-600 bg-white/5 border-white/10",
        Icon: Shield,
      };
  }
}

function statusLabel(status: C2paStatus): string {
  switch (status) {
    case "present_valid":
      return "VALID";
    case "present_valid_ai_claimed":
      return "AI ASSERTED";
    case "present_unverified":
      return "UNVERIFIED";
    case "absent":
      return "NONE";
    case "unsupported_format":
      return "UNSUPPORTED";
    case "error":
      return "ERROR";
    case "disabled":
      return "DISABLED";
    default:
      return "UNKNOWN";
  }
}

export function C2paImageBadge({
  scanning,
  result,
}: {
  scanning: boolean;
  result: C2paScanResult | null;
}) {
  const safeResult = normalizeC2paScanResult(result);

  if (scanning) {
    return (
      <div className="absolute top-3 left-3 z-20 flex items-center gap-1.5 px-2 py-1 bg-black/80 border border-white/10 rounded backdrop-blur-md">
        <Loader2 className="w-3 h-3 text-cyan-500 animate-spin" />
        <span className="text-[9px] font-mono text-cyan-400 uppercase tracking-widest">
          C2PA Scan
        </span>
      </div>
    );
  }

  if (!safeResult) return null;

  const { border, badge, Icon } = statusStyles(safeResult.status);

  return (
    <div
      className={`absolute top-3 left-3 z-20 flex items-center gap-1.5 px-2 py-1 bg-black/80 border rounded backdrop-blur-md ${border}`}
    >
      <Icon className="w-3 h-3 shrink-0" />
      <span className={`text-[9px] font-mono uppercase tracking-widest ${badge.split(" ")[0]}`}>
        {statusLabel(safeResult.status)}
      </span>
    </div>
  );
}

export default function C2paCredentialsPanel({
  scanning,
  result,
}: C2paCredentialsPanelProps) {
  const safeResult = normalizeC2paScanResult(result);
  const showPlaceholder = !scanning && !safeResult;

  return (
    <section className="space-y-3">
      <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold block">
        Content Credentials (C2PA)
      </label>

      {scanning && (
        <div className="p-4 bg-white/5 border border-white/10 rounded-lg flex items-center gap-3">
          <Loader2 className="w-4 h-4 text-cyan-500 animate-spin" />
          <span className="text-[10px] font-mono text-gray-400 uppercase tracking-widest">
            Scanning manifest…
          </span>
        </div>
      )}

      {showPlaceholder && (
        <div className="p-3 bg-white/2 border border-white/5 rounded-lg opacity-40">
          <p className="text-[10px] text-gray-600 font-mono uppercase tracking-widest">
            Awaiting visual source
          </p>
        </div>
      )}

      {!scanning && safeResult && (
        <div
          className={`p-4 border rounded-lg space-y-3 ${statusStyles(safeResult.status).border}`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {(() => {
                const { Icon } = statusStyles(safeResult.status);
                return <Icon className="w-4 h-4 shrink-0" />;
              })()}
              <span
                className={`text-[10px] font-bold font-mono uppercase tracking-widest px-2 py-0.5 border rounded ${statusStyles(safeResult.status).badge}`}
              >
                {statusLabel(safeResult.status)}
              </span>
            </div>
            {safeResult.validationState && (
              <span className="text-[9px] font-mono text-gray-500 uppercase">
                {safeResult.validationState}
              </span>
            )}
          </div>

          <p className="text-xs text-gray-400 leading-relaxed">{safeResult.summary}</p>

          {safeResult.status === "absent" && (
            <p className="text-[10px] text-gray-600 leading-relaxed">
              Absence of a manifest does not prove a photo is authentic or non-AI. Metadata may
              have been stripped on export.
            </p>
          )}

          {(safeResult.claimGenerator || safeResult.manifestLabel) && (
            <div className="space-y-1 text-[10px] font-mono">
              {safeResult.claimGenerator && (
                <div className="flex justify-between gap-2">
                  <span className="text-gray-600 uppercase">Claim generator</span>
                  <span className="text-gray-300 text-right truncate">{safeResult.claimGenerator}</span>
                </div>
              )}
              {safeResult.manifestLabel && (
                <div className="flex justify-between gap-2">
                  <span className="text-gray-600 uppercase">Manifest</span>
                  <span className="text-gray-500 text-right truncate">{safeResult.manifestLabel}</span>
                </div>
              )}
            </div>
          )}

          {safeResult.actions.length > 0 && (
            <details className="group">
              <summary className="text-[10px] text-gray-500 uppercase tracking-widest cursor-pointer hover:text-cyan-400 transition-colors">
                Action chain ({safeResult.actions.length})
              </summary>
              <ul className="mt-2 space-y-1 max-h-28 overflow-y-auto custom-scrollbar">
                {safeResult.actions.map((action, i) => (
                  <li
                    key={`${action}-${i}`}
                    className="text-[10px] font-mono text-gray-400 px-2 py-1 bg-black/30 rounded border border-white/5"
                  >
                    {action}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {safeResult.digitalSourceTypes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {safeResult.digitalSourceTypes.map((type) => (
                <span
                  key={type}
                  className="text-[9px] font-mono px-2 py-0.5 rounded border border-amber-500/20 bg-amber-950/30 text-amber-400/90 max-w-full truncate"
                  title={type}
                >
                  {type.split("/").pop() ?? type}
                </span>
              ))}
            </div>
          )}

          {safeResult.validationIssues.length > 0 && (
            <ul className="space-y-1">
              {safeResult.validationIssues.map((issue, i) => (
                <li key={i} className="text-[10px] text-amber-500/90 font-mono leading-snug">
                  {issue}
                </li>
              ))}
            </ul>
          )}

          <a
            href="https://contentcredentials.org/verify"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[10px] text-cyan-600 hover:text-cyan-400 font-mono uppercase tracking-widest transition-colors"
          >
            Verify externally <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}
    </section>
  );
}
