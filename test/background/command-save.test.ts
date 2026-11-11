import { options } from "../../src/config/options-data.ts";
import { menuState } from "../../src/background/menu-build.ts";
import { backgroundRuntime } from "../../src/background/runtime.ts";
import { isPointerCommand, runPointerCommand } from "../../src/background/command-save.ts";
import { openPickerForActiveTab } from "../../src/background/destination-picker.ts";
import { hoveredClickInfo, readHoveredSource } from "../../src/background/hovered-source.ts";
import { handleContextMenuClick, lastUsedMenuExists } from "../../src/background/menu-click.ts";

vi.mock("../../src/background/destination-picker.ts", () => ({
  openPickerForActiveTab: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../src/background/menu-click.ts", () => ({
  handleContextMenuClick: vi.fn(() => Promise.resolve()),
  lastUsedMenuExists: vi.fn(() => true),
}));

const tab = { id: 9, url: "https://example.com/page", title: "P" };
const mapping = (parsedDir: string) => ({ parsedDir, comment: "", menuIndex: "1", title: "" });

beforeEach(() => {
  vi.mocked(handleContextMenuClick).mockClear();
  vi.mocked(lastUsedMenuExists).mockReturnValue(true);
  backgroundRuntime.ready = Promise.resolve();
  options.paths = "first\nparent\n>child\n---\nthird";
  menuState.pathMappings = {
    "save-in-0": mapping("first"),
    "save-in-1": mapping("parent"),
    "save-in-2": mapping("parent/child"),
    "save-in-4": mapping("third"),
  };
  global.browser.tabs.query = vi.fn(() => Promise.resolve([tab])) as never;
  global.browser.tabs.sendMessage = vi.fn(() => Promise.resolve(null)) as never;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("save commands", () => {
  test("recognizes only the commands that act on the pointer", () => {
    expect(
      ["save-last-used", "save-folder-1", "save-folder-2", "save-folder-3", "open-picker"].map(
        isPointerCommand,
      ),
    ).toEqual([true, true, true, true, true]);
    expect(["quick-save", "save-folder-4", "toggle-source-panel"].map(isPointerCommand)).toEqual([
      false,
      false,
      false,
    ]);
  });

  test("the picker command opens the picker instead of saving", async () => {
    await runPointerCommand("open-picker");

    expect(openPickerForActiveTab).toHaveBeenCalledOnce();
    expect(handleContextMenuClick).not.toHaveBeenCalled();
  });

  test("saves the page to the Nth pickable folder, skipping submenu headings", async () => {
    await runPointerCommand("save-folder-1");
    await runPointerCommand("save-folder-2");
    await runPointerCommand("save-folder-3");

    expect(vi.mocked(handleContextMenuClick).mock.calls).toEqual([
      [{ menuItemId: "save-in-0", pageUrl: tab.url }, tab],
      [{ menuItemId: "save-in-2", pageUrl: tab.url }, tab],
      [{ menuItemId: "save-in-4", pageUrl: tab.url }, tab],
    ]);
    expect(global.browser.tabs.sendMessage).toHaveBeenCalledWith(
      9,
      { type: "SAVE_IN_HOVERED_SOURCE" },
      { frameId: 0 },
    );
  });

  test("saves the hovered media and link as a menu click would report them", async () => {
    global.browser.tabs.sendMessage = vi.fn(() =>
      Promise.resolve({
        media: { url: "https://img.example.com/a.png", kind: "image" },
        linkUrl: "https://example.com/full",
      }),
    ) as never;

    await runPointerCommand("save-last-used");

    expect(handleContextMenuClick).toHaveBeenCalledWith(
      {
        menuItemId: "save-in-last-used",
        pageUrl: tab.url,
        srcUrl: "https://img.example.com/a.png",
        mediaType: "image",
        linkUrl: "https://example.com/full",
      },
      tab,
    );
  });

  test("does nothing for a destination the menu does not offer", async () => {
    // A cold start can deliver the command before init assigns the promise.
    Reflect.deleteProperty(backgroundRuntime, "ready");
    options.paths = "only";
    await runPointerCommand("save-folder-2");

    // Folders hidden from the menu have no mapping to pick.
    menuState.pathMappings = {};
    await runPointerCommand("save-folder-1");

    vi.mocked(lastUsedMenuExists).mockReturnValue(false);
    await runPointerCommand("save-last-used");
    await runPointerCommand("unrelated");

    expect(handleContextMenuClick).not.toHaveBeenCalled();
    expect(global.browser.tabs.query).not.toHaveBeenCalled();
  });

  test("does nothing without an active tab address", async () => {
    global.browser.tabs.query = vi.fn(() => Promise.resolve([])) as never;
    await runPointerCommand("save-folder-1");
    global.browser.tabs.query = vi.fn(() => Promise.resolve([{ id: 9 }])) as never;
    await runPointerCommand("save-folder-1");

    expect(handleContextMenuClick).not.toHaveBeenCalled();
  });
});

describe("hovered source lookup", () => {
  test.each([
    ["a tab without an id", { url: "https://example.com/" }],
    ["no tab", null],
  ])("skips %s", async (_label, target) => {
    expect(await readHoveredSource(target)).toBeNull();
    expect(global.browser.tabs.sendMessage).not.toHaveBeenCalled();
  });

  test.each([
    ["a restricted page rejects the message", () => Promise.reject(new Error("no receiver"))],
    [
      "the tab cannot be messaged at all",
      () => {
        throw new Error("tab closed");
      },
    ],
    ["an older content script answers nothing", () => Promise.resolve(undefined)],
    ["the answer is not a fetchable address", () => Promise.resolve({ linkUrl: "javascript:1" })],
  ])("falls back to the page when %s", async (_label, answer) => {
    global.browser.tabs.sendMessage = vi.fn(answer) as never;
    expect(await readHoveredSource(tab)).toBeNull();
  });

  test("stops waiting for a content script that never answers", async () => {
    vi.useFakeTimers();
    global.browser.tabs.sendMessage = vi.fn(() => new Promise(() => {})) as never;
    const pending = readHoveredSource(tab);
    await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toBeNull();
  });

  test("maps the answer onto menu click fields", () => {
    expect(hoveredClickInfo(null)).toEqual({});
    expect(hoveredClickInfo({ linkUrl: "https://example.com/a" })).toEqual({
      linkUrl: "https://example.com/a",
    });
    expect(
      hoveredClickInfo({ media: { url: "https://example.com/v.mp4", kind: "video" } }),
    ).toEqual({ srcUrl: "https://example.com/v.mp4", mediaType: "video" });
  });
});
