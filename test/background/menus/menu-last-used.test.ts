import {
  addRecentDestinations,
  menuState,
  recordRecentDestination,
  restoreLastUsed,
  setLastUsed,
} from "../../../src/background/menu-build.ts";
import { setupBrowserMocks } from "./listeners.fixture.ts";

describe("Menus last-used state", () => {
  beforeEach(() => {
    setupBrowserMocks();
    restoreLastUsed(undefined);
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

  test("setLastUsed ignores private-window activity", async () => {
    await setLastUsed("private/path", { comment: "secret", menuIndex: "9" }, true);

    expect(menuState.lastUsedPath).toBeNull();
    expect(global.browser.storage.local.set).not.toHaveBeenCalled();
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
        comment: "photos",
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
      comment: "photos",
      menuIndex: "1",
      title: "Images",
      prompt: true,
    });

    expect(menuState.recentDestinations.map(({ path }) => path)).toEqual(["images", "documents"]);
    expect(global.browser.storage.local.set).toHaveBeenLastCalledWith({
      recentDestinations: menuState.recentDestinations,
    });
    const writes = vi.mocked(global.browser.storage.local.set).mock.calls.length;
    expect(
      await recordRecentDestination("images", {
        comment: "photos",
        menuIndex: "1",
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
