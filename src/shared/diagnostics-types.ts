export const DIAGNOSTIC_LIFECYCLE_KINDS = [
  "background_ready",
  "background_failed",
  "configuration_reloaded",
  "extension_installed",
  "extension_updated",
  "failures_cleared",
] as const;

export type DiagnosticLifecycleKind = (typeof DIAGNOSTIC_LIFECYCLE_KINDS)[number];

export type DiagnosticLifecycleEntry = {
  at: string;
  kind: DiagnosticLifecycleKind;
  durationMs?: number | undefined;
  previousVersion?: string | undefined;
};

const isDiagnosticLifecycleKind = (value: unknown): value is DiagnosticLifecycleKind =>
  typeof value === "string" && DIAGNOSTIC_LIFECYCLE_KINDS.some((kind) => kind === value);

export const isDiagnosticLifecycleEntry = (value: unknown): value is DiagnosticLifecycleEntry => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const at = Reflect.get(value, "at");
  const kind = Reflect.get(value, "kind");
  const durationMs = Reflect.get(value, "durationMs");
  const previousVersion = Reflect.get(value, "previousVersion");
  return (
    typeof at === "string" &&
    isDiagnosticLifecycleKind(kind) &&
    (typeof durationMs === "undefined" ||
      (typeof durationMs === "number" && Number.isSafeInteger(durationMs) && durationMs >= 0)) &&
    (typeof previousVersion === "undefined" || typeof previousVersion === "string")
  );
};

export type DiagnosticFailureEntry = {
  at: string;
  message: string;
  data?: string | undefined;
};

export type DiagnosticSnapshot = {
  capturedAt: string;
  extensionVersion: string;
  manifestVersion: number;
  browser: string;
  browserVersion?: number | undefined;
  backgroundHost: "service_worker" | "event_page";
  workerStatus: "starting" | "ready" | "failed";
  workerStartedAt: string;
  workerReadyAt?: string | undefined;
  workerUptimeMs: number;
  sessionStorageAvailable: boolean;
  verboseLogging: boolean;
  pathErrorCount: number;
  routingErrorCount: number;
  lifecycle: DiagnosticLifecycleEntry[];
  recentFailures: DiagnosticFailureEntry[];
};
