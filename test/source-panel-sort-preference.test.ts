// @vitest-environment jsdom
import { getSourcePanelHostForTesting, toggleSourcePanel } from "../src/content/source-panel.ts";
import { SOURCE_PANEL_SORT_STORAGE_KEY } from "../src/shared/storage-keys.ts";

const openPanel = (): HTMLSelectElement => {
  toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
  return getSourcePanelHostForTesting()!.shadowRoot!.querySelector<HTMLSelectElement>("select")!;
};

describe("Page Sources sort preference", () => {
  afterEach(() => {
    getSourcePanelHostForTesting()?.remove();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  test("defaults to relevance when no valid preference is stored", () => {
    vi.spyOn(global.chrome.storage.local, "get").mockImplementation(((
      _key: string,
      callback: (stored: Record<string, unknown>) => void,
    ) => callback({ [SOURCE_PANEL_SORT_STORAGE_KEY]: "unexpected" })) as any);

    expect(openPanel().value).toBe("relevance");
  });

  test("restores and persists the selected sort across panel instances", () => {
    const stored: Record<string, unknown> = {
      [SOURCE_PANEL_SORT_STORAGE_KEY]: "name-asc",
    };
    vi.spyOn(global.chrome.storage.local, "get").mockImplementation(((
      _key: string,
      callback: (values: Record<string, unknown>) => void,
    ) => callback({ ...stored })) as any);
    const set = vi.spyOn(global.chrome.storage.local, "set").mockImplementation(((
      values: Record<string, unknown>,
      callback?: () => void,
    ) => {
      Object.assign(stored, values);
      callback?.();
    }) as any);

    const first = openPanel();
    expect(first.value).toBe("name-asc");

    first.value = "size-desc";
    first.dispatchEvent(new Event("change"));
    expect(set).toHaveBeenCalledWith(
      { [SOURCE_PANEL_SORT_STORAGE_KEY]: "size-desc" },
      expect.any(Function),
    );

    getSourcePanelHostForTesting()!.remove();
    expect(openPanel().value).toBe("size-desc");
  });
});
