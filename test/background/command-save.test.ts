import { options } from "../../src/config/options-data.ts";
import { backgroundRuntime } from "../../src/background/runtime.ts";
import { isPointerCommand, runPointerCommand } from "../../src/background/command-save.ts";
import { openPickerForActiveTab } from "../../src/background/destination-picker.ts";
import { hoveredClickInfo, readHoveredSource } from "../../src/background/hovered-source.ts";
import { handleContextMenuClick } from "../../src/background/menu-click.ts";

vi.mock("../../src/background/destination-picker.ts", () => ({
  openPickerForActiveTab: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../src/background/menu-click.ts", () => ({
  handleContextMenuClick: vi.fn(() => Promise.resolve()),
}));

const tab = { id: 9, url: "https://example.com/page", title: "P" };
const destination = (parsedDir: string) => expect.objectContaining({ parsedDir });

beforeEach(() => {
  vi.mocked(handleContextMenuClick).mockClear();
  backgroundRuntime.ready = Promise.resolve();
  options.paths = "first\nparent\n>child\n---\nthird";
  global.browser.tabs.query = vi.fn(() => Promise.resolve([tab])) as never;
  global.browser.tabs.sendMessage = vi.fn(() => Promise.resolve({ hovered: null })) as never;
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
      [{ menuItemId: "save-in-0", pageUrl: tab.url }, tab, destination("first")],
      [{ menuItemId: "save-in-2", pageUrl: tab.url }, tab, destination("child")],
      [{ menuItemId: "save-in-4", pageUrl: tab.url }, tab, destination("third")],
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
        hovered: {
          media: { url: "https://img.example.com/a.png", kind: "image" },
          linkUrl: "https://example.com/full",
        },
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
      undefined,
    );
  });

  test("does nothing for a folder that is not configured", async () => {
    // A cold start can deliver the command before init assigns the promise.
    Reflect.deleteProperty(backgroundRuntime, "ready");
    options.paths = "only";
    await runPointerCommand("save-folder-2");
    await runPointerCommand("unrelated");

    expect(handleContextMenuClick).not.toHaveBeenCalled();
    expect(global.browser.tabs.query).not.toHaveBeenCalled();
  });

  // A bound key is its own opt-in: the command carries the folder it names, so
  // it does not depend on the menu having rendered that item.
  test("names its folder itself rather than relying on the rendered menu", async () => {
    options.paths = "Inbox // (dialog: true)";

    await runPointerCommand("save-folder-1");

    expect(handleContextMenuClick).toHaveBeenCalledWith(
      { menuItemId: "save-in-0", pageUrl: tab.url },
      tab,
      expect.objectContaining({ parsedDir: "Inbox", prompt: true }),
    );
  });

  // No answer says nothing about the pointer: a tab loaded before an install
  // or update has no current content script, and saving the whole page in
  // place of the image under the pointer would be a wrong guess.
  test.each(["https://example.com/page", "HTTP://example.com/", "file:///home/u/a.html"])(
    "does nothing when a page that runs the content script gives no answer (%s)",
    async (url) => {
      global.browser.tabs.query = vi.fn(() => Promise.resolve([{ ...tab, url }])) as never;
      global.browser.tabs.sendMessage = vi.fn(() => Promise.resolve(undefined)) as never;

      await runPointerCommand("save-folder-1");

      expect(handleContextMenuClick).not.toHaveBeenCalled();
    },
  );

  test("still saves the page where the content script can never run", async () => {
    const restricted = { ...tab, url: "about:addons" };
    global.browser.tabs.query = vi.fn(() => Promise.resolve([restricted])) as never;
    global.browser.tabs.sendMessage = vi.fn(() =>
      Promise.reject(new Error("no receiver")),
    ) as never;

    await runPointerCommand("save-folder-1");

    expect(handleContextMenuClick).toHaveBeenCalledWith(
      { menuItemId: "save-in-0", pageUrl: "about:addons" },
      restricted,
      destination("first"),
    );
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
    expect(await readHoveredSource(target)).toBeUndefined();
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
    ["a content script answers nothing", () => Promise.resolve(undefined)],
    // Before the answer was wrapped, a content script sent the source bare.
    [
      "an older content script answers in the unwrapped shape",
      () => Promise.resolve({ linkUrl: "https://example.com/a" }),
    ],
    ["an older content script answers a bare null", () => Promise.resolve(null)],
  ])("reports no answer when %s", async (_label, answer) => {
    global.browser.tabs.sendMessage = vi.fn(answer) as never;
    expect(await readHoveredSource(tab)).toBeUndefined();
  });

  test.each([
    ["nothing is hovered", null],
    ["the hovered address is not fetchable", { linkUrl: "javascript:1" }],
  ])("reports an answer of nothing hovered when %s", async (_label, hovered) => {
    global.browser.tabs.sendMessage = vi.fn(() => Promise.resolve({ hovered })) as never;
    expect(await readHoveredSource(tab)).toBeNull();
  });

  test("unwraps the hovered source", async () => {
    global.browser.tabs.sendMessage = vi.fn(() =>
      Promise.resolve({ hovered: { linkUrl: "https://example.com/a" } }),
    ) as never;
    expect(await readHoveredSource(tab)).toEqual({ linkUrl: "https://example.com/a" });
  });

  test("stops waiting for a content script that never answers", async () => {
    vi.useFakeTimers();
    global.browser.tabs.sendMessage = vi.fn(() => new Promise(() => {})) as never;
    const pending = readHoveredSource(tab);
    await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toBeUndefined();
  });

  test("maps the answer onto menu click fields", () => {
    expect(hoveredClickInfo(null)).toEqual({});
    expect(hoveredClickInfo({ linkUrl: "https://example.com/a" })).toEqual({
      linkUrl: "https://example.com/a",
    });
    expect(
      hoveredClickInfo({ media: { url: "https://example.com/v.mp4", kind: "video" } }),
    ).toEqual({ srcUrl: "https://example.com/v.mp4", mediaType: "video" });
    expect(
      hoveredClickInfo({
        media: { url: "https://example.com/a.png", kind: "image", alt: "Misty forest" },
      }),
    ).toEqual({ srcUrl: "https://example.com/a.png", mediaType: "image", altText: "Misty forest" });
  });
});
