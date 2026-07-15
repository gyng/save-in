import { webExtensionApi } from "../platform/web-extension-api.ts";
import { CURRENT_BROWSER, CURRENT_BROWSER_VERSION } from "../platform/chrome-detector.ts";
import { extensionSessionStorage } from "../platform/storage-areas.ts";
import {
  isDiagnosticLifecycleEntry,
  type DiagnosticLifecycleEntry,
  type DiagnosticLifecycleKind,
  type DiagnosticSnapshot,
} from "../shared/diagnostics-types.ts";
import { DIAGNOSTIC_LIFECYCLE_SESSION_KEY } from "../shared/storage-keys.ts";
import { getSession, updateSession } from "../shared/session-state.ts";
import { sessionWriteState } from "./state.ts";
import { Log } from "./log.ts";
import { backgroundRuntime } from "./runtime.ts";

const LIFECYCLE_LIMIT = 50;
const ROUTINE_LIFECYCLE_LIMIT = 5;
const ROUTINE_LIFECYCLE_KINDS = new Set<DiagnosticLifecycleKind>([
  "background_ready",
  "configuration_reloaded",
]);
const workerStartedAtMs = Date.now();
const workerStartedAt = new Date(workerStartedAtMs).toISOString();
let workerReadyAt: string | undefined;
let workerStatus: DiagnosticSnapshot["workerStatus"] = "starting";
let latestWrite: Promise<unknown> = Promise.resolve();

export const normalizeDiagnosticLifecycle = (value: unknown): DiagnosticLifecycleEntry[] => {
  if (!Array.isArray(value)) return [];
  const entries = value.filter(isDiagnosticLifecycleEntry);
  const routineCounts = new Map<DiagnosticLifecycleKind, number>();
  const retained: DiagnosticLifecycleEntry[] = [];
  for (
    let index = entries.length - 1;
    index >= 0 && retained.length < LIFECYCLE_LIMIT;
    index -= 1
  ) {
    const entry = entries[index];
    if (entry === undefined) continue;
    if (ROUTINE_LIFECYCLE_KINDS.has(entry.kind)) {
      const count = routineCounts.get(entry.kind) ?? 0;
      if (count >= ROUTINE_LIFECYCLE_LIMIT) continue;
      routineCounts.set(entry.kind, count + 1);
    }
    retained.push(entry);
  }
  return retained.reverse();
};

export const recordDiagnosticLifecycle = (
  kind: DiagnosticLifecycleKind,
  fields: Pick<DiagnosticLifecycleEntry, "durationMs" | "previousVersion"> = {},
): Promise<unknown> => {
  const entry: DiagnosticLifecycleEntry = {
    at: new Date().toISOString(),
    kind,
    ...(fields.durationMs !== undefined ? { durationMs: fields.durationMs } : {}),
    ...(fields.previousVersion !== undefined ? { previousVersion: fields.previousVersion } : {}),
  };
  latestWrite = updateSession<DiagnosticLifecycleEntry[]>(
    sessionWriteState,
    extensionSessionStorage,
    DIAGNOSTIC_LIFECYCLE_SESSION_KEY,
    (stored) => normalizeDiagnosticLifecycle([...normalizeDiagnosticLifecycle(stored), entry]),
  );
  return latestWrite;
};

export const markBackgroundReady = (): void => {
  workerStatus = "ready";
  workerReadyAt = new Date().toISOString();
  void recordDiagnosticLifecycle("background_ready", {
    durationMs: Math.max(0, Date.now() - workerStartedAtMs),
  });
};

export const markBackgroundFailed = (): void => {
  workerStatus = "failed";
  void recordDiagnosticLifecycle("background_failed");
};

const getLifecycle = async (): Promise<DiagnosticLifecycleEntry[]> => {
  // updateSession contains persistence failures and always settles successfully.
  await latestWrite;
  const stored = await getSession(extensionSessionStorage, DIAGNOSTIC_LIFECYCLE_SESSION_KEY);
  return normalizeDiagnosticLifecycle(stored[DIAGNOSTIC_LIFECYCLE_SESSION_KEY]);
};

export const getDiagnosticSnapshot = async (): Promise<DiagnosticSnapshot> => {
  const manifest = webExtensionApi.runtime.getManifest();
  const [lifecycle, recentFailures] = await Promise.all([getLifecycle(), Log.get()]);
  return {
    capturedAt: new Date().toISOString(),
    extensionVersion: manifest.version,
    manifestVersion: manifest.manifest_version,
    browser: CURRENT_BROWSER,
    ...(CURRENT_BROWSER_VERSION !== undefined ? { browserVersion: CURRENT_BROWSER_VERSION } : {}),
    backgroundHost: Reflect.has(globalThis, "document") ? "event_page" : "service_worker",
    workerStatus,
    workerStartedAt,
    ...(workerReadyAt !== undefined ? { workerReadyAt } : {}),
    workerUptimeMs: Math.max(0, Date.now() - workerStartedAtMs),
    sessionStorageAvailable: Boolean(webExtensionApi.storage?.session),
    verboseLogging: backgroundRuntime.debug,
    pathErrorCount: backgroundRuntime.optionErrors.paths.length,
    routingErrorCount: backgroundRuntime.optionErrors.filenamePatterns.length,
    lifecycle,
    recentFailures,
  };
};
