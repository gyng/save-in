import {
  addRecentDestinations,
  clearPrivateLastUsed,
  enablePrivateLastUsedMenu,
  menuState,
  recordRecentDestination,
  restoreLastUsed,
  restorePrivateLastUsed,
  setLastUsed,
  updateLastUsedMenu,
} from "../../../src/background/menu-build.ts";
import { setupBrowserMocks } from "./listeners.fixture.ts";

describe("Menus last-used state", () => {
  beforeEach(() => {
    setupBrowserMocks();
    restoreLastUsed(undefined);
    restorePrivateLastUsed(undefined);
  });

  test("restoreLastUsed maps a stored object into state, defaulting to null", () => {
    restoreLastUsed({
      lastUsedPath: "a/b",
      lastUsedMeta: { comment: "c" },
    });
    expect(menuState.lastUsedPath).toBe("a/b");
    expect(menuState.lastUsedMeta).toEqual({ comment: "c" });

    restoreLastUsed({
      lastUsedPath: "other/file",
      lastUsedMeta: { menuIndex: "2", title: "Saved file" },
    });
    expect(menuState.lastUsedMeta).toEqual({ menuIndex: "2", title: "Saved file" });

    restoreLastUsed(undefined);
    expect(menuState.lastUsedPath).toBeNull();
    expect(menuState.lastUsedMeta).toBeNull();
  });

  test("restoreLastUsed rejects malformed persisted values", () => {
    restoreLastUsed({
      lastUsedPath: { path: "legacy-object" },
      lastUsedMeta: { comment: 4, menuIndex: [1] },
    });

    expect(menuState.lastUsedPath).toBeNull();
    expect(menuState.lastUsedMeta).toBeNull();
  });

  test("restoreLastUsed keeps a valid path but drops malformed routing metadata", () => {
    restoreLastUsed({
      lastUsedPath: "images",
      lastUsedMeta: { comment: "ok", menuIndex: 2 },
    });

    expect(menuState.lastUsedPath).toBe("images");
    expect(menuState.lastUsedMeta).toBeNull();
  });

  test("restoreLastUsed rejects array-shaped routing metadata", () => {
    restoreLastUsed({
      lastUsedPath: "images",
      lastUsedMeta: [],
    });

    expect(menuState.lastUsedPath).toBe("images");
    expect(menuState.lastUsedMeta).toBeNull();
  });

  test("restoreLastUsed rejects persisted paths that violate the path policy", () => {
    restoreLastUsed({
      lastUsedPath: "../escape",
      lastUsedMeta: { comment: "old", menuIndex: "1" },
    });

    expect(menuState.lastUsedPath).toBeNull();
    expect(menuState.lastUsedMeta).toBeNull();
  });

  test("setLastUsed mutates state and persists to storage.local", () => {
    setLastUsed("dir/x", { comment: "cm", menuIndex: "2" });
    expect(menuState.lastUsedPath).toBe("dir/x");
    expect(menuState.lastUsedMeta).toEqual({ comment: "cm", menuIndex: "2" });
    expect(global.browser.storage.local.set).toHaveBeenCalledWith({
      lastUsedPath: "dir/x",
      lastUsedMeta: { comment: "cm", menuIndex: "2" },
    });
  });

  test("setLastUsed keeps private-window activity in session storage only", async () => {
    await setLastUsed("private/path", { comment: "secret", menuIndex: "9" }, true);

    expect(menuState.lastUsedPath).toBeNull();
    expect(menuState.privateLastUsedPath).toBe("private/path");
    expect(menuState.privateLastUsedMeta).toEqual({ comment: "secret", menuIndex: "9" });
    expect(global.browser.storage.local.set).not.toHaveBeenCalled();
    expect(global.browser.storage.session.set).toHaveBeenCalledWith({
      siPrivateLastUsed: {
        path: "private/path",
        meta: { comment: "secret", menuIndex: "9" },
      },
    });
  });

  test("contains private-session persistence failures", async () => {
    vi.mocked(global.browser.storage.session.set).mockRejectedValueOnce(new Error("unavailable"));

    await expect(setLastUsed("private/path", { title: "Private folder" }, true)).resolves.toBe(
      undefined,
    );

    expect(menuState.privateLastUsedPath).toBe("private/path");
  });

  test("restores and clears a private-session Last used destination", async () => {
    restorePrivateLastUsed({
      siPrivateLastUsed: {
        path: "private/path",
        meta: { comment: "private", menuIndex: "3", title: "Private folder" },
      },
    });

    expect(menuState.privateLastUsedPath).toBe("private/path");
    expect(menuState.privateLastUsedMeta).toEqual({
      comment: "private",
      menuIndex: "3",
      title: "Private folder",
    });

    await clearPrivateLastUsed();

    expect(menuState.privateLastUsedPath).toBeNull();
    expect(menuState.privateLastUsedMeta).toBeNull();
    expect(global.browser.storage.session.remove).toHaveBeenCalledWith("siPrivateLastUsed");
  });

  test("contains private-session cleanup failures", async () => {
    await setLastUsed("private/path", { title: "Private folder" }, true);
    vi.mocked(global.browser.storage.session.remove).mockRejectedValueOnce(
      new Error("unavailable"),
    );

    await expect(clearPrivateLastUsed()).resolves.toBe(undefined);

    expect(menuState.privateLastUsedPath).toBeNull();
  });

  test("renders an unavailable generic Last used item without stored state", async () => {
    await updateLastUsedMenu();

    expect(global.browser.contextMenus.update).toHaveBeenCalledWith("save-in-last-used", {
      title: "Translat&ed<contextMenuLastUsed>",
      enabled: false,
    });
  });

  test("keeps the regular title when enabling private Last used on static menus", async () => {
    await setLastUsed("regular/path", { title: "Regular folder" });
    await setLastUsed("private/path", { title: "Private folder" }, true);
    vi.mocked(global.browser.contextMenus.update).mockClear();

    await enablePrivateLastUsedMenu();

    expect(global.browser.contextMenus.update).toHaveBeenCalledWith("save-in-last-used", {
      title: "R&egular folder",
      enabled: true,
    });
  });

  test("rejects malformed private-session Last used state", () => {
    restorePrivateLastUsed({
      siPrivateLastUsed: { path: "../escape", meta: { comment: 4 } },
    });

    expect(menuState.privateLastUsedPath).toBeNull();
    expect(menuState.privateLastUsedMeta).toBeNull();
  });

  test("restores only valid recent destinations", () => {
    restoreLastUsed({
      recentDestinations: [
        null,
        { path: 3, meta: {} },
        { path: "docs", meta: { comment: "docs", menuIndex: "2" } },
        {
          path: "images",
          meta: { comment: "photos", menuIndex: "1", title: "Images", prompt: true },
        },
        { path: "../escape", meta: { comment: "bad", menuIndex: "2", title: "Bad" } },
        { path: "docs", meta: { comment: 2, menuIndex: "3", title: "Docs" } },
      ],
    });

    expect(menuState.recentDestinations).toEqual([
      {
        path: "docs",
        meta: { comment: "docs", menuIndex: "2", title: "docs" },
      },
      {
        path: "images",
        meta: { comment: "photos", menuIndex: "1", title: "Images", prompt: true },
      },
    ]);
  });

  test("records recent destinations newest-first without duplicates", async () => {
    expect(
      await recordRecentDestination("images", {
        comment: "0photos",
        menuIndex: "1",
        title: "Images",
        prompt: true,
      }),
    ).toBe(true);
    await recordRecentDestination("documents", {
      comment: "docs",
      menuIndex: "2",
      title: "Documents",
    });
    await recordRecentDestination("images", {
      comment: "1photos",
      menuIndex: "2",
      title: "Images",
      prompt: true,
    });

    expect(menuState.recentDestinations.map(({ path }) => path)).toEqual(["images", "documents"]);
    expect(menuState.recentDestinations[0]?.meta).toMatchObject({
      comment: "1photos",
      menuIndex: "2",
    });
    expect(global.browser.storage.local.set).toHaveBeenLastCalledWith({
      recentDestinations: menuState.recentDestinations,
    });
    const writes = vi.mocked(global.browser.storage.local.set).mock.calls.length;
    expect(
      await recordRecentDestination("images", {
        comment: "1photos",
        menuIndex: "2",
        title: "Images",
        prompt: true,
      }),
    ).toBe(false);
    expect(global.browser.storage.local.set).toHaveBeenCalledTimes(writes);
  });

  test("ignores private destinations and contains persistence failures", async () => {
    await recordRecentDestination(
      "private",
      { comment: "private", menuIndex: "1", title: "Private" },
      true,
    );
    vi.mocked(global.browser.storage.local.set).mockRejectedValueOnce(new Error("unavailable"));
    await expect(
      recordRecentDestination("public", {
        comment: "public",
        menuIndex: "2",
        title: "Public",
      }),
    ).resolves.toBe(true);

    expect(menuState.recentDestinations.map(({ path }) => path)).toEqual(["public"]);
  });

  test("uses fallback copy when rendering recent destinations", () => {
    restoreLastUsed({
      recentDestinations: [
        { path: "images", meta: { comment: "photos", menuIndex: "1", title: "Rock & Roll" } },
      ],
    });
    vi.mocked(global.browser.i18n.getMessage).mockReturnValue("");

    addRecentDestinations(["image"]);

    expect(global.browser.contextMenus.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Recent locations" }),
    );
    expect(global.browser.contextMenus.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Rock && Roll" }),
    );
  });
});
