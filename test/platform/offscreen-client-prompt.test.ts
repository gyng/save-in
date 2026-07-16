import { OffscreenClient } from "../../src/platform/offscreen-client.ts";

describe("offscreen Prompt API client", () => {
  let originalCreateObjectURL: typeof URL.createObjectURL;
  let sendMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalCreateObjectURL = URL.createObjectURL;
    Object.defineProperty(URL, "createObjectURL", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    sendMessage = vi.fn(() => Promise.resolve({ output: "into: suggested/" }));
    global.chrome = {
      offscreen: {
        createDocument: vi.fn(() => Promise.resolve()),
      },
      runtime: {
        getURL: vi.fn((path: string) => `chrome-extension://id/${path}`),
        getContexts: vi.fn(() => Promise.resolve([{}])),
        sendMessage,
      },
    } as any;
  });

  afterEach(() => {
    Object.defineProperty(URL, "createObjectURL", {
      value: originalCreateObjectURL,
      configurable: true,
      writable: true,
    });
    Reflect.deleteProperty(globalThis, "chrome");
  });

  test("routes inference through the reusable offscreen document", async () => {
    await expect(OffscreenClient.prompt("Suggest a rule")).resolves.toBe("into: suggested/");
    expect(sendMessage).toHaveBeenCalledWith({
      type: "OFFSCREEN_PROMPT",
      input: "Suggest a rule",
    });
  });

  test("preserves the unavailable fallback", async () => {
    sendMessage.mockResolvedValue({ output: null });
    await expect(OffscreenClient.prompt("Suggest a rule")).resolves.toBeNull();
  });

  test("rejects explicit and malformed failures", async () => {
    sendMessage.mockResolvedValueOnce({ error: "inference failed" });
    await expect(OffscreenClient.prompt("Suggest a rule")).rejects.toThrow("inference failed");

    sendMessage.mockResolvedValueOnce({});
    await expect(OffscreenClient.prompt("Suggest a rule")).rejects.toThrow(
      "offscreen prompt failed",
    );
  });
});
