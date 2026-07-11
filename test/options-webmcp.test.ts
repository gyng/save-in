// EXPERIMENTAL WebMCP adapter: tool definitions + auto-registration guard

import { SaveInWebMCP } from "../src/options/webmcp.ts";

describe("buildTools", () => {
  const toolsByName = () => {
    const send = vi.fn((m) => Promise.resolve({ ok: m.type }));
    const tools = SaveInWebMCP.buildTools(send);
    return { send, byName: Object.fromEntries(tools.map((t) => [t.name, t])) };
  };

  test("defines the save-in tools with input schemas", () => {
    const { byName } = toolsByName();
    expect(Object.keys(byName).sort()).toEqual([
      "save_in_apply_config",
      "save_in_download",
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
    expect(byName.save_in_validate_config.annotations?.readOnlyHint).toBe(true);
    const validationInfo = byName.save_in_validate_config.inputSchema.properties.info as {
      description: string;
      properties: Record<string, unknown>;
    };
    expect(validationInfo.description).toContain("srcUrl");
    expect(validationInfo.properties).toHaveProperty("srcUrl");
    expect(validationInfo.properties).toHaveProperty("url");
  });

  test("execute handlers message the right background type", () => {
    const { send, byName } = toolsByName();

    byName.save_in_get_schema.execute({});
    expect(send).toHaveBeenCalledWith({ type: "GET_SCHEMA" });

    byName.save_in_list_vocabulary.execute({});
    expect(send).toHaveBeenCalledWith({ type: "GET_KEYWORDS" });

    byName.save_in_validate_config.execute({ paths: "dogs" });
    expect(send).toHaveBeenCalledWith({ type: "VALIDATE", body: { paths: "dogs" } });

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
        info: { pageUrl: "https://x/", srcUrl: "https://x/a.png" },
        comment: "c",
      },
    });
  });

  test("rejects malformed tool input before messaging the background", async () => {
    const { send, byName } = toolsByName();

    await expect(byName.save_in_get_schema.execute({ surprise: true })).resolves.toEqual({
      status: "ERROR",
      errors: [{ field: "surprise", message: "Unknown property" }],
    });
    await expect(byName.save_in_list_vocabulary.execute({ surprise: true })).resolves.toEqual({
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
    await expect(byName.save_in_apply_config.execute({ config: [] })).resolves.toEqual({
      status: "ERROR",
      errors: [{ field: "config", message: "Expected an object" }],
    });
    await expect(byName.save_in_download.execute({ url: "" })).resolves.toEqual({
      status: "ERROR",
      errors: [{ field: "url", message: "Expected a non-empty string" }],
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
    ).resolves.toEqual({ ok: "VALIDATE" });
  });

  test("register reports successful registrations and isolates failures", async () => {
    const registerTool = vi.fn(() => Promise.resolve());
    await expect(SaveInWebMCP.register({ registerTool }, vi.fn())).resolves.toBe(5);
    expect(registerTool).toHaveBeenCalledTimes(5);

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
    await expect(SaveInWebMCP.register(throwing, vi.fn())).resolves.toBe(3);
  });
});

describe("auto-registration on import", () => {
  afterEach(() => {
    delete document.modelContext;
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
    await import("../src/options/webmcp.ts");

    expect(registerTool).toHaveBeenCalledTimes(5);
    await vi.waitFor(() =>
      expect(document.getElementById("webmcp-status")?.textContent).toBe(
        "Active — 5 tools registered",
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
    await import("../src/options/webmcp.ts");

    await vi.waitFor(() =>
      expect(document.getElementById("webmcp-status")?.textContent).toBe(
        "Limited — 4 of 5 tools registered",
      ),
    );
  });

  test("no-ops and reports unavailability without a model context", async () => {
    document.body.innerHTML = '<span id="webmcp-status"></span>';
    delete document.modelContext;

    vi.resetModules();
    await import("../src/options/webmcp.ts");

    expect(document.getElementById("webmcp-status")?.textContent).toBe(
      "Not available in this browser",
    );
  });
});
