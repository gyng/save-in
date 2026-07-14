import { extensionLocalStorage, extensionSessionStorage } from "../src/platform/storage-areas.ts";

describe("storage area adapters", () => {
  test("forwards local storage operations at call time", async () => {
    vi.mocked(browser.storage.local.get).mockResolvedValue({ value: 1 });
    vi.mocked(browser.storage.local.set).mockResolvedValue();
    vi.mocked(browser.storage.local.remove).mockResolvedValue();

    await expect(extensionLocalStorage.get("value")).resolves.toEqual({ value: 1 });
    await extensionLocalStorage.set({ value: 2 });
    await extensionLocalStorage.remove("value");

    expect(browser.storage.local.get).toHaveBeenCalledWith("value");
    expect(browser.storage.local.set).toHaveBeenCalledWith({ value: 2 });
    expect(browser.storage.local.remove).toHaveBeenCalledWith("value");
  });

  test("uses no-op session operations when the capability is absent", async () => {
    const session = browser.storage.session;
    Reflect.deleteProperty(browser.storage, "session");
    try {
      await expect(extensionSessionStorage.get("value")).resolves.toEqual({});
      await expect(extensionSessionStorage.set({ value: 2 })).resolves.toBeUndefined();
      await expect(extensionSessionStorage.remove("value")).resolves.toBeUndefined();
    } finally {
      Reflect.set(browser.storage, "session", session);
    }
  });
});
