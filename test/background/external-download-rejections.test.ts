import { createExternalDownloadRejections } from "../../src/background/external-download-rejections.ts";

const createStorage = (initial: Record<string, unknown> = {}) => {
  const values = { ...initial };
  return {
    values,
    get: vi.fn(async (key: string) => ({ [key]: values[key] })),
    set: vi.fn(async (updates: Record<string, unknown>) => {
      Object.assign(values, updates);
    }),
    remove: vi.fn(async (key: string) => {
      delete values[key];
    }),
  };
};

test("records bounded, privacy-minimizing rejection summaries per caller", async () => {
  const storage = createStorage();
  const rejections = createExternalDownloadRejections(
    storage,
    () => new Date("2026-07-13T10:00:00.000Z"),
  );

  await rejections.record("blocked-extension", {
    url: "https://private.example/account?token=secret",
  });
  await rejections.record("blocked-extension", { target: "activeTab" });

  expect(await rejections.get()).toEqual([
    {
      senderId: "blocked-extension",
      attempts: 2,
      lastRejectedAt: "2026-07-13T10:00:00.000Z",
      requestType: "activeTab",
    },
  ]);
  expect(JSON.stringify(storage.values)).not.toContain("private.example");
  expect(JSON.stringify(storage.values)).not.toContain("secret");
});

test("normalizes malformed stored data and caps distinct callers", async () => {
  const storage = createStorage({ externalDownloadRejections: [null, { senderId: 7 }] });
  let second = 0;
  const rejections = createExternalDownloadRejections(
    storage,
    () => new Date(Date.UTC(2026, 0, 1, 0, 0, second++)),
  );

  for (let index = 0; index < 25; index += 1) {
    await rejections.record(`extension-${index}`, { url: "https://example.test/file" });
  }

  const stored = await rejections.get();
  expect(stored).toHaveLength(20);
  expect(stored[0]?.senderId).toBe("extension-24");
  expect(stored.at(-1)?.senderId).toBe("extension-5");
});

test("clears one approved caller without removing other rejections", async () => {
  const storage = createStorage();
  const rejections = createExternalDownloadRejections(storage);
  await rejections.record("keep-extension", { url: "https://example.test/a" });
  await rejections.record("approve-extension", { target: "activeTab" });

  await rejections.clear("approve-extension");

  expect((await rejections.get()).map(({ senderId }) => senderId)).toEqual(["keep-extension"]);
});

test("contains storage failures and ignores an unidentified caller", async () => {
  const storage = {
    get: vi.fn(() => Promise.reject(new Error("read denied"))),
    set: vi.fn(() => Promise.reject(new Error("write denied"))),
  };
  const rejections = createExternalDownloadRejections(storage);

  await expect(rejections.record("", {})).resolves.toBeUndefined();
  await expect(rejections.record("blocked", {})).resolves.toBeUndefined();
  await expect(rejections.get()).resolves.toEqual([]);

  expect(storage.set).toHaveBeenCalledWith({
    externalDownloadRejections: [
      expect.objectContaining({ senderId: "blocked", requestType: "unknown" }),
    ],
  });
});

test("recovers its queue after request metadata construction fails", async () => {
  const storage = createStorage();
  const now = vi
    .fn<() => Date>()
    .mockImplementationOnce(() => {
      throw new Error("clock failed");
    })
    .mockReturnValue(new Date("2026-07-14T00:00:00.000Z"));
  const rejections = createExternalDownloadRejections(storage, now);

  await expect(rejections.record("first", {})).rejects.toThrow("clock failed");
  await expect(rejections.get()).resolves.toEqual([]);
  await expect(rejections.record("second", {})).resolves.toBeUndefined();
  await expect(rejections.get()).resolves.toEqual([
    expect.objectContaining({ senderId: "second", requestType: "unknown" }),
  ]);
});

test("saturates the rejection attempt count", async () => {
  const storage = createStorage({
    externalDownloadRejections: [
      {
        senderId: "persistent",
        attempts: Number.MAX_SAFE_INTEGER,
        lastRejectedAt: "2026-07-13T00:00:00.000Z",
        requestType: "url",
      },
    ],
  });
  const rejections = createExternalDownloadRejections(
    storage,
    () => new Date("2026-07-14T00:00:00.000Z"),
  );

  await rejections.record("persistent", { url: "https://example.test" });

  expect((await rejections.get())[0]?.attempts).toBe(Number.MAX_SAFE_INTEGER);
});
