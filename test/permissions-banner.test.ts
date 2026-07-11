// Options-page host-permission banner: detect a missing <all_urls> grant and
// offer a one-click request. jest-webextension-mock has no permissions API, so
// it's defined per test.
import { PermissionsBanner } from "../src/options/permissions-banner.ts";

const makeEl = () => {
  const listeners: Record<string, any> = {};
  return {
    hidden: false,
    addEventListener: (type: string, fn: (...args: any[]) => void) => {
      listeners[type] = fn;
    },
    click: () => listeners.click && listeners.click(),
  };
};

const flush = () => new Promise((r) => setTimeout(r));

afterEach(() => {
  delete global.browser.permissions;
});

describe("PermissionsBanner.hasHostAccess", () => {
  test("resolves true when the permissions API is unavailable (old browser)", async () => {
    delete global.browser.permissions;
    await expect(PermissionsBanner.hasHostAccess()).resolves.toBe(true);
  });

  test("resolves the contains() result for <all_urls>", async () => {
    (global.browser as any).permissions = { contains: vi.fn(() => Promise.resolve(false)) };
    await expect(PermissionsBanner.hasHostAccess()).resolves.toBe(false);
    expect(global.browser.permissions.contains).toHaveBeenCalledWith({ origins: ["<all_urls>"] });
  });

  test("resolves true when contains() rejects (do not nag on error)", async () => {
    (global.browser as any).permissions = {
      contains: vi.fn(() => Promise.reject(new Error("x"))),
    };
    await expect(PermissionsBanner.hasHostAccess()).resolves.toBe(true);
  });
});

describe("PermissionsBanner.init", () => {
  const withPerms = (containsResult: boolean, extra: Record<string, any> = {}) => {
    (global.browser as any).permissions = {
      contains: vi.fn(() => Promise.resolve(containsResult)),
      onAdded: { addListener: vi.fn() },
      onRemoved: { addListener: vi.fn() },
      ...extra,
    };
  };

  test("returns early (no throw) without elements", async () => {
    await expect(PermissionsBanner.init(null, null)).resolves.toBeUndefined();
  });

  test("hides the banner when access is granted", async () => {
    withPerms(true);
    const banner = makeEl();
    await PermissionsBanner.init(banner, makeEl());
    expect(banner.hidden).toBe(true);
  });

  test("shows the banner when access is missing", async () => {
    withPerms(false);
    const banner = makeEl();
    await PermissionsBanner.init(banner, makeEl());
    expect(banner.hidden).toBe(false);
  });

  test("requests <all_urls> on button click and re-hides once granted", async () => {
    let granted = false;
    withPerms(false, {
      contains: vi.fn(() => Promise.resolve(granted)),
      request: vi.fn(() => {
        granted = true;
        return Promise.resolve(true);
      }),
    });
    const banner = makeEl();
    const button = makeEl();
    await PermissionsBanner.init(banner, button);
    expect(banner.hidden).toBe(false);

    button.click();
    await flush();

    expect(global.browser.permissions.request).toHaveBeenCalledWith({ origins: ["<all_urls>"] });
    expect(banner.hidden).toBe(true);
  });

  test("stays shown when the user dismisses the request", async () => {
    withPerms(false, { request: vi.fn(() => Promise.reject(new Error("denied"))) });
    const banner = makeEl();
    const button = makeEl();
    await PermissionsBanner.init(banner, button);

    button.click();
    await flush();

    expect(banner.hidden).toBe(false);
  });

  test("reacts to grant/revoke while the page is open", async () => {
    withPerms(true);
    await PermissionsBanner.init(makeEl(), makeEl());
    expect(global.browser.permissions.onAdded.addListener).toHaveBeenCalled();
    expect(global.browser.permissions.onRemoved.addListener).toHaveBeenCalled();
  });
});
