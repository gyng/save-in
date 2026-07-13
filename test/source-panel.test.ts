// @vitest-environment jsdom
import {
  getSourcePanelHostForTesting,
  replaceSourcePanel,
  setSourcePanelOpen,
  toggleSourcePanel,
} from "../src/content/source-panel.ts";
import { createSourcePanelCopy } from "../src/shared/source-panel-copy.ts";

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
    (globalThis as { SAVE_IN_CONTENT_E2E?: boolean }).SAVE_IN_CONTENT_E2E = true;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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
    expect(impostor.classList.contains("closing")).toBe(false);
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
    expect(imageFacet?.querySelector(".facet-count")?.textContent).toBe("1");
    imageFacet!.click();
    expect(shadow!.querySelector("h2")?.textContent).toBe("Page sources");
    shadow!.querySelector<HTMLButtonElement>(".copy-urls")!.click();
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith("http://localhost/cat.jpg");
  });

  test("marks the panel closing before its short exit transition removes it", () => {
    vi.useFakeTimers();
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    expect(toggleSourcePanel(vi.fn())).toBe(false);
    const host = document.getElementById("save-in-source-panel");
    expect(host?.classList.contains("closing")).toBe(true);
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
    shadow.querySelector<HTMLButtonElement>(".dock")!.click();

    expect(replaceSourcePanel(vi.fn(), { ...options, previews: false })).toBe(true);

    expect(getSourcePanelHostForTesting()).toBe(host);
    expect(filter.value).toBe("cat");
    expect(sort.value).toBe("name-asc");
    expect(host.dataset.dock).toBe("bottom");
    expect(shadow.querySelector(".source-link img")).toBeNull();
  });

  test("applies and live-updates the Page Sources theme override", () => {
    const options = { includeBackgrounds: false, live: false, theme: "dark" as const };
    toggleSourcePanel(vi.fn(), options);
    const host = getSourcePanelHostForTesting()!;

    expect(host.dataset.theme).toBe("dark");

    expect(replaceSourcePanel(vi.fn(), { ...options, theme: "light" })).toBe(true);
    expect(getSourcePanelHostForTesting()).toBe(host);
    expect(host.dataset.theme).toBe("light");
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
    catRow.dispatchEvent(new MouseEvent("mouseenter"));
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
    firstLink.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    rows[1]!.dispatchEvent(new MouseEvent("mouseenter"));

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

    expect(video.src).toBe("http://localhost/movie.mp4");
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

  test("updates displayed sizes for ordinary resources observed after opening", () => {
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
    row.dispatchEvent(new MouseEvent("mouseenter"));
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
    expect(shadow.querySelector(".meta")?.textContent).toContain("2 KB");
    expect(
      getSourcePanelHostForTesting()!.shadowRoot!.querySelector<HTMLElement>(".source-size")
        ?.dataset.sizeWeight,
    ).toBe("regular");

    reportSize(2 * 1024 * 1024);
    expect(
      getSourcePanelHostForTesting()!.shadowRoot!.querySelector<HTMLElement>(".source-size")
        ?.dataset.sizeWeight,
    ).toBe("medium");

    reportSize(12 * 1024 * 1024);
    expect(
      getSourcePanelHostForTesting()!.shadowRoot!.querySelector<HTMLElement>(".source-size")
        ?.dataset.sizeWeight,
    ).toBe("bold");
  });

  test("gives every header action an accessible name", () => {
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const shadow = document.getElementById("save-in-source-panel")!.shadowRoot!;

    const actions = [...shadow.querySelectorAll<HTMLButtonElement>(".header-actions button")];
    expect(actions.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Copy filtered source URLs",
      "Change panel dock position",
      "Pop out Page Sources",
      "Close Page Sources",
    ]);
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
    const buttons = [...row.querySelectorAll<HTMLButtonElement>(".actions button")];
    const locate = buttons[0]!;
    const save = buttons[1]!;

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
      .shadowRoot!.querySelector<HTMLButtonElement>(".actions button:last-child")!;

    save.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, altKey: true }));

    expect(sendDownload).toHaveBeenCalledOnce();
  });

  test("Alt-clicking non-save action buttons does not trigger a row download", () => {
    document.body.innerHTML = `<img src="cat.jpg">`;
    const sendDownload = vi.fn();
    toggleSourcePanel(sendDownload, { includeBackgrounds: false, live: false });
    const locate = document
      .getElementById("save-in-source-panel")!
      .shadowRoot!.querySelector<HTMLButtonElement>(".actions button")!;
    document.querySelector<HTMLImageElement>("img")!.scrollIntoView = vi.fn();

    locate.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, altKey: true }));

    expect(sendDownload).not.toHaveBeenCalled();
  });

  test("pops the drawer into a draggable floating panel", () => {
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const host = document.getElementById("save-in-source-panel")!;
    const popout = host.shadowRoot!.querySelector<HTMLButtonElement>(".popout")!;

    popout.click();

    expect(host.classList.contains("floating")).toBe(true);
    expect(popout.getAttribute("aria-pressed")).toBe("true");
    expect(popout.getAttribute("aria-label")).toBe("Dock Page Sources");
    expect(popout.title).toBe("Dock Page Sources");

    vi.spyOn(host, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 80,
      width: 320,
      height: 400,
      right: 420,
      bottom: 480,
      x: 100,
      y: 80,
      toJSON: () => ({}),
    });
    const header = host.shadowRoot!.querySelector("header")!;
    header.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 120, clientY: 100 }),
    );
    header.dispatchEvent(
      new MouseEvent("pointermove", { bubbles: true, clientX: 160, clientY: 130 }),
    );

    expect(host.style.left).toBe("140px");
    expect(host.style.top).toBe("110px");

    host.shadowRoot!.querySelector<HTMLButtonElement>(".dock")!.click();
    expect(host.classList.contains("floating")).toBe(false);
    expect(host.style.left).toBe("");
    expect(host.style.top).toBe("");
    expect(popout.getAttribute("aria-label")).toBe("Pop out Page Sources");
    expect(popout.title).toBe("Pop out into a draggable panel");
  });

  test("shows compact detection order with the detection time in a tooltip", () => {
    document.body.innerHTML = `<img src="cat.jpg">`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const detected = document
      .getElementById("save-in-source-panel")!
      .shadowRoot!.querySelector<HTMLElement>(".detected")!;

    expect(detected.textContent).toBe("#1");
    expect(detected.getAttribute("aria-label")).toMatch(/^Detected at /);
    expect(detected.title).toBe("");
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
    expect(rowLink.querySelector(".preview-fallback")?.textContent).toBe("▧");
  });

  test("shows and removes a rich tooltip without competing native titles", () => {
    document.body.innerHTML = `<img src="large.jpg">`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const shadow = document.getElementById("save-in-source-panel")!.shadowRoot!;
    const row = shadow.querySelector<HTMLElement>(".row")!;
    const sourceLink = row.querySelector<HTMLAnchorElement>(".source-link")!;

    expect(row.title).toBe("");
    expect(sourceLink.title).toBe("");
    row.dispatchEvent(new MouseEvent("mouseenter"));
    expect(shadow.querySelector<HTMLImageElement>(".media-tooltip img")?.src).toBe(
      "http://localhost/large.jpg",
    );
    expect(sourceLink.hasAttribute("aria-describedby")).toBe(true);
    row.dispatchEvent(new MouseEvent("mouseleave"));
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
    row.dispatchEvent(new MouseEvent("mouseenter"));
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

    row.dispatchEvent(new MouseEvent("mouseenter"));
    const preview = shadow.querySelector<HTMLVideoElement>(".media-tooltip video")!;
    expect(preview.muted).toBe(true);
    expect(play).toHaveBeenCalled();

    row.dispatchEvent(new MouseEvent("mouseleave"));
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

    sourceLink.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(shadow.querySelector(".media-tooltip")).not.toBeNull();
    expect(source.style.outline).toContain("3px");
    sourceLink.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
    expect(shadow.querySelector(".media-tooltip")).toBeNull();
    expect(source.style.outline).toBe("");
  });

  test("describes streaming playlists without relying on manifest jargon", () => {
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      { name: "https://cdn.test/master.m3u8" } as PerformanceEntry,
    ]);
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const shadow = document.getElementById("save-in-source-panel")!.shadowRoot!;
    const playlistFacet = [...shadow.querySelectorAll<HTMLButtonElement>(".facet")].find(
      (button) => button.childNodes[0]?.textContent === "Playlist",
    );

    expect(playlistFacet).toBeDefined();
    playlistFacet!.click();
    expect(shadow.querySelector(".meta")?.textContent).toContain("Playlist");
    expect(
      [...shadow.querySelectorAll(".actions button")].map((button) => button.textContent),
    ).toEqual(["Locate", "Save playlist", "Copy yt-dlp command"]);
  });

  test("offers a yt-dlp command for direct video sources", () => {
    document.body.innerHTML = `<video src="https://cdn.test/movie.mp4"></video>`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const shadow = document.getElementById("save-in-source-panel")!.shadowRoot!;

    expect(
      [...shadow.querySelectorAll(".actions button")].map((button) => button.textContent),
    ).toEqual(["Locate", "Save", "Copy yt-dlp command"]);
  });
});
