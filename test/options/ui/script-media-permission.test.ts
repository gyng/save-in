// @vitest-environment jsdom
// Opt-in gate for the script-media (webRequest) detector: requesting the
// optional permission from the toggle gesture, reverting on denial/revoke, and
// self-healing a stored "on" whose permission was dropped out of band.
import {
  initScriptMediaPermission,
  setupScriptMediaPermission,
} from "../../../src/options/ui/script-media-permission.ts";

const checkbox = (checked: boolean): HTMLInputElement => {
  const el = document.createElement("input");
  el.type = "checkbox";
  el.id = "sourcePanelScriptMedia";
  el.checked = checked;
  return el;
};

const withPerms = (contains: boolean, extra: Record<string, any> = {}) => {
  (global.browser as any).permissions = {
    contains: vi.fn(() => Promise.resolve(contains)),
    request: vi.fn(() => Promise.resolve(true)),
    remove: vi.fn(() => Promise.resolve(true)),
    onRemoved: { addListener: vi.fn() },
    ...extra,
  };
};

afterEach(() => {
  Reflect.deleteProperty(global.browser, "permissions");
  document.body.innerHTML = "";
});

describe("initScriptMediaPermission", () => {
  test("returns early (no throw) without a checkbox", async () => {
    await expect(initScriptMediaPermission(null)).resolves.toBeUndefined();
  });

  test("requests webRequest when the toggle is turned on", async () => {
    withPerms(false);
    const box = checkbox(false);
    await initScriptMediaPermission(box);

    box.checked = true;
    box.dispatchEvent(new Event("change"));

    expect(global.browser.permissions.request).toHaveBeenCalledWith({
      permissions: ["webRequest"],
    });
  });

  test("reverts the toggle when the permission is denied", async () => {
    withPerms(false, { request: vi.fn(() => Promise.resolve(false)) });
    const box = checkbox(false);
    await initScriptMediaPermission(box);

    box.checked = true;
    box.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(box.checked).toBe(false));
  });

  test("reverts the toggle when the request rejects", async () => {
    withPerms(false, { request: vi.fn(() => Promise.reject(new Error("denied"))) });
    const box = checkbox(false);
    await initScriptMediaPermission(box);

    box.checked = true;
    box.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(box.checked).toBe(false));
  });

  test("keeps the toggle on when the permission is granted", async () => {
    withPerms(false, { request: vi.fn(() => Promise.resolve(true)) });
    const box = checkbox(false);
    await initScriptMediaPermission(box);

    box.checked = true;
    box.dispatchEvent(new Event("change"));
    await Promise.resolve();
    await Promise.resolve();
    expect(box.checked).toBe(true);
  });

  test("removes the permission (not requests one) when the toggle is turned off", async () => {
    withPerms(true);
    const box = checkbox(true);
    await initScriptMediaPermission(box);

    box.checked = false;
    box.dispatchEvent(new Event("change"));
    expect(global.browser.permissions.request).not.toHaveBeenCalled();
    expect(global.browser.permissions.remove).toHaveBeenCalledWith({ permissions: ["webRequest"] });
  });

  test("self-heals a stored on whose permission is missing", async () => {
    withPerms(false);
    const box = checkbox(true);
    await initScriptMediaPermission(box);
    expect(box.checked).toBe(false);
  });

  test("leaves a granted stored on untouched", async () => {
    withPerms(true);
    const box = checkbox(true);
    await initScriptMediaPermission(box);
    expect(box.checked).toBe(true);
  });

  test("reverts when the permission is revoked while the page is open", async () => {
    let held = true;
    let revoke: () => void = () => {};
    withPerms(true, {
      contains: vi.fn(() => Promise.resolve(held)),
      onRemoved: {
        addListener: (fn: () => void) => {
          revoke = fn;
        },
      },
    });
    const box = checkbox(true);
    await initScriptMediaPermission(box);
    expect(box.checked).toBe(true);

    held = false;
    revoke();
    await vi.waitFor(() => expect(box.checked).toBe(false));
  });

  test("leaves the toggle alone when the permissions API is unavailable", async () => {
    Reflect.deleteProperty(global.browser, "permissions");
    const box = checkbox(true);
    await initScriptMediaPermission(box);
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    expect(box.checked).toBe(true);
  });

  test("wires the options-page checkbox by id", async () => {
    withPerms(true);
    document.body.innerHTML = `<input type="checkbox" id="sourcePanelScriptMedia" checked />`;
    await setupScriptMediaPermission();
    expect(document.querySelector<HTMLInputElement>("#sourcePanelScriptMedia")!.checked).toBe(true);
  });
});
