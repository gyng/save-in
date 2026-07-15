// @vitest-environment jsdom
import {
  SOURCE_PANEL_LAYOUT_STORAGE_KEY,
  SOURCE_PANEL_SORT_STORAGE_KEY,
} from "../../src/shared/storage-keys.ts";

type StorageCallback = (stored: Record<string, unknown>) => void;

const mockCallbackStorageGet = (read: (key: string, callback: StorageCallback) => void): void => {
  vi.mocked(chrome.storage.local.get).mockImplementation(((
    key: string,
    callback: StorageCallback,
  ) => read(key, callback)) as never);
};

describe("Page Sources panel callback storage", () => {
  afterEach(() => {
    document.getElementById("save-in-source-panel")?.remove();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.resetModules();
  });

  test("loads normalized layout and sort values and persists changes", async () => {
    mockCallbackStorageGet((key, callback) => {
      callback(
        key === SOURCE_PANEL_LAYOUT_STORAGE_KEY
          ? {
              [key]: {
                placement: "floating",
                sideWidth: 444,
                dockHeight: Number.POSITIVE_INFINITY,
                floatingLeft: 22,
                floatingTop: "invalid",
                floatingWidth: 640,
                floatingHeight: 500,
              },
            }
          : { [key]: "name-asc" },
      );
    });
    vi.mocked(chrome.storage.local.set).mockImplementation(((
      _value: unknown,
      callback: () => void,
    ) => callback()) as never);
    const { getSourcePanelHostForTesting, toggleSourcePanel } =
      await import("../../src/content/source-panel.ts");

    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const host = getSourcePanelHostForTesting()!;
    const shadow = host.shadowRoot!;
    expect(host.dataset.dock).toBe("floating");
    expect(host.style.getPropertyValue("--source-panel-side-size")).toBe("444px");
    expect(host.style.getPropertyValue("--source-panel-dock-size")).toBe("420px");
    expect(host.style.getPropertyValue("--source-panel-floating-top")).toBe("80px");
    expect(
      shadow.querySelector<HTMLSelectElement>('select[aria-label="Sort sources"]')?.value,
    ).toBe("name-asc");

    shadow.querySelector<HTMLButtonElement>('[data-placement="bottom"]')!.click();
    const sort = shadow.querySelector<HTMLSelectElement>('select[aria-label="Sort sources"]')!;
    sort.value = "detected-asc";
    sort.dispatchEvent(new Event("change"));
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(2);
  });

  test.each([null, { placement: "invalid" }])(
    "falls back from malformed stored layout %#",
    async (storedLayout) => {
      mockCallbackStorageGet((key, callback) =>
        callback({ [key]: key === SOURCE_PANEL_LAYOUT_STORAGE_KEY ? storedLayout : "invalid" }),
      );
      const { getSourcePanelHostForTesting, toggleSourcePanel } =
        await import("../../src/content/source-panel.ts");

      toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
      expect(getSourcePanelHostForTesting()!.dataset.dock).toBe("right");
    },
  );

  test("does not overwrite a sort changed before storage responds", async () => {
    let sortCallback: StorageCallback | undefined;
    mockCallbackStorageGet((key, callback) => {
      if (key === SOURCE_PANEL_LAYOUT_STORAGE_KEY) callback({});
      else sortCallback = callback;
    });
    const { getSourcePanelHostForTesting, toggleSourcePanel } =
      await import("../../src/content/source-panel.ts");
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const sort = getSourcePanelHostForTesting()!.shadowRoot!.querySelector<HTMLSelectElement>(
      'select[aria-label="Sort sources"]',
    )!;
    sort.value = "size-desc";
    sort.dispatchEvent(new Event("change"));
    sortCallback?.({ [SOURCE_PANEL_SORT_STORAGE_KEY]: "name-asc" });

    expect(sort.value).toBe("size-desc");
  });

  test("does not apply a sort after its panel is detached", async () => {
    let sortCallback: StorageCallback | undefined;
    mockCallbackStorageGet((key, callback) => {
      if (key === SOURCE_PANEL_LAYOUT_STORAGE_KEY) callback({});
      else sortCallback = callback;
    });
    const { getSourcePanelHostForTesting, toggleSourcePanel } =
      await import("../../src/content/source-panel.ts");
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    getSourcePanelHostForTesting()!.remove();
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    sortCallback?.({ [SOURCE_PANEL_SORT_STORAGE_KEY]: "name-asc" });

    expect(getSourcePanelHostForTesting()).not.toBeNull();
  });

  test("contains storage failures from an invalidated extension context", async () => {
    vi.mocked(chrome.storage.local.get).mockImplementation(() => {
      throw new Error("invalidated");
    });
    vi.mocked(chrome.storage.local.set).mockImplementation(() => {
      throw new Error("invalidated");
    });
    const { getSourcePanelHostForTesting, toggleSourcePanel } =
      await import("../../src/content/source-panel.ts");

    expect(() =>
      toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false }),
    ).not.toThrow();
    const shadow = getSourcePanelHostForTesting()!.shadowRoot!;
    expect(() =>
      shadow.querySelector<HTMLButtonElement>('[data-placement="left"]')!.click(),
    ).not.toThrow();
    expect(() => {
      const sort = shadow.querySelector<HTMLSelectElement>('select[aria-label="Sort sources"]')!;
      sort.value = "name-asc";
      sort.dispatchEvent(new Event("change"));
    }).not.toThrow();
  });
});
