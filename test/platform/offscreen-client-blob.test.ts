import { OffscreenClient } from "../../src/platform/offscreen-client.ts";

describe("offscreen blob assembly client", () => {
  let sendMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendMessage = vi.fn(() => Promise.resolve({ blobUrl: "blob:chrome-extension://id/1" }));
    global.chrome = {
      offscreen: { createDocument: vi.fn(() => Promise.resolve()) },
      runtime: {
        getURL: vi.fn((path: string) => `chrome-extension://id/${path}`),
        getContexts: vi.fn(() => Promise.resolve([{}])),
        sendMessage,
      },
    } as any;
  });

  afterEach(() => Reflect.deleteProperty(globalThis, "chrome"));

  test("relays chunks unchanged and returns the assembled object URL", async () => {
    await expect(OffscreenClient.appendBlob("r", "AAEC")).resolves.toBeUndefined();
    await expect(OffscreenClient.completeBlob("r", "image/png")).resolves.toBe(
      "blob:chrome-extension://id/1",
    );

    expect(sendMessage).toHaveBeenNthCalledWith(1, {
      type: "OFFSCREEN_BLOB_APPEND",
      requestId: "r",
      data: "AAEC",
    });
    expect(sendMessage).toHaveBeenNthCalledWith(2, {
      type: "OFFSCREEN_BLOB_COMPLETE",
      requestId: "r",
      mime: "image/png",
    });
  });

  test.each([undefined, {}, { blobUrl: 42 }])(
    "rejects a completion without an object URL: %j",
    async (response) => {
      sendMessage.mockResolvedValue(response);
      await expect(OffscreenClient.completeBlob("r", "")).rejects.toThrow(
        "offscreen blob assembly failed",
      );
    },
  );
});
