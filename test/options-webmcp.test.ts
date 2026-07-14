// @vitest-environment jsdom
// EXPERIMENTAL WebMCP adapter: tool definitions + auto-registration guard

import { SaveInWebMCP } from "../src/options/webmcp.ts";

type SaveInTool = ReturnType<typeof SaveInWebMCP.buildTools>[number];
type SaveInToolName =
  | "save_in_apply_config"
  | "save_in_download"
  | "save_in_get_config"
  | "save_in_get_grammars"
  | "save_in_get_schema"
  | "save_in_list_vocabulary"
  | "save_in_validate_config";

describe("buildTools", () => {
  const toolsByName = () => {
    const send = vi.fn((m) => Promise.resolve({ ok: m.type }));
    const tools = SaveInWebMCP.buildTools(send);
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool])) as Record<
      SaveInToolName,
      SaveInTool
    >;
    return { send, byName };
  };

  test("defines the save-in tools with input schemas", () => {
    const { byName } = toolsByName();
    expect(Object.keys(byName).toSorted()).toEqual([
      "save_in_apply_config",
      "save_in_download",
      "save_in_get_config",
      "save_in_get_grammars",
      "save_in_get_schema",
      "save_in_list_vocabulary",
      "save_in_validate_config",
    ]);
    for (const tool of Object.values(byName)) {
      expect(typeof tool.description).toBe("string");
      expect(tool.inputSchema.type).toBe("object");
      expect(typeof tool.execute).toBe("function");
      expect(typeof tool.annotations?.readOnlyHint).toBe("boolean");
      expect(typeof tool.annotations?.untrustedContentHint).toBe("boolean");
    }
    expect(byName.save_in_download.inputSchema.required).toEqual(["url"]);
    expect(byName.save_in_download.inputSchema.additionalProperties).toBe(false);
    expect(byName.save_in_apply_config.annotations?.readOnlyHint).toBe(false);
    expect(byName.save_in_apply_config.annotations?.untrustedContentHint).toBe(true);
    expect(byName.save_in_get_config.annotations).toEqual({
      readOnlyHint: true,
      untrustedContentHint: true,
    });
    expect(byName.save_in_validate_config.annotations?.readOnlyHint).toBe(true);
    const validationInfo = byName.save_in_validate_config.inputSchema.properties.info as {
      description: string;
      properties: Record<string, unknown>;
    };
    expect(validationInfo.description).toContain("srcUrl");
    expect(validationInfo.properties).toHaveProperty("srcUrl");
    expect(validationInfo.properties).toHaveProperty("url");
    expect(validationInfo.properties).toHaveProperty("mediaType");
    expect(validationInfo.properties).toHaveProperty("context");
    expect(validationInfo.properties).toHaveProperty("menuIndex");
    expect(validationInfo.properties).toHaveProperty("resolvedFilename");
    expect(validationInfo.properties).toHaveProperty("sourceKind");
    expect(validationInfo.properties).toHaveProperty("counter");
    expect(validationInfo.properties).toHaveProperty("now");
    expect(validationInfo.properties).toHaveProperty("sha256");
    expect(validationInfo.properties).toHaveProperty("currentTab");
    expect((validationInfo as { additionalProperties?: boolean }).additionalProperties).toBe(false);
  });

  test("keeps discovery metadata cloneable and within WebMCP character budgets", () => {
    const tools = SaveInWebMCP.buildTools(vi.fn());
    const visitSchema = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      const record = value as Record<string, unknown>;
      if (typeof record.description === "string")
        expect(record.description.length).toBeLessThanOrEqual(150);
      if (record.properties && typeof record.properties === "object") {
        for (const [name, child] of Object.entries(record.properties)) {
          expect(name.length).toBeLessThanOrEqual(30);
          visitSchema(child);
        }
      }
    };
    for (const tool of tools) {
      expect(tool.name.length).toBeLessThanOrEqual(30);
      expect(tool.description.length).toBeLessThanOrEqual(500);
      expect(() => structuredClone(tool.inputSchema)).not.toThrow();
      visitSchema(tool.inputSchema);
    }
  });

  test("execute handlers message the right background type", () => {
    const { send, byName } = toolsByName();

    byName.save_in_get_schema.execute({});
    byName.save_in_get_schema.execute();
    expect(send).toHaveBeenCalledWith({ type: "GET_SCHEMA" });

    byName.save_in_get_config.execute({});
    expect(send).toHaveBeenCalledWith({ type: "GET_CONFIG" });

    byName.save_in_list_vocabulary.execute({});
    expect(send).toHaveBeenCalledWith({ type: "GET_KEYWORDS" });

    byName.save_in_get_grammars.execute({});
    expect(send).toHaveBeenCalledWith({ type: "GET_GRAMMARS" });

    byName.save_in_validate_config.execute({ paths: "dogs" });
    expect(send).toHaveBeenCalledWith({
      type: "VALIDATE",
      body: { paths: "dogs", validationSource: "webmcp" },
    });

    byName.save_in_apply_config.execute({ config: { prompt: true } });
    expect(send).toHaveBeenCalledWith({
      type: "APPLY_CONFIG",
      body: { config: { prompt: true } },
    });

    byName.save_in_download.execute({
      url: "https://x/a.png",
      pageUrl: "https://x/",
      comment: "c",
    });
    expect(send).toHaveBeenCalledWith({
      type: "DOWNLOAD",
      body: {
        url: "https://x/a.png",
        info: {
          pageUrl: "https://x/",
          srcUrl: "https://x/a.png",
          suggestedFilename: undefined,
          mime: undefined,
          mediaType: undefined,
          sourceKind: undefined,
        },
        comment: "c",
      },
    });
  });

  test("validates and forwards automatic-source rules with a sample candidate", async () => {
    const { send, byName } = toolsByName();
    const automaticCandidate = {
      pageUrl: "https://example.test/gallery",
      sourceUrl: "https://cdn.test/cat.png",
      sourceKind: "image",
      suggestedFilename: "server-cat.png",
    };

    await byName.save_in_validate_config.execute({
      filenamePatterns:
        "context: ^auto$\npagedomain: example\\.test\nsourcekind: image\ninto: Images",
      automaticCandidate,
    });

    expect(send).toHaveBeenCalledWith({
      type: "VALIDATE",
      body: {
        filenamePatterns:
          "context: ^auto$\npagedomain: example\\.test\nsourcekind: image\ninto: Images",
        automaticCandidate,
        validationSource: "webmcp",
      },
    });
  });

  test("passes every matcher input needed for a representative rule trace", async () => {
    const { send, byName } = toolsByName();
    const info = {
      frameUrl: "https://frame.test/",
      linkText: "Download report",
      mediaType: "image",
      selectionText: "selected",
      context: "media",
      menuIndex: "2",
      resolvedFilename: "report.pdf",
      sourceKind: "document",
      counter: 7,
      now: "2026-07-15T12:30:00.000Z",
      sha256: "ba7816bf8f01",
      currentTab: { title: "Quarterly report" },
    };

    await byName.save_in_validate_config.execute({
      filenamePatterns: "pagetitle: report\ninto: matched",
      info,
    });

    expect(send).toHaveBeenCalledWith({
      type: "VALIDATE",
      body: {
        filenamePatterns: "pagetitle: report\ninto: matched",
        info,
        validationSource: "webmcp",
      },
    });
  });

  test("rejects malformed tool input before messaging the background", async () => {
    const { send, byName } = toolsByName();

    await expect(byName.save_in_get_schema.execute({ surprise: true })).resolves.toEqual({
      status: "ERROR",
      errors: [{ field: "surprise", message: "Unknown property" }],
    });
    await expect(byName.save_in_get_config.execute({ surprise: true })).resolves.toEqual({
      status: "ERROR",
      errors: [{ field: "surprise", message: "Unknown property" }],
    });
    await expect(byName.save_in_list_vocabulary.execute({ surprise: true })).resolves.toEqual({
      status: "ERROR",
      errors: [{ field: "surprise", message: "Unknown property" }],
    });
    await expect(byName.save_in_get_grammars.execute({ surprise: true })).resolves.toEqual({
      status: "ERROR",
      errors: [{ field: "surprise", message: "Unknown property" }],
    });
    await expect(byName.save_in_validate_config.execute({ paths: false })).resolves.toEqual({
      status: "ERROR",
      errors: [{ field: "paths", message: "Expected a string" }],
    });
    await expect(
      byName.save_in_validate_config.execute({
        filenamePatterns: "filename: .*\ninto: test/:filename:",
        info: { filename: 42 },
      }),
    ).resolves.toEqual({
      status: "ERROR",
      errors: [{ field: "info.filename", message: "Expected a string" }],
    });
    await expect(
      byName.save_in_validate_config.execute({
        filenamePatterns: "pagetitle: .*\ninto: test",
        info: { currentTab: { title: 42 } },
      }),
    ).resolves.toEqual({
      status: "ERROR",
      errors: [{ field: "info.currentTab.title", message: "Expected a string" }],
    });
    await expect(
      byName.save_in_validate_config.execute({
        filenamePatterns: "into: test",
        info: { sourceKind: "script" },
      }),
    ).resolves.toEqual({
      status: "ERROR",
      errors: [{ field: "info.sourceKind", message: "Unknown source kind" }],
    });
    await expect(
      byName.save_in_validate_config.execute({
        filenamePatterns: "into: test",
        info: { counter: -1 },
      }),
    ).resolves.toEqual({
      status: "ERROR",
      errors: [{ field: "info.counter", message: "Expected a non-negative integer" }],
    });
    await expect(
      byName.save_in_validate_config.execute({
        filenamePatterns: "into: test",
        info: { now: "not-a-date" },
      }),
    ).resolves.toEqual({
      status: "ERROR",
      errors: [{ field: "info.now", message: "Expected an ISO date and time" }],
    });
    await expect(byName.save_in_apply_config.execute({ config: [] })).resolves.toEqual({
      status: "ERROR",
      errors: [{ field: "config", message: "Expected an object" }],
    });
    await expect(byName.save_in_apply_config.execute({ config: {} })).resolves.toEqual({
      status: "ERROR",
      errors: [{ field: "config", message: "Provide at least one setting" }],
    });
    await expect(byName.save_in_validate_config.execute({})).resolves.toEqual({
      status: "ERROR",
      errors: [{ field: "$", message: "Provide paths or filenamePatterns" }],
    });
    await expect(
      byName.save_in_validate_config.execute({ info: { filename: "cat.jpg" } }),
    ).resolves.toEqual({
      status: "ERROR",
      errors: [{ field: "$", message: "Provide paths or filenamePatterns" }],
    });
    await expect(
      byName.save_in_validate_config.execute({
        automaticCandidate: {
          pageUrl: "https://example.test/",
          sourceUrl: "https://cdn.test/a.js",
          sourceKind: "script",
        },
      }),
    ).resolves.toEqual({
      status: "ERROR",
      errors: [{ field: "automaticCandidate.sourceKind", message: "Unknown source kind" }],
    });
    await expect(byName.save_in_download.execute({ url: "" })).resolves.toEqual({
      status: "ERROR",
      errors: [{ field: "url", message: "Expected a non-empty string" }],
    });
    await expect(byName.save_in_download.execute({ url: "javascript:alert(1)" })).resolves.toEqual({
      status: "ERROR",
      errors: [{ field: "url", message: "Use an http, https, ftp, data, or blob URL" }],
    });
    await expect(
      byName.save_in_download.execute({ url: "https://x/a.png", destination: "elsewhere" }),
    ).resolves.toEqual({
      status: "ERROR",
      errors: [{ field: "destination", message: "Unknown property" }],
    });
    expect(send).not.toHaveBeenCalled();

    await expect(
      byName.save_in_validate_config.execute({ info: { surprise: true } }),
    ).resolves.toEqual({
      status: "ERROR",
      errors: [{ field: "info.surprise", message: "Unknown property" }],
    });
    await expect(
      byName.save_in_validate_config.execute({ filenamePatterns: "into: x", info: [] }),
    ).resolves.toMatchObject({ errors: [{ field: "info", message: "Expected an object" }] });
    await expect(
      byName.save_in_validate_config.execute({
        filenamePatterns: "into: x",
        info: { currentTab: [] },
      }),
    ).resolves.toMatchObject({
      errors: [{ field: "info.currentTab", message: "Expected an object" }],
    });
    await expect(
      byName.save_in_validate_config.execute({
        filenamePatterns: "into: x",
        info: { currentTab: { unexpected: "x" } },
      }),
    ).resolves.toMatchObject({
      errors: [{ field: "info.currentTab.unexpected", message: "Unknown property" }],
    });
    await expect(
      byName.save_in_validate_config.execute({
        filenamePatterns: "into: x",
        automaticCandidate: [],
      }),
    ).resolves.toMatchObject({
      errors: [{ field: "automaticCandidate", message: "Expected an object" }],
    });
    await expect(
      byName.save_in_validate_config.execute({
        filenamePatterns: "into: x",
        automaticCandidate: {
          pageUrl: "https://page.test",
          sourceUrl: "https://source.test",
          sourceKind: "image",
          unexpected: true,
        },
      }),
    ).resolves.toMatchObject({
      errors: [{ field: "automaticCandidate.unexpected", message: "Unknown property" }],
    });
    await expect(
      byName.save_in_validate_config.execute({
        filenamePatterns: "into: x",
        automaticCandidate: { pageUrl: "", sourceUrl: "https://source.test", sourceKind: "image" },
      }),
    ).resolves.toMatchObject({
      errors: [{ field: "automaticCandidate.pageUrl", message: "Expected a non-empty string" }],
    });
    await expect(
      byName.save_in_validate_config.execute({
        filenamePatterns: "into: x",
        automaticCandidate: {
          pageUrl: "https://page.test",
          sourceUrl: "https://source.test",
          sourceKind: "image",
          suggestedFilename: 42,
        },
      }),
    ).resolves.toMatchObject({
      errors: [{ field: "automaticCandidate.suggestedFilename", message: "Expected a string" }],
    });
    await expect(
      byName.save_in_validate_config.execute({
        automaticCandidate: {
          pageUrl: "https://page.test",
          sourceUrl: "https://source.test",
          sourceKind: "image",
        },
      }),
    ).resolves.toMatchObject({
      errors: [{ field: "automaticCandidate", message: "Provide filenamePatterns to trace" }],
    });
    await expect(
      byName.save_in_apply_config.execute({ config: { prompt: true }, extra: 1 }),
    ).resolves.toMatchObject({ errors: [{ field: "extra", message: "Unknown property" }] });
    await expect(
      byName.save_in_download.execute({ url: "https://x/a", mime: 42 }),
    ).resolves.toMatchObject({ errors: [{ field: "mime", message: "Expected a string" }] });
    await expect(
      byName.save_in_download.execute({ url: "https://x/a", sourceKind: "script" }),
    ).resolves.toMatchObject({
      errors: [{ field: "sourceKind", message: "Unknown source kind" }],
    });
  });

  test("normalizes surrounding URL whitespace before starting a download", async () => {
    const { send, byName } = toolsByName();
    await byName.save_in_download.execute({
      url: "  https://x/a.png  ",
      pageUrl: "  https://x/page  ",
    });

    await byName.save_in_download.execute({ url: "https://x/no-page", pageUrl: "   " });
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ info: expect.objectContaining({ pageUrl: undefined }) }),
      }),
    );
    await byName.save_in_download.execute({ url: "https://x/omitted-page" });
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ info: expect.objectContaining({ pageUrl: undefined }) }),
      }),
    );
    expect(send).toHaveBeenCalledWith({
      type: "DOWNLOAD",
      body: {
        url: "https://x/a.png",
        info: {
          pageUrl: "https://x/page",
          srcUrl: "https://x/a.png",
          suggestedFilename: undefined,
          mime: undefined,
          mediaType: undefined,
          sourceKind: undefined,
        },
        comment: undefined,
      },
    });
  });

  test("rejects adversarial non-JSON inputs without invoking the background", async () => {
    const { send, byName } = toolsByName();
    for (const input of [null, [], "oops", 42, true]) {
      await expect(byName.save_in_download.execute(input)).resolves.toEqual({
        status: "ERROR",
        errors: [{ field: "$", message: "Expected an object" }],
      });
    }
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(byName.save_in_validate_config.execute(cyclic)).resolves.toEqual({
      status: "ERROR",
      errors: [{ field: "$", message: "Expected a JSON-compatible object" }],
    });
    await expect(
      byName.save_in_validate_config.execute({ paths: "x".repeat(1_000_001) }),
    ).resolves.toEqual({
      status: "ERROR",
      errors: [{ field: "$", message: "Input is too large" }],
    });
    expect(send).not.toHaveBeenCalled();
  });

  test("turns synchronous and asynchronous transport failures into stable results", async () => {
    const syncTools = SaveInWebMCP.buildTools(() => {
      throw new Error("extension context invalidated: secret detail");
    });
    const asyncTools = SaveInWebMCP.buildTools(() => Promise.reject(new Error("worker gone")));
    await expect(syncTools[0]!.execute({})).resolves.toEqual({
      status: "ERROR",
      errors: [{ field: "$", message: "Save In is temporarily unavailable" }],
    });
    await expect(asyncTools[0]!.execute({})).resolves.toEqual({
      status: "ERROR",
      errors: [{ field: "$", message: "Save In is temporarily unavailable" }],
    });
    for (const empty of [undefined, null]) {
      const emptyTools = SaveInWebMCP.buildTools(() => Promise.resolve(empty));
      await expect(emptyTools[0]!.execute({})).resolves.toEqual({
        status: "ERROR",
        errors: [{ field: "$", message: "Save In is temporarily unavailable" }],
      });
    }
  });

  test("register reports successful registrations and isolates failures", async () => {
    const registerTool = vi.fn(() => Promise.resolve());
    await expect(SaveInWebMCP.register({ registerTool }, vi.fn())).resolves.toBe(7);
    expect(registerTool).toHaveBeenCalledTimes(7);

    const throwing = {
      registerTool: vi.fn((tool: { name: string }) => {
        if (tool.name === "save_in_download") {
          throw new Error("nope");
        }
        return tool.name === "save_in_apply_config"
          ? Promise.reject(new Error("also nope"))
          : Promise.resolve();
      }),
    };
    await expect(SaveInWebMCP.register(throwing, vi.fn())).resolves.toBe(5);
  });
});

describe("options-page registration", () => {
  afterEach(() => {
    delete document.modelContext;
    delete navigator.modelContext;
    Reflect.deleteProperty(global, "browser");
    document.body.innerHTML = "";
  });

  test("registers and reports status when document.modelContext is present", async () => {
    document.body.innerHTML = '<span id="webmcp-status"></span>';
    const registerTool = vi.fn(() => Promise.resolve());
    document.modelContext = { registerTool };
    (global as any).browser = {
      runtime: { sendMessage: vi.fn(() => Promise.resolve({ body: {} })) },
    };

    vi.resetModules();
    const { setupWebMcpStatus } = await import("../src/options/webmcp.ts");
    setupWebMcpStatus(() => "");

    expect(registerTool).toHaveBeenCalledTimes(7);
    await vi.waitFor(() =>
      expect(document.getElementById("webmcp-status")?.textContent).toBe(
        "Active — 7 tools registered",
      ),
    );
  });

  test("reports partial registration instead of claiming full success", async () => {
    document.body.innerHTML = '<span id="webmcp-status"></span>';
    document.modelContext = {
      registerTool: vi.fn((tool: { name: string }) =>
        tool.name === "save_in_download" ? Promise.reject(new Error("nope")) : Promise.resolve(),
      ),
    };
    (global as any).browser = {
      runtime: { sendMessage: vi.fn(() => Promise.resolve({ body: {} })) },
    };

    vi.resetModules();
    const { setupWebMcpStatus } = await import("../src/options/webmcp.ts");
    setupWebMcpStatus(() => "");

    await vi.waitFor(() =>
      expect(document.getElementById("webmcp-status")?.textContent).toBe(
        "Limited — 6 of 7 tools registered",
      ),
    );
  });

  test("refreshes the open page after apply succeeds without changing the tool result", async () => {
    document.body.innerHTML = '<span id="webmcp-status"></span>';
    let applyTool: SaveInTool | undefined;
    document.modelContext = {
      registerTool: vi.fn((tool: { name: string }) => {
        if (tool.name === "save_in_apply_config") applyTool = tool as SaveInTool;
        return Promise.resolve();
      }),
    };
    (global as any).browser = {
      runtime: {
        sendMessage: vi.fn(() =>
          Promise.resolve({
            body: { version: 1, applied: { prompt: true }, rejected: [] },
          }),
        ),
      },
    };
    const onConfigApplied = vi.fn(() => Promise.reject(new Error("page refresh failed")));

    vi.resetModules();
    const { setupWebMcpStatus } = await import("../src/options/webmcp.ts");
    setupWebMcpStatus(() => "", onConfigApplied);
    await vi.waitFor(() => expect(applyTool).toBeDefined());

    await expect(applyTool!.execute({ config: { prompt: true } })).resolves.toEqual({
      version: 1,
      applied: { prompt: true },
      rejected: [],
    });
    expect(onConfigApplied).toHaveBeenCalledWith({ prompt: true });
  });

  test("no-ops and reports unavailability without a model context", async () => {
    document.body.innerHTML = '<span id="webmcp-status"></span>';
    delete document.modelContext;

    vi.resetModules();
    const { setupWebMcpStatus } = await import("../src/options/webmcp.ts");
    setupWebMcpStatus(() => "");

    expect(document.getElementById("webmcp-status")?.textContent).toBe(
      "Not available in this browser",
    );
  });

  test("uses the legacy navigator context when the document context is absent", () => {
    const registerTool = vi.fn();
    navigator.modelContext = { registerTool };
    expect(SaveInWebMCP.getModelContext()?.registerTool).toEqual(expect.any(Function));
  });

  test("reports localized registration failure when every tool is rejected", async () => {
    document.body.innerHTML = '<span id="webmcp-status"></span>';
    document.modelContext = { registerTool: vi.fn(() => Promise.reject(new Error("nope"))) };
    (global as any).browser = {
      runtime: { sendMessage: vi.fn(() => Promise.resolve({ body: {} })) },
    };

    vi.resetModules();
    const { setupWebMcpStatus } = await import("../src/options/webmcp.ts");
    const localize = vi
      .fn<(key: string) => string>()
      .mockReturnValueOnce("Localized<webMcpStatusRegistering>")
      .mockReturnValue("");
    setupWebMcpStatus(localize);

    await vi.waitFor(() =>
      expect(document.getElementById("webmcp-status")?.textContent).toBe(
        "Unavailable — tool registration failed",
      ),
    );
  });

  test("registers without a status element and tolerates an empty runtime response", async () => {
    document.body.innerHTML = "";
    document.modelContext = {
      registerTool: vi.fn((tool: { name: string }) => (tool as SaveInTool).execute({})),
    };
    const sendMessage = vi.fn().mockResolvedValueOnce(null).mockResolvedValue({ body: null });
    (global as any).browser = {
      runtime: { sendMessage },
    };

    vi.resetModules();
    const { setupWebMcpStatus } = await import("../src/options/webmcp.ts");
    expect(() => setupWebMcpStatus(() => "")).not.toThrow();
    await vi.waitFor(() => expect(document.modelContext?.registerTool).toHaveBeenCalledTimes(7));
    delete document.modelContext;
    expect(() => setupWebMcpStatus(() => "")).not.toThrow();
  });
});
