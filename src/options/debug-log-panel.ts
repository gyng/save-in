import { webExtensionApi } from "../platform/web-extension-api.ts";
import { getMessage } from "../platform/localization.ts";
import { MESSAGE_TYPES } from "../shared/constants.ts";
import {
  isDiagnosticLifecycleEntry,
  type DiagnosticLifecycleEntry,
  type DiagnosticSnapshot,
} from "../shared/diagnostics-types.ts";
import { isStringKeyedRecord, sendInternalMessage } from "../shared/message-protocol.ts";
import { copyText, type CopyText } from "./clipboard.ts";

let latestSnapshot: DiagnosticSnapshot | undefined;
let requestGeneration = 0;

const message = (key: string, fallback: string, substitutions?: string | number | string[]) =>
  getMessage(key, substitutions) || fallback;

const isFailureEntry = (value: unknown): boolean =>
  isStringKeyedRecord(value) &&
  typeof value.at === "string" &&
  typeof value.message === "string" &&
  (typeof value.data === "undefined" || typeof value.data === "string");

const isDiagnosticSnapshot = (value: unknown): value is DiagnosticSnapshot => {
  if (!isStringKeyedRecord(value)) return false;
  return (
    typeof value.capturedAt === "string" &&
    typeof value.extensionVersion === "string" &&
    typeof value.manifestVersion === "number" &&
    typeof value.browser === "string" &&
    (typeof value.browserVersion === "undefined" || typeof value.browserVersion === "number") &&
    (value.backgroundHost === "service_worker" || value.backgroundHost === "event_page") &&
    (value.workerStatus === "starting" ||
      value.workerStatus === "ready" ||
      value.workerStatus === "failed") &&
    typeof value.workerStartedAt === "string" &&
    (typeof value.workerReadyAt === "undefined" || typeof value.workerReadyAt === "string") &&
    typeof value.workerUptimeMs === "number" &&
    Number.isFinite(value.workerUptimeMs) &&
    value.workerUptimeMs >= 0 &&
    typeof value.sessionStorageAvailable === "boolean" &&
    typeof value.verboseLogging === "boolean" &&
    typeof value.pathErrorCount === "number" &&
    Number.isSafeInteger(value.pathErrorCount) &&
    value.pathErrorCount >= 0 &&
    typeof value.routingErrorCount === "number" &&
    Number.isSafeInteger(value.routingErrorCount) &&
    value.routingErrorCount >= 0 &&
    Array.isArray(value.lifecycle) &&
    value.lifecycle.every(isDiagnosticLifecycleEntry) &&
    Array.isArray(value.recentFailures) &&
    value.recentFailures.every(isFailureEntry)
  );
};

const setText = (selector: string, value: string): void => {
  const target = document.querySelector<HTMLElement>(selector);
  if (target) target.textContent = value;
};

const formatTime = (iso: string): string => {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date);
};

const formatDuration = (durationMs: number): string => {
  if (durationMs < 1000) return message("diagnosticsDurationMs", "$COUNT$ ms", durationMs);
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) return message("diagnosticsDurationSeconds", "$COUNT$ s", seconds);
  const minutes = Math.round(seconds / 60);
  return message("diagnosticsDurationMinutes", "$COUNT$ min", minutes);
};

const lifecycleText = (entry: DiagnosticLifecycleEntry): string => {
  switch (entry.kind) {
    case "background_ready":
      return message(
        "diagnosticsLifecycleBackgroundReady",
        "Background became ready in $DURATION$.",
        [formatDuration(entry.durationMs ?? 0)],
      );
    case "background_failed":
      return message("diagnosticsLifecycleBackgroundFailed", "Background startup failed.");
    case "configuration_reloaded":
      return message("diagnosticsLifecycleConfigurationReloaded", "Configuration reloaded.");
    case "extension_installed":
      return message("diagnosticsLifecycleExtensionInstalled", "Extension installed.");
    case "extension_updated":
      return entry.previousVersion
        ? message("diagnosticsLifecycleExtensionUpdatedFrom", "Extension updated from $VERSION$.", [
            entry.previousVersion,
          ])
        : message("diagnosticsLifecycleExtensionUpdated", "Extension updated.");
    case "failures_cleared":
      return message("diagnosticsLifecycleFailuresCleared", "Recent failures cleared.");
  }
};

const renderLifecycle = (entries: DiagnosticLifecycleEntry[]): void => {
  const list = document.querySelector<HTMLOListElement>("#diagnostics-lifecycle");
  if (!list) return;
  if (entries.length === 0) {
    const empty = document.createElement("li");
    empty.className = "diagnostics-empty";
    empty.textContent = message("diagnosticsLifecycleEmpty", "No lifecycle events yet.");
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(
    ...entries.toReversed().map((entry) => {
      const item = document.createElement("li");
      const time = document.createElement("time");
      time.dateTime = entry.at;
      time.textContent = formatTime(entry.at);
      const description = document.createElement("span");
      description.textContent = lifecycleText(entry);
      item.append(time, description);
      return item;
    }),
  );
};

const failureLines = (snapshot: DiagnosticSnapshot): string =>
  snapshot.recentFailures
    .map((entry) => [entry.at, entry.message, entry.data].filter(Boolean).join("  "))
    .join("\n");

const renderSnapshot = (snapshot: DiagnosticSnapshot): void => {
  const statusCopy: Record<DiagnosticSnapshot["workerStatus"], string> = {
    starting: message("diagnosticsWorkerStarting", "Starting"),
    ready: message("diagnosticsWorkerReady", "Running · ready"),
    failed: message("diagnosticsWorkerFailed", "Startup failed"),
  };
  const host =
    snapshot.backgroundHost === "service_worker"
      ? message("diagnosticsHostServiceWorker", "MV3 service worker")
      : message("diagnosticsHostEventPage", "MV3 event page");
  const browserName =
    snapshot.browser === "FIREFOX"
      ? "Firefox"
      : snapshot.browser === "CHROME"
        ? "Chrome"
        : message("diagnosticsBrowserUnknown", "Unknown browser");
  const browser = snapshot.browserVersion
    ? `${browserName} ${snapshot.browserVersion}`
    : browserName;
  const extension = `Save In ${snapshot.extensionVersion} · Manifest V${snapshot.manifestVersion}`;
  const started = message("diagnosticsStartedWithUptime", "$TIME$ · up for $UPTIME$", [
    formatTime(snapshot.workerStartedAt),
    formatDuration(snapshot.workerUptimeMs),
  ]);
  const configuration = message(
    "diagnosticsConfigurationIssueCount",
    "$PATHS$ path · $ROUTING$ routing",
    [String(snapshot.pathErrorCount), String(snapshot.routingErrorCount)],
  );

  setText("#diagnostics-background", statusCopy[snapshot.workerStatus]);
  setText("#diagnostics-host", host);
  setText("#diagnostics-extension", extension);
  setText("#diagnostics-browser", browser);
  setText("#diagnostics-worker-started", started);
  setText(
    "#diagnostics-session-storage",
    snapshot.sessionStorageAvailable
      ? message("diagnosticsAvailable", "Available")
      : message("diagnosticsUnavailable", "Unavailable"),
  );
  setText(
    "#diagnostics-verbose",
    snapshot.verboseLogging ? message("diagnosticsOn", "On") : message("diagnosticsOff", "Off"),
  );
  setText("#diagnostics-configuration", configuration);
  setText("#diagnostics-failure-count", String(snapshot.recentFailures.length));
  const log = document.querySelector<HTMLTextAreaElement>("#debug-log");
  if (log) {
    log.value =
      failureLines(snapshot) || message("diagnosticsFailuresEmpty", "No recent failures.");
  }
  renderLifecycle(snapshot.lifecycle);
};

const setStatus = (text: string, error = false): void => {
  const status = document.querySelector<HTMLElement>("#diagnostics-status");
  if (!status) return;
  status.textContent = text;
  status.classList.toggle("feedback-error", error);
};

const setBusy = (busy: boolean): void => {
  document.querySelector("#diagnostics-core")?.setAttribute("aria-busy", String(busy));
  for (const selector of ["#debug-log-refresh", "#diagnostics-copy", "#debug-log-clear"]) {
    const button = document.querySelector<HTMLButtonElement>(selector);
    if (button) button.disabled = busy;
  }
};

export const updateDebugLog = async (): Promise<DiagnosticSnapshot | undefined> => {
  const details = document.querySelector<HTMLDetailsElement>("#diagnostics-details");
  if (!details?.open) return undefined;
  const generation = ++requestGeneration;
  setBusy(true);
  setStatus(message("diagnosticsChecking", "Checking background…"));
  try {
    const response = await sendInternalMessage(webExtensionApi.runtime, {
      type: MESSAGE_TYPES.DIAGNOSTICS_GET,
    });
    if (response.type !== MESSAGE_TYPES.DIAGNOSTICS_GET || !isDiagnosticSnapshot(response.body)) {
      throw new Error("Invalid diagnostics response");
    }
    if (generation !== requestGeneration) return latestSnapshot;
    latestSnapshot = response.body;
    renderSnapshot(response.body);
    setStatus(
      message("diagnosticsCheckedAt", "Checked $TIME$", [formatTime(response.body.capturedAt)]),
    );
    return response.body;
  } catch {
    if (generation === requestGeneration) {
      setStatus(message("diagnosticsLoadFailed", "Could not load diagnostics."), true);
    }
    return undefined;
  } finally {
    if (generation === requestGeneration) setBusy(false);
  }
};

const diagnosticsText = (snapshot: DiagnosticSnapshot): string => {
  const core = Array.from(document.querySelectorAll<HTMLElement>("#diagnostics-core > div"))
    .map((item) => {
      const label = item.querySelector("dt")?.textContent?.trim();
      const value = item.querySelector("dd")?.textContent?.trim();
      return label && value ? `${label}: ${value}` : "";
    })
    .filter(Boolean)
    .join("\n");
  const lifecycle = snapshot.lifecycle
    .map((entry) => `${entry.at}  ${lifecycleText(entry)}`)
    .join("\n");
  return [
    message("o_sAdvancedDiagnostics", "Diagnostics"),
    core || "",
    "",
    message("diagnosticsLifecycle", "Lifecycle"),
    lifecycle || message("diagnosticsLifecycleEmpty", "No lifecycle events yet."),
    "",
    message("o_lDebugLog", "Recent failures"),
    failureLines(snapshot) || message("diagnosticsFailuresEmpty", "No recent failures."),
  ].join("\n");
};

const copyDiagnostics = async (
  snapshot: DiagnosticSnapshot | undefined,
  copy: CopyText,
): Promise<void> => {
  if (snapshot === undefined) return;
  await copy(diagnosticsText(snapshot));
  setStatus(message("diagnosticsCopySuccess", "Diagnostics copied."));
};

export const setupDebugLogPanel = (copy: CopyText = copyText): void => {
  const details = document.querySelector<HTMLDetailsElement>("#diagnostics-details");
  if (!details) return;
  latestSnapshot = undefined;
  requestGeneration += 1;
  details.addEventListener("toggle", () => {
    if (details.open && !latestSnapshot) void updateDebugLog();
  });
  document.querySelector("#debug-log-refresh")?.addEventListener("click", () => {
    void updateDebugLog();
  });
  document.querySelector("#diagnostics-copy")?.addEventListener("click", () => {
    const run = async (): Promise<void> => {
      const snapshot = latestSnapshot ?? (await updateDebugLog());
      await copyDiagnostics(snapshot, copy);
    };
    void run().catch(() => {
      setStatus(message("diagnosticsCopyFailed", "Could not copy diagnostics."), true);
    });
  });
  document.querySelector("#debug-log-clear")?.addEventListener("click", () => {
    const clear = async (): Promise<void> => {
      requestGeneration += 1;
      setBusy(true);
      const response = await sendInternalMessage(webExtensionApi.runtime, {
        type: MESSAGE_TYPES.DIAGNOSTICS_CLEAR_FAILURES,
      });
      if (response.type !== MESSAGE_TYPES.OK) throw new Error("Could not clear failures");
      latestSnapshot = undefined;
      await updateDebugLog();
      setStatus(message("diagnosticsClearSuccess", "Recent failures cleared."));
    };
    void clear().catch(() => {
      setBusy(false);
      setStatus(message("diagnosticsClearFailed", "Could not clear recent failures."), true);
    });
  });
  if (details.open) void updateDebugLog();
};
