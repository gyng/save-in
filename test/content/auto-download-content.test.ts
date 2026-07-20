// @vitest-environment jsdom
import {
  setupAutoDownloadDiscovery as rawSetupAutoDownloadDiscovery,
  type AutoDownloadDiscoveryOptions,
  type AutoDownloadSendResult,
} from "../../src/content/auto-download.ts";
import { Sha256 } from "../../src/shared/sha256.ts";

// Link adoption, the phase-B channel toggles, and the disable-list predicate
// are wired in from content.ts; default them here so each case only states
// what it exercises.
type DefaultedOption =
  | "includeLinks"
  | "includeDocuments"
  | "includeBackgrounds"
  | "resourceHints"
  | "includeDataUrls"
  | "isPageDisabled";

const setupAutoDownloadDiscovery = (
  options: Omit<AutoDownloadDiscoveryOptions, DefaultedOption> &
    Partial<Pick<AutoDownloadDiscoveryOptions, DefaultedOption>>,
) =>
  rawSetupAutoDownloadDiscovery({
    includeLinks: false,
    includeDocuments: false,
    includeBackgrounds: false,
    resourceHints: false,
    includeDataUrls: false,
    isPageDisabled: () => false,
    ...options,
  });

const rules = `
context: ^auto$
pageurl: ^http://localhost/
sourcekind: image
sourceurl/i: \\.(?:png|jpg)(?:[?#].*)?$
into: automatic/
`;

// No sourcekind matcher, so this rule isolates the scan's channel gates from
// rule matching: every candidate URL matches, and only the option gates decide.
const anyKindRules = `
context: ^auto$
pageurl: ^http://localhost/
sourceurl: cdn\\.test
into: automatic/
`;

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const flushLiveScan = async () => {
  await settle();
  await vi.advanceTimersByTimeAsync(200);
};

describe("automatic source discovery", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  test("queues matching selected page sources after initial discovery", async () => {
    document.body.innerHTML = `
      <img src="https://cdn.test/cat.png">
      <img src="https://cdn.test/readme.txt">
    `;
    const send = vi.fn(() => Promise.resolve("started" as const));
    const controller = setupAutoDownloadDiscovery({ rules, live: false, maxPerPage: 20, send });

    await controller.idle();

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({
      pageUrl: "http://localhost/",
      sourceUrl: "https://cdn.test/cat.png",
      sourceKind: "image",
    });
    controller.stop();
  });

  test("adopts a previewable-media anchor only when link adoption is enabled", async () => {
    document.body.innerHTML = `
      <a href="https://cdn.test/linked.jpg">image link</a>
      <a href="https://cdn.test/page.html">plain link</a>
    `;
    const send = vi.fn(() => Promise.resolve("started" as const));
    const controller = setupAutoDownloadDiscovery({
      rules,
      live: false,
      maxPerPage: 20,
      includeLinks: true,
      send,
    });

    await controller.idle();

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({
      pageUrl: "http://localhost/",
      sourceUrl: "https://cdn.test/linked.jpg",
      sourceKind: "image",
      sourceChannel: "anchor",
    });
    controller.stop();
  });

  test("leaves linked media alone by default (pre-4.1 rules match embedded media only)", async () => {
    document.body.innerHTML = `
      <a href="https://cdn.test/linked.jpg">image link</a>
      <a href="https://cdn.test/page.html">plain link</a>
    `;
    const send = vi.fn(() => Promise.resolve("started" as const));
    // includeLinks defaults to false in the wrapper, matching autoDownloadLinks.
    const controller = setupAutoDownloadDiscovery({ rules, live: false, maxPerPage: 20, send });

    await controller.idle();

    expect(send).not.toHaveBeenCalled();
    controller.stop();
  });

  test("adopts a linked document without requiring link adoption, and still excludes a plain media link", async () => {
    document.body.innerHTML = `
      <a href="https://cdn.test/paper.pdf">paper</a>
      <a href="https://cdn.test/linked.jpg">image link</a>
    `;
    const send = vi.fn(() => Promise.resolve("started" as const));
    const controller = setupAutoDownloadDiscovery({
      rules: anyKindRules,
      live: false,
      maxPerPage: 20,
      includeDocuments: true,
      send,
    });

    await controller.idle();

    // includeDocuments turns on anchor collection by itself: the linked PDF is
    // adopted even though includeLinks (media links) stays off, and the media
    // anchor is still excluded because its own gate is off.
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({
      pageUrl: "http://localhost/",
      sourceUrl: "https://cdn.test/paper.pdf",
      sourceKind: "document",
      sourceChannel: "anchor",
    });
    controller.stop();
  });

  test("adopts a linked stream anchor only when the documents option is enabled, never merely from the manifests option", async () => {
    document.body.innerHTML = `<a href="https://cdn.test/playlist.m3u8">playlist</a>`;
    const send = vi.fn(() => Promise.resolve("started" as const));
    // The manifests (resourceHints) option does not collect anchors at all, so
    // a linked .m3u8 must stay unadopted even when it is on.
    const controllerManifestsOnly = setupAutoDownloadDiscovery({
      rules: anyKindRules,
      live: false,
      maxPerPage: 20,
      resourceHints: true,
      send,
    });
    await controllerManifestsOnly.idle();
    expect(send).not.toHaveBeenCalled();
    controllerManifestsOnly.stop();

    const send2 = vi.fn(() => Promise.resolve("started" as const));
    const controllerDocuments = setupAutoDownloadDiscovery({
      rules: anyKindRules,
      live: false,
      maxPerPage: 20,
      includeDocuments: true,
      send: send2,
    });
    await controllerDocuments.idle();
    expect(send2).toHaveBeenCalledOnce();
    expect(send2).toHaveBeenCalledWith({
      pageUrl: "http://localhost/",
      sourceUrl: "https://cdn.test/playlist.m3u8",
      sourceKind: "stream",
      sourceChannel: "anchor",
    });
    controllerDocuments.stop();
  });

  test("adopts a CSS background image only when the backgrounds option is enabled", async () => {
    document.body.innerHTML = `<div style="background-image:url('https://cdn.test/wall.png')"></div>`;
    const send = vi.fn(() => Promise.resolve("started" as const));
    const controllerOff = setupAutoDownloadDiscovery({ rules, live: false, maxPerPage: 20, send });
    await controllerOff.idle();
    expect(send).not.toHaveBeenCalled();
    controllerOff.stop();

    const send2 = vi.fn(() => Promise.resolve("started" as const));
    const controllerOn = setupAutoDownloadDiscovery({
      rules,
      live: false,
      maxPerPage: 20,
      includeBackgrounds: true,
      send: send2,
    });
    await controllerOn.idle();
    expect(send2).toHaveBeenCalledOnce();
    expect(send2).toHaveBeenCalledWith({
      pageUrl: "http://localhost/",
      sourceUrl: "https://cdn.test/wall.png",
      sourceKind: "image",
      sourceChannel: "background",
    });
    controllerOn.stop();
  });

  test("skips dispatch for a candidate once the page is on the disable list", async () => {
    document.body.innerHTML = '<img src="https://cdn.test/cat.png">';
    let disabled = false;
    const send = vi.fn(() => Promise.resolve("started" as const));
    const controller = setupAutoDownloadDiscovery({
      rules,
      live: false,
      maxPerPage: 20,
      isPageDisabled: () => disabled,
      send,
    });
    await controller.idle();
    expect(send).toHaveBeenCalledOnce();

    // A single-page-app navigation moves the page onto the disable list; a fresh
    // scan of a new image must not dispatch while disabled.
    disabled = true;
    document.body.insertAdjacentHTML("beforeend", '<img src="https://cdn.test/dog.png">');
    controller.scan();
    await controller.idle();
    expect(send).toHaveBeenCalledOnce();

    // Navigating back off the list resumes dispatch for newly discovered media.
    disabled = false;
    document.body.insertAdjacentHTML("beforeend", '<img src="https://cdn.test/fox.png">');
    controller.scan();
    await controller.idle();
    expect(send).toHaveBeenLastCalledWith({
      pageUrl: "http://localhost/",
      sourceUrl: "https://cdn.test/fox.png",
      sourceKind: "image",
    });
    controller.stop();
  });

  test("stops dispatching mid-drain when the page becomes disabled", async () => {
    document.body.innerHTML =
      '<img src="https://cdn.test/one.png"><img src="https://cdn.test/two.png">';
    let disabled = false;
    // The first send flips the predicate, standing in for a pushState
    // navigation onto the disable list while the queue is draining.
    const send = vi.fn(() => {
      disabled = true;
      return Promise.resolve("started" as const);
    });
    const controller = setupAutoDownloadDiscovery({
      rules,
      live: false,
      maxPerPage: 5,
      isPageDisabled: () => disabled,
      send,
    });
    await controller.idle();
    expect(send).toHaveBeenCalledOnce();
    controller.stop();
  });

  test("a candidate dropped mid-drain is un-consumed for later rescans", async () => {
    document.body.innerHTML =
      '<img src="https://cdn.test/one.png"><img src="https://cdn.test/two.png">';
    let disabled = false;
    const send = vi.fn(() => {
      disabled = true;
      return Promise.resolve("started" as const);
    });
    const controller = setupAutoDownloadDiscovery({
      rules,
      live: false,
      maxPerPage: 2,
      isPageDisabled: () => disabled,
      send,
    });
    await controller.idle();
    expect(send).toHaveBeenCalledOnce();

    // The dropped candidate returned its dedup slot and budget, so a rescan
    // after the page leaves the list still saves it.
    disabled = false;
    controller.scan();
    await controller.idle();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ sourceUrl: "https://cdn.test/two.png" }),
    );
    controller.stop();
  });

  test("a failed send frees its dedup slot and is re-offered on the next scan", async () => {
    document.body.innerHTML = '<img src="https://cdn.test/cat.png">';
    const results: AutoDownloadSendResult[] = ["failed", "started"];
    let index = 0;
    const send = vi.fn(() => Promise.resolve(results[index++] ?? "started"));
    const controller = setupAutoDownloadDiscovery({ rules, live: false, maxPerPage: 20, send });
    await controller.idle();
    expect(send).toHaveBeenCalledOnce();

    // The terminal "failed" result returned the once-per-visit slot, so a later
    // rescan re-offers the same source instead of skipping it forever.
    controller.scan();
    await controller.idle();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ sourceUrl: "https://cdn.test/cat.png" }),
    );
    controller.stop();
  });

  test("a backstop-skipped save frees its slot and is re-offered after re-enable", async () => {
    document.body.innerHTML = '<img src="https://cdn.test/cat.png">';
    const results: AutoDownloadSendResult[] = ["skipped", "started"];
    let index = 0;
    const send = vi.fn(() => Promise.resolve(results[index++] ?? "started"));
    const controller = setupAutoDownloadDiscovery({ rules, live: false, maxPerPage: 20, send });
    await controller.idle();
    expect(send).toHaveBeenCalledOnce();

    // A background backstop that skips the save (e.g. the channel was toggled
    // off) must not permanently consume the dedup slot: re-enabling and
    // rescanning re-offers the source.
    controller.scan();
    await controller.idle();
    expect(send).toHaveBeenCalledTimes(2);
    controller.stop();
  });

  test("a started save stays deduped across rescans", async () => {
    document.body.innerHTML = '<img src="https://cdn.test/cat.png">';
    const send = vi.fn(() => Promise.resolve("started" as const));
    const controller = setupAutoDownloadDiscovery({ rules, live: false, maxPerPage: 20, send });
    await controller.idle();
    expect(send).toHaveBeenCalledOnce();

    // A successful start holds the once-per-visit slot: rescanning the same page
    // must not re-send it.
    controller.scan();
    await controller.idle();
    expect(send).toHaveBeenCalledOnce();
    controller.stop();
  });

  test("a shared dedup state survives a remount without re-sending saved sources", async () => {
    document.body.innerHTML = '<img src="https://cdn.test/cat.png">';
    const send = vi.fn(() => Promise.resolve("started" as const));
    const dedup = { seen: new Set<string>(), limitNotified: false };
    const first = setupAutoDownloadDiscovery({ rules, live: false, maxPerPage: 5, send, dedup });
    await first.idle();
    expect(send).toHaveBeenCalledOnce();
    first.stop();

    // A disable-list edit remounts discovery with the page-owned dedup state:
    // the initial rescan must not re-download what this page already saved.
    const second = setupAutoDownloadDiscovery({ rules, live: false, maxPerPage: 5, send, dedup });
    await second.idle();
    expect(send).toHaveBeenCalledOnce();

    document.body.insertAdjacentHTML("beforeend", '<img src="https://cdn.test/new.png">');
    second.scan();
    await second.idle();
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ sourceUrl: "https://cdn.test/new.png" }),
    );
    second.stop();
  });

  test("a disabled page consumes neither dedup state nor the page budget", async () => {
    document.body.innerHTML =
      '<img src="https://cdn.test/one.png"><img src="https://cdn.test/two.png">';
    let disabled = true;
    const send = vi.fn(() => Promise.resolve("started" as const));
    const controller = setupAutoDownloadDiscovery({
      rules,
      live: false,
      maxPerPage: 2,
      isPageDisabled: () => disabled,
      send,
    });
    await controller.idle();
    expect(send).not.toHaveBeenCalled();

    // Un-disabling and rescanning must adopt both images: had the disabled
    // scan recorded them as seen or spent the two-slot budget, nothing would
    // ever save on this page again without a reload.
    disabled = false;
    controller.scan();
    await controller.idle();
    expect(send).toHaveBeenCalledTimes(2);
    controller.stop();
  });

  test("keeps valid automation active when an unrelated routing rule is invalid", async () => {
    document.body.innerHTML = '<img src="https://cdn.test/cat.png">';
    const send = vi.fn(() => Promise.resolve("started" as const));
    const controller = setupAutoDownloadDiscovery({
      rules: `filename: \\.pdf$\n\n${rules}`,
      live: false,
      maxPerPage: 20,
      send,
    });

    await controller.idle();

    expect(send).toHaveBeenCalledOnce();
    controller.stop();
  });

  test("discovers live insertions once and processes them sequentially", async () => {
    vi.useFakeTimers();
    const releases: Array<() => void> = [];
    const send = vi.fn(
      () =>
        new Promise<"started">((resolve) => {
          releases.push(() => resolve("started"));
        }),
    );
    const controller = setupAutoDownloadDiscovery({ rules, live: true, maxPerPage: 20, send });
    await settle();

    document.body.insertAdjacentHTML(
      "beforeend",
      '<img src="https://cdn.test/one.png"><img src="https://cdn.test/two.jpg">',
    );
    await flushLiveScan();

    expect(send).toHaveBeenCalledTimes(1);
    releases.shift()?.();
    await settle();
    expect(send).toHaveBeenCalledTimes(2);
    releases.shift()?.();
    await controller.idle();

    document.body.append(document.querySelector("img")!);
    await flushLiveScan();
    expect(send).toHaveBeenCalledTimes(2);
    controller.stop();
  });

  test("scans a small live insertion without rescanning the document", async () => {
    vi.useFakeTimers();
    const send = vi.fn(() => Promise.resolve("started" as const));
    const controller = setupAutoDownloadDiscovery({ rules, live: true, maxPerPage: 20, send });
    await controller.idle();
    const documentQueries = vi.spyOn(Document.prototype, "querySelectorAll");
    documentQueries.mockClear();

    const added = document.createElement("img");
    added.src = "https://cdn.test/incremental.png";
    document.body.append(added);
    await flushLiveScan();
    await controller.idle();

    expect(documentQueries).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ sourceUrl: "https://cdn.test/incremental.png" }),
    );
    controller.stop();
  });

  test("does not read resource timings when manifest discovery is disabled", async () => {
    const resourceEntries = vi.spyOn(performance, "getEntriesByType").mockReturnValue([]);
    const controller = setupAutoDownloadDiscovery({
      rules,
      live: false,
      maxPerPage: 20,
      resourceHints: false,
      send: vi.fn(() => Promise.resolve("started" as const)),
    });
    await controller.idle();

    expect(resourceEntries).not.toHaveBeenCalled();
    controller.stop();
  });

  test("reads resource timings once for an incremental mutation batch", async () => {
    vi.useFakeTimers();
    const resourceEntries = vi.spyOn(performance, "getEntriesByType").mockReturnValue([]);
    const controller = setupAutoDownloadDiscovery({
      rules,
      live: true,
      maxPerPage: 20,
      resourceHints: true,
      send: vi.fn(() => Promise.resolve("started" as const)),
    });
    await controller.idle();
    resourceEntries.mockClear();

    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 3; index += 1) {
      const image = document.createElement("img");
      image.src = `https://cdn.test/timing-${index}.png`;
      fragment.append(image);
    }
    document.body.append(fragment);
    await flushLiveScan();
    await controller.idle();

    expect(resourceEntries).toHaveBeenCalledOnce();
    controller.stop();
  });

  test("rescans the owning media element when a source changes", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<video><source></video>`;
    const video = document.querySelector("video")!;
    const send = vi.fn(() => Promise.resolve("started" as const));
    const controller = setupAutoDownloadDiscovery({
      rules: anyKindRules,
      live: true,
      maxPerPage: 20,
      send,
    });
    await controller.idle();
    Object.defineProperty(video, "currentSrc", {
      configurable: true,
      value: "https://cdn.test/live.mp4",
    });

    document.querySelector("source")!.src = "https://cdn.test/live.mp4";
    await flushLiveScan();
    await controller.idle();

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUrl: "https://cdn.test/live.mp4",
        sourceKind: "video",
      }),
    );
    controller.stop();
  });

  test("falls back to one document scan for a large mutation burst", async () => {
    vi.useFakeTimers();
    const send = vi.fn(() => Promise.resolve("started" as const));
    const controller = setupAutoDownloadDiscovery({ rules, live: true, maxPerPage: 100, send });
    await controller.idle();
    const documentQueries = vi.spyOn(Document.prototype, "querySelectorAll");
    documentQueries.mockClear();

    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 65; index += 1) {
      const container = document.createElement("div");
      container.innerHTML = `<img src="https://cdn.test/burst-${index}.png">`;
      fragment.append(container);
    }
    document.body.append(fragment);
    await flushLiveScan();
    await controller.idle();

    expect(documentQueries).toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(65);
    controller.stop();
  });

  test("rescans the document after a single-page navigation", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<div id="ticker"></div>`;
    const send = vi.fn(() => Promise.resolve("started" as const));
    const controller = setupAutoDownloadDiscovery({ rules, live: true, maxPerPage: 20, send });
    await controller.idle();
    const documentQueries = vi.spyOn(Document.prototype, "querySelectorAll");
    documentQueries.mockClear();

    history.pushState({}, "", "/next");
    document.querySelector("#ticker")!.setAttribute("src", "tick");
    await flushLiveScan();
    await controller.idle();

    const rescanned = documentQueries.mock.calls.length > 0;
    controller.stop();
    history.replaceState({}, "", "/");
    expect(rescanned).toBe(true);
  });

  test("still scans while mutations keep resetting the live debounce", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<div id="ticker"></div>`;
    const send = vi.fn(() => Promise.resolve("started" as const));
    const controller = setupAutoDownloadDiscovery({ rules, live: true, maxPerPage: 20, send });
    await controller.idle();
    const added = document.createElement("img");
    added.src = "https://cdn.test/busy.png";
    document.body.append(added);

    const ticker = document.querySelector<HTMLElement>("#ticker")!;
    for (let index = 0; index < 20; index += 1) {
      ticker.style.width = `${index}px`;
      await settle();
      await vi.advanceTimersByTimeAsync(100);
    }
    await controller.idle();

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ sourceUrl: "https://cdn.test/busy.png" }),
    );
    controller.stop();
  });

  test("rescans when an arbitrary attribute change makes a CSS selector match", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<img class="avatar" src="https://cdn.test/profile.png">';
    const send = vi.fn(() => Promise.resolve("started" as const));
    const controller = setupAutoDownloadDiscovery({
      rules: `context: ^auto$
pageurl: ^http://localhost/$
css: img[data-save]
into: automatic/`,
      live: true,
      maxPerPage: 20,
      send,
    });
    await controller.idle();
    expect(send).not.toHaveBeenCalled();

    document.querySelector("img")!.setAttribute("data-save", "");
    await flushLiveScan();
    await controller.idle();

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUrl: "https://cdn.test/profile.png",
        matchedCssSelectorsByOrigin: [["img[data-save]"]],
      }),
    );
    controller.stop();
  });

  test("does not observe later insertions when live discovery is off", async () => {
    vi.useFakeTimers();
    const send = vi.fn(() => Promise.resolve("started" as const));
    const controller = setupAutoDownloadDiscovery({ rules, live: false, maxPerPage: 20, send });
    await controller.idle();
    document.body.innerHTML = '<img src="https://cdn.test/later.png">';
    await vi.advanceTimersByTimeAsync(250);
    expect(send).not.toHaveBeenCalled();
    controller.stop();
  });

  test("enforces the page limit before sending and ignores non-network sources", async () => {
    document.body.innerHTML = `
      <img src="https://cdn.test/one.png">
      <img src="https://cdn.test/two.png">
      <img src="https://cdn.test/three.png">
      <img src="data:image/png;base64,AAAA">
    `;
    const send = vi.fn(() => Promise.resolve("started" as const));
    const limitReached = vi.fn();
    const controller = setupAutoDownloadDiscovery({
      rules,
      live: false,
      maxPerPage: 1,
      send,
      onLimitReached: limitReached,
    });
    await controller.idle();

    expect(send).toHaveBeenCalledOnce();
    expect(limitReached).toHaveBeenCalledOnce();
    controller.stop();
  });

  test.each([Number.NaN, Number.POSITIVE_INFINITY])(
    "uses the validated default when the page limit is %s",
    async (maxPerPage) => {
      document.body.innerHTML = Array.from(
        { length: 21 },
        (_, index) => `<img src="https://cdn.test/${index}.png">`,
      ).join("");
      const send = vi.fn(() => Promise.resolve("started" as const));
      const limitReached = vi.fn();
      const controller = setupAutoDownloadDiscovery({
        rules,
        live: false,
        maxPerPage,
        send,
        onLimitReached: limitReached,
      });

      await controller.idle();

      expect(send).toHaveBeenCalledTimes(20);
      expect(limitReached).toHaveBeenCalledOnce();
      controller.stop();
    },
  );

  test("stopping cancels observation and prevents queued sends", async () => {
    document.body.innerHTML = `
      <img src="https://cdn.test/one.png">
      <img src="https://cdn.test/two.png">
    `;
    let release: (() => void) | undefined;
    const send = vi.fn(
      () =>
        new Promise<"started">((resolve) => {
          release = () => resolve("started");
        }),
    );
    const controller = setupAutoDownloadDiscovery({ rules, live: true, maxPerPage: 20, send });
    await settle();
    expect(send).toHaveBeenCalledOnce();
    controller.stop();
    release?.();
    await settle();
    expect(send).toHaveBeenCalledOnce();
  });

  test("contains a rejected send and ignores scans while the queue is already draining", async () => {
    document.body.innerHTML = '<img src="https://cdn.test/one.png">';
    let rejectSend!: (error: Error) => void;
    const send = vi.fn(
      () =>
        new Promise<"started">((_resolve, reject) => {
          rejectSend = reject;
        }),
    );
    const controller = setupAutoDownloadDiscovery({ rules, live: false, maxPerPage: 20, send });
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());

    controller.scan();
    rejectSend(new Error("extension context invalidated"));
    await controller.idle();

    expect(send).toHaveBeenCalledOnce();
    controller.stop();
  });

  test("is inert without eligible rules and after it has stopped", async () => {
    document.body.innerHTML = '<img src="https://cdn.test/one.png">';
    const send = vi.fn(() => Promise.resolve("started" as const));
    const controller = setupAutoDownloadDiscovery({
      rules: "filename: \\.png$\ninto: files/",
      live: true,
      maxPerPage: 20,
      send,
    });
    await controller.idle();
    controller.scan();
    controller.stop();
    controller.stop();
    controller.scan();

    expect(send).not.toHaveBeenCalled();
  });

  test("ignores mutations that add no discoverable elements", async () => {
    vi.useFakeTimers();
    const send = vi.fn(() => Promise.resolve("started" as const));
    const controller = setupAutoDownloadDiscovery({ rules, live: true, maxPerPage: 20, send });
    document.body.append(document.createTextNode("text only"));
    await flushLiveScan();

    expect(send).not.toHaveBeenCalled();
    controller.stop();
  });
});

describe("inline data: sources", () => {
  // Matches an inline data: image by kind and the data: scheme. A data: URL has
  // no extension, so kind comes from the <img>, not the URL.
  const dataRules = `
context: ^auto$
pageurl: ^http://localhost/
sourcekind: image
sourceurl: ^data:image/
into: automatic/
`;
  const bigDataUrl = (payloadLength: number): string =>
    `data:image/png;base64,${"A".repeat(payloadLength)}`;

  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  test("adopts an inline data: image only when the option is enabled", async () => {
    document.body.innerHTML = '<img src="data:image/png;base64,iVBORw0KGgoAAAA">';

    const off = vi.fn(() => Promise.resolve("started" as const));
    const controllerOff = setupAutoDownloadDiscovery({
      rules: dataRules,
      live: false,
      maxPerPage: 20,
      send: off,
    });
    await controllerOff.idle();
    expect(off).not.toHaveBeenCalled();
    controllerOff.stop();

    const on = vi.fn(() => Promise.resolve("started" as const));
    const controllerOn = setupAutoDownloadDiscovery({
      rules: dataRules,
      live: false,
      maxPerPage: 20,
      includeDataUrls: true,
      send: on,
    });
    await controllerOn.idle();
    // An inline <img src="data:…"> is embedded media: no channel marker, so it
    // rides the same admission as an embedded http image, gated only by the
    // data: protocol option.
    expect(on).toHaveBeenCalledOnce();
    expect(on).toHaveBeenCalledWith({
      pageUrl: "http://localhost/",
      sourceUrl: "data:image/png;base64,iVBORw0KGgoAAAA",
      sourceKind: "image",
    });
    controllerOn.stop();
  });

  test("drops an oversize data: URL before sending, even with the option on", async () => {
    // Just over the 2 MB cap: rejected at the content gate so it never rides a
    // runtime message.
    document.body.innerHTML = `<img src="${bigDataUrl(2 * 1024 * 1024 + 10)}">`;
    const send = vi.fn(() => Promise.resolve("started" as const));
    const controller = setupAutoDownloadDiscovery({
      rules: dataRules,
      live: false,
      maxPerPage: 20,
      includeDataUrls: true,
      send,
    });
    await controller.idle();
    expect(send).not.toHaveBeenCalled();
    controller.stop();
  });

  test("dedups a long data: URL on its hash, never holding the payload in the seen set", async () => {
    const payload = bigDataUrl(4000);
    document.body.innerHTML = `<img src="${payload}"><img src="${payload}">`;
    const dedup = { seen: new Set<string>(), limitNotified: false };
    const send = vi.fn(() => Promise.resolve("started" as const));
    const controller = setupAutoDownloadDiscovery({
      rules: dataRules,
      live: false,
      maxPerPage: 20,
      includeDataUrls: true,
      send,
      dedup,
    });
    await controller.idle();

    // Two identical large data: images collapse to a single save.
    expect(send).toHaveBeenCalledOnce();
    // The dedup set holds only the short hash key, not the multi-kilobyte URL.
    const keys = [...dedup.seen];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(keys[0]!.length).toBeLessThan(payload.length);
    controller.stop();
  });

  test("does not re-hash an already-seen large data: URL on a rescan", async () => {
    const payload = bigDataUrl(4000);
    document.body.innerHTML = `<img src="${payload}">`;
    const hex = vi.spyOn(Sha256.prototype, "hex");
    const send = vi.fn(() => Promise.resolve("started" as const));
    const controller = setupAutoDownloadDiscovery({
      rules: dataRules,
      live: false,
      maxPerPage: 20,
      includeDataUrls: true,
      send,
    });
    await controller.idle();
    expect(send).toHaveBeenCalledOnce();
    const afterFirstScan = hex.mock.calls.length;
    expect(afterFirstScan).toBeGreaterThan(0);

    // The dedup key is memoized per instance, so a rescan re-derives it from the
    // cache instead of running the pure-JS SHA-256 over the megabyte payload
    // again.
    controller.scan();
    await controller.idle();
    expect(hex).toHaveBeenCalledTimes(afterFirstScan);
    controller.stop();
    hex.mockRestore();
  });

  test("bounds retained data: candidates while allowing a later rescan", async () => {
    const payloads = Array.from({ length: 3 }, (_, index) => bigDataUrl(1_500_000 + index));
    document.body.innerHTML = payloads.map((payload) => `<img src="${payload}">`).join("");
    const hex = vi.spyOn(Sha256.prototype, "hex");
    const send = vi.fn(() => Promise.resolve("started" as const));
    const controller = setupAutoDownloadDiscovery({
      rules: dataRules,
      live: false,
      maxPerPage: 20,
      includeDataUrls: true,
      send,
    });
    await controller.idle();
    const afterFirstScan = hex.mock.calls.length;
    // Two payloads fit the 4 MiB outstanding-character budget; the third is
    // deferred instead of making the queue retain every page-controlled URL.
    expect(send).toHaveBeenCalledTimes(2);

    controller.scan();
    await controller.idle();

    // Once the first batch settles, a later scan can offer the deferred source.
    expect(send).toHaveBeenCalledTimes(3);
    // Crossing the same character budget evicts at least one raw cache key.
    expect(hex.mock.calls.length).toBeGreaterThan(afterFirstScan);
    controller.stop();
    hex.mockRestore();
    // The budget this pins is measured in characters, so the case has to move
    // 4.5 MB through jsdom and SHA-256 to cross it -- shrinking the payloads
    // would test a different bound. That is ~0.5s alone here and ~7s on a
    // 2-vCPU runner sharing itself with every other worker, so the default 5s
    // makes a correct test fail on the runner and nowhere else.
  }, 20_000);

  test("returns queued data: payload budget when discovery stops", async () => {
    const first = bigDataUrl(4000);
    const second = bigDataUrl(4001);
    document.body.innerHTML = `<img src="${first}"><img src="${second}">`;
    let release: (() => void) | undefined;
    const send = vi.fn(
      () =>
        new Promise<"started">((resolve) => {
          release = () => resolve("started");
        }),
    );
    const controller = setupAutoDownloadDiscovery({
      rules: dataRules,
      live: false,
      maxPerPage: 20,
      includeDataUrls: true,
      send,
    });
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());

    controller.stop();
    release?.();
    await settle();

    expect(send).toHaveBeenCalledOnce();
  });

  test("never adopts a blob: source, even with the data: option on", async () => {
    document.body.innerHTML = '<img src="blob:http://localhost/2b8c">';
    const send = vi.fn(() => Promise.resolve("started" as const));
    const controller = setupAutoDownloadDiscovery({
      rules: `
context: ^auto$
pageurl: ^http://localhost/
sourcekind: image
sourceurl: ^blob:
into: automatic/
`,
      live: false,
      maxPerPage: 20,
      includeDataUrls: true,
      send,
    });
    await controller.idle();
    expect(send).not.toHaveBeenCalled();
    controller.stop();
  });
});
