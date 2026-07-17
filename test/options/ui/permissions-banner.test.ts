// @vitest-environment jsdom
// Options-page host-permission banner: detect a missing <all_urls> grant and
// offer a one-click request. The shared host is replaced here so
// it's defined per test.
import {
  hasHostAccess,
  initPermissionsBanner,
  setupPermissionsBanner,
} from "../../../src/options/ui/permissions-banner.ts";

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

afterEach(() => {
  Reflect.deleteProperty(global.browser, "permissions");
});

describe("hasHostAccess", () => {
  test("resolves true when the permissions API is unavailable (old browser)", async () => {
    Reflect.deleteProperty(global.browser, "permissions");
    await expect(hasHostAccess()).resolves.toBe(true);
  });

  test("resolves the contains() result for <all_urls>", async () => {
    (global.browser as any).permissions = { contains: vi.fn(() => Promise.resolve(false)) };
    await expect(hasHostAccess()).resolves.toBe(false);
    expect(global.browser.permissions.contains).toHaveBeenCalledWith({ origins: ["<all_urls>"] });
  });

  test("resolves true when contains() rejects (do not nag on error)", async () => {
    (global.browser as any).permissions = {
      contains: vi.fn(() => Promise.reject(new Error("x"))),
    };
    await expect(hasHostAccess()).resolves.toBe(true);
  });
});

describe("initPermissionsBanner", () => {
  const withPerms = (containsResult: boolean, extra: Record<string, any> = {}) => {
    (global.browser as any).permissions = {
      contains: vi.fn(() => Promise.resolve(containsResult)),
      onAdded: { addListener: vi.fn() },
      onRemoved: { addListener: vi.fn() },
      ...extra,
    };
  };

  test("returns early (no throw) without elements", async () => {
    await expect(initPermissionsBanner(null, null)).resolves.toBeUndefined();
  });

  test("hides the banner when access is granted", async () => {
    withPerms(true);
    const banner = makeEl();
    await initPermissionsBanner(banner, makeEl());
    expect(banner.hidden).toBe(true);
  });

  test("shows the banner when access is missing", async () => {
    withPerms(false);
    const banner = makeEl();
    await initPermissionsBanner(banner, makeEl());
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
    await initPermissionsBanner(banner, button);
    expect(banner.hidden).toBe(false);

    button.click();
    await vi.waitFor(() => expect(banner.hidden).toBe(true));

    expect(global.browser.permissions.request).toHaveBeenCalledWith({ origins: ["<all_urls>"] });
    expect(banner.hidden).toBe(true);
  });

  test("stays shown when the user dismisses the request", async () => {
    withPerms(false, { request: vi.fn(() => Promise.reject(new Error("denied"))) });
    const banner = makeEl();
    const button = makeEl();
    await initPermissionsBanner(banner, button);

    button.click();
    await vi.waitFor(() => expect(global.browser.permissions.request).toHaveBeenCalled());

    expect(banner.hidden).toBe(false);
  });

  test("reacts to grant/revoke while the page is open", async () => {
    withPerms(true);
    await initPermissionsBanner(makeEl(), makeEl());
    expect(global.browser.permissions.onAdded.addListener).toHaveBeenCalled();
    expect(global.browser.permissions.onRemoved.addListener).toHaveBeenCalled();
  });

  test("works when request and permission-change events are unavailable", async () => {
    (global.browser as any).permissions = {
      contains: vi.fn(() => Promise.resolve(false)),
    };
    const banner = makeEl();
    const button = makeEl();

    await initPermissionsBanner(banner, button);
    button.click();

    expect(banner.hidden).toBe(false);
  });

  test("wires the options-page banner elements", async () => {
    document.body.innerHTML = `
      <div id="host-permission-banner"></div>
      <button id="host-permission-grant"></button>`;
    withPerms(true);

    await setupPermissionsBanner();

    expect(document.querySelector<HTMLElement>("#host-permission-banner")!.hidden).toBe(true);
  });
});
