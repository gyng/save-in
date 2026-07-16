// @vitest-environment jsdom
import {
  setupAutoDownloadDiscovery as rawSetupAutoDownloadDiscovery,
  type AutoDownloadDiscoveryOptions,
} from "../../src/content/auto-download.ts";

// Link adoption and the disable-list predicate are wired in from content.ts;
// default them here so each case only states what it exercises.
const setupAutoDownloadDiscovery = (
  options: Omit<AutoDownloadDiscoveryOptions, "includeLinks" | "isPageDisabled"> &
    Partial<Pick<AutoDownloadDiscoveryOptions, "includeLinks" | "isPageDisabled">>,
) =>
  rawSetupAutoDownloadDiscovery({ includeLinks: false, isPageDisabled: () => false, ...options });

const rules = `
context: ^auto$
pageurl: ^http://localhost/
sourcekind: image
sourceurl/i: \\.(?:png|jpg)(?:[?#].*)?$
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
