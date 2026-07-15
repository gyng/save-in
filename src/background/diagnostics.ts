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
const workerStartedAtMs = Date.now();
const workerStartedAt = new Date(workerStartedAtMs).toISOString();
let workerReadyAt: string | undefined;
let workerStatus: DiagnosticSnapshot["workerStatus"] = "starting";
let latestWrite: Promise<unknown> = Promise.resolve();

export const normalizeDiagnosticLifecycle = (value: unknown): DiagnosticLifecycleEntry[] =>
  Array.isArray(value) ? value.filter(isDiagnosticLifecycleEntry).slice(-LIFECYCLE_LIMIT) : [];

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
    (stored) => [...normalizeDiagnosticLifecycle(stored), entry].slice(-LIFECYCLE_LIMIT),
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
  await latestWrite.catch(() => {});
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
