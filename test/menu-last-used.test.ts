import { setupBrowserMocks, importMenus, type MenusFixture } from "./menu-listeners-fixture.ts";

describe("Menus last-used state", () => {
  let Menus: MenusFixture;

  beforeEach(async () => {
    vi.resetModules();
    setupBrowserMocks();
    Menus = await importMenus();
  });

  test("restoreLastUsed maps a stored object into state, defaulting to null", () => {
    Menus.restoreLastUsed({
      lastUsedPath: "a/b",
      lastUsedMeta: { comment: "c" },
    } as unknown as Parameters<MenusFixture["restoreLastUsed"]>[0]);
    expect(Menus.state.lastUsedPath).toBe("a/b");
    expect(Menus.state.lastUsedMeta).toEqual({ comment: "c" });

    Menus.restoreLastUsed(undefined as unknown as Parameters<MenusFixture["restoreLastUsed"]>[0]);
    expect(Menus.state.lastUsedPath).toBeNull();
    expect(Menus.state.lastUsedMeta).toBeNull();
  });

  test("restoreLastUsed rejects malformed persisted values", () => {
    Menus.restoreLastUsed({
      lastUsedPath: { path: "legacy-object" },
      lastUsedMeta: { comment: 4, menuIndex: [1] },
    } as any);

    expect(Menus.state.lastUsedPath).toBeNull();
    expect(Menus.state.lastUsedMeta).toBeNull();
  });

  test("restoreLastUsed keeps a valid path but drops malformed routing metadata", () => {
    Menus.restoreLastUsed({
      lastUsedPath: "images",
      lastUsedMeta: { comment: "ok", menuIndex: 2 },
    } as any);

    expect(Menus.state.lastUsedPath).toBe("images");
    expect(Menus.state.lastUsedMeta).toBeNull();
  });

  test("restoreLastUsed rejects persisted paths that violate the path policy", () => {
    Menus.restoreLastUsed({
      lastUsedPath: "../escape",
      lastUsedMeta: { comment: "old", menuIndex: "1" },
    });

    expect(Menus.state.lastUsedPath).toBeNull();
    expect(Menus.state.lastUsedMeta).toBeNull();
  });

  test("setLastUsed mutates state and persists to storage.local", () => {
    Menus.setLastUsed("dir/x", { comment: "cm", menuIndex: "2" });
    expect(Menus.state.lastUsedPath).toBe("dir/x");
    expect(Menus.state.lastUsedMeta).toEqual({ comment: "cm", menuIndex: "2" });
    expect(global.browser.storage.local.set).toHaveBeenCalledWith({
      lastUsedPath: "dir/x",
      lastUsedMeta: { comment: "cm", menuIndex: "2" },
    });
  });

  test("setLastUsed ignores private-window activity", async () => {
    await Menus.setLastUsed("private/path", { comment: "secret", menuIndex: "9" }, true);

    expect(Menus.state.lastUsedPath).toBeNull();
    expect(global.browser.storage.local.set).not.toHaveBeenCalled();
  });
});
