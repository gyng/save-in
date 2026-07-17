// @vitest-environment jsdom
import { PathEditor } from "../../../src/options/path-editor/path-editor.ts";
import {
  refreshCounterPanel,
  setupCounterPanel,
} from "../../../src/options/integrations/counter-panel.ts";
import {
  setupDebugLogPanel,
  updateDebugLog,
} from "../../../src/options/integrations/debug-log-panel.ts";
import {
  renderVariablesPreview,
  setupVariablesPreview,
} from "../../../src/options/reference/variables-preview.ts";
import { setupResetOptions } from "../../../src/options/core/reset-options.ts";
import { COUNTER_KEY } from "../../../src/shared/storage-keys.ts";
import { MESSAGE_TYPES } from "../../../src/shared/constants.ts";
import type { DiagnosticSnapshot } from "../../../src/shared/diagnostics-types.ts";

beforeEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.mocked(browser.i18n.getMessage).mockImplementation((key) => `Translated<${key}>`);
});

describe("counter panel", () => {
  test("renders persisted state and resets it", async () => {
    document.body.innerHTML =
      '<input id="counter-value"><button id="counter-set"></button><button id="counter-reset"></button>';
    vi.mocked(browser.storage.local.get).mockResolvedValue({ [COUNTER_KEY]: 7 });
    vi.mocked(browser.storage.local.set).mockResolvedValue();

    setupCounterPanel();
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLInputElement>("#counter-value")?.value).toBe("7"),
    );

    document.querySelector<HTMLInputElement>("#counter-value")!.value = "12";
    document.querySelector<HTMLButtonElement>("#counter-set")!.click();
    await vi.waitFor(() =>
      expect(browser.storage.local.set).toHaveBeenCalledWith({ [COUNTER_KEY]: 12 }),
    );

    document.querySelector<HTMLButtonElement>("#counter-reset")!.click();
    await vi.waitFor(() =>
      expect(browser.storage.local.set).toHaveBeenCalledWith({ [COUNTER_KEY]: 0 }),
    );
  });

  test("refreshes after a download advances the counter", async () => {
    document.body.innerHTML = '<input id="counter-value" value="0">';
    vi.mocked(browser.storage.local.get).mockResolvedValue({ [COUNTER_KEY]: 8 });
    await refreshCounterPanel();
    expect(document.querySelector<HTMLInputElement>("#counter-value")?.value).toBe("8");
  });

  test.each(["8", -1, 1.5, Number.NaN])(
    "renders malformed persisted counter %p as zero",
    async (stored) => {
      document.body.innerHTML = '<input id="counter-value" value="7">';
      vi.mocked(browser.storage.local.get).mockResolvedValue({ [COUNTER_KEY]: stored });

      await refreshCounterPanel();

      expect(document.querySelector<HTMLInputElement>("#counter-value")?.value).toBe("0");
    },
  );

  test("validates edits and supports the keyboard without writing malformed values", async () => {
    document.body.innerHTML =
      '<input id="counter-value"><button id="counter-set"></button><button id="counter-reset"></button>';
    vi.mocked(browser.storage.local.get).mockResolvedValue({});
    vi.mocked(browser.storage.local.set).mockResolvedValue();
    setupCounterPanel();
    const input = document.querySelector<HTMLInputElement>("#counter-value")!;
    const reportValidity = vi.spyOn(input, "reportValidity").mockReturnValue(false);
    await vi.waitFor(() => expect(input.value).toBe("0"));

    input.value = "-1";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(browser.storage.local.set).not.toHaveBeenCalled();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(reportValidity).toHaveBeenCalledOnce();
    expect(input.validationMessage).toContain("whole number");

    input.value = "9";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() =>
      expect(browser.storage.local.set).toHaveBeenCalledWith({ [COUNTER_KEY]: 9 }),
    );
    expect(input.validationMessage).toBe("");
  });

  test("does nothing until all controls exist and tolerates a refresh without an input", async () => {
    document.body.innerHTML = '<input id="counter-value">';
    setupCounterPanel();
    expect(browser.storage.local.get).not.toHaveBeenCalled();

    document.body.innerHTML = "";
    vi.mocked(browser.storage.local.get).mockResolvedValue({});
    await expect(refreshCounterPanel()).resolves.toBeUndefined();
  });
});

describe("debug log panel", () => {
  const snapshot = (overrides: Partial<DiagnosticSnapshot> = {}): DiagnosticSnapshot => ({
    capturedAt: "2026-07-15T08:00:05.000Z",
    extensionVersion: "4.0.0",
    manifestVersion: 3,
    browser: "CHROME",
    browserVersion: 140,
    backgroundHost: "service_worker",
    workerStatus: "ready",
    workerStartedAt: "2026-07-15T08:00:00.000Z",
    workerReadyAt: "2026-07-15T08:00:00.100Z",
    workerUptimeMs: 5000,
    sessionStorageAvailable: true,
    verboseLogging: false,
    pathErrorCount: 0,
    routingErrorCount: 1,
    lifecycle: [
      {
        at: "2026-07-15T08:00:00.100Z",
        kind: "background_ready",
        durationMs: 100,
      },
    ],
    recentFailures: [
      { at: "2026-07-15T08:00:04.000Z", message: "download failed", data: "denied" },
    ],
    ...overrides,
  });

  beforeEach(() => {
    document.body.innerHTML = `
      <details id="diagnostics-details">
        <span id="diagnostics-status"></span>
        <button id="debug-log-refresh"></button>
        <button id="diagnostics-copy"></button>
        <dl id="diagnostics-core">
          <div><dt>Background</dt><dd id="diagnostics-background"></dd></div>
          <div><dt>Host</dt><dd id="diagnostics-host"></dd></div>
          <div><dt>Extension</dt><dd id="diagnostics-extension"></dd></div>
          <div><dt>Browser</dt><dd id="diagnostics-browser"></dd></div>
          <div><dt>Worker started</dt><dd id="diagnostics-worker-started"></dd></div>
          <div><dt>Session storage</dt><dd id="diagnostics-session-storage"></dd></div>
          <div><dt>Verbose logging</dt><dd id="diagnostics-verbose"></dd></div>
          <div><dt>Configuration issues</dt><dd id="diagnostics-configuration"></dd></div>
        </dl>
        <ol id="diagnostics-lifecycle"></ol>
        <span id="diagnostics-failure-count"></span>
        <textarea id="debug-log"></textarea>
        <button id="debug-log-clear"></button>
      </details>`;
  });

  test("does not wake the background while Diagnostics is collapsed", async () => {
    setupDebugLogPanel();

    await expect(updateDebugLog()).resolves.toBeUndefined();
    expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test("loads and renders core health, lifecycle, and failures when opened", async () => {
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
      type: MESSAGE_TYPES.DIAGNOSTICS_GET,
      body: snapshot(),
    });
    setupDebugLogPanel();
    const details = document.querySelector<HTMLDetailsElement>("#diagnostics-details")!;
    details.open = true;
    details.dispatchEvent(new Event("toggle"));

    await vi.waitFor(() =>
      expect(document.querySelector("#diagnostics-background")?.textContent).toBe(
        "Translated<diagnosticsWorkerReady>",
      ),
    );
    expect(document.querySelector("#diagnostics-host")?.textContent).toBe(
      "Translated<diagnosticsHostServiceWorker>",
    );
    expect(document.querySelector("#diagnostics-configuration")?.textContent).toBe(
      "Translated<diagnosticsConfigurationIssueCount>",
    );
    expect(document.querySelector("#diagnostics-lifecycle")?.textContent).toContain(
      "diagnosticsLifecycleBackgroundReady",
    );
    expect(document.querySelector<HTMLTextAreaElement>("#debug-log")?.value).toContain(
      "download failed  denied",
    );
  });

  test("clears failures through the background and refreshes the snapshot", async () => {
    vi.mocked(browser.runtime.sendMessage)
      .mockResolvedValueOnce({ type: MESSAGE_TYPES.DIAGNOSTICS_GET, body: snapshot() })
      .mockResolvedValueOnce({ type: MESSAGE_TYPES.OK })
      .mockResolvedValueOnce({
        type: MESSAGE_TYPES.DIAGNOSTICS_GET,
        body: snapshot({ recentFailures: [] }),
      });
    const details = document.querySelector<HTMLDetailsElement>("#diagnostics-details")!;
    details.open = true;
    setupDebugLogPanel();
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLTextAreaElement>("#debug-log")?.value).toContain(
        "download failed",
      ),
    );

    document.querySelector<HTMLButtonElement>("#debug-log-clear")!.click();
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLTextAreaElement>("#debug-log")?.value).toBe(
        "Translated<diagnosticsFailuresEmpty>",
      ),
    );
    expect(browser.runtime.sendMessage).toHaveBeenNthCalledWith(2, {
      type: MESSAGE_TYPES.DIAGNOSTICS_CLEAR_FAILURES,
    });
  });

  test("reports malformed responses without replacing the current view", async () => {
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
      type: MESSAGE_TYPES.DIAGNOSTICS_GET,
      body: { capturedAt: "invalid" },
    });
    document.querySelector<HTMLDetailsElement>("#diagnostics-details")!.open = true;
    setupDebugLogPanel();
    await vi.waitFor(() =>
      expect(document.querySelector("#diagnostics-status")?.textContent).toBe(
        "Translated<diagnosticsLoadFailed>",
      ),
    );
    expect(document.querySelector<HTMLTextAreaElement>("#debug-log")?.value).toBe("");
  });

  test("reports a clear failure and keeps the current failure text", async () => {
    vi.mocked(browser.runtime.sendMessage)
      .mockResolvedValueOnce({ type: MESSAGE_TYPES.DIAGNOSTICS_GET, body: snapshot() })
      .mockRejectedValueOnce(new Error("remove denied"));
    document.querySelector<HTMLDetailsElement>("#diagnostics-details")!.open = true;
    setupDebugLogPanel();
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLTextAreaElement>("#debug-log")?.value).toContain(
        "download failed",
      ),
    );

    document.querySelector<HTMLButtonElement>("#debug-log-clear")!.click();

    await vi.waitFor(() =>
      expect(document.querySelector("#diagnostics-status")?.textContent).toBe(
        "Translated<diagnosticsClearFailed>",
      ),
    );
    expect(document.querySelector<HTMLTextAreaElement>("#debug-log")?.value).toContain(
      "download failed",
    );
  });

  test("copies the rendered snapshot only after an explicit action", async () => {
    const copy = vi.fn<(text: string) => Promise<void>>().mockResolvedValue();
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
      type: MESSAGE_TYPES.DIAGNOSTICS_GET,
      body: snapshot(),
    });
    document.querySelector<HTMLDetailsElement>("#diagnostics-details")!.open = true;
    setupDebugLogPanel(copy);
    await vi.waitFor(() => expect(browser.runtime.sendMessage).toHaveBeenCalledOnce());

    document.querySelector<HTMLButtonElement>("#diagnostics-copy")!.click();

    await vi.waitFor(() => expect(copy).toHaveBeenCalledOnce());
    expect(copy.mock.calls[0]?.[0]).toContain("Host: Translated<diagnosticsHostServiceWorker>");
    expect(copy.mock.calls[0]?.[0]).toContain("download failed");
  });

  test("renders fallback copy, event-page health, and every lifecycle outcome", async () => {
    vi.spyOn(browser.i18n, "getMessage").mockReturnValue("");
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
      type: MESSAGE_TYPES.DIAGNOSTICS_GET,
      body: snapshot({
        capturedAt: "invalid capture time",
        backgroundHost: "event_page",
        workerStatus: "failed",
        workerStartedAt: "invalid start time",
        workerUptimeMs: 61_000,
        browser: "FIREFOX",
        browserVersion: undefined,
        sessionStorageAvailable: false,
        verboseLogging: true,
        lifecycle: [
          { at: "invalid ready time", kind: "background_ready" },
          { at: "2026-07-15T08:00:01.000Z", kind: "background_failed" },
          { at: "2026-07-15T08:00:02.000Z", kind: "configuration_reloaded" },
          { at: "2026-07-15T08:00:03.000Z", kind: "extension_installed" },
          {
            at: "2026-07-15T08:00:04.000Z",
            kind: "extension_updated",
            previousVersion: "3.9.0",
          },
          { at: "2026-07-15T08:00:05.000Z", kind: "extension_updated" },
          { at: "2026-07-15T08:00:06.000Z", kind: "failures_cleared" },
        ],
        recentFailures: [],
      }),
    });
    document.querySelector("#diagnostics-extension")?.remove();
    document.querySelector<HTMLDetailsElement>("#diagnostics-details")!.open = true;

    setupDebugLogPanel();

    await vi.waitFor(() =>
      expect(document.querySelector("#diagnostics-background")?.textContent).toBe("Startup failed"),
    );
    expect(document.querySelector("#diagnostics-host")?.textContent).toBe("MV3 event page");
    expect(document.querySelector("#diagnostics-browser")?.textContent).toBe("Firefox");
    expect(document.querySelector("#diagnostics-worker-started")?.textContent).toBe(
      "$TIME$ · up for $UPTIME$",
    );
    expect(document.querySelector("#diagnostics-session-storage")?.textContent).toBe("Unavailable");
    expect(document.querySelector("#diagnostics-verbose")?.textContent).toBe("On");
    expect(document.querySelector("#diagnostics-lifecycle")?.textContent).toContain(
      "Extension updated from $VERSION$.",
    );
    expect(document.querySelector("#diagnostics-lifecycle")?.textContent).toContain(
      "Recent failures cleared.",
    );
  });

  test("copies empty diagnostics and ignores incomplete core rows", async () => {
    const copy = vi.fn<(text: string) => Promise<void>>().mockResolvedValue();
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
      type: MESSAGE_TYPES.DIAGNOSTICS_GET,
      body: snapshot({
        browser: "UNKNOWN",
        browserVersion: 0,
        workerStatus: "starting",
        workerUptimeMs: 500,
        lifecycle: [],
        recentFailures: [],
      }),
    });
    const core = document.querySelector("#diagnostics-core")!;
    core.replaceChildren();
    core.insertAdjacentHTML(
      "beforeend",
      "<div><dt></dt><dd>orphan value</dd></div><div><dt>Orphan label</dt></div>",
    );
    document.querySelector<HTMLDetailsElement>("#diagnostics-details")!.open = true;
    setupDebugLogPanel(copy);
    await vi.waitFor(() => expect(browser.runtime.sendMessage).toHaveBeenCalledOnce());

    document.querySelector<HTMLButtonElement>("#diagnostics-copy")!.click();

    await vi.waitFor(() => expect(copy).toHaveBeenCalledOnce());
    expect(copy.mock.calls[0]?.[0]).toContain("Translated<diagnosticsLifecycleEmpty>");
    expect(copy.mock.calls[0]?.[0]).toContain("Translated<diagnosticsFailuresEmpty>");
    expect(copy.mock.calls[0]?.[0]).not.toContain("orphan");
  });

  test("contains diagnostics when optional output and control nodes are absent", async () => {
    document.body.innerHTML = '<details id="diagnostics-details" open></details>';
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
      type: MESSAGE_TYPES.DIAGNOSTICS_GET,
      body: snapshot(),
    });

    setupDebugLogPanel();

    await vi.waitFor(() => expect(browser.runtime.sendMessage).toHaveBeenCalledOnce());
    await expect(updateDebugLog()).resolves.toEqual(expect.objectContaining({ browser: "CHROME" }));
  });

  test("ignores setup without Diagnostics and rejects a non-record snapshot", async () => {
    document.body.innerHTML = "";
    setupDebugLogPanel();
    expect(browser.runtime.sendMessage).not.toHaveBeenCalled();

    document.body.innerHTML = '<details id="diagnostics-details" open></details>';
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
      type: MESSAGE_TYPES.DIAGNOSTICS_GET,
      body: null,
    });
    await expect(updateDebugLog()).resolves.toBeUndefined();
  });

  test("refreshes explicitly and ignores a stale successful request", async () => {
    let resolveFirst: ((value: unknown) => void) | undefined;
    const first = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    vi.mocked(browser.runtime.sendMessage)
      .mockReturnValueOnce(first as ReturnType<typeof browser.runtime.sendMessage>)
      .mockResolvedValueOnce({
        type: MESSAGE_TYPES.DIAGNOSTICS_GET,
        body: snapshot({ browser: "FIREFOX" }),
      });
    document.querySelector<HTMLDetailsElement>("#diagnostics-details")!.open = true;
    setupDebugLogPanel();
    document.querySelector<HTMLButtonElement>("#debug-log-refresh")!.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#diagnostics-browser")?.textContent).toContain("Firefox"),
    );

    resolveFirst?.({
      type: MESSAGE_TYPES.DIAGNOSTICS_GET,
      body: snapshot({ browser: "CHROME" }),
    });
    await Promise.resolve();

    expect(document.querySelector("#diagnostics-browser")?.textContent).toContain("Firefox");
  });

  test("refreshes an already rendered snapshot from the button", async () => {
    vi.mocked(browser.runtime.sendMessage)
      .mockResolvedValueOnce({ type: MESSAGE_TYPES.DIAGNOSTICS_GET, body: snapshot() })
      .mockResolvedValueOnce({
        type: MESSAGE_TYPES.DIAGNOSTICS_GET,
        body: snapshot({ browser: "FIREFOX" }),
      });
    document.querySelector<HTMLDetailsElement>("#diagnostics-details")!.open = true;
    setupDebugLogPanel();
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLButtonElement>("#debug-log-refresh")?.disabled).toBe(false),
    );

    document.querySelector<HTMLButtonElement>("#debug-log-refresh")!.click();

    await vi.waitFor(() => expect(browser.runtime.sendMessage).toHaveBeenCalledTimes(2));
    expect(document.querySelector("#diagnostics-browser")?.textContent).toContain("Firefox");
  });

  test("ignores a stale rejection after a newer request succeeds", async () => {
    let rejectFirst: ((reason: unknown) => void) | undefined;
    const first = new Promise((_resolve, reject) => {
      rejectFirst = reject;
    });
    vi.mocked(browser.runtime.sendMessage)
      .mockReturnValueOnce(first as ReturnType<typeof browser.runtime.sendMessage>)
      .mockResolvedValueOnce({ type: MESSAGE_TYPES.DIAGNOSTICS_GET, body: snapshot() });
    document.querySelector<HTMLDetailsElement>("#diagnostics-details")!.open = true;
    setupDebugLogPanel();
    document.querySelector<HTMLButtonElement>("#debug-log-refresh")!.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#diagnostics-background")?.textContent).toContain(
        "Translated<diagnosticsWorkerReady>",
      ),
    );

    rejectFirst?.(new Error("late failure"));
    await Promise.resolve();

    expect(document.querySelector("#diagnostics-status")?.classList).not.toContain(
      "feedback-error",
    );
  });

  test("reports copy failures", async () => {
    const copy = vi.fn<(text: string) => Promise<void>>().mockRejectedValue(new Error("denied"));
    vi.mocked(browser.runtime.sendMessage).mockResolvedValueOnce({
      type: MESSAGE_TYPES.DIAGNOSTICS_GET,
      body: snapshot(),
    });
    document.querySelector<HTMLDetailsElement>("#diagnostics-details")!.open = true;
    setupDebugLogPanel(copy);
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLButtonElement>("#diagnostics-copy")?.disabled).toBe(false),
    );
    document.querySelector<HTMLButtonElement>("#diagnostics-copy")!.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#diagnostics-status")?.textContent).toContain(
        "Translated<diagnosticsCopyFailed>",
      ),
    );
  });

  test("skips copying when no snapshot can load", async () => {
    const copy = vi.fn<(text: string) => Promise<void>>().mockResolvedValue();
    vi.mocked(browser.runtime.sendMessage).mockRejectedValue(new Error("offline"));
    const details = document.querySelector<HTMLDetailsElement>("#diagnostics-details")!;
    setupDebugLogPanel(copy);
    details.open = true;
    document
      .querySelector<HTMLButtonElement>("#diagnostics-copy")!
      .dispatchEvent(new MouseEvent("click"));
    await vi.waitFor(() =>
      expect(document.querySelector("#diagnostics-status")?.textContent).toContain(
        "diagnosticsLoadFailed",
      ),
    );
    expect(browser.runtime.sendMessage).toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();
  });

  test("rejects a non-OK clear acknowledgement", async () => {
    vi.mocked(browser.runtime.sendMessage)
      .mockResolvedValueOnce({ type: MESSAGE_TYPES.DIAGNOSTICS_GET, body: snapshot() })
      .mockResolvedValueOnce({ type: MESSAGE_TYPES.DIAGNOSTICS_GET, body: snapshot() });
    document.querySelector<HTMLDetailsElement>("#diagnostics-details")!.open = true;
    setupDebugLogPanel();
    await vi.waitFor(() => expect(browser.runtime.sendMessage).toHaveBeenCalledOnce());

    document.querySelector<HTMLButtonElement>("#debug-log-clear")!.click();

    await vi.waitFor(() =>
      expect(document.querySelector("#diagnostics-status")?.textContent).toContain(
        "Translated<diagnosticsClearFailed>",
      ),
    );
  });
});

describe("variables preview", () => {
  test("does nothing without preview panels", async () => {
    document.body.innerHTML = "";
    await expect(renderVariablesPreview()).resolves.toBeUndefined();
    expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test("falls back to an English variable insertion label", async () => {
    vi.mocked(browser.i18n.getMessage).mockImplementation((key) =>
      key === "referenceInsertValue" ? "" : `Translated<${key}>`,
    );
    document.body.innerHTML = `
      <textarea id="paths"></textarea>
      <section class="variables-preview" data-insert-target="paths">
        <div class="variables-preview-list"></div>
      </section>`;
    vi.mocked(browser.runtime.sendMessage)
      .mockResolvedValueOnce({ body: { variables: [":year:"] } })
      .mockResolvedValueOnce({ body: { interpolatedVariables: {} } });

    await renderVariablesPreview();

    expect(
      document
        .querySelector(
          ".variables-preview-row:not(.variables-preview-command) .variables-preview-insert",
        )
        ?.getAttribute("aria-label"),
    ).toBe("Insert :year:");
  });

  test("closes an open live-variable list when clicking outside", () => {
    document.body.innerHTML = `
      <details class="variables-preview" open>
        <summary>Live variable list</summary>
        <div class="variables-preview-list"></div>
      </details>
      <button id="outside">Outside</button>`;
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({ body: { variables: [] } });

    setupVariablesPreview();
    document.querySelector<HTMLButtonElement>("#outside")!.click();

    expect(document.querySelector<HTMLDetailsElement>(".variables-preview")!.open).toBe(false);
  });

  test("renders only string variables and values and supports insertion", async () => {
    document.body.innerHTML = `
      <textarea id="paths"></textarea>
      <section class="variables-preview" data-insert-target="paths">
        <div class="variables-preview-list"></div>
      </section>
      <section id="options-reference-variables">
        <table><tbody>
          <tr>
            <td><code>:url:</code></td><td>https://example/file.jpg</td>
            <td>Localized source URL description</td>
          </tr>
          <tr><td><code>---</code></td><td>Separator</td><td>Add a menu divider</td></tr>
          <tr>
            <td><code>&gt;submenu</code></td><td>submenu</td>
            <td>Add an item under the folder above to create a submenu</td>
          </tr>
        </tbody></table>
      </section>`;
    vi.mocked(browser.runtime.sendMessage)
      .mockResolvedValueOnce({ body: { variables: [":url:", 7, ":title:"] } })
      .mockResolvedValueOnce({
        body: { interpolatedVariables: { ":url:": "https://x/", ":title:": 9 } },
      });
    const insert = vi.spyOn(PathEditor, "insertAtCursor").mockImplementation(() => {});

    await renderVariablesPreview();
    const rows = [
      ...document.querySelectorAll<HTMLElement>(
        ".variables-preview-row:not(.variables-preview-command)",
      ),
    ];
    expect(
      rows.map((row) => ({
        name: row.querySelector("code")?.textContent,
        value: row.querySelector(".variables-preview-value")?.textContent,
        description: row.querySelector(".variables-preview-description")?.textContent,
      })),
    ).toEqual([
      {
        name: ":title:",
        value: "example",
        description: "Translated<referenceRuntimeVariable>",
      },
      {
        name: ":url:",
        value: "https://x/",
        description: "Localized source URL description",
      },
    ]);
    const buttons = [
      ...document.querySelectorAll<HTMLButtonElement>(
        ".variables-preview-row:not(.variables-preview-command) .variables-preview-insert",
      ),
    ];
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.type).toBe("button");
    expect(buttons[0]!.getAttribute("aria-label")).toBe("Translated<referenceInsertValue>");
    buttons[0]!.click();
    expect(insert).toHaveBeenCalledWith(
      document.querySelector<HTMLTextAreaElement>("#paths"),
      ":title:",
    );
    expect(
      [...document.querySelectorAll<HTMLElement>(".variables-preview-command")].map((row) => ({
        syntax: row.querySelector("code")?.textContent,
        label: row.querySelector(".variables-preview-command-label")?.textContent,
        description: row.querySelector(".variables-preview-description")?.textContent,
        insertable: row.classList.contains("insertable"),
      })),
    ).toEqual([
      {
        syntax: "---",
        label: "Translated<o_bAddSeparator>",
        description: "Add a menu divider",
        insertable: true,
      },
      {
        syntax: ">submenu",
        label: "Translated<html_createASubmenu>",
        description: "Add an item under the folder above to create a submenu",
        insertable: true,
      },
    ]);
    expect(
      [...document.querySelectorAll<HTMLElement>(".variables-preview-group")].map(
        (row) => row.textContent,
      ),
    ).toEqual(["Page context", "Source URL"]);

    const filter = document.querySelector<HTMLInputElement>(".variables-preview-filter")!;
    expect(filter.name).toBe("variable-filter");
    expect(filter.placeholder).toBe("Translated<html_filterVariables>");
    expect(filter.getAttribute("aria-label")).toBe("Translated<html_filterVariables>");
    filter.value = "title";
    filter.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(rows[0]!.hidden).toBe(false);
    expect(rows[1]!.hidden).toBe(true);

    expect(document.querySelector(".variables-preview-structures")).toBeNull();
    const insertLine = vi.spyOn(PathEditor, "insertLine").mockImplementation(() => {});
    const commandButtons = [
      ...document.querySelectorAll<HTMLButtonElement>(".variables-preview-command button"),
    ];
    commandButtons[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(insertLine).toHaveBeenCalledWith(
      document.querySelector<HTMLTextAreaElement>("#paths"),
      "---",
    );
    commandButtons[1]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(insertLine).toHaveBeenCalledWith(
      document.querySelector<HTMLTextAreaElement>("#paths"),
      ">submenu",
    );
  });

  test("inserts variables into the focused visual folder instead of the hidden textarea", async () => {
    document.body.innerHTML = `
      <textarea id="paths">images</textarea>
      <div id="paths-visual">
        <input class="path-editor-dir" value="images">
      </div>
      <section class="variables-preview" data-insert-target="paths">
        <div class="variables-preview-list"></div>
      </section>`;
    vi.mocked(browser.runtime.sendMessage)
      .mockResolvedValueOnce({ body: { variables: [":year:"] } })
      .mockResolvedValueOnce({ body: { interpolatedVariables: {} } });
    const insert = vi.spyOn(PathEditor, "insertAtCursor").mockImplementation(() => {});

    await renderVariablesPreview();
    const folder = document.querySelector<HTMLInputElement>(".path-editor-dir")!;
    folder.focus();
    document
      .querySelector<HTMLButtonElement>(
        ".variables-preview-insert:not([data-path-command]):not(:disabled)",
      )!
      .click();

    expect(insert).toHaveBeenCalledWith(folder, ":year:");
    expect(insert).not.toHaveBeenCalledWith(
      document.querySelector<HTMLTextAreaElement>("#paths"),
      ":year:",
    );
  });

  test("disables visual insertion until a folder field has been focused", async () => {
    document.body.innerHTML = `
      <textarea id="paths">images</textarea>
      <div id="paths-visual"><input class="path-editor-dir" value="images"></div>
      <section class="variables-preview" data-insert-target="paths">
        <div class="variables-preview-list"></div>
      </section>`;
    vi.mocked(browser.runtime.sendMessage)
      .mockResolvedValueOnce({ body: { variables: [":year:"] } })
      .mockResolvedValueOnce({ body: { interpolatedVariables: {} } });

    await renderVariablesPreview();

    expect(
      document.querySelector<HTMLButtonElement>(
        ".variables-preview-insert:not([data-path-command])",
      )!.disabled,
    ).toBe(true);
    expect(
      [...document.querySelectorAll<HTMLButtonElement>("[data-path-command]")].every(
        (button) => !button.disabled,
      ),
    ).toBe(true);
  });

  test("tracks text-mode focus and clears a removed visual target", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <textarea id="paths"></textarea>
      <button id="paths-mode-text"></button>
      <button id="paths-mode-visual"></button>
      <div id="paths-visual"><input class="path-editor-dir"></div>
      <section class="variables-preview" data-insert-target="paths">
        <div class="variables-preview-list"></div>
      </section>`;
    vi.mocked(browser.runtime.sendMessage)
      .mockResolvedValueOnce({ body: { variables: [":year:"] } })
      .mockResolvedValueOnce({ body: { interpolatedVariables: {} } });

    await renderVariablesPreview();
    expect(document.querySelector<HTMLElement>("#paths-visual")!.hidden).toBe(false);
    const insertLine = vi.spyOn(PathEditor, "insertLine").mockImplementation(() => {});
    document
      .querySelector<HTMLButtonElement>(".variables-preview-command button")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(insertLine).toHaveBeenCalledWith(
      document.querySelector<HTMLTextAreaElement>("#paths"),
      "---",
    );
    const folder = document.querySelector<HTMLInputElement>(".path-editor-dir")!;
    folder.focus();
    document.dispatchEvent(new Event("visual-editor-rendered"));
    folder.remove();
    document.dispatchEvent(new Event("visual-editor-rendered"));
    expect(
      document.querySelector<HTMLButtonElement>(
        ".variables-preview-insert:not([data-path-command])",
      )!.disabled,
    ).toBe(true);
    document
      .querySelector<HTMLButtonElement>(".variables-preview-insert:not([data-path-command])")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    document.querySelector<HTMLTextAreaElement>("#paths")!.focus();
    document.querySelector<HTMLButtonElement>("#paths-mode-text")!.click();
    vi.runAllTimers();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  test("shows known variables with blank values before a save", async () => {
    document.body.innerHTML =
      '<section class="variables-preview"><div class="variables-preview-list"></div></section>';
    vi.mocked(browser.runtime.sendMessage)
      .mockResolvedValueOnce({ body: { variables: [":url:", ":title:"] } })
      .mockResolvedValueOnce({ body: { interpolatedVariables: { ":url:": false } } });
    await renderVariablesPreview();
    expect(document.querySelector(".variables-preview-empty")).toBeNull();
    const values = [...document.querySelectorAll<HTMLElement>(".variables-preview-value")];
    expect(values.map((value) => value.textContent)).toEqual([
      "example",
      "https://example.com/file.jpg",
    ]);
    expect(values.every((value) => value.title.startsWith("Example —"))).toBe(true);
  });

  test("labels unresolved network-derived variables as lazy", async () => {
    document.body.innerHTML =
      '<section class="variables-preview"><div class="variables-preview-list"></div></section>';
    vi.mocked(browser.runtime.sendMessage)
      .mockResolvedValueOnce({ body: { variables: [":sha256:", ":mime:", ":filename:"] } })
      .mockResolvedValueOnce({ body: { interpolatedVariables: {} } });

    await renderVariablesPreview();

    const rows = [...document.querySelectorAll<HTMLElement>(".variables-preview-row")];
    expect(rows.find((row) => row.textContent?.includes(":sha256:"))?.textContent).toContain(
      "(lazy)",
    );
    expect(rows.find((row) => row.textContent?.includes(":mime:"))?.textContent).toContain(
      "(lazy)",
    );
    expect(rows.find((row) => row.textContent?.includes(":filename:"))?.textContent).toContain(
      "photo.jpg",
    );
  });

  test("contains unavailable route values and panels without a list container", async () => {
    document.body.innerHTML = '<section class="variables-preview"></section>';
    vi.mocked(browser.runtime.sendMessage)
      .mockResolvedValueOnce({ body: {} })
      .mockRejectedValueOnce(new Error("worker restarting"));

    await expect(renderVariablesPreview()).resolves.toBeUndefined();
    expect(document.querySelector(".variables-preview-filter")).toBeNull();
  });

  test("supports filter keyboard dismissal and inserts the first visible result", async () => {
    document.body.innerHTML = `
      <textarea id="paths"></textarea>
      <details class="variables-preview" data-insert-target="paths" open>
        <summary>Variables</summary>
        <div class="variables-preview-list"></div>
      </details>`;
    vi.mocked(browser.runtime.sendMessage)
      .mockResolvedValueOnce({ body: { variables: [":url:"] } })
      .mockResolvedValueOnce({ body: { interpolatedVariables: {} } });
    const insertLine = vi.spyOn(PathEditor, "insertLine").mockImplementation(() => {});
    await renderVariablesPreview();
    const panel = document.querySelector<HTMLElement>(".variables-preview")!;
    const filter = document.querySelector<HTMLInputElement>(".variables-preview-filter")!;

    filter.focus();
    filter.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(panel.hasAttribute("open")).toBe(false);
    expect(document.activeElement).toBe(panel.querySelector("summary"));
    filter.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    filter.value = "no match";
    filter.dispatchEvent(new InputEvent("input", { bubbles: true }));
    filter.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(insertLine).not.toHaveBeenCalled();

    filter.value = "";
    filter.dispatchEvent(new InputEvent("input", { bubbles: true }));
    filter.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(insertLine).toHaveBeenCalledWith(
      document.querySelector<HTMLTextAreaElement>("#paths"),
      "---",
    );
  });

  test("uses path-command fallbacks and dismisses a non-disclosure preview", async () => {
    vi.mocked(browser.i18n.getMessage).mockReturnValue("");
    document.body.innerHTML = `
      <textarea id="paths"></textarea>
      <section class="variables-preview" data-insert-target="paths" open>
        <div class="variables-preview-list"></div>
      </section>`;
    vi.mocked(browser.runtime.sendMessage)
      .mockResolvedValueOnce({ body: { variables: [] } })
      .mockResolvedValueOnce({ body: { interpolatedVariables: {} } });
    await renderVariablesPreview();
    const commands = [...document.querySelectorAll<HTMLElement>(".variables-preview-command")];
    expect(commands.map(({ textContent }) => textContent)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Separator"),
        expect.stringContaining("Create a submenu"),
      ]),
    );
    const panel = document.querySelector<HTMLElement>(".variables-preview")!;
    panel.setAttribute("open", "");
    document
      .querySelector<HTMLInputElement>(".variables-preview-filter")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(panel.hasAttribute("open")).toBe(false);
  });
});

describe("reset options", () => {
  test("removes only schema options, preserving history and other extension data", async () => {
    document.body.innerHTML =
      '<button id="reset"></button><div id="settings-reset-status"></div><span id="lastSavedAt"></span>';
    vi.mocked(browser.storage.local.remove).mockResolvedValue();
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({ type: "OK" });
    const restoreOptions = vi.fn();
    const updateErrors = vi.fn();
    setupResetOptions({
      restoreOptions,
      updateErrors,
      getOptionNames: () => Promise.resolve(["paths", "prompt"]),
      localize: () => "",
    });

    document.querySelector<HTMLButtonElement>("#reset")!.click();
    document.querySelector<HTMLButtonElement>(".reset-settings-confirm")!.click();
    await vi.waitFor(() =>
      expect(browser.storage.local.remove).toHaveBeenCalledWith(["paths", "prompt"]),
    );
    expect(browser.storage.local.clear).not.toHaveBeenCalled();
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: "OPTIONS_LOADED" });
    expect(restoreOptions).toHaveBeenCalled();
    expect(updateErrors).toHaveBeenCalled();
    const status = document.querySelector<HTMLElement>("#settings-reset-status")!;
    expect(status.textContent).toBe("Default settings restored.");
    expect(status.classList).toContain("feedback-success");
    expect(status.getAttribute("role")).toBe("status");
  });

  test("does nothing when confirmation is declined", async () => {
    document.body.innerHTML = '<button id="reset"></button>';
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: vi.fn(function (this: HTMLDialogElement) {
        this.setAttribute("open", "");
      }),
    });
    setupResetOptions({
      restoreOptions: vi.fn(),
      updateErrors: vi.fn(),
      getOptionNames: () => Promise.resolve(["paths"]),
      localize: () => "",
    });
    document.querySelector<HTMLButtonElement>("#reset")!.click();
    let dialog = document.querySelector<HTMLDialogElement>(".reset-settings-dialog")!;
    expect(dialog.getAttribute("aria-describedby")).toBe("reset-settings-description");
    dialog.querySelector<HTMLButtonElement>("button")!.click();
    await Promise.resolve();
    expect(browser.storage.local.clear).not.toHaveBeenCalled();
    expect(document.querySelector(".reset-settings-dialog")).toBeNull();

    Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    document.querySelector<HTMLButtonElement>("#reset")!.click();
    dialog = document.querySelector<HTMLDialogElement>(".reset-settings-dialog")!;
    expect(dialog.open).toBe(true);
    const cancel = new Event("cancel", { cancelable: true });
    dialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    await Promise.resolve();

    document.querySelector<HTMLButtonElement>("#reset")!.click();
    document.querySelector<HTMLButtonElement>(".reset-settings-confirm")!.click();
    await vi.waitFor(() => expect(browser.storage.local.remove).toHaveBeenCalledWith(["paths"]));
  });

  test("reports a reset failure without restoring stale controls", async () => {
    document.body.innerHTML = '<button id="reset"></button><div id="settings-reset-status"></div>';
    vi.mocked(browser.storage.local.remove).mockRejectedValueOnce(new Error("storage denied"));
    const restoreOptions = vi.fn();
    setupResetOptions({
      restoreOptions,
      updateErrors: vi.fn(),
      getOptionNames: () => Promise.resolve(["paths"]),
      localize: () => "",
    });

    document.querySelector<HTMLButtonElement>("#reset")!.click();
    document.querySelector<HTMLButtonElement>(".reset-settings-confirm")!.click();

    await vi.waitFor(() =>
      expect(document.querySelector("#settings-reset-status")?.textContent).toBe(
        "Could not restore default settings.",
      ),
    );
    expect(document.querySelector("#settings-reset-status")?.classList).toContain("feedback-error");
    expect(restoreOptions).not.toHaveBeenCalled();
  });
});
