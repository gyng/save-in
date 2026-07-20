import {
  createE2EControlClient,
  createRecoveringControlTransport,
  controlRetryMode,
  dispatchControlRequest,
} from "../e2e/control-client.mjs";
import { createControlPageDispatcher } from "../e2e/control-page-runtime.mjs";
import {
  CONTROL_FUNCTION,
  CONTROL_PAGE_PATH,
  CONTROL_READY_EXPRESSION,
} from "../e2e/control-target.mjs";
import { arrayOf, decodeNumber, decodeString, evaluateJson, objectOf } from "../e2e/helpers.mjs";

describe("structured E2E control client", () => {
  test("uses a dedicated preloaded control page instead of serializing the dispatcher", () => {
    expect(CONTROL_PAGE_PATH).toBe("test/e2e/control.html");
    expect(CONTROL_FUNCTION).toContain("__saveInE2EControl");
    expect(CONTROL_FUNCTION).not.toContain(dispatchControlRequest.toString());
    expect(CONTROL_READY_EXPRESSION).toContain("__saveInE2EControl");
  });

  test("passes data as arguments instead of interpolating executable expressions", async () => {
    const calls: Array<{ declaration: string; args: unknown[] | undefined }> = [];
    const callFunction = vi.fn(async (declaration: string, args?: unknown[]) => {
      calls.push({ declaration, args });
      return JSON.stringify({ ok: true, value: true });
    });
    const client = createE2EControlClient({ callFunction });
    const value = 'folder/"quoted"/${notExecutable}';

    await client.storage.local.set({ paths: value });

    expect(callFunction).toHaveBeenCalledOnce();
    expect(calls[0]?.declaration).not.toContain(value);
    expect(calls[0]?.args).toEqual([
      {
        requestId: expect.stringMatching(/^[0-9a-f-]+:1$/),
        retryMode: "idempotent",
        request: { operation: "storage.set", area: "local", values: { paths: value } },
      },
    ]);
    expect(client.metrics()).toEqual({ structuredCalls: 1 });
  });

  test("reports browser-side operation failures with their original message", async () => {
    const client = createE2EControlClient({
      callFunction: async () =>
        JSON.stringify({
          ok: false,
          error: { message: "downloads API unavailable", stack: "remote stack" },
        }),
    });

    await expect(client.downloads.search()).rejects.toThrow("downloads API unavailable");
  });

  test("uses production runtime messages for option changes", async () => {
    const requests: unknown[] = [];
    const client = createE2EControlClient({
      callFunction: async (_declaration, args) => {
        const request = (args?.[0] as { request?: { operation?: string } } | undefined)?.request;
        requests.push(request);
        return JSON.stringify({
          ok: true,
          value:
            request?.operation === "storage.set"
              ? true
              : { type: "OK", body: { instanceId: "background-1", generation: 1 } },
        });
      },
    });

    await client.options.set({ promptOnShift: true });

    expect(requests).toEqual([
      {
        operation: "storage.set",
        area: "local",
        values: { promptOnShift: true },
      },
      {
        operation: "runtime.send",
        message: { type: "OPTIONS_LOADED" },
      },
    ]);
  });

  test("tracks reset generations within each background instance", async () => {
    const acknowledgements = [
      { type: "OK", body: { instanceId: "worker-a", generation: 4 } },
      { type: "OK", body: { instanceId: "worker-a", generation: 4 } },
      { type: "OK", body: { instanceId: "worker-b", generation: 1 } },
    ];
    const client = createE2EControlClient({
      callFunction: async () => JSON.stringify({ ok: true, value: acknowledgements.shift() }),
    });

    await expect(client.runtime.reset()).resolves.toMatchObject({
      body: { instanceId: "worker-a", generation: 4 },
    });
    await expect(client.runtime.reset()).rejects.toThrow("Stale background generation 4");
    await expect(client.runtime.reset()).resolves.toMatchObject({
      body: { instanceId: "worker-b", generation: 1 },
    });
  });

  test("keeps configured setup and a one-shot command in one control request", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const client = createE2EControlClient({
      callFunction: async (_declaration, args) => {
        const request = (args?.[0] as { request?: Record<string, unknown> } | undefined)?.request;
        if (!request) throw new Error("missing request");
        requests.push(request);
        return JSON.stringify({
          ok: true,
          value: {
            type: "SAVE_IN_E2E_START_DOWNLOAD",
            body: { status: "OK", result: { status: "skipped" } },
          },
        });
      },
    });

    await expect(
      client.background.startDownloadConfigured(
        { content: "pdf", suggestedFilename: "report.pdf" },
        { filenamePatterns: "mime: pdf" },
      ),
    ).resolves.toEqual({ status: "skipped" });
    expect(requests).toEqual([
      {
        operation: "runtime.send",
        message: {
          type: "SAVE_IN_E2E_START_DOWNLOAD",
          body: {
            content: "pdf",
            suggestedFilename: "report.pdf",
            config: { filenamePatterns: "mime: pdf" },
          },
        },
      },
    ]);
  });

  test("sends event-driven wait criteria through the structured protocol", async () => {
    const requests: unknown[] = [];
    const client = createE2EControlClient({
      callFunction: async (_declaration, args) => {
        const request = (args?.[0] as { request?: { operation?: string } } | undefined)?.request;
        requests.push(request);
        return JSON.stringify({
          ok: true,
          value:
            request?.operation === "storage.waitString"
              ? "mime: ^application/pdf$\ninto: documents/:filename:"
              : request?.operation === "runtime.send"
                ? {
                    type: "SAVE_IN_E2E_NOTIFICATION_CALLS",
                    body: { status: "OK", calls: [{ id: "7", message: "saved" }] },
                  }
                : [],
        });
      },
    });

    await client.downloads.wait({ filenameIncludes: "automatic", minimumComplete: 2 });
    await client.history.wait({ status: "complete", context: "browser" });
    await expect(
      client.storage.local.waitString("filenamePatterns", "application/pdf"),
    ).resolves.toContain("documents/:filename:");
    await expect(client.background.waitForNotification("7")).resolves.toMatchObject({ id: "7" });

    expect(requests).toEqual([
      { operation: "downloads.wait", filenameIncludes: "automatic", minimumComplete: 2 },
      { operation: "history.wait", status: "complete", context: "browser" },
      {
        operation: "storage.waitString",
        area: "local",
        key: "filenamePatterns",
        includes: "application/pdf",
      },
      {
        operation: "runtime.send",
        message: {
          type: "SAVE_IN_E2E_NOTIFICATION_CALLS",
          body: { action: "wait", id: "7" },
        },
      },
    ]);
  });

  test("turns a notification wait timeout into a caller-visible failure", async () => {
    const client = createE2EControlClient({
      callFunction: async () =>
        JSON.stringify({
          ok: true,
          value: {
            type: "SAVE_IN_E2E_NOTIFICATION_CALLS",
            body: { status: "ERROR", message: "Timed out waiting for notification 7" },
          },
        }),
    });

    await expect(client.background.waitForNotification("7")).rejects.toThrow(
      "Timed out waiting for notification 7",
    );
  });

  test("restores a missing control page before retrying discovery", async () => {
    const missing = new Error('No target matching "options.html"');
    Object.assign(missing, { code: "E2E_CONTROL_TARGET_MISSING" });
    const callFunction = vi.fn().mockRejectedValueOnce(missing).mockResolvedValueOnce("ready");
    const recover = vi.fn(async () => undefined);
    const call = createRecoveringControlTransport({ callFunction, recover });

    await expect(call("function () {}", [{ id: 1 }])).resolves.toBe("ready");
    expect(recover).toHaveBeenCalledOnce();
    expect(callFunction).toHaveBeenCalledTimes(2);
  });

  test("does not retry an ambiguous transport failure", async () => {
    const failure = new Error("CDP timeout: Runtime.callFunctionOn");
    const callFunction = vi.fn().mockRejectedValue(failure);
    const recover = vi.fn(async () => undefined);
    const call = createRecoveringControlTransport({ callFunction, recover });

    await expect(call("function () {}", [])).rejects.toBe(failure);
    expect(recover).not.toHaveBeenCalled();
    expect(callFunction).toHaveBeenCalledOnce();
  });

  test("retries reads after an ambiguous transport failure", async () => {
    const callFunction = vi
      .fn()
      .mockRejectedValueOnce(new Error("reply lost"))
      .mockResolvedValueOnce("ready");
    const recover = vi.fn(async () => undefined);
    const call = createRecoveringControlTransport({ callFunction, recover });

    await expect(call("function () {}", [], 100, "read")).resolves.toBe("ready");
    expect(recover).toHaveBeenCalledOnce();
    expect(callFunction).toHaveBeenCalledTimes(2);
  });

  test("never recreates a one-shot request cache after an ambiguous replay failure", async () => {
    const firstFailure = new Error("reply lost");
    const secondFailure = Object.assign(new Error("realm disappeared"), {
      code: "E2E_CONTROL_TARGET_MISSING",
    });
    const callFunction = vi
      .fn()
      .mockRejectedValueOnce(firstFailure)
      .mockRejectedValueOnce(secondFailure);
    const recover = vi.fn(async () => undefined);
    const call = createRecoveringControlTransport({
      callFunction,
      recover,
      canRetryOneShot: async (error) => error === firstFailure,
    });

    await expect(call("function () {}", [], 100, "one-shot")).rejects.toBe(secondFailure);
    expect(recover).not.toHaveBeenCalled();
    expect(callFunction).toHaveBeenCalledTimes(2);
  });

  test("deduplicates a repeated one-shot request in the control page realm", async () => {
    let finish!: (value: string) => void;
    const operation = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const dispatch = createControlPageDispatcher(operation);
    const envelope = JSON.stringify({
      requestId: "download-7",
      retryMode: "one-shot",
      request: { operation: "runtime.download", content: "one" },
    });

    const first = dispatch(envelope);
    const repeated = dispatch(envelope);
    finish("done");

    await expect(Promise.all([first, repeated])).resolves.toEqual(["done", "done"]);
    expect(operation).toHaveBeenCalledOnce();
  });

  test("releases settled safe operations and bounds one-shot deduplication", async () => {
    const operation = vi.fn(async (request: string) => request);
    const dispatch = createControlPageDispatcher(operation, { maxOneShotResults: 1 });
    const envelope = (requestId: string, retryMode: "read" | "one-shot") =>
      JSON.stringify({ requestId, retryMode, request: { operation: "inspect" } });

    await dispatch(envelope("read-1", "read"));
    await dispatch(envelope("read-1", "read"));
    await dispatch(envelope("write-1", "one-shot"));
    await dispatch(envelope("write-2", "one-shot"));
    await dispatch(envelope("write-1", "one-shot"));

    expect(operation).toHaveBeenCalledTimes(5);
  });

  test("classifies retry safety at the operation boundary", () => {
    expect(controlRetryMode({ operation: "downloads.search", query: {} })).toBe("read");
    expect(
      controlRetryMode({ operation: "storage.set", area: "local", values: { enabled: true } }),
    ).toBe("idempotent");
    expect(controlRetryMode({ operation: "tabs.create", properties: { url: "about:blank" } })).toBe(
      "one-shot",
    );
    expect(
      controlRetryMode({
        operation: "runtime.send",
        message: { type: "SAVE_IN_E2E_NOTIFICATION_CALLS", body: { action: "wait", id: "7" } },
      }),
    ).toBe("read");
    expect(
      controlRetryMode({
        operation: "runtime.send",
        message: { type: "SAVE_IN_E2E_NOTIFICATION_CALLS", body: { action: "reset" } },
      }),
    ).toBe("idempotent");
    expect(
      controlRetryMode({
        operation: "runtime.send",
        message: {
          type: "SAVE_IN_E2E_START_DOWNLOAD",
          body: {
            content: "pdf",
            suggestedFilename: "report.pdf",
            config: { filenamePatterns: "mime: pdf" },
          },
        },
      }),
    ).toBe("one-shot");
  });

  test("latches a failed control-page recreation for the rest of the suite", async () => {
    const missing = Object.assign(new Error("missing"), { code: "E2E_CONTROL_TARGET_MISSING" });
    const callFunction = vi.fn().mockRejectedValue(missing);
    const recover = vi.fn().mockRejectedValue(new Error("tab creation failed"));
    const call = createRecoveringControlTransport({ callFunction, recover });

    await expect(call("function () {}", [])).rejects.toThrow(
      "E2E control plane could not be recreated",
    );
    await expect(call("function () {}", [])).rejects.toThrow(
      "E2E control plane could not be recreated",
    );
    expect(callFunction).toHaveBeenCalledOnce();
    expect(recover).toHaveBeenCalledOnce();
  });

  test("does not infer a missing control page from browser-thrown error text", async () => {
    const failure = new Error('No target matching "options.html"');
    const callFunction = vi.fn().mockRejectedValue(failure);
    const recover = vi.fn(async () => undefined);
    const call = createRecoveringControlTransport({ callFunction, recover });

    await expect(call("function () {}", [])).rejects.toBe(failure);
    expect(recover).not.toHaveBeenCalled();
  });

  test("surfaces background menu command failures immediately", async () => {
    const client = createE2EControlClient({
      callFunction: async () =>
        JSON.stringify({
          ok: true,
          value: {
            type: "SAVE_IN_E2E_CONTEXT_MENU_CLICK",
            body: { status: "ERROR", message: "menu dispatch failed" },
          },
        }),
    });

    await expect(
      client.background.clickContextMenu({ info: { menuItemId: "save-in-0" }, tab: {} }),
    ).rejects.toThrow("menu dispatch failed");
  });

  test("rejects malformed operation results at the protocol boundary", async () => {
    const client = createE2EControlClient({
      callFunction: async () =>
        JSON.stringify({
          ok: true,
          value: [{ id: "not-a-number", state: "complete", filename: "bad.txt", url: "data:" }],
        }),
    });

    await expect(client.downloads.search()).rejects.toThrow("Invalid E2E downloads.search result");
  });

  test("rejects malformed typed runtime payloads", async () => {
    const values = [
      { type: "OPTIONS", body: { paths: 42 } },
      { type: "HISTORY_GET", body: { entries: [{ status: 500 }] } },
    ];
    const client = createE2EControlClient({
      callFunction: async () => JSON.stringify({ ok: true, value: values.shift() }),
    });

    await expect(client.options.get("paths")).rejects.toThrow("Invalid E2E option value for paths");
    await expect(client.history.get()).rejects.toThrow("invalid runtime.send result");
  });

  test("rejects malformed successful command responses before callers use them", async () => {
    const client = createE2EControlClient({
      callFunction: async () =>
        JSON.stringify({
          ok: true,
          value: {
            type: "SAVE_IN_E2E_START_DOWNLOAD",
            body: { status: "OK", result: { status: "started", downloadId: "7" } },
          },
        }),
    });

    await expect(
      client.background.startDownload({ content: "x", suggestedFilename: "x.txt" }),
    ).rejects.toThrow("invalid runtime.send result");
  });

  test("decodes string-valued runtime options without treating them as booleans", async () => {
    const values = [
      { type: "OPTIONS", body: { setRefererHeaderFilter: "https://example.com/*" } },
      { type: "OPTIONS", body: { shortcutType: "MAC_WEBLOC" } },
      { type: "OPTIONS", body: { shortcutType: "UNKNOWN" } },
    ];
    const client = createE2EControlClient({
      callFunction: async () => JSON.stringify({ ok: true, value: values.shift() }),
    });

    await expect(client.options.get("setRefererHeaderFilter")).resolves.toBe(
      "https://example.com/*",
    );
    await expect(client.options.get("shortcutType")).resolves.toBe("MAC_WEBLOC");
    await expect(client.options.get("shortcutType")).rejects.toThrow(
      "Invalid E2E option value for shortcutType",
    );
  });

  test("rejects malformed requests before touching browser APIs", async () => {
    await expect(
      dispatchControlRequest(JSON.stringify({ operation: "downloads.cancel", id: "7" })),
    ).rejects.toThrow("Invalid E2E control request");
    await expect(
      dispatchControlRequest(
        JSON.stringify({ operation: "runtime.send", message: { type: "UNKNOWN_COMMAND" } }),
      ),
    ).rejects.toThrow("Invalid E2E control request");
    await expect(
      dispatchControlRequest(
        JSON.stringify({
          operation: "downloads.wait",
          filenameIncludes: "x",
          minimumComplete: 0,
        }),
      ),
    ).rejects.toThrow("Invalid E2E control request");
    await expect(
      dispatchControlRequest(
        JSON.stringify({
          operation: "downloads.wait",
          filenameIncludes: "x",
          url: "https://example.test/x",
        }),
      ),
    ).rejects.toThrow("Invalid E2E control request");
    await expect(
      dispatchControlRequest(JSON.stringify({ operation: "downloads.wait", timeoutMs: 1000 })),
    ).rejects.toThrow("Invalid E2E control request");
    await expect(
      dispatchControlRequest(JSON.stringify({ operation: "downloads.wait", filenameIncludes: "" })),
    ).rejects.toThrow("Invalid E2E control request");
    await expect(
      dispatchControlRequest(
        JSON.stringify({ operation: "logs.wait", messages: [], timeoutMs: 1000 }),
      ),
    ).rejects.toThrow("Invalid E2E control request");
    await expect(
      dispatchControlRequest(JSON.stringify({ operation: "tabs.wait", id: 7, timeoutMs: -1 })),
    ).rejects.toThrow("Invalid E2E control request");
    await expect(
      dispatchControlRequest(JSON.stringify({ operation: "tabs.wait", urlIncludes: "" })),
    ).rejects.toThrow("Invalid E2E control request");
    await expect(
      dispatchControlRequest(
        JSON.stringify({ operation: "storage.wait", area: "local", key: "x", timeoutMs: 0 }),
      ),
    ).rejects.toThrow("Invalid E2E control request");
    await expect(
      dispatchControlRequest(
        JSON.stringify({ operation: "history.wait", status: "complete", minimum: -1 }),
      ),
    ).rejects.toThrow("Invalid E2E control request");
    await expect(
      dispatchControlRequest(JSON.stringify({ operation: "history.wait", timeoutMs: 1000 })),
    ).rejects.toThrow("Invalid E2E control request");
    await expect(
      dispatchControlRequest(
        JSON.stringify({ operation: "history.wait", status: "complete", timeoutMs: 300_001 }),
      ),
    ).rejects.toThrow("Invalid E2E control request");
    await expect(
      dispatchControlRequest(
        JSON.stringify({
          operation: "runtime.send",
          message: {
            type: "SAVE_IN_E2E_NOTIFICATION_CALLS",
            body: { action: "wait", id: "7", timeoutMs: 0 },
          },
        }),
      ),
    ).rejects.toThrow("Invalid E2E control request");
  });

  test("resets and verifies browser and worker state during case cleanup", async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === "SAVE_IN_E2E_RESET_STATE") {
        return { type: "SAVE_IN_E2E_RESET_STATE", body: { status: "OK" } };
      }
      return { type: "OK" };
    });
    const host = {
      runtime: {
        getURL: (path: string) => `chrome-extension://id/${path}`,
        sendMessage,
      },
      tabs: {
        getCurrent: vi.fn(async () => ({ id: 1 })),
        query: vi.fn(async () => [
          { id: 1, url: "chrome-extension://id/src/options/options.html" },
        ]),
        remove: vi.fn(async () => undefined),
      },
      downloads: {
        search: vi.fn(async () => []),
        cancel: vi.fn(async () => undefined),
        erase: vi.fn(async () => []),
      },
      notifications: {
        getAll: vi.fn(async () => ({})),
        clear: vi.fn(async () => true),
      },
      declarativeNetRequest: {
        getSessionRules: vi.fn(async () => []),
        updateSessionRules: vi.fn(async () => undefined),
      },
      storage: {
        local: {
          clear: vi.fn(async () => undefined),
          set: vi.fn(async () => undefined),
        },
        session: {
          clear: vi.fn(async () => undefined),
          get: vi.fn(async () => ({ siDiagnosticLifecycle: [] })),
        },
      },
    };
    vi.stubGlobal("chrome", host);
    vi.stubGlobal("browser", host);

    try {
      const response = await dispatchControlRequest(
        JSON.stringify({ operation: "harness.resetCase" }),
      );

      expect(JSON.parse(response)).toEqual({ ok: true, value: true });
      expect(sendMessage).toHaveBeenCalledWith({
        type: "SAVE_IN_E2E_RESET_STATE",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("decodes raw structured evaluation results without leaking any", async () => {
    const decode = objectOf({ name: decodeString, ids: arrayOf(decodeNumber) });

    await expect(
      evaluateJson(async () => '{"name":"tab","ids":[1,2]}', "ignored", decode),
    ).resolves.toEqual({ name: "tab", ids: [1, 2] });
    await expect(
      evaluateJson(async () => '{"name":"tab","ids":["1"]}', "ignored", decode),
    ).rejects.toThrow("Expected an E2E number");
  });
});
