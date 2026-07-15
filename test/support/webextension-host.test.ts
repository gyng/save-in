import { createWebExtensionTestHost } from "./webextension-host.fixture.ts";

describe("WebExtension test hosts", () => {
  test("keeps Firefox and Chrome state independent", async () => {
    const host = createWebExtensionTestHost();

    await host.browser.storage.local.set({ owner: "firefox" });
    await host.chrome.storage.local.set({ owner: "chrome" });

    await expect(host.browser.storage.local.get("owner")).resolves.toEqual({ owner: "firefox" });
    await expect(host.chrome.storage.local.get("owner")).resolves.toEqual({ owner: "chrome" });
    expect(host.browser.runtime.onMessage).not.toBe(host.chrome.runtime.onMessage);
  });

  test("models Firefox promise-only and Chrome callback-compatible calls", async () => {
    const host = createWebExtensionTestHost();
    const chromeStorageCallback = vi.fn();
    const chromeMessageCallback = vi.fn();

    await host.chrome.storage.local.set({ ready: true });
    Reflect.apply(host.chrome.storage.local.get, host.chrome.storage.local, [
      "ready",
      chromeStorageCallback,
    ]);
    Reflect.apply(host.chrome.runtime.sendMessage, host.chrome.runtime, [
      { type: "PING" },
      chromeMessageCallback,
    ]);

    expect(chromeStorageCallback).toHaveBeenCalledWith({ ready: true });
    expect(chromeMessageCallback).toHaveBeenCalledWith(undefined);
    expect(() =>
      Reflect.apply(host.browser.storage.local.get, host.browser.storage.local, ["ready", vi.fn()]),
    ).toThrow("do not accept callbacks");
    expect(() =>
      Reflect.apply(host.browser.runtime.sendMessage, host.browser.runtime, [
        { type: "PING" },
        vi.fn(),
      ]),
    ).toThrow("do not accept callbacks");
  });
});
