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
    }
    expect(byName.save_in_download.inputSchema.required).toEqual(["url"]);
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

  test("register registers every tool and swallows failures", () => {
    const registerTool = vi.fn(() => Promise.resolve());
    SaveInWebMCP.register({ registerTool }, vi.fn());
    expect(registerTool).toHaveBeenCalledTimes(5);

    const throwing = {
      registerTool: vi.fn(() => {
        throw new Error("nope");
      }),
    };
    expect(() => SaveInWebMCP.register(throwing, vi.fn())).not.toThrow();
  });
});

describe("auto-registration on import", () => {
  afterEach(() => {
    delete document.modelContext;
    delete global.browser;
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
    expect(document.getElementById("webmcp-status").textContent).toBe(
      "Active — 5 tools registered",
    );
  });

  test("no-ops and reports unavailability without a model context", async () => {
    document.body.innerHTML = '<span id="webmcp-status"></span>';
    delete document.modelContext;

    vi.resetModules();
    await import("../src/options/webmcp.ts");

    expect(document.getElementById("webmcp-status").textContent).toBe(
      "Not available in this browser",
    );
  });
});
