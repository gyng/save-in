// @vitest-environment jsdom
import {
  getSourcePanelHostForTesting,
  replaceSourcePanel,
  resetSourcePanelLayoutForTesting,
  setSourcePanelOpen,
  toggleSourcePanel,
} from "../../../src/content/source-panel.ts";
import { createSourcePanelCopy } from "../../../src/shared/source-panel-copy.ts";
import { SOURCE_PANEL_LAYOUT_STORAGE_KEY } from "../../../src/shared/storage-keys.ts";

describe("page source localization", () => {
  afterEach(() => document.getElementById("save-in-source-panel")?.remove());

  test("renders one resolved copy object without localizing during discovery", () => {
    const french = new Map([
      ["o_sPageSources", "Sources de la page"],
      ["html_filterSources", "Filtrer les sources"],
      ["sourcePanelLocate", "Repérer"],
      ["sourcePanelSave", "Enregistrer"],
    ]);
    const copy = createSourcePanelCopy((key) => french.get(key) || "");
    document.body.innerHTML = `<img src="cat.jpg">`;

    toggleSourcePanel(vi.fn(), { copy, includeBackgrounds: false, live: false });

    const shadow = document.getElementById("save-in-source-panel")!.shadowRoot!;
    expect(shadow.querySelector("h2")?.textContent).toBe("Sources de la page");
    expect(shadow.querySelector<HTMLInputElement>('input[type="search"]')?.placeholder).toBe(
      "Filtrer les sources",
    );
    const actions = [...shadow.querySelectorAll(".actions button")].map(
      (button) => button.textContent,
    );
    expect(actions).toContain("Repérer");
    expect(actions).toContain("Enregistrer");
  });
});

describe("Page Sources panel interactions", () => {
  afterEach(() => {
    getSourcePanelHostForTesting()?.remove();
    document.querySelectorAll("#save-in-source-panel").forEach((host) => host.remove());
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    document.documentElement.style.removeProperty("overflow");
    (globalThis as { SAVE_IN_CONTENT_E2E?: boolean }).SAVE_IN_CONTENT_E2E = true;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetSourcePanelLayoutForTesting();
    void chrome.storage.local.clear();
  });

  test("uses a closed owned host without removing a page ID collision", () => {
    (globalThis as { SAVE_IN_CONTENT_E2E?: boolean }).SAVE_IN_CONTENT_E2E = false;
    const impostor = document.createElement("div");
    impostor.id = "save-in-source-panel";
    document.body.append(impostor);

    expect(toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false })).toBe(true);
    const ownedHost = getSourcePanelHostForTesting();

    expect(ownedHost).not.toBe(impostor);
    expect(ownedHost?.shadowRoot).toBeNull();
    expect(impostor.isConnected).toBe(true);
  });

  test("does not open when the panel is disabled", () => {
    expect(toggleSourcePanel(vi.fn(), { enabled: false })).toBe(false);
    expect(getSourcePanelHostForTesting()).toBeNull();
  });

  test("ignores a second close while the exit transition is active", () => {
    vi.useFakeTimers();
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const close =
      getSourcePanelHostForTesting()!.shadowRoot!.querySelector<HTMLButtonElement>(".close")!;

    close.click();
    close.click();

    expect(getSourcePanelHostForTesting()?.classList).toContain("closing");
  });

  test("normalizes generated and invalid locales for panel formatting", () => {
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false, locale: "fr_AI" });
    expect(getSourcePanelHostForTesting()).not.toBeNull();
    setSourcePanelOpen(false, vi.fn(), { includeBackgrounds: false, live: false });
    getSourcePanelHostForTesting()?.remove();

    toggleSourcePanel(vi.fn(), {
      includeBackgrounds: false,
      live: false,
      locale: "invalid_locale_value",
    });
    expect(getSourcePanelHostForTesting()).not.toBeNull();
  });

  test("resizes every dock orientation and drags a floating panel", () => {
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const host = getSourcePanelHostForTesting()!;
    host.dataset.dock = "invalid";
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue({
      left: 80,
      top: 60,
      right: 480,
      bottom: 360,
      width: 400,
      height: 300,
      x: 80,
      y: 60,
      toJSON: () => ({}),
    });
    const shadow = host.shadowRoot!;
    const resize = shadow.querySelector<HTMLElement>(".resize")!;
    resize.setPointerCapture = vi.fn();
    const pointer = (type: string, x: number, y: number, target?: Element) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperties(event, {
        pointerId: { value: 1 },
        clientX: { value: x },
        clientY: { value: y },
        button: { value: 0 },
      });
      (target || resize).dispatchEvent(event);
    };

    pointer("pointerdown", 400, 300);
    pointer("pointermove", 300, 300);
    pointer("pointerup", 300, 300);
    expect(host.style.getPropertyValue("--source-panel-side-size")).not.toBe("");

    shadow.querySelector<HTMLButtonElement>('[data-placement="bottom"]')!.click();
    pointer("pointerdown", 400, 300);
    pointer("pointermove", 400, 200);
    pointer("pointerup", 400, 200);
    expect(host.style.getPropertyValue("--source-panel-dock-size")).not.toBe("");

    shadow.querySelector<HTMLButtonElement>('[data-placement="left"]')!.click();
    pointer("pointerdown", 300, 300);
    pointer("pointermove", 380, 300);
    pointer("pointerup", 380, 300);
    expect(host.style.getPropertyValue("--source-panel-side-size")).not.toBe("");

    shadow.querySelector<HTMLButtonElement>('[data-placement="top"]')!.click();
    pointer("pointerdown", 400, 200);
    pointer("pointermove", 400, 280);
    pointer("pointerup", 400, 280);
    expect(host.style.getPropertyValue("--source-panel-dock-size")).not.toBe("");

    shadow.querySelector<HTMLButtonElement>('[data-placement="floating"]')!.click();
    const header = shadow.querySelector<HTMLElement>("header")!;
    header.setPointerCapture = vi.fn();
    pointer("pointerdown", 100, 100, header);
    pointer("pointermove", 180, 160, header);
    pointer("pointerup", 180, 160, header);
    expect(host.style.getPropertyValue("--source-panel-floating-left")).not.toBe("");
    expect(host.style.getPropertyValue("--source-panel-floating-top")).not.toBe("");

    shadow.querySelector<HTMLButtonElement>('[data-placement="right"]')!.click();
    expect(host.classList).not.toContain("floating");
  });

  test("ignores panel dragging from controls and while docked", () => {
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const shadow = getSourcePanelHostForTesting()!.shadowRoot!;
    const header = shadow.querySelector<HTMLElement>("header")!;
    header.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    shadow.querySelector<HTMLButtonElement>('[data-placement="floating"]')!.click();
    shadow
      .querySelector<HTMLButtonElement>(".close")!
      .dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    expect(getSourcePanelHostForTesting()).not.toBeNull();
  });

  test("moves dock boundaries in their visual direction and preserves unrelated dimensions", () => {
    const set = vi.spyOn(global.chrome.storage.local, "set");
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const host = getSourcePanelHostForTesting()!;
    const shadow = host.shadowRoot!;
    const resize = shadow.querySelector<HTMLElement>(".resize")!;
    const initialWidth = Number(resize.getAttribute("aria-valuenow"));

    resize.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(Number(resize.getAttribute("aria-valuenow"))).toBeGreaterThan(initialWidth);
    expect(resize.getAttribute("aria-orientation")).toBe("vertical");

    shadow.querySelector<HTMLButtonElement>('[data-placement="bottom"]')!.click();
    const initialBottomHeight = Number(resize.getAttribute("aria-valuenow"));
    resize.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(Number(resize.getAttribute("aria-valuenow"))).toBeGreaterThan(initialBottomHeight);
    expect(host.dataset.dock).toBe("bottom");
    expect(resize.getAttribute("aria-orientation")).toBe("horizontal");

    shadow.querySelector<HTMLButtonElement>('[data-placement="floating"]')!.click();
    const initialFloatingWidth = host.style.getPropertyValue("--source-panel-floating-width");
    resize.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    const resizedFloatingWidth = host.style.getPropertyValue("--source-panel-floating-width");
    expect(resizedFloatingWidth).not.toBe(initialFloatingWidth);

    shadow.querySelector<HTMLButtonElement>('[data-placement="right"]')!.click();
    resize.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    shadow.querySelector<HTMLButtonElement>('[data-placement="floating"]')!.click();
    expect(host.style.getPropertyValue("--source-panel-floating-width")).toBe(resizedFloatingWidth);

    shadow.querySelector<HTMLButtonElement>('[data-placement="bottom"]')!.click();
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        [SOURCE_PANEL_LAYOUT_STORAGE_KEY]: expect.objectContaining({ placement: "bottom" }),
      }),
      expect.any(Function),
    );

    host.remove();
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    expect(getSourcePanelHostForTesting()!.dataset.dock).toBe("bottom");
  });

  test("supports every resize key, floating pointer resize, and reset direction", () => {
    vi.stubGlobal("visualViewport", {
      offsetLeft: 4,
      offsetTop: 6,
      width: 900,
      height: 700,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const host = getSourcePanelHostForTesting()!;
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue({
      left: 80,
      top: 60,
      right: 600,
      bottom: 680,
      width: 520,
      height: 620,
      x: 80,
      y: 60,
      toJSON: () => ({}),
    });
    const shadow = host.shadowRoot!;
    const resize = shadow.querySelector<HTMLElement>(".resize")!;
    resize.setPointerCapture = vi.fn();
    const key = (value: string, shiftKey = false) => {
      const event = new KeyboardEvent("keydown", {
        key: value,
        shiftKey,
        bubbles: true,
        cancelable: true,
      });
      resize.dispatchEvent(event);
      return event;
    };

    expect(key("ArrowRight").defaultPrevented).toBe(true);
    expect(host.style.getPropertyValue("--source-panel-side-size")).toBe("388px");
    expect(key("PageDown").defaultPrevented).toBe(false);
    expect(host.style.getPropertyValue("--source-panel-side-size")).toBe("388px");
    shadow.querySelector<HTMLButtonElement>('[data-placement="left"]')!.click();
    expect(key("ArrowLeft", true).defaultPrevented).toBe(true);
    expect(host.style.getPropertyValue("--source-panel-side-size")).toBe("356px");
    key("ArrowRight");
    expect(host.style.getPropertyValue("--source-panel-side-size")).toBe("368px");
    key("PageDown");
    expect(host.style.getPropertyValue("--source-panel-side-size")).toBe("368px");
    shadow.querySelector<HTMLButtonElement>('[data-placement="top"]')!.click();
    key("ArrowUp");
    expect(host.style.getPropertyValue("--source-panel-dock-size")).toBe("408px");
    key("ArrowDown");
    expect(host.style.getPropertyValue("--source-panel-dock-size")).toBe("420px");
    key("PageDown");
    expect(host.style.getPropertyValue("--source-panel-dock-size")).toBe("420px");
    resize.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(host.style.getPropertyValue("--source-panel-dock-size")).toBe("420px");
    shadow.querySelector<HTMLButtonElement>('[data-placement="bottom"]')!.click();
    key("ArrowDown");
    expect(host.style.getPropertyValue("--source-panel-dock-size")).toBe("408px");
    shadow.querySelector<HTMLButtonElement>('[data-placement="floating"]')!.click();
    key("ArrowLeft");
    expect(host.style.getPropertyValue("--source-panel-floating-width")).toBe("508px");
    key("ArrowRight");
    expect(host.style.getPropertyValue("--source-panel-floating-width")).toBe("520px");
    key("ArrowUp");
    expect(host.style.getPropertyValue("--source-panel-floating-height")).toBe("608px");
    key("ArrowDown");
    expect(host.style.getPropertyValue("--source-panel-floating-height")).toBe("620px");
    key("PageDown");
    expect(resize.getAttribute("aria-valuetext")).toBe("520 × 620");

    resize.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerId: 12,
        clientX: 500,
        clientY: 500,
      }),
    );
    resize.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 12,
        clientX: 540,
        clientY: 550,
      }),
    );
    resize.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 12 }));
    expect(host.style.getPropertyValue("--source-panel-floating-width")).toBe("560px");
    expect(host.style.getPropertyValue("--source-panel-floating-height")).toBe("670px");
    resize.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

    expect(host.style.getPropertyValue("--source-panel-floating-width")).toBe("520px");
    expect(host.style.getPropertyValue("--source-panel-floating-height")).toBe("620px");
  });

  test("keeps row actions clickable and supports keyboard-complete menus", async () => {
    document.body.innerHTML = `<img src="cat.jpg">`;
    const image = document.querySelector<HTMLImageElement>("img")!;
    image.scrollIntoView = vi.fn();
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const shadow = getSourcePanelHostForTesting()!.shadowRoot!;
    const dockPicker = shadow.querySelector<HTMLDetailsElement>(".dock-picker")!;
    const rowMore = shadow.querySelector<HTMLDetailsElement>(".row-more")!;
    const dockTrigger = dockPicker.querySelector<HTMLElement>("summary")!;
    const moreTrigger = rowMore.querySelector<HTMLElement>("summary")!;
    const locate = rowMore.querySelector<HTMLButtonElement>("button")!;

    moreTrigger.click();
    await Promise.resolve();
    expect(shadow.activeElement).toBe(locate);
    locate.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
    expect(rowMore.open).toBe(true);
    expect(locate.closest(".panel")).not.toBeNull();
    locate.click();
    expect(image.scrollIntoView).toHaveBeenCalledOnce();

    dockTrigger.click();
    await Promise.resolve();
    const dockItems = [...shadow.querySelectorAll<HTMLButtonElement>(".dock-menu button")];
    expect(dockTrigger.getAttribute("aria-controls")).toBe(dockItems[0]?.parentElement?.id);
    expect(shadow.activeElement).toBe(dockItems[0]);
    dockItems[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(shadow.activeElement).toBe(dockItems.at(-1));
    dockItems.at(-1)?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(dockPicker.open).toBe(false);
    expect(shadow.activeElement).toBe(dockTrigger);

    dockTrigger.click();
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(dockPicker.open).toBe(false);

    moreTrigger.click();
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(rowMore.open).toBe(false);

    moreTrigger.click();
    shadow
      .querySelector<HTMLElement>(".panel")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(rowMore.open).toBe(false);
    expect(getSourcePanelHostForTesting()?.classList).not.toContain("closing");
  });

  test("wraps menu focus and tolerates empty and detached menus", async () => {
    document.body.innerHTML = `<img src="cat.jpg">`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const shadow = getSourcePanelHostForTesting()!.shadowRoot!;
    const picker = shadow.querySelector<HTMLDetailsElement>(".dock-picker")!;
    const trigger = picker.querySelector<HTMLElement>("summary")!;
    picker.style.direction = "rtl";
    trigger.click();
    await Promise.resolve();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const menu = shadow.querySelector<HTMLElement>(".dock-menu")!;
    shadow.querySelector<HTMLElement>(".row-more summary")!.click();
    await Promise.resolve();
    trigger.click();
    await Promise.resolve();
    const items = [...menu.querySelectorAll<HTMLButtonElement>("button")];
    items[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(shadow.activeElement).toBe(items.at(-1));
    items.at(-1)!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(shadow.activeElement).toBe(items[0]);
    items.at(-1)!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(shadow.activeElement).toBe(items[0]);
    items[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));

    items.forEach((item) => item.remove());
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    picker.remove();
    window.dispatchEvent(new Event("resize"));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    expect(picker.isConnected).toBe(false);
  });

  test("locks and restores page scrolling while the narrow panel covers the viewport", () => {
    vi.useFakeTimers();
    vi.stubGlobal("innerWidth", 390);
    document.documentElement.style.overflow = "auto";

    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    expect(document.documentElement.style.getPropertyValue("overflow")).toBe("hidden");
    expect(document.documentElement.style.getPropertyPriority("overflow")).toBe("important");

    vi.stubGlobal("innerWidth", 800);
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("resize"));
    expect(document.documentElement.style.getPropertyValue("overflow")).toBe("auto");

    vi.stubGlobal("innerWidth", 390);
    window.dispatchEvent(new Event("resize"));
    expect(document.documentElement.style.getPropertyValue("overflow")).toBe("hidden");

    setSourcePanelOpen(false, vi.fn(), { includeBackgrounds: false, live: false });
    vi.advanceTimersByTime(90);
    expect(document.documentElement.style.getPropertyValue("overflow")).toBe("auto");
    expect(document.documentElement.style.getPropertyPriority("overflow")).toBe("");

    document.documentElement.style.removeProperty("overflow");
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    setSourcePanelOpen(false, vi.fn(), { includeBackgrounds: false, live: false });
    vi.advanceTimersByTime(90);
    expect(document.documentElement.style.getPropertyValue("overflow")).toBe("");
  });

  test("positions shadow-root action menus against viewport collisions", async () => {
    document.body.innerHTML = `<img src="cat.jpg">`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const shadow = getSourcePanelHostForTesting()!.shadowRoot!;
    const rowMore = shadow.querySelector<HTMLDetailsElement>(".row-more")!;
    const trigger = rowMore.querySelector<HTMLElement>("summary")!;
    const menu = rowMore.querySelector<HTMLElement>(".action-menu")!;
    vi.spyOn(shadow.querySelector<HTMLElement>(".panel")!, "getBoundingClientRect").mockReturnValue(
      {
        left: 0,
        top: 0,
        right: 320,
        bottom: 240,
        width: 320,
        height: 240,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      },
    );
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      left: 280,
      top: 210,
      right: 312,
      bottom: 238,
      width: 32,
      height: 28,
      x: 280,
      y: 210,
      toJSON: () => ({}),
    });
    vi.spyOn(menu, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 160,
      bottom: 120,
      width: 160,
      height: 120,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    trigger.click();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    expect(menu.style.position).toBe("absolute");
    expect(menu.parentElement).toBe(shadow.querySelector(".panel"));
    expect(menu.style.left).not.toBe("");
    expect(menu.style.top).not.toBe("");
  });

  test("uses friendly embedded-source text, list semantics, status, and a clearable empty state", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<img src="data:image/png;base64,AAAA">`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const shadow = getSourcePanelHostForTesting()!.shadowRoot!;

    expect(shadow.querySelector("ul.list")).not.toBeNull();
    expect(shadow.querySelector(".name")?.textContent).toBe("Embedded page source");
    expect(shadow.querySelector(".url")?.textContent).toBe("data:image/png");
    expect(shadow.querySelector(".source-count")?.textContent).toBe("1");
    expect(shadow.querySelector(".live-status")?.textContent).toContain("1");
    expect(shadow.querySelector(".meta")?.textContent).not.toContain("#");

    const filter = shadow.querySelector<HTMLInputElement>('input[type="search"]')!;
    filter.value = "missing";
    filter.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(80);
    expect(shadow.querySelector(".empty")?.textContent).toContain("missing");

    shadow.querySelector<HTMLButtonElement>(".empty button")!.click();
    expect(filter.value).toBe("");
    expect(shadow.querySelectorAll(".row")).toHaveLength(1);
  });

  test("formats malformed, empty data, and blob source URLs safely", () => {
    document.body.innerHTML = `<img src="http://localhost/%E0%A4%A.jpg"><img src="data:,hello"><img src="blob:http://localhost/id">`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const shadow = getSourcePanelHostForTesting()!.shadowRoot!;
    const text = [...shadow.querySelectorAll<HTMLElement>(".source-link")].map(
      ({ textContent }) => textContent,
    );

    expect(text.some((value) => value.includes("%E0%A4%A.jpg"))).toBe(true);
    expect(text.some((value) => value.includes("data:data"))).toBe(true);
    expect(text.some((value) => value.includes("blob:"))).toBe(true);
  });

  test("copies only URLs in the active text and type filters", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <img src="cat.jpg"><img src="dog.jpg"><a href="cat.pdf">cat paper</a>`;
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    expect(toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false })).toBe(true);
    const shadow = document.getElementById("save-in-source-panel")?.shadowRoot;
    const filter = shadow?.querySelector<HTMLInputElement>('input[type="search"]');
    filter!.value = "cat";
    filter!.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(80);
    const imageFacet = [...shadow!.querySelectorAll<HTMLButtonElement>(".facet")].find((button) =>
      button.textContent?.startsWith("Image"),
    );
    expect(imageFacet?.childNodes[0]?.textContent).toBe("Image");
    expect(imageFacet?.querySelector(".facet-count")?.textContent).toBe("2");
    imageFacet!.click();
    expect(shadow!.querySelector("h2")?.textContent).toBe("Page sources");
    shadow!.querySelector<HTMLButtonElement>(".copy-urls")!.click();
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith("http://localhost/cat.jpg");
  });

  test("restores copy controls after success and reports clipboard failure", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<img src="cat.jpg">`;
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error());
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const copy =
      getSourcePanelHostForTesting()!.shadowRoot!.querySelector<HTMLButtonElement>(".copy-urls")!;

    copy.click();
    await vi.advanceTimersByTimeAsync(0);
    vi.advanceTimersByTime(1200);
    expect(copy.title).toContain("Copy");
    copy.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(copy.title).toContain("failed");
  });

  test("handles row keyboard, alternate-save, locate, sort, and escape boundaries", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<img id="cat" src="cat.jpg"><a href="paper.pdf">paper</a>`;
    const sendDownload = vi.fn();
    const onSaveIntent = vi.fn();
    toggleSourcePanel(sendDownload, {
      includeBackgrounds: false,
      live: false,
      onSaveIntent,
    });
    const host = getSourcePanelHostForTesting()!;
    const shadow = host.shadowRoot!;
    const imageRow = shadow.querySelector<HTMLElement>('.row[data-kind="image"]')!;
    const source = document.querySelector<HTMLElement>("#cat")!;
    source.scrollIntoView = vi.fn();
    imageRow.querySelector<HTMLButtonElement>(".action-menu button")!.click();
    vi.advanceTimersByTime(1600);
    expect(source.style.outline).toBe("");

    imageRow.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, altKey: true }),
    );
    expect(sendDownload).toHaveBeenCalledOnce();
    imageRow.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 1, altKey: true }),
    );
    imageRow.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "x", altKey: true }));
    expect(onSaveIntent).not.toHaveBeenCalled();

    const save = imageRow.querySelector<HTMLButtonElement>(".primary-action")!;
    save.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 1 }));
    save.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "x" }));
    save.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: " " }));
    expect(onSaveIntent).toHaveBeenCalledOnce();

    const link = imageRow.querySelector<HTMLAnchorElement>(".source-link")!;
    const locate = imageRow.querySelector<HTMLButtonElement>(".action-menu button")!;
    link.dispatchEvent(new FocusEvent("focus"));
    link.dispatchEvent(new FocusEvent("blur", { relatedTarget: locate }));
    expect(shadow.querySelector(".media-tooltip")).toBeNull();

    const sort = shadow.querySelector<HTMLSelectElement>("select")!;
    sort.value = "invalid";
    sort.dispatchEvent(new Event("change"));
    shadow.querySelector<HTMLButtonElement>(".facet")!.click();
    shadow.querySelector<HTMLElement>(".panel")!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
      }),
    );
    expect(host.classList).toContain("closing");
  });

  test("keeps the panel mounted for its short exit transition before removing it", () => {
    vi.useFakeTimers();
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    expect(toggleSourcePanel(vi.fn())).toBe(false);
    const host = document.getElementById("save-in-source-panel");
    expect(host?.isConnected).toBe(true);
    vi.advanceTimersByTime(90);
    expect(document.getElementById("save-in-source-panel")).toBeNull();
    vi.useRealTimers();
  });

  test("cancels delayed removal when the panel is reopened during its exit transition", () => {
    vi.useFakeTimers();
    const onOpenChange = vi.fn();
    const options = { includeBackgrounds: false, live: false, onOpenChange };
    toggleSourcePanel(vi.fn(), options);
    expect(toggleSourcePanel(vi.fn(), options)).toBe(false);

    expect(setSourcePanelOpen(true, vi.fn(), options)).toBe(true);
    vi.advanceTimersByTime(90);

    expect(document.getElementById("save-in-source-panel")).not.toBeNull();
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    vi.useRealTimers();
  });

  test("restores the original page focus after replacing an open panel", () => {
    vi.useFakeTimers();
    const pageButton = document.createElement("button");
    document.body.append(pageButton);
    pageButton.focus();
    const options = { includeBackgrounds: false, live: false };

    toggleSourcePanel(vi.fn(), options);
    expect(replaceSourcePanel(vi.fn(), { ...options, previews: false })).toBe(true);
    document
      .getElementById("save-in-source-panel")!
      .shadowRoot!.querySelector<HTMLButtonElement>(".close")!
      .click();

    expect(document.activeElement).toBe(pageButton);
  });

  test("restores page focus when background state closes the panel", () => {
    vi.useFakeTimers();
    const pageButton = document.createElement("button");
    document.body.append(pageButton);
    pageButton.focus();
    const options = { includeBackgrounds: false, live: false };

    toggleSourcePanel(vi.fn(), options);
    expect(setSourcePanelOpen(false, vi.fn(), options)).toBe(false);

    expect(document.activeElement).toBe(pageButton);
  });

  test("updates options without resetting the open panel view state", () => {
    document.body.innerHTML = `<img src="cat.jpg"><img src="dog.jpg">`;
    const options = { includeBackgrounds: false, live: false };
    toggleSourcePanel(vi.fn(), options);
    const host = getSourcePanelHostForTesting()!;
    const shadow = host.shadowRoot!;
    const filter = shadow.querySelector<HTMLInputElement>('input[type="search"]')!;
    const sort = shadow.querySelector<HTMLSelectElement>("select")!;
    filter.value = "cat";
    sort.value = "name-asc";
    shadow.querySelector<HTMLButtonElement>('[data-placement="bottom"]')!.click();

    expect(replaceSourcePanel(vi.fn(), { ...options, previews: false })).toBe(true);

    expect(getSourcePanelHostForTesting()).toBe(host);
    expect(filter.value).toBe("cat");
    expect(sort.value).toBe("name-asc");
    expect(host.dataset.dock).toBe("bottom");
    expect(shadow.querySelector(".source-link img")).toBeNull();
  });

  test("applies replacement copy to every static panel control", () => {
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const copy = createSourcePanelCopy((key) => `New ${key}`);

    expect(
      replaceSourcePanel(vi.fn(), { includeBackgrounds: false, live: false, copy, locale: "de" }),
    ).toBe(true);

    const shadow = getSourcePanelHostForTesting()!.shadowRoot!;
    expect(shadow.querySelector("h2")?.textContent).toBe(copy.title);
    expect(shadow.querySelector<HTMLInputElement>('input[type="search"]')?.placeholder).toBe(
      copy.filterSources,
    );
    expect(shadow.querySelector(".copy-urls")?.getAttribute("aria-label")).toBe(
      copy.copyFilteredUrlsLabel,
    );
  });

  test("applies and live-updates the Page Sources theme override", () => {
    const options = { includeBackgrounds: false, live: false, theme: "dark" as const };
    toggleSourcePanel(vi.fn(), options);
    const host = getSourcePanelHostForTesting()!;

    expect(host.dataset.theme).toBe("dark");

    expect(replaceSourcePanel(vi.fn(), { ...options, theme: "light" })).toBe(true);
    expect(getSourcePanelHostForTesting()).toBe(host);
    expect(host.dataset.theme).toBe("light");

    expect(replaceSourcePanel(vi.fn(), { ...options, theme: "pastel-pink" })).toBe(true);
    expect(host.dataset.theme).toBe("pastel-pink");

    expect(replaceSourcePanel(vi.fn(), { ...options, theme: "blue-house" })).toBe(true);
    expect(host.dataset.theme).toBe("blue-house");
  });

  test("defaults direct and legacy panel callers to the system theme", () => {
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });

    expect(getSourcePanelHostForTesting()!.dataset.theme).toBe("system");
  });

  test("starts and stops live reconciliation without replacing the panel", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<img src="initial.jpg">`;
    const sendDownload = vi.fn();
    const options = { includeBackgrounds: false, live: false };
    toggleSourcePanel(sendDownload, options);
    const host = getSourcePanelHostForTesting()!;
    const urls = () =>
      [...host.shadowRoot!.querySelectorAll<HTMLAnchorElement>(".source-link")].map(
        ({ href }) => href,
      );

    const discovered = document.createElement("img");
    discovered.src = "discovered.jpg";
    document.body.append(discovered);
    replaceSourcePanel(sendDownload, { ...options, live: true });
    expect(urls()).toContain("http://localhost/discovered.jpg");

    replaceSourcePanel(sendDownload, options);
    const ignored = document.createElement("img");
    ignored.src = "ignored.jpg";
    document.body.append(ignored);
    await Promise.resolve();
    vi.advanceTimersByTime(200);
    expect(urls()).not.toContain("http://localhost/ignored.jpg");
    expect(getSourcePanelHostForTesting()).toBe(host);
  });

  test("filters cached sources without rescanning the page on every keystroke", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<img src="cat.jpg"><img src="dog.jpg">`;
    const resourceReads = vi.spyOn(performance, "getEntriesByType");
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    resourceReads.mockClear();
    const shadow = document.getElementById("save-in-source-panel")!.shadowRoot!;
    const filter = shadow.querySelector<HTMLInputElement>('input[type="search"]')!;
    const dogRow = [...shadow.querySelectorAll<HTMLElement>(".row")].find((row) =>
      row.textContent?.includes("dog.jpg"),
    );

    filter.value = "c";
    filter.dispatchEvent(new Event("input"));
    filter.value = "cat";
    filter.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(80);

    expect(resourceReads).not.toHaveBeenCalled();
    expect(shadow.querySelectorAll(".row")).toHaveLength(1);

    filter.value = "";
    filter.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(80);
    expect(
      [...shadow.querySelectorAll<HTMLElement>(".row")].find((row) =>
        row.textContent?.includes("dog.jpg"),
      ),
    ).toBe(dogRow);
    vi.useRealTimers();
  });

  test("shows one empty state and deactivates cached rows when nothing matches", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<img id="cat" src="cat.jpg"><img src="dog.jpg">`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const host = document.getElementById("save-in-source-panel")!;
    const shadow = host.shadowRoot!;
    const filter = shadow.querySelector<HTMLInputElement>('input[type="search"]')!;
    const catRow = [...shadow.querySelectorAll<HTMLElement>(".row")].find((row) =>
      row.textContent?.includes("cat.jpg"),
    )!;
    catRow.querySelector(".source-link")!.dispatchEvent(new MouseEvent("mouseenter"));
    expect(shadow.querySelector(".media-tooltip")).not.toBeNull();
    expect(document.querySelector<HTMLElement>("#cat")!.style.outline).not.toBe("");

    filter.value = "missing";
    filter.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(80);
    filter.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(80);

    expect(shadow.querySelectorAll(".row")).toHaveLength(0);
    expect(shadow.querySelectorAll(".empty")).toHaveLength(1);
    expect(shadow.querySelector(".media-tooltip")).toBeNull();
    expect(document.querySelector<HTMLElement>("#cat")!.style.outline).toBe("");

    filter.value = "";
    filter.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(80);
    expect(
      [...shadow.querySelectorAll<HTMLElement>(".row")].find((row) =>
        row.textContent?.includes("cat.jpg"),
      ),
    ).toBe(catRow);
  });

  test("restores a shared source element outline after overlapping rows deactivate", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<img id="responsive" style="outline: 1px solid red" src="one.jpg" srcset="one.jpg 1x, two.jpg 2x">`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const source = document.querySelector<HTMLElement>("#responsive")!;
    const shadow = getSourcePanelHostForTesting()!.shadowRoot!;
    const rows = [...shadow.querySelectorAll<HTMLElement>(".row")];
    const firstLink = rows[0]!.querySelector<HTMLAnchorElement>(".source-link")!;
    firstLink.dispatchEvent(new FocusEvent("focus"));
    rows[1]!.querySelector(".source-link")!.dispatchEvent(new MouseEvent("mouseenter"));

    setSourcePanelOpen(false, vi.fn(), { includeBackgrounds: false, live: false });
    vi.advanceTimersByTime(90);

    expect(source.style.outline).toBe("1px solid red");
    expect(source.hasAttribute("data-save-in-previous-outline")).toBe(false);
  });

  test("loads list previews only when they approach the panel viewport", () => {
    let intersectionCallback: IntersectionObserverCallback | undefined;
    const observe = vi.fn();
    const unobserve = vi.fn();
    class IntersectionObserverStub {
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
      }
      observe = observe;
      disconnect = vi.fn();
      unobserve = unobserve;
      takeRecords = vi.fn(() => []);
      root = null;
      rootMargin = "";
      thresholds = [];
    }
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    document.body.innerHTML = `<a href="movie.mp4">movie</a>`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const video = document
      .getElementById("save-in-source-panel")!
      .shadowRoot!.querySelector<HTMLVideoElement>(".source-link video")!;

    expect(video.hasAttribute("src")).toBe(false);
    expect(observe).toHaveBeenCalledWith(video);
    intersectionCallback!(
      [{ isIntersecting: true, target: video } as unknown as IntersectionObserverEntry],
      { unobserve } as unknown as IntersectionObserver,
    );
    intersectionCallback!(
      [{ isIntersecting: true, target: video } as unknown as IntersectionObserverEntry],
      { unobserve } as unknown as IntersectionObserver,
    );

    intersectionCallback!(
      [
        { isIntersecting: false, target: video },
        { isIntersecting: true, target: document.createElement("div") },
      ] as unknown as IntersectionObserverEntry[],
      { unobserve } as unknown as IntersectionObserver,
    );

    expect(video.src).toBe("http://localhost/movie.mp4");
  });

  test("re-observes an unchanged cached preview after a list render", () => {
    const observe = vi.fn();
    class IntersectionObserverStub {
      observe = observe;
      disconnect = vi.fn();
      unobserve = vi.fn();
      takeRecords = vi.fn(() => []);
      root = null;
      rootMargin = "";
      thresholds = [];
    }
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    document.body.innerHTML = `<img src="cat.jpg">`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const sort =
      getSourcePanelHostForTesting()!.shadowRoot!.querySelector<HTMLSelectElement>("select")!;
    observe.mockClear();

    sort.value = "name-asc";
    sort.dispatchEvent(new Event("change"));

    expect(observe).toHaveBeenCalled();
  });

  test("does not preload unselected responsive-image candidates", () => {
    document.body.innerHTML = `<img src="fallback.jpg" srcset="selected.jpg 1x, large.jpg 2x">`;
    Object.defineProperty(document.querySelector("img")!, "currentSrc", {
      configurable: true,
      value: "http://localhost/selected.jpg",
    });

    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const rows = [
      ...getSourcePanelHostForTesting()!.shadowRoot!.querySelectorAll<HTMLElement>(".row"),
    ];
    const rowFor = (name: string) => rows.find((row) => row.textContent?.includes(name))!;

    expect(rowFor("selected.jpg").querySelector("img")).not.toBeNull();
    expect(rowFor("fallback.jpg").querySelector("img")).toBeNull();
    expect(rowFor("large.jpg").querySelector("img")).toBeNull();
  });

  test("ignores panel mutations and incrementally reconciles changed link targets", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<a id="dynamic" href="first.html">first</a><a href="stable.html">stable</a>`;
    const resourceReads = vi.spyOn(performance, "getEntriesByType");
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: true });
    const host = document.getElementById("save-in-source-panel")!;
    const stableRow = [...host.shadowRoot!.querySelectorAll<HTMLElement>(".row")].find((row) =>
      row.textContent?.includes("stable.html"),
    );
    resourceReads.mockClear();

    host.style.width = "400px";
    await Promise.resolve();
    vi.advanceTimersByTime(250);
    expect(resourceReads).not.toHaveBeenCalled();

    document.querySelector<HTMLAnchorElement>("#dynamic")!.href = "second.html";
    await Promise.resolve();
    vi.advanceTimersByTime(250);
    expect(resourceReads).not.toHaveBeenCalled();
    expect(
      [...host.shadowRoot!.querySelectorAll<HTMLAnchorElement>(".source-link")].map(
        ({ href }) => href,
      ),
    ).toContain("http://localhost/second.html");
    expect(
      [...host.shadowRoot!.querySelectorAll<HTMLElement>(".row")].find((row) =>
        row.textContent?.includes("stable.html"),
      ),
    ).toBe(stableRow);
    expect(
      [...host.shadowRoot!.querySelectorAll<HTMLAnchorElement>(".source-link")].map(
        ({ href }) => href,
      ),
    ).not.toContain("http://localhost/first.html");
    expect(
      [...host.shadowRoot!.querySelectorAll<HTMLAnchorElement>(".source-link")].map(
        ({ href }) => href,
      ),
    ).toContain("http://localhost/stable.html");
    vi.useRealTimers();
  });

  test("incrementally adds and removes sources while retaining duplicate URL fallbacks", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<img id="first" src="shared.jpg"><img id="second" src="shared.jpg">`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: true });
    const host = document.getElementById("save-in-source-panel")!;

    document.querySelector("#first")!.remove();
    const added = document.createElement("img");
    added.src = "new.jpg";
    document.body.append(added);
    await Promise.resolve();
    vi.advanceTimersByTime(200);

    expect(
      [...host.shadowRoot!.querySelectorAll<HTMLAnchorElement>(".source-link")].map(
        ({ href }) => href,
      ),
    ).toEqual(expect.arrayContaining(["http://localhost/shared.jpg", "http://localhost/new.jpg"]));

    document.querySelector("#second")!.remove();
    await Promise.resolve();
    vi.advanceTimersByTime(200);
    expect(
      [...host.shadowRoot!.querySelectorAll<HTMLAnchorElement>(".source-link")].map(
        ({ href }) => href,
      ),
    ).not.toContain("http://localhost/shared.jpg");
  });

  test("cached save actions drop a duplicate origin after it leaves the page", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <article><img id="retained" src="shared.jpg"></article>
      <aside><img id="removed" class="avatar" src="shared.jpg"></aside>`;
    const sendDownload = vi.fn();
    toggleSourcePanel(sendDownload, { includeBackgrounds: false, live: true });
    const shadow = getSourcePanelHostForTesting()!.shadowRoot!;
    const row = shadow.querySelector<HTMLElement>(".row")!;

    document.querySelector("#removed")!.remove();
    await Promise.resolve();
    vi.advanceTimersByTime(200);
    expect(shadow.querySelector(".row")).toBe(row);
    row.querySelector<HTMLButtonElement>(".primary-action")!.click();

    const source = sendDownload.mock.calls[0]?.[0];
    expect(source?.originElements).toEqual([document.querySelector("#retained")]);
  });

  test("coalesces nested, disconnected, and text-only live mutations", async () => {
    vi.useFakeTimers();
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: true });
    const parent = document.createElement("div");
    const child = document.createElement("img");
    child.src = "nested.jpg";
    parent.append(child);
    document.body.append(parent);
    child.setAttribute("src", "nested-updated.jpg");

    const movedChild = document.createElement("img");
    movedChild.src = "moved.jpg";
    document.body.append(movedChild);
    const wrapper = document.createElement("section");
    wrapper.append(movedChild);
    document.body.append(wrapper);

    const disconnected = document.createElement("img");
    disconnected.src = "gone.jpg";
    document.body.append(disconnected);
    disconnected.remove();
    const text = document.createTextNode("temporary");
    document.body.append(text);
    text.remove();

    await Promise.resolve();
    vi.advanceTimersByTime(200);

    const urls = [
      ...getSourcePanelHostForTesting()!.shadowRoot!.querySelectorAll<HTMLAnchorElement>(
        ".source-link",
      ),
    ].map(({ href }) => href);
    expect(urls).toContain("http://localhost/nested-updated.jpg");
    expect(urls).toContain("http://localhost/moved.jpg");
    expect(urls).not.toContain("http://localhost/gone.jpg");
  });

  test("contains live mutations whose target is not an element", () => {
    let mutationCallback: MutationCallback | undefined;
    class StubMutationObserver {
      constructor(callback: MutationCallback) {
        mutationCallback = callback;
      }

      observe() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    vi.stubGlobal("MutationObserver", StubMutationObserver);
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: true });

    const mutations = ["childList", "attributes"].map(
      (type) =>
        ({
          type,
          target: document,
          addedNodes: [],
          removedNodes: [],
        }) as unknown as MutationRecord,
    );
    expect(mutationCallback).toBeTypeOf("function");
    expect(() => mutationCallback?.(mutations, {} as MutationObserver)).not.toThrow();
  });

  test("removes background candidates under a deleted ancestor", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<section id="group"><div style="background-image:url(poster.jpg)"></div></section>`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: true, live: true });
    vi.advanceTimersByTime(0);
    expect(
      getSourcePanelHostForTesting()!.shadowRoot!.querySelector(".source-link"),
    ).not.toBeNull();

    document.querySelector("#group")!.remove();
    await Promise.resolve();
    vi.advanceTimersByTime(200);

    expect(getSourcePanelHostForTesting()!.shadowRoot!.querySelector(".source-link")).toBeNull();
  });

  test("incrementally reconciles responsive picture source-list changes", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <picture>
        <source id="responsive" srcset="old.jpg 1x, old@2x.jpg 2x">
        <img src="fallback.jpg">
      </picture>`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: true });
    const host = document.getElementById("save-in-source-panel")!;
    const urls = () =>
      [...host.shadowRoot!.querySelectorAll<HTMLAnchorElement>(".source-link")].map(
        ({ href }) => href,
      );
    expect(urls()).toEqual(
      expect.arrayContaining(["http://localhost/old.jpg", "http://localhost/old@2x.jpg"]),
    );

    document.querySelector("#responsive")!.setAttribute("srcset", "new.jpg 1x, new@2x.jpg 2x");
    await Promise.resolve();
    vi.advanceTimersByTime(200);

    expect(urls()).toEqual(
      expect.arrayContaining(["http://localhost/new.jpg", "http://localhost/new@2x.jpg"]),
    );
    expect(urls()).not.toEqual(
      expect.arrayContaining(["http://localhost/old.jpg", "http://localhost/old@2x.jpg"]),
    );

    document.querySelector("#responsive")!.remove();
    await Promise.resolve();
    vi.advanceTimersByTime(200);
    expect(urls()).not.toEqual(
      expect.arrayContaining(["http://localhost/new.jpg", "http://localhost/new@2x.jpg"]),
    );

    const added = document.createElement("source");
    added.srcset = "added.jpg 1x, added@2x.jpg 2x";
    document.querySelector("picture")!.prepend(added);
    await Promise.resolve();
    vi.advanceTimersByTime(200);
    expect(urls()).toEqual(
      expect.arrayContaining(["http://localhost/added.jpg", "http://localhost/added@2x.jpg"]),
    );
  });

  test("refreshes computed backgrounds after a class change", async () => {
    vi.useFakeTimers();
    document.head.innerHTML = `<style>.poster { background-image: url(poster.jpg) }</style>`;
    document.body.innerHTML = `<div id="dynamic-background"></div>`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: true, live: true, includeLinks: false });
    const host = document.getElementById("save-in-source-panel")!;

    document.querySelector("#dynamic-background")!.className = "poster";
    await Promise.resolve();
    vi.advanceTimersByTime(200);

    expect(host.shadowRoot!.querySelector<HTMLAnchorElement>(".source-link")!.href).toBe(
      "http://localhost/poster.jpg",
    );
  });

  test("scans initial computed backgrounds in idle chunks", () => {
    const idleCallbacks: IdleRequestCallback[] = [];
    vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
      idleCallbacks.push(callback);
      return idleCallbacks.length;
    });
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    document.body.innerHTML = `<div class="poster" style="background-image: url(poster.jpg)"></div>`;
    const computedStyle = vi.spyOn(window, "getComputedStyle");

    toggleSourcePanel(vi.fn(), { includeBackgrounds: true, live: false });

    expect(computedStyle).not.toHaveBeenCalled();
    idleCallbacks.shift()!({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
    expect(computedStyle).toHaveBeenCalled();
    expect(
      getSourcePanelHostForTesting()!.shadowRoot!.querySelector<HTMLAnchorElement>(".source-link")!
        .href,
    ).toBe("http://localhost/poster.jpg");
  });

  test("cancels a multi-chunk background scan when the panel closes", () => {
    vi.useFakeTimers();
    const idleCallbacks: IdleRequestCallback[] = [];
    vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
      idleCallbacks.push(callback);
      return idleCallbacks.length;
    });
    const cancelIdleCallback = vi.fn();
    vi.stubGlobal("cancelIdleCallback", cancelIdleCallback);
    document.body.innerHTML = Array.from(
      { length: 51 },
      (_, index) => `<div style="background-image:url(${index}.jpg)"></div>`,
    ).join("");
    toggleSourcePanel(vi.fn(), { includeBackgrounds: true, live: false });

    idleCallbacks.shift()!({ didTimeout: false, timeRemaining: () => 0 } as IdleDeadline);
    setSourcePanelOpen(false, vi.fn(), { includeBackgrounds: true, live: false });
    vi.advanceTimersByTime(90);

    expect(cancelIdleCallback).toHaveBeenCalled();
  });

  test("cancels a timer-backed background scan when the panel closes", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<div style="background-image:url(poster.jpg)"></div>`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: true, live: false });
    setSourcePanelOpen(false, vi.fn(), { includeBackgrounds: true, live: false });
    vi.advanceTimersByTime(90);
    expect(getSourcePanelHostForTesting()).toBeNull();
  });

  test("cancels a timer-backed scan when background discovery is disabled", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<div style="background-image:url(poster.jpg)"></div>`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: true, live: false });

    replaceSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    vi.advanceTimersByTime(0);

    expect(getSourcePanelHostForTesting()!.shadowRoot!.querySelector(".source-link")).toBeNull();
  });

  test("drops a stale background chunk after discovery is reconfigured", () => {
    const idleCallbacks: IdleRequestCallback[] = [];
    vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
      idleCallbacks.push(callback);
      return idleCallbacks.length;
    });
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    document.body.innerHTML = `<div style="background-image:url(poster.jpg)"></div>`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: true, live: false });
    const stale = idleCallbacks[0]!;
    document.querySelector("div")!.remove();
    replaceSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });

    stale({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);

    expect(getSourcePanelHostForTesting()!.shadowRoot!.querySelector(".source-link")).toBeNull();
  });

  test("restarts an active background scan after a live page mutation", async () => {
    vi.useFakeTimers();
    const idleCallbacks: IdleRequestCallback[] = [];
    vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
      idleCallbacks.push(callback);
      return idleCallbacks.length;
    });
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    document.body.innerHTML = `<div id="poster"></div>`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: true, live: true });

    document.querySelector<HTMLElement>("#poster")!.style.backgroundImage = "url(poster.jpg)";
    await Promise.resolve();
    vi.advanceTimersByTime(200);

    expect(idleCallbacks.length).toBeGreaterThan(1);
  });

  test("re-resolves relative sources after the document base changes", async () => {
    vi.useFakeTimers();
    document.head.innerHTML = `<base href="http://localhost/one/">`;
    document.body.innerHTML = `<img src="image.jpg">`;
    toggleSourcePanel(vi.fn(), {
      includeBackgrounds: false,
      includeLinks: false,
      live: true,
    });
    const urls = () =>
      [
        ...getSourcePanelHostForTesting()!.shadowRoot!.querySelectorAll<HTMLAnchorElement>(
          ".source-link",
        ),
      ].map(({ href }) => href);
    expect(urls()).toContain("http://localhost/one/image.jpg");

    document.querySelector("base")!.setAttribute("href", "http://localhost/two/");
    await Promise.resolve();
    vi.advanceTimersByTime(200);

    expect(urls()).toContain("http://localhost/two/image.jpg");
    expect(urls()).not.toContain("http://localhost/one/image.jpg");
  });

  test("refreshes when a new streaming resource is observed", () => {
    vi.useFakeTimers();
    let performanceCallback: PerformanceObserverCallback | undefined;
    const observe = vi.fn();
    class PerformanceObserverStub {
      constructor(callback: PerformanceObserverCallback) {
        performanceCallback = callback;
      }
      observe = observe;
      disconnect = vi.fn();
      takeRecords = vi.fn(() => []);
    }
    vi.stubGlobal("PerformanceObserver", PerformanceObserverStub);
    const resourceReads = vi.spyOn(performance, "getEntriesByType");
    toggleSourcePanel(vi.fn(), {
      includeBackgrounds: false,
      live: true,
      resourceHints: true,
    });
    resourceReads.mockClear();

    performanceCallback!(
      { getEntries: () => [{ name: "https://cdn.test/new.m3u8" }] } as PerformanceObserverEntryList,
      {} as PerformanceObserver,
    );
    vi.advanceTimersByTime(200);

    expect(observe).toHaveBeenCalledWith({ type: "resource", buffered: true });
    expect(resourceReads).not.toHaveBeenCalled();
    expect(
      document
        .getElementById("save-in-source-panel")!
        .shadowRoot!.querySelector<HTMLAnchorElement>(".source-link")!.href,
    ).toBe("https://cdn.test/new.m3u8");
  });

  test("falls back across unsupported PerformanceObserver signatures", () => {
    const observe = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("buffered type unsupported");
      })
      .mockImplementationOnce(() => {
        throw new Error("resource entries unsupported");
      });
    class PerformanceObserverStub {
      observe = observe;
      disconnect = vi.fn();
      takeRecords = vi.fn(() => []);
    }
    vi.stubGlobal("PerformanceObserver", PerformanceObserverStub);

    expect(() =>
      toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: true }),
    ).not.toThrow();
    expect(observe).toHaveBeenCalledTimes(2);
  });

  test("runs without PerformanceObserver support", () => {
    vi.stubGlobal("PerformanceObserver", undefined);

    expect(() =>
      toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: true }),
    ).not.toThrow();
  });

  test("preserves an active row and tooltip when late resource metadata arrives", () => {
    let performanceCallback: PerformanceObserverCallback | undefined;
    class PerformanceObserverStub {
      constructor(callback: PerformanceObserverCallback) {
        performanceCallback = callback;
      }
      observe = vi.fn();
      disconnect = vi.fn();
      takeRecords = vi.fn(() => []);
    }
    vi.stubGlobal("PerformanceObserver", PerformanceObserverStub);
    document.body.innerHTML = `<img src="https://cdn.test/late-size.jpg">`;
    toggleSourcePanel(vi.fn(), {
      includeBackgrounds: false,
      live: true,
      resourceHints: false,
    });
    const shadow = getSourcePanelHostForTesting()!.shadowRoot!;
    const row = shadow.querySelector<HTMLElement>(".row")!;
    row.querySelector(".source-link")!.dispatchEvent(new MouseEvent("mouseenter"));
    const tooltip = shadow.querySelector<HTMLElement>(".media-tooltip")!;

    const reportSize = (bytes: number) =>
      performanceCallback!(
        {
          getEntries: () => [
            {
              name: "https://cdn.test/late-size.jpg",
              encodedBodySize: bytes,
              transferSize: bytes,
            },
          ],
        } as unknown as PerformanceObserverEntryList,
        {} as PerformanceObserver,
      );

    reportSize(2048);

    expect(shadow.querySelector(".row")).toBe(row);
    expect(shadow.querySelector(".media-tooltip")).toBe(tooltip);
  });

  test("updates background-source bytes and ignores unchanged resource metadata", () => {
    vi.useFakeTimers();
    let performanceCallback: PerformanceObserverCallback | undefined;
    class PerformanceObserverStub {
      constructor(callback: PerformanceObserverCallback) {
        performanceCallback = callback;
      }
      observe = vi.fn();
      disconnect = vi.fn();
      takeRecords = vi.fn(() => []);
    }
    vi.stubGlobal("PerformanceObserver", PerformanceObserverStub);
    document.body.innerHTML = `<div style="background-image:url(https://cdn.test/poster.jpg)"></div>`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: true, live: true, resourceHints: false });
    vi.advanceTimersByTime(0);

    performanceCallback!(
      {
        getEntries: () => [
          { name: "https://cdn.test/poster.jpg", encodedBodySize: 0, transferSize: 2048 },
        ],
      } as unknown as PerformanceObserverEntryList,
      {} as PerformanceObserver,
    );
    performanceCallback!(
      {
        getEntries: () => [
          { name: "https://cdn.test/poster.jpg", encodedBodySize: 0, transferSize: 2048 },
        ],
      } as unknown as PerformanceObserverEntryList,
      {} as PerformanceObserver,
    );

    expect(
      getSourcePanelHostForTesting()!.shadowRoot!.querySelector(".source-size")?.textContent,
    ).toBe("2 KB");
  });

  test("ignores unchanged foreground resource metadata", () => {
    let performanceCallback: PerformanceObserverCallback | undefined;
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      { name: "http://localhost/cat.jpg", encodedBodySize: 2048 },
    ] as unknown as PerformanceEntry[]);
    class PerformanceObserverStub {
      constructor(callback: PerformanceObserverCallback) {
        performanceCallback = callback;
      }
      observe = vi.fn();
      disconnect = vi.fn();
      takeRecords = vi.fn(() => []);
    }
    vi.stubGlobal("PerformanceObserver", PerformanceObserverStub);
    document.body.innerHTML = `<img src="cat.jpg">`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: true, resourceHints: false });

    performanceCallback!(
      {
        getEntries: () => [{ name: "http://localhost/cat.jpg", encodedBodySize: 2048 }],
      } as unknown as PerformanceObserverEntryList,
      {} as PerformanceObserver,
    );

    expect(
      getSourcePanelHostForTesting()!.shadowRoot!.querySelector(".source-size")?.textContent,
    ).toBe("2 KB");
  });

  test("handles resource entries unrelated to current sources", () => {
    vi.useFakeTimers();
    let performanceCallback: PerformanceObserverCallback | undefined;
    class PerformanceObserverStub {
      constructor(callback: PerformanceObserverCallback) {
        performanceCallback = callback;
      }
      observe = vi.fn();
      disconnect = vi.fn();
      takeRecords = vi.fn(() => []);
    }
    vi.stubGlobal("PerformanceObserver", PerformanceObserverStub);
    document.body.innerHTML = `<img src="cat.jpg"><div style="background-image:url(poster.jpg)"></div>`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: true, live: true, resourceHints: false });
    vi.advanceTimersByTime(0);

    performanceCallback!(
      {
        getEntries: () => [{ name: "https://cdn.test/unrelated.js" }],
      } as unknown as PerformanceObserverEntryList,
      {} as PerformanceObserver,
    );

    expect(
      getSourcePanelHostForTesting()!.shadowRoot!.querySelector(".source-link"),
    ).not.toBeNull();
  });

  test("prefers encoded background size over transfer size", () => {
    vi.useFakeTimers();
    let performanceCallback: PerformanceObserverCallback | undefined;
    class PerformanceObserverStub {
      constructor(callback: PerformanceObserverCallback) {
        performanceCallback = callback;
      }
      observe = vi.fn();
      disconnect = vi.fn();
      takeRecords = vi.fn(() => []);
    }
    vi.stubGlobal("PerformanceObserver", PerformanceObserverStub);
    document.body.innerHTML = `<div style="background-image:url(https://cdn.test/poster.jpg)"></div>`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: true, live: true, resourceHints: false });
    vi.advanceTimersByTime(0);

    performanceCallback!(
      {
        getEntries: () => [
          { name: "https://cdn.test/poster.jpg", encodedBodySize: 4096, transferSize: 2048 },
        ],
      } as unknown as PerformanceObserverEntryList,
      {} as PerformanceObserver,
    );

    expect(
      getSourcePanelHostForTesting()!.shadowRoot!.querySelector(".source-size")?.textContent,
    ).toBe("4 KB");
  });

  test("gives every header action an accessible name", () => {
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const shadow = document.getElementById("save-in-source-panel")!.shadowRoot!;

    const actions = [
      ...shadow.querySelectorAll<HTMLElement>(
        ".header-actions > button, .header-actions > details > summary",
      ),
    ];
    const names = actions.map((button) => button.getAttribute("aria-label"));
    expect(names.every(Boolean)).toBe(true);
    expect(new Set(names).size).toBe(actions.length);
  });

  test("warms the background only at Page Sources save-intent boundaries", () => {
    document.body.innerHTML = `<img src="cat.jpg">`;
    const onSaveIntent = vi.fn();
    toggleSourcePanel(vi.fn(), {
      includeBackgrounds: false,
      live: false,
      onSaveIntent,
    });
    const shadow = document.getElementById("save-in-source-panel")!.shadowRoot!;
    const row = shadow.querySelector<HTMLElement>(".row")!;
    const locate = row.querySelector<HTMLButtonElement>(".action-menu button")!;
    const save = row.querySelector<HTMLButtonElement>(".primary-action")!;

    locate.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    expect(onSaveIntent).not.toHaveBeenCalled();

    save.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    save.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    row.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, altKey: true }));
    row.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", altKey: true }));

    expect(onSaveIntent).toHaveBeenCalledTimes(4);
  });

  test("Alt-clicking the Save action triggers only its button download", () => {
    document.body.innerHTML = `<img src="cat.jpg">`;
    const sendDownload = vi.fn();
    toggleSourcePanel(sendDownload, { includeBackgrounds: false, live: false });
    const save = document
      .getElementById("save-in-source-panel")!
      .shadowRoot!.querySelector<HTMLButtonElement>(".primary-action")!;

    save.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, altKey: true }));

    expect(sendDownload).toHaveBeenCalledOnce();
  });

  test("selects filtered sources and submits the batch sequentially", async () => {
    document.body.innerHTML = `<img src="cat.jpg"><img src="dog.jpg"><a href="paper.pdf">Paper</a>`;
    const order: string[] = [];
    const sendDownload = vi.fn(async ({ url }: { url: string }) => {
      order.push(url);
      return true;
    });
    toggleSourcePanel(sendDownload, {
      includeBackgrounds: false,
      includeLinks: true,
      live: false,
    });
    const shadow = getSourcePanelHostForTesting()!.shadowRoot!;
    expect(shadow.querySelector<HTMLElement>(".selection-count")!.hidden).toBe(true);
    expect(shadow.querySelector<HTMLButtonElement>(".batch-save")!.hidden).toBe(true);
    const filter = shadow.querySelector<HTMLInputElement>('input[type="search"]')!;
    filter.value = ".jpg";
    filter.dispatchEvent(new Event("input"));
    await vi.waitFor(() => expect(shadow.querySelectorAll(".row")).toHaveLength(2));
    const select = [...shadow.querySelectorAll<HTMLButtonElement>(".selection-bar button")].find(
      ({ textContent }) => textContent === "Select filtered",
    )!;
    select.click();
    expect(shadow.querySelector<HTMLElement>(".selection-count")!.hidden).toBe(false);
    expect(select.hidden).toBe(true);
    filter.value = ".pdf";
    filter.dispatchEvent(new Event("input"));
    await vi.waitFor(() =>
      expect(shadow.querySelector(".hidden-selection-count")?.textContent).toBe("2 hidden"),
    );
    shadow.querySelector<HTMLButtonElement>(".batch-save")!.click();

    await vi.waitFor(() => expect(sendDownload).toHaveBeenCalledTimes(2));
    expect(order[0]).toContain("cat.jpg");
    expect(order[1]).toContain("dog.jpg");
    expect(shadow.querySelector(".selection-count")?.textContent).toBe("0 selected");
  });

  test("paints one checkbox state across rows while dragging", () => {
    document.body.innerHTML = `<img src="one.jpg"><img src="two.jpg"><img src="three.jpg">`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const shadow = getSourcePanelHostForTesting()!.shadowRoot!;
    const inputs = [...shadow.querySelectorAll<HTMLInputElement>(".source-selection input")];
    let hit: Element = inputs[0]!;
    Object.defineProperty(shadow, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => hit),
    });
    const pointer = (type: string) =>
      new PointerEvent(type, {
        bubbles: true,
        button: 0,
        clientX: 10,
        clientY: 10,
        pointerId: 7,
      });

    inputs[0]!.dispatchEvent(pointer("pointerdown"));
    hit = inputs[1]!;
    document.dispatchEvent(pointer("pointermove"));
    hit = inputs[2]!;
    document.dispatchEvent(pointer("pointermove"));
    document.dispatchEvent(pointer("pointerup"));
    expect(inputs.map(({ checked }) => checked)).toEqual([true, true, true]);

    hit = inputs[1]!;
    inputs[1]!.dispatchEvent(pointer("pointerdown"));
    hit = inputs[0]!;
    document.dispatchEvent(pointer("pointermove"));
    document.dispatchEvent(pointer("pointerup"));
    expect(inputs.map(({ checked }) => checked)).toEqual([false, false, true]);
  });

  test("ignores invalid selection-paint starts, moves, and finishes", () => {
    document.body.innerHTML = `<img src="one.jpg"><img src="two.jpg">`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const shadow = getSourcePanelHostForTesting()!.shadowRoot!;
    const inputs = [...shadow.querySelectorAll<HTMLInputElement>(".source-selection input")];
    const pointer = (type: string, pointerId: number, button = 0) =>
      new PointerEvent(type, {
        bubbles: true,
        composed: true,
        pointerId,
        button,
        clientX: 4,
        clientY: 4,
      });

    inputs[0]!.dispatchEvent(pointer("pointerdown", 1, 1));
    expect(inputs.map(({ checked }) => checked)).toEqual([false, false]);
    expect(shadow.querySelector(".panel")?.hasAttribute("data-selecting")).toBe(false);
    const url = inputs[0]!.dataset.sourceUrl;
    delete inputs[0]!.dataset.sourceUrl;
    inputs[0]!.dispatchEvent(pointer("pointerdown", 2));
    expect(inputs.map(({ checked }) => checked)).toEqual([false, false]);
    inputs[0]!.dataset.sourceUrl = url;
    document.dispatchEvent(pointer("pointermove", 2));
    document.dispatchEvent(pointer("pointerup", 2));
    expect(inputs.map(({ checked }) => checked)).toEqual([false, false]);

    inputs[0]!.dispatchEvent(pointer("pointerdown", 3));
    expect(inputs.map(({ checked }) => checked)).toEqual([true, false]);
    expect(shadow.querySelector<HTMLElement>(".panel")!.dataset.selecting).toBe("select");
    inputs[1]!.dispatchEvent(pointer("pointerdown", 4));
    inputs[0]!.dispatchEvent(pointer("pointermove", 3));
    inputs[0]!.dispatchEvent(pointer("pointermove", 3));
    shadow.querySelector<HTMLElement>(".close")!.dispatchEvent(pointer("pointermove", 3));
    document.dispatchEvent(pointer("pointermove", 4));
    document.dispatchEvent(pointer("pointerup", 4));
    expect(inputs.map(({ checked }) => checked)).toEqual([true, false]);
    expect(shadow.querySelector<HTMLElement>(".panel")!.dataset.selecting).toBe("select");
    document.dispatchEvent(pointer("pointermove", 3));
    document.dispatchEvent(pointer("pointerup", 3));
    document.dispatchEvent(pointer("pointercancel", 3));

    expect(inputs.map(({ checked }) => checked)).toEqual([true, false]);
    expect(shadow.querySelector(".panel")?.hasAttribute("data-selecting")).toBe(false);
    expect(shadow.querySelector(".selection-count")?.textContent).toBe("1 selected");
  });

  test("does not suppress keyboard activation after a selection drag", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<img src="one.jpg"><img src="two.jpg">`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const shadow = getSourcePanelHostForTesting()!.shadowRoot!;
    const input = shadow.querySelector<HTMLInputElement>(".source-selection input")!;
    Object.defineProperty(shadow, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => input),
    });
    const pointer = (type: string) =>
      new PointerEvent(type, { bubbles: true, button: 0, pointerId: 9 });

    input.dispatchEvent(pointer("pointerdown"));
    document.dispatchEvent(pointer("pointerup"));
    expect(input.checked).toBe(true);

    vi.advanceTimersByTime(0);
    input.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    expect(input.checked).toBe(false);
  });

  test("suppresses the synthetic pointer click but permits keyboard activation", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<img src="one.jpg">`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const input =
      getSourcePanelHostForTesting()!.shadowRoot!.querySelector<HTMLInputElement>(
        ".source-selection input",
      )!;
    input.setPointerCapture = vi.fn();
    input.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 3 }),
    );
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 3 }));
    input.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    expect(
      getSourcePanelHostForTesting()!.shadowRoot!.querySelector(".selection-count")?.textContent,
    ).toBe("1 selected");

    input.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }));
    input.checked = false;
    input.dispatchEvent(new Event("change"));
    vi.advanceTimersByTime(0);
    expect(input.checked).toBe(false);
  });

  test("removes document drag listeners when the panel closes mid-selection", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<img src="one.jpg"><img src="two.jpg">`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const host = getSourcePanelHostForTesting()!;
    const shadow = host.shadowRoot!;
    const input = shadow.querySelector<HTMLInputElement>(".source-selection input")!;
    const hitTest = vi.fn(() => input);
    Object.defineProperty(shadow, "elementFromPoint", {
      configurable: true,
      value: hitTest,
    });

    input.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 11 }),
    );
    shadow.querySelector<HTMLButtonElement>(".close")!.click();
    vi.advanceTimersByTime(90);
    hitTest.mockClear();
    document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 11 }));

    expect(hitTest).not.toHaveBeenCalled();
  });

  test("updates only the checkbox whose selection changed", () => {
    document.body.innerHTML = Array.from(
      { length: 8 },
      (_, index) => `<img src="image-${index}.jpg">`,
    ).join("");
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const inputs = [
      ...getSourcePanelHostForTesting()!.shadowRoot!.querySelectorAll<HTMLInputElement>(
        ".source-selection input",
      ),
    ];
    const checkedWrites = vi.spyOn(HTMLInputElement.prototype, "checked", "set");
    inputs[3]!.checked = true;
    checkedWrites.mockClear();

    inputs[3]!.dispatchEvent(new Event("change"));

    expect(checkedWrites).toHaveBeenCalledOnce();
  });

  test("drops selections whose source disappears during a refresh", () => {
    document.body.innerHTML = `<img src="gone.jpg">`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const shadow = getSourcePanelHostForTesting()!.shadowRoot!;
    const input = shadow.querySelector<HTMLInputElement>(".source-selection input")!;
    input.checked = true;
    input.dispatchEvent(new Event("change"));
    replaceSourcePanel(vi.fn(), {
      includeBackgrounds: false,
      includeLinks: true,
      live: false,
    });
    document.querySelector("img")!.remove();
    replaceSourcePanel(vi.fn(), {
      includeBackgrounds: false,
      includeLinks: false,
      live: false,
    });

    expect(shadow.querySelector(".selection-count")?.textContent).toBe("0 selected");
  });

  test("labels the selected responsive source and its descriptors", () => {
    document.body.innerHTML = `<img src="fallback.jpg" srcset="selected.jpg 1x, large.jpg 2x">`;
    const image = document.querySelector("img")!;
    Object.defineProperty(image, "currentSrc", {
      configurable: true,
      value: "http://localhost/selected.jpg",
    });
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const rows = [...getSourcePanelHostForTesting()!.shadowRoot!.querySelectorAll(".row")];

    expect(rows[0]?.querySelector(".meta-details")?.textContent).toContain("1x");
    expect(rows[0]?.querySelector(".current-source")?.textContent).toBe("Current");
    const large = rows.find((row) =>
      row.querySelector<HTMLAnchorElement>(".source-link")?.href.endsWith("/large.jpg"),
    );
    expect(large?.querySelector(".meta-details")?.textContent).toContain("2x");
  });

  test("refreshes the current responsive source after the viewport changes", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<img src="fallback.jpg" srcset="small.jpg 1x, large.jpg 2x">`;
    const image = document.querySelector("img")!;
    Object.defineProperty(image, "currentSrc", {
      configurable: true,
      value: "http://localhost/small.jpg",
    });
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: true });
    const shadow = getSourcePanelHostForTesting()!.shadowRoot!;
    expect(
      shadow
        .querySelector(".current-source")
        ?.closest(".row")
        ?.querySelector<HTMLAnchorElement>(".source-link")?.href,
    ).toBe("http://localhost/small.jpg");

    Object.defineProperty(image, "currentSrc", {
      configurable: true,
      value: "http://localhost/large.jpg",
    });
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(200);

    expect(
      shadow
        .querySelector(".current-source")
        ?.closest(".row")
        ?.querySelector<HTMLAnchorElement>(".source-link")?.href,
    ).toBe("http://localhost/large.jpg");
  });

  test("confirms a batch larger than twenty sources", async () => {
    document.body.innerHTML = Array.from(
      { length: 21 },
      (_, index) => `<img src="image-${index}.jpg">`,
    ).join("");
    const sendDownload = vi.fn().mockResolvedValue(true);
    toggleSourcePanel(sendDownload, { includeBackgrounds: false, live: false });
    const shadow = getSourcePanelHostForTesting()!.shadowRoot!;
    const buttons = [...shadow.querySelectorAll<HTMLButtonElement>(".selection-bar button")];
    buttons.find(({ textContent }) => textContent === "Select filtered")!.click();
    shadow.querySelector<HTMLButtonElement>(".batch-save")!.click();

    expect(sendDownload).not.toHaveBeenCalled();
    expect(shadow.querySelector(".batch-dialog")?.hasAttribute("open")).toBe(true);
    const proceed = [...shadow.querySelectorAll<HTMLButtonElement>(".batch-dialog button")].find(
      ({ textContent }) => textContent === "Save sources",
    )!;
    proceed.click();
    await vi.waitFor(() => expect(sendDownload).toHaveBeenCalledTimes(21));
  });

  test("cancels large batches through both dialog exits", async () => {
    document.body.innerHTML = Array.from(
      { length: 21 },
      (_, index) => `<img src="image-${index}.jpg">`,
    ).join("");
    const sendDownload = vi.fn();
    toggleSourcePanel(sendDownload, { includeBackgrounds: false, live: false });
    const shadow = getSourcePanelHostForTesting()!.shadowRoot!;
    const select = [...shadow.querySelectorAll<HTMLButtonElement>(".selection-bar button")].find(
      ({ textContent }) => textContent === "Select filtered",
    )!;
    const save = shadow.querySelector<HTMLButtonElement>(".batch-save")!;
    const dialog = shadow.querySelector<HTMLDialogElement>(".batch-dialog")!;
    dialog.showModal = vi.fn(() => dialog.setAttribute("open", ""));
    dialog.close = vi.fn(() => dialog.removeAttribute("open"));
    select.click();
    save.click();
    await Promise.resolve();
    [...dialog.querySelectorAll<HTMLButtonElement>("button")]
      .find(({ textContent }) => textContent === "Cancel")!
      .click();
    await Promise.resolve();
    save.click();
    await Promise.resolve();
    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    await Promise.resolve();

    expect(sendDownload).not.toHaveBeenCalled();
    expect(dialog.close).toHaveBeenCalledTimes(2);
  });

  test("handles empty, thrown, cleared, and vanished batch selections", async () => {
    document.body.innerHTML = `<img src="throw.jpg"><img src="vanish.jpg">`;
    let release: ((value: boolean) => void) | undefined;
    const sendDownload = vi
      .fn()
      .mockRejectedValueOnce(new Error("failed"))
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => (release = resolve)));
    toggleSourcePanel(sendDownload, { includeBackgrounds: false, live: false });
    const shadow = getSourcePanelHostForTesting()!.shadowRoot!;
    const save = shadow.querySelector<HTMLButtonElement>(".batch-save")!;
    save.click();
    expect(sendDownload).not.toHaveBeenCalled();
    const select = [...shadow.querySelectorAll<HTMLButtonElement>(".selection-bar button")].find(
      ({ textContent }) => textContent === "Select filtered",
    )!;
    select.click();
    expect(shadow.querySelector(".selection-count")?.textContent).toBe("2 selected");
    save.click();
    await vi.waitFor(() => expect(sendDownload).toHaveBeenCalledTimes(2));
    expect(shadow.querySelector(".selection-bar")?.getAttribute("aria-busy")).toBe("true");
    expect(shadow.querySelector(".list")?.getAttribute("aria-busy")).toBe("true");
    expect(save.disabled).toBe(true);
    document.querySelectorAll("img").forEach((image) => image.remove());
    replaceSourcePanel(sendDownload, {
      includeBackgrounds: false,
      includeLinks: true,
      live: false,
    });
    release?.(false);
    await vi.waitFor(() =>
      expect(shadow.querySelector(".selection-count")?.textContent).toBe("0 selected"),
    );
    expect(shadow.querySelector(".selection-bar")?.getAttribute("aria-busy")).toBe("false");
    expect(shadow.querySelector(".list")?.getAttribute("aria-busy")).toBe("false");
    expect(save.disabled).toBe(false);

    [...shadow.querySelectorAll<HTMLButtonElement>(".selection-bar button")]
      .find(({ textContent }) => textContent === "Clear selection")
      ?.click();
    expect(sendDownload).toHaveBeenCalledTimes(2);
  });

  test("shows the unfiltered no-match state for an empty source kind", () => {
    document.body.innerHTML = `<img src="cat.jpg">`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const shadow = getSourcePanelHostForTesting()!.shadowRoot!;
    [...shadow.querySelectorAll<HTMLButtonElement>(".facet")]
      .find(({ textContent }) => textContent?.startsWith("Video"))!
      .click();

    expect(shadow.querySelector(".empty")?.textContent).toContain("No sources match");
    expect(shadow.querySelector(".empty button")).not.toBeNull();
  });

  test("keeps rejected batch sources selected for retry", async () => {
    document.body.innerHTML = `<img src="accepted.jpg"><img src="rejected.jpg">`;
    const sendDownload = vi.fn(async ({ url }: { url: string }) => !url.endsWith("rejected.jpg"));
    toggleSourcePanel(sendDownload, { includeBackgrounds: false, live: false });
    const shadow = getSourcePanelHostForTesting()!.shadowRoot!;
    const select = [...shadow.querySelectorAll<HTMLButtonElement>(".selection-bar button")].find(
      ({ textContent }) => textContent === "Select filtered",
    )!;
    select.click();
    shadow.querySelector<HTMLButtonElement>(".batch-save")!.click();
    await vi.waitFor(() => expect(sendDownload).toHaveBeenCalledTimes(2));

    const selectedUrls = [...shadow.querySelectorAll<HTMLInputElement>(".source-selection input")]
      .filter(({ checked }) => checked)
      .map(({ dataset }) => dataset.sourceUrl);
    expect(selectedUrls).toEqual(["http://localhost/rejected.jpg"]);
  });

  test("offers an automatic rule draft for each source", () => {
    document.body.innerHTML = `<img src="cat.jpg">`;
    const onCreateRule = vi.fn();
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false, onCreateRule });
    const shadow = getSourcePanelHostForTesting()!.shadowRoot!;
    const action = [...shadow.querySelectorAll<HTMLButtonElement>(".action-menu button")].find(
      ({ textContent }) => textContent === "Create automatic rule",
    )!;

    action.click();

    expect(onCreateRule).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "image", url: expect.stringContaining("cat.jpg") }),
    );
  });

  test("Alt-clicking non-save action buttons does not trigger a row download", () => {
    document.body.innerHTML = `<img src="cat.jpg">`;
    const sendDownload = vi.fn();
    toggleSourcePanel(sendDownload, { includeBackgrounds: false, live: false });
    const locate = document
      .getElementById("save-in-source-panel")!
      .shadowRoot!.querySelector<HTMLButtonElement>(".action-menu button")!;
    document.querySelector<HTMLImageElement>("img")!.scrollIntoView = vi.fn();

    locate.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, altKey: true }));

    expect(sendDownload).not.toHaveBeenCalled();
  });

  test("exposes explicit accessible panel positions", () => {
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const host = document.getElementById("save-in-source-panel")!;
    const shadow = host.shadowRoot!;
    const floating = shadow.querySelector<HTMLButtonElement>('[data-placement="floating"]')!;
    const right = shadow.querySelector<HTMLButtonElement>('[data-placement="right"]')!;

    floating.click();

    expect(host.classList).toContain("floating");
    expect(floating.getAttribute("aria-checked")).toBe("true");

    right.click();
    expect(host.classList).not.toContain("floating");
    expect(right.getAttribute("aria-checked")).toBe("true");
  });

  test("newest and oldest visibly reverse sources detected in one render", () => {
    vi.spyOn(Date, "now").mockReturnValue(100);
    document.body.innerHTML = `<img src="first.jpg"><img src="second.jpg">`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const shadow = document.getElementById("save-in-source-panel")!.shadowRoot!;
    const names = () =>
      [...shadow.querySelectorAll<HTMLElement>(".source-link .name")].map(
        (name) => name.textContent,
      );

    expect(names()).toEqual(["second.jpg", "first.jpg"]);

    const sort = shadow.querySelector<HTMLSelectElement>('select[aria-label="Sort sources"]')!;
    sort.value = "detected-asc";
    sort.dispatchEvent(new Event("change"));

    expect(names()).toEqual(["first.jpg", "second.jpg"]);
  });

  test("uses the full compact result body as a link and replaces broken previews", () => {
    document.body.innerHTML = `<img src="missing.jpg">`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const shadow = document.getElementById("save-in-source-panel")!.shadowRoot!;
    const rowLink = shadow.querySelector<HTMLAnchorElement>(".source-link")!;
    const preview = rowLink.querySelector<HTMLImageElement>("img")!;

    expect(rowLink.href).toBe("http://localhost/missing.jpg");
    expect(rowLink.querySelector(".name")?.tagName).toBe("SPAN");
    preview.dispatchEvent(new Event("error"));

    expect(rowLink.querySelector("img")).toBeNull();
    expect(rowLink.querySelector("[aria-label]")).not.toBeNull();
  });

  test("updates image and video metadata after their previews load", () => {
    document.body.innerHTML = `<img src="photo.jpg"><video src="movie.mp4"></video>`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const shadow = getSourcePanelHostForTesting()!.shadowRoot!;
    const image = shadow.querySelector<HTMLImageElement>('.row[data-kind="image"] img')!;
    Object.defineProperties(image, {
      naturalWidth: { value: 640 },
      naturalHeight: { value: 480 },
    });
    image.dispatchEvent(new Event("load"));
    const video = shadow.querySelector<HTMLVideoElement>('.row[data-kind="video"] video')!;
    Object.defineProperties(video, {
      duration: { value: 12.4 },
      videoWidth: { value: 1920 },
      videoHeight: { value: 1080 },
    });
    video.dispatchEvent(new Event("loadedmetadata"));

    expect(shadow.querySelector('.row[data-kind="image"] .meta')?.textContent).toContain("640×480");
    expect(shadow.querySelector('.row[data-kind="video"] .meta')?.textContent).toContain("12s");
  });

  test("formats every source-size weight and optional media detail", () => {
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      { name: "http://localhost/small.jpg", encodedBodySize: 512 },
      { name: "http://localhost/medium.jpg", encodedBodySize: 2 * 1024 * 1024 },
      { name: "http://localhost/large.jpg", encodedBodySize: 12 * 1024 * 1024 },
    ] as unknown as PerformanceEntry[]);
    document.body.innerHTML = `<img src="small.jpg"><img src="medium.jpg"><img src="large.jpg"><video src="unknown.mp4"></video>`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const shadow = getSourcePanelHostForTesting()!.shadowRoot!;
    expect(
      [...shadow.querySelectorAll<HTMLElement>(".source-size")].map(
        ({ dataset }) => dataset.sizeWeight,
      ),
    ).toEqual(expect.arrayContaining(["regular", "medium", "bold"]));
    const video = shadow.querySelector<HTMLVideoElement>('.row[data-kind="video"] video')!;
    Object.defineProperties(video, {
      duration: { value: Number.POSITIVE_INFINITY },
      videoWidth: { value: 0 },
    });
    video.dispatchEvent(new Event("loadedmetadata"));
    expect(shadow.querySelector('.row[data-kind="video"] .meta')?.textContent).not.toContain("×");
  });

  test("renders audio and host-only link fallbacks", () => {
    document.body.innerHTML = `<audio src="sound.mp3"></audio><a href="https://example.test/">host</a>`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const shadow = getSourcePanelHostForTesting()!.shadowRoot!;

    expect(shadow.querySelector('.row[data-kind="audio"] .audio')?.textContent).toBe("♪");
    expect(
      [...shadow.querySelectorAll<HTMLElement>(".name")].map(({ textContent }) => textContent),
    ).toContain("example.test");
  });

  test("does not highlight non-HTML source elements", () => {
    document.body.innerHTML = `<svg><a href="https://example.test/vector.svg">vector</a></svg>`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const row = getSourcePanelHostForTesting()!.shadowRoot!.querySelector<HTMLElement>(".row")!;

    row.querySelector<HTMLButtonElement>(".action-menu button")!.click();
    row.querySelector(".source-link")!.dispatchEvent(new MouseEvent("mouseenter"));
    setSourcePanelOpen(false, vi.fn(), { includeBackgrounds: false, live: false });

    expect(document.querySelector("svg a")?.getAttribute("style")).toBeNull();
  });

  test("positions and retires rich tooltips with ResizeObserver", () => {
    const callbacks: ResizeObserverCallback[] = [];
    class ResizeObserverStub {
      constructor(callback: ResizeObserverCallback) {
        callbacks.push(callback);
      }
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(new Error());
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    document.body.innerHTML = `<video src="movie.mp4"></video><a href="paper.pdf">paper</a>`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const host = getSourcePanelHostForTesting()!;
    const shadow = host.shadowRoot!;
    shadow.querySelector<HTMLButtonElement>('[data-placement="floating"]')!.click();
    const videoRow = shadow.querySelector<HTMLElement>('.row[data-kind="video"]')!;
    const videoLink = videoRow.querySelector(".source-link")!;
    videoLink.dispatchEvent(new MouseEvent("mouseenter"));
    const tooltip = shadow.querySelector<HTMLElement>(".media-tooltip")!;
    callbacks[0]!([], {} as ResizeObserver);
    tooltip.querySelector("video")?.dispatchEvent(new Event("loadedmetadata"));
    videoLink.dispatchEvent(new MouseEvent("mouseleave"));
    callbacks[0]!([], {} as ResizeObserver);

    const documentRow = shadow.querySelector<HTMLElement>('.row[data-kind="document"]')!;
    documentRow.querySelector(".source-link")!.dispatchEvent(new MouseEvent("mouseenter"));
    expect(shadow.querySelectorAll(".media-tooltip")).toHaveLength(0);
    expect(play).toHaveBeenCalled();
  });

  test("removes an injected empty marker when sources are rendered", () => {
    document.body.innerHTML = `<img src="cat.jpg">`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const shadow = getSourcePanelHostForTesting()!.shadowRoot!;
    const marker = document.createElement("div");
    marker.className = "empty";
    shadow.querySelector(".list")!.prepend(marker);
    const foreign = document.createElement("span");
    shadow.querySelector(".list")!.append(foreign);

    shadow.querySelector<HTMLButtonElement>(".facet")!.click();

    expect(marker.isConnected).toBe(false);
    expect(foreign.isConnected).toBe(false);
  });

  test("closes when replacement options disable the panel", () => {
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });

    expect(replaceSourcePanel(vi.fn(), { enabled: false })).toBe(false);
    expect(getSourcePanelHostForTesting()?.classList).toContain("closing");
  });

  test("returns stable state for replace and set-open no-ops", () => {
    expect(replaceSourcePanel(vi.fn())).toBe(false);
    expect(setSourcePanelOpen(false, vi.fn())).toBe(false);
    expect(toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false })).toBe(true);
    expect(setSourcePanelOpen(true, vi.fn())).toBe(true);
    expect(setSourcePanelOpen(false, vi.fn())).toBe(false);
    expect(setSourcePanelOpen(false, vi.fn())).toBe(false);
  });

  test("shows and removes a rich tooltip without competing native titles", () => {
    document.body.innerHTML = `<img src="large.jpg">`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const shadow = document.getElementById("save-in-source-panel")!.shadowRoot!;
    const row = shadow.querySelector<HTMLElement>(".row")!;
    const sourceLink = row.querySelector<HTMLAnchorElement>(".source-link")!;

    expect(row.title).toBe("");
    expect(sourceLink.title).toBe("");
    sourceLink.dispatchEvent(new MouseEvent("mouseenter"));
    expect(shadow.querySelector<HTMLImageElement>(".media-tooltip img")?.src).toBe(
      "http://localhost/large.jpg",
    );
    expect(sourceLink.hasAttribute("aria-describedby")).toBe(true);
    sourceLink.dispatchEvent(new MouseEvent("mouseleave"));
    expect(shadow.querySelector(".media-tooltip")).toBeNull();
    expect(sourceLink.hasAttribute("aria-describedby")).toBe(false);
  });

  test("keeps hover previews available when inline thumbnails are disabled", () => {
    document.body.innerHTML = `<img src="hover-only.jpg">`;
    toggleSourcePanel(vi.fn(), {
      includeBackgrounds: false,
      live: false,
      previews: false,
    });
    const shadow = document.getElementById("save-in-source-panel")!.shadowRoot!;
    const row = shadow.querySelector<HTMLElement>(".row")!;

    expect(row.querySelector(".source-link img")).toBeNull();
    row.querySelector(".source-link")!.dispatchEvent(new MouseEvent("mouseenter"));
    expect(shadow.querySelector<HTMLImageElement>(".media-tooltip img")?.src).toBe(
      "http://localhost/hover-only.jpg",
    );
  });

  test("plays and pauses muted video hover previews", () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    document.body.innerHTML = `<video src="clip.mp4"></video>`;
    toggleSourcePanel(vi.fn(), {
      includeBackgrounds: false,
      live: false,
      previews: false,
    });
    const shadow = document.getElementById("save-in-source-panel")!.shadowRoot!;
    const row = shadow.querySelector<HTMLElement>(".row")!;

    const sourceLink = row.querySelector(".source-link")!;
    sourceLink.dispatchEvent(new MouseEvent("mouseenter"));
    const preview = shadow.querySelector<HTMLVideoElement>(".media-tooltip video")!;
    expect(preview.muted).toBe(true);
    expect(play).toHaveBeenCalled();

    sourceLink.dispatchEvent(new MouseEvent("mouseleave"));
    expect(pause).toHaveBeenCalled();
    expect(preview.isConnected).toBe(false);
  });

  test("shows the same preview and page outline for keyboard focus", () => {
    document.body.innerHTML = `<img id="source" src="keyboard.jpg">`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const source = document.querySelector<HTMLElement>("#source")!;
    const shadow = document.getElementById("save-in-source-panel")!.shadowRoot!;
    const row = shadow.querySelector<HTMLElement>(".row")!;
    const sourceLink = row.querySelector<HTMLAnchorElement>(".source-link")!;

    sourceLink.dispatchEvent(new FocusEvent("focus"));
    expect(shadow.querySelector(".media-tooltip")).not.toBeNull();
    expect(source.style.outline).not.toBe("");
    sourceLink.dispatchEvent(new FocusEvent("blur", { relatedTarget: null }));
    expect(shadow.querySelector(".media-tooltip")).toBeNull();
    expect(source.style.outline).toBe("");
  });

  test("copies only the media URL for a yt-dlp hand-off", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    document.body.innerHTML = `<video src="https://cdn.test/movie.mp4?probe=$(id)"></video>`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const shadow = document.getElementById("save-in-source-panel")!.shadowRoot!;

    shadow.querySelector<HTMLButtonElement>(".actions button[title]")!.click();

    await vi.waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("https://cdn.test/movie.mp4?probe=$(id)"),
    );
  });

  test("restores the yt-dlp action after success and reports copy failure", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error());
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    document.body.innerHTML = `<video src="https://cdn.test/movie.mp4"></video>`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const action =
      getSourcePanelHostForTesting()!.shadowRoot!.querySelector<HTMLButtonElement>(
        ".actions button[title]",
      )!;

    action.click();
    await vi.advanceTimersByTimeAsync(0);
    vi.advanceTimersByTime(1200);
    expect(action.textContent).toContain("yt-dlp");
    action.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(action.textContent).toContain("failed");
  });
});
